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
  /** Berkas durable: `${DIRECTORY}|${path}` → byte mentah. */
  fs: new Map<string, Uint8Array>(),
  /** "Server" OTA: versi → path → isi (teks atau byte biner). */
  server: new Map<string, Map<string, string | Uint8Array>>(),
  integrity: {} as Record<string, Record<string, string>>,
  /** `${versi}|${path}` yang sengaja dikirim rusak oleh server. */
  corrupt: new Set<string>(),
  remoteVersion: '0.0.0',
  /** CapacitorHttp aktif (seperti di APK). false = plugin tak tersedia. */
  capHttpOn: true,
  /** Argumen tiap panggilan CapacitorHttp.request — untuk memastikan
   *  `responseType:'arraybuffer'` benar-benar dipakai di jalur biner. */
  capHttpCalls: [] as { url: string; responseType?: string }[],
  /** Hitungan permintaan ASET (bukan manifest) — untuk membuktikan tidak ada
   *  unduh ulang saat staging sudah utuh. */
  assetHits: 0,
  /** Resolusi URL → berkas; dipasang di beforeEach (dipakai fetch & CapacitorHttp). */
  serve: null as null | ((url: string) => { status: number; bytes: Uint8Array; contentType: string }),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => h.native },
  /**
   * Tiruan SETIA plugin CapacitorHttp (HttpRequestHandler.java):
   *   • Content-Type application/json → data = objek hasil parseJSON
   *   • responseType 'arraybuffer'/'blob' → data = base64 (readStreamAsBase64)
   *   • selain itu (DEFAULT = TEXT) → data = STRING hasil dekode UTF-8
   *     (readStreamAsString) — inilah yang merusak PNG/JPEG bila kode memakai
   *     jalur native tanpa meminta arraybuffer.
   */
  CapacitorHttp: {
    async request(options: { url: string; responseType?: string }) {
      h.capHttpCalls.push({ url: options.url, responseType: options.responseType })
      if (!h.capHttpOn || !h.serve) throw new Error('CapacitorHttp tidak tersedia')
      const { status, bytes, contentType } = h.serve(options.url)
      const dec = new TextDecoder()
      const encB64 = (b: Uint8Array): string => {
        let bin = ''
        for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000))
        return btoa(bin)
      }
      const responseType = contentType.includes('application/json') ? 'json' : options.responseType
      if (responseType === 'json') {
        return { status, headers: {}, url: options.url, data: JSON.parse(dec.decode(bytes)) }
      }
      if (responseType === 'arraybuffer' || responseType === 'blob') {
        return { status, headers: {}, url: options.url, data: encB64(bytes) }
      }
      return { status, headers: {}, url: options.url, data: dec.decode(bytes) }
    },
  },
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

const utf8 = new TextEncoder()

/** Byte nyata sebuah "berkas server" (string → byte UTF-8). */
function bytesOfFile(file: string | Uint8Array): Uint8Array {
  return typeof file === 'string' ? utf8.encode(file) : file
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Publikasikan satu rilis: aset + integrity + manifest.
 * Nilai boleh byte mentah (Uint8Array) — dipakai untuk menguji aset BINER
 * (PNG/JPEG) yang bukan UTF-8, persis seperti bundel nyata aplikasi.
 */
async function release(version: string, files: Record<string, string | Uint8Array>): Promise<void> {
  const map = new Map(Object.entries(files))
  h.server.set(version, map)
  const integrity: Record<string, string> = {}
  for (const [path, file] of map) integrity[path] = await sha256Bytes(bytesOfFile(file))
  h.integrity[version] = integrity
  h.remoteVersion = version
}

/** Resolusi URL → berkas. Dipakai fetch WebView DAN tiruan CapacitorHttp. */
function serve(url: string) {
  const parsed = new URL(url)
  const clean = parsed.origin + parsed.pathname

  // Manifest — versi yang sedang "dirilis" di server.
  if (clean === MANIFEST_URL) {
    if (h.remoteVersion === '0.0.0') return { status: 404, bytes: utf8.encode('belum ada rilis'), contentType: 'text/plain' }
    const map = h.server.get(h.remoteVersion)
    if (!map) return { status: 404, bytes: utf8.encode('tidak ada'), contentType: 'text/plain' }
    const manifest = JSON.stringify({
      version: h.remoteVersion,
      assets: [...map.keys()],
      integrity: h.integrity[h.remoteVersion],
    })
    // GitHub raw menyajikan .json sebagai text/plain (diverifikasi dengan curl),
    // jadi klien TIDAK boleh bergantung pada Content-Type application/json.
    return { status: 200, bytes: utf8.encode(manifest), contentType: 'text/plain; charset=utf-8' }
  }

  // Aset bundle — versi diambil dari parameter `ota=` (pembeda anti-cache).
  if (clean.startsWith(ASSETS_BASE)) {
    h.assetHits++
    const version = parsed.searchParams.get('ota') ?? h.remoteVersion
    const path = decodeURIComponent(clean.slice(ASSETS_BASE.length))
    const file = h.server.get(version)?.get(path)
    if (file == null) return { status: 404, bytes: utf8.encode(`hilang: ${path}`), contentType: 'text/plain' }
    if (h.corrupt.has(`${version}|${path}`)) {
      const base = typeof file === 'string' ? file : 'bin'
      return { status: 200, bytes: utf8.encode(`RUSAK-${base}`), contentType: 'text/plain' }
    }
    const contentType = /\.(png|jpe?g|gif|ico|woff2?)$/i.test(path)
      ? `image/${path.split('.').pop()}`
      : 'text/plain; charset=utf-8'
    return { status: 200, bytes: bytesOfFile(file), contentType }
  }

  return { status: 404, bytes: utf8.encode('tidak dikenal'), contentType: 'text/plain' }
}

function makeFetch() {
  return vi.fn(async (input: unknown): Promise<Response> => {
    const url = typeof input === 'string' ? input : String((input as Request).url ?? input)
    const { status, bytes, contentType } = serve(url)
    return new Response(bytes.slice().buffer as ArrayBuffer, { status, headers: { 'Content-Type': contentType } })
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
  h.capHttpOn = true
  h.capHttpCalls = []
  h.assetHits = 0
  h.serve = serve
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

  it('SEMVER diprioritaskan, timestamp hanya tiebreak (jam mesin rilis bisa meleset)', () => {
    // Semver lebih rendah walau timestamp lebih besar → BUKAN update.
    expect(isNewer('1.0.3+9999999999999', '1.0.4+1')).toBe(false)
    // Semver lebih tinggi walau timestamp lebih kecil → update.
    expect(isNewer('1.0.4+1', '1.0.3+9999999999999')).toBe(true)
    // Semver sama → timestamp yang menentukan.
    expect(isNewer('1.0.4+2', '1.0.4+1')).toBe(true)
    expect(isNewer('1.0.4+1', '1.0.4+2')).toBe(false)
    expect(isNewer('1.0.4+1', '1.0.4')).toBe(true)
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

// ── Aset BINER lewat jalur native (CapacitorHttp) ────────────────────────────
//
// Bug lapangan yang paling fatal: HttpRequestHandler.DEFAULT = TEXT membaca
// stream sebagai STRING UTF-8 (readStreamAsString), sehingga PNG/JPEG rusak
// menjadi U+FFFD lalu di-encode ulang → SHA-256 tak pernah cocok → SEMUA update
// berhenti di "Verifikasi berkas gagal". Bundel nyata selalu memuat 3 aset biner
// (guest-profile.jpeg, karyamas_clean.png, favicon.png), jadi tanpa tes ini
// jalur yang dipakai APK nyata tidak pernah tercakup.

describe('aset biner di APK (CapacitorHttp)', () => {
  /** Byte mirip PNG: mengandung 0xFF/0xFE/0x80 yang BUKAN UTF-8 valid. */
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0x00, 0xfe, 0x80, 0xc3, 0x28])

  async function cachedBytes(cacheName: string, path: string): Promise<Uint8Array | null> {
    const cache = await cachesApi().open(cacheName)
    const res = await cache.match(new URL(path, window.location.origin).href)
    return res ? new Uint8Array(await res.arrayBuffer()) : null
  }

  it('aset biner terunduh UTUH (bukan hasil dekode UTF-8) & update sukses', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'assets/logo.png': PNG })
    await updateTo('1.0.1', null)

    // Unduhan aset di native WAJIB meminta byte, bukan teks.
    const assetCalls = h.capHttpCalls.filter(c => c.url.includes('/ota/'))
    expect(assetCalls.length).toBeGreaterThan(0)
    expect(assetCalls.every(c => c.responseType === 'arraybuffer')).toBe(true)

    // Byte tersimpan identik dengan yang dipublikasikan.
    expect([...(await cachedBytes(versionCacheName('1.0.1'), 'assets/logo.png'))!]).toEqual([...PNG])
    expect([...(h.fs.get('DATA|ota/1.0.1/assets/logo.png') ?? [])]).toEqual([...PNG])
    expect(await getCurrentVersion()).toBe('1.0.1')
  })

  it('update KEDUA dengan aset biner juga mulus — bukan "sekali pakai"', async () => {
    const PNG2 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x10, 0xff, 0x00, 0x01, 0xfe])
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'assets/logo.png': PNG })
    await updateTo('1.0.1', null)

    // TANPA clear data / reset apa pun di antara dua rilis.
    await release('1.0.2', { 'index.html': '<html>v1.0.2</html>', 'assets/logo.png': PNG2 })
    await updateTo('1.0.2', '1.0.1')

    expect(await getCurrentVersion()).toBe('1.0.2')
    expect([...(await cachedBytes(versionCacheName('1.0.2'), 'assets/logo.png'))!]).toEqual([...PNG2])
  })

  it('plugin CapacitorHttp tidak tersedia → fallback fetch WebView tetap byte utuh', async () => {
    h.capHttpOn = false
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'assets/logo.png': PNG })
    await updateTo('1.0.1', null)

    expect([...(await cachedBytes(versionCacheName('1.0.1'), 'assets/logo.png'))!]).toEqual([...PNG])
  })
})

// ── Mode web (tanpa plugin native) ───────────────────────────────────────────
//
// Dulu jalur web tidak punya PENANDA rilis sama sekali, sehingga daftar berkas
// harus disalin di UpdateState.downloaded — dua sumber yang bisa berbeda dan
// tidak pernah diuji. Kini penanda juga hidup di localStorage saat web, jadi
// siklus penuh (dua rilis beruntun) bisa diuji tanpa perangkat native.

describe('mode web (tanpa native)', () => {
  it('siklus penuh berjalan dan penanda tersimpan di localStorage', async () => {
    h.native = false

    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'main-aaa.js': 'console.log("1.0.1")' })
    await updateTo('1.0.1', null)
    expect(await getCurrentVersion()).toBe('1.0.1')
    expect(localStorage.getItem('trip.ota.marker.1.0.1')).toBeTruthy()

    // Rilis kedua — tanpa clear data, hanya penanda yang jadi acuan.
    await release('1.0.2', { 'index.html': '<html>v1.0.2</html>', 'main-bbb.js': 'console.log("1.0.2")' })
    await updateTo('1.0.2', '1.0.1')

    expect(await getCurrentVersion()).toBe('1.0.2')
    expect(await cachedText(versionCacheName('1.0.2'), 'index.html')).toBe('<html>v1.0.2</html>')
    // Penanda versi lama ikut terbersihkan.
    expect(localStorage.getItem('trip.ota.marker.1.0.1')).toBeNull()
  })
})

// ── Efisiensi siklus berkala (jaringan lapangan) ─────────────────────────────

describe('siklus cek berkala', () => {
  it('state "ready" tidak dihapus & tidak diunduh ulang sebelum pengguna menerapkan', async () => {
    await release('1.0.1', { 'index.html': '<html>v1.0.1</html>', 'main-aaa.js': 'console.log("1.0.1")' })

    expect((await checkForUpdate(null, () => {}, true)).available).toBe(true)
    const hitsAfterFirst = h.assetHits
    expect(hitsAfterFirst).toBeGreaterThan(0)

    // Pemeriksaan berkala berikutnya (mis. 30 menit) SEBELUM "Terapkan" ditekan.
    const states: UpdateState[] = []
    const res = await checkForUpdate(null, s => states.push(s), true)

    expect(res.available).toBe(true)
    expect(states.at(-1)?.status).toBe('ready')
    expect(h.assetHits).toBe(hitsAfterFirst) // tidak ada unduhan ulang
    expect(await cachedText(versionCacheName('1.0.1'), 'index.html')).toBe('<html>v1.0.1</html>')
  })
})
