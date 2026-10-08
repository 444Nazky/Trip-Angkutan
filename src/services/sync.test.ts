// ─── Unit Test: Sync Service (services/sync.ts) ──────────────────────────────
// Cakupan (sesuai audit offline-first):
//   1. resolveRoute  — payload rute tidak pernah kosong ("--") di dashboard.
//   2. backoffMs     — exponential backoff + cap 10 menit (anti-stuck).
//   3. Antrean       — IDEMPOTEN (trip sama tak pernah terduplikasi) dan
//                      item hanya keluar antrean SETELAH server balas 200/201.
//
// Jalankan: npm run test:unit
// Mock dipasang pada './localDb' (IndexedDB → memori), './api' (HTTP → buatan),
// '@capacitor/geolocation', dan './adminPull' agar test hermetik & offline.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addToSyncQueue,
  backoffMs,
  probeServer,
  processSyncQueue,
  resolveRoute,
  type SyncItem,
} from './sync'
import { dbAll } from './localDb'
import type { Trip } from '../pages/store'

// ── State bersama untuk mock (vi.hoisted → aman dipakai di dalam vi.mock) ────
const h = vi.hoisted(() => {
  // btoa cukup untuk JWT palsu ini (didukung lib.dom & runtime)
  const enc = (o: unknown) => btoa(JSON.stringify(o))
  const stores: Record<string, Map<string, Record<string, unknown>>> = {
    pending: new Map(),
    trips: new Map(),
    meta: new Map(),
  }
  const keyOf = (store: string, row: Record<string, unknown>): string =>
    store === 'pending' ? String(row['syncId'])
      : store === 'trips' ? String(row['id'])
        : String(row['k'])

  return {
    stores,
    keyOf,
    api: {
      pingOk: true,
      postOk: true,
      postCalls: 0,
      lastBody: null as FormData | null,
      // JWT palsu: role officer + officerId cocok dengan sesi tersimpan
      token: `${enc({ alg: 'none' })}.${enc({ role: 'officer', officerId: 'off1', exp: 4102444800 })}.sig`,
      authenticated: true,
    },
  }
})

vi.mock('./localDb', () => ({
  initLocalDb: async () => 'indexeddb',
  localDbBackend: () => 'indexeddb',
  dbAll: async (store: string) => [...h.stores[store].values()],
  dbCount: async (store: string) => h.stores[store].size,
  dbGet: async (store: string, key: string) => h.stores[store].get(key) ?? null,
  dbPut: async (store: string, row: Record<string, unknown>) => {
    h.stores[store].set(h.keyOf(store, row), row)
  },
  dbPutMany: async (store: string, rows: Array<Record<string, unknown>>) => {
    for (const row of rows) h.stores[store].set(h.keyOf(store, row), row)
    return true
  },
  dbDelete: async (store: string, key: string) => { h.stores[store].delete(key) },
  dbClear: async (store: string) => { h.stores[store].clear() },
  metaGet: async (k: string) => h.stores['meta'].get(k)?.['v'] ?? null,
  metaSet: async (k: string, v: unknown) => { h.stores['meta'].set(k, { k, v }) },
  requestPersistentStorage: async () => true,
}))

vi.mock('./api', () => ({
  api: {
    get token() { return h.api.token },
    get isAuthenticated() { return h.api.authenticated },
    baseUrl: 'http://api.test',
    setToken(t: string | null) { h.api.token = t ?? ''; h.api.authenticated = !!t },
    refreshBaseUrl: () => { /* no-op */ },
    ping: async () => h.api.pingOk,
    get: async () => ({ ok: true, data: [] }),
    post: async () => ({ ok: true, data: {} }),
    put: async () => ({ ok: true, data: {} }),
    delete: async () => ({ ok: true, data: {} }),
    uploadPhoto: async () => null,
    postMultipart: async (_path: string, body: FormData) => {
      h.api.postCalls++
      h.api.lastBody = body
      return h.api.postOk
        ? { ok: true, data: { id: 'srv-1' } }
        : { ok: false, error: { message: 'Server menolak payload', code: '500' } }
    },
  },
  getApiBaseUrl: () => 'http://api.test',
  setApiBaseUrl: () => { /* no-op */ },
}))

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    getCurrentPosition: async () => { throw new Error('geolocation dimatikan di test') },
  },
}))

vi.mock('./adminPull', () => ({
  FORCE_ROSTER_SYNC_KEY: 'trip.sync.forceRoster',
  syncOnResume: () => { /* no-op */ },
}))

// ── Fixture ──────────────────────────────────────────────────────────────────

const IMG = `data:image/jpeg;base64,${'A'.repeat(64)}`
const IMG_BARU = `data:image/jpeg;base64,${'B'.repeat(64)}`

function makeTrip(over: Partial<Trip> = {}): Trip {
  const now = new Date().toISOString()
  return {
    id: 'TRP-2026-0001',
    route: 'Sijangkung → Sabadi',
    routeCode: 'SJRE-SBDZ',
    routeFrom: 'SJRE',
    routeTo: 'SBDZ',
    status: 'Selesai',
    time: '08:00',
    date: '7 Okt 2026',
    load: 'Ada Muatan',
    vehicle: 'B 1234 XY',
    type: 'Truck Besar',
    category: 'Internal',
    revenue: 'Rp 100.000',
    revenueNum: 100_000,
    officer: 'Petugas Satu',
    officerId: 'off1',
    duration: '10m',
    photo: true,
    photoUrl: IMG,
    photoCapturedAt: now,
    startedAt: now,
    completedAt: now,
    vehicles: [
      { plate: 'B 1234 XY', type: 'Truck Besar', category: 'Internal', tariff: 100_000, photoUrl: IMG },
    ],
    synced: false,
    ...over,
  }
}

const pendingRows = () => dbAll<SyncItem>('pending')

// ── Lifecycle ────────────────────────────────────────────────────────────────

beforeEach(async () => {
  // Timer palsu: mencegah jadwal latar (retry 15 dtk / polling 20 dtk / timer
  // 150 ms "kirim segera") ikut berjalan di tengah test dan mengaburkan hasil.
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })

  h.stores['pending'].clear()
  h.stores['trips'].clear()
  h.stores['meta'].clear()
  h.api.pingOk = true
  h.api.postOk = true
  h.api.postCalls = 0
  h.api.lastBody = null
  h.api.authenticated = true

  localStorage.clear()
  // Sesi backend tersimpan → proses antrean tidak berhenti di "sesi berakhir"
  localStorage.setItem('trip.auth.officer.v1', JSON.stringify({
    id: 'off1', name: 'Petugas Satu', regionId: 'r1', regionName: 'R1', regionCode: 'R1',
  }))
  // Cache rute per dermaga (dipakai resolveRoute)
  localStorage.setItem('trip.auth.routes.v1', JSON.stringify({
    dock1: [{
      id: 'route-1',
      name: 'Sijangkung → Sabadi',
      route_from: 'SJRE',
      route_to: 'SBDZ',
      distance: '42 km',
      duration: '1j 10m',
    }],
  }))

  // Reset cache ping agar setiap test mulai dari keadaan bersih
  h.api.pingOk = true
  await probeServer(true)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

// ── 1. resolveRoute (anti "--" di dashboard admin) ───────────────────────────

describe('resolveRoute', () => {
  it('memakai kode eksplisit dan mencocokkannya ke cache rute', () => {
    expect(resolveRoute(makeTrip())).toEqual({
      routeFrom: 'SJRE', routeTo: 'SBDZ', routeCode: 'SJRE-SBDZ',
    })
  })

  it('memecah kode yang tidak dikenal pada strip terakhir', () => {
    const r = resolveRoute(makeTrip({ routeCode: 'AAAA-BBBB', route: 'AAAA → BBBB' }))
    expect(r).toEqual({ routeFrom: 'AAAA', routeTo: 'BBBB', routeCode: 'AAAA-BBBB' })
  })

  it('memakai routeFrom/routeTo eksplisit bila kode kosong', () => {
    const r = resolveRoute(makeTrip({ routeCode: '', routeFrom: 'SJRE', routeTo: 'SBDZ' }))
    expect(r).toEqual({ routeFrom: 'SJRE', routeTo: 'SBDZ', routeCode: 'SJRE-SBDZ' })
  })

  it('mengurai label tampilan "A → B" milik trip lama', () => {
    const r = resolveRoute(makeTrip({
      routeCode: undefined, routeFrom: undefined, routeTo: undefined, route: 'SJRE → SBDZ',
    }))
    expect(r).toEqual({ routeFrom: 'SJRE', routeTo: 'SBDZ', routeCode: 'SJRE-SBDZ' })
  })

  it('mengurai format kode "AAAA-BBBB" dari string route', () => {
    const r = resolveRoute(makeTrip({
      routeCode: undefined, routeFrom: undefined, routeTo: undefined, route: 'AAAA-BBBB',
    }))
    expect(r).toEqual({ routeFrom: 'AAAA', routeTo: 'BBBB', routeCode: 'AAAA-BBBB' })
  })

  it('null (bukan string kosong/strip) saat rute tidak dikenal — mencegah "--"', () => {
    for (const route of ['', 'Rute Hilang Total']) {
      const r = resolveRoute(makeTrip({
        routeCode: undefined, routeFrom: undefined, routeTo: undefined, route,
      }))
      expect(r).toEqual({ routeFrom: null, routeTo: null, routeCode: null })
    }
  })
})

// ── 2. Exponential backoff (anti-stuck) ──────────────────────────────────────

describe('backoffMs', () => {
  it('menaik eksponensial 15s → 30s → 60s → … lalu ditahan di 10 menit', () => {
    expect(backoffMs(0)).toBe(0)
    expect(backoffMs(1)).toBe(15_000)
    expect(backoffMs(2)).toBe(30_000)
    expect(backoffMs(3)).toBe(60_000)
    expect(backoffMs(4)).toBe(120_000)
    expect(backoffMs(5)).toBe(240_000)
    expect(backoffMs(6)).toBe(480_000)
    expect(backoffMs(7)).toBe(600_000)   // cap 10 menit
    expect(backoffMs(50)).toBe(600_000)  // tetap cap, tidak meledak
  })
})

// ── 3. Antrean sinkron: idempotensi + hapus bersyarat ───────────────────────

describe('antrean sinkron', () => {
  it('trip dengan id sama TIDAK PERNAH terduplikasi (diperbarui di tempat)', async () => {
    const trip = makeTrip()
    await addToSyncQueue(trip, [{ dataUrl: IMG, mimeType: 'image/jpeg' }], { dataUrl: IMG, mimeType: 'image/jpeg' })
    const syncIdPertama = String((await pendingRows())[0]?.syncId ?? '')
    const awalan = `trip:${trip.id}:`
    expect(syncIdPertama.startsWith(awalan)).toBe(true)
    expect(/^\d+$/.test(syncIdPertama.slice(awalan.length))).toBe(true)

    // Kirim ulang dengan data berbeda (mis. setelah foto diperbaiki)
    await addToSyncQueue(
      { ...trip, officer: 'Petugas Dua' },
      [{ dataUrl: IMG_BARU, mimeType: 'image/jpeg' }],
    )

    const rows = await pendingRows()
    expect(rows).toHaveLength(1)                       // ← idempoten
    expect(rows[0].syncId).toBe(syncIdPertama)         // ← kunci tidak berubah
    expect(rows[0].trip.officer).toBe('Petugas Dua')   // ← data diperbarui
    expect(rows[0].photos[0].dataUrl).toBe(IMG_BARU)
    expect(rows[0].attempts).toBe(0)
  })

  it('item TETAP di antrean saat server gagal, hilang hanya setelah 200/201', async () => {
    await addToSyncQueue(makeTrip())

    // ── Gagal (HTTP 500) → wajib bertahan ──
    h.api.postOk = false
    await processSyncQueue({ retryAll: true })
    let rows = await pendingRows()
    expect(h.api.postCalls).toBe(1)
    expect(rows).toHaveLength(1)
    expect(rows[0].attempts).toBe(1)
    expect(rows[0].lastError).toContain('menolak payload')
    expect(rows[0].needsAttention).toBeFalsy() // 5xx = bisa dicoba ulang otomatis

    // ── Berhasil (HTTP 200) → baru boleh keluar antrean ──
    h.api.postOk = true
    await processSyncQueue({ retryAll: true })
    rows = await pendingRows()
    expect(h.api.postCalls).toBe(2)
    expect(rows).toHaveLength(0)
  })

  it('payload yang terkirim lengkap: rute, clientTripId & foto per kendaraan', async () => {
    await addToSyncQueue(makeTrip())
    h.api.postOk = true
    await processSyncQueue({ retryAll: true })

    const body = h.api.lastBody
    expect(body).toBeTruthy()
    const payload = JSON.parse(String(body!.get('payload'))) as {
      clientTripId: string
      routeFrom: string
      routeTo: string
      statusMuatan: string
      tripPhotoIndex: number
      vehicles: Array<{ noPolisi: string; photoIndex: number }>
    }

    expect(payload.clientTripId).toBe('TRP-2026-0001') // anti-duplikat di server
    expect(payload.routeFrom).toBe('SJRE')             // tidak "--"
    expect(payload.routeTo).toBe('SBDZ')
    expect(payload.statusMuatan).toBe('muatan')
    expect(payload.tripPhotoIndex).toBe(0)             // index 0 = foto bukti trip
    expect(payload.vehicles[0].photoIndex).toBe(1)     // 1..n = foto tiap kendaraan
    expect(body!.getAll('photos')).toHaveLength(2)
  })

  it('foto hilang → payload cacat TIDAK dikirim & item ditandai butuh perhatian', async () => {
    const trip = makeTrip({
      photoUrl: undefined,
      vehicles: [{ plate: 'B 1234 XY', type: 'Truck Besar', category: 'Internal', tariff: 0 }],
    })
    await addToSyncQueue(trip, [{ dataUrl: '', mimeType: 'image/jpeg' }], undefined)

    const sebelum = h.api.postCalls
    await processSyncQueue({ retryAll: true })

    expect(h.api.postCalls).toBe(sebelum)              // tidak ada request keluar
    const rows = await pendingRows()
    expect(rows).toHaveLength(1)                       // tidak dibuang sia-sia
    expect(rows[0].lastErrorCode).toBe('PHOTO_MISSING')
    expect(rows[0].needsAttention).toBe(true)
  })

  it('server tak terjangkau (ping gagal) → siklus berhenti, antrean tidak disentuh', async () => {
    await addToSyncQueue(makeTrip())

    // Buat cache ping kedaluwarsa (TTL 2,5 dtk) lalu simulasikan offline
    vi.setSystemTime(Date.now() + 10_000)
    h.api.pingOk = false
    const postSebelum = h.api.postCalls

    await processSyncQueue({ retryAll: true })

    expect(h.api.postCalls).toBe(postSebelum)
    const rows = await pendingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].attempts).toBe(0) // tidak membakar percobaan saat offline
  })
})
