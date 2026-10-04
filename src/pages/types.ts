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

export type AdminTab = 'overview' | 'tariff' | 'plates' | 'officers' | 'reports' | 'settings'

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

/** Akses petugas ke dermaga (dipakai filter Ganti Petugas & pilih rute). */
export interface DermagaAccess {
  id: string
  code?: string
  name: string
  region_id?: string
}

/** Profil petugas — dipakai store mobile & layar Ganti Petugas. */
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
