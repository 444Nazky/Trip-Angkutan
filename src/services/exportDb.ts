import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { dbAll, localDbBackend } from './localDb'

/**
 * Ekspor database lokal perangkat.
 *
 * Isinya: trip, antrean kirim, dokumen pembatalan, petugas, dan master data
 * penting dalam rentang 40 hari terakhir. Kredensial (PIN/token/password)
 * sengaja TIDAK ikut diekspor.
 */
export const EXPORT_WINDOW_DAYS = 40
const EXPORT_WINDOW_MS = EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1000

/** Kunci localStorage yang dianggap data penting untuk ekspor. */
const IMPORTANT_KEYS = [
  'trip.officers.v1',
  'trip.auth.officer.v1',
  'trip.officer.v2',
  'trip.regions.v1',
  'trip.auth.routes.v1',
  'trip.routes.v2',
  'trip.tariffs.v1',
  'trip.vehicleTypes.v1',
  'trip.master.offline.v1',
  'trip.geofence.points',
  'trip.dermaga',
  'trip.dermaga.all',
  'trip.appSettings.v1',
  'trip.api.baseUrl',
  'trip.server.profile.v1',
  'trip.seq.v1',
]

export interface LocalDatabaseExport {
  app: string
  format: number
  exportedAt: string
  windowDays: number
  windowStart: string
  backend: 'indexeddb' | 'localStorage'
  counts: {
    trips: number
    pendingTrips: number
    pendingCancels: number
    officers: number
    meta: number
  }
  trips: unknown[]
  pendingTrips: unknown[]
  pendingCancels: unknown[]
  officers: unknown
  meta: unknown[]
  data: Record<string, unknown>
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

function tripTime(trip: unknown): number {
  if (!trip || typeof trip !== 'object') return 0
  const t = trip as Record<string, unknown>
  return parseTime(t['completedAt'])
    || parseTime(t['startedAt'])
    || parseTime(t['updatedAt'])
    || parseTime(t['date'])
}

function queueTime(item: unknown): number {
  if (!item || typeof item !== 'object') return 0
  const row = item as Record<string, unknown>
  return parseTime(row['createdAt'])
    || parseTime(row['cancelledAt'])
    || tripTime(row['trip'])
}

function withinWindow(ts: number, cutoff: number): boolean {
  // Data tanpa tanggal tetap diekspor supaya tidak hilang.
  return !ts || ts >= cutoff
}

function readLocalValue(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return undefined
    try { return JSON.parse(raw) } catch { return raw }
  } catch {
    return undefined
  }
}

function collectImportantData(): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  if (typeof localStorage === 'undefined') return data
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key) continue
      const important = IMPORTANT_KEYS.includes(key) || key.startsWith('trip.dermaga.officers.')
      if (!important) continue
      const value = readLocalValue(key)
      if (value !== undefined) data[key] = value
    }
  } catch { /* localStorage tidak tersedia */ }
  return data
}

export async function buildLocalDatabaseExport(now: number = Date.now()): Promise<LocalDatabaseExport> {
  const cutoff = now - EXPORT_WINDOW_MS
  const [allTrips, allPending, allCancels, allMeta] = await Promise.all([
    dbAll<Record<string, unknown>>('trips'),
    dbAll<Record<string, unknown>>('pending'),
    dbAll<Record<string, unknown>>('pending-cancel'),
    dbAll<Record<string, unknown>>('meta'),
  ])

  const trips = allTrips.filter(t => withinWindow(tripTime(t), cutoff))
  const pendingTrips = allPending.filter(t => withinWindow(queueTime(t), cutoff))
  const pendingCancels = allCancels.filter(t => withinWindow(queueTime(t), cutoff))
  const data = collectImportantData()
  const officers = data['trip.officers.v1'] ?? []

  return {
    app: 'Trip Angkutan',
    format: 1,
    exportedAt: new Date(now).toISOString(),
    windowDays: EXPORT_WINDOW_DAYS,
    windowStart: new Date(cutoff).toISOString(),
    backend: localDbBackend(),
    counts: {
      trips: trips.length,
      pendingTrips: pendingTrips.length,
      pendingCancels: pendingCancels.length,
      officers: Array.isArray(officers) ? officers.length : 0,
      meta: allMeta.length,
    },
    trips,
    pendingTrips,
    pendingCancels,
    officers,
    meta: allMeta,
    data,
  }
}

function exportFilename(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `trip-angkutan-db-${stamp}.json`
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
    const json = JSON.stringify(payload, null, 2)

    if (!Capacitor.isNativePlatform()) {
      return downloadInBrowser(filename, json)
    }

    let lastError = ''
    for (const directory of [Directory.Documents, Directory.External, Directory.Cache]) {
      try {
        const res = await Filesystem.writeFile({
          path: filename,
          data: json,
          directory,
          encoding: Encoding.UTF8,
          recursive: true,
        })
        return { ok: true, filename, size: json.length, mode: 'file', path: res.uri }
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
      }
    }

    return {
      ok: false,
      filename,
      size: json.length,
      message: `Gagal menyimpan berkas ekspor: ${lastError || 'penyimpanan tidak tersedia'}`,
    }
  } catch (err) {
    return {
      ok: false,
      filename,
      size: 0,
      message: err instanceof Error ? err.message : 'Gagal membuat ekspor database',
    }
  }
}
