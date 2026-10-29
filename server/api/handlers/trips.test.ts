// Uji handler trip (server/api/handlers/trips.ts). Fokusnya: AKAR MASALAH HTTP 500 pada POST /trips/complete.

import { assertEquals, assert, assertStringIncludes, } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { asUuidOrNull, errorText, explainDbError, isUuid, } from "./trips.ts";



const UUID_A = "3f9b1c2e-5a7d-4b8c-9e1f-2a3b4c5d6e7f";



const UUID_B = "11111111-2222-3333-4444-555555555555";



Deno.test("isUuid hanya menerima UUID Accelerator yang valid", () => {
  assert(isUuid(UUID_A));
  assert(isUuid(UUID_B.toUpperCase()));
  assert(isUuid(`  ${UUID_A}  `));

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
  // Galat PostgREST BUKAN instance Error. Kalau diproses dengan String(error), pesannya hilang -> "[object Object]".
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

  assertEquals(explainDbError(new Error("boom")), null);
  assertEquals(explainDbError({ message: "boom" }), null);
});

// Uji handler POST /trips/complete. Fokus: memastikan trip yang dikirim petugas benar-benar TERSIMPAN di database, dan tidak pernah "berhasil" (2xx)…


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
  region_tariff_rows: {
    columns: new Set([
      "id", "region_id", "golongan", "vehicle_type", "lokal_tariff",
      "muatan_tariff", "kosong_tariff", "is_active", "updated_at",
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



function applyFilters(
  rows: Record<string, unknown>[],
  params: URLSearchParams,
): Record<string, unknown>[] {
  let out = rows;
  for (const [key, raw] of params.entries()) {
    if (!raw.startsWith("eq.")) continue;
    const wanted = raw.slice("eq.".length);
    out = out.filter((r) => String(r[key] ?? "") === wanted);
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

    if (req.method === "GET") {
      const select = url.searchParams.get("select");
      if (select) {
        // Hanya kolom sederhana yang dicek; embed diabaikan.
        for (const part of select.split(",")) {
          const col = part.trim().split("(")[0].trim();
          if (col && col !== "*" && !t.columns.has(col)) {
            return pgrstError("42703", `column "${table}.${col}" does not exist`);
          }
        }
      }
      const rows = applyFilters(t.rows, url.searchParams);
      return Response.json(rows);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const incoming = Array.isArray(body) ? body : [body];
      const created: Record<string, unknown>[] = [];
      for (const row of incoming) {
        for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
          if (value === null || value === undefined) continue;
          if (UUID_COLUMNS.has(key) && !UUID_RE.test(String(value))) {
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

    if (req.method === "DELETE") {
      const targets = applyFilters(t.rows, url.searchParams);
      for (const row of targets) {
        const idx = t.rows.indexOf(row);
        if (idx >= 0) t.rows.splice(idx, 1);
      }
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
  TABLES.officers.rows.push({ id: OFFICER_ID });
}



Deno.test("petugas tanpa region: trip tetap tersimpan (region_id null)", async () => {
  resetTables();
  const { completeTrip } = await loadHandler();
  const { signToken } = await import("../_shared.ts");

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

  // Percobaan kedua dengan client_trip_id sama tapi trip yang BERBEDA (mis.
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

  // Folder bucket foto dibuat read-only -> upload foto harus gagal dengan pesan yang bisa ditindaklanjuti, bukan "gagal mengunggah" yang kabur.
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
  invalidateTariffCache();

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

  const vehicles = TABLES.vehicles.rows;
  assertEquals(vehicles.length, 1);
  assertEquals(vehicles[0].tariff_amount, 50_000, "harga harus mengikuti tarif saat trip dikirim");
  assertEquals(vehicles[0].tarif_source, "region-row", "sumber harga harus tercatat");

  // Admin mengubah tarif -> baris yang sudah tersimpan TIDAK boleh ikut berubah.
  TABLES.region_tariff_rows.rows[0].muatan_tariff = 75_000;
  assertEquals(vehicles[0].tariff_amount, 50_000, "harga trip lama tidak boleh ikut berubah");
});
