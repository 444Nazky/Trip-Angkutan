/**
 * Geofence service - sinkronisasi dari server.
 * Tidak ada sesi expired, auto-retry, fallback ke data lokal.
 */

import { api } from './api'
import { getStoredDermaga, getStoredOfficer, getStoredRoutes } from './auth'
import { Geolocation } from '@capacitor/geolocation'

export const GEOFENCE_UPDATED_EVENT = 'trip:geofence-updated'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GeofencePoint {
  id: string
  name: string
  latitude: number
  longitude: number
  radiusMeters: number
  allowedRoutes: string[]
  dermagaId?: string | null
  enabled: boolean
  strictEnforceOutsideArea?: boolean
}

// Partial point for testing
export interface PartialGeofencePoint {
  id?: string
  name?: string
  latitude?: number
  longitude?: number
  radiusMeters?: number
  allowedRoutes?: string[]
  dermagaId?: string | null
  enabled?: boolean
  strictEnforceOutsideArea?: boolean
}

export interface GeofenceScopeDiagnosis {
  received: number
  active: number
  scoped: number
  assignedCodes: string[]
  hasUnassigned: boolean
}

/**
 * Normalisasi kode rute agar data admin dan data petugas selalu bisa
 * dibandingkan: "SBDZ→SJRE", "SBDZ - SJRE", "sbdz-sjre" => "SBDZ-SJRE".
 *
 * Dulu perbandingan memakai string mentah, sehingga titik geofence yang
 * di-set admin dengan format panah/tanpa spasi tidak pernah cocok dengan rute
 * petugas — akibatnya aplikasi menganggap "tidak ada titik lokasi" walau
 * konfigurasinya benar (terutama pada endpoint intranet yang datanya lebih
 * baru). Normalisasi ini dipakai di SEMUA jalur (sync, scope, validasi).
 */
export function normalizeRouteCode(code: string): string {
  return String(code ?? '')
    .toUpperCase()
    .trim()
    .replace(/→|->|>|–|—/g, '-')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '')
}

// ─── Storage keys ───────────────────────────────────────────────────────────────

const GEOFENCE_KEY = 'trip.geofence.points'
const GEOFENCE_DIAG_KEY = 'trip.geofence.diagnosis'
const GPS_FIX_CACHE_KEY = 'trip.geofence.gpsfix'
const LAST_SYNC_KEY = 'trip.geofence.lastSync'

// ─── Cached geofence storage ──────────────────────────────────────────────────

export function getStoredGeofencePoints(): GeofencePoint[] {
  try {
    const raw = localStorage.getItem(GEOFENCE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((point: PartialGeofencePoint & Record<string, unknown>) => ({
      id: String(point.id ?? ''),
      name: String(point.name ?? 'Titik Geofence'),
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      radiusMeters: Number(point.radiusMeters ?? point['radius_meters']) || 100,
      allowedRoutes: Array.isArray(point.allowedRoutes)
        ? point.allowedRoutes.map(String)
        : Array.isArray(point['allowedRouteCodes'])
          ? point['allowedRouteCodes'].map(String)
          : Array.isArray(point['allowed_route_codes'])
            ? point['allowed_route_codes'].map(String)
            : [],
      dermagaId: (point.dermagaId ?? null) as string | null,
      enabled: point.enabled !== false,
      strictEnforceOutsideArea: point.strictEnforceOutsideArea !== false,
    })).filter(point => point.id && Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
  } catch {
    return []
  }
}

export function saveGeofencePoints(points: GeofencePoint[]) {
  try {
    if (points.length) {
      localStorage.setItem(GEOFENCE_KEY, JSON.stringify(points))
    } else {
      localStorage.removeItem(GEOFENCE_KEY)
    }
  } catch {}
}

function saveDiagnosis(d: GeofenceScopeDiagnosis) {
  try { localStorage.setItem(GEOFENCE_DIAG_KEY, JSON.stringify(d)) } catch {}
}

export function getLastGeofenceDiagnosis(): GeofenceScopeDiagnosis | null {
  try {
    const raw = localStorage.getItem(GEOFENCE_DIAG_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function resetGpsFixCache() {
  _cachedFix = null
  try { localStorage.removeItem(GPS_FIX_CACHE_KEY) } catch {}
}

// UUID helpers ────────────────────────────────────────────────────────────

export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))
}

// ─── Geofence matching ─────────────────────────────────────────────────────────

export function pointIsForOtherDermaga(point: PartialGeofencePoint, dockId: string): boolean {
  if (!point.dermagaId) return false // Legacy = applies to all
  if (isUuid(point.dermagaId)) return point.dermagaId !== dockId
  if (/^[A-Z]+-D\d+$/i.test(point.dermagaId)) return false // ID warisan yang diketahui = shared
  return point.dermagaId !== dockId
}

export function belongsTo(point: GeofencePoint, dockId: string | null): boolean {
  if (!dockId) return true
  if (!point.dermagaId) return true
  if (point.dermagaId === dockId) return true
  return !isUuid(point.dermagaId) && /^[A-Z]+-D\d+$/i.test(point.dermagaId)
}

/**
 * Filter titik yang cocok dengan dermaga/rute petugas.
 *
 * LOGIKA:
 * - Jika routes tersimpan: filter geofence berdasarkan route codes yang diizinkan
 * - Jika routes KOSONG: tampilkan SEMUA geofence aktif (fallback untuk debugging)
 * - Titik dengan allowedRoutes kosong tidak pernah ditampilkan
 * - Titik dengan dermagaId yang tidak match akan difilter (ditangani di getActiveGeofenceSnapshot)
 */
export function scopedGeofencePoints(points: GeofencePoint[]): GeofencePoint[] {
  const routes = getStoredRoutes()
  const routeCodes = new Set(routes.map(r => normalizeRouteCode(r.code)))
  const assignedDockIds = new Set(routes.map(r => r.dermagaId).filter((id): id is string => !!id))
  const routeCount = routes.length

  console.debug('[geofence] scopedGeofencePoints:', {
    totalPoints: points.length,
    storedRoutes: routeCount,
    routeCodes: [...routeCodes],
  })

  // Fallback: jika tidak ada routes tersimpan, tampilkan semua titik aktif
  // Ini mencegah "Belum ada titik geofence" saat routes belum sync
  if (routeCount === 0) {
    console.debug('[geofence] Tidak ada routes tersimpan - menampilkan semua titik aktif')
    const fallback = points.filter(p => p.enabled)
    console.debug('[geofence] Fallback: ditampilkan', fallback.length, 'titik')
    return fallback
  }

  const active = points.filter(p => {
    if (!p.enabled) return false
    return !assignedDockIds.size || !p.dermagaId || !isUuid(p.dermagaId) || assignedDockIds.has(p.dermagaId)
  })
  const matching = active.filter(p => p.allowedRoutes.length === 0 || p.allowedRoutes.some(r => routeCodes.has(normalizeRouteCode(r))))
  // Jika route assignment dan kode dari master berbeda, jangan membuat layar
  // geofence kosong total. Validasi trip tetap membatasi rute saat dipilih.
  const filtered = matching.length ? matching : active

  console.debug('[geofence] scopedGeofencePoints hasil:', {
    input: points.length,
    output: filtered.length,
  })

  return filtered
}

// ─── Foreign route detection ───────────────────────────────────────────────────

export function foreignRouteCodesForPoint(point: GeofencePoint): string[] {
  const routes = getStoredRoutes()
  const localCodes = new Set(routes.map(r => r.code))
  return point.allowedRoutes.filter(r => !localCodes.has(r))
}

// ─── GPS fix ───────────────────────────────────────────────────────────────────

interface GpsFix {
  latitude: number
  longitude: number
  accuracy?: number
  timestamp: number
}

let _cachedFix: GpsFix | null = null

function getCachedGpsFix(): GpsFix | null {
  if (_cachedFix) return _cachedFix
  try {
    const raw = localStorage.getItem(GPS_FIX_CACHE_KEY)
    if (!raw) return null
    _cachedFix = JSON.parse(raw)
    return _cachedFix
  } catch { return null }
}

let _gpsFixWrittenAt = 0

function cacheGpsFix(fix: GpsFix) {
  _cachedFix = fix
  // ponytail: GPS watch bisa update tiap beberapa detik. Menulis ke
  // localStorage tiap update bikin jank; tulis ke storage paling sering
  // setiap 10 detik (cache di memori tetap real-time).
  if (Date.now() - _gpsFixWrittenAt < 10_000) return
  _gpsFixWrittenAt = Date.now()
  try { localStorage.setItem(GPS_FIX_CACHE_KEY, JSON.stringify(fix)) } catch {}
}

// ─── Distance calculation ───────────────────────────────────────────────────────

function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

// ─── Sync from server ──────────────────────────────────────────────────────────

export interface SyncResult {
  ok: boolean
  count: number
  reason?: 'ok' | 'empty' | 'unauthorized' | 'network' | 'cached'
  error?: string
}

export async function syncFromServer(): Promise<SyncResult> {
  const cached = getStoredGeofencePoints()
  console.debug('[geofence] syncFromServer mulai', { cachedCount: cached.length, isAuthenticated: api.isAuthenticated })

  if (!api.isAuthenticated) {
    console.log('[geofence] No auth, using cache:', cached.length)
    // Jika tidak authenticated tapi ada cached, coba renew session dulu
    // Ini akan dipanggil dari luar untuk retry auth
    return { ok: !!cached.length, count: cached.length, reason: cached.length ? 'ok' : 'unauthorized' }
  }

  try {
    const rows = await fetchGeofenceRows()
    if (!rows.ok) {
      return { ok: false, count: cached.length, reason: rows.reason, error: rows.error }
    }
    if (!rows.data.length) {
      console.log('[geofence] Server mengirim array kosong, pakai cache')
      return { ok: true, count: cached.length, reason: 'empty' }
    }

    return saveSyncedRows(rows.data, cached)
  } catch (e) {
    console.error('[geofence] Sync error:', e)
    return { ok: false, count: cached.length, reason: 'network', error: String(e) }
  }
}

export interface ForceSyncResult {
  ok: boolean
  count: number
  reason?: 'ok' | 'empty' | 'unauthorized' | 'network'
  error?: string
}

/**
 * Force sync = tanpa throttle, untuk refresh manual.
 */
export async function forceSyncGeofencesFromBackend(): Promise<ForceSyncResult> {
  const cached = getStoredGeofencePoints()
  console.debug('[geofence] forceSyncGeofencesFromBackend mulai', { cachedCount: cached.length, isAuthenticated: api.isAuthenticated })

  if (!api.isAuthenticated) {
    console.log('[geofence] No auth, returning unauthorized (bukan empty) untuk trigger retry')
    return { ok: !!cached.length, count: cached.length, reason: cached.length ? 'ok' : 'unauthorized' }
  }

  try {
    const rows = await fetchGeofenceRows()
    if (!rows.ok) {
      return { ok: false, count: cached.length, reason: rows.reason, error: rows.error }
    }
    if (!rows.data.length) {
      console.log('[geofence] Server kosong, pakai cache yang ada')
      return { ok: true, count: cached.length, reason: 'empty' }
    }

    const saved = saveSyncedRows(rows.data, cached)
    return { ...saved, reason: saved.reason === 'cached' ? 'ok' : saved.reason }
  } catch (e) {
    console.error('[geofence] Force sync error:', e)
    return { ok: false, count: cached.length, reason: 'network', error: String(e) }
  }
}

type FetchRowsResult = { ok: true; data: GeofenceRaw[] } | { ok: false; reason: 'unauthorized' | 'network'; error?: string }

async function fetchGeofenceRows(): Promise<FetchRowsResult> {
  const officer = getStoredOfficer()
  const accessibleIds = new Set<string>([
    ...(officer?.dermagaAccess ?? []).map(d => d.id).filter(Boolean),
    ...getStoredRoutes().map(route => route.dermagaId).filter((id): id is string => !!id),
  ])
  const selected = getStoredDermaga()?.id
  if (selected) accessibleIds.add(selected)

  const paths = accessibleIds.size
    ? [...accessibleIds].map(id => `/geofences?dermagaId=${encodeURIComponent(id)}`)
    : ['/geofences']
  const responses = await Promise.all(paths.map(path => api.get<GeofenceRaw[]>(path, 15000)))
  const failed = responses.find(response => !response.ok)
  if (failed) {
    const code = String(failed.error?.code ?? '')
    return {
      ok: false,
      reason: code === '401' || code === '403' || code.toLowerCase() === 'unauthorized' ? 'unauthorized' : 'network',
      error: failed.error?.message,
    }
  }

  const byId = new Map<string, GeofenceRaw>()
  for (const response of responses) {
    for (const row of response.data ?? []) {
      const id = String(row.id ?? '')
      if (id) byId.set(id, row)
    }
  }
  return { ok: true, data: [...byId.values()] }
}

function saveSyncedRows(rows: GeofenceRaw[], cached: GeofencePoint[]): SyncResult {
  const routes = getStoredRoutes()
  const routeCodes = new Set(routes.map(route => normalizeRouteCode(route.code)))
  const accessibleIds = new Set<string>([
    ...(getStoredOfficer()?.dermagaAccess ?? []).map(d => d.id).filter(Boolean),
    ...routes.map(route => route.dermagaId).filter((id): id is string => !!id),
  ])
  const selectedId = getStoredDermaga()?.id
  if (selectedId) accessibleIds.add(selectedId)

  const points = rows.map(mapGeofence).filter((point): point is GeofencePoint => !!point)
    .filter(point => point.enabled)
    .filter(point => {
      const source = rows.find(row => String(row.id) === point.id)
      const dermagaId = point.dermagaId || source?.dermaga_id || source?.dermagaId
      return !accessibleIds.size || !dermagaId || accessibleIds.has(dermagaId) || /^[A-Z]+-D\d+$/i.test(dermagaId)
    })
  const routeMatched = points.filter(point => point.allowedRoutes.length === 0 || point.allowedRoutes.some(code => routeCodes.has(normalizeRouteCode(code))))
  const scoped = routeMatched.length ? routeMatched : points

  if (!scoped.length) {
    return { ok: true, count: cached.length, reason: cached.length ? 'ok' : 'empty' }
  }

  const canonical = (items: GeofencePoint[]) => items.map(point => ({
    id: point.id,
    name: point.name,
    latitude: point.latitude,
    longitude: point.longitude,
    radiusMeters: point.radiusMeters,
    allowedRoutes: point.allowedRoutes,
    dermagaId: point.dermagaId ?? null,
    enabled: point.enabled,
  }))
  const oldSerialized = JSON.stringify(canonical(cached))
  const newSerialized = JSON.stringify(canonical(scoped))
  saveGeofencePoints(scoped)
  saveDiagnosis(buildDiagnosis(scoped))
  localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
  if (oldSerialized !== newSerialized) {
    try { window.dispatchEvent(new CustomEvent(GEOFENCE_UPDATED_EVENT, { detail: { count: scoped.length } })) } catch { /* ignore */ }
  }
  console.log('[geofence] Synced', scoped.length, 'points, aktif:', scoped.length)
  return { ok: true, count: scoped.length, reason: 'ok' }
}

export async function syncGeofencesFromBackend(opts?: { force?: boolean }): Promise<SyncResult> {
  console.debug('[geofence] syncGeofencesFromBackend', { force: opts?.force })
  if (opts?.force) {
    return forceSyncGeofencesFromBackend()
  }
  // Check throttle
  const lastSync = Number(localStorage.getItem(LAST_SYNC_KEY) || 0)
  const THROTTLE = 5 * 60 * 1000 // 5 minutes
  if (Date.now() - lastSync < THROTTLE && !opts?.force) {
    const cached = getStoredGeofencePoints()
    console.debug('[geofence] Throttled, pakai cache')
    return { ok: !!cached.length, count: cached.length, reason: 'cached' }
  }
  return syncFromServer()
}

// ─── Raw mapping ───────────────────────────────────────────────────────────────

interface GeofenceRaw {
  id: string
  name?: string
  locationName?: string
  location_name?: string
  latitude: number
  longitude: number
  radius_meters?: number
  radiusMeters?: number
  allowed_routes?: string[]
  allowedRoutes?: string[]
  allowed_route_codes?: string[]
  allowedRouteCodes?: string[]
  dermaga_id?: string
  dermagaId?: string
  enabled?: boolean
}

function mapGeofence(g: GeofenceRaw): GeofencePoint | null {
  const lat = Number(g.latitude)
  const lon = Number(g.longitude)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const routes = g.allowed_routes || g.allowedRoutes || g.allowed_route_codes || g.allowedRouteCodes || []
  return {
    id: String(g.id),
    name: g.locationName || g.location_name || g.name || 'Titik Geofence',
    latitude: lat,
    longitude: lon,
    radiusMeters: Number(g.radius_meters ?? g.radiusMeters) || 100,
    allowedRoutes: Array.isArray(routes) ? routes.map(String).filter(Boolean) : [],
      dermagaId: g.dermaga_id || g.dermagaId || null,
    enabled: g.enabled === undefined || g.enabled === null || g.enabled !== false,
    strictEnforceOutsideArea: true,
  }
}

// ─── Diagnosis ─────────────────────────────────────────────────────────────────

function buildDiagnosis(points: GeofencePoint[]): GeofenceScopeDiagnosis {
  const routes = getStoredRoutes()
  const routeCodes = new Set(routes.map(r => normalizeRouteCode(r.code)))

  const scoped = points.filter(p =>
    p.enabled && (p.allowedRoutes.length === 0 || p.allowedRoutes.some(r => routeCodes.has(normalizeRouteCode(r))))
  )

  return {
    received: points.length,
    active: points.filter(p => p.enabled).length,
    scoped: scoped.length,
    assignedCodes: [...routeCodes],
    hasUnassigned: scoped.length === 0 && points.length > 0,
  }
}

// ─── Active geofence snapshot ─────────────────────────────────────────────────

export interface ActiveSnapshot {
  valid: boolean
  activePoint: GeofencePoint | null
  blocked?: boolean
  configMissing?: boolean
  reason?: string
}

/**
 * Dapatkan titik geofence aktif berdasarkan lokasi GPS saat ini.
 * Kalau dockId disediakan → hanya titik milik dermaga tsb.
 */
export async function getActiveGeofenceSnapshot(
  gpsPosition?: { latitude: number; longitude: number },
  dockId?: string | null
): Promise<ActiveSnapshot> {
  const cached = getCachedGpsFix()
  let points = scopedGeofencePoints(getStoredGeofencePoints())

  if (dockId) {
    const exactDock = points.filter(point => point.dermagaId === dockId)
    const shared = points.filter(point => !point.dermagaId || !isUuid(point.dermagaId))
    points = exactDock.length ? [...exactDock, ...shared] : shared
  }

  if (points.length === 0) {
    return { valid: false, activePoint: null, blocked: true, configMissing: true }
  }

  const freshPosition = gpsPosition ?? (cached
    ? undefined
    : await getCurrentPosition().then(fix => fix ? { latitude: fix.lat, longitude: fix.lng } : undefined))
  const pos = freshPosition || cached
  if (!pos) {
    return { valid: false, activePoint: null, blocked: true, reason: 'GPS tidak tersedia' }
  }

  // Urutkan: dermaga match duluan, lalu jarak terdekat
  const scored = points
    .map(p => {
      const dist = haversineDistance(pos.latitude, pos.longitude, p.latitude, p.longitude)
      const inRange = dist <= p.radiusMeters
      let dockMatch = true
      if (dockId) {
        // Legacy IDs (non-UUID) selalu match
        dockMatch = !p.dermagaId || !isUuid(p.dermagaId) || p.dermagaId === dockId
      }
      const dockPriority = !dockId || dockMatch ? 0 : (p.dermagaId && isUuid(p.dermagaId) ? 2 : 1)
      return { point: p, dist, inRange, dockMatch, dockPriority }
    })
    .filter(s => s.inRange)
    .sort((a, b) => a.dockPriority - b.dockPriority || a.dist - b.dist)

  if (scored.length === 0) {
    return { valid: false, activePoint: null, blocked: true }
  }

  return { valid: true, activePoint: scored[0].point }
}

// ─── Purge ─────────────────────────────────────────────────────────────────────

export function purgeGeofenceCache(): void {
  try {
    localStorage.removeItem(GEOFENCE_KEY)
    localStorage.removeItem(GEOFENCE_DIAG_KEY)
    localStorage.removeItem(LAST_SYNC_KEY)
  } catch {}
}

// ─── Validation ────────────────────────────────────────────────────────────────

export interface RouteValidationResult {
  valid: boolean
  blocked?: boolean
  configMissing?: boolean
  activePoint?: GeofencePoint | null
  reason?: string
}

/**
 * Validasi apakah rute tertentu bisa dipakai di lokasi petugas saat ini.
 */
export async function validateRouteForCurrentLocation(
  routeCode: string,
  gpsPosition?: { latitude: number; longitude: number },
  dockId?: string | null
): Promise<RouteValidationResult> {
  const snap = await getActiveGeofenceSnapshot(gpsPosition, dockId)

  if (snap.configMissing) {
    return { valid: false, blocked: true, configMissing: true }
  }

  if (!snap.valid || !snap.activePoint) {
    return { valid: false, blocked: true, activePoint: null }
  }

  const point = snap.activePoint

  // Normalisasi kode rute (hyphen/arrow/spasi) — satu aturan untuk semua jalur.
  const normalizedRouteCode = normalizeRouteCode(routeCode)
  const normalizedAllowed = point.allowedRoutes.map(normalizeRouteCode)

  // Check direct match
  const directMatch = normalizedAllowed.includes(normalizedRouteCode)

  // Check reverse direction match (e.g., "SBDZ-SJRE" matches "SJRE-SBDZ" for round-trip routes)
  const reverseCode = normalizedRouteCode.split('-').reverse().join('-')
  const reverseMatch = normalizedAllowed.includes(reverseCode)

  // Debug logging for troubleshooting
  console.debug('[geofence] Route validation:', {
    requestedCode: routeCode,
    normalizedCode: normalizedRouteCode,
    reverseCode,
    allowedCodes: point.allowedRoutes,
    normalizedAllowed,
    directMatch,
    reverseMatch,
    pointName: point.name,
  })

  if (directMatch || reverseMatch) {
    return { valid: true, activePoint: point }
  }

  const allowed = point.allowedRoutes.join(', ')
  return {
    valid: false,
    blocked: true,
    activePoint: point,
    reason: `Rute ${routeCode} tidak diizinkan di titik ${point.name}. Rute yang diizinkan: ${allowed}`,
  }
}

// ─── Validation helpers ──────────────────────────────────────────────────

/**
 * Validasi apakah data titik geofence valid.
 */
export function isValidGeofencePoint(p: GeofencePoint): string[] {
  const errors: string[] = []
  if (!p.name.trim()) errors.push('Nama lokasi wajib diisi')
  if (!Number.isFinite(p.latitude) || Math.abs(p.latitude) > 90) errors.push('Latitude tidak valid')
  if (!Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) errors.push('Longitude tidak valid')
  if (!Number.isFinite(p.radiusMeters) || p.radiusMeters <= 0) errors.push('Radius harus > 0')
  return errors
}

// ─── GPS location ─────────────────────────────────────────────────────────────

/**
 * Coba dapat posisi GPS dari browser/device.
 * Mengembalikan null pada kegagalan (bukan throw).
 */
/**
 * Ambil posisi GPS.
 *
 * Mengembalikan null hanya kalau benar-benar TIDAK ADA posisi yang bisa
 * dipakai - termasuk posisi lama (stale) yang masih dipakai sebagai
 * cadangan. Field `stale` menandai bahwa koordinat bukan fix terbaru.
 *
 * Timeout Android untuk GPS cold start sering lebih dari 8 detik, jadi
 * batas 8 detik guarantee kode 3 (Timeout expired) dan memblokir petugas
 * di layar "Pilih Rute".
 */
export interface GpsPosition {
  lat: number
  lng: number
  accuracy?: number
  /** true = koordinat berasal dari fix lama, bukan permintaan terbaru. */
  stale?: boolean
  /** Umur fix dalam milidetik (hanya kalau stale). */
  ageMs?: number
}

const GPS_CACHE_TTL = 30_000
/** Fix dianggap masih berguna sampai 10 menit. */
const STALE_FIX_MAX_AGE_MS = 10 * 60_000
/** Batas waktu permintaan GPS presisi tinggi (detik). */
const GPS_HIGH_ACCURACY_TIMEOUT = 15_000
/** Batas waktu permintaan GPS presisi rendah / jaringan (detik). */
const GPS_LOW_ACCURACY_TIMEOUT = 10_000

let pendingGpsRequest: Promise<GpsPosition | null> | null = null

// ponytail: GPS watch Keeping cache tetap hangat. Dengan watch, layar "Pilih
// Rute" hampir selalu punya fix instan (tidak menunggu 8-15 detik GPS cold
// start). Watch hanya hidup selama aplikasi aktif.
let _gpsWatchId: string | null = null

export function startGpsWatch(): void {
  if (_gpsWatchId) return
  try {
    void Geolocation.watchPosition(
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 3000 },
      (position: { coords?: { latitude: number; longitude: number; accuracy?: number } } | null) => {
        const c = position?.coords
        if (!c) return
        cacheGpsFix({
          latitude: c.latitude,
          longitude: c.longitude,
          accuracy: c.accuracy,
          timestamp: Date.now(),
        })
      },
    )
      .then(id => { _gpsWatchId = id })
      .catch(() => { _gpsWatchId = null })
  } catch { /* GPS tidak tersedia */ }
}

export function stopGpsWatch(): void {
  if (!_gpsWatchId) return
  try { void Geolocation.clearWatch({ id: _gpsWatchId }) } catch { /* ignore */ }
  _gpsWatchId = null
}

export function getCurrentPosition(options: { force?: boolean } = {}): Promise<GpsPosition | null> {
  const cached = getCachedGpsFix()
  if (!options.force && cached && Date.now() - cached.timestamp <= GPS_CACHE_TTL) {
    return Promise.resolve({ lat: cached.latitude, lng: cached.longitude, accuracy: cached.accuracy })
  }
  if (pendingGpsRequest) return pendingGpsRequest

  const requestFix = (highAccuracy: boolean) => Geolocation.getCurrentPosition({
    enableHighAccuracy: highAccuracy,
    // Batas 8 detik terlalu pendek untuk GPS cold start di Android - hasilnya
    // hampir selalu kode 3 (Timeout expired). 15 detik untuk fix presisi
    // tinggi, 10 detik untuk fix jaringan.
    timeout: highAccuracy ? GPS_HIGH_ACCURACY_TIMEOUT : GPS_LOW_ACCURACY_TIMEOUT,
    maximumAge: highAccuracy ? 15000 : 60000,
  })

  pendingGpsRequest = requestFix(true)
      // Timeout (code 3) = GPS tidak dapat fix; coba sekali pakai network fix.
      .catch(error => {
        if ((error as { code?: number } | null)?.code === 3) return requestFix(false)
        throw error
      })
      .then(position => {
        const fix = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          timestamp: Date.now(),
        }
        cacheGpsFix(fix)
        return { lat: fix.latitude, lng: fix.longitude, accuracy: fix.accuracy }
      })
      .catch(error => {
        console.warn('[geofence] Gagal mendapatkan GPS:', error)
        // Cadangan terakhir: pakai fix terakhir yang tersimpan, selama tidak
        // lebih tua dari 10 menit. Tanpa ini, satu kedipan sinyal GPS
        // (tunnel, atap kapal, basement) langsung memblokir petugas di layar
        // "Pilih Rute" dengan pesan "GPS tidak tersedia".
        const last = getCachedGpsFix()
        if (last) {
          const ageMs = Date.now() - last.timestamp
          if (ageMs <= STALE_FIX_MAX_AGE_MS) {
            console.warn('[geofence] Memakai posisi terakhir (umur', Math.round(ageMs / 1000), 'detik)')
            return {
              lat: last.latitude,
              lng: last.longitude,
              accuracy: last.accuracy,
              stale: true,
              ageMs,
            }
          }
        }
        return null
      })
      .finally(() => { pendingGpsRequest = null })

  return pendingGpsRequest
}
