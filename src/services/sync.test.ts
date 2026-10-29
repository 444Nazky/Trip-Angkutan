
// ─── Unit Test: Sync Service (services/sync.ts) ────────────────────────────── Cakupan (sesuai audit offline-first): 1. resolveRoute

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addToSyncQueue,
  backoffMs,
  onSyncFailure,
  onTripSynced,
  probeServer,
  processSyncQueue,
  readQueuedPhotos,
  resolveRoute,
  retrySyncItem,
  type SyncItem,
} from './sync'
import { dbAll } from './localDb'
import type { Trip } from '../pages/store'



const h = vi.hoisted(() => {
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
      /** Balasan error dari server (bisa diubah per test). */
      postError: { message: 'Server menolak payload', code: '500' } as { message: string; code: string },
      // Konfirmasi balasan server. `null` = pakai konfirmasi otomatis (dihitung dari payload yang dikirim, seperti server sungguhan).
      ack: null as Record<string, unknown> | null,
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
    refreshBaseUrl: () => {  },
    ping: async () => h.api.pingOk,
    get: async () => ({ ok: true, data: [] }),
    post: async () => ({ ok: true, data: {} }),
    put: async () => ({ ok: true, data: {} }),
    delete: async () => ({ ok: true, data: {} }),
    uploadPhoto: async () => null,
    postMultipart: async (_path: string, body: FormData) => {
      h.api.postCalls++
      h.api.lastBody = body
      if (!h.api.postOk) return { ok: false, error: h.api.postError }
      let vehicleCount = 0
      try {
        vehicleCount = (JSON.parse(String(body.get('payload'))) as { vehicles?: unknown[] }).vehicles?.length ?? 0
      } catch {  }
      const photoCount = body.getAll('photos').length
      return {
        ok: true,
        data: h.api.ack ?? { id: 'srv-1', noTrip: 'TRP-SRV-0001', vehicleCount, photoCount },
      }
    },
  },
  getApiBaseUrl: () => 'http://api.test',
}))



vi.mock('@capacitor/geolocation', () => ({
  Geolocation: {
    getCurrentPosition: async () => { throw new Error('geolocation dimatikan di test') },
  },
}))



vi.mock('./adminPull', () => ({
  FORCE_ROSTER_SYNC_KEY: 'trip.sync.forceRoster',
  syncOnResume: () => {  },
}))



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



beforeEach(async () => {
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
  h.api.postError = { message: 'Server menolak payload', code: '500' }
  h.api.ack = null
  h.api.authenticated = true

  localStorage.clear()
  localStorage.setItem('trip.auth.officer.v1', JSON.stringify({
    id: 'off1', name: 'Petugas Satu', regionId: 'r1', regionName: 'R1', regionCode: 'R1',
  }))
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



describe('backoffMs', () => {
  it('menaik eksponensial 15s → 30s → 60s → … lalu ditahan di 10 menit', () => {
    expect(backoffMs(0)).toBe(0)
    expect(backoffMs(1)).toBe(15_000)
    expect(backoffMs(2)).toBe(30_000)
    expect(backoffMs(3)).toBe(60_000)
    expect(backoffMs(4)).toBe(120_000)
    expect(backoffMs(5)).toBe(240_000)
    expect(backoffMs(6)).toBe(480_000)
    expect(backoffMs(7)).toBe(600_000)
    expect(backoffMs(50)).toBe(600_000)
  })
})



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
    expect(rows).toHaveLength(1)
    expect(rows[0].syncId).toBe(syncIdPertama)
    expect(rows[0].trip.officer).toBe('Petugas Dua')
    expect(rows[0].photos![0].dataUrl).toBe(IMG_BARU)
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
    expect(rows[0].needsAttention).toBeFalsy()

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

    expect(payload.clientTripId).toBe('TRP-2026-0001')
    expect(payload.routeFrom).toBe('SJRE')
    expect(payload.routeTo).toBe('SBDZ')
    expect(payload.statusMuatan).toBe('muatan')
    expect(payload.tripPhotoIndex).toBe(0)
    expect(payload.vehicles[0].photoIndex).toBe(1)
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

    expect(h.api.postCalls).toBe(sebelum)
    const rows = await pendingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].lastErrorCode).toBe('PHOTO_MISSING')
    expect(rows[0].needsAttention).toBe(true)
  })

  it('server tak terjangkau (ping gagal) → siklus berhenti, antrean tidak disentuh', async () => {
    await addToSyncQueue(makeTrip())

    vi.setSystemTime(Date.now() + 10_000)
    h.api.pingOk = false
    const postSebelum = h.api.postCalls

    await processSyncQueue({ retryAll: true })

    expect(h.api.postCalls).toBe(postSebelum)
    const rows = await pendingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].attempts).toBe(0)
  })
})



describe('kegagalan server tidak pernah dilaporkan sebagai sukses', () => {
  it('HTTP 500: listener sukses tidak dipanggil, notifikasi gagal membawa pesan server', async () => {
    const sukses: string[] = []
    const gagal: Array<{ tripId: string; error: string; permanent: boolean }> = []
    const offSukses = onTripSynced(id => sukses.push(id))
    const offGagal = onSyncFailure(d => gagal.push(d))

    try {
      await addToSyncQueue(makeTrip())
      h.api.postOk = false

      await processSyncQueue({ retryAll: true })

      expect(sukses).toHaveLength(0)

      expect(gagal).toHaveLength(1)
      expect(gagal[0].tripId).toBe('TRP-2026-0001')
      expect(gagal[0].error).toContain('500')
      expect(gagal[0].error).toContain('Server menolak payload')

      expect(gagal[0].permanent).toBe(false)

      const rows = await pendingRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].attempts).toBe(1)
      expect(rows[0].lastError).toContain('500')
    } finally {
      offSukses()
      offGagal()
    }
  })

  it('HTTP 400 (payload ditolak permanen) menampilkan pesan server apa adanya', async () => {
    const sukses: string[] = []
    const gagal: Array<{ error: string; permanent: boolean }> = []
    const offSukses = onTripSynced(id => sukses.push(id))
    const offGagal = onSyncFailure(d => gagal.push(d))

    try {
      await addToSyncQueue(makeTrip())
      h.api.postOk = false
      h.api.postError = { message: 'Nomor plat kendaraan ke-1 wajib diisi', code: '400' }

      await processSyncQueue({ retryAll: true })

      expect(sukses).toHaveLength(0)
      expect(gagal).toHaveLength(1)
      expect(gagal[0].error).toContain('Nomor plat kendaraan ke-1 wajib diisi')
      expect(gagal[0].permanent).toBe(true)

      const rows = await pendingRows()
      expect(rows).toHaveLength(1)
      expect(rows[0].needsAttention).toBe(true)
    } finally {
      offSukses()
      offGagal()
    }
  })
})

// ── 6. Foto di antrean tidak boleh terhapus oleh state yang hanya metadata ─── Regresi: halaman Riwayat menampilkan "Foto Dokumentasi (0)" dan trip…

describe('foto di antrean tidak hilang oleh state tanpa foto', () => {
  it('retrySyncItem mempertahankan foto lama saat trip tidak membawa foto', async () => {
    await addToSyncQueue(makeTrip())

    // State yang hanya memuat metadata: semua photoUrl hilang.
    const metadataOnly = makeTrip({ photoUrl: undefined, vehicles: [
      { plate: 'B 1234 XY', type: 'Truck Besar', category: 'Internal', tariff: 100_000 },
    ] })
    await retrySyncItem(metadataOnly)

    const rows = await pendingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].tripPhoto?.dataUrl, 'foto bukti trip tidak boleh terhapus').toBe(IMG)
    expect(rows[0].photos?.[0]?.dataUrl, 'foto kendaraan tidak boleh terhapus').toBe(IMG)
  })

  it('setelah edit dari state tanpa foto, upload tetap membawa blob foto lengkap', async () => {
    await addToSyncQueue(makeTrip())

    const metadataOnly = makeTrip({ photoUrl: undefined, vehicles: [
      { plate: 'B 1234 XY', type: 'Truck Besar', category: 'Internal', tariff: 100_000 },
    ] })
    await retrySyncItem(metadataOnly)

    h.api.postCalls = 0
    await processSyncQueue({ retryAll: true })

    expect(h.api.postCalls).toBe(1)
    const body = h.api.lastBody
    expect(body, 'trip harus terkirim').toBeTruthy()
    const payload = JSON.parse(String(body!.get('payload'))) as {
      tripPhotoIndex: number
      vehicles: Array<{ photoIndex: number }>
    }
    expect(payload.tripPhotoIndex).toBe(0)
    expect(payload.vehicles[0].photoIndex).toBe(1)
    // Dua blob (foto bukti trip + foto kendaraan) — bukan payload tanpa foto.
    expect(body!.getAll('photos')).toHaveLength(2)
  })

  it('foto hasil ambil ulang tetap menggantikan foto lama', async () => {
    await addToSyncQueue(makeTrip())

    const retake = makeTrip({ photoUrl: IMG_BARU, vehicles: [
      { plate: 'B 1234 XY', type: 'Truck Besar', category: 'Internal', tariff: 100_000, photoUrl: IMG_BARU },
    ] })
    await retrySyncItem(retake)

    const rows = await pendingRows()
    expect(rows[0].tripPhoto?.dataUrl).toBe(IMG_BARU)
    expect(rows[0].photos?.[0]?.dataUrl).toBe(IMG_BARU)
  })

  it('readQueuedPhotos mengembalikan salinan foto untuk pemulihan Riwayat', async () => {
    await addToSyncQueue(makeTrip())

    const q = await readQueuedPhotos('TRP-2026-0001')
    expect(q?.tripPhotoUrl).toBe(IMG)
    expect(q?.vehiclePhotos[0]).toBe(IMG)
  })

  it('readQueuedPhotos mengembalikan null bila antrean tidak punya foto', async () => {
    await addToSyncQueue(makeTrip({ photoUrl: undefined, vehicles: [] }))
    expect(await readQueuedPhotos('TRP-2026-0001')).toBeNull()
    expect(await readQueuedPhotos('TRP-TIDAK-ADA')).toBeNull()
  })
})

// ── 7. "Berhasil terkirim" TIDAK BOLEH bohong ──────────────────────────────── Regresi yang dilaporkan: aplikasi mobile memberi tahu "trip berhasil…

describe('sukses upload hanya sah kalau server mengonfirmasi', () => {
  it('2xx tanpa konfirmasi trip TIDAK dianggap terkirim (tetap di antrean)', async () => {
    await addToSyncQueue(makeTrip())
    h.api.ack = { id: 'srv-1' }

    await processSyncQueue({ retryAll: true })

    const rows = await pendingRows()
    expect(rows, 'trip harus tetap di antrean kalau server tidak mengonfirmasi').toHaveLength(1)
    expect(rows[0].lastErrorCode).toBe('NOT_CONFIRMED')
    expect(rows[0].lastError).toMatch(/tidak mengonfirmasi/i)
  })

  it('2xx dengan body kosong juga tidak dianggap terkirim', async () => {
    await addToSyncQueue(makeTrip())
    h.api.ack = null
    const mod = await import('./api')
    const spy = vi.spyOn(mod.api, 'postMultipart').mockResolvedValue({ ok: true, data: undefined } as never)

    await processSyncQueue({ retryAll: true })
    spy.mockRestore()

    const rows = await pendingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].lastErrorCode).toBe('NOT_CONFIRMED')
  })

  it('server hanya menyimpan sebagian kendaraan -> upload dianggap gagal', async () => {
    await addToSyncQueue(makeTrip())
    h.api.ack = { id: 'srv-1', noTrip: 'TRP-SRV-0001', vehicleCount: 0, photoCount: 2 }

    await processSyncQueue({ retryAll: true })

    const rows = await pendingRows()
    expect(rows, 'trip dengan 0 kendaraan tidak boleh dianggap terkirim').toHaveLength(1)
    expect(rows[0].lastError).toMatch(/0 dari 1 kendaraan/i)
  })

  it('server hanya menyimpan sebagian foto -> upload dianggap gagal', async () => {
    await addToSyncQueue(makeTrip())
    h.api.ack = { id: 'srv-1', noTrip: 'TRP-SRV-0001', vehicleCount: 1, photoCount: 1 }

    await processSyncQueue({ retryAll: true })

    const rows = await pendingRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].lastError).toMatch(/foto dokumentasi/i)
  })

  it('konfirmasi lengkap -> trip keluar dari antrean dan ditandai terkirim', async () => {
    await addToSyncQueue(makeTrip())
    const synced: string[] = []
    const off = onTripSynced(id => synced.push(id))

    await processSyncQueue({ retryAll: true })
    off()

    expect(await pendingRows()).toHaveLength(0)
    expect(synced).toEqual(['TRP-2026-0001'])
  })
})

// ── 8. Kendaraan & fotonya tidak boleh hilang dari antrean ────────────────── Regresi: "kendaraan menghilang"

describe('kendaraan di antrean tidak pernah hilang', () => {
  const TRIP_2_KENDARAAN = makeTrip({
    vehicles: [
      { plate: 'B 1111 AA', type: 'Truck Besar', category: 'Internal', tariff: 100_000, photoUrl: IMG },
      { plate: 'B 2222 BB', type: 'Truck Sedang', category: 'Eksternal', tariff: 50_000, photoUrl: IMG_BARU },
    ],
  })

  it('state tanpa kendaraan tidak menghapus kendaraan yang sudah di antrean', async () => {
    await addToSyncQueue(TRIP_2_KENDARAAN)

    // State setelah aplikasi dibuka ulang: cache metadata tanpa kendaraan.
    const metadataOnly = makeTrip({ vehicles: [] })
    await retrySyncItem(metadataOnly)

    const rows = await pendingRows()
    expect(rows[0].trip.vehicles, 'kendaraan tidak boleh hilang dari antrean').toHaveLength(2)
    expect(rows[0].trip.vehicles?.map(v => v.plate)).toEqual(['B 1111 AA', 'B 2222 BB'])
  })

  it('foto kendaraan ikut dipertahankan saat state kehilangan kendaraan', async () => {
    await addToSyncQueue(TRIP_2_KENDARAAN)
    await retrySyncItem(makeTrip({ vehicles: [] }))

    const rows = await pendingRows()
    expect(rows[0].photos).toHaveLength(2)
    expect(rows[0].photos[0].dataUrl).toBe(IMG)
    expect(rows[0].photos[1].dataUrl).toBe(IMG_BARU)
  })

  it('kendaraan yang ditambah tetap terkirim lengkap ke server', async () => {
    await addToSyncQueue(makeTrip())
    await retrySyncItem(TRIP_2_KENDARAAN)

    h.api.postCalls = 0
    await processSyncQueue({ retryAll: true })

    expect(h.api.postCalls).toBe(1)
    const payload = JSON.parse(String(h.api.lastBody!.get('payload'))) as {
      vehicles: Array<{ noPolisi: string; photoIndex: number }>
    }
    expect(payload.vehicles.map(v => v.noPolisi)).toEqual(['B 1111 AA', 'B 2222 BB'])
    expect(payload.vehicles.every(v => v.photoIndex !== null)).toBe(true)
  })

  it('edit plat satu kendaraan tidak menggeser foto kendaraan lain', async () => {
    await addToSyncQueue(TRIP_2_KENDARAAN)

    const edited = makeTrip({
      vehicles: [
        { plate: 'B 9999 ZZ', type: 'Truck Besar', category: 'Internal', tariff: 100_000 },
        { plate: 'B 2222 BB', type: 'Truck Sedang', category: 'Eksternal', tariff: 50_000 },
      ],
    })
    await retrySyncItem(edited)

    const rows = await pendingRows()
    const vehicles = rows[0].trip.vehicles ?? []
    expect(vehicles.map(v => v.plate)).toEqual(['B 9999 ZZ', 'B 2222 BB'])
    expect(vehicles[0].photoUrl).toBe(IMG)
    expect(vehicles[1].photoUrl).toBe(IMG_BARU)
  })
})
