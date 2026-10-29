// Uji metrik server (server/api/_metrics.ts dan server/api/_system.ts). Fokusnya dua hal: 1.

import { assert, assertEquals, } from "https://deno.land/std@0.224.0/assert/mod.ts";

import { recordRequest, snapshot } from "./_metrics.ts";
import { systemSnapshot } from "./_system.ts";



Deno.test("snapshot() mengirim 60 bucket per menit yang kontinu", () => {
  const snap = snapshot();
  assertEquals(snap.buckets.length, 60);

  // Jarak antar bucket harus tepat 1 menit.
  for (let i = 1; i < snap.buckets.length; i++) {
    assertEquals(snap.buckets[i].minute - snap.buckets[i - 1].minute, 60_000);
  }

  const currentMinute = Math.floor(Date.now() / 60_000) * 60_000;
  assertEquals(snap.buckets[snap.buckets.length - 1].minute, currentMinute);
});



Deno.test("bucket terisi setelah ada request", () => {
  recordRequest({
    path: "/api/test-ping",
    method: "GET",
    status: 200,
    ms: 5,
    ip: "10.0.0.1",
  });

  const snap = snapshot();
  const last = snap.buckets[snap.buckets.length - 1];
  assert(last.total >= 1);
  assertEquals(last.ok >= 1, true);
});



Deno.test("snapshot sistem terbaca di mesin Linux", async () => {
  const sys = await systemSnapshot();
  // Deno memblokir /proc kecuali --allow-all atau --allow-run=cat (subprocess `cat` yang dipakai _system.ts).
  if (!sys.available) {
    console.warn("SKIP: /proc tidak terbaca (butuh --allow-run=cat atau --allow-all)");
    return;
  }
  assert(sys.memory.total > 0, "MemTotal harus terbaca dari /proc/meminfo");
  assert(sys.cpu.cores > 0, "jumlah core harus terbaca dari /proc/cpuinfo");
  assert(sys.uptimeSeconds > 0, "uptime mesin harus terbaca dari /proc/uptime");
  for (const d of sys.disks) {
    assert(d.usedPercent >= 0 && d.usedPercent <= 100, "persentase disk harus 0-100");
  }
});
