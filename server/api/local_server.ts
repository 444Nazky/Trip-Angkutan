// Server API INTRANET (port 3000). Menjalankan router API di dalam jaringan lokal kantor (PC Ubuntu 192.168.1.123).

import { join } from "node:path";



const PORT = Number(Deno.env.get("PORT") ?? "3000");



const HOST = Deno.env.get("HOST") ?? "0.0.0.0";

// Nonaktifkan server bawaan di index.ts supaya tidak ada dua Deno.serve dalam satu proses. Harus di-set SEBELUM import modul index.
Deno.env.set("API_DISABLE_EMBEDDED_SERVER", "1");

// ── Pre-flight: secrets wajib ada ─────────────────────────────────────────────

// JWT_SECRET WAJIB ada di server intranet. Kenapa wajib (bukan sekadar peringatan): `_shared.ts` memakai fallback `|| "trip-angkut-secret-key"` kalau…
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

// ── Mode akses dashboard admin ──────────────────────────────────────────────── Dashboard admin pada server intranet TIDAK memakai password.
if (Deno.env.get("ADMIN_AUTH_DISABLED") === undefined) {
  Deno.env.set("ADMIN_AUTH_DISABLED", "1");
}

// ── Pre-flight: direktori penyimpanan berkas ───────────────────────────────── Server menyimpan berkas (foto trip, APK, bundel OTA) di STORAGE_DIR,…

const STORAGE_DIR = Deno.env.get("STORAGE_DIR") || "/data/storage";



async function prepareStorageDir(): Promise<boolean> {
  try {
    await Deno.mkdir(STORAGE_DIR, { recursive: true });
  } catch (error) {
    console.error(
      `[api-intranet] PERINGATAN: direktori penyimpanan ${STORAGE_DIR} tidak bisa dibuat: ` +
        `${error instanceof Error ? error.message : error}`,
    );
    return false;
  }

  const probe = join(STORAGE_DIR, ".write-probe");
  try {
    await Deno.writeFile(probe, new Uint8Array([0]));
    await Deno.remove(probe);
    return true;
  } catch (error) {
    console.error(
      `[api-intranet] PERINGATAN: direktori penyimpanan ${STORAGE_DIR} tidak bisa ditulis: ` +
        `${error instanceof Error ? error.message : error}`,
    );
    console.error(
      `[api-intranet] Unggahan foto trip, APK, dan bundel OTA AKAN GAGAL sampai ini diperbaiki.`,
    );
    console.error(
      `[api-intranet] Perbaikan di PC kantor: sudo chown -R 1000:1000 <folder>/data/storage`,
    );
    console.error(
      `[api-intranet] (1000 = uid user 'deno' di dalam container), lalu jalankan ./restart-all-ubuntu.sh`,
    );
    return false;
  }
}



const STORAGE_READY = await prepareStorageDir();



const { handleRequest } = await import("./index.ts");


// Deno 2.x: `Deno.networkInterfaces()` mengembalikan DAFTAR ALAMAT yang datar (NetworkInterfaceInfo: { name, family, address, ...
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
  }
  return out;
}

// Alamat LAN dihitung SEBELUM Deno.serve: callback `onListen` dijalankan sinkron oleh Deno, jadi kalau isinya `await`, sisa kode setelah await tidak…
const LAN_IPS = await lanAddresses();

// IP LAN HOST opsional, mis. "192.168.1.123".
const EXTRA_LAN_IPS = (Deno.env.get("LAN_IP") ?? "")
  .split(/[,\s]+/)
  .map((s) => s.trim())
  .filter((s) => s.length > 0 && !s.startsWith("127."));



for (const ip of EXTRA_LAN_IPS) {
  if (!LAN_IPS.includes(ip)) LAN_IPS.push(ip);
}

// ── Suntik IP peer asli ke request ─────────────────────────────────────────── Rate limiter (_ratelimit.ts) menentukan IP klien dari header…
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
    headers.set("x-forwarded-for", peer);
    headers.set("x-real-ip", peer);

    return handleRequest(new Request(req, { headers }));
  },
);



console.log(`[api-intranet] Database: ${Deno.env.get("POSTGREST_URL") ?? "http://127.0.0.1:3001"} | File: ${Deno.env.get("STORAGE_DIR") ?? "/data/storage"}`);
