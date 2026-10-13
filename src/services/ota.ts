// ─── OTA Auto-Update Service — ARSITEKTUR v4 (purge-first / full-package) ────
//
// MASALAH YANG DISELESAIKAN (bug "update sekunder B→C gagal di APK native"):
//
//  1. CACHE SATU-SLOT. Dulu hanya ada satu cache bernama tetap ("trip-ota-active").
//     Versi baru menulis ke nama cache yang SAMA dengan versi lama, sehingga
//     sisa entri V1.0.1 bisa "menang" atas V1.0.2 (cache.match mengembalikan
//     yang lama) → update tampak sukses tetapi UI tidak berubah.
//     → v4: SATU CACHE PER VERSI ("trip-ota-v<versi>"). Versi baru = nama baru,
//       jadi mustahil tercampur. Perpindahan versi dilakukan dengan menulis
//       SATU penanda kecil (meta) — operasi atomik.
//
//  2. STALE CDN / WEBVIEW CACHE. `index.html`, `sw.js`, dan aset bernama tetap
//     diambil tanpa pembeda versi. GitHub raw (Fastly) + cache WebView bisa
//     menyajikan salinan LAMA untuk nama file yang sama → hash integritas tidak
//     cocok → update dibatalkan ("mismatch integrity" di lapangan).
//     → v4: setiap unduhan memakai `?ota=<versi>&t=<timestamp>` (URL unik per
//       percobaan). Cache lokal tetap disimpan di URL kanonik (tanpa query).
//
//  3. PURGE-FIRST YANG MENGHANCURKAN DIRI SENDIRI. Dulu SEMUA cache dihapus
//     SEBELUM unduhan, termasuk cache yang sedang menyajikan aplikasi yang
//     berjalan. Chunk yang di-lazy-load setelah itu jatuh ke bundle bawaan APK
//     (versi lama) → runtime campur aduk; bila unduhan lalu gagal, perangkat
//     tidak punya cache OTA sama sekali padahal localStorage masih mengaku
//     versi baru.
//     → v4: yang di-purge lebih dulu adalah SEMUA versi lain + staging lama,
//       sedangkan versi yang SEDANG AKTIF tetap utuh sampai versi baru lulus
//       verifikasi. Setelah switch sukses, versi lama langsung dibuang total
//       sehingga tidak ada sisa chunk V1.0.1 saat V1.0.2 tampil.
//
//  4. PENYIMPANAN PRIMER YANG BISA DIHAPUS OS. Bundle ditulis ke
//     `Directory.Cache` — Android boleh membersihkan direktori ini kapan saja.
//     Setelah dibersihkan, aktivasi gagal ("update gagal" sehari kemudian).
//     → v4: penyimpanan primer `Directory.Data` (durable). Cache Storage hanya
//       proyeksi yang bisa dibangun ulang dari sana (self-heal saat boot).
//
//  5. SERVICE WORKER MENYAJIKAN APA PUN YANG ADA DI CACHE. Bila satu berkas
//     hilang, SW diam-diam jatuh ke jaringan (bundle APK) → versi campur.
//     → v4: SW hanya menyajikan dari cache VERSI AKTIF (dibaca dari meta), dan
//       mendukung pesan PURGE_ALL/SET_ACTIVE serta bypass `ota_bypass=1`.
//
//  6. TIDAK ADA VERIFIKASI PASCA-RELOAD. Reload tanpa penanda versi bisa
//     dilayani WebView HTTP cache (index.html lama).
//     → v4: reload memakai `?ota=<versi>` + pemeriksaan mandiri saat boot.
//
// Alur pembaruan (setiap siklus, FULL-PACKAGE):
//   manifest segar (anti-cache) → versi lebih baru?
//   → purge SEMUA versi lain (cache + storage) → unduh SELURUH berkas (URL
//     ber-versi) → verifikasi SHA-256 tiap berkas → tulis ke cache versi baru +
//     storage durable → verifikasi ulang dari cache → tulis meta (SWITCH
//     ATOMIK) → buang versi lama → reload.
//   Gagal di langkah mana pun = staging dibuang, versi lama tetap jalan
//   (fallback aman, tidak pernah setengah-setengah).

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Network } from '@capacitor/network'
import { FORCE_ROSTER_SYNC_KEY } from './adminPull'

// ── Config ───────────────────────────────────────────────────────────────────
const MANIFEST_URL = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/version.json'
const ASSETS_BASE = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/ota/'

/** Cache LAMA (v3) — tidak dipakai lagi, hanya dibersihkan saat purge. */
export const OTA_CACHE = 'trip-ota-active'
/** Cache penanda: satu berkas `__active__.json` berisi versi aktif (dibaca SW). */
export const OTA_META_CACHE = 'trip-ota-meta'
/** Prefiks cache per versi: `trip-ota-v<versi>`. */
const VERSION_CACHE_PREFIX = 'trip-ota-v'
/** Penanda versi aktif di dalam OTA_META_CACHE. */
const META_ACTIVE_KEY = '__active__.json'

/** Direktori penyimpanan DURABLE (Directory.Data) — sumber kebenaran bundle. */
const OTA_DIR = 'ota'
/** Direktori LAMA (Directory.Cache, bisa dibersihkan OS) — dibersihkan saat purge. */
const LEGACY_OTA_DIR = 'trip-ota'
const MARKER = '.complete.json'

const ERROR_COOLDOWN_MS = 2 * 60 * 1000

export interface VersionManifest {
  version: string
  assets: string[]
  minAppVersion?: string
  /** SHA-256 (hex) per path — wajib dari publisher (dipakai verifikasi penuh). */
  integrity?: Record<string, string>
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'offline'
  progress?: number
  error?: string
  latestVersion?: string
  downloaded?: string[]
  /** Versi yang sedang menyajikan aplikasi saat ini. */
  activeVersion?: string
}

const STATE_KEY = 'trip.ota.state'
const CURRENT_VER_KEY = 'trip.ota.currentVersion'
const BUNDLED_VERSION = '0.0.0'
const LAST_ERROR_KEY = 'trip.ota.lastError'
/** Versi yang baru diterapkan — dipakai untuk verifikasi boot + cache-buster reload. */
const APPLIED_VER_KEY = 'trip.ota.appliedVersion'

// ── Versi lokal ──────────────────────────────────────────────────────────────

export async function getCurrentVersion(): Promise<string | null> {
  try { return localStorage.getItem(CURRENT_VER_KEY) ?? BUNDLED_VERSION } catch { return BUNDLED_VERSION }
}

export function setCurrentVersion(v: string): void {
  try { localStorage.setItem(CURRENT_VER_KEY, v) } catch { /* quota */ }
}

export function getCachedState(): UpdateState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    return raw ? (JSON.parse(raw) as UpdateState) : null
  } catch { return null }
}

function saveState(s: UpdateState): void {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)) } catch { /* quota */ }
}

async function isOnline(): Promise<boolean> {
  try {
    const { connected } = await Network.getStatus()
    return connected
  } catch { return navigator.onLine }
}

// ── Lifecycle flag ───────────────────────────────────────────────────────────

export const PERSIST_BUNDLE_ACTIVE_KEY = 'trip.ota.persistActive'

export async function markBundlePersisted(): Promise<void> {
  try { localStorage.setItem(PERSIST_BUNDLE_ACTIVE_KEY, '1') } catch { /* quota */ }
}

export async function hasPersistFlag(): Promise<boolean> {
  try { return localStorage.getItem(PERSIST_BUNDLE_ACTIVE_KEY) === '1' } catch { return false }
}

/** Versi yang terakhir kali berhasil diterapkan (untuk audit boot). */
export async function getAppliedVersion(): Promise<string | null> {
  try { return localStorage.getItem(APPLIED_VER_KEY) } catch { return null }
}

// ── Helper dasar ─────────────────────────────────────────────────────────────

const isNative = () => Capacitor.isNativePlatform()

function urlOf(path: string): string {
  return new URL(path, window.location.origin).href
}

export function versionCacheName(version: string): string {
  return `${VERSION_CACHE_PREFIX}${version}`
}

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/** SHA-256 hex via WebCrypto. null bila tidak tersedia (WebView lawas). */
async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle
    if (!subtle) return null
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    const digest = await subtle.digest('SHA-256', buf)
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}

// ── META: penanda versi aktif (dibaca Service Worker) ────────────────────────

interface ActiveMeta {
  version: string
  assets: string[]
  savedAt: number
}

/** Tulis penanda versi aktif — INI operasi switch atomiknya. */
async function writeActiveMeta(version: string, assets: string[]): Promise<void> {
  if (typeof caches === 'undefined') return
  const cache = await caches.open(OTA_META_CACHE)
  await cache.put(
    new Request(new URL(META_ACTIVE_KEY, window.location.origin).href),
    new Response(JSON.stringify({ version, assets, savedAt: Date.now() } satisfies ActiveMeta), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    }),
  )
}

export async function readActiveMeta(): Promise<ActiveMeta | null> {
  if (typeof caches === 'undefined') return null
  try {
    const cache = await caches.open(OTA_META_CACHE)
    const res = await cache.match(new URL(META_ACTIVE_KEY, window.location.origin).href)
    if (!res) return null
    const data = await res.json() as ActiveMeta
    if (!data?.version || !Array.isArray(data.assets)) return null
    return data
  } catch { return null }
}

// ── Storage durable (Directory.Data) ─────────────────────────────────────────

function assetPath(version: string, path: string): string {
  return `${OTA_DIR}/${version}/${path}`
}

async function persistToStorage(version: string, path: string, bytes: Uint8Array): Promise<void> {
  if (!isNative()) return
  // PENTING: `data` base64 ditulis TANPA `encoding`. Bila memakai
  // Encoding.UTF8, Capacitor menulis string base64 sebagai teks ASCII — lalu
  // `readFromStorage` (baca base64) mengembalikan byte dari string itu, bukan
  // byte berkas asli. Hasilnya bundel korup & hash tidak pernah cocok.
  await Filesystem.writeFile({
    path: assetPath(version, path),
    data: toBase64(bytes),
    directory: Directory.Data,
    recursive: true,
  })
}

async function readFromStorage(version: string, path: string): Promise<Uint8Array | null> {
  if (!isNative()) return null
  try {
    const res = await Filesystem.readFile({
      path: assetPath(version, path),
      directory: Directory.Data,
    })
    if (typeof res.data !== 'string') return null
    return fromBase64(res.data)
  } catch { return null }
}

async function writeMarker(version: string, assets: string[], integrity?: Record<string, string>): Promise<void> {
  if (!isNative()) return
  await Filesystem.writeFile({
    path: `${OTA_DIR}/${version}/${MARKER}`,
    data: JSON.stringify({ version, assets, integrity, savedAt: Date.now() }),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  })
}

async function readMarker(version: string): Promise<VersionManifest | null> {
  if (!isNative()) return null
  try {
    const res = await Filesystem.readFile({
      path: `${OTA_DIR}/${version}/${MARKER}`,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })
    if (typeof res.data !== 'string') return null
    return JSON.parse(res.data) as VersionManifest
  } catch { return null }
}

async function removeVersionStorage(version: string): Promise<void> {
  if (typeof caches !== 'undefined') {
    try { await caches.delete(versionCacheName(version)) } catch { /* */ }
  }
  if (!isNative()) return
  try {
    await Filesystem.rmdir({ path: `${OTA_DIR}/${version}`, directory: Directory.Data, recursive: true })
  } catch { /* tidak ada */ }
}

// ── Purge (v4) ───────────────────────────────────────────────────────────────
// Aturan: yang dibuang lebih dulu = SEMUA versi selain versi aktif + semua sisa
// arsitektur lama. Versi aktif baru dibuang setelah penggantinya lulus
// verifikasi (lihat activateStagedBundle).

async function listCaches(): Promise<string[]> {
  try { return typeof caches === 'undefined' ? [] : await caches.keys() } catch { return [] }
}

/**
 * Buang semua sisa versi/arsitektur LAMA, sisakan: cache meta + cache versi
 * yang sedang aktif (kalau ada) + versi staging yang sedang diunduh.
 */
export async function purgeOtherVersions(keep: string[] = []): Promise<void> {
  const keepSet = new Set([OTA_META_CACHE, ...keep, ...keep.map(versionCacheName)])
  const names = await listCaches()
  await Promise.all(names.map(async n => {
    if (keepSet.has(n)) return
    // hanya sentuh cache milik OTA — jangan hapus cache lain milik WebView
    if (n === OTA_CACHE || n.startsWith(VERSION_CACHE_PREFIX) || n.startsWith('trip-ota-')) {
      try { await caches.delete(n) } catch { /* */ }
    }
  }))

  if (!isNative()) return
  // Direktori versi durable yang bukan versi yang disimpan
  try {
    const { files } = await Filesystem.readdir({ path: OTA_DIR, directory: Directory.Data })
    for (const f of files) {
      if (keep.includes(f.name)) continue
      try {
        await Filesystem.rmdir({ path: `${OTA_DIR}/${f.name}`, directory: Directory.Data, recursive: true })
      } catch { /* */ }
    }
  } catch { /* folder belum ada */ }

  // Sisa arsitektur v3 di Directory.Cache — selalu dibuang
  try {
    await Filesystem.rmdir({ path: LEGACY_OTA_DIR, directory: Directory.Cache, recursive: true })
  } catch { /* sudah tidak ada */ }
}

// ── Statе anti-macet ─────────────────────────────────────────────────────────

async function clearStuckOtaState(): Promise<void> {
  const state = getCachedState()
  if (!state) return
  const stuck = state.status === 'downloading' ||
    (state.status === 'ready' && (!state.downloaded || state.downloaded.length === 0))
  if (!stuck) return
  // Buang HANYA staging yang menggantung. Versi yang sedang aktif (meta / versi
  // lokal) tidak pernah disentuh — kalau tersentuh, SW kehilangan bahan untuk
  // disajikan dan aplikasi turun ke bundel APK padahal versi lokal mengaku OTA.
  const active = (await readActiveMeta())?.version
  const local = await getCurrentVersion()
  const staging = state.latestVersion
  if (staging && staging !== active && staging !== local) {
    await removeVersionStorage(staging)
  }
  saveState({ status: 'idle', latestVersion: state.latestVersion })
}

// ── Util jaringan ────────────────────────────────────────────────────────────

let _capacitorHttp: any = null
async function getCapacitorHttp(): Promise<any> {
  if (_capacitorHttp) return _capacitorHttp
  try {
    const core = await import('@capacitor/core')
    _capacitorHttp = (core as any).CapacitorHttp ?? null
  } catch {
    _capacitorHttp = null
  }
  return _capacitorHttp
}

/**
 * HTTP fetch: CapacitorHttp di native (bebas CORS), fetch biasa di web.
 * Semua permintaan OTA memakai `Cache-Control: no-store` + `Pragma: no-cache`
 * supaya WebView/HTTP cache tidak menyajikan salinan lama.
 */
async function nativeFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const mergedOptions: RequestInit = {
    ...options,
    headers: {
      ...options.headers,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    },
  }

  if (isNative()) {
    try {
      const capHttp = await getCapacitorHttp()
      if (capHttp) {
        const response = await capHttp.request({
          url,
          method: (mergedOptions.method as string) || 'GET',
          headers: mergedOptions.headers as Record<string, string>,
          connectTimeout: 10000,
        })
        return new Response(response.data, {
          status: response.status,
          statusText: response.status >= 200 && response.status < 300 ? 'OK' : 'Error',
          headers: new Headers(
            Object.entries(response.headers || {}).reduce((acc, [k, v]) => {
              acc[k] = Array.isArray(v) ? v.join(', ') : String(v)
              return acc
            }, {} as Record<string, string>),
          ),
        })
      }
    } catch {
      // jatuh ke fetch biasa
    }
  }

  return fetch(url, mergedOptions)
}

type ManifestResult =
  | { ok: true; manifest: VersionManifest }
  | { ok: false; reason: 'not-found' | 'network' | 'invalid' }

/**
 * Ambil manifest SELALU segar. `?t=` membuat URL unik sehingga lapisan cache
 * apa pun (WebView, Fastly/GitHub raw) tidak bisa menyajikan version.json basi
 * — penyebab utama update sekunder tidak terdeteksi.
 */
/**
 * DEV mode yang sah untuk memotong jaringan GitHub (CORS di localhost).
 * Sama seperti di services/geofence.ts: harus DEV=true DAN MODE='development'.
 * Vitest menyetel DEV=true dengan MODE='test' → jalur ini TIDAK boleh aktif,
 * kalau tidak semua tes siklus rilis (V1→V2→V3) buntu di "manifest not-found".
 */
function devModeSkipRemote(): boolean {
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV) return false
  if (env.MODE && env.MODE !== 'development') return false
  return true
}

async function fetchManifest(signal: AbortSignal): Promise<ManifestResult> {
  // DEV MODE: Skip fetch ke GitHub jika di development (CORS block di localhost)
  if (devModeSkipRemote()) {
    console.log('[OTA] DEV MODE: Skip fetch manifest dari GitHub (menghindari CORS)')
    return { ok: false, reason: 'not-found' }
  }

  let res: Response | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      res = await nativeFetch(`${MANIFEST_URL}?t=${Date.now()}&n=${attempt}`, {
        signal,
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      })
      break
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      if (attempt === 2) return { ok: false, reason: 'network' }
      await sleep(400 * (attempt + 1))
    }
  }
  if (!res) return { ok: false, reason: 'network' }

  if (res.status === 404 || res.status === 410) return { ok: false, reason: 'not-found' }
  if (!res.ok) return { ok: false, reason: 'network' }

  try {
    const data = await res.json() as VersionManifest
    if (!data || typeof data.version !== 'string' || !Array.isArray(data.assets) || data.assets.length === 0) {
      return { ok: false, reason: 'invalid' }
    }
    for (const asset of data.assets) {
      if (typeof asset !== 'string' || !asset.length) return { ok: false, reason: 'invalid' }
    }
    // index.html WAJIB ada: tanpa itu bundle tidak bisa dipakai untuk navigasi.
    if (!data.assets.includes('index.html')) return { ok: false, reason: 'invalid' }
    return { ok: true, manifest: data }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

// Bandingkan versi: "x.y.z" · "x.y.z+<timestamp>" · commit-hash/opaque.
export function isNewer(remote: string, local: string): boolean {
  if (!local) return true
  if (!remote) return false
  if (remote === local) return false
  const rt = /\+(\d+)/.exec(remote)?.[1]
  const lt = /\+(\d+)/.exec(local)?.[1]
  if (rt && lt) return parseInt(rt, 10) > parseInt(lt, 10)
  const rm = remote.match(/\d+/g)
  const lm = local.match(/\d+/g)
  if (rm && lm) {
    const max = Math.max(rm.length, lm.length)
    for (let i = 0; i < max; i++) {
      const rn = parseInt(rm[i] ?? '0', 10)
      const ln = parseInt(lm[i] ?? '0', 10)
      if (rn !== ln) return rn > ln
    }
    return remote.length > local.length
  }
  return !remote.startsWith(local)
}

export function semverLabel(version: string): string {
  if (!version) return '—'
  const m = version.match(/^([\d.]+)/)
  return m ? m[1] : version
}

/**
 * Unduh satu berkas bundle.
 * URL unik per percobaan (`?ota=<versi>&t=<ts>&n=<attempt>`) — inilah yang
 * membuat CDN/WebView TIDAK bisa menyajikan salinan lama untuk nama file tetap
 * seperti index.html (penyebab "integritas tidak cocok" dulu).
 */
async function downloadAsset(
  version: string,
  path: string,
  signal: AbortSignal,
  attempts = 3,
): Promise<Uint8Array> {
  let lastErr: unknown
  for (let n = 0; n < attempts; n++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      const url = `${ASSETS_BASE}${path}?ota=${encodeURIComponent(version)}&t=${Date.now()}&n=${n}`
      const res = await nativeFetch(url, { signal, cache: 'no-store' })
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
      if (!res.ok) throw new Error(`HTTP ${res.status} saat unduh ${path}`)
      const buf = await res.arrayBuffer()
      if (!buf || buf.byteLength === 0) throw new Error(`File kosong: ${path}`)
      return new Uint8Array(buf)
    } catch (err) {
      if (signal.aborted || (err as Error)?.name === 'AbortError') throw err
      lastErr = err
      if (n < attempts - 1) await sleep(600 * (n + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Gagal unduh ${path}`)
}

/**
 * Verifikasi isi berkas terhadap hash manifest.
 * Manifest baru SELALU memuat integrity untuk tiap berkas (publisher
 * memaksanya) — jadi ketidakcocokan = berkas basi/rusak dan update harus batal.
 * Bila manifest tidak punya integrity (kompatibilitas versi lama), keberadaan
 * berkas non-kosong dianggap cukup.
 */
async function verifyBytes(
  bytes: Uint8Array,
  path: string,
  integrity?: Record<string, string>,
): Promise<boolean> {
  const expected = integrity?.[path]
  if (!expected) return bytes.byteLength > 0
  const actual = await sha256Hex(bytes)
  if (actual == null) return bytes.byteLength > 0 // WebCrypto tidak tersedia
  return actual.toLowerCase() === expected.toLowerCase()
}

/** Tulis satu berkas ke cache versi + penyimpanan durable. */
async function stageAsset(version: string, path: string, bytes: Uint8Array): Promise<void> {
  if (typeof caches !== 'undefined') {
    const cache = await caches.open(versionCacheName(version))
    await cache.put(
      urlOf(path),
      new Response(bytes.slice().buffer as ArrayBuffer, {
        headers: {
          'Content-Type': contentTypeOf(path),
          'Cache-Control': 'no-store',
        },
      }),
    )
  }
  await persistToStorage(version, path, bytes)
}

/**
 * Baca berkas HANYA dari cache versi (Cache Storage).
 * Sengaja TIDAK jatuh ke storage — pemanggil (`ensureVersionBundleReady`) yang
 * harus tahu cache-nya kosong supaya bisa MEMBANGUN ULANG cache dari storage
 * durable. Bila fungsi ini diam-diam mengambil dari storage, cache versi akan
 * tetap kosong dan Service Worker (yang hanya menyajikan dari cache versi)
 * jatuh ke bundel bawaan APK → versi campur.
 */
async function readFromVersionCache(version: string, path: string): Promise<Uint8Array | null> {
  if (typeof caches === 'undefined') return null
  try {
    const cache = await caches.open(versionCacheName(version))
    const res = await cache.match(urlOf(path))
    if (res) return new Uint8Array(await res.arrayBuffer())
  } catch { /* cache tidak tersedia */ }
  return null
}

function contentTypeOf(path: string): string {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8'
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (path.endsWith('.css')) return 'text/css; charset=utf-8'
  if (path.endsWith('.svg')) return 'image/svg+xml'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.json')) return 'application/json'
  if (path.endsWith('.woff2')) return 'font/woff2'
  return 'application/octet-stream'
}

// ── Aktivasi ─────────────────────────────────────────────────────────────────

/**
 * Pastikan berkas versi ini benar-benar ada & cocok hash-nya, membangun cache
 * versi dari penyimpanan durable bila perlu (mis. setelah WebView dibersihkan).
 * Return false bila bundle tidak lengkap → aktivasi dibatalkan.
 */
async function ensureVersionBundleReady(version: string, assets: string[]): Promise<boolean> {
  const marker = await readMarker(version)
  const integrity = marker?.integrity
  const manifestAssets = marker?.assets?.length ? marker.assets : assets

  for (const path of manifestAssets) {
    let bytes = await readFromVersionCache(version, path)
    if (!bytes) {
      // cache hilang (WebView dibersihkan) → bangun ulang dari storage durable
      const fromStorage = await readFromStorage(version, path)
      if (!fromStorage) return false
      await stageAsset(version, path, fromStorage)
      bytes = fromStorage
    }
    if (!(await verifyBytes(bytes, path, integrity))) return false
  }
  return true
}

/**
 * Aktifkan versi yang sudah lulus verifikasi (SWITCH ATOMIK):
 *   1. verifikasi seluruh berkas versi baru,
 *   2. tulis penanda versi aktif (meta) — sejak titik ini SW menyajikan versi baru,
 *   3. buang versi lama (cache + storage) → tidak ada sisa chunk lama,
 *   4. catat versi lokal + flag persist.
 */
export async function activateStagedBundle(version: string, assets: string[]): Promise<boolean> {
  if (!assets.length || typeof caches === 'undefined') return false
  try {
    if (!(await ensureVersionBundleReady(version, assets))) {
      console.warn('[OTA] aktivasi dibatalkan — bundle tidak lengkap/cacat:', version)
      await removeVersionStorage(version)
      return false
    }

    const marker = await readMarker(version)
    await writeActiveMeta(version, marker?.assets?.length ? marker.assets : assets)

    // Baru setelah switch: buang semua versi lain (termasuk versi lama yang
    // tadinya aktif) agar tidak ada residu V1.0.1 saat V1.0.2 tampil.
    await purgeOtherVersions([version])

    setCurrentVersion(version)
    try { localStorage.setItem(APPLIED_VER_KEY, version) } catch { /* quota */ }
    await markBundlePersisted()
    return true
  } catch (err) {
    console.warn('[OTA] aktivasi gagal:', err)
    return false
  }
}

/**
 * Kompatibilitas API lama: aktivasi versi dari daftar aset.
 * (Dipakai test & jalur "web tanpa Filesystem".)
 */
export async function activateBundle(version: string, assets: string[]): Promise<boolean> {
  return activateStagedBundle(version, assets)
}

/**
 * SELF-HEAL saat boot: bila flag persist ada tetapi cache/meta hilang (clear
 * data, WebView reset, OS membersihkan cache), bangun ulang dari penyimpanan
 * durable tanpa unduh ulang. Ini yang membuat update pertama tetap "lengket"
 * dan tidak memaksa pengguna Clear Data manual.
 */
export async function restoreBundleFromStorage(): Promise<boolean> {
  try {
    const local = await getCurrentVersion()
    if (!local || local === BUNDLED_VERSION) return false
    if (!(await hasPersistFlag())) return false

    const marker = await readMarker(local)
    const assets = marker?.assets
    if (!assets?.length) return false
    if (typeof caches === 'undefined') return false

    const cache = await caches.open(versionCacheName(local))
    const before = (await cache.keys()).length
    const meta = await readActiveMeta()

    if (before < assets.length) {
      // Bangun ulang cache versi dari storage durable (tanpa unduh ulang).
      const ok = await ensureVersionBundleReady(local, assets)
      if (!ok) return false
    }
    // Pastikan cache versi benar-benar terisi: SW hanya menyajikan dari sini.
    if ((await cache.keys()).length < assets.length) return false
    if (meta?.version !== local) await writeActiveMeta(local, assets)
    return true
  } catch { return false }
}

// ── Reset ────────────────────────────────────────────────────────────────────

/**
 * Hapus SEMUA jejak OTA: cache Storage (per versi + meta + arsitektur lama),
 * direktori durable & legacy di Filesystem, serta seluruh state localStorage.
 * Setelah ini aplikasi kembali memakai bundle bawaan APK.
 */
export async function resetOtaStorage(): Promise<void> {
  const names = await listCaches()
  await Promise.all(names.map(async n => {
    if (n === OTA_CACHE || n === OTA_META_CACHE || n.startsWith('trip-ota-')) {
      try { await caches.delete(n) } catch { /* */ }
    }
  }))

  if (isNative()) {
    for (const [path, directory] of [[OTA_DIR, Directory.Data], [LEGACY_OTA_DIR, Directory.Cache]] as const) {
      try {
        await Filesystem.rmdir({ path, directory, recursive: true })
      } catch { /* sudah tidak ada */ }
    }
  }

  try {
    localStorage.removeItem(STATE_KEY)
    localStorage.removeItem(CURRENT_VER_KEY)
    localStorage.removeItem(LAST_ERROR_KEY)
    localStorage.removeItem(PERSIST_BUNDLE_ACTIVE_KEY)
    localStorage.removeItem(APPLIED_VER_KEY)
  } catch { /* quota */ }

  console.log('[OTA] resetOtaStorage() selesai — semua bundle & state OTA dibuang')
}

/**
 * RESET TOTAL dari sisi klien (tombol "Reset App Cache" di UpdateNotifier):
 * purge semua OTA storage + lepas registrasi Service Worker + kosongkan cache
 * WebView milik origin ini. Dipakai saat jaringan bermasalah / aplikasi macet
 * di lapangan. Caller harus reload setelah ini.
 */
export async function resetAppCacheFully(): Promise<void> {
  await resetOtaStorage()
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations()
      await Promise.all(regs.map(r => r.unregister().catch(() => false)))
    }
  } catch { /* tidak ada SW */ }
  console.log('[OTA] resetAppCacheFully() selesai — reload akan memakai bundle bawaan')
}

// ── Diagnostik ───────────────────────────────────────────────────────────────

export async function auditOta(): Promise<{
  localVersion: string
  remoteVersion: string | null
  activeMetaVersion: string | null
  bundlePersisted: boolean
  cacheActiveEntries: number
  hasRemoteManifest: boolean
}> {
  const localVersion = (await getCurrentVersion()) ?? BUNDLED_VERSION
  const persisted = await hasPersistFlag()
  const meta = await readActiveMeta()
  let remoteVersion: string | null = null
  let hasRemoteManifest = false

  // DEV MODE: Skip fetch ke GitHub jika di development (CORS block di localhost)
  const isDevMode = devModeSkipRemote()
  if (isDevMode) {
    console.log('[OTA] DEV MODE: Skip audit fetch dari GitHub (menghindari CORS)')

    let cacheActiveEntries = 0
    try {
      if (typeof caches !== 'undefined' && meta?.version) {
        const cache = await caches.open(versionCacheName(meta.version))
        cacheActiveEntries = (await cache.keys()).length
      }
    } catch { /* cache tidak tersedia */ }

    return {
      localVersion,
      remoteVersion: null,
      activeMetaVersion: meta?.version ?? null,
      bundlePersisted: persisted,
      cacheActiveEntries,
      hasRemoteManifest: false,
    }
  }

  try {
    const ac = new AbortController()
    const timeout = setTimeout(() => ac.abort(), 4000)
    let res: Response
    try {
      res = await nativeFetch(MANIFEST_URL, { cache: 'no-store', signal: ac.signal })
    } finally {
      clearTimeout(timeout)
    }
    if (res.ok) {
      const data = await res.json()
      if (data?.version) {
        remoteVersion = data.version
        hasRemoteManifest = true
      }
    }
  } catch { /* offline — bukan blocking */ }

  let cacheActiveEntries = 0
  try {
    if (typeof caches !== 'undefined' && meta?.version) {
      const cache = await caches.open(versionCacheName(meta.version))
      cacheActiveEntries = (await cache.keys()).length
    }
  } catch { /* cache tidak tersedia */ }

  return {
    localVersion,
    remoteVersion,
    activeMetaVersion: meta?.version ?? null,
    bundlePersisted: persisted,
    cacheActiveEntries,
    hasRemoteManifest,
  }
}

// ── Service worker ───────────────────────────────────────────────────────────

/**
 * Daftarkan SW penyaji bundle. `updateViaCache: 'none'` memaksa browser
 * memeriksa ulang skrip SW (bukan memakai salinan cache) — dulu SW lama bisa
 * terus menyajikan cache basi karena skripnya tidak pernah diperbarui.
 */
export function registerOtaServiceWorker(forceRefresh = false): void {
  if (!('serviceWorker' in navigator)) return
  if (location.protocol === 'file:') return
  navigator.serviceWorker.register('sw.js', { scope: '/', updateViaCache: 'none' }).then(reg => {
    void reg.update().catch(() => undefined)
    const activateNew = (worker: ServiceWorker | null) => {
      worker?.postMessage({ type: 'SKIP_WAITING' })
    }
    activateNew(reg.waiting)
    reg.addEventListener('updatefound', () => {
      const newWorker = reg.installing
      if (!newWorker) return
      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) activateNew(newWorker)
      })
    })
    if (forceRefresh) activateNew(reg.waiting)
  }).catch(err => {
    console.warn('[OTA] service worker gagal didaftarkan:', err)
  })
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

export interface CheckResult {
  available: boolean
  version?: string
  assets?: string[]
}

let controller: AbortController | undefined

/**
 * Cek + unduh pembaruan (FULL-PACKAGE, PURGE-FIRST).
 *
 * Urutan yang dijaga ketat:
 *   1. manifest segar (anti-cache) & versi lebih baru?
 *   2. purge SEMUA versi lain (cache + storage) — tidak ada sisa chunk lama
 *      yang bisa tercampur; versi yang SEDANG AKTIF tetap dipertahankan
 *      sampai versi baru lulus verifikasi (agar aplikasi tidak rusak di tengah
 *      proses bila unduhan gagal),
 *   3. unduh SELURUH berkas (URL ber-versi, retry 3x),
 *   4. verifikasi hash tiap berkas,
 *   5. tulis ke cache versi baru + storage durable + marker.
 * Gagal di langkah mana pun → staging dibuang, versi lama tetap dipakai.
 */
export async function checkForUpdate(
  currentVersion: string | undefined | null,
  onState?: (s: UpdateState) => void,
  force = false,
): Promise<CheckResult> {
  const emit = (s: UpdateState) => { saveState(s); onState?.(s) }
  const local = currentVersion ?? (await getCurrentVersion()) ?? BUNDLED_VERSION

  controller?.abort()
  controller = new AbortController()
  const sig = controller.signal

  try {
    const online = await isOnline()
    if (!online) {
      emit({ status: 'offline', latestVersion: getCachedState()?.latestVersion ?? local, activeVersion: local })
      return { available: false }
    }

    if (force) {
      try { localStorage.removeItem(LAST_ERROR_KEY) } catch { /* quota */ }
    } else {
      const lastErr = parseInt(localStorage.getItem(LAST_ERROR_KEY) ?? '0', 10)
      if (Date.now() - lastErr < ERROR_COOLDOWN_MS) return { available: false }
    }

    await clearStuckOtaState()

    const result = await fetchManifest(sig)
    if (!result.ok) {
      if (result.reason === 'not-found') {
        emit({ status: 'idle', latestVersion: local, activeVersion: local })
        return { available: false }
      }
      console.warn('[OTA] cek gagal:', result.reason, force ? '(manual)' : '(silent)')
      localStorage.setItem(LAST_ERROR_KEY, String(Date.now()))
      emit(force
        ? { status: 'error', error: 'Gagal menghubungi server pembaruan', latestVersion: local, activeVersion: local }
        : { status: 'idle', latestVersion: local, activeVersion: local })
      return { available: false }
    }
    const remote = result.manifest

    if (!isNewer(remote.version, local)) {
      console.log(`[OTA] Versi tidak lebih baru: local=${local}, remote=${remote.version}`)
      emit({ status: 'idle', latestVersion: local, activeVersion: local })
      return { available: false, version: local }
    }

    console.log(`[OTA] Update tersedia: ${local} → ${remote.version} (${remote.assets.length} berkas)`)
    emit({ status: 'downloading', progress: 0, latestVersion: remote.version, activeVersion: local })

    // ── LANGKAH 2: PURGE-FIRST ─────────────────────────────────────────────
    // Semua versi LAIN dibuang sebelum byte pertama diunduh (tidak ada sisa
    // V1.0.1 saat V1.0.2 selesai). Versi aktif dipertahankan sampai switch.
    const activeBefore = (await readActiveMeta())?.version
    await purgeOtherVersions([remote.version, ...(activeBefore ? [activeBefore] : [])])
    await removeVersionStorage(remote.version) // staging bersih, mulai dari nol

    // ── LANGKAH 3-5: FULL DOWNLOAD + VERIFIKASI + STAGING ──────────────────
    const total = remote.assets.length
    for (let i = 0; i < total; i++) {
      if (sig.aborted) {
        await removeVersionStorage(remote.version)
        emit({ status: 'idle', latestVersion: local, activeVersion: local })
        return { available: false }
      }
      const asset = remote.assets[i]
      try {
        const bytes = await downloadAsset(remote.version, asset, sig)
        if (!(await verifyBytes(bytes, asset, remote.integrity))) {
          // Berkas basi/rusak → coba unduh ulang dengan cache-buster baru.
          let recovered = false
          for (let extra = 0; extra < 2 && !recovered; extra++) {
            await sleep(300 * (extra + 1))
            const retryBytes = await downloadAsset(remote.version, asset, sig, 2)
            recovered = await verifyBytes(retryBytes, asset, remote.integrity)
            if (recovered) {
              await stageAsset(remote.version, asset, retryBytes)
            }
          }
          if (!recovered) {
            console.warn('[OTA] verifikasi berkas gagal — update dibatalkan:', asset)
            await removeVersionStorage(remote.version)
            localStorage.setItem(LAST_ERROR_KEY, String(Date.now()))
            emit({
              status: 'error',
              error: 'Verifikasi berkas gagal — update dibatalkan (versi lama tetap dipakai)',
              latestVersion: remote.version,
              activeVersion: local,
            })
            return { available: false }
          }
        } else {
          await stageAsset(remote.version, asset, bytes)
        }
        console.log(`[OTA] terunduh & terverifikasi ${i + 1}/${total}: ${asset}`)
      } catch (err) {
        if (sig.aborted) {
          await removeVersionStorage(remote.version)
          emit({ status: 'idle', latestVersion: local, activeVersion: local })
          return { available: false }
        }
        console.warn('[OTA] unduhan gagal:', asset, err)
        await removeVersionStorage(remote.version)
        localStorage.setItem(LAST_ERROR_KEY, String(Date.now()))
        emit({ status: 'error', error: 'Gagal mengunduh paket pembaruan', latestVersion: local, activeVersion: local })
        return { available: false }
      }
      emit({
        status: 'downloading',
        progress: Math.round(((i + 1) / total) * 100),
        latestVersion: remote.version,
        activeVersion: local,
      })
    }

    // Marker ditulis hanya setelah SEMUA berkas ada.
    try { await writeMarker(remote.version, remote.assets, remote.integrity) } catch { /* web */ }

    emit({
      status: 'ready',
      progress: 100,
      downloaded: remote.assets,
      latestVersion: remote.version,
      activeVersion: local,
    })
    return { available: true, version: remote.version, assets: remote.assets }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return { available: false }
    console.warn('[OTA] cek gagal total:', err, force ? '(manual)' : '(silent)')
    localStorage.setItem(LAST_ERROR_KEY, String(Date.now()))
    emit(force
      ? { status: 'error', error: 'Gagal menghubungi server pembaruan', latestVersion: local, activeVersion: local }
      : { status: 'idle', latestVersion: local, activeVersion: local })
    return { available: false }
  }
}

/**
 * Terapkan bundle terunduh (aktifkan + switch). Caller melakukan reload setelah
 * fungsi ini bernilai true.
 * Gagal → false; aplikasi tetap berjalan pada versi sekarang (tidak ada layar
 * kosong / crash).
 */
export async function applyUpdate(): Promise<boolean> {
  try {
    const state = getCachedState()
    const version = state?.latestVersion
    const assets = state?.downloaded
    if (!version || !assets?.length) return false

    const marker = await readMarker(version)
    const list = marker?.assets?.length ? marker.assets : assets

    const ok = await activateStagedBundle(version, list)
    if (!ok) {
      await removeVersionStorage(version)
      saveState({ status: 'error', error: 'Bundle tidak lengkap setelah unduh', latestVersion: version })
      return false
    }

    saveState({ status: 'idle', latestVersion: version, activeVersion: version })

    // Bundle baru → tarik roster petugas segera saat aplikasi dibuka kembali.
    try { localStorage.setItem(FORCE_ROSTER_SYNC_KEY, '1') } catch { /* quota */ }

    try {
      const audit = await auditOta()
      console.log(
        '[OTA] pasca-apply:',
        'local=', audit.localVersion,
        'meta=', audit.activeMetaVersion,
        'remote=', audit.remoteVersion,
        'cacheEntries=', audit.cacheActiveEntries,
      )
      if (audit.cacheActiveEntries === 0 && audit.hasRemoteManifest) {
        console.warn('[OTA] pasca-apply: cache versi aktif kosong — perangkat perlu reload/reset OTA.')
      }
    } catch { /* diagnostik gagal → jangan fatalkan apply */ }

    return true
  } catch (err) {
    console.warn('[OTA] apply gagal:', err)
    return false
  }
}
