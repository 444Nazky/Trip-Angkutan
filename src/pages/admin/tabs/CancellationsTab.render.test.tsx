/**
 * Render harness — tab "Pembatalan Trip" (CancellationsTab).
 *
 * Halaman ini memantau trip yang dibatalkan petugas beserta ALASANNYA.
 * Yang diuji:
 *   1. dokumen pembatalan tampil lengkap dengan alasan & keterangan,
 *   2. kartu statistik memakai angka ringkasan dari server,
 *   3. grafik "per alasan" menampilkan setiap alasan beserta jumlahnya,
 *   4. filter alasan benar-benar dikirim ke server (bukan hanya di UI),
 *   5. rincian kendaraan terbuka saat baris diklik.
 *
 * Semua sumber jaringan dimock; tidak ada panggilan jaringan sungguhan.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { CancellationsTab } from './CancellationsTab'

const CANCEL_ROWS = [
  {
    id: 'c-1',
    no_cancel: 'CNL20261101AAAAAA',
    officer_id: 'officer-a',
    reason: 'Pelanggan membatalkan',
    note: 'Kapal ditunda oleh pelanggan',
    route_from: 'SJRE',
    route_to: 'SBDZ',
    route_code: 'SJRE-SBDZ',
    condition: 'muatan',
    vehicle_count: 2,
    photo_count: 2,
    photos: [
      { url: 'http://server/foto-kondisi.jpg', label: 'Foto kondisi draft' },
      { url: 'http://server/swafoto.jpg', label: 'Swafoto petugas' },
    ],
    vehicles: [
      { plate: 'B 1234 XY', type: 'Mobil', category: 'Lokal', load: 'loaded', tariff: 75000 },
      { plate: 'B 5678 ZA', type: 'Truk Kecil', category: 'Internal', load: 'loaded', tariff: 50000 },
    ],
    started_at: '2026-11-01T01:00:00.000Z',
    cancelled_at: '2026-11-01T02:00:00.000Z',
    created_at: '2026-11-01T02:00:00.000Z',
    officer_name: 'Petugas Satu',
    region_code: 'CRB',
  },
  {
    id: 'c-2',
    no_cancel: 'CNL20261102BBBBBB',
    officer_id: 'officer-b',
    reason: 'Data masuk salah',
    note: null,
    route_from: 'CRB',
    route_to: 'SBDZ',
    route_code: 'CRB-SBDZ',
    condition: 'kosong',
    vehicle_count: 1,
    photo_count: 1,
    vehicles: [{ plate: 'D 9999 ZZ', type: 'Motor', category: 'Lokal', load: 'empty', tariff: 15000 }],
    started_at: '2026-11-02T00:30:00.000Z',
    cancelled_at: '2026-11-02T01:00:00.000Z',
    created_at: '2026-11-02T01:00:00.000Z',
    officer_name: 'Petugas Dua',
    region_code: 'CRB',
  },
]

const CANCEL_SUMMARY = {
  total: 2,
  byReason: [
    { reason: 'Pelanggan membatalkan', count: 1 },
    { reason: 'Data masuk salah', count: 1 },
  ],
  byDay: [
    { day: '2026-11-01', count: 1 },
    { day: '2026-11-02', count: 1 },
  ],
  byOfficer: [
    { officerId: 'officer-a', officerName: 'Petugas Satu', count: 1 },
    { officerId: 'officer-b', officerName: 'Petugas Dua', count: 1 },
  ],
  vehicleCount: 3,
  photoCount: 3,
}

let fetchMock: ReturnType<typeof vi.fn>

// React 19 butuh penanda ini agar `act()` boleh dipakai di luar test renderer.
;(globalThis as unknown as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

describe('CancellationsTab (render harness)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)

    fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes('mode=summary') ? CANCEL_SUMMARY : CANCEL_ROWS
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    await act(async () => { root.unmount() })
    container.remove()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  async function renderTab() {
    await act(async () => {
      root.render(React.createElement(CancellationsTab, { showToast: () => {} }))
    })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })
  }

  it('menampilkan judul halaman dan filter rentang', async () => {
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('Pembatalan Trip')
    expect(body).toContain('Rentang')
    expect(body).toContain('Hari Ini')
    expect(body).toContain('30 Hari')
    expect(body).toContain('Semua')
  })

  it('menampilkan dokumen pembatalan beserta alasan dan keterangannya', async () => {
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('CNL20261101AAAAAA')
    expect(body).toContain('Pelanggan membatalkan')
    expect(body).toContain('Kapal ditunda oleh pelanggan')
    expect(body).toContain('CNL20261102BBBBBB')
    expect(body).toContain('Data masuk salah')
    // Petugas & rute ikut terbaca.
    expect(body).toContain('Petugas Satu')
    expect(body).toContain('SJRE → SBDZ')
  })

  it('menampilkan kartu statistik dari ringkasan server', async () => {
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('Total pembatalan')
    expect(body).toContain('Kendaraan dibatalkan')
    expect(body).toContain('Alasan teratas')
    expect(body).toContain('Petugas terlibat')
    // Total 2 pembatalan, 3 kendaraan, 2 petugas.
    expect(body).toContain('Total pembatalan')
    const tiles = Array.from(container.querySelectorAll('.text-xl')).map(el => el.textContent?.trim())
    expect(tiles).toContain('2')
    expect(tiles).toContain('3')
  })

  it('menampilkan grafik pembatalan per alasan dengan jumlahnya', async () => {
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('Pembatalan per alasan')
    expect(body).toContain('Petugas paling sering membatalkan')
    // Setiap alasan tampil beserta jumlah & persentasenya.
    expect(body).toContain('Pelanggan membatalkan')
    expect(body).toMatch(/1 · 50%/)
  })

  it('mengirim filter alasan ke server saat alasan dipilih', async () => {
    await renderTab()
    fetchMock.mockClear()

    const select = container.querySelector('select') as HTMLSelectElement | null
    expect(select).toBeTruthy()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
      setter?.call(select, 'Data masuk salah')
      select?.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    const called = fetchMock.mock.calls.map(c => String(c[0]))
    expect(called.some(u => u.includes('reason=Data+masuk+salah'))).toBe(true)
  })

  it('membuka rincian kendaraan saat baris dokumen diklik', async () => {
    await renderTab()

    const rows = Array.from(container.querySelectorAll('tbody tr.cursor-pointer'))
    expect(rows.length).toBe(2)

    await act(async () => {
      rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const body = container.textContent ?? ''
    expect(body).toContain('Rincian trip yang dibatalkan')
    expect(body).toContain('B 1234 XY')
    expect(body).toContain('B 5678 ZA')
    expect(body).toContain('Truk Kecil')
  })

  it('menampilkan foto draft dan peringatan dokumen versi lama', async () => {
    await renderTab()

    const rows = Array.from(container.querySelectorAll('tbody tr.cursor-pointer'))
    await act(async () => {
      rows[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    const body = container.textContent ?? ''
    expect(body).toContain('Foto draft')
    expect(body).toContain('Swafoto petugas')
    const images = Array.from(container.querySelectorAll('img'))
    expect(images.map(img => img.getAttribute('src'))).toContain('http://server/foto-kondisi.jpg')

    // Dokumen lama hanya menyimpan jumlah foto tanpa URL.
    await act(async () => {
      rows[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.textContent).toContain('dikirim aplikasi versi lama')
  })
})
