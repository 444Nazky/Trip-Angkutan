// Uji handler master jenis kendaraan (`server/api/handlers/vehicleTypes.ts`). Yang dikunci di sini: 1.

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";



const TYPE_ID = "11111111-2222-3333-4444-555555555555";



const store = {
  vehicle_types: [] as Record<string, unknown>[],
  region_tariff_rows: [] as Record<string, unknown>[],
  tariffs: [] as Record<string, unknown>[],
  inserted: [] as Record<string, unknown>[],
  deleted: [] as string[],
  updated: [] as Record<string, unknown>[],
};



const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const table = url.pathname.slice(1);
  const method = req.method;

  if (table === "vehicle_types") {
    if (method === "GET") {
      let rows = store.vehicle_types;
      const idFilter = url.searchParams.get("id");
      const keyFilter = url.searchParams.get("key");
      if (idFilter) {
        const want = idFilter.replace(/^eq\./, "");
        rows = rows.filter((r) => String(r.id) === want);
      }
      if (keyFilter) {
        const want = keyFilter.replace(/^eq\./, "");
        rows = rows.filter((r) => String(r.key) === want);
      }
      return Response.json(rows);
    }
    if (method === "POST") {
      const body = await req.json() as Record<string, unknown>;
      store.inserted.push(body);
      const row = { id: TYPE_ID, ...body };
      store.vehicle_types.push(row);
      return Response.json(row, { status: 201 });
    }
    if (method === "PATCH") {
      const body = await req.json() as Record<string, unknown>;
      store.updated.push(body);
      return Response.json(store.vehicle_types);
    }
    if (method === "DELETE") {
      store.deleted.push((url.searchParams.get("id") ?? "").replace(/^eq\./, ""));
      store.vehicle_types = store.vehicle_types.filter((r) => r.id !== TYPE_ID);
      return Response.json(store.vehicle_types);
    }
  }

  if (table === "region_tariff_rows") {
    if (method === "GET") return Response.json(store.region_tariff_rows);
    if (method === "PATCH") {
      const body = await req.json() as Record<string, unknown>;
      store.updated.push(body);
      return Response.json(store.region_tariff_rows);
    }
    if (method === "DELETE") {
      store.deleted.push((url.searchParams.get("id") ?? "").replace(/^eq\./, ""));
      return Response.json(store.region_tariff_rows);
    }
  }

  if (table === "tariffs") {
    if (method === "GET") return Response.json(store.tariffs);
    if (method === "PATCH") return Response.json(store.tariffs);
    if (method === "DELETE") return Response.json(store.tariffs);
  }

  return Response.json({ message: `unexpected ${method} ${table}`, code: "XX000" }, { status: 400 });
});



Deno.env.set("POSTGREST_URL", `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);



Deno.env.set("JWT_SECRET", "secret-untuk-uji-jenis-kendaraan");



const { signToken } = await import("../_shared.ts");



const { getVehicleTypes, createVehicleType, updateVehicleType, deleteVehicleType } = await import(
  "./vehicleTypes.ts"
);



const token = await signToken({ officerId: "officer-1", role: "admin", username: "admin" });



function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://127.0.0.1:3000/api${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}



function reset(): void {
  store.vehicle_types = [];
  store.region_tariff_rows = [];
  store.tariffs = [];
  store.inserted = [];
  store.deleted = [];
  store.updated = [];
}



Deno.test("GET daftar jenis kendaraan dibaca dari tabel vehicle_types", async () => {
  reset();
  store.vehicle_types = [
    { id: "a", name: "Motor", key: "motor", sort_order: 1, is_active: 1 },
    { id: "b", name: "Truk Kecil", key: "trukkecil", sort_order: 2, is_active: 1 },
    { id: "c", name: "Truk Lama", key: "truklama", sort_order: 3, is_active: 0 },
  ];

  const res = await getVehicleTypes(req("GET", "/vehicle-types"));
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.length, 2);
  assertEquals(body[0].name, "Motor");
  assertEquals(body[0].isActive, true);
});



Deno.test("POST jenis baru benar-benar menulis ke database", async () => {
  reset();
  const res = await createVehicleType(req("POST", "/vehicle-types", { name: "Truk Ringan" }));
  const body = await res.json();
  assertEquals(res.status, 201);
  assertEquals(store.inserted.length, 1);
  assertEquals(store.inserted[0].name, "Truk Ringan");
  assertEquals(store.inserted[0].key, "trukringan");
  assertEquals(body.name, "Truk Ringan");
});



Deno.test("POST jenis yang sudah ada (beda ejaan) ditolak -> tidak ada jenis ganda", async () => {
  reset();
  store.vehicle_types = [{ id: "a", name: "Truk Kecil", key: "trukkecil", sort_order: 1, is_active: 1 }];

  const res = await createVehicleType(req("POST", "/vehicle-types", { name: "truk kecil" }));
  const body = await res.json();
  assertEquals(res.status, 409);
  assertStringIncludes(String(body.error), "sudah ada");
  assertEquals(store.inserted.length, 0);
});



Deno.test("POST tanpa nama ditolak (400)", async () => {
  reset();
  const res = await createVehicleType(req("POST", "/vehicle-types", { name: "   " }));
  assertEquals(res.status, 400);
  assertEquals(store.inserted.length, 0);
});



Deno.test("PUT nama baru menulis ulang baris tarif yang pakai ejaan lama", async () => {
  reset();
  store.vehicle_types = [{ id: TYPE_ID, name: "Truk Kecil", key: "trukkecil", sort_order: 1, is_active: 1 }];
  store.region_tariff_rows = [
    { id: "row-1", region_id: "r1", vehicle_type: "Truk Kecil" },
    { id: "row-2", region_id: "r2", vehicle_type: "truk kecil" },
  ];

  const res = await updateVehicleType(req("PUT", `/vehicle-types/${TYPE_ID}`, { name: "Truk Ringan" }), TYPE_ID);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.renamed, 2);
  const renamed = store.updated.find((u) => u.vehicle_type === "Truk Ringan");
  assertEquals(renamed?.vehicle_type, "Truk Ringan");
});



Deno.test("DELETE jenis menghapus baris tarifnya juga", async () => {
  reset();
  store.vehicle_types = [{ id: TYPE_ID, name: "Truk Kecil", key: "trukkecil", sort_order: 1, is_active: 1 }];
  store.region_tariff_rows = [{ id: "row-1", region_id: "r1", vehicle_type: "Truk Kecil" }];

  const res = await deleteVehicleType(req("DELETE", `/vehicle-types/${TYPE_ID}`), TYPE_ID);
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.deletedRows, 1);
  assertEquals(store.deleted.includes("row-1"), true);
  assertEquals(store.deleted.includes(TYPE_ID), true);
});
