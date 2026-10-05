// OTA Auto-Update Service — fetch manifest GitHub, download assets, apply senyap.

import { Network } from '@capacitor/network'

const MANIFEST_URL = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/version.json'
const ASSETS_BASE   = 'https://raw.githubusercontent.com/444Nazky/Aplikasi-Trip-Ionic/mobile/'

export interface VersionManifest { version: string; assets: string[]; minAppVersion?: string }

export interface UpdateState {
  status: 'idle' | 'checking' | 'downloading' | 'ready' | 'error' | 'offline'
  progress?: number
  error?: string
  downloaded?: string[]
  latestVersion?: string
}

const STATE_KEY = 'trip.ota.state'
const CURRENT_VER_KEY = 'trip.ota.currentVersion'

export async function getCurrentVersion(): Promise<string | null> {
  try { return localStorage.getItem(CURRENT_VER_KEY) } catch { return null }
}

export function setCurrentVersion(v: string): void {
  try { localStorage.setItem(CURRENT_VER_KEY, v) } catch { /* quota */}
}

export function getCachedState(): UpdateState | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function saveState(s: UpdateState): void {
  try { localStorage.setItem(STATE_KEY, JSON.stringify(s)) } catch { /* quota */}
}

async function isOnline(): Promise<boolean> {
  try {
    const { connected } = await Network.getState()
    return connected
  } catch { return navigator.onLine }
}

async function fetchManifest(url: string, signal: AbortSignal): Promise<VersionManifest | null> {
  try {
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    return res.json()
  } catch { return null }
}

// Bandingkan versi semver atau commit-hash. Returns true jika remote > local.
export function isNewer(remote: string, local: string): boolean {
  if (!local) return true
  const rm = remote.match(/\d+/g)
  const lm = local.match(/\d+/g)
  if (rm && lm) {
    const max = Math.max(rm.length, lm.length)
    for (let i = 0; i < max; i++) {
      const rn = parseInt(rm[i] ?? '0', 10)
      const ln = parseInt(lm[i] ?? '0', 10)
      if (rn !== ln) return rn > ln
    }
    return false
  }
  // commit-hash style
  return !remote.startsWith(local)
}

// Download satu file. AbortSignal untuk cancel.
async function downloadAsset(
  path: string,
  signal: AbortSignal,
  onProgress?: (p: number) => void,
): Promise<{ path: string; data: ArrayBuffer }> {
  const res = await fetch(ASSETS_BASE + path, { signal })
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${path}`)
  const cl = parseInt(res.headers.get('content-length') ?? '0') || 0
  const reader = res.body!.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        received += value.length
        if (cl && onProgress) onProgress(Math.round((received / cl) * 100)
      }
    }
  } catch { /* connection reset mid-stream, treat as partial */}
  const buf = new Uint8Array(received)
  let offset = 0
  for (const c of chunks) { buf.set(c, offset); offset += c.length }
  return { path, data: buf.buffer }
}

// Simpan asset ke localStorage. AbortSignal untuk cancel.
const FS_PREFIX   = 'trip.ota.asset.'
const FS_MANIFEST = 'trip.ota.assetManifest'

function writeAsset(path: string, data: ArrayBuffer): void {
  try {
    const bytes = new Uint8Array(data)
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    localStorage.setItem(FS_PREFIX + path, btoa(bin))
    // update index
    let idx: Record<string, string> = {}
    try { idx = JSON.parse(localStorage.getItem(FS_MANIFEST) ?? '{}') } catch { /* */}
    idx[path] = path
    localStorage.setItem(FS_MANIFEST, JSON.stringify(idx))
  } catch { /* quota */}
}

export function getAssetIndex(): string[] {
  try { return Object.keys(JSON.parse(localStorage.getItem(FS_MANIFEST) ?? '{}')) }
  catch { return [] }
}

// Bersihkan asset individual.
function removeAsset(path: string): void {
  localStorage.removeItem(FS_PREFIX + path)
}

// ─── Orchestrator utama ──────────────────────────────────────────────────────────

export interface CheckResult { available: boolean; version?: string; assets?: string[] }

let controller: AbortController | undefined

/** Cek update. Aborts request sebelumnya. State 'downloading' boleh di-trigger ulang saat app aktif kembali. */
export async function checkForUpdate(
  currentVersion: string | undefined,
  onState?: (s: UpdateState) => void,
): Promise<CheckResult> {
  if (!currentVersion) return { available: false }

  controller?.abort()
  controller = new AbortController()
  const sig = controller.signal

  const online = await isOnline()
  if (!online) {
    const cached = getCachedState()
    const s: UpdateState = { status: 'offline', latestVersion: cached?.latestVersion }
    saveState(s); onState?.(s)
    return { available: false, version: cached?.latestVersion }
  }

  const chk: UpdateState = { status: 'checking' }
  saveState(chk); onState?.(chk)

  try {
    const remote = await fetchManifest(MANIFEST_URL, sig)
    if (!remote) {
      const e: UpdateState = { status: 'error', error: 'manifest-unavailable', latestVersion: currentVersion }
      saveState(e); onState?.(e)
      return { available: false }
    }

    if (!isNewer(remote.version, currentVersion)) {
      const idle: UpdateState = { status: 'idle', latestVersion: currentVersion }
      saveState(idle); onState?.(idle)
      return { available: false, version: currentVersion }
    }

    const downloaded: string[] = []
    const total = remote.assets.length

    for (let i = 0; i < total; i++) {
      if (sig.aborted) break
      const asset = remote.assets[i]
      try {
        const { data } = await downloadAsset(asset, sig, (p) => {
          const prog = Math.round((i / total * 100) + p / total)
          const ps: UpdateState = { status: 'downloading', latestVersion: remote.version, progress: prog }
          saveState(ps); onState?.(ps)
        })
        writeAsset(asset, data)
        downloaded.push(asset)
      } catch {
        // Asset gagal → lanjut ke berikutnya; state terakhir 'downloading' agar HUD tampil
        const fail: UpdateState = { status: 'downloading', latestVersion: remote.version }
        saveState(fail); onState?.(fail)
      }
    }

    const ready: UpdateState = { status: 'ready', downloaded, latestVersion: remote.version }
    saveState(ready); onState?.(ready)
    return { available: true, version: remote.version, assets: remote.assets }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return { available: false }
    const fail: UpdateState = { status: 'error', error: String(err), latestVersion: currentVersion }
    saveState(fail); onState?.(fail)
    return { available: false }
  }
}

/** Panggil saat user menekan "Terapkan". Simpan versi & bersihkan state download agar polling berikutnya tidak mendeteksi ulang. */
export function applyUpdate(): boolean {
  const state = getCachedState()
  if (!state?.latestVersion) return false
  setCurrentVersion(state.latestVersion)
  const idle: UpdateState = { status: 'idle', latestVersion: state.latestVersion }
  saveState(idle)
  return true
}

/** Hapus semua asset & state. Panggil saat logout atau reset app. */
export function clearCache(): void {
  for (const k of getAssetIndex()) localStorage.removeItem(FS_PREFIX + k)
  localStorage.removeItem(FS_MANIFEST)
  localStorage.removeItem(STATE_KEY)
  localStorage.removeItem(CURRENT_VER_KEY)
}
