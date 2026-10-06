// ─── Sync Service ───────────────────────────────────────────────────────
// Antrean upload trip (offline-first).
//   Trip baru → simpan lokal (localStorage) lalu diproses saat online.
//   Retry maksimal 3x dengan exponential backoff; gagal total tetap
//     tersimpan agar bisa dikirim ulang manual dari layar Home.
//   Server selalu menang (konflik diselesaikan oleh backend).

import { Geolocation, type Position } from '@capacitor/geolocation'
import { api, getApiBaseUrl as readApiBaseUrl, setApiBaseUrl as writeApiBaseUrl } from './api'
import { ensureBackendSession, getStoredRoutes } from './auth'
import type { Trip } from '../pages/store'

const SYNC_QUEUE_KEY = 'trip.syncQueue.v1'
const MAX_RETRIES = 3
const RETRY_BACKOFF_MS = 60_000     // backoff 60s
const RETRY_INTERVAL_MS = 15_000    // polling antrean
const KEEP_ALIVE_MS = 50_000

interface SyncItem {
  trip: Trip
  attempts: number
  lastError?: string
  createdAt: number
  lastAttemptAt?: number
}

interface SyncResult {
  id: string
  success: boolean
  error?: string
  code?: string
}

// ── Antrean lokal ──────────────────────────────────────────────

function loadQueue(): SyncItem[] {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function saveQueue(queue: SyncItem[]) {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue))
  } catch { /* quota */ }
}

export function addToSyncQueue(trip: Trip) {
  const queue = loadQueue()
  if (queue.some(q => q.trip.id === trip.id)) return
  queue.push({ trip, attempts: 0, createdAt: Date.now() })
  saveQueue(queue)
  notifyQueueListeners()
}

export function removeFromSyncQueue(tripId: string) {
  saveQueue(loadQueue().filter(q => q.trip.id !== tripId))
  notifyQueueListeners()
}

export function getSyncQueue(): SyncItem[] {
  return loadQueue()
}

export function getPendingCount(): number {
  return loadQueue().length
}

// ── Listeners ───────────────────────────────────────────────────

type QueueListener = (count: number) => void
type SyncedListener = (tripId: string) => void
let queueListeners: QueueListener[] = []
let syncedListeners: SyncedListener[] = []

function notifyQueueListeners() {
  const count = getPendingCount()
  for (const l of [...queueListeners]) {
    try { l(count) } catch { /* ignore */ }
  }
}

function notifySyncedListeners(tripId: string) {
  for (const l of [...syncedListeners]) {
    try { l(tripId) } catch { /* ignore */ }
  }
}

/** Daftarkan listener perubahan antrean. Returns unsubscribe. */
export function onSyncQueueChange(cb: QueueListener): () => void {
  queueListeners.push(cb)
  try { cb(getPendingCount()) } catch { /* ignore */ }
  return () => { queueListeners = queueListeners.filter(x => x !== cb) }
}

/** Daftarkan listener trip berhasil disinkron. Returns unsubscribe. */
export function onTripSynced(cb: SyncedListener): () => void {
  syncedListeners.push(cb)
  return () => { syncedListeners = syncedListeners.filter(x => x !== cb) }
}

// ── Upload satu trip ────────────────────────────────────────────

async function dataUrlToBlob(dataUrl?: string): Promise<Blob | null> {
  if (!dataUrl) return null
  const res = await fetch(dataUrl)
  return res.blob()
}

async function postTripToServer(trip: Trip, allowReauth = true): Promise<SyncResult> {
  try {
    const photos: Blob[] = []
    const toPhotoIndex = async (dataUrl?: string) => {
      const blob = await dataUrlToBlob(dataUrl)
      if (!blob) return null
      const idx = photos.length
      photos.push(blob)
      return idx
    }

    const tripPhotoIndex = await toPhotoIndex(trip.photoUrl)
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
      const vi = await toPhotoIndex(v.photoUrl)
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
        tariffAmount: v.tariff,
      })
    }

    if (tripPhotoIndex === null || vehicles.some(v => v.photoIndex === null)) {
      return {
        id: trip.id,
        success: false,
        error: 'Foto dokumentasi tidak lengkap — ambil ulang dari Riwayat',
      }
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
      tripPhotoIndex,
      tripPhotoCapturedAt: trip.photoCapturedAt ?? null,
      tripPhotoLatitude: trip.photoLatitude ?? null,
      tripPhotoLongitude: trip.photoLongitude ?? null,
      startedAt: trip.startedAt ?? null,
      completedAt: trip.completedAt ?? null,
      vehicles,
    }))
    photos.forEach((blob, i) => form.append('photos', blob, `photo-${i}.jpg`))

    const res = await api.postMultipart<unknown>('/trips/complete', form)
    if (res.ok) return { id: trip.id, success: true }

    const code = res.error?.code
    if (code === '401' && allowReauth) {
      const ok = await ensureBackendSession()
      if (ok) return postTripToServer(trip, false)
    }
    return { id: trip.id, success: false, error: res.error?.message, code }
  } catch (e) {
    return { id: trip.id, success: false, error: e instanceof Error ? e.message : 'Gagal upload' }
  }
}

// ── Proses antrean ─────────────────────────────────────────────

let syncInProgress = false

function backoffMs(attempts: number): number {
  return RETRY_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1))
}

function isNetworkError(err?: string): boolean {
  return !!err && /timeout|network|failed.to.fetch|terjangkau|offline|request.failed/i.test(err)
}

/**
 * Proses antrean upload.
 *   retryAll = true → paksa upload ulang semua (tombol "Sinkronkan" di Home).
 */
export async function processSyncQueue(opts?: { retryAll?: boolean }): Promise<void> {
  if (syncInProgress) return
  if (!navigator.onLine) { notifyQueueListeners(); return }

  const initial = loadQueue()
  if (initial.length === 0) { notifyQueueListeners(); return }

  syncInProgress = true
  try {
    for (const item of initial) {
      // Cek item masih di antrean
      const current = loadQueue().find(q => q.trip.id === item.trip.id)
      if (!current) continue
      if (!navigator.onLine) break

      const attempts = current.attempts
      if (!opts?.retryAll) {
        if (attempts >= MAX_RETRIES) continue
        const last = current.lastAttemptAt ?? 0
        const elapsed = Date.now() - last
        if (elapsed < backoffMs(attempts)) continue
      }

      const result = await postTripToServer(current.trip)
      const queue = loadQueue()
      const idx = queue.findIndex(q => q.trip.id === current.trip.id)
      if (idx < 0) { notifyQueueListeners(); continue }

      if (result.success) {
        // Hapus dari antrean + beritahu listener
        queue.splice(idx, 1)
        saveQueue(queue)
        notifyQueueListeners()
        notifySyncedListeners(current.trip.id)
      } else {
        queue[idx] = {
          ...queue[idx],
          attempts: queue[idx].attempts + 1,
          lastAttemptAt: Date.now(),
          lastError: result.error ?? (result.code ? `HTTP ${result.code}` : 'Unknown error'),
        }
        saveQueue(queue)
        // Error jaringan → berhenti, coba lagi nanti (backoff)
        if (isNetworkError(queue[idx].lastError)) break
        notifyQueueListeners()
      }
    }
  } finally {
    syncInProgress = false
    notifyQueueListeners()
  }
}

// ── Lifecycle ──────────────────────────────────────────────────

let initialized = false

/** Panggil sekali saat app start. Aman dipanggil ulang (idempoten). */
export function initializeSync(): void {
  if (initialized) return
  initialized = true

  // polling setiap RETRY_INTERVAL_MS saat online
  window.setInterval(() => { if (navigator.onLine) void processSyncQueue() }, RETRY_INTERVAL_MS)

  // Ionic online event
  window.addEventListener('online', () => void processSyncQueue())

  // coba sinkronisasi sekali di background
  window.setTimeout(() => void processSyncQueue(), 2000)
}

/** Paksa sinkronisasi manual — tunggu hasil. */
export async function syncNow(): Promise<{ synced: number; failed: number }> {
  if (syncInProgress) return { synced: 0, failed: getPendingCount() }
  const before = getPendingCount()
  await processSyncQueue({ retryAll: true })
  const after = getPendingCount()
  return { synced: Math.max(0, before - after), failed: after }
}

// ── Base URL server ──────────────────────────────────────────

export function getApiBaseUrl(): string {
  return readApiBaseUrl()
}

export function setApiBaseUrl(url: string) {
  if (!url) return
  writeApiBaseUrl(url)
}

export function getBaseUrl(): string {
  return readApiBaseUrl()
}

/** Mask URL server: sebagian hostname disensor. */
export function getMaskedApiUrl(): string {
  try {
    const u = new URL(getApiBaseUrl())
    const host = u.hostname
    const hidden = host.length > 8
      ? `${host.slice(0, 4)}…${host.slice(-4)}`
      : `${host.slice(0, 2)}…${host.slice(-2)}`
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.protocol}//${hidden}${path}`
  } catch {
    return getBaseUrl()
  }
}
