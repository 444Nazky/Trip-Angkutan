import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isNewer, activateBundle, OTA_CACHE } from './ota'

const h = vi.hoisted(() => ({
  native: true,
  files: new Map<string, string>(),
  storageRoot: 'trip-ota',
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'cache' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    async readFile({ path }: { path: string }) {
      const v = h.files.get(path)
      if (!v) throw new Error(`tidak ada: ${path}`)
      return { data: v }
    },
    async writeFile() { /* no-op */ },
    async rmdir({ path }: { path: string }) {
      for (const k of [...h.files.keys()]) if (k.startsWith(path + '/')) h.files.delete(k)
    },
    async readdir({ path }: { path: string }) {
      const names = new Set<string>()
      for (const k of h.files.keys()) {
        if (!k.startsWith(path + '/')) continue
        const rest = k.slice(path.length + 1)
        const i = rest.indexOf('/')
        names.add(i === -1 ? rest : rest.slice(0, i))
      }
      return { files: [...names].map(name => ({ name, type: 'directory' as const, size: 0 })) }
    },
  },
}))

vi.mock('@capacitor/network', () => ({
  Network: { getStatus: async () => ({ connected: true }) },
}))

vi.mock('./adminPull', () => ({ FORCE_ROSTER_SYNC_KEY: 'trip.sync.forceRoster' }))

// Cache Storage tiruan — cukup untuk API yang dipakai activateBundle/putToCache.
function fakeCaches() {
  const store = new Map<string, Map<string, Uint8Array>>()
  const api = {
    store,
    async keys() { return [...store.keys()] },
    async delete(name: string) { return store.delete(name) },
    async open(name: string) {
      if (!store.has(name)) store.set(name, new Map())
      const entries = store.get(name)!
      return {
        async match(url: string) {
          const b = entries.get(url)
          if (!b) return undefined
          return new Response(b.slice().buffer as ArrayBuffer)
        },
        async put(url: string, res: Response) {
          entries.set(url, new Uint8Array(await res.arrayBuffer()))
        },
        async keys() { return [...entries.keys()].map(url => ({ url })) },
        async delete(url: string) { return entries.delete(url) },
      }
    },
  }
  return api
}

const b64 = (s: string) => btoa(s)

beforeEach(() => {
  h.native = true
  h.files.clear()
  ;(globalThis as unknown as { caches: unknown }).caches = fakeCaches()
})

describe('isNewer', () => {
  it('mendeteksi update kedua dari manifest hybrid semver+timestamp', () => {
    expect(isNewer('1.0.979521+1791527033132', '1.0.979520+1791526573552')).toBe(true)
    expect(isNewer('1.0.979520+1791526573552', '1.0.979521+1791527033132')).toBe(false)
    expect(isNewer('1.0.979521+1791527033132', '1.0.979521+1791527033132')).toBe(false)
    expect(isNewer('1.0.0+1000', '0.0.0')).toBe(true)
  })
})

describe('activateBundle', () => {
  it('menimpa isi cache lama dengan bundle versi baru (bukan skip)', async () => {
    const url = (p: string) => new URL(p, window.location.origin).href

    // Cache masih berisi bundle VERSI LAMA untuk URL yang sama.
    const cache = await (globalThis as unknown as { caches: { open: (n: string) => Promise<{ put: (u: string, r: Response) => Promise<void> }> } }).caches.open(OTA_CACHE)
    await cache.put(url('index.html'), new Response('ISI-LAMA'))

    // Penyimpanan internal berisi versi BARU.
    h.files.set('trip-ota/2.0.0/index.html', b64('ISI-BARU'))
    h.files.set('trip-ota/2.0.0/main.js', b64('KODE-BARU'))

    const ok = await activateBundle('2.0.0', ['index.html', 'main.js'])
    expect(ok).toBe(true)

    const active = await (globalThis as unknown as { caches: { open: (n: string) => Promise<{ match: (u: string) => Promise<Response | undefined> }> } }).caches.open(OTA_CACHE)
    expect(await (await active.match(url('index.html')))!.text()).toBe('ISI-BARU')
    expect(await (await active.match(url('main.js')))!.text()).toBe('KODE-BARU')
  })

  it('web (tanpa Filesystem): pakai entri cache hasil unduhan, gagal bila hilang', async () => {
    h.native = false
    const url = (p: string) => new URL(p, window.location.origin).href
    const c = (globalThis as unknown as { caches: { open: (n: string) => Promise<{ put: (u: string, r: Response) => Promise<void>; match: (u: string) => Promise<Response | undefined> }> } }).caches
    const cache = await c.open(OTA_CACHE)
    await cache.put(url('index.html'), new Response('TERUNDUH'))

    expect(await activateBundle('3.0.0', ['index.html'])).toBe(true)
    expect(await activateBundle('3.0.0', ['index.html', 'hilang.js'])).toBe(false)
  })
})

