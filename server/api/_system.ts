// Metrik sistem mesin server (CPU, RAM, storage, load, uptime).

export type CpuMetrics = {
  /** Persentase 0-100 sejak sampel sebelumnya. null saat belum ada pembanding. */
  usagePercent: number | null;
  averageSinceBootPercent: number;
  cores: number;
  model: string;
  mhz: number | null;
  loadAvg: [number, number, number];
};



export type MemoryMetrics = {
  total: number;
  used: number;
  available: number;
  usedPercent: number;
  swapTotal: number;
  swapUsed: number;
  swapUsedPercent: number;
};



export type DiskMetrics = {
  label: string;
  path: string;
  total: number;
  used: number;
  free: number;
  usedPercent: number;
};



export type SystemMetrics = {
  hostname: string;
  os: string;
  arch: string;
  uptimeSeconds: number;
  cpu: CpuMetrics;
  memory: MemoryMetrics;
  disks: DiskMetrics[];
  available: boolean;
};



type CpuSample = { total: number; idle: number };



let prevCpuSample: CpuSample | null = null;



async function runCommand(cmd: string, args: string[]): Promise<string | null> {
  try {
    const out = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!out.success) return null;
    return new TextDecoder().decode(out.stdout);
  } catch {
    return null;
  }
}

// Baca file teks. PENTING 1: `Deno.readTextFile()` GAGAL untuk file pseudo-filesystem Linux (/proc/*) karena `st_size` file itu 0, sedangkan Deno…
async function readText(path: string): Promise<string | null> {
  const direct = await readDirect(path);
  if (direct !== null) return direct;
  // Fallback: baca lewat `cat` (diperlukan untuk /proc).
  return await runCommand("cat", [path]);
}



async function readDirect(path: string): Promise<string | null> {
  let file: Deno.FsFile;
  try {
    file = await Deno.open(path, { read: true });
  } catch {
    return null;
  }
  try {
    const chunks: Uint8Array[] = [];
    const buf = new Uint8Array(64 * 1024);
    while (true) {
      const n = await file.read(buf);
      if (n === null) break;
      chunks.push(buf.slice(0, n));
    }
    let size = 0;
    for (const c of chunks) size += c.length;
    const out = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return new TextDecoder().decode(out);
  } catch {
    return null;
  } finally {
    try {
      file.close();
    } catch {
    }
  }
}



async function readCpu(): Promise<CpuMetrics> {
  const empty: CpuMetrics = {
    usagePercent: null,
    averageSinceBootPercent: 0,
    cores: 0,
    model: "Tidak diketahui",
    mhz: null,
    loadAvg: [0, 0, 0],
  };

  const stat = await readText("/proc/stat");
  let sample: CpuSample | null = null;
  if (stat) {
    const line = stat.split("\n").find((l) => l.startsWith("cpu "));
    if (line) {
      const parts = line.trim().split(/\s+/).slice(1).map((v) => Number(v) || 0);
      const total = parts.reduce((a, b) => a + b, 0);
      const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
      sample = { total, idle };
    }
  }

  let usagePercent: number | null = null;
  let averageSinceBootPercent = 0;
  if (sample) {
    averageSinceBootPercent = sample.total > 0
      ? Math.min(100, Math.max(0, ((sample.total - sample.idle) / sample.total) * 100))
      : 0;
    if (prevCpuSample) {
      const dTotal = sample.total - prevCpuSample.total;
      const dIdle = sample.idle - prevCpuSample.idle;
      if (dTotal > 0) {
        usagePercent = Math.min(100, Math.max(0, ((dTotal - dIdle) / dTotal) * 100));
      }
    }
    prevCpuSample = sample;
  }

  let cores = 0;
  let model = "";
  let mhzSum = 0;
  let mhzCount = 0;
  const cpuinfo = await readText("/proc/cpuinfo");
  if (cpuinfo) {
    for (const line of cpuinfo.split("\n")) {
      if (/^processor\s*:/.test(line)) cores += 1;
      else if (/^model name\s*:/.test(line) && !model) model = line.split(":").slice(1).join(":").trim();
      else if (/^cpu MHz\s*:/.test(line)) {
        const v = Number(line.split(":")[1]);
        if (Number.isFinite(v) && v > 0) {
          mhzSum += v;
          mhzCount += 1;
        }
      }
    }
  }
  if (cores === 0) {
    try {
      cores = navigator.hardwareConcurrency ?? 0;
    } catch {
      cores = 0;
    }
  }

  let loadAvg: [number, number, number] = [0, 0, 0];
  const loadavg = await readText("/proc/loadavg");
  if (loadavg) {
    const parts = loadavg.trim().split(/\s+/).map(Number);
    loadAvg = [
      Number.isFinite(parts[0]) ? parts[0] : 0,
      Number.isFinite(parts[1]) ? parts[1] : 0,
      Number.isFinite(parts[2]) ? parts[2] : 0,
    ];
  }

  return {
    usagePercent: usagePercent === null ? null : Math.round(usagePercent * 10) / 10,
    averageSinceBootPercent: Math.round(averageSinceBootPercent * 10) / 10,
    cores,
    model: model || "Tidak diketahui",
    mhz: mhzCount ? Math.round(mhzSum / mhzCount) : null,
    loadAvg,
  };
}



async function readMemory(): Promise<MemoryMetrics> {
  const empty: MemoryMetrics = {
    total: 0,
    used: 0,
    available: 0,
    usedPercent: 0,
    swapTotal: 0,
    swapUsed: 0,
    swapUsedPercent: 0,
  };

  const meminfo = await readText("/proc/meminfo");
  if (!meminfo) return empty;

  const values = new Map<string, number>();
  for (const line of meminfo.split("\n")) {
    const m = line.match(/^(\w+):\s+(\d+)\s*kB$/);
    if (m) values.set(m[1], Number(m[2]) * 1024);
  }

  const total = values.get("MemTotal") ?? 0;
  const free = values.get("MemFree") ?? 0;
  const buffers = values.get("Buffers") ?? 0;
  const cached = values.get("Cached") ?? 0;
  const available = values.get("MemAvailable") ?? (free + buffers + cached);
  const used = Math.max(0, total - available);
  const swapTotal = values.get("SwapTotal") ?? 0;
  const swapFree = values.get("SwapFree") ?? 0;
  const swapUsed = Math.max(0, swapTotal - swapFree);

  return {
    total,
    used,
    available,
    usedPercent: total ? Math.round((used / total) * 1000) / 10 : 0,
    swapTotal,
    swapUsed,
    swapUsedPercent: swapTotal ? Math.round((swapUsed / swapTotal) * 1000) / 10 : 0,
  };
}



async function readDisk(label: string, path: string): Promise<DiskMetrics | null> {
  try {
    const out = await runCommand("df", ["-k", path]);
    if (!out) return null;
    const lines = out.trim().split("\n");
    if (lines.length < 2) return null;
    const cols = lines[lines.length - 1].trim().split(/\s+/);
    if (cols.length < 5) return null;
    const total = Number(cols[1]) * 1024;
    const used = Number(cols[2]) * 1024;
    const free = Number(cols[3]) * 1024;
    if (!Number.isFinite(total) || total <= 0) return null;
    return {
      label,
      path,
      total,
      used,
      free,
      usedPercent: used > 0 || free > 0 ? Math.round((used / (used + free)) * 1000) / 10 : 0,
    };
  } catch {
    return null;
  }
}



async function readUptimeSeconds(): Promise<number> {
  const raw = await readText("/proc/uptime");
  if (!raw) return 0;
  const seconds = Number(raw.trim().split(/\s+/)[0]);
  return Number.isFinite(seconds) ? Math.floor(seconds) : 0;
}



async function hostname(): Promise<string> {
  try {
    const name = Deno.hostname();
    if (name) return name;
  } catch {
    // lanjut ke fallback
  }
  const fromProc = await readText("/proc/sys/kernel/hostname");
  if (fromProc?.trim()) return fromProc.trim();
  const fromFile = await readText("/etc/hostname");
  if (fromFile?.trim()) return fromFile.trim();
  return "server";
}



export async function systemSnapshot(): Promise<SystemMetrics> {
  const storageDir = Deno.env.get("STORAGE_DIR") || "/data/storage";

  const [cpu, memory, uptimeSeconds, storageDisk, rootDisk] = await Promise.all([
    readCpu(),
    readMemory(),
    readUptimeSeconds(),
    readDisk("Penyimpanan Data", storageDir),
    readDisk("Disk Sistem", "/"),
  ]);

  const disks = [storageDisk, rootDisk].filter((d): d is DiskMetrics => d !== null);

  return {
    hostname: await hostname(),
    os: `${Deno.build.os} ${Deno.build.arch}`,
    arch: Deno.build.arch,
    uptimeSeconds,
    cpu,
    memory,
    disks,
    available: cpu.cores > 0 || memory.total > 0,
  };
}
