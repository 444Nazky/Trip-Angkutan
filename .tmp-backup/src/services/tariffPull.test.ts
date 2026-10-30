/**
 * Tes penarikan master tarif admin → perangkat petugas.
 *
 * Sebelum ini tarif hanya hidup di sisi admin (`/api/tariffs` = requireAdmin),
 * jadi HP petugas selalu memakai angka contoh di `data.ts` — nominal yang
 * tersimpan di trip tidak pernah sama dengan tarif resmi. Sekarang HP membaca
 * `/master/tariffs` (cukup token petugas) dan menyimpannya di kunci yang sama
 * dengan yang dipakai `tariffFor()`.
 *
 * Dua hal yang dijaga tes ini: hasil kosong/gagal TIDAK menghapus cache yang
 * sudah dipakai petugas, dan baris tanpa jenis kendaraan tidak ikut tersimpan.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  response: { ok: true, data: [] as unknown[] } as { ok: boolean; data?: unknown; error?: { code?: string; message?: string } },
  urls: [] as string[],
  renew: true,
}))

vi.mock('./api', () => ({
  api: {
    get isAuthenticated() { return true },
    async get(url: string) { h.urls.push(url); return h.response },
  },
}))

vi.mock('./auth', () => ({
  cacheDockOfficers: async () => {},
  syncDermagaOfficersToDb: async () => {},
  getStoredDermaga: () => null,
  getStoredOfficer: () => ({ id: 'ofc-1' }),
  refreshStoredRoutes: async () => null,
  renewSessionIfNeeded: async () => h.renew,
}))

vi.mock('./geofence', () => ({ syncGeofencesFromBackend: async () => 0 }))

import { TARIFFS_STORAGE_KEY, getStoredTariffs, pullTariffsToLocal, silentMasterSync } from './adminPull'

const BACKEND_ROWS = [
  { id: 't1', golongan: 'I', vehicle_type: 'Motor', loaded_tariff: 15000, empty_tariff: 8000, description: 'Sepeda motor' },
  { id: 't2', golongan: 'V', vehicle_type: 'Truck Besar', loaded_tariff: 275000, empty_tariff: 190000 },
]

function stored(): { type: string }[] {
  const raw = localStorage.getItem(TARIFFS_STORAGE_KEY)
  return raw ? (JSON.parse(raw) as { type: string }[]) : []
}

beforeEach(() => {
  localStorage.clear()
  h.urls = []
  h.renew = true
  h.response = { ok: true, data: BACKEND_ROWS }
})

describe('pullTariffsToLocal', () => {
  it('menyimpan tarif server dalam bentuk yang dipakai tariffFor()', async () => {
    const count = await pullTariffsToLocal()

    expect(count).toBe(2)
    const row = getStoredTariffs().find(t => t.type === 'Truck Besar')
    expect(row).toBeDefined()
    expect(row?.loadedNum).toBe(275000)
    expect(row?.emptyNum).toBe(190000)
    // Format Rp harus sama dengan data.ts supaya tampilan tidak berubah gaya.
    expect(row?.loaded).toBe('Rp 275.000')
    expect(row?.golongan).toBe('V')
    expect(row?.desc).toBe('')
  })

  it('memakai endpoint khusus petugas, bukan /tariffs milik admin', async () => {
    await pullTariffsToLocal()
    expect(h.urls).toContain('/master/tariffs')
    expect(h.urls).not.toContain('/tariffs')
  })

  it('respons kosong tidak menimpa tarif yang sudah dipakai', async () => {
    await pullTariffsToLocal()
    h.response = { ok: true, data: [] }

    const count = await pullTariffsToLocal()

    expect(count).toBe(2)
    expect(stored().map(t => t.type)).toEqual(['Motor', 'Truck Besar'])
  })

  it('jaringan gagal / respons non-ok tetap memakai cache', async () => {
    await pullTariffsToLocal()
    h.response = { ok: false, data: undefined, error: { code: 'network' } }

    await pullTariffsToLocal()

    expect(stored()).toHaveLength(2)
  })

  it('membuang baris tanpa jenis kendaraan', async () => {
    h.response = {
      ok: true,
      data: [
        { id: 'x', golongan: 'I', vehicle_type: '   ', loaded_tariff: 1000, empty_tariff: 0 },
        { id: 't1', golongan: 'I', vehicle_type: 'Motor', loaded_tariff: 15000, empty_tariff: 8000 },
      ],
    }

    const count = await pullTariffsToLocal()

    expect(count).toBe(1)
    expect(stored().map(t => t.type)).toEqual(['Motor'])
  })
})

describe('silentMasterSync', () => {
  it('menarik tarif bersama region saat koneksi kembali', async () => {
    await silentMasterSync()
    expect(h.urls).toContain('/master/tariffs')
    expect(getStoredTariffs().map(t => t.type)).toEqual(['Motor', 'Truck Besar'])
  })

  it('sesi tidak bisa diperbarui = tarif tidak ditembak', async () => {
    h.renew = false

    await silentMasterSync()

    expect(h.urls).toEqual([])
    expect(stored()).toEqual([])
  })
})
