import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { FORCE_ROSTER_SYNC_KEY } from './adminPull'
import { isDevMode } from './runtimeEnv'




const MANIFEST_URL = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/version.json'
const ASSETS_BASE = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/ota/'




const OTA_META_CACHE = 'trip-ota-meta'
const VERSION_CACHE_PREFIX = 'trip-ota-v'
const META_ACTIVE_KEY = '__active__.json'
const MARKER_KEY_PREFIX = 'trip.ota.marker.'




function forEachStorageKey(fn: (key: string) => void): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i)
      if (key) fn(key)
    }
  } catch { /* akses localStorage ditolak */ }
}

const OTA_DIR = 'ota'
const LEGACY_OTA_DIR = 'trip-ota'
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
  latestVersion?: string
  activeVersion?: string
}

const STATE_KEY = 'trip.ota.state'
const CURRENT_VER_KEY = 'trip.ota.currentVersion'
const BUNDLED_VERSION = '0.0.0'
const LAST_ERROR_KEY = 'trip.ota.lastError'
const APPLIED_VER_KEY = 'trip.ota.appliedVersion'




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




function isOnline(): boolean {
  try { return navigator.onLine !== false } catch { return true }
}

export const PERSIST_BUNDLE_ACTIVE_KEY = 'trip.ota.persistActive'




export async function markBundlePersisted(): Promise<void> {
  try { localStorage.setItem(PERSIST_BUNDLE_ACTIVE_KEY, '1') } catch { /* quota */ }
}




export async function hasPersistFlag(): Promise<boolean> {
  try { return localStorage.getItem(PERSIST_BUNDLE_ACTIVE_KEY) === '1' } catch { return false }
}




export async function getAppliedVersion(): Promise<string | null> {
  try { return localStorage.getItem(APPLIED_VER_KEY) } catch { return null }
}




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




export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}




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




interface ActiveMeta {
  version: string
  assets: string[]
  savedAt: number
}




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




function assetPath(version: string, path: string): string {
  return `${OTA_DIR}/${version}/${path}`
}




async function persistToStorage(version: string, path: string, bytes: Uint8Array): Promise<void> {
  if (!isNative()) return
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
  const data = JSON.stringify({ version, assets, integrity, savedAt: Date.now() })
  if (!isNative()) {
    try { localStorage.setItem(MARKER_KEY_PREFIX + version, data) } catch { /* quota */ }
    return
  }
  await Filesystem.writeFile({
    path: `${OTA_DIR}/${version}/${MARKER}`,
    data,
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  })
}




async function readMarker(version: string): Promise<VersionManifest | null> {
  if (!version) return null
  if (!isNative()) {
    try {
      const raw = localStorage.getItem(MARKER_KEY_PREFIX + version)
      return raw ? (JSON.parse(raw) as VersionManifest) : null
    } catch { return null }
  }
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
  if (!isNative()) {
    try { localStorage.removeItem(MARKER_KEY_PREFIX + version) } catch { /* quota */ }
    return
  }
  try {
    await Filesystem.rmdir({ path: `${OTA_DIR}/${version}`, directory: Directory.Data, recursive: true })
  } catch { /* tidak ada */ }
}




async function listCaches(): Promise<string[]> {
  try { return typeof caches === 'undefined' ? [] : await caches.keys() } catch { return [] }
}




function isOtaCacheName(name: string): boolean {
  return name.startsWith('trip-ota')
}




async function deleteOtaCaches(keep: Iterable<string> = []): Promise<void> {
  const keepSet = new Set(keep)
  const names = await listCaches()
  await Promise.all(names.map(async n => {
    if (keepSet.has(n)) return
    if (!isOtaCacheName(n)) return
    try { await caches.delete(n) } catch { /* */ }
  }))
}




export async function purgeOtherVersions(keep: string[] = []): Promise<void> {
  await deleteOtaCaches([OTA_META_CACHE, ...keep, ...keep.map(versionCacheName)])

  if (!isNative()) {
    const keepVersions = new Set(keep)
    forEachStorageKey(key => {
      if (!key.startsWith(MARKER_KEY_PREFIX)) return
      if (keepVersions.has(key.slice(MARKER_KEY_PREFIX.length))) return
      localStorage.removeItem(key)
    })
    return
  }

  if (!isNative()) return
  try {
    const { files } = await Filesystem.readdir({ path: OTA_DIR, directory: Directory.Data })
    for (const f of files) {
      if (keep.includes(f.name)) continue
      try {
        await Filesystem.rmdir({ path: `${OTA_DIR}/${f.name}`, directory: Directory.Data, recursive: true })
      } catch { /* */ }
    }
  } catch { /* folder belum ada */ }

  try {
    await Filesystem.rmdir({ path: LEGACY_OTA_DIR, directory: Directory.Cache, recursive: true })
  } catch { /* sudah tidak ada */ }
}




async function clearStuckOtaState(): Promise<void> {
  const state = getCachedState()
  if (!state) return
  const marker = state.status === 'ready' ? await readMarker(state.latestVersion ?? '') : null
  const stuck = state.status === 'downloading' ||
    (state.status === 'ready' && !marker?.assets?.length)
  if (!stuck) return
  const active = (await readActiveMeta())?.version
  const local = await getCurrentVersion()
  const staging = state.latestVersion
  if (staging && staging !== active && staging !== local) {
    await removeVersionStorage(staging)
  }
  saveState({ status: 'idle', latestVersion: state.latestVersion })
}




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
      const response = await CapacitorHttp.request({
        url,
        method: (mergedOptions.method as string) || 'GET',
        headers: mergedOptions.headers as Record<string, string>,
        connectTimeout: 10000,
      })
      const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
      return new Response(body, {
        status: response.status,
        statusText: response.status >= 200 && response.status < 300 ? 'OK' : 'Error',
        headers: new Headers((response.headers ?? {}) as Record<string, string>),
      })
    } catch {
      // jatuh ke fetch biasa
    }
  }

  return fetch(url, mergedOptions)
}




type ManifestResult =
  | { ok: true; manifest: VersionManifest }
  | { ok: false; reason: 'not-found' | 'network' | 'invalid' }




async function fetchManifest(signal: AbortSignal): Promise<ManifestResult> {
  if (isDevMode()) {
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
    if (!data.assets.includes('index.html')) return { ok: false, reason: 'invalid' }
    return { ok: true, manifest: data }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}




export function isNewer(remote: string, local: string): boolean {
  if (!local) return true
  if (!remote) return false
  if (remote === local) return false

  const base = (v: string) => v.split('+')[0]
  const rb = base(remote)
  const lb = base(local)
  const rm = rb.match(/\d+/g)
  const lm = lb.match(/\d+/g)
  if (rm && lm) {
    const max = Math.max(rm.length, lm.length)
    for (let i = 0; i < max; i++) {
      const rn = parseInt(rm[i] ?? '0', 10)
      const ln = parseInt(lm[i] ?? '0', 10)
      if (rn !== ln) return rn > ln
    }
  } else if (rb !== lb) {
    return !rb.startsWith(lb)
  }

  const rt = /\+(\d+)/.exec(remote)?.[1]
  const lt = /\+(\d+)/.exec(local)?.[1]
  if (rt && lt) return parseInt(rt, 10) > parseInt(lt, 10)
  if (rt && !lt) return true
  return false
}




export function semverLabel(version: string): string {
  if (!version) return '—'
  const m = version.match(/^([\d.]+)/)
  return m ? m[1] : version
}




async function fetchBytes(url: string, signal: AbortSignal): Promise<Uint8Array> {
  if (isNative()) {
    try {
      const response = await CapacitorHttp.request({
        url,
        method: 'GET',
        responseType: 'arraybuffer',
        connectTimeout: 15000,
        readTimeout: 30000,
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
      })
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`)
      if (response.status < 200 || response.status >= 300) throw new Error(`HTTP ${response.status} saat unduh`)
      const data = response.data
      if (typeof data === 'string' && data.length) {
        const bytes = fromBase64(data)
        if (bytes.byteLength) return bytes
      }
      throw new Error('data native kosong/tak terduga')
    } catch (err) {
      if (signal.aborted || (err as Error)?.name === 'AbortError') throw err
      console.warn('[OTA] CapacitorHttp gagal — fallback ke fetch WebView:', err)
    }
  }

  const res = await fetch(url, { signal, cache: 'no-store' })
  if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  if (!buf.byteLength) throw new Error('File kosong')
  return new Uint8Array(buf)
}




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
      const bytes = await fetchBytes(url, signal)
      if (!bytes.byteLength) throw new Error(`File kosong: ${path}`)
      return bytes
    } catch (err) {
      if (signal.aborted || (err as Error)?.name === 'AbortError') throw err
      lastErr = err
      if (n < attempts - 1) await sleep(600 * (n + 1))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Gagal unduh ${path}`)
}




async function verifyBytes(
  bytes: Uint8Array,
  path: string,
  integrity?: Record<string, string>,
): Promise<boolean> {
  const expected = integrity?.[path]
  if (!expected) return bytes.byteLength > 0
  const actual = await sha256Hex(bytes)
  if (actual == null) return bytes.byteLength > 0
  return actual.toLowerCase() === expected.toLowerCase()
}




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




async function ensureVersionBundleReady(version: string, assets: string[]): Promise<boolean> {
  const marker = await readMarker(version)
  const integrity = marker?.integrity
  const manifestAssets = marker?.assets?.length ? marker.assets : assets

  for (const path of manifestAssets) {
    let bytes = await readFromVersionCache(version, path)
    if (!bytes) {
      const fromStorage = await readFromStorage(version, path)
      if (!fromStorage) return false
      await stageAsset(version, path, fromStorage)
      bytes = fromStorage
    }
    if (!(await verifyBytes(bytes, path, integrity))) return false
  }
  return true
}




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




export async function activateBundle(version: string, assets: string[]): Promise<boolean> {
  return activateStagedBundle(version, assets)
}




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
      const ok = await ensureVersionBundleReady(local, assets)
      if (!ok) return false
    }
    if ((await cache.keys()).length < assets.length) return false
    if (meta?.version !== local) await writeActiveMeta(local, assets)
    return true
  } catch { return false }
}




export async function resetOtaStorage(): Promise<void> {
  await deleteOtaCaches()
  forEachStorageKey(key => {
    if (key.startsWith(MARKER_KEY_PREFIX)) localStorage.removeItem(key)
  })

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

  if (isDevMode()) {
    console.log('[OTA] DEV MODE: Skip audit fetch dari GitHub (menghindari CORS)')
  } else {
    try {
      const ac = new AbortController()
      const timeout = setTimeout(() => ac.abort(), 4000)
      let res: Response
      try {
        res = await nativeFetch(`${MANIFEST_URL}?t=${Date.now()}`, { cache: 'no-store', signal: ac.signal })
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
  }

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




export interface CheckResult {
  available: boolean
  version?: string
  assets?: string[]
}

let controller: AbortController | undefined




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

    const staged = getCachedState()
    const stagedMarker = staged?.status === 'ready' && staged.latestVersion === remote.version
      ? await readMarker(remote.version)
      : null
    if (stagedMarker?.assets?.length === remote.assets.length) {
      console.log(`[OTA] ${remote.version} sudah terunduh & terverifikasi — menunggu aksi pengguna`)
      emit({
        status: 'ready',
        progress: 100,
        latestVersion: remote.version,
        activeVersion: local,
      })
      return { available: true, version: remote.version, assets: remote.assets }
    }

    console.log(`[OTA] Update tersedia: ${local} → ${remote.version} (${remote.assets.length} berkas)`)
    emit({ status: 'downloading', progress: 0, latestVersion: remote.version, activeVersion: local })

    const activeBefore = (await readActiveMeta())?.version
    await purgeOtherVersions([remote.version, ...(activeBefore ? [activeBefore] : [])])
    await removeVersionStorage(remote.version)

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

    try { await writeMarker(remote.version, remote.assets, remote.integrity) } catch { /* web */ }

    emit({
      status: 'ready',
      progress: 100,
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




export async function applyUpdate(): Promise<boolean> {
  try {
    const version = getCachedState()?.latestVersion
    if (!version) return false

    const list = (await readMarker(version))?.assets
    if (!list?.length) return false

    const ok = await activateStagedBundle(version, list)
    if (!ok) {
      await removeVersionStorage(version)
      saveState({ status: 'error', error: 'Bundle tidak lengkap setelah unduh', latestVersion: version })
      return false
    }

    saveState({ status: 'idle', latestVersion: version, activeVersion: version })

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
