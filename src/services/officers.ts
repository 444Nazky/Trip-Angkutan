// ─── Officer Sync Service ──────────────────────────────────────────────────────
// Syncs officers between mobile app and backend

import { api } from './api'
import { ensureBackendSession } from './auth'
import { getPinHash, listOfficers, saveOfficers, setPinHash } from './offlineDb'
import { seedRoster } from './seedData'

export interface BackendOfficer {
  id: string
  name: string
  username?: string | null
  region_id: string
  regions: Array<{ id: string; name: string; code: string }>
  dermagas?: Array<{ id: string; name: string; code: string; region_id: string }>
  is_active: number
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







export async function fetchBackendOfficers(force = false): Promise<BackendOfficer[]> {
  if (!force) {
    const cache = loadCache()
    if (cache && Date.now() - cache.timestamp < OFFICER_CACHE_TTL) {
      return cache.officers
    }
  }

  const ok = await ensureBackendSession()
  if (!ok || !api.isAuthenticated) throw new Error('Sesi petugas tidak valid. Masuk ulang secara online.')

  const result = await api.get<BackendOfficer[]>('/officers/my-region')
  if (!result.ok) {
    if (result.error?.code === '401' || result.error?.code === '403') {
      throw new Error('Sesi petugas tidak valid. Masuk ulang secara online.')
    }
    if (result.error?.code === '404') throw new Error('Endpoint sinkron petugas belum tersedia di server.')
    throw new Error(result.error?.message || 'Server gagal mengirim daftar petugas.')
  }
  if (!Array.isArray(result.data)) throw new Error('Data petugas dari server tidak valid.')
  saveCache(result.data)
  return result.data
}

function toMobileOfficer(bo: BackendOfficer) {
  const primaryRegion = bo.regions?.[0]?.code ?? bo.region_id
  return {
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
  if (!backendOfficers.length) return []
  const mobileOfficers = backendOfficers.map(toMobileOfficer)

  if (backendOfficers.some(o => o.is_active && !o.pin_hash)) {
    throw new Error('Server tidak mengirim hash PIN petugas aktif')
  }

  await saveOfficers(mobileOfficers.map((o, i) => ({
    id: o.id,
    username: o.username,
    name: o.name,
    regionId: backendOfficers[i].regions?.[0]?.id ?? backendOfficers[i].region_id,
    regionName: backendOfficers[i].regions?.[0]?.name,
    regionCode: o.region,
    isActive: o.status === 'Aktif',
    payload: { ...o, username: o.username, dermagaAccess: o.dermagaAccess },
  })))

  for (const bo of backendOfficers) {
    if (!bo.pin_hash) continue
    await setPinHash(String(bo.id), bo.pin_hash)
    if (await getPinHash(String(bo.id)) !== bo.pin_hash) {
      throw new Error('Gagal menyimpan PIN petugas di perangkat')
    }
  }

  const stored = await listOfficers<{ id: string }>()
  if (mobileOfficers.some(o => !stored.some(row => String(row.id) === o.id))) {
    throw new Error('Gagal menyimpan daftar petugas di perangkat')
  }

  // ── Gabungkan roster (UPSERT, bukan timpa) ──────────────────────────────
  // Sinkron dari dashboard admin HANYA menambah/memperbarui. Petugas bawaan
  // (seed) dan entri lama yang tidak ikut dikirim server harus tetap ada,
  // sehingga data default tidak rusak oleh sinkronisasi/OTA.
  const local = new Map<string, ReturnType<typeof toMobileOfficer>>()
  for (const o of [...getStoredOfficers(), ...seedRoster()]) local.set(String(o.id), o)

  const merged = new Map<string, ReturnType<typeof toMobileOfficer>>()
  for (const o of mobileOfficers) {
    const prev = local.get(String(o.id))
    // JANGAN biarkan server mengosongkan scope dermaga yang sudah diketahui.
    // Server kadang membalas `dermagas: []` (link belum tersinkron / DB lama)
    // → tanpa ini HomeScreen menganggap akun tak punya akses & mengunci Mulai Trip.
    const dermagaAccess = o.dermagaAccess?.length ? o.dermagaAccess : (prev?.dermagaAccess ?? [])
    merged.set(String(o.id), { ...o, dermagaAccess })
  }
  for (const [id, o] of local) if (!merged.has(id)) merged.set(id, o)
  const roster = [...merged.values()]
  localStorage.setItem('trip.officers.v1', JSON.stringify(roster))

  return roster
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
