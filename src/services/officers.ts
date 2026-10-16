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
const OFFICER_CACHE_TTL = 5 * 60 * 1000




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




// null = sesi/jaringan belum siap → pemanggil pakai data lokal, tanpa error
async function fetchBackendOfficers(force = false): Promise<BackendOfficer[] | null> {
  if (!force) {
    const cache = loadCache()
    if (cache && Date.now() - cache.timestamp < OFFICER_CACHE_TTL) {
      return cache.officers
    }
  }

  const ok = await ensureBackendSession()
  if (!ok || !api.isAuthenticated) {
    // ponytail: sesi belum siap → pakai cache lokal, JANGAN hapus token.
    // Token dipertahankan agar percobaan berikutnya (atau token perpetual
    // server) bisa dipakai; penghapusan dulu bikin roster mati permanen.
    return loadCache()?.officers ?? null
  }

  const result = await api.get<BackendOfficer[]>('/officers/my-region')
  if (!result.ok) {
    const code = result.error?.code
    if (code === '401' || code === '403') {
      // ponytail: sesi ditolak server → lanjut pakai data lokal, token tetap
      // disimpan (server kini menerima token lama; petugas aktif kembali
      // sembuh sendiri tanpa login ulang).
      return loadCache()?.officers ?? null
    }
    if (code === '404') throw new Error('Endpoint sinkron petugas belum tersedia di server.')
    // jaringan putus / CORS / timeout → jangan ganggu petugas
    return loadCache()?.officers ?? null
  }
  if (!Array.isArray(result.data)) return loadCache()?.officers ?? null
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
    pin: '',
    status: bo.is_active ? 'Aktif' : 'Nonaktif',
    device: '-',
    trips: 0,
    lastActive: '-',
    joined: '-',
    dermagaAccess: bo.dermagas || [],
  }
}




export async function syncOfficersToLocal(force = false): Promise<ReturnType<typeof toMobileOfficer>[]> {
  const backendOfficers = await fetchBackendOfficers(force)
  // sesi mati / offline → roster lokal dipakai apa adanya
  if (!backendOfficers?.length) return []
  const mobileOfficers = backendOfficers.map(toMobileOfficer)

  const missingPinHash = backendOfficers.filter(o => o.is_active && !o.pin_hash)
  if (missingPinHash.length > 0) {
    console.warn(`[officers] ${missingPinHash.length} petugas aktif tanpa pin_hash dari server: ${missingPinHash.map(o => o.name || o.id).join(', ')}`)
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

  const local = new Map<string, ReturnType<typeof toMobileOfficer>>()
  for (const o of [...getStoredOfficers(), ...seedRoster()]) local.set(String(o.id), o)

  const merged = new Map<string, ReturnType<typeof toMobileOfficer>>()
  for (const o of mobileOfficers) {
    const prev = local.get(String(o.id))
    const dermagaAccess = o.dermagaAccess?.length ? o.dermagaAccess : (prev?.dermagaAccess ?? [])
    merged.set(String(o.id), { ...o, dermagaAccess })
  }
  for (const [id, o] of local) if (!merged.has(id)) merged.set(id, o)
  const roster = [...merged.values()]
  localStorage.setItem('trip.officers.v1', JSON.stringify(roster))

  return roster
}




export function getStoredOfficers(): ReturnType<typeof toMobileOfficer>[] {
  try {
    const raw = localStorage.getItem('trip.officers.v1')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
