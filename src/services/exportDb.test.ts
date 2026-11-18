// ─── Unit Test: Ekspor Database Lokal (services/exportDb.ts) ────────────────
// Memastikan ekspor hanya membawa data 40 hari terakhir, menyertakan petugas
// dan master data penting, serta TIDAK membocorkan kredensial.

import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { dbClear, dbPut } from './localDb'
import { buildLocalDatabaseExport, EXPORT_WINDOW_DAYS } from './exportDb'

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
  it('mengekspor trip 40 hari terakhir dan membuang yang lebih tua', async () => {
    await dbPut('trips', { id: 'baru', completedAt: recent })
    await dbPut('trips', { id: 'lama', completedAt: old })

    const result = await buildLocalDatabaseExport(NOW)

    expect(result.windowDays).toBe(EXPORT_WINDOW_DAYS)
    expect(result.trips.map(t => (t as { id: string }).id)).toEqual(['baru'])
    expect(result.counts.trips).toBe(1)
  })

  it('menyertakan antrean kirim dan pembatalan dalam rentang waktu', async () => {
    await dbPut('pending', { syncId: 'p-baru', createdAt: NOW - DAY })
    await dbPut('pending', { syncId: 'p-lama', createdAt: NOW - 41 * DAY })
    await dbPut('pending-cancel', { cancelId: 'c-baru', cancelledAt: recent })
    await dbPut('pending-cancel', { cancelId: 'c-lama', cancelledAt: old })

    const result = await buildLocalDatabaseExport(NOW)

    expect(result.pendingTrips.map(t => (t as { syncId: string }).syncId)).toEqual(['p-baru'])
    expect(result.pendingCancels.map(t => (t as { cancelId: string }).cancelId)).toEqual(['c-baru'])
  })

  it('menyertakan petugas + master penting, tetapi tidak kredensial/token', async () => {
    localStorage.setItem('trip.officers.v1', JSON.stringify([{ id: 'o-1', name: 'Budi' }]))
    localStorage.setItem('trip.master.offline.v1', JSON.stringify({ plates: [{ plate: 'B 1 X' }] }))
    localStorage.setItem('trip.officers.credentials.v1', JSON.stringify({ 'o-1': 'hash' }))
    localStorage.setItem('trip.auth.token.v2', 'rahasia')

    const result = await buildLocalDatabaseExport(NOW)

    expect(result.counts.officers).toBe(1)
    expect(result.data['trip.officers.v1']).toEqual([{ id: 'o-1', name: 'Budi' }])
    expect(result.data['trip.master.offline.v1']).toEqual({ plates: [{ plate: 'B 1 X' }] })
    expect(result.data['trip.officers.credentials.v1']).toBeUndefined()
    expect(result.data['trip.auth.token.v2']).toBeUndefined()
  })
})
