/**
 * Geofence service - sinkronisasi dari server.
 * Tidak ada sesi expired, auto-retry, fallback ke data lokal.
 */

import { api } from './api'

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
    return Array.isArray(parsed) ? parsed : []
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
  try { localStorage.removeItem(GPS_FIX_CACHE_KEY) } catch {}
}

// UUID helpers ────────────────────────────────────────────────────────────

export function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))
}

// ─── Geofence matching ─────────────────────────────────────────────────────────

export function pointIsForOtherDermaga(point: PartialGeofencePoint, dockId: string): boolean {
  if (!point.dermagaId) return false // Legacy = applies to all
  if (!isUuid(point.dermagaId)) return false // Legacy non-UUID = applies to all
  return point.dermagaId !== dockId
}

export function belongsTo(point: GeofencePoint, dockId: string | null): boolean {
  if (!dockId) return true
  if (!point.dermagaId) return true
  if (point.dermagaId === dockId) return true
  return !isUuid(point.dermagaId)
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
  const routeCodes = new Set(routes.map(r => r.code))
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
    const fallback = points.filter(p => p.enabled && p.allowedRoutes.length > 0)
    console.debug('[geofence] Fallback: ditampilkan', fallback.length, 'titik')
    return fallback
  }

  const filtered = points.filter(p => {
    if (!p.enabled) return false
    if (p.allowedRoutes.length === 0) return false
    // Minimal satu rute harus match
    const hasMatch = p.allowedRoutes.some(r => routeCodes.has(r))
    if (!hasMatch) {
      console.debug('[geofence] Titik difilter (route mismatch):', p.name, p.allowedRoutes)
    }
    return hasMatch
  })

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

function cacheGpsFix(fix: GpsFix) {
  _cachedFix = fix
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
    const result = await api.get<GeofenceRaw[]>('/geofences', 15000)
    console.debug('[geofence] /geofences response', { ok: result.ok, dataCount: result.data?.length })

    if (!result.ok) {
      return { ok: !!cached.length, count: cached.length, reason: 'network', error: result.error?.message }
    }
    if (!result.data?.length) {
      console.log('[geofence] Server mengirim array kosong, pakai cache')
      return { ok: true, count: cached.length, reason: cached.length ? 'ok' : 'empty' }
    }

    const points: GeofencePoint[] = []
    for (const g of result.data) {
      const p = mapGeofence(g)
      if (p) points.push(p)
    }

    saveGeofencePoints(points)
    const diag = buildDiagnosis(points)
    saveDiagnosis(diag)
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))

    try { window.dispatchEvent(new Event(GEOFENCE_UPDATED_EVENT)) } catch { /* ignore */ }

    console.log('[geofence] Synced', points.length, 'points, aktif:', points.filter(p => p.enabled).length)
    return { ok: true, count: points.length, reason: 'ok' }
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
    const result = await api.get<GeofenceRaw[]>('/geofences', 15000)
    console.debug('[geofence] /geofences response', { ok: result.ok, dataCount: result.data?.length })

    if (!result.ok) {
      return { ok: !!cached.length, count: cached.length, reason: 'network', error: result.error?.message }
    }
    if (!result.data?.length) {
      console.log('[geofence] Server kosong, pakai cache yang ada')
      return { ok: true, count: cached.length, reason: cached.length ? 'ok' : 'empty' }
    }

    const points: GeofencePoint[] = []
    for (const g of result.data) {
      const p = mapGeofence(g)
      if (p) points.push(p)
    }

    saveGeofencePoints(points)
    const diag = buildDiagnosis(points)
    saveDiagnosis(diag)
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))

    try { window.dispatchEvent(new Event(GEOFENCE_UPDATED_EVENT)) } catch { /* ignore */ }

    console.log('[geofence] Force sync BERHASIL:', points.length, 'points')
    return { ok: true, count: points.length, reason: 'ok' }
  } catch (e) {
    console.error('[geofence] Force sync error:', e)
    return { ok: false, count: cached.length, reason: 'network', error: String(e) }
  }
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
    name: g.location_name || g.name || 'Titik Geofence',
    latitude: lat,
    longitude: lon,
    radiusMeters: g.radius_meters || g.radiusMeters || 100,
    allowedRoutes: Array.isArray(routes) ? routes.map(String).filter(Boolean) : [],
    dermagaId: g.dermaga_id || g.dermagaId,
    enabled: g.enabled !== false && g.enabled !== undefined,
    strictEnforceOutsideArea: true,
  }
}

// ─── Diagnosis ─────────────────────────────────────────────────────────────────

function buildDiagnosis(points: GeofencePoint[]): GeofenceScopeDiagnosis {
  const routes = getStoredRoutes()
  const routeCodes = new Set(routes.map(r => r.code))

  const scoped = points.filter(p =>
    p.enabled && p.allowedRoutes.some(r => routeCodes.has(r))
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
  configMissing: boolean
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
  const pos = gpsPosition || cached
  if (!pos) {
    return { valid: false, activePoint: null, blocked: true, configMissing: false, reason: 'GPS tidak tersedia' }
  }

  const points = scopedGeofencePoints(getStoredGeofencePoints())

  if (points.length === 0) {
    return { valid: false, activePoint: null, blocked: true, configMissing: true }
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
      return { point: p, dist, inRange, dockMatch, score: (dockMatch ? 0 : 1) + dist }
    })
    .filter(s => s.inRange)
    .sort((a, b) => a.score - b.score)

  if (scored.length === 0) {
    return { valid: false, activePoint: null, blocked: true, configMissing: false }
  }

  return { valid: true, activePoint: scored[0].point, configMissing: false }
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
  if (!point.allowedRoutes.includes(routeCode)) {
    const allowed = point.allowedRoutes.join(', ')
    return {
      valid: false,
      blocked: true,
      activePoint: point,
      reason: `Rute ${routeCode} tidak diizinkan di titik ${point.name}. Rute yang diizinkan: ${allowed}`,
    }
  }

  return { valid: true, activePoint: point }
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
export function getCurrentPosition(): Promise<{ lat: number; lng: number; accuracy?: number } | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) {
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }
        cacheGpsFix({ latitude: fix.lat, longitude: fix.lng, accuracy: fix.accuracy, timestamp: Date.now() })
        resolve(fix)
      },
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    )
  })
}

// ─── Import helpers from api.ts ────────────────────────────────────────────────

function getStoredRoutes(): { code: string; from: string; to: string }[] {
  try {
    const raw = localStorage.getItem('trip.routes.v2')
    if (!raw) return []
    const map: Record<string, any[]> = JSON.parse(raw)
    const result: { code: string; from: string; to: string }[] = []
    for (const routes of Object.values(map)) {
      for (const r of routes) {
        result.push({
          code: `${r.route_from}-${r.route_to}`,
          from: r.route_from,
          to: r.route_to,
        })
      }
    }
    return result
  } catch { return [] }
}
