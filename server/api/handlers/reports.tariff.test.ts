// Uji: perubahan tarif di admin HANYA berlaku untuk trip selanjutnya.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";



const REGION_ID = "11111111-1111-4111-8111-111111111111";



const TRIP_LAMA = "22222222-2222-4222-8222-222222222222";



const TRIP_BARU = "33333333-3333-4333-8333-333333333333";



let tarifMotor = 50_000;



const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => {
  const url = new URL(req.url);
  const table = url.pathname.slice(1);

  if (table === "trips") {
    return Response.json([
      {
        id: TRIP_LAMA,
        no_trip: "T-001",
        region_id: REGION_ID,
        created_at: "2026-01-01T08:00:00Z",
        status_muatan: "muatan",
        officers: { name: "Petugas" },
        regions: { name: "BADAU", code: "BADAU" },
      },
      {
        id: TRIP_BARU,
        no_trip: "T-002",
        region_id: REGION_ID,
        created_at: "2026-01-02T08:00:00Z",
        status_muatan: "muatan",
        officers: { name: "Petugas" },
        regions: { name: "BADAU", code: "BADAU" },
      },
    ]);
  }

  if (table === "trip_vehicles") {
    return Response.json([
      {
        trip_id: TRIP_LAMA,
        vehicles: {
          id: "v-lama",
          no_polisi: "B 1111 AAA",
          vehicle_type: "motor",
          golongan: "",
          kategori: "Eksternal",
          has_load: 1,
          tariff_amount: 50_000,
          tarif_source: "region-row",
          trip_id: TRIP_LAMA,
        },
      },
      {
        trip_id: TRIP_BARU,
        vehicles: {
          id: "v-baru",
          no_polisi: "B 2222 BBB",
          vehicle_type: "motor",
          golongan: "",
          kategori: "Eksternal",
          has_load: 1,
          // Harga saat trip dikirim (2 Januari, setelah tarif diubah).
          tariff_amount: 75_000,
          tarif_source: "region-row",
          trip_id: TRIP_BARU,
        },
      },
    ]);
  }

  if (table === "vehicles") {
    return Response.json([{ id: "v-lama", kategori: "Eksternal" }]);
  }

  if (table === "region_tariff_rows") {
    return Response.json([
      {
        region_id: REGION_ID,
        vehicle_type: "motor",
        lokal_tariff: 0,
        muatan_tariff: tarifMotor,
        kosong_tariff: tarifMotor,
        is_active: 1,
      },
    ]);
  }

  if (table === "region_tariffs") return Response.json([]);
  if (table === "plate_scans") return Response.json([]);
  if (table === "vehicle_plates") return Response.json([]);

  return Response.json({ message: `unexpected ${table}` }, { status: 400 });
});



Deno.env.set("POSTGREST_URL", `http://127.0.0.1:${(server.addr as Deno.NetAddr).port}`);



Deno.env.set("JWT_SECRET", "secret-untuk-uji-tarif");



const { signToken } = await import("../_shared.ts");



const { tripsReport } = await import("./reports.ts");



const token = await signToken({ officerId: REGION_ID, role: "admin", username: "admin" });



function report(): Request {
  return new Request("http://127.0.0.1:3000/api/reports/trips", {
    headers: { Authorization: `Bearer ${token}` },
  });
}



Deno.test("trip lama tetap memakai harga saat dikirim setelah tarif diubah", async () => {
  tarifMotor = 75_000;

  const res = await tripsReport(report(), new URL("http://127.0.0.1:3000/api/reports/trips"));
  const body = await res.json();
  assertEquals(res.status, 200, JSON.stringify(body));

  const lama = (body ?? []).find((t: any) => t.id === TRIP_LAMA);
  const baru = (body ?? []).find((t: any) => t.id === TRIP_BARU);

  // Trip lama: harga SEBELUM perubahan (50.000), bukan 75.000.
  assertEquals(lama?.vehicles?.[0]?.tariff_amount, 50_000);
  // Trip baru: harga SETELAH perubahan (75.000).
  assertEquals(baru?.vehicles?.[0]?.tariff_amount, 75_000);
});



Deno.test("cleanup", () => server.shutdown());
