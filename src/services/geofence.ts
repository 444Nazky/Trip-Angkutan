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

// ponytail: ID dermaga warisan berbentuk 'BADAU-D1' (bukan UUID) tidak pernah
// sama dengan UUID dermaga asli → dulu selalu mismatch walau posisi benar.
// ID yang bukan UUID diperlakukan sebagai titik umum. TODO-data: bereskan
// dermaga_id di server (migrasi sudah ada) lalu hapus pengecualian ini.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(id: unknown): boolean {
  return UUID_RE.test(String(id ?? '').trim())
}

function isLegacyDermagaId(id: unknown): boolean {
  const s = String(id ?? '').trim()
  return !!s && !isUuid(s)
}

function pointBelongsToDermaga(p: GeofencePoint, dockId: string): boolean {
  if (!p.dermagaId) return true
  if (String(p.dermagaId).trim() === String(dockId).trim()) return true
  return isLegacyDermagaId(p.dermagaId)
}



// Apakah titik ini jelas-jelas milik DERMAGA LAIN (bukan titik umum/warisan)?
// Dipakai UI untuk memunculkan "Lokasi Tidak Sesuai Dermaga". Sengaja hanya
// menyalakan saat KEDUA sisi memakai UUID asli — dulu perbandingan mentah
// (`dermagaId !== dockId`) menyalakan banner ini untuk titik umum/warisan,
// sehingga petugas yang BENAR berada di dermaga terpilih tetap diblokir.
export function pointIsForOtherDermaga(
  point: { dermagaId?: string | null } | null | undefined,
  dockId?: string | null,
): boolean {
  const pid = String(point?.dermagaId ?? '').trim()
  const did = String(dockId ?? '').trim()
  if (!pid || !did) return false
  if (pid === did) return false
  return isUuid(pid) && isUuid(did)
}

// ponytail: radius bisa tumpang tindih (atau koordinat kembar dari input admin)
// → pemenang-tunggal berdasarkan urutan storage dulu menunjuk titik dermaga
// LAIN ("lokasi tidak sesuai dermaga" padahal posisi benar + tombol mati).
// Dengan dockId: hanya titik dermaga tsb (atau umum/warisan) yang dinilai,
// menang yang ID-nya persis lalu yang terdekat.
// peringkat titik saat dermaga terpilih: 0 = titik dermaga itu sendiri,
// 1 = titik "berlaku umum" (dermagaId kosong), 2 = warisan/non-UUID.
// Titik yang jelas milik dermaga lain tidak pernah masuk (pointBelongsToDermaga).
function dermagaRank(point: GeofencePoint, dockId: string): number {
  const pid = String(point.dermagaId ?? '').trim()
  if (!pid) return 1
  if (pid === String(dockId).trim()) return 0
  if (isUuid(pid)) return 3
  return 2
}

function findActiveGeofencePointForDermaga(
  position: { lat: number; lon: number },
  points: GeofencePoint[],
  dockId?: string | null,
): GeofencePoint | null {
  if (!dockId) return findActiveGeofencePoint(position, points)
  let best: GeofencePoint | null = null
  let bestScore = ''
  for (const point of points) {
    if (point.enabled === false) continue
    if (!pointBelongsToDermaga(point, dockId)) continue
    const distance = calculateDistance(position.lat, position.lon, point.latitude, point.longitude)
    if (distance > point.radiusMeters) continue
    const score = `${dermagaRank(point, dockId)}-${String(Math.round(distance)).padStart(10, '0')}`
    if (!best || score < bestScore) {
      best = point
      bestScore = score
    }
  }
  return best
}




export async function validateRouteForCurrentLocation(
  routeCode: string,
  points?: GeofencePoint[],
  dockId?: string | null,
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

  const activePoint = findActiveGeofencePointForDermaga(position, geofencePoints, dockId ?? null)

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

  // ponytail: rute sah bila ADA titik yang melingkupi posisi + membolehkannya,
  // bukan cuma pemenang-tunggal — radius yang tumpang tindih dulu bikin rute
  // yang benar ditolak saat submit. Scope dibatasi dermaga terpilih bila ada.
  const scopePool = dockId
    ? geofencePoints.filter(p => p.enabled !== false && pointBelongsToDermaga(p, dockId))
    : geofencePoints.filter(p => p.enabled !== false)
  const routeAllowed = scopePool.some(
    p => calculateDistance(position.lat, position.lon, p.latitude, p.longitude) <= p.radiusMeters
      && p.allowedRoutes.includes(routeCode),
  )

  if (!routeAllowed) {
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
  const penugasan = getStoredRoutes()
  if (penugasan.length === 0) return aktif

  // Route code alone is not a unique assignment: the same code can exist on
  // different docks. Keep a point only when its dock matches a route assigned
  // to that dock; NULL/legacy dock IDs remain shared for backwards compatibility.
  const belongsToAssignedDock = (point: GeofencePoint) => {
    const pointDockId = String(point.dermagaId ?? '').trim()
    if (!pointDockId || isLegacyDermagaId(pointDockId)) return true
    return penugasan.some(route => {
      const routeDockId = String(route.dermagaId ?? '').trim()
      return !routeDockId || routeDockId === pointDockId
    })
  }

  const dockScoped = aktif.filter(belongsToAssignedDock)
  const filtered = dockScoped.filter(point => {
    if (point.allowedRoutes.length === 0) return true
    return point.allowedRoutes.some(code => penugasan.some(route =>
      String(route.code ?? '').trim().toUpperCase() === String(code).trim().toUpperCase()
        && (!route.dermagaId || pointBelongsToDermaga(point, route.dermagaId)),
    ))
  })

  // Keep same-dock configuration visible if route codes are stale/mismatched,
  // but never fall back to points owned by another assigned dock.
  return filtered.length > 0 ? filtered : dockScoped
}

// ponytail: hitungan tiap tahap filter sync terakhir — agar layar "belum ada
// titik" bisa menjelaskan KENAPA (tak ada titik di server vs kode rute petugas
// tak cocok), bukan sekadar kosong. Disimpan di memori saja, bukan storage.
export interface GeofenceScopeDiagnosis {
  at: number
  received: number
  validCoords: number
  active: number
  scoped: number
  assignedCodes: string[]
}
let lastDiagnosis: GeofenceScopeDiagnosis | null = null
export function getLastGeofenceDiagnosis(): GeofenceScopeDiagnosis | null {
  return lastDiagnosis
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
    // ponytail: tarik titik untuk SEMUA dermaga yang menjadi akses petugas, bukan
    // cuma dermaga yang sedang dipilih. Dulu satu request ke `?dermagaId=<terpilih>`
    // lalu cache DITIMPA hasilnya → daftar titik berubah-ubah tiap ganti pilihan
    // ("kadang D1, kadang hanya D2, kadang keduanya") dan sinkron tampak menghapus
    // titik dermaga lain. Union = stabil, dan tetap ter-scope per device karena
    // hanya dermaga milik petugas itu yang diminta.
    // Sumber dermaga akses, digabung dari SEMUA data lokal yang tersimpan agar
    // tidak bergantung pada satu field (sesi officer lama sering tanpa
    // dermagaAccess → perangkat akhirnya menarik MASTER semua region).
    const accessibleIds: string[] = (() => {
      const ids = new Set<string>()
      for (const d of getStoredOfficer()?.dermagaAccess ?? []) {
        const id = String(d?.id ?? '').trim()
        if (id) ids.add(id)
      }
      for (const r of getStoredRoutes()) {
        const id = String(r?.dermagaId ?? '').trim()
        if (id) ids.add(id)
      }
      const selected = String(getStoredDermaga()?.id ?? '').trim()
      if (selected) ids.add(selected)
      return [...ids]
    })()

    const targets = accessibleIds.length > 0
      ? accessibleIds.map(id => `/geofences?dermagaId=${encodeURIComponent(id)}`)
      : ['/geofences']

    let rows: BackendGeofence[] = []
    let lastError: { code?: string; message?: string } | undefined
    let gotAny = false
    for (const path of targets) {
      console.log('[geofence] Sync: GET', path)
      const result = await api.get<BackendGeofence[]>(path)
      if (!result.ok || !Array.isArray(result.data)) { lastError = result.error; continue }
      gotAny = true
      rows.push(...result.data)
    }

    if (!gotAny) {
      const sesiMati = lastError?.code === '401' || lastError?.code === '403'
      console.log('[geofence] Sync: request failed, sesiMati:', sesiMati)
      if (sesiMati) {
        lastUnauthorizedAt = Date.now()
        // ponytail: 401 TIDAK menendang ke layar login — sesi petugas dibuat tidak
        // expired; cache lokal dipertahankan dan sync berikutnya mencoba lagi.
      }
      return { ok: false, count: backup.length, reason: sesiMati ? 'unauthorized' : 'network' }
    }

    // Titik "berlaku umum" (dermagaId kosong) muncul di setiap respons dermaga →
    // buang duplikatnya dulu, lalu sisakan hanya titik milik dermaga akses petugas
    // (id warisan/non-UUID tetap diterima sebagaiberlaku umum).
    const seenIds = new Set<string>()
    rows = rows.filter(p => {
      const key = String(p.id ?? '')
      if (key && seenIds.has(key)) return false
      if (key) seenIds.add(key)
      const pid = String(p.dermagaId ?? '').trim()
      if (!pid) return true
      if (accessibleIds.length === 0) return true
      return accessibleIds.includes(pid)
    }) as BackendGeofence[]

    console.log('[geofence] Sync: got', rows.length, 'items from server')
    const mapped = rows
      .map(mapBackendToGeofence)
      .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
    const points = scopedGeofencePoints(mapped)
    lastDiagnosis = {
      at: Date.now(),
      received: rows.length,
      validCoords: mapped.length,
      active: mapped.filter(p => p.enabled !== false).length,
      scoped: points.length,
      assignedCodes: [...assignedRouteCodes()].sort(),
    }
    console.log('[geofence] Sync: after scoped filter,', points.length, 'points remain')
    if (points.length === 0 && rows.length > 0) {
      console.warn('[geofence] Sync: server mengirim', rows.length, 'titik tetapi semuanya tersaring oleh kode rute perangkat')
    }
    if (points.length === 0) {
      // ponytail: hasil kosong TIDAK boleh menimpa cache bagus — sync yang
      // mengembalikan 0 (filter dermaga/rute tak cocok, tabel server kosong
      // sesaat) dulu menghapus titik perangkat permanen ("Belum ada titik"
      // + refresh tak pernah berubah). Pertahankan last-known-good.
      try { localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now())) } catch { /* storage mati */ }
      return { ok: true, count: backup.length, reason: 'empty' }
    }
    const berubah = JSON.stringify(backup) !== JSON.stringify(points)

    saveGeofencePoints(points)
    try { localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now())) } catch { /* storage mati */ }

    if (berubah) {
      try {
        window.dispatchEvent(new CustomEvent(GEOFENCE_UPDATED_EVENT, { detail: { count: points.length } }))
      } catch { /* non-browser */ }
    }
    return { ok: true, count: points.length, reason: 'ok' }
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
  dockId?: string | null,
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

  const activePoint = findActiveGeofencePointForDermaga(position, geofencePoints, dockId ?? null)
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
