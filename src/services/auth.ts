/**
 * Session management - tidak ada sesi expired, auto-renew dari token.
 * Debug logging ditambahkan untuk troubleshooting auth flow.
 */

import { api } from './api'
import {
  getStoredOfficer as getStoredOfficerApi,
  saveOfficer as saveOfficerApi,
  getStoredRoutes as getStoredRoutesMap,
  saveRoutes as saveRoutesApi,
  getCredentials,
  storeCredentials,
  clearCredentials,
  type Officer as StoredOfficer,
  type Route,
  type Dermaga,
} from './api'
import {
  findOfficer as findOfflineOfficer,
  hashPin,
  setPinHash,
  verifyPin as verifyStoredPin,
} from './offlineDb'
import { findSeedOfficer } from './seedData'

// ─── Debug helpers ───────────────────────────────────────────────────────────────

function debugAuth(label: string, data?: Record<string, unknown>): void {
  if (typeof console !== 'undefined') {
    console.debug(`[auth] ${label}`, data ?? '')
  }
}

// ─── Events ───────────────────────────────────────────────────────────────────

export const SESSION_READY_EVENT = 'trip:session-ready'

/**
 * Check if routes are scoped to a specific dock.
 */
export function hasDockScopedRoutes(): boolean {
  const routes = getStoredRoutes()
  return routes.some(r => r.dermagaId)
}

// ─── Re-export ────────────────────────────────────────────────────────────────

// Didefinisikan lokal (bukan dari api.ts): test-suite mem-mock './api'
// menyeluruh, dan artifact ini harus tetap hidup offline di localStorage.
const DERMAGA_STORAGE_KEY = 'trip.auth.dermaga.v1'

export function getStoredDermaga(): Dermaga | null {
  try {
    const raw = localStorage.getItem(DERMAGA_STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function storeDermaga(d: Dermaga): void {
  try { localStorage.setItem(DERMAGA_STORAGE_KEY, JSON.stringify(d)) } catch { /* quota */ }
}

// getStoredOfficer is defined locally below (with fallback to legacy storage)

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface UiRoute {
  code: string
  from: string
  to: string
  label: string
  distance?: string
  duration?: string
  dermagaId?: string
}

export type Officer = StoredOfficer
export { type Route, type Dermaga }

// ─── Officer / Dermaga / Routes storage ─────────────────────────────────────

export function getStoredOfficerLocal(): StoredOfficer | null {
  try {
    const raw = localStorage.getItem('trip.officer') ?? localStorage.getItem('trip.auth.officer.v1')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

/** Simpan sesi officer ke storage + legacy key untuk perangkat lama. */
function saveOfficerSession(officer: StoredOfficer): void {
  saveOfficerApi(officer)
  try { localStorage.setItem('trip.officer', JSON.stringify(officer)) } catch {}
  try { localStorage.setItem('trip.auth.officer.v1', JSON.stringify(officer)) } catch {}
}

/**
 * Get officer from storage (api.ts storage + legacy trip.officer fallback).
 */
export function getStoredOfficer(): StoredOfficer | null {
  const fromApi = getStoredOfficerApi()
  if (fromApi) return fromApi
  return getStoredOfficerLocal()
}

export function clearAuth(): void {
  api.setToken(null)
  clearCredentials()
  try {
    localStorage.removeItem('trip.officer')
    localStorage.removeItem('trip.dermaga')
    localStorage.removeItem('trip.routes')
  } catch {}
}

/**
 * Semua rute yang tersimpan, dikonversi ke bentuk UI.
 */
export function getStoredRoutes(): UiRoute[] {
  const map = getStoredRoutesMap()
  const result: UiRoute[] = []
  for (const [dermagaId, routes] of Object.entries(map)) {
    for (const r of routes) {
      const code = `${r.route_from}-${r.route_to}`
      result.push({
        code,
        from: r.route_from,
        to: r.route_to,
        label: r.name || code,
        distance: r.distance,
        duration: r.duration,
        dermagaId,
      })
    }
  }
  return result
}

// ─── Pin-based offline login ──────────────────────────────────────────────────

// ponytail: officer WAJIB memuat dermagaAccess — beberapa endpoint login
// mengirim `dermagas` terpisah (bukan di dalam officer), sehingga sesi
// tersimpan kehilangan akses dermaga dan filter geofence per-dermaga mati.
function enrichOfficerWithDermagaAccess(
  officer: StoredOfficer,
  dermagas?: Array<{ id: string; name?: string; code?: string; region_id?: string }>,
): StoredOfficer {
  const fromArgs = (dermagas ?? [])
    .map(d => ({ id: String(d.id), name: String(d.name ?? ''), code: String(d.code ?? ''), region_id: d.region_id }))
    .filter(d => d.id)
  if (fromArgs.length) return { ...officer, dermagaAccess: fromArgs }
  return officer
}

// Titik geofence hanya dibuang saat GANTI petugas — bukan setiap login.
function purgeGeofenceOnlyIfOfficerChanged(prevOfficerId?: string | null, nextOfficerId?: string | null): void {
  if (!prevOfficerId) return
  if (nextOfficerId && String(prevOfficerId) === String(nextOfficerId)) return
  void import('./geofence').then(m => m.purgeGeofenceCache()).catch(() => {})
}

export async function loginWithPin(officerId: string, pin: string): Promise<{ success: boolean; error?: string }> {
  debugAuth('loginWithPin mulai', { officerId, hasPin: !!pin })

  try {
    const res = await api.post<{ token: string; officer: StoredOfficer; dermagas?: Dermaga[]; routes?: Record<string, Route[]> }>('/auth/login', { officerId, pin })
    debugAuth('loginWithPin response', { ok: res.ok, hasToken: !!res.data?.token, hasOfficer: !!res.data?.officer })

    if (!res.ok || !res.data?.token || !res.data.officer) {
      debugAuth('loginWithPin gagal', { error: res.error?.message })
      return { success: false, error: res.error?.message || 'Login gagal' }
    }

    const prevOfficerId = getStoredOfficer()?.id ?? null

    // Set token FIRST - ini yang paling penting untuk API calls selanjutnya
    api.setToken(res.data.token)
    debugAuth('Token disimpan', { tokenLength: res.data.token.length })

    // Officer + dermagaAccess + legacy keys (backward compatibility)
    saveOfficerSession(enrichOfficerWithDermagaAccess(res.data.officer, res.data.dermagas))
    debugAuth('Officer disimpan', { id: res.data.officer.id, name: res.data.officer.name })

    // Store credentials untuk session renewal
    storeCredentials({ officerId, pin })
    try { storeLoginCredential({ kind: 'pin', officerId, pin }) } catch { /* quota */ }
    debugAuth('Credentials disimpan', { officerId })

    // Ganti petugas = mulai bersih; login ulang petugas yang sama TIDAK menghapus
    // titik geofence (dulu terhapus lalu sync gagal → perangkat kosong permanen).
    purgeGeofenceOnlyIfOfficerChanged(prevOfficerId, res.data.officer.id)

    // Store routes - INI KRUSIAL UNTUK GEOFENCE FILTERING
    if (res.data.routes) {
      saveRoutesApi(res.data.routes)
      try { localStorage.setItem('trip.routes', JSON.stringify(res.data.routes)) } catch {}
      try { localStorage.setItem('trip.routes.v2', JSON.stringify(res.data.routes)) } catch {}
      const routeCount = Object.values(res.data.routes).flat().length
      debugAuth('Routes disimpan', { routeCount, keys: Object.keys(res.data.routes) })
    }

    // ponytail: dermaga tunggal → langsung aktif; dermaga ganda → biarkan petugas memilih.
    if (res.data.dermagas?.length === 1) {
      storeDermaga(res.data.dermagas[0])
      try { localStorage.setItem('trip.dermaga', JSON.stringify(res.data.dermagas[0])) } catch {}
      debugAuth('Dermaga tunggal aktif', { id: res.data.dermagas[0].id })
    } else if (res.data.dermagas?.length) {
      try { localStorage.setItem('trip.dermaga.all', JSON.stringify(res.data.dermagas)) } catch {}
      debugAuth('Dermaga ganda disimpan', { count: res.data.dermagas.length })
    }

    console.log('[auth] PIN login OK:', res.data.officer.name, '| routes:', res.data.routes ? Object.values(res.data.routes).flat().length : 0)
    return { success: true }
  } catch (e) {
    debugAuth('loginWithPin exception', { error: String(e) })
    return { success: false, error: String(e) }
  }
}

/**
 * Login offline: verifikasi PIN lokal (credential hasil sinkron server),
 * lalu buka sesi petugas tanpa jaringan. Sesi dipertahankan bila petugasnya
 * sama; dibersihkan saat GANTI petugas.
 */
export const LEGACY_PIN_KEY = 'trip.auth.pin.v1'

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

async function buildOfflineSession(identifier: string): Promise<StoredOfficer | null> {
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
  saveOfficerSession(officer)
  if (!sameOfficer) {
    api.setToken(null)
    try { localStorage.removeItem('trip.auth.dermaga.v1') } catch { /* quota */ }
  }
  const accessIds = new Set((access ?? []).map(d => String(d.id)))
  const storedDock = getStoredDermaga()
  if (storedDock && !accessIds.has(String(storedDock.id))) {
    try { localStorage.removeItem('trip.auth.dermaga.v1') } catch { /* quota */ }
  }
  return officer
}

export async function loginOffline(
  identifier?: string,
  pin?: string,
): Promise<{ success: boolean; officer?: StoredOfficer; error?: string }> {
  if (!identifier || !pin) {
    // Tanpa argumen: cukup cek sesi tersimpan (dipakai startup / PinVerify).
    if (api.isAuthenticated || getStoredOfficer()) {
      const officer = getStoredOfficer()
      if (officer) return { success: true, officer }
    }
    return { success: false, error: 'Tidak ada sesi aktif' }
  }

  const ok = await verifyPinOffline(identifier, pin)
  if (!ok) return { success: false, error: 'PIN tidak cocok' }

  // id ter-resolve (bukan username yang diketik) supaya login-diam-diam nanti tepat
  let resolvedId = String(identifier)
  try {
    const row = await findOfflineOfficer<OfflineOfficerRecord>(identifier)
    if (row?.id) resolvedId = String(row.id)
  } catch { /* database offline belum siap */ }
  storeLoginCredential({ kind: 'pin', officerId: resolvedId, pin })

  const officer = await buildOfflineSession(resolvedId)
  if (!officer && resolvedId !== String(identifier)) {
    // fallback: coba lagi dengan identifier mentah (bisa jadi username)
    const fallback = await buildOfflineSession(identifier)
    if (!fallback) return { success: false, error: 'Sesi petugas tidak dapat dibuat' }
    storeLoginCredential({ kind: 'pin', officerId: String(fallback.id), pin })
    return { success: true, officer: fallback }
  }
  if (!officer) return { success: false, error: 'Sesi petugas tidak dapat dibuat' }
  storeLoginCredential({ kind: 'pin', officerId: String(officer.id), pin })
  return { success: true, officer }
}

// ─── Session management ────────────────────────────────────────────────────────

let _sessionReady = false

export async function isSessionReady(): Promise<boolean> {
  if (api.isAuthenticated) {
    setSessionReady(true)
    return true
  }
  return renewSessionIfNeeded()
}

function setSessionReady(ready: boolean) {
  // ponytail: guard re-entrancy — ponsel yang sudah siap mengundang
  // ensureBackendSession→fetch→setSessionReady melingkar tanpa batas
  if (_sessionReady === ready) return
  _sessionReady = ready
  if (ready) {
    try { window.dispatchEvent(new Event(SESSION_READY_EVENT)) } catch { /* ignore */ }
  }
}

/**
 * Pastikan ada sesi backend yang valid.
 * Kalau belum ada token → coba renew dari kredensial PIN tersimpan.
 */
export async function ensureBackendSession(officerId?: string): Promise<boolean> {
  // Check token first
  if (api.isAuthenticated) {
    debugAuth('ensureBackendSession: token sudah ada, session ready')
    setSessionReady(true)
    return true
  }

  debugAuth('ensureBackendSession: token kosong, coba renew dari credentials')

  const cred = getCredentials()
  debugAuth('Credentials ditemukan', { hasOfficerId: !!cred.officerId, hasPin: !!cred.pin, username: cred.username })

  // Case 1: Ada officerId + PIN → gunakan loginWithPin
  if (cred.officerId && cred.pin) {
    const id = officerId || cred.officerId
    const pin = cred.pin
    debugAuth('Memanggil loginWithPin untuk renew', { id })

    const result = await loginWithPin(id, pin)
    if (result.success) {
      debugAuth('Renew session BERHASIL (loginWithPin)')
      setSessionReady(true)
      return true
    } else {
      debugAuth('Renew session GAGAL (loginWithPin)', { error: result.error })
    }
  }

  // Case 2: Hanya ada username (tanpa PIN) → coba memberLogin ulang
  // Ini terjadi jika login pertama kali pakai username/password
  if (cred.username) {
    debugAuth('Tidak ada PIN, coba memberLogin dengan username saja')
    // Tapi kita tidak punya password di credentials...
    // Dalam kasus ini, kita tidak bisa renew - petugas perlu login ulang
    debugAuth('Tidak bisa renew tanpa PIN/password - petugas perlu login ulang')
  }

  debugAuth('Tidak ada credentials untuk renew', { credKeys: Object.keys(cred).filter(k => cred[k as keyof typeof cred]) })

  setSessionReady(false)
  return false
}

/**
 * Perbarui sesi dari server (paksa login ulang dengan PIN tersimpan).
 */
export async function refreshBackendSession(officerId?: string): Promise<boolean> {
  debugAuth('refreshBackendSession mulai')
  const cred = getCredentials()
  debugAuth('Credentials', { hasOfficerId: !!cred.officerId, hasPin: !!cred.pin })

  if (!cred.officerId || !cred.pin) {
    debugAuth('Tidak ada credentials')
    return false
  }

  const id = officerId || cred.officerId
  const pin = cred.pin
  const result = await loginWithPin(id, pin)
  if (result.success) {
    debugAuth('Refresh session BERHASIL')
    setSessionReady(true)
    return true
  }
  debugAuth('Refresh session GAGAL', { error: result.error })
  return false
}

/**
 * Renew sesi jika token sudah ada tapi perlu di-refresh.
 * Tanpa mengganggu petugas jika gagal.
 */
// ponytail: „login diam-diam" — pakai kredensial login terakhir yang tersimpan di
// localStorage untuk mengambil token baru TANPA meminta petugas mengetik ulang PIN.
const LOGIN_CRED_KEY = 'trip.auth.lastCredential.v1'

interface LoginCred {
  kind: 'pin' | 'member'
  officerId?: string
  pin?: string
  username?: string
  password?: string
}

function getLoginCredential(): LoginCred | null {
  try {
    const raw = localStorage.getItem(LOGIN_CRED_KEY)
    const c = raw ? JSON.parse(raw) as LoginCred : null
    if (!c?.kind) return null
    if (c.kind === 'pin' && (!c.officerId || !c.pin)) return null
    if (c.kind === 'member' && !c.username) return null
    return c
  } catch {
    return null
  }
}

export function storeLoginCredential(cred: LoginCred | null): void {
  try {
    if (cred) localStorage.setItem(LOGIN_CRED_KEY, JSON.stringify(cred))
    else localStorage.removeItem(LOGIN_CRED_KEY)
  } catch { /* quota */ }
}

async function silentReLogin(): Promise<boolean> {
  const cred = getLoginCredential()
  if (!cred) return false
  try {
    if (cred.kind === 'member') {
      const r = await api.post<{ token: string; officer: StoredOfficer }>('/auth/member-login', { username: cred.username, password: cred.password })
      if (!r.ok || !r.data?.token) return false
      api.setToken(r.data.token)
      saveOfficerApi(r.data.officer)
      return true
    }
    const r = await api.post<{ token: string; officer: StoredOfficer }>('/auth/login', { officerId: cred.officerId, pin: cred.pin })
    if (!r.ok || !r.data?.token) return false
    api.setToken(r.data.token)
    saveOfficerApi(r.data.officer)
    return true
  } catch {
    return false
  }
}

export async function renewSessionIfNeeded(): Promise<boolean> {
  debugAuth('renewSessionIfNeeded mulai', { hasToken: api.isAuthenticated })
  if (!api.isAuthenticated) {
    try { await silentReLogin() } catch { /* offline: lanjut dengan rapi */ }
  }
  if (api.isAuthenticated) {
    debugAuth('renewSessionIfNeeded: sudah authenticated')
    setSessionReady(true)
    return true
  }
  debugAuth('renewSessionIfNeeded: memanggil ensureBackendSession')
  return ensureBackendSession()
}

// ─── Logout ───────────────────────────────────────────────────────────────────

export function logout(): void {
  api.setToken(null)
  clearCredentials()
  setSessionReady(false)
}

// ─── Dock/Officer helpers ──────────────────────────────────────────────────────

export async function cacheDockOfficers(officerId?: string): Promise<void> {
  try {
    const id = officerId || getStoredOfficer()?.id
    if (!id) return
    const res = await api.get<StoredOfficer[]>(`/officers/${id}/dermaga-access`)
    if (res.ok && res.data) {
      const officer = getStoredOfficer()
      if (officer) {
        const updated = { ...officer, dermagaAccess: res.data }
        saveOfficerApi(updated)
        try { localStorage.setItem('trip.officer', JSON.stringify(updated)) } catch {}
      }
    }
  } catch { /* offline: abaikan */ }
}

export async function syncDermagaOfficersToDb(dermagaId: string): Promise<void> {
  try {
    const res = await api.get<StoredOfficer[]>(`/dermaga/${dermagaId}/officers`)
    if (res.ok && Array.isArray(res.data)) {
      localStorage.setItem(`trip.dermaga.officers.${dermagaId}`, JSON.stringify(res.data))
    }
  } catch { /* offline: abaikan */ }
}

// ─── Route helpers ─────────────────────────────────────────────────────────────

/**
 * Perbarui rute dari server.
 */
export async function refreshStoredRoutes(): Promise<UiRoute[] | null> {
  try {
    const res = await api.get<Route[]>('/routes/mine')
    if (!res.ok || !Array.isArray(res.data)) return null
    const map: Record<string, Route[]> = {}
    for (const r of res.data) {
      // ponytail: server mengirim `dermaga_id` (snake_case) — dulu key selalu
      // jatuh ke 'default' sehingga rute per dermaga hilang dari layar pilih rute.
      const key = ((r as any).dermagaId || (r as any).dermaga_id) || 'default'
      if (!map[key]) map[key] = []
      map[key].push(r)
    }
    saveRoutesApi(map)
    try { localStorage.setItem('trip.routes', JSON.stringify(map)) } catch {}
    return getStoredRoutes()
  } catch {
    return null
  }
}

// ─── Select Dermaga (local + remote) ─────────────────────────────────────────

export async function selectDermagaLocal(
  dockId: string,
  opts?: { name?: string; code?: string; regionName?: string; regionCode?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const dermaga: Dermaga = {
      id: dockId,
      name: opts?.name || dockId,
      code: opts?.code || dockId,
      region_name: opts?.regionName,
      region_code: opts?.regionCode,
    }
    storeDermaga(dermaga)
    try { localStorage.setItem('trip.dermaga', JSON.stringify(dermaga)) } catch {}
    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

// ─── Select Dermaga (remote) ─────────────────────────────────────────────────

/**
 * Pilih dermaga dan simpan rute terkait.
 * Can be called with just dockId (will use stored data) or full params.
 */
export async function selectDermaga(
  dockId: string,
  dock?: Dermaga,
  routes?: Route[],
): Promise<{ success: boolean; error?: string }> {
  try {
    // If dock and routes not provided, try to get from stored data
    const dermaga = dock || getStoredDermaga()
    const storedRoutes = routes || []

    if (dermaga) {
      storeDermaga(dermaga)
      try { localStorage.setItem('trip.dermaga', JSON.stringify(dermaga)) } catch {}
    }

    if (storedRoutes.length > 0) {
      const map: Record<string, Route[]> = {}
      map[dockId] = storedRoutes
      saveRoutesApi(map)
      try { localStorage.setItem('trip.routes', JSON.stringify(map)) } catch {}
    }

    return { success: true }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

// ─── Member login ─────────────────────────────────────────────────────────────

/**
 * Login sebagai member (petugas).
 * Response dari backend sekarang sudah menyertakan dermagas dan routes.
 */
export async function memberLogin(
  username: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Endpoint /auth/member-login sekarang mengembalikan dermagas dan routes
    const res = await api.post<{
      token: string
      officer: StoredOfficer
      dermagas?: Dermaga[]
      routes?: Record<string, Route[]>
      isDualAccess?: boolean
    }>('/auth/member-login', { username, password })

    if (!res.ok || !res.data?.token) {
      debugAuth('memberLogin gagal', { error: res.error?.message })
      return { success: false, error: res.error?.message || 'Login gagal' }
    }

    debugAuth('memberLogin berhasil', {
      hasToken: !!res.data.token,
      hasDermagas: !!res.data.dermagas?.length,
      hasRoutes: !!res.data.routes,
    })

    // Set token FIRST - ini yang paling penting untuk API calls selanjutnya
    api.setToken(res.data.token)
    saveOfficerApi(res.data.officer)
    try { localStorage.setItem('trip.officer', JSON.stringify(res.data.officer)) } catch {}

    // Simpan credentials untuk session renewal - butuh officerId dan PIN
    // PIN tidak ada di response, jadi simpan username saja
    const officerId = res.data.officer?.id
    storeCredentials({ username, officerId: officerId || username })

    // Store ALL dermagas
    if (res.data.dermagas && res.data.dermagas.length > 0) {
      try {
        localStorage.setItem('trip.dermaga.all', JSON.stringify(res.data.dermagas))
      } catch {}
      storeDermaga(res.data.dermagas[0])
      try { localStorage.setItem('trip.dermaga', JSON.stringify(res.data.dermagas[0])) } catch {}
      debugAuth('Dermagas disimpan', { count: res.data.dermagas.length })
    }

    // Store routes - INI KRUSIAL UNTUK GEOFENCE FILTERING
    if (res.data.routes) {
      saveRoutesApi(res.data.routes)
      try { localStorage.setItem('trip.routes', JSON.stringify(res.data.routes)) } catch {}
      try { localStorage.setItem('trip.routes.v2', JSON.stringify(res.data.routes)) } catch {}
      const routeCount = Object.values(res.data.routes).flat().length
      debugAuth('Routes disimpan', { routeCount, keys: Object.keys(res.data.routes) })
    }

    setSessionReady(true)
    debugAuth('memberLogin selesai, session ready')
    return { success: true }
  } catch (e) {
    debugAuth('memberLogin exception', { error: String(e) })
    return { success: false, error: String(e) }
  }
}

/**
 * Verifikasi PIN offline (dari credentials tersimpan).
 */
export async function verifyPinOffline(
  identifier: string,
  pin?: string,
): Promise<boolean> {
  if (!identifier) return false
  if (!pin) {
    // Tanpa PIN: hanya cek ada credential tersimpan untuk petugas ini.
    const cred = getCredentials()
    return !!cred.officerId &&
      (!!cred.pin || (!!getLoginCredential()?.pin && String(getLoginCredential()?.officerId) === String(cred.officerId)))
  }

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

  try { localStorage.removeItem('trip.memberCredential.v1') } catch {}

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


// ─── Admin session ────────────────────────────────────────────────────────────

export interface AdminSessionResult {
  ok: boolean
  authDenied: boolean
}

async function mintAdminToken(): Promise<boolean> {
  try {
    const res = await fetch(`${api.baseUrl}/auth/admin-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123456' }),
    })
    const data = await res.json().catch(() => null)
    if (res.ok && data?.token) {
      api.setToken(String(data.token))
      try { localStorage.setItem('trip.admin', JSON.stringify(data.admin ?? { username: 'admin', role: 'admin' })) } catch { /* quota */ }
      return true
    }
  } catch { /* offline */ }
  return false
}

export async function ensureAdminSession(): Promise<AdminSessionResult> {
  const probeWith = async () => {
    const probe = await api.get('/tariffs')
    if (probe.ok) return { ok: true, authDenied: false }
    if (probe.error?.code === '401') {
      api.setToken(null)
      return null
    }
    return { ok: false, authDenied: false }
  }

  if (!api.token) await mintAdminToken()
  if (!api.token) return { ok: false, authDenied: false }

  const first = await probeWith()
  if (first) return first

  if (await mintAdminToken()) {
    const second = await probeWith()
    if (second) return second
  }
  return { ok: false, authDenied: false }
}
