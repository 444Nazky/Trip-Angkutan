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
  validateCancelPayload,
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

// Uji handler POST /trips/complete.
//
// Fokus: memastikan trip yang dikirim petugas benar-benar TERSIMPAN di
// database, dan tidak pernah "berhasil" (2xx) padahal tidak ada baris trip
// yang baru.
//
// Empat skenario yang diuji:
//   1. Petugas tanpa region (region_id NULL di DB) -> token punya regionId
//      null. Handler lama menulis region_id = "" -> PostgreSQL menolak
//      "invalid input syntax for type uuid" -> HTTP 500 -> trip tidak pernah
//      masuk dashboard.
//   2. ID dermaga lawas (bukan UUID) dikirim klien -> sama, insert gagal.
//   3. client_trip_id yang sama dipakai ulang -> handler lama diam-diam
//      MENGUBAH trip lama (baris baru tidak dibuat, created_at lama) ->
//      petugas melihat "terkirim" tapi trip tidak muncul sebagai data baru.
//   4. Retry yang sama persis -> harus idempoten (tidak menggandakan baris).
//
// Jalankan:
//   deno test --allow-net --allow-env --allow-read --allow-write \
//     server/api/handlers/trips.test.ts


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface FakeTable {
  columns: Set<string>;
  rows: Record<string, unknown>[];
}

const TABLES: Record<string, FakeTable> = {
  trips: {
    columns: new Set([
      "id", "no_trip", "officer_id", "region_id", "dermaga_id", "route_id",
      "status_muatan", "route_from", "route_to", "keterangan",
      "foto_kosong_path", "foto_captured_at", "foto_latitude", "foto_longitude",
      "started_at", "completed_at", "client_trip_id", "is_synced", "created_at",
      "selfie_path", "selfie_captured_at",
    ]),
    rows: [],
  },
  vehicles: {
    columns: new Set([
      "id", "no_polisi", "vehicle_type", "golongan", "trip_id", "has_load",
      "tariff_id", "tariff_amount", "foto_path", "foto_captured_at",
      "latitude", "longitude", "created_at", "kategori", "tarif_source",
    ]),
    rows: [],
  },
  trip_vehicles: {
    columns: new Set(["id", "trip_id", "vehicle_id", "created_at"]),
    rows: [],
  },
  officer_dermagas: {
    columns: new Set(["officer_id", "dermaga_id"]),
    rows: [],
  },
  dermagas: {
    columns: new Set(["id", "region_id", "name", "code", "username", "created_at"]),
    rows: [],
  },
  regions: {
    columns: new Set(["id", "name", "code", "password", "created_at"]),
    rows: [],
  },
  officers: {
    columns: new Set(["id", "name", "username", "password", "region_id", "created_at"]),
    rows: [],
  },
  tariffs: {
    columns: new Set([
      "id", "golongan", "vehicle_type", "loaded_tariff", "empty_tariff",
      "description", "is_active", "created_at",
    ]),
    rows: [],
  },
  region_tariffs: {
    columns: new Set([
      "id", "region_id", "tariff_type", "nominal_tariff", "is_active",
      "golongan", "vehicle_type", "muatan_tariff", "kosong_tariff",
    ]),
    rows: [],
  },
  // Baris tarif per region per jenis kendaraan (sumber harga saat insert).
  region_tariff_rows: {
    columns: new Set([
      "id", "region_id", "golongan", "vehicle_type", "lokal_tariff",
      "muatan_tariff", "kosong_tariff", "is_active", "updated_at",
    ]),
    rows: [],
  },
  // Dokumen pembatalan trip (hasil POST /trips/cancel).
  trip_cancellations: {
    columns: new Set([
      "id", "no_cancel", "client_cancel_id", "officer_id", "region_id",
      "dermaga_id", "reason", "note", "route_from", "route_to", "route_code",
      "condition", "vehicle_count", "vehicles", "photo_count", "started_at",
      "cancelled_at", "created_at",
    ]),
    rows: [],
  },
};

/** Kolom yang nilainya harus UUID (FK). */
const UUID_COLUMNS = new Set([
  "officer_id", "region_id", "dermaga_id", "route_id", "trip_id",
  "vehicle_id", "tariff_id", "origin_region_id", "checkpoint_region_id",
]);

function pgrstError(code: string, message: string, status = 400): Response {
  return new Response(JSON.stringify({ code, message, details: null, hint: null }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Terapkan filter PostgREST yang dipakai handler:
 *   `eq.<nilai>`    - kesamaan persis
 *   `gte.<nilai>`   - lebih besar atau sama (timestamptz terurut)
 *   `lte.<nilai>`   - lebih kecil atau sama
 *   `ilike.<pola>`  - pencarian teks, `%` = wildcard
 *   `or=(a,b,...)`  - salah satu dari (dipakai untuk pencarian bebas)
 *
 * Nilai dibaca apa adanya (tanpa decoding URL) supaya cocok dengan cara
 * `db.from().eq()` menuliskan parameter.
 */
function applyFilters(
  rows: Record<string, unknown>[],
  params: URLSearchParams,
): Record<string, unknown>[] {
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (key === "or") {
      // Bentuk: `(col.op.value,col.op.value)` — setiap bagian dipecah pada
      // koma di LUAR nilai.
      const inner = raw.replace(/^\(|\)$/g, "");
      const parts = inner.split(",").map(p => p.trim()).filter(Boolean);
      out = out.filter((r) =>
        parts.some((part) => {
          const dot = part.indexOf(".");
          if (dot < 0) return false;
          const col = part.slice(0, dot);
          const rest = part.slice(dot + 1);
          const opDot = rest.indexOf(".");
          if (opDot < 0) return false;
          const op = rest.slice(0, opDot);
          const value = rest.slice(opDot + 1);
          const cell = String(r[col] ?? "");
          if (op === "ilike") {
            const re = new RegExp(
              `^${value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
              "i",
            );
            return re.test(cell);
          }
          if (op === "eq") return cell === value;
          return false;
        })
      );
      continue;
    }
    if (raw.startsWith("eq.")) {
      const wanted = raw.slice("eq.".length);
      out = out.filter((r) => String(r[key] ?? "") === wanted);
      continue;
    }
    if (raw.startsWith("gte.")) {
      const wanted = raw.slice("gte.".length);
      out = out.filter((r) => String(r[key] ?? "") >= wanted);
      continue;
    }
    if (raw.startsWith("lte.")) {
      const wanted = raw.slice("lte.".length);
      out = out.filter((r) => String(r[key] ?? "") <= wanted);
      continue;
    }
    if (raw.startsWith("ilike.")) {
      const pattern = raw.slice("ilike.".length);
      const re = new RegExp(
        `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`,
        "i",
      );
      out = out.filter((r) => re.test(String(r[key] ?? "")));
    }
  }
  return out;
}

function startFakePostgrest() {
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
    const url = new URL(req.url);
    const table = decodeURIComponent(url.pathname.slice(1));
    const t = TABLES[table];
    if (!t) return pgrstError("42P01", `relation "${table}" does not exist`, 404);

    const prefer = req.headers.get("Prefer") ?? "";
    const wantsRepresentation = prefer.includes("return=representation");
    const wantsObject = (req.headers.get("Accept") ?? "").includes("pgrst.object");

    // ---- GET ----
    if (req.method === "GET") {
      const select = url.searchParams.get("select");
      if (select) {
        // Hanya kolom sederhana yang dicek; embed (mis. `officers(name)`)
        // diabaikan — PostgREST menyelesaikan embed lewat relasi FK.
        for (const part of select.split(",")) {
          const trimmed = part.trim();
          if (trimmed.includes("(")) continue; // embed
          const col = trimmed.split("(")[0].trim();
          if (col && col !== "*" && !t.columns.has(col)) {
            return pgrstError("42703", `column "${table}.${col}" does not exist`);
          }
        }
      }
      const rows = applyFilters(t.rows, url.searchParams);

      // Urut according parameter `order` (mis. `cancelled_at.desc`).
      const order = url.searchParams.get("order");
      let sorted = rows;
      if (order) {
        sorted = [...rows].sort((a, b) => {
          for (const clause of order.split(",")) {
            const [col, dir] = clause.trim().split(".");
            const av = String(a[col] ?? "");
            const bv = String(b[col] ?? "");
            if (av === bv) continue;
            const cmp = av < bv ? -1 : 1;
            return dir === "desc" ? -cmp : cmp;
          }
          return 0;
        });
      }

      const limit = url.searchParams.get("limit");
      const offset = url.searchParams.get("offset");
      let page = sorted;
      if (offset) page = page.slice(Number(offset));
      if (limit) page = page.slice(0, Number(limit));
      return Response.json(page);
    }

    // ---- POST (insert) ----
    if (req.method === "POST") {
      const body = await req.json();
      const incoming = Array.isArray(body) ? body : [body];
      const created: Record<string, unknown>[] = [];
      for (const row of incoming) {
        for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
          if (value === null || value === undefined) continue;
          if (UUID_COLUMNS.has(key) && !UUID_RE.test(String(value))) {
            // PostgreSQL: invalid input syntax for type uuid
            return pgrstError("22P02", `invalid input syntax for type uuid: "${value}"`);
          }
        }
        created.push({ ...(row as Record<string, unknown>) });
      }
      t.rows.push(...created);
      if (wantsRepresentation) {
        const payload = wantsObject ? created[0] : created;
        return Response.json(payload, { status: 201 });
      }
      return new Response(null, { status: 201 });
    }

    // ---- PATCH (update) ----
    if (req.method === "PATCH") {
      const body = await req.json();
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (value === null || value === undefined) continue;
        if (UUID_COLUMNS.has(key) && !UUID_RE.test(String(value))) {
          return pgrstError("22P02", `invalid input syntax for type uuid: "${value}"`);
        }
      }
      const targets = applyFilters(t.rows, url.searchParams);
      for (const row of targets) Object.assign(row, body);
      if (wantsRepresentation) return Response.json(wantsObject ? targets[0] : targets);
      return new Response(null, { status: 204 });
    }

    // ---- DELETE ----
    if (req.method === "DELETE") {
      const targets = applyFilters(t.rows, url.searchParams);
      for (const row of targets) {
        const idx = t.rows.indexOf(row);
        if (idx >= 0) t.rows.splice(idx, 1);
      }
      // PostgreSQL: trip_vehicles.vehicle_id ON DELETE CASCADE.
      if (table === "vehicles") {
        const removed = new Set(targets.map((r) => String(r.id)));
        const links = TABLES.trip_vehicles.rows;
        for (let i = links.length - 1; i >= 0; i--) {
          if (removed.has(String(links[i].vehicle_id))) links.splice(i, 1);
        }
      }
      return new Response(null, { status: 204 });
    }

    return new Response("method not allowed", { status: 405 });
  });

  return { url: `http://127.0.0.1:${server.addr.port}`, close: () => server.shutdown() };
}

const fake = startFakePostgrest();
const TMP_DIR = await Deno.makeTempDir({ prefix: "trip-test-" });

async function loadHandler() {
  Deno.env.set("JWT_SECRET", "secret-untuk-uji");
  Deno.env.set("POSTGREST_URL", fake.url);
  Deno.env.set("STORAGE_DIR", TMP_DIR);
  const module = await import("./trips.ts");
  return module as typeof import("./trips.ts");
}

const OFFICER_ID = "11111111-1111-4111-8111-111111111111";
const REGION_ID = "22222222-2222-4222-8222-222222222222";
const DERMAGA_ID = "33333333-3333-4333-8333-333333333333";

/** PNG 1x1 - berkas uji, bukan foto asli. */
const PNG = Uint8Array.from(
  atob(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489" +
      "0000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082",
  ),
  (c) => c.charCodeAt(0),
);

function multipart(
  payload: unknown,
  photoCount: number,
  dermagaId?: string,
): { body: Uint8Array; contentType: string } {
  const boundary = "----ujitrip" + Math.random().toString(16).slice(2);
  const chunks: Uint8Array[] = [];
  const enc = new TextEncoder();

  const push = (s: string) => chunks.push(enc.encode(s));
  push(`--${boundary}\r\nContent-Disposition: form-data; name="payload"\r\n\r\n`);
  push(JSON.stringify(payload));
  push("\r\n");
  if (dermagaId !== undefined) {
    push(`--${boundary}\r\nContent-Disposition: form-data; name="dermagaId"\r\n\r\n`);
    push(dermagaId);
    push("\r\n");
  }
  for (let i = 0; i < photoCount; i++) {
    push(
      `--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="p${i}.png"\r\n` +
        "Content-Type: image/png\r\n\r\n",
    );
    chunks.push(PNG);
    push("\r\n");
  }
  push(`--${boundary}--\r\n`);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    body.set(c, offset);
    offset += c.length;
  }
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function basePayload(clientTripId: string) {
  return {
    clientTripId,
    statusMuatan: "muatan",
    routeFrom: "UJI",
    routeTo: "UJI2",
    route: "UJI-UJI2",
    routeCode: "UJI-UJI2",
    keterangan: "uji",
    tripPhotoIndex: 0,
    selfieIndex: 1,
    selfieCapturedAt: "2026-10-27T02:00:00.000Z",
    tripPhotoCapturedAt: "2026-10-27T02:00:00.000Z",
    tripPhotoLatitude: -6.2,
    tripPhotoLongitude: 106.9,
    startedAt: "2026-10-27T01:00:00.000Z",
    completedAt: "2026-10-27T02:00:00.000Z",
    vehicles: [{
      noPolisi: "B 1234 ABC",
      vehicleType: "Truck",
      golongan: "I",
      kategori: "Internal",
      hasLoad: true,
      photoIndex: 2,
      photoCapturedAt: "2026-10-27T02:00:00.000Z",
      latitude: -6.2,
      longitude: 106.9,
      tariffAmount: 0,
    }],
  };
}

function requestFor(
  payload: unknown,
  photoCount: number,
  dermagaId: string | undefined,
  token: string,
): Request {
  const { body, contentType } = multipart(payload, photoCount, dermagaId);
  return new Request("http://127.0.0.1:3000/api/trips/complete", {
    method: "POST",
    headers: { "Content-Type": contentType, Authorization: `Bearer ${token}` },
    body: body as unknown as BodyInit,
  });
}

function resetTables() {
  for (const t of Object.values(TABLES)) t.rows.length = 0;
  // Handler memverifikasi officer ada di tabel (penjaga FK).
  TABLES.officers.rows.push({ id: OFFICER_ID });
}

Deno.test("petugas tanpa region: trip tetap tersimpan (region_id null)", async () => {
  resetTables();
  const { completeTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");

  // Petugas yang TIDAK punya region -> token regionId null.
  const token = await signToken({ officerId: OFFICER_ID, regionId: null as unknown as string, role: "officer" });

  const res = await completeTrip(requestFor(basePayload("TRP-2026-0001"), 3, DERMAGA_ID, token));
  const body = await res.json();

  assertEquals(res.status, 201, `harus 201, dapat ${res.status}: ${JSON.stringify(body)}`);
  const trips = TABLES.trips.rows;
  assertEquals(trips.length, 1, "harus ada satu baris trip");
  assertEquals(trips[0].officer_id, OFFICER_ID);
  assertEquals(trips[0].region_id, null, "region_id harus null, bukan string kosong");
});

Deno.test("id dermaga bukan UUID: trip tetap tersimpan (dermaga_id null)", async () => {
  resetTables();
  const { completeTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ officerId: OFFICER_ID, regionId: REGION_ID, role: "officer" });

  // Klien mengirim id dermaga lawas (bukan UUID).
  const res = await completeTrip(requestFor(basePayload("TRP-2026-0001"), 3, "BADAU-D1", token));
  const body = await res.json();

  assertEquals(res.status, 201, `harus 201, dapat ${res.status}: ${JSON.stringify(body)}`);
  assertEquals(TABLES.trips.rows.length, 1, "harus ada satu baris trip");
  assertEquals(TABLES.trips.rows[0].dermaga_id, null, "dermaga_id harus null");
});

Deno.test("client_trip_id yang sama -> trip BARU dibuat, bukan trip lama yang ditimpa", async () => {
  resetTables();
  const { completeTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ officerId: OFFICER_ID, regionId: REGION_ID, role: "officer" });

  const first = await completeTrip(requestFor(basePayload("TRP-2026-0001"), 3, DERMAGA_ID, token));
  assertEquals(first.status, 201);

  // Percobaan kedua dengan client_trip_id sama tapi trip yang BERBEDA
  // (mis. perangkat lain, atau riwayat perangkat dihapus sehingga penomoran
  // mulai dari nol lagi). Waktu selesai juga berbeda karena ini trip lain.
  const payload2 = basePayload("TRP-2026-0001");
  payload2.routeFrom = "LAIN";
  payload2.routeTo = "LAIN2";
  payload2.completedAt = "2026-10-28T03:00:00.000Z";
  payload2.startedAt = "2026-10-28T02:00:00.000Z";
  const second = await completeTrip(requestFor(payload2, 3, DERMAGA_ID, token));

  assertEquals(second.status, 201, "percobaan kedua harus membuat trip baru");
  assertEquals(TABLES.trips.rows.length, 2, "harus ada DUA baris trip, bukan satu yang ditimpa");
});

Deno.test("pengiriman ulang trip yang sama (retry) tetap idempoten", async () => {
  resetTables();
  const { completeTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ officerId: OFFICER_ID, regionId: REGION_ID, role: "officer" });

  const payload = basePayload("TRP-2026-0001");
  const first = await completeTrip(requestFor(payload, 3, DERMAGA_ID, token));
  assertEquals(first.status, 201);
  const second = await completeTrip(requestFor(payload, 3, DERMAGA_ID, token));

  // Retry yang sama persis TIDAK boleh menggandakan baris.
  assertEquals(TABLES.trips.rows.length, 1, "retry identik tidak boleh menambah baris");
  assertEquals(second.status, 200, "retry identik boleh mengembalikan 200 updated");
});

Deno.test("error penyimpanan berkas diteruskan dengan pesan yang bisa ditindaklanjuti", async () => {
  resetTables();
  const { completeTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ officerId: OFFICER_ID, regionId: REGION_ID, role: "officer" });

  // Folder bucket foto dibuat read-only -> upload foto harus gagal dengan
  // pesan yang bisa ditindaklanjuti, bukan "gagal mengunggah" yang kabur.
  const bucketDir = `${TMP_DIR}/trip-photos`;
  await Deno.mkdir(bucketDir, { recursive: true });
  await Deno.chmod(bucketDir, 0o500);
  try {
    const res = await completeTrip(requestFor(basePayload("TRP-2026-0001"), 3, DERMAGA_ID, token));
    const body = await res.json();
    assertEquals(res.status >= 400, true, "gagal simpan berkas harus jadi error");
    assertStringIncludes(String(body.error ?? "").toLowerCase(), "berkas");
  } finally {
    await Deno.chmod(bucketDir, 0o700);
  }
});

Deno.test("harga saat trip dikirim tersimpan sebagai snapshot (perubahan tarif tidak menimpa)", async () => {
  resetTables();
  const { completeTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const { invalidateTariffCache } = await import("./tariffRules.ts");
  // Cache tarif bisa saja sudah terisi dari file uji lain -> bersihkan dulu.
  invalidateTariffCache();

  // Region + baris tarif: Truck bermuatan 50.000.
  TABLES.regions.rows.push({ id: REGION_ID, name: "BADAU", code: "BADAU" });
  TABLES.region_tariff_rows.rows.push({
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    region_id: REGION_ID,
    vehicle_type: "Truk Besar",
    lokal_tariff: 0,
    muatan_tariff: 50_000,
    kosong_tariff: 45_000,
    is_active: 1,
  });

  const token = await signToken({ officerId: OFFICER_ID, regionId: REGION_ID, role: "officer" });
  const payload = basePayload("TRP-2026-0002");
  payload.vehicles[0].kategori = "Eksternal";
  payload.vehicles[0].vehicleType = "Truk Besar";
  payload.vehicles[0].tariffAmount = 0;

  const res = await completeTrip(requestFor(payload, 3, DERMAGA_ID, token));
  assertEquals(res.status, 201, `harus 201, dapat ${res.status}: ${await res.clone().text()}`);

  // Harga yang tercatat = harga tarif SAAT INI (saat trip dikirim).
  const vehicles = TABLES.vehicles.rows;
  assertEquals(vehicles.length, 1);
  assertEquals(vehicles[0].tariff_amount, 50_000, "harga harus mengikuti tarif saat trip dikirim");
  assertEquals(vehicles[0].tarif_source, "region-row", "sumber harga harus tercatat");

  // Admin mengubah tarif -> baris yang sudah tersimpan TIDAK boleh ikut berubah.
  TABLES.region_tariff_rows.rows[0].muatan_tariff = 75_000;
  assertEquals(vehicles[0].tariff_amount, 50_000, "harga trip lama tidak boleh ikut berubah");
});

Deno.test("dokumen pembatalan wajib punya alasan", () => {
  assertEquals(validateCancelPayload({ reason: "Pelanggan membatalkan" }), null);
  assertEquals(
    validateCancelPayload({ reason: "  " }),
    "Alasan pembatalan wajib diisi",
  );
  assertEquals(
    validateCancelPayload({ note: "tanpa alasan" }),
    "Alasan pembatalan wajib diisi",
  );
  assertEquals(
    validateCancelPayload(null),
    "Payload pembatalan tidak valid",
  );
  assertEquals(
    validateCancelPayload({ reason: "x".repeat(200) }),
    "Alasan pembatalan terlalu panjang",
  );
});

/** Permintaan POST JSON (dipakai endpoint pembatalan). */
function jsonRequest(path: string, body: unknown, token: string): Request {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

Deno.test("pembatalan tanpa alasan ditolak", async () => {
  resetTables();
  const { cancelTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ officerId: OFFICER_ID, regionId: REGION_ID, role: "officer" });

  const res = await cancelTrip(jsonRequest("/trips/cancel", { clientCancelId: "c1" }, token));
  assertEquals(res.status, 400);
  assertEquals(TABLES.trip_cancellations.rows.length, 0, "dokumen tidak boleh tersimpan tanpa alasan");
});

Deno.test("dokumen pembatalan tersimpan lengkap dengan rincian trip", async () => {
  resetTables();
  const { cancelTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ officerId: OFFICER_ID, regionId: REGION_ID, role: "officer" });

  const res = await cancelTrip(jsonRequest("/trips/cancel", {
    clientCancelId: "c-123",
    reason: "Pelanggan membatalkan",
    note: "kapal ditunda",
    routeFrom: "SJRE",
    routeTo: "SBDZ",
    routeCode: "SJRE-SBDZ",
    condition: "muatan",
    vehicleCount: 1,
    vehicles: [{ plate: "B 1234 XY", type: "Mobil", category: "Lokal", load: "loaded", tariff: 75000 }],
    photoCount: 2,
  }, token));
  const body = await res.json();

  assertEquals(res.status, 201, `harus 201, dapat ${res.status}: ${JSON.stringify(body)}`);
  assertEquals(TABLES.trip_cancellations.rows.length, 1);
  const row = TABLES.trip_cancellations.rows[0];
  assertEquals(row.reason, "Pelanggan membatalkan");
  assertEquals(row.note, "kapal ditunda");
  assertEquals(row.officer_id, OFFICER_ID);
  assertEquals(row.route_from, "SJRE");
  assertEquals(row.vehicle_count, 1);
  assertEquals(row.photo_count, 2);
  assert(String(row.no_cancel).startsWith("CNL"), "nomor dokumen harus berawalan CNL");
});

Deno.test("pengiriman ulang dokumen pembatalan tidak membuat dokumen ganda", async () => {
  resetTables();
  const { cancelTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ officerId: OFFICER_ID, regionId: REGION_ID, role: "officer" });

  const payload = {
    clientCancelId: "c-456",
    reason: "Data masuk salah",
    routeFrom: "A",
    routeTo: "B",
  };
  const first = await cancelTrip(jsonRequest("/trips/cancel", payload, token));
  assertEquals(first.status, 201);
  const second = await cancelTrip(jsonRequest("/trips/cancel", payload, token));
  assertEquals(second.status, 200, "dokumen yang sama harus dikenali, bukan dibuat ulang");
  assertEquals(TABLES.trip_cancellations.rows.length, 1, "harus tetap satu dokumen");
});

// ── Uji endpoint pemantauan pembatalan ───────────────────────────────────────
//
// Admin memakai tab "Pembatalan Trip" untuk melihat DOKUMEN pembatalan:
// daftar, filter (tanggal/alasan/cari), dan ringkasan (per alasan, per hari,
// per petugas). Ringkasan dihitung di server supaya angka pada kartu,
// grafik, dan tabel selalu berasal dari potongan data yang sama.

Deno.test("ringkasan pembatalan menghitung per alasan, per hari, per petugas", async () => {
  const { summarizeCancellations } = await loadHandler();

  const summary = summarizeCancellations([
    {
      reason: "Pelanggan membatalkan",
      officer_id: "officer-a",
      officer_name: "Petugas A",
      vehicle_count: 2,
      photo_count: 1,
      cancelled_at: "2026-11-01T02:00:00.000Z", // 09:00 WIB -> 1 Nov
    },
    {
      reason: "Pelanggan membatalkan",
      officer_id: "officer-a",
      officer_name: "Petugas A",
      vehicle_count: 1,
      photo_count: 0,
      cancelled_at: "2026-11-01T15:00:00.000Z", // 22:00 WIB -> 1 Nov
    },
    {
      reason: "Data masuk salah",
      officer_id: "officer-b",
      officer_name: "Petugas B",
      vehicle_count: 3,
      photo_count: 4,
      cancelled_at: "2026-11-02T01:00:00.000Z", // 08:00 WIB -> 2 Nov
    },
  ]);

  assertEquals(summary.total, 3);
  // Alasan paling banyak dihitung DULU, bukan yang terakhir.
  assertEquals(summary.byReason[0], { reason: "Pelanggan membatalkan", count: 2 });
  assertEquals(summary.byReason[1], { reason: "Data masuk salah", count: 1 });
  // Tanggal dihitung dalam zona WIB (UTC 02:00 = 09:00 WIB, masih 1 Nov).
  assertEquals(summary.byDay, [
    { day: "2026-11-01", count: 2 },
    { day: "2026-11-02", count: 1 },
  ]);
  assertEquals(summary.byOfficer[0], {
    officerId: "officer-a",
    officerName: "Petugas A",
    count: 2,
  });
  assertEquals(summary.vehicleCount, 6);
  assertEquals(summary.photoCount, 5);
});

Deno.test("ringkasan pembatalan tetap benar saat tidak ada dokumen", async () => {
  const { summarizeCancellations } = await loadHandler();
  const summary = summarizeCancellations([]);
  assertEquals(summary.total, 0);
  assertEquals(summary.byReason, []);
  assertEquals(summary.byDay, []);
  assertEquals(summary.byOfficer, []);
});

Deno.test("daftar pembatalan difilter tanggal, alasan, dan pencarian", async () => {
  resetTables();
  const { getTripCancellations } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ role: "admin", username: "admin" });

  TABLES.trip_cancellations.rows.push(
    {
      id: "c-1",
      no_cancel: "CNL20261101AAAAAA",
      officer_id: OFFICER_ID,
      officer_name: "Petugas A",
      reason: "Pelanggan membatalkan",
      note: "kapal ditunda",
      route_from: "SJRE",
      route_to: "SBDZ",
      vehicle_count: 1,
      photo_count: 2,
      cancelled_at: "2026-11-01T02:00:00.000Z",
    },
    {
      id: "c-2",
      no_cancel: "CNL20261105BBBBBB",
      officer_id: OFFICER_ID,
      officer_name: "Petugas A",
      reason: "Data masuk salah",
      note: null,
      route_from: "CRB",
      route_to: "SBDZ",
      vehicle_count: 3,
      photo_count: 0,
      cancelled_at: "2026-11-05T08:00:00.000Z",
    },
  );

  const get = async (qs: string) => {
    const res = await getTripCancellations(
      new Request(`http://x/trips/cancellations${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      }),
      new URL(`http://x/trips/cancellations${qs}`),
    );
    assertEquals(res.status, 200, `harus 200, dapat ${res.status}`);
    return await res.json();
  };

  // Tanpa filter -> semua dokumen.
  assertEquals((await get("")).length, 2);

  // Rentang tanggal (WIB). 1 Nov 00:00 WIB = 31 Okt 17:00 UTC.
  const satuNov = await get("?startDate=2026-11-01&endDate=2026-11-01");
  assertEquals(satuNov.length, 1);
  assertEquals(satuNov[0].id, "c-1");

  // Filter alasan.
  const salahData = await get("?reason=Data%20masuk%20salah");
  assertEquals(salahData.length, 1);
  assertEquals(salahData[0].id, "c-2");

  // Pencarian bebas pada keterangan.
  const cari = await get("?q=kapal");
  assertEquals(cari.length, 1);
  assertEquals(cari[0].id, "c-1");
});

Deno.test("mode=summary mengembalikan ringkasan, bukan daftar dokumen", async () => {
  resetTables();
  const { getTripCancellations } = await loadHandler();
  const { signToken } = await import("../_shared.ts");
  const token = await signToken({ role: "admin", username: "admin" });

  TABLES.trip_cancellations.rows.push({
    id: "c-9",
    no_cancel: "CNL20261101CCCCCC",
    officer_id: OFFICER_ID,
    officer_name: "Petugas C",
    reason: "Lainnya",
    note: null,
    vehicle_count: 2,
    photo_count: 1,
    cancelled_at: "2026-11-01T02:00:00.000Z",
  });

  const url = new URL("http://x/trips/cancellations?mode=summary");
  const res = await getTripCancellations(
    new Request("http://x/trips/cancellations?mode=summary", {
      headers: { Authorization: `Bearer ${token}` },
    }),
    url,
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.total, 1);
  assertEquals(body.byReason, [{ reason: "Lainnya", count: 1 }]);
  assertEquals(body.vehicleCount, 2);
});
