import { api } from './api'



export const AUTH_EVENT = 'admin-login'



export const ADMIN_KEY = 'trip.auth.admin.v1'



export const ADMIN_CREDS_KEY = 'trip.admin.creds.v1'



export interface AdminSessionResult {
  ok: boolean

  authDenied: boolean
}

try {
  localStorage.removeItem(ADMIN_CREDS_KEY)
  localStorage.removeItem(ADMIN_KEY)
} catch {}



export function logout() {
  try {
    localStorage.removeItem(ADMIN_KEY)
    localStorage.removeItem(ADMIN_CREDS_KEY)
  } catch {}
  api.setToken(null)
}



export async function ensureAdminSession(): Promise<AdminSessionResult> {
  if (!api.token) return { ok: false, authDenied: true }

  const probe = await api.get('/tariffs')
  if (probe.ok) return { ok: true, authDenied: false }
  if (probe.error?.code === '401') {
    api.setToken(null)
    return { ok: false, authDenied: true }
  }

  return { ok: false, authDenied: false }
}



export async function adminLogin(username: string, password: string): Promise<AdminSessionResult> {
  const result = await api.post<{ token: string }>('/auth/admin-login', { username, password })
  if (result.ok && result.data?.token) {
    api.setToken(result.data.token)
    return { ok: true, authDenied: false }
  }
  if (result.error?.code === '401' || result.error?.code === '503') {
    return { ok: false, authDenied: true }
  }
  return { ok: false, authDenied: false }
}
