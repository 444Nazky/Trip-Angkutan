/**
 * API service utama untuk mobile app.
 * Auto-simpan token, tidak ada sesi expired.
 * Cache geofence & auth locally.
 */

import { environment } from '../environments/environment'

const TOKEN_KEY = 'trip.auth.token.v2'
const API_URL_OVERRIDE_KEY = 'trip.api.baseUrl'

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ApiError {
  message: string
  code?: string
}

export interface ApiResponse<T> {
  data?: T
  error?: ApiError
  ok: boolean
}

export interface Officer {
  id: string
  name: string
  username?: string
  regionId?: string
  regionCode?: string
  regionName?: string
  dermagaAccess?: { id: string; name?: string; code?: string }[]
}

export interface Dermaga {
  id: string
  name: string
  code: string
  region_name?: string
  region_code?: string
}

export interface Route {
  id: string
  name?: string
  route_from: string
  route_to: string
  distance?: string
  duration?: string
  dermagaId?: string
}

export interface GeofencePoint {
  id: string
  name: string
  latitude: number
  longitude: number
  radiusMeters?: number
  allowedRoutes?: string[]
  enabled?: boolean
}

// ─── URL resolution ───────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  try {
    const override = localStorage.getItem(API_URL_OVERRIDE_KEY)
    if (override?.trim()) return normalizeUrl(override)
  } catch {}
  return normalizeUrl(environment.apiBaseUrl)
}

function normalizeUrl(raw: string): string {
  let url = String(raw || '').trim().replace(/\/+$/, '')
  if (!url) return 'https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api'
  if (!/^https?:\/\//i.test(url)) {
    url = `${url.startsWith('localhost') ? 'http' : 'https'}://${url}`
  }
  if (!/\/api$/i.test(url)) url = `${url}/api`
  return url
}

export function setApiBaseUrl(url: string | null) {
  try {
    if (url?.trim()) localStorage.setItem(API_URL_OVERRIDE_KEY, url.trim())
    else localStorage.removeItem(API_URL_OVERRIDE_KEY)
  } catch {}
  window.location.reload()
}

export function resolveApiBaseUrl(): string {
  return getBaseUrl()
}

export function getApiBaseUrl(): string {
  return getBaseUrl()
}

export function normalizeBaseUrl(raw: string): string {
  return normalizeUrl(raw)
}

export interface PingResult {
  ok: boolean
  ms: number
  blockedByCors?: boolean
  timedOut?: boolean
  status?: number
  mixedContent?: boolean
  detail?: string
}

export async function pingBaseUrl(url: string, timeoutMs = 5000): Promise<PingResult> {
  const pageHttps = typeof window !== 'undefined' && window.location?.protocol === 'https:'
  const mixed = pageHttps && /^http:\/\//i.test(url) && !isPrivateHostUrl(url)
  if (mixed) {
    return { ok: false, ms: 0, mixedContent: true, detail: 'http:// diblokir dari halaman https (mixed content)' }
  }
  const r = await probeServerHealth(url, timeoutMs)
  return { ok: r.reachable, ms: r.ms ?? 0, blockedByCors: r.blockedByCors, timedOut: r.timedOut, status: r.status, detail: r.detail }
}

// ─── Token storage ───────────────────────────────────────────────────────────────

function loadToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

// ─── Request ──────────────────────────────────────────────────────────────────

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 12000,
): Promise<ApiResponse<T>> {
  const token = loadToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const anon = (environment as { supabaseAnonKey?: string }).supabaseAnonKey
  if (anon) headers['apikey'] = anon

  const url = `${baseUrl}${path}`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
    clearTimeout(timer)

    let data: T
    try { data = await res.json() } catch { data = undefined as T }
    if (!res.ok) {
      const msg = data && typeof data === 'object' && 'error' in data
        ? String((data as { error?: { message?: string } }).error?.message || `HTTP ${res.status}`)
        : `HTTP ${res.status}`
      return { ok: false, error: { message: msg, code: String(res.status) } }
    }
    return { ok: true, data }
  } catch (e) {
    clearTimeout(timer)
    const msg = e instanceof Error ? e.message : 'Network error'
    return { ok: false, error: { message: msg, code: 'NETWORK' } }
  }
}

const baseUrl = getBaseUrl()

export const api = {
  get: async <T>(path: string, timeoutMs = 12000): Promise<ApiResponse<T>> => request<T>('GET', path, undefined, timeoutMs),
  post: async <T>(path: string, body?: unknown, timeoutMs = 12000): Promise<ApiResponse<T>> => request<T>('POST', path, body, timeoutMs),
  put: async <T>(path: string, body?: unknown, timeoutMs = 12000): Promise<ApiResponse<T>> => request<T>('PUT', path, body, timeoutMs),
  delete: async <T>(path: string, timeoutMs = 12000): Promise<ApiResponse<T>> => request<T>('DELETE', path, undefined, timeoutMs),
  setToken: (token: string | null) => saveToken(token),
  get token() { return loadToken() },
  get baseUrl() { return baseUrl },
  get url() { return baseUrl },
  get isAuthenticated() { return !!loadToken() },
  getOk: async <T>(path: string, timeoutMs = 12000): Promise<T | null> => {
    const r = await request<T>('GET', path, undefined, timeoutMs)
    return r.ok ? (r.data ?? null) : null
  },
  ping: async (timeoutMs = 5000): Promise<boolean> => {
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(`${baseUrl}/health?_t=${Date.now()}`, {
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
  },
  postMultipart: async <T>(path: string, body: FormData): Promise<ApiResponse<T>> => {
    let token: string | null = null
    try { token = loadToken() } catch { /* storage offline */ }
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60000)
      let res: Response
      try {
        res = await fetch(`${baseUrl}${path}`, {
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
        // ponytail: 401 TIDAK boleh menghapus token — dulu satu 401 (token basi
        // di salah satu dari 4 request paralel) menghapus token di storage,
        // sehingga renew tak pernah bisa dipanggil dan sesi mati permanen
        // ("session renewal failed" padahal petugas sudah login). Token hanya
        // diganti saat login/refresh eksplisit.
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
  },
}

// ─── Geofence caching ─────────────────────────────────────────────────────────

const GEOFENCE_KEY = 'trip.geofence.cache'
const GEOFENCE_TTL = 15 * 60 * 1000

export function getCachedGeofences(): GeofencePoint[] {
  try {
    const raw = localStorage.getItem(GEOFENCE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as GeofencePoint[]
  } catch { return [] }
}

export function cacheGeofences(points: GeofencePoint[]) {
  try {
    if (points?.length) localStorage.setItem(GEOFENCE_KEY, JSON.stringify(points))
    else localStorage.removeItem(GEOFENCE_KEY)
  } catch {}
}

export function cachedGeofenceAge(): number {
  try {
    const raw = localStorage.getItem(GEOFENCE_KEY)
    if (!raw) return Infinity
    const parsed = JSON.parse(raw)
    return Date.now() - (parsed?.cachedAt || 0)
  } catch { return Infinity }
}

export function isGeofenceCacheStale(): boolean {
  return cachedGeofenceAge() > GEOFENCE_TTL
}

// ─── Officer storage ───────────────────────────────────────────────────────────

const OFFICER_KEY = 'trip.officer.v2'
const DERMAGA_KEY = 'trip.auth.dermaga.v1'
const ROUTES_KEY = 'trip.routes.v2'
const CREDENTIALS_KEY = 'trip.credentials'

export function getStoredOfficer(): Officer | null {
  try {
    const raw = localStorage.getItem(OFFICER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function saveOfficer(officer: Officer) {
  try {
    if (officer) localStorage.setItem(OFFICER_KEY, JSON.stringify(officer))
    else localStorage.removeItem(OFFICER_KEY)
  } catch {}
}

export function getStoredDermaga(): Dermaga | null {
  try {
    const raw = localStorage.getItem(DERMAGA_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function storeDermaga(d: Dermaga | null) {
  try {
    if (d) localStorage.setItem(DERMAGA_KEY, JSON.stringify(d))
    else localStorage.removeItem(DERMAGA_KEY)
  } catch {}
}

export function getStoredRoutes(): Record<string, Route[]> {
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function saveRoutes(routes: Record<string, Route[]>) {
  try {
    if (routes && Object.keys(routes).length) localStorage.setItem(ROUTES_KEY, JSON.stringify(routes))
    else localStorage.removeItem(ROUTES_KEY)
  } catch {}
}

export function getCredentials(): { username?: string; pin?: string; officerId?: string } {
  try {
    const raw = localStorage.getItem(CREDENTIALS_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}

export function storeCredentials(cred: { username?: string; pin?: string; officerId?: string }) {
  try {
    if (cred) localStorage.setItem(CREDENTIALS_KEY, JSON.stringify(cred))
    else localStorage.removeItem(CREDENTIALS_KEY)
  } catch {}
}

export function clearCredentials() {
  storeCredentials({})
}

// ─── Server Settings helpers ─────────────────────────────────────────────────

export function apiBaseCandidateLabel(candidate: string): string {
  if (/\.supabase\.co/i.test(candidate)) return 'Supabase'
  return new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`).hostname
}

export interface ApiBaseCandidate {
  url: string
  label: string
}

export function apiBaseCandidates(): ApiBaseCandidate[] {
  return [
    { url: 'https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api', label: 'Produksi (Supabase)' },
    // Localhost DIHAPUS dari kandidat - URL produksi selalu digunakan
  ]
}

export function isPrivateHostUrl(url: string): boolean {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return /^127\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^localhost$/i.test(u.hostname)
  } catch { return false }
}

export function normalizeApiBaseInput(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '')
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`
  }
  if (!/\/api$/i.test(url)) {
    url = `${url}/api`
  }
  return url
}

export interface ServerProbeResult {
  reachable: boolean
  ms?: number
  blockedByCors?: boolean
  status?: number
  timedOut?: boolean
  cleartextBlocked?: boolean
  detail?: string
}

export async function probeServerHealth(url: string, timeoutMs = 5000): Promise<ServerProbeResult> {
  const start = Date.now()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const res = await fetch(`${url}/health`, { method: 'GET', signal: controller.signal })
    clearTimeout(timer)
    const ms = Date.now() - start
    return { reachable: true, ms, status: res.status }
  } catch (e) {
    const ms = Date.now() - start
    const err = e as Error
    if (err.name === 'AbortError') {
      return { reachable: false, ms: ms || 0, timedOut: true, detail: 'Request timed out' }
    }
    if (err.message.includes('fetch') || err.message.includes('CORS')) {
      return { reachable: false, ms: ms || 0, blockedByCors: true, detail: err.message }
    }
    return { reachable: false, ms: ms || 0, detail: err.message }
  }
}

export function setApiBaseUrlOverride(url: string | null): void {
  setApiBaseUrl(url)
}

// Default URL (synchronous) - PRODUKSI ONLY
export async function autoDetectApiBaseUrl(_timeoutMs?: number): Promise<string | null> {
  console.log('[API] Production mode: URL dikunci ke Supabase')
  return 'https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api'
}

// PRODUCTION: URL backend DIKUNCI ke Supabase - tidak ada auto-detect atau fallback ke localhost
const PRODUCTION_API_URL = 'https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api'

// Async version for chained calls - PRODUKSI ONLY, tidak pernah ke localhost
export async function autoDetectApiBaseUrlAsync(_timeoutMs = 30000): Promise<string> {
  // SELALU kembalikan URL produksi - tidak ada deteksi
  console.log('[API] Production mode: menggunakan Supabase API')
  return PRODUCTION_API_URL
}
