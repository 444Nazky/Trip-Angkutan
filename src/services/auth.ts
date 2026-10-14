/**
 * Admin Auth Service — admin-only. Tidak mengimpor pages/ atau komponen mobile.
 *
 * AUTH_EVENT dipakai juga oleh App.tsx, LoginPage.tsx.
 */

import { api } from './api'

export const AUTH_EVENT = 'admin-login'

/** Kunci sesi token (baca/tulis dari Shell). */
export const ADMIN_KEY = 'trip.auth.admin.v1'
/** Kunci kredensial (tulis dari LoginPage, baca dari LoginPage). */
export const ADMIN_CREDS_KEY = 'trip.admin.creds.v1'

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

/** Hapus kredensial tersimpan — dipakai ChangePassword.tsx. */
export function clearAdminCredentials() {
  try { localStorage.removeItem(ADMIN_CREDS_KEY) } catch { /* quota */ }
}

/** Simpan kredensial admin setelah login, dipakai LoginPage.tsx. */
export function saveAdminCredentials(username: string, password: string) {
  try { localStorage.setItem(ADMIN_CREDS_KEY, JSON.stringify({ username, password })) } catch { /* quota */ }
}

/** Akhiri sesi & bersihkan semua data auth (logout tombol). */
export function logout() {
  try {
    localStorage.removeItem(ADMIN_KEY)
    localStorage.removeItem(ADMIN_CREDS_KEY)
  } catch { /* quota */ }
  api.setToken(null)
}

/** Kirim kredensial ke backend & simpan token sesi. */
export async function ensureAdminSession(): Promise<AdminSessionResult> {
  const attempts: AdminCreds[] = []
  const stored = getAdminCredentials()
  if (stored) attempts.push(stored)

  const fallback: AdminCreds = { username: 'admin', password: 'admin123' }
  if (!attempts.some(c => c.username === fallback.username && c.password === fallback.password)) {
    attempts.push(fallback)
  }

  for (const creds of attempts) {
    const result = await api.post<{ token: string }>('/auth/admin-login', creds)
    if (result.ok && result.data) {
      api.setToken(result.data.token)
      try {
        localStorage.setItem(ADMIN_KEY, JSON.stringify({ token: result.data.token, username: creds.username }))
        if (creds.username !== fallback.username || creds.password !== fallback.password) {
          // Simpan kredensial non-bawaan agar retry tanpa ketik ulang.
          saveAdminCredentials(creds.username, creds.password)
        }
      } catch { /* quota */ }
      return { ok: true, authDenied: false }
    }
    if (result.error?.code === '401') { /* tolak kredensial */ }
  }
  return { ok: false, authDenied: true }
}
