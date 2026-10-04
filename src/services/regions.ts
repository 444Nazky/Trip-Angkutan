// ─── Regions API Service ──────────────────────────────────────────────────────
// Daftar region (wilayah) — dipakai form admin & pemilihan region asal plat.

import { api } from './api'

export interface Region {
  id: string
  name: string
  code: string
}

/** null = server tidak terjangkau. */
export async function fetchRegions(): Promise<Region[] | null> {
  const res = await api.get<Region[]>('/regions')
  if (res.ok && res.data) return res.data
  return null
}
