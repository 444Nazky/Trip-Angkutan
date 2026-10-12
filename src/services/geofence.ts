// ─── Geofencing & Route Validation Config ──────────────────────────────────────
// Konfigurasi lokasi geofencing untuk validasi rute dinamis berdasarkan
// koordinat GPS petugas. Rules ini disinkronkan dari Admin Dashboard.
//
// Radius maksimum: 100 meter (high-accuracy GPS)
// Coordinate format: { latitude: number, longitude: number }

import { api } from './api'

// ── DEV MODE: Fallback Mock Location ─────────────────────────────────────────
// Koordinat Dermaga 1 Badau — digunakan saat GPS gagal/timeout di VS Code Browser
const DEV_MODE_FALLBACK_LAT = -6.1891005
const DEV_MODE_FALLBACK_LON = 106.8371641

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

/**
 * Konfigurasi geofence default — KOSONG (rules dari backend/admin).
 * Default sebelumnya memuat koordinat Badau hardcoded; di region lain
 * (Entikong, Belitung, Kelapa Kampit) itu membingungkan petugas (rule palsu
 * memaksa rute yang salah). Config sebenarnya di-sync via syncGeofenceConfig()
 * saat online; tanpa sync = tanpa rule, tanpa paksaan rute.
 */
export const DEFAULT_GEOFENCE_CONFIG: GeofenceConfig = {
  maxAccuracyMeters: 100,
  defaultRadiusMeters: 100,
  rules: [],
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
  // Match = dalam radius SAJA. Formula lama (maxAccuracy + radiusMeters)
  // MEMPERLEBAR zona aman jadi radius + akurasi GPS — petugas 120m dari
  // pusat lolos padahal seharusnya di luar. Zona tidak boleh melebar.
  const matched = inRadius
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

// ── Sync dari Backend ────────────────────────────────────────────────────

const GEOFENCE_CACHE_KEY = 'trip.geofence.config.v1'

function isGeofenceConfig(x: unknown): x is GeofenceConfig {
  if (!x || typeof x !== 'object') return false
  const cfg = x as GeofenceConfig
  return typeof cfg.maxAccuracyMeters === 'number' &&
    typeof cfg.defaultRadiusMeters === 'number' &&
    Array.isArray(cfg.rules)
}

/** Muat config terakhir yang tersimpan lokal (cache offline). */
export function loadCachedGeofenceConfig(): GeofenceConfig {
  try {
    const raw = localStorage.getItem(GEOFENCE_CACHE_KEY)
    const cfg = raw ? JSON.parse(raw) : null
    if (isGeofenceConfig(cfg)) return cfg
  } catch { /* corrupt → pakai default */ }
  return DEFAULT_GEOFENCE_CONFIG
}

function persistGeofenceConfig(config: GeofenceConfig): void {
  try { localStorage.setItem(GEOFENCE_CACHE_KEY, JSON.stringify(config)) } catch { /* quota */ }
}

/**
 * Tarik konfigurasi geofence terbaru dari backend (hasil CRUD Admin Dashboard)
 * dan simpan cache lokal. Return true bila fetch berhasil.
 */
export async function syncGeofenceConfig(): Promise<boolean> {
  try {
    const res = await api.get<unknown>('/geofences')
    if (!res.ok || !Array.isArray(res.data)) return false

    // Bentuk respons backend: array rule → konversi jadi GeofenceConfig
    const remoteRules = (res.data as unknown[]).filter(isGeofenceRuleShape) as GeofenceRule[]
    if (remoteRules.length === 0) {
      // Backend belum punya rule — pertahankan cache, jangan reset ke default
      return true
    }
    applyGeofenceConfig({
      ...loadCachedGeofenceConfig(),
      rules: remoteRules,
    })
    return true
  } catch { return false }
}

function isGeofenceRuleShape(x: unknown): x is GeofenceRule {
  if (!x || typeof x !== 'object') return false
  const r = x as Record<string, unknown>
  return typeof r['id'] === 'string' &&
    typeof r['locationName'] === 'string' &&
    typeof r['latitude'] === 'number' &&
    typeof r['longitude'] === 'number'
}

/** Terapkan config baru ke state runtime & persist ke localStorage. */
export function applyGeofenceConfig(config: GeofenceConfig): void {
  if (!isGeofenceConfig(config)) return
  currentConfigRef = config
  persistGeofenceConfig(config)
}

let currentConfigRef: GeofenceConfig | null = null

/** Getter global — pakai ini untuk menghindari import circular dengan location.ts. */
export function currentConfig(): GeofenceConfig {
  if (!currentConfigRef) currentConfigRef = loadCachedGeofenceConfig()
  return currentConfigRef
}
