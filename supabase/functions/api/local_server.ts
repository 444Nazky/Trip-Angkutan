/**
 * Server API INTRANET (port 3000).
 *
 * Menjalankan API Edge Function yang PERSIS SAMA dengan yang di-deploy ke
 * Supabase, tapi di dalam jaringan lokal kantor (PC Ubuntu 192.168.1.123).
 *
 * Aplikasi mobile punya dua pilihan endpoint:
 *   - Cloud   : https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api
 *   - Intranet: http://192.168.1.123:3000/api
 *
 * Router, rate limit, cache, CORS, dan handler-nya identik — yang berbeda
 * hanya alamat jemputannya dan cara database-nya diakses (Tetap Supabase
 * PostgreSQL lewat service role key; tidak ada database lokal).
 *
 * Syarat environment (lihat supabase/functions/api/.env.example):
 *   SUPABASE_URL             - URL project Supabase
 *   SUPABASE_SERVICE_ROLE_KEY - service role key (wajib)
 *   JWT_SECRET               - HARUS SAMA dengan secret di Supabase, kalau tidak
 *                             token yang issued cloud tidak valid di intranet
 *   ADMIN_USERNAME/PASSWORD  - kredensial admin dashboard (opsional)
 */

const PORT = Number(Deno.env.get("PORT") ?? "3000");
const HOST = Deno.env.get("HOST") ?? "0.0.0.0";

// Nonaktifkan server bawaan di index.ts supaya tidak ada dua Deno.serve
// dalam satu proses. Harus di-set SEBELUM import modul index.
Deno.env.set("API_DISABLE_EMBEDDED_SERVER", "1");

// ── Pre-flight: secrets wajib ada ─────────────────────────────────────────────

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;
const missing = REQUIRED.filter((k) => !Deno.env.get(k));

if (missing.length > 0) {
  console.error(
    `[api-intranet] GAGAL START: env wajib belum diisi -> ${missing.join(", ")}`,
  );
  console.error(
    `[api-intranet] Buat file supabase/functions/api/.env.local (lihat .env.example) lalu restart.`,
  );
  Deno.exit(1);
}

// JWT_SECRET kosong tidak mematikan server, tapi token yang issued server
// cloud TIDAK akan valid di intranet (dan sebaliknya) -> petugas harus
// login ulang setiap kali endpoint-nya diganti.
if (!Deno.env.get("JWT_SECRET")) {
  console.warn(
    "[api-intranet] PERINGATAN: JWT_SECRET kosong. Set nilainya SAMA dengan secret di " +
      "Supabase (supabase secrets list) supaya token dari server cloud tetap valid di intranet.",
  );
}

// ── Import router utama ───────────────────────────────────────────────────────

const { handleRequest } = await import("./index.ts");

// ── Server ────────────────────────────────────────────────────────────────────

// Deno 2.x: `Deno.networkInterfaces()` mengembalikan DAFTAR ALAMAT yang datar
// (NetworkInterfaceInfo: { name, family, address, ... }), BUKAN array interface
// yang masing-masing punya `.addresses` seperti Deno 1.x.
//
// Kalau ditulis ala Deno 1 (`iface.addresses`), hasilnya ALWAYS array kosong:
// `iface.addresses` undefined -> `?? []` -> tidak ada satu pun IP yang
// tercetak, tanpa error. Itu sebabnya banner LAN pernah kosong.
async function lanAddresses(): Promise<string[]> {
  const out: string[] = [];
  try {
    const infos = await Deno.networkInterfaces();
    for (const info of infos) {
      if (info.family !== "IPv4") continue;
      if (info.name === "lo") continue;
      const ip = info.address;
      if (!ip || ip.startsWith("127.")) continue;
      if (!out.includes(ip)) out.push(ip);
    }
  } catch {
    // networkInterfaces tidak tersedia di beberapa runtime -> abaikan.
  }
  return out;
}

// Alamat LAN dihitung SEBELUM Deno.serve: callback `onListen` dijalankan
// sinkron oleh Deno, jadi kalau isinya `await`, sisa kode setelah await
// tidak ikut tercetak tepat waktu (banner LAN pernah kosong).
const LAN_IPS = await lanAddresses();

Deno.serve(
  { port: PORT, hostname: HOST, onListen: ({ hostname, port }) => {
    console.log(`[api-intranet] API lokal siap di http://${hostname}:${port}/api`);
    for (const ip of LAN_IPS) {
      console.log(`[api-intranet]   - LAN: http://${ip}:${port}/api`);
    }
  } },
  handleRequest,
);

console.log("[api-intranet] Service key dipakai: service_role (akses penuh DB)");
