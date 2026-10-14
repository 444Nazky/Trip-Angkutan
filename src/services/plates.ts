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
