// Render harness — tab "Master Tarif" (TariffTab).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TariffTab } from './TariffTab'
import { fetchRegionTariffs } from '../../../services/tariffs'
import { fetchVehicleTypes } from '../../../services/vehicleTypes'



const regionRows = vi.hoisted(() => ({
  list: [] as unknown[],
}))



const MASTER_TYPES = [
  { id: 'vt-1', name: 'Motor', key: 'motor', sortOrder: 1, isActive: true },
  { id: 'vt-2', name: 'Mobil', key: 'mobil', sortOrder: 2, isActive: true },
  { id: 'vt-3', name: 'Truk Kecil', key: 'trukkecil', sortOrder: 3, isActive: true },
  { id: 'vt-4', name: 'Truk Sedang', key: 'truksedang', sortOrder: 4, isActive: true },
  { id: 'vt-5', name: 'Truk Besar', key: 'trukbesar', sortOrder: 5, isActive: true },
]



vi.mock('../../../services/vehicleTypes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/vehicleTypes')>()
  return {
    ...actual,
    fetchVehicleTypes: vi.fn(async () => MASTER_TYPES.map((t) => ({ ...t }))),
  }
})



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



const TYPES_PER_REGION = MASTER_TYPES.length



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
    expect(body).toContain('Region Badau')
    expect(body).toContain('Region Belitung')

    expect(tariffRows().length).toBe(2 * TYPES_PER_REGION)

    expect(regionHeader('Badau')?.textContent).toContain('Sembunyikan')
    expect(regionHeader('Belitung')?.textContent).toContain('Sembunyikan')
  })

  it('region tanpa baris tampil Rp 0, yang punya baris memakai nominalnya', async () => {
    await renderTab()
    const text = container.textContent ?? ''
    expect(text).toContain('45.000')
    expect(text).toContain('40.000')
    expect(text).toContain('Rp 0')
  })

  it('tombol toggle tetap bisa menutup region (collapse)', async () => {
    await renderTab()
    expect(tariffRows().length).toBe(2 * TYPES_PER_REGION)

    await click(regionHeader('Belitung'))
    expect(tariffRows().length).toBe(TYPES_PER_REGION)

    await click(regionHeader('Belitung'))
    expect(tariffRows().length).toBe(2 * TYPES_PER_REGION)
  })

  it('menutup hanya region yang diklik, region lain tetap terbuka', async () => {
    await renderTab()

    await click(regionHeader('Badau'))
    expect(tariffRows().length).toBe(TYPES_PER_REGION)
    expect(regionHeader('Belitung')?.textContent).toContain('Sembunyikan')
  })

  it('form tambah tarif punya pilihan "Semua Region"', async () => {
    await renderTab()

    const form = container.querySelector('#tariff-form') as HTMLElement | null
    expect(form).toBeTruthy()
    const regionSelect = form!.querySelector('select') as HTMLSelectElement
    const labels = Array.from(regionSelect.options).map((o) => o.textContent ?? '')
    expect(labels.some((l) => l.includes('Semua Region'))).toBe(true)
  })

  it('jenis kendaraan dipilih dari daftar master (dropdown), bukan input teks bebas', async () => {
    await renderTab()

    const form = container.querySelector('#tariff-form') as HTMLElement | null
    const selects = Array.from(form!.querySelectorAll('select')) as HTMLSelectElement[]
    expect(selects.length).toBeGreaterThanOrEqual(2)
    const typeSelect = selects[1]
    const labels = Array.from(typeSelect.options).map((o) => o.textContent ?? '')
    expect(labels.filter((l) => l && !l.includes('Pilih jenis'))).toEqual(
      MASTER_TYPES.map((t) => t.name),
    )
    const typeInputs = Array.from(
      form!.querySelectorAll('input'),
    ).filter((i) => (i.getAttribute('placeholder') ?? '').toLowerCase().includes('jenis kendaraan'))
    expect(typeInputs.length).toBe(0)
  })

  it('daftar jenis diambil dari database, bukan dari daftar hardcode', async () => {
    await renderTab()
    expect(fetchVehicleTypes).toHaveBeenCalled()
    const body = container.textContent ?? ''
    for (const t of MASTER_TYPES) expect(body).toContain(t.name)
  })

  it('tombol hapus hanya aktif untuk baris tarif yang sudah tersimpan', async () => {
    await renderTab()

    const deleteButtons = Array.from(
      container.querySelectorAll('[title="Hapus tarif kendaraan ini"]'),
    ) as HTMLButtonElement[]
    // Hanya baris "motor" di region Belitung yang punya baris tersimpan.
    expect(deleteButtons.length).toBe(1)
    expect(deleteButtons[0].disabled).toBe(false)

    const disabled = Array.from(
      container.querySelectorAll('[title="Belum ada baris tarif untuk dihapus"]'),
    ) as HTMLButtonElement[]
    expect(disabled.length).toBe(2 * TYPES_PER_REGION - 1)
    expect(disabled.every((b) => b.disabled)).toBe(true)
  })
})
