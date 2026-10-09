// ─── OTA Auto-Update Service ──────────────────────────────────────────────────
// Pembaruan tanpa install ulang .apk:
//   1. Ambil version.json (manifest) dari branch `mobile` di GitHub.
//   2. Bandingkan versi/commit-hash dengan versi lokal perangkat.
//   3. Unduh seluruh file bundle www KE PENYIMPANAN INTERNAL APLIKASI
//      (Cache dir Capacitor Filesystem + Cache Storage untuk service worker)
//      di latar belakang — UI tetap bisa dipakai.
//   4. Saat "Terapkan", isi Cache Storage dari penyimpanan internal lalu
//      muat ulang; service worker menyajikan bundle baru tersebut.
//
// Keamanan gagal (offline / unduhan terputus):
//   • Bundle hanya dianggap SAH bila semua file dari manifest berhasil ditulis
//     (penanda `.complete.json`) — unduhan parsial dibuang, tidak pernah
//     dipakai, sehingga aplikasi selalu jatuh ke bundle bawaan APK.
//   • Semua operasi dibungkus try/catch: gagal = state 'error', app tetap jalan.

import { Network } from '@capacitor/network'
import { Capacitor } from '@capacitor/core'
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import { FORCE_ROSTER_SYNC_KEY } from './adminPull'

const MANIFEST_URL = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/version.json'
const ASSETS_BASE = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/ota/'

/** Cache Storage yang dibaca service worker (src/sw.js). */
export const OTA_CACHE = 'trip-ota-active'
const CACHE_PREFIX = 'trip-ota-'
/** Folder penyimpanan internal bundle (Capacitor Filesystem, direktori Cache). */
const OTA_DIR = 'trip-ota'
const MARKER = '.complete.json'


const ERROR_COOLDOWN_MS = 2 * 60 * 1000

export interface VersionManifest {
  version: string
  assets: string[]
  minAppVersion?: string

  

  integrity?: Record<string, string>
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'offline'
  progress?: number
  error?: string
  downloaded?: string[]
  latestVersion?: string
}

const STATE_KEY = 'trip.ota.state'
const CURRENT_VER_KEY = 'trip.ota.currentVersion'
/** Versi awal perangkat yang belum pernah menerima update. */
const BUNDLED_VERSION = '0.0.0'
/** Timestamp error terakhir untuk deduplikasi */
const LAST_ERROR_KEY = 'trip.ota.lastError'

// ── Versi lokal ──────────────────────────────────────────────────────────────

export async function getCurrentVersion(): Promise<string | null> {
  try {
    let v = localStorage.getItem(CURRENT_VER_KEY)
    if (!v) {
      // Perangkat baru: mulai dari versi dasar supaya update pertama terdeteksi
      v = BUNDLED_VERSION
      localStorage.setItem(CURRENT_VER_KEY, v)
    }
    return v
  } catch { return BUNDLED_VERSION }
}

export function setCurrentVersion(v: string): void {
  try { localStorage.setItem(CURRENT_VER_KEY, v) } catch { /* quota */ }
}

export function getCachedState(): UpdateState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    return raw ? JSON.parse(raw) : null
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

// ── Lifecycle toggle ─────────────────────────────────────────────────────────
// Flag terpisah dari versi: bila disetされたが (value='1') aplikasi mulai,
// service worker WAJIB serve bundle OTA aktif (bukan bundle bawaan APK).
// Harus ada karena clear-data / reinstall bisa membuat perangkat lupa bahwa
// bundle OTA pernah diaktifkan — flag ini juara "apakah bundle harus dijadikan
// yang dikirim ke UI".
export const PERSIST_BUNDLE_ACTIVE_KEY = 'trip.ota.persistActive'

/**
 * Tandai bahwa bundle versi ini sudah diaktifkan (dipakai service worker).
 * Dipakai main.tsx/ota boot: bila flag ada, panggil activateBundle() + reload
 * saat start, bukan cuma menunggu tombol manual.
 */
export async function markBundlePersisted(): Promise<void> {
  try { localStorage.setItem(PERSIST_BUNDLE_ACTIVE_KEY, '1') } catch { /* quota */ }
}

export async function clearPersistFlag(): Promise<void> {
  try { localStorage.removeItem(PERSIST_BUNDLE_ACTIVE_KEY) } catch { /* quota */ }
}

export async function hasPersistFlag(): Promise<boolean> {
  try { return localStorage.getItem(PERSIST_BUNDLE_ACTIVE_KEY) === '1' } catch { return false }
}

// ── Diagnostik & reset ───────────────────────────────────────────────────────

/**
 * Cek singkat kondisi OTA tanpa side-efek:
 * - versi lokal saat ini (persisted / bundled)
 * - apakah bundle aktif pernah diaktifkan
 * - apakah manifiest remote lebih baru (bila reachable)
 * - apakah cache OTA kosong / ada
 *
 * Dipakai untuk diagnostik saat update "terdeteksi tapi tidak berubah".
 */
export async function auditOta(): Promise<{
  localVersion: string
  remoteVersion: string | null
  bundlePersisted: boolean
  cacheActiveEntries: number
  hasRemoteManifest: boolean
}> {
  const localVersion = (await getCurrentVersion()) ?? (await getCurrentVersion()) ?? BUNDLED_VERSION
  const persisted = await hasPersistFlag()
  let remoteVersion: string | null = null
  let hasRemoteManifest = false

  try {
    const res = await fetch(MANIFEST_URL, { cache: 'no-store', signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      const data = await res.json()
      if (data?.version) {
        remoteVersion = data.version
        hasRemoteManifest = true
      }
    }
  } catch { /* offline / timeout — bukan blocking */ }

  let cacheActiveEntries = 0
  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(OTA_CACHE)
      const keys = await cache.keys()
      cacheActiveEntries = keys.length
    }
  } catch { /* cache tidak tersedia */ }

  return {
    localVersion,
    remoteVersion,
    bundlePersisted: persisted,
    cacheActiveEntries,
    hasRemoteManifest,
  }
}

/**
 * Hapus semua state & bundle OTA — jawaban atas perangkat yang "terupdate"
 * tapi tetap tampak versi lama / macet.
 *
 * Bersihkan:
 *  - Cache Storage (OTA_CACHE + semua cache trip-ota-*)
 *  - Penyimpanan internal Capacitor (direktori trip-ota, jadi semua versi)
 *  - State OTA (trip.ota.state, trip.ota.currentVersion, trip.ota.lastError)
 *  - Flag persist (trip.ota.persistActive)
 *
 * Setelah ini, app jatuh ke bundle bawaan APK / build asli.
 */
export async function resetOtaStorage(): Promise<void> {
  // 1. Cache Storage
  try {
    const names = await caches.keys()
    await Promise.all(
      names.filter(n => n.startsWith(CACHE_PREFIX) || n === OTA_CACHE).map(n => caches.delete(n)),
    )
  } catch { /* cache tidak tersedia */ }

  // 2. Penyimpanan internal — hapus SELURUH direktori trip-ota ("semua versi")
  if (isNative()) {
    try {
      await Filesystem.rmdir({ path: OTA_DIR, directory: Directory.Cache, recursive: true })
    } catch { /* sudah tidak ada / gagal — tidak fatal */ }
  }

  // 3. State OTA
  try {
    localStorage.removeItem(STATE_KEY)
    localStorage.removeItem(CURRENT_VER_KEY)
    localStorage.removeItem(LAST_ERROR_KEY)
    localStorage.removeItem(PERSIST_BUNDLE_ACTIVE_KEY)
  } catch { /* quota / tidak tersedia */ }

  console.log('[ota] resetOtaStorage() selesai — bundle lama dibuang, state OTA di-reset')
}

// ── Util ─────────────────────────────────────────────────────────────────────

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)))
  }
  return btoa(bin)
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

const isNative = () => Capacitor.isNativePlatform()

type ManifestResult =
  | { ok: true; manifest: VersionManifest }
  | { ok: false; reason: 'not-found' | 'network' | 'invalid' }

async function fetchManifest(signal: AbortSignal): Promise<ManifestResult> {
  let res: Response
  try {
    // 2a — jangan pakai ?t=Date.now() yang buta: itu membuat request hampir
    // sama tiap kali, dan HTTP cache/intermediary bisa return respons basi.
    // Pakai GET polos + no-store + AbortSignal; saat perangkat "tarik update"
    // atau aplikasi start, fetch ini selalu re-resolve ke manifest terkini.
    res = await fetch(MANIFEST_URL, {
      signal,
      cache: 'no-store',
      headers: { 'Accept': 'application/json' },
    })
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err
    // Gagal di level jaringan (offline, DNS, CORS, diblokir)
    return { ok: false, reason: 'network' }
  }

  // 404/410 = manifest memang belum pernah dipublish → bukan kegagalan
  if (res.status === 404 || res.status === 410) return { ok: false, reason: 'not-found' }
  if (!res.ok) return { ok: false, reason: 'network' }

  try {
    const data = await res.json()
    if (!data || typeof data.version !== 'string' || !Array.isArray(data.assets)) {
      return { ok: false, reason: 'invalid' }
    }
    return { ok: true, manifest: data as VersionManifest }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}

// Bandingkan versi. Format yang didukung:
//   • "x.y.z"  (semver murni)
//   • "x.y.z+<timestamp>" (hybrid; timestamp hanya jadi tie-breaker numerik)
//   • commit-hash / opaque (pernah ditemukan di versi lama)
export function isNewer(remote: string, local: string): boolean {
  if (!local) return true
  if (!remote) return false
  if (remote === local) return false
  // Hybrid semver+timestamp: bandingkan timestamp build-nya dulu
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
    // Semua segmen numerik sama → bandingkan panjang (mis. "1.0" vs "1.0.0")
    return remote.length > local.length
  }
  // Gaya commit-hash: remote lebih baru bila bukan prefiks local
  return !remote.startsWith(local)
}

/**
 * Parse semver depan dari versi hybrid. Dipakai di UI untuk menampilkan
 * versi yang manusiawi (mis. "1.0.2") tanpa timestamp.
 */
export function semverLabel(version: string): string {
  if (!version) return '—'
  const m = version.match(/^([\d.]+)/)
  return m ? m[1] : version
}

/** Unduh satu file bundle dengan retry — GitHub raw & jaringan lapangan sering
 *  seret sesaat (429/throttle); tanpa retry, 1 gagal = 20 file dibuang. */
async function downloadAsset(path: string, signal: AbortSignal, attempts = 3): Promise<Uint8Array> {
  let lastErr: unknown
  for (let n = 0; n < attempts; n++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      const res = await fetch(ASSETS_BASE + path, { signal, cache: 'no-store' })
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

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Hitung SHA-256 (hex) dari bytes via WebCrypto. Return null bila crypto.subtle
 * tidak tersedia ( WebView lawas / konteks tidak aman ) — caller melewati
 * verifikasi sengaja agar update tetap jalan di lingkungan tanpa WebCrypto.
 */
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

/**
 * Cocokkan bytes hasil unduh dengan hash di manifest. Return true bila SAH:
 * tidak ada hash untuk path ini, WebCrypto tidak tersedia (mundur kompatibel),
 * atau hash cocok. Hanya ketidakcocokan nyata yang membatalkan update.
 */
async function verifyAsset(bytes: Uint8Array, path: string, integrity?: Record<string, string>): Promise<boolean> {
  const expected = integrity?.[path]
  if (!expected) return true
  const actual = await sha256Hex(bytes)
  if (actual == null) return true // tak bisa verifikasi → jangan blokir update
  return actual.toLowerCase() === expected.toLowerCase()
}

// ── Penyimpanan internal ─────────────────────────────────────────────────────

function assetPath(version: string, path: string): string {
  return `${OTA_DIR}/${version}/${path}`
}

/** Tulis file ke penyimpanan internal (native) — tahan terhadap hapus cache WebView. */
async function persistToStorage(version: string, path: string, bytes: Uint8Array): Promise<void> {
  if (!isNative()) return
  await Filesystem.writeFile({
    path: assetPath(version, path),
    data: toBase64(bytes),
    directory: Directory.Cache,
    recursive: true,
  })
}

async function readFromStorage(version: string, path: string): Promise<Uint8Array | null> {
  if (!isNative()) return null
  try {
    const res = await Filesystem.readFile({
      path: assetPath(version, path),
      directory: Directory.Cache,
    })
    if (res.data instanceof Blob) return new Uint8Array(await res.data.arrayBuffer())
    return fromBase64(String(res.data))
  } catch { return null }
}

async function removeStorage(version: string): Promise<void> {
  if (!isNative()) return
  try {
    await Filesystem.rmdir({ path: `${OTA_DIR}/${version}`, directory: Directory.Cache, recursive: true })
  } catch { /* sudah tidak ada */ }
}

/** Buang SEMUA folder versi OTA kecuali `keep` — versi lama tidak menumpuk. */
async function removeOtherVersions(keep: string): Promise<void> {
  if (!isNative()) return
  try {
    const { files } = await Filesystem.readdir({ path: OTA_DIR, directory: Directory.Cache })
    for (const f of files) {
      if (f.type === 'directory' && f.name !== keep) {
        await removeStorage(f.name)
        console.log(`[ota] versi lama ${f.name} dihapus dari penyimpanan`)
      }
    }
  } catch { /* folder belum ada */ }
}

function urlOf(path: string): string {
  return new URL(path, window.location.origin).href
}

async function putToCache(path: string, bytes: Uint8Array): Promise<void> {
  const cache = await caches.open(OTA_CACHE)
  // Salin tepat seukuran view — ArrayBuffer generik tidak selalu cocok BodyInit
  const body = bytes.slice().buffer as ArrayBuffer
  await cache.put(
    urlOf(path),
    new Response(body, {
      headers: {
        'Content-Type': contentTypeOf(path),
        // Jangan biarkan WebView/CDN menyimpan versi lama dari URL ini
        'Cache-Control': 'no-store',
      },
    }),
  )
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

async function writeMarker(version: string, assets: string[]): Promise<void> {
  if (!isNative()) return
  await Filesystem.writeFile({
    path: `${OTA_DIR}/${version}/${MARKER}`,
    data: JSON.stringify({ version, assets, savedAt: Date.now() }),
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
    recursive: true,
  })
}

async function readMarker(version: string): Promise<VersionManifest | null> {
  if (!isNative()) return null
  try {
    const res = await Filesystem.readFile({
      path: `${OTA_DIR}/${version}/${MARKER}`,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    })
    if (typeof res.data !== 'string') return null
    return JSON.parse(res.data) as VersionManifest
  } catch { return null }
}

/** Buang semua salinan bundle (unduhan parsial / reset). */
async function discardBundle(version?: string): Promise<void> {
  try {
    // FULL PURGE: hapus SEMUA OTA cache, bukan hanya prefix tertentu
    const cacheNames = await caches.keys()
    await Promise.all(cacheNames.map(n => caches.delete(n)))
  } catch { /* cache tidak tersedia */ }
  if (version) await removeStorage(version)
}

/** Bersihkan SEMUA direktori versi lama sebelum unduhan baru. */
async function purgeAllOtaStorage(): Promise<void> {
  // 1. Buang semua cache
  try {
    const names = await caches.keys()
    await Promise.all(names.map(n => caches.delete(n)))
  } catch { /* */ }
  // 2. Buang semua versi di penyimpanan internal
  if (isNative()) {
    try {
      const { files } = await Filesystem.readdir({ path: OTA_DIR, directory: Directory.Cache })
      for (const f of files) {
        if (f.type === 'directory') await removeStorage(f.name)
      }
    } catch { /* folder belum ada */ }
  }
}

/**
 * 2a — anti-stuck: bersihkan state OTA yang macet (mis. sebagai akibat pull
 * kedua yang gagal, atau bundle yang tidak utuh setelah clear-data).
 * Dipanggil di awal checkForUpdate + dipanggil eksplisit saat start.
 */
async function clearStuckOtaState(): Promise<void> {
  const state = getCachedState()
  if (!state) return
  const stuck = state.status === 'downloading' || (state.status === 'ready' && (!state.downloaded || state.downloaded.length === 0))
  if (!stuck) return
  // Hapus bundle parsial yang mungkin menahan cache basi.
  await discardBundle(state.latestVersion)
  saveState({ status: 'idle', latestVersion: state.latestVersion ?? await getCurrentVersion() ?? BUNDLED_VERSION })
}

/**
 * Dipanggil saat app start (boot): bila perangkat pernah mengaktifkan bundle
 * OTA (flag persist ada) tapi Cache Storage kosong (clear data / WebView reset),
 * isi ulang dari penyimpanan internal + aktivasi ulang tanpa unduh ulang.
 * Return true bila berhasil di-restore.
 */
export async function ensurePersistedBundleActive(): Promise<boolean> {
  const persisted = await hasPersistFlag()
  if (!persisted) return false
  const ok = await restoreBundleFromStorage()
  if (!ok) {
    // Bundle tidak utuh → jangan biarkan app start dalam kondisi ambigu:
    // hapus flag, biar aplikasi jatuh kembali ke bundle bawaan APK.
    await clearPersistFlag()
    await discardBundle(undefined)
  }
  return ok
}

// ── Aktivasi bundle ──────────────────────────────────────────────────────────

/**
 * Pastikan Cache Storage (yang dibaca service worker) berisi bundle lengkap.
 * Berkas hilang (terhapus OS) dicoba dibaca ulang dari penyimpanan internal.
 * Returns false bila tidak lengkap → pembaruan BATAL, app tetap memakai
 * bundle bawaan APK (fallback aman).
 */
export async function activateBundle(version: string, assets: string[]): Promise<boolean> {
  if (!assets.length) return false
  if (typeof caches === 'undefined') return false

  try {
    // Bersihkan cache OTA lama agar hanya satu versi aktif
    const names = await caches.keys()
    await Promise.all(
      names.filter(n => n.startsWith(CACHE_PREFIX) && n !== OTA_CACHE).map(n => caches.delete(n)),
    )

    const cache = await caches.open(OTA_CACHE)
    for (const path of assets) {
      // SELALU timpa dengan bundle versi INI. "Skip kalau sudah ada" membuat
      // update kedua sukses secara status tapi isi cache masih versi lama
      // (URL sama, beda isi) → UI tidak berubah sama sekali.
      const bytes = await readFromStorage(version, path)
      if (bytes) await putToCache(path, bytes)
      // Web (tanpa Filesystem): aset sudah ditulis langsung ke cache saat unduh.
      else if (!(await cache.match(urlOf(path)))) return false
    }
    // Verifikasi ulang
    for (const path of assets) {
      if (!(await cache.match(urlOf(path)))) return false
    }
    return true
  } catch (err) {
    console.warn('[ota] aktivasi gagal:', err)
    return false
  }
}

/**
 * Dipanggil saat app start: isi ulang Cache Storage dari penyimpanan internal
 * bila cache WebView terhapus (mis. setelah clear data) — tanpa unduh ulang.
 */
export async function restoreBundleFromStorage(): Promise<boolean> {
  try {
    const version = await getCurrentVersion()
    if (!version || version === BUNDLED_VERSION) return false
    const marker = await readMarker(version)
    if (!marker?.assets?.length) return false

    if (typeof caches === 'undefined') return false
    const cache = await caches.open(OTA_CACHE)
    const missing = []
    for (const path of marker.assets) {
      if (!(await cache.match(urlOf(path)))) missing.push(path)
    }
    if (missing.length === 0) return true
    return activateBundle(version, marker.assets)
  } catch { return false }
}

// ── Registrasi service worker ────────────────────────────────────────────────

/**
 * Daftarkan service worker penyaji bundle OTA. Gagal registrasi TIDAK membuat
 * crash — aplikasi tetap berjalan dengan bundle bawaan.
 *
 * Setelah mendaftarkan ulang (mis. bundle aktif berubah), kirim message ke
 * SW supaya self-heal: skip waiting, aktifkan versi baru, purge cache basi.
 */
export function registerOtaServiceWorker(forceRefresh = false): void {
  if (!('serviceWorker' in navigator)) return
  if (location.protocol === 'file:') return
  navigator.serviceWorker.register('sw.js', { scope: '/' }).then(reg => {
    if (forceRefresh) {
      // Tunjuk ke versi terbaru yang baru saja diaktifkan
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' })
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing
        if (!newWorker) return
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            newWorker.postMessage({ type: 'SKIP_WAITING' })
          }
        })
      })
    }
  }).catch(err => {
    console.warn('[ota] service worker gagal didaftarkan:', err)
  })
}

// ── Orchestrator utama ───────────────────────────────────────────────────────

export interface CheckResult {
  available: boolean
  version?: string
  assets?: string[]
}

let controller: AbortController | undefined

/**
 * Cek update. Silent fail untuk network errors - tidak pernah tampilkan
 * "manifest tidak terjangkau" yang membingungkan petugas lapanga
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
      emit({ status: 'offline', latestVersion: getCachedState()?.latestVersion ?? local })
      return { available: false }
    }

    // 2a — pendinginan error biar tidak spam fetch saat jaringan goyang.
    // Cek MANUAL (force) melewati cooldown: user menekan tombol berarti dia
    // memang ingin hasil sekarang, bukan "diam" tanpa keterangan.
    if (force) {
      try { localStorage.removeItem(LAST_ERROR_KEY) } catch { /* quota */ }
    } else {
      const lastErr = parseInt(localStorage.getItem(LAST_ERROR_KEY) ?? '0', 10)
      if (Date.now() - lastErr < ERROR_COOLDOWN_MS) {
        return { available: false }
      }
    }

    // ── 2a — cek anti-stuck: bila state masih "downloading" atau "ready"
    // tapi bundle tidak utuh / sudah basi, reset ke idle sebelum cek lagi.
    // Ini yang mencegah perangkat "diam" setelah pull kedua (status cor menetap).
    await clearStuckOtaState()

    const result = await fetchManifest(sig)
    if (!result.ok) {
      // Silent fail untuk cek background: catat error tapi JANGAN emit status
      // error (mencegah notifikasi "manifest tidak terjangkau" yang membingungkan).
      // Cek manual (force) BOLEH tegas — user menekan tombol dan berhak tahu.
      if (result.reason === 'not-found') {
        emit({ status: 'idle', latestVersion: local })
        return { available: false }
      }
      console.warn('[ota] cek gagal:', result.reason, force ? '(manual)' : '(silent)')
      localStorage.setItem(LAST_ERROR_KEY, String(Date.now()))
      emit(force
        ? { status: 'error', error: 'Gagal menghubungi server pembaruan', latestVersion: local }
        : { status: 'idle', latestVersion: local })
      return { available: false }
    }
    const remote = result.manifest

    if (!isNewer(remote.version, local)) {
      emit({ status: 'idle', latestVersion: local })
      return { available: false, version: local }
    }

    if (!remote.assets.length) {
      // Manifest kosong - tidak perlu notifikasi
      emit({ status: 'idle', latestVersion: local })
      return { available: false }
    }

    emit({ status: 'downloading', progress: 0, latestVersion: remote.version })
    // FULL PACKAGE UPDATE: purge SEMUA cache & versi lama SEBELUM mengunduh
    // Ini menjamin update kedua dengan struktur chunk sama terdeteksi & diterapkan
    await purgeAllOtaStorage()

    const downloaded: string[] = []
    const total = remote.assets.length

    for (let i = 0; i < total; i++) {
      if (sig.aborted) {
        await purgeAllOtaStorage()
        emit({ status: 'idle', latestVersion: local })
        return { available: false }
      }
      const asset = remote.assets[i]
      try {
        const bytes = await downloadAsset(asset, sig)
        // Verifikasi isi file terhadap manifest — file basi/rusak dibuang,
        // update dibatalkan dengan aman (app tetap pakai bundle bawaan APK).
        if (!(await verifyAsset(bytes, asset, remote.integrity))) {
          console.warn('[ota] integritas aset tidak cocok, batalkan update:', asset)
          await purgeAllOtaStorage()
          localStorage.setItem(LAST_ERROR_KEY, String(Date.now()))
          emit({ status: 'error', error: 'Verifikasi berkas gagal — update dibatalkan', latestVersion: remote.version })
          return { available: false }
        }
        await persistToStorage(remote.version, asset, bytes)
        // Web (tanpa Filesystem) → langsung ke Cache Storage
        if (!isNative()) await putToCache(asset, bytes)
        downloaded.push(asset)
      } catch (err) {
        if (sig.aborted) {
          await purgeAllOtaStorage()
          emit({ status: 'idle', latestVersion: local })
          return { available: false }
        }
        // Silent fail: bundle tidak lengkap → purge total, notifikasi error
        console.warn('[ota] unduhan gagal:', asset)
        await purgeAllOtaStorage()
        localStorage.setItem(LAST_ERROR_KEY, String(Date.now()))
        emit({ status: 'error', error: 'Gagal mengunduh paket pembaruan', latestVersion: local })
        return { available: false }
      }
      emit({
        status: 'downloading',
        progress: Math.round(((i + 1) / total) * 100),
        latestVersion: remote.version,
      })
    }

    // Tandai sah hanya jika SELURUH manifest tersimpan
    try { await writeMarker(remote.version, remote.assets) } catch { /* web */ }

    emit({ status: 'ready', progress: 100, downloaded, latestVersion: remote.version })
    return { available: true, version: remote.version, assets: remote.assets }
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') return { available: false }
    console.warn('[ota] cek gagal total:', err, force ? '(manual)' : '(silent)')
    localStorage.setItem(LAST_ERROR_KEY, String(Date.now()))
    emit(force
      ? { status: 'error', error: 'Gagal menghubungi server pembaruan', latestVersion: local }
      : { status: 'idle', latestVersion: local })
    return { available: false }
  }
}

/**
 * Terapkan bundle terunduh. Returns true bila berhasil → panggil
 * window.location.reload(). Bila gagal → false, aplikasi tetap berjalan
 * normal dengan versi sekarang (tanpa crash / layar kosong).
 */
export async function applyUpdate(): Promise<boolean> {
  try {
    const state = getCachedState()
    const version = state?.latestVersion
    const assets = state?.downloaded
    if (!version || !assets?.length) return false

    const marker = await readMarker(version)
    const list = marker?.assets?.length ? marker.assets : assets

    const ok = await activateBundle(version, list)
    if (!ok) {
      await discardBundle(version)
      saveState({ status: 'error', error: 'bundle tidak lengkap', latestVersion: version })
      return false
    }

    // PENTING: jangan sentuh OTA_CACHE di sini — activateBundle baru saja mengisinya
    // dengan bundle BARU. Menghapusnya justru membuat service worker jatuh ke
    // jaringan (bundle bawaan APK) sehingga update tidak pernah kelihatan.

    // Hapus versi lama dari penyimpanan internal (semua kecuali yang baru).
    await removeOtherVersions(version)

    setCurrentVersion(version)
    await writeMarker(version, list)
    await markBundlePersisted()
    saveState({ status: 'idle', latestVersion: version })
    // Bundle OTA baru diterapkan → minta penarikan roster petugas SEGERA saat
    // aplikasi berikutnya dibuka: penambahan/penonaktifan dari dashboard admin
    // masuk otomatis ke penyimpanan lokal (insert-if-absent — data bawaan aman).
    try { localStorage.setItem(FORCE_ROSTER_SYNC_KEY, '1') } catch { /* quota */ }

    // Diagnostik pasca-apply: cek versi lokal vs remote, status cache.
    // Bukan blocking; hanya log untuk diagnostik "kenapa tidak berubah".
    try {
      const audit = await auditOta()
      console.log(
        '[ota] pasca-apply:',
        'local=', audit.localVersion,
        'remote=', audit.remoteVersion,
        'persisted=', audit.bundlePersisted,
        'cacheEntries=', audit.cacheActiveEntries,
      )
      if (audit.cacheActiveEntries === 0 && audit.hasRemoteManifest) {
        console.warn(
          '[ota] pasca-apply: cache aktif kosong padahal manifiest remote ada —',
          'bundle tidak konsisten; perangkat mungkin perlu reset OTA / reload paksa.',
        )
      }
    } catch { /* diagnostik gagal → tidak fatalkan apply */ }

    return true
  } catch (err) {
    console.warn('[ota] apply gagal:', err)
    return false
  }
}

/** Hapus semua asset & state OTA. Alias ringkas untuk resetOtaStorage(). */
export async function clearCache(): Promise<void> {
  await resetOtaStorage()
}
