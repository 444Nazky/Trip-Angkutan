import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest'
import { api, normalizeApiBaseInput, probeServerHealth, resolveApiBaseUrl, setApiBaseUrlOverride } from './api'
import { environment } from '../environments/environment'




afterEach(() => {
  setApiBaseUrlOverride(null)
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
