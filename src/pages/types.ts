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
