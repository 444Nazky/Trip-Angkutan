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

// Saat sesi petugas terbukti tidak valid (token usang/kedaluwarsa), jangan
// mencoba lagi di setiap event online/session-ready — itu yang memicu
// crash-loop sinkronisasi offline→online. Tahan percobaan berikutnya selama
// cooldown berikut, lalu coba lagi otomatis.
const SESSION_COOLDOWN_MS = 60 * 1000
let _sessionCooldownUntil = 0



interface CacheEntry {
  officers: BackendOfficer[]
  timestamp: number
}



/**
 * Error khusus sesi petugas: dibedakan dari kegagalan jaringan/server agar
 * pemanggil bisa melakukan fallback secara graceful, bukan mengulang tanpa henti.
 */
export class SessionInvalidError extends Error {
  readonly code = 'SESSION_INVALID'
  constructor(message = 'Sesi petugas tidak valid. Masuk ulang secara online.') {
    super(message)
    this.name = 'SessionInvalidError'
  }
}



/** True bila sinkron petugas sedang menahan diri setelah sesi terbukti tidak valid. */
export function isSessionCooldownActive(): boolean {
  return Date.now() < _sessionCooldownUntil
}



/**
 * Bersihkan token lokal yang usang lalu mulai masa cooldown. Ini memutus
 * siklus "sync gagal → event online → sync gagal lagi" tanpa menggantung UI.
 */
function clearStaleSession(): void {
  try { api.setToken(null) } catch {}
  _sessionCooldownUntil = Date.now() + SESSION_COOLDOWN_MS
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
  } catch {}
}

async function fetchBackendOfficers(force = false): Promise<BackendOfficer[]> {
  const cache = loadCache()
  if (!force && cache && Date.now() - cache.timestamp < OFFICER_CACHE_TTL) {
    return cache.officers
  }

  // Masih dalam cooldown sesi → pakai cache terakhir (graceful fallback)
  // alih-alih menembak server lagi dan gagal berulang kali.
  if (isSessionCooldownActive()) {
    return cache?.officers ?? []
  }

  const ok = await ensureBackendSession()
  if (!ok || !api.isAuthenticated) {
    clearStaleSession()
    if (cache?.officers.length) return cache.officers
    throw new SessionInvalidError()
  }

  const result = await api.get<BackendOfficer[]>('/officers/my-region')
  if (!result.ok) {
    if (result.error?.code === '401' || result.error?.code === '403') {
      clearStaleSession()
      if (cache?.officers.length) return cache.officers
      throw new SessionInvalidError()
    }
    if (result.error?.code === '404') throw new Error('Endpoint sinkron petugas belum tersedia di server.')
    throw new Error(result.error?.message || 'Server gagal mengirim daftar petugas.')
  }
  if (!Array.isArray(result.data)) throw new Error('Data petugas dari server tidak valid.')
  // Sesi sehat → buka kembali jalur sinkron normal.
  _sessionCooldownUntil = 0
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
  if (!backendOfficers.length) return []
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
