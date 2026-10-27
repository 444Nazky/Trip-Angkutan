// API intranet - pengganti backend Express, berjalan penuh di jaringan lokal.
//
// Ada dua middleware yang membungkus router:
//
//   1. Rate limiter (_ratelimit.ts) — menahan request storm / scanner dari luar
//      yang menembak endpoint yang sama ratusan kali per menit.
//   2. Cache TTL (_cache.ts) — menahan fetch berulang atas master data
//      (tarif, region, dermaga, rute, geofence) yang isinya jarang berubah.
//
// Keduanya hanya menahan request yang menganggur; response apa pun tetap
// sama persis dengan sebelumnya, hanya diambil dari cache / diteruskan ke
// database bila perlu.
import * as authh from "./handlers/auth.ts";
import * as geo from "./handlers/geofences.ts";
import * as mst from "./handlers/master.ts";
import * as rt from "./handlers/regionTariffs.ts";
import * as rts from "./handlers/routes.ts";
import * as trps from "./handlers/trips.ts";
import * as rprt from "./handlers/reports.ts";
import * as ofc from "./handlers/officers.ts";
import * as plt from "./handlers/plates.ts";
import * as upd from "./handlers/appVersion.ts";
import * as srvst from "./handlers/serverStats.ts";
import * as imp from "./handlers/import.ts";
import { corsHeaders, json, auth, serveStoredFile } from "./_shared.ts";
import { recordRequest } from "./_metrics.ts";
import {
  take,
  remaining,
  limitOf,
  buildLimiters,
  loginUserKey,
  clientIp,
  type RateClass,
  type Limiter,
} from "./_ratelimit.ts";
import {
  ttlFor,
  cacheKey,
  cacheGet,
  cacheSet,
  cacheInvalidate,
  cacheSweep,
} from "./_cache.ts";

// ── Klasifikasi rate limit ───────────────────────────────────────────────────

/** Kelas endpoint untuk rate limiter. */
function rateClassFor(parts: string[], method: string): RateClass {
  const [a] = parts;
  if (a === "health") return "health";
  // Panel statistik di-poll tiap 5 detik. Klasifikasikan sebagai "health"
  // supaya tidak memakan bucket "read" yang dipakai endpoint master data.
  if (a === "server-stats") return "health";
  if (a === "auth") return "auth";
  if (a === "reports") return "report";
  if (method !== "GET" && method !== "OPTIONS") return "write";
  return "read";
}

// ── Cache master data ────────────────────────────────────────────────────────

/**
 * Rute yang boleh dicache (hanya GET, hanya master data yang isinya sama
 * untuk semua pengguna). `null` berarti tidak boleh dicache.
 */
function cacheRouteFor(parts: string[], method: string): string | null {
  if (method !== "GET") return null;
  const [a, b] = parts;
  if (a === "regions" && !b) return "/regions";
  if (a === "dermagas" && !b) return "/dermagas";
  if (a === "routes" && !b) return "/routes"; // /routes/mine -> b="mine" -> tidak dicache
  if (a === "tariffs" && !b) return "/tariffs";
  if (a === "master" && b === "tariffs") return "/master/tariffs";
  if (a === "master" && b === "offline") return "/master/offline";
  if (a === "geofences" && !b) return "/geofences";
  return null;
}

/**
 * Scope cache. Data master identik untuk semua admin, jadi satu entri bisa
 * dipakai bersama. Officer dipisahkan supaya tidak pernah menerima response
 * admin-only. Tanpa token -> scope "anon" (selalu cache miss).
 */
function cacheScope(role: string | undefined): string {
  if (role === "admin") return "admin";
  if (role === "officer") return "officer";
  return "anon";
}

/** Rute cache yang harus di invalidated setelah perubahan master data. */
function invalidationTargets(parts: string[], method: string): string[] {
  if (method === "GET" || method === "OPTIONS") return [];
  const [a, b] = parts;
  switch (a) {
    case "geofences":
      return ["/geofences"];
    case "dermagas":
      return ["/dermagas"];
    case "routes":
      return ["/routes"];
    case "regions":
      // Perubahan region/metadata mempengaruhi daftar region UI admin & paket offline.
      return ["/regions", "/master/offline"];
    case "tariffs":
      // Master tarif dipakai dua endpoint: admin (/tariffs) dan petugas
      // (/master/tariffs).
      return ["/tariffs", "/master/tariffs"];
    case "plates":
      // Master plat ikut/compose paket offline → cache paket harus dibuang.
      return ["/master/offline"];
    case "region-tariffs":
      // Perubahan tarif region mempengaruhi paket offline & UI tabel region.
      // Invalidasi cache region tariffs supaya tabel selalu tampilkan nilai terbaru.
      return ["/region-tariffs", "/master/offline"];
    case "master":
      return b === "tariffs" ? ["/tariffs", "/master/tariffs"] : [];
    default:
      return [];
  }
}

/** Jumlah request antar sweep cache. */
let sinceSweep = 0;
const SWEEP_EVERY = 200;

// ── Router ───────────────────────────────────────────────────────────────────

async function route(req: Request, url: URL, parts: string[]): Promise<Response> {
  const [a, b, c] = parts;
  const notFound = () => json({ error: `Endpoint not found: ${req.method} /${parts.join("/")}` }, 404);

  // ---------------- /health ----------------
  if (a === "health" && req.method === "GET") {
    // `mode` membedakan server intranet kantor dari proses Deno yang
    // dijalankan mandiri (mis. saat uji lokal).
    const mode = Deno.env.get("API_DISABLE_EMBEDDED_SERVER") === "1" ? "intranet" : "standalone";
    return json({ status: "ok", version: "3.0.0-local", mode, instance: INSTANCE_ID });
  }

  // ---------------- /auth ----------------
  if (a === "auth" && req.method === "POST") {
    switch (b) {
      case "admin-login": return await authh.adminLogin(req);
      case "region-login": return await authh.regionLogin(req);
      case "member-login": return await authh.memberLogin(req);
      case "login": return await authh.login(req);
      case "select-dermaga": return await authh.selectDermaga(req);
      case "refresh": return await authh.refreshToken(req);
      // Dashboard admin pada server intranet tidak memakai password (mode
      // ADMIN_AUTH_DISABLED). Jadi tidak ada endpoint ganti password.
    }
    return notFound();
  }

  // ---------------- /geofences ----------------
  if (a === "geofences") {
    if (req.method === "GET" && b === "resolve-link") return await geo.resolveLink(req, url);
    if (req.method === "GET" && !b) return await geo.getGeofences(req, url);
    if (req.method === "POST" && !b) return await geo.createGeofence(req);
    if (req.method === "PUT" && b) return await geo.updateGeofence(req, b);
    if (req.method === "DELETE" && b) return await geo.deleteGeofence(req, b);
    return notFound();
  }

  // ---------------- /regions ----------------
  if (a === "regions") {
    if (req.method === "GET" && !b) return await mst.getRegions(req);
    if (req.method === "POST" && !b) return await mst.createRegion(req);
    if (req.method === "PUT" && b) return await mst.updateRegion(req, b);
    if (req.method === "DELETE" && b) return await mst.deleteRegion(req, b);
    return notFound();
  }

  // ---------------- /dermagas + nested ----------------
  if (a === "dermagas") {
    if (req.method === "GET" && !b) return await mst.getDermagas(req);
    if (req.method === "POST" && !b) return await mst.createDermaga(req);
    if (req.method === "PUT" && b && !c) return await mst.updateDermaga(req, b);
    if (req.method === "DELETE" && b && !c) return await mst.deleteDermaga(req, b);
    return notFound();
  }

  // ---------------- /routes ----------------
  if (a === "routes") {
    if (req.method === "GET" && b === "mine") return await rts.getOfficerRoutes(req);
    if (req.method === "GET" && !b) return await rts.getAllRoutes(req);
    if (req.method === "POST" && !b) return await rts.createRoute(req);
    if (req.method === "PUT" && b) return await rts.updateRoute(req, b);
    if (req.method === "DELETE" && b) return await rts.deleteRoute(req, b);
    return notFound();
  }

  // ---------------- /tariffs (admin) ----------------
  if (a === "tariffs") {
    if (req.method === "GET" && !b) return await mst.getAdminTariffs(req);
    if (req.method === "POST" && !b) return await mst.createTariff(req);
    if (req.method === "PUT" && b) return await mst.updateTariff(req, b);
    if (req.method === "DELETE" && b) return await mst.deleteTariff(req, b);
    return notFound();
  }

  // ---------------- /master/tariffs (officer) ----------------
  if (a === "master" && b === "tariffs" && req.method === "GET") {
    return await mst.getMasterTariffs(req);
  }

  // ---------------- /master/offline (officer) ----------------
  // Paket master untuk mode offline: region + plat + tarif region.
  if (a === "master" && b === "offline" && req.method === "GET") {
    return await mst.getOfflineMasterPack(req);
  }

  // ---------------- /region-tariffs ----------------
  if (a === "region-tariffs") {
    if (req.method === "GET" && !b) return await rt.getRegionTariffs(req);
    if (req.method === "PUT" && b) return await rt.updateRegionTariff(req, b, url);
    return notFound();
  }

  // ---------------- /trips ----------------
  if (a === "trips") {
    if (req.method === "POST" && b === "complete") return await trps.completeTrip(req);
    if (req.method === "POST" && !b) return await trps.createTrip(req);
    if (req.method === "GET" && !b) return await trps.getTrips(req, url);
    return notFound();
  }

  // ---------------- /reports ----------------
  if (a === "reports") {
    if (req.method === "GET" && b === "summary") return await rprt.summary(req, url);
    if (req.method === "GET" && b === "trips" && c === "filters") return await rprt.tripFilters(req);
    if (req.method === "GET" && b === "trips") return await rprt.tripsReport(req, url);
    return notFound();
  }

  // ---------------- /officers ----------------
  if (a === "officers") {
    if (req.method === "GET" && !b) return await ofc.getOfficers(req);
    if (req.method === "GET" && b === "my-region") return await ofc.myRegionOfficers(req);
    if (req.method === "GET" && b && c === "dermaga-access") return await ofc.officerDermagaAccess(req, b);
    if (req.method === "POST" && !b) return await ofc.createOfficer(req);
    if (req.method === "PUT" && b && c === "dermagas") return await ofc.updateOfficerDermagas(req, b);
    if (req.method === "PUT" && b && c === "regions") return await ofc.updateOfficerRegions(req, b);
    if (req.method === "PUT" && b && c === "pin") return await ofc.updateOfficerPin(req, b);
    if (req.method === "PUT" && b && c === "status") return await ofc.updateOfficerStatus(req, b);
    if (req.method === "DELETE" && b) return await ofc.deleteOfficer(req, b);
    return notFound();
  }

  // ---------------- /plates ----------------
  if (a === "plates") {
    if (req.method === "GET" && !b) return await plt.getPlates(req, url);
    if (req.method === "POST" && b === "check") return await plt.checkPlate(req);
    if (req.method === "POST" && !b) return await plt.createPlate(req);
    if (req.method === "PUT" && b) return await plt.updatePlate(req, b);
    if (req.method === "DELETE" && b) return await plt.deletePlate(req, b);
    return notFound();
  }

  // ---------------- impor massal (migrasi sekali jalan) ----------------
  if (a === "admin" && b === "import" && req.method === "POST") return await imp.importData(req);

  // ---------------- app update / OTA ----------------
  if (a === "app-version" && req.method === "GET") return await upd.getAppVersion(req, url);
  if (a === "release-notes" && req.method === "GET" && b) return await upd.releaseNotes(req, b);
  if (a === "apk-list" && req.method === "GET") return await upd.apkList(req);
  if (a === "publish-version" && req.method === "POST") return await upd.publishVersion(req);
  if (a === "app-download" && req.method === "GET" && b) return await upd.appDownload(req, b);
  if (a === "ota-manifest" && req.method === "GET") return await upd.otaManifest(req);
  if (a === "ota-versions" && req.method === "GET") return await upd.otaVersions(req);
  if (a === "publish-ota" && req.method === "POST") return await upd.publishOta(req);
  if (a === "report-version" && req.method === "POST") return await upd.reportDeviceVersion(req);
  if (a === "device-versions" && req.method === "GET") return await upd.deviceVersions(req);

  // ---------------- /server-stats ----------------
  // Statistik runtime server (Total Requests, Success Rate, latensi, memori,
  // grafik per menit, status komponen). Dipakai panel "Endpoint" di admin
  // dashboard untuk memantau server intranet port 3000.
  if (a === "server-stats" && req.method === "GET") return await srvst.serverStats(req);

  return notFound();
}

// ── Middleware ───────────────────────────────────────────────────────────────

/**
 * ID instance edge function. Dipakai untuk diagnose: kalau dua request
 * berturut-turut membawa ID yang sama, berarti instance dipakai ulang (state
 * in-memory seperti cache & rate limiter ikut bertahan). Kalau selalu beda,
 * state in-memory tidak pernah bertahan antar request.
 */
const INSTANCE_ID = crypto.randomUUID();

/** Tambahkan header pada response tanpa mengubah body. */
function withHeaders(res: Response, extra: Record<string, string>): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

// ── Log request (diagnostik) ─────────────────────────────────────────────────

/**
 * Nilai query parameter yang aman dimuat ke log (tidak memuat PII seperti
 * pencarian nama petugas di laporan).
 */
const LOGGED_QUERY_KEYS = new Set(["dermagaId", "scope", "path", "status", "limit", "offset"]);

/** Ringkasan query string: hanya nama parameter + nilai yang aman. */
function logQuery(url: URL): string {
  const parts: string[] = [];
  for (const [k, v] of url.searchParams.entries()) {
    if (k === "path") continue;
    parts.push(LOGGED_QUERY_KEYS.has(k) ? `${k}=${v}` : k);
  }
  return parts.join(",");
}

/**
 * Log request (diagnostik).
 *
 *_two mode_:
 *
 *  - `API_LOG=1` → satu baris JSON per request (detail, tapi boros kuota
 *    "Log Ingestion" yang di proyek ini sudah lewat 400%).
 *  - `API_LOG=0` (default) → AGREGAT: satu baris ringkasan per 30 detik,
 *    berisi jumlah request per (path, ip, status, auth). Volume log ~1 baris
 *    per 30 detik per instance, tapi datanya tetap cukup untuk melihat
 *    endpoint mana yang paling sering ditembak dan dari IP mana.
 *
 * Agregat lebih berguna untuk diagnosis lonjakan daripada log per request:
 * yang dicari adalah "siapa yang menembak apa", bukan isi tiap request.
 */
const API_LOG_ALL = (Deno.env.get("API_LOG") ?? "0") === "1";

/** Ringkasan traffic: key = "path|status|ip|auth". */
const trafficCounts = new Map<string, number>();
/** Kapan ringkasan terakhir dicetak (epoch ms). */
let trafficFlushedAt = Date.now();
/** Jarak waktu antar ringkasan (ms). */
const TRAFFIC_FLUSH_MS = 30_000;

function flushTraffic(force = false): void {
  const now = Date.now();
  if (!force && now - trafficFlushedAt < TRAFFIC_FLUSH_MS) return;
  trafficFlushedAt = now;
  if (!trafficCounts.size) return;

  const rows = [...trafficCounts.entries()]
    .map(([key, n]) => {
      const [path, status, ip, auth] = key.split("|");
      return { path, status: Number(status), ip, auth, n };
    })
    .sort((a, b) => b.n - a.n)
    .slice(0, 25);
  trafficCounts.clear();

  console.log(JSON.stringify({ ev: "api_traffic", window_ms: TRAFFIC_FLUSH_MS, rows }));
}

function logRequest(fields: Record<string, unknown>): void {
  // Metrik /server-stats dicatat di handleRequest (satu pintu, termasuk 429
  // dan error 500), bukan di sini - supaya tidak terhitung dua kali.
  if (API_LOG_ALL) {
    console.log(JSON.stringify({ ev: "api_request", ...fields }));
    return;
  }

  // Mode agregat: hitung per (path, status, ip, auth).
  const key = `${fields.path}|${fields.status}|${fields.ip}|${fields.auth}`;
  trafficCounts.set(key, (trafficCounts.get(key) ?? 0) + 1);
  flushTraffic();

  // Anomali (401/403/429/5xx) tetap dicatat per kejadian — jumlahnya kecil
  // dan justru yang paling perlu terlihat cepat (mis. token kadaluarsa
  // membuat klien retry tanpa henti).
  const status = Number(fields.status);
  if (!isAnomaly(status)) return;
  const anomalyKey = `${fields.path}|${status}|${fields.ip}`;
  const now = Date.now();
  if (now - (anomalySeen.get(anomalyKey) ?? 0) < ANOMALY_COOLDOWN_MS) return;
  anomalySeen.set(anomalyKey, now);
  console.log(JSON.stringify({ ev: "api_anomaly", ...fields }));
}

/** Status yang layak memicu satu baris langsung (anomali). */
function isAnomaly(status: number): boolean {
  return status === 401 || status === 403 || status === 429 || status >= 500;
}

/** Anomali yang sama dibatasi satu baris per menit (anti spam log). */
const ANOMALY_COOLDOWN_MS = 60_000;
const anomalySeen = new Map<string, number>();

/**
 * Handler utama API.
 *
 * Dipisah dari `Deno.serve` supaya handler yang sama bisa dipakai dua tempat:
 *   1. Server intranet lokal (port 3000) -> `local_server.ts`
 *   2. Proses Deno mandiri (uji lokal)  -> `Deno.serve(handleRequest)`
 *
 * Database: PostgreSQL lokal lewat PostgREST (`_db.ts`).
 * File: direktori lokal, dilayani di `/files/<bucket>/<path>`.
 */
export async function handleRequest(req: Request): Promise<Response> {
  // File lokal (foto trip, APK, bundle OTA) dilayani langsung dari disk,
  // tanpa lewat database maupun rate limiter API.
  const asset = await serveStoredFile(new URL(req.url).pathname);
  if (asset) return asset;

  const started = Date.now();
  let path = "";
  let ip = "";
  try {
    const url = new URL(req.url);
    let p = url.searchParams.get("path") ?? url.pathname.replace(/^\/functions\/v1\/api\/?/, "");
    path = (p.startsWith("/") ? p : `/${p}`).replace(/^\/api(?=\/|$)/, "") || "/";
    ip = clientIp(req);
  } catch {
    // URL rusak -> pakai path generik.
    path = "?";
  }

  let res: Response;
  try {
    res = await handleRequestCore(req);
  } catch (error) {
    recordRequest({ path, method: req.method, status: 500, ms: Date.now() - started, ip });
    throw error;
  }

  // Preflight OPTIONS bukan request nyata -> jangan dihitung sebagai traffic.
  if (req.method !== "OPTIONS") {
    recordRequest({
      path,
      method: req.method,
      status: res.status,
      ms: Date.now() - started,
      ip,
    });
  }
  return withCors(req, res);
}

/**
 * Origin yang SELALU diizinkan, apa pun isi `CORS_ORIGIN`.
 *
 * Aplikasi native (Capacitor/Android WebView) memuat halaman dari origin
 * LOKAL `https://localhost` - bukan `http://192.168.1.123:5173` seperti
 * dashboard. Kalau `CORS_ORIGIN` diisi tanpa origin ini, aplikasi mobile
 * akan mendapat 403 "Origin tidak diizinkan" dan TIDAK bisa mengirim data
 * ke server intranet sama sekali.
 *
 * Origin browser tidak bisa dipalsukan jadi `https://localhost` (header
 * Origin controlled browser), jadi ini tidak melemahkan proteksi CORS untuk
 * situs web mana pun.
 */
const ALWAYS_ALLOWED_ORIGINS = new Set([
  "https://localhost",
  "http://localhost",
  "capacitor://localhost",
  "https://127.0.0.1",
]);

/**
 * CORS respons sesuai origin pemanggil.
 *
 * `_shared.ts` memakai `Access-Control-Allow-Origin: *` SEKALIGUS untuk semua
 * respons. Itu sempat bermasalah karena kombinasi `*` + `Access-Control-Allow-
 * Credentials: true` itu tidak valid di spec CORS: browser menolak request
 * ber-credentials (cookie) kalau origin-nya wildcard.
 *
 * Admin dashboard (port 8000) memanggil API intranet (port 3000) - itu
 * lintas origin, jadi header CORS menentukan boleh/tidaknya. Supaya dashboard
 * dan aplikasi mobile sama-sama bebas hambatan:
 *
 *   - Kalau `CORS_ORIGIN` diisi (daftar origin, dipisah koma), origin yang
 *     terdaftar ditiru + Allow-Credentials ikut diaktifkan. Origin aplikasi
 *     native (`https://localhost`) SELALU diizinkan - lihat
 *     `ALWAYS_ALLOWED_ORIGINS`.
 *   - Kalau `CORS_ORIGIN` kosong, wildcard tetap dipakai (server intranet
 *     ada di LAN tertutup), tapi Allow-Credentials DIMATIKAN supaya
 *     kombinasi wildcard+credentials yang invalid tidak pernah terjadi.
 *
 * Asal tidak boleh header yang sama dikembalikan dua kali, jadi header
 * CORS lama dibuang lebih dulu.
 */
function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get("origin");
  const allowed = (Deno.env.get("CORS_ORIGIN") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let allowOrigin = "*";
  let allowCredentials = false;

  if (allowed.length > 0) {
    if (origin && (allowed.includes(origin) || ALWAYS_ALLOWED_ORIGINS.has(origin))) {
      allowOrigin = origin;
      allowCredentials = true;
    } else if (origin) {
      // Origin terkirim tapi tidak terdaftar -> jangan bocorkan data; tetap
      // 403 agar pemanggil tahu masalahnya CORS, bukan "data kosong".
      //
      // Request TANPA header Origin (curl, aplikasi native tanpa Origin)
      // tetap diizinkan: header Origin cuma ada untuk request browser.
      return new Response(JSON.stringify({ error: "Origin tidak diizinkan" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", allowOrigin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "authorization, x-client-info, apikey, content-type, cache-control, pragma, expires, accept, origin, x-requested-with",
  );
  if (allowCredentials) headers.set("Access-Control-Allow-Credentials", "true");
  else headers.delete("Access-Control-Allow-Credentials");

  return new Response(res.body, { status: res.status, headers });
}

async function handleRequestCore(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  let p = url.searchParams.get("path") ?? url.pathname.replace(/^\/functions\/v1\/api\/?/, "");
  const path = (p.startsWith("/") ? p : `/${p}`).replace(/^\/api(?=\/|$)/, "") || "/";
  const parts = path.replace(/^\//, "").split("/").filter(Boolean);
  const startedAt = Date.now();
  const ip = clientIp(req);

  try {
    if (++sinceSweep >= SWEEP_EVERY) {
      sinceSweep = 0;
      cacheSweep();
    }

    // ---------------- Rate limit ----------------
    const cls = rateClassFor(parts, req.method);
    const ctx = await auth(req);
    const subject = ctx?.officerId ?? ctx?.username ?? null;

    const limiters: Limiter[] = buildLimiters(
      req,
      cls,
      subject,
      cls === "health", // /health tidak menyentuh DB -> jangan diblokir per-IP
    );

    // Endpoint login: batasi juga per nama pengguna, supaya credential
    // stuffing yang tersebar dari banyak IP tetap tertahan.
    if (cls === "auth" && req.method === "POST") {
      const parsed = await req.clone().json().catch(() => null) as any;
      const username = parsed?.username ?? parsed?.name ?? parsed?.nip;
      if (username) {
        limiters.push({ key: loginUserKey(String(username)), cls, loose: false });
      }
    }

    let tightest: Limiter | null = null;
    for (const limiter of limiters) {
      if (!take(limiter)) {
        tightest = limiter;
        break;
      }
    }
    if (tightest) {
      logRequest({
        t: startedAt,
        method: req.method,
        path,
        q: logQuery(url),
        ip,
        status: 429,
        ms: Date.now() - startedAt,
        rl_class: cls,
        rl_blocked: true,
        auth: ctx?.role ?? "anon",
        instance: INSTANCE_ID,
      });
      return new Response(
        JSON.stringify({
          error: "Rate limit exceeded. Slow down and retry shortly.",
          retryAfterSeconds: 60,
        }),
        {
          status: 429,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "Retry-After": "60",
            "X-RateLimit-Limit": String(limitOf(tightest)),
            "X-RateLimit-Remaining": "0",
          },
        },
      );
    }

    const rlHeaders: Record<string, string> = {};
    for (const limiter of limiters) {
      const rem = remaining(limiter);
      const lim = limitOf(limiter);
      // Tampilkan bucket paling ketat sebagai angka yang dilihat pemanggil.
      if (!rlHeaders["X-RateLimit-Limit"] || lim < Number(rlHeaders["X-RateLimit-Limit"])) {
        rlHeaders["X-RateLimit-Limit"] = String(lim);
        rlHeaders["X-RateLimit-Remaining"] = String(rem);
      }
    }

    // ---------------- Cache master data ----------------
    const cacheRoute = cacheRouteFor(parts, req.method);
    const ttl = cacheRoute ? ttlFor(cacheRoute) : 0;
    const scope = cacheScope(ctx?.role);
    const key = ttl > 0 ? `${scope}|${cacheKey(cacheRoute!, url)}` : "";

    if (ttl > 0) {
      const hit = cacheGet(key);
      if (hit !== null) {
        logRequest({
          t: startedAt,
          method: req.method,
          path,
          q: logQuery(url),
          ip,
          status: 200,
          ms: Date.now() - startedAt,
          rl_class: cls,
          rl_remaining: Number(rlHeaders["X-RateLimit-Remaining"] ?? -1),
          cache: "HIT",
          auth: ctx?.role ?? "anon",
          instance: INSTANCE_ID,
        });
        return new Response(JSON.stringify(hit), {
          status: 200,
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
            "X-Cache": "HIT",
            ...rlHeaders,
          },
        });
      }
    }

    // ---------------- Handler ----------------
    const res = await route(req, url, parts);

    // Simpan response master data yang sukses ke cache.
    if (ttl > 0 && res.status === 200) {
      const text = await res.clone().text();
      try {
        cacheSet(key, JSON.parse(text), ttl, cacheRoute!);
      } catch {
        // Body bukan JSON valid -> tidak dicache.
      }
    }

    // Perubahan master data langsung membatalkan cache supaya admin melihat
    // hasil karyanya tanpa menunggu TTL habis.
    for (const route of invalidationTargets(parts, req.method)) {
      if (res.status >= 200 && res.status < 300) cacheInvalidate(route);
    }

    logRequest({
      t: startedAt,
      method: req.method,
      path,
      q: logQuery(url),
      ip,
      status: res.status,
      ms: Date.now() - startedAt,
      rl_class: cls,
      rl_remaining: Number(rlHeaders["X-RateLimit-Remaining"] ?? -1),
      cache: ttl > 0 ? "MISS" : "n/a",
      auth: ctx?.role ?? "anon",
      subject: subject ?? undefined,
      instance: INSTANCE_ID,
    });

    return withHeaders(res, {
      ...rlHeaders,
      "X-Api-Instance": INSTANCE_ID,
      ...(ttl > 0 ? { "X-Cache": "MISS" } : {}),
    });
  } catch (error) {
    console.error("[api]", req.method, path, error);
    recordRequest({ path, method: req.method, status: 500, ms: Date.now() - startedAt });
    return json({ error: "Internal error" }, 500);
  }
}

// Hanya jalankan server bawaan bila modul ini dipakai sebagai entrypoint.
//
// `local_server.ts` (server intranet port 3000) men-set
// API_DISABLE_EMBEDDED_SERVER=1 SEBELUM meng-import modul ini, sehingga tidak
// ada dua server yang berebut port di proses yang sama.
//
// Catatan: `import.meta.main` sengaja TIDAK dipakai. Edge Runtime tidak
// menjamin entrypoint adalah "main module", dan kalau salahevaluate backend
// produksi akan berhenti melayani request.
if (Deno.env.get("API_DISABLE_EMBEDDED_SERVER") !== "1") {
  Deno.serve(handleRequest);
}
