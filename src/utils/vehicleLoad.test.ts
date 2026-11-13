import { describe, it, expect } from 'vitest'
import { loadChoiceApplies } from './vehicleLoad'

describe('loadChoiceApplies', () => {
  it('menampilkan pilihan muatan untuk truk eksternal', () => {
    expect(loadChoiceApplies('Eksternal', 'Truk Kecil')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'Truk Sedang')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'Truk Besar')).toBe(true)
    expect(loadChoiceApplies('eksternal', 'truck kecil')).toBe(true)
  })

  it('menampilkan pilihan muatan untuk jenis yang menyebut trip', () => {
    expect(loadChoiceApplies('Eksternal', 'Trip Truck')).toBe(true)
    expect(loadChoiceApplies('Eksternal', 'Truk Trip Panjang')).toBe(true)
  })

  it('menyembunyikan pilihan muatan untuk kategori non-eksternal', () => {
    expect(loadChoiceApplies('Internal', 'Truk Besar')).toBe(false)
    expect(loadChoiceApplies('Lokal', 'Truk Kecil')).toBe(false)
  })

  it('menyembunyikan pilihan muatan untuk jenis selain truk', () => {
    expect(loadChoiceApplies('Eksternal', 'Motor')).toBe(false)
    expect(loadChoiceApplies('Eksternal', 'Mobil')).toBe(false)
    expect(loadChoiceApplies('Eksternal', 'Bus')).toBe(false)
    expect(loadChoiceApplies('Eksternal', '')).toBe(false)
  })
})
