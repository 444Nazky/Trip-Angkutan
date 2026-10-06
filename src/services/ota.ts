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

const MANIFEST_URL = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/version.json'
const ASSETS_BASE = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/'

/** Cache Storage yang dibaca service worker (src/sw.js). */
export const OTA_CACHE = 'trip-ota-active'
const CACHE_PREFIX = 'trip-ota-'
/** Folder penyimpanan internal bundle (Capacitor Filesystem, direktori Cache). */
const OTA_DIR = 'trip-ota'
const MARKER = '.complete.json'
const FETCH_TIMEOUT_MS = 20_000

export interface VersionManifest {
  version: string
  assets: string[]
  minAppVersion?: string
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

async function fetchManifest(signal: AbortSignal): Promise<VersionManifest | null> {
  try {
    const res = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
      signal,
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data || typeof data.version !== 'string' || !Array.isArray(data.assets)) return null
    return data as VersionManifest
  } catch { return null }
}

// Bandingkan versi semver ATAU commit-hash. Returns true bila remote lebih baru.
export function isNewer(remote: string, local: string): boolean {
  if (!local) return true
  if (remote === local) return false
  const rm = remote.match(/\d+/g)
  const lm = local.match(/\d+/g)
  if (rm && lm) {
    const max = Math.max(rm.length, lm.length)
    for (let i = 0; i < max; i++) {
      const rn = parseInt(rm[i] ?? '0', 10)
      const ln = parseInt(lm[i] ?? '0', 10)
      if (rn !== ln) return rn > ln
    }
    // Semua angka sama (mis. "1.0" vs "1.0.0") → versi dianggap sama
    return remote.length > local.length
  }
  // Gaya commit-hash: remote lebih baru bila bukan prefiks local
  return !remote.startsWith(local)
}

/** Unduh satu file bundle. */
async function downloadAsset(path: string, signal: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(ASSETS_BASE + path, { signal, cache: 'no-store' })
  if (!res.ok) throw new Error(`HTTP ${res.status} saat unduh ${path}`)
  const buf = await res.arrayBuffer()
  if (!buf || buf.byteLength === 0) throw new Error(`File kosong: ${path}`)
  return new Uint8Array(buf)
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
    const cache = await caches.open(OTA_CACHE)
    const keys = await cache.keys()
    await Promise.all(keys.map(k => cache.delete(k)))
  } catch { /* cache tidak tersedia */ }
  if (version) await removeStorage(version)
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
      const existing = await cache.match(urlOf(path))
      if (existing) continue
      const bytes = await readFromStorage(version, path)
      if (!bytes) return false // sumber hilang → bundle tidak utuh
      await putToCache(path, bytes)
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
 */
export function registerOtaServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  if (location.protocol === 'file:') return
  navigator.serviceWorker.register('sw.js', { scope: '/' }).catch(err => {
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
 * Cek update. Membatalkan request sebelumnya bila ada. Aman dipanggil berkali
 * kali (polling) — tidak pernah melempar exception.
 */
export async function checkForUpdate(
  currentVersion: string | undefined | null,
  onState?: (s: UpdateState) => void,
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

    emit({ status: 'checking', latestVersion: local })

    const remote = await fetchManifest(sig)
    if (!remote) {
      // Manifest tidak terjangkau → bukan masalah fatal, coba lagi nanti
      emit({ status: 'error', error: 'manifest tidak terjangkau', latestVersion: local })
      return { available: false }
    }

    if (!isNewer(remote.version, local)) {
      emit({ status: 'idle', latestVersion: local })
      return { available: false, version: local }
    }

    if (!remote.assets.length) {
      emit({ status: 'error', error: 'manifest kosong', latestVersion: local })
      return { available: false }
    }

    emit({ status: 'downloading', progress: 0, latestVersion: remote.version })
    // Buang unduhan parsial versi ini. Bundle AKTIF tidak disentuh sampai
    // aktivasi, supaya app yang sedang berjalan tetap utuh.
    await removeStorage(remote.version)

    const downloaded: string[] = []
    const total = remote.assets.length

    for (let i = 0; i < total; i++) {
      if (sig.aborted) {
        await removeStorage(remote.version)
        emit({ status: 'idle', latestVersion: local })
        return { available: false }
      }
      const asset = remote.assets[i]
      try {
        const bytes = await downloadAsset(asset, sig)
        await persistToStorage(remote.version, asset, bytes)
        // Web (tanpa Filesystem) → langsung ke Cache Storage
        if (!isNative()) await putToCache(asset, bytes)
        downloaded.push(asset)
      } catch (err) {
        if (sig.aborted) {
          await removeStorage(remote.version)
          emit({ status: 'idle', latestVersion: local })
          return { available: false }
        }
        console.warn('[ota] unduhan gagal:', asset, err)
        // Bundle tidak utuh → buang unduhan parsial (aktif tetap dipakai)
        await removeStorage(remote.version)
        emit({
          status: 'error',
          error: `unduh terputus (${downloaded.length}/${total})`,
          latestVersion: local,
        })
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
    emit({ status: 'error', error: String(err), latestVersion: local })
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

    setCurrentVersion(version)
    saveState({ status: 'idle', latestVersion: version })
    return true
  } catch (err) {
    console.warn('[ota] apply gagal:', err)
    return false
  }
}

/** Hapus semua asset & state OTA. */
export async function clearCache(): Promise<void> {
  try {
    const version = getCachedState()?.latestVersion
    await discardBundle(version)
    if (isNative()) {
      try { await Filesystem.rmdir({ path: OTA_DIR, directory: Directory.Cache, recursive: true }) } catch { /* */ }
    }
  } catch { /* */ }
  try {
    localStorage.removeItem(STATE_KEY)
    localStorage.removeItem(CURRENT_VER_KEY)
  } catch { /* quota */ }
}
