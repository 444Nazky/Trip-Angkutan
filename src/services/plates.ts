import { api } from './api'




export type PlateStatus = 'internal' | 'lokal' | 'eksternal'




export interface PlateCheck {
  found: boolean
  plate: string
  owner: string | null
  status: PlateStatus
  jenisTarif: 'lokal' | 'eksternal' | null
  originRegionId: string | null
  originRegionCode: string | null
  checkpointRegionId: string | null
  checkpointRegionCode: string | null
  tariffAmount: number
}




// ponytail: cache hasil cek plat di memori supaya plat yang sama tidak
// memicu request server berulang (mis. saat user mengoreksi lalu mengetik ulang).
const plateCheckCache = new Map<string, { at: number; data: PlateCheck | null }>()
const PLATE_CACHE_TTL = 5 * 60 * 1000

export async function checkPlate(
  plate: string,
  originRegionId?: string | null,
): Promise<PlateCheck | null> {
  const key = `${String(plate || '').trim().toUpperCase()}::${originRegionId ?? ''}`
  const cached = plateCheckCache.get(key)
  if (cached && Date.now() - cached.at < PLATE_CACHE_TTL) return cached.data

  const res = await api.post<PlateCheck>('/plates/check', {
    plate,
    originRegionId: originRegionId || undefined,
  })
  const data = res.ok && res.data ? res.data : null
  plateCheckCache.set(key, { at: Date.now(), data })
  return data
}

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

export async function fetchPlates(): Promise<PlateRecord[] | null> {
  return api.getOk<PlateRecord[]>('/plates')
}

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

export async function updatePlate(
  id: string,
  input: { plate?: string; owner?: string; originRegionId?: string | null; status?: PlateStatus; isActive?: boolean },
): Promise<boolean> {
  const res = await api.put(`/plates/${id}`, input)
  return res.ok
}

export async function deletePlate(id: string): Promise<boolean> {
  const res = await api.delete(`/plates/${id}`)
  return res.ok
}
