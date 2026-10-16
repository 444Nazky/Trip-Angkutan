import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { environment } from '../environments/environment'




const TOKEN_KEY = 'trip.auth.token.v1'
const API_BASE_URL_OVERRIDE_KEY = 'trip.api.baseUrl'




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




function getBaseUrl(): string {
  return resolveApiBaseUrl()
}




// baca url dinamis (override > env)
export function resolveApiBaseUrl(): string {
  try {
    const override = localStorage.getItem(API_BASE_URL_OVERRIDE_KEY)
    if (override && override.trim()) return normalizeBaseUrl(override)
    const auto = readAutoDetectedBaseUrl()
    if (auto) return auto
  } catch {}
  const runtime = (globalThis as { __TRIP_API_BASE_URL__?: string }).__TRIP_API_BASE_URL__
  if (typeof runtime === 'string' && runtime.trim()) {
    return normalizeBaseUrl(runtime)
  }
  return normalizeBaseUrl(environment.apiBaseUrl)
}




// hasil cek kesehatan server (dipakai modal Pengaturan Server)
export interface ServerProbeResult {
  /** server menjawab (walau balasannya tidak bisa dibaca karena CORS) */
  reachable: boolean
  /** status HTTP bila benar-benar terbaca */
  status?: number
  ms: number
  /** server hidup tapi browser memblokir bacaannya (tak ada Access-Control-Allow-Origin) */
  blockedByCors: boolean
  /** berhenti karena timeout, bukan karena koneksi ditolak */
  timedOut?: boolean
  /** URL http:// non-localhost di APK (diblokir Android, bukan masalah jaringan) */
  cleartextBlocked?: boolean
  /** ringkasan penyebab gagal — supaya petugas tahu apa yang harus diperbaiki */
  detail?: string
}




// rapikan format url (dipakai juga untuk memvalidasi input di Pengaturan Server)
export function normalizeApiBaseInput(raw: string): string {
  return normalizeBaseUrl(raw)
}




// Cek apakah server hidup.
// fetch biasa akan MENOLAK (throw) bila respons lintas-origin tidak punya header
// Access-Control-Allow-Origin — padahal servernya menjawab 200. Dulu itu dilaporkan
// sebagai "server tidak merespon" sehingga petugas mengganti-ganti URL padahal URL-nya
// benar. Di sini kegagalan dibedakan: benar-benar mati / timeout / diblokir CORS.
//
// Jalur native memakai HTTP native (tanpa CORS), tetapi plugin native bisa tak
// tersedia di build tertentu (mis. APK lama tanpa CapacitorHttp aktif) dan gagal
// dalam hitungan milidetik — itu dulu langsung dilaporkan "server tidak merespon".
// Sekarang kegagalan native di-fallback ke fetch WebView sebelum disimpulkan mati.
export async function probeServerHealth(raw: string, timeoutMs = 10000): Promise<ServerProbeResult> {
  const url = normalizeApiBaseInput(raw)
  const t0 = Date.now()

  // APK hanya mengizinkan http:// untuk host LAN/privat (lihat
  // android/app/src/main/res/xml/network_security_config.xml). Host PUBLIK tetap
  // wajib https. Bedakan sejak awal supaya pesannya jelas, bukan "tidak merespon".
  if (Capacitor.isNativePlatform() && /^http:\/\//i.test(url) && !isPrivateHostUrl(url)) {
    const host = url.replace(/^http:\/\//i, '').split('/')[0]
    return {
      reachable: false,
      ms: Date.now() - t0,
      blockedByCors: false,
      cleartextBlocked: true,
      detail: `Host publik wajib https:// (http://${host} diblokir Android). Alamat LAN/privat (192.168.x, 10.x, 172.16-31.x, localhost) tetap boleh http://.`,
    }
  }

  // Aplikasi native (APK) tidak punya CORS → pakai HTTP native agar hasilnya pasti.
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.get({
        url: `${url}/health?_t=${Date.now()}`,
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs,
        headers: { 'Cache-Control': 'no-cache' },
      })
      return {
        // Ada respons HTTP apa pun (200/401/404) = server HIDUP. Dulu hanya 2xx-3xx
        // yang dianggap hidup, sehingga server yang menjawab 401/404 (mis. versi
        // rute health berbeda) dilaporkan "Server tidak merespon" dan URL yang
        // benar ikut dibuang.
        reachable: Number.isFinite(res.status) && res.status > 0,
        status: res.status,
        ms: Date.now() - t0,
        blockedByCors: false,
        detail: res.status >= 200 && res.status < 400 ? undefined : `HTTP ${res.status}`,
      }
    } catch (err) {
      // Plugin native tak tersedia / gagal → lanjut ke fetch WebView di bawah,
      // jangan langsung menyimpulkan server mati.
      console.warn('[probe] HTTP native gagal, fallback ke fetch WebView:', err)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const hit = (mode?: RequestMode) =>
    fetch(`${url}/health?_t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
      ...(mode ? { mode } : {}),
    })

  try {
    try {
      // Sama seperti jalur native: respons apa pun = server hidup. Yang menandakan
      // server mati hanya kegagalan jaringan (koneksi ditolak/timeout/CORS).
      const res = await hit()
      return {
        reachable: true,
        status: res.status,
        ms: Date.now() - t0,
        blockedByCors: false,
        detail: res.ok ? undefined : `HTTP ${res.status}`,
      }
    } catch (err) {
      // Timeout → server tak menjawab sama sekali.
      if (controller.signal.aborted) {
        return { reachable: false, timedOut: true, ms: Date.now() - t0, blockedByCors: false }
      }
      // Gagal karena CORS: request mode 'no-cors' tidak butuh header CORS,
      // jadi kalau ini berhasil berarti server hidup dan hanya diblokir browser.
      try {
        const res = await hit('no-cors')
        if (res.type === 'opaque' || res.status === 0) {
          return { reachable: true, blockedByCors: true, ms: Date.now() - t0 }
        }
        return { reachable: true, status: res.status, ms: Date.now() - t0, blockedByCors: false }
      } catch {
        return {
          reachable: false,
          ms: Date.now() - t0,
          blockedByCors: false,
          detail: err instanceof Error ? err.message : undefined,
        }
      }
    }
  } finally {
    clearTimeout(timer)
  }
}




// host lokal/LAN boleh tanpa TLS; host publik wajib https.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i



/**
 * Apakah host URL ini loopback/LAN privat (boleh http:// di APK)?
 *
 * Dipakai bersama oleh probe kesehatan server dan penyimpanan URL manual, supaya
 * tidak ada lagi ketidakcocokan: dulu normalizeBaseUrl menganggap 192.168.x LOKAL
 * (tetap http) sementara probe menyebutnya "diblokir APK" — petugas melihat
 * "Server tidak merespon (8 ms)" untuk server LAN yang sebenarnya sehat.
 */
export function isPrivateHostUrl(raw: string): boolean {
  const value = String(raw ?? '').trim()
  if (!value) return false
  const authority = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split('/')[0].split('@').pop() ?? ''
  const host = authority.startsWith('[')
    ? authority.slice(1, authority.includes(']') ? authority.indexOf(']') : undefined)
    : authority.replace(/:\d+$/, '')
  return LOCAL_HOST.test(host) || host === '::1'
}




function normalizeBaseUrl(raw: string): string {
  let url = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!url) return url
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    // Dulu selalu `http://` — akibatnya hostname publik yang diketik tanpa skema
    // (mis. tunnel xxx.trycloudflare.com) jadi http di halaman https dan selalu
    // diblokir browser. Sekarang host lokal/LAN tetap http, sisanya https.
    const host = url.split('/')[0]
    url = `${LOCAL_HOST.test(host) ? 'http' : 'https'}://${url}`
  }
  if (!/\/api$/i.test(url)) url = `${url}/api`
  return url
}




// simpan url dinamis
export function setApiBaseUrlOverride(url: string | null): void {
  try {
    if (url && url.trim()) localStorage.setItem(API_BASE_URL_OVERRIDE_KEY, url.trim())
    else localStorage.removeItem(API_BASE_URL_OVERRIDE_KEY)
  } catch {}
  api?.refreshBaseUrl()
}




export function getApiBaseUrl(): string {
  return getBaseUrl()
}




// ── Kandidat endpoint bawaan (auto-deteksi) ──────────────────────────────────
// Dulu endpoint hanya bisa dari env (build rilis = Railway), sehingga saat
// petugas/admin memakai server uji (laptop/tunnel/LAN) mereka harus mengetik URL
// panjang dan gagal tes karena salah satu pihak tidak bisa dijangkau. Sekarang ada
// daftar kandidat: yang bisa dijangkau dipakai otomatis, dan URL manual tetap menang.
export interface ApiBaseCandidate {
  label: string
  url: string
}

// ponytail: kunci berversi — cache auto-detect lama (era default localhost) diabaikan sekali.
const API_BASE_AUTODETECT_KEY = 'trip.api.autoBaseUrl.v2'
const AUTODETECT_TTL_MS = 10 * 60 * 1000




export function apiBaseCandidates(): ApiBaseCandidate[] {
  const urls: ApiBaseCandidate[] = [
    // ponytail: default = Railway; kandidat lokal hanya fallback bila Railway mati.
    { label: 'Produksi (Railway)', url: 'https://aplikasi-trip-api-production.up.railway.app/api' },
    { label: 'Default build', url: normalizeBaseUrl(environment.apiBaseUrl) },
    { label: 'Backend lokal laptop', url: 'http://localhost:3000/api' },
    { label: 'Emulator Android', url: 'http://10.0.2.2:3000/api' },
  ]
  const seen = new Set<string>()
  return urls.filter(c => {
    if (!c.url || seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })
}




function readAutoDetectedBaseUrl(): string | null {
  try {
    const raw = localStorage.getItem(API_BASE_AUTODETECT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { url?: string; at?: number }
    if (!parsed?.url) return null
    if (Date.now() - Number(parsed.at ?? 0) > AUTODETECT_TTL_MS) return null
    return normalizeBaseUrl(parsed.url)
  } catch {
    return null
  }
}




/**
 * Cari endpoint yang benar-benar menjawab dari daftar kandidat, lalu simpan
 * sementara (TTL 10 menit). URL manual (override) selalu diprioritaskan dan
 * tidak pernah ditimpa fungsi ini.
 */
export async function autoDetectApiBaseUrl(timeoutMs = 3500): Promise<string | null> {
  let hasOverride = false
  try {
    const override = localStorage.getItem(API_BASE_URL_OVERRIDE_KEY)
    hasOverride = !!override && !!override.trim()
  } catch { /* storage mati */ }
  if (hasOverride) return resolveApiBaseUrl()

  for (const candidate of apiBaseCandidates()) {
    const probe = await probeServerHealth(candidate.url, timeoutMs)
    if (!probe.reachable) continue
    try {
      localStorage.setItem(API_BASE_AUTODETECT_KEY, JSON.stringify({ url: candidate.url, at: Date.now() }))
    } catch { /* storage penuh */ }
    api?.refreshBaseUrl()
    console.log(`[api] Endpoint auto-detect: ${candidate.label} → ${candidate.url}`)
    return candidate.url
  }
  return null
}




/** Label kandidat yang cocok dengan URL aktif (untuk ditampilkan di UI). */
export function apiBaseCandidateLabel(url: string): string | null {
  const target = normalizeBaseUrl(url)
  return apiBaseCandidates().find(c => c.url === target)?.label ?? null
}




class ApiService {
  private _baseUrl = getBaseUrl()
  private _token: string | null = null

  // ponytail: tidak ada request yang boleh menghapus token (lihat 401 di bawah).

  constructor() {
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

  refreshBaseUrl() {
    this._baseUrl = getBaseUrl()
  }

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
        // ponytail: 401 TIDAK boleh menghapus token — dulu satu 401 (token basi
        // di salah satu dari 4 request paralel) menghapus token di storage,
        // sehingga renew tak pernah bisa dipanggil dan sesi mati permanen
        // ("session renewal failed" padahal petugas sudah login). Token hanya
        // diganti saat login/refresh eksplisit. TODO-security: hapus sesi hanya
        // untuk 401 yang terbukti revokasi, bukan expiry.
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
        // ponytail: 401 TIDAK boleh menghapus token — dulu satu 401 (token basi
        // di salah satu dari 4 request paralel) menghapus token di storage,
        // sehingga renew tak pernah bisa dipanggil dan sesi mati permanen
        // ("session renewal failed" padahal petugas sudah login). Token hanya
        // diganti saat login/refresh eksplisit. TODO-security: hapus sesi hanya
        // untuk 401 yang terbukti revokasi, bukan expiry.
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
