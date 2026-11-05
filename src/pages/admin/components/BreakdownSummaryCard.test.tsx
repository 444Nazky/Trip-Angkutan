/**
 * Render harness — Breakdown Summary Card.
 *
 * Memeriksa agregasi kartu dengan data laporan tiruan: jumlah trip per
 * golongan/jenis, tarif, pecahan Ada/Tanpa Muatan, dan trip tanpa kendaraan
 * yang wajib disebutkan (bukan disembunyikan).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { BreakdownSummaryCard } from './BreakdownSummaryCard'
import type { ReportTrip, ReportVehicle } from '../../../services/trips'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

function vehicle(partial: Partial<ReportVehicle> & Pick<ReportVehicle, 'no_polisi' | 'vehicle_type'>): ReportVehicle {
  return {
    id: partial.id ?? partial.no_polisi,
    golongan: null as never,
    has_load: 0,
    tariff_amount: 0,
    foto_path: null,
    ...partial,
  } as ReportVehicle
}

function trip(id: string, vehicles: ReportVehicle[]): ReportTrip {
  return {
    id,
    no_trip: id,
    route_from: null,
    route_to: null,
    status_muatan: 'muatan',
    keterangan: null,
    foto_kosong_path: null,
    created_at: '2026-11-01T00:00:00Z',
    vehicle_count: vehicles.length,
    trip_revenue: vehicles.reduce((s, v) => s + (v.tariff_amount || 0), 0),
    vehicles,
  } as ReportTrip
}

const trips: ReportTrip[] = [
  trip('t1', [vehicle({ no_polisi: 'B1', vehicle_type: 'Dump Truck', kategori: 'Eksternal', has_load: 1, tariff_amount: 100 } as ReportVehicle)]),
  trip('t2', [vehicle({ no_polisi: 'B2', vehicle_type: 'Dump Truck', kategori: 'Eksternal', has_load: 0, tariff_amount: 0 } as ReportVehicle)]),
  trip('t3', [vehicle({ no_polisi: 'B3', vehicle_type: 'Motor', kategori: 'Internal', has_load: 1 } as ReportVehicle)]),
  trip('t4', [
    vehicle({ no_polisi: 'B4', vehicle_type: 'Dump Truck', kategori: 'Eksternal', has_load: 1, tariff_amount: 50 } as ReportVehicle),
    vehicle({ no_polisi: 'B5', vehicle_type: 'Motor', kategori: 'Internal', has_load: 1 } as ReportVehicle),
  ]),
  trip('t5', []),
]

describe('BreakdownSummaryCard', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function renderCard() {
    act(() => {
      root = createRoot(container)
      root.render(React.createElement(BreakdownSummaryCard, { reportTrips: trips, revealed: true, onToggleReveal: () => {} }))
    })
  }

  it('menghitung trip, tarif, dan pecahan muatan tanpa data palsu', () => {
    renderCard()
    const text = container.textContent ?? ''
    expect(text).toContain('Golongan: Eksternal')
    // Eksternal: t1, t2, t4
    expect(text).toContain('3 Trip')
    expect(text).toContain('Rp 150')
    expect(text).toContain('Golongan: Internal')
    expect(text).toContain('1 trip tanpa data kendaraan')
  })

  it('mode jenis mengelompokkan per jenis kendaraan', () => {
    renderCard()
    const btn = Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent === 'Jenis Kendaraan → Golongan')!
    act(() => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const text = container.textContent ?? ''
    expect(text).toContain('Jenis: Dump Truck')
    expect(text).toContain('Jenis: Motor')
  })
})
