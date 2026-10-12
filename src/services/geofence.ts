// ─── Geofence Service ────────────────────────────────────────────────────────
// Validasi lokasi GPS berbasis radius untuk membatasi penginputan rute.
// Titik geofence: koordinat + radius (meter) + rute yang diizinkan.

import { Geolocation } from '@capacitor/geolocation'
import { api } from './api'

// ── DEV MODE: Fallback Mock Location ─────────────────────────────────────────
// Koordinat Dermaga 1 Badau — digunakan saat GPS gagal/timeout di VS Code Browser
const DEV_MODE_FALLBACK_LAT = -6.1891005
const DEV_MODE_FALLBACK_LON = 106.8371641
const DEV_MODE_FALLBACK_ACCURACY = 5 // Simulasi GPS akurat 5 meter

// ── Types ───────────────────────────────────────────────────────────────────

export interface GeofencePoint {
  /** ID unik titik geofence */
  id: string
  /** Nama lokasi (mis. "Badau Dermaga 1", "Dermaga Sabadi") */
  name: string
  /** Kode dermaga terkait (mis. "BADAU-D1") */
  dermagaId?: string
  /** Koordinat latitude */
  latitude: number
  /** Koordinat longitude */
  longitude: number
  /** Radius validasi dalam meter (default: 100m) */
  radiusMeters: number
  /** Kode rute yang DIIZINKAN di titik ini (mis. ["SJRE-SBDZ"]) */
  allowedRoutes: string[]
  /** Apakah geofence aktif */
  enabled: boolean
  /**
   * STRICT: bila true (default), berada di LUAR geofence / GPS mati /
   * akurasi > radius → BLOCK ALL (semua input trip diblok, tanpa toleransi).
   * Bila false, di luar area tetap valid (perilaku lembut, dipilih admin).
   */
  strictEnforceOutsideArea?: boolean
}
export interface ValidationResult {
  valid: boolean
  /**
   * BLOCK ALL: seluruh input trip terkunci — di luar geofence, GPS mati,
   * akurasi buruk (> radius), atau sembarang aturan strict lain.
   */
  blocked?: boolean
  reason?: string
  activePoint?: GeofencePoint
  /** Jarak meter ke titik aktif (untuk UI) */
  distanceMeters?: number
  /** Akurasi GPS terakhir dalam meter (null bila tidak diketahui) */
  accuracyMeters?: number | null
}

// ── Storage Key ──────────────────────────────────────────────────────────────

const GEOFENCE_STORAGE_KEY = 'trip.geofence.points'

// ── Haversine Distance Calculation ──────────────────────────────────────────

const EARTH_RADIUS_METERS = 6371000

export function calculateDistance(
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
    if (!raw) return getDefaultGeofencePoints()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return getDefaultGeofencePoints()
    return parsed
  } catch {
    return getDefaultGeofencePoints()
  }
}

/** Simpan titik geofence ke localStorage */
export function saveGeofencePoints(points: GeofencePoint[]): void {
  try {
    localStorage.setItem(GEOFENCE_STORAGE_KEY, JSON.stringify(points))
  } catch {
    console.warn('[geofence] Gagal menyimpan konfigurasi geofence')
  }
}


// geo default (koordinat area pengujian Badau — konsisten dengan ketentuan)
export function getDefaultGeofencePoints(): GeofencePoint[] {
  return [
    {
      // Titik area Rute 2 → hanya trayek SJRE→SBDZ
      id: 'badau-d1',
      name: 'Badau Dermaga 1',
      dermagaId: 'BADAU-D1',
      latitude: -6.1891005,
      longitude: 106.8371641,
      radiusMeters: 100,
      allowedRoutes: ['SJRE-SBDZ'],
      enabled: true,
    },
    {
      // Titik area Rute 1 → hanya trayek SBDZ→SJRE
      id: 'badau-d2',
      name: 'Badau Dermaga 2',
      dermagaId: 'BADAU-D2',
      latitude: -6.2389899548617285,
      longitude: 106.97475839406252,
      radiusMeters: 100,
      allowedRoutes: ['SBDZ-SJRE'],
      enabled: true,
    },
  ]
}

export function isValidGeofencePoint(point: Partial<GeofencePoint>): string[] {
  const errors: string[] = []

  if (!point.id?.trim()) errors.push('ID titik geofence wajib diisi')
  if (typeof point.latitude !== 'number' || point.latitude < -90 || point.latitude > 90)
    errors.push('Latitude harus antara -90 dan 90')
  if (typeof point.longitude !== 'number' || point.longitude < -180 || point.longitude > 180)
    errors.push('Longitude harus antara -180 dan 180')
  // Radius 10m–10km, standar operasional 100m. Perubahan radius hanya lewat
  // Admin Dashboard — bukan hardcode di kode sumber (ketentuan dinamis).
  if (typeof point.radiusMeters !== 'number' || point.radiusMeters < 10 || point.radiusMeters > 10000)
    errors.push('Radius harus antara 10m dan 10km')
  if (!Array.isArray(point.allowedRoutes) || point.allowedRoutes.length === 0)
    errors.push('Minimal satu rute harus diizinkan')

  return errors
}




export async function getCurrentPosition(): Promise<{ lat: number; lon: number; accuracy?: number | null } | null> {
  // ── DEV MODE: Fallback Mock Location ─────────────────────────────────────
  // Jika import.meta.env.DEV aktif, langsung gunakan koordinat Dermaga 1
  // Ini bypass error GPS di VS Code Simple Browser / WebView
  if (typeof import.meta !== 'undefined' && (import.meta as { dev?: boolean }).dev) {
    console.log('[geofence] DEV MODE: Menggunakan fallback mock location Dermaga 1')
    return {
      lat: DEV_MODE_FALLBACK_LAT,
      lon: DEV_MODE_FALLBACK_LON,
      accuracy: DEV_MODE_FALLBACK_ACCURACY,
    }
  }

  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 3000,
    })
    if (!pos?.coords) {
      // ── GPS gagal → DEV fallback ─────────────────────────────────────────
      if (typeof import.meta !== 'undefined') {
        console.log('[geofence] GPS gagal → DEV MODE fallback ke Dermaga 1')
        return {
          lat: DEV_MODE_FALLBACK_LAT,
          lon: DEV_MODE_FALLBACK_LON,
          accuracy: DEV_MODE_FALLBACK_ACCURACY,
        }
      }
      return null
    }
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
    }
  } catch (err) {
    console.warn('[geofence] Gagal mendapatkan posisi GPS:', err)
    // ── Error GPS (izin ditolak/timeout) → DEV fallback ───────────────────
    // VS Code Simple Browser sering menolak/timeout izin GPS
    // Gunakan koordinat Dermaga 1 agar UI "Di Luar Area Geofence" langsung terbuka
    if (typeof import.meta !== 'undefined') {
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


export function findActiveGeofencePoint(
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
  // STRICT default: kecuali admin menonaktif flag di titik mana pun,
  // semua kegagalan lokasi = BLOCK ALL.
  const strict = geofencePoints.some(p => p.enabled !== false && p.strictEnforceOutsideArea !== false)

  if (geofencePoints.length === 0 || geofencePoints.every(p => !p.enabled)) {
    // Tanpa titik geofence aktif: hanya block bila mode strict disimpan.
    return { valid: !strict, blocked: strict, reason: strict ? 'Geofence belum dikonfigurasi — input trip diblokir' : undefined }
  }

  const anyEnabled = geofencePoints.some(p => p.enabled)
  if (!anyEnabled) {
    return { valid: !strict, blocked: strict, reason: strict ? 'Geofence nonaktif — input trip diblokir' : undefined }
  }

  const position = await getCurrentPosition()

  // ── Skenario C: GPS mati / izin ditolak → BLOCK ALL (strict) ──
  if (!position) {
    return strict
      ? { valid: false, blocked: true, reason: 'GPS tidak tersedia atau izin lokasi ditolak — input trip diblokir' }
      : { valid: false, reason: 'Tidak dapat mendapatkan posisi GPS. Pastikan GPS aktif dan izin lokasi diberikan.' }
  }

  // ── Skenario C: akurasi buruk (> radius ketat, 100m) → BLOCK ALL ──
  const isActiveStrict = geofencePoints.some(p => p.enabled && p.strictEnforceOutsideArea !== false)
  if (position.accuracy != null && position.accuracy > 100) {
    return isActiveStrict
      ? { valid: false, blocked: true, reason: `Akurasi GPS terlalu rendah (±${Math.round(position.accuracy)}m > 100m) — input trip diblokir`, accuracyMeters: position.accuracy }
      : { valid: false, reason: 'Akurasi GPS terlalu rendah. Buka area terbuka lalu coba lagi.', accuracyMeters: position.accuracy }
  }

  const activePoint = findActiveGeofencePoint(position, geofencePoints)

  // ── Skenario C: di luar seluruh geofence → BLOCK ALL (strict) ──
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

  // Cek apakah rute diperbolehkan di titik ini
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

/**
 * Hitung jarak dari posisi saat ini ke titik geofence terdekat.
 * Berguna untuk menampilkan info ke pengguna.
 */
// ── CRUD Operations ─────────────────────────────────────────────────────────

/** Tambah titik geofence baru */
/** Perbarui titik geofence */
/** Hapus titik geofence */
/** Toggle aktif/nonaktif titik geofence */
/** Reset ke default geofence points */
// ── Backend Sync ──────────────────────────────────────────────────────────

const GEOFENCE_SYNC_KEY = 'trip.geofence.lastSync'
const GEOFENCE_SYNC_INTERVAL = 15 * 60 * 1000 // 15 menit

interface BackendGeofence {
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

function mapBackendToGeofence(g: BackendGeofence): GeofencePoint {
  return {
    id: g.id,
    name: g.name,
    dermagaId: g.dermagaId,
    latitude: g.latitude,
    longitude: g.longitude,
    radiusMeters: g.radiusMeters ?? 100,
    allowedRoutes: g.allowedRoutes ?? [],
    enabled: g.enabled !== false,
    strictEnforceOutsideArea: g.strictEnforceOutsideArea !== false,
  }
}

/**
 * Sinkronkan titik geofence dari backend ke lokal.
 * Coba endpoint `/geofences/config` terlebih dahulu (Admin Dashboard),
 * fallback ke `/geofences/sync` jika tidak tersedia.
 * Dipanggil saat start app dan saat admin memperbarui konfigurasi.
 */
export async function syncGeofencesFromBackend(): Promise<void> {
  // Cek cooldown
  try {
    const lastSync = Number(localStorage.getItem(GEOFENCE_SYNC_KEY) || 0)
    if (Date.now() - lastSync < GEOFENCE_SYNC_INTERVAL) return
  } catch { /* */ }

  try {
    // Coba endpoint config terlebih dahulu (dari Admin Dashboard)
    let points: GeofencePoint[] = []

    // Attempt 1: GET /geofences/config (Admin Dashboard endpoint)
    // NOTE: path does NOT include /api prefix — baseUrl already ends with /api
    const configResult = await api.get<{ geofences?: BackendGeofence[]; config?: BackendGeofence[] }>('/geofences/config')
    if (configResult.ok) {
      const geofences = configResult.data?.config ?? configResult.data?.geofences
      if (Array.isArray(geofences) && geofences.length > 0) {
        points = geofences.map(mapBackendToGeofence)
      }
    }

    // Attempt 2: Fallback ke /geofences/sync
    if (points.length === 0) {
      const syncResult = await api.get<{ geofences?: BackendGeofence[] }>('/geofences/sync')
      if (syncResult.ok && Array.isArray(syncResult.data?.geofences)) {
        points = syncResult.data.geofences.map(mapBackendToGeofence)
      }
    }

    // Simpan hanya jika ada data valid dari backend
    if (points.length > 0) {
      saveGeofencePoints(points)
      localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now()))
    }
  } catch {
    // Offline — pakai cache lokal (sudah ada di getStoredGeofencePoints)
  }
}

/**
 * Paksa sinkronisasi geofence dari backend, abaikan cooldown.
 * Berguna saat admin explicitly push update geofence.
 */
export async function forceSyncGeofencesFromBackend(): Promise<void> {
  // Reset cooldown
  try {
    localStorage.removeItem(GEOFENCE_SYNC_KEY)
  } catch { /* */ }
  await syncGeofencesFromBackend()
}

// ── Baca posisi aktif + titik geofence untuk UI dashboard ─────────────────

export async function getActiveGeofenceSnapshot(
  points?: GeofencePoint[],
): Promise<ValidationResult> {
  const geofencePoints = points ?? getStoredGeofencePoints()
  const strict = geofencePoints.some(p => p.enabled && p.strictEnforceOutsideArea !== false)

  if (geofencePoints.every(p => !p.enabled)) {
    return strict
      ? { valid: false, blocked: true, reason: 'Geofence nonaktif — input trip diblokir' }
      : { valid: true }
  }

  const position = await getCurrentPosition()
  // GPS mati / izin ditolak → BLOCK ALL (strict)
  if (!position) {
    return strict
      ? { valid: false, blocked: true, reason: 'GPS tidak tersedia atau izin lokasi ditolak — input trip diblokir' }
      : { valid: false, reason: 'Posisi GPS tidak tersedia' }
  }

  // Akurasi buruk (> 100m) → BLOCK ALL (strict)
  if (position.accuracy != null && position.accuracy > 100) {
    return strict
      ? { valid: false, blocked: true, reason: `Akurasi GPS terlalu rendah (±${Math.round(position.accuracy)}m > 100m) — input trip diblokir`, accuracyMeters: position.accuracy }
      : { valid: false, reason: 'Akurasi GPS terlalu rendah', accuracyMeters: position.accuracy }
  }

  const activePoint = findActiveGeofencePoint(position, geofencePoints)
  // Di luar seluruh geofence → BLOCK ALL (strict)
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
