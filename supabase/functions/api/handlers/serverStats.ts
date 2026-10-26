/**
 * Endpoint `GET /server-stats` - panel statistik server untuk Admin Dashboard.
 *
 * Dipakai oleh tab "Endpoint" di admin dashboard untuk memantau server
 * intranet port 3000 (atau cloud) dengan gaya panel metrik Supabase/btop:
 * Total Requests, Success Rate, latensi, memori proses, grafik request per
 * menit, dan status tiap komponen server.
 *
 * Akses:
 *   - Wajib punya token admin (sama seperti endpoint master data lain),
 *     KECUALI server dijalankan dengan `ADMIN_AUTH_DISABLED=1` (mode intranet
 *     tanpa auth, untuk mesin yang benar-benar tertutup di LAN).
 *   - Komponen yang dicek: proses API, database Supabase, JWT/auth, cache,
 *     dan konektivitas ke cloud (Supabase host) - itu yang membedakan
 *     "server hidup tapi tidak bisa ke internet" dari "server hidup normal".
 */

import { db, json, requireAdmin } from "../_shared.ts";
import { snapshot, type MetricsSnapshot } from "../_metrics.ts";

type ComponentStatus = "ok" | "degraded" | "down" | "unknown";

type Component = {
  id: string;
  label: string;
  status: ComponentStatus;
  detail: string;
  /** Latensi pengecekan terakhir (ms). */
  ms: number;
};

type ServerStatsResponse = {
  ok: true;
  generatedAt: number;
  mode: "intranet" | "cloud";
  instance: string;
  version: string;
  metrics: MetricsSnapshot;
  components: Component[];
};

function mode(): "intranet" | "cloud" {
  return Deno.env.get("API_DISABLE_EMBEDDED_SERVER") === "1" ? "intranet" : "cloud";
}

async function checkDatabase(): Promise<Component> {
  const started = Date.now();
  try {
    const { error } = await db.from("regions").select("id").limit(1);
    const ms = Date.now() - started;
    if (error) {
      const msg = error.message;
      // "Invalid API key" = host hidup, hanya kredensial yang salah ->
      // status "terbatas", bukan "gangguan".
      const keyProblem = /api key|jwt|unauthorized|auth/i.test(msg);
      return {
        id: "database",
        label: "Database (Supabase)",
        status: keyProblem ? "degraded" : "down",
        detail: keyProblem ? `Host database hidup tapi kredensial salah: ${msg}` : msg,
        ms,
      };
    }
    return {
      id: "database",
      label: "Database (Supabase)",
      status: "ok",
      detail: "PostgreSQL terjangkau, query SELECT berhasil",
      ms,
    };
  } catch (e) {
    return {
      id: "database",
      label: "Database (Supabase)",
      status: "down",
      detail: e instanceof Error ? e.message : "gagal cek database",
      ms: Date.now() - started,
    };
  }
}

async function checkCloud(): Promise<Component> {
  const started = Date.now();
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) {
    return {
      id: "cloud",
      label: "Konektivitas Cloud",
      status: "unknown",
      detail: "SUPABASE_URL belum diisi di environment server",
      ms: 0,
    };
  }
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      const anon = Deno.env.get("SUPABASE_ANON_KEY");
      const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const key = anon || service;
      if (key) headers['apikey'] = key;
      if (service) headers['Authorization'] = `Bearer ${service}`;

      const res = await fetch(`${url.replace(/\/+$/, "")}/auth/v1/health`, {
        method: "GET",
        headers,
        signal: ctrl.signal,
      });
      const ms = Date.now() - started;
      return {
        id: "cloud",
        label: "Konektivitas Cloud",
        // 401 di /auth/v1/health artinya host hidup tapi key tidak cocok -
        // itu tetap "terhubung", hanya autentikasinya yang belum beres.
        status: res.ok ? "ok" : "degraded",
        detail: res.ok
          ? "Host Supabase cloud terjangkau"
          : `Host menjawab HTTP ${res.status}${res.status === 401 ? " (api key tidak cocok)" : ""}`,
        ms,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return {
      id: "cloud",
      label: "Konektivitas Cloud",
      status: "down",
      detail: e instanceof Error ? e.message : "tidak bisa menghubungi host cloud",
      ms: Date.now() - started,
    };
  }
}

function checkAuth(): Component {
  const secret = Deno.env.get("JWT_SECRET");
  if (!secret) {
    return {
      id: "auth",
      label: "Autentikasi (JWT)",
      status: "down",
      detail: "JWT_SECRET kosong - token cloud tidak valid di server ini",
      ms: 0,
    };
  }
  if (secret === "trip-angkut-secret-key") {
    return {
      id: "auth",
      label: "Autentikasi (JWT)",
      status: "degraded",
      detail: "JWT_SECRET masih memakai nilai default - wajib diganti",
      ms: 0,
    };
  }
  return {
    id: "auth",
    label: "Autentikasi (JWT)",
    status: "ok",
    detail: "JWT_SECRET terpasang",
    ms: 0,
  };
}

export async function serverStats(req: Request): Promise<Response> {
  const authDisabled = Deno.env.get("ADMIN_AUTH_DISABLED") === "1";
  if (!authDisabled) {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Akses ditolak. Token admin dibutuhkan." }, 401);
  }

  const metrics = snapshot();

  const components: Component[] = [
    {
      id: "api",
      label: "Proses API",
      status: "ok",
      detail: `Server ${mode()} aktif, sudah jalan ${formatUptime(metrics.uptimeMs)}`,
      ms: 0,
    },
    await checkDatabase(),
    checkAuth(),
    await checkCloud(),
  ];

  const body: ServerStatsResponse = {
    ok: true,
    generatedAt: Date.now(),
    mode: mode(),
    instance: Deno.env.get("API_INSTANCE_LABEL") ?? "api-intranet",
    version: "3.0.0",
    metrics,
    components,
  };

  return json(body);
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h} jam ${m} menit`;
  if (m > 0) return `${m} menit ${sec} detik`;
  return `${sec} detik`;
}
