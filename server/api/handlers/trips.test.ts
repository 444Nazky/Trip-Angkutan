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
