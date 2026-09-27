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

// Detect if running on mobile device (Capacitor/Cordova)
function isMobileDevice(): boolean {
  return (
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (window as any).Capacitor !== undefined ||
    (window as any).cordova !== undefined
  )
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

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this._token) {
      headers['Authorization'] = `Bearer ${this._token}`
    }

    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })

      const data = await res.json()

      if (!res.ok) {
        // Clear token on auth errors
        if (res.status === 401) {
          this.setToken(null)
        }
        return { ok: false, error: { message: data.error || 'Request failed', code: String(res.status) } }
      }

      return { ok: true, data }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error'
      return { ok: false, error: { message } }
    }
  }

  get<T>(path: string) { return this.request<T>('GET', path) }
  post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, body) }
  put<T>(path: string, body?: unknown) { return this.request<T>('PUT', path, body) }
  delete<T>(path: string) { return this.request<T>('DELETE', path) }
}

export const api = new ApiService()
