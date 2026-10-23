// Metrik proses untuk endpoint GET /stats (admin only).
//
// Semua angka In-memory dan per instance: di Supabase Edge Runtime instance
// bisa berganti-ganti, jadi /stats menjawab "instance yang melayani request
// ini". Di server intranet (port 3000) prosesnya long-lived, jadi angkanya
// mencakup seluruh umur server.
const STARTED_AT = Date.now();

type Totals = {
  count: number;
  ok: number;
  clientErrors: number;
  serverErrors: number;
  totalMs: number;
};

const totals: Totals = { count: 0, ok: 0, clientErrors: 0, serverErrors: 0, totalMs: 0 };

type PathStat = { count: number; errors: number; totalMs: number };
const perPath = new Map<string, PathStat>();

/** Bucket per detik untuk jendela 60 detik terakhir (RPM + latensi terkini). */
type SecondBucket = { n: number; ms: number };
const perSecond = new Map<number, SecondBucket>();
const WINDOW_SECONDS = 60;

export function recordRequest(path: string, status: number, ms: number): void {
  totals.count++;
  totals.totalMs += ms;
  if (status >= 200 && status < 300) totals.ok++;
  else if (status >= 500) totals.serverErrors++;
  else if (status >= 400) totals.clientErrors++;

  const p = perPath.get(path) ?? { count: 0, errors: 0, totalMs: 0 };
  p.count++;
  p.totalMs += ms;
  if (status >= 400) p.errors++;
  perPath.set(path, p);

  const sec = Math.floor(Date.now() / 1000);
  const b = perSecond.get(sec) ?? { n: 0, ms: 0 };
  b.n++;
  b.ms += ms;
  perSecond.set(sec, b);

  // Cukup simpan 2x jendela supaya snapshot yang sedikit telat tetap benar.
  const cutoff = sec - WINDOW_SECONDS * 2;
  if (perSecond.size > WINDOW_SECONDS * 3) {
    for (const key of perSecond.keys()) if (key < cutoff) perSecond.delete(key);
  }
}

function recentWindow(): { n: number; ms: number } {
  const nowSec = Math.floor(Date.now() / 1000);
  let n = 0;
  let ms = 0;
  for (const [sec, b] of perSecond) {
    if (sec > nowSec - WINDOW_SECONDS) {
      n += b.n;
      ms += b.ms;
    }
  }
  return { n, ms };
}

function memory() {
  try {
    const m = Deno.memoryUsage();
    return {
      rssBytes: m.rss,
      heapTotalBytes: m.heapTotal,
      heapUsedBytes: m.heapUsed,
      externalBytes: m.external,
    };
  } catch {
    return null;
  }
}

function load() {
  try {
    const [one, five, fifteen] = Deno.loadavg();
    return { load1: one, load5: five, load15: fifteen };
  } catch {
    return null;
  }
}

export function statsSnapshot(instance: string) {
  const recent = recentWindow();
  const topEndpoints = [...perPath.entries()]
    .map(([path, s]) => ({
      path,
      count: s.count,
      errors: s.errors,
      avgMs: Math.round((s.totalMs / s.count) * 10) / 10,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    status: "ok",
    mode: Deno.env.get("API_DISABLE_EMBEDDED_SERVER") === "1" ? "intranet" : "cloud",
    instance,
    startedAt: new Date(STARTED_AT).toISOString(),
    uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
    requests: {
      total: totals.count,
      ok: totals.ok,
      clientErrors: totals.clientErrors,
      serverErrors: totals.serverErrors,
      successRate: totals.count ? Math.round((totals.ok / totals.count) * 1000) / 10 : 100,
      avgMs: totals.count ? Math.round((totals.totalMs / totals.count) * 10) / 10 : 0,
      rpm: recent.n,
      recentAvgMs: recent.n ? Math.round((recent.ms / recent.n) * 10) / 10 : 0,
    },
    memory: memory(),
    cpu: load(),
    runtime: {
      platform: Deno.build.os,
      arch: Deno.build.arch,
      denoVersion: Deno.version.deno,
    },
    topEndpoints,
  };
}
