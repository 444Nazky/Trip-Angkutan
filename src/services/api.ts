// ─── API Service ──────────────────────────────────────────────────────────────

import { environment } from '../environments/environment'

const TOKEN_KEY = 'trip.auth.token.v1'
const API_BASE_URL_KEY = 'trip.api.baseUrl.v1'

export interface ApiError {
  message: string
  code?: string
}

export interface ApiResponse<T> {
  data?: T
  error?: ApiError
  ok: boolean
}

export interface OfficerInfo {
  id: string
  name: string
  regionId: string
  regionName: string
  regionCode: string
}

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

export interface LoginResponse {
  token: string
  officer: OfficerInfo
  dermagas?: Dermaga[]
  routes?: Record<string, Route[]>
  isDualAccess?: boolean
}

// Detect if running on a REAL mobile device.
// Penting: window.Capacitor juga ikut terdefinisi di build web (platform 'web'),
// jadi cek keberadaannya saja akan salah menganggap browser desktop sebagai
// perangkat fisik → base URL jatuh ke deviceApiBaseUrl (host mati) dan login
// menggantung. Yang benar: hanya native platform (Android/iOS) atau UA mobile.
function isMobileDevice(): boolean {
  // UA mobile → browser di HP/tablet (perlu IP host, bukan localhost)
  if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) return true

  const cap = (window as any).Capacitor
  // Hanya native (Android/iOS) yang dianggap perangkat fisik
  if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) return true
  if (cap && typeof cap.getPlatform === 'function') {
    const platform = cap.getPlatform()
    if (platform === 'android' || platform === 'ios') return true
  }

  return (window as any).cordova !== undefined
}

// Get current base URL (user-configurable for physical devices)
function getBaseUrl(): string {
  // Check if user set a custom URL
  try {
    const customUrl = localStorage.getItem(API_BASE_URL_KEY)
    if (customUrl) return customUrl
  } catch { /* ignore */ }

  // Use device-specific URL on mobile
  if (isMobileDevice() && environment.deviceApiBaseUrl) {
    return environment.deviceApiBaseUrl
  }

  return environment.apiBaseUrl
}

// Allow users to set custom API URL (for physical device testing)
export function setApiBaseUrl(url: string) {
  try {
    localStorage.setItem(API_BASE_URL_KEY, url)
  } catch { /* quota */ }
}

export function getApiBaseUrl(): string {
  return getBaseUrl()
}

class ApiService {
  private _baseUrl = getBaseUrl()
  private _token: string | null = null

  constructor() {
    // Load token from localStorage on init
    try {
      this._token = localStorage.getItem(TOKEN_KEY)
    } catch { /* ignore */ }
  }

  get baseUrl() { return this._baseUrl }
  get token() { return this._token }
  get isAuthenticated() { return !!this._token }

  setToken(token: string | null) {
    this._token = token
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token)
      } else {
        localStorage.removeItem(TOKEN_KEY)
      }
    } catch { /* quota */ }
  }

  // Refresh base URL (call after setting custom URL)
  refreshBaseUrl() {
    this._baseUrl = getBaseUrl()
  }

  /**
   * PING AKTIF ke endpoint health backend.
   *
   * `navigator.onLine` sering menipu di dalam webview/Cordova (captive portal,
   * DNS mati, sinyal lemah, WiFi tanpa akses internet) — statusnya tetap
   * "online" padahal server tidak terjangkau. Karena itu sinkronisasi WAJIB
   * memverifikasi koneksi dengan request ringan sungguhan ke `/api/health`
   * sebelum menganggap antrean bisa dikirim.
   */
  async ping(timeoutMs = 5000): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(`${this.baseUrl}/health?_t=${Date.now()}`, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        return res.ok
      } finally {
        clearTimeout(timer)
      }
    } catch {
      return false
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = 12000,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this._token) {
      headers['Authorization'] = `Bearer ${this._token}`
    }

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort()
        reject(new Error('timeout'))
      }, timeoutMs)
    })
    try {
      const res = await Promise.race([fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      }), timeout])
      const data = await Promise.race([res.json(), timeout]).catch(err => {
        if (controller.signal.aborted) throw err
        return {}
      })

      if (!res.ok) {
        if (res.status === 401) this.setToken(null)
        return { ok: false, error: { message: data.error || 'Request failed', code: String(res.status) } }
      }

      return { ok: true, data }
    } catch (err) {
      const aborted = controller.signal.aborted
      const message = aborted
        ? `Server tidak merespon (${timeoutMs / 1000} detik timeout) — periksa API ${this.baseUrl}`
        : err instanceof Error ? err.message : 'Network error'
      return { ok: false, error: { message, code: aborted ? 'TIMEOUT' : 'NETWORK' } }
    } finally {
      clearTimeout(timer)
    }
  }

  get<T>(path: string) { return this.request<T>('GET', path) }
  post<T>(path: string, body?: unknown, timeoutMs?: number) { return this.request<T>('POST', path, body, timeoutMs) }
  put<T>(path: string, body?: unknown) { return this.request<T>('PUT', path, body) }
  delete<T>(path: string) { return this.request<T>('DELETE', path) }

  async postMultipart<T>(path: string, body: FormData): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {}
    if (this._token) headers['Authorization'] = `Bearer ${this._token}`

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60000)
      let res: Response
      try {
        res = await fetch(`${this.baseUrl}${path}`, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 401) this.setToken(null)
        return { ok: false, error: { message: data.error || 'Request failed', code: String(res.status) } }
      }
      return { ok: true, data }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      return {
        ok: false,
        error: { message: aborted ? 'Unggah dokumentasi melewati batas waktu' : err instanceof Error ? err.message : 'Network error' },
      }
    }
  }

  async uploadPhoto(file: File): Promise<{ url: string } | null> {
    const form = new FormData()
    form.append('foto', file)
    try {
      const res = await fetch(`${this.baseUrl}/upload`, {
        method: 'POST',
        headers: { Authorization: this._token ? `Bearer ${this._token}` : '' },
        body: form,
      })
      if (!res.ok) return null
      const data = await res.json()
      return data.url ? { url: data.url } : null
    } catch { return null }
  }
}

export const api = new ApiService()
