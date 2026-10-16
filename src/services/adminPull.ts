import { cacheDockOfficers, syncDermagaOfficersToDb, getStoredDermaga, getStoredOfficer, refreshStoredRoutes, renewSessionIfNeeded } from './auth'
import { syncGeofencesFromBackend } from './geofence'




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
  // ponytail: resume = force — fetch geofence murah (segelintir baris) dan
  // inilah yang membuat edit admin (koordinat baru) "langsung" sampai di HP.
  // Throttle 15 menit dulu yang bikin HP menampilkan titik basi berhari-hari.
  void syncGeofencesFromBackend({ force: true }).catch(() => null)
}

const LAST_SYNC_KEY = 'trip.officers.lastSync'
const LAST_SYNC_MS = 5 * 60 * 1000
