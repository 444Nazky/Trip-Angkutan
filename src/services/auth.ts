// ─── Auth Service ─────────────────────────────────────────────────────────────
// Handles authentication with backend API

import { api, type ApiError, type LoginResponse } from './api'

const OFFICER_KEY = 'trip.auth.officer.v1'

// Demo PIN shared by all seeded officers
export const DEMO_PIN = '123456'

// Officer the app *wants* to be authenticated as, even while offline
let activeOfficerId: string | null = null

export interface StoredOfficer {
  /** Selalu string — id petugas bisa UUID, bukan hanya angka */
  id: string
  name: string
  regionId: string
  regionName: string
  regionCode: string
}

export function getStoredOfficer(): StoredOfficer | null {
  try {
    const raw = localStorage.getItem(OFFICER_KEY)
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

function clearOfficer() {
  try {
    localStorage.removeItem(OFFICER_KEY)
  } catch { /* quota */ }
}

// Login with username/password (local login) and obtain backend JWT
export async function memberLogin(username: string, password: string): Promise<{ success: boolean; error?: string }> {
  const result = await api.post<LoginResponse>('/auth/member-login', { username, password })

  if (!result.ok || !result.data) {
    // Backend unreachable or auth failed - fallback to demo mode
    return { success: false, error: result.error?.message || 'Backend unreachable' }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)

  return { success: true }
}

// Login with PIN (for officer switching).
// `error.code` terisi hanya jika server merespons (HTTP error) — dipakai UI untuk
// membedakan "PIN salah / akun nonaktif" (ditolak server) vs "offline" (fallback demo).
export async function loginWithPin(
  officerId: string,
  pin: string,
): Promise<{ success: boolean; error?: ApiError }> {
  const result = await api.post<LoginResponse>('/auth/login', { officerId, pin })

  if (!result.ok || !result.data) {
    return { success: false, error: result.error }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)

  return { success: true }
}

export function logout() {
  api.setToken(null)
  clearOfficer()
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
 * Fetch an admin JWT for the dashboard (username/password login).
 * Overwrites the current token — admin and officer sessions are mutually
 * exclusive in this app (routing is based on userType).
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
 * Ensure we have a valid backend JWT for the given (or last known) officer.
 * Safe to call repeatedly: no-op if the right token exists, fails soft if
 * the backend is unreachable (queue keeps the data for later retry).
 */
export async function ensureBackendSession(officerId?: string): Promise<boolean> {
  if (officerId != null && officerId !== '') {
    activeOfficerId = officerId
    // A token belonging to a different officer must not be reused
    const stored = getStoredOfficer()
    if (stored && String(stored.id) !== String(officerId)) {
      api.setToken(null)
    }
  }

  // Never reuse an admin token for officer sync — it carries no officerId
  const payload = jwtPayload()
  if (payload && (payload.role === 'admin' || payload.officerId == null)) {
    api.setToken(null)
  }

  if (api.isAuthenticated) return true

  // Try PIN login with demo PIN (works even if memberLogin failed offline)
  const id = officerId ?? activeOfficerId ?? getStoredOfficer()?.id
  if (id == null || id === '') return false

  const result = await loginWithPin(String(id), DEMO_PIN)
  return result.success
}
