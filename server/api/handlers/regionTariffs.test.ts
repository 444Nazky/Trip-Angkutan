// Uji PUT /region-tariffs/:id (handler tarif per region).

import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";



const REGION_ID = "3f9b1c2e-5a7d-4b8c-9e1f-2a3b4c5d6e7f";



const saved: Record<string, unknown>[] = [];



const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, async (req) => {
  const url = new URL(req.url);
  const table = url.pathname.slice(1);
  if (table === "regions" && req.method === "GET") {
    return Response.json([{ id: REGION_ID }]);
  }
  if (table === "region_tariff_rows" && req.method === "POST") {
    saved.push(await req.json());
    return Response.json(saved[saved.length - 1], { status: 201 });
  }
  return Response.json({ message: `unexpected ${req.method} ${table}`, code: "XX000" }, { status: 400 });
});



Deno.env.set("POSTGREST_URL", `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);



Deno.env.set("JWT_SECRET", "secret-untuk-uji-tarif");



const { signToken } = await import("../_shared.ts");



const { updateRegionTariff } = await import("./regionTariffs.ts");



const token = await signToken({ officerId: REGION_ID, role: "admin", username: "admin" });



function put(payload: unknown): Request {
  return new Request(`http://127.0.0.1:3000/api/region-tariffs/${REGION_ID}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}



Deno.test("PUT baris tarif region non-BADAU tersimpan (body dibaca sekali)", async () => {
  const res = await updateRegionTariff(
    put({ vehicleType: "motor", muatanTariff: 45000, kosongTariff: 40000 }),
    REGION_ID,
  );
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));
  assertEquals(saved.length, 1);
  assertEquals(saved[0].region_id, REGION_ID);
  assertEquals(saved[0].vehicle_type, "motor");
  assertEquals(saved[0].muatan_tariff, 45000);
  assertEquals(saved[0].kosong_tariff, 40000);
});



Deno.test("payload tanpa vehicleType tetap ditolak 400 (bukan 500)", async () => {
  const res = await updateRegionTariff(put({ foo: 1 }), REGION_ID);
  assertStringIncludes(String((await res.json()).error ?? ""), "tariffType");
});



Deno.test("cleanup", () => server.shutdown());
