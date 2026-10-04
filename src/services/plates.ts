// ─── Plates API Service ───────────────────────────────────────────────────────
// Registrasi & pengecekan nomor plat (internal / lokal / eksternal).

import { api } from './api'

export type PlateStatus = 'internal' | 'lokal' | 'eksternal'

export interface PlateRecord {
  id: string
  plate: string
  owner: string | null
  origin_region_id: string | null
  origin_region_code?: string | null
  origin_region_name?: string | null
  status: PlateStatus
  is_active: number
  created_at: string
}

export interface PlateCheck {
  found: boolean
  plate: string
  owner: string | null
  status: PlateStatus
  /** null untuk internal (tidak dikenakan tarif) */
  jenisTarif: 'lokal' | 'eksternal' | null
  originRegionId: string | null
  originRegionCode: string | null
  checkpointRegionId: string | null
  checkpointRegionCode: string | null
  tariffAmount: number
}

/** Daftar plat terdaftar (admin). null = server tidak terjangkau. */
export async function fetchPlates(): Promise<PlateRecord[] | null> {
  const res = await api.get<PlateRecord[]>('/plates')
  if (res.ok && res.data) return res.data
  return null
}

/** Registrasi plat baru (admin). Return id baru atau null. */
export async function createPlate(input: {
  plate: string
  owner?: string
  originRegionId?: string | null
  status: PlateStatus
}): Promise<string | null> {
  const res = await api.post<{ id: string }>('/plates', input)
  if (res.ok && res.data) return res.data.id
  return null
}

/** Edit plat (admin). */
export async function updatePlate(
  id: string,
  input: { plate?: string; owner?: string; originRegionId?: string | null; status?: PlateStatus },
): Promise<boolean> {
  const res = await api.put(`/plates/${id}`, input)
  return res.ok
}

/** Hapus plat (admin). */
export async function deletePlate(id: string): Promise<boolean> {
  const res = await api.delete(`/plates/${id}`)
  return res.ok
}

/**
 * Cek plat oleh petugas. Region pos pemeriksaan diambil dari JWT petugas
 * di server; `originRegionId` = region asal kendaraan (untuk plat tak terdaftar).
 * null = server tidak terjangkau / request gagal.
 */
export async function checkPlate(
  plate: string,
  originRegionId?: string | null,
): Promise<PlateCheck | null> {
  const res = await api.post<PlateCheck>('/plates/check', {
    plate,
    originRegionId: originRegionId || undefined,
  })
  if (res.ok && res.data) return res.data
  return null
}
