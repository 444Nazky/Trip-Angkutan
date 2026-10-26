// Impor massal data dari server lama (Supabase/railway) ke database lokal.
//
// Endpoint ini dibuat khusus untuk migrasi SEKALI jalan. Endpoint CRUD biasa
// (/regions, /routes, dan seterusnya) tidak bisa dipakai untuk itu karena:
//   - kolom id dibuat oleh server, jadi relasi antar tabel (rute ke dermaga,
//     petugas ke region, trip ke kendaraan) tidak bisa dipertahankan;
//   - tabel master dan transaksi seperti vehicles, vehicle_plates,
//     plate_scans, dan trip_vehicles tidak punya endpoint tulis sama sekali.
//
// Yang dikirim: JSON berisi tabel (baris lengkap, id ikut disertakan) dan
// berkas (base64 per objek di bucket penyimpanan lokal).
//
// Urutan adalah urutan aman terhadap foreign key: induk lebih dulu, anak
// kemudian. Penghapusan memakai urutan terbalik.

import { db, json, requireAdmin } from "../_shared.ts";

/**
 * Tabel yang boleh diimpor, urut dari induk ke anak.
 *
 * Urutan WAJIB dipertahankan: baris pada tabel yang lebih dulu tidak boleh
 * disobuhi sebelum tabel yang merujuk padanya.
 */
const IMPORT_TABLES = [
  "regions",
  "dermagas",
  "routes",
  "geofences",
  "officers",
  "officer_regions",
  "officer_dermagas",
  "vehicles",
  "tariffs",
  "vehicle_plates",
  "region_tariffs",
  "trips",
  "trip_vehicles",
  "plate_scans",
  "app_versions",
  "device_versions",
  "ota_bundles",
  "admin_credentials",
] as const;

/** Bucket penyimpanan yang boleh diisi lewat impor. */
const IMPORT_BUCKETS = ["trip-photos", "apks", "ota"] as const;

/** Jumlah baris per permintaan INSERT. */
const CHUNK = 200;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * POST /admin/import
 *
 * Body:
 *   {
 *     "mode": "upsert" | "replace",
 *     "tables": { "<nama_tabel>": [ { ...baris } ] },
 *     "files":  { "<bucket>": { "<path>": "<base64>" } }
 *   }
 *
 * `mode`:
 *   upsert  (bawaan) - baris dengan id sama diperbarui, id baru ditambahkan.
 *   replace - isi tabel target dihapus dulu, lalu diisi ulang. Dipakai saat
 *             database lokal masih sisa migrasi sebelumnya.
 */
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

    // ── Tabel ────────────────────────────────────────────────────────────────
    //
    // Penghapusan didahulukan untuk mode replace. Urutan pembatalan adalah
    // kebalikan urutan impor, supaya anak dihapus lebih dulu dan tidak
    // melanggar foreign key.
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

    // ── Berkas ──────────────────────────────────────────────────────────────
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
