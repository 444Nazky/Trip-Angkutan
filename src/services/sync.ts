// ────────────────────────────────────────────────────────────────────────────
// SYNC SERVICE — Offline-First Trip Upload (arsitektur v3)
//
// Prinsip yang dijaga di sini:
//
// 1. PERSISTENSI — Antrean disimpan di IndexedDB (localDb.ts), TIDAK PERNAH
//    dihapus saat app ditutup / direstart / di-refresh. localStorage hanya
//    dipakai sebagai fallback bila IndexedDB tidak tersedia.
// 2. KONFIRMASI SERVER — Satu-satunya alasan item keluar dari antrean adalah
//    respon sukses HTTP 200/201 dari backend (`POST /trips/complete`),
//    artinya trip + rute + foto bukti sudah diterima & tampil di dashboard.
//    Gagal/timeout/error = item TETAP tersimpan.
// 3. VERIFIKASI KONEKSI AKTIF — `navigator.onLine` sering menipu di webview,
//    jadi sebelum antrean diproses selalu dilakukan ping ringan ke
//    `/api/health`. Koneksi pulih → antrean diproses dalam hitungan detik.
// 4. ANTI-STUCK — Kunci `syncInProgress` punya watchdog: bila satu siklus
//    macet (timeout/hang), kunci dilepas paksa sehingga antrean tidak pernah
//    terkunci selamanya di status "masih menunggu koneksi".
// 5. RETRY CERDAS — Exponential backoff bertingkat + re-authenticasi token
//    otomatis saat sesi kedaluwarsa (HTTP 401). Item TIDAK PERNAH dibuang.
//────────────────────────────────────────────────────────────────────────────

import { Geolocation, type Position } from '@capacitor/geolocation'
import { api, getApiBaseUrl as readApiBaseUrl } from './api'
import { ensureBackendSession, getStoredDermaga, getStoredRoutes, renewSessionIfNeeded } from './auth'
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

// ── Config ───────────────────────────────────────────────────────────────────
const BASE_BACKOFF_MS = 15_000        // backoff dasar 15 dtk, x2 per percobaan
const MAX_BACKOFF_MS = 600_000        // maksimal 10 menit (antrean tak pernah dibuang)
const FAST_RETRY_NETWORK_MS = 2_000   // retry cepat utk error jaringan (< 2 dtk)
const POLL_INTERVAL_MS = 20_000       // polling latar sebagai jaring pengaman
const LOCK_TIMEOUT_MS = 120_000       // watchdog: paksa lepas kunci setelah 2 mnt
const ITEM_TIMEOUT_MS = 90_000        // batas waktu per item agar loop tak menggantung
const GEO_TIMEOUT_MS = 8_000          // batas waktu ambil lokasi saat membangun payload
const PING_TTL_MS = 2_500             // hasil ping dipakai ulang 2.5 dtk
const PING_TIMEOUT_MS = 5_000         // batas waktu ping kesehatan server
const ONLINE_RETRY_ATTEMPTS = 3       // percobaan ping saat event 'online' masuk
const ONLINE_RETRY_DELAY_MS = 700     // jeda antar percobaan event 'online'

// ── Types ────────────────────────────────────────────────────────────────────
export interface PhotoEntry {
  dataUrl: string
  mimeType: string
}

export interface SyncItem {
  /** Kunci unik di IndexedDB (keyPath 'syncId') */
  syncId: string
  trip: Trip
  attempts: number
  lastError?: string
  lastErrorCode?: string
  /** true → error non-jaringan (mis. foto hilang) — perlu campur tangan petugas */
  needsAttention?: boolean
  createdAt: number
  lastAttemptAt?: number
  /** Foto kendaraan saat antrean dibuat (cadangan bila trip.photoUrl berubah) */
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

// ── State antrean ────────────────────────────────────────────────────────────
let queueListeners: QueueListener[] = []
let syncedListeners: SyncedListener[] = []
let _pendingCount = 0
let _lastError: string | null = null

// ── State koneksi (ping aktif) ───────────────────────────────────────────────
let _pingOk = false
let _pingAt = 0
let _pinging: Promise<boolean> | null = null

// ── State kunci proses sinkron ───────────────────────────────────────────────
let _syncing = false
let _lockDeadline = 0
let _lockWatchdog: ReturnType<typeof setTimeout> | null = null
let _retryTimer: ReturnType<typeof setTimeout> | null = null

let _initialized = false

// ── Helper dasar ─────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Bungkus promise dgn batas waktu — mencegah satu item menggantung selamanya. */
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

/**
 * Exponential backoff bertingkat: 15s → 30s → 60s → … → cap 10 menit.
 * Di-eksport untuk unit test (services/sync.test.ts).
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts - 1), MAX_BACKOFF_MS)
}

// ── Akses IndexedDB (via localDb) ────────────────────────────────────────────

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

function notifyQueueListeners() {
  void dbCount('pending').then(n => {
    _pendingCount = n
    for (const l of [...queueListeners]) { try { l(n) } catch { /* ignore */ } }
  })
  // Jaga cache diagnostik tetap segar
  void readQueue().then(q => { _queueCache = q }).catch(() => { /* ignore */ })
}

function notifySyncedListeners(tripId: string) {
  for (const l of [...syncedListeners]) { try { l(tripId) } catch { /* ignore */ } }
}

// ── Migrasi antrean versi lama (localStorage → IndexedDB) ────────────────────

const LEGACY_QUEUE_KEY = 'trip.syncQueue.v1'
const MIGRATION_KEY = 'sync.queue.migrated.v1'

function derivePhotos(trip: Trip): PhotoEntry[] {
  // PENTING: satu entry PER kendaraan (termasuk yang foto-nya kosong) supaya
  // indeks foto selalu sejajar dengan indeks kendaraan di payload.
  return (trip.vehicles ?? []).map(v => ({
    dataUrl: v.photoUrl ?? '',
    mimeType: 'image/jpeg',
  }))
}

function deriveTripPhoto(trip: Trip): PhotoEntry | undefined {
  return trip.photoUrl ? { dataUrl: trip.photoUrl, mimeType: 'image/jpeg' } : undefined
}

/**
 * Pindahkan antrean lama (localStorage 'trip.syncQueue.v1') ke IndexedDB.
 * Kunci lama hanya dihapus SETELAH tulis ke IndexedDB sukses — data tidak
 * boleh hilang walau proses migrasi terputus di tengah jalan.
 */
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
        // Jangan dobelkan item yang sudah masuk IndexedDB
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

// ── Public API: antrean ──────────────────────────────────────────────────────

/**
 * Daftarkan trip baru ke antrean sinkron. IDEMPOTEN — trip dengan id sama tidak
 * pernah terduplikasi (diperbarui pada tempatnya).
 */
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
  // Kirim SEGERA bila server terjangkau — jangan menunggu siklus polling
  // berikutnya (target: antrean diproses < 2 detik setelah trip selesai).
  window.setTimeout(() => void processSyncQueue(), 150)
}

async function dbGetById(tripId: string): Promise<SyncItem | null> {
  const all = await readQueue()
  return all.find(i => i.trip.id === tripId) ?? null
}

/** Jumlah antrean tertunda (nilai ter-cache, diperbarui tiap perubahan). */
export function getPendingCount(): number { return _pendingCount }

/**
 * Perbarui snapshot item antrean dengan data trip TERBARU (mis. setelah foto
 * dokumentasi diambil ulang dari Riwayat), reset status gagal, lalu proses
 * ulang. Dipakai untuk melepas item yang macet karena PHOTO_MISSING.
 */
export async function retrySyncItem(trip: Trip): Promise<void> {
  try {
    await initLocalDb()
    const existing = await dbGetById(trip.id)
    // Trip sudah pernah terkirim (item sudah keluar dari antrean) lalu diedit
    // → antrekan ULANG. Tanpa ini, status trip hanya berubah jadi
    // "menunggu koneksi" di lokal tapi tidak pernah dikirim lagi.
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
    // Kirim segera (150 ms) — sama seperti addToSyncQueue
    window.setTimeout(() => void processSyncQueue(), 150)
  } catch (err) {
    console.warn('[sync] retrySyncItem gagal:', err)
  }
}

/** Seluruh isi antrean (untuk debug/diagnostik UI). */
export function getSyncQueue(): SyncItem[] { return _queueCache }

let _queueCache: SyncItem[] = []
void readQueue().then(q => { _queueCache = q }).catch(() => { /* ignore */ })

/** Error terakhir pada proses sinkron (null = bersih). */
export function getLastSyncError(): string | null { return _lastError }

/** true bila ada siklus sinkronisasi yang sedang berjalan. */
export function isSyncInProgress(): boolean { return _syncing && Date.now() <= _lockDeadline }

export function onSyncQueueChange(cb: QueueListener): () => void {
  queueListeners.push(cb)
  void dbCount('pending').then(n => {
    _pendingCount = n
    try { cb(n) } catch { /* ignore */ }
  })
  return () => { queueListeners = queueListeners.filter(x => x !== cb) }
}

/**
 * Dipanggil saat SATU trip sudah dikonfirmasi server.
 * Argumen berupa **trip.id** (bukan syncId) agar store bisa menandai trip.
 */
export function onTripSynced(cb: SyncedListener): () => void {
  syncedListeners.push(cb)
  return () => { syncedListeners = syncedListeners.filter(x => x !== cb) }
}

// ── Verifikasi koneksi AKTIF (ping server) ───────────────────────────────────

/**
 * Ping aktif ke `/api/health` — memastikan server benar-benar tembus, bukan
 * sekadar `navigator.onLine === true`. Hasil di-cache singkat agar event
 * beruntun tidak membanjiri server.
 */
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

// ── Payload foto ─────────────────────────────────────────────────────────────

/** Normalisasi berbagai bentuk sumber foto menjadi URL yang bisa di-fetch. */
function normalizeSource(raw?: string): string | null {
  if (!raw) return null
  const s = raw.trim()
  if (!s) return null
  if (s.startsWith('data:')) return s
  if (/^(https?|blob|content|file):/i.test(s)) return s
  // Base64 polos tanpa prefix data URL
  if (/^[A-Za-z0-9+/=\s]{64,}$/.test(s)) return `data:image/jpeg;base64,${s.replace(/\s/g, '')}`
  return s
}

/** Fallback manual decode data URL bila fetch gagal (WebView tertentu). */
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

/**
 * Ubah sumber foto menjadi Blob dgn MIME yang valid.
 * Backend menolak berkas non-gambar (fileFilter multer) sehingga MIME wajib
 * dipaksa ke image/jpeg bila bukan jpeg/png/webp — inilah sumber "failed payload".
 */
async function toImageBlob(raw?: string): Promise<Blob | null> {
  const src = normalizeSource(raw)
  if (!src) return null
  let blob: Blob | null = null
  try {
    const res = await fetch(src)
    blob = await res.blob()
  } catch {
    blob = src.startsWith('data:') ? dataUrlToBlobManual(src) : null
  }
  if (!blob || blob.size === 0) return null
  if (!OK_MIME.test(blob.type)) blob = new Blob([blob], { type: 'image/jpeg' })
  return blob
}

function photoFileName(blob: Blob, index: number): string {
  const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'
  return `photo-${index}.${ext}`
}

// ── Resolusi rute (perbaikan strip "--" di dashboard) ────────────────────────

/**
 * Petakan trip → (routeFrom, routeTo) sesuai skema backend
 * (`trips.route_from` / `trips.route_to` berisi KODE tempat, mis. SJRE-SBDZ).
 *
 * Sumber data, berurutan:
 *   1. trip.routeCode / trip.routeFrom+routeTo (disimpan saat trip dibuat)
 *   2. Kode rute di cache localStorage (`SJRE-SBDZ`)
 *   3. Tampilan lama "SJRE → SBDZ" / "SJRE - SBDZ" / "SJRE -> SBDZ"
 *
 * Tanpa ini, payload kosong (null) → tabel laporan admin menampilkan "-"/"--".
 */
export function resolveRoute(trip: Trip): { routeFrom: string | null; routeTo: string | null; routeCode: string | null } {
  let cached: ReturnType<typeof getStoredRoutes> = []
  try { cached = getStoredRoutes() } catch { cached = [] }

  // 1a. Kode eksplisit yang tersimpan saat trip dibuat
  const code = (trip as Trip & { routeCode?: string }).routeCode?.trim()
  if (code) {
    const hit = cached.find(r => r.code === code)
    if (hit) return { routeFrom: hit.from, routeTo: hit.to, routeCode: hit.code }
    const i = code.lastIndexOf('-')
    if (i > 0 && i < code.length - 1) {
      return { routeFrom: code.slice(0, i).trim(), routeTo: code.slice(i + 1).trim(), routeCode: code }
    }
  }

  // 1b. from/to eksplisit
  const explicitFrom = (trip as Trip & { routeFrom?: string }).routeFrom
  const explicitTo = (trip as Trip & { routeTo?: string }).routeTo
  if (explicitFrom && explicitTo) {
    return { routeFrom: explicitFrom, routeTo: explicitTo, routeCode: `${explicitFrom}-${explicitTo}` }
  }

  const raw = (trip.route ?? '').trim()
  if (!raw) return { routeFrom: null, routeTo: null, routeCode: null }

  // 2. Cocokkan dengan cache rute (kode maupun label)
  const byCode = cached.find(r => r.code === raw)
  if (byCode) return { routeFrom: byCode.from, routeTo: byCode.to, routeCode: byCode.code }
  const byLabel = cached.find(r => r.label === raw || `${r.from} → ${r.to}` === raw)
  if (byLabel) return { routeFrom: byLabel.from, routeTo: byLabel.to, routeCode: byLabel.code }

  // 3. Format kode "SJRE-SBDZ"
  const dash = raw.lastIndexOf('-')
  if (dash > 0 && dash < raw.length - 1 && !/[\s→–—]/.test(raw)) {
    return { routeFrom: raw.slice(0, dash).trim(), routeTo: raw.slice(dash + 1).trim(), routeCode: raw }
  }

  // 4. Format tampilan "SJRE → SBDZ"
  const sep = /\s*(?:→|->|—|–|-)\s*/.exec(raw)
  if (sep && sep.index > 0) {
    const from = raw.slice(0, sep.index).trim()
    const to = raw.slice(sep.index + sep[0].length).trim()
    if (from && to) return { routeFrom: from, routeTo: to, routeCode: `${from}-${to}` }
  }

  return { routeFrom: null, routeTo: null, routeCode: null }
}

// ── POST trip ke server ──────────────────────────────────────────────────────

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

    // 0. Foto bukti trip (index 0) — WAJIB
    const tripPhotoRaw = item.tripPhoto?.dataUrl ?? trip.photoUrl
    const tripPhotoIdx = await pushPhoto(tripPhotoRaw)

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
    const vehiclesList = trip.vehicles ?? []
    for (let i = 0; i < vehiclesList.length; i++) {
      const v = vehiclesList[i]
      // `||` (bukan `??`) — entry kosong harus jatuh ke foto milik kendaraan ini,
      // jangan sampai foto kendaraan lain terpasang di posisi yang salah.
      const vi = await pushPhoto(item.photos?.[i]?.dataUrl || v.photoUrl)
      let lat: number | null = v.photoLatitude ?? null
      let lon: number | null = v.photoLongitude ?? null
      if (lat == null || lon == null) {
        const geo = await getCurrentPositionSafe()
        if (geo) { lat = geo.lat; lon = geo.lon }
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

    // Foto hilang → jangan kirim payload cacat; item TETAP di antrean.
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
      // ID unik trip dari sisi klien — backend pakai untuk menolak duplikat
      // saat antrean dikirim ulang (timeout/putus di tengah jalan).
      clientTripId: trip.id,
      statusMuatan: hasLoad ? 'muatan' : 'kosong',
      routeFrom,
      routeTo,
      // Alias untuk ketertelusuran lintas versi backend
      route: routeCode ?? trip.route ?? null,
      routeCode: routeCode ?? null,
      keterangan: trip.category && trip.category !== '-' ? trip.category : null,
      tripPhotoIndex: tripPhotoIdx,
      tripPhotoCapturedAt: trip.photoCapturedAt ?? null,
      tripPhotoLatitude: trip.photoLatitude ?? null,
      tripPhotoLongitude: trip.photoLongitude ?? null,
      startedAt: trip.startedAt ?? null,
      completedAt: trip.completedAt ?? null,
      vehicles,
    }

    const form = new FormData()
    form.append('payload', JSON.stringify(payload))
    // Urutan WAJIB: foto trip dulu (index 0), lalu foto kendaraan 1..n —
    // backend memvalidasi seluruh berkas dipakai tepat satu kali.
    blobs.forEach((blob, i) => form.append('photos', blob, photoFileName(blob, i)))

    const dermagaId = getStoredDermaga()?.id
    if (dermagaId) form.append('dermagaId', String(dermagaId))

    const res = await api.postMultipart<unknown>('/trips/complete', form)

    // ✅ HANYA HTTP 200/201 → item boleh keluar dari antrean
    if (res.ok) {
      _lastError = null
      return { syncId, success: true }
    }

    const code = res.error?.code
    if (code === '401' && allowReauth) {
      // Token kedaluwarsa → validasi ulang sesi lalu kirim ulang SATU kali
      const ok = await ensureBackendSession()
      if (ok) return postTripToServer(item, false)
      return { syncId, success: false, error: res.error?.message ?? 'Sesi autentikasi berakhir', code }
    }

    // Error permanent dari validasi server (4xx selain 401) → tandai, jangan spam
    const permanent = !!code && /^4\d\d$/.test(code) && code !== '408'
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

// ── Pemroses antrean ─────────────────────────────────────────────────────────

/**
 * true  → ada siklus lain yang sedang berjalan (kunci basi otomatis dilepas).
 * false → bebas memulai siklus baru.
 * Inilah pengunci anti-stuck: bila siklus macet melewati batas watchdog,
 * kunci dilepas sehingga antrean tidak terkunci selamanya.
 */
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
    // Antrean tidak boleh stuck — jadwalkan percobaan berikutnya SEGERA
    scheduleRetry(FAST_RETRY_NETWORK_MS)
    notifyQueueListeners()
  }, LOCK_TIMEOUT_MS + 1_000)
}

function releaseLock(): void {
  _syncing = false
  _lockDeadline = 0
  if (_lockWatchdog) { clearTimeout(_lockWatchdog); _lockWatchdog = null }
}

/** Jadwalkan siklus berikutnya (timer lama dibatalkan agar tidak menumpuk). */
function scheduleRetry(delayMs = POLL_INTERVAL_MS): void {
  if (_retryTimer) clearTimeout(_retryTimer)
  _retryTimer = setTimeout(() => {
    _retryTimer = null
    void processSyncQueue()
  }, delayMs)
}

/** Proses SATU item. Sukses → hapus dari DB; gagal → catat + backoff. */
async function processItem(item: SyncItem, retryAll = false): Promise<void> {
  const last = item.lastAttemptAt ?? 0
  const elapsed = Date.now() - last
  const wait = item.needsAttention ? MAX_BACKOFF_MS : backoffMs(item.attempts)

  if (!retryAll && item.attempts > 0 && elapsed < wait && !isNetworkError(item.lastError)) {
    return // belum waktunya retry (backoff) — bukan kegagalan
  }

  const result = await withTimeout(
    postTripToServer(item),
    ITEM_TIMEOUT_MS,
    { syncId: item.syncId, success: false, error: 'Server tidak merespon (timeout)' } as SyncResult,
  )

  if (result.success) {
    // ✅ SERVER KONFIRMASI (200/201) — baru item keluar dari antrean
    await removeItem(item.syncId)
    _lastError = null
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
  _lastError = updated.lastError ?? null

  // Jaringan → retry cepat (< 2 dtk) untuk beberapa percobaan pertama agar
  // pulih seketika; setelah itu naik ke exponential backoff agar tidak membanjiri.
  const fastRetry = isNetworkError(updated.lastError) && updated.attempts < 4
  scheduleRetry(fastRetry ? FAST_RETRY_NETWORK_MS : backoffMs(updated.attempts))
  notifyQueueListeners()
}

// ── Proses SEMUA antrean ─────────────────────────────────────────────────────

/**
 * Pastikan sesi backend valid SEBELUM antrean dikirim — token diperiksa &
 * diperpanjang (refresh) lebih dulu supaya tidak membakar percobaan 401.
 */
async function ensureSessionForQueue(): Promise<boolean> {
  try {
    return await renewSessionIfNeeded()
  } catch {
    return api.isAuthenticated
  }
}

export async function processSyncQueue(opts?: { retryAll?: boolean }): Promise<void> {
  // Kunci pengunci antrean — cegah dua siklus berjalan bersamaan.
  // Kunci basi (melewati batas watchdog) otomatis dilepas oleh isSyncBusy()
  // sehingga antrean tidak pernah terkunci selamanya (anti-stuck).
  if (isSyncBusy()) return
  // Diambil sinkron (tanpa await) → tidak ada celah balapan antar pemanggil
  acquireLock()

  try {
    // VERIFIKASI AKTIF: jangan percaya navigator.onLine saja
    const reachable = await probeServer()
    if (!reachable) {
      scheduleRetry(POLL_INTERVAL_MS)
      return
    }

    const items = await readQueue()
    _queueCache = items
    if (items.length === 0) {
      _pendingCount = 0
      notifyQueueListeners()
      return
    }

    const sessionOk = await ensureSessionForQueue()
    if (!sessionOk) {
      // Jangan kirim tanpa sesi — tunda dengan pesan yang jelas untuk petugas.
      _lastError = 'Sesi berakhir — silakan login ulang. Data antrean tetap aman.'
      scheduleRetry(MAX_BACKOFF_MS)
      return
    }

    for (const item of items) {
      // Cek di antar item: bila koneksi putus, hentikan siklus ini dengan rapi
      if (!(await probeServer())) break
      await processItem(item, opts?.retryAll ?? false)
    }
  } catch (err) {
    _lastError = err instanceof Error ? err.message : 'Proses sinkron terganggu'
    console.warn('[sync] siklus terputus:', err)
  } finally {
    releaseLock()
    notifyQueueListeners()
    void readQueue().then(q => { _queueCache = q }).catch(() => { /* ignore */ })
  }
}

// ── Event-driven: real-time + fallback ───────────────────────────────────────

/** Event 'online' sering datang SEBELUM jaringan benar-benar tembus → verifikasi. */
async function handleConnectionRestored(): Promise<void> {
  for (let i = 0; i < ONLINE_RETRY_ATTEMPTS; i++) {
    if (await probeServer(true)) {
      // SINKRONISASI DUA ARAH: tarik master data terbaru + unggah antrean lokal
      void syncOnResume(true)
      await processSyncQueue()
      return
    }
    if (i < ONLINE_RETRY_ATTEMPTS - 1) await sleep(ONLINE_RETRY_DELAY_MS)
  }
  scheduleRetry(POLL_INTERVAL_MS)
}

/** Inisialisasi (idempoten) — dipanggil sekali saat app mount. */
export function initializeSync(): void {
  if (_initialized) return
  _initialized = true

  // Tarik master data sekali saat init (hanya jalan bila online & throttle 5 mnt)
  void syncOnResume()

  void initLocalDb().then(async () => {
    // 1. Migrasi antrean lama agar data petugas yang sudah ada tidak hilang
    await migrateLegacyQueue()
    // 2. Minta browser TIDAK menghapus storage origin (proteksi penghapusan)
    void requestPersistentStorage()
    // 3. Coba kirim yang sudah ada (background, tanpa menghambat render)
    window.setTimeout(() => void processSyncQueue(), 1_200)
  })

  // 4. REAL-TIME: koneksi pulih → verifikasi ping → proses antrean (< 2 detik)
  window.addEventListener('online', () => { void handleConnectionRestored() })
  window.addEventListener('offline', () => {
    // Tandai agar UI langsung berubah; kunci siklus berjalan akan berhenti rapi
    _pingOk = false
    _pingAt = 0
    notifyQueueListeners()
  })

  // 5. Fallback polling — jaga-jaga bila event online/offline tidak reliable
  window.setInterval(() => { void processSyncQueue() }, POLL_INTERVAL_MS)

  // 6. Kembali dari background (mobile) → langsung cek antrean
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void processSyncQueue()
  })
}

/**
 * PAKSA SINKRONISASI SEKARANG (tombol manual petugas).
 * Tetap berjalan walau `navigator.onLine` salah — memakai verifikasi ping.
 */
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

// ── Base URL helpers ─────────────────────────────────────────────────────────
export function getApiBaseUrl(): string { return readApiBaseUrl() }

export function getMaskedApiUrl(): string {
  try {
    const u = new URL(getApiBaseUrl())
    const hidden = u.hostname.length > 8
      ? `${u.hostname.slice(0, 4)}…${u.hostname.slice(-4)}`
      : `${u.hostname.slice(0, 2)}…${u.hostname.slice(-2)}`
    return `${u.protocol}//${hidden}${u.pathname}`
  } catch { return '(konfigurasi tidak valid)' }
}
