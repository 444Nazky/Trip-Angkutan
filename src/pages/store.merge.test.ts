// ─── Unit Test: mergeTrips (pages/store.tsx) ─────────────────────────────────
// Regresi bug: EDIT trip yang sudah terkirim (plat/foto) ditimpa salinan lama
// (synced:true) saat rekonsiliasi localStorage ↔ IndexedDB → hasil edit hilang
// dan status "masuk antrean" seolah tidak pernah terkirim.
// Aturan: updatedAt terbaru menang; bila seri, synced:true tidak ditimpa false.

import { describe, expect, it } from 'vitest'
import { healDermagaAccess, mergeTrips, type Trip } from './store'
import { SEED_OFFICERS } from '../services/seedData'

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

describe('mergeTrips — edit pasca-kirim tidak hilang', () => {
  it('versi dengan updatedAt lebih baru menang (edit dipertahankan)', () => {
    const syncedOld = base({ synced: true, updatedAt: 1000, vehicle: 'LAMA' })
    const editedNew = base({ synced: false, updatedAt: 2000, vehicle: 'BARU' })
    const merged = mergeTrips([syncedOld], [editedNew])
    expect(merged).toHaveLength(1)
    expect(merged[0].vehicle).toBe('BARU')
    expect(merged[0].synced).toBe(false)
  })

  it('tanpa updatedAt (data lama): synced:true tidak ditimpa synced:false', () => {
    const synced = base({ synced: true })
    const unsynced = base({ synced: false })
    const merged = mergeTrips([synced], [unsynced])
    expect(merged[0].synced).toBe(true)
  })

  it('tidak menduplikasi trip dengan id sama', () => {
    const merged = mergeTrips([base({ updatedAt: 1 })], [base({ updatedAt: 2 })])
    expect(merged).toHaveLength(1)
  })
})

describe('healDermagaAccess — scope dermaga tidak hilang setelah sync', () => {
  const seed = SEED_OFFICERS[0]

  it('isi ulang dermagaAccess kosong dari seed (regresi akun ke-lock)', () => {
    const blanked = { id: seed.id, name: seed.name, region: seed.regionCode, dermagaAccess: [] } as never
    const [healed] = healDermagaAccess([blanked])
    expect(healed.dermagaAccess?.length).toBeGreaterThan(0)
  })

  it('akses yang sudah ada tidak diubah', () => {
    const own = [{ id: 'D9', code: 'D9', name: 'Custom' }]
    const officer = { id: seed.id, name: seed.name, region: seed.regionCode, dermagaAccess: own } as never
    expect(healDermagaAccess([officer])[0].dermagaAccess).toEqual(own)
  })

  it('petugas non-seed tetap dibiarkan apa adanya (diserahkan ke sync berikutnya)', () => {
    const unknown = { id: 'server-only-1', name: 'X', region: 'X', dermagaAccess: [] } as never
    expect(healDermagaAccess([unknown])[0].dermagaAccess).toEqual([])
  })
})
