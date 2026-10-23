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

// ── Import router utama ───────────────────────────────────────────────────────

const { handleRequest } = await import("./index.ts");

// ── Server ────────────────────────────────────────────────────────────────────

// Deno.networkInterfaces() mengembalikan Promise<NetworkInterface[]>, BUKAN
// array. Tanpa `await`, `for...of` melempar TypeError ("not iterable") yang
// ditangkap try/catch sehingga daftar IP LAN selalu kosong.
async function lanAddresses(): Promise<string[]> {
  const out: string[] = [];
  try {
    const interfaces = await Deno.networkInterfaces();
    for (const iface of interfaces) {
      for (const addr of iface.addresses ?? []) {
        if (addr.family === "IPv4" && !addr.internal) out.push(addr.address);
      }
    }
  } catch {
    // networkInterfaces tidak tersedia di beberapa runtime -> abaikan.
  }
  return out;
}

Deno.serve(
  { port: PORT, hostname: HOST, onListen: async ({ hostname, port }) => {
    console.log(`[api-intranet] API lokal siap di http://${hostname}:${port}/api`);
    for (const ip of await lanAddresses()) {
      console.log(`[api-intranet]   - LAN: http://${ip}:${port}/api`);
    }
  } },
  handleRequest,
);

console.log("[api-intranet] Service key dipakai: service_role (akses penuh DB)");
