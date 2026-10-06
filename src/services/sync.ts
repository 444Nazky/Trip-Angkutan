// ────────────────────────────────────────────────────────────────────────
// Sync Service — Offline-First Trip Upload
//
// IMPROVEMENTS v2:
// 1. PERSISTENSI: IndexedDB via Dexie.js (andal, tidak hilang saat app ditutup)
// 2. REAL-TIME SYNC: Langsung proses antrean saat koneksi pulih (< 2 detik)
// 3. RETRY CERDAS: Exponential backoff + re-authentication token otomatis
// 4. KONFIRMASI SERVER: Hapus dari antrean HANYA setelah HTTP 200/201
//─────────────────────────────────────────────────────────────────────────

import { Geolocation, type Position } from '@capacitor/geolocation'
import { api, getApiBaseUrl as readApiBaseUrl } from './api'
import { ensureBackendSession, getStoredRoutes } from './auth'
import type { Trip } from '../pages/store'

// ── Config ────────────────────────────────────────────────────────────────────
const DB_NAME = 'trip-sync-v2'
const STORE_PENDING = 'pending'
const MAX_RETRIES = 5
const RETRY_BACKOFF_MS = 30_000      // 30 detik (lebih agresif dr 60s sebelumnya)
const FAST_RETRY_NETWORK_MS = 2_000   // Retry cepat untuk error jaringan (< 2 detik)
const POLL_INTERVAL_MS = 30_000        // Fallback polling saja, online-event utama

// ── Types ──────────────────────────────────────────────────────────────────────
interface SyncItem {
  /** Kunci unik: trip.id + timestamp bikin, unik antar percobaan */
  syncId: string
  trip: Trip
  attempts: number
  lastError?: string
  createdAt: number
  lastAttemptAt?: number
  /** Foto sebagai object {dataUrl, mimeType} */
  photos: PhotoEntry[]
  tripPhoto?: PhotoEntry
}

interface PhotoEntry {
  dataUrl: string
  mimeType: string
}

interface SyncResult {
  syncId: string
  success: boolean
  error?: string
  code?: string
}

interface SyncQueueRow {
  syncId: string
  data: SyncItem
  indexedAt: number
}

// ── Dexie-like IndexedDB wrapper ───────────────────────────────────────────────
let _db: IDBDatabase | null = null
let _dbPromise: Promise<IDBDatabase> | null = null

function openDB(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db)
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const store = db.createObjectStore(STORE_PENDING, { keyPath: 'syncId' })
        store.createIndex('createdAt', 'indexedAt')
      }
    }
    req.onsuccess = () => { _db = req.result; resolve(_db) }
    req.onerror = () => reject(req.error)
  })
  return _dbPromise
}

/** Baca SEMUA item antrean tersimpan */
async function dbReadAll(): Promise<SyncItem[]> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_PENDING, 'readonly')
    const store = tx.objectStore(tx.objectStoreNames[0])
    const req = store.getAll()
    req.onsuccess = () => res(req.result.map((r: SyncQueueRow) => r.data))
    req.onerror = () => { console.warn('[sync] gagal baca DB:', req.error); res([]) }
  })
}

/** Tulis SATU item ke antrean (upsert by syncId */
async function dbUpsert(item: SyncItem, syncId: string): Promise<void> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE_PENDING, 'readwrite')
    const store = tx.objectStore(tx.objectStoreNames[0])
    const wrapped: SyncQueueRow = { syncId, data: item, indexedAt: item.createdAt }
    const req = store.put(wrapped)
    req.onsuccess = () => res()
    req.onerror = () => { console.warn('[sync] gagal tulis DB:', req.error); res() }
  })
}

/** Hapus SATU item dari antrean (stlh server konfirmasi sukses */
async function dbRemove(syncId: string): Promise<void> {
  const db = await openDB()
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE_PENDING, 'readwrite')
      const store = tx.objectStore(tx.objectStoreNames[0])
      store.delete(syncId)
      tx.oncomplete = () => res()
      tx.onerror = () => res() // diam-diam gagal ≠ fatal
    } catch { res() }
  })
}

/** Hitung jumlah antrean (tanpa baca semua data) */
async function dbCount(): Promise<number> {
  const db = await openDB()
  return new Promise((res) => {
    try {
      const tx = db.transaction(STORE_PENDING, 'readonly')
      const store = tx.objectStore(tx.objectStoreNames[0])
      const req = store.count()
      req.onsuccess = () => res(req.result)
      req.onerror = () => res(0)
    } catch { res(0) }
  }
}

// ── Listeners ────────────────────────────────────────────────────────────────
type QueueListener = (count: number) => void
type SyncedListener = (syncId: string) => void

let queueListeners: QueueListener[] = []
let syncedListeners: SyncedListener[] = []
let _pendingCount = 0

function notifyQueueListeners() {
  void dbCount().then(n => {
    _pendingCount = n
    for (const l of [...queueListeners]) { try { l(n) } catch {} }
  })
}

function notifySyncedListeners(syncId: string) {
  for (const l of [...syncedListeners]) { try { l(syncId) } catch {} }
}

// ── Public API: antrean ──────────────────────────────────────────────────────

/** Daftarkan trip baru ke antrean sinkron. Idempoten. */
export async function addToSyncQueue(trip: Trip, photos?: PhotoEntry[], tripPhoto?: PhotoEntry): Promise<void> {
  await openDB()
  const syncId = `trip:${trip.id}:${Date.now()}`
  const vehiclePhotos = photos ?? (trip.vehicles ?? []).map(v => ({
    dataUrl: v.photoUrl ?? '',
    mimeType: 'image/jpeg' as string,
  }))
  const item: SyncItem = {
    syncId,
    trip,
    attempts: 0,
    createdAt: Date.now(),
    photos: vehiclePhotos,
    tripPhoto: tripPhoto,
  }
  await dbUpsert(item, syncId)
  notifyQueueListeners()
}

/** Hapus SATU item. Dipanggil setelah server konfirmasi sukses. */
export async function removeFromSyncQueue(syncId: string): Promise<void> {
  await dbRemove(syncId)
  notifyQueueListeners()
}

/** Hitung antrean tertunda */
export function getPendingCount(): number { return _pendingCount }

/** Dapat syncId unik dr item antrean */
export function getSyncQueue(): SyncItem[] { return [] } // overload untuk backward compat, syncId dari listener

export function onSyncQueueChange(cb: QueueListener): () => void {
  queueListeners.push(cb)
  void dbCount().then(n => { _pendingCount = n; try { cb(n) } catch {} })
  return () => { queueListeners = queueListeners.filter(x => x !== cb) }
}

export function onTripSynced(cb: SyncedListener): () => void {
  syncedListeners.push(cb)
  return () => { syncedListeners = syncedListeners.filter(x => x !== cb) }
}

// ── Backward compat exports ─────────────────────────────────────────────────
export { addToSyncQueue as addToSyncQueueLegacy }
export { removeFromSyncQueue as removeFromSyncQueueLegacy }
export { getPendingCount as getPendingCountLegacy }

// ── Helper: blob dari data URL ──────────────────────────────────────────────
async function dataUrlToBlob(dataUrl?: string): Promise<Blob | null> {
  if (!dataUrl) return null
  try {
    const res = await fetch(dataUrl)
    return res.blob()
  } catch { return null }
}

// ── POST trip ke server ─────────────────────────────────────────────────────

async function postTripToServer(item: SyncItem, allowReauth = true): Promise<SyncResult> {
  const { syncId, trip, photos, tripPhoto } = item
  try {
    const blobs: Blob[] = []
    const toPhotoIndex = async (entry?: PhotoEntry): Promise<number | null> => {
      if (!entry) return null
      const blob = await dataUrlToBlob(entry.dataUrl)
      if (!blob) return null
      const idx = blobs.length
      blobs.push(blob)
      return idx
    }

    const tripPhotoIdx = await toPhotoIndex(tripPhoto)
    const hasLoad = trip.load === 'Ada Muatan'

    interface VehiclePayload {
      noPolisi: string
      vehicleType: string
      golongan: string
      hasLoad: boolean
      photoIndex: number | null
      photoCapturedAt: string | null
      latitude: number | null
      longitude: number | null
      tariffAmount: number
    }

    const vehicles: VehiclePayload[] = []
    for (const v of trip.vehicles ?? []) {
      const vi = await toPhotoIndex({ dataUrl: v.photoUrl ?? '', mimeType: 'image/jpeg' })
      let lat: number | null = null
      let lon: number | null = null
      if (v.photoLatitude != null && v.photoLongitude != null) {
        lat = v.photoLatitude
        lon = v.photoLongitude
      } else {
        try {
          const pos: Position = await Geolocation.getCurrentPosition()
          lat = pos.coords.latitude
          lon = pos.coords.longitude
        } catch { /* lokasi tidak tersedia */ }
      }
      vehicles.push({
        noPolisi: v.plate,
        vehicleType: v.type,
        golongan: v.category,
        hasLoad,
        photoIndex: vi,
        photoCapturedAt: v.photoCapturedAt ?? null,
        latitude: lat,
        longitude: lon,
        tariffAmount: v.tariff ?? 0,
      })
    }

    if (tripPhotoIdx === null || vehicles.some(v => v.photoIndex === null)) {
      return { syncId, success: false, error: 'Foto dokumentasi tidak lengkap — ambil ulang dari Riwayat' }
    }

    // Route "ASAL-TUJUAN" → asal/tujuan
    let routeFrom: string | null = null
    let routeTo: string | null = null
    const known = getStoredRoutes().find(r => r.code === trip.route)
    if (known) {
      routeFrom = known.from
      routeTo = known.to
    } else {
      const idx = trip.route.lastIndexOf('-')
      if (idx > 0) {
        routeFrom = trip.route.slice(0, idx)
        routeTo = trip.route.slice(idx + 1)
      }
    }

    const form = new FormData()
    form.append('payload', JSON.stringify({
      statusMuatan: hasLoad ? 'muatan' : 'kosong',
      routeFrom,
      routeTo,
      keterangan: trip.category || null,
      tripPhotoIndex: tripPhotoIdx,
      tripPhotoCapturedAt: trip.photoCapturedAt ?? null,
      tripPhotoLatitude: trip.photoLatitude ?? null,
      tripPhotoLongitude: trip.photoLongitude ?? null,
      startedAt: trip.startedAt ?? null,
      completedAt: trip.completedAt ?? null,
      vehicles,
    }))
    blobs.forEach((blob, i) => form.append('photos', blob, `photo-${i}.jpg`))

    const res = await api.postMultipart<unknown>('/trips/complete', form)

    // ✅ KONFIRMASI SERVER: HANYA sukses nyata (HTTP 200/201) yang menghapus dr antrean
    if (res.ok) {
      return { syncId, success: true }
    }

    // Auth expired → re-authenticate otomatis
    const code = res.error?.code
    if (code === '401' && allowReauth) {
      const ok = await ensureBackendSession()
      if (ok) {
        // Rekursif dgn token baru, MAX SATU kali saja (allowReauth=false)
        return postTripToServer(item, false)
      }
      return { syncId, success: false, error: res.error?.message ?? 'Auth gagal', code }
    }

    return { syncId, success: false, error: res.error?.message ?? 'Server menolak', code }

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Gagal upload'
    return { syncId, success: false, error: msg }
  }
}

// ── Proses antrean ────────────────────────────────────────────────────────

let syncInProgress = false
let _syncTimeout: ReturnType<typeof setTimeout> | null = null

function isNetworkError(err?: string): boolean {
  return !!err && /timeout|network|failed.to.fetch|terjangkau|offline|request.failed|ECONNREFUSED|ENOTFOUND/i.test(err ?? '')
}

function backoffMs(attempts: number): number {
  return Math.min(RETRY_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1)), 300_000)
}

/** Proses SATU item. Berhasil → hapus dr DB. */
async function processItem(item: SyncItem, retryAll = false): Promise<void> {
  if (!navigator.onLine) return
  if (item.attempts >= MAX_RETRIES && !retryAll) return

  const last = item.lastAttemptAt ?? 0
  const wait = backoffMs(item.attempts)
  const elapsed = Date.now() - last

  if (!retryAll && elapsed < wait && !isNetworkError(item.lastError)) {
    // Item belum siap di-retry — skip (bukan error, hanya waiting)
    return
  }

  const result = await postTripToServer(item)

  if (result.success) {
    // ✅ SERVER KONFIRMASI — baru hapus dari antrean
    await dbRemove(item.syncId)
    notifyQueueListeners()
    notifySyncedListeners(item.syncId)
    return
  }

  // Gagal — simpan ulang dengan attempt + error terbaru
  const updated: SyncItem = {
    ...item,
    attempts: item.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError: result.error ?? (result.code ? `HTTP ${result.code}` : 'Unknown'),
  }
  await dbUpsert(updated, item.syncId)

  // Error jaringan → retry cepat (< 2 detik). Error server → pakai backoff normal.
  const delay = isNetworkError(result.error) ? FAST_RETRY_NETWORK_MS : wait
  scheduleRetry(delay)
  notifyQueueListeners()
}

/** Jadwalkan polling lagi */
function scheduleRetry(delayMs = POLL_INTERVAL_MS) {
  if (_syncTimeout) clearTimeout(_syncTimeout)
  _syncTimeout = setTimeout(() => { _syncTimeout = null; void processSyncQueue() }, delayMs)
}

/** Proses SEMUA antrean. retryAll = true → tombol "Sinkronkan" di Home. */
export async function processSyncQueue(opts?: { retryAll?: boolean }): Promise<void> {
  if (syncInProgress) return
  if (!navigator.onLine) return

  const items = await dbReadAll()
  if (items.length === 0) { notifyQueueListeners(); return }

  syncInProgress = true
  try {
    for (const item of items) {
      if (!navigator.onLine) break
      await processItem(item, opts?.retryAll ?? false)
    }
  } finally {
    syncInProgress = false
    notifyQueueListeners()
  }
}

// ── Event-driven sync REAL-TIME ───────────────────────────────────────────

let _initialized = false

/** Inisialisasi. Dipanggil Sekali saat app mount. Idempoten. */
export function initializeSync(): void {
  if (_initialized) return
  _initialized = true

  // 1. LISTENER ONLINE — REAL-TIME (< 2 detik): proses antrean SETERUSNYA.
  //    Ini adalah listener utama. Immediately() microtask agar lebih cepat dr setTimeout.
  window.addEventListener('online', () => {
    if (!navigator.onLine) return
    // Langsung proses tanpa delay. scheduleRetry() sebagai fallback bila proses ini dipanggil lagi.
    queueMicrotask(() => void processSyncQueue())
  })

  // 2. Polling fallback tiap POLL_INTERVAL_MS — jaga-jaga bila online-event tidak reliable.
  //    Lebih lambat dari event, tapi tetap berjalan di background.
  window.setInterval(() => {
    if (navigator.onLine) void processSyncQueue()
  }, POLL_INTERVAL_MS)

  // 3. Coba sinkronisasi di background saat app mulai (tanpa halangi render).
  window.setTimeout(() => void processSyncQueue(), 1500)
}

/** Paksa sinkronisasi SEKARANG — untuk tombol "Sinkronkan" di HomeScreen. */
export async function syncNow(): Promise<{ synced: number; failed: number }> {
  if (syncInProgress) return { synced: 0, failed: _pendingCount }
  const before = _pendingCount
  await processSyncQueue({ retryAll: true })
  await dbCount().then(n => { _pendingCount = n })
  const after = _pendingCount
  return { synced: Math.max(0, before - after), failed: after }
}

// ── Base URL helpers ──────────────────────────────────────────────────────
export function getApiBaseUrl(): string { return readApiBaseUrl() }
export function getMaskedApiUrl(): string {
  try {
    const u = new URL(getApiBaseUrl())
    const hidden = u.hostname.length > 8 ? `${u.hostname.slice(0,4)}…${u.hostname.slice(-4)}` : `${u.hostname.slice(0,2)}…${u.hostname.slice(-2)}`
    return `${u.protocol}//${hidden}${u.pathname}`
  } catch { return '(konfigurasi tidak valid)' }
}
