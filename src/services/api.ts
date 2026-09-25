// ─── API Service ──────────────────────────────────────────────────────────────

import { environment } from '../environments/environment'

const TOKEN_KEY = 'trip.auth.token.v1'

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

class ApiService {
  private baseUrl = environment.apiBaseUrl
  private _token: string | null = null

  constructor() {
    // Load token from localStorage on init
    try {
      this._token = localStorage.getItem(TOKEN_KEY)
    } catch { /* ignore */ }
  }

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
