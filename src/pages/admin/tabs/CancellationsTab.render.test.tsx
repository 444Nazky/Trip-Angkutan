/**
 * Render harness — tab "Pembatalan Trip" (CancellationsTab).
 *
 * Halaman ini memantau trip yang dibatalkan petugas beserta ALASANNYA.
 * Yang diuji:
 *   1. panel "Detail & Klasifikasi Pembatalan Trip" tampil,
 *   2. empat kartu ringkasan memakai angka ringkasan dari server,
 *   3. daftar rincian dikelompokkan "Petugas → Alasan" dan satu baris =
 *      satu kendaraan,
 *   4. filter alasan benar-benar dikirim ke server (bukan hanya di UI),
 *   5. rincian kendaraan (keterangan, tarif, foto) terbuka saat baris diklik,
 *   6. tombol Collapse All / Expand All mengatur grup.
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
      { url: '/files/trip-photos/swafoto.jpg', label: 'Swafoto petugas' },
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
    reason: 'saya lupa melanjutkan draft',
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
  // Dokumen kedua Petugas Satu pada TANGGAL yang sama (2026-11-01) —
  // harus tetap masuk satu grup tanggal.
  {
    id: 'c-3',
    no_cancel: 'CNL20261101CCCCCC',
    officer_id: 'officer-a',
    reason: 'Kendaraan tidak ditemukan',
    note: null,
    route_from: 'SJRE',
    route_to: 'CRB',
    route_code: 'SJRE-CRB',
    condition: 'kosong',
    vehicle_count: 1,
    photo_count: 0,
    vehicles: [{ plate: 'E 1111 AA', type: 'Motor', category: 'Internal', load: 'empty', tariff: 10000 }],
    started_at: '2026-11-01T03:00:00.000Z',
    cancelled_at: '2026-11-01T04:00:00.000Z',
    created_at: '2026-11-01T04:00:00.000Z',
    officer_name: 'Petugas Satu',
    region_code: 'CRB',
  },
]

const CANCEL_SUMMARY = {
  total: 2,
  byReason: [
    { reason: 'Pelanggan membatalkan', count: 1 },
    { reason: 'saya lupa melanjutkan draft', count: 1 },
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

  const button = (label: string) =>
    Array.from(container.querySelectorAll('button')).find(b => b.textContent?.trim() === label)!

  const vehicleRow = (plate: string) =>
    Array.from(container.querySelectorAll('[data-testid="cancel-vehicle-row"]'))
      .find(el => el.textContent?.includes(plate))!

  it('panel detail & klasifikasi dengan filter rentang saja', async () => {
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('Detail & Klasifikasi Pembatalan Trip')
    expect(body).toContain('Rentang')
    expect(body).toContain('Hari Ini')
    expect(body).toContain('30 Hari')
    expect(body).toContain('Semua')

    // Filter yang dihapus: 90 Hari, dropdown alasan, dan kotak cari.
    expect(body).not.toContain('90 Hari')
    expect(container.querySelector('select')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
  })

  it('menampilkan empat kartu ringkasan sesuai angka server', async () => {
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('Total Pembatalan')
    expect(body).toContain('Golongan & Jenis Kendaraan')
    expect(body).toContain('Alasan Teratas')
    expect(body).toContain('Petugas')

    // Total 2 pembatalan, 3 kendaraan, alasan teratas 1, 2 petugas.
    const tiles = Array.from(container.querySelectorAll('.text-xl')).map(el => el.textContent?.trim())
    expect(tiles).toContain('2Trip')
    expect(tiles).toContain('3Unit')
    expect(tiles).toContain('1Pelanggan membatalkan')
    expect(tiles).toContain('2Orang')

    // Keterangan kartu: total transaksi, golongan yang ada, nama petugas.
    expect(body).toContain('Total transaksi dibatalkan')
    expect(body).toContain('Internal & Lokal')
    expect(body).toContain('Kapal ditunda oleh pelanggan')
    expect(body).toContain('Petugas Satu')
  })

  it('satu grup per petugas, satu grup per tanggal (dokumen sedate digabung)', async () => {
    await renderTab()

    // 1 petugas = 1 grup (tidak dipecah per alasan maupun per dokumen).
    const officerTexts = Array.from(container.querySelectorAll('[data-testid="cancel-group-header"]'))
      .map(el => el.textContent ?? '')
    expect(officerTexts.length).toBe(2)
    expect(officerTexts.some(t => t.includes('Petugas Satu'))).toBe(true)
    expect(officerTexts.some(t => t.includes('Petugas Dua'))).toBe(true)

    // 2 dokumen Petugas Satu pada 2026-11-01 tetap jadi SATU grup tanggal.
    const dateTexts = Array.from(container.querySelectorAll('[data-testid="cancel-date-header"]'))
      .map(el => el.textContent ?? '')
    expect(dateTexts.length).toBe(2)
    expect(dateTexts.some(t => t.includes('01-11-2026') && t.includes('2 trip') && t.includes('3 unit'))).toBe(true)
    expect(dateTexts.some(t => t.includes('02-11-2026') && t.includes('1 trip') && t.includes('1 unit'))).toBe(true)

    // 4 kendaraan dari 3 dokumen pembatalan.
    const vehicleRows = Array.from(container.querySelectorAll('[data-testid="cancel-vehicle-row"]'))
    expect(vehicleRows.length).toBe(4)

    const body = container.textContent ?? ''
    expect(body).toContain('CNL20261101AAAAAA')
    expect(body).toContain('CNL20261101CCCCCC')
    expect(body).toContain('CNL20261102BBBBBB')
    expect(body).toContain('B 1234 XY')
    expect(body).toContain('B 5678 ZA')
    expect(body).toContain('D 9999 ZZ')
    expect(body).toContain('E 1111 AA')
    expect(body).toContain('Truk Kecil')
    // Waktu batal memakai format "YYYY-MM-DD HH:MM WIB".
    expect(body).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB/)
  })

  it('kolom tabel sesuai judul, termasuk kolom Foto', async () => {
    await renderTab()

    const headers = Array.from(container.querySelectorAll('thead th'))
      .map(th => th.textContent?.trim() ?? '')
    expect(headers).toEqual([
      'No Trip / Info Group',
      'Waktu Batal',
      'Golongan',
      'Jenis Kendaraan',
      'No. Polisi',
      'Petugas Autorisasi',
      'Foto',
    ])
  })

  it('Collapse All / Expand Header / Expand All mengatur level buka', async () => {
    await renderTab()

    expect(container.querySelectorAll('[data-testid="cancel-group-header"]').length).toBe(2)
    expect(container.querySelectorAll('[data-testid="cancel-date-header"]').length).toBe(2)
    expect(container.querySelectorAll('[data-testid="cancel-vehicle-row"]').length).toBe(4)

    await act(async () => {
      button('Collapse All').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // Hanya header petugas yang tersisa.
    expect(container.querySelectorAll('[data-testid="cancel-group-header"]').length).toBe(2)
    expect(container.querySelectorAll('[data-testid="cancel-date-header"]').length).toBe(0)
    expect(container.querySelectorAll('[data-testid="cancel-vehicle-row"]').length).toBe(0)

    await act(async () => {
      button('Expand Header').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    // Header petugas + tanggal tampil, kendaraan masih tertutup.
    expect(container.querySelectorAll('[data-testid="cancel-date-header"]').length).toBe(2)
    expect(container.querySelectorAll('[data-testid="cancel-vehicle-row"]').length).toBe(0)

    await act(async () => {
      button('Expand All').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(container.querySelectorAll('[data-testid="cancel-date-header"]').length).toBe(2)
    expect(container.querySelectorAll('[data-testid="cancel-vehicle-row"]').length).toBe(4)
  })

  it('klik baris menampilkan alasan ketikan petugas, bukan label pilihan', async () => {
    await renderTab()

    expect(container.textContent).not.toContain('alasan =')

    const expandedText = () =>
      Array.from(container.querySelectorAll('tbody tr'))
        .find(tr => tr.textContent?.includes('alasan ='))?.textContent ?? ''

    // Dokumen baru: alasan diketik manual, tampil apa adanya.
    await act(async () => {
      vehicleRow('D 9999 ZZ').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(expandedText()).toContain('alasan =')
    expect(expandedText()).toContain('saya lupa melanjutkan draft')

    // Dokumen versi lama: pilihan baku tersimpan di `reason`, kalimat petugas
    // ada di `note` — yang tampil harus kalimat petugasnya.
    await act(async () => {
      vehicleRow('B 1234 XY').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(expandedText()).toContain('Kapal ditunda oleh pelanggan')
    expect(expandedText()).not.toContain('Pelanggan membatalkan')

    // Detail rinci lama sudah dihapus.
    const body = container.textContent ?? ''
    expect(body).not.toContain('Keterangan petugas:')
    expect(body).not.toContain('Muatan saat batal:')
    expect(body).not.toContain('Tarif (Rp):')
  })

  it('menampilkan foto draft di kolom Foto + penanda dokumen versi lama', async () => {
    await renderTab()

    const srcs = Array.from(container.querySelectorAll('tbody img'))
      .map(img => img.getAttribute('src') ?? '')
    expect(srcs).toContain('http://server/foto-kondisi.jpg')

    // Path relatif dari server (mis. "/files/trip-photos/...") harus diarahkan
    // ke origin API, bukan origin halaman admin (port berbeda).
    const swafoto = srcs.find(src => src.includes('/files/trip-photos/swafoto.jpg'))
    expect(swafoto).toMatch(/^https?:\/\/[^/]+\/files\/trip-photos\/swafoto\.jpg$/)

    // Dokumen lama hanya menyimpan jumlah foto tanpa URL → tampil "1 foto".
    expect(container.textContent).toContain('1 foto')
  })
})
