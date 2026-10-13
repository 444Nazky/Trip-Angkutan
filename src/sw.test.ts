/**
 * Tes Service Worker OTA v4 (src/sw.js).
 *
 * Fokus (sesuai bug lapangan "update kedua tidak muncul"):
 *   1. SW HANYA menyajikan berkas dari cache VERSI AKTIF (dibaca dari meta).
 *      Chunk milik versi lama tidak boleh pernah tersaji walau masih ada di
 *      Cache Storage.
 *   2. Saat activate: sisa arsitektur v3 dibuang; cache versi non-aktif hanya
 *      dibuang bila versi aktif sudah diketahui (tidak menghapus bundel yang
 *      sedang dibangun ulang oleh halaman).
 */
import { describe, it, expect, beforeEach } from 'vitest'
import swSource from './sw.js?raw'

// ── Cache Storage tiruan (kontrak sama dengan sw.js pakai) ───────────────────

function fakeCaches() {
  const store = new Map<string, Map<string, Uint8Array>>()
  const keyOf = (key: unknown): string => {
    if (typeof key === 'string') return new URL(key, 'https://localhost').href
    if (key instanceof URL) return key.href
    if (key && typeof (key as Request).url === 'string') return (key as Request).url
    return String(key)
  }
  return {
    store,
    async keys() { return [...store.keys()] },
    async delete(name: string) { return store.delete(name) },
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map())
      const entries = store.get(name)!
      return {
        async match(key: unknown) {
          const bytes = entries.get(keyOf(key))
          if (!bytes) return undefined
          return new Response(bytes.slice().buffer as ArrayBuffer)
        },
        async put(key: unknown, res: Response) {
          entries.set(keyOf(key), new Uint8Array(await res.arrayBuffer()))
        },
        async keys() { return [...entries.keys()].map(url => ({ url })) as unknown as Request[] },
        async delete(key: unknown) { return entries.delete(keyOf(key)) },
      }
    },
  }
}

type FakeCaches = ReturnType<typeof fakeCaches>

const ORIGIN = 'https://localhost'
const versionCache = (version: string) => `trip-ota-v${version}`

/** Isi satu berkas di cache bernama `name`. */
async function seed(cacheName: string, path: string, body: string): Promise<void> {
  const cache = await caches().open(cacheName)
  await cache.put(new URL(path, ORIGIN).href, new Response(body))
}

let cacheStore: FakeCaches
const caches = () => cacheStore

/** Jaringan palsu (bundel bawaan APK / server lokal). */
const network = (path: string) => new Response(`JARINGAN:${path}`)

interface Env {
  listeners: Record<string, ((event: unknown) => void)[]>
  fire: (type: string, event: Record<string, unknown>) => void
  /** Jalankan handler dan kembalikan promise respondWith (undefined = lewat). */
  respondWith: (req: Request) => Promise<Response> | undefined
  /** Jalankan handler dan tunggu seluruh waitUntil. */
  waitFor: (type: string, event?: Record<string, unknown>) => Promise<void>
  fetchCalls: string[]
}

/**
 * Evaluasi src/sw.js sebagai skrip klasik dengan `self` tiruan — tanpa
 * menyalin logika SW ke dalam tes (yang membuat tes tidak bermakna).
 */
function loadServiceWorker(): Env {
  const listeners: Env['listeners'] = { install: [], activate: [], message: [], fetch: [] }
  const fetchCalls: string[] = []
  const selfStub = {
    location: { origin: ORIGIN, href: `${ORIGIN}/sw.js` },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
    addEventListener: (type: string, fn: (event: unknown) => void) => { listeners[type]?.push(fn) },
  }
  const fetchStub = (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as Request)?.url ?? input)
    fetchCalls.push(url)
    return Promise.resolve(network(new URL(url).pathname))
  }

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const run = new Function('self', 'caches', 'fetch', 'Response', 'Request', 'URL', swSource)
  run(selfStub, cacheStore, fetchStub, Response, Request, URL)

  const fire = (type: string, event: Record<string, unknown>) => {
    for (const fn of listeners[type] ?? []) fn(event)
  }

  return {
    listeners,
    fetchCalls,
    fire,
    respondWith: (req: Request) => {
      let result: Promise<Response> | undefined
      fire('fetch', { request: req, respondWith: (p: Promise<Response>) => { result = p } })
      return result
    },
    waitFor: async (type: string, extra: Record<string, unknown> = {}) => {
      const pending: Promise<unknown>[] = []
      fire(type, { ...extra, waitUntil: (p: Promise<unknown>) => { pending.push(p) } })
      await Promise.all(pending)
    },
  }
}

let sw: Env

beforeEach(async () => {
  cacheStore = fakeCaches()
  sw = loadServiceWorker()
  await seed('trip-ota-meta', '__active__.json', JSON.stringify({ version: '1.0.2', assets: ['index.html'] }))
  // Versi lama sengaja MASIH ADA di Cache Storage (sisa unduhan sebelumnya).
  await seed(versionCache('1.0.1'), 'index.html', 'LAMA-1.0.1')
  await seed(versionCache('1.0.1'), 'main-aaa.js', 'CHUNK-LAMA')
  await seed(versionCache('1.0.2'), 'index.html', 'BARU-1.0.2')
  await seed(versionCache('1.0.2'), 'main-bbb.js', 'CHUNK-BARU')
})

describe('Service Worker v4 — hanya versi aktif yang disajikan', () => {
  it('navigasi dilayani index.html versi AKTIF, bukan versi lama', async () => {
    const res = await sw.respondWith(new Request(`${ORIGIN}/?ota=1.0.2`))
    expect(res).toBeDefined()
    expect(await res!.text()).toBe('BARU-1.0.2')
  })

  it('chunk yang hanya ada di cache versi LAMA tidak pernah disajikan', async () => {
    const res = await sw.respondWith(new Request(`${ORIGIN}/main-aaa.js`))
    expect(res).toBeDefined() // respondWith dipanggil…
    expect(await res!.text()).toBe('JARINGAN:/main-aaa.js') // …tetapi isinya dari jaringan (bukan cache lama)
    expect(sw.fetchCalls).toContain(`${ORIGIN}/main-aaa.js`)
  })

  it('chunk versi aktif disajikan dari cache (tanpa menyentuh jaringan)', async () => {
    const res = await sw.respondWith(new Request(`${ORIGIN}/main-bbb.js`))
    expect(await res!.text()).toBe('CHUNK-BARU')
    expect(sw.fetchCalls).not.toContain(`${ORIGIN}/main-bbb.js`)
  })

  it('tanpa meta (belum ada OTA) → langsung ke jaringan, cache apa pun diabaikan', async () => {
    await caches().delete('trip-ota-meta')
    const res = await sw.respondWith(new Request(`${ORIGIN}/`))
    expect(await res!.text()).toBe('JARINGAN:/')
  })

  it('permintaan non-bundle & lintas origin tidak diintersep', async () => {
    expect(sw.respondWith(new Request(`${ORIGIN}/api/geofences`))).toBeUndefined()
    expect(sw.respondWith(new Request('https://raw.githubusercontent.com/x/y.json'))).toBeUndefined()
  })
})

describe('Service Worker v4 — siklus hidup & purge', () => {
  it('activate: bangun sisa v3 dibuang, cache versi non-aktif dibuang', async () => {
    await seed('trip-ota-active', 'index.html', 'SISA-V3')
    await seed('trip-ota-complement', 'index.html', 'SISA-V3-B')
    await seed(versionCache('1.0.0'), 'index.html', 'SISA-1.0.0')

    await sw.waitFor('activate')

    const names = await cacheStore.keys()
    expect(names).toContain(versionCache('1.0.2')) // versi aktif dipertahankan
    expect(names).not.toContain(versionCache('1.0.1'))
    expect(names).not.toContain(versionCache('1.0.0'))
    expect(names).not.toContain('trip-ota-active')
    expect(names).not.toContain('trip-ota-complement')
  })

  it('activate tanpa meta tidak menghapus cache versi (halaman sedang self-heal)', async () => {
    await caches().delete('trip-ota-meta')
    await sw.waitFor('activate')
    expect(await cacheStore.keys()).toContain(versionCache('1.0.1'))
  })

  it('versi aktif baru langsung berlaku (switch atomik lewat meta)', async () => {
    await seed('trip-ota-meta', '__active__.json', JSON.stringify({ version: '1.0.3', assets: ['index.html'] }))
    await seed(versionCache('1.0.3'), 'index.html', 'BARU-1.0.3')

    const res = await sw.respondWith(new Request(`${ORIGIN}/`))
    expect(await res!.text()).toBe('BARU-1.0.3')
  })
})
