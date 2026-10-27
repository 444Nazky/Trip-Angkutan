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
import type { TariffRow } from '../components/types'

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

const MASTER_TARIFFS: TariffRow[] = [
  { id: 't1', golongan: 'I', type: 'Motor', loaded: '8.000', loadedNum: 8000, empty: '5.000', emptyNum: 5000, desc: '' },
  { id: 't2', golongan: 'II', type: 'Mobil Barang', loaded: '15.000', loadedNum: 15000, empty: '10.000', emptyNum: 10000, desc: '' },
]

const REGION_BADAU = {
  id: 'r-badau',
  name: 'Badau',
  code: 'BADAU',
  lokal_tariff: null,
  lokal_active: null,
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
  rows: [],
}

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
          tariffs: MASTER_TARIFFS,
          serverState: 'online' as const,
          onSaveTariffs: () => {},
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

  /** Baris "Golongan X" - hanya ada kalau accordion region tersebut TERBUKA. */
  function golonganRows(): HTMLTableRowElement[] {
    return Array.from(container.querySelectorAll('tbody tr')).filter((tr) =>
      (tr.textContent ?? '').includes('Golongan'),
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

    // Tiap region punya 2 golongan master -> 4 baris "Golongan" harus tampil
    // (2 region x 2 golongan). Kalau accordion masih tertutup, baris ini 0.
    expect(golonganRows().length).toBe(4)

    // Kedua region berlabel "Sembunyikan" -> keduanya dalam kondisi TERBUKA.
    expect(regionHeader('Badau')?.textContent).toContain('Sembunyikan')
    expect(regionHeader('Belitung')?.textContent).toContain('Sembunyikan')
  })

  it('tombol toggle tetap bisa menutup region (collapse)', async () => {
    await renderTab()
    expect(golonganRows().length).toBe(4)

    // Klik header region -> accordion-nya menutup.
    await click(regionHeader('Belitung'))
    expect(golonganRows().length).toBe(2)

    // Klik lagi -> terbuka kembali.
    await click(regionHeader('Belitung'))
    expect(golonganRows().length).toBe(4)
  })

  it('menutup hanya region yang diklik, region lain tetap terbuka', async () => {
    await renderTab()

    await click(regionHeader('Badau'))
    expect(golonganRows().length).toBe(2)
    // Region yang tidak diklik tetap terbuka.
    expect(regionHeader('Belitung')?.textContent).toContain('Sembunyikan')
  })
})
