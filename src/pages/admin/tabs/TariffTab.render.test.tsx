/**
 * Render harness — tab "Master Tarif" (TariffTab).
 *
 * Fokus test ini: accordion tabel tarif per region harus **terbuka secara
 * default** saat halaman dimuat (tidak perlu klik "Tampilkan" satu per satu),
 * dan tombol toggle tetap bisa dipakai untuk menutup/membuka lagi.
 *
 * Tidak ada panggilan jaringan sungguhan: service `services/tariffs` dimock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TariffTab } from './TariffTab'
import { fetchRegionTariffs } from '../../../services/tariffs'

const regionRows = vi.hoisted(() => ({
  list: [] as unknown[],
}))

vi.mock('../../../services/tariffs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/tariffs')>()
  return {
    ...actual,
    fetchRegionTariffs: vi.fn(async () => (regionRows.list as any[]).map((r) => ({ ...r }))),
  }
})

// React 19 butuh penanda ini agar act() boleh dipakai di luar test renderer.
;(globalThis as unknown as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

const REGION_BADAU = {
  id: 'r-badau',
  name: 'Badau',
  code: 'BADAU',
  lokal_tariff: 15000,
  lokal_active: 1,
  eksternal_tariff: null,
  eksternal_active: null,
  rows: [],
}

const REGION_BELITUNG = {
  id: 'r-belitung',
  name: 'Belitung',
  code: 'BLT',
  lokal_tariff: null,
  lokal_active: null,
  eksternal_tariff: null,
  eksternal_active: null,
  rows: [
    { vehicleType: 'motor', muatanTariff: 45000, kosongTariff: 40000 },
  ],
}

/** Jumlah baris tarif yang tampil = 5 jenis standar untuk SEMUA region. */
const TYPES_PER_REGION = 5

describe('TariffTab (accordion per region)', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    regionRows.list = [{ ...REGION_BADAU }, { ...REGION_BELITUNG }]

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => {
      root.unmount()
    })
    container.remove()
  })

  async function renderTab() {
    await act(async () => {
      root.render(
        React.createElement(TariffTab, {
          serverState: 'online' as const,
          showToast: () => {},
        }),
      )
    })
    // Flush kedua: fetchRegionTariffs baru selesai setelah tick berikutnya.
    await act(async () => {})
  }

  /** Baris header region (tombol yang Expansion) */
  function regionHeader(text: string): HTMLTableRowElement | undefined {
    return Array.from(container.querySelectorAll('tbody tr')).find(
      (tr) => (tr.textContent ?? '').includes(`Region ${text}`),
    ) as HTMLTableRowElement | undefined
  }

  /** Baris tarif (punya tombol "Edit tarif"); hanya ada kalau region TERBUKA. */
  function tariffRows(): HTMLTableRowElement[] {
    return Array.from(container.querySelectorAll('tbody tr')).filter((tr) =>
      tr.querySelector('[title="Edit tarif"]'),
    ) as HTMLTableRowElement[]
  }

  async function click(el: HTMLElement | undefined) {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})
  }

  it('membuka SEMUA region secara default tanpa perlu klik "Tampilkan"', async () => {
    await renderTab()

    expect(fetchRegionTariffs).toHaveBeenCalled()
    const body = container.textContent ?? ''
    // Kedua region terlihat sebagai header accordion.
    expect(body).toContain('Region Badau')
    expect(body).toContain('Region Belitung')

    // Semua region menampilkan 5 jenis kendaraan -> 10 baris. Kalau accordion
    // masih tertutup, baris ini 0.
    expect(tariffRows().length).toBe(2 * TYPES_PER_REGION)

    // Kedua region berlabel "Sembunyikan" -> keduanya dalam kondisi TERBUKA.
    expect(regionHeader('Badau')?.textContent).toContain('Sembunyikan')
    expect(regionHeader('Belitung')?.textContent).toContain('Sembunyikan')
  })

  it('region tanpa baris tampil Rp 0, yang punya baris memakai nominalnya', async () => {
    await renderTab()
    const text = container.textContent ?? ''
    expect(text).toContain('45.000')
    expect(text).toContain('40.000')
    // Badau belum punya baris tarif -> kolom eksternal Rp 0.
    expect(text).toContain('Rp 0')
  })

  it('tombol toggle tetap bisa menutup region (collapse)', async () => {
    await renderTab()
    expect(tariffRows().length).toBe(2 * TYPES_PER_REGION)

    // Klik header region -> accordion-nya menutup.
    await click(regionHeader('Belitung'))
    expect(tariffRows().length).toBe(TYPES_PER_REGION)

    // Klik lagi -> terbuka kembali.
    await click(regionHeader('Belitung'))
    expect(tariffRows().length).toBe(2 * TYPES_PER_REGION)
  })

  it('menutup hanya region yang diklik, region lain tetap terbuka', async () => {
    await renderTab()

    await click(regionHeader('Badau'))
    expect(tariffRows().length).toBe(TYPES_PER_REGION)
    // Region yang tidak diklik tetap terbuka.
    expect(regionHeader('Belitung')?.textContent).toContain('Sembunyikan')
  })
})
