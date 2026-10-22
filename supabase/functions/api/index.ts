// API Edge Function - replaces the Express backend, fully on Supabase.
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
import { corsHeaders, json, auth } from "./_shared.ts";
import {
  take,
  remaining,
  limitOf,
  buildLimiters,
  loginUserKey,
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
      return ["/regions"];
    case "tariffs":
      // Master tarif dipakai dua endpoint: admin (/tariffs) dan petugas
      // (/master/tariffs).
      return ["/tariffs", "/master/tariffs"];
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
    return json({ status: "ok", version: "3.0.0-supabase-only" });
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
      case "change-admin-password": return await authh.changeAdminPassword(req);
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

  // ---------------- /region-tariffs ----------------
  if (a === "region-tariffs") {
    if (req.method === "GET" && !b) return await rt.getRegionTariffs(req);
    if (req.method === "PUT" && b) return await rt.updateRegionTariff(req, b);
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
 * Satu baris JSON per request supaya bisa difilter di Supabase Logs Explorer.
 *
 * Fungsinya: melihat pola traffic yang sebenarnya — endpoint mana yang paling
 * sering dipanggil, dari IP mana, apakah sudah bertoken, dan apakah kena rate
 * limit. Ini data yang dibutuhkan untuk memutuskan di mana request storm
 * harus dihentikan (sisi klien vs gateway vs shared state).
 */
function logRequest(fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ ev: "api_request", ...fields }));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  let p = url.searchParams.get("path") ?? url.pathname.replace(/^\/functions\/v1\/api\/?/, "");
  const path = (p.startsWith("/") ? p : `/${p}`).replace(/^\/api(?=\/|$)/, "") || "/";
  const parts = path.replace(/^\//, "").split("/").filter(Boolean);

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

    return withHeaders(res, {
      ...rlHeaders,
      "X-Api-Instance": INSTANCE_ID,
      ...(ttl > 0 ? { "X-Cache": "MISS" } : {}),
    });
  } catch (error) {
    console.error("[api]", req.method, path, error);
    return json({ error: "Internal error" }, 500);
  }
});
