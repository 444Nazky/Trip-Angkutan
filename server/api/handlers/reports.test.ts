/**
 * Uji laporan trip:
 *   1. laporan membaca SEMUA halaman (tidak berhenti diam-diam di 1.000 baris);
 *   2. query kendaraan dipecah menjadi potongan <= 100 id;
 *   3. galat database pada ringkasan menjadi HTTP 500, bukan total 0.
 *
 * Jalankan:
 *   deno test --allow-net --allow-env server/api/handlers/reports.test.ts
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

const TRIP_COUNT = 1200;

type Call = { table: string; inCount: number };

/**
 * PostgREST tiruan. Hanya endpoint yang dipakai handler laporan yang
 * dilayani; sisanya dibalas array kosong supaya fallback tarif tidak
 * menembak jaringan sungguhan.
 */
function startFakePostgrest(mode: "ok" | "summary-error") {
  const calls: Call[] = [];
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", onListen: () => {} }, (req) => {
    const url = new URL(req.url);
    const table = url.pathname.replace(/^\//, "");
    const inParam = url.searchParams.get("trip_id") ?? "";
    calls.push({
      table,
      inCount: inParam.startsWith("in.(") ? inParam.slice(4, -1).split(",").length : 0,
    });

    if (table === "trips") {
      if (mode === "summary-error") return new Response("db down", { status: 500 });
      if (req.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": `0-0/${TRIP_COUNT}` },
        });
      }
      const offset = Number(url.searchParams.get("offset") ?? 0);
      const limit = Number(url.searchParams.get("limit") ?? 1000);
      const rows = [];
      for (let i = offset; i < Math.min(offset + limit, TRIP_COUNT); i++) {
        rows.push({
          id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          no_trip: `T-${i}`,
          status_muatan: "muatan",
          created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
          officer_name: "Petugas",
        });
      }
      return Response.json(rows);
    }

    if (table === "vehicles") {
      if (mode === "summary-error") return new Response("db down", { status: 500 });
      if (req.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-range": "0-0/0" },
        });
      }
      return Response.json([]);
    }

    return Response.json([]);
  });
  return { url: `http://127.0.0.1:${server.addr.port}`, calls, close: () => server.shutdown() };
}

// JWT_SECRET dibaca saat modul diimpor, jadi harus di-set lebih dulu.
Deno.env.set("JWT_SECRET", "secret-uji-laporan");
const { signToken } = await import("../_shared.ts");
const token = await signToken({ role: "admin", username: "admin" }, 60);
const { summary, tripsReport } = await import("./reports.ts");

function authedRequest(path: string): Request {
  return new Request(`http://127.0.0.1:3000${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

Deno.test("laporan trip membaca semua halaman dan memecah id kendaraan <= 100", async () => {
  const fake = startFakePostgrest("ok");
  try {
    Deno.env.set("POSTGREST_URL", fake.url);
    const req = authedRequest("/api/reports/trips");
    const res = await tripsReport(req, new URL(req.url));

    assertEquals(res.status, 200);
    const rows = await res.json();
    assertEquals(rows.length, TRIP_COUNT);

    const vehicleCalls = fake.calls.filter((c) => c.table === "trip_vehicles");
    assertEquals(vehicleCalls.length, Math.ceil(TRIP_COUNT / 100));
    assertEquals(Math.max(...vehicleCalls.map((c) => c.inCount)), 100);
  } finally {
    fake.close();
  }
});

Deno.test("ringkasan membalas 500 saat database gagal, bukan total 0", async () => {
  const fake = startFakePostgrest("summary-error");
  try {
    Deno.env.set("POSTGREST_URL", fake.url);
    const req = authedRequest("/api/reports/summary");
    const res = await summary(req, new URL(req.url));
    assertEquals(res.status, 500);
  } finally {
    fake.close();
  }
});
