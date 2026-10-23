import { Geolocation, type Position } from '@capacitor/geolocation'
import { api, getApiBaseUrl as readApiBaseUrl } from './api'
import { getStoredDermaga, getStoredRoutes, refreshBackendSession, renewSessionIfNeeded } from './auth'
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
import type { Trip } from '../pages/store'
import { syncOnResume } from './adminPull'




const BASE_BACKOFF_MS = 15_000
const MAX_BACKOFF_MS = 600_000
const FAST_RETRY_NETWORK_MS = 2_000
const POLL_INTERVAL_MS = 20_000
const LOCK_TIMEOUT_MS = 120_000
const ITEM_TIMEOUT_MS = 90_000
const GEO_TIMEOUT_MS = 8_000
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
}




type QueueListener = (count: number) => void




type SyncedListener = (tripId: string) => void

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
  void dbCount('pending').then(n => {
    _pendingCount = n
    for (const l of [...queueListeners]) { try { l(n) } catch { /* ignore */ } }
  })
  void readQueue().then(q => { _queueCache = q }).catch(() => { /* ignore */ })
}




function notifySyncedListeners(tripId: string) {
  for (const l of [...syncedListeners]) { try { l(tripId) } catch { /* ignore */ } }
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
  const item: SyncItem = {
    syncId: existing?.syncId ?? `trip:${trip.id}:${createdAt}`,
    trip,
    attempts: existing?.attempts ?? 0,
    lastError: existing?.lastError,
    lastErrorCode: existing?.lastErrorCode,
    needsAttention: existing?.needsAttention,
    createdAt,
    lastAttemptAt: existing?.lastAttemptAt,
    photos: photos?.length ? photos : derivePhotos(trip),
    tripPhoto: tripPhoto ?? deriveTripPhoto(trip),
  }
  await writeItem(item)
  notifyQueueListeners()
  window.setTimeout(() => void processSyncQueue(), 150)
}




async function dbGetById(tripId: string): Promise<SyncItem | null> {
  const all = await readQueue()
  return all.find(i => i.trip.id === tripId) ?? null
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
    const item: SyncItem = {
      ...existing,
      trip,
      photos: derivePhotos(trip),
      tripPhoto: deriveTripPhoto(trip),
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
  void dbCount('pending').then(n => {
    _pendingCount = n
    try { cb(n) } catch { /* ignore */ }
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




async function getCurrentPositionSafe(): Promise<{ lat: number; lon: number } | null> {
  try {
    const pos: Position | null = await withTimeout<Position | null>(
      Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: GEO_TIMEOUT_MS, maximumAge: 60_000 }),
      GEO_TIMEOUT_MS + 1_000,
      null,
    )
    if (!pos?.coords) return null
    return { lat: pos.coords.latitude, lon: pos.coords.longitude }
  } catch {
    return null
  }
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
      clientTripId: trip.id,
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

    const res = await api.postMultipart<unknown>('/trips/complete', form)

    if (res.ok) {
      return { syncId, success: true }
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

    const permanent = !!code && /^4\d\d$/.test(code) && code !== '408' && code !== '401'
    return {
      syncId,
      success: false,
      error: res.error?.message ?? 'Server menolak payload',
      code,
      permanent,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Gagal upload'
    return { syncId, success: false, error: msg }
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
    notifySyncedListeners(item.trip.id)
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
    // invocations edge function per hari per perangkat, padahal tidak ada
    // satu byte pun yang perlu dikirim. Di free plan Supabase (500.000
    // invocations/bulan) ini dengan sendirinya menghabiskan kuota.
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
