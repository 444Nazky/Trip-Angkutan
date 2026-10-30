import { normalizeRouteCode } from './geofence'
import type { UiRoute } from './auth'

/**
 * Apakah sebuah rute diizinkan oleh titik geofence aktif.
 *
 * Memakai `normalizeRouteCode` yang sama dengan validasi trip, jadi
 * "SBDZ→SJRE", "sbdz - sjre", dan "SBDZ-SJRE" dianggap rute yang sama.
 */
export function routeAllowed(code: string, allowedRoutes: string[] | null | undefined): boolean {
  if (!allowedRoutes?.length) return false
  const target = normalizeRouteCode(code)
  return allowedRoutes.some(allowed => normalizeRouteCode(allowed) === target)
}

export interface PartitionedRoutes {
  /** Rute yang boleh dipakai di posisi petugas sekarang — tampil paling atas. */
  available: UiRoute[]
  /** Rute lain: tetap ditampilkan (SOP rute ganda) tapi dikunci. */
  locked: UiRoute[]
}

/**
 * Pisahkan rute menjadi tersedia & terkunci tanpa mengubah urutan aslinya.
 *
 * Dulu daftar tampil apa adanya, sehingga rute yang diizinkan geofence bisa
 * berada di bawah dan petugas harus scroll dulu untuk menemukannya.
 */
export function partitionRoutes(
  routes: UiRoute[],
  allowedRoutes: string[] | null | undefined,
): PartitionedRoutes {
  const available: UiRoute[] = []
  const locked: UiRoute[] = []
  for (const route of routes) {
    if (routeAllowed(route.code, allowedRoutes)) available.push(route)
    else locked.push(route)
  }
  return { available, locked }
}

/**
 * Kode rute yang sebaiknya dipilih otomatis.
 *
 * - Pilihan petugas yang masih diizinkan dipertahankan (jangan menimpa).
 * - Kalau belum ada / pilihannya terkunci, ambil rute pertama yang tersedia.
 * - Tidak ada rute tersedia (di luar geofence) → null, biarkan kosong.
 */
export function pickAutoRouteCode(opts: {
  routes: UiRoute[]
  allowedRoutes: string[] | null | undefined
  currentCode?: string | null
}): string | null {
  const { routes, allowedRoutes, currentCode } = opts
  if (currentCode && routeAllowed(currentCode, allowedRoutes)) return currentCode
  const first = routes.find(route => routeAllowed(route.code, allowedRoutes))
  return first?.code ?? null
}
