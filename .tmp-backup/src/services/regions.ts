import { api } from './api'



export interface Region {
  id: string
  name: string
  code: string
}



export async function fetchRegions(): Promise<Region[] | null> {
  return api.getOk<Region[]>('/regions')
}
