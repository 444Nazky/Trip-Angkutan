/**
 * Endpoint `GET /server-stats` - panel statistik server untuk Admin Dashboard.
 *
 * Dipakai oleh tab "Endpoint" di admin dashboard untuk memantau server
 * intranet port 3000: total request, success rate, latensi, memori proses,
 * grafik request per menit, dan status tiap komponen server.
 *
 * Akses:
 *   - Wajib punya token admin (sama seperti endpoint master data lain),
 *     KECUALI server dijalankan dengan `ADMIN_AUTH_DISABLED=1` (mode intranet
 *     tanpa auth, untuk mesin yang benar-benar tertutup di LAN).
 *   - Komponen yang dicek: proses API, database lokal, JWT/auth, dan
 *     direktori penyimpanan file. Tidak ada pengecekan ke internet.
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
      const keyProblem = /kredensial|unauthorized|auth/i.test(msg);
      return {
        id: "database",
        label: "Database Lokal",
        status: keyProblem ? "degraded" : "down",
        detail: keyProblem ? `Host database hidup tapi kredensial salah: ${msg}` : msg,
        ms,
      };
    }
    return {
      id: "database",
      label: "Database Lokal",
      status: "ok",
      detail: "PostgreSQL terjangkau, query SELECT berhasil",
      ms,
    };
  } catch (e) {
    return {
      id: "database",
      label: "Database Lokal",
      status: "down",
      detail: e instanceof Error ? e.message : "gagal cek database",
      ms: Date.now() - started,
    };
  }
}

async function checkStorage(): Promise<Component> {
  const started = Date.now();
  const dir = Deno.env.get("STORAGE_DIR") || "/data/storage";
  try {
    let files = 0;
    for await (const entry of Deno.readDir(dir)) {
      if (entry.isDirectory) {
        for await (const _ of Deno.readDir(`${dir}/${entry.name}`)) files++;
      }
    }
    return {
      id: "storage",
      label: "Penyimpanan File",
      status: "ok",
      detail: `${dir} terjangkau (${files} berkas)`,
      ms: Date.now() - started,
    };
  } catch (e) {
    return {
      id: "storage",
      label: "Penyimpanan File",
      status: "down",
      detail: e instanceof Error ? e.message : "direktori penyimpanan tidak terbaca",
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
      detail: "JWT_SECRET kosong - token tidak dapat diverifikasi",
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
    await checkStorage(),
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
