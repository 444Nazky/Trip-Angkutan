#!/usr/bin/env node
// import-to-intranet.mjs — migrasi data dari server lama ke server intranet.
//
// Menyalin SELURUH data operasional dan berkas dari server lama (Supabase
// cloud) ke server API intranet (http://192.168.1.123:3000/api).
//
// Yang dipindahkan:
//   - Tabel master    : regions, dermagas, routes, geofences, officers,
//                       officer_regions, officer_dermagas, vehicles, tariffs,
//                       vehicle_plates, region_tariffs.
//   - Tabel transaksi : trips, trip_vehicles, plate_scans.
//   - Tabel rilis     : app_versions, device_versions, ota_bundles,
//                       admin_credentials.
//   - Berkas          : seluruh isi bucket trip-photos/, apks/, dan ota/.
//
// ID (uuid) dari server lama dipertahankan supaya seluruh relasi antar tabel
// tetap sah. Path berkas di dalam database ditulis ulang menjadi path lokal
// relatif (`/files/<bucket>/<path>`) supaya tidak lagi menunjuk ke server
// lama.
//
// Pemakaian:
//   node scripts/migration/import-to-intranet.mjs \
//     --cloud-url=https://xxx.supabase.co \
//     --cloud-key=eyJ... \
//     --target=http://192.168.1.123:3000/api
//
// Nilai kredensial boleh dibaca dari environment (CLOUD_SUPABASE_URL,
// CLOUD_SERVICE_ROLE_KEY, TRIP_API_URL) sehingga tidak perlu ditulis di
// baris perintah. Kredensial server lama TIDAK pernah disimpan di repo.
//
// Opsi:
//   --mode=upsert|replace   upsert (bawaan) atau replace (isi ulang tabel)
//   --skip-files=1          lewati penyalinan berkas
//   --dry-run=1             hanya menampilkan jumlah baris, tidak menulis
//   --tables=a,b            batasi tabel yang disalin (default: semua)
//
// Server intranet harus sudah menjalankan versi terbaru API (endpoint
// POST /admin/import). Jalankan ./restart-all-ubuntu.sh di PC kantor dulu
// bila endpoint itu belum tersedia.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..', '..')

const args = process.argv.slice(2)
const argValue = (name) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
// Flag menerima dua bentuk: `--dry-run` dan `--dry-run=1`.
const hasFlag = (name) => args.some(a => a === `--${name}` || a === `--${name}=1` || a === `--${name}=true`)

/** Baca environment dari file .env.local server (tidak pernah dicetak). */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const envFile = readEnvFile(path.join(ROOT, 'server', 'api', '.env.local'))

const CLOUD_URL = (argValue('cloud-url') || process.env.CLOUD_SUPABASE_URL || envFile.SUPABASE_URL || '').replace(/\/+$/, '')
const CLOUD_KEY = argValue('cloud-key') || process.env.CLOUD_SERVICE_ROLE_KEY || envFile.SUPABASE_SERVICE_ROLE_KEY || ''
const TARGET = (argValue('target') || process.env.TRIP_API_URL || 'http://192.168.1.123:3000/api').replace(/\/+$/, '')
const MODE = argValue('mode') === 'replace' ? 'replace' : 'upsert'
const DRY_RUN = hasFlag('dry-run')
const SKIP_FILES = hasFlag('skip-files')

/** Urutan aman terhadap foreign key: induk dulu, anak kemudian. */
const TABLES = [
  'regions',
  'dermagas',
  'routes',
  'geofences',
  'officers',
  'officer_regions',
  'officer_dermagas',
  'tariffs',
  'trips',
  'vehicles',
  'trip_vehicles',
  'vehicle_plates',
  'region_tariffs',
  'plate_scans',
  'app_versions',
  'device_versions',
  'ota_bundles',
  'admin_credentials',
]

const BUCKETS = ['trip-photos', 'apks', 'ota']

/** Kolom yang menyimpan path berkas, per tabel. */
const FILE_COLUMNS = {
  trips: ['foto_kosong_path', 'selfie_path'],
  trip_vehicles: ['foto_path'],
  app_versions: ['download_url'],
}

const ORDER = {
  officer_regions: 'officer_id',
  officer_dermagas: 'officer_id',
  device_versions: 'device_id',
}

const only = argValue('tables')?.split(',').map(t => t.trim()).filter(Boolean)
const tables = only?.length ? TABLES.filter(t => only.includes(t)) : TABLES

function cloudHeaders(extra = {}) {
  return {
    apikey: CLOUD_KEY,
    Authorization: `Bearer ${CLOUD_KEY}`,
    ...extra,
  }
}

/**
 * Ubah URL berkas server lama menjadi path lokal relatif.
 *
 * Pola yang ditangani:
 *   https://<host>/storage/v1/object/public/<bucket>/<path>
 *   /storage/v1/object/public/<bucket>/<path>
 */
function toLocalFilePath(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  const match = raw.match(/^(?:https?:\/\/[^/]+)?\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+)$/i)
  if (!match) return raw
  return `/files/${match[1]}/${match[2]}`
}

function rewriteFilePaths(table, rows) {
  const columns = FILE_COLUMNS[table]
  if (!columns) return 0
  let changed = 0
  for (const row of rows) {
    for (const column of columns) {
      const local = toLocalFilePath(row[column])
      if (local !== null && local !== row[column]) {
        row[column] = local
        changed += 1
      }
    }
  }
  return changed
}

async function cloudGet(pathname) {
  const res = await fetch(`${CLOUD_URL}${pathname}`, { headers: cloudHeaders() })
  if (!res.ok) throw new Error(`GET ${pathname} -> HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

async function pullTable(table) {
  const rows = []
  const order = ORDER[table] || 'id'
  const page = 1000
  for (let offset = 0; ; offset += page) {
    const batch = await cloudGet(`/rest/v1/${table}?select=*&order=${order}&limit=${page}&offset=${offset}`)
    rows.push(...batch)
    if (batch.length < page) return rows
  }
}

async function listObjects(bucket, prefix = '') {
  const res = await fetch(`${CLOUD_URL}/storage/v1/object/list/${bucket}`, {
    method: 'POST',
    headers: cloudHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prefix, limit: 1000, offset: 0 }),
  })
  if (!res.ok) throw new Error(`LIST ${bucket}/${prefix} -> HTTP ${res.status}: ${await res.text()}`)
  const entries = await res.json()
  const files = []
  for (const entry of entries) {
    const objectPath = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.id === null) files.push(...await listObjects(bucket, objectPath))
    else files.push(objectPath)
  }
  return files
}

async function fetchObject(bucket, objectPath) {
  const res = await fetch(`${CLOUD_URL}/storage/v1/object/${bucket}/${objectPath}`, { headers: cloudHeaders() })
  if (!res.ok) throw new Error(`GET ${bucket}/${objectPath} -> HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function postImport(payload) {
  const res = await fetch(`${TARGET}/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    throw new Error(`POST /admin/import -> HTTP ${res.status}: ${body?.message || body?.error || 'tanpa pesan'}`)
  }
  return body
}

async function main() {
  if (!CLOUD_URL || !CLOUD_KEY) {
    console.error('Kredensial server lama wajib diisi.')
    console.error('Isi CLOUD_SUPABASE_URL dan CLOUD_SERVICE_ROLE_KEY, atau beri --cloud-url dan --cloud-key.')
    console.error('Alternatif: file server/api/.env.local sudah dibaca otomatis oleh script ini.')
    process.exit(1)
  }

  console.log(`Sumber   : ${CLOUD_URL}`)
  console.log(`Tujuan   : ${TARGET}/admin/import`)
  console.log(`Mode     : ${MODE}${DRY_RUN ? ' (DRY RUN - tidak ada yang ditulis)' : ''}`)
  console.log('')

  // 1. Kumpulkan seluruh tabel.
  const payload = { mode: MODE, tables: {}, files: {} }
  for (const table of tables) {
    const rows = await pullTable(table)
    const rewritten = rewriteFilePaths(table, rows)
    payload.tables[table] = rows
    console.log(`  ${table}: ${rows.length} baris${rewritten ? ` (${rewritten} path berkas ditulis ulang)` : ''}`)
  }

  // 2. Kumpulkan berkas.
  if (!SKIP_FILES) {
    for (const bucket of BUCKETS) {
      const objects = await listObjects(bucket)
      const files = {}
      let bytes = 0
      for (const objectPath of objects) {
        const buffer = await fetchObject(bucket, objectPath)
        bytes += buffer.length
        files[objectPath] = buffer.toString('base64')
      }
      payload.files[bucket] = files
      console.log(`  ${bucket}/: ${objects.length} berkas (${(bytes / 1024 / 1024).toFixed(1)} MB)`)
    }
  }

  if (DRY_RUN) {
    console.log('')
    console.log('DRY RUN selesai. Tidak ada data yang dikirim.')
    return
  }

  // 3. Kirim ke server intranet, satu tabel per permintaan.
  //
  // Alasannya urutan tabel TIDAK bisa diserahkan ke server. Di antara
  // tabel ada ketergantungan dua arah: `vehicles.trip_id` menunjuk ke
  // `trips`, sementara `trip_vehicles` menunjuk ke keduanya. Server
  // menjalankan tabel dalam urutan miliknya sendiri, sehingga kalau
  // urutan server tidak sama dengan urutan di sini, permintaan gagal
  // dengan pelanggaran foreign key.
  //
  // Kirim per tabel membuat urutan yang benar menjamin penuh di sisi
  // script, tanpa menuntut server selalu punya versi terbaru.
  console.log('')
  console.log('Mengirim ke server intranet...')
  const totals = {}
  const fileTotals = {}
  for (const table of tables) {
    const rows = payload.tables[table] || []
    const result = await postImport({ mode: MODE, tables: { [table]: rows }, files: {} })
    totals[table] = result.tables?.[table] ?? rows.length
    console.log(`  ${table}: ${totals[table]} baris`)
  }
  for (const bucket of BUCKETS) {
    const files = payload.files[bucket]
    if (!files || Object.keys(files).length === 0) continue
    const result = await postImport({ mode: MODE, tables: {}, files: { [bucket]: files } })
    fileTotals[bucket] = result.files?.[bucket] ?? Object.keys(files).length
    console.log(`  ${bucket}/: ${fileTotals[bucket]} berkas`)
  }
  console.log('Selesai.')
  console.log(`  Mode    : ${MODE}`)
}

main().catch((error) => {
  console.error(`Gagal: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
