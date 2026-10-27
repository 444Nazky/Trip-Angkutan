/**
 * Uji handler trip (server/api/handlers/trips.ts).
 *
 * Fokusnya: AKAR MASALAH HTTP 500 pada POST /trips/complete.
 *
 * Semua kolom FK di tabel trips/vehicles/dermagas bertipe `uuid`. Nilai
 * yang bukan uuid (mis. ID dermaga lawas "BADAU-D1", atau region kosong "")
 * membuat PostgreSQL menjawab 22P02 (invalid input syntax for type uuid),
 * yang sebelumnya dilempar apa adanya -> router jadi HTTP 500 generik ->
 * petugas melihat "gagal mengunggah" tanpa tahu penyebabnya.
 *
 * Jalankan:
 *   deno test --allow-env server/api/handlers/trips.test.ts
 */

import {
  assertEquals,
  assert,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  asUuidOrNull,
  errorText,
  explainDbError,
  isUuid,
  pickRetryCandidate,
} from "./trips.ts";

const UUID_A = "3f9b1c2e-5a7d-4b8c-9e1f-2a3b4c5d6e7f";
const UUID_B = "11111111-2222-3333-4444-555555555555";

Deno.test("isUuid hanya menerima UUID Accelerator yang valid", () => {
  assert(isUuid(UUID_A));
  assert(isUuid(UUID_B.toUpperCase()));
  assert(isUuid(`  ${UUID_A}  `)); // spasi di tolerated

  // Nilai legacy / rusak yang dulu menggagalkan insert.
  assertEquals(isUuid("BADAU-D1"), false);
  assertEquals(isUuid("off1"), false);
  assertEquals(isUuid(""), false);
  assertEquals(isUuid("   "), false);
  assertEquals(isUuid(null), false);
  assertEquals(isUuid(undefined), false);
  assertEquals(isUuid(123), false);
  assertEquals(isUuid({}), false);
});

Deno.test("asUuidOrNull membuang nilai rusak jadi null (bukan error)", () => {
  assertEquals(asUuidOrNull(UUID_A), UUID_A);
  assertEquals(asUuidOrNull(" BADAU-D1 "), null);
  assertEquals(asUuidOrNull(""), null);
  assertEquals(asUuidOrNull(null), null);
  assertEquals(asUuidOrNull(undefined), null);
});

Deno.test("errorText membaca pesan dari error PostgREST (objek biasa)", () => {
  // Galat PostgREST BUKAN instance Error. Kalau diproses dengan String(error),
  // pesannya hilang -> "[object Object]".
  const pgError = { message: 'invalid input syntax for type uuid', code: "22P02" };
  assertEquals(errorText(pgError), "invalid input syntax for type uuid");
  assertEquals(errorText(new Error("boom")), "boom");
  assertStringIncludes(errorText({}), "[object Object]");
});

Deno.test("pickRetryCandidate: retry sejati dicocokkan lewat completed_at", () => {
  const candidates = [
    {
      id: "lama",
      no_trip: "TRP-LAMA",
      completed_at: "2026-10-21T08:20:30.528Z",
      created_at: "2026-10-21T08:20:30Z",
    },
    {
      id: "baru",
      no_trip: "TRP-BARU",
      completed_at: "2026-10-27T06:27:19.523Z",
      created_at: "2026-10-27T06:27:19Z",
    },
  ];

  // Request ulang trip baru harus memilih baris baru, bukan baris lama yang
  // kebetulan memakai client_trip_id yang sama.
  assertEquals(pickRetryCandidate(candidates, "2026-10-27T06:27:19.523Z")?.id, "baru");
  assertEquals(pickRetryCandidate(candidates, "2026-10-21T08:20:30.528Z")?.id, "lama");
});

Deno.test("pickRetryCandidate: id lokal dipakai ulang -> BUKAN retry (jangan timpa)", () => {
  const lama = [{
    id: "lama",
    completed_at: "2026-10-21T08:20:30.528Z",
    created_at: "2026-10-21T08:20:30Z",
  }];

  // completedAt berbeda 6 hari = trip baru; server WAJIB insert baris baru.
  assertEquals(pickRetryCandidate(lama, "2026-10-27T06:27:19.523Z"), null);
  // Tanpa completedAt dan trip sudah lama -> jangan menebak sebagai retry.
  assertEquals(pickRetryCandidate(lama, null), null);
});

Deno.test("pickRetryCandidate: klien lama tanpa completedAt hanya retry jika masih baru", () => {
  const now = Date.parse("2026-10-27T10:00:00Z");
  const segar = [{ id: "segar", created_at: "2026-10-27T09:55:00Z" }];
  const basi = [{ id: "basi", created_at: "2026-10-20T09:55:00Z" }];

  assertEquals(pickRetryCandidate(segar, undefined, now)?.id, "segar");
  assertEquals(pickRetryCandidate(basi, undefined, now), null);
});

Deno.test("explainDbError memetakan galat database ke status yang tepat", () => {
  const invalidUuid = explainDbError({ message: "invalid input syntax for type uuid", code: "22P02" });
  assertEquals(invalidUuid?.status, 400);
  assertStringIncludes(invalidUuid!.message, "tidak valid");

  const fk = explainDbError({
    message: 'insert or update on table "trips" violates foreign key constraint "trips_dermaga_id_fkey"',
    code: "23503",
  });
  assertEquals(fk?.status, 409);
  assertStringIncludes(fk!.message, "23503");

  const unik = explainDbError({ message: "duplicate key value", code: "23505" });
  assertEquals(unik?.status, 409);

  // Galat tak dikenal -> null (biarkan jalur umum yang menangani).
  assertEquals(explainDbError(new Error("boom")), null);
  assertEquals(explainDbError({ message: "boom" }), null);
});
