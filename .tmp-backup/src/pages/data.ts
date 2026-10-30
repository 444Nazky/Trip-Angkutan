import { getStoredRoutes, hasDockScopedRoutes, type UiRoute } from '../services/auth'

/**
 * Data contoh yang dulu ada di file ini sudah DIHAPUS:
 *   - `ROUTES` (rute "Sijangkung → Sabadi" dsb.)
 *   - `tariffData` (harga Motor 15.000, Mobil 45.000, ...)
 *   - `officerList` (nama petugas contoh + PIN "123456", region BELITUNG &
 *     KELAPAKAMPIT yang sudah DIHAPUS dari database)
 *
 * Semuanya adalah data palsu: tidak ada di server, dan kalau dipakai membuat
 * petugas melihat rute/harga/region yang tidak benar-benar ada. Sekarang
 * satu-satunya sumber adalah server (rute & tarif disinkron ke perangkat,
 * jenis kendaraan & wilayah diambil dari database).
 */

export function activeRoutes(): UiRoute[] {
  const stored = getStoredRoutes()
  // Tanpa rute di perangkat, tidak ada rute yang bisa ditampilkan. Jangan
  // menampilkan daftar contoh - petugas akan memilih rute yang tidak ada.
  return stored.length > 0 || hasDockScopedRoutes() ? stored : []
}

export const allTrips = []

export interface DermagaAccess {
  id: string
  code?: string
  name: string
  region_id?: string
}
