export type AdminTab =
  | 'overview'
  | 'tariff'
  | 'plates'
  | 'routes'
  | 'officers'
  | 'reports'
  | 'settings'



export interface TariffRow {
  id?: string
  golongan: string
  type: string
  loaded: string
  loadedNum: number
  empty: string
  emptyNum: number
  desc: string
}



export interface RouteRow {
  id: string
  dermaga_id: string
  name: string
  route_from: string
  route_to: string
  distance?: string
  duration?: string
  dermaga_name?: string
  dermaga_code?: string
  region_name?: string
}



export interface RouteDermaga {
  id: string
  region_id: string
  name: string
  code: string
  region_name?: string
  region_code?: string
}



export interface RouteFormState {
  dermaga_id: string
  name: string
  route_from: string
  route_to: string
  distance: string
  duration: string
  geofencePoints: GeofencePoint[]
}



export interface GeofencePoint {
  id?: string
  locationName: string
  latitude: string
  longitude: string
  radiusMeters: string
  description: string
}



export const emptyRouteForm: RouteFormState = {
  dermaga_id: '',
  name: '',
  route_from: '',
  route_to: '',
  distance: '',
  duration: '',
  geofencePoints: [],
}



export interface DermagaAccess {
  id: string
  code?: string
  name: string
  region_id?: string
}



export interface Officer {
  id: string
  name: string
  username?: string
  initials: string
  region: string
  regions?: string[]
  pin: string
  status: string
  device: string
  trips: number
  lastActive: string
  joined: string
  dermagaAccess?: DermagaAccess[]
}



export interface BackendOfficerRow {
  id: string
  name: string
  username: string
  region_id: string
  region_code?: string
  is_active: number
  regions: { code: string; id: string; name: string }[]
  dermagas?: DermagaAccess[]
}
