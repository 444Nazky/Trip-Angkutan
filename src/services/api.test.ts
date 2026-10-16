/**
 * Tes Pengaturan Server (dynamic backend URL) di dashboard admin.
 *
 * Akar masalah yang dijaga:
 *   1. Hostname publik yang diketik tanpa skema dulu dipaksa `http://` — di
 *      halaman https itu langsung ditolak browser (mixed content) sehingga toast
 *      berbunyi "Server tidak merespon (8 ms)" padahal URL benar.
 *   2. fetch biasa MENOLAK respons lintas-origin tanpa header CORS. Dulu itu
 *      dilaporkan sebagai "server tidak merespon" sehingga URL yang benar tidak
 *      pernah tersimpan. Sekarang server-yang-hidup-tapi-CORS dibedakan.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autoDetectApiBaseUrl, isMixedContentRisk, normalizeBaseUrl, pingBaseUrl, resolveApiBaseUrl, setApiBaseUrlOverride } from './api'



const originalFetch = globalThis.fetch

// Suite dashboard berjalan di environment `node` (tanpa jsdom), jadi localStorage
// dibuat manual. Kodenya membaca storage secara lazy, sehingga stub ini cukup.
function installStorageStub(): void {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)) },
    removeItem: (k: string) => { store.delete(k) },
    clear: () => { store.clear() },
  }
}

beforeEach(() => {
  installStorageStub()
})

afterEach(() => {
  globalThis.fetch = originalFetch
  setApiBaseUrlOverride(null)
  vi.restoreAllMocks()
})



describe('normalizeBaseUrl (Pengaturan Server)', () => {
  it('hostname publik tanpa skema → https (dulu http → mixed content 8 ms)', () => {
    expect(normalizeBaseUrl('abc.trycloudflare.com')).toBe('https://abc.trycloudflare.com/api')
  })

  it('localhost/LAN tanpa skema tetap http', () => {
    expect(normalizeBaseUrl('localhost:3000')).toBe('http://localhost:3000/api')
    expect(normalizeBaseUrl('192.168.1.5:3000')).toBe('http://192.168.1.5:3000/api')
  })

  it('akhiran /api ditambahkan sekali saja', () => {
    expect(normalizeBaseUrl('https://abc.trycloudflare.com/api/')).toBe('https://abc.trycloudflare.com/api')
  })
})



describe('mixed content (halaman https → server http://)', () => {
  it('server LAN http dari dashboard https terdeteksi sebagai mixed content', () => {
    expect(isMixedContentRisk('192.168.1.5:3000', 'https://aplikasi-trip.web.app/')).toBe(true)
    expect(isMixedContentRisk('http://192.168.1.5:3000/api', 'https://aplikasi-trip.web.app/')).toBe(true)
  })

  it('https target / dashboard lokal http tidak dianggap mixed content', () => {
    expect(isMixedContentRisk('https://abc.trycloudflare.com', 'https://aplikasi-trip.web.app/')).toBe(false)
    expect(isMixedContentRisk('192.168.1.5:3000', 'http://localhost:5173/')).toBe(false)
  })

  it('pingBaseUrl melaporkan mixedContent (bukan "tidak merespon") tanpa menembak jaringan', async () => {
    let called = 0
    globalThis.fetch = vi.fn(async () => { called++; return { ok: true, status: 200, type: 'cors' } as unknown as Response }) as unknown as typeof fetch
    ;(globalThis as { location?: unknown }).location = { href: 'https://aplikasi-trip.web.app/' }
    try {
      const r = await pingBaseUrl('192.168.1.5:3000')
      expect(r.ok).toBe(false)
      expect(r.mixedContent).toBe(true)
      expect(r.timedOut).toBe(false)
      expect(r.detail).toMatch(/mixed content|https/i)
      expect(called).toBe(0)
    } finally {
      delete (globalThis as { location?: unknown }).location
    }
  })
})



describe('pingBaseUrl (tes koneksi sebelum menyimpan URL)', () => {
  it('server hidup tanpa header CORS → ok + blockedByCors (URL tetap boleh disimpan)', async () => {
    const modes: string[] = []
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const mode = (init?.mode ?? 'cors') as string
      modes.push(mode)
      if (mode === 'cors') throw new TypeError('Failed to fetch')
      return { type: 'opaque', status: 0, ok: false } as unknown as Response
    }) as unknown as typeof fetch

    const r = await pingBaseUrl('https://abc.trycloudflare.com')

    expect(modes).toEqual(['cors', 'no-cors'])
    expect(r.ok).toBe(true)
    expect(r.blockedByCors).toBe(true)
  })

  it('server benar-benar mati → ok false, bukan timeout', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    const r = await pingBaseUrl('https://abc.trycloudflare.com')

    expect(r.ok).toBe(false)
    expect(r.blockedByCors).toBe(false)
    expect(r.timedOut).toBe(false)
  })

  it('respons terbaca → status dilaporkan', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, type: 'cors' })) as unknown as typeof fetch

    const r = await pingBaseUrl('https://abc.trycloudflare.com')

    expect(r).toMatchObject({ ok: true, status: 200, blockedByCors: false, timedOut: false })
    expect(r.ms).toBeGreaterThanOrEqual(0)
  })

  it('/health balas 404 → host hidup (URL tetap boleh disimpan)', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, type: 'cors' })) as unknown as typeof fetch

    const r = await pingBaseUrl('https://abc.trycloudflare.com')

    expect(r.ok).toBe(true)
    expect(r.status).toBe(404)
    expect(r.timedOut).toBe(false)
  })

  it('timeout → timedOut true', async () => {
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })) as unknown as typeof fetch

    const r = await pingBaseUrl('https://abc.trycloudflare.com', 30)

    expect(r.timedOut).toBe(true)
    expect(r.ok).toBe(false)
  })

  it('menembak /api/health pada URL yang sudah dinormalisasi', async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (url: string) => {
      seen.push(String(url))
      return { ok: true, status: 200, type: 'cors' } as unknown as Response
    }) as unknown as typeof fetch

    await pingBaseUrl('https://abc.trycloudflare.com/')

    expect(seen).toHaveLength(1)
    expect(seen[0].startsWith('https://abc.trycloudflare.com/api/health?_t=')).toBe(true)
  })
})



describe('autoDetectApiBaseUrl (endpoint bawaan tidak lagi hanya Railway)', () => {
  it('pakai kandidat pertama yang menjawab & simpan sementara', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('localhost:3000')) throw new TypeError('Failed to fetch')
      return { ok: true, status: 200, type: 'cors' } as unknown as Response
    }) as unknown as typeof fetch

    const found = await autoDetectApiBaseUrl(60)

    expect(found).toBe('https://aplikasi-trip-api-production.up.railway.app/api')
    expect(resolveApiBaseUrl()).toBe(found)
  })

  it('server lokal yang hidup dipilih lebih dulu bila terjangkau', async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('localhost:3000')) return { ok: true, status: 200, type: 'cors' } as unknown as Response
      throw new TypeError('Failed to fetch')
    }) as unknown as typeof fetch

    expect(await autoDetectApiBaseUrl(60)).toBe('http://localhost:3000/api')
  })

  it('override manual tidak pernah ditimpa auto-deteksi', async () => {
    setApiBaseUrlOverride('https://manual.example.com')
    globalThis.fetch = vi.fn(async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch

    expect(await autoDetectApiBaseUrl(40)).toBe('https://manual.example.com/api')
  })
})
