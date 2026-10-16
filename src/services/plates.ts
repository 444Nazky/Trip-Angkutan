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
  input: { plate?: string; owner?: string; originRegionId?: string | null; status?: PlateStatus },
): Promise<boolean> {
  const res = await api.put(`/plates/${id}`, input)
  return res.ok
}



export async function deletePlate(id: string): Promise<boolean> {
  const res = await api.delete(`/plates/${id}`)
  return res.ok
}
