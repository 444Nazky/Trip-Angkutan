// ─── Auth Service ─────────────────────────────────────────────────────────────
// Handles authentication with backend API

import { api, type ApiError } from './api'

const OFFICER_KEY = 'trip.auth.officer.v1'
const DERMAGA_KEY = 'trip.auth.dermaga.v1'
const ROUTES_KEY = 'trip.auth.routes.v1'

// Demo PIN shared by all seeded officers
export const DEMO_PIN = '123456'

// Officer the app *wants* to be authenticated as, even while offline
let activeOfficerId: string | null = null

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
}

export interface LoginResponse {
  token: string
  officer: StoredOfficer
  dermagas?: Dermaga[]
  routes?: Record<string, Route[]>
  isDualAccess?: boolean
}

// ── Revisi #4: login wilayah (langkah 1) ───────────────────────────────────
export interface RegionInfo { id: string; name: string; code: string }
export interface RegionOfficer { id: string; name: string }

/**
 * Login wilayah: kode region + password region (contoh BADAU / badau123).
 * Berhasil → daftar petugas wilayah tsb (tanpa PIN) untuk langkah berikutnya.
 */
export async function regionLogin(
  regionCode: string,
  password: string,
): Promise<{
  success: boolean
  error?: string
  region?: RegionInfo
  officers?: RegionOfficer[]
}> {
  const result = await api.post<{ region: RegionInfo; officers: RegionOfficer[] }>(
    '/auth/region-login',
    { regionCode, password },
  )

  if (!result.ok || !result.data) {
    return { success: false, error: result.error?.message || 'Backend tidak terjangkau' }
  }

  return { success: true, region: result.data.region, officers: result.data.officers }
}

// ── Rute petugas (dari login PIN / pilih dermaga) ─────────────────────────────
export interface UiRoute {
  code: string
  from: string
  to: string
  label: string
  distance?: string
  duration?: string
  /** ID dermaga asal rute — dipakai filter per dermaga di RouteSelectScreen */
  dermagaId?: string
}

function saveRoutesMap(map: Record<string, Route[]>) {
  try {
    localStorage.setItem(ROUTES_KEY, JSON.stringify(map))
  } catch { /* quota */ }
}

/**
 * Rute milik petugas yang sedang login (dari backend, per dermaga).
 * Kembalikan bentuk UI — kosong bila belum pernah login (caller fallback data statis).
 */
export function getStoredRoutes(): UiRoute[] {
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, Route[]>
    const selectedDermaga = getStoredDermaga()
    const routeGroups: Array<[string, Route[]]> = selectedDermaga
      ? [[selectedDermaga.id, map[selectedDermaga.id] || []]]
      : Object.keys(map).length === 1 ? [[Object.keys(map)[0], Object.values(map)[0] || []]] : []
    const out: UiRoute[] = []
    for (const [dermagaId, list] of routeGroups) {
      for (const r of list || []) {
        if (!r?.route_from || !r?.route_to) continue
        const code = `${r.route_from}-${r.route_to}`
        if (out.some(x => x.code === code)) continue
        out.push({
          code,
          from: r.route_from,
          to: r.route_to,
          label: r.name || `${r.route_from} → ${r.route_to}`,
          distance: r.distance,
          duration: r.duration,
          dermagaId,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Muat ulang rute petugas dari backend (`GET /routes/mine`) — dipanggil saat
 * layar Pilih Rute dibuka supaya hasil edit Master Rute admin langsung
 * terlihat tanpa harus logout/login ulang.
 * Kembalikan daftar rute terbaru, atau null bila gagal (pakai cache).
 */
export async function refreshStoredRoutes(): Promise<UiRoute[] | null> {
  const result = await api.get<(Route & { dermaga_id: string })[]>('/routes/mine')
  if (!result.ok || !result.data) return null

  const map: Record<string, Route[]> = {}
  for (const r of result.data) {
    if (!map[r.dermaga_id]) map[r.dermaga_id] = []
    // Simpan route_from/route_to terpisah dari dermaga_id agar map tetap bersih
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
  // getStoredRoutes() sudah menyertakan dermagaId dari key map
  return getStoredRoutes()
}

/** True when backend route data or a dock selection must prevent static fallback. */
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
  } catch { /* quota */ }
}

// Login with username/password (member login) and obtain backend JWT
export async function memberLogin(
  username: string,
  password: string
): Promise<{ success: boolean; error?: string; officer?: StoredOfficer }> {
  const result = await api.post<LoginResponse>('/auth/member-login', { username, password })

  if (!result.ok || !result.data) {
    return { success: false, error: result.error?.message || 'Backend unreachable' }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)

  return { success: true, officer: result.data.officer }
}

// Login with PIN (for officer switching).
export async function loginWithPin(
  officerId: string,
  pin: string,
): Promise<{ success: boolean; error?: ApiError; data?: LoginResponse }> {
  const result = await api.post<LoginResponse>('/auth/login', { officerId, pin })

  if (!result.ok || !result.data) {
    return { success: false, error: result.error }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)

  // Simpan rute per dermaga agar layar Pilih Rute memakai data master terbaru
  if (result.data.routes) saveRoutesMap(result.data.routes)

  // For single-dermaga officers, save the dermaga automatically
  if (result.data.dermagas && result.data.dermagas.length === 1) {
    saveDermaga(result.data.dermagas[0])
  }

  return { success: true, data: result.data }
}

// Select dermaga for dual-access officers
export async function selectDermaga(dermagaId: string): Promise<{ success: boolean; error?: string }> {
  const result = await api.post<{ dermaga: Dermaga; routes: Route[] }>('/auth/select-dermaga', { dermagaId })

  if (!result.ok || !result.data) {
    return { success: false, error: result.error?.message }
  }

  saveDermaga(result.data.dermaga)
  // Gabungkan rute dermaga terpilih dengan rute dermaga lain yang sudah tersimpan
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    const map: Record<string, Route[]> = raw ? JSON.parse(raw) : {}
    map[result.data.dermaga.id] = result.data.routes || []
    saveRoutesMap(map)
  } catch { /* quota */ }
  return { success: true, error: undefined }
}

export function logout() {
  api.setToken(null)
  clearOfficer()
}

/**
 * Refresh JWT with latest claims from database.
 */
export async function refreshBackendSession(officerId?: string): Promise<boolean> {
  const id = officerId ?? activeOfficerId ?? getStoredOfficer()?.id
  if (id == null || id === '') return false

  activeOfficerId = String(id)

  if (!api.isAuthenticated) {
    const result = await loginWithPin(String(id), DEMO_PIN)
    return result.success
  }

  const result = await api.post<LoginResponse>('/auth/refresh', {})
  if (result.ok && result.data) {
    api.setToken(result.data.token)
    saveOfficer(result.data.officer)
    return true
  }

  return false
}

export function isLoggedIn(): boolean {
  return api.isAuthenticated && !!getStoredOfficer()
}

// Decode the stored JWT payload without verification (UI-level checks only)
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

/**
 * Fetch an admin JWT for the dashboard.
 */
export async function ensureAdminBackendSession(): Promise<boolean> {
  const result = await api.post<{ token: string }>('/auth/admin-login', {
    username: 'admin',
    password: 'admin123',
  })

  if (result.ok && result.data) {
    api.setToken(result.data.token)
    return true
  }
  return false
}

/**
 * Ensure we have a valid backend JWT for the given officer.
 */
export async function ensureBackendSession(officerId?: string): Promise<boolean> {
  if (officerId != null && officerId !== '') {
    activeOfficerId = officerId
    const stored = getStoredOfficer()
    if (stored && String(stored.id) !== String(officerId)) {
      api.setToken(null)
    }
  }

  const payload = jwtPayload()
  if (payload && (payload.role === 'admin' || payload.officerId == null)) {
    api.setToken(null)
  }

  if (api.isAuthenticated) return true

  const id = officerId ?? activeOfficerId ?? getStoredOfficer()?.id
  if (id == null || id === '') return false

  const result = await loginWithPin(String(id), DEMO_PIN)
  return result.success
}
