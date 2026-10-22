import { describe, expect, it } from 'vitest'
import { buildRecap } from './recap'
import type { ReportTrip, ReportVehicle } from './trips'

const vehicle = (over: Partial<ReportVehicle>): ReportVehicle => ({
  id: 'V1',
  no_polisi: 'BG 1 AA',
  vehicle_type: 'Truck Sedang',
  golongan: 'III',
  has_load: 1,
  tariff_amount: 280000,
  foto_path: null,
  ...over,
})

const trip = (over: Partial<ReportTrip> = {}, vehicles: ReportVehicle[] = []): ReportTrip => ({
  id: 'T1',
  no_trip: 'TRIP-1',
  route_from: 'SJRE',
  route_to: 'BDAU',
  status_muatan: 'muatan',
  keterangan: null,
  foto_kosong_path: null,
  created_at: '2026-10-22T01:00:00Z',
  vehicle_count: vehicles.length,
  trip_revenue: 0,
  vehicles,
  ...over,
})

describe('buildRecap', () => {
  it('mengelompokkan per golongan dan jenis serta menjumlahkan muatan, unit, dan pendapatan', () => {
    const groups = buildRecap([
      trip({}, [
        vehicle({ id: 'V1', kategori: 'Eksternal' }),
        vehicle({ id: 'V2', kategori: 'Eksternal', has_load: 0, tariff_amount: 130000 }),
        vehicle({ id: 'V3', kategori: 'Internal', tariff_amount: 0 }),
      ]),
      trip({ id: 'T2' }, [
        vehicle({ id: 'V4', kategori: 'Eksternal', vehicle_type: 'Truck Besar', tariff_amount: 450000 }),
        vehicle({ id: 'V5', kategori: 'Lokal', has_load: 0, tariff_amount: 200000 }),
      ]),
    ])

    expect(groups.map(g => g.golongan)).toEqual(['Internal', 'Eksternal', 'Lokal'])

    const eksternal = groups[1]
    expect(eksternal.loaded).toBe(2)
    expect(eksternal.empty).toBe(1)
    expect(eksternal.total).toBe(3)
    expect(eksternal.revenue).toBe(280000 + 130000 + 450000)
    expect(eksternal.rows.map(r => r.jenis)).toEqual(['Truck Besar', 'Truck Sedang'])
    expect(eksternal.rows[1]).toMatchObject({ loaded: 1, empty: 1, total: 2, revenue: 410000 })
  })
})
