// ─── Sync Service ─────────────────────────────────────────────────────────────
// Handles trip data synchronization between mobile app and backend

import { api } from './api'
import { ensureBackendSession } from './auth'
import type { Trip } from '../pages/store'

const SYNC_QUEUE_KEY = 'trip.syncQueue.v1'
const MAX_RETRIES = 3
/** Jeda minimal sebelum item yang sudah 3× gagal dicoba lagi (backoff). */
const RETRY_BACKOFF_MS = 60_000
/** Jaring pengaman: cek ulang tiap 15 detik bila event 'online' tak dipancarkan. */
const RETRY_INTERVAL_MS = 15_000

interface SyncItem {
  trip: Trip
  attempts: number
  lastError?: string
  createdAt: number
  /** Kapan terakhir dicoba — dasar backoff untuk item yang sudah mentok. */
  lastAttemptAt?: number
}

interface SyncResult {
  id: string
  success: boolean
  error?: string
  code?: string
}

// ─── Queue Management ─────────────────────────────────────────────────────────

function loadQueue(): SyncItem[] {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveQueue(queue: SyncItem[]) {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue))
  } catch { /* quota */ }
}

export function addToSyncQueue(trip: Trip): void {
  const queue = loadQueue()
  // Avoid duplicates
  if (queue.some(q => q.trip.id === trip.id)) return
  queue.push({ trip, attempts: 0, createdAt: Date.now() })
  saveQueue(queue)
  notifyListeners()
  // Sedang online? kirim segera — inilah alur "isi form → langsung ke dashboard".
  scheduleFlush(400)
}

export function removeFromSyncQueue(tripId: string): void {
  saveQueue(loadQueue().filter(q => q.trip.id !== tripId))
  notifyListeners()
}

export function getSyncQueue(): SyncItem[] {
  return loadQueue()
}

export function getPendingCount(): number {
  return loadQueue().length
}

// ─── Trip Sync ────────────────────────────────────────────────────────────────

async function postTripToServer(trip: Trip): Promise<SyncResult> {
  if (trip.photo && !trip.photoUrl) {
    return { id: trip.id, success: false, error: 'Foto bukti trip tidak tersedia' }
  }
  if (trip.vehicles?.some(vehicle => !vehicle.photoUrl)) {
    return { id: trip.id, success: false, error: 'Foto dokumentasi kendaraan tidak lengkap' }
  }

  const photos: Blob[] = []
  const toPhotoIndex = async (dataUrl?: string) => {
    if (!dataUrl) return null
    const index = photos.length
    const photo = await (await fetch(dataUrl)).blob()
    photos.push(photo)
    return index
  }

  let tripPhotoIndex: number | null
  const vehicles = []
  try {
    tripPhotoIndex = await toPhotoIndex(trip.photoUrl)
    for (const vehicle of trip.vehicles || []) {
      vehicles.push({
        noPolisi: vehicle.plate,
        vehicleType: vehicle.type,
        golongan: vehicle.category,
        hasLoad: trip.load === 'Ada Muatan',
        tariffAmount: vehicle.tariff,
        photoIndex: await toPhotoIndex(vehicle.photoUrl),
        photoCapturedAt: vehicle.photoCapturedAt || null,
        latitude: vehicle.photoLatitude ?? null,
        longitude: vehicle.photoLongitude ?? null,
      })
    }
  } catch (error) {
    return {
      id: trip.id,
      success: false,
      error: error instanceof Error ? `Foto dokumentasi gagal dibaca: ${error.message}` : 'Foto dokumentasi gagal dibaca',
    }
  }

  // One multipart request carries the full trip manifest and every image.
  const payload = {
    statusMuatan: trip.load === 'Ada Muatan' ? 'muatan' : 'kosong',
    routeFrom: trip.route.split(' → ')[0],
    routeTo: trip.route.split(' → ')[1],
    keterangan: trip.category || 'Internal',
    startedAt: trip.startedAt || null,
    completedAt: trip.completedAt || null,
    tripPhotoIndex,
    tripPhotoCapturedAt: trip.photoCapturedAt || null,
    tripPhotoLatitude: trip.photoLatitude ?? null,
    tripPhotoLongitude: trip.photoLongitude ?? null,
    vehicles,
  }

  const form = new FormData()
  form.append('payload', JSON.stringify(payload))
  photos.forEach((photo, index) => form.append('photos', photo, `documentation-${index}.jpg`))
  const tripResult = await api.postMultipart<{ id: string; noTrip: string }>('/trips/complete', form)

  if (!tripResult.ok || !tripResult.data) {
    return {
      id: trip.id,
      success: false,
      error: tripResult.error?.message,
      code: tripResult.error?.code,
    }
  }

  return { id: trip.id, success: true }
}

async function syncTrip(trip: Trip): Promise<SyncResult> {
  console.log('[Sync] Starting sync for trip:', trip.id)

  // The login screen never talks to the backend, so make sure a JWT exists
  // before posting (otherwise POST /trips 401s forever).
  const hasSession = await ensureBackendSession()
  console.log('[Sync] Backend session:', hasSession ? 'OK' : 'FAILED')

  if (!hasSession) {
    return { id: trip.id, success: false, error: 'Tidak ada sesi backend' }
  }

  let result = await postTripToServer(trip)
  console.log('[Sync] Post result:', result.success ? 'SUCCESS' : 'FAILED', result.error)

  // Token expired or rejected mid-flight — api cleared it on 401; re-auth once
  if (result.code === '401' && (await ensureBackendSession())) {
    result = await postTripToServer(trip)
  }

  return result
}

// ─── Background Sync ──────────────────────────────────────────────────────────

let syncInProgress = false
let syncListeners: ((count: number) => void)[] = []

export function onSyncQueueChange(callback: (count: number) => void) {
  syncListeners.push(callback)
  return () => {
    syncListeners = syncListeners.filter(cb => cb !== callback)
  }
}

function notifyListeners() {
  const count = getPendingCount()
  syncListeners.forEach(cb => cb(count))
}

export interface ProcessQueueOptions {
  /** Paksa ulang semua item termasuk yang sudah mentok percobaan (dipakai saat
   *  koneksi kembali / sinkron manual). */
  retryAll?: boolean
}

export async function processSyncQueue(opts: ProcessQueueOptions = {}): Promise<SyncResult[]> {
  if (syncInProgress) {
    console.log('[Sync] Already in progress, skipping')
    return []
  }
  if (!navigator.onLine) {
    console.log('[Sync] Offline — antrean tetap tersimpan lokal')
    return []
  }
  syncInProgress = true

  const queue = loadQueue()
  console.log('[Sync] Queue length:', queue.length)

  if (queue.length === 0) {
    console.log('[Sync] Queue empty, nothing to sync')
    syncInProgress = false
    return []
  }

  const results: SyncResult[] = []
  const updatedQueue: SyncItem[] = []
  const now = Date.now()

  for (const item of queue) {
    const due =
      opts.retryAll ||
      item.attempts < MAX_RETRIES ||
      now - (item.lastAttemptAt || 0) >= RETRY_BACKOFF_MS

    if (!due) {
      // Belum waktunya dicoba lagi — tetap antri, jangan hilangkan.
      updatedQueue.push(item)
      continue
    }

    if (opts.retryAll) item.attempts = 0
    const result = await syncTrip(item.trip)
    item.lastAttemptAt = Date.now()

    if (result.success) {
      results.push(result)
      try {
        const rawTrips = localStorage.getItem('trip.trips.v1')
        if (rawTrips) {
          const list: Trip[] = JSON.parse(rawTrips)
          const updated = list.map(t => (t.id === item.trip.id ? { ...t, synced: true } : t))
          localStorage.setItem('trip.trips.v1', JSON.stringify(updated))
          window.dispatchEvent(new Event('storage'))
        }
      } catch { /* quota */ }
      console.log(`[Sync] Trip ${item.trip.id} terkirim ke server ✓`)
    } else {
      item.attempts++
      item.lastError = result.error
      // Item SELALU dipertahankan (tak ada trip yang hilang) — hanya jadwal
      // percobaan berikutnya yang ditunda lewat backoff.
      updatedQueue.push(item)
      console.warn(`[Sync] Trip ${item.trip.id} gagal (percobaan ${item.attempts}):`, result.error)
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 500))
  }

  saveQueue(updatedQueue)
  notifyListeners()
  syncInProgress = false

  return results
}

// ─── Network Watchers & Auto Sync ────────────────────────────────────────
//
// Aturan: begitu koneksi pulih (atau ada trip baru sementara online), antrean
// lokal langsung dikirim ke server — tanpa restart aplikasi dan tanpa tap manual.

let initialized = false
let watchersStarted = false
let flushTimer: ReturnType<typeof setTimeout> | null = null

/** Tunda pengiriman sebentar agar beberapa trip berurutan digabung jadi satu. */
function scheduleFlush(delay = 300): void {
  if (flushTimer !== null) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    if (navigator.onLine && getPendingCount() > 0) {
      void processSyncQueue({ retryAll: true })
    }
  }, delay)
}

/** Dipanggil tiap kali koneksi kembali. */
function handleReconnect(reason: string): void {
  const queue = loadQueue()
  if (queue.length === 0) {
    console.log(`[Sync] ${reason} — antrean kosong`)
    return
  }
  console.log(`[Sync] ${reason} — mengirim ${queue.length} trip tersimpan lokal…`)
  // Beri jatah percobaan baru ke semua item (sebelumnya mungkin sudah mentok).
  queue.forEach(item => { item.attempts = 0 })
  saveQueue(queue)
  scheduleFlush(200)
}

function startNetworkWatchers(): void {
  if (watchersStarted) return
  watchersStarted = true

  window.addEventListener('online', () => handleReconnect('Online'))
  window.addEventListener('offline', () =>
    console.log('[Sync] Offline — trip baru disimpan lokal dulu'))

  // Antrean bisa berubah dari luar addToSyncQueue (tab lain, restore data,
  // atau penulisan localStorage langsung) — badge "menunggu sinkronisasi"
  // di beranda harus ikut menyesuaikan tanpa perlu reload.
  window.addEventListener('storage', e => {
    if (e.key == null || e.key === SYNC_QUEUE_KEY) notifyListeners()
  })

  // Jaring pengaman: sebagian WebView/Capacitor tidak memancarkan event 'online'.
  setInterval(() => {
    if (navigator.onLine && getPendingCount() > 0 && !syncInProgress) {
      void processSyncQueue()
    }
  }, RETRY_INTERVAL_MS)

  // Perangkat asli (Capacitor): pantau status jaringan secara native.
  void import('@capacitor/network')
    .then(({ Network }) =>
      Network.addListener('networkStatusChange', status => {
        if (status.connected) handleReconnect('Jaringan pulih (native)')
      }),
    )
    .catch(() => { /* mode web — event window sudah cukup */ })
}

export async function initializeSync() {
  if (initialized) return
  initialized = true

  // PENTING: listener dipasang dulu, apa pun isi antrean saat aplikasi dibuka.
  // (Versi lama keluar lebih dulu kalau antrean kosong, sehingga trip yang diisi
  //  saat offline tidak pernah terkirim otomatis ketika koneksi kembali.)
  startNetworkWatchers()

  // Kirim sisa antrean dari sesi sebelumnya.
  if (navigator.onLine && getPendingCount() > 0) {
    await processSyncQueue({ retryAll: true })
  }
}
