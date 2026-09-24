// ─── Officer Sync Service ──────────────────────────────────────────────────────
// Syncs officers between mobile app and backend

import { api } from './api'
import { ensureAdminBackendSession } from './auth'

export interface BackendOfficer {
  id: string
  name: string
  region_id: string
  regions: Array<{ id: string; name: string; code: string }>
  is_active: number
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

// Fetch all officers from backend (requires admin JWT)
export async function fetchBackendOfficers(): Promise<BackendOfficer[] | null> {
  // Check cache first
  const cache = loadCache()
  if (cache && Date.now() - cache.timestamp < OFFICER_CACHE_TTL) {
    return cache.officers
  }

  const ok = await ensureAdminBackendSession()
  if (!ok) return null

  const result = await api.get<BackendOfficer[]>('/officers')
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
    id: Number(bo.id),
    name: bo.name,
    initials: bo.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
    region: primaryRegion,
    regions: bo.regions?.map(r => r.code) ?? [primaryRegion],
    pin: '', // Not exposed from backend for security
    status: bo.is_active ? 'Aktif' : 'Nonaktif',
    device: '-',
    trips: 0,
    lastActive: '-',
    joined: '-',
  }
}

// Sync officers to local storage and return mobile-format list
export async function syncOfficersToLocal(): Promise<ReturnType<typeof toMobileOfficer>[]> {
  const backendOfficers = await fetchBackendOfficers()
  if (!backendOfficers) return []

  const mobileOfficers = backendOfficers.map(toMobileOfficer)

  // Save to localStorage for offline access
  try {
    localStorage.setItem('trip.officers.v1', JSON.stringify(mobileOfficers))
  } catch { /* quota */ }

  return mobileOfficers
}
