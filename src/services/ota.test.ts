/**
 * Tes arsitektur OTA v4 (purge-first / full-package).
 *
 * Yang diuji BUKAN potongan fungsi, melainkan SIKLUS RILIS NYATA lewat API publik
 * yang dipakai aplikasi (checkForUpdate → applyUpdate → restoreBundleFromStorage):
 *
 *   V1.0.0 (bundel APK) → rilis V1.0.1 → rilis V1.0.2 TANPA clear data manual.
 *
 * Semua lapisan eksternal ditiru secara setia:
 *   • Cache Storage (caches.open/match/put/keys/delete)
 *   • @capacitor/filesystem (direktori Data/Cache, semantik encoding base64 vs UTF8)
 *   • fetch ke manifest & aset (dengan hitungan hash SHA-256 asli)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  checkForUpdate,
  applyUpdate,
  getCurrentVersion,
  readActiveMeta,
  restoreBundleFromStorage,
  resetOtaStorage,
  isNewer,
  activateBundle,
  versionCacheName,
  type UpdateState,
} from './ota'

// Verifikasi SHA-256 adalah inti arsitektur ini; bila WebCrypto tidak ada,
// tes harus GAGAL TERANG-TERANGAN (bukan diam-diam melewati verifikasi).
if (!globalThis.crypto?.subtle) {
  throw new Error('[ota.test] WebCrypto SubtleCrypto tidak tersedia — verifikasi integritas tidak bisa diuji')
}

/** Harus sama dengan konstanta di ota.ts (URL publikasi OTA). */
const MANIFEST_URL = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/version.json'
const ASSETS_BASE = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/ota/'

const h = vi.hoisted(() => ({
  native: true,
  connected: true,
  /** Berkas durable: `${DIRECTORY}|${path}` → byte mentah. */
  fs: new Map<string, Uint8Array>(),
  /** "Server" OTA: versi → path → isi teks. */
  server: new Map<string, Map<string, string>>(),
  integrity: {} as Record<string, Record<string, string>>,
  /** `${versi}|${path}` yang sengaja dikirim rusak oleh server. */
  corrupt: new Set<string>(),
  remoteVersion: '0.0.0',
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native },
}))

vi.mock('@capacitor/filesystem', () => {
  const Directory = { Data: 'DATA', Cache: 'CACHE', Documents: 'DOCUMENTS' }
  const k = (directory: string, path: string) => `${directory}|${path}`
  const utf8 = new TextEncoder()
  const dec = new TextDecoder()
  const decodeB64 = (b64: string): Uint8Array => {
    const bin = atob(b64)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  }
  const encodeB64 = (bytes: Uint8Array): string => {
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(bin)
  }
  return {
    Directory,
    Encoding: { UTF8: 'utf8' },
    Filesystem: {
      // Semantik Capacitor: TANPA encoding → `data` adalah base64; DENGAN UTF8 →
      // `data` adalah teks biasa. Keduanya ditiru agar kesalahan encoding lolos uji.
      async writeFile({ path, data, directory, encoding }: { path: string; data: string; directory: string; encoding?: string }) {
        const bytes = encoding === 'utf8'
          ? utf8.encode(String(data))
          : decodeB64(String(data))
        h.fs.set(k(directory, path), bytes)
      },
      async readFile({ path, directory, encoding }: { path: string; directory: string; encoding?: string }) {
        const bytes = h.fs.get(k(directory, path))
        if (!bytes) throw new Error(`tidak ada: ${path}`)
        return { data: encoding === 'utf8' ? dec.decode(bytes) : encodeB64(bytes) }
      },
      async rmdir({ path, directory }: { path: string; directory: string }) {
        const prefix = k(directory, path)
        for (const key of [...h.fs.keys()]) {
          if (key === prefix || key.startsWith(`${prefix}/`)) h.fs.delete(key)
        }
      },
      async readdir({ path, directory }: { path: string; directory: string }) {
        const prefix = `${k(directory, path)}/`
        const names = new Set<string>()
        for (const key of h.fs.keys()) {
          if (!key.startsWith(prefix)) continue
          const rest = key.slice(prefix.length)
          const i = rest.indexOf('/')
          names.add(i === -1 ? rest : rest.slice(0, i))
        }
        return { files: [...names].map(name => ({ name, type: 'directory' as const, size: 0 })) }
      },
    },
  }
})

vi.mock('@capacitor/network', () => ({
  Network: { getStatus: async () => ({ connected: h.connected }) },
}))

vi.mock('./adminPull', () => ({ FORCE_ROSTER_SYNC_KEY: 'trip.sync.forceRoster' }))

// ── Cache Storage tiruan ─────────────────────────────────────────────────────

function fakeCaches() {
  const store = new Map<string, Map<string, Uint8Array>>()
  const keyOf = (key: unknown): string => {
    if (typeof key === 'string') return new URL(key, window.location.origin).href
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
const cachesApi = () => (globalThis as unknown as { caches: FakeCaches }).caches
const cacheNames = () => cachesApi().keys()

async function cachedText(cacheName: string, path: string): Promise<string | null> {
  const cache = await cachesApi().open(cacheName)
  const res = await cache.match(new URL(path, window.location.origin).href)
  return res ? res.text() : null
}

// ── "Server" OTA + fetch tiruan ──────────────────────────────────────────────

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text)
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Publikasikan satu rilis: aset + integrity + manifest. */
async function release(version: string, files: Record<string, string>): Promise<void> {
  const map = new Map(Object.entries(files))
  h.server.set(version, map)
  const integrity: Record<string, string> = {}
  for (const [path, text] of map) integrity[path] = await sha256(text)
  h.integrity[version] = integrity
  h.remoteVersion = version
}

function makeFetch() {
  return vi.fn(async (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as Request).url ?? input)
    const parsed = new URL(url)
    const clean = parsed.origin + parsed.pathname

    // Manifest — versi yang sedang "dirilis" di server.
    if (clean === MANIFEST_URL) {
      if (h.remoteVersion === '0.0.0') return new Response('belum ada rilis', { status: 404 })
      const map = h.server.get(h.remoteVersion)
      if (!map) return new Response('tidak ada', { status: 404 })
      return new Response(JSON.stringify({
        version: h.remoteVersion,
        assets: [...map.keys()],
        integrity: h.integrity[h.remoteVersion],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    // Aset bundle — versi diambil dari parameter `ota=` (pembeda anti-cache).
    if (clean.startsWith(ASSETS_BASE)) {
      const version = parsed.searchParams.get('ota') ?? h.remoteVersion
      const path = decodeURIComponent(clean.slice(ASSETS_BASE.length))
      const text = h.server.get(version)?.get(path)
      if (text == null) return new Response(`hilang: ${path}`, { status: 404 })
      if (h.corrupt.has(`${version}|${path}`)) return new Response(`RUSAK-${text}`, { status: 200 })
      return new Response(text, { status: 200 })
    }

    return new Response('tidak dikenal', { status: 404 })
  })
}

/** Seluruh siklus: cek → unduh → verifikasi → aktivasi. */
async function updateTo(version: string, from: string | null): Promise<UpdateState[]> {
  const states: UpdateState[] = []
  const res = await checkForUpdate(from, s => states.push(s), true)
  expect(res.available, `rilis ${version} harus terdeteksi`).toBe(true)
  expect(res.version).toBe(version)
  expect(await applyUpdate(), `aktivasi ${version} harus sukses`).toBe(true)
  return states
}

beforeEach(() => {
  h.native = true
  h.connected = true
  h.fs.clear()
  h.server.clear()
  h.corrupt.clear()
  h.remoteVersion = '0.0.0'
  ;(globalThis as unknown as { caches: FakeCaches }).caches = fakeCaches()
  localStorage.clear()
  vi.stubGlobal('fetch', makeFetch())
})

// ── Perbandingan versi ───────────────────────────────────────────────────────

describe('isNewer', () => {
  it('mendeteksi update kedua dari manifest hybrid semver+timestamp', () => {
    expect(isNewer('1.0.979521+1791527033132', '1.0.979520+1791526573552')).toBe(true)
    expect(isNewer('1.0.979520+1791526573552', '1.0.979521+1791527033132')).toBe(false)
    expect(isNewer('1.0.979521+1791527033132', '1.0.979521+1791527033132')).toBe(false)
    expect(isNewer('1.0.0+1000', '0.0.0')).toBe(true)
    expect(isNewer('1.0.2+1791527033132', '1.0.1+1791526573552')).toBe(true)
  })
})

// ── Siklus rilis beruntun (inti laporan lapangan) ────────────────────────────

describe('OTA v4 — update beruntun tanpa clear data', () => {
  it('update pertama (V1.0.1): purge → unduh paket penuh → verifikasi → aktivasi atomik', async () => {
    // Sisa arsitektur lama (v3) di perangkat — harus ikut dibersihkan.
    const legacy = await cachesApi().open('trip-ota-active')
    await legacy.put(new URL('index.html', window.location.origin).href, new Response('SISA-V3'))

    await release('1.0.1', {
      'index.html': '<html>v1.0.1</html>',
      'main-aaa.js': 'console.log("1.0.1")',
      'styles-aaa.css': 'body{color:#111}',
    })

    const states = await updateTo('1.0.1', null)

    expect(states.some(s => s.status === 'downloading' && s.progress === 100)).toBe(true)
    expect(await getCurrentVersion()).toBe('1.0.1')
    expect((await readActiveMeta())?.version).toBe('1.0.1')
    expect(await cachedText(versionCacheName('1.0.1'), 'index.html')).toBe('<html>v1.0.1</html>')
    expect(await cachedText(versionCacheName('1.0.1'), 'main-aaa.js')).toBe('console.log("1.0.1")')
    // Salinan durable (Directory.Data) — bertahan walau OS membersihkan cache.
    expect(h.fs.has('DATA|ota/1.0.1/index.html')).toBe(true)
    // Cache warisan v3 sudah dibuang.
    expect(await cacheNames()).not.toContain('trip-ota-active')
  })

  it('update KEDUA (V1.0.2) terdeteksi & aktif tanpa sisa chunk V1.0.1', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'main-aaa.js': 'console.log("1.0.1")' })
    await updateTo('1.0.1', null)

    // Rilis berikutnya — TIDAK ada clear data / reset apa pun di sini.
    await release('1.0.2', { 'index.html': '<html>v1.0.2</html>', 'main-bbb.js': 'console.log("1.0.2")' })
    await updateTo('1.0.2', '1.0.1')

    expect(await getCurrentVersion()).toBe('1.0.2')
    expect((await readActiveMeta())?.version).toBe('1.0.2')

    const names = await cacheNames()
    expect(names).toContain(versionCacheName('1.0.2'))
    expect(names).not.toContain(versionCacheName('1.0.1')) // purge total versi lama
    expect(await cachedText(versionCacheName('1.0.2'), 'index.html')).toBe('<html>v1.0.2</html>')
    // Tidak ada berkas V1.0.1 yang tertinggal di cache versi aktif.
    expect(await cachedText(versionCacheName('1.0.2'), 'main-aaa.js')).toBeNull()
    // Storage durable juga hanya menyisakan versi baru.
    expect(h.fs.has('DATA|ota/1.0.1/index.html')).toBe(false)
    expect(h.fs.has('DATA|ota/1.0.2/index.html')).toBe(true)
  })

  it('update KETIGA (V1.0.3) juga mulus — perilaku tidak pernah terasa "sekali pakai"', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>' })
    await updateTo('1.0.1', null)
    await release('1.0.2', { 'index.html': '<html>v1.0.2</html>' })
    await updateTo('1.0.2', '1.0.1')
    await release('1.0.3', { 'index.html': '<html>v1.0.3</html>', 'main-ccc.js': 'console.log("1.0.3")' })
    await updateTo('1.0.3', '1.0.2')

    expect(await getCurrentVersion()).toBe('1.0.3')
    expect(await cachedText(versionCacheName('1.0.3'), 'index.html')).toBe('<html>v1.0.3</html>')
    const names = await cacheNames()
    expect(names.filter(n => n.startsWith('trip-ota-v'))).toEqual([versionCacheName('1.0.3')])
  })
})

// ── Integritas & rollback ────────────────────────────────────────────────────

describe('verifikasi integritas', () => {
  it('satu berkas rusak → update dibatalkan, versi lama tetap aktif, staging dibuang', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'main-aaa.js': 'console.log("1.0.1")' })
    await updateTo('1.0.1', null)

    await release('1.0.2', { 'index.html': '<html>v1.0.2</html>', 'main-bbb.js': 'console.log("1.0.2")' })
    h.corrupt.add('1.0.2|main-bbb.js') // server mengirim byte yang hash-nya tidak cocok

    const states: UpdateState[] = []
    const res = await checkForUpdate('1.0.1', s => states.push(s), true)

    expect(res.available).toBe(false)
    expect(states.at(-1)?.status).toBe('error')
    // Versi lama TIDAK tersentuh — aplikasi tetap jalan.
    expect(await getCurrentVersion()).toBe('1.0.1')
    expect((await readActiveMeta())?.version).toBe('1.0.1')
    expect(await cachedText(versionCacheName('1.0.1'), 'index.html')).toBe('<html>v1.0.1</html>')
    // Staging versi gagal dibuang total (tidak tersisa separuh jalan).
    expect(await cacheNames()).not.toContain(versionCacheName('1.0.2'))
    expect(h.fs.has('DATA|ota/1.0.2/main-bbb.js')).toBe(false)
  })

  it('manifest tanpa integrity → hanya berkas non-kosong (kompatibilitas mundur)', async () => {
    // Staging belum ada apa pun → aktivasi harus gagal, bukan menghasilkan versi kosong.
    expect(await activateBundle('1.0.1', ['index.html'])).toBe(false)

    const cache = await cachesApi().open(versionCacheName('1.0.1'))
    await cache.put(new URL('index.html', window.location.origin).href, new Response('<html>lama</html>'))
    expect(await activateBundle('1.0.1', ['index.html'])).toBe(true)
    expect((await readActiveMeta())?.version).toBe('1.0.1')
  })
})

// ── Self-heal & reset ────────────────────────────────────────────────────────

describe('ketahanan perangkat', () => {
  it('Cache Storage dibersihkan WebView → bundle dibangun ulang dari storage durable', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'main-aaa.js': 'console.log("1.0.1")' })
    await updateTo('1.0.1', null)

    // WebView/OS membersihkan Cache Storage (penyebab "update hilang" dulu).
    ;(globalThis as unknown as { caches: FakeCaches }).caches = fakeCaches()

    expect(await restoreBundleFromStorage()).toBe(true)
    expect((await readActiveMeta())?.version).toBe('1.0.1')
    // Cache versi WAJIB terisi ulang: Service Worker hanya menyajikan dari sini.
    expect(await cachedText(versionCacheName('1.0.1'), 'index.html')).toBe('<html>v1.0.1</html>')
    expect(await cachedText(versionCacheName('1.0.1'), 'main-aaa.js')).toBe('console.log("1.0.1")')
  })

  it('state "downloading" yang menggantung tidak menghapus versi AKTIF', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'main-aaa.js': 'console.log("1.0.1")' })
    await updateTo('1.0.1', null)

    // Aplikasi sempat mati di tengah siklus: state tersangkut di versi yang
    // justru sudah aktif. Siklus berikutnya tidak boleh menghapus bundelnya.
    localStorage.setItem('trip.ota.state', JSON.stringify({ status: 'downloading', latestVersion: '1.0.1' }))

    const res = await checkForUpdate('1.0.1', () => {}, true)
    expect(res.available).toBe(false) // remote tidak lebih baru
    expect(await cachedText(versionCacheName('1.0.1'), 'index.html')).toBe('<html>v1.0.1</html>')
    expect(h.fs.has('DATA|ota/1.0.1/index.html')).toBe(true)
  })

  it('storage durable rusak → boot tidak mengklaim versi OTA (kembali ke bundle APK)', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>' })
    await updateTo('1.0.1', null)

    h.fs.clear() // Filesystem hilang (clear data manual)
    ;(globalThis as unknown as { caches: FakeCaches }).caches = fakeCaches()

    expect(await restoreBundleFromStorage()).toBe(false)
  })

  it('resetOtaStorage() menghapus semua cache, storage, dan state versi', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'main-aaa.js': 'console.log("1.0.1")' })
    await updateTo('1.0.1', null)

    await resetOtaStorage()

    // Cache diperiksa SEBELUM readActiveMeta (yang memang membuat ulang cache
    // meta kosong lewat caches.open — perilaku Cache Storage, bukan kebocoran).
    expect((await cacheNames()).filter(n => n.startsWith('trip-ota'))).toEqual([])
    expect([...h.fs.keys()].filter(k => k.startsWith('DATA|ota/'))).toEqual([])
    expect(await getCurrentVersion()).toBe('0.0.0')
    expect(await readActiveMeta()).toBeNull()
    expect(localStorage.getItem('trip.ota.persistActive')).toBeNull()
  })
})
