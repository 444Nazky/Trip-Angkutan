// Uji resolveTariff: tiap region punya tarif sendiri, bukan menyalin BADAU. Skenario: BADAU motor 50.000; BELITUNG punya baris motor 45.000;

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";



const BADAU = "11111111-1111-4111-8111-111111111111";



const BELITUNG = "22222222-2222-4222-8222-222222222222";



const LAIN = "33333333-3333-4333-8333-333333333333";



const FALLBACK = "44444444-4444-4444-8444-444444444444";



const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/tariffs") return Response.json([]);
  if (url.pathname === "/region_tariff_rows") {
    return Response.json([
      {
        region_id: BADAU,
        vehicle_type: "motor",
        lokal_tariff: 15000,
        muatan_tariff: 50000,
        kosong_tariff: 45000,
        is_active: 1,
      },
      {
        region_id: BELITUNG,
        vehicle_type: "motor",
        lokal_tariff: 12000,
        muatan_tariff: 45000,
        kosong_tariff: 40000,
        is_active: 1,
      },
      {
        region_id: FALLBACK,
        vehicle_type: "motor",
        lokal_tariff: 0,
        muatan_tariff: 30000,
        kosong_tariff: 25000,
        is_active: 1,
      },
    ]);
  }
  if (url.pathname === "/region_tariffs") {
    return Response.json([
      {
        region_id: FALLBACK,
        tariff_type: "lokal",
        nominal_tariff: 9000,
        is_active: 1,
      },
    ]);
  }
  return Response.json({ message: `unexpected ${url.pathname}` }, { status: 400 });
});



Deno.env.set("POSTGREST_URL", `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);



const { resolveTariff, invalidateTariffCache } = await import("./tariffRules.ts");



Deno.test("region dengan baris sendiri memakai harganya", async () => {
  invalidateTariffCache();
  const res = await resolveTariff({
    regionId: BELITUNG,
    vehicleType: "motor",
    hasLoad: true,
    golongan: "II",
    kategori: "Eksternal",
  });
  assertEquals(res.amount, 45000);
  assertEquals(res.source, "region-row");
});



Deno.test("region tanpa baris = Rp 0, bukan menyalin BADAU", async () => {
  invalidateTariffCache();
  const res = await resolveTariff({
    regionId: LAIN,
    vehicleType: "motor",
    hasLoad: true,
    golongan: "II",
    kategori: "Eksternal",
  });
  assertEquals(res.amount, 0);
  assertEquals(res.source, "tanpa-tarif");
});



Deno.test("BADAU memakai barisnya sendiri 50.000", async () => {
  invalidateTariffCache();
  const res = await resolveTariff({
    regionId: BADAU,
    vehicleType: "motor",
    hasLoad: true,
    golongan: "II",
    kategori: "Eksternal",
  });
  assertEquals(res.amount, 50000);
  assertEquals(res.source, "region-row");
});



Deno.test("tarif lokal memakai lokal_tariff milik jenis kendaraan itu", async () => {
  invalidateTariffCache();
  const res = await resolveTariff({
    regionId: BELITUNG,
    vehicleType: "motor",
    hasLoad: true,
    golongan: "II",
    kategori: "Lokal",
  });
  assertEquals(res.amount, 12000);
  assertEquals(res.source, "region-row");
});



Deno.test("lokal_tariff 0 jatuh ke tarif flat wilayah", async () => {
  invalidateTariffCache();
  const res = await resolveTariff({
    regionId: FALLBACK,
    vehicleType: "motor",
    hasLoad: true,
    golongan: "II",
    kategori: "Lokal",
  });
  assertEquals(res.amount, 9000);
  assertEquals(res.source, "region");
});



Deno.test("cleanup", () => server.shutdown());
