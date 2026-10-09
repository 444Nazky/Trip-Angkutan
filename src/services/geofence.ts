// ─── Geofence Service ────────────────────────────────────────────────────────
// Validasi lokasi GPS berbasis radius untuk membatasi penginputan rute.
// Titik geofence: koordinat + radius (meter) + rute yang diizinkan.

import { Geolocation } from '@capacitor/geolocation'
import { api } from './api'

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
}

export interface GeofenceState {
  /** Posisi GPS saat ini (null jika belum tersedia) */
  currentPosition: { lat: number; lon: number } | null
  /** Titik geofence yang sedang aktif (dalam radius) */
  activePoint: GeofencePoint | null
  /** Semua titik geofence terkonfigurasi */
  points: GeofencePoint[]
  /** Error terakhir (mis. GPS ditolak) */
  error: string | null
  /** Apakah GPS sedang dimuat */
  loading: boolean
}

export interface ValidationResult {
  valid: boolean
  reason?: string
  activePoint?: GeofencePoint
}

// ── Storage Key ──────────────────────────────────────────────────────────────

const GEOFENCE_STORAGE_KEY = 'trip.geofence.points'

// ── Haversine Distance Calculation ──────────────────────────────────────────

const EARTH_RADIUS_METERS = 6371000

/**
 * Hitung jarak antara dua titik koordinat menggunakan formula Haversine.
 * Returns jarak dalam meter.
 */
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

// ── Geofence Point Management ────────────────────────────────────────────────

/** Ambil semua titik geofence dari localStorage */
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

/**
 * Default geofence points untuk pengujian.
 * Nanti bisa dikonfigurasi dari Admin Dashboard.
 */
export function getDefaultGeofencePoints(): GeofencePoint[] {
  return [
    {
      id: 'badau-d1',
      name: 'Badau Dermaga 1',
      dermagaId: 'BADAU-D1',
      latitude: -6.1891005,
      longitude: 106.8371641,
      radiusMeters: 100,
      allowedRoutes: ['SJRE-SBDZ', 'BDAU-SJRE'],
      enabled: true,
    },
    {
      id: 'badau-d2',
      name: 'Badau Dermaga 2',
      dermagaId: 'BADAU-D2',
      latitude: -6.2389899548617285,
      longitude: 106.97475839406252,
      radiusMeters: 100,
      allowedRoutes: ['SBDZ-SJRE', 'BDAU-SJRE'],
      enabled: true,
    },
    {
      id: 'sjre-d1',
      name: 'Sijangkung Dermaga 1',
      dermagaId: 'SJRE-D1',
      latitude: -6.3078,
      longitude: 106.7234,
      radiusMeters: 100,
      allowedRoutes: ['SJRE-SBDZ', 'SJRE-BDAU'],
      enabled: true,
    },
    {
      id: 'sbdz-d1',
      name: 'Sabadi Dermaga 1',
      dermagaId: 'SBDZ-D1',
      latitude: -6.1456,
      longitude: 106.8923,
      radiusMeters: 100,
      allowedRoutes: ['SBDZ-SJRE', 'BDAU-SJRE'],
      enabled: true,
    },
  ]
}

/** Cek apakah titik geofence valid */
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

// ── Position Checking ───────────────────────────────────────────────────────

/**
 * Ambil posisi GPS perangkat saat ini.
 * Returns null jika gagal atau GPS tidak tersedia.
 */
export async function getCurrentPosition(): Promise<{ lat: number; lon: number } | null> {
  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000,
    })
    if (!pos?.coords) return null
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
    }
  } catch (err) {
    console.warn('[geofence] Gagal mendapatkan posisi GPS:', err)
    return null
  }
}

/**
 * Cari titik geofence yang sedang aktif (dalam radius).
 * Returns null jika tidak ada titik yang cocok.
 */
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

/**
 * Validasi apakah rute yang dipilih diperbolehkan di posisi saat ini.
 * Ini fungsi utama yang dipanggil sebelum submit trip.
 */
export async function validateRouteForCurrentLocation(
  routeCode: string,
  points?: GeofencePoint[],
): Promise<ValidationResult> {
  const geofencePoints = points ?? getStoredGeofencePoints()

  // Jika tidak ada titik geofence dikonfigurasi, izinkan semua
  if (geofencePoints.length === 0 || geofencePoints.every(p => !p.enabled)) {
    return { valid: true }
  }

  // Jika geofencing dimatikan sepenuhnya, izinkan semua
  const anyEnabled = geofencePoints.some(p => p.enabled)
  if (!anyEnabled) {
    return { valid: true }
  }

  // Ambil posisi GPS
  const position = await getCurrentPosition()

  if (!position) {
    return {
      valid: false,
      reason: 'Tidak dapat mendapatkan posisi GPS. Pastikan GPS aktif dan izin lokasi diberikan.',
    }
  }

  // Cari titik geofence yang aktif
  const activePoint = findActiveGeofencePoint(position, geofencePoints)

  if (!activePoint) {
    return {
      valid: false,
      reason:
        'Anda tidak berada di lokasi yang diizinkan untuk input trip. Mendeteksi Anda di luar area dermaga yang terdaftar.',
    }
  }

  // Cek apakah rute diperbolehkan di titik ini
  if (!activePoint.allowedRoutes.includes(routeCode)) {
    const allowedList = activePoint.allowedRoutes.join(', ')
    return {
      valid: false,
      reason: `Rute ${routeCode} tidak diizinkan di lokasi ini (${activePoint.name}). Rute yang diperbolehkan: ${allowedList}`,
      activePoint,
    }
  }

  return { valid: true, activePoint }
}

/**
 * Hitung jarak dari posisi saat ini ke titik geofence terdekat.
 * Berguna untuk menampilkan info ke pengguna.
 */
export async function getDistanceToNearestPoint(
  points?: GeofencePoint[],
): Promise<{ point: GeofencePoint; distance: number } | null> {
  const geofencePoints = points ?? getStoredGeofencePoints()
  const position = await getCurrentPosition()

  if (!position) return null

  let nearest: { point: GeofencePoint; distance: number } | null = null

  for (const point of geofencePoints) {
    if (!point.enabled) continue

    const distance = calculateDistance(
      position.lat,
      position.lon,
      point.latitude,
      point.longitude,
    )

    if (!nearest || distance < nearest.distance) {
      nearest = { point, distance }
    }
  }

  return nearest
}

// ── CRUD Operations ─────────────────────────────────────────────────────────

/** Tambah titik geofence baru */
export function addGeofencePoint(point: GeofencePoint): { success: boolean; error?: string } {
  const errors = isValidGeofencePoint(point)
  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') }
  }

  const points = getStoredGeofencePoints()

  // Cek duplikasi ID
  if (points.some(p => p.id === point.id)) {
    return { success: false, error: 'ID titik geofence sudah ada' }
  }

  points.push(point)
  saveGeofencePoints(points)

  return { success: true }
}

/** Perbarui titik geofence */
export function updateGeofencePoint(
  id: string,
  updates: Partial<GeofencePoint>,
): { success: boolean; error?: string } {
  const points = getStoredGeofencePoints()
  const index = points.findIndex(p => p.id === id)

  if (index === -1) {
    return { success: false, error: 'Titik geofence tidak ditemukan' }
  }

  const merged = { ...points[index], ...updates }
  const errors = isValidGeofencePoint(merged)
  if (errors.length > 0) {
    return { success: false, error: errors.join('; ') }
  }

  points[index] = merged
  saveGeofencePoints(points)

  return { success: true }
}

/** Hapus titik geofence */
export function deleteGeofencePoint(id: string): void {
  const points = getStoredGeofencePoints().filter(p => p.id !== id)
  saveGeofencePoints(points)
}

/** Toggle aktif/nonaktif titik geofence */
export function toggleGeofencePoint(id: string, enabled: boolean): void {
  const points = getStoredGeofencePoints()
  const point = points.find(p => p.id === id)
  if (point) {
    point.enabled = enabled
    saveGeofencePoints(points)
  }
}

/** Reset ke default geofence points */
export function resetGeofenceToDefaults(): void {
  saveGeofencePoints(getDefaultGeofencePoints())
}

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
}

/**
 * Sinkronkan titik geofence dari backend ke lokal.
 * Dipanggil saat start app dan saat admin memperbarui konfigurasi.
 */
export async function syncGeofencesFromBackend(): Promise<void> {
  // Cek cooldown
  try {
    const lastSync = Number(localStorage.getItem(GEOFENCE_SYNC_KEY) || 0)
    if (Date.now() - lastSync < GEOFENCE_SYNC_INTERVAL) return
  } catch { /* */ }

  try {
    const result = await api.get<{ geofences?: BackendGeofence[] }>('/geofences/sync')

    if (result.ok && Array.isArray(result.data?.geofences)) {
      const points: GeofencePoint[] = result.data.geofences.map(g => ({
        id: g.id,
        name: g.name,
        dermagaId: g.dermagaId,
        latitude: g.latitude,
        longitude: g.longitude,
        radiusMeters: g.radiusMeters ?? 100,
        allowedRoutes: g.allowedRoutes ?? [],
        enabled: g.enabled !== false,
      }))

      if (points.length > 0) {
        saveGeofencePoints(points)
        localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now()))
      }
    }
  } catch {
    // Offline — pakai cache lokal
  }
}
