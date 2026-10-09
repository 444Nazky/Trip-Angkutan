import { describe, it, expect } from 'vitest'
import { isNewer, semverLabel } from './ota'

describe('ota version compare', () => {
  it('SemVer murni lebih baru bila major lebih besar', () => {
    expect(isNewer('2.0.0', '1.9.9')).toBe(true)
    expect(isNewer('1.9.9', '2.0.0')).toBe(false)
  })

  it('SemVer murni lebih baru bila minor lebih besar (major sama)', () => {
    expect(isNewer('1.2.0', '1.1.9')).toBe(true)
    expect(isNewer('1.1.9', '1.2.0')).toBe(false)
  })

  it('SemVer murni lebih baru bila patch lebih besar (major.minor sama)', () => {
    expect(isNewer('1.0.2', '1.0.1')).toBe(true)
    expect(isNewer('1.0.1', '1.0.2')).toBe(false)
  })

  it('Versi sama dianggap tidak lebih baru', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
  })

  it('Versi hybrid SemVer+timestamp lebih baru bila prefix sama tapi build lebih besar', () => {
    // +YYYYMMDDHHMMSS: nilai lebih besar = build lebih baru
    expect(isNewer('1.0.0+20261009090000', '1.0.0+20261009090000')).toBe(false)
    expect(isNewer('1.0.0+20261009093000', '1.0.0+20261009090000')).toBe(true)
    expect(isNewer('1.0.0+20261009090000', '1.0.0+20261009093000')).toBe(false)
  })

  it('Versi hybrid dengan prefix lebih baru dianggap lebih baru meski build lebih kecil', () => {
    expect(isNewer('1.0.1+100', '1.0.0+9999')).toBe(true)
    expect(isNewer('1.0.0+9999', '1.0.1+100')).toBe(false)
  })

  it('Versi hybrid dengan prefix sama: yang punya build lebih baru dari yang tidak punya build', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false)
    expect(isNewer('1.0.0+9999', '1.0.0')).toBe(true)
    expect(isNewer('1.0.0', '1.0.0+9999')).toBe(false)
  })

  it('Format timestamp murni dibanding segmen numerik', () => {
    expect(isNewer('1791494911890', '1791494911889')).toBe(true)
    expect(isNewer('1791494911889', '1791494911890')).toBe(false)
  })

  it('Timestamp murni vs hybrid SemVer: hybrid SemVer dianggap lebih baru / tidaknya', () => {
    // Bila kedua versi punya SemVer prefix, pembanding prefix yang menentukan.
    // Di bawah ini: kedua versi TIDAK punya SemVer prefix (satu hybrid dengan prefix
    // tidak valid untuk SemVer dan satu timestamp murni) → masuk jalur numerik umum.
    expect(isNewer('1.0.0+9999', '1791494911889')).toBe(false)
    expect(isNewer('1791494911889', '1.0.0+9999')).toBe(true)
  })

  it('Versi lokal kosong dianggap lebih lama dari remote apa pun', () => {
    expect(isNewer('1.0.0', '')).toBe(true)
    expect(isNewer('1.0.0', null as any)).toBe(true)
  })

  it('Remote kosong/undefined tidak dianggap lebih baru', () => {
    expect(isNewer('', '1.0.0')).toBe(false)
    expect(isNewer(null as any, '1.0.0')).toBe(false)
  })

  it('semverLabel mengekstrak prefix manusiawi', () => {
    expect(semverLabel('1.0.2+9999')).toBe('1.0.2')
    expect(semverLabel('1.0.0')).toBe('1.0.0')
    expect(semverLabel('999999')).toBe('999999')
    expect(semverLabel('')).toBe('—')
    expect(semverLabel(null as any)).toBe('—')
  })
})
