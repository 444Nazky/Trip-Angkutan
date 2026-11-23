import { describe, it, expect } from 'vitest'
import { loadChoiceApplies } from './vehicleLoad'

describe('loadChoiceApplies', () => {
  it('menampilkan pilihan muatan untuk jenis angkutan barang eksternal', () => {
    expect(loadChoiceApplies('Eksternal', 'Truk Besar')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'Trado')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'Tanki Besar')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'Truk 7 Ton')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'Pickup')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'LV')).toBe(true)
  })

  it('tahan beda ejaan dan huruf besar/kecil', () => {
    expect(loadChoiceApplies('eksternal', 'truk 7 ton')).toBe(true)
    expect(loadChoiceApplies('EKSTERNAL', 'TANKI BESAR')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'lv')).toBe(true)
  })

  it('menyembunyikan pilihan muatan untuk kategori non-eksternal', () => {
    expect(loadChoiceApplies('Internal', 'Truk Besar')).toBe(false)
    expect(loadChoiceApplies('Lokal', 'Pickup')).toBe(false)
  })

  it('menyembunyikan pilihan muatan untuk jenis di luar daftar', () => {
    expect(loadChoiceApplies('Eksternal', 'Motor')).toBe(false)
    expect(loadChoiceApplies('Eksternal', 'Mobil')).toBe(false)
    expect(loadChoiceApplies('Eksternal', 'Bus')).toBe(false)
    expect(loadChoiceApplies('Eksternal', 'Truk Kecil')).toBe(false)
    expect(loadChoiceApplies('Eksternal', '')).toBe(false)
  })
})
