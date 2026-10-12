// ─── Geofence Service ────────────────────────────────────────────────────────
// Validasi lokasi GPS berbasis radius untuk membatasi penginputan rute.
// Titik geofence: koordinat + radius (meter) + rute yang diizinkan.

import { Geolocation } from '@capacitor/geolocation'
import { api } from './api'

// ── TIDAK ADA mock location ──────────────────────────────────────────────────
// Sebelumnya ada DEV_MODE_FALLBACK ke koordinat Badau Dermaga 1 yang dipakai
// setiap kali GPS gagal/izin ditolak. Efeknya berbahaya: petugas di region mana
// pun yang GPS-nya mati akan "terlihat" berada di Badau sehingga lolos validasi
// geofence. GPS gagal = lokasi TIDAK TERVERIFIKASI (return null) → rute tetap
// tersembunyi dan input trip diblokir, sesuai kebijakan strict.

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
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
  } catch {
    return []
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


// ── TANPA titik geofence hardcoded ──────────────────────────────────────────
// Sumber kebenaran tunggal adalah Master Rute di Admin Dashboard, disinkronkan
// via syncGeofencesFromBackend() → GET /api/geofences. Sebelumnya di sini ada
// koordinat Badau Dermaga 1 & 2 yang di-hardcode; itu membuat rute palsu di
// region lain (Entikong/Belitung/Kelapa Kampit) dan menutupi kegagalan sync.
// Fungsi dipertahankan (dipakai untuk paritas antar-branch) tapi mengembalikan
// daftar KOSONG: tanpa config dari backend = tidak ada area yang dianggap sah.
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
  // Radius 10m–10km, standar operasional 100m. Perubahan radius hanya lewat
  // Admin Dashboard — bukan hardcode di kode sumber (ketentuan dinamis).
  if (typeof point.radiusMeters !== 'number' || point.radiusMeters < 10 || point.radiusMeters > 10000)
    errors.push('Radius harus antara 10m dan 10km')
  if (!Array.isArray(point.allowedRoutes) || point.allowedRoutes.length === 0)
    errors.push('Minimal satu rute harus diizinkan')

  return errors
}




export async function getCurrentPosition(): Promise<{ lat: number; lon: number; accuracy?: number | null } | null> {
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 3000,
    })
    if (!pos?.coords) return null
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
    }
  } catch (err) {
    // GPS gagal / izin ditolak / timeout → null (lokasi tidak terverifikasi).
    // Jangan pernah mengembalikan koordinat hardcoded apa pun.
    console.warn('[geofence] Gagal mendapatkan posisi GPS:', err)
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

  // Tanpa titik geofence sama sekali → lokasi tidak terverifikasi, trip BLOCKED.
  // (Kebijakan disamakan dengan RouteSelectScreen & getActiveGeofenceSnapshot:
  //  rute hanya boleh dipakai setelah lokasi terbukti berada di titik resmi.)
  if (geofencePoints.length === 0) {
    return {
      valid: false,
      blocked: true,
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

/**
 * Kontrak respons ACTUAL dari GET /api/geofences (endpoint backend geofences.js):
 *   { id, locationName, latitude, longitude, radiusMeters,
 *     allowedRouteCodes: string[], allowedDirections: string[], description }
 * Toleransi camelCase/snake_case & field opsional agar kompatibel dengan
 * versi backend lama maupun baru.
 */
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
    // Backend mengirim allowedRouteCodes; fallback ke allowedRoutes (versi lama)
    allowedRoutes: toStringArray(g.allowedRouteCodes).length > 0
      ? toStringArray(g.allowedRouteCodes)
      : toStringArray(g.allowedRoutes),
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
    // Endpoint sebenarnya: GET /api/geofences → array rule hasil CRUD Master Rute
    // (versi lama menembak /geofences/config & /geofences/sync yang TIDAK ADA di
    // backend, sehingga sync selalu gagal diam-diam dan app terpaksa memakai
    // titik hardcoded Badau. Sekarang endpoint benar + mapping field benar.)
    const result = await api.get<BackendGeofence[]>('/geofences')
    if (!result.ok || !Array.isArray(result.data)) return

    const points = result.data
      .map(mapBackendToGeofence)
      .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))

    if (points.length === 0) {
      // Backend belum punya titik: JANGAN pakai default/hardcoded, dan jangan
      // hapus cache lama (offline-first) — cukup tandai sudah sync.
      localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now()))
      return
    }

    saveGeofencePoints(points)
    localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now()))
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

  // Belum ada titik sama sekali (admin belum mengisi Master Rute / belum sync):
  // lokasi TIDAK BISA diverifikasi → rute tetap disembunyikan, tapi pesannya
  // harus jelas (bukan "di luar area", karena tidak ada area yang didefinisikan).
  if (geofencePoints.length === 0) {
    return {
      valid: false,
      blocked: true,
      reason: 'Geofence belum dikonfigurasi admin (Master Rute) — hubungi admin untuk mendaftarkan titik lokasi',
    }
  }

  if (geofencePoints.every(p => !p.enabled)) {
    return strict
      ? { valid: false, blocked: true, reason: 'Geofence nonaktif — input trip diblokir' }
      : { valid: false, blocked: true, reason: 'Titik geofence dinonaktifkan admin — input trip diblokir' }
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
