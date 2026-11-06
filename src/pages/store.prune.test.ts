// ─── Unit Test: pruneExpiredTrips (pages/store.tsx) ─────────────────────────
// Auto-clear riwayat 7 hari. Data yang belum pasti sampai server TIDAK boleh
// terhapus: trip pending/local selalu dipertahankan, trip dibatalkan hanya
// dibuang kalau dokumen pembatalannya sudah dikonfirmasi server.

import { describe, expect, it } from 'vitest'
import { HISTORY_TTL_MS, pruneExpiredTrips, type Trip } from './store'

const base = (over: Partial<Trip>): Trip => ({
  id: 'T1',
  route: 'A → B',
  status: 'Selesai',
  time: '10:00',
  date: '01/01/2026',
  load: 'Kosong',
  vehicle: '-',
  type: '-',
  category: '-',
  revenue: '-',
  revenueNum: 0,
  officer: 'Budi',
  duration: '-',
  photo: true,
  ...over,
})

const NOW = Date.parse('2026-11-06T12:00:00Z')
const old = new Date(NOW - HISTORY_TTL_MS - 60_000).toISOString()
const fresh = new Date(NOW - 60_000).toISOString()

describe('pruneExpiredTrips — auto-clear 7 hari', () => {
  it('trip terkirim lebih dari 7 hari dihapus', () => {
    const { kept, dropped } = pruneExpiredTrips([base({ synced: true, completedAt: old })], {}, NOW)
    expect(kept).toHaveLength(0)
    expect(dropped).toHaveLength(1)
  })

  it('trip terkirim yang masih muda dipertahankan', () => {
    const { kept, dropped } = pruneExpiredTrips([base({ synced: true, completedAt: fresh })], {}, NOW)
    expect(kept).toHaveLength(1)
    expect(dropped).toHaveLength(0)
  })

  it('trip belum tersinkron (pending/local) tidak pernah dihapus walau tua', () => {
    const { kept } = pruneExpiredTrips([
      base({ id: 'a', synced: false, completedAt: old }),
      base({ id: 'b', completedAt: old }),
    ], {}, NOW)
    expect(kept).toHaveLength(2)
  })

  it('trip dibatalkan tua dibuang hanya kalau dokumen batalnya sudah diterima server', () => {
    const pending = base({ id: 'a', canceled: true, cancelId: 'C1', completedAt: old })
    const delivered = base({ id: 'b', canceled: true, cancelId: 'C2', completedAt: old })
    const { kept, dropped } = pruneExpiredTrips([pending, delivered], { C2: { deliveredAt: 1 } }, NOW)
    expect(kept.map(t => t.id)).toEqual(['a'])
    expect(dropped.map(t => t.id)).toEqual(['b'])
  })

  it('trip tanpa completedAt dipertahankan', () => {
    const { kept } = pruneExpiredTrips([base({ synced: true })], {}, NOW)
    expect(kept).toHaveLength(1)
  })
})
