// Impor massal data dari server lama (Supabase/railway) ke database lokal. Endpoint ini dibuat khusus untuk migrasi SEKALI jalan.

import { db, json, requireAdmin } from "../_shared.ts";

// Tabel yang boleh diimpor, urut dari induk ke anak.
const IMPORT_TABLES = [
  "regions",
  "dermagas",
  "routes",
  "geofences",
  "officers",
  "officer_regions",
  "officer_dermagas",
  "tariffs",
  "trips",
  "vehicles",
  "trip_vehicles",
  "vehicle_plates",
  "region_tariffs",
  "plate_scans",
  "app_versions",
  "device_versions",
  "ota_bundles",
  "admin_credentials",
] as const;



const IMPORT_BUCKETS = ["trip-photos", "apks", "ota"] as const;



const CHUNK = 200;



function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// POST /admin/import Body: { "mode": "upsert" | "replace", "tables": { "<nama_tabel>": [ { ...baris } ] }, "files": { "<bucket>": { "<path>":…
export async function importData(req: Request): Promise<Response> {
  try {
    const ctx = await requireAdmin(req);
    if (!ctx) return json({ error: "Admin access required" }, 403);

    const body = await req.json().catch(() => null) as any;
    if (!body || typeof body !== "object") {
      return json({ error: "Body harus berupa objek JSON" }, 400);
    }

    const mode = body.mode === "replace" ? "replace" : "upsert";
    const tables = (body.tables ?? {}) as Record<string, unknown>;
    const files = (body.files ?? {}) as Record<string, Record<string, string>>;

    const unknownTables = Object.keys(tables).filter((name) => !(IMPORT_TABLES as readonly string[]).includes(name));
    if (unknownTables.length) {
      return json({ error: `Tabel tidak dikenal: ${unknownTables.join(", ")}` }, 400);
    }
    const unknownBuckets = Object.keys(files).filter((name) => !(IMPORT_BUCKETS as readonly string[]).includes(name));
    if (unknownBuckets.length) {
      return json({ error: `Bucket tidak dikenal: ${unknownBuckets.join(", ")}` }, 400);
    }

    const tableSummary: Record<string, number> = {};
    const fileSummary: Record<string, number> = {};

    // ── Tabel ──────────────────────────────────────────────────────────────── Penghapusan didahulukan untuk mode replace.
    if (mode === "replace") {
      for (const table of [...IMPORT_TABLES].reverse()) {
        if (!Array.isArray(tables[table])) continue;
        const { error } = await db.from(table).delete();
        if (error) throw new Error(`Pembersihan tabel ${table} gagal: ${error.message}`);
      }
    }

    for (const table of IMPORT_TABLES) {
      const rows = tables[table];
      if (!Array.isArray(rows)) continue;
      if (rows.length === 0) {
        tableSummary[table] = 0;
        continue;
      }
      for (const chunk of chunks(rows, CHUNK)) {
        const result = mode === "replace"
          ? await db.from(table).insert(chunk)
          : await db.from(table).upsert(chunk);
        if (result.error) {
          throw new Error(`Impor tabel ${table} gagal: ${result.error.message}`);
        }
      }
      tableSummary[table] = rows.length;
    }

    for (const bucket of IMPORT_BUCKETS) {
      const objects = files[bucket];
      if (!objects || typeof objects !== "object") continue;
      let written = 0;
      for (const [path, base64] of Object.entries(objects)) {
        const bytes = Uint8Array.from(atob(String(base64)), (c) => c.charCodeAt(0));
        const { error } = await db.storage.from(bucket).upload(path, bytes.buffer as ArrayBuffer, { upsert: true });
        if (error) throw new Error(`Unggah berkas ${bucket}/${path} gagal: ${error.message}`);
        written += 1;
      }
      fileSummary[bucket] = written;
    }

    return json({
      success: true,
      mode,
      tables: tableSummary,
      files: fileSummary,
    });
  } catch (error) {
    console.error("Import error:", error);
    const message = error instanceof Error ? error.message : String(error);
    return json({ error: "Impor gagal", message }, 500);
  }
}
