// ─── Shared Types ─────────────────────────────────────────────────────────────

export type AppMode = 'mobile' | 'admin'
export type UserType = 'admin' | 'member'

export type MobileScreen =
  | 'home'
  | 'route-select'
  | 'trip-condition'
  | 'vehicle-form'
  | 'camera'
  | 'trip-summary'
  | 'trip-active'
  | 'trip-complete'
  | 'history'
  | 'history-detail'
  | 'officer-switch'
  | 'pin-verify'
  | 'profile'
  | 'settings'

export type AdminTab = 'overview' | 'tariff' | 'plates' | 'officers' | 'dermaga' | 'routes' | 'reports' | 'settings'

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
}

export interface Route {
  id: string
  dermaga_id: string
  name: string
  route_from: string
  route_to: string
  distance?: string
  duration?: string
}
