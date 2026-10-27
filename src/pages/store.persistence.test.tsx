/**
 * Regresi: FOTO HILANG DARI RIWAYAT SETELAH APLIKASI DIBUKA ULANG.
 *
 * Alur penyimpanan yang benar:
 *   - IndexedDB store `trips` = sumber kebenaran, memuat foto (data URL).
 *   - localStorage `trip.trips.v1` = cache metadata saja (foto dibuang, karena
 *     kuota localStorage hanya ~5 MB).
 *
 * Saat aplikasi dibuka ulang, state `trips` awalnya diisi dari cache metadata
 * (tanpa foto). Bila state itu sempat ditulis balik ke IndexedDB SEBELUM
 * hidrasi selesai, seluruh foto yang tersimpan terhapus permanen — dan petugas
 * melihat "Foto Dokumentasi (0)" di halaman Riwayat.
 *
 * Test ini merender `AppProvider` sungguhan (react-dom/client) dengan
 * IndexedDB nyata (fake-indexeddb), lalu memastikan foto masih ada setelah
 * mount. Sumber jaringan dimock; tidak ada panggilan jaringan sungguhan.
 *
 * Jalankan: npm run test:unit
 */

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { AppProvider, nextTripId, persistTrips, stripTripPhotos, uniqueTripId, useApp, type Trip } from './store'
import { dbAll, dbClear, dbPut, initLocalDb } from '../services/localDb'

// React 19 membutuhkan flag ini agar `act` benar-benar mem-flush efek.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

// ── Mock modul jaringan: test ini hanya soal persistensi ──────────────────────
vi.mock('../services/api', () => ({
  api: { isAuthenticated: false, ping: async () => false },
}))
vi.mock('../services/auth', () => ({
  ensureBackendSession: async () => true,
  getStoredOfficer: () => null,
  logout: () => {},
  refreshBackendSession: async () => true,
  SESSION_READY_EVENT: 'session:ready',
}))
vi.mock('../services/officers', () => ({
  syncOfficersToLocal: async () => [],
  OFFICERS_UPDATED_EVENT: 'officers:updated',
}))
vi.mock('../services/prefetch', () => ({
  prefetchAllCriticalData: async () => ({}),
}))
vi.mock('../services/sync', () => ({
  addToSyncQueue: async () => {},
  onTripSynced: () => () => {},
  retrySyncItem: async () => {},
  notifyQueueListeners: () => {},
}))
vi.mock('../services/masterTariffs', () => ({ TARIFF_UPDATED_EVENT: 'tariffs:updated' }))

const LS_TRIPS = 'trip.trips.v1'

/** Data URL kecil — isinya tidak penting, hanya keberadaannya yang diuji. */
const TRIP_PHOTO = 'data:image/jpeg;base64,AAAA'
const VEHICLE_PHOTO = 'data:image/jpeg;base64,BBBB'
const SELFIE = 'data:image/jpeg;base64,CCCC'

const fullTrip = (): Trip => ({
  id: 'TRP-2026-0001',
  route: 'Sindang → Cirebon',
  status: 'Selesai',
  time: '10:00',
  date: '01/01/2026',
  load: 'Ada Muatan',
  vehicle: 'D 1 AB',
  type: 'Truck Besar',
  category: 'Eksternal',
  revenue: 'Rp 100.000',
  revenueNum: 100000,
  officer: 'Petugas Satu',
  duration: '10m',
  photo: true,
  photoUrl: TRIP_PHOTO,
  selfieUrl: SELFIE,
  vehicles: [{
    plate: 'D 1 AB',
    type: 'Truck Besar',
    category: 'Eksternal',
    tariff: 100000,
    photoUrl: VEHICLE_PHOTO,
  }],
  synced: false,
})

const readStored = () => dbAll<Trip>('trips')

/** State trips terakhir yang dilihat UI (setara yang dibaca HistoryScreen). */
const seen = { trips: [] as Trip[], loaded: false }
let app: ReturnType<typeof useApp> | null = null

function Probe() {
  const ctx = useApp()
  app = ctx
  seen.trips = ctx.trips
  seen.loaded = ctx.tripsLoaded
  return null
}

async function flush(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms))
  })
}

/** Siapkan kondisi "buka ulang aplikasi": IndexedDB penuh foto, cache metadata tanpa foto. */
async function prepareColdStart(): Promise<void> {
  await initLocalDb()
  await dbClear('trips')
  await dbClear('meta')
  await dbClear('pending')
  await dbPut<Trip>('trips', fullTrip())
  localStorage.setItem(LS_TRIPS, JSON.stringify([stripTripPhotos(fullTrip())]))
  seen.trips = []
  seen.loaded = false
}

let root: Root | null = null
let container: HTMLDivElement | null = null

async function mountApp(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(<AppProvider><Probe /></AppProvider>)
  })
}

beforeEach(() => {
  localStorage.clear()
  root = null
  container = null
  app = null
})

describe('persistensi riwayat — foto tidak boleh hilang saat aplikasi dibuka ulang', () => {
  it('foto di IndexedDB tetap utuh setelah AppProvider mount', async () => {
    await prepareColdStart()
    await mountApp()
    await flush()

    const stored = await readStored()
    const trip = stored.find(t => t.id === 'TRP-2026-0001')
    expect(trip, 'trip harus tetap ada di IndexedDB').toBeTruthy()
    expect(trip?.photoUrl, 'foto bukti trip tidak boleh terhapus').toBe(TRIP_PHOTO)
    expect(trip?.selfieUrl, 'swafoto tidak boleh terhapus').toBe(SELFIE)
    expect(trip?.vehicles?.[0]?.photoUrl, 'foto kendaraan tidak boleh terhapus').toBe(VEHICLE_PHOTO)
  })

  it('halaman Riwayat menerima trip lengkap dengan foto setelah hidrasi', async () => {
    await prepareColdStart()
    await mountApp()
    await flush()

    const trip = seen.trips.find(t => t.id === 'TRP-2026-0001')
    expect(seen.loaded, 'hidrasi IndexedDB selesai').toBe(true)
    expect(trip?.photoUrl).toBe(TRIP_PHOTO)
    expect(trip?.selfieUrl).toBe(SELFIE)
    expect(trip?.vehicles?.[0]?.photoUrl).toBe(VEHICLE_PHOTO)
  })

  it('foto hasil ambil ulang menggantikan foto lama tanpa menghilangkan foto lain', async () => {
    await prepareColdStart()
    await mountApp()
    await flush()

    const retaken = 'data:image/jpeg;base64,RETAKE'
    await act(async () => {
      app!.patchTripPhoto('TRP-2026-0001', { photo: true, photoUrl: retaken })
    })
    await flush()

    const stored = (await readStored()).find(t => t.id === 'TRP-2026-0001')
    expect(stored?.photoUrl).toBe(retaken)
    expect(stored?.selfieUrl, 'swafoto tidak boleh ikut hilang').toBe(SELFIE)
    expect(stored?.vehicles?.[0]?.photoUrl, 'foto kendaraan tidak boleh ikut hilang').toBe(VEHICLE_PHOTO)
  })

  it('cache metadata (tanpa foto) tidak menimpa foto yang sudah tersimpan', async () => {
    await prepareColdStart()
    await initLocalDb()
    await dbClear('trips')
    await dbPut<Trip>('trips', fullTrip())

    const metadataOnly = stripTripPhotos(fullTrip())
    await persistTrips([metadataOnly])

    const stored = await readStored()
    const trip = stored.find(t => t.id === 'TRP-2026-0001')
    expect(trip?.photoUrl).toBe(TRIP_PHOTO)
    expect(trip?.vehicles?.[0]?.photoUrl).toBe(VEHICLE_PHOTO)
  })
})

describe('ID trip unik — nomor urut boleh direset, kunci internal tidak', () => {
  it('nomor tampilan tetap berurutan tetapi ID internal selalu berbeda', () => {
    const trips = [fullTrip()]
    const display = nextTripId(trips)
    expect(display).toBe(`TRP-${new Date().getFullYear()}-0002`)

    const a = uniqueTripId(display)
    const b = uniqueTripId(display)
    expect(a.startsWith(display)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('riwayat dihapus -> nomor kembali ke 0001, ID internal tetap tidak bentrok', () => {
    const display = nextTripId([])
    const first = uniqueTripId(display)
    const second = uniqueTripId(display)

    expect(display).toBe(`TRP-${new Date().getFullYear()}-0001`)
    expect(first).not.toBe(second)
  })

  it('nextTripId memakai displayId, bukan ID internal yang panjang', () => {
    const trips: Trip[] = [{
      ...fullTrip(),
      id: 'TRP-2026-0007-ABC123',
      displayId: 'TRP-2026-0007',
    }]
    expect(nextTripId(trips)).toBe('TRP-2026-0008')
  })
})
