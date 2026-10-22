/**
 * Render harness — tab "Laporan Trip" (ReportsTab).
 *
 * Unit test lain hanya menguji logika murni (merge, tarif, sync). Test ini
 * merender komponen sungguhan di jsdom (react-dom/client) memakai data
 * laporan tiruan, lalu memeriksa DOM hasil render:
 *
 *   1. kolom "Kendaraan" (plat + jenis + status muatan per unit) tampil,
 *   2. kolom "Foto" menampilkan strip thumbnail (swafoto, bukti trip, dan
 *      foto tiap kendaraan) — bukan hanya satu foto bukti trip,
 *   3. nominal tarif tampil dari data laporan (Master Tarif / Tarif Region),
 *   4. jumlah kolom <thead> konsisten dengan jumlah sel baris data.
 *
 * Semua sumber jaringan dimock; tidak ada panggilan jaringan sungguhan.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ReportsTab } from './ReportsTab'

// Data laporan tiruan: satu trip bermuatan dengan 2 unit (1 eksternal + 1 internal).
const { reportTrips } = vi.hoisted(() => ({
  reportTrips: [
    {
      id: 'trip-1',
      no_trip: 'TRP-2026-001',
      route_from: 'SBDZ',
      route_to: 'SJRE',
      route_from_name: 'Sindang',
      route_to_name: 'Cirebon',
      status_muatan: 'muatan',
      keterangan: 'Bahan baku',
      foto_kosong_path: '/storage/trip-photos/bukti-trip.jpg',
      created_at: '2026-10-22T03:15:00.000Z',
      officer_name: 'Petugas Satu',
      region_name: 'Wilayah Cirebon',
      region_code: 'CRB',
      vehicle_count: 2,
      trip_revenue: 300000,
      selfie_photo: '/storage/trip-photos/swafoto.jpg',
      vehicles: [
        {
          id: 'veh-1',
          no_polisi: 'D 1234 AB',
          vehicle_type: 'Truck Besar',
          golongan: 'V',
          kategori: 'Eksternal',
          has_load: 1,
          tariff_amount: 300000,
          tarif_source: 'master',
          foto_path: '/storage/trip-photos/kendaraan-1.jpg',
          foto_captured_at: '2026-10-22T03:10:00.000Z',
          latitude: -6.732,
          longitude: 108.552,
        },
        {
          id: 'veh-2',
          no_polisi: 'D 5678 CD',
          vehicle_type: 'Truck Besar',
          golongan: 'V',
          kategori: 'Internal',
          has_load: 1,
          tariff_amount: 0,
          tarif_source: 'internal',
          foto_path: null,
          latitude: null,
          longitude: null,
        },
      ],
    },
  ],
}))

vi.mock('../../../services/trips', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/trips')>()
  return {
    ...actual,
    fetchTrips: vi.fn(async () => []),
    fetchReportFilters: vi.fn(async () => ({
      golongan: ['Internal', 'Eksternal', 'Lokal'],
      vehicleTypes: ['Truck Besar'],
    })),
    fetchTripReports: vi.fn(async () => reportTrips),
  }
})

vi.mock('../../../services/geofences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/geofences')>()
  return { ...actual, fetchGeofenceRules: vi.fn(async () => []) }
})

vi.mock('../../../services/xlsx', () => ({ downloadXlsx: vi.fn() }))

// React 19 butuh penanda ini agar `act()` boleh dipakai di luar test renderer.
;(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('ReportsTab (render harness)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
  })

  async function renderReports() {
    await act(async () => {
      root.render(
        React.createElement(ReportsTab, {
          onServerTripsChange: () => {},
          showToast: () => {},
          revealed: true,
          onToggleReveal: () => {},
          baseUrl: 'https://api.example.test',
        }),
      )
    })
    // Tick kedua: promise dari fetchTripReports baru selesai di flush pertama.
    await act(async () => {})
  }

  it('menampilkan kolom Kendaraan dan Foto pada header tabel', async () => {
    await renderReports()

    const headers = Array.from(container.querySelectorAll('thead th'))
      .map(th => th.textContent?.trim() ?? '')

    expect(headers).toContain('Kendaraan')
    expect(headers).toContain('Foto')
    expect(headers).toContain('Unit')
  })

  it('menampilkan plat + jenis kendaraan per unit pada baris trip', async () => {
    await renderReports()

    const body = container.textContent ?? ''
    expect(body).toContain('D 1234 AB')
    expect(body).toContain('D 5678 CD')
    expect(body).toContain('Truck Besar')
  })

  it('menampilkan strip thumbnail seluruh foto (swafoto, bukti trip, kendaraan)', async () => {
    await renderReports()

    const images = Array.from(container.querySelectorAll('tbody img'))
    const sources = images.map(img => img.getAttribute('src') ?? '')

    expect(sources.some(s => s.includes('swafoto.jpg'))).toBe(true)
    expect(sources.some(s => s.includes('bukti-trip.jpg'))).toBe(true)
    expect(sources.some(s => s.includes('kendaraan-1.jpg'))).toBe(true)
  })

  it('menampilkan nominal tarif dari laporan', async () => {
    await renderReports()

    const body = container.textContent ?? ''
    expect(body).toContain('Rp 300.000')
  })

  it('jumlah kolom header sama dengan jumlah sel baris data', async () => {
    await renderReports()

    // Baris header kolom (baris kedua <thead>).
    const headerRows = container.querySelectorAll('thead tr')
    const headerCells = headerRows[1]?.querySelectorAll('th').length ?? 0

    // Baris data trip (baris pertama di <tbody> setelah group tanggal).
    const dataRow = container.querySelector('tbody tr.bg-blue-50\\/60, tbody tr.cursor-pointer')
    const dataCells = dataRow?.querySelectorAll('td').length ?? 0

    expect(headerCells).toBe(11)
    expect(dataCells).toBe(headerCells)
  })
})
