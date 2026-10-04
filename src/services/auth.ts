/**
 * Admin Auth Service — admin-only.
 * Tidak mengimpor pages/ atau komponen mobile.
 */

import { api } from './api'

const ADMIN_CREDS_KEY = 'trip.admin.creds.v1'

export interface AdminCreds {
  username: string
  password: string
}

export interface AdminSessionResult {
  ok: boolean
  /** True bila server menolak kredensial lama. */
  authDenied: boolean
}

export function getAdminCredentials(): AdminCreds | null {
  try {
    const raw = localStorage.getItem(ADMIN_CREDS_KEY)
    if (!raw) return null
    const c = JSON.parse(raw) as AdminCreds
    return c.username && c.password ? c : null
  } catch { return null }
}

export function clearAdminCredentials() {
  try { localStorage.removeItem(ADMIN_CREDS_KEY) } catch { /* quota */ }
}

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
      if (creds !== fallback) {
        try { localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify(creds)) } catch { /* quota */ }
      }
      return { ok: true, authDenied: false }
    }
    if (result.error?.code === '401') authDenied = true
  }
  return { ok: false, authDenied }
}

export function adminLogout() {
  api.setToken(null)
  clearAdminCredentials()
}
