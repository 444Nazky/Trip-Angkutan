/**
 * Prefetch Service - memuat SEMUA data yang dibutuhkan aplikasi mobile
 * sekali saja setelah login, supaya navigasi berikutnya instan.
 *
 * Yang di-prefetch (semua paralel, satu round-trip):
 * - Rute (/routes/mine)          -> localStorage trip.routes.v2
 * - Titik geofence (/geofences)  -> localStorage trip.geofence.points
 * - Tarif (/master/tariffs)      -> localStorage trip.tariffs.v1 (dipakai form kendaraan)
 * - Akses dermaga (/officers/:id/dermaga-access)
 *
 * Semua hasil disimpan di localStorage. Layar berikutnya (Pilih Rute, Form
 * Kendaraan, dsb) membaca dari cache secara SYNCHRONIS -> tampil instan tanpa
 * spinner menunggu jaringan.
 *
 * Anti-duplikat: single-flight + TTL. Prefetch dipanggil dari beberapa layar
 * (Home, Profile, PinVerify) — tanpa guard ini, satu login bisa memicu 4-6
 * request paralel yang sama.
 */

import { refreshStoredRoutes, getStoredRoutes, cacheDockOfficers } from './auth'
import { syncGeofencesFromBackend, getStoredGeofencePoints } from './geofence'
import { pullTariffsToLocal, getStoredTariffs as getStoredTariffRows, TARIFF_UPDATED_EVENT } from './masterTariffs'
import { syncOfficersToLocal } from './officers'
import { pullOfflineMaster, getOfflineMasterStatus } from './offlineMaster'
import type { UiRoute } from './auth'
import type { GeofencePoint } from './geofence'

export interface PrefetchResult {
  success: boolean
  routes?: UiRoute[]
  geofencePoints?: GeofencePoint[]
  tariffs?: TariffInfo[]
  errors: string[]
}

export interface TariffInfo {
  golongan: string
  vehicleType: string
  loadedTariff: number
  emptyTariff: number
}

export { TARIFF_UPDATED_EVENT }

// Storage keys untuk cache
const LAST_PREFETCH_KEY = 'trip.prefetch.lastAt'
const PREFETCH_TTL_MS = 3 * 60 * 1000      // prefetch ulang minimal tiap 3 menit

let inflight: Promise<PrefetchResult> | null = null



/**
 * Ambil tarif dari localStorage (diformat ulang ke bentuk ringkas).
 * Sumber data: adminPull.pullTariffsToLocal (key trip.tariffs.v1).
 */
export function getStoredTariffs(): TariffInfo[] {
  return getStoredTariffRows().map(t => ({
    golongan: t.golongan,
    vehicleType: t.type,
    loadedTariff: t.loadedNum,
    emptyTariff: t.emptyNum,
  }))
}



/**
 * Apakah hasil prefetch terakhir masih segar (belum perlu diulang)?
 */
export function isPrefetchFresh(): boolean {
  try {
    const last = Number(localStorage.getItem(LAST_PREFETCH_KEY) || 0)
    if (!last || Date.now() - last >= PREFETCH_TTL_MS) return false
    // Cache bisa terhapus (storage dibersihkan / update aplikasi) sementara
    // penanda waktu masih ada. Anggap tidak segar bila data inti kosong.
    return getStoredRoutes().length > 0 && getStoredGeofencePoints().length > 0
  } catch {
    return false
  }
}



function markPrefetched(): void {
  try { localStorage.setItem(LAST_PREFETCH_KEY, String(Date.now())) } catch { /* quota */ }
}



async function doPrefetch(): Promise<PrefetchResult> {
  const errors: string[] = []
  let routes: UiRoute[] | undefined
  let geofencePoints: GeofencePoint[] | undefined
  let tariffs: TariffInfo[] | undefined

  console.log('[prefetch] Memulai prefetch data kritis...')

  // Jalankan semua fetch secara paralel
  const [routesResult, geoResult, tariffResult, accessResult, rosterResult, masterResult] = await Promise.allSettled([
    // Rute — selalu refresh dari server (murah, 1 request)
    (async () => {
      const fresh = await refreshStoredRoutes({ force: true })
      routes = fresh ?? getStoredRoutes()
      console.log('[prefetch] Rute:', routes.length)
      return routes
    })(),

    // Geofence — sync titik lokasi
    (async () => {
      const sync = await syncGeofencesFromBackend({ force: true })
      geofencePoints = getStoredGeofencePoints()
      console.log('[prefetch] Geofence:', geofencePoints.length, '(', sync.reason, ')')
      return geofencePoints
    })(),

    // Tarif (pakai pullTariffsToLocal — sumber data master tarif yang sama
    // dengan sinkron admin, menulis ke trip.tariffs.v1)
    (async () => {
      await pullTariffsToLocal()
      tariffs = getStoredTariffs()
      console.log('[prefetch] Tarif:', tariffs.length)
      return tariffs
    })(),

    // Akses dermaga petugas
    (async () => {
      await cacheDockOfficers()
      return true
    })(),

    // Roster petugas + hash PIN + akses dermaga.
    // ponytail: ini yang membuat perubahan di dashboard admin (PIN baru,
    // petugas baru, akses baru) LANGSUNG menggantikan data di HP begitu ada
    // internet — bukan menunggu petugas logout/login ulang.
    (async () => {
      const roster = await syncOfficersToLocal(true)
      console.log('[prefetch] Roster petugas:', roster.length)
      return roster
    })(),

    // Paket master offline: region + master plat + tarif region.
    // Tanpa ini, cek status plat HANYA bisa jalan online (butuh /plates/check)
    // dan tarif region tidak pernah ada di perangkat.
    (async () => {
      const res = await pullOfflineMaster()
      const status = getOfflineMasterStatus()
      console.log(
        '[prefetch] Master offline:',
        res.ok ? 'ok' : 'gagal (pakai cache)',
        'plat=' + status.plates,
        'region=' + status.regions,
        'tarif-region=' + status.tariffs,
      )
      // Backend belum punya /master/offline (belum ter-deploy). Bukan error:
      // aplikasi tetap jalan, hanya fitur offline plat yang belum aktif.
      // Kalau ini dianggap gagal, prefetch tidak pernah ditandai segar →
      // tiap resume aplikasi mengulang 5-6 request dan memboroskan kuota.
      if (res.missing) {
        console.warn('[prefetch] Master offline: endpoint /master/offline belum ada di server')
        return null
      }
      if (!res.ok && !status.hasPack) throw new Error('Master offline belum pernah ditarik')
      return res
    })(),
  ])

  if (routesResult.status === 'rejected') errors.push('Routes: ' + String(routesResult.reason))
  if (geoResult.status === 'rejected') errors.push('Geofence: ' + String(geoResult.reason))
  if (tariffResult.status === 'rejected') errors.push('Tarif: ' + String(tariffResult.reason))
  if (accessResult.status === 'rejected') errors.push('Dermaga: ' + String(accessResult.reason))
  if (rosterResult.status === 'rejected') errors.push('Roster: ' + String(rosterResult.reason))
  if (masterResult.status === 'rejected') errors.push('Master offline: ' + String(masterResult.reason))

  const success = errors.length === 0
  // Hanya tandai segar bila SEMUA sumber berhasil. Dulu partial failure tetap
  // menandai segar → data master yang gagal tidak pernah dicoba ulang sampai
  // TTL habis, dan petugas offline memakai cache tidak lengkap.
  if (success) markPrefetched()

  console.log('[prefetch] Selesai:', {
    success,
    routesCount: routes?.length ?? 0,
    geofenceCount: geofencePoints?.length ?? 0,
    tariffsCount: tariffs?.length ?? 0,
    errors: errors.length,
  })

  return { success, routes, geofencePoints, tariffs, errors }
}



/**
 * Prefetch semua data kritis (paralel, anti-duplikat).
 * Dipanggil setelah login berhasil. Tidak pernah di-await oleh layar —
 * pemanggil cukup memicu di background.
 */
export async function prefetchAllCriticalData(
  opts?: { force?: boolean },
): Promise<PrefetchResult> {
  // Sudah baru saja di-prefetch → pakai cache, jangan ulang.
  if (!opts?.force && isPrefetchFresh()) {
    return {
      success: true,
      routes: getStoredRoutes(),
      geofencePoints: getStoredGeofencePoints(),
      tariffs: getStoredTariffs(),
      errors: [],
    }
  }

  // Sudah berjalan → gabungkan ke promise yang sama.
  if (inflight) return inflight

  inflight = doPrefetch().finally(() => { inflight = null })
  return inflight
}



/**
 * Prefetch data spesifik (single)
 * Untuk lazy loading atau refresh tertentu
 */
export async function prefetchRoutes(): Promise<UiRoute[] | null> {
  const cached = getStoredRoutes()
  if (cached.length > 0) {
    // Refresh di background, return cached dulu
    refreshStoredRoutes().then(fresh => {
      if (fresh) console.log('[prefetch] Rute di-refresh:', fresh.length)
    }).catch(() => {})
    return cached
  }
  // Kalau tidak ada cache, wait sampai fetch selesai
  return refreshStoredRoutes()
}



export async function prefetchGeofences(): Promise<GeofencePoint[]> {
  const cached = getStoredGeofencePoints()
  if (cached.length > 0) {
    // Sync di background
    syncGeofencesFromBackend({ force: false }).catch(() => {})
    return cached
  }
  // Wait kalau tidak ada cache
  await syncGeofencesFromBackend({ force: true })
  return getStoredGeofencePoints()
}



export async function prefetchTariffs(): Promise<TariffInfo[]> {
  const cached = getStoredTariffs()
  if (cached.length > 0) return cached
  await pullTariffsToLocal()
  return getStoredTariffs()
}



/**
 * Auto-sync master data berkala (hanya saat online & aplikasi aktif).
 *
 * Tujuannya: perubahan di dashboard admin (PIN baru, petugas baru, akses
 * dermaga baru, rute, geofence, tarif) langsung sampai ke HP tanpa perlu
 * petugas logout/login ulang.
 *
 * Interval 30 menit, bukan 5 menit: satu siklus prefetch = 4-5 request
 * (rute + geofence per dermaga + tarif + daftar petugas). Pada 5 menit itu
 * ~1.440 request/hari per perangkat, sementara data master hampir tidak
 * berubah dalam rentang itu. Sebagai jaring pengaman, 30 menit cukup: setiap
 * kali aplikasi dibuka ulang (appStateChange) master data tetap ditarik paksa.
 */
const AUTO_SYNC_INTERVAL_MS = 30 * 60 * 1000
let _autoSyncTimer: ReturnType<typeof setInterval> | null = null

export function startMasterDataAutoSync(): void {
  if (_autoSyncTimer) return
  _autoSyncTimer = setInterval(() => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return
    void prefetchAllCriticalData().catch(() => undefined)
  }, AUTO_SYNC_INTERVAL_MS)
}

export function stopMasterDataAutoSync(): void {
  if (!_autoSyncTimer) return
  clearInterval(_autoSyncTimer)
  _autoSyncTimer = null
}


/**
 * Clear semua cache
 */
export function clearAllCache(): void {
  try {
    localStorage.removeItem(LAST_PREFETCH_KEY)
    console.log('[prefetch] Cache cleared')
  } catch (e) {
    console.warn('[prefetch] Gagal clear cache:', e)
  }
}



/**
 * Cek status cache
 */
export function getCacheStatus(): {
  routesCount: number
  geofenceCount: number
  tariffCount: number
  tariffCacheAge: number | null
  prefetchAge: number | null
} {
  const prefetchTime = localStorage.getItem(LAST_PREFETCH_KEY)
  return {
    routesCount: getStoredRoutes().length,
    geofenceCount: getStoredGeofencePoints().length,
    tariffCount: getStoredTariffs().length,
    tariffCacheAge: null,
    prefetchAge: prefetchTime ? Date.now() - Number(prefetchTime) : null,
  }
}
