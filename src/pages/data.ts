import { getStoredRoutes, hasDockScopedRoutes, type UiRoute } from '../services/auth'



export function activeRoutes(): UiRoute[] {
  const stored = getStoredRoutes()
  // Tanpa rute di perangkat, tidak ada rute yang bisa ditampilkan. Jangan menampilkan daftar contoh - petugas akan memilih rute yang tidak ada.
  return stored.length > 0 || hasDockScopedRoutes() ? stored : []
}



export const allTrips = []



export interface DermagaAccess {
  id: string
  code?: string
  name: string
  region_id?: string
}
