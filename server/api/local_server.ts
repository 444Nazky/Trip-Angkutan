/**
 * Server API INTRANET (port 3000).
 *
 * Menjalankan router API di dalam jaringan lokal kantor (PC Ubuntu
 * 192.168.1.123). Aplikasi mobile dan dashboard admin hanya memanggil
 * endpoint ini: http://192.168.1.123:3000/api
 *
 * Tidak ada koneksi ke internet:
 *   - Database : PostgreSQL lokal di container `db` (diakses lewat PostgREST
 *                container `rest`, lihat `_db.ts`).
 *   - File     : direktori lokal `STORAGE_DIR` (default /data/storage),
 *                dilayani di /files/<bucket>/<path>.
 *
 * Syarat environment (lihat server/api/.env.example):
 *   JWT_SECRET     - WAJIB. Dipakai menandatangani token admin/petugas.
 *   POSTGREST_URL  - opsional, default http://127.0.0.1:3001 (docker: http://rest:3000)
 *   STORAGE_DIR    - opsional, default /data/storage
 *   ADMIN_USERNAME / ADMIN_PASSWORD - opsional, kredensial dashboard
 *   LAN_IP, PORT, HOST, TLS_CERT_FILE, TLS_KEY_FILE - opsional
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
//   Pre-flight ini hanya jalan di server intranet (file ini).
const REQUIRED = [
  "JWT_SECRET",
] as const;
const missing = REQUIRED.filter((k) => !Deno.env.get(k));

if (missing.length > 0) {
  console.error(
    `[api-intranet] GAGAL START: env wajib belum diisi -> ${missing.join(", ")}`,
  );
  console.error(
    `[api-intranet] Buat file server/api/.env.local (lihat .env.example) lalu restart.`,
  );
  if (missing.includes("JWT_SECRET")) {
    console.error(
      `[api-intranet] JWT_SECRET tidak boleh kosong: tanpa itu server memakai secret` +
        ` default yang tertulis di source, dan token admin bisa dipalsukan.`,
    );
    console.error(
      `[api-intranet] Isi dengan string acak panjang, mis.: openssl rand -hex 32`,
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
// Di belakang reverse proxy, `x-forwarded-for` diisi oleh proxy -> benar.
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
// ── TLS opsional ──────────────────────────────────────────────────────────────
//
// Default: server intranet serves HTTP polos (http://192.168.1.123:3000/api).
// Itu cukup untuk aplikasi native (WebView) karena cleartext ke LAN sudah
// diizinkan lewat `android.allowMixedContent` + network security config.
//
// Kalau aplikasi dibuka lewat https di browser (atau kebijakan kantor mau
// server intranet punya TLS), set dua env berikut:
//
//   TLS_CERT_FILE=/path/ke/sertifikat.pem
//   TLS_KEY_FILE=/path/ke/private-key.pem
//
// Server lalu serve HTTPS di port yang sama, dan kandidat
// "Intranet Kantor (HTTPS)" bisa dipakai di aplikasi (isi
// `intranetHttpsApiBaseUrl` di src/environments/environment.ts).
//
// CATATAN PENTING: sertifikat self-signed harus DIINSTALL di perangkat
// petugas, kalau tidak WebView/browser menolak koneksi ("sertifikat tidak
// dipercaya") - gejalanya mirip "server tidak merespon".
const TLS_CERT_FILE = (Deno.env.get("TLS_CERT_FILE") ?? "").trim();
const TLS_KEY_FILE = (Deno.env.get("TLS_KEY_FILE") ?? "").trim();
const TLS_ENABLED = Boolean(TLS_CERT_FILE && TLS_KEY_FILE);

let tlsCert = "";
let tlsKey = "";
if (TLS_ENABLED) {
  try {
    tlsCert = await Deno.readTextFile(TLS_CERT_FILE);
    tlsKey = await Deno.readTextFile(TLS_KEY_FILE);
  } catch (e) {
    console.error(
      `[api-intranet] GAGAL START: TLS_CERT_FILE/TLS_KEY_FILE tidak bisa dibaca -> ${e}`,
    );
    Deno.exit(1);
  }
}

const SCHEME = TLS_ENABLED ? "https" : "http";

Deno.serve(
  {
    port: PORT,
    hostname: HOST,
    // Deno.serve menerima `cert`/`key` (isi PEM) untuk HTTPS.
    ...(TLS_ENABLED ? { cert: tlsCert, key: tlsKey } : {}),
    onListen: ({ hostname, port }) => {
      console.log(`[api-intranet] API lokal siap di ${SCHEME}://${hostname}:${port}/api`);
      for (const ip of LAN_IPS) {
        console.log(`[api-intranet]   - LAN: ${SCHEME}://${ip}:${port}/api`);
      }
    },
  },
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

console.log(`[api-intranet] Database: ${Deno.env.get("POSTGREST_URL") ?? "http://127.0.0.1:3001"} | File: ${Deno.env.get("STORAGE_DIR") ?? "/data/storage"}`);
