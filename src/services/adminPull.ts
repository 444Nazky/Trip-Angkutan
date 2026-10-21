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
  } catch { /* quota */ }

  // ponytail: renew DULU sebelum 4 panggilan authed paralel. Dulu semuanya
  // ditembak serentak dengan token basi → semua 401 → api.request menghapus
  // token saat 401 pertama → sesi mati sendiri + geofence "renewal failed"
  // padahal petugas sudah login. Tanpa sesi valid, jangan tembak sama sekali.
  const sessionOk = await renewSessionIfNeeded().catch(() => false)
  if (!sessionOk) return

  // ponytail: SATU prefetch mengambil semua yang dibutuhkan (rute + geofence
  // + tarif + akses dermaga + roster petugas) secara PARALEL. Dulu tiap
  // resume menembak 4-5 request terpisah -> lambat & boros.
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



/**
 * Daftar region yang tersimpan di perangkat.
 * Region dipakai lintas layar (pemilihan dermaga, tarif, label petugas), jadi
 * harus tersedia offline — bukan hanya region milik petugas yang sedang login.
 */
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
  try { localStorage.setItem(REGIONS_STORAGE_KEY, JSON.stringify(regions)) } catch { /* quota */ }
}



/**
 * Tarik daftar region dari admin ke penyimpanan lokal.
 *
 * Hasil kosong TIDAK menimpa cache — sama seperti geofence: respons kosong
 * sesaat (mis. tabel server sedang di-reset) tidak boleh menghapus data bagus
 * yang sudah dipakai petugas.
 */
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



// ── Tarif ────────────────────────────────────────────────────────────────────
// ponytail: implementasi tarif dipindah ke services/tariffs.ts supaya bisa
// dipakai prefetch.ts TANPA cycle import (prefetch <-> adminPull).
import {
  TARIFFS_STORAGE_KEY,
  TARIFF_UPDATED_EVENT,
  getStoredTariffs,
  pullTariffsToLocal,
  type StoredTariff,
} from './masterTariffs'

export {
  TARIFFS_STORAGE_KEY,
  TARIFF_UPDATED_EVENT,
  getStoredTariffs,
  pullTariffsToLocal,
  type StoredTariff,
}


/** Satu tarikan master data, tanpa UI. Aman dipanggil kapan pun. */
export async function silentMasterSync(): Promise<void> {
  try {
    // Belum pernah login = tidak ada yang bisa ditarik; jangan mengganggu.
    if (!api.isAuthenticated && !getStoredOfficer()) return
    const sessionOk = await renewSessionIfNeeded().catch(() => false)
    if (!sessionOk) return
    await pullRegionsToLocal().catch(() => 0)
    await pullTariffsToLocal().catch(() => 0)
    // Petugas, ketersediaan dermaga, rute, dan geofence ditangani syncOnResume.
    await syncOnResume(true).catch(() => {})
  } catch { /* senyap: saat offline tetap memakai cache lokal */ }
}
