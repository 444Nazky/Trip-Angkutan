import JSZip from 'jszip'
import { Capacitor } from '@capacitor/core'
import { dbAll, localDbBackend } from './localDb'
import { canPickSaveLocation, saveBinaryWithPicker } from './saveFile'

/**
 * Ekspor data trip perangkat menjadi satu arsip ZIP:
 *
 *   export_trip_<NAMA_USER>_<TIMESTAMP>.zip
 *     ├── data_trip.json   → seluruh data trip tersinkron + referensi foto
 *     └── images/          → file foto fisik (dokumentasi, swafoto, bukti, kendaraan)
 *
 * Isinya HANYA trip yang sudah benar-benar terkirim dan tersinkron ke server
 * (`synced: true`), bukan antrean yang masih menunggu, draft, atau dokumen
 * pembatalan. Data diambil dari IndexedDB (lengkap dengan foto) dan digabung
 * dengan cache `trip.trips.v1` di localStorage supaya trip yang sudah
 * tersinkron tetap ikut walau penulisan IndexedDB sempat gagal.
 */
export const LOCAL_TRIPS_CACHE_KEY = 'trip.trips.v1'

/** Nama file JSON di dalam arsip. */
export const ARCHIVE_JSON_NAME = 'data_trip.json'
/** Folder foto di dalam arsip. */
export const ARCHIVE_IMAGE_DIR = 'images'

type TripRow = Record<string, unknown>

export interface ExportPhotoFile {
  /** Path di dalam arsip, mis. `images/TRP-1-dokumentasi.jpg`. */
  path: string
  bytes: Uint8Array
  mime: string
}

export interface LocalDatabaseExport {
  app: string
  kind: 'synced-trips'
  format: number
  exportedAt: string
  officer: { id: string; name: string }
  backend: 'indexeddb' | 'localStorage'
  counts: {
    trips: number
    photos: number
    withProof: number
    withDocumentation: number
  }
  trips: TripRow[]
}

export interface ExportResult {
  ok: boolean
  filename: string
  size: number
  mode?: 'download' | 'file'
  path?: string
  trips?: number
  photos?: number
  message?: string
}

export interface ExportOfficerProfile {
  id?: string
  name?: string
}

function parseTime(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const ts = Date.parse(value)
    return Number.isFinite(ts) ? ts : 0
  }
  return 0
}

function tripTime(trip: TripRow): number {
  return parseTime(trip['completedAt'])
    || parseTime(trip['startedAt'])
    || parseTime(trip['updatedAt'])
    || parseTime(trip['date'])
}

/**
 * Hanya trip final yang sudah diterima server. Trip yang sedang diantrekan
 * (`synced: false`), draft, dan pembatalan tidak boleh ikut.
 */
function isSyncedTrip(trip: TripRow): boolean {
  if (trip['canceled'] === true) return false
  const synced = trip['synced']
  return synced === true || synced === 1 || synced === 'true'
}

function tripId(trip: TripRow): string {
  return String(trip['id'] ?? '').trim()
}

function readCachedTrips(): TripRow[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(LOCAL_TRIPS_CACHE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((row): row is TripRow => !!row && typeof row === 'object') : []
  } catch {
    return []
  }
}

/** Foto yang benar-benar ada di data trip (bukan sekadar field kosong). */
function hasString(row: TripRow, key: string): boolean {
  const value = row[key]
  return typeof value === 'string' && value.trim().length > 0
}

/** Bagian id yang aman dipakai sebagai nama file di dalam arsip. */
function safeSegment(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
  return cleaned || 'trip'
}

/** Nama petugas untuk nama arsip: spasi jadi `_`, karakter aneh dibuang. */
export function archiveUserSegment(name: string): string {
  const cleaned = name.trim().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]+/g, '').replace(/^_+|_+$/g, '')
  return (cleaned || 'PETUGAS').toUpperCase()
}

/** Timestamp nama arsip: YYYYMMDD-HHMMSS (waktu lokal perangkat). */
export function archiveTimestamp(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

export function archiveFilename(officerName: string, now: number): string {
  return `export_trip_${archiveUserSegment(officerName)}_${archiveTimestamp(now)}.zip`
}

const MIME_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
}

/**
 * Ubah data URL foto menjadi byte siap ditulis ke folder `images/`.
 * Nilai yang bukan data URL (mis. URL server) dibiarkan sebagai referensi.
 */
function dataUrlBytes(value: unknown): { bytes: Uint8Array; mime: string } | null {
  if (typeof value !== 'string') return null
  const match = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(value)
  if (!match) return null
  try {
    const mime = (match[1] || 'image/jpeg').toLowerCase()
    if (match[2]) {
      const bin = atob(match[3].replace(/\s/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return { bytes, mime }
    }
    const text = decodeURIComponent(match[3])
    return { bytes: new TextEncoder().encode(text), mime }
  } catch {
    return null
  }
}

/**
 * Bangun payload JSON + kumpulan foto fisik yang akan dimasukkan ke arsip.
 *
 * Field foto pada JSON DIGANTI dengan path relatif di dalam arsip
 * (`images/...`) supaya file JSON tetap kecil dan setiap foto punya pasangan
 * file nyata yang bisa dipulihkan di dashboard admin.
 */
export async function buildLocalDatabaseExport(
  now: number = Date.now(),
  officer: ExportOfficerProfile = {},
): Promise<{ payload: LocalDatabaseExport; photos: ExportPhotoFile[] }> {
  // IndexedDB adalah sumber utama (menyimpan foto). Cache localStorage
  // menjadi cadangan metadata bila IndexedDB kosong/gagal ditulis.
  const stored = await dbAll<TripRow>('trips')
  const merged = new Map<string, TripRow>()
  for (const trip of stored) {
    const id = tripId(trip)
    if (id) merged.set(id, trip)
  }
  for (const trip of readCachedTrips()) {
    const id = tripId(trip)
    // Versi IndexedDB menang karena membawa foto; cache hanya mengisi trip
    // yang tidak ada di IndexedDB.
    if (id && !merged.has(id)) merged.set(id, trip)
  }

  // SELURUH trip tersinkron ikut diekspor — tanpa batas umur — supaya data
  // lama yang masih tersimpan di perangkat tidak hilang dari arsip.
  const trips = [...merged.values()]
    .filter(isSyncedTrip)
    .sort((a, b) => tripTime(b) - tripTime(a))

  const photos: ExportPhotoFile[] = []
  const exportedTrips: TripRow[] = []

  const addPhoto = (trip: TripRow, kind: string, value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value.trim()) return undefined
    const decoded = dataUrlBytes(value)
    // URL server / path yang sudah ada: simpan apa adanya, jangan dibuat
    // file palsu di dalam arsip.
    if (!decoded) return value
    const ext = MIME_EXT[decoded.mime] || '.jpg'
    const path = `${ARCHIVE_IMAGE_DIR}/${safeSegment(tripId(trip))}-${kind}${ext}`
    photos.push({ path, bytes: decoded.bytes, mime: decoded.mime })
    return path
  }

  for (const trip of trips) {
    const copy: TripRow = { ...trip }
    const documentation = addPhoto(trip, 'dokumentasi', trip['photoUrl'])
    const selfie = addPhoto(trip, 'swafoto', trip['selfieUrl'])
    const proof = addPhoto(trip, 'bukti', trip['proofUrl'])

    if (documentation) copy['photoUrl'] = documentation
    else delete copy['photoUrl']
    if (selfie) copy['selfieUrl'] = selfie
    else delete copy['selfieUrl']
    if (proof) copy['proofUrl'] = proof
    else delete copy['proofUrl']

    const vehicles = Array.isArray(trip['vehicles']) ? trip['vehicles'] : []
    copy['vehicles'] = vehicles.map((vehicle, index) => {
      if (!vehicle || typeof vehicle !== 'object') return vehicle
      const row = { ...(vehicle as TripRow) }
      const photo = addPhoto(trip, `kendaraan-${index + 1}`, row['photoUrl'])
      if (photo) row['photoUrl'] = photo
      else delete row['photoUrl']
      return row
    })

    exportedTrips.push(copy)
  }

  const payload: LocalDatabaseExport = {
    app: 'Trip Angkutan',
    kind: 'synced-trips',
    format: 3,
    exportedAt: new Date(now).toISOString(),
    officer: {
      id: String(officer.id ?? '').trim(),
      name: String(officer.name ?? '').trim(),
    },
    backend: localDbBackend(),
    counts: {
      trips: exportedTrips.length,
      photos: photos.length,
      withProof: exportedTrips.filter(t => hasString(t, 'proofUrl')).length,
      withDocumentation: exportedTrips.filter(t => hasString(t, 'photoUrl')).length,
    },
    trips: exportedTrips,
  }

  return { payload, photos }
}

/** Buat arsip ZIP berisi `data_trip.json` + folder `images/`. */
export async function buildTripArchive(
  now: number = Date.now(),
  officer: ExportOfficerProfile = {},
): Promise<{ bytes: Uint8Array; payload: LocalDatabaseExport; filename: string }> {
  const { payload, photos } = await buildLocalDatabaseExport(now, officer)
  const zip = new JSZip()
  zip.file(ARCHIVE_JSON_NAME, JSON.stringify(payload, null, 2))
  for (const photo of photos) zip.file(photo.path, photo.bytes)
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  })
  return {
    bytes,
    payload,
    filename: archiveFilename(payload.officer.name, now),
  }
}

/**
 * Potong byte menjadi potongan base64 yang VALID saat digabung.
 *
 * Panjang potongan kelipatan 3 byte supaya setiap potongan base64 berdiri
 * sendiri (tidak ada padding di tengah) dan hasil gabungannya tetap base64
 * yang sah untuk seluruh file.
 */
export function base64Chunks(bytes: Uint8Array, chunkBytes = 384 * 1024): string[] {
  const size = chunkBytes - (chunkBytes % 3)
  const chunks: string[] = []
  for (let start = 0; start < bytes.length; start += size) {
    const slice = bytes.subarray(start, Math.min(start + size, bytes.length))
    let bin = ''
    for (let i = 0; i < slice.length; i++) bin += String.fromCharCode(slice[i])
    chunks.push(btoa(bin))
  }
  return chunks
}

function downloadInBrowser(filename: string, bytes: Uint8Array): ExportResult {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { ok: true, filename, size: bytes.length, mode: 'download' }
}

/**
 * Ekspor data trip tersinkron menjadi arsip ZIP.
 *
 * Tidak pernah membuat arsip kosong: bila tidak ada trip tersinkron, proses
 * dibatalkan dengan pesan yang bisa dibaca petugas.
 */
export async function exportLocalDatabase(officer: ExportOfficerProfile = {}): Promise<ExportResult> {
  const now = Date.now()
  const filename = archiveFilename(officer.name ?? '', now)
  try {
    const { bytes, payload, filename: archiveName } = await buildTripArchive(now, officer)
    if (payload.counts.trips === 0) {
      return {
        ok: false,
        filename,
        size: 0,
        message: 'Belum ada trip tersinkron di perangkat ini. Kirim trip ke server terlebih dahulu.',
      }
    }
    if (!bytes.length) {
      return {
        ok: false,
        filename,
        size: 0,
        message: 'Arsip ekspor kosong. Coba ekspor ulang.',
      }
    }

    if (!Capacitor.isNativePlatform()) {
      return {
        ...downloadInBrowser(archiveName, bytes),
        trips: payload.counts.trips,
        photos: payload.counts.photos,
      }
    }

    if (!canPickSaveLocation()) {
      return {
        ok: false,
        filename,
        size: 0,
        message: 'Pemilih lokasi file hanya tersedia di aplikasi Android.',
      }
    }

    try {
      const saved = await saveBinaryWithPicker(archiveName, 'application/zip', base64Chunks(bytes))
      if (!saved.bytes) {
        return {
          ok: false,
          filename,
          size: 0,
          message: 'File ekspor kosong. Coba ekspor ulang dan pilih lokasi penyimpanan.',
        }
      }
      return {
        ok: true,
        filename: saved.name || archiveName,
        size: saved.bytes,
        mode: 'file',
        path: saved.uri,
        trips: payload.counts.trips,
        photos: payload.counts.photos,
      }
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err
        ? String((err as { code?: unknown }).code ?? '')
        : ''
      const message = err instanceof Error ? err.message : String(err)
      return {
        ok: false,
        filename,
        size: 0,
        message: code === 'CANCELLED'
          ? 'Ekspor dibatalkan.'
          : `Gagal menyimpan berkas ekspor: ${message || 'lokasi tidak tersedia'}`,
      }
    }
  } catch (err) {
    return {
      ok: false,
      filename,
      size: 0,
      message: err instanceof Error ? err.message : 'Gagal membuat ekspor data trip',
    }
  }
}
