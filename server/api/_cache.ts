// Cache TTL sederhana untuk endpoint master data di Edge Function `api`.
//
// Master data (tarif, region, dermaga, rute, geofence) jarang berubah, tetapi
// aplikasi mobile menariknya berulang kali: saat login, saat prefetch, dan
// setiap 5 menit pada auto-sync. Tanpa cache, setiap perangkat membangkitkan
// permintaan berulang yang tidak pernah berubah isinya.
//
// Cache ini berada di memori instance Edge Function dan hanya menyalin
// respons endpoint yang deterministik dan tidak bergantung pada waktu.
// Endpoint yang menulis, atau yang mengembalikan data per pengguna, TIDAK
// pernah dicache.

type Entry = {
  body: unknown;
  expiresAt: number;
  /** Rute sumber (tanpa scope) — dipakai saat invalidasi. */
  route: string;
};

const store = new Map<string, Entry>();

/** TTL default (ms). dapat diatur lewat CACHE_TTL_MS. */
function defaultTtl(): number {
  const raw = Deno.env.get("CACHE_TTL_MS");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}

/** TTL khusus per endpoint (ms). "0" berarti tidak boleh dicache. */
const ROUTE_TTL: Record<string, number> = {
  "/master/tariffs": 120_000,
  "/master/offline": 120_000,
  "/tariffs": 60_000,
  "/regions": 120_000,
  "/dermagas": 120_000,
  "/routes": 120_000,
  "/geofences": 120_000,
};

/** TTL endpoint master data, 0 bila endpoint ini tidak boleh dicache. */
export function ttlFor(route: string): number {
  const override = ROUTE_TTL[route];
  if (override === undefined) return 0;
  return override || defaultTtl();
}

/** Kunci cache: rute + query string yang sudah dinormalisasi. */
export function cacheKey(route: string, url: URL): string {
  const params = [...url.searchParams.entries()]
    .filter(([k]) => k !== "_t")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return params ? `${route}?${params}` : route;
}

/** Ambil nilai cache yang masih valid, atau null. */
export function cacheGet(key: string): unknown | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.body;
}

/** Simpan nilai ke cache dengan TTL tertentu. */
export function cacheSet(key: string, body: unknown, ttlMs: number, route = ""): void {
  if (ttlMs <= 0) return;
  store.set(key, { body, expiresAt: Date.now() + ttlMs, route });
}

/**
 * Buang seluruh entri untuk sebuah rute, di semua scope.
 * Dipanggil setelah admin mengubah master data, supaya perubahan langsung
 * terlihat tanpa menunggu TTL habis.
 */
export function cacheInvalidate(route: string): void {
  for (const [key, entry] of store) {
    if (entry.route === route) store.delete(key);
  }
}

/** Buang entri kedaluwarsa. Dipanggil berkala dari router. */
export function cacheSweep(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}
