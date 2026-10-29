// Rate limiter untuk Edge Function `api`. Setiap request ke Edge Function tetap dihitung sebagai invokasi, dan setiap query PostgREST tetap dihitung…

export type RateClass = "health" | "read" | "report" | "write" | "auth";



type BucketConfig = {
  capacity: number;
  refillPerMinute: number;
};



const STRICT_CONFIG: Record<RateClass, BucketConfig> = {
  // Health check dipanggil berkala oleh aplikasi mobile (sekitar 3 per menit per perangkat). Batas longgar supaya tidak mengganggu perangkat sah.
  health: { capacity: 60, refillPerMinute: 30 },
  read: { capacity: 120, refillPerMinute: 120 },
  report: { capacity: 30, refillPerMinute: 30 },
  write: { capacity: 30, refillPerMinute: 30 },
  // Endpoint autentikasi: batas ketat untuk menahan brute force PIN dan credential stuffing. Satu IP hanya boleh mencoba handful kali.
  auth: { capacity: 10, refillPerMinute: 2 },
};

// Batas longgar untuk traffic terautentikasi yang berbagi IP.
const LOOSE_CONFIG: Record<RateClass, BucketConfig> = {
  health: { capacity: 1200, refillPerMinute: 600 },
  read: { capacity: 900, refillPerMinute: 600 },
  report: { capacity: 240, refillPerMinute: 120 },
  write: { capacity: 240, refillPerMinute: 120 },
  auth: { capacity: 30, refillPerMinute: 10 },
};



function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}



function configFor(cls: RateClass, loose: boolean): BucketConfig {
  const base = loose ? LOOSE_CONFIG[cls] : STRICT_CONFIG[cls];
  const prefix = loose ? `RATE_LIMIT_LOOSE_${cls.toUpperCase()}` : `RATE_LIMIT_${cls.toUpperCase()}`;
  return {
    capacity: envInt(`${prefix}_CAPACITY`, base.capacity),
    refillPerMinute: envInt(`${prefix}_REFILL_PER_MIN`, base.refillPerMinute),
  };
}



type Bucket = {
  tokens: number;
  updatedAt: number;
  expiresAt: number;
};



const buckets = new Map<string, Bucket>();



const BUCKET_IDLE_MS = 10 * 60 * 1000;
/** Setiap N request dilakukan sweep supaya peta tidak tumbuh tanpa batas. */
const SWEEP_EVERY = 500;



let requestCount = 0;



function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
}

/** Satu bucket yang harus lolos supaya request boleh diteruskan. */
export type Limiter = {
  key: string;
  cls: RateClass;
  loose: boolean;
};



export function take(limiter: Limiter): boolean {
  const now = Date.now();
  if (++requestCount % SWEEP_EVERY === 0) sweep(now);

  const cfg = configFor(limiter.cls, limiter.loose);
  let bucket = buckets.get(limiter.key);
  if (!bucket) {
    bucket = { tokens: cfg.capacity, updatedAt: now, expiresAt: now + BUCKET_IDLE_MS };
    buckets.set(limiter.key, bucket);
  }

  const elapsed = Math.max(0, now - bucket.updatedAt);
  const refill = (cfg.refillPerMinute / 60_000) * elapsed;
  bucket.tokens = Math.min(cfg.capacity, bucket.tokens + refill);
  bucket.updatedAt = now;
  bucket.expiresAt = now + BUCKET_IDLE_MS;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}



export function remaining(limiter: Limiter): number {
  const bucket = buckets.get(limiter.key);
  if (!bucket) return configFor(limiter.cls, limiter.loose).capacity;
  return Math.max(0, Math.floor(bucket.tokens));
}



export function limitOf(limiter: Limiter): number {
  return configFor(limiter.cls, limiter.loose).capacity;
}



export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  return "unknown";
}

// Bucket yang harus dicek untuk sebuah request. - Semua request dibatasi per IP.
export function buildLimiters(
  req: Request,
  cls: RateClass,
  subject: string | null,
  forceLooseIp = false,
): Limiter[] {
  const ip = clientIp(req);
  const limiters: Limiter[] = [];

  // Bucket per-IP selalu longgar kalau request sudah terautentikasi (NAT seluler) atau kalau endpoint-nya hanya pemeriksaan kesehatan: endpoint seperti…
  const useLooseIp = forceLooseIp || subject !== null || cls === "auth";

  if (useLooseIp) {
    limiters.push({ key: `${cls}:loose:ip:${ip}`, cls, loose: true });
  } else {
    limiters.push({ key: `${cls}:ip:${ip}`, cls, loose: false });
  }

  if (subject) {
    limiters.push({ key: `${cls}:subj:${subject}`, cls, loose: false });
  }
  return limiters;
}



export function loginUserKey(username: string): string {
  const normalized = username.trim().toLowerCase().slice(0, 64);
  return `auth:user:${normalized}`;
}
