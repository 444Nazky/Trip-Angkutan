import { api, toActionResult, failureReason, type ActionResult } from './api'
import type { TariffRow } from '../pages/admin/components/types'

export interface ServerTariff {
  id: string
  golongan: string
  vehicle_type: string
  loaded_tariff: number
  empty_tariff: number
  description?: string
  is_active: number
}

export interface RegionTariffOverrideRow {
  vehicleType: string
  /** Tarif lokal jenis kendaraan ini (0 = pakai tarif lokal wilayah). */
  lokalTariff: number
  muatanTariff: number
  kosongTariff: number
  isActive: number
}

export interface RegionTariffRow {
  id: string
  name: string
  code: string
  lokal_tariff: number | null
  lokal_active: number | null
  eksternal_tariff: number | null
  eksternal_active: number | null
  /** Baris tarif per jenis kendaraan (kosong = tarif Rp 0). */
  rows?: RegionTariffOverrideRow[] | null
}

function fmtRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

function toRow(s: ServerTariff): TariffRow {
  return {
    id: s.id,
    golongan: s.golongan,
    type: s.vehicle_type,
    loaded: fmtRp(s.loaded_tariff),
    loadedNum: s.loaded_tariff,
    empty: fmtRp(s.empty_tariff),
    emptyNum: s.empty_tariff,
    desc: s.description ?? '',
  }
}

function toPayload(row: TariffRow) {
  return {
    golongan: row.golongan,
    vehicleType: row.type,
    loadedTariff: row.loadedNum,
    emptyTariff: row.emptyNum,
    description: row.desc,
  }
}

export async function fetchTariffs(): Promise<TariffRow[] | null> {
  const rows = await api.getOk<ServerTariff[]>('/tariffs')
  return rows ? rows.map(toRow) : null
}

export async function createTariff(row: TariffRow): Promise<string | null> {
  const res = await api.post<{ id: string }>('/tariffs', toPayload(row))
  return res.ok && res.data ? res.data.id : null
}

export async function updateTariff(row: TariffRow): Promise<boolean> {
  if (!row.id) return false
  const r = await api.put(`/tariffs/${row.id}`, { ...toPayload(row), isActive: true })
  return r.ok
}

export async function deleteTariff(row: TariffRow): Promise<boolean> {
  if (!row.id) return false
  const r = await api.delete(`/tariffs/${row.id}`)
  return r.ok
}

export async function fetchRegionTariffs(): Promise<RegionTariffRow[] | null> {
  return api.getOk<RegionTariffRow[]>('/region-tariffs')
}

export async function upsertRegionTariff(input: {
  regionId: string
  tariffType: 'lokal' | 'eksternal'
  nominal: number
  aktif: boolean
}): Promise<ActionResult> {
  const r = await api.put(`/region-tariffs/${input.regionId}`, {
    [input.tariffType === 'lokal' ? 'lokal_tariff' : 'eksternal_tariff']: input.nominal,
    [input.tariffType === 'lokal' ? 'lokal_active' : 'eksternal_active']: input.aktif ? 1 : 0,
  })
  return toActionResult(r, 'Tarif wilayah gagal disimpan karena server menolak permintaan')
}

/** Upsert tarif (muatan+kosong) satu jenis kendaraan untuk region. */
export async function upsertRegionTariffRow(input: {
  regionId: string
  vehicleType: string
  muatanTariff: number
  kosongTariff: number
  lokalTariff?: number
}): Promise<ActionResult> {
  const r = await api.put(`/region-tariffs/${input.regionId}`, {
    vehicleType: input.vehicleType,
    muatanTariff: input.muatanTariff,
    kosongTariff: input.kosongTariff,
    ...(input.lokalTariff === undefined ? {} : { lokalTariff: input.lokalTariff }),
    isActive: 1,
  })
  return toActionResult(r, 'Tarif kendaraan gagal disimpan karena server menolak permintaan')
}

export async function fetchRegionTariffsFresh(regionId: string): Promise<RegionTariffRow | null> {
  const rows = await api.getOk<RegionTariffRow[]>('/region-tariffs')
  if (!rows) return null
  return rows.find(r => String(r.id) === String(regionId)) ?? null
}

/**
 * Hapus baris tarif (region + jenis kendaraan).
 *
 * Jenis kendaraan ikut di URL (di-encode), jadi "truk kecil" aman walau
 * mengandung spasi.
 */
export async function deleteRegionTariffRow(regionId: string, vehicleType: string): Promise<ActionResult> {
  const r = await api.delete(`/region-tariffs/${regionId}/rows/${encodeURIComponent(vehicleType)}`)
  return toActionResult(r, 'Tarif kendaraan gagal dihapus karena server menolak permintaan')
}

/**
 * Terapkan tarif satu jenis kendaraan ke banyak region sekaligus.
 *
 * scope 'all'      -> semua region (region yang belum punya baris ikut dibuat).
 * scope 'existing' -> hanya region yang sudah punya baris untuk jenis ini.
 */
export async function bulkUpsertRegionTariffRows(input: {
  vehicleType: string
  muatanTariff: number
  kosongTariff: number
  scope: 'all' | 'existing'
}): Promise<{ ok: boolean; updated: number; reason?: string }> {
  const res = await api.post<{ success: boolean; updated: number }>('/region-tariffs/bulk', {
    vehicleType: input.vehicleType,
    muatanTariff: input.muatanTariff,
    kosongTariff: input.kosongTariff,
    scope: input.scope,
  })
  if (!res.ok || !res.data?.success) {
    return {
      ok: false,
      updated: res.data?.updated ?? 0,
      reason: failureReason(res, 'Tarif gagal disimpan ke semua region karena server menolak permintaan'),
    }
  }
  return { ok: true, updated: res.data?.updated ?? 0 }
}

export async function upsertRegionTariffDirect(input: {
  regionId: string
  tariffType: 'lokal' | 'eksternal'
  nominal: number
  aktif: boolean
}): Promise<ActionResult> {
  const r = await api.put(`/region-tariffs/${input.regionId}`, {
    [input.tariffType === 'lokal' ? 'lokal_tariff' : 'eksternal_tariff']: input.nominal,
    [input.tariffType === 'lokal' ? 'lokal_active' : 'eksternal_active']: input.aktif ? 1 : 0,
  })
  return toActionResult(r, 'Tarif wilayah gagal disimpan karena server menolak permintaan')
}

export async function fetchAdminRegions(): Promise<AdminRegionRow[] | null> {
  return api.getOk<AdminRegionRow[]>('/regions')
}

export async function createAdminRegion(input: { name: string; code: string }): Promise<string | null> {
  const res = await api.post<{ id: string }>('/regions', input)
  return res.ok && res.data ? res.data.id : null
}

/**
 * Ubah nama/kode sebuah region.
 *
 * Memakai endpoint region (PUT /regions/:id), BUKAN endpoint tarif. Region
 * dan tarif adalah dua tabel berbeda; mengirim id region ke endpoint tarif
 * akan mengubah baris tarif yang kebetulan memakai id tersebut.
 */
export async function updateAdminRegion(
  id: string,
  input: { name?: string; code?: string },
): Promise<boolean> {
  const r = await api.put(`/regions/${id}`, input)
  return r.ok
}

export async function deleteAdminRegion(id: string): Promise<ActionResult> {
  const r = await api.delete(`/regions/${id}`)
  return toActionResult(r, 'Wilayah gagal dihapus karena server menolak permintaan')
}

export interface AdminRegionRow {
  id: string
  name: string
  code: string
}
