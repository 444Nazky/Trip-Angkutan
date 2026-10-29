import { syncDermagaOfficersToDb, getStoredDermaga, getStoredOfficer, renewSessionIfNeeded } from './auth'
import { prefetchAllCriticalData } from './prefetch'
import { api } from './api'



export const FORCE_ROSTER_SYNC_KEY = 'trip.sync.forceRoster'



export async function syncOnResume(force = false): Promise<void> {
  let forced = false
  try {
    forced = localStorage.getItem(FORCE_ROSTER_SYNC_KEY) === '1'
    if (forced) localStorage.removeItem(FORCE_ROSTER_SYNC_KEY)
    const last = Number(localStorage.getItem(LAST_SYNC_KEY) || 0)
    if (!force && !forced && Date.now() - last < LAST_SYNC_MS) return
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
  } catch {  }

  // ponytail: renew DULU sebelum 4 panggilan authed paralel.
  const sessionOk = await renewSessionIfNeeded().catch(() => false)
  if (!sessionOk) return

  void prefetchAllCriticalData({ force: true }).catch(() => null)
  const dermaga = getStoredDermaga()
  if (dermaga?.id) void syncDermagaOfficersToDb(dermaga.id)
}



const LAST_SYNC_KEY = 'trip.officers.lastSync'



const LAST_SYNC_MS = 5 * 60 * 1000



export const REGIONS_STORAGE_KEY = 'trip.regions.v1'



export interface StoredRegion {
  id: string
  name: string
  code: string
}



// Daftar region yang tersimpan di perangkat. Region dipakai lintas layar (pemilihan dermaga, tarif, label petugas), jadi harus tersedia offline
export function getStoredRegions(): StoredRegion[] {
  try {
    const raw = localStorage.getItem(REGIONS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(r => (r && typeof r === 'object' ? (r as Partial<StoredRegion>) : null))
      .filter((r): r is Partial<StoredRegion> => r !== null)
      .map(r => ({ id: String(r.id ?? ''), name: String(r.name ?? ''), code: String(r.code ?? '') }))
      .filter(r => r.id || r.code)
  } catch {
    return []
  }
}



function saveRegions(regions: StoredRegion[]): void {
  try { localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify(regions)) } catch {  }
}



// Tarik daftar region dari admin ke penyimpanan lokal. Hasil kosong TIDAK menimpa cache — sama seperti geofence: respons kosong sesaat (mis.
export async function pullRegionsToLocal(): Promise<number> {
  const cached = getStoredRegions()
  const res = await api.get<StoredRegion[]>('/regions').catch(() => null)
  if (!res || !res.ok || !Array.isArray(res.data)) return cached.length
  const rows = res.data
    .filter(r => r && String(r.id ?? '').trim())
    .map(r => ({ id: String(r.id), name: String(r.name ?? ''), code: String(r.code ?? '') }))
  if (rows.length === 0) return cached.length
  saveRegions(rows)
  return rows.length
}



// ── Tarif ──────────────────────────────────────────────────────────────────── ponytail: implementasi tarif dipindah ke services/tariffs.ts supaya…
import {
  TARIFFS_STORAGE_KEY,
  TARIFF_UPDATED_EVENT,
  getStoredTariffs,
  pullTariffsToLocal,
  type StoredTariff,
} from './masterTariffs'

import { pullVehicleTypesToLocal } from './vehicleTypes'



export {
  TARIFFS_STORAGE_KEY,
  TARIFF_UPDATED_EVENT,
  getStoredTariffs,
  pullTariffsToLocal,
  type StoredTariff,
}



export async function silentMasterSync(): Promise<void> {
  try {
    // Belum pernah login = tidak ada yang bisa ditarik; jangan mengganggu.
    if (!api.isAuthenticated && !getStoredOfficer()) return
    const sessionOk = await renewSessionIfNeeded().catch(() => false)
    if (!sessionOk) return
    await pullRegionsToLocal().catch(() => 0)
    await pullTariffsToLocal().catch(() => 0)
    await pullVehicleTypesToLocal().catch(() => 0)
    await syncOnResume(true).catch(() => {})
  } catch {  }
}
