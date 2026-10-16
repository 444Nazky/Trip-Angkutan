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



// ponytail: kredensial login TERAKHIR yang sukses, dipakai untuk "login diam-diam"
// saat token hilang/kedaluwarsa (server tidak lagi melempar petugas ke halaman login
// ketika sync geofence gagal). Permintaan operasional: "bekerja dulu, keamanan belakangan".
// TODO-security: simpan hanya hash + refresh token, jangan PIN/password polos.
const LOGIN_CRED_KEY = 'trip.auth.lastCredential.v1'



type StoredLoginCredential =
  | { kind: 'pin'; officerId: string; pin: string }
  | { kind: 'member'; username: string; password: string }




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



// ponytail: sesi officer WAJIB memuat dermagaAccess. Respons beberapa endpoint login
// hanya mengirim `dermagas` terpisah (bukan di dalam officer), sehingga sesi tersimpan
// kehilangan akses dermaga → penarikan geofence jatuh ke master (titik semua region)
// dan filter per-dermaga tidak jalan. Isi dari argumen, lalu dari roster lokal.
function enrichOfficerWithDermagaAccess(
  officer: StoredOfficer,
  dermagas?: Array<{ id: string; name?: string; code?: string; region_id?: string }>,
): StoredOfficer {
  const fromArgs = (dermagas ?? [])
    .map(d => ({ id: String(d.id), name: String(d.name ?? ''), code: String(d.code ?? ''), region_id: d.region_id }))
    .filter(d => d.id)
  if (fromArgs.length) return { ...officer, dermagaAccess: fromArgs }
  if (officer.dermagaAccess?.length) return officer
  const roster = findStoredOfficerRecord(String(officer.id))
  const fromRoster = roster?.dermagaAccess ?? []
  return fromRoster.length ? { ...officer, dermagaAccess: fromRoster } : officer
}



// Tambahkan satu dermaga ke akses sesi bila belum ada (dipakai saat petugas memilih
// dermaga) supaya penarikan geofence ikut mencakup dermaga yang benar-benar dipakai.
function addDermagaToStoredOfficer(dock: { id: string; name?: string; code?: string; region_id?: string }): void {
  const officer = getStoredOfficer()
  if (!officer || !dock?.id) return
  const id = String(dock.id)
  if ((officer.dermagaAccess ?? []).some(d => String(d.id) === id)) return
  saveOfficer({
    ...officer,
    dermagaAccess: [
      ...(officer.dermagaAccess ?? []),
      { id, name: String(dock.name ?? ''), code: String(dock.code ?? ''), region_id: dock.region_id },
    ],
  })
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
    localStorage.removeItem(LOGIN_CRED_KEY)
    evictPinCache()
  } catch { /* quota */ }
}



// Titik geofence hanya dibuang saat GANTI petugas — bukan setiap login. Dulu purge
// di tiap login + sync yang gagal = perangkat berakhir TANPA titik selamanya
// ("Belum ada titik geofence tersimpan") padahal admin sudah menyimpan titik.
function purgeGeofenceOnlyIfOfficerChanged(prevOfficerId?: string | null, nextOfficerId?: string | null): void {
  if (prevOfficerId && nextOfficerId && String(prevOfficerId) === String(nextOfficerId)) return
  if (!prevOfficerId) return
  void import('./geofence').then(m => m.purgeGeofenceCache()).catch(() => {})
}



function cacheLoginCredential(cred: StoredLoginCredential): void {
  try { localStorage.setItem(LOGIN_CRED_KEY, JSON.stringify(cred)) } catch { /* quota */ }
}



function getLoginCredential(): StoredLoginCredential | null {
  try {
    const raw = localStorage.getItem(LOGIN_CRED_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredLoginCredential
    if (!parsed || (parsed.kind !== 'pin' && parsed.kind !== 'member')) return null
    return parsed
  } catch { return null }
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

  const prevOfficerId = getStoredOfficer()?.id ?? null
  api.setToken(result.data.token)
  saveOfficer(result.data.officer)
  cacheLoginCredential({ kind: 'member', username, password })
  const memberKey = `member:${result.data.officer.id}`
  await setPinHash(memberKey, await hashPin(memberKey, password))

  // Ganti petugas = mulai bersih; login ulang petugas yang sama TIDAK menghapus
  // titik geofence (dulu terhapus lalu sync gagal → perangkat kosong permanen).
  purgeGeofenceOnlyIfOfficerChanged(prevOfficerId, result.data.officer.id)

  void cacheDockOfficers(result.data.officer.id, result.data.dermagas)
    // roster (berisi dermagas) baru tersedia setelah cache selesai → lengkapi sesi
    .then(() => {
      const cur = getStoredOfficer()
      if (cur) saveOfficer(enrichOfficerWithDermagaAccess(cur))
    })
    .catch(() => null)
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

  const prevOfficerId = getStoredOfficer()?.id ?? null
  api.setToken(result.data.token)
  saveOfficer(enrichOfficerWithDermagaAccess(result.data.officer, result.data.dermagas))
  cacheLoginCredential({ kind: 'pin', officerId, pin })
  void cachePin(officerId, pin)

  purgeGeofenceOnlyIfOfficerChanged(prevOfficerId, result.data.officer?.id ?? officerId)

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
  // ponytail: dulu di sini token DIHAPUS dan dermaga aktif DIHAPUS — akibatnya
  // setelah login offline aplikasi mengira "belum login": sync geofence selalu
  // `session renewal failed` dan filter per-dermaga ikut hilang. Sekarang sesi
  // dipertahankan bila petugasnya sama; hanya dibersihkan saat GANTI petugas.
  const prev = getStoredOfficer()
  const sameOfficer = !!prev?.id && String(prev.id) === String(officer.id)
  saveOfficer(officer)
  if (!sameOfficer) {
    api.setToken(null)
    try { localStorage.removeItem(DERMAGA_KEY) } catch { /* quota */ }
  }
  const accessIds = new Set((access ?? []).map(d => String(d.id)))
  const storedDock = getStoredDermaga()
  if (storedDock && !accessIds.has(String(storedDock.id))) {
    try { localStorage.removeItem(DERMAGA_KEY) } catch { /* quota */ }
  }
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
  return { token: api.token ?? '', officer }
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
  // id ter-resolve (bukan username yang diketik) supaya login-diam-diam nanti tepat
  cacheLoginCredential({ kind: 'pin', officerId: String(session.officer.id), pin })
  return { success: true, officer: session.officer, session }
}




export async function selectDermaga(dermagaId: string): Promise<{ success: boolean; error?: string }> {
  const result = await api.post<{ dermaga: Dermaga; routes: Route[] }>('/auth/select-dermaga', { dermagaId })

  if (!result.ok || !result.data) {
    return { success: false, error: result.error?.message }
  }

  saveDermaga(result.data.dermaga)
  addDermagaToStoredOfficer(result.data.dermaga)
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
  addDermagaToStoredOfficer({ id: String(dermagaId), name, code })
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




// ponytail: „login diam-diam" — pakai kredensial login terakhir yang tersimpan di
// localStorage untuk mengambil token baru TANPA meminta petugas mengetik ulang PIN.
// Ini jalur pemulihan yang dulu tidak ada: sync geofence hanya mencoba renew saat
// token kosong, sementara renew sendiri mensyaratkan token valid (mustahil) →
// perangkat terjebak `session renewal failed` selamanya.
async function silentReLogin(): Promise<boolean> {
  const cred = getLoginCredential()
  if (!cred) return false
  try {
    if (cred.kind === 'member') {
      const r = await api.post<LoginResponse>('/auth/member-login', { username: cred.username, password: cred.password }, AUTH_TIMEOUT_MS)
      if (!r.ok || !r.data?.token) return false
      api.setToken(r.data.token)
      saveOfficer(r.data.officer)
      return true
    }
    const r = await api.post<LoginResponse>('/auth/login', { officerId: cred.officerId, pin: cred.pin }, AUTH_TIMEOUT_MS)
    if (!r.ok || !r.data?.token) return false
    api.setToken(r.data.token)
    saveOfficer(r.data.officer)
    return true
  } catch {
    return false
  }
}


export async function renewSessionIfNeeded(): Promise<boolean> {
  // Token kosong bukan jalan buntu lagi: coba login diam-diam dari kredensial lokal.
  if (!api.isAuthenticated) {
    if (!(await silentReLogin())) return false
  }

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
  if (!api.isAuthenticated) {
    if (!(await silentReLogin())) return false
  }
  if (!(await ensureBackendSession())) return false
  const exp = jwtExpiryMs(api.token)
  // tanpa `exp` (token petugas lama/polos) dianggap tetap siap — sesi tidak expired
  if (exp === null) return true
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
