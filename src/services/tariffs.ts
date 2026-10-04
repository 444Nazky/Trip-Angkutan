/**
 * Tariff API Service — admin-only.
 * Tidak ada mobile code.
 */

import { api } from './api'

export interface TariffRow {
  id?: string
  golongan: string
  type: string
  loadedNum: number
  emptyNum: number
  desc: string
}

export interface ServerTariff {
  id: string
  golongan: string
  vehicle_type: string
  loaded_tariff: number
  empty_tariff: number
  description?: string
  is_active: number
}

export interface RegionTariffRow {
  id: string
  name: string
  code: string
  lokal_tariff: number | null
  lokal_active: number | null
  eksternal_tariff: number | null
  eksternal_active: number | null
}

function fmtRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

function toRow(s: ServerTariff): TariffRow {
  return {
    id: s.id,
    golongan: s.golongan,
    type: s.vehicle_type,
    loadedNum: s.loaded_tariff,
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

/** null = server tidak terjangkau */
export async function fetchTariffs(): Promise<TariffRow[] | null> {
  const res = await api.get<ServerTariff[]>('/tariffs')
  if (res.ok && res.data) return res.data.map(toRow)
  return null
}

/** null = gagal. */
export async function createTariff(row: TariffRow): Promise<string | null> {
  const res = await api.post<{ id: string }>('/tariffs', toPayload(row))
  return res.ok && res.data ? res.data.id : null
}

/** true = server terima. Rows tanpa id diabaikan. */
export async function updateTariff(row: TariffRow): Promise<boolean> {
  if (!row.id) return false
  const r = await api.put(`/tariffs/${row.id}`, { ...toPayload(row), isActive: true })
  return r.ok
}

/** true = server terima. */
export async function deleteTariff(row: TariffRow): Promise<boolean> {
  if (!row.id) return false
  const r = await api.delete(`/tariffs/${row.id}`)
  return r.ok
}

/** null = tidak terjangkau. */
export async function fetchRegionTariffs(): Promise<RegionTariffRow[] | null> {
  const r = await api.get<RegionTariffRow[]>('/region-tariffs')
  return r.ok && r.data ? r.data : null
}

/** true = server terima. */
export async function upsertRegionTariff(input: {
  regionId: string
  tariffType: 'lokal' | 'eksternal'
  nominal: number
  aktif: boolean
}): Promise<boolean> {
  const r = await api.put(`/region-tariffs/${input.regionId}`, {
    [input.tariffType === 'lokal' ? 'lokal_tariff' : 'eksternal_tariff']: input.nominal,
    [input.tariffType === 'lokal' ? 'lokal_active' : 'eksternal_active']: input.aktif ? 1 : 0,
  })
  return r.ok
}
