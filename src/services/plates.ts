// ─── Plates API Service ───────────────────────────────────────────────────────
// Registrasi & pengecekan nomor plat (internal / lokal / eksternal).

import { api } from './api'

export type PlateStatus = 'internal' | 'lokal' | 'eksternal'
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
/** Registrasi plat baru (admin). Return id baru atau null. */
/** Edit plat (admin). */
/** Hapus plat (admin). */
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
