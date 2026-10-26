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

// JWT_SECRET WAJIB ada di server intranet.
//
// Kenapa wajib (bukan sekadar peringatan):
//   `_shared.ts` memakai fallback `|| "trip-angkut-secret-key"` kalau env
//   kosong. Fallback itu tertulis di source repo, jadi anybody yang bisa
//   membaca repo bisa MEMBUAT TOKEN ADMIN SENDIRI secara offline (HMAC-SHA256
//   dengan key yang diketahui). Server intranet ini listen di 0.0.0.0:3000
//   -> reachable dari device mana pun di LAN.
//
//   Plus CORS API intranet mengizinkan origin `*` (_shared.ts), jadi halaman
//   web yang dibuka petugas di browser pun bisa menembak API intranet.
//
//   Perhatikan: pre-flight ini HANYA jalan di server intranet (file ini).
//   Edge Function di Supabase tidak pernah lewat file ini, jadi perubahan
//   ini tidak memengaruhi deployment cloud.
const REQUIRED = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "JWT_SECRET",
] as const;
const missing = REQUIRED.filter((k) => !Deno.env.get(k));

if (missing.length > 0) {
  console.error(
    `[api-intranet] GAGAL START: env wajib belum diisi -> ${missing.join(", ")}`,
  );
  console.error(
    `[api-intranet] Buat file supabase/functions/api/.env.local (lihat .env.example) lalu restart.`,
  );
  if (missing.includes("JWT_SECRET")) {
    console.error(
      `[api-intranet] JWT_SECRET tidak boleh kosong: tanpa itu server memakai secret` +
        ` default yang tertulis di source, dan token admin bisa dipalsukan.`,
    );
    console.error(
      `[api-intranet] Ambil dari: Supabase Dashboard > Project Settings > API > JWT Secret.`,
    );
  }
  Deno.exit(1);
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

// IP LAN HOST opsional, mis. "192.168.1.123".
//
// Di dalam container Docker, `Deno.networkInterfaces()` hanya melihat
// interface container (172.18.x.x) - bukan IP host yang diketik petugas di
// HP. Jadi IP host boleh diberikan lewat env `LAN_IP` supaya banner
// menampilkan URL yang benar-benar bisa dibuka perangkat di jaringan.
const EXTRA_LAN_IPS = (Deno.env.get("LAN_IP") ?? "")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("127."));
for (const ip of EXTRA_LAN_IPS) {
  if (!LAN_IPS.includes(ip)) LAN_IPS.push(ip);
}

// ── Suntik IP peer asli ke request ───────────────────────────────────────────
//
// Rate limiter (_ratelimit.ts) menentukan IP klien dari header
// `x-forwarded-for` -> `x-real-ip` -> `cf-connecting-ip`, fallback "unknown".
//
// Di Supabase Edge Runtime, `x-forwarded-for` diisi oleh platform -> benar.
// Di server intranet TIDAK ADA reverse proxy di depan Deno, jadi header itu
// datang langsung dari klien dan bisa DIPALSUKAN. Akibatnya:
//   - rate limit per-IP jadi tidak berguna (klien putar header => bucket baru
//     tiap request, dan "unknown" jadi bucket bersama semua device), dan
//   - log request mencatat IP yang tidak akurat.
//
// Solusinya: Deno menyediakan IP peer asli lewat `info.remoteAddr` pada
// handler Deno.serve. Kita BUNGKUS handleRequest dan menimpa `x-forwarded-for`
// dengan nilai itu.
//
// PENTING: header pada Request dari Deno.serve bersifat immutable
// ("Cannot change headers: headers are immutable"), jadi WAJIB lewat
// `new Request(req, { headers })` - bukan `req.headers.set(...)`.
//
// Body tetap utuh: `new Request(req, {headers})` mempertahankan stream body
// yang sama, jadi `req.formData()` di /trips/complete tetap bisa membaca
// multipart (sudah diverifikasi).
Deno.serve(
  { port: PORT, hostname: HOST, onListen: ({ hostname, port }) => {
    console.log(`[api-intranet] API lokal siap di http://${hostname}:${port}/api`);
    for (const ip of LAN_IPS) {
      console.log(`[api-intranet]   - LAN: http://${ip}:${port}/api`);
    }
  } },
  (req, info) => {
    const peer = info.remoteAddr?.hostname;
    if (!peer) return handleRequest(req);

    const headers = new Headers(req.headers);
    // Timpa apa pun yang dikirim klien - inilah IP yang benar.
    headers.set("x-forwarded-for", peer);
    headers.set("x-real-ip", peer);

    return handleRequest(new Request(req, { headers }));
  },
);

console.log("[api-intranet] Service key dipakai: service_role (akses penuh DB)");
