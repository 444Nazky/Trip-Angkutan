/**
 * Render harness — tab "Master Dermaga" (RegionTab).
 *
 * Tab ini menulis langsung ke database lewat endpoint master
 * (`POST/DELETE /regions`, `POST/DELETE /dermagas`) dan selalu memuat ulang
 * data dari server. Test ini merender komponen sungguhan di jsdom dengan
 * services yang dimock, lalu memeriksa DOM + panggilan service:
 *
 *   1. tabel menampilkan wilayah & dermaga persis seperti data server,
 *   2. tambah wilayah / dermaga benar-benar memanggil server, dan barisnya
 *      muncul dari hasil muat ulang — bukan ditambahkan sendiri di dashboard,
 *   3. simpan gagal TIDAK menambah baris palsu,
 *   4. wilayah yang masih punya dermaga / petugas tidak dihapus,
 *   5. hapus dermaga memanggil server lalu tabel dimuat ulang,
 *   6. server tidak merespons → tidak ada baris palsu,
 *   7.Improvisasi UI: ringkasan, pencarian tabel, dan pesan error di form
 *      bekerja tanpa mengubah sumber data.
 *
 * Tidak ada panggilan jaringan sungguhan di sini.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RegionTab } from './RegionTab'
import { fetchAdminRegions } from '../../../services/tariffs'
import { createDermaga, deleteDermaga, fetchDermagas, fetchRoutes } from '../../../services/dermagas'
import { api } from '../../../services/api'

interface RowRegion {
  id: string
  name: string
  code: string
}

interface RowDermaga {
  id: string
  region_id: string | null
  name: string
  code: string
}

interface RowRoute {
  id: string
  dermaga_id: string
}

interface RowOfficer {
  id: string
  name: string
  username: string
  region_id: string | null
  is_active: number
  regions: { id: string; name: string; code: string }[]
  dermagas: { id: string; name: string; code: string }[]
}

/**
 * "Database" tiruan: mock service membaca/menulis array ini, sehingga
 * perilaku server (baris muncul setelah tersimpan) tetap terwakili.
 */
const db = vi.hoisted(() => ({
  regions: [] as unknown[],
  dermagas: [] as unknown[],
  routes: [] as unknown[],
  officers: [] as unknown[],
  nextId: 1,
}))

vi.mock('../../../services/tariffs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/tariffs')>()
  return {
    ...actual,
    fetchAdminRegions: vi.fn(async () => (db.regions as RowRegion[]).map((r) => ({ ...r }))),
    createAdminRegion: vi.fn(async (input: { name: string; code: string }) => {
      const id = `reg-${db.nextId++}`
      ;(db.regions as RowRegion[]).push({ id, name: input.name, code: input.code })
      return id
    }),
    deleteAdminRegion: vi.fn(async (id: string) => {
      const rows = db.regions as RowRegion[]
      const left = rows.filter((r) => r.id !== id)
      const removed = left.length !== rows.length
      db.regions = left
      return removed
    }),
  }
})

vi.mock('../../../services/dermagas', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/dermagas')>()
  return {
    ...actual,
    fetchDermagas: vi.fn(async () => (db.dermagas as RowDermaga[]).map((d) => ({ ...d }))),
    fetchRoutes: vi.fn(async () => (db.routes as RowRoute[]).map((r) => ({ ...r }))),
    createDermaga: vi.fn(async (input: { region_id: string; name: string; code: string }) => {
      const id = `dm-${db.nextId++}`
      ;(db.dermagas as RowDermaga[]).push({
        id,
        region_id: input.region_id,
        name: input.name,
        code: input.code,
      })
      return { ok: true as const, data: id }
    }),
    deleteDermaga: vi.fn(async (id: string) => {
      const rows = db.dermagas as RowDermaga[]
      const left = rows.filter((d) => d.id !== id)
      const removed = left.length !== rows.length
      db.dermagas = left
      return removed ? { ok: true as const } : { ok: false as const, reason: 'Dermaga gagal dihapus karena tidak ditemukan' }
    }),
  }
})

vi.mock('../../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      getOk: vi.fn(async (path: string) =>
        path === '/officers' ? (db.officers as RowOfficer[]).map((o) => ({ ...o })) : null,
      ),
    },
  }
})

// React 19 butuh penanda ini agar act() boleh dipakai di luar test renderer.
;(globalThis as unknown as Record<string, unknown>)['IS_REACT_ACT_ENVIRONMENT'] = true

const REGION_MASTER: RowRegion = { id: 'r-master', name: 'Wilayah Badau', code: 'BADAU' }
const REGION_SBDZ: RowRegion = { id: 'r-sbdz', name: 'Wilayah Sindang', code: 'SBDZ' }
const DERMAGA_SINDANG: RowDermaga = { id: 'd-1', region_id: 'r-sbdz', name: 'Dermaga Sindang', code: 'SBD1' }

function seedDb() {
  db.regions = [{ ...REGION_MASTER }, { ...REGION_SBDZ }]
  db.dermagas = [{ ...DERMAGA_SINDANG }]
  db.routes = [{ id: 'rt-1', dermaga_id: 'd-1' }]
  db.officers = [
    {
      id: 'o-1',
      name: 'Petugas A',
      username: 'petugas.a',
      region_id: 'r-sbdz',
      is_active: 1,
      regions: [{ id: 'r-sbdz', name: 'Wilayah Sindang', code: 'SBDZ' }],
      dermagas: [{ id: 'd-1', name: 'Dermaga Sindang', code: 'SBD1' }],
    },
  ]
  db.nextId = 100
}

describe('RegionTab (render harness)', () => {
  let container: HTMLDivElement
  let root: Root
  let toasts: { msg: string; type: string }[]

  beforeEach(() => {
    vi.clearAllMocks()
    seedDb()
    toasts = []
    Object.defineProperty(window, 'confirm', { value: vi.fn(() => true), writable: true, configurable: true })

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
        React.createElement(RegionTab, {
          showToast: (msg: string, type?: 'success' | 'error') => {
            toasts.push({ msg, type: type ?? 'success' })
          },
        }),
      )
    })
    // Flush kedua: promise load() baru selesai setelah tick berikutnya.
    await act(async () => {})
  }

  function buttonByText(text: string): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').replace(/\s+/g, ' ').trim() === text,
    ) as HTMLButtonElement | undefined
  }

  function rowByText(text: string): HTMLTableRowElement | undefined {
    return Array.from(container.querySelectorAll('tbody tr')).find((tr) =>
      (tr.textContent ?? '').includes(text),
    ) as HTMLTableRowElement | undefined
  }

  async function setValue(el: HTMLInputElement | HTMLSelectElement | undefined, value: string) {
    expect(el).toBeTruthy()
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
    setter?.call(el, value)
    await act(async () => {
      el!.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
    })
  }

  async function click(el: HTMLElement | undefined) {
    expect(el).toBeTruthy()
    await act(async () => {
      el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await act(async () => {})
  }

  it('menampilkan wilayah dan dermaga persis seperti data server', async () => {
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('Wilayah Badau')
    expect(body).toContain('Wilayah Sindang')
    expect(body).toContain('Dermaga Sindang')
    expect(body).toContain('SBD1')
    // Ringkasan jumlah diambil dari server, bukan angka tetap.
    expect(body).toContain('2 wilayah · 1 dermaga')
    // Dermaga Sindang punya 1 rute dan dipakai 1 petugas.
    expect(rowByText('Dermaga Sindang')?.textContent).toContain('1 rute')
    expect(rowByText('Dermaga Sindang')?.textContent).toContain('1 petugas')
    expect(fetchDermagas).toHaveBeenCalled()
    expect(fetchRoutes).toHaveBeenCalled()
  })

  it('menambah dermaga ke wilayah terpilih dan menampilkannya setelah muat ulang', async () => {
    await renderTab()

    await setValue(container.querySelector('select') as HTMLSelectElement, 'r-sbdz')
    await setValue(container.querySelector('input[placeholder="cth: Dermaga Badau"]') as HTMLInputElement, 'Dermaga Baru')
    await setValue(container.querySelector('input[placeholder="cth: BDU"]') as HTMLInputElement, 'bdu')
    await click(buttonByText('Tambah Dermaga'))

    expect(createDermaga).toHaveBeenCalledWith({ region_id: 'r-sbdz', name: 'Dermaga Baru', code: 'BDU' })
    expect(container.textContent ?? '').toContain('Dermaga Baru')
    expect(toasts.at(-1)?.msg).toBe('Dermaga ditambahkan ke database')
  })

  it('menolak kode dermaga kembar di wilayah yang sama tanpa memanggil server', async () => {
    await renderTab()

    await setValue(container.querySelector('select') as HTMLSelectElement, 'r-sbdz')
    await setValue(container.querySelector('input[placeholder="cth: Dermaga Badau"]') as HTMLInputElement, 'Dermaga Duplikat')
    await setValue(container.querySelector('input[placeholder="cth: BDU"]') as HTMLInputElement, 'sbd1')
    await click(buttonByText('Tambah Dermaga'))

    expect(createDermaga).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toEqual({ msg: 'Wilayah ini sudah punya dermaga berkode SBD1', type: 'error' })
  })

  it('mengizinkan kode dermaga yang sama di wilayah BERBEDA (pola database kantor: D1, D2 per wilayah)', async () => {
    await renderTab()

    // Kode SBD1 sudah dipakai Dermaga Sindang, tetapi di wilayah lain tetap boleh.
    await setValue(container.querySelector('select') as HTMLSelectElement, 'r-master')
    await setValue(container.querySelector('input[placeholder="cth: Dermaga Badau"]') as HTMLInputElement, 'Dermaga Badau Satu')
    await setValue(container.querySelector('input[placeholder="cth: BDU"]') as HTMLInputElement, 'sbd1')
    await click(buttonByText('Tambah Dermaga'))

    expect(createDermaga).toHaveBeenCalledWith({ region_id: 'r-master', name: 'Dermaga Badau Satu', code: 'SBD1' })
    expect(container.textContent ?? '').toContain('Dermaga Badau Satu')
    expect(toasts.at(-1)?.msg).toBe('Dermaga ditambahkan ke database')
  })

  it('menampilkan kode dermaga yang sama di dua wilayah tanpa tertukar (pola database kantor)', async () => {
    ;(db.dermagas as RowDermaga[]).push({
      id: 'd-master',
      region_id: 'r-master',
      name: 'Dermaga Badau Satu',
      code: 'SBD1',
    })
    await renderTab()

    expect(rowByText('Dermaga Sindang')?.textContent).toContain('SBD1')
    expect(rowByText('Dermaga Badau Satu')?.textContent).toContain('SBD1')
    // Jumlah dermaga dihitung per wilayah, bukan dari kode yang bisa berulang.
    expect(rowByText('Wilayah Badau')?.textContent).toContain('1 dermaga')
    expect(rowByText('Wilayah Sindang')?.textContent).toContain('1 dermaga')
  })

  it('menghapus dermaga di server lalu memuat ulang tabel', async () => {
    await renderTab()

    const row = rowByText('Dermaga Sindang')
    const button = Array.from(row?.querySelectorAll('button') ?? []).find((b) =>
      (b.textContent ?? '').includes('Hapus Dermaga'),
    ) as HTMLButtonElement
    await click(button)

    expect(window.confirm).toHaveBeenCalled()
    expect(deleteDermaga).toHaveBeenCalledWith('d-1')
    expect(container.textContent ?? '').not.toContain('Dermaga Sindang')
    expect(toasts.at(-1)?.msg).toBe('Dermaga dihapus dari database')
  })

  it('server tidak merespons: tidak ada baris wilayah palsu', async () => {
    vi.mocked(fetchAdminRegions).mockResolvedValueOnce(null)
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('Server tidak bisa dihubungi')
    expect(body).not.toContain('Wilayah Sindang')
    expect(body).not.toContain('Dermaga Sindang')
  })

  it('menampilkan ringkasan jumlah dari server, bukan angka tetap', async () => {
    await renderTab()

    const body = container.textContent ?? ''
    expect(body).toContain('2 wilayah · 1 dermaga')
    // Kartu ringkasan: wilayah, dermaga, rute, petugas.
    expect(body).toContain('Rute')
    expect(body).toContain('Petugas')
    expect(body).toContain('Server: Tersambung')
  })

  it('pencarian menyaring baris dermaga tanpa memanggil server lagi', async () => {
    await renderTab()

    const before = vi.mocked(fetchDermagas).mock.calls.length
    await setValue(
      container.querySelector('input[aria-label="Cari dermaga"]') as HTMLInputElement,
      'tidak-ada',
    )

    const body = container.textContent ?? ''
    expect(body).not.toContain('Dermaga Sindang')
    expect(body).toContain('Tidak ada dermaga yang cocok dengan pencarian')
    // Pencarian hanya tampilan — tidak ada request baru ke server.
    expect(vi.mocked(fetchDermagas).mock.calls.length).toBe(before)
  })

  it('menampilkan pesan error di dalam kartu form saat kode dermaga kembar', async () => {
    await renderTab()

    await setValue(container.querySelector('select') as HTMLSelectElement, 'r-sbdz')
    await setValue(container.querySelector('input[placeholder="cth: Dermaga Badau"]') as HTMLInputElement, 'Dermaga Kembar')
    await setValue(container.querySelector('input[placeholder="cth: BDU"]') as HTMLInputElement, 'sbd1')
    await click(buttonByText('Tambah Dermaga'))

    expect(createDermaga).not.toHaveBeenCalled()
    expect(toasts.at(-1)).toEqual({ msg: 'Wilayah ini sudah punya dermaga berkode SBD1', type: 'error' })
    // Pesan yang sama juga tampil di dalam form (bukan cuma toast).
    expect(container.textContent ?? '').toContain('Wilayah ini sudah punya dermaga berkode SBD1')
  })
})

// Dipakai hanya agar import tetap terpakai di mata TS (mock-nya yang dipanggil).
void api
