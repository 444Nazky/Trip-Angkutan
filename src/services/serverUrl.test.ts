import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'



// Runtime Capacitor dibuat bisa dikendalikan: sebagian besar tes berjalan sebagai
// web (native=false); tes "APK" menyalakannya untuk memeriksa fallback plugin.
const cap = vi.hoisted(() => ({
  native: false,
  calls: 0,
  httpImpl: async (_opts: unknown): Promise<{ status: number; data?: unknown }> => ({ status: 200, data: {} }),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => cap.native,
    getPlatform: () => 'android',
    isPluginAvailable: () => true,
  },
  CapacitorHttp: {
    get: (opts: unknown) => { cap.calls += 1; return cap.httpImpl(opts) },
    request: (opts: unknown) => { cap.calls += 1; return cap.httpImpl(opts) },
  },
}))

import { api, autoDetectApiBaseUrl, normalizeApiBaseInput, probeServerHealth, resolveApiBaseUrl, setApiBaseUrlOverride } from './api'
import { environment } from '../environments/environment'




afterEach(() => {
  setApiBaseUrlOverride(null)
  localStorage.removeItem('trip.api.autoBaseUrl')
})




describe('dynamic backend url', () => {
  it('pakai env bila tak ada override', () => {
    expect(resolveApiBaseUrl()).toBe(environment.apiBaseUrl.replace(/\/+$/, ''))
  })




  it('override menang + akhiran /api', () => {
    setApiBaseUrlOverride('https://abc.trycloudflare.com/')
    expect(resolveApiBaseUrl()).toBe('https://abc.trycloudflare.com/api')
    expect(api.baseUrl).toBe('https://abc.trycloudflare.com/api')
  })




  it('reset kembali ke default', () => {
    setApiBaseUrlOverride('https://abc.trycloudflare.com')
    setApiBaseUrlOverride(null)
    expect(resolveApiBaseUrl()).toBe(environment.apiBaseUrl.replace(/\/+$/, ''))
  })




  it('hostname publik tanpa skema → https (dulu http → diblokir mixed-content)', () => {
    expect(normalizeApiBaseInput('abc.trycloudflare.com')).toBe('https://abc.trycloudflare.com/api')
  })




  it('localhost/LAN tanpa skema tetap http', () => {
    expect(normalizeApiBaseInput('localhost:3000')).toBe('http://localhost:3000/api')
    expect(normalizeApiBaseInput('192.168.1.5:3000')).toBe('http://192.168.1.5:3000/api')
  })




  it('skema eksplisit tetap dihormati', () => {
    expect(normalizeApiBaseInput('http://10.0.0.2:3000/')).toBe('http://10.0.0.2:3000/api')
  })
})

// ── Probe kesehatan server (penyebab notifikasi "Server tidak merespon") ────────

const originalFetch = globalThis.fetch

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('probeServerHealth', () => {
  it('server hidup tapi tidak ada header CORS → reachable + blockedByCors', async () => {
    const modes: string[] = []
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const mode = (init?.mode ?? 'cors') as string
      modes.push(mode)
      // fetch biasa ditolak browser karena tak ada Access-Control-Allow-Origin...
      if (mode === 'cors') throw new TypeError('Failed to fetch')
      // ...tetapi mode 'no-cors' lolos → server memang hidup.
      return { type: 'opaque', status: 0, ok: false } as unknown as Response
    }) as unknown as typeof fetch

    const r = await probeServerHealth('https://abc.trycloudflare.com')
    expect(modes).toEqual(['cors', 'no-cors'])
    expect(r.reachable).toBe(true)
    expect(r.blockedByCors).toBe(true)
  })

  it('server mati benar-benar → reachable false, bukan timeout', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    const r = await probeServerHealth('https://abc.trycloudflare.com')
    expect(r.reachable).toBe(false)
    expect(r.blockedByCors).toBe(false)
    expect(r.timedOut).toBeFalsy()
  })

  it('jawaban terbaca → status & ms dilaporkan', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, type: 'cors' })) as unknown as typeof fetch

    const r = await probeServerHealth('https://abc.trycloudflare.com')
    expect(r).toMatchObject({ reachable: true, status: 200, blockedByCors: false })
    expect(r.ms).toBeGreaterThanOrEqual(0)
  })

  it('server hidup tapi /health balas 404 → tetap reachable (dulu "tidak merespon" lalu URL dibuang)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, type: 'cors' })) as unknown as typeof fetch

    const r = await probeServerHealth('https://abc.trycloudflare.com')

    expect(r.reachable).toBe(true)
    expect(r.status).toBe(404)
    expect(r.detail).toMatch(/404/)
  })

  it('timeout → timedOut true', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch

    const r = await probeServerHealth('https://abc.trycloudflare.com', 30)
    expect(r.timedOut).toBe(true)
    expect(r.reachable).toBe(false)
  })

  it('menembak /api/health pada URL yang sudah dinormalisasi', async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      seen.push(String(url))
      return { ok: true, status: 200, type: 'cors' } as unknown as Response
    }) as unknown as typeof fetch

    await probeServerHealth('https://abc.trycloudflare.com/')
    expect(seen).toHaveLength(1)
    expect(seen[0].startsWith('https://abc.trycloudflare.com/api/health?_t=')).toBe(true)
  })
})

// ── Probe di APK (native Capacitor) ──────────────────────────────────────────

const originalFetchNative = globalThis.fetch

describe('probeServerHealth di APK (native)', () => {
  beforeEach(() => {
    cap.native = true
    cap.calls = 0
    cap.httpImpl = async () => ({ status: 200, data: {} })
    localStorage.clear()
  })

  afterEach(() => {
    cap.native = false
    globalThis.fetch = originalFetchNative
    vi.restoreAllMocks()
  })

  it('plugin HTTP native gagal → fallback fetch WebView (dulu langsung "tidak merespon")', async () => {
    cap.httpImpl = async () => {
      throw new Error('"CapacitorHttp" plugin is not implemented on android')
    }
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      seen.push(String(url))
      return { ok: true, status: 200, type: 'cors' } as unknown as Response
    }) as unknown as typeof fetch

    const r = await probeServerHealth('https://abc.trycloudflare.com')

    expect(cap.calls).toBe(1) // native dicoba lebih dulu
    expect(r.reachable).toBe(true)
    expect(r.status).toBe(200)
    expect(seen).toHaveLength(1) // server yang hidup TIDAK lagi dilaporkan mati
  })

  it('URL http:// ke host non-lokal diblokir Android → dijelaskan, bukan "tidak merespon"', async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      seen.push(String(url))
      return { ok: true, status: 200, type: 'cors' } as unknown as Response
    }) as unknown as typeof fetch

    const r = await probeServerHealth('192.168.1.5:3000')

    expect(r.reachable).toBe(false)
    expect(r.cleartextBlocked).toBe(true)
    expect(r.detail).toMatch(/https/i)
    expect(cap.calls).toBe(0)
    expect(seen).toEqual([])
  })

  it('plugin native tersedia & server hidup → status dilaporkan tanpa menyentuh fetch', async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      seen.push(String(url))
      return { ok: true, status: 200, type: 'cors' } as unknown as Response
    }) as unknown as typeof fetch

    const r = await probeServerHealth('https://abc.trycloudflare.com')

    expect(r).toMatchObject({ reachable: true, status: 200, blockedByCors: false })
    expect(seen).toEqual([])
  })

  it('native: /health balas 401 → host hidup, URL tetap bisa disimpan', async () => {
    cap.httpImpl = async () => ({ status: 401, data: { error: 'Unauthorized' } })

    const r = await probeServerHealth('https://abc.trycloudflare.com')

    expect(r.reachable).toBe(true)
    expect(r.status).toBe(401)
  })
})

// ── Auto-deteksi endpoint kandidat ────────────────────────────────────────

describe('autoDetectApiBaseUrl', () => {
  it('pakai kandidat pertama yang menjawab, simpan sementara, dan override manual tetap menang', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('localhost:3000')) throw new TypeError('Failed to fetch')
      return { ok: true, status: 200, type: 'cors' } as unknown as Response
    }) as unknown as typeof fetch

    const found = await autoDetectApiBaseUrl(60)

    expect(found).toBe('https://aplikasi-trip-api-production.up.railway.app/api')
    expect(resolveApiBaseUrl()).toBe(found)

    setApiBaseUrlOverride('https://manual.example.com')
    expect(await autoDetectApiBaseUrl(60)).toBe('https://manual.example.com/api')
    expect(resolveApiBaseUrl()).toBe('https://manual.example.com/api')
  })

  it('tidak ada kandidat yang menjawab → null, URL default tidak diubah', async () => {
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch

    expect(await autoDetectApiBaseUrl(40)).toBeNull()
    expect(resolveApiBaseUrl()).toBe(environment.apiBaseUrl.replace(/\/+$/, ''))
  })
})
