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
      dermagas: [
        { id: 'd-1', name: 'Badau D1', code: 'D1', region_name: 'BADAU', region_code: 'BADAU' },
        { id: 'd-2', name: 'Empanang D1', code: 'D1', region_name: 'EMPANANG', region_code: 'EMPANANG' },
      ],
      routes: [
        { id: 'r-1', name: 'SBDZ -> SJRE', route_from: 'SBDZ', route_to: 'SJRE', dermaga_id: 'd-1', dermaga_name: 'Badau D1' },
      ],
    })),
    fetchTripReports: vi.fn(async () => reportTrips),
  }
})

vi.mock('../../../services/geofences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/geofences')>()
  return { ...actual, fetchGeofenceRules: vi.fn(async () => []) }
})

vi.mock('../../../services/vehicleTypes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vehicleTypes')>()
  return {
    ...actual,
    fetchVehicleTypes: vi.fn(async () => [
      { id: 'vt-1', name: 'Motor', key: 'motor', sortOrder: 1, isActive: true },
      { id: 'vt-2', name: 'Burung Sumatra', key: 'burungsumatra', sortOrder: 7, isActive: true },
    ]),
    getStoredVehicleTypes: vi.fn(() => []),
  }
})

vi.mock('../../../services/xlsx', () => ({ downloadXlsx: vi.fn() }))

// React 19 butuh penanda ini agar `act()` boleh dipakai di luar test renderer.
;(globalThis as unknown as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

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

  /** Buka grup golongan (default 'Expand Header' = kendaraan masih tertutup). */
  async function openGolongan(gol: string) {
    const header = Array.from(container.querySelectorAll('[data-testid="report-gol-header"]'))
      .find(el => el.getAttribute('data-gol') === gol)!
    await act(async () => {
      header.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }

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

  it('menampilkan kolom kendaraan pada header tabel', async () => {
    await renderReports()

    const headers = Array.from(container.querySelectorAll('thead tr')[1]?.querySelectorAll('th') ?? [])
      .map(th => th.textContent?.trim() ?? '')

    // Satu baris = satu kendaraan, jadi kolom unit per trip tidak ada lagi.
    expect(headers).toContain('No Trip')
    expect(headers).toContain('No. Polisi')
    expect(headers).toContain('Muatan')
    expect(headers).toContain('Tarif')
    expect(headers).toContain('Foto')
  })

  it('menampilkan semua pilihan master di filter Dermaga, Rute, dan Jenis Kendaraan', async () => {
    await renderReports()

    const labels = Array.from(container.querySelectorAll('label'))
      .map(l => l.textContent?.trim() ?? '')
    expect(labels).toContain('Dermaga')
    expect(labels).toContain('Rute')
    expect(labels).toContain('Jenis Kendaraan')

    const optionsText = Array.from(container.querySelectorAll('select option'))
      .map(o => o.textContent?.trim() ?? '')
    // Master yang belum dipakai trip mana pun tetap harus muncul.
    expect(optionsText).toContain('Badau D1')
    expect(optionsText).toContain('Empanang D1')
    expect(optionsText.some(t => t.includes('SBDZ') && t.includes('SJRE') && t.includes('Badau D1'))).toBe(true)
    expect(optionsText).toContain('Motor')
    expect(optionsText).toContain('Burung Sumatra')
  })

  it('default Expand Header: tanggal + golongan tampil, kendaraan tertutup', async () => {
    await renderReports()

    const body = container.textContent ?? ''
    // Header tanggal (folder) dan header golongan tampil sejak load.
    expect(body).toContain('22-10-2026')
    expect(body).toContain('Internal')
    expect(body).toContain('Eksternal')
    expect(body).toContain('Lokal')
    // Baris kendaraan baru muncul setelah grup golongan diklik.
    expect(body).not.toContain('D 1234 AB')
    expect(body).not.toContain('D 5678 CD')
  })

  it('membuka satu grup golongan menampilkan seluruh kendaraan golongan itu', async () => {
    await renderReports()

    const golHeader = (gol: string) => Array.from(container.querySelectorAll('[data-testid="report-gol-header"]'))
      .find(el => el.getAttribute('data-gol') === gol)!

    await act(async () => {
      golHeader('Eksternal').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    let body = container.textContent ?? ''
    // Hanya kendaraan golongan Eksternal yang tampil.
    expect(body).toContain('D 1234 AB')
    expect(body).not.toContain('D 5678 CD')

    await act(async () => {
      golHeader('Internal').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    body = container.textContent ?? ''
    expect(body).toContain('D 5678 CD')
    expect(body).toContain('Truck Besar')
  })

  it('Collapse All menyembunyikan isi tanggal, Expand All menampilkannya', async () => {
    await renderReports()

    const button = (label: string) => Array.from(container.querySelectorAll('button'))
      .find(b => b.textContent === label)!

    await act(async () => {
      button('Collapse All').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // Hanya header tanggal yang tersisa.
    expect(container.querySelectorAll('[data-testid="report-gol-header"]').length).toBe(0)
    expect(container.querySelectorAll('[data-testid="report-vehicle-row"]').length).toBe(0)

    await act(async () => {
      button('Expand All').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelectorAll('[data-testid="report-gol-header"]').length).toBe(3)
    expect(container.querySelectorAll('[data-testid="report-vehicle-row"]').length).toBe(2)
  })

  it('menampilkan strip thumbnail seluruh foto (swafoto, bukti trip, kendaraan)', async () => {
    await renderReports()
    await openGolongan('Eksternal')

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
    await openGolongan('Eksternal')

    // Baris header kolom (baris kedua <thead>).
    const headerRows = container.querySelectorAll('thead tr')
    const headerCells = headerRows[1]?.querySelectorAll('th').length ?? 0

    // Baris kendaraan (baris data di <tbody>).
    const dataRow = container.querySelector('[data-testid="report-vehicle-row"]')
    const dataCells = dataRow?.querySelectorAll('td').length ?? 0

    expect(headerCells).toBe(10)
    expect(dataCells).toBe(headerCells)
  })
})
