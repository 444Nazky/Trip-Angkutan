// Rate limiter untuk Edge Function `api`.
//
// Setiap request ke Edge Function tetap dihitung sebagai invokasi, dan setiap
// query PostgREST tetap dihitung sebagai operasi database. Keduanya memotong
// kuota proyek. Tanpa batas eksplisit, satu bug di sisi klien ATAU satu
// scanner dari luar bisa menembak ratusan request per menit ke endpoint yang
// sama dan menghabiskan kuota tanpa menghasilkan data.
//
// Mekanisme: token bucket per kunci. Bucket diisi ulang secara kontinu
// (refill), sehingga tidak ada scheduler yang perlu dibersihkan. State hanya
// hidup di memori instance Edge Function, jadi cukup untuk menahan flood dari
// satu klien atau satu penyerang.
//
// Dua lapis batas:
//
//   1. Bucket ketat — untuk request TANPA token (scanner dari luar). Ini yang
//      menahan request storm: satu IP hanya boleh menembak handful kali.
//   2. Bucket longgar — untuk request yang SUDAH terautentikasi. Aplikasi
//      mobile dipakai banyak petugas yang berbagi IP (NAT seluler), jadi batas
//      per-IP tidak boleh terlalu sempit. Batas ketat untuk traffic sah
//      ditambahkan per-subjek (officer/token), bukan per-IP.
//
// Semua angka batas bisa diubah lewat environment variable (tanpa redeploy
// kode) melalui `supabase secrets set`.

/** Kelas endpoint, tiap kelas punya bucket dan refill sendiri. */
export type RateClass = "health" | "read" | "report" | "write" | "auth";

type BucketConfig = {
  /** Jumlah token maksimum yang boleh terkumpul (burst). */
  capacity: number;
  /** Token yang ditambahkan per menit. */
  refillPerMinute: number;
};

/** Batas untuk traffic tidak terautentikasi (scanner dari luar). */
const STRICT_CONFIG: Record<RateClass, BucketConfig> = {
  // Health check dipanggil berkala oleh aplikasi mobile (sekitar 3 per menit
  // per perangkat). Batas longgar supaya tidak mengganggu perangkat sah.
  health: { capacity: 60, refillPerMinute: 30 },
  // Endpoint baca umum. Cukup untuk pemakaian normal admin + petugas.
  read: { capacity: 120, refillPerMinute: 120 },
  // Endpoint laporan: querying berat, dipanggil dari layar laporan admin.
  report: { capacity: 30, refillPerMinute: 30 },
  // Endpoint tulis: create/update/delete.
  write: { capacity: 30, refillPerMinute: 30 },
  // Endpoint autentikasi: batas ketat untuk menahan brute force PIN dan
  // credential stuffing. Satu IP hanya boleh mencoba handful kali.
  auth: { capacity: 10, refillPerMinute: 2 },
};

/**
 * Batas longgar untuk traffic terautentikasi yang berbagi IP.
 * Numerous petugas berada di balik NAT operator seluler, jadi satu IP bisa
 * mewakili puluhan perangkat sah. Batas ini jadi pagar pengaman agar satu
 * perangkat tidak mematikan perangkat lain di IP yang sama.
 */
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
  /** Sisa token. */
  tokens: number;
  /** Epoch milidetik saat bucket terakhir kali penuh. */
  updatedAt: number;
  /** Epoch milidetik saat bucket boleh dihapus dari peta. */
  expiresAt: number;
};

const buckets = new Map<string, Bucket>();

/** Berapa lama bucket idle dibuang (ms). */
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
  /** Kunci bucket (bisa lebih dari satu per request). */
  key: string;
  /** Kelas endpoint — menentukan batas dan label. */
  cls: RateClass;
  /**true bila bucket ini longgar (traffic terautentikasi). */
  loose: boolean;
};

/**
 * Alokasikan token untuk satu kunci.
 * Mengembalikan true bila request boleh diteruskan.
 */
export function take(limiter: Limiter): boolean {
  const now = Date.now();
  if (++requestCount % SWEEP_EVERY === 0) sweep(now);

  const cfg = configFor(limiter.cls, limiter.loose);
  let bucket = buckets.get(limiter.key);
  if (!bucket) {
    bucket = { tokens: cfg.capacity, updatedAt: now, expiresAt: now + BUCKET_IDLE_MS };
    buckets.set(limiter.key, bucket);
  }

  // Refill kontinu: setiap milidetik menambah capacity/60 token.
  const elapsed = Math.max(0, now - bucket.updatedAt);
  const refill = (cfg.refillPerMinute / 60_000) * elapsed;
  bucket.tokens = Math.min(cfg.capacity, bucket.tokens + refill);
  bucket.updatedAt = now;
  bucket.expiresAt = now + BUCKET_IDLE_MS;

  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

/** Sisa token yang tersedia untuk kunci (untuk header X-RateLimit-Remaining). */
export function remaining(limiter: Limiter): number {
  const bucket = buckets.get(limiter.key);
  if (!bucket) return configFor(limiter.cls, limiter.loose).capacity;
  return Math.max(0, Math.floor(bucket.tokens));
}

/** Batas maksimum token untuk kunci (untuk header X-RateLimit-Limit). */
export function limitOf(limiter: Limiter): number {
  return configFor(limiter.cls, limiter.loose).capacity;
}

/**
 * Ambil IP klien. Edge Function dijalankan di belakang reverse proxy
 * Supabase, jadi IP asli ada di x-forwarded-for.
 */
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

/**
 * Bucket yang harus dicek untuk sebuah request.
 *
 * - Semua request dibatasi per IP.
 * - Request terautentikasi dibatasi per subjek token, supaya satu akun yang
 *   bocor tidak bisa menyamar dengan berpindah IP.
 * - Endpoint autentikasi juga dibatasi per nama pengguna yang dicoba, untuk
 *   menahan credential stuffing yang tersebar dari banyak IP.
 */
export function buildLimiters(
  req: Request,
  cls: RateClass,
  subject: string | null,
  forceLooseIp = false,
): Limiter[] {
  const ip = clientIp(req);
  const limiters: Limiter[] = [];

  // Bucket per-IP selalu longgar kalau request sudah terautentikasi (NAT
  // seluler) atau kalau endpoint-nya hanya pemeriksaan kesehatan: endpoint
  // seperti /health tidak menyentuh database, jadi menyetop perangkat sah di
  // balik IP yang sama lebih merugikan daripada membiarkan lewat.
  const useLooseIp = forceLooseIp || subject !== null || cls === "auth";

  if (useLooseIp) {
    limiters.push({ key: `${cls}:loose:ip:${ip}`, cls, loose: true });
  } else {
    limiters.push({ key: `${cls}:ip:${ip}`, cls, loose: false });
  }

  // Batas ketat per subjek: satu akun yang bocor tidak bisa menyamar dengan
  // berpindah IP.
  if (subject) {
    limiters.push({ key: `${cls}:subj:${subject}`, cls, loose: false });
  }
  return limiters;
}

/** Kunci tambahan khusus percobaan login per nama pengguna. */
export function loginUserKey(username: string): string {
  const normalized = username.trim().toLowerCase().slice(0, 64);
  return `auth:user:${normalized}`;
}
