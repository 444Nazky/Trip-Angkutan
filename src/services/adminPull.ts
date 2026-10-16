import { cacheDockOfficers, syncDermagaOfficersToDb, getStoredDermaga, getStoredOfficer, refreshStoredRoutes, renewSessionIfNeeded } from './auth'
import { syncGeofencesFromBackend } from './geofence'
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

  const officer = getStoredOfficer()
  void cacheDockOfficers(officer?.id)
  const dermaga = getStoredDermaga()
  if (dermaga?.id) void syncDermagaOfficersToDb(dermaga.id)
  void refreshStoredRoutes().catch(() => null)
  // Tarif ikut disegarkan saat aplikasi dibuka: nominal bisa berubah kapan
  // saja dari admin, dan trip berikutnya harus memakai angka terbaru.
  void pullTariffsToLocal().catch(() => 0)
  // ponytail: resume = force — fetch geofence murah (segelintir baris) dan
  // inilah yang membuat edit admin (koordinat baru) "langsung" sampai di HP.
  // Throttle 15 menit dulu yang bikin HP menampilkan titik basi berhari-hari.
  void syncGeofencesFromBackend({ force: true }).catch(() => null)
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

/** Kunci yang sama dipakai store (`LS.tariffs`) — jangan diubah sendiri. */
export const TARIFFS_STORAGE_KEY = 'trip.tariffs.v1'



export interface StoredTariff {
  id: string
  golongan: string
  type: string
  loaded: string
  loadedNum: number
  empty: string
  emptyNum: number
  desc: string
}



interface ServerTariff {
  id?: string
  golongan?: string
  vehicle_type?: string
  loaded_tariff?: number
  empty_tariff?: number
  description?: string | null
}



function fmtRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}



function toStoredTariff(s: ServerTariff): StoredTariff | null {
  const type = String(s.vehicle_type ?? '').trim()
  if (!type) return null
  const loadedNum = Number(s.loaded_tariff) || 0
  const emptyNum = Number(s.empty_tariff) || 0
  return {
    id: String(s.id ?? ''),
    golongan: String(s.golongan ?? '').trim(),
    type,
    loaded: fmtRp(loadedNum),
    loadedNum,
    empty: fmtRp(emptyNum),
    emptyNum,
    desc: String(s.description ?? ''),
  }
}



/** Tarif yang tersimpan di perangkat (kosong = belum pernah tersinkron). */
export function getStoredTariffs(): StoredTariff[] {
  try {
    const raw = localStorage.getItem(TARIFFS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(r => (r && typeof r === 'object' ? (r as Partial<StoredTariff>) : null))
      .filter((r): r is Partial<StoredTariff> => r !== null)
      .map(r => ({
        id: String(r.id ?? ''),
        golongan: String(r.golongan ?? ''),
        type: String(r.type ?? ''),
        loaded: String(r.loaded ?? ''),
        loadedNum: Number(r.loadedNum) || 0,
        empty: String(r.empty ?? ''),
        emptyNum: Number(r.emptyNum) || 0,
        desc: String(r.desc ?? ''),
      }))
      .filter(r => r.type)
  } catch {
    return []
  }
}



function saveTariffs(tariffs: StoredTariff[]): void {
  try { localStorage.setItem(TARIFFS_STORAGE_KEY, JSON.stringify(tariffs)) } catch { /* quota */ }
}



/**
 * Tarik master tarif admin ke perangkat petugas.
 *
 * Dipakai `tariffFor()` saat petugas menambah kendaraan, jadi nominal yang
 * tersimpan di trip = tarif admin terakhir, bukan angka contoh bawaan.
 * Hasil kosong TIDAK menimpa cache (sama seperti geofence/region): tabel yang
 * sedang kosong sesaat tidak boleh menghapus tarif yang sudah dipakai.
 */
export async function pullTariffsToLocal(): Promise<number> {
  const cached = getStoredTariffs()
  const res = await api.get<ServerTariff[]>('/master/tariffs').catch(() => null)
  if (!res || !res.ok || !Array.isArray(res.data)) return cached.length
  const rows = res.data
    .map(toStoredTariff)
    .filter((r): r is StoredTariff => r !== null)
  if (rows.length === 0) return cached.length
  saveTariffs(rows)
  return rows.length
}



// ── Sinkron senyap saat koneksi kembali ──────────────────────────────────────

let connectivityBound = false
let pendingSync: ReturnType<typeof setTimeout> | null = null



/**
 * Bawa seluruh master data (petugas + PIN, dermaga, rute, geofence, region)
 * selaras begitu perangkat kembali punya internet.
 *
 * Sengaja TANPA notifikasi/toast — petugas cukup melihat datanya berubah.
 * Dijeda 1,5 detik karena satu peralihan jaringan sering memicu beberapa event
 * berturut-turut (`online` + `networkStatusChange`).
 */
export function startConnectivitySync(): void {
  if (connectivityBound) return
  connectivityBound = true

  const trigger = () => { scheduleSilentSync() }

  try {
    window.addEventListener('online', trigger)
  } catch { /* non-browser */ }

  // Jalur native: event `online` WebView tidak selalu andal saat jaringan
  // berpindah (WiFi ↔ seluler), jadi pakai plugin Network bila tersedia.
  void (async () => {
    try {
      const { Network } = await import('@capacitor/network')
      await Network.addListener('networkStatusChange', status => {
        if (status?.connected) trigger()
      })
    } catch { /* plugin tak tersedia (web) — listener window sudah cukup */ }
  })()
}



function scheduleSilentSync(): void {
  if (pendingSync) clearTimeout(pendingSync)
  pendingSync = setTimeout(() => {
    pendingSync = null
    void silentMasterSync()
  }, 1500)
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
