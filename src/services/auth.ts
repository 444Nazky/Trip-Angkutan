import { api, type ApiError } from './api'
import {
  findOfficer as findOfflineOfficer,
  hashPin,
  saveOfficers,
  setPinHash,
  verifyPin as verifyStoredPin,
} from './offlineDb'
import { findSeedOfficer } from './seedData'




export const SESSION_READY_EVENT = 'trip:session-ready'




const OFFICER_KEY = 'trip.auth.officer.v1'
const DERMAGA_KEY = 'trip.auth.dermaga.v1'
const ROUTES_KEY = 'trip.auth.routes.v1'
const AUTH_TIMEOUT_MS = 4000




const MEMBER_CRED_KEY = 'trip.memberCredential.v1'




export interface Dermaga {
  id: string
  name: string
  code: string
  region_name: string
  region_code: string
}




export interface Route {
  id: string
  name: string
  route_from: string
  route_to: string
  distance?: string
  duration?: string
}




export interface StoredOfficer {
  id: string
  name: string
  regionId: string
  regionName: string
  regionCode: string
  dermagaAccess?: Array<{ id: string; name: string; code: string; region_id?: string }>
}




export interface LoginResponse {
  token: string
  officer: StoredOfficer
  dermagas?: Dermaga[]
  routes?: Record<string, Route[]>
  isDualAccess?: boolean
}




export interface UiRoute {
  code: string
  from: string
  to: string
  label: string
  distance?: string
  duration?: string
  dermagaId?: string
}




function isValidRoute(r: unknown): r is Route {
  return typeof r === 'object' && r !== null && !!(r as Route).id && !!(r as Route).name
}




function saveRoutesMap(map: Record<string, Route[]>): void {
  const clean: Record<string, Route[]> = {}
  if (map && typeof map === 'object') {
    for (const [k, list] of Object.entries(map)) {
      if (!k || !Array.isArray(list)) continue
      const filtered = list.filter(isValidRoute)
      if (filtered.length) clean[k] = filtered
    }
  }
  try { localStorage.setItem(ROUTES_KEY, JSON.stringify(clean)) }
  catch { /* quota */ }
}




export function getStoredRoutes(): UiRoute[] {
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, Route[]>
    const out: UiRoute[] = []
    for (const [dermagaId, list] of Object.entries(map)) {
      for (const route of list || []) {
        if (!route?.route_from || !route?.route_to) continue
        const code = `${route.route_from}-${route.route_to}`
        if (out.some(item => item.code === code && item.dermagaId === dermagaId)) continue
        out.push({
          code,
          from: route.route_from,
          to: route.route_to,
          label: route.name || `${route.route_from} → ${route.route_to}`,
          distance: route.distance || undefined,
          duration: route.duration || undefined,
          dermagaId,
        })
      }
    }
    return out
  } catch {
    return []
  }
}




export async function refreshStoredRoutes(): Promise<UiRoute[] | null> {
  const result = await api.get<(Route & { dermaga_id: string })[]>('/routes/mine')
  if (!result.ok || !result.data) return null

  const map: Record<string, Route[]> = {}
  for (const r of result.data) {
    if (!map[r.dermaga_id]) map[r.dermaga_id] = []
    map[r.dermaga_id].push({
      id: r.id,
      name: r.name,
      route_from: r.route_from,
      route_to: r.route_to,
      distance: r.distance,
      duration: r.duration,
    })
  }
  saveRoutesMap(map)
  return getStoredRoutes()
}




export function hasDockScopedRoutes(): boolean {
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    if (!raw) return !!getStoredDermaga()
    const map = JSON.parse(raw) as Record<string, Route[]>
    return !!getStoredDermaga() || Object.keys(map).length > 0
  } catch {
    return !!getStoredDermaga()
  }
}




export function getStoredOfficer(): StoredOfficer | null {
  try {
    const raw = localStorage.getItem(OFFICER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}




export function getStoredDermaga(): Dermaga | null {
  try {
    const raw = localStorage.getItem(DERMAGA_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}




function saveOfficer(officer: StoredOfficer) {
  try {
    localStorage.setItem(OFFICER_KEY, JSON.stringify(officer))
  } catch { /* quota */ }
}




function saveDermaga(dermaga: Dermaga) {
  try {
    localStorage.setItem(DERMAGA_KEY, JSON.stringify(dermaga))
  } catch { /* quota */ }
}




function clearOfficer() {
  try {
    localStorage.removeItem(OFFICER_KEY)
    localStorage.removeItem(DERMAGA_KEY)
    evictPinCache()
  } catch { /* quota */ }
}




export async function memberLogin(
  username: string,
  password: string
): Promise<{ success: boolean; error?: string; officer?: StoredOfficer }> {
  const result = await api.post<LoginResponse>('/auth/member-login', { username, password }, AUTH_TIMEOUT_MS)

  if (!result.ok || !result.data) {
    if (isNetworkError(result.error)) {
      const offline = await loginOffline(username, password)
      if (offline.success) return { success: true, officer: offline.officer }
      return { success: false, error: 'Server tidak terjangkau dan data petugas belum tersimpan di perangkat.' }
    }
    return { success: false, error: result.error?.message || 'Backend unreachable' }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)
  const memberKey = `member:${result.data.officer.id}`
  await setPinHash(memberKey, await hashPin(memberKey, password))

  // clear cache geofence - only fresh data for this officer
  void import('./geofence').then(m => m.purgeGeofenceCache()).catch(() => {})

  void cacheDockOfficers(result.data.officer.id, result.data.dermagas)
  // ponytail: dermaga aktif + rute WAJIB tersimpan saat login — geofence dan
  // validasi trip membaca keduanya dari localStorage. Satu dermaga = langsung
  // jadi aktif (tanpa ini getStoredDermaga() kosong dan filter per-dermaga
  // tidak jalan). Rute di-await (dibatasi timeout) agar penugasan siap dipakai.
  if (result.data.dermagas?.length === 1) saveDermaga(result.data.dermagas[0])
  await refreshStoredRoutes().catch(() => null)

  return { success: true, officer: result.data.officer }
}




function isNetworkError(err?: ApiError): boolean {
  if (!err) return true
  if (err.code === 'NETWORK' || err.code === 'TIMEOUT' || /^5\d\d$/.test(err.code ?? '')) return true
  if (err.code) return false
  return /timeout|network|failed to fetch|terjangkau|offline|merespon|unreachable/i.test(err.message)
}




export async function loginWithPin(
  officerId: string,
  pin: string,
): Promise<{ success: boolean; error?: ApiError; data?: LoginResponse; offline?: boolean }> {
  const result = await api.post<LoginResponse>('/auth/login', { officerId, pin }, AUTH_TIMEOUT_MS)

  if (!result.ok || !result.data) {
    if (isNetworkError(result.error)) {
      const offline = await loginOffline(officerId, pin)
      if (offline.success && offline.session) {
        return { success: true, offline: true, data: offline.session }
      }
      return {
        success: false,
        error: { message: 'Server tidak terjangkau — PIN tidak dapat diverifikasi.' },
      }
    }
    return { success: false, error: result.error }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)
  void cachePin(officerId, pin)

  // clear cache geofence - only fresh data for this officer
  void import('./geofence').then(m => m.purgeGeofenceCache()).catch(() => {})

  void cacheDockOfficers(String(result.data.officer?.id ?? officerId), result.data.dermagas)

  if (result.data.routes) saveRoutesMap(result.data.routes)

  if (result.data.dermagas?.length === 1) saveDermaga(result.data.dermagas[0])

  return { success: true, data: result.data }
}




export interface OfflineOfficerRecord {
  id: string
  name: string
  username?: string
  region?: string
  regions?: string[]
  regionId?: string
  regionName?: string
  regionCode?: string
  status?: string
  pin?: string
  dermagaAccess?: Array<{ id: string; name: string; code: string; region_id?: string }>
}




function findStoredOfficerRecord(identifier: string): OfflineOfficerRecord | null {
  const key = String(identifier).toLowerCase()
  const pools: OfflineOfficerRecord[][] = []
  const read = (k: string): OfflineOfficerRecord[] => {
    try {
      const raw = localStorage.getItem(k)
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list : []
    } catch { return [] }
  }
  pools.push(read('trip.officers.v1'))
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('trip.dermaga.officers.')) pools.push(read(k))
    }
  } catch { /* ignore */ }

  for (const pool of pools) {
    const hit = pool.find(o =>
      String(o.id) === String(identifier) ||
      String(o.username ?? '').toLowerCase() === key ||
      String(o.name ?? '').toLowerCase() === key,
    )
    if (hit) return hit
  }
  return null
}




function seedToRecord(identifier: string): OfflineOfficerRecord | null {
  const s = findSeedOfficer(identifier)
  if (!s) return null
  return {
    id: s.id,
    username: s.username,
    name: s.name,
    region: s.regionCode,
    regionId: s.regionId,
    regionName: s.regionName,
    regionCode: s.regionCode,
    status: (s.isActive ?? 1) === 1 ? 'Aktif' : 'Nonaktif',
    dermagaAccess: s.dermagaAccess,
  }
}




async function buildOfflineSession(identifier: string): Promise<LoginResponse | null> {
  let row: OfflineOfficerRecord | null = null
  try { row = await findOfflineOfficer<OfflineOfficerRecord>(identifier) } catch { row = null }
  if (!row) row = findStoredOfficerRecord(identifier)
  if (!row) row = seedToRecord(identifier)
  if (!row) return null
  if (row.status && /^(nonaktif|non-aktif|inactive)$/i.test(String(row.status))) return null

  const roster = findStoredOfficerRecord(String(row.id))
  const access = row.dermagaAccess?.length ? row.dermagaAccess : roster?.dermagaAccess
  const region = String(row.region ?? row.regionCode ?? row.regionId ?? '')
  const officer: StoredOfficer = {
    id: String(row.id ?? identifier),
    name: String(row.name ?? ''),
    regionId: String(row.regionId ?? region),
    regionName: String(row.regionName ?? region),
    regionCode: String(row.regionCode ?? region),
    dermagaAccess: access ?? [],
  }
  saveOfficer(officer)
  api.setToken(null)
  try { localStorage.removeItem(DERMAGA_KEY) } catch {}
  if (access?.length === 1) {
    const dock = access[0]
    saveDermaga({
      id: dock.id,
      name: dock.name,
      code: dock.code,
      region_name: officer.regionName,
      region_code: officer.regionCode,
    })
  }
  return { token: '', officer }
}




export async function loginOffline(
  identifier: string,
  pin: string,
): Promise<{ success: boolean; officer?: StoredOfficer; session?: LoginResponse }> {
  if (!identifier || !pin) return { success: false }
  const ok = await verifyPinOffline(identifier, pin)
  if (!ok) return { success: false }
  const session = await buildOfflineSession(identifier)
  if (!session) return { success: false }
  return { success: true, officer: session.officer, session }
}




export async function selectDermaga(dermagaId: string): Promise<{ success: boolean; error?: string }> {
  const result = await api.post<{ dermaga: Dermaga; routes: Route[] }>('/auth/select-dermaga', { dermagaId })

  if (!result.ok || !result.data) {
    return { success: false, error: result.error?.message }
  }

  saveDermaga(result.data.dermaga)
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    const map: Record<string, Route[]> = raw ? JSON.parse(raw) : {}
    map[result.data.dermaga.id] = result.data.routes || []
    saveRoutesMap(map)
  } catch { /* quota */ }
  return { success: true, error: undefined }
}




export async function selectDermagaLocal(
  dermagaId: string,
  opts?: { name?: string; code?: string; regionName?: string; regionCode?: string },
): Promise<{ success: boolean; error?: string }> {
  if (!dermagaId) return { success: false, error: 'ID dermaga kosong' }
  const officer = getStoredOfficer()
  const fromAccess = officer?.dermagaAccess?.find(d => String(d.id) === String(dermagaId))
  const name = opts?.name ?? fromAccess?.name ?? ''
  const code = opts?.code ?? fromAccess?.code ?? ''
  const regionName = opts?.regionName ?? officer?.regionName ?? ''
  const regionCode = opts?.regionCode ?? officer?.regionCode ?? ''
  if (!name && !code) return { success: false, error: 'Dermaga tidak ditemukan di akses petugas' }
  saveDermaga({ id: String(dermagaId), name, code, region_name: regionName, region_code: regionCode })
  return { success: true, error: undefined }
}




export function logout() {
  api.setToken(null)
  clearOfficer()
  // buang sisa titik petugas lama — login berikut mulai bersih
  void import('./geofence').then(m => m.purgeGeofenceCache()).catch(() => {})
}




export async function refreshBackendSession(officerId?: string): Promise<boolean> {
  const id = officerId ?? getStoredOfficer()?.id
  if (!id || !(await ensureBackendSession(String(id)))) return false

  const result = await api.post<LoginResponse>('/auth/refresh', {})
  if (result.ok && result.data?.token && String(result.data.officer?.id) === String(id)) {
    api.setToken(result.data.token)
    saveOfficer(result.data.officer)
    return true
  }

  return false
}




function jwtPayload(): { role?: string; officerId?: string | number } | null {
  const token = api.token
  if (!token) return null
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return null
  }
}




function jwtExpiryMs(token?: string | null): number | null {
  const t = token ?? api.token
  if (!t) return null
  try {
    const base64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64)) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}




export async function renewSessionIfNeeded(): Promise<boolean> {
  if (!(await ensureBackendSession())) return false

  const exp = jwtExpiryMs(api.token)
  if (exp === null || Date.now() < exp - 60_000) return true

  const r = await api.post<{ token?: string; officer?: StoredOfficer }>('/auth/refresh', {})
  if (r.ok && r.data?.token) {
    api.setToken(r.data.token)
    if (r.data.officer) saveOfficer(r.data.officer)
    return true
  }
  // ponytail: refresh gagal (mis. officer dinonaktifkan) = biarkan token apa
  // adanya dan lanjut pakai cache lokal. Menghapus token di sini dulu membuat
  // sesi mati permanen tanpa bisa dipulihkan ("session renewal failed").
  return false
}


export async function isSessionReady(): Promise<boolean> {
  if (!api.isAuthenticated) return false
  if (!(await ensureBackendSession())) return false
  const exp = jwtExpiryMs(api.token)
  if (exp === null) return false
  return Date.now() < exp
}




export async function ensureBackendSession(officerId?: string): Promise<boolean> {
  const stored = getStoredOfficer()
  const id = officerId ?? stored?.id
  const payload = jwtPayload()
  if (!id || String(stored?.id) !== String(id) || !payload?.officerId ||
      payload.role === 'admin' || String(payload.officerId) !== String(id)) {
    if (api.isAuthenticated) api.setToken(null)
    return false
  }
  return api.isAuthenticated
}

const LEGACY_PIN_KEY = 'trip.auth.pin.v1'




function loadLegacyPinMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LEGACY_PIN_KEY) ?? '{}') }
  catch { return {} }
}




async function cachePin(officerId: string, pin: string): Promise<void> {
  if (!officerId || !pin) return
  try {
    await setPinHash(officerId, await hashPin(officerId, pin))
    const legacy = loadLegacyPinMap()
    if (officerId in legacy) {
      delete legacy[officerId]
      const keys = Object.keys(legacy)
      if (keys.length) localStorage.setItem(LEGACY_PIN_KEY, JSON.stringify(legacy))
      else localStorage.removeItem(LEGACY_PIN_KEY)
    }
  } catch { /* quota */ }
}




export async function verifyPinOffline(identifier: string, pin: string): Promise<boolean> {
  if (!identifier || !pin) return false

  let officerId = String(identifier)
  let resolved = false
  let inactive = false
  try {
    const row = await findOfflineOfficer<OfflineOfficerRecord & { isActive?: boolean; is_active?: number; payload?: { status?: string } }>(identifier)
    if (row?.id) { officerId = String(row.id); resolved = true }
    const status = row?.status ?? row?.payload?.status
    if (status && /^(nonaktif|non-aktif|inactive)$/i.test(String(status))) inactive = true
    if (row?.isActive === false || row?.is_active === 0) inactive = true
  } catch { /* database offline belum siap */ }

  const storedRecord = findStoredOfficerRecord(identifier)
  if (!resolved && storedRecord?.id) { officerId = String(storedRecord.id); resolved = true }
  if (storedRecord && storedRecord.status && /^(nonaktif|non-aktif|inactive)$/i.test(String(storedRecord.status))) inactive = true
  if (inactive) return false

  try { localStorage.removeItem(MEMBER_CRED_KEY) } catch {}

  try {
    if (await verifyStoredPin(officerId, pin) || await verifyStoredPin(`member:${officerId}`, pin)) return true
  } catch { /* lanjut ke fallback legacy */ }

  const legacy = loadLegacyPinMap()
  const stored = legacy[officerId] ?? legacy[identifier]
  if (stored && (stored === pin || stored === `plain:${pin}`)) {
    await cachePin(officerId, pin)
    return true
  }

  // TIDAK ada jalur PIN dari seedData: PIN default yang ter-bundle di klien adalah
  // temuan F001 (login offline "123456" tanpa server). Verifikasi hanya lewat
  // credential hasil sinkron server (verifyStoredPin di atas) atau server online.
  return false
}




function evictPinCache() {
  try { localStorage.removeItem(LEGACY_PIN_KEY) } catch { /* quota */ }
}




interface RosterOfficer {
  id: string | number
  name: string
  username?: string | null
  region_id?: string
  region_name?: string
  region_code?: string
  regions?: Array<{ id: string; name: string; code: string }>
  dermagas?: Array<{ id: string; name: string; code: string; region_id?: string }>
  is_active?: number | boolean
  pin_hash?: string
}




function toStoredOfficer(o: RosterOfficer): StoredOfficer & { username?: string; status?: string } {
  const primary = o.regions?.[0]
  return {
    id: String(o.id),
    name: String(o.name ?? ''),
    username: o.username ?? undefined,
    regionId: String(o.region_id ?? primary?.id ?? ''),
    regionName: String(o.region_name ?? primary?.name ?? ''),
    regionCode: String(o.region_code ?? primary?.code ?? ''),
    status: o.is_active === 0 || o.is_active === false ? 'Nonaktif' : 'Aktif',
  } as StoredOfficer & { username?: string; status?: string }
}




async function persistRoster(officers: RosterOfficer[], dermagaIds: string[]): Promise<void> {
  if (!officers.length) return
  const shaped = officers.map(toStoredOfficer)

  try {
    await saveOfficers(officers.map((o, i) => ({
      id: String(o.id),
      username: o.username ?? undefined,
      name: shaped[i].name,
      regionId: shaped[i].regionId,
      regionName: shaped[i].regionName,
      regionCode: shaped[i].regionCode,
      isActive: o.is_active === undefined ? true : Boolean(o.is_active),
      payload: shaped[i],
    })))
    for (const o of officers) {
      if (o.pin_hash) void setPinHash(String(o.id), o.pin_hash)
    }
  } catch { /* db belum siap — cache di bawah tetap jalan */ }

  for (const did of dermagaIds) {
    const subset = officers.filter(o => (o.dermagas ?? []).some(d => String(d.id) === String(did)))
    if (!subset.length) continue
    const key = `trip.dermaga.officers.${did}`
    try {
      const prevRaw = localStorage.getItem(key)
      const prev = prevRaw ? JSON.parse(prevRaw) : []
      const merged: Array<Record<string, unknown>> = Array.isArray(prev) ? prev : []
      for (const o of subset) {
        const s = toStoredOfficer(o) as unknown as Record<string, unknown>
        const i = merged.findIndex(x => String(x['id']) === String(s['id']))
        if (i >= 0) merged[i] = { ...merged[i], ...s }
        else merged.push(s)
      }
      localStorage.setItem(key, JSON.stringify(merged))
    } catch { /* quota — data lama tetap aman */ }
  }
}




async function fetchMyRegionRoster(): Promise<RosterOfficer[] | null> {
  const r = await api.get<RosterOfficer[]>('/officers/my-region')
  if (!r.ok || !Array.isArray(r.data)) return null
  return r.data
}




export async function cacheDockOfficers(
  officerId?: string,
  dermagas?: Array<{ id: string }>,
): Promise<void> {
  try {
    const id = String(officerId ?? getStoredOfficer()?.id ?? '')
    const dockIds = new Set<string>((dermagas ?? []).map(d => String(d.id)))

    const all = await fetchMyRegionRoster()
    if (all?.length) {
      const me = all.find(o => String(o.id) === id)
      for (const d of me?.dermagas ?? []) dockIds.add(String(d.id))

      const mates = all.filter(o => (o.dermagas ?? []).some(d => dockIds.has(String(d.id))))
      const list = me && !mates.some(m => String(m.id) === String(me.id))
        ? [me, ...mates]
        : mates

      if (list.length) {
        await persistRoster(list, [...dockIds])
        return
      }
      await persistRoster(all, [])
      return
    }

    for (const did of dockIds) await syncDermagaOfficersToDb(did)
  } catch { /* offline — cache sebelumnya tetap aman */ }
}




export async function syncDermagaOfficersToDb(dermagaId?: string): Promise<void> {
  if (!dermagaId) return
  try {
    const r = await api.get<{ officers?: RosterOfficer[] }>(`/dermagas/${dermagaId}/officers`)
    if (r.ok && r.data?.officers?.length) {
      await persistRoster(r.data.officers, [String(dermagaId)])
      return
    }
    if (r.error?.code === '404') {
      const all = await fetchMyRegionRoster()
      const subset = (all ?? []).filter(o =>
        (o.dermagas ?? []).some(d => String(d.id) === String(dermagaId)))
      if (subset.length) await persistRoster(subset, [String(dermagaId)])
    }
  } catch { /* offline — data sebelumnya tetap aman */ }
}
