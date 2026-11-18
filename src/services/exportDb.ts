import { Capacitor } from '@capacitor/core'
import { dbAll, localDbBackend } from './localDb'
import { canPickSaveLocation, saveChunksWithPicker, splitChunk } from './saveFile'

/**
 * Ekspor data trip perangkat.
 *
 * Isinya HANYA trip yang sudah benar-benar terkirim dan tersinkron ke server
 * (`synced: true`), bukan antrean yang masih menunggu, draft, atau dokumen
 * pembatalan. Data diambil dari IndexedDB (lengkap dengan foto) dan
 * digabung dengan cache `trip.trips.v1` di localStorage supaya trip yang
 * sudah tersinkron tetap ikut walau penulisan IndexedDB sempat gagal.
 */
export const EXPORT_WINDOW_DAYS = 40
const EXPORT_WINDOW_MS = EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** Cache metadata trip di localStorage (lihat `LS.trips` di store). */
export const LOCAL_TRIPS_CACHE_KEY = 'trip.trips.v1'

type TripRow = Record<string, unknown>

export interface LocalDatabaseExport {
  app: string
  kind: 'synced-trips'
  format: number
  exportedAt: string
  windowDays: number
  windowStart: string
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
  message?: string
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

function withinWindow(ts: number, cutoff: number): boolean {
  // Data tanpa tanggal tetap diekspor supaya tidak hilang.
  return !ts || ts >= cutoff
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

function tripPhotos(trip: TripRow): string[] {
  const photos: string[] = []
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) photos.push(value)
  }
  push(trip['photoUrl'])
  push(trip['selfieUrl'])
  push(trip['proofUrl'])
  const vehicles = trip['vehicles']
  if (Array.isArray(vehicles)) {
    for (const vehicle of vehicles) {
      if (vehicle && typeof vehicle === 'object') push((vehicle as TripRow)['photoUrl'])
    }
  }
  return photos
}

export async function buildLocalDatabaseExport(now: number = Date.now()): Promise<LocalDatabaseExport> {
  const cutoff = now - EXPORT_WINDOW_MS
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

  const trips = [...merged.values()]
    .filter(trip => isSyncedTrip(trip) && withinWindow(tripTime(trip), cutoff))
    .sort((a, b) => tripTime(b) - tripTime(a))

  const photos = trips.flatMap(tripPhotos)
  return {
    app: 'Trip Angkutan',
    kind: 'synced-trips',
    format: 2,
    exportedAt: new Date(now).toISOString(),
    windowDays: EXPORT_WINDOW_DAYS,
    windowStart: new Date(cutoff).toISOString(),
    backend: localDbBackend(),
    counts: {
      trips: trips.length,
      photos: photos.length,
      withProof: trips.filter(t => hasString(t, 'proofUrl')).length,
      withDocumentation: trips.filter(t => hasString(t, 'photoUrl')).length,
    },
    trips,
  }
}

function exportFilename(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `trip-angkutan-data-trip-${stamp}.json`
}

/**
 * JSON dipecah per trip (lalu per potongan kecil) supaya tidak pernah ada satu
 * string raksasa di memori WebView maupun di jembatan native.
 */
function* exportJsonChunks(payload: LocalDatabaseExport): Generator<string> {
  const { trips, ...meta } = payload
  const head = JSON.stringify(meta)
  yield `${head.slice(0, -1)},"trips":[`
  for (let i = 0; i < trips.length; i++) {
    const raw = `${i > 0 ? ',' : ''}${JSON.stringify(trips[i])}`
    for (const part of splitChunk(raw)) yield part
  }
  yield ']}'
}

function downloadInBrowser(filename: string, json: string): ExportResult {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return { ok: true, filename, size: json.length, mode: 'download' }
}

export async function exportLocalDatabase(): Promise<ExportResult> {
  const now = Date.now()
  const filename = exportFilename(now)
  try {
    const payload = await buildLocalDatabaseExport(now)
    if (payload.counts.trips === 0) {
      return {
        ok: false,
        filename,
        size: 0,
        message: 'Belum ada trip tersinkron di perangkat ini. Kirim trip ke server terlebih dahulu.',
      }
    }

    // Di Android JSON tidak pernah dirakit utuh: langsung dialirkan ke file.
    if (!Capacitor.isNativePlatform()) {
      const json = JSON.stringify(payload, null, 2)
      return downloadInBrowser(filename, json)
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
      const saved = await saveChunksWithPicker(filename, exportJsonChunks(payload))
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
        filename: saved.name || filename,
        size: saved.bytes,
        mode: 'file',
        path: saved.uri,
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
