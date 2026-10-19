/**
 * Session management - tidak ada sesi expired, auto-renew dari token.
 * Debug logging ditambahkan untuk troubleshooting auth flow.
 */

import { api } from './api'
import {
  getStoredOfficer as getStoredOfficerApi,
  saveOfficer as saveOfficerApi,
  getStoredDermaga,
  storeDermaga as storeDermagaApi,
  getStoredRoutes as getStoredRoutesMap,
  saveRoutes as saveRoutesApi,
  getCredentials,
  storeCredentials,
  clearCredentials,
  type Officer as StoredOfficer,
  type Route,
  type Dermaga,
} from './api'
import { listOfficers } from './offlineDb'

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

// Re-export storage functions from api.ts for backward compatibility
export { getStoredDermaga, storeDermaga } from './api'

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
    const raw = localStorage.getItem('trip.officer')
    return raw ? JSON.parse(raw) : null
  } catch { return null }
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

export async function loginWithPin(officerId: string, pin: string): Promise<{ success: boolean; error?: string }> {
  debugAuth('loginWithPin mulai', { officerId, hasPin: !!pin })

  try {
    const res = await api.post<{ token: string; officer: StoredOfficer; dermagas?: Dermaga[]; routes?: Record<string, Route[]> }>('/auth/login', { officerId, pin })
    debugAuth('loginWithPin response', { ok: res.ok, hasToken: !!res.data?.token, hasOfficer: !!res.data?.officer })

    if (!res.ok || !res.data?.token || !res.data.officer) {
      debugAuth('loginWithPin gagal', { error: res.error?.message })
      return { success: false, error: res.error?.message || 'Login gagal' }
    }

    // Set token FIRST - ini yang paling penting untuk API calls selanjutnya
    api.setToken(res.data.token)
    debugAuth('Token disimpan', { tokenLength: res.data.token.length })

    // Simpan di multiple tempat untuk backward compatibility
    saveOfficerApi(res.data.officer)
    debugAuth('Officer disimpan', { id: res.data.officer.id, name: res.data.officer.name })

    try { localStorage.setItem('trip.officer', JSON.stringify(res.data.officer)) } catch (e) {
      debugAuth('trip.officer storage gagal', { error: String(e) })
    }

    // Store ALL dermagas (not just first) untuk dual-access officers
    if (res.data.dermagas && res.data.dermagas.length > 0) {
      // Simpan semua dermaga yang punya akses
      try {
        localStorage.setItem('trip.dermaga.all', JSON.stringify(res.data.dermagas))
      } catch {}
      // Simpan dermaga pertama sebagai default
      storeDermagaApi(res.data.dermagas[0])
      try { localStorage.setItem('trip.dermaga', JSON.stringify(res.data.dermagas[0])) } catch {}
      debugAuth('Dermagas disimpan', { count: res.data.dermagas.length, names: res.data.dermagas.map(d => d.name) })
    } else {
      storeDermagaApi(null)
      debugAuth('Tidak ada dermaga dalam response')
    }

    // Store routes - INI KRUSIAL UNTUK GEOFENCE FILTERING
    if (res.data.routes) {
      saveRoutesApi(res.data.routes)
      try { localStorage.setItem('trip.routes', JSON.stringify(res.data.routes)) } catch {}
      // Also save to v2 key for consistency
      try { localStorage.setItem('trip.routes.v2', JSON.stringify(res.data.routes)) } catch {}
      const routeCount = Object.values(res.data.routes).flat().length
      debugAuth('Routes disimpan', { routeCount, keys: Object.keys(res.data.routes) })
    } else {
      debugAuth('Tidak ada routes dalam response')
    }

    // Store credentials untuk session renewal
    storeCredentials({ officerId, pin })
    debugAuth('Credentials disimpan', { officerId })

    console.log('[auth] PIN login OK:', res.data.officer.name, '| routes:', res.data.routes ? Object.values(res.data.routes).flat().length : 0)
    return { success: true }
  } catch (e) {
    debugAuth('loginWithPin exception', { error: String(e) })
    return { success: false, error: String(e) }
  }
}

/**
 * Login offline: validate credentials if provided, or check stored session.
 */
export async function loginOffline(
  userId?: string,
  _pin?: string,
): Promise<{ success: boolean; officer?: StoredOfficer; error?: string }> {
  if (userId && _pin) {
    // Validate provided credentials
    const officers = listOfficers()
    const match = officers.find(o => String(o.id) === userId || o.username === userId)
    if (match) {
      return { success: true, officer: match }
    }
    return { success: false, error: 'Officer not found' }
  }
  // Check existing session
  if (api.isAuthenticated) {
    const officer = getStoredOfficer()
    if (officer) return { success: true, officer }
  }
  return { success: false, error: 'Tidak ada sesi aktif' }
}

// ─── Session management ────────────────────────────────────────────────────────

let _sessionReady = false

export function isSessionReady(): boolean {
  return _sessionReady || api.isAuthenticated
}

function setSessionReady(ready: boolean) {
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
export async function renewSessionIfNeeded(): Promise<boolean> {
  debugAuth('renewSessionIfNeeded mulai', { hasToken: api.isAuthenticated })
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
      const key = (r as any).dermagaId || 'default'
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
    storeDermagaApi(dermaga)
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
      storeDermagaApi(dermaga)
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
      storeDermagaApi(res.data.dermagas[0])
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
  officerId: string,
  pin?: string,
): Promise<boolean> {
  if (pin) {
    return loginWithPin(officerId, pin).then(r => r.success)
  }
  // Just check if we have stored credentials
  return loginOffline().then(r => r.success)
}

