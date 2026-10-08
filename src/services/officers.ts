// ─── Officer Sync Service ──────────────────────────────────────────────────────
// Syncs officers between mobile app and backend

import { api } from './api'
import { ensureBackendSession } from './auth'
import { saveOfficers, setPinHash } from './offlineDb'

export interface BackendOfficer {
  id: string
  name: string
  username?: string | null
  region_id: string
  regions: Array<{ id: string; name: string; code: string }>
  dermagas?: Array<{ id: string; name: string; code: string; region_id: string }>
  is_active: number
  /** Hash bcrypt PIN — untuk verifikasi PIN/password offline */
  pin_hash?: string | null
}

const OFFICER_CACHE_KEY = 'trip.officers.cache.v1'
const OFFICER_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

interface CacheEntry {
  officers: BackendOfficer[]
  timestamp: number
}

function loadCache(): CacheEntry | null {
  try {
    const raw = localStorage.getItem(OFFICER_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveCache(officers: BackendOfficer[]) {
  try {
    localStorage.setItem(OFFICER_CACHE_KEY, JSON.stringify({
      officers,
      timestamp: Date.now(),
    }))
  } catch { /* quota */ }
}

/**
 * Fetch officers that share a region with the logged-in officer.
 * Uses the *officer* JWT (GET /officers/my-region) so the mobile session is
 * never replaced by an admin token just to read this list.
 *
 * `force = true` skips the 5-minute cache (used when the switch-account screen
 * opens, so status/region changes made in the admin dashboard show up
 * immediately).
 */
export async function fetchBackendOfficers(force = false): Promise<BackendOfficer[] | null> {
  if (!force) {
    const cache = loadCache()
    if (cache && Date.now() - cache.timestamp < OFFICER_CACHE_TTL) {
      return cache.officers
    }
  }

  const ok = await ensureBackendSession()
  if (!ok) return null

  const result = await api.get<BackendOfficer[]>('/officers/my-region')
  if (result.ok && result.data) {
    saveCache(result.data)
    return result.data
  }
  return null
}

// Convert backend officer to mobile format
export function toMobileOfficer(bo: BackendOfficer) {
  const primaryRegion = bo.regions?.[0]?.code ?? bo.region_id
  return {
    // id tetap string agar cocok dengan id UUID maupun id lama "1".."5"
    id: String(bo.id),
    name: bo.name,
    username: bo.username || undefined,
    initials: bo.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
    region: primaryRegion,
    regions: bo.regions?.map(r => r.code) ?? [primaryRegion],
    pin: '', // Not exposed from backend for security
    status: bo.is_active ? 'Aktif' : 'Nonaktif',
    device: '-',
    trips: 0,
    lastActive: '-',
    joined: '-',
    dermagaAccess: bo.dermagas || [],
  }
}

// Sync officers to local storage and return mobile-format list
export async function syncOfficersToLocal(force = false): Promise<ReturnType<typeof toMobileOfficer>[]> {
  const backendOfficers = await fetchBackendOfficers(force)
  if (!backendOfficers) return []

  const mobileOfficers = backendOfficers.map(toMobileOfficer)

  // Kredensial PIN (bcrypt dari server) disimpan lokal supaya petugas BARU
  // hasil sync admin langsung bisa login offline tanpa pernah login online dulu.
  for (const bo of backendOfficers) {
    if (bo.pin_hash) void setPinHash(String(bo.id), bo.pin_hash)
  }

  // Save to localStorage for offline access
  try {
    localStorage.setItem('trip.officers.v1', JSON.stringify(mobileOfficers))
  } catch { /* quota */ }

  // Dan ke database offline (SQLite di native / localStorage di web) supaya
  // login & verifikasi PIN tetap berfungsi tanpa jaringan.
  void saveOfficers(mobileOfficers.map(o => ({
    id: String(o.id),
    username: o.username,
    name: o.name,
    regionId: o.region,
    regionCode: o.region,
    isActive: o.status === 'Aktif',
    payload: { ...o, username: o.username, dermagaAccess: o.dermagaAccess },
  })))

  return mobileOfficers
}

/** Daftar petugas tersimpan di perangkat (hasil prefetch terakhir). */
export function getStoredOfficers(): ReturnType<typeof toMobileOfficer>[] {
  try {
    const raw = localStorage.getItem('trip.officers.v1')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
