/**
 * Test untuk helper grouping relasi officer (bulk vs per-officer).
 *
 * Helper ini menjaga hasil endpoint /officers tetap sama dengan versi lama
 * (yang query per officer), padahal sekarang datanya diambil 2 query untuk
 * semua officer sekaligus.
 */

import { describe, it, expect } from 'vitest'
import { groupOfficerExtras } from '../../supabase/functions/api/_officerExtras'

describe('groupOfficerExtras', () => {
  const regionRows = [
    { officer_id: 1, regions: { id: 'r1', name: 'Cirebon', code: 'CRB' } },
    { officer_id: 1, regions: { id: 'r2', name: 'Indramayu', code: 'IDM' } },
    { officer_id: 3, regions: { id: 'r1', name: 'Cirebon', code: 'CRB' } },
  ]
  const dermagaRows = [
    { officer_id: 1, dermagas: { id: 'd1', name: 'Dermaga A', code: 'DMGA', region_id: 'r1' } },
    { officer_id: 3, dermagas: { id: 'd2', name: 'Dermaga B', code: 'DMGB', region_id: 'r1' } },
  ]

  it('mengelompokkan relasi ke officer yang tepat', () => {
    const map = groupOfficerExtras(['1', '2', '3'], regionRows, dermagaRows)

    expect(map['1'].regions.map(r => r.code)).toEqual(['CRB', 'IDM'])
    expect(map['1'].dermagas.map(d => d.code)).toEqual(['DMGA'])
    expect(map['3'].regions.map(r => r.code)).toEqual(['CRB'])
    expect(map['3'].dermagas.map(d => d.code)).toEqual(['DMGB'])
  })

  it('memberi entri kosong untuk officer tanpa relasi', () => {
    const map = groupOfficerExtras(['1', '2', '3'], regionRows, dermagaRows)

    expect(map['2']).toEqual({ regions: [], dermagas: [] })
  })

  it('menangani input null/undefined tanpa error', () => {
    const map = groupOfficerExtras(['1', '2'], null, undefined)

    expect(map['1']).toEqual({ regions: [], dermagas: [] })
    expect(map['2']).toEqual({ regions: [], dermagas: [] })
  })

  it('mengabaikan baris dengan officer_id di luar daftar', () => {
    const map = groupOfficerExtras(
      ['1'],
      [...regionRows, { officer_id: 99, regions: { id: 'rx', name: 'X', code: 'XXX' } }],
      dermagaRows,
    )

    expect(Object.keys(map)).toEqual(['1'])
    expect(map['1'].regions.map(r => r.code)).toEqual(['CRB', 'IDM'])
  })

  it('mengabaikan baris dengan relasi null', () => {
    const map = groupOfficerExtras(
      ['1'],
      [{ officer_id: 1, regions: null }],
      [{ officer_id: 1, dermagas: null }],
    )

    expect(map['1']).toEqual({ regions: [], dermagas: [] })
  })

  it('menyamakan hasil dengan query per-officer (regresi N+1)', () => {
    // Simulasi versi lama: satu query per officer, lalu digabung.
    const perOfficer = (id: string) => ({
      regions: regionRows.filter(r => String(r.officer_id) === id).map(r => r.regions).filter(Boolean),
      dermagas: dermagaRows.filter(d => String(d.officer_id) === id).map(d => d.dermagas).filter(Boolean),
    })

    const ids = ['1', '2', '3']
    const bulk = groupOfficerExtras(ids, regionRows, dermagaRows)

    for (const id of ids) {
      expect(bulk[id]).toEqual(perOfficer(id))
    }
  })
})
