import { beforeEach, describe, expect, it } from 'vitest'
import { REGIONS_STORAGE_KEY, regionDisplayName } from './adminPull'

describe('regionDisplayName', () => {
  beforeEach(() => {
    localStorage.clear()
    localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify([
      { id: 'r1', name: 'SEJIRAM', code: 'KMP' },
      { id: 'r2', name: 'BADAU', code: 'BDU' },
    ]))
  })

  it('mengubah kode region lama menjadi nama wilayah', () => {
    expect(regionDisplayName('KMP')).toBe('SEJIRAM')
    expect(regionDisplayName('r2')).toBe('BADAU')
  })

  it('memakai nama dari data petugas bila tersedia', () => {
    expect(regionDisplayName('KMP', 'KENEPAI')).toBe('KENEPAI')
  })

  it('tidak menampilkan nilai kosong', () => {
    expect(regionDisplayName('', '')).toBe('')
  })
})
