type Entry = {
  body: unknown;
  expiresAt: number;
  route: string;
};

const store = new Map<string, Entry>();
function defaultTtl(): number {
  const raw = Deno.env.get("CACHE_TTL_MS");
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 60_000;
}


const ROUTE_TTL: Record<string, number> = {
  "/master/tariffs": 120_000,
  "/master/offline": 120_000,
  "/tariffs": 60_000,
  "/regions": 120_000,
  "/dermagas": 120_000,
  "/routes": 120_000,
  "/geofences": 120_000,
};


export function ttlFor(route: string): number {
  const override = ROUTE_TTL[route];
  if (override === undefined) return 0;
  return override || defaultTtl();
}


export function cacheKey(route: string, url: URL): string {
  const params = [...url.searchParams.entries()]
    .filter(([k]) => k !== "_t")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return params ? `${route}?${params}` : route;
}


export function cacheGet(key: string): unknown | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.body;
}


export function cacheSet(key: string, body: unknown, ttlMs: number, route = ""): void {
  if (ttlMs <= 0) return;
  store.set(key, { body, expiresAt: Date.now() + ttlMs, route });
}

export function cacheInvalidate(route: string): void {
  for (const [key, entry] of store) {
    if (entry.route === route) store.delete(key);
  }
}

export function cacheSweep(): void {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}
