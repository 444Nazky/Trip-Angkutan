



export type MobileScreen =
  | 'home'
  | 'route-select'
  | 'trip-condition'
  | 'vehicle-form'
  | 'camera'
  | 'trip-summary'
  | 'trip-complete'
  | 'history'
  | 'history-detail'
  | 'officer-switch'
  | 'pin-verify'
  | 'profile'
  | 'local-officers'
  | 'geofence-config'




export interface Region {
  id: string
  name: string
  code: string
}




export interface Dermaga {
  id: string
  region_id: string
  name: string
  code: string
  region_name?: string
  region_code?: string
}




export interface Route {
  id: string
  dermaga_id: string
  name: string
  route_from: string
  route_to: string
  distance?: string | null
  duration?: string | null
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
