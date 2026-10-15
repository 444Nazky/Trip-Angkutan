import { Geolocation } from '@capacitor/geolocation'
import { api } from './api'
import { getStoredDermaga, getStoredOfficer, getStoredRoutes, renewSessionIfNeeded } from './auth'
import { isDevMode } from './runtimeEnv'




const DEV_MODE_FALLBACK_LAT = -6.1891005
const DEV_MODE_FALLBACK_LON = 106.8371641
const DEV_MODE_FALLBACK_ACCURACY = 5




function devMockLocationAllowed(): boolean {
  return isDevMode()
}




export interface GeofencePoint {
  id: string
  name: string
  dermagaId?: string
  latitude: number
  longitude: number
  radiusMeters: number
  allowedRoutes: string[]
  enabled: boolean
  strictEnforceOutsideArea?: boolean
}




export interface ValidationResult {
  valid: boolean
  blocked?: boolean
  reason?: string
  activePoint?: GeofencePoint
  distanceMeters?: number
  accuracyMeters?: number | null
  configMissing?: boolean
}

const GEOFENCE_STORAGE_KEY = 'trip.geofence.points'




const EARTH_RADIUS_METERS = 6371000




function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_METERS * c
}




export function getStoredGeofencePoints(): GeofencePoint[] {
  try {
    const raw = localStorage.getItem(GEOFENCE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeStoredPoint).filter((p): p is GeofencePoint => p !== null)
  } catch {
    return []
  }
}




function normalizeStoredPoint(value: unknown): GeofencePoint | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Partial<GeofencePoint>
  const latitude = Number(p.latitude)
  const longitude = Number(p.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  const radius = Number(p.radiusMeters)
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? 'Titik Geofence'),
    dermagaId: p.dermagaId,
    latitude,
    longitude,
    radiusMeters: Number.isFinite(radius) && radius > 0 ? radius : 100,
    allowedRoutes: toStringArray(p.allowedRoutes as string[] | string | undefined),
    enabled: p.enabled !== false,
    strictEnforceOutsideArea: p.strictEnforceOutsideArea !== false,
  }
}




export function saveGeofencePoints(points: GeofencePoint[]): void {
  try {
    localStorage.setItem(GEOFENCE_STORAGE_KEY, JSON.stringify(points))
  } catch {
    console.warn('[geofence] Gagal menyimpan konfigurasi geofence')
  }
}



// clear cache geofence - remove old data
export function purgeGeofenceCache(): void {
  try {
    localStorage.removeItem(GEOFENCE_STORAGE_KEY)
    localStorage.removeItem(GEOFENCE_SYNC_KEY)
  } catch { /* storage offline */ }
}




export function getDefaultGeofencePoints(): GeofencePoint[] {
  return []
}




export function isValidGeofencePoint(point: Partial<GeofencePoint>): string[] {
  const errors: string[] = []

  if (!point.id?.trim()) errors.push('ID titik geofence wajib diisi')
  if (typeof point.latitude !== 'number' || point.latitude < -90 || point.latitude > 90)
    errors.push('Latitude harus antara -90 dan 90')
  if (typeof point.longitude !== 'number' || point.longitude < -180 || point.longitude > 180)
    errors.push('Longitude harus antara -180 dan 180')
  if (typeof point.radiusMeters !== 'number' || point.radiusMeters < 10 || point.radiusMeters > 10000)
    errors.push('Radius harus antara 10m dan 10km')
  if (!Array.isArray(point.allowedRoutes) || point.allowedRoutes.length === 0)
    errors.push('Minimal satu rute harus diizinkan')

  return errors
}




async function requestGpsFix(): Promise<GpsFix | null> {

  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: GPS_TIMEOUT_MS,
      maximumAge: FIX_MAX_AGE_MS,
    })
    if (!pos?.coords) {
      console.warn('[geofence] GPS: coords null')
      if (devMockLocationAllowed()) {
        console.log('[geofence] GPS gagal → DEV MODE fallback ke Dermaga 1')
        return {
          lat: DEV_MODE_FALLBACK_LAT,
          lon: DEV_MODE_FALLBACK_LON,
          accuracy: DEV_MODE_FALLBACK_ACCURACY,
        }
      }
      return null
    }
    console.log(`[geofence] GPS real: ${pos.coords.latitude}, ${pos.coords.longitude} (±${pos.coords.accuracy}m)`)
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
    }
  } catch (err) {
    console.warn('[geofence] Gagal mendapatkan posisi GPS:', err)
    if (devMockLocationAllowed()) {
      console.log('[geofence] GPS error → DEV MODE fallback ke Dermaga 1')
      return {
        lat: DEV_MODE_FALLBACK_LAT,
        lon: DEV_MODE_FALLBACK_LON,
        accuracy: DEV_MODE_FALLBACK_ACCURACY,
      }
    }
    return null
  }
}




export interface GpsFix {
  lat: number
  lon: number
  accuracy?: number | null
}

const FIX_FRESH_MS = 12_000
const FIX_MAX_AGE_MS = 8_000
const GPS_TIMEOUT_MS = 10_000




let cachedFix: { value: GpsFix; at: number } | null = null
let inFlightFix: Promise<GpsFix | null> | null = null




export function resetGpsFixCache(): void {
  cachedFix = null
}




export async function getCurrentPosition(): Promise<GpsFix | null> {
  if (cachedFix && Date.now() - cachedFix.at < FIX_FRESH_MS) return cachedFix.value
  if (inFlightFix) return inFlightFix

  const pending = requestGpsFix()
    .then((fix) => {
      if (fix) cachedFix = { value: fix, at: Date.now() }
      return fix
    })
    .finally(() => { inFlightFix = null })

  inFlightFix = pending
  return pending
}




function findActiveGeofencePoint(
  position: { lat: number; lon: number },
  points: GeofencePoint[],
): GeofencePoint | null {
  for (const point of points) {
    if (!point.enabled) continue

    const distance = calculateDistance(
      position.lat,
      position.lon,
      point.latitude,
      point.longitude,
    )

    if (distance <= point.radiusMeters) {
      return point
    }
  }
  return null
}




export async function validateRouteForCurrentLocation(
  routeCode: string,
  points?: GeofencePoint[],
): Promise<ValidationResult> {
  const geofencePoints = points ?? getStoredGeofencePoints()
  const strict = geofencePoints.some(p => p.enabled !== false && p.strictEnforceOutsideArea !== false)

  if (geofencePoints.length === 0) {
    return {
      valid: false,
      blocked: true,
      configMissing: true,
      reason: 'Geofence belum dikonfigurasi admin (Master Rute) — input trip diblokir sampai titik lokasi didaftarkan',
    }
  }

  const anyEnabled = geofencePoints.some(p => p.enabled)
  if (!anyEnabled || geofencePoints.every(p => !p.enabled)) {
    return {
      valid: false,
      blocked: true,
      reason: 'Titik geofence dinonaktifkan admin — input trip diblokir',
    }
  }

  const position = await getCurrentPosition()

  if (!position) {
    return strict
      ? { valid: false, blocked: true, reason: 'GPS tidak tersedia atau izin lokasi ditolak — input trip diblokir' }
      : { valid: false, reason: 'Tidak dapat mendapatkan posisi GPS. Pastikan GPS aktif dan izin lokasi diberikan.' }
  }

  const isActiveStrict = geofencePoints.some(p => p.enabled && p.strictEnforceOutsideArea !== false)
  if (position.accuracy != null && position.accuracy > 100) {
    return isActiveStrict
      ? { valid: false, blocked: true, reason: `Akurasi GPS terlalu rendah (±${Math.round(position.accuracy)}m > 100m) — input trip diblokir`, accuracyMeters: position.accuracy }
      : { valid: false, reason: 'Akurasi GPS terlalu rendah. Buka area terbuka lalu coba lagi.', accuracyMeters: position.accuracy }
  }

  const activePoint = findActiveGeofencePoint(position, geofencePoints)

  if (!activePoint) {
    return isActiveStrict
      ? { valid: false, blocked: true, reason: 'Di luar Area Geofence Resmi — seluruh input trip diblokir', accuracyMeters: position.accuracy }
      : {
          valid: false,
          reason:
            'Anda tidak berada di lokasi yang diizinkan untuk input trip. Mendeteksi Anda di luar area dermaga yang terdaftar.',
        }
  }

  const activeDistance = calculateDistance(
    position.lat,
    position.lon,
    activePoint.latitude,
    activePoint.longitude,
  )

  if (!activePoint.allowedRoutes.includes(routeCode)) {
    const allowedList = activePoint.allowedRoutes.join(', ')
    return {
      valid: false,
      blocked: isActiveStrict,
      reason: `Rute ${routeCode} tidak diizinkan di lokasi ini (${activePoint.name}). Rute yang diperbolehkan: ${allowedList}`,
      activePoint,
      distanceMeters: activeDistance,
      accuracyMeters: position.accuracy,
    }
  }

  return {
    valid: true,
    activePoint,
    distanceMeters: activeDistance,
    accuracyMeters: position.accuracy,
  }
}

const GEOFENCE_SYNC_KEY = 'trip.geofence.lastSync'
const GEOFENCE_SYNC_INTERVAL = 15 * 60 * 1000

let inFlightSync: Promise<GeofenceSyncResult> | null = null
// ponytail: throttle global — satu 401 menahan sync otomatis 60 dtk, manual (force) tetap lolos
let lastUnauthorizedAt = 0
const UNAUTH_THROTTLE_MS = 60_000




export const GEOFENCE_UPDATED_EVENT = 'trip:geofence-updated'




export const GEOFENCE_AUTH_EXPIRED_EVENT = 'trip:geofence-auth-expired'




export interface GeofenceSyncResult {
  ok: boolean
  count: number
  reason: 'ok' | 'cached' | 'empty' | 'unauthorized' | 'network'
}




interface BackendGeofence {
  id: string
  locationName?: string
  name?: string
  latitude: number | string
  longitude: number | string
  radiusMeters?: number
  allowedRouteCodes?: string[] | string
  allowedRoutes?: string[]
  dermagaId?: string
  description?: string
  enabled?: boolean
  strictEnforceOutsideArea?: boolean
}




function toStringArray(v: string[] | string | undefined): string[] {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean)
  return []
}




function mapBackendToGeofence(g: BackendGeofence): GeofencePoint {
  return {
    id: String(g.id),
    name: String(g.locationName ?? g.name ?? 'Titik Geofence'),
    dermagaId: g.dermagaId,
    latitude: Number(g.latitude),
    longitude: Number(g.longitude),
    radiusMeters: Number(g.radiusMeters) > 0 ? Number(g.radiusMeters) : 100,
    allowedRoutes: toStringArray(g.allowedRouteCodes).length > 0
      ? toStringArray(g.allowedRouteCodes)
      : toStringArray(g.allowedRoutes),
    enabled: g.enabled !== false,
    strictEnforceOutsideArea: g.strictEnforceOutsideArea !== false,
  }
}




// kode rute yang jadi penugasan petugas di perangkat ini
function assignedRouteCodes(): Set<string> {
  const codes = new Set<string>()
  try {
    for (const route of getStoredRoutes()) {
      const code = String(route?.code ?? '').trim().toUpperCase()
      if (code) codes.add(code)
    }
  } catch { /* storage mati */ }
  return codes
}



// sisakan cuma titik aktif + yang masuk penugasan petugas.
// Titik TANPA kode rute (allowedRoutes kosong) = berlaku di semua rute, jadi
// JANGAN dibuang: dulu titik begini ikut ter-filter sehingga perangkat petugas
// berakhir dengan daftar kosong ("Belum ada titik geofence tersimpan") padahal
// admin sudah menyimpan titik di dashboard.
export function scopedGeofencePoints(points: GeofencePoint[]): GeofencePoint[] {
  const aktif = points.filter(p => p.enabled !== false)
  const penugasan = assignedRouteCodes()
  if (penugasan.size === 0) return aktif
  return aktif.filter(p => {
    if (p.allowedRoutes.length === 0) return true
    return p.allowedRoutes.some(code => penugasan.has(String(code).trim().toUpperCase()))
  })
}



export async function syncGeofencesFromBackend(opts: { force?: boolean } = {}): Promise<GeofenceSyncResult> {
  if (inFlightSync) return inFlightSync

  const run = pullGeofencesFromBackend(opts)
  inFlightSync = run
  try {
    return await run
  } finally {
    inFlightSync = null
  }
}



async function pullGeofencesFromBackend(opts: { force?: boolean } = {}): Promise<GeofenceSyncResult> {
  const cached = () => getStoredGeofencePoints()

  if (!opts.force) {
    try {
      const lastSync = Number(localStorage.getItem(GEOFENCE_SYNC_KEY) || 0)
      if (Date.now() - lastSync < GEOFENCE_SYNC_INTERVAL) {
        console.log('[geofence] Sync: using cached data, last sync', new Date(lastSync).toISOString())
        return { ok: true, count: cached().length, reason: 'cached' }
      }
    } catch { /* storage tidak tersedia */ }
  }

  // ponytail: belum pernah login (tanpa officer tersimpan) = renew pasti gagal.
  // Diam total — jangan penuhi console sebelum user pertama kali login.
  if (!api.isAuthenticated && !getStoredOfficer()) {
    return { ok: false, count: cached().length, reason: 'unauthorized' }
  }

  // auto-refresh token before sync
  if (!api.isAuthenticated) {
    if (!opts.force && Date.now() - lastUnauthorizedAt < UNAUTH_THROTTLE_MS) {
      return { ok: false, count: cached().length, reason: 'unauthorized' }
    }
    console.log('[geofence] Sync: not authenticated, trying to renew session')
    const refreshed = await renewSessionIfNeeded()
    if (!refreshed) {
      console.log('[geofence] Sync: session renewal failed')
      lastUnauthorizedAt = Date.now()
      return { ok: false, count: cached().length, reason: 'unauthorized' }
    }
  }

  const backup = cached()
  console.log('[geofence] Sync: fetching from', api.baseUrl)

  // ponytail: cache tidak pernah dihapus sebelum sukses — save menimpa atomis

  try {
    // petugas mengambil titik untuk dermaga yang ia pilih (jika ada) PLUS titik
  // "berlaku umum" (dermagaId kosong). Jika one-dermaga device tapi backend SSB
  // masih DB lama tanpa kolom dermaga_id, endpoint masih 200 dan kita amankan di
  // sisi klien: titik yang petugas itu dapat = yang dermagaId-nya cocok ATAU NULL
  // (berlaku umum). Titik dermaga lain TIDAK ikut, jadi masing-masing petugas
  // lihat subset yang ia miliki — sinkronisasi jadi benar-benar berbeda per device.
  const dermagaId = getStoredDermaga()?.id
  let path: string
  let dermagaFilter: { id?: string; cacheKey?: string } = { id: dermagaId ?? undefined }
  if (dermagaId) {
    path = `/geofences?dermagaId=${encodeURIComponent(String(dermagaId))}`
    dermagaFilter.cacheKey = `dermaga-${dermagaId}`
  } else {
    path = '/geofences'
    dermagaFilter.cacheKey = 'all'
  }
  console.log('[geofence] Sync: GET', path)
  const result = await api.get<BackendGeofence[]>(path)
    console.log('[geofence] Sync: response', JSON.stringify(result))

    if (!result.ok || !Array.isArray(result.data)) {
      const sesiMati = result.error?.code === '401' || result.error?.code === '403'
      console.log('[geofence] Sync: request failed, sesiMati:', sesiMati)
      if (sesiMati) {
        lastUnauthorizedAt = Date.now()
        try { window.dispatchEvent(new Event(GEOFENCE_AUTH_EXPIRED_EVENT)) } catch { /* non-browser */ }
      }
      return { ok: false, count: backup.length, reason: sesiMati ? 'unauthorized' : 'network' }
    }

    // Jika bukan one-dermaga device (tanpa dermaga_diminta): dapat semua, titik
    // berlaku umum + semua per-dermaga; frontend filter di scopedGeofencePoints.
    //
    // Jika one-dermaga device DAN backend sudah punya kolom dermaga_id (endpoint
    // mobile branch yang live): hasilnya sudah tepat (titik dermaga tsb + umum).
    //
    // Jika one-dermaga device DAN endpoint SSB masih skema lama (tanpa kolom):
    // tidak ada titik yang dermagaId-nya cocok, tapi titik umum (NULL) ikut sampai.
    // Di sisi klien kita SIDAKAN titik lain: hasilnya harus = titik yang dermagaId
    // pas ATAU dermagaId kosong (berlaku umum). Ini bukan fallback ke master —
    // fallback ke master itu bikin titik D1 masuk device D2, yang bikin sinkron
    // jadi SALAH per device. Setelah fix di server, guard ini tidak pernah dinyalakan
    // karena semua device dapat subset yang tepat dari endpoint dermagaId.
    let rows = result.data ?? []
    // Sisi klien: satu-dermaga device hanya boleh dapat titik yang dermagaId-nya cocok
    // ATAU dermagaId kosong (berlaku umum). Ini melindungi D1 device D2 selama backend
    // masih berjalan di SSB skema lama yang belum punya kolom dermaga_id — selama itu,
    // titik dermaga lain TIDAK ikut, jadi sinkron benar-benar berbeda per device.
    //
    // Sedangkan titik umum (dermagaId kosong) tetap dianggap milik semua device, jadi
    // TIDAK pernah di-sidebar — itu memang yang sebenarnya harusnya sampai ke setiap
    // perangkat. Setelah deploy backend terbaru (endpoint punya kolom dermaga_id),
    // hasilnya tetap sama: hanya titik dermaga tsb + umum.
    rows = rows.filter(
      p => !dermagaId || !String(p.dermagaId || '').trim() || String(p.dermagaId).trim() === dermagaId,
    ) as BackendGeofence[]

    console.log('[geofence] Sync: got', rows.length, 'items from server')
    const points = scopedGeofencePoints(
      rows
        .map(mapBackendToGeofence)
        .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude)),
    )
    console.log('[geofence] Sync: after scoped filter,', points.length, 'points remain')
    if (points.length === 0 && rows.length > 0) {
      console.warn('[geofence] Sync: server mengirim', rows.length, 'titik tetapi semuanya tersaring oleh kode rute perangkat')
    }
    const berubah = JSON.stringify(backup) !== JSON.stringify(points)

    saveGeofencePoints(points)
    try { localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now())) } catch { /* storage mati */ }

    if (berubah) {
      try {
        window.dispatchEvent(new CustomEvent(GEOFENCE_UPDATED_EVENT, { detail: { count: points.length } }))
      } catch { /* non-browser */ }
    }
    return { ok: true, count: points.length, reason: points.length > 0 ? 'ok' : 'empty' }
  } catch (e) {
    console.error('[geofence] Sync: exception:', e)
    return { ok: false, count: backup.length, reason: 'network' }
  }
}




export async function forceSyncGeofencesFromBackend(): Promise<GeofenceSyncResult> {
  return syncGeofencesFromBackend({ force: true })
}




export async function getActiveGeofenceSnapshot(
  points?: GeofencePoint[],
): Promise<ValidationResult> {
  const geofencePoints = points ?? getStoredGeofencePoints()
  const strict = geofencePoints.some(p => p.enabled && p.strictEnforceOutsideArea !== false)

  if (geofencePoints.length === 0) {
    return {
      valid: false,
      blocked: true,
      configMissing: true,
      reason: 'Belum ada titik geofence tersimpan di perangkat ini — tarik konfigurasi terbaru dari Admin (Master Rute)',
    }
  }

  if (geofencePoints.every(p => !p.enabled)) {
    return strict
      ? { valid: false, blocked: true, reason: 'Geofence nonaktif — input trip diblokir' }
      : { valid: false, blocked: true, reason: 'Titik geofence dinonaktifkan admin — input trip diblokir' }
  }

  const position = await getCurrentPosition()
  if (!position) {
    return strict
      ? { valid: false, blocked: true, reason: 'GPS tidak tersedia atau izin lokasi ditolak — input trip diblokir' }
      : { valid: false, reason: 'Posisi GPS tidak tersedia' }
  }

  if (position.accuracy != null && position.accuracy > 100) {
    return strict
      ? { valid: false, blocked: true, reason: `Akurasi GPS terlalu rendah (±${Math.round(position.accuracy)}m > 100m) — input trip diblokir`, accuracyMeters: position.accuracy }
      : { valid: false, reason: 'Akurasi GPS terlalu rendah', accuracyMeters: position.accuracy }
  }

  const activePoint = findActiveGeofencePoint(position, geofencePoints)
  if (!activePoint) {
    return strict
      ? { valid: false, blocked: true, reason: 'Di luar Area Geofence Resmi — seluruh input trip diblokir', accuracyMeters: position.accuracy }
      : { valid: false, reason: 'Tidak berada di dalam area geofence', accuracyMeters: position.accuracy }
  }

  const distanceMeters = calculateDistance(
    position.lat,
    position.lon,
    activePoint.latitude,
    activePoint.longitude,
  )
  return { valid: true, activePoint, distanceMeters, accuracyMeters: position.accuracy }
}
