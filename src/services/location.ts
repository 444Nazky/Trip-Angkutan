// ─── Location Service ──────────────────────────────────────────────────────────
// Layanan lokasi dengan high-accuracy GPS untuk validasi geofencing dan
// penanda koordinat photos. Menggunakan @capacitor/geolocation dengan
// pengaturan akurasi maksimum.
//
// Maximum radius threshold: 100 meters (sesuai konfigurasi geofence)

import { Geolocation, type Position } from '@capacitor/geolocation'
import {
  DEFAULT_GEOFENCE_CONFIG,
  currentConfig as syncedConfig,
  applyGeofenceConfig as persistSyncedConfig,
  type GeofenceConfig,
  type GeofenceRule,
  findActiveGeofenceRule,
  getHardLockedRoute,
  validateRouteAgainstGeofence,
  haversineDistance,
} from './geofence'

const MAX_ACCURACY_METERS = 100
const LOCATION_TIMEOUT_MS = 10000
const MAX_AGE_MS = 30000

export interface LocationResult {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
  valid: boolean
}

export interface GeofenceLocationResult extends LocationResult {
  activeRule: GeofenceRule | null
  hardLockedRoute: string | null
  routeValidation: { allowed: boolean; reason?: string }
}

// Runtime state: selalu delegasi ke config hasil sync/cache dari geofence.ts
// agar update di latar belakang (adminPull) langsung terlihat oleh semua caller.
function activeConfig(): GeofenceConfig {
  try { const c = syncedConfig(); if (c) return c } catch { /* fallthrough */ }
  return DEFAULT_GEOFENCE_CONFIG
}

/** Update konfigurasi geofence (dari Admin Dashboard sync) — dipersist juga ke cache lokal */
export function updateGeofenceConfig(config: GeofenceConfig): void {
  void persistSyncedConfig(config)
}

/** Dapatkan konfigurasi geofence saat ini */
export function getGeofenceConfig(): GeofenceConfig {
  return activeConfig()
}

/**
 * Dapatkan posisi GPS dengan high accuracy
 * Returns null bila gagal atau timeout
 */
export async function getCurrentPositionHighAccuracy(): Promise<LocationResult | null> {
  try {
    const pos: Position | null = await withTimeout<Position | null>(
      Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: LOCATION_TIMEOUT_MS,
        maximumAge: MAX_AGE_MS,
      }),
      LOCATION_TIMEOUT_MS + 1000,
      null,
    )

    if (!pos?.coords) return null

    const { latitude, longitude, accuracy } = pos.coords

    // Validasi akurasi GPS
    const valid = accuracy <= MAX_ACCURACY_METERS || accuracy === 0

    return {
      latitude,
      longitude,
      accuracy,
      timestamp: pos.timestamp,
      valid,
    }
  } catch {
    return null
  }
}

/**
 * Dapatkan lokasi lengkap dengan validasi geofencing
 */
export async function getGeofencedLocation(): Promise<GeofenceLocationResult | null> {
  const location = await getCurrentPositionHighAccuracy()
  if (!location) return null

  const activeRule = findActiveGeofenceRule(
    location.latitude,
    location.longitude,
    activeConfig(),
    location.accuracy,
  )

  const hardLockedRoute = getHardLockedRoute(activeRule)

  const routeValidation = activeRule
    ? validateRouteAgainstGeofence('', '', activeRule)
    : { allowed: true }

  return {
    ...location,
    activeRule,
    hardLockedRoute,
    routeValidation,
  }
}

/**
 * Hitung jarak dari posisi saat ini ke koordinat target
 */
export function distanceToTarget(
  currentLat: number,
  currentLon: number,
  targetLat: number,
  targetLon: number,
): number {
  return haversineDistance(currentLat, currentLon, targetLat, targetLon)
}

/**
 * Cek apakah dua koordinat dianggap "sama" dalam threshold tertentu
 */
export function coordinatesMatch(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
  thresholdMeters: number = 100,
): boolean {
  const distance = haversineDistance(lat1, lon1, lat2, lon2)
  return distance <= thresholdMeters
}

/**
 * Fungsi timeout helper untuk operasi geolocation
 */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        resolve(fallback)
      }
    }, ms)
    p.then(
      (v) => {
        if (!done) {
          done = true
          clearTimeout(timer)
          resolve(v)
        }
      },
      () => {
        if (!done) {
          done = true
          clearTimeout(timer)
          resolve(fallback)
        }
      },
    )
  })
}

/**
 * Daftar koordinat geofence yang terkonfigurasi (untuk debugging/admin UI)
 */
export function getConfiguredGeofenceLocations(): Array<{
  id: string
  name: string
  latitude: number
  longitude: number
  radiusMeters: number
}> {
  return activeConfig().rules.map((rule) => ({
    id: rule.id,
    name: rule.locationName,
    latitude: rule.latitude,
    longitude: rule.longitude,
    radiusMeters: rule.radiusMeters,
  }))
}
