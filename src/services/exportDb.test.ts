// ─── Unit Test: Ekspor Data Trip (services/exportDb.ts) ─────────────────────
// Memastikan ekspor hanya membawa trip yang SUDAH tersinkron, tidak menulis
// file kosong, dan tetap menemukan data dari cache lokal bila IndexedDB gagal.

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { dbClear, dbPut } from './localDb'
import {
  buildLocalDatabaseExport,
  exportLocalDatabase,
  EXPORT_WINDOW_DAYS,
  LOCAL_TRIPS_CACHE_KEY,
} from './exportDb'

const NOW = Date.parse('2026-11-18T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const recent = new Date(NOW - 2 * DAY).toISOString()
const old = new Date(NOW - 41 * DAY).toISOString()

beforeEach(async () => {
  await dbClear('trips')
  await dbClear('pending')
  await dbClear('pending-cancel')
  await dbClear('meta')
  localStorage.clear()
})

describe('buildLocalDatabaseExport', () => {
  it('hanya mengekspor trip tersinkron dalam 40 hari terakhir', async () => {
    await dbPut('trips', { id: 'terkirim', synced: true, completedAt: recent })
    await dbPut('trips', { id: 'belum-terkirim', synced: false, completedAt: recent })
    await dbPut('trips', { id: 'lama', synced: true, completedAt: old })
    await dbPut('trips', { id: 'dibatalkan', synced: true, canceled: true, completedAt: recent })

    const result = await buildLocalDatabaseExport(NOW)

    expect(result.kind).toBe('synced-trips')
    expect(result.windowDays).toBe(EXPORT_WINDOW_DAYS)
    expect(result.trips.map(t => t.id)).toEqual(['terkirim'])
    expect(result.counts.trips).toBe(1)
    // File tidak boleh kosong: ada data trip nyata di dalam JSON.
    expect(JSON.stringify(result)).toContain('terkirim')
  })

  it('memakai cache localStorage bila IndexedDB tidak berisi trip', async () => {
    localStorage.setItem(LOCAL_TRIPS_CACHE_KEY, JSON.stringify([
      { id: 'cache-terkirim', synced: true, completedAt: recent, route: 'A → B' },
      { id: 'cache-lokal', synced: false, completedAt: recent, route: 'C → D' },
    ]))

    const result = await buildLocalDatabaseExport(NOW)

    expect(result.trips.map(t => t.id)).toEqual(['cache-terkirim'])
    expect(result.counts.trips).toBe(1)
  })

  it('menyertakan foto bukti dan dokumentasi beserta hitungannya', async () => {
    await dbPut('trips', {
      id: 'lengkap',
      synced: true,
      completedAt: recent,
      photoUrl: 'data:image/jpeg;base64,DOKUMENTASI',
      proofUrl: 'data:image/jpeg;base64,BUKTI',
      selfieUrl: 'data:image/jpeg;base64,SWAFOTO',
      vehicles: [{ plate: 'B 1 X', photoUrl: 'data:image/jpeg;base64,KENDARAAN' }],
    })

    const result = await buildLocalDatabaseExport(NOW)

    expect(result.counts.photos).toBe(4)
    expect(result.counts.withProof).toBe(1)
    expect(result.counts.withDocumentation).toBe(1)
    expect(JSON.stringify(result)).toContain('BUKTI')
    expect(JSON.stringify(result)).toContain('DOKUMENTASI')
  })
})

describe('exportLocalDatabase', () => {
  it('menolak membuat file kosong saat belum ada trip tersinkron', async () => {
    const result = await exportLocalDatabase()

    expect(result.ok).toBe(false)
    expect(result.size).toBe(0)
    expect(result.message).toContain('Belum ada trip tersinkron')
  })
})
