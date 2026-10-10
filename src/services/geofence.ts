// ─── Geofencing & Route Validation Config ──────────────────────────────────────
// Konfigurasi lokasi geofencing untuk validasi rute dinamis berdasarkan
// koordinat GPS petugas. Rules ini siap disinkronkan dari Admin Dashboard.
//
// Radius maksimum: 100 meter (high-accuracy GPS)
// Coordinate format: { latitude: number, longitude: number }

export interface GeofenceRule {
  /** ID unik rule */
  id: string
  /** Nama lokasi referensi */
  locationName: string
  /** Koordinat pusat geofence */
  latitude: number
  longitude: number
  /** Radius maksimum dalam meter (default: 100) */
  radiusMeters: number
  /** Kode rute yang DIIZIN kan saat berada di area ini */
  allowedRouteCodes: string[]
  /** Arah rute yang DIIZIN kan (from->to) */
  allowedDirections: string[]
  /** Keterangan */
  description: string
}

export interface GeofenceConfig {
  /** Threshold akurasi GPS maksimum dalam meter */
  maxAccuracyMeters: number
  /** Radius default geofence dalam meter */
  defaultRadiusMeters: number
  /** Daftar rule geofencing aktif */
  rules: GeofenceRule[]
}

/** Konfigurasi geofencing default untuk Badau Dermaga 1 & 2 area */
export const DEFAULT_GEOFENCE_CONFIG: GeofenceConfig = {
  maxAccuracyMeters: 100,
  defaultRadiusMeters: 100,
  rules: [
    // ── Route 2: Badau Dermaga 1 area ──────────────────────────────────────
    // Koordinat: -6.1891005, 106.8371641
    // Saat petugas berada di area ini, rute dipaksa: SJRE -> SBDZ
    {
      id: 'badau-d1-route2',
      locationName: 'Badau Dermaga 1',
      latitude: -6.1891005,
      longitude: 106.8371641,
      radiusMeters: 100,
      allowedRouteCodes: ['SJRE-SBDZ'],
      allowedDirections: ['SJRE → SBDZ'],
      description: 'Route 2: Petugas di area Badau Dermaga 1 dipaksa menggunakan rute SJRE -> SBDZ',
    },
    // ── Route 1: Badau Dermaga 2 area ──────────────────────────────────────
    // Koordinat: -6.2389899548617285, 106.97475839406252
    // Saat petugas berada di area ini, rute dipaksa: SBDZ -> SJRE
    {
      id: 'badau-d2-route1',
      locationName: 'Badau Dermaga 2',
      latitude: -6.2389899548617285,
      longitude: 106.97475839406252,
      radiusMeters: 100,
      allowedRouteCodes: ['SBDZ-SJRE'],
      allowedDirections: ['SBDZ → SJRE'],
      description: 'Route 1: Petugas di area Badau Dermaga 2 dipaksa menggunakan rute SBDZ -> SJRE',
    },
  ],
}

/**
 * Hitung jarak antara dua koordinat GPS (Haversine formula)
 * Returns jarak dalam meter
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000 // radius bumi dalam meter
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Cek apakah koordinat berada dalam radius geofence tertentu
 */
export function isWithinGeofence(
  lat: number,
  lon: number,
  rule: GeofenceRule,
  maxAccuracy: number,
): { matched: boolean; distance: number; inRadius: boolean } {
  const distance = haversineDistance(lat, lon, rule.latitude, rule.longitude)
  const inRadius = distance <= rule.radiusMeters
  // Hanya match bila GPS cukup akurat (within maxAccuracy meters)
  const matched = inRadius && distance <= maxAccuracy + rule.radiusMeters
  return { matched, distance, inRadius }
}

/**
 * Dapatkan rule geofence yang aktif berdasarkan koordinat saat ini
 * Returns rule pertama yang cocok, atau null bila tidak ada yang cocok
 */
export function findActiveGeofenceRule(
  lat: number,
  lon: number,
  config: GeofenceConfig,
  accuracy?: number,
): GeofenceRule | null {
  const effectiveAccuracy = accuracy ?? config.maxAccuracyMeters
  for (const rule of config.rules) {
    const result = isWithinGeofence(lat, lon, rule, effectiveAccuracy)
    if (result.matched) return rule
  }
  return null
}

/**
 * Validasi apakah rute yang dipilih diizinkan berdasarkan geofence aktif
 * Returns { allowed: boolean, reason?: string }
 */
export function validateRouteAgainstGeofence(
  routeCode: string,
  selectedDirection: string,
  activeRule: GeofenceRule | null,
): { allowed: boolean; reason?: string } {
  if (!activeRule) return { allowed: true }

  const routeAllowed = activeRule.allowedRouteCodes.includes(routeCode)
  const directionAllowed = activeRule.allowedDirections.includes(selectedDirection)

  if (!routeAllowed && !directionAllowed) {
    return {
      allowed: false,
      reason: `Area ${activeRule.locationName} hanya mengijinkan rute: ${activeRule.allowedDirections.join(', ')}`,
    }
  }

  return { allowed: true }
}

/**
 * Hard-lock route selection berdasarkan geofence
 * Returns kode rute yang dipaksa, atau null bila tidak ada lock
 */
export function getHardLockedRoute(
  activeRule: GeofenceRule | null,
): string | null {
  if (!activeRule) return null
  if (activeRule.allowedRouteCodes.length === 1) {
    return activeRule.allowedRouteCodes[0]
  }
  return null
}
