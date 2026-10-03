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

// ── Region login (step 1) ─────────────────────────────────────────────────────
export interface RegionInfo { id: string; name: string; code: string }
export interface RegionOfficer { id: string; name: string }

/**
 * Region login: region code + password.
 * Success → daftar officer wilayah (tanpa PIN) untuk langkah berikutnya.
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

// ── Officer routes (dari PIN login / dermaga selection) ───────────────────────
export interface UiRoute {
  code: string
  from: string
  to: string
  label: string
  distance?: string
  duration?: string
  /** Dermaga ID route ini milik */
  dermagaId?: string
}

function saveRoutesMap(map: Record<string, Route[]>) {
  try {
    localStorage.setItem(ROUTES_KEY, JSON.stringify(map))
  } catch { /* quota */ }
}

/**
 * Simpan route yang terkait dengan officer (dari backend, per dermaga).
 * Dikembalikan dalam bentuk UI — kosong bila belum ada login.
 */
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
          distance: route.distance,
          duration: route.duration,
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
 * Refresh routes dari backend (`GET /routes/mine`) — dipakai saat layar Route dibuka
 * agar hasil edit Admin Route langsung terlihat tanpa logout/login ulang.
 */
export async function refreshStoredRoutes(): Promise<UiRoute[] | null> {
  const result = await api.get<(Route & { dermaga_id: string })[]>(`/routes/mine`)
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
  // Kembalikan routes yang baru saja disimpan.
  return getStoredRoutes()
}

/** Apakah backend route data atau dock selection harus mencegah fallback statis. */
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

function clearRoutes() {
  try {
    localStorage.removeItem(ROUTES_KEY)
  } catch { /* quota */ }
}

// ── Officer login (PIN) ────────────────────────────────────────────────────
/**
 * Login dengan PIN officer.
 * Otomatis memilih dermaga tunggal.
 */
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
  // Simpan route per dermaga.
  if (result.data.routes) saveRoutesMap(result.data.routes)

  // Single-dermaga officers: pilih otomatis.
  if (result.data.dermagas?.length === 1) {
    saveDermaga(result.data.dermagas[0])
  }

  return { success: true, data: result.data }
}

// ── Dermaga selection (dual-access officers) ────────────────────────────────
export async function selectDermaga(dermagaId: string): Promise<{ success: boolean; error?: string }> {
  const result = await api.post<{ dermaga: Dermaga; routes: Route[] }>('/auth/select-dermaga', { dermagaId })

  if (!result.ok || !result.data) {
    return { success: false, error: result.error?.message }
  }

  // Simpan dermaga & route yang dipilih.
  saveDermaga(result.data.dermaga)
  // Timpa route di dermaga ini dengan data terbaru.
  const raw = localStorage.getItem(ROUTES_KEY)
  const map: Record<string, Route[]> = raw ? JSON.parse(raw) : {}
  map[dermagaId] = result.data.routes
  saveRoutesMap(map)

  return { success: true }
}

// ── Logout ──────────────────────────────────────────────────────────────
export function logout() {
  api.setToken(null)
  clearOfficer()
  clearRoutes()
}

/**
 * Refresh JWT session dengan claims terbaru dari database.
 */
export async function refreshBackendSession(officerId?: string): Promise<boolean> {
  const id = officerId ?? activeOfficerId ?? getStoredOfficer()?.id
  if (id == null) return false

  activeOfficerId = String(id)

  if (!api.isAuthenticated) {
    // Offline: login ulang otomatis.
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

// Decode JWT payload tanpa verifikasi (hanya untuk UI-level checks).
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

// ── Admin credentials ──────────────────────────────────────────────────
const ADMIN_CREDS_KEY = 'trip.auth.admin.v1'

export interface AdminCreds { username: string; password: string }

/**
 * Simpan kredensial admin setelah login sukses.
 * Dipakai ulang oleh ensureAdminBackendSession sehingga dashboard tetap autentikasi
 * setelah password diubah (tanpa perlu hardcode admin123).
 */
export function saveAdminCredentials(username: string, password: string) {
  try {
    localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify({ username, password }))
  } catch { /* quota */ }
}

export function getAdminCredentials(): AdminCreds | null {
  try {
    const raw = localStorage.getItem(ADMIN_CREDS_KEY)
    if (!raw) return null
    const c = JSON.parse(raw)
    return (
      c && typeof c.username === 'string' && typeof c.password === 'string'
        ? { username: c.username, password: c.password }
        : null
    )
  } catch {
    return null
  }
}

export function clearAdminCredentials() {
  try {
    localStorage.removeItem(ADMIN_CREDS_KEY)
  } catch { /* quota */ }
}

// ── Admin login ───────────────────────────────────────────────────────
/**
 * Login admin ke backend (`POST /auth/admin-login`).
 * Error: 'invalid' = server tolak (401), 'network' = server mati.
 */
export async function adminLogin(
  username: string,
  password: string,
): Promise<{ success: boolean; error?: 'invalid' | 'network' }> {
  const result = await api.post<{ token: string }>('/auth/admin-login', { username, password })

  if (result.ok && result.data) {
    api.setToken(result.data.token)
    saveAdminCredentials(username, password)
    return { success: true }
  }
  if (result.error?.code === '401') return { success: false, error: 'invalid' }
  return { success: false, error: 'network' }
}

export interface AdminSessionResult {
  ok: boolean
  /** true bila server menjawab 401 (kredensial salah) — buka form login, bukan offline mode. */
  authDenied: boolean
}

/**
 * Ambil JWT admin dari storage atau cache kredensial.
 * Percobaan beruntun: stored → fallback admin/admin123.
 */
export async function ensureAdminBackendSession(): Promise<AdminSessionResult> {
  const attempts: AdminCreds[] = []

  const stored = getAdminCredentials()
  if (stored) attempts.push(stored)

  const fallback: AdminCreds = { username: 'admin', password: 'admin123' }
  if (!attempts.some(c => c.username === fallback.username && c.password === fallback.password)) {
    attempts.push(fallback)
  }

  let authDenied = false
  for (const creds of attempts) {
    const result = await api.post<{ token: string }>('/auth/admin-login', creds)
    if (result.ok && result.data) {
      api.setToken(result.data.token)
      // Samakan storage dengan kredensial yang valid.
      if (creds !== fallback) saveAdminCredentials(creds.username, creds.password)
      return { ok: true, authDenied: false }
    }
    if (result.error?.code === '401') authDenied = true
  }
  return { ok: false, authDenied }
}

/**
 * Pastikan sesi valid untuk officer tertentu.
 */
export async function ensureBackendSession(officerId?: string): Promise<boolean> {
  if (officerId != null && officerId !== '') {
    activeOfficerId = officerId
    const stored = getStoredOfficer()
    if (stored && String(stored.id) !== officerId) {
      api.setToken(null)
    }
  }

  const payload = jwtPayload()
  if (payload?.role === 'admin' || payload?.officerId == null) {
    api.setToken(null)
  }

  if (api.isAuthenticated) return true

  const id = officerId ?? activeOfficerId ?? getStoredOfficer()?.id
  if (id == null || id === '') return false

  const result = await loginWithPin(String(id), DEMO_PIN)
  return result.success
}
