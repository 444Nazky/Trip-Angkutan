import { describe, expect, it } from 'vitest'
import { formatPlateNumber, sanitizePlateInput, validatePlate } from './plateFormatter'

const fmt = (raw: string) => formatPlateNumber(sanitizePlateInput(raw))

describe('formatPlateNumber', () => {
  it('menyisipkan spasi otomatis dan membatasi tiap bagian', () => {
    expect(fmt('B777ERB')).toBe('B 777 ERB')
    expect(fmt('kt1717prf')).toBe('KT 1717 PRF')
    expect(fmt('B 777 ERB')).toBe('B 777 ERB')
    expect(fmt('B12345XY')).toBe('B 1234 XY')
    expect(fmt('B123XYZW')).toBe('B 123 XYZ')
    expect(fmt('B!@# 777-ERB')).toBe('B 777 ERB')
  })

  it('menolak hasil yang belum lengkap saat validasi', () => {
    expect(validatePlate(fmt('B')).valid).toBe(false)
    expect(validatePlate(fmt('B 777')).valid).toBe(false)
    expect(validatePlate(fmt('B 777 ERB')).valid).toBe(true)
    expect(validatePlate(fmt('KT 1717 PRF')).valid).toBe(true)
  })
})
