// CATATAN KEAMANAN (F001): berkas ini TIDAK boleh lagi memuat hash PIN apa pun.
export const SEED_VERSION = 3



export const SEED_VERSION_KEY = 'trip.officers.seedVersion'



const ROSTER_KEY = 'trip.officers.v1'



const ROUTES_KEY = 'trip.auth.routes.v1'



export interface SeedDermaga {
  id: string
  name: string
  code: string
  region_id: string
}



export interface SeedOfficer {
  id: string
  username: string
  name: string
  isActive?: 0 | 1
  regionId: string
  regionName: string
  regionCode: string
  dermagaAccess: SeedDermaga[]
}



export interface SeedRoute {
  id: string
  name: string
  route_from: string
  route_to: string
  distance?: string
  duration?: string
}



export interface SeedMobileOfficer {
  id: string
  name: string
  username: string
  initials: string
  region: string
  regions: string[]
  pin: string
  status: string
  device: string
  trips: number
  lastActive: string
  joined: string
  dermagaAccess: SeedDermaga[]
}

// Cari petugas di roster seed. Tidak ada roster seed lagi, jadi hasilnya selalu `null`.
export function findSeedOfficer(_identifier: string): SeedOfficer | null {
  return null
}

// Verifikasi PIN untuk petugas seed. SENGAJA selalu false: tidak ada PIN yang sah di source klien.
export function verifySeedPin(_identifier: string, _pin: string): boolean {
  return false
}



export function seedRoster(): SeedMobileOfficer[] {
  return []
}

// Bersihkan sisa data seed versi lama dari perangkat.
export function purgeLegacySeedData(): void {
  try {
    localStorage.removeItem(ROSTER_KEY)
    localStorage.removeItem(ROUTES_KEY)
  } catch {
  }
  try {
    localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION))
  } catch {
  }
}



export function seedRosterIfAbsent(): void {
  purgeLegacySeedData()
}



export function seedRouteCacheIfAbsent(): void {
  purgeLegacySeedData()
}



export function seedGeofencePointsIfAbsent(): void {
  /* no-op sengaja: geofence hanya dari Admin Dashboard */
}
