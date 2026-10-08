// ─────────────────────────────────────────────────────────────────────────────
// SYNC SERVICE — Offline-First Trip Upload (arsitektur v4)
//
// Prinsip yang DIJAGA KETAT:
//   1. PERSISTENSI → antran disimpan IndexedDB, TIDAK PERNAH dihapus saat app ditutup/restart.
//   2. KONFIRMASI SERVER → SATU-SATUNYA alasan item keluar adalah HTTP 200 ATAU HTTP 201 DARI SERVER.
//      Jika koneksi timeout, error jaringan, response 4xx/5xx, atau request gagal:
//      → Item TETAP di antran dengan attempt count yang di-increment.
//   3. ANTI-STUCK → watchdog timer + exponential backoff.
//   4. IDEMPOTENSI → trip dengan ID sama tidak akan duplikat di antran.
//   5. AUTO-RETRY → koneksi pulih → probeServer() → proses antran.
//   6. SYNC DUA ARAH → pull master data terbaru + upload antran lokal.
//────────────────────────────────────────────────────────────────────────────

import { Geolocation } from '@capacitor/geolocation'
import { getApiBaseUrl } from './api'
import { renewSessionIfNeeded, ensureBackendSession } from './auth'
import { dbAll, dbCount, dbDelete, dbGet, dbPut, initOfflineDb } from './offline-db'

// ── Config ──────────────────────────────────────────────────────────────
const BASE_BACKOFF_MS = 15_000       // backoff dasar 15 detik, x2 per percobaan
const MAX_BACKOFF_MS = 600_000       // maksimal 10 menit (antrean tak pernah dibuang)
const FAST_RETRY_NETWORK_MS = 2_000  // retry cepat utk error jaringan (< 2 detik)
const POLL_INTERVAL_MS = 20_000      // polling latar sebagai jaring pengaman
const LOCK_TIMEOUT_MS = 120_000     // watchdog: paksa lepas kunci setelah 2 menit
const ITEM_TIMEOUT_MS = 90_000      // batas waktu per item agar loop tak menggantung
const PING_TTL_MS = 2_500          // hasil ping dipakai ulang 2.5 detik
const PING_TIMEOUT_MS = 5_000       // batas waktu ping kesehatan server
const ONLINE_RETRY_ATTEMPTS = 3     // percobaan ping saat event 'online' masuk
const ONLINE_RETRY_DELAY_MS = 700   // jeda antar percobaan event 'online'
const GEO_TIMEOUT_MS = 8_000        // batas waktu ambil lokasi saat membangun payload

// ── Types ────────────────────────────────────────────────────────────
export interface PhotoEntry {
  dataUrl: string
  mimeType: string
}

export interface SyncQueueItem {
  syncId: string
  tripId: string
  payload: TripPayload
  attempts: number
  lastError?: string
  lastErrorCode?: string
  needsAttention?: boolean
  createdAt: number
  lastAttemptAt?: number
  photos: PhotoEntry[]
  tripPhoto?: PhotoEntry
}

export interface TripPayload {
  id: string
  route: string
  routeCode?: string
  routeFrom?: string
  routeTo?: string
  load: 'Ada Muatan' | 'Kosong'
  vehicle: string
  type: string
  category: string
  revenue: string
  revenueNum: number
  officer: string
  duration: string
  photo: boolean
  photoUrl?: string
  photoCapturedAt?: string
  photoLatitude?: number
  photoLongitude?: string
  vehicles?: VehiclePayload[]
  selfieUrl?: string
  selfieCapturedAt?: string
  startedAt?: string
  completedAt?: string
}

export interface VehiclePayload {
  plate: string
  type: string
  category: string
  tariff: number
  photo?: string
  photoCapturedAt?: string
  photoLatitude?: number
  photoLongitude?: number
}

export interface SyncResult {
  syncId: string
  success: boolean
  error?: string
  code?: string
  permanent?: boolean
}

// ── State ───────────────────────────────────────────────────────────
let queueListeners: Array<(n: number) => void> = []
let _pendingCount = 0
let _lastError: string | null = null
let _pingOk = false
let _pingAt = 0
let _syncing = false
let _lockDeadline = 0
let _retryTimer: ReturnType<typeof setTimeout> | null = null
let _initialized = false

// ── Helpers ────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)) }

function isNetworkError(err?: string) {
  return !!err && /timeout|network|failed.to.fetch|terjangkau|offline|ECONNREFUSED/i.test(err)
}

function backoffMs(attempts: number) {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts - 1), MAX_BACKOFF_MS)
}

// ── Queue Operations ─────────────────────────────────────────────────

export async function addToSyncQueue(item: SyncQueueItem): Promise<void> {
  await initOfflineDb()

  // Cek duplikat sebelum tambah
  const existing = await dbGet<SyncQueueItem>('trips', item.syncId)
  if (existing) {
    console.log(`[Sync] Item ${item.syncId} sudah ada di antran, update saja`)
    await dbPut('trips', item.syncId, {
      ...item,
      attempts: existing.attempts ?? 0,
      lastError: existing.lastError,
      lastErrorCode: existing.lastErrorCode,
      needsAttention: existing.needsAttention,
      createdAt: existing.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    })
  } else {
    await dbPut('trips', item.syncId, {
      ...item,
      synced: false,
      createdAt: item.createdAt || Date.now(),
      updatedAt: Date.now(),
    })
  }

  notifyListeners()
  // Trigger proses sync SEGERA jika server terjangkau
  window.setTimeout(() => processQueue({ force: true }), 150)
}

export async function removeSyncItem(syncId: string) {
  await dbDelete('trips', syncId)
  _pendingCount = await dbCount('trips')
  notifyListeners()
}

export function getPendingCount() { return _pendingCount }

export function onQueueChange(cb: (n: number) => void) {
  queueListeners.push(cb)
  dbCount('trips').then(n => { _pendingCount = n; cb(n) })
  return () => { queueListeners = queueListeners.filter(l => l !== cb) }
}

function notifyListeners() {
  dbCount('trips').then(n => {
    _pendingCount = n
    for (const l of queueListeners) { try { l(n) } catch { /* ignore */ } }
  }).catch(() => { /* ignore */ })
}

export async function probeServer(force = false): Promise<boolean> {
  if (!_initialized) return navigator.onLine
  const now = Date.now()
  if (!force && now - _pingAt < PING_TTL_MS) return _pingOk
  const base = getApiBaseUrl()
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS)
    const res = await fetch(`${base}/health`, {
      cache: 'no-store',
      signal: controller.signal,
    })
    clearTimeout(timer)
    _pingOk = res.ok
    _pingAt = now
    return res.ok
  } catch {
    _pingOk = false
    _pingAt = now
    return false
  }
}

// ── Queue Processing ─────────────────────────────────────────────────

/**
 * Proses SATU item dari antran.
 *
 * ATURAN KRUSIAL ANTI-QUEUE LOCK:
 * - Item HANYA dihapus dari antran JIKA server mengembalikan HTTP 200 ATAU HTTP 201.
 * - Jika koneksi timeout, error jaringan, response 4xx/5xx, atau request gagal:
 *   → Item TETAP di antran dengan attempt count yang di-increment + backoff.
 * - Tidak ada scenario lain yang menghapus item dari antran.
 *
 * @param item Item di antran.
 * @param retryAll Jika true, lewati cek backoff & proses semua item.
 */
async function processItem(item: SyncQueueItem, retryAll = false): Promise<void> {
  const { syncId } = item

  // ── Backoff check ───────────────────────────────────────
  const lastAttempt = item.lastAttemptAt ?? 0
  const elapsed = Date.now() - lastAttempt
  const backoffTime = backoffMs(item.attempts)

  // Skip jika belum waktunya retry (kecuali retryAll dipaksa)
  if (!retryAll && item.attempts > 0 && elapsed < backoffTime && !isNetworkError(item.lastError)) {
    console.log(`[Sync] Item ${syncId} belum waktunya retry (elapsed: ${elapsed}ms < backoff: ${backoffTime}ms)`)
    return
  }

  // ── Verifikasi koneksi server TERLEBIH DAHULU ─────────────────
  const serverOk = await probeServer(true)
  if (!serverOk) {
    console.warn('[Sync] Server tidak terjangkau, jadwalkan retry...')
    scheduleRetry(backoffTime || POLL_INTERVAL_MS)
    return
  }

  // ── Verifikasi sesi autentikasi ─────────────────────────────
  const sessionOk = await ensureBackendSession()
  if (!sessionOk) {
    console.warn('[Sync] Sesi berakhir, jadwalkan retry...')
    scheduleRetry(MAX_BACKOFF_MS)
    return
  }

  // ── Kirim ke server dengan timeout protection ───────────────
  let response: Response | null = null
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), ITEM_TIMEOUT_MS)

    response = await fetch(`${getApiBaseUrl()}/trips/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(item.payload),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)
  } catch (error) {
    // ── KONEKSI GAGAL/TIMEOUT ─────────────────────────
    // Error jaringan/timeout → item TETAP di antran
    const errorMsg = error instanceof Error ? error.message : 'Koneksi gagal'
    console.warn(`[Sync] Gagal kirim ${syncId}: ${errorMsg}`)

    const updated: SyncQueueItem = {
      ...item,
      attempts: item.attempts + 1,
      lastAttemptAt: Date.now(),
      lastError: errorMsg,
      lastErrorCode: 'NETWORK_ERROR',
      needsAttention: false, // Error jaringan bukan perhatian khusus
    }

    await dbPut('trips', syncId, updated)
    _lastError = errorMsg
    notifyListeners()

    // Jadwalkan retry dengan backoff
    const fastRetry = item.attempts < 3 && isNetworkError(errorMsg)
    scheduleRetry(fastRetry ? FAST_RETRY_NETWORK_MS : backoffMs(updated.attempts))
    return
  }

  if (!response) {
    // Tidak seharusnya terjadi, tapi jaga-jaga
    scheduleRetry(POLL_INTERVAL_MS)
    return
  }

  // ── Server memberikan response ───────────────────────────
  // HANYA HTTP 200/201 yang dianggap sukses
  const statusOk = response.status === 200 || response.status === 201

  if (statusOk) {
    // ✅ KONFIRMASI SUKSES DARI SERVER (HTTP 200/201)
    // BARU item boleh dihapus dari antran
    console.log(`[Sync] ✅ Server konfirmasi sukses untuk ${syncId} (HTTP ${response.status})`)
    await removeSyncItem(syncId)
    _lastError = null
    return
  }

  // ── HTTP non-200/201 → Item TETAP di antran ─────────
  let errorBody: { error?: string } = {}
  try {
    errorBody = await response.json()
  } catch { /* ignore */ }

  const errorMsg = errorBody.error || `HTTP ${response.status}`
  console.warn(`[Sync] Server tolak ${syncId}: ${errorMsg}`)

  const updated: SyncQueueItem = {
    ...item,
    attempts: item.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError: errorMsg,
    lastErrorCode: String(response.status),
    needsAttention: response.status >= 400 && response.status < 500, // 4xx butuh perhatian petugas
  }

  await dbPut('trips', syncId, updated)
  _lastError = errorMsg
  notifyListeners()

  // Jadwalkan retry dengan backoff
  const nextBackoff = backoffMs(updated.attempts)
  scheduleRetry(nextBackoff)
}

/**
 * Jadwalkan retry dengan delay opsional.
 * Perbedaan dengan processQueue biasa: probeServer() selalu diverifikasi.
 */
function scheduleRetry(delayMs = POLL_INTERVAL_MS): void {
  if (_retryTimer) clearTimeout(_retryTimer)
  _retryTimer = setTimeout(() => void processQueue({ force: true }), delayMs)
}

/**
 * Proses semua item di antran.
 *
 * ATURAN KRUSIAL ANTI-STUCK:
 * 1. Kunci antran (syncInProgress) dengan watchdog LOCK_TIMEOUT_MS.
 * 2. Probe server TERLEBIH DAHULU sebelum kirim data.
 * 3. Verifikasi sesi autentikasi sebelum kirim.
 * 4. Jika koneksi putus saat proses, hentikan iterate dengan RAPI.
 * 5. Item yang gagal TETAP di antran (tidak pernah hilang).
 *
 * @param opts.force Jika true, lewati cek koneksi & sesi (untuk retry manual).
 * @param opts.retryAll Jika true, proses semua item tanpa cek backoff.
 */
export async function processQueue(opts: { force?: boolean; retryAll?: boolean } = {}): Promise<void> {
  // Anti-stuck: kunci basi otomatis dilepas
  if (_syncing && Date.now() < _lockDeadline) {
    console.log('[Sync] Siklus sebelumnya masih berjalan, lewati...')
    return
  }

  _syncing = true
  _lockDeadline = Date.now() + LOCK_TIMEOUT_MS

  try {
    // 1. Verifikasi koneksi server TERLEBIH DAHULU
    if (!opts.force) {
      const serverOk = await probeServer(true)
      if (!serverOk) {
        console.log('[Sync] Server tidak terjangkau, jadwalkan retry...')
        scheduleRetry(POLL_INTERVAL_MS)
        return
      }

      // 2. Verifikasi sesi autentikasi
      const sessionOk = await ensureBackendSession()
      if (!sessionOk) {
        console.warn('[Sync] Sesi berakhir, jadwalkan retry...')
        scheduleRetry(MAX_BACKOFF_MS)
        return
      }
    }

    // 3. Ambil semua item dari antran
    const items = await dbAll<SyncQueueItem>('trips')

    if (items.length === 0) {
      console.log('[Sync] Antran kosong')
      return
    }

    console.log(`[Sync] Memproses ${items.length} item...`)

    // 4. Proses setiap item dengan probe di setiap iterasi
    for (const item of items) {
      // Cek koneksi di setiap item (jaringan bisa putus saat proses)
      if (!opts.force && !(await probeServer(true))) {
        console.warn('[Sync] Koneksi terputus saat proses, hentikan siklus...')
        break
      }
      await processItem(item, opts.retryAll ?? false)
    }
  } catch (error) {
    console.error('[Sync] Siklus terputus:', error)
    _lastError = error instanceof Error ? error.message : 'Siklus sinkron terputus'
    scheduleRetry(POLL_INTERVAL_MS)
  } finally {
    _syncing = false
    _lockDeadline = 0
    notifyListeners()
  }
}

// ── Sync Dua Arah: Pull Master Data ────────────────────────────────
export async function pullMasterData(): Promise<{ officers?: number; tariffs?: number }> {
  const base = getApiBaseUrl()
  const results: { officers?: number; tariffs?: number } = {}
  // Pull tariffs
  try {
    const res = await fetch(`${base}/tariffs`)
    if (res.ok) {
      const data = await res.json()
      for (const t of data) {
        await dbPut('tariffs', t.id, t)
        results.tariffs = (results.tariffs ?? 0) + 1
      }
    }
  } catch { /* ignore */ }
  // Pull officers
  try {
    const res = await fetch(`${base}/officers`)
    if (res.ok) {
      const data = await res.json()
      for (const o of data) {
        await dbPut('officers', o.id, o)
        results.officers = (results.officers ?? 0) + 1
      }
    }
  } catch { /* ignore */ }
  return results
}

// ── Init ───────────────────────────────────────────────────────
export function initSync() {
  if (_initialized) return
  _initialized = true

  initOfflineDb().then(() => {
    // Proses antran yang sudah ada saat init
    processQueue({ force: true, retryAll: true })
  })

  window.addEventListener('online', async () => {
    // Verifikasi koneksi sebelum proses
    await sleep(ONLINE_RETRY_DELAY_MS)
    for (let i = 0; i < ONLINE_RETRY_ATTEMPTS; i++) {
      if (await probeServer(true)) {
        await pullMasterData()
        await processQueue({ force: true, retryAll: true })
        return
      }
      if (i < ONLINE_RETRY_ATTEMPTS - 1) await sleep(ONLINE_RETRY_DELAY_MS)
    }
    // Gagal setelah beberapa percobaan → jadwalkan polling biasa
    scheduleRetry(POLL_INTERVAL_MS)
  })

  window.addEventListener('offline', () => {
    _pingOk = false
    _pingAt = 0
    console.log('[Sync] Offline — antran tetap aman')
  })

  // Polling latar sebagai jaring pengaman
  window.setInterval(() => {
    if (_pendingCount > 0) processQueue({ force: true })
  }, POLL_INTERVAL_MS)

  // Pantau visibility change (kembali dari background)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _pendingCount > 0) {
      processQueue({ force: true })
    }
  })
}

// ── Manual Sync ───────────────────────────────────────────────
export async function syncNow(): Promise<{ synced: number; pending: number; reachable?: boolean }> {
  const before = await dbCount('trips')
  const reachable = await probeServer(true)
  if (!reachable) {
    return { synced: 0, pending: before, reachable: false }
  }
  await processQueue({ force: true, retryAll: true })
  const after = await dbCount('trips')
  return { synced: Math.max(0, before - after), pending: after, reachable: true }
}
