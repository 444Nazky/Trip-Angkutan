import { beforeEach, describe, expect, it } from 'vitest'
import { vehicleTariff } from './store'
import { TARIFFS_STORAGE_KEY } from '../services/masterTariffs'

/**
 * Harga yang ditampilkan di HP harus sama dengan yang disimpan server.
 * Aturan server (resolveTariff): Internal = 0, Lokal = lokal_tariff,
 * selain itu muatan/kosong. Dulu Lokal ikut memakai muatan, sehingga
 * petugas mengutip harga berbeda dari tagihan kantor.
 */
describe('vehicleTariff', () => {
  beforeEach(() => {
    localStorage.setItem(
      TARIFFS_STORAGE_KEY,
      JSON.stringify([
        {
          id: 't-1',
          golongan: 'II',
          type: 'Truk Besar',
          loaded: 'Rp 100.000',
          loadedNum: 100_000,
          empty: 'Rp 80.000',
          emptyNum: 80_000,
          lokalNum: 45_000,
          desc: '',
        },
      ]),
    )
  })

  it('kategori Lokal memakai lokalNum, bukan tarif muatan', () => {
    expect(vehicleTariff('Truk Besar', 'Lokal', 'loaded')).toBe(45_000)
    expect(vehicleTariff('Truk Besar', 'Lokal', 'empty')).toBe(45_000)
  })

  it('kategori Eksternal memakai muatan/kosong', () => {
    expect(vehicleTariff('Truk Besar', 'Eksternal', 'loaded')).toBe(100_000)
    expect(vehicleTariff('Truk Besar', 'Eksternal', 'empty')).toBe(80_000)
  })

  it('Internal selalu 0', () => {
    expect(vehicleTariff('Truk Besar', 'Internal', 'loaded')).toBe(0)
  })

  it('jenis tanpa tarif master -> 0, bukan angka contoh', () => {
    expect(vehicleTariff('Jenis Tidak Ada', 'Eksternal', 'loaded')).toBe(0)
  })
})
