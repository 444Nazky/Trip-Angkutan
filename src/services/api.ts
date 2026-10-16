import { environment } from '../environments/environment'



const TOKEN_KEY = 'trip.auth.token.v1'
const API_BASE_URL_OVERRIDE_KEY = 'trip.admin.apiBaseUrl'




interface ApiError {
  message: string
  code?: string
}

interface ApiResponse<T> {
  data?: T
  error?: ApiError
  ok: boolean
}




// baca url dinamis (override > env)
export function resolveApiBaseUrl(): string {
  try {
    const override = localStorage.getItem(API_BASE_URL_OVERRIDE_KEY)
    if (override && override.trim()) return normalizeBaseUrl(override)
    const auto = readAutoDetectedBaseUrl()
    if (auto) return auto
  } catch {}
  return normalizeBaseUrl(environment.apiBaseUrl)
}




// host lokal/LAN boleh tanpa TLS; host publik wajib https.
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i



// rapikan format url
export function normalizeBaseUrl(raw: string): string {
  let url = String(raw ?? '').trim().replace(/\/+$/, '')
  if (!url) return url
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    // Dulu selalu `http://` — akibatnya hostname publik yang diketik tanpa skema
    // (mis. tunnel xxx.trycloudflare.com) jadi http di halaman https milik dashboard
    // dan langsung ditolak browser (mixed content) → "Server tidak merespon".
    // Sekarang host lokal/LAN tetap http, sisanya https.
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
}




// hasil cek kesehatan server (dipakai form Server/Endpoint di Pengaturan)
export interface ServerProbe {
  /** server menjawab (walau balasannya tidak bisa dibaca karena CORS / berstatus error) */
  ok: boolean
  ms: number
  /** server hidup tapi browser memblokir bacaannya (origin belum ada di CORS_ORIGIN) */
  blockedByCors: boolean
  /** berhenti karena timeout, bukan karena koneksi ditolak */
  timedOut: boolean
  status?: number
  /**
   * Halaman dashboard dibuka via https sedangkan URL server http:// → browser
   * MEMBLOKIR sebelum request dikirim (mixed content). Server bisa saja sehat;
   * yang salah adalah kombinasi skema. Dulu ini berbunyi "Server tidak merespon".
   */
  mixedContent?: boolean
  /** pesan siap-tampil untuk kasus yang tak bisa diperbaiki dari sisi dashboard */
  detail?: string
}




/** Halaman ini dibuka via https? */
export function isPageHttps(pageHref = typeof location === 'undefined' ? '' : location.href): boolean {
  return /^https:/i.test(String(pageHref ?? ''))
}



/**
 * Apakah request ke URL ini akan diblokir browser karena mixed content?
 *
 * Dashboard produksi disajikan lewat https (Firebase/Netlify), sehingga server
 * http:// — termasuk server LAN kantor 192.168.x — TIDAK BISA dihubungi langsung
 * dari halaman itu. Deteksi di depan supaya admin dapat penjelasan yang benar
 * (pakai https/tunnel, atau jalankan dashboard lokal via `npm start`).
 */
export function isMixedContentRisk(
  rawUrl: string,
  pageHref = typeof location === 'undefined' ? '' : location.href,
): boolean {
  return isPageHttps(pageHref) && /^http:\/\//i.test(normalizeBaseUrl(rawUrl))
}




// Kandidat endpoint bawaan: build produksi hanya mengenal Railway, sehingga
// saat dashboard diarahkan ke server uji (laptop/tunnel/LAN) admin harus mengetik
// URL panjang dan mudah salah. Daftar ini jadi tombol pilih-cepat + auto-deteksi.
export interface ApiBaseCandidate {
  label: string
  url: string
}

const API_BASE_AUTODETECT_KEY = 'trip.admin.api.autoBaseUrl'
const AUTODETECT_TTL_MS = 10 * 60 * 1000




export function apiBaseCandidates(): ApiBaseCandidate[] {
  const urls: ApiBaseCandidate[] = [
    { label: 'Default build', url: normalizeBaseUrl(environment.apiBaseUrl) },
    { label: 'Produksi (Railway)', url: 'https://aplikasi-trip-api-production.up.railway.app/api' },
    { label: 'Backend lokal laptop', url: 'http://localhost:3000/api' },
    { label: 'Backend lokal (LAN)', url: 'http://192.168.1.5:3000/api' },
  ]
  const seen = new Set<string>()
  return urls.filter(c => {
    if (!c.url || seen.has(c.url)) return false
    seen.add(c.url)
    return true
  })
}




export function apiBaseCandidateLabel(url: string): string | null {
  const target = normalizeBaseUrl(url)
  return apiBaseCandidates().find(c => c.url === target)?.label ?? null
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




/** Pilih endpoint pertama yang menjawab dari daftar kandidat (URL manual menang). */
export async function autoDetectApiBaseUrl(timeoutMs = 3500): Promise<string | null> {
  let hasOverride = false
  try {
    const override = localStorage.getItem(API_BASE_URL_OVERRIDE_KEY)
    hasOverride = !!override && !!override.trim()
  } catch { /* storage mati */ }
  if (hasOverride) return resolveApiBaseUrl()

  for (const candidate of apiBaseCandidates()) {
    const probe = await pingBaseUrl(candidate.url, timeoutMs)
    if (!probe.ok) continue
    try {
      localStorage.setItem(API_BASE_AUTODETECT_KEY, JSON.stringify({ url: candidate.url, at: Date.now() }))
    } catch { /* storage penuh */ }
    console.log(`[admin-api] Endpoint auto-detect: ${candidate.label} → ${candidate.url}`)
    return candidate.url
  }
  return null
}



// tes koneksi ke url.
// fetch biasa MENOLAK (throw) bila respons lintas-origin tidak membawa header
// Access-Control-Allow-Origin — padahal server menjawab 200. Dulu itu dilaporkan
// "Server tidak merespon" sehingga URL yang benar ikut dibuang. Di sini kegagalan
// dibedakan: benar-benar mati / timeout / hidup tapi diblokir CORS.
export async function pingBaseUrl(raw: string, timeoutMs = 10000): Promise<ServerProbe> {
  const base = normalizeBaseUrl(raw)
  const t0 = Date.now()

  // https page → http target: browser menolak duluan. Jelaskan sebabnya, jangan
  // bilang "server tidak merespon" (server-nya bisa sehat).
  if (isMixedContentRisk(base)) {
    return {
      ok: false,
      ms: 0,
      blockedByCors: false,
      timedOut: false,
      mixedContent: true,
      detail: 'Dashboard ini dibuka via https, jadi browser memblokir alamat http:// (mixed content). Pakai https (mis. cloudflared tunnel), atau jalankan dashboard lokal (`npm start`) untuk menuju server LAN.',
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const hit = (mode?: RequestMode) =>
    fetch(`${base}/health?_t=${Date.now()}`, {
      cache: 'no-store',
      signal: controller.signal,
      ...(mode ? { mode } : {}),
    })

  try {
    try {
      const r = await hit()
      // Respons HTTP apa pun (200/401/404) = host HIDUP. Dulu hanya `r.ok` yang
      // dianggap hidup sehingga server yang menjawab 401/404 dilaporkan "tidak
      // merespon" dan URL yang benar tidak pernah tersimpan.
      return { ok: true, status: r.status, ms: Date.now() - t0, blockedByCors: false, timedOut: false }
    } catch (err) {
      if (controller.signal.aborted) {
        return { ok: false, ms: Date.now() - t0, blockedByCors: false, timedOut: true }
      }
      // Request mode 'no-cors' tidak butuh header CORS: kalau ini berhasil berarti
      // server hidup dan hanya diblokir browser (origin belum diizinkan server).
      try {
        const r = await hit('no-cors')
        if (r.type === 'opaque' || r.status === 0) {
          return { ok: true, ms: Date.now() - t0, blockedByCors: true, timedOut: false }
        }
        return { ok: true, status: r.status, ms: Date.now() - t0, blockedByCors: false, timedOut: false }
      } catch {
        void err
        return { ok: false, ms: Date.now() - t0, blockedByCors: false, timedOut: false }
      }
    }
  } finally {
    clearTimeout(timer)
  }
}



class ApiService {
  private _token: string | null = null

  constructor() {
    try {
      this._token = localStorage.getItem(TOKEN_KEY)
    } catch {}
  }

  get token() { return this._token }

  setToken(token: string | null) {
    this._token = token
    try {
      if (token) {
        localStorage.setItem(TOKEN_KEY, token)
      } else {
        localStorage.removeItem(TOKEN_KEY)
      }
    } catch {}
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
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 12000)
      const base = resolveApiBaseUrl()

      let res: Response
      try {
        res = await fetch(`${base}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        if (res.status === 401) {
          this.setToken(null)
        }
        return { ok: false, error: { message: data.error || 'Request failed', code: String(res.status) } }
      }

      return { ok: true, data }
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      const message = aborted
        ? `Server tidak merespon (12 detik timeout) — periksa API ${resolveApiBaseUrl()}`
        : err instanceof Error ? err.message : 'Network error'
      return { ok: false, error: { message } }
    }
  }

  get<T>(path: string) { return this.request<T>('GET', path) }
  post<T>(path: string, body?: unknown) { return this.request<T>('POST', path, body) }
  put<T>(path: string, body?: unknown) { return this.request<T>('PUT', path, body) }
  delete<T>(path: string) { return this.request<T>('DELETE', path) }

  getOk<T>(path: string): Promise<T | null> {
    return this.get<T>(path).then(r => (r.ok && r.data ? r.data : null))
  }
}



export const api = new ApiService()
