/**
 * Migrasi data sekali jalan: Supabase cloud -> server intranet lokal.
 *
 * Menyalin SELURUH baris tabel operasional beserta berkas di bucket
 * trip-photos/ apks/ ota/ ke Postgres lokal (lewat PostgREST) dan ke
 * STORAGE_DIR di PC kantor. Jalankan SEKALI di PC kantor sebelum aplikasi
 * dipakai penuh di jaringan lokal.
 *
 * Prasyarat (sudah berjalan):
 *   - docker compose up -d db rest   (Postgres + PostgREST lokal)
 *   - schema.sql sudah dimuat otomatis oleh container db
 *
 * Jalankan:
 *   CLOUD_SUPABASE_URL=https://xxxx.supabase.co \
 *   CLOUD_SERVICE_ROLE_KEY=eyJ... \
 *   STORAGE_DIR=./data/storage \
 *   deno run -A scripts/migration/migrate-cloud-to-local.ts
 *
 * Opsi:
 *   DRY_RUN=1       hanya menampilkan jumlah baris/berkas, tidak menulis
 *   TABLES=a,b      batasi tabel yang disalin (default: semua)
 *   SKIP_STORAGE=1  lewati penyalinan berkas
 *
 * Kredensial cloud HANYA dibaca dari environment, tidak pernah ditulis ke
 * repo. UUID dipertahankan supaya relasi antar tabel tetap sah.
 */

const CLOUD_URL = (Deno.env.get("CLOUD_SUPABASE_URL") ?? "").replace(/\/+$/, "");
const CLOUD_KEY = Deno.env.get("CLOUD_SERVICE_ROLE_KEY") ?? "";
const LOCAL_REST = (Deno.env.get("POSTGREST_URL") ?? "http://127.0.0.1:3001").replace(/\/+$/, "");
const STORAGE_DIR = Deno.env.get("STORAGE_DIR") ?? "./data/storage";
const DRY_RUN = Deno.env.get("DRY_RUN") === "1";
const SKIP_STORAGE = Deno.env.get("SKIP_STORAGE") === "1";
const PAGE = 1000;

/** Urutan aman terhadap foreign key: induk dulu, anak kemudian. */
const TABLES = [
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
];

const BUCKETS = ["trip-photos", "apks", "ota"];

/** Kolom pengurut untuk paginasi; tabel tanpa `id` memakai kolom PK pertamanya. */
const ORDER: Record<string, string> = {
  officer_regions: "officer_id",
  officer_dermagas: "officer_id",
  device_versions: "device_id",
};

const only = Deno.env.get("TABLES")?.split(",").map((t) => t.trim()).filter(Boolean);
const tables = only?.length ? TABLES.filter((t) => only.includes(t)) : TABLES;

function cloudHeaders(extra: Record<string, string> = {}): HeadersInit {
  return {
    apikey: CLOUD_KEY,
    Authorization: `Bearer ${CLOUD_KEY}`,
    ...extra,
  };
}

async function cloudGet<T>(path: string): Promise<T> {
  const res = await fetch(`${CLOUD_URL}${path}`, { headers: cloudHeaders() });
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}: ${await res.text()}`);
  return await res.json() as T;
}

/** Ambil semua baris sebuah tabel, dipaginasi (PostgREST membatasi per request). */
async function pullTable(table: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const order = ORDER[table] ?? "id";
  for (let offset = 0;; offset += PAGE) {
    const batch = await cloudGet<Record<string, unknown>[]>(
      `/rest/v1/${table}?select=*&order=${order}&limit=${PAGE}&offset=${offset}`,
    );
    rows.push(...batch);
    if (batch.length < PAGE) return rows;
  }
}

/** Upsert ke PostgREST lokal; target konflik = primary key tabel. */
async function pushTable(table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  for (let i = 0; i < rows.length; i += PAGE) {
    const chunk = rows.slice(i, i + PAGE);
    const res = await fetch(`${LOCAL_REST}/${table}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(chunk),
    });
    if (!res.ok) throw new Error(`POST ${table} -> HTTP ${res.status}: ${await res.text()}`);
  }
}

interface StorageEntry {
  name: string;
  id: string | null;
  metadata: { size?: number } | null;
}

/** Daftar isi bucket (rekursif ke subfolder). */
async function listObjects(bucket: string, prefix = ""): Promise<string[]> {
  const res = await fetch(`${CLOUD_URL}/storage/v1/object/list/${bucket}`, {
    method: "POST",
    headers: cloudHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  });
  if (!res.ok) throw new Error(`LIST ${bucket}/${prefix} -> HTTP ${res.status}: ${await res.text()}`);
  const entries = await res.json() as StorageEntry[];
  const files: string[] = [];
  for (const entry of entries) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) files.push(...await listObjects(bucket, path));
    else files.push(path);
  }
  return files;
}

async function copyObject(bucket: string, path: string): Promise<void> {
  const res = await fetch(`${CLOUD_URL}/storage/v1/object/${bucket}/${path}`, {
    headers: cloudHeaders(),
  });
  if (!res.ok) throw new Error(`GET ${bucket}/${path} -> HTTP ${res.status}`);
  const target = `${STORAGE_DIR}/${bucket}/${path}`;
  await Deno.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
  await Deno.writeFile(target, new Uint8Array(await res.arrayBuffer()));
}

async function main(): Promise<void> {
  if (!CLOUD_URL || !CLOUD_KEY) {
    console.error("CLOUD_SUPABASE_URL dan CLOUD_SERVICE_ROLE_KEY wajib diisi.");
    Deno.exit(1);
  }
  console.log(`Sumber : ${CLOUD_URL}`);
  console.log(`Tujuan : ${LOCAL_REST} + ${STORAGE_DIR}${DRY_RUN ? " (DRY RUN)" : ""}`);

  for (const table of tables) {
    const rows = await pullTable(table);
    console.log(`  ${table}: ${rows.length} baris`);
    if (!DRY_RUN) await pushTable(table, rows);
  }

  if (SKIP_STORAGE) return;
  for (const bucket of BUCKETS) {
    const files = await listObjects(bucket);
    console.log(`  ${bucket}/: ${files.length} berkas`);
    if (DRY_RUN) continue;
    for (const path of files) await copyObject(bucket, path);
  }

  console.log(DRY_RUN ? "Selesai (tidak ada yang ditulis)." : "Migrasi selesai.");
}

if (import.meta.main) {
  await main().catch((err) => {
    console.error(`Gagal: ${err instanceof Error ? err.message : err}`);
    Deno.exit(1);
  });
}
