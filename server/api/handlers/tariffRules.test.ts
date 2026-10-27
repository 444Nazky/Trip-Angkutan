/**
 * Uji resolveTariff: tiap region punya tarif sendiri, bukan menyalin BADAU.
 *
 * Skenario: BADAU (master) motor 50.000; BELITUNG punya baris override motor
 * 45.000. Keduanya harus mengembalikan nominal masing-masing, dan region tanpa
 * override tetap ikut master.
 *
 * Jalankan:
 *   deno test --allow-env --allow-net server/api/handlers/tariffRules.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BADAU = "11111111-1111-4111-8111-111111111111";
const BELITUNG = "22222222-2222-4222-8222-222222222222";
const LAIN = "33333333-3333-4333-8333-333333333333";

const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/tariffs") {
    return Response.json([{
      id: "t-motor",
      golongan: "II",
      vehicle_type: "motor",
      loaded_tariff: 50000,
      empty_tariff: 45000,
      description: null,
      is_active: 1,
    }]);
  }
  if (url.pathname === "/region_tariff_rows") {
    return Response.json([{
      region_id: BELITUNG,
      golongan: "II",
      vehicle_type: "motor",
      muatan_tariff: 45000,
      kosong_tariff: 40000,
      is_active: 1,
    }]);
  }
  if (url.pathname === "/region_tariffs") return Response.json([]);
  return Response.json({ message: `unexpected ${url.pathname}` }, { status: 400 });
});

Deno.env.set("POSTGREST_URL", `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);

const { resolveTariff, invalidateTariffCache } = await import("./tariffRules.ts");

Deno.test("region dengan override memakai harganya sendiri", async () => {
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

Deno.test("region tanpa override tetap ikut master BADAU", async () => {
  invalidateTariffCache();
  const res = await resolveTariff({
    regionId: LAIN,
    vehicleType: "motor",
    hasLoad: true,
    golongan: "II",
    kategori: "Eksternal",
  });
  assertEquals(res.amount, 50000);
  assertEquals(res.source, "master");
});

Deno.test("BADAU sendiri memakai master 50.000", async () => {
  invalidateTariffCache();
  const res = await resolveTariff({
    regionId: BADAU,
    vehicleType: "motor",
    hasLoad: true,
    golongan: "II",
    kategori: "Eksternal",
  });
  assertEquals(res.amount, 50000);
  assertEquals(res.source, "master");
});

Deno.test("cleanup", () => server.shutdown());
