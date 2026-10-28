// CATATAN KEAMANAN (F001): berkas ini TIDAK boleh lagi memuat hash PIN apa pun.
// Dulu setiap petugas seed membawa bcrypt("123456") di dalam bundle → siapa pun
// yang memasang APK bisa login offline sebagai petugas mana pun dengan PIN default
// tanpa server. Sekarang credential hanya datang dari sinkron server (sekali online).
//
// CATATAN DATA PALSU (2026-10-31): roster seed, rute seed, dan region seed
// yang tadinya ada di berkas ini SUDAH DIHAPUS. Isinya bukan data nyata:
//   - nama petugas contoh ("Budi Santoso", "Agung Suntoso", ...)
//   - region ENTIKONG / BELITUNG / KELAPAKAMPIT yang sudah DIHAPUS dari database
//   - rute contoh ("AAAA → BBBB", "CCCC → DDDD", ...)
//_seedSeed data fake itu ditulis ke localStorage dan IndexedDB perangkat
// petugas, jadi muncul sebagai wilayah/rute/petugas sungguhan di aplikasi.
// Sekarang: tidak ada data seed sama sekali. Semua master data berasal dari
// server (dan database).
export const SEED_VERSION = 3
export const SEED_VERSION_KEY = 'trip.officers.seedVersion'

const DEFAULT_PIN = '123456'

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

/**
 * Cari petugas di roster seed.
 *
 * Tidak ada roster seed lagi, jadi hasilnya selalu `null`. Fungsinya tetap
 * ada karena pemanggil (login offline) memakai hasilnya sebagai tanda "tidak
 * ada kandidat lokal" - dan itu memang jawabannya: kredensial hanya boleh
 * datang dari server.
 */
export function findSeedOfficer(_identifier: string): SeedOfficer | null {
  return null
}

/**
 * Verifikasi PIN untuk petugas seed.
 *
 * SENGAJA selalu false: tidak ada PIN yang sah di source klien. Kalau PIN
 * default ikut ter-bundle, perangkat baru bisa login offline sebagai petugas
 * mana pun dengan "123456" - temuan F001 pada audit keamanan. PIN diverifikasi
 * dari credential hasil sinkron server (offlineDb) atau server saat online.
 */
export function verifySeedPin(_identifier: string, _pin: string): boolean {
  return false
}

/** Roster seed sudah dihapus -> selalu kosong. */
export function seedRoster(): SeedMobileOfficer[] {
  return []
}

/**
 * Bersihkan sisa data seed versi lama dari perangkat.
 *
 * Perangkat yang sudah ter-install aplikasi versi lama masih menyimpan roster
 * dan rute contoh di localStorage / IndexedDB. Semua itu dihapus di sini
 * supaya petugas tidak melihat petugas/rute yang tidak ada di database.
 */
export function purgeLegacySeedData(): void {
  try {
    localStorage.removeItem(ROSTER_KEY)
    localStorage.removeItem(ROUTES_KEY)
  } catch {
    /* quota / storage dibatasi */
  }
  try {
    localStorage.setItem(SEED_VERSION_KEY, String(SEED_VERSION))
  } catch {
    /* quota */
  }
}

/** Tidak ada lagi roster seed yang boleh disalin ke localStorage. */
export function seedRosterIfAbsent(): void {
  purgeLegacySeedData()
}

/** Tidak ada lagi rute seed yang boleh disalin ke localStorage. */
export function seedRouteCacheIfAbsent(): void {
  purgeLegacySeedData()
}

export function seedGeofencePointsIfAbsent(): void {
  /* no-op sengaja: geofence hanya dari Admin Dashboard */
}
