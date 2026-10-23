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

// ─── URL resolution ───────────────────────────────────────────────────────────────

function getBaseUrl(): string {
  try {
    const override = localStorage.getItem(API_URL_OVERRIDE_KEY)
    if (override?.trim()) return normalizeUrl(override)
  } catch {}
  return normalizeUrl(defaultApiBaseUrl())
}

/**
 * Endpoint default sistem = backend INTRANET kantor (port 3000).
 *
 * Cloud hanya dipakai bila `intranetApiBaseUrl` dikosongkan di environment.
 * Jangan mengembalikan `apiBaseUrl` lebih dulu: aplikasi mobile kantor harus
 * tetap bisa login/geofence walau tidak ada internet.
 */
export function defaultApiBaseUrl(): string {
  const intranet = (environment as { intranetApiBaseUrl?: string }).intranetApiBaseUrl
  return (intranet && intranet.trim()) || environment.apiBaseUrl
}

/** True kalau endpoint default/aktif adalah server intranet. */
export function isDefaultIntranet(): boolean {
  return isIntranetBaseUrl(defaultApiBaseUrl())
}

function cloudApiBaseUrl(): string {
  return environment.apiBaseUrl
}

function normalizeUrl(raw: string): string {
  let url = String(raw || '').trim().replace(/\/+$/, '')
  if (!url) return defaultApiBaseUrl()
  if (!/^https?:\/\//i.test(url)) {
    // Host privat/LAN hanya boleh http (server intranet tidak punya TLS).
    // Host publik dipaksa https.
    url = `${isPrivateHostUrl(url) ? 'http' : 'https'}://${url}`
  }
  if (!/\/api$/i.test(url)) url = `${url}/api`
  return url
}

export function setApiBaseUrl(url: string | null) {
  try {
    if (url?.trim()) localStorage.setItem(API_URL_OVERRIDE_KEY, url.trim())
    else localStorage.removeItem(API_URL_OVERRIDE_KEY)
  } catch {}
}

export function resolveApiBaseUrl(): string {
  return getBaseUrl()
}

/**
 * Origin project Supabase (cloud).
 *
 * Artefak yang disimpan di Supabase Storage (bundel OTA di bucket `ota`, file
 * APK di bucket `apks`) SELALU berada di host cloud ini - bukan di server
 * intranet. Jadi URL storage tidak boleh diturunkan dari `api.baseUrl` yang
 * sedang aktif: begitu petugas memilih endpoint intranet, unduhan OTA akan
 * diarahkan ke port 3000 yang tidak melayani /storage -> 404.
 */
export function supabaseProjectOrigin(): string {
  const explicit = (environment as { supabaseUrl?: string }).supabaseUrl
  try {
    return new URL(explicit || environment.apiBaseUrl).origin
  } catch {
    try {
      return new URL(environment.apiBaseUrl).origin
    } catch {
      return 'https://bmiruktfruunegtbydyw.supabase.co'
    }
  }
}

/**
 * Alamat Supabase yang aman ditampilkan (disamarkan sesuai audit).
 * Hanya untuk UI/konfigurasi — JANGAN dipakai untuk request.
 */
export function maskedSupabaseUrl(): string {
  return (environment as { supabaseUrlMask?: string }).supabaseUrlMask
    || (environment as { supabaseUrl?: string }).supabaseUrl
    || environment.apiBaseUrl
}

export function getApiBaseUrl(): string {
  return getBaseUrl()
}

export function normalizeBaseUrl(raw: string): string {
  return normalizeUrl(raw)
}

export interface PingResult {
  /**
   * true = host menjawab (HTTP apa pun), termasuk saat browser memblokir
   * pembacaan respons karena CORS. Lihat `blockedByCors` untuk membedakannya.
   */
  ok: boolean
  ms: number
  blockedByCors?: boolean
  hostAlive?: boolean
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
  // Host yang hidup tetap dianggap ok walau browser memblokir bacaannya (CORS):
  // URL-nya benar, hanya origin pemanggil belum terdaftar di CORS_ORIGIN.
  return {
    ok: r.reachable || r.hostAlive === true,
    ms: r.ms ?? 0,
    blockedByCors: r.blockedByCors,
    hostAlive: r.hostAlive,
    timedOut: r.timedOut,
    status: r.status,
    detail: r.detail,
  }
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

  const url = `${currentBaseUrl()}${path}`
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

/**
 * Base URL aktif.
 *
 * Sengaja TIDAK di-cache di level modul: endpoint bisa diganti saat runtime
 * lewat "Pengaturan Server" (pindah Supabase <-> Intranet). Kalau di-cache,
 * `api.baseUrl` masih menunjuk ke server lama sampai aplikasi di-reload.
 */
function currentBaseUrl(): string {
  return getBaseUrl()
}

export const api = {
  get: async <T>(path: string, timeoutMs = 12000): Promise<ApiResponse<T>> => request<T>('GET', path, undefined, timeoutMs),
  post: async <T>(path: string, body?: unknown, timeoutMs = 12000): Promise<ApiResponse<T>> => request<T>('POST', path, body, timeoutMs),
  put: async <T>(path: string, body?: unknown, timeoutMs = 12000): Promise<ApiResponse<T>> => request<T>('PUT', path, body, timeoutMs),
  delete: async <T>(path: string, timeoutMs = 12000): Promise<ApiResponse<T>> => request<T>('DELETE', path, undefined, timeoutMs),
  setToken: (token: string | null) => saveToken(token),
  get token() { return loadToken() },
  get baseUrl() { return currentBaseUrl() },
  get url() { return currentBaseUrl() },
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
        const res = await fetch(`${currentBaseUrl()}/health?_t=${Date.now()}`, {
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
        res = await fetch(`${currentBaseUrl()}${path}`, {
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
  try {
    const u = new URL(candidate.startsWith('http') ? candidate : `https://${candidate}`)
    return isIntranetBaseUrl(candidate) ? `Intranet (${u.hostname})` : u.hostname
  } catch {
    return candidate
  }
}

export interface ApiBaseCandidate {
  url: string
  label: string
  hint?: string
}

/** URL backend intranet (PC kantor, port 3000). */
export function intranetApiBaseUrl(): string {
  const url = (environment as { intranetApiBaseUrl?: string }).intranetApiBaseUrl
  return (url ?? '').trim()
}

/** True kalau URL tersebut mengarah ke backend intranet (bukan Supabase cloud). */
export function isIntranetBaseUrl(url: string): boolean {
  if (!url) return false
  if (/\.supabase\.co/i.test(url)) return false
  return isPrivateHostUrl(url)
}

export function apiBaseCandidates(): ApiBaseCandidate[] {
  // Intranet lebih dulu karena ia endpoint DEFAULT sistem.
  const candidates: ApiBaseCandidate[] = []
  const intranet = intranetApiBaseUrl()
  if (intranet) {
    candidates.push({
      url: intranet,
      label: 'Intranet Kantor (LAN)',
      hint: 'Default sistem. Server lokal di PC kantor (port 3000), tidak butuh internet.',
    })
  }
  candidates.push({
    url: cloudApiBaseUrl(),
    label: 'Supabase (Cloud)',
    hint: 'Cadangan untuk luar jaringan kantor. Butuh internet.',
  })
  return candidates
}

export function isPrivateHostUrl(url: string): boolean {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return /^127\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^localhost$/i.test(u.hostname)
  } catch { return false }
}

/**
 * Normalisasi input URL dari layar pengaturan server.
 *
 * Sengaja mendelegasikan aturan http/https ke `normalizeUrl()` supaya hanya ada
 * SATU aturan: host privat/LAN boleh http, host publik wajib https. Versi lama
 * fungsi ini selalu menambahkan `http://` saat skema tidak diketik, sehingga
 * `contoh.example.com` tersimpan sebagai `http://contoh.example.com/api` —
 * lolos dari guard di UI (yang hanya memeriksa `http://` eksplisit) dan langsung
 * mati sebagai mixed content di halaman https.
 */
export function normalizeApiBaseInput(raw: string): string {
  const url = String(raw ?? '').trim()
  if (!url) return normalizeUrl(defaultApiBaseUrl())
  const withScheme = /^https?:\/\//i.test(url)
    ? url
    : `${isPrivateHostUrl(url) ? 'http' : 'https'}://${url}`
  return normalizeUrl(withScheme)
}

export type EndpointValidation =
  | { ok: true; url: string }
  | { ok: false; msg: string }

/**
 * Aturan validasi endpoint TUNGGAL.
 *
 * Semua layar pengaturan server (EndpointPicker di mobile & admin,
 * ServerSettingsModal di login/profil, SettingsTab di dashboard) memakai fungsi
 * ini supaya URL yang sama tidak diterima di satu layar dan ditolak di layar
 * lain. `pageProtocol` bisa dioper eksplisit agar bisa diuji tanpa bergantung
 * pada protokol halaman yang sedang berjalan.
 */
export function validateEndpointInput(raw: string, pageProtocol?: string): EndpointValidation {
  const value = String(raw ?? '').trim()
  if (!value) return { ok: false, msg: 'URL kosong.' }

  if (/^http:\/\//i.test(value) && !isPrivateHostUrl(value)) {
    return {
      ok: false,
      msg: 'Pakai https untuk host publik, kecuali alamat LAN/privat (192.168.x, 10.x, 172.16-31.x, localhost).',
    }
  }

  const url = normalizeApiBaseInput(value)
  const page = pageProtocol
    ?? (typeof window !== 'undefined' ? window.location?.protocol : undefined)

  // Halaman https tidak boleh memanggil http:// (mixed content): browser
  // memblokir sebelum request keluar, sehingga server yang hidup akan tampak
  // "tidak merespon".
  if (page === 'https:' && /^http:\/\//i.test(url)) {
    return {
      ok: false,
      msg: 'Halaman ini dibuka lewat https, jadi alamat http:// diblokir browser (mixed content). Pakai endpoint Supabase atau buka aplikasi lewat http://.',
    }
  }

  return { ok: true, url }
}

/**
 * Validasi lalu terapkan endpoint aktif. Mengembalikan hasil validasi supaya
 * pemanggil bisa menampilkan pesan yang sama tanpa menduplikasi aturannya.
 */
export function applyEndpointInput(raw: string, pageProtocol?: string): EndpointValidation {
  const result = validateEndpointInput(raw, pageProtocol)
  if (result.ok) setApiBaseUrl(result.url)
  return result
}

export interface ServerProbeResult {
  /** true = respons berhasil dibaca (status HTTP apa pun). */
  reachable: boolean
  /**
   * true = host benar-benar menjawab, walau isi responsnya tidak bisa dibaca
   * karena CORS. Ini pembeda antara "server mati" dan "server hidup tapi
   * origin kita belum diizinkan".
   */
  hostAlive?: boolean
  ms?: number
  blockedByCors?: boolean
  status?: number
  timedOut?: boolean
  cleartextBlocked?: boolean
  detail?: string
}

/**
 * Probe tanpa CORS (`mode: 'no-cors'`).
 *
 * Respons opaque tidak bisa dibaca, tetapi promise HANYA resolve kalau host
 * benar-benar menjawab. Jadi resolve = host hidup, reject = host tidak
 * terjangkau. Inilah satu-satunya cara andal membedakan kegagalan jaringan
 * biasa dari pemblokiran CORS: pesan `TypeError: Failed to fetch` dipakai
 * browser untuk keduanya.
 */
async function probeHostAlive(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    await fetch(`${url}/health`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal,
    })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

export async function probeServerHealth(url: string, timeoutMs = 5000): Promise<ServerProbeResult> {
  const start = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${url}/health`, { method: 'GET', signal: controller.signal })
    return { reachable: true, hostAlive: true, ms: Date.now() - start, status: res.status }
  } catch (e) {
    const err = e as Error

    // Timeout sudah menghabiskan jatah waktu; probe opaque hanya akan timeout lagi.
    if (err.name === 'AbortError') {
      return {
        reachable: false,
        hostAlive: false,
        ms: Date.now() - start,
        timedOut: true,
        detail: 'Request timed out',
      }
    }

    const hostAlive = await probeHostAlive(url, timeoutMs)
    const ms = Date.now() - start

    if (hostAlive) {
      return {
        reachable: false,
        hostAlive: true,
        blockedByCors: true,
        ms,
        detail: err.message,
      }
    }

    return { reachable: false, hostAlive: false, ms, detail: err.message }
  } finally {
    // Dulu timer hanya dibersihkan di jalur sukses, sehingga setiap probe gagal
    // meninggalkan timer yang tetap hidup sampai timeoutMs.
    clearTimeout(timer)
  }
}

export function setApiBaseUrlOverride(url: string | null): void {
  setApiBaseUrl(url)
}

// Default URL (synchronous) - tanpa override memakai endpoint intranet.
export async function autoDetectApiBaseUrl(_timeoutMs?: number): Promise<string | null> {
  console.log('[API] Menggunakan endpoint default:', defaultApiBaseUrl())
  return defaultApiBaseUrl()
}

// Async version for chained calls. Tidak ada auto-detect ke localhost acak:
// default tetap server intranet kantor (port 3000) yang sudah dikonfigurasi.
export async function autoDetectApiBaseUrlAsync(_timeoutMs = 30000): Promise<string> {
  console.log('[API] Menggunakan endpoint default:', defaultApiBaseUrl())
  return defaultApiBaseUrl()
}
