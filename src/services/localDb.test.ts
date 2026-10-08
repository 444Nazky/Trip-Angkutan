// ─── Unit Test: Penyimpanan Antrean Sync (services/localDb.ts) ───────────────
// Memvalidasi lapisan IndexedDB yang menampung antrean sinkronisasi (`pending`),
// daftar trip (`trips`) dan metadata (`meta`) — inti klaim offline-first:
//   "data TIDAK BOLEH hilang saat app direfresh/restart dan hanya keluar dari
//    antrean SETELAH server memberi respons sukses".
//
// IndexedDB sungguhan disimulasikan dengan `fake-indexeddb` (bukan mock buatan
// sendiri), sehingga jalur IDB — bukan fallback localStorage — yang diuji.
//
// Jalankan: npm run test:unit

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  dbAll,
  dbClear,
  dbCount,
  dbDelete,
  dbGet,
  dbPut,
  dbPutMany,
  initLocalDb,
  localDbBackend,
  metaGet,
  metaSet,
  requestPersistentStorage,
} from './localDb'

/**
 * Potongan baris antrean. keyPath-nya (`syncId`) identik dengan `SyncItem`
 * di services/sync.ts — sengaja tidak mengimpor tipe Trip lengkap agar test
 * fokus pada mekanik penyimpanan.
 */
interface QueueRow {
  syncId: string
  tripId: string
  attempts: number
  createdAt: number
}

const row = (tripId: string, over: Partial<QueueRow> = {}): QueueRow => ({
  syncId: `trip:${tripId}:1791383550000`,
  tripId,
  attempts: 0,
  createdAt: 1791383550000,
  ...over,
})

const pendings = () => dbAll<QueueRow>('pending')
const trips = () => dbAll<{ id: string }>('trips')

beforeEach(async () => {
  await dbClear('pending')
  await dbClear('trips')
  await dbClear('meta')
})

describe('backend penyimpanan', () => {
  it('memakai IndexedDB (bukan fallback localStorage)', async () => {
    expect(await initLocalDb()).toBe('indexeddb')
    expect(localDbBackend()).toBe('indexeddb')
    expect(typeof indexedDB).toBe('object')
  })
})

describe('antrean syncQueue di IndexedDB', () => {
  it('menyimpan, membaca, dan menghitung item antrean', async () => {
    expect(await dbPut('pending', row('TRP-1'))).toBe(true)

    expect(await dbCount('pending')).toBe(1)
    const rows = await pendings()
    expect(rows).toHaveLength(1)
    expect(rows[0].tripId).toBe('TRP-1')

    const satu = await dbGet<QueueRow>('pending', 'trip:TRP-1:1791383550000')
    expect(satu?.tripId).toBe('TRP-1')
  })

  it('IDEMPOTEN: menulis trip dengan syncId sama tidak menggandakan item', async () => {
    await dbPut('pending', row('TRP-1'))
    await dbPut('pending', row('TRP-1', { attempts: 3 })) // percobaan gagal sebelumnya

    const rows = await pendings()
    expect(rows).toHaveLength(1)
    expect(rows[0].attempts).toBe(3) // diperbarui di tempat, bukan duplikat
  })

  it('membatalkan tulis bila keyPath kosong (tidak membuat baris cacat)', async () => {
    expect(await dbPut('pending', { attempts: 1 } as QueueRow)).toBe(false)
    expect(await dbCount('pending')).toBe(0)
  })

  it('menulis massal (dbPutMany) lalu menghapus per item', async () => {
    const rows = [row('TRP-1'), row('TRP-2'), row('TRP-3')]
    expect(await dbPutMany('pending', rows)).toBe(true)
    expect(await dbCount('pending')).toBe(3)

    // Simulasi konfirmasi server → item keluar antrean SATU PER SATU
    expect(await dbDelete('pending', 'trip:TRP-2:1791383550000')).toBe(true)
    const sisa = await pendings()
    expect(sisa.map(r => r.tripId)).toEqual(['TRP-1', 'TRP-3'])

    // Menghapus item yang sudah tidak ada tetap aman (idempoten)
    expect(await dbDelete('pending', 'trip:TRP-2:1791383550000')).toBe(true)
    expect(await dbCount('pending')).toBe(2)
  })

  it('store trips terpisah dari pending — kosongkan antrean tak menghapus riwayat', async () => {
    await dbPutMany('pending', [row('TRP-1')])
    await dbPutMany('trips', [{ id: 'TRP-1' }, { id: 'TRP-2' }])

    await dbClear('pending')

    expect(await dbCount('pending')).toBe(0)
    expect((await trips()).map(t => t.id).sort()).toEqual(['TRP-1', 'TRP-2'])
  })

  it('meta (penanda migrasi) dibaca & ditulis utuh', async () => {
    expect(await metaGet('sync.queue.migrated.v1')).toBeNull()

    await metaSet('sync.queue.migrated.v1', 1791383550000)
    expect(await metaGet('sync.queue.migrated.v1')).toBe(1791383550000)

    await metaSet('flag', { nested: [1, 2, 3] })
    expect(await metaGet('flag')).toEqual({ nested: [1, 2, 3] })
  })
})

describe('persistensi lintas restart', () => {
  it('data antrean BERTAHAN saat modul dimuat ulang (simulasi app direstart)', async () => {
    await dbPutMany('pending', [row('TRP-1'), row('TRP-2')])
    await metaSet('trips', 2)

    // Simulasi restart: buang seluruh module cache lalu impor ulang modul DB.
    vi.resetModules()
    const fresh = await import('./localDb')

    expect(await fresh.dbCount('pending')).toBe(2)
    const rows = await fresh.dbAll<QueueRow>('pending')
    expect(rows.map(r => r.tripId).sort()).toEqual(['TRP-1', 'TRP-2'])
    expect(await fresh.metaGet('trips')).toBe(2)
  })

  it('requestPersistentStorage tidak pernah melempar (browser tanpa dukungan)', async () => {
    await expect(requestPersistentStorage()).resolves.toBeTypeOf('boolean')
  })
})
