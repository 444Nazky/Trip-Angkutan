// Uji endpoint tarif region yang bekerja pada BANYAK region sekaligus: - POST /region-tariffs/bulk -> tulis satu jenis ke semua region - DELETE…

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";



const REGION_A = "3f9b1c2e-5a7d-4b8c-9e1f-2a3b4c5d6e7f";



const REGION_B = "4a8c2d3f-6b8e-4c9d-a0f2-3b4c5d6e7f80";



interface SavedRow {
  region_id: string;
  vehicle_type: string;
  muatan_tariff: number;
  kosong_tariff: number;
  is_active: number;
}



const saved: SavedRow[] = [];



const deletedQueries: string[] = [];



const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const table = url.pathname.slice(1);

  if (table === "regions" && req.method === "GET") {
    return Response.json([
      { id: REGION_A, name: "Badau", code: "BADAU" },
      { id: REGION_B, name: "Belitung", code: "BLT" },
    ]);
  }
  if (table === "region_tariff_rows" && req.method === "GET") {
    // Hanya BADAU yang sudah punya baris untuk "Truck Kecil".
    return Response.json([{ id: "row-1", region_id: REGION_A, vehicle_type: "Truck Kecil" }]);
  }
  if (table === "region_tariff_rows" && req.method === "POST") {
    const body = await req.json();
    const rows = Array.isArray(body) ? body : [body];
    saved.push(...rows);
    return Response.json(rows, { status: 201 });
  }
  if (table === "region_tariff_rows" && req.method === "DELETE") {
    deletedQueries.push(url.search);
    return new Response(null, { status: 204 });
  }
  return Response.json({ message: `unexpected ${req.method} ${table}`, code: "XX000" }, { status: 400 });
});



Deno.env.set("POSTGREST_URL", `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);



Deno.env.set("JWT_SECRET", "secret-untuk-uji-tarif-bulk");



const { signToken } = await import("../_shared.ts");



const { bulkUpdateRegionTariffRows, deleteRegionTariffRow } = await import("./regionTariffs.ts");



const token = await signToken({ officerId: REGION_A, role: "admin", username: "admin" });



function bulkPost(payload: unknown): Request {
  return new Request("http://127.0.0.1:3000/api/region-tariffs/bulk", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}



function deleteReq(regionId: string, vehicleType: string): Request {
  return new Request(
    `http://127.0.0.1:3000/api/region-tariffs/${regionId}/rows/${encodeURIComponent(vehicleType)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } },
  );
}



Deno.test("bulk scope=all menulis ke semua region dan mempertahankan ejaan lama", async () => {
  saved.length = 0;
  const res = await bulkUpdateRegionTariffRows(
    bulkPost({ vehicleType: "truk kecil", muatanTariff: 45000, kosongTariff: 40000, scope: "all" }),
  );
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(body.updated, 2);

  const a = saved.find((r) => r.region_id === REGION_A);
  const b = saved.find((r) => r.region_id === REGION_B);
  assertEquals(a?.vehicle_type, "Truck Kecil");
  assertEquals(b?.vehicle_type, "truk kecil");
  assertEquals(a?.muatan_tariff, 45000);
  assertEquals(b?.kosong_tariff, 40000);
});



Deno.test("bulk scope=existing hanya menyentuh region yang sudah punya baris", async () => {
  saved.length = 0;
  const res = await bulkUpdateRegionTariffRows(
    bulkPost({ vehicleType: "truk kecil", muatanTariff: 50000, kosongTariff: 45000, scope: "existing" }),
  );
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(body.updated, 1);
  assertEquals(saved.length, 1);
  assertEquals(saved[0].region_id, REGION_A);
});



Deno.test("bulk tanpa jenis kendaraan ditolak 400", async () => {
  const res = await bulkUpdateRegionTariffRows(bulkPost({ muatanTariff: 1000 }));
  assertEquals(res.status, 400);
  assertStringIncludes(String((await res.json()).error ?? ""), "Jenis kendaraan");
});



Deno.test("hapus baris tarif memakai pencocokan case-insensitive", async () => {
  deletedQueries.length = 0;
  const res = await deleteRegionTariffRow(deleteReq(REGION_A, "Truck Kecil"), REGION_A, "Truck%20Kecil");
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(body.deleted, true);
  assertEquals(deletedQueries.length, 1);
  // Penghapusan dilakukan per id baris (bukan per nama), jadi tidak ada masalah encoding spasi.
  assertStringIncludes(deletedQueries[0], "id=eq.row-1");
});



Deno.test("hapus baris tanpa jenis kendaraan ditolak 400", async () => {
  const res = await deleteRegionTariffRow(deleteReq(REGION_A, ""), REGION_A, "");
  assertEquals(res.status, 400);
});



Deno.test("cleanup", () => server.shutdown());
