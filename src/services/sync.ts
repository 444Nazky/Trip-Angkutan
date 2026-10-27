import { Geolocation, type Position } from '@capacitor/geolocation'
import { api, getApiBaseUrl as readApiBaseUrl } from './api'
import { getStoredDermaga, getStoredRoutes, refreshBackendSession, renewSessionIfNeeded } from './auth'
import { getLastKnownPosition } from './geofence'
import {
  initLocalDb as initLocalDb,
  dbAll,
  dbCount,
  dbDelete,
  dbPut,
  dbPutMany,
  metaGet,
  metaSet,
  requestPersistentStorage,
} from './localDb'
import type { Trip, VehicleEntry } from '../pages/store'
import { syncOnResume } from './adminPull'




const BASE_BACKOFF_MS = 15_000
const MAX_BACKOFF_MS = 600_000
const FAST_RETRY_NETWORK_MS = 2_000
const POLL_INTERVAL_MS = 20_000
const LOCK_TIMEOUT_MS = 120_000
const ITEM_TIMEOUT_MS = 90_000
// Timeout permintaan GPS saat butuh koordinat fallback untuk kendaraan.
// 8 detik -> sering gagal di lapangan (Timeout expired). 20 detik memberi
// cukup waktu bagi GPS chipset lock, tanpa menggantung upload.
const GEO_TIMEOUT_MS = 20_000
const PING_TTL_MS = 2_500
const PING_TIMEOUT_MS = 5_000
const ONLINE_RETRY_ATTEMPTS = 3
const ONLINE_RETRY_DELAY_MS = 700




export interface PhotoEntry {
  dataUrl: string
  mimeType: string
}




export interface SyncItem {
  syncId: string
  trip: Trip
  attempts: number
  lastError?: string
  lastErrorCode?: string
  needsAttention?: boolean
  createdAt: number
  lastAttemptAt?: number
  photos: PhotoEntry[]
  tripPhoto?: PhotoEntry
}




interface SyncResult {
  syncId: string
  success: boolean
  error?: string
  code?: string
  permanent?: boolean
  /** Base URL server yang MENERIMA trip ini (untuk ditampilkan ke petugas). */
  target?: string
}




type QueueListener = (count: number, queue: SyncItem[]) => void




type SyncedListener = (tripId: string, target?: string) => void

let queueListeners: QueueListener[] = []
let syncedListeners: SyncedListener[] = []
let _pendingCount = 0




let _pingOk = false
let _pingAt = 0
let _pinging: Promise<boolean> | null = null




let _syncing = false
let _lockDeadline = 0
let _lockWatchdog: ReturnType<typeof setTimeout> | null = null
let _retryTimer: ReturnType<typeof setTimeout> | null = null




let _initialized = false




function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}




function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    let done = false
    const timer = setTimeout(() => {
      if (done) return
      done = true
      resolve(fallback)
    }, ms)
    p.then(
      v => { if (!done) { done = true; clearTimeout(timer); resolve(v) } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(fallback) } },
    )
  })
}




function isNetworkError(err?: string): boolean {
  return !!err && /timeout|network|failed.to.fetch|terjangkau|offline|request.failed|ECONNREFUSED|ENOTFOUND|server tidak merespon|unreachable/i.test(err)
}




export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts - 1), MAX_BACKOFF_MS)
}




async function readQueue(): Promise<SyncItem[]> {
  const rows = await dbAll<SyncItem>('pending')
  return rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
}




async function writeItem(item: SyncItem): Promise<void> {
  await dbPut<SyncItem>('pending', item)
}




async function removeItem(syncId: string): Promise<void> {
  await dbDelete('pending', syncId)
}




export function notifyQueueListeners() {
  // Antrean ikut dikirim ke listener: UI memakai ISI antrean (bukan hanya
  // jumlahnya) untuk menentukan status kirim tiap trip. Kalau UI membaca
  // cache modul, ia bisa masih melihat antrean LAMA saat render pertama.
  void readQueue().then(q => {
    _queueCache = q
    _pendingCount = q.length
    for (const l of [...queueListeners]) { try { l(q.length, q) } catch { /* ignore */ } }
  }).catch(() => {
    void dbCount('pending').then(n => {
      _pendingCount = n
      for (const l of [...queueListeners]) { try { l(n, _queueCache) } catch { /* ignore */ } }
    })
  })
}




function notifySyncedListeners(tripId: string, target?: string) {
  for (const l of [...syncedListeners]) { try { l(tripId, target) } catch { /* ignore */ } }
}

const LEGACY_QUEUE_KEY = 'trip.syncQueue.v1'
const MIGRATION_KEY = 'sync.queue.migrated.v1'




function derivePhotos(trip: Trip): PhotoEntry[] {
  return (trip.vehicles ?? []).map(v => ({
    dataUrl: v.photoUrl ?? '',
    mimeType: 'image/jpeg',
  }))
}




function deriveTripPhoto(trip: Trip): PhotoEntry | undefined {
  return trip.photoUrl ? { dataUrl: trip.photoUrl, mimeType: 'image/jpeg' } : undefined
}




/** true bila entri foto benar-benar membawa data gambar. */
function hasPhotoData(p?: PhotoEntry): p is PhotoEntry {
  return !!p?.dataUrl && p.dataUrl.trim().length > 0
}




/**
 * Normalisasi plat untuk pencocokan: huruf besar, tanpa spasi/teguk.
 */
function plateKey(plate?: string): string {
  return String(plate ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Gabungkan daftar kendaraan state (baru) dengan daftar kendaraan yang
 * sudah ada di antrean (lama).
 *
 * Dua aturan, keduanya berakar dari gejala "kendaraan menghilang":
 *
 *   1. Daftar BARU tidak boleh lebih pendek dari daftar LAMA kalau state
 *      yang datang hanya metadata (foto dibuang dari cache localStorage).
 *      Dalam keadaan itu daftar lama dipertahankan — lengkap dengan fotonya.
 *   2. Pencocokan foto dilakukan per PLAT, bukan per index: urutan kendaraan
 *      bisa berubah (plat diedit, unit dihapus) dan pencocokan per index
 *      akan menempelkan foto unit yang salah.
 *
 * Kalau jumlah keduanya sama, itu berarti petugas hanya MENGEDIT platunit
 * yang sama — jadi posisinya yang jadi acuan (foto ikut unitnya).
 */
function mergeVehicleList(
  next: VehicleEntry[],
  prev: VehicleEntry[] = [],
): VehicleEntry[] {
  if (!prev.length) return next
  if (!next.length) return prev

  // Jumlah sama = daftar yang sama, plat bisa saja diedit -> cocok per index.
  if (next.length === prev.length) {
    return next.map((v, i) => {
      const old = prev[i]
      if (!old) return v
      return {
        ...v,
        photoUrl: v.photoUrl ?? old.photoUrl,
        photoCapturedAt: v.photoCapturedAt ?? old.photoCapturedAt,
        photoLatitude: v.photoLatitude ?? old.photoLatitude,
        photoLongitude: v.photoLongitude ?? old.photoLongitude,
      }
    })
  }

  // Jumlah berbeda: coralkan per plat, jangan sampai ada unit yang hilang.
  const used = new Set<number>()
  const merged: VehicleEntry[] = next.map((v, i) => {
    const key = plateKey(v.plate)
    let idx = prev.findIndex((p, j) => !used.has(j) && key && plateKey(p.plate) === key)
    if (idx < 0) {
      // Tanpa plat yang cocok -> pakai index kalau slotnya masih kosong.
      idx = prev.findIndex((_p, j) => !used.has(j) && j === i)
    }
    if (idx < 0) return v
    used.add(idx)
    const old = prev[idx]
    return {
      ...v,
      photoUrl: v.photoUrl ?? old.photoUrl,
      photoCapturedAt: v.photoCapturedAt ?? old.photoCapturedAt,
      photoLatitude: v.photoLatitude ?? old.photoLatitude,
      photoLongitude: v.photoLongitude ?? old.photoLongitude,
    }
  })
  // Unit lama yang tidak punya pasangan ikut dipertahankan (dengan fotonya).
  for (let j = 0; j < prev.length; j++) {
    if (used.has(j)) continue
    merged.push(prev[j])
  }
  return merged
}

/**
 * Susun ulang isi antrean supaya TIDAK PERNAH kehilangan kendaraan atau foto.
 *
 * kembalikan: trip (dengan kendaraan + foto), daftar foto kendaraan (sejajar
 * dengan `trip.vehicles`), dan foto bukti trip.
 */
function mergeQueuedTrip(
  next: Trip,
  prev?: SyncItem,
): { trip: Trip; photos: PhotoEntry[]; tripPhoto?: PhotoEntry } {
  const prevVehicles = prev?.trip?.vehicles ?? []
  const vehicles = mergeVehicleList(next.vehicles ?? [], prevVehicles)

  // Foto per kendaraan: pakai yang ada di state, kalau kosong ambil dari
  // antrean (cocok per plat, fallback per index).
  const prevPhotos = prev?.photos ?? []
  const photos: PhotoEntry[] = vehicles.map((v, i) => {
    const own = v.photoUrl
    if (hasPhotoData({ dataUrl: own ?? '', mimeType: 'image/jpeg' })) {
      return { dataUrl: own as string, mimeType: 'image/jpeg' }
    }
    const key = plateKey(v.plate)
    let idx = prevVehicles.findIndex((p, j) => {
      const prevPhoto = prevPhotos[j]?.dataUrl
      return !!prevPhoto && !!key && plateKey(p.plate) === key
    })
    // Tanpa plat yang cocok -> pakai posisi yang sama di antrean.
    if (idx < 0) idx = i < prevPhotos.length ? i : -1
    const fallback = idx >= 0 ? prevPhotos[idx] : undefined
    return {
      dataUrl: hasPhotoData(fallback) ? fallback.dataUrl : '',
      mimeType: 'image/jpeg',
    }
  })

  // Kembalikan foto ke dalam trip supaya isi antrean selalu konsisten:
  // `vehicles[i].photoUrl` = `photos[i].dataUrl`.
  const tripVehicles = vehicles.map((v, i) => ({
    ...v,
    photoUrl: photos[i].dataUrl || v.photoUrl,
  }))

  const tripPhoto = hasPhotoData({ dataUrl: next.photoUrl ?? '', mimeType: 'image/jpeg' })
    ? { dataUrl: next.photoUrl as string, mimeType: 'image/jpeg' }
    : prev?.tripPhoto

  return {
    trip: { ...next, vehicles: tripVehicles },
    photos,
    tripPhoto,
  }
}




async function migrateLegacyQueue(): Promise<void> {
  try {
    if (await metaGet(MIGRATION_KEY)) return
    const raw = localStorage.getItem(LEGACY_QUEUE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const rows = Array.isArray(parsed) ? parsed : []
      const items: SyncItem[] = []
      for (const row of rows) {
        const trip = row?.trip as Trip | undefined
        if (!trip?.id) continue
        const createdAt = Number(row.createdAt) || Date.now()
        items.push({
          syncId: `trip:${trip.id}:${createdAt}`,
          trip,
          attempts: Number(row.attempts) || 0,
          lastError: row.lastError,
          createdAt,
          lastAttemptAt: row.lastAttemptAt,
          photos: derivePhotos(trip),
          tripPhoto: deriveTripPhoto(trip),
        })
      }
      if (items.length) {
        const existing = new Set((await readQueue()).map(i => i.trip.id))
        const fresh = items.filter(i => !existing.has(i.trip.id))
        const ok = await dbPutMany<SyncItem>('pending', fresh)
        if (ok) localStorage.removeItem(LEGACY_QUEUE_KEY)
      } else {
        localStorage.removeItem(LEGACY_QUEUE_KEY)
      }
    }
    await metaSet(MIGRATION_KEY, Date.now())
    notifyQueueListeners()
  } catch (err) {
    console.warn('[sync] migrasi antrean lama gagal (dicoba lagi nanti):', err)
  }
}




export async function addToSyncQueue(
  trip: Trip,
  photos?: PhotoEntry[],
  tripPhoto?: PhotoEntry,
): Promise<void> {
  await initLocalDb()
  const existing = (await dbGetById(trip.id))
  const createdAt = existing?.createdAt ?? Date.now()

  // Foto dari parameter (kamera) adalah yang paling baru — pakai dulu.
  // Kalau parameter tidak membawa foto, ambil dari state trip; kalau tetap
  // kosong, pertahankan salinan di antrean.
  const incomingPhotos = photos?.length ? photos : derivePhotos(trip)
  const withPhotos: Trip = {
    ...trip,
    vehicles: (trip.vehicles ?? []).map((v, i) => {
      const dataUrl = incomingPhotos[i]?.dataUrl
      return dataUrl ? { ...v, photoUrl: dataUrl } : v
    }),
  }
  const incomingTripPhoto = hasPhotoData(tripPhoto)
    ? tripPhoto
    : (hasPhotoData(deriveTripPhoto(trip)) ? deriveTripPhoto(trip) : undefined)

  // Gabungkan dengan isi antrean lama: daftar kendaraan dan foto tidak boleh
  // pernah hilang hanya karena state yang dipakai hanya metadata.
  const merged = mergeQueuedTrip(withPhotos, existing ?? undefined)

  const item: SyncItem = {
    syncId: existing?.syncId ?? `trip:${trip.id}:${createdAt}`,
    trip: merged.trip,
    attempts: existing?.attempts ?? 0,
    lastError: existing?.lastError,
    lastErrorCode: existing?.lastErrorCode,
    needsAttention: existing?.needsAttention,
    createdAt,
    lastAttemptAt: existing?.lastAttemptAt,
    photos: merged.photos,
    // Foto trip hanya boleh diganti oleh foto BARU yang berisi data; kalau
    // tidak ada, pertahankan salinan yang sudah ada di antrean.
    tripPhoto: incomingTripPhoto ?? existing?.tripPhoto,
  }
  await writeItem(item)
  notifyQueueListeners()
  window.setTimeout(() => void processSyncQueue(), 150)
}




async function dbGetById(tripId: string): Promise<SyncItem | null> {
  const all = await readQueue()
  return all.find(i => i.trip.id === tripId) ?? null
}




/**
 * Foto yang masih tersimpan di antrean sinkronisasi untuk sebuah trip.
 *
 * Antrean (`pending`) menyimpan data URL foto secara UTUH — berbeda dari cache
 * metadata `localStorage` yang membuangnya. Kalau store `trips` kehilangan foto
 * (penulisan IndexedDB gagal, mis. kuota penuh), antrean adalah salinan terakhir
 * yang bisa dipakai memulihkan foto di halaman Riwayat dan memastikan upload
 * tetap membawa blob foto yang valid.
 */
export interface QueuedPhotos {
  /** Foto kendaraan; index-nya sejajar dengan `vehicles` pada trip di antrean. */
  vehiclePhotos: Array<string | undefined>
  tripPhotoUrl?: string
  selfieUrl?: string
}

/** Foto sebuah trip dari antrean sync. `null` = antrean tidak punya fotonya. */
export async function readQueuedPhotos(tripId: string): Promise<QueuedPhotos | null> {
  try {
    await initLocalDb()
    const item = await dbGetById(tripId)
    if (!item) return null
    const vehiclePhotos = (item.photos ?? []).map(p => (hasPhotoData(p) ? p.dataUrl : undefined))
    const tripPhotoUrl = hasPhotoData(item.tripPhoto) ? item.tripPhoto.dataUrl : undefined
    const selfieUrl = typeof item.trip?.selfieUrl === 'string' ? item.trip.selfieUrl : undefined
    if (!vehiclePhotos.some(Boolean) && !tripPhotoUrl && !selfieUrl) return null
    return { vehiclePhotos, tripPhotoUrl, selfieUrl }
  } catch {
    return null
  }
}

/** Paksa muat ulang antrean + kabari semua listener (setelah kirim ulang manual). */
export function refreshSyncQueue(): void {
  notifyQueueListeners()
}



export function getPendingCount(): number { return _pendingCount }




export async function retrySyncItem(trip: Trip): Promise<void> {
  try {
    await initLocalDb()
    const existing = await dbGetById(trip.id)
    if (!existing) {
      await addToSyncQueue(trip, derivePhotos(trip), deriveTripPhoto(trip))
      return
    }
    // Gabungkan state yang baru dengan isi antrean lama. State bisa saja
    // hanya metadata (foto dibuang dari cache localStorage) atau kehilangan
    // daftar kendaraan — tanpa penggabungan ini, satu aksi "Simpan & Kirim"
    // akan menghapus kendaraan/foto dari antrean dan trip terkirim tanpa
    // dokumen (gejala "kendaraan menghilang" di dashboard admin).
    const merged = mergeQueuedTrip(trip, existing ?? undefined)
    const item: SyncItem = {
      ...existing,
      trip: merged.trip,
      photos: merged.photos,
      tripPhoto: merged.tripPhoto,
      attempts: 0,
      lastError: undefined,
      lastErrorCode: undefined,
      needsAttention: false,
      lastAttemptAt: undefined,
    }
    await writeItem(item)
    notifyQueueListeners()
    window.setTimeout(() => void processSyncQueue(), 150)
  } catch (err) {
    console.warn('[sync] retrySyncItem gagal:', err)
  }
}




export function getSyncQueue(): SyncItem[] { return _queueCache }

let _queueCache: SyncItem[] = []
void readQueue().then(q => { _queueCache = q }).catch(() => { /* ignore */ })




export function onSyncQueueChange(cb: QueueListener): () => void {
  queueListeners.push(cb)
  void readQueue().then(q => {
    _queueCache = q
    _pendingCount = q.length
    try { cb(q.length, q) } catch { /* ignore */ }
  })
  return () => { queueListeners = queueListeners.filter(x => x !== cb) }
}




export function onTripSynced(cb: SyncedListener): () => void {
  syncedListeners.push(cb)
  return () => { syncedListeners = syncedListeners.filter(x => x !== cb) }
}



// ─── Notifikasi kegagalan kirim ───────────────────────────────────────────────

/**
 * Event global + listener untuk memberitahu UI bahwa sebuah trip GAGAL dikirim.
 *
 * Dulu kegagalan upload hanya terlihat dari state antrean di layar "Trip
 * Tercatat" / "Riwayat". Petugas yang menutup layar atau berada di tab lain
 * bisa saja mengira trip sudah masuk ke server — persis keluhan "tapi
 * aplikasi bilang berhasil terkirim". Sekarang setiap kegagalan memunculkan
 * notifikasi eksplisit berisi alasannya.
 */
export const SYNC_FAILURE_EVENT = 'trip:sync-failure'

export interface SyncFailureDetail {
  /** ID trip lokal (client_trip_id) yang gagal dikirim. */
  tripId: string
  /** Alasan yang layak ditampilkan ke petugas. */
  error: string
  /** Kode/status HTTP bila ada (mis. "400", "NETWORK"). */
  code?: string
  /** true = kegagalan permanen (percobaan ulang tanpa perubahan data tak akan menolong). */
  permanent: boolean
  /** Jumlah percobaan kirim yang sudah dilakukan. */
  attempts: number
}

type SyncFailureListener = (detail: SyncFailureDetail) => void

const failureListeners: SyncFailureListener[] = []

/** Daftar listener kegagalan kirim. Return: fungsi unsubscribe. */
export function onSyncFailure(cb: SyncFailureListener): () => void {
  failureListeners.push(cb)
  return () => {
    const i = failureListeners.indexOf(cb)
    if (i >= 0) failureListeners.splice(i, 1)
  }
}

function notifySyncFailure(detail: SyncFailureDetail): void {
  for (const l of [...failureListeners]) {
    try { l(detail) } catch { /* listener yang error tidak boleh mengganggu antrean */ }
  }
  try {
    window.dispatchEvent(new CustomEvent(SYNC_FAILURE_EVENT, { detail }))
  } catch { /* lingkungan tanpa DOM */ }
}



// ─── Status sinkronisasi satu trip ─────────────────────────────────────────────

export type TripSyncState = 'synced' | 'pending' | 'failed' | 'local'

export interface TripSyncStatus {
  state: TripSyncState
  item?: SyncItem
  /** Alasan kegagalan (hanya untuk state 'failed'). */
  error?: string
  /** Jumlah percobaan kirim. */
  attempts: number
}

/**
 * Status sinkronisasi satu trip — SATU sumber kebenaran untuk semua layar.
 *
 * previously tiap layar menebak sendiri dari `trip.synced`, sehingga trip yang
 * GAGAL kirim tetap terbaca "menunggu" (kuning) bahkan setelah server
 * menolaknya dengan 4xx. Fungsi ini memakai antrean sebagai sumber utama:
 *   - ada di antrean + needsAttention -> 'failed' (merah, GAGAL TERKIRIM)
 *   - ada di antrean                 -> 'pending' (kuning, menunggu)
 *   - tidak ada di antrean + synced  -> 'synced' (hijau, benar-benar terkirim)
 *   - tidak ada di antrean + belum   -> 'local' (abu, perlu kirim ulang manual)
 */
export function classifyTripSync(
  tripId: string,
  synced: boolean | undefined,
  queue: SyncItem[],
): TripSyncStatus {
  const item = queue.find(q => q?.trip?.id === tripId)
  if (item) {
    if (item.needsAttention) {
      return {
        state: 'failed',
        item,
        error: item.lastError ?? 'Server menolak data trip',
        attempts: item.attempts ?? 0,
      }
    }
    return { state: 'pending', item, error: item.lastError, attempts: item.attempts ?? 0 }
  }
  if (synced === true) return { state: 'synced', attempts: 0 }
  return { state: 'local', attempts: 0 }
}




export async function probeServer(force = false): Promise<boolean> {
  if (_pinging && !force) return _pinging
  if (!force && Date.now() - _pingAt < PING_TTL_MS) return _pingOk

  const p = (async () => {
    const ok = await api.ping(PING_TIMEOUT_MS)
    _pingOk = ok
    _pingAt = Date.now()
    return ok
  })()
  _pinging = p
  try {
    return await p
  } finally {
    if (_pinging === p) _pinging = null
  }
}




function normalizeSource(raw?: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (s.startsWith('data:')) return s
  if (/^(https?|blob|content|file):/i.test(s)) return s
  if (/^[A-Za-z0-9+/=\s]{64,}$/.test(s)) return `data:image/jpeg;base64,${s.replace(/\s/g, '')}`
  return s
}




function dataUrlToBlobManual(dataUrl: string): Blob | null {
  try {
    const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(dataUrl)
    if (!m) return null
    const type = m[1] || 'image/jpeg'
    if (m[2]) {
      const bin = atob(m[3].replace(/\s/g, ''))
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return new Blob([bytes], { type })
    }
    return new Blob([decodeURIComponent(m[3])], { type })
  } catch {
    return null
  }
}

const OK_MIME = /^image\/(jpeg|png|webp)$/i




async function toImageBlob(raw?: string): Promise<Blob | null> {
  const src = normalizeSource(raw)
  if (!src) return null
  let blob: Blob | null = null
  // ponytail: untuk data: URL decode manual JAUH lebih cepat daripada
  // fetch(dataUrl) di WebView Android (tidak lewat network stack).
  if (src.startsWith('data:')) {
    blob = dataUrlToBlobManual(src)
  } else {
    try {
      const res = await fetch(src)
      blob = await res.blob()
    } catch {
      blob = null
    }
  }
  if (!blob || blob.size === 0) return null
  if (!OK_MIME.test(blob.type)) blob = new Blob([blob], { type: 'image/jpeg' })
  return blob
}




function photoFileName(blob: Blob, index: number): string {
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  return `photo-${index}.${ext}`
}




export function resolveRoute(trip: Trip): { routeFrom: string | null; routeTo: string | null; routeCode: string | null } {
  let cached: ReturnType<typeof getStoredRoutes> = []
  try { cached = getStoredRoutes() } catch { cached = [] }

  const code = (trip as Trip & { routeCode?: string }).routeCode?.trim()
  if (code) {
    const hit = cached.find(r => r.code === code)
    if (hit) return { routeFrom: hit.from, routeTo: hit.to, routeCode: hit.code }
    const i = code.lastIndexOf('-')
    if (i > 0 && i < code.length - 1) {
      return { routeFrom: code.slice(0, i).trim(), routeTo: code.slice(i + 1).trim(), routeCode: code }
    }
  }

  const explicitFrom = (trip as Trip & { routeFrom?: string }).routeFrom
  const explicitTo = (trip as Trip & { routeTo?: string }).routeTo
  if (explicitFrom && explicitTo) {
    return { routeFrom: explicitFrom, routeTo: explicitTo, routeCode: `${explicitFrom}-${explicitTo}` }
  }

  const raw = (trip.route ?? '').trim()
  if (!raw) return { routeFrom: null, routeTo: null, routeCode: null }

  const byCode = cached.find(r => r.code === raw)
  if (byCode) return { routeFrom: byCode.from, routeTo: byCode.to, routeCode: byCode.code }
  const byLabel = cached.find(r => r.label === raw || `${r.from} → ${r.to}` === raw)
  if (byLabel) return { routeFrom: byLabel.from, routeTo: byLabel.to, routeCode: byLabel.code }

  const dash = raw.lastIndexOf('-')
  if (dash > 0 && dash < raw.length - 1 && !/[\s→–—]/.test(raw)) {
    return { routeFrom: raw.slice(0, dash).trim(), routeTo: raw.slice(dash + 1).trim(), routeCode: raw }
  }

  const sep = /\s*(?:→|->|—|–|-)\s*/.exec(raw)
  if (sep && sep.index > 0) {
    const from = raw.slice(0, sep.index).trim()
    const to = raw.slice(sep.index + sep[0].length).trim()
    if (from && to) return { routeFrom: from, routeTo: to, routeCode: `${from}-${to}` }
  }

  return { routeFrom: null, routeTo: null, routeCode: null }
}




/**
 * Ambil koordinat untuk kendaraan yang foto-nya tidak membawa GPS.
 *
 * PENTING: ini HANYA fallback. Koordinat asli diambil dari metadata foto
 * (v.photoLatitude). Yang di sini hanya dipakai kalau foto tidak punya
 * koordinat — jadi tidak boleh menunda pengiriman lebih dari perlu.
 *
 * urutan:
 *   1. fix terakhir yang sudah diketahui (watch GPS / cache) -> instan,
 *   2. permintaan GPS dengan timeout wajar.
 */
async function getCurrentPositionSafe(): Promise<{ lat: number; lon: number } | null> {
  // 1. Fix yang sudah ada di perangkat (watch GPS) -> tanpa jaringan.
  const last = getLastKnownPosition()
  if (last) return { lat: last.lat, lon: last.lng }

  // 2. Permintaan GPS. Timeout 8 detik dulu -> sering "Timeout expired" di
  //    lapangan. Sekarang 20 detik; batas luar (withTimeout) tetap menjaga
  //    supaya upload tidak menggantung lebih lama dari itu.
  try {
    const pos: Position | null = await withTimeout<Position | null>(
      Geolocation.getCurrentPosition({
        enableHighAccuracy: true,
        timeout: GEO_TIMEOUT_MS,
        maximumAge: 60_000,
      }),
      GEO_TIMEOUT_MS + 1_000,
      null,
    )
    if (!pos?.coords) return null
    return { lat: pos.coords.latitude, lon: pos.coords.longitude }
  } catch {
    return null
  }
}




/**
 * Bentuk jawaban server untuk `POST /trips/complete`.
 *
 * `vehicleCount` / `photoCount` dipakai sebagai KONFIRMASI: server baru
 * mengirimkannya kalau seluruh kendaraan & foto benar-benar tersimpan. Kalau
 * angkanya tidak cocok, data di server tidak utuh dan trip TIDAK boleh
 * dianggap terkirim.
 */
export interface TripCompleteAck {
  id?: string
  noTrip?: string
  updated?: boolean
  vehicleCount?: number
  photoCount?: number
}

/**
 * Periksa apakah jawaban server benar-benar mengonfirmasi trip tersimpan.
 *
 * Ini yang mencegah gejala "notifikasi berhasil terkirim tapi data tidak ada
 * di dashboard admin": status HTTP 2xx saja TIDAK cukup — server wajib
 * mengembalikan nomor trip, dan kalau ia melaporkan jumlah kendaraan/foto,
 * angka itu harus sama dengan yang dikirim.
 */
export function verifyTripAcknowledgement(
  data: unknown,
  expectedVehicles: number,
  expectedPhotos: number,
): { ok: true } | { ok: false; error: string } {
  if (!data || typeof data !== 'object') {
    return {
      ok: false,
      error: 'Server tidak mengonfirmasi trip tersimpan — periksa endpoint server yang dipakai',
    }
  }
  const ack = data as TripCompleteAck
  const noTrip = typeof ack.noTrip === 'string' ? ack.noTrip.trim() : ''
  if (!noTrip) {
    return {
      ok: false,
      error: 'Server tidak mengonfirmasi trip tersimpan (nomor trip tidak ada) — periksa endpoint server yang dipakai',
    }
  }
  if (typeof ack.vehicleCount === 'number' && ack.vehicleCount !== expectedVehicles) {
    return {
      ok: false,
      error: `Server hanya menyimpan ${ack.vehicleCount} dari ${expectedVehicles} kendaraan — trip dikirim ulang`,
    }
  }
  if (typeof ack.photoCount === 'number' && ack.photoCount !== expectedPhotos) {
    return {
      ok: false,
      error: `Server hanya menyimpan ${ack.photoCount} dari ${expectedPhotos} foto dokumentasi — trip dikirim ulang`,
    }
  }
  return { ok: true }
}



async function postTripToServer(item: SyncItem, allowReauth = true): Promise<SyncResult> {
  const { syncId, trip } = item
  try {
    const blobs: Blob[] = []
    const pushPhoto = async (raw?: string): Promise<number | null> => {
      const blob = await toImageBlob(raw)
      if (!blob) return null
      const idx = blobs.length
      blobs.push(blob)
      return idx
    }

    const tripPhotoRaw = item.tripPhoto?.dataUrl ?? trip.photoUrl
    const tripPhotoIdx = await pushPhoto(tripPhotoRaw)

    // Swafoto (foto petugas) dikirim sebagai foto tambahan pada trip.
    const selfieIdx = await pushPhoto(trip.selfieUrl ?? undefined)

    const hasLoad = (trip.vehicles?.length ?? 0) > 0
      ? trip.vehicles!.some(v => v.load !== 'empty')
      : trip.load === 'Ada Muatan'

    interface VehiclePayload {
      noPolisi: string
      vehicleType: string
      /** Golongan master tarif (I..V). */
      golongan: string
      /** Kategori operasional (Internal / Eksternal / Lokal) — penentu tarif. */
      kategori: string
      hasLoad: boolean
      photoIndex: number | null
      photoCapturedAt: string | null
      latitude: number | null
      longitude: number | null
      tariffAmount: number
    }

    const vehicles: VehiclePayload[] = []
    const vehiclesList = trip.vehicles ?? []
    // ponytail: GPS diambil SATU KALI untuk semua kendaraan. Dulu tiap
    // kendaraan tanpa koordinat memanggil getCurrentPosition() (timeout 8
    // detik) secara SEKUENSIAL -> 3 kendaraan = 24 detik extra sebelum
    // request terkirim.
    let sharedGeo: { lat: number; lon: number } | null | undefined
    const ensureGeo = async (): Promise<{ lat: number; lon: number } | null> => {
      if (sharedGeo === undefined) sharedGeo = await getCurrentPositionSafe()
      return sharedGeo
    }
    for (let i = 0; i < vehiclesList.length; i++) {
      const v = vehiclesList[i]
      const vi = await pushPhoto(item.photos?.[i]?.dataUrl || v.photoUrl)
      let lat: number | null = v.photoLatitude ?? null
      let lon: number | null = v.photoLongitude ?? null
      if (lat == null || lon == null) {
        const geo = await ensureGeo()
        if (geo) { lat = geo.lat; lon = geo.lon }
      }
      vehicles.push({
        noPolisi: v.plate,
        vehicleType: v.type,
        // Golongan master tarif — TIDAK boleh diisi kategori, supaya lookup
        // tarif master tidak meleset.
        golongan: v.golongan ?? '',
        // Kategori operasional (Internal/Eksternal/Lokal) dikirim terpisah;
        // backend memakai ini untuk menentukan tarif (Internal = Rp 0).
        kategori: v.category ?? '',
        hasLoad: v.load ? v.load === 'loaded' : hasLoad,
        photoIndex: vi,
        photoCapturedAt: v.photoCapturedAt ?? null,
        latitude: lat,
        longitude: lon,
        tariffAmount: v.tariff ?? 0,
      })
    }

    if (tripPhotoIdx === null || vehicles.some(v => v.photoIndex === null)) {
      return {
        syncId,
        success: false,
        error: 'Foto dokumentasi tidak lengkap — ambil ulang dari Riwayat',
        code: 'PHOTO_MISSING',
        permanent: true,
      }
    }

    const { routeFrom, routeTo, routeCode } = resolveRoute(trip)

    const payload = {
      // Kunci idempoten: UUID per trip (lihat Trip.clientTripId). Fallback ke
      // id lama supaya trip yang dibuat sebelum perubahan ini tetap punya
      // kunci.
      clientTripId: trip.clientTripId ?? trip.id,
      statusMuatan: hasLoad ? 'muatan' : 'kosong',
      routeFrom,
      routeTo,
      route: routeCode ?? trip.route ?? null,
      routeCode: routeCode ?? null,
      keterangan: trip.category && trip.category !== '-' ? trip.category : null,
      tripPhotoIndex: tripPhotoIdx,
      selfieIndex: selfieIdx,
      selfieCapturedAt: trip.selfieCapturedAt ?? null,
      tripPhotoCapturedAt: trip.photoCapturedAt ?? null,
      tripPhotoLatitude: trip.photoLatitude ?? null,
      tripPhotoLongitude: trip.photoLongitude ?? null,
      startedAt: trip.startedAt ?? null,
      completedAt: trip.completedAt ?? null,
      vehicles,
    }

    const form = new FormData()
    form.append('payload', JSON.stringify(payload))
    blobs.forEach((blob, i) => form.append('photos', blob, photoFileName(blob, i)))

    const dermagaId = getStoredDermaga()?.id
    if (dermagaId) form.append('dermagaId', String(dermagaId))

    const res = await api.postMultipart<TripCompleteAck>('/trips/complete', form)

    if (res.ok) {
      // Server boleh membalas 2xx, tapi itu BELUM tentu berarti datanya
      // tersimpan. Endpoint yang salah (mis. backend lain yang kebalas 200
      // dengan body kosong) dulu dianggap "sukses" -> petugas melihat
      // "berhasil terkirim" padahal tidak ada apa pun di dashboard admin.
      //
      // Jadi respons server WAJIB mengonfirmasi trip: ada nomor trip, dan
      // (kalau ada) jumlah kendaraan & foto harus sama dengan yang dikirim.
      const confirm = verifyTripAcknowledgement(res.data, vehicles.length, blobs.length)
      if (!confirm.ok) {
        return {
          syncId,
          success: false,
          error: confirm.error,
          code: 'NOT_CONFIRMED',
        }
      }
      return { syncId, success: true, target: readApiBaseUrl() }
    }

    const code = res.error?.code
    if (code === '401' && allowReauth) {
      // 401 = token DITOLAK server. Satu-satunya jalan keluar adalah login
      // ulang dari PIN tersimpan (refreshBackendSession). Jangan fallback ke
      // ensureBackendSession — ia hanya cek ADA token di storage, bukan
      // validitasnya, sehingga token basi lolos dan retry 401 lagi lalu trip
      // terkunci "permanent" di antrean. Kalau login ulang gagal (credentials
      // kosong), biarkan item RETRYABLE — petugas masuk lewat layar login
      // dan force sync berikutnya akan menyelamatkan trip.
      const ok = await refreshBackendSession()
      if (ok) return postTripToServer(item, false)
      return {
        syncId,
        success: false,
        error: 'Sesi autentikasi berakhir — login ulang lalu ketuk sinkronisasi',
        code,
      }
    }

    // 4xx = server menolak payload (permanen, retry tanpa ubah data tak akan
    // menolong). 5xx = masalah server/sesi -> tetap retry.
    const permanent = !!code && /^4\d\d$/.test(code) && code !== '408' && code !== '401'

    // Pesan galat server HARUS ikut ditampilkan utuh. Dulu_generic "Server
    // menolak payload" membuat petugas tidak tahu apa yang salah; sekarang
    // status HTTP + pesan server ikut dibawa ke UI.
    const serverMessage = (res.error?.message ?? '').trim()
    const error = serverMessage
      ? `Server menolak (HTTP ${code ?? '?'}): ${serverMessage}`
      : `Server menolak permintaan (HTTP ${code ?? '?'}) — data BELUM masuk dashboard admin`

    return {
      syncId,
      success: false,
      error,
      code,
      permanent,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Gagal upload'
    return { syncId, success: false, error: `Gagal mengirim trip: ${msg}` }
  }
}




function isSyncBusy(): boolean {
  if (!_syncing) return false
  if (Date.now() > _lockDeadline) {
    console.warn('[sync] Watchdog: kunci proses kedaluwarsa → dilepas paksa')
    releaseLock()
    return false
  }
  return true
}




function acquireLock(): void {
  _syncing = true
  _lockDeadline = Date.now() + LOCK_TIMEOUT_MS
  if (_lockWatchdog) clearTimeout(_lockWatchdog)
  _lockWatchdog = setTimeout(() => {
    if (!_syncing) return
    console.warn('[sync] Watchdog: proses sinkron menggantung → kunci dilepas')
    releaseLock()
    scheduleRetry(FAST_RETRY_NETWORK_MS)
    notifyQueueListeners()
  }, LOCK_TIMEOUT_MS + 1_000)
}




function releaseLock(): void {
  _syncing = false
  _lockDeadline = 0
  if (_lockWatchdog) { clearTimeout(_lockWatchdog); _lockWatchdog = null }
}




function scheduleRetry(delayMs = POLL_INTERVAL_MS): void {
  if (_retryTimer) clearTimeout(_retryTimer)
  _retryTimer = setTimeout(() => {
    _retryTimer = null
    void processSyncQueue()
  }, delayMs)
}




async function processItem(item: SyncItem, retryAll = false): Promise<void> {
  // Item yang sudah ditandai butuh perhatian (mis. foto tidak lengkap)
  // tidak diulang otomatis tanpa perubahan data — cegah churn antrean.
  // Pengulangan manual (syncNow / setelah foto diambil) memakai retryAll.
  if (item.needsAttention && !retryAll) return

  const last = item.lastAttemptAt ?? 0
  const elapsed = Date.now() - last
  const wait = item.needsAttention ? MAX_BACKOFF_MS : backoffMs(item.attempts)

  if (!retryAll && item.attempts > 0 && elapsed < wait && !isNetworkError(item.lastError)) {
    return
  }

  const result = await withTimeout(
    postTripToServer(item),
    ITEM_TIMEOUT_MS,
    { syncId: item.syncId, success: false, error: 'Server tidak merespon (timeout)' } as SyncResult,
  )

  if (result.success) {
    await removeItem(item.syncId)
    notifyQueueListeners()
    // Target ikut dilaporkan: petugas bisa memastikan trip-nya masuk ke
    // server yang sama dengan yang dipakai dashboard admin.
    notifySyncedListeners(item.trip.id, result.target)
    return
  }

  const updated: SyncItem = {
    ...item,
    attempts: item.attempts + 1,
    lastAttemptAt: Date.now(),
    lastError: result.error ?? (result.code ? `HTTP ${result.code}` : 'Unknown error'),
    lastErrorCode: result.code,
    needsAttention: result.permanent ? true : item.needsAttention,
  }
  await writeItem(updated)

  // Beri tahu UI: trip ini GAGAL dikirim. Tanpa notifikasi ini petugas bisa
  // saja melihat "berhasil terkirim" di tempat lain aplikasi.
  notifySyncFailure({
    tripId: item.trip.id,
    error: updated.lastError ?? 'Gagal mengirim trip ke server',
    code: result.code,
    permanent: updated.needsAttention === true,
    attempts: updated.attempts,
  })

  const fastRetry = isNetworkError(updated.lastError) && updated.attempts < 4
  scheduleRetry(fastRetry ? FAST_RETRY_NETWORK_MS : backoffMs(updated.attempts))
  notifyQueueListeners()
}




async function ensureSessionForQueue(): Promise<boolean> {
  try {
    return await renewSessionIfNeeded()
  } catch {
    return api.isAuthenticated
  }
}




export async function processSyncQueue(opts?: { retryAll?: boolean }): Promise<void> {
  if (isSyncBusy()) return
  acquireLock()

  try {
    // Antrean kosong -> jangan sentuh server sama sekali.
    //
    // DULU probeServer() dipanggil paling dulu, sehingga setiap perangkat
    // yang idle tetap menembak GET /health tiap 20 detik (PING_TTL_MS hanya
    // 2,5 detik, jadi cache pings-nya selalu kedaluwarsa). Itu 4.320
    // request per hari per perangkat, padahal tidak ada satu byte pun yang
    // perlu dikirim. Sekarang server tidak disentuh selama antrean kosong.
    const items = await readQueue()
    _queueCache = items
    if (items.length === 0) {
      _pendingCount = 0
      notifyQueueListeners()
      return
    }

    // Baru setelah dipastikan ada yang mau dikirim, baru cek server.
    const reachable = await probeServer()
    if (!reachable) {
      scheduleRetry(POLL_INTERVAL_MS)
      return
    }

    const sessionOk = await ensureSessionForQueue()
    if (!sessionOk) {
      scheduleRetry(MAX_BACKOFF_MS)
      return
    }

    for (const item of items) {
      // Tidak ada probe per item lagi: kalau server mati di tengah siklus,
      // processItem sudah menangani error jaringan + backoff sendiri. Probe
      // per item menambah 1 request untuk setiap antrean entry.
      await processItem(item, opts?.retryAll ?? false)
    }
  } catch (err) {
    console.warn('[sync] siklus terputus:', err)
  } finally {
    releaseLock()
    notifyQueueListeners()
    void readQueue().then(q => { _queueCache = q }).catch(() => { /* ignore */ })
  }
}




async function handleConnectionRestored(): Promise<void> {
  for (let i = 0; i < ONLINE_RETRY_ATTEMPTS; i++) {
    if (await probeServer(true)) {
      void syncOnResume(true)
      await processSyncQueue()
      return
    }
    if (i < ONLINE_RETRY_ATTEMPTS - 1) await sleep(ONLINE_RETRY_DELAY_MS)
  }
  scheduleRetry(POLL_INTERVAL_MS)
}




export function initializeSync(): void {
  if (_initialized) return
  _initialized = true

  void syncOnResume()

  void initLocalDb().then(async () => {
    await migrateLegacyQueue()
    void requestPersistentStorage()
    window.setTimeout(() => void processSyncQueue(), 1_200)
  })

  window.addEventListener('online', () => { void handleConnectionRestored() })
  window.addEventListener('offline', () => {
    _pingOk = false
    _pingAt = 0
    notifyQueueListeners()
  })

  window.setInterval(() => { void processSyncQueue() }, POLL_INTERVAL_MS)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void processSyncQueue()
  })
}




export async function syncNow(): Promise<{ synced: number; failed: number; busy?: boolean; reachable?: boolean }> {
  const before = await dbCount('pending')
  if (isSyncBusy()) return { synced: 0, failed: before, busy: true }

  const reachable = await probeServer(true)
  if (!reachable) {
    return { synced: 0, failed: before, reachable: false }
  }

  await processSyncQueue({ retryAll: true })
  const after = await dbCount('pending')
  _pendingCount = after
  notifyQueueListeners()
  return { synced: Math.max(0, before - after), failed: after, reachable: true }
}




export function getApiBaseUrl(): string { return readApiBaseUrl() }
