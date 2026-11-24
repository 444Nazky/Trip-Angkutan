// CATATAN KEAMANAN (F001): berkas ini TIDAK boleh lagi memuat hash PIN apa pun.
// Dulu setiap petugas seed membawa bcrypt("123456") di dalam bundle → siapa pun
// yang memasang APK bisa login offline sebagai petugas mana pun dengan PIN default
// tanpa server. Sekarang credential hanya datang dari sinkron server (sekali online).
//
// CATATAN DATA PALSU (2026-10-31): roster seed, rute seed, dan region seed
// yang tadinya ada di berkas ini SUDAH DIHAPUS. Isinya bukan data nyata.
// Sekarang: tidak ada data seed sama sekali. Semua master data berasal dari
// server (dan database). Berkas ini hanya menyimpan versi seed dan pembersih
// sisa data seed lama di perangkat.
export const SEED_VERSION = 3
export const SEED_VERSION_KEY = 'trip.officers.seedVersion'

const ROSTER_KEY = 'trip.officers.v1'
const ROUTES_KEY = 'trip.auth.routes.v1'

/**
 * Bersihkan sisa data seed versi lama dari perangkat.
 *
 * Perangkat yang sudah ter-install aplikasi versi lama masih menyimpan roster
 * dan rute contoh di localStorage. Semua itu dihapus di sini supaya petugas
 * tidak melihat petugas/rute yang tidak ada di database.
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

export function seedGeofencePointsIfAbsent(): void {
  /* no-op sengaja: geofence hanya dari Admin Dashboard */
}
