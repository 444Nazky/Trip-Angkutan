// ─── Unit Test: mergeTrips (pages/store.tsx) ───────────────────────────────── Regresi bug: EDIT trip yang sudah terkirim (plat/foto) ditimpa salinan…

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { healDermagaAccess, mergeTrips, vehicleTariff, type Trip } from './store'



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

  it('metadata localStorage (tanpa foto) tidak menimpa trip berfoto', () => {
    const withPhoto = base({ updatedAt: 5000, photoUrl: 'data:image/jpeg;base64,AAA' })
    const metadataOnly = base({ updatedAt: 5000 })
    const merged = mergeTrips([withPhoto], [metadataOnly])
    expect(merged).toHaveLength(1)
    expect(merged[0].photoUrl).toBe(withPhoto.photoUrl)
  })
})



describe('healDermagaAccess — scope dermaga tidak hilang setelah sync', () => {
  it('akses yang sudah ada tidak diubah', () => {
    const own = [{ id: 'D9', code: 'D9', name: 'Custom' }]
    const officer = { id: 'officer-1', name: 'X', region: 'R', dermagaAccess: own } as never
    expect(healDermagaAccess([officer])[0].dermagaAccess).toEqual(own)
  })

  it('petugas tanpa akses tidak mendapat akses dari data palsu (regresi data seed dihapus)', () => {
    // Tidak ada lagi roster seed di perangkat: petugas yang belum sinkron TIDAK boleh mendapat akses dermaga dari data contoh.
    const unknown = { id: 'server-only-1', name: 'X', region: 'X', dermagaAccess: [] } as never
    expect(healDermagaAccess([unknown])[0].dermagaAccess).toEqual([])
  })
})



describe('vehicleTariff — harga per kondisi kendaraan', () => {
  beforeEach(() => {
    localStorage.setItem(
      'trip.tariffs.v1',
      JSON.stringify([
        { id: '1', golongan: 'IV', type: 'Truk Sedang', loaded: 'Rp 280.000', loadedNum: 280000, empty: 'Rp 130.000', emptyNum: 130000, desc: '' },
      ]),
    )
  })

  afterEach(() => {
    localStorage.removeItem('trip.tariffs.v1')
  })

  it('memakai loadedNum saat ada muatan dan emptyNum saat kosong', () => {
    expect(vehicleTariff('Truk Sedang', 'Eksternal', 'loaded')).toBe(280000)
    expect(vehicleTariff('Truk Sedang', 'Eksternal', 'empty')).toBe(130000)
  })

  it('pencocokan tahan beda ejaan (Truck/Truk, huruf besar-kecil)', () => {
    expect(vehicleTariff('Truck Sedang', 'Eksternal', 'loaded')).toBe(280000)
    expect(vehicleTariff('truk sedang', 'Eksternal', 'empty')).toBe(130000)
  })

  it('kendaraan internal tetap Rp 0 untuk kedua kondisi', () => {
    expect(vehicleTariff('Truk Sedang', 'Internal', 'loaded')).toBe(0)
    expect(vehicleTariff('Truk Sedang', 'Internal', 'empty')).toBe(0)
  })

  it('jenis tanpa tarif master -> 0, bukan angka contoh', () => {
    expect(vehicleTariff('Truk Apotek', 'Eksternal', 'loaded')).toBe(0)
  })
})
