// ─── Sync Service ─────────────────────────────────────────────────────────────
// Antrean unggah trip (offline-first).
//   • Trip baru → antre lokal (localStorage) lalu diproses saat online.
//   • Retry maksimal 3x dengan exponential backoff; gagal total tetap
//     tersimpan agar bisa dikirim ulang manual dari layar Home.
//   • Server selalu menang (konflik diselesaikan oleh backend).

import { Geolocation, type Position } from '@capacitor/geolocation'
import { Network } from '@capacitor/network'
import { api, getApiBaseUrl as readApiBaseUrl, setApiBaseUrl as writeApiBaseUrl } from './api'
import { ensureBackendSession, getStoredRoutes } from './auth'
import type { Trip } from '../pages/store'

const SYNC_QUEUE_KEY = 'trip.syncQueue.v1'
const MAX_RETRIES = 3
const RETRY_BACKOFF_MS = 60_000      // percobaan pertama ulang 60s
const RETRY_INTERVAL_MS = 15_000     // polling antrean
const KEEP_ALIVE_MS = 50_000         // jaga-jaga deteksi koneksi di mobile

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

// ── Antrean ──────────────────────────────────────────────────────────────────

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
  notifyListeners()
}

export function removeFromSyncQueue(tripId: string) {
  saveQueue(loadQueue().filter(q => q.trip.id !== tripId))
  notifyListeners()
}

export function getSyncQueue(): SyncItem[] {
  return loadQueue()
}

export function getPendingCount(): number {
  return loadQueue().length
}

// ── Listeners (badge antrean di Home / History) ──────────────────────────────

type QueueListener = (count: number) => void
let listeners: QueueListener[] = []

function notifyListeners() {
  const count = getPendingCount()
  for (const l of [...listeners]) {
    try { l(count) } catch { /* listener rusak diabaikan */ }
  }
}

/** Daftarkan listener perubahan antrean. Returns fungsi unsubscribe. */
export function onSyncQueueChange(cb: QueueListener): () => void {
  listeners.push(cb)
  try { cb(getPendingCount()) } catch { /* ignore */ }
  return () => { listeners = listeners.filter(x => x !== cb) }
}

// ── Unggah satu trip ─────────────────────────────────────────────────────────

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
        error: 'Foto dokumentasi tidak lengkap —ambil ulang dari layar Riwayat',
      }
    }

    // route code "ASAL-TUJUAN" → asal/tujuan untuk backend
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

    const payload = {
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
    }

    const form = new FormData()
    form.append('payload', JSON.stringify(payload))
    photos.forEach((blob, i) => form.append('photos', blob, `photo-${i}.jpg`))

    const res = await api.postMultipart<unknown>('/trips/complete', form)
    if (res.ok) return { id: trip.id, success: true }

    const code = res.error?.code
    // Token kedaluwarsa → bangun sesi baru sekali lalu coba ulang
    if (code === '401' && allowReauth) {
      const ok = await ensureBackendSession()
      if (ok) return postTripToServer(trip, false)
    }
    return { id: trip.id, success: false, error: res.error?.message, code }
  } catch (e) {
    return { id: trip.id, success: false, error: e instanceof Error ? e.message : 'Gagal baca foto' }
  }
}

// ── Proses antrean ───────────────────────────────────────────────────────────

let syncInProgress = false

function backoffMs(attempts: number): number {
  return RETRY_BACKOFF_MS * Math.pow(2, Math.max(0, attempts - 1))
}

function isNetworkError(err?: string): boolean {
  return !!err && /timeout|network|failed to fetch|terjangkau|offline|request failed/i.test(err)
}

/**
 * Proses antrean unggah.
 *   retryAll = true → paksa kirim ulang semua item (termasuk yang sudah
 *   mencapai batas retry), dipakai tombol "Sinkronkan" di Home.
 */
export async function processSyncQueue(opts?: { retryAll?: boolean }): Promise<void> {
  if (syncInProgress) return
  if (!navigator.onLine) { notifyListeners(); return }

  const initial = loadQueue()
  if (initial.length === 0) { notifyListeners(); return }

  syncInProgress = true
  try {
    for (const item of initial) {
      // Ambil ulang: item bisa saja sudah terkirim/hapus oleh proses lain
      const current = loadQueue().find(q => q.trip.id === item.trip.id)
      if (!current) continue
      if (!navigator.onLine) break

      const attempts = current.attempts
      if (!opts?.retryAll) {
        if (attempts >= MAX_RETRIES) continue
        const last = current.lastAttemptAt ?? 0
        if (last && Date.now() - last < backoffMs(attempts)) continue
      }

      const result = await postTripToServer(current.trip)
      const queue = loadQueue()
      const idx = queue.findIndex(q => q.trip.id === current.trip.id)
      if (idx < 0) { notifyListeners(); continue }

      if (result.success) {
        queue.splice(idx, 1)
        saveQueue(queue)
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
      }
      notifyListeners()
    }
  } finally {
    syncInProgress = false
    notifyListeners()
  }
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

let initialized = false

/** Panggil sekali saat app start. Aman dipanggil berulang (idempoten). */
export function initializeSync(): void {
  if (initialized) return
  initialized = true

  // Jaringan pulih → langsung kirim antrean
  void Network.addListener('networkStatusChange', ({ connected }) => {
    if (connected) void processSyncQueue()
  }).catch(() => {
    // Plugin tidak tersedia (web) → pakai event browser
    window.addEventListener('online', () => void processSyncQueue())
  })
  window.addEventListener('online', () => void processSyncQueue())

  // Polling berkala selama app terbuka
  window.setInterval(() => { if (navigator.onLine) void processSyncQueue() }, RETRY_INTERVAL_MS)

  // Keep-alive: sentuh status jaringan agar deteksi online di WebView akurat
  window.setInterval(() => { void Network.getStatus().catch(() => undefined) }, KEEP_ALIVE_MS)

  void processSyncQueue()
}

// ── Base URL server (read-only untuk petugas lapangan) ───────────────────────

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

/**
 * Mask URL server: sebagian tengah hostname disensor
 * contoh → https://apli…ray.app/api
 */
export function getMaskedApiUrl(): string {
  const url = getApiBaseUrl()
  try {
    const u = new URL(url)
    const host = u.hostname
    const hidden = host.length > 8
      ? `${host.slice(0, 4)}…${host.slice(-4)}`
      : `${host.slice(0, 2)}…${host.slice(-2)}`
    const path = u.pathname === '/' ? '' : u.pathname
    return `${u.protocol}//${hidden}${path}`
  } catch { return url }
}
