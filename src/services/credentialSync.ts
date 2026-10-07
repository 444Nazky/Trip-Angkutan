// ─────────────────────────────────────────────────────────────────────────────
// CREDENTIAL SYNC SERVICE — Sinkronisasi Kredensial dari Web Admin Dashboard
//
// Fungsi:
//   • Menarik data username & password petugas dari endpoint admin dashboard
//   • Menyimpan kredensial ke SQLite (native) / localStorage (web/browser)
//   • Auto-sync saat koneksi internet terdeteksi
//   • Mendukung offline-first — petugas tetap bisa login offline
//
// Endpoint admin: GET /auth/admin/officers-credentials
// Payload: { officers: Array<{ id, username, password_hash, name, region_id, status }> }
//
// Pipeline keamanan:
//   1. Password tidak pernah disimpan plaintext di storage
//   2. Hash bcrypt dari server disimpan langsung (untuk verifikasi PIN/password)
//   3. Fallback: SHA-256/FNV-1a untuk PIN hasil hash lokal
//─────────────────────────────────────────────────────────────────────────────

import { api, getApiBaseUrl as readApiBaseUrl } from './api'
import { ensureAdminBackendSession } from './auth'
import {
  initOfflineDb,
  type OfficerRow,
  setPinHash,
  saveOfficers,
} from './offlineDb'
import { probeServer } from './sync'

// ── Tipe Data ────────────────────────────────────────────────────────────────

/** Payload kredensial dari admin dashboard */
export interface AdminCredential {
  id: string | number
  username: string
  /** Hash bcrypt password dari admin (disimpan langsung) */
  password_hash?: string
  name: string
  region_id?: string
  region_name?: string
  region_code?: string
  status?: 'active' | 'inactive' | 'Aktif' | 'Nonaktif'
  /** Hash bcrypt PIN (jika admin set PIN khusus) */
  pin_hash?: string
}

/** Response dari endpoint admin */
interface CredentialsResponse {
  officers: AdminCredential[]
  synced_at?: number
  version?: string
}

// ── Konfigurasi ────────────────────────────────────────────────────────────

/** Interval polling sinkronisasi kredensial (30 detik) */
const CREDENTIAL_SYNC_INTERVAL_MS = 30_000

/** Cache TTL sebelum fetch ulang (5 menit) */
const CACHE_TTL_MS = 5 * 60 * 1000

/** Kunci storage cache terakhir sync */
const LAST_SYNC_KEY = 'trip.credentials.last_sync'

/** Kunci storage versi data */
const VERSION_KEY = 'trip.credentials.version'

// ── State ────────────────────────────────────────────────────────────────

let _syncListeners: Array<(count: number) => void> = []
let _lastSyncAt = 0
let _syncing = false
let _syncTimer: ReturnType<typeof setInterval> | null = null
let _offlineQueue: string[] = [] // username yang perlu di-sync saat online

// ── Helper Storage ─────────────────────────────────────────────────────────

function getLastSyncTime(): number {
  try {
    return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0
  } catch { return 0 }
}

function setLastSyncTime(ts: number): void {
  try { localStorage.setItem(LAST_SYNC_KEY, String(ts)) } catch { /* quota */ }
}

function getStoredVersion(): string | null {
  try { return localStorage.getItem(VERSION_KEY) } catch { return null }
}

function setStoredVersion(v: string): void {
  try { localStorage.setItem(VERSION_KEY, v) } catch { /* quota */ }
}

// ── Public API ────────────────────────────────────────────────────────────

/** Listener untuk notifikasi perubahan kredensial */
export function onCredentialsSync(cb: (count: number) => void): () => void {
  _syncListeners.push(cb)
  return () => { _syncListeners = _syncListeners.filter(x => x !== cb) }
}

function notifySyncListeners(count: number): void {
  for (const l of _syncListeners) { try { l(count) } catch { /* ignore */ } }
}

/** Apakah credential sync sedang berjalan */
export function isCredentialSyncing(): boolean {
  return _syncing
}

/** Timestamp sync terakhir (epoch ms) */
export function getLastCredentialsSync(): number {
  return _lastSyncAt
}

/** Inisialisasi service — idempoten */
export async function initCredentialSync(): Promise<void> {
  await initOfflineDb()
  _lastSyncAt = getLastSyncTime()

  // Langsung sync sekali saat init (kalau online)
  void syncCredentialsFromAdmin(true).catch(() => { /* offline — nanti pas koneksi pulih */ })
}

// ── Core Sync Logic ───────────────────────────────────────────────────────

/**
 * Sinkronisasi kredensial dari admin dashboard.
 *
 * @param force — true = abaikan cache TTL
 */
export async function syncCredentialsFromAdmin(force = false): Promise<{
  synced: number
  failed: number
  online: boolean
  error?: string
}> {
  // Cek konektivitas
  const online = await probeServer()
  if (!online) {
    return { synced: 0, failed: 0, online: false, error: 'Server tidak terjangkau' }
  }

  // Throttle: skip kalau belum lewat TTL (kecuali force)
  if (!force) {
    const elapsed = Date.now() - _lastSyncAt
    if (elapsed < CACHE_TTL_MS) {
      return { synced: 0, failed: 0, online: true }
    }
  }

  _syncing = true
  notifySyncListeners(0) // trigger loading indicator

  try {
    // Pastikan sesi admin valid
    const sessionOk = await ensureAdminBackendSession()
    if (!sessionOk) {
      return { synced: 0, failed: 0, online: true, error: 'Sesi admin tidak valid' }
    }

    // Fetch kredensial dari dashboard admin
    const result = await api.get<CredentialsResponse>('/auth/admin/officers-credentials')

    if (!result.ok || !result.data?.officers) {
      const errMsg = result.error?.message ?? 'Gagal mengambil data kredensial'
      return { synced: 0, failed: 0, online: true, error: errMsg }
    }

    const officers = result.data.officers
    let synced = 0
    let failed = 0

    // Proses setiap petugas
    for (const officer of officers) {
      try {
        await persistCredential(officer)
        synced++
      } catch (e) {
        failed++
        console.warn('[credential-sync] Gagal sinkronkan petugas:', officer.username, e)
      }
    }

    // Update metadata sync
    _lastSyncAt = Date.now()
    setLastSyncTime(_lastSyncAt)
    if (result.data.version) setStoredVersion(result.data.version)
    if (result.data.synced_at) setLastSyncTime(result.data.synced_at)

    // Trigger sync petugas ke DB offline
    void syncOfficersToLocal(officers)

    return { synced, failed, online: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error sinkronisasi kredensial'
    return { synced: 0, failed: 0, online: true, error: msg }
  } finally {
    _syncing = false
    notifySyncListeners(0)
  }
}

/**
 * Simpan kredensial SATU petugas ke storage lokal.
 * Tidak pernah menyimpan password plaintext.
 */
async function persistCredential(officer: AdminCredential): Promise<void> {
  const id = String(officer.id)

  // 1. Password hash dari admin → langsung simpan (bcrypt)
  if (officer.password_hash) {
    // Gunakan username sebagai key agar lookup by username bisa dilakukan
    await setPinHash(`pw:${id}`, officer.password_hash)
    // Key tambahan by username untuk lookup cepat
    const usernameKey = `pw:u:${officer.username?.toLowerCase()}`
    await setPinHash(usernameKey, officer.password_hash)
  }

  // 2. PIN hash dari admin (kalau ada)
  if (officer.pin_hash) {
    await setPinHash(`pin:${id}`, officer.pin_hash)
    const usernameKey = `pin:u:${officer.username?.toLowerCase()}`
    await setPinHash(usernameKey, officer.pin_hash)
  }

  // 3. Simpan data officer dasar ke DB offline untuk roster
  const isActive = /active|aktif/i.test(String(officer.status ?? ''))
  const row: OfficerRow = {
    id,
    username: officer.username,
    name: officer.name,
    regionId: officer.region_id,
    regionName: officer.region_name,
    regionCode: officer.region_code,
    isActive,
    payload: {
      ...officer,
      password_hash: officer.password_hash ? '[HIDDEN]' : undefined,
      pin_hash: officer.pin_hash ? '[HIDDEN]' : undefined,
      synced_at: Date.now(),
    },
  }
  await saveOfficers([row])
}

/**
 * Sync data petugas ke storage offline (panggil persistOfficers dari officers.ts).
 */
async function syncOfficersToLocal(officers: AdminCredential[]): Promise<void> {
  // Konversi format admin ke format mobile
  const mobileOfficers = officers.map(o => ({
    id: String(o.id),
    username: o.username,
    name: o.name,
    regionId: o.region_id,
    regionName: o.region_name,
    regionCode: o.region_code,
    isActive: /active|aktif/i.test(String(o.status ?? 'active')),
    payload: {
      ...o,
      // Jangan expose hash ke UI
      password_hash: undefined,
      pin_hash: undefined,
      synced_at: Date.now(),
    },
  }))

  await saveOfficers(mobileOfficers.map(o => ({
    ...o,
    payload: { ...o.payload, password_hash: undefined, pin_hash: undefined },
  })))
}

// ── Verifikasi Kredensial Offline ───────────────────────────────────────────

import bcrypt from 'bcryptjs'
import { hashPin } from './offlineDb'

/**
 * Verifikasi password petugas terhadap hash tersimpan.
 * Bisa dilakukan offline (tanpa server).
 */
export async function verifyPassword(
  identifier: string,
  password: string,
): Promise<boolean> {
  const key = identifier.includes('@') || identifier.includes(':')
    ? `pw:u:${identifier.toLowerCase()}`
    : `pw:${identifier}`

  const storedHash = await getStoredHash(key)
  if (!storedHash) return false

  // bcrypt dari admin
  if (storedHash.startsWith('$2')) {
    try { return bcrypt.compareSync(password, storedHash) } catch { return false }
  }

  // SHA-256 / FNV-1a fallback
  const computed = await hashPin(key, password)
  return storedHash === computed
}

/**
 * Verifikasi PIN petugas terhadap hash tersimpan.
 */
export async function verifyOfficerPin(
  identifier: string,
  pin: string,
): Promise<boolean> {
  const key = identifier.includes('@') || identifier.includes(':')
    ? `pin:u:${identifier.toLowerCase()}`
    : `pin:${identifier}`

  const storedHash = await getStoredHash(key)
  if (!storedHash) return false

  if (storedHash.startsWith('$2')) {
    try { return bcrypt.compareSync(pin, storedHash) } catch { return false }
  }

  const computed = await hashPin(key, pin)
  return storedHash === computed
}

/** Ambil hash tersimpan untuk key tertentu */
async function getStoredHash(key: string): Promise<string | null> {
  // Import dinamis untuk hindari circular dep
  const { getPinHash } = await import('./offlineDb')
  return getPinHash(key)
}

// ── Auto-Sync saat Koneksi Tersambung ───────────────────────────────────

/**
 * Start auto-sync credential saat app mount.
 * Memanggil syncCredentialsFromAdmin() secara berkala dan saat koneksi pulih.
 */
export function startCredentialAutoSync(): void {
  if (_syncTimer) return // sudah jalan

  // 1. Sync berkala (30 detik) sebagai safety net
  _syncTimer = setInterval(() => {
    const elapsed = Date.now() - _lastSyncAt
    if (elapsed >= CACHE_TTL_MS) {
      void syncCredentialsFromAdmin(false)
    }
  }, CREDENTIAL_SYNC_INTERVAL_MS)

  // 2. Sync SEGERA saat koneksi pulih
  window.addEventListener('online', () => {
    void syncCredentialsFromAdmin(true)
  })
}

/** Stop auto-sync (saat logout/cleanup) */
export function stopCredentialAutoSync(): void {
  if (_syncTimer) {
    clearInterval(_syncTimer)
    _syncTimer = null
  }
}

/**
 * Force sync sekarang (dipanggil manual dari Settings atau trigger user).
 */
export async function syncNow(): Promise<{ synced: number; failed: number; online: boolean; error?: string }> {
  return syncCredentialsFromAdmin(true)
}

// ── Utility ───────────────────────────────────────────────────────────────

/** Cek apakah ada credential tersimpan untuk identifier */
export async function hasStoredCredentials(identifier: string): Promise<boolean> {
  const idKey = `pw:${identifier}`
  const usernameKey = `pw:u:${identifier.toLowerCase()}`
  const { getPinHash } = await import('./offlineDb')
  return !!(await getPinHash(idKey) || await getPinHash(usernameKey))
}

/** Hapus credential untuk satu petugas (mis. saat dinonaktifkan) */
export async function removeCredential(officerId: string): Promise<void> {
  const { setPinHash } = await import('./offlineDb')
  // Set null/tidak ada operasi hapus di API offlineDb
  // Hash tetap tersimpan tapi tidak dipakai lagi
  // Future: bisa tambahkan deletePinHash() di offlineDb.ts
  console.info('[credential-sync] Credential remove tidak implemented (hash retained)')
}

// ── Export untuk Settings Screen ─────────────────────────────────────────

export interface SyncStatus {
  lastSync: number
  isSyncing: boolean
  hasCachedCredentials: boolean
}

export function getSyncStatus(): SyncStatus {
  return {
    lastSync: _lastSyncAt,
    isSyncing: _syncing,
    hasCachedCredentials: _lastSyncAt > 0,
  }
}

/** Alias: mulai auto-sync saat app mount */
export { startCredentialAutoSync as startCredentialSync }
