
import { Capacitor } from '@capacitor/core'
import { environment } from '../environments/environment'



const TOKEN_KEY = 'trip.auth.token.v2'



const API_URL_OVERRIDE_KEY = 'trip.api.baseUrl'



export interface ApiError {
  message: string
  code?: string
}

// Hasil aksi (tambah/hapus/simpan). `reason` dipakai kalau gagal: kalimat penjelasan yang SUDAH mentioning penyebabnya (dari server, atau "server tidak…
export interface ActionResult<T = void> {
  ok: boolean
  data?: T
  reason?: string
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



function getBaseUrl(): string {
  try {
    const override = localStorage.getItem(API_URL_OVERRIDE_KEY)
    if (override?.trim()) return normalizeUrl(override)
  } catch {}
  return normalizeUrl(defaultApiBaseUrl())
}



export function defaultApiBaseUrl(): string {
  const intranet = (environment as { intranetApiBaseUrl?: string }).intranetApiBaseUrl
  return (intranet && intranet.trim()) || environment.apiBaseUrl
}



export function isDefaultIntranet(): boolean {
  return isIntranetBaseUrl(defaultApiBaseUrl())
}



function normalizeUrl(raw: string): string {
  let url = String(raw || '').trim().replace(/\/+$/, '')
  if (!url) return defaultApiBaseUrl()
  if (!/^https?:\/\//i.test(url)) {
    // Host privat/LAN hanya boleh http (server intranet tidak punya TLS). Host publik dipaksa https.
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



export function getApiBaseUrl(): string {
  return getBaseUrl()
}



export function normalizeBaseUrl(raw: string): string {
  return normalizeUrl(raw)
}



export interface PingResult {
  // true = host menjawab (HTTP apa pun), termasuk saat browser memblokir pembacaan respons karena CORS. Lihat `blockedByCors` untuk membedakannya.
  ok: boolean
  ms: number
  blockedByCors?: boolean
  hostAlive?: boolean
  timedOut?: boolean
  status?: number
  mixedContent?: boolean
  detail?: string
}



export async function pingBaseUrl(url: string, timeoutMs = 5000, pageProtocol?: string): Promise<PingResult> {
  // Mixed content hanya berlaku di halaman https yang BUKAN aplikasi native dan bukan loopback. Di APK (WebView) endpoint LAN http:// tetap boleh.
  if (isMixedContentBlocked(url, pageProtocol)) {
    return { ok: false, ms: 0, mixedContent: true, detail: 'http:// diblokir dari halaman https (mixed content)' }
  }
  const r = await probeServerHealth(url, timeoutMs)
  // Host yang hidup tetap dianggap ok walau browser memblokir bacaannya (CORS): URL-nya benar, hanya origin pemanggil belum terdaftar di CORS_ORIGIN.
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



export function getAuthToken(): string | null {
  return loadToken()
}



function loadToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}



function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token)
    else localStorage.removeItem(TOKEN_KEY)
  } catch {}
}


// Ambil kalimat alasan dari body error server.
export function extractErrorMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const b = body as { error?: unknown; message?: unknown }
  if (typeof b.error === 'string' && b.error.trim()) return b.error.trim()
  if (b.error && typeof b.error === 'object') {
    const m = (b.error as { message?: unknown }).message
    if (typeof m === 'string' && m.trim()) return m.trim()
  }
  if (typeof b.message === 'string' && b.message.trim()) return b.message.trim()
  return null
}

// Alasan umum kalau server tidak memberi teks yang bisa dipakai.
export function offlineReason(code: string | undefined): string {
  if (code === 'NETWORK' || code === 'TIMEOUT') {
    return 'Server tidak bisa dihubungi — cek koneksi dan endpoint yang dipakai'
  }
  if (code === '401') return 'Sesi admin sudah berakhir — silakan login ulang'
  if (code === '403') return 'Akses ditolak — butuh hak admin'
  if (code === '404') return 'Data tidak ditemukan di server'
  return 'Server menolak permintaan tanpa penjelasan'
}

// Pesan server yang masih berbahasa Inggris -> kalimat Indonesia. Hanya untuk pesan yang DASAR (bukan pesan Domain).
const SERVER_MSG_ID: Record<string, string> = {
  'invalid token': 'Sesi sudah berakhir — silakan login ulang',
  'admin access required': 'Akses ditolak — tindakan ini butuh hak admin',
  'not authenticated': 'Sesi sudah berakhir — silakan login ulang',
  'forbidden': 'Akses ditolak — tindakan ini butuh hak admin',
}

// Kalimat final untuk sebuah kegagalan: pakai alasan server kalau ada, kalau tidak pakai penjelasan bawaan sesuai kode status.
export function failureReason(res: ApiResponse<unknown>, fallback: string): string {
  const code = res.error?.code
  const msg = res.error?.message?.trim()
  // "HTTP 500" / "HTTP 409" tanpa penjelasan = server tidak mengirim alasan.
  if (msg && !/^HTTP \d+$/i.test(msg) && !/^network error$/i.test(msg)) {
    return SERVER_MSG_ID[msg.toLowerCase()] ?? msg
  }
  if (code === 'NETWORK' || code === 'TIMEOUT') return offlineReason(code)
  if (msg && /^HTTP \d+$/i.test(msg)) return `${fallback} (${msg})`
  return fallback
}

// Bungkus hasil request jadi `ActionResult` dengan alasan yang SUDAH enak dibaca user (siap tampil di notifikasi).
export function toActionResult<T>(res: ApiResponse<T>, fallback: string): ActionResult<void> {
  if (res.ok) return { ok: true }
  return { ok: false, reason: failureReason(res, fallback) }
}



async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  timeoutMs = 12000,
): Promise<ApiResponse<T>> {
  const token = loadToken()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
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
      const msg = extractErrorMessage(data) ?? `HTTP ${res.status}`
      return { ok: false, error: { message: msg, code: String(res.status) } }
    }
    return { ok: true, data }
  } catch (e) {
    clearTimeout(timer)
    const aborted = e instanceof DOMException && e.name === 'AbortError'
    const msg = aborted ? 'Server tidak merespons (timeout)' : 'Network error'
    return { ok: false, error: { message: msg, code: aborted ? 'TIMEOUT' : 'NETWORK' } }
  }
}

// Base URL aktif. Sengaja TIDAK di-cache di level modul: endpoint bisa diganti saat runtime lewat "Pengaturan Server" (pindah antar-server intranet).
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
    try { token = loadToken() } catch {  }
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
        // ponytail: 401 TIDAK boleh menghapus token
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



export function apiBaseCandidateLabel(candidate: string): string {
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



export function intranetApiBaseUrl(): string {
  const url = (environment as { intranetApiBaseUrl?: string }).intranetApiBaseUrl
  return (url ?? '').trim()
}

// URL backend intranet dengan TLS (opsional). Kosong kalau server port 3000 hanya serves http (default).
export function intranetHttpsApiBaseUrl(): string {
  const url = (environment as { intranetHttpsApiBaseUrl?: string }).intranetHttpsApiBaseUrl
  return (url ?? '').trim()
}



export function isIntranetBaseUrl(url: string): boolean {
  if (!url) return false
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
  const intranetHttps = intranetHttpsApiBaseUrl()
  if (intranetHttps) {
    candidates.push({
      url: intranetHttps,
      label: 'Intranet Kantor (HTTPS)',
      hint: 'Server lokal dengan TLS. Dipakai saat aplikasi dibuka lewat https (mixed content).',
    })
  }
  return candidates
}



export function isPrivateHostUrl(url: string): boolean {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return /^127\.|^10\.|^172\.(1[6-9]|2[0-9]|3[01])\.|^192\.168\.|^localhost$/i.test(u.hostname)
  } catch { return false }
}


// True kalau aplikasi sedang berjalan di APLIKASI NATIVE (Capacitor/WebView).
export function isNativeApp(): boolean {
  try {
    return Capacitor?.isNativePlatform?.() === true
  } catch {
    return false
  }
}



export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return /^(localhost|127(\.\d+){3}|\[::1\])$/i.test(u.hostname)
  } catch { return false }
}

// True kalau request ke `url` AKAN diblokir browser karena mixed content (halaman https memanggil endpoint http://).
export function isMixedContentBlocked(url: string, pageProtocol?: string): boolean {
  if (!/^http:\/\//i.test(url)) return false
  const page = pageProtocol
    ?? (typeof window !== 'undefined' ? window.location?.protocol : undefined)
  if (page !== 'https:') return false
  if (isNativeApp()) return false
  if (isLoopbackUrl(url)) return false
  return true
}

// Normalisasi input URL dari layar pengaturan server.
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

// Aturan validasi endpoint TUNGGAL. Semua layar pengaturan server (EndpointPicker di mobile & admin, ServerSettingsModal di login/profil, SettingsTab…
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

  // Halaman https yang DIBUKA DI BROWSER tidak boleh memanggil http:// (mixed content): browser memblokir sebelum request keluar, sehingga server yang…
  if (isMixedContentBlocked(url, page)) {
    return {
      ok: false,
      msg: 'Halaman ini dibuka lewat https, jadi alamat http:// diblokir browser (mixed content). Pakai endpoint https://, atau buka aplikasi lewat http://.',
    }
  }

  return { ok: true, url }
}

// Validasi lalu terapkan endpoint aktif. Mengembalikan hasil validasi supaya pemanggil bisa menampilkan pesan yang sama tanpa menduplikasi aturannya.
export function applyEndpointInput(raw: string, pageProtocol?: string): EndpointValidation {
  const result = validateEndpointInput(raw, pageProtocol)
  if (result.ok) setApiBaseUrl(result.url)
  return result
}



export interface ServerProbeResult {
  reachable: boolean
  // true = host benar-benar menjawab, walau isi responsnya tidak bisa dibaca karena CORS.
  hostAlive?: boolean
  ms?: number
  blockedByCors?: boolean
  status?: number
  timedOut?: boolean
  cleartextBlocked?: boolean
  detail?: string
}

// Probe tanpa CORS (`mode: 'no-cors'`). Respons opaque tidak bisa dibaca, tetapi promise HANYA resolve kalau host benar-benar menjawab.
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
    // Dulu timer hanya dibersihkan di jalur sukses, sehingga setiap probe gagal meninggalkan timer yang tetap hidup sampai timeoutMs.
    clearTimeout(timer)
  }
}



export function setApiBaseUrlOverride(url: string | null): void {
  setApiBaseUrl(url)
}



export async function autoDetectApiBaseUrl(_timeoutMs?: number): Promise<string | null> {
  console.log('[API] Menggunakan endpoint default:', defaultApiBaseUrl())
  return defaultApiBaseUrl()
}



export async function autoDetectApiBaseUrlAsync(_timeoutMs = 30000): Promise<string> {
  console.log('[API] Menggunakan endpoint default:', defaultApiBaseUrl())
  return defaultApiBaseUrl()
}
