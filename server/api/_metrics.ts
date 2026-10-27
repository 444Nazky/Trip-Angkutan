/**
 * Registry metrik runtime untuk server API intranet (port 3000).
 *
 * Tujuannya: dashboard admin bisa menampilkan statistik server yang serupa
 * panel btop - Total Requests, Success Rate, latensi, penggunaan memori, dan
 * grafik request per menit.
 *
 * PENTING: semua state di sini hanya hidup di memori proses. Server intranet
 * adalah proses Deno panjang di port 3000, jadi angkanya akurat dan kumulatif
 * sejak proses start; restart container akan mengosongkannya.
 */

export type MetricsBucket = {
  /** Epoch menit (epoch ms dibulatkan ke menit). */
  minute: number;
  total: number;
  ok: number;
  err: number;
};

export type PathStat = {
  path: string;
  count: number;
  errors: number;
  /** Latensi rata-rata (ms) untuk path ini. */
  avgMs: number;
  lastMs: number;
};

export type MetricsSnapshot = {
  /** Epoch ms saat registry dibuat (= start proses, mendekati uptime server). */
  startedAt: number;
  uptimeMs: number;
  total: number;
  ok: number;
  clientError: number;
  serverError: number;
  /** 0 - 100. */
  successRate: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  /** Request per menit pada menit terakhir yang ada isinya. */
  rpsLastMinute: number;
  /** Total request 1 jam terakhir. */
  requestsLastHour: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  /** Deret waktu per menit (terlama -> terbaru). */
  buckets: MetricsBucket[];
  topPaths: PathStat[];
  lastRequestAt: number | null;
  /** Jumlah client unik (IP) yang terlihat dalam 1 jam terakhir. */
  uniqueClientsLastHour: number;
};

/** Berapa lama bucket per menit disimpan (ms). */
const BUCKET_WINDOW_MS = 90 * 60 * 1000;
/** Berapa banyak menit yang selalu dikirim ke dashboard (deret kontinu). */
const WINDOW_MINUTES = 60;
/** Berapa lama latensi mentah disimpan (untuk p95). */
const LATENCY_WINDOW = 1000;
/** Berapa banyak path yang dilacak. */
const MAX_PATHS = 200;

const startedAt = Date.now();

const counters = {
  total: 0,
  ok: 0,
  clientError: 0,
  serverError: 0,
  maxMs: 0,
};

let latencySamples: number[] = [];
const buckets = new Map<number, MetricsBucket>();
const paths = new Map<string, { count: number; errors: number; totalMs: number; lastMs: number }>();
/** IP klien -> epoch ms request terakhir. */
const clients = new Map<string, number>();
let lastRequestAt: number | null = null;

function bucketFor(minute: number): MetricsBucket {
  let b = buckets.get(minute);
  if (!b) {
    b = { minute, total: 0, ok: 0, err: 0 };
    buckets.set(minute, b);
  }
  return b;
}

function sweep(now: number): void {
  const cutoff = now - BUCKET_WINDOW_MS;
  for (const [minute, b] of buckets) {
    if (minute < cutoff) buckets.delete(minute);
  }
  const clientCutoff = now - 60 * 60 * 1000;
  for (const [ip, at] of clients) {
    if (at < clientCutoff) clients.delete(ip);
  }
  if (buckets.size > 200) {
    const sorted = [...buckets.keys()].sort((a, b) => a - b);
    for (const key of sorted.slice(0, sorted.length - 120)) buckets.delete(key);
  }
}

export type RecordInput = {
  path: string;
  method: string;
  status: number;
  ms: number;
  ip?: string;
};

/**
 * Catat satu request yang sudah selesai diproses.
 *
 * Dipanggil dari `handleRequest` (index.ts). Path statistik (`server-stats`)
 * sengaja DIKECUALIKAN:
 * polling dashboard setiap 5 detik akan membuat server terlihat sangat
 * sibuk padahal tidak ada pekerjaan nyata.
 */
export function recordRequest(input: RecordInput): void {
  const now = Date.now();

  if (input.path === "server-stats" || input.path === "/server-stats") return;

  counters.total += 1;
  if (input.status >= 500) counters.serverError += 1;
  else if (input.status >= 400) counters.clientError += 1;
  else counters.ok += 1;

  if (input.ms > counters.maxMs) counters.maxMs = input.ms;

  latencySamples.push(input.ms);
  if (latencySamples.length > LATENCY_WINDOW) latencySamples.shift();

  const minute = Math.floor(now / 60_000) * 60_000;
  const b = bucketFor(minute);
  b.total += 1;
  if (input.status >= 400) b.err += 1;
  else b.ok += 1;

  const stat = paths.get(input.path) ?? { count: 0, errors: 0, totalMs: 0, lastMs: 0 };
  stat.count += 1;
  stat.totalMs += input.ms;
  stat.lastMs = input.ms;
  if (input.status >= 400) stat.errors += 1;
  paths.set(input.path, stat);

  if (paths.size > MAX_PATHS) {
    // Buang path paling jarang dipakai.
    const sorted = [...paths.entries()].sort((a, b) => a[1].count - b[1].count);
    for (const [key] of sorted.slice(0, Math.floor(MAX_PATHS / 4))) paths.delete(key);
  }

  if (input.ip) clients.set(input.ip, now);

  lastRequestAt = now;
  sweep(now);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[idx]);
}

/** Ambil penggunaan memori proses (RSS + heap). Aman dipanggil di runtime apa pun. */
function memoryUsage(): MetricsSnapshot["memory"] {
  try {
    const m = Deno.memoryUsage();
    return {
      rss: m.rss,
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      external: m.external,
    };
  } catch {
    return { rss: 0, heapUsed: 0, heapTotal: 0, external: 0 };
  }
}

/** Snapshot metrik saat ini. */
export function snapshot(): MetricsSnapshot {
  const now = Date.now();
  sweep(now);

  const sorted = [...latencySamples].sort((a, b) => a - b);
  const avgMs = latencySamples.length
    ? Math.round(latencySamples.reduce((a, b) => a + b, 0) / latencySamples.length)
    : 0;

  // Deret KONTINU 60 menit terakhir (lama -> baru).
  //
  // Dulu hanya menit yang punya request yang dikirim, jadi grafik
  // "request per menit" di dashboard sering tampil kosong / bolong-bolong.
  // Sekarang menit tanpa request diisi dengan angka 0 supaya grafik selalu
  // berupa garis penuh yang naik-turun sesuai kondisi server.
  const currentMinute = Math.floor(now / 60_000) * 60_000;
  const bucketList: MetricsBucket[] = [];
  for (let i = WINDOW_MINUTES - 1; i >= 0; i--) {
    const minute = currentMinute - i * 60_000;
    bucketList.push(buckets.get(minute) ?? { minute, total: 0, ok: 0, err: 0 });
  }

  // "Request per menit" = menit terakhir yang punya traffic (bukan menit
  // berjalan yang mungkin masih 0 karena baru saja berganti menit).
  let lastMinute: MetricsBucket | null = null;
  for (let i = bucketList.length - 1; i >= 0; i--) {
    if (bucketList[i].total > 0) {
      lastMinute = bucketList[i];
      break;
    }
  }

  const hourCutoff = now - 60 * 60 * 1000;
  const requestsLastHour = bucketList
    .filter((b) => b.minute >= hourCutoff)
    .reduce((sum, b) => sum + b.total, 0);
  const total = counters.total;
  const successRate = total ? Math.round((counters.ok / total) * 1000) / 10 : 100;

  const topPaths: PathStat[] = [...paths.entries()]
    .map(([path, s]) => ({
      path,
      count: s.count,
      errors: s.errors,
      avgMs: s.count ? Math.round(s.totalMs / s.count) : 0,
      lastMs: s.lastMs,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    startedAt,
    uptimeMs: now - startedAt,
    total,
    ok: counters.ok,
    clientError: counters.clientError,
    serverError: counters.serverError,
    successRate,
    avgMs,
    p95Ms: percentile(sorted, 95),
    maxMs: counters.maxMs,
    rpsLastMinute: lastMinute ? lastMinute.total : 0,
    requestsLastHour,
    memory: memoryUsage(),
    buckets: bucketList,
    topPaths,
    lastRequestAt,
    uniqueClientsLastHour: clients.size,
  };
}

/** Reset semua counter (dipakai test). */
export function resetMetrics(): void {
  counters.total = 0;
  counters.ok = 0;
  counters.clientError = 0;
  counters.serverError = 0;
  counters.maxMs = 0;
  latencySamples = [];
  buckets.clear();
  paths.clear();
  clients.clear();
  lastRequestAt = null;
}
