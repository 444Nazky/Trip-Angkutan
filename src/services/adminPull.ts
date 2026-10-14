import { cacheDockOfficers, syncDermagaOfficersToDb, getStoredDermaga, getStoredOfficer, refreshStoredRoutes } from './auth'
import { syncGeofencesFromBackend } from './geofence'



export const FORCE_ROSTER_SYNC_KEY = 'trip.sync.forceRoster'



export function syncOnResume(force = false): void {
  let forced = false
  try {
    forced = localStorage.getItem(FORCE_ROSTER_SYNC_KEY) === '1'
    if (forced) localStorage.removeItem(FORCE_ROSTER_SYNC_KEY)
    const last = Number(localStorage.getItem(LAST_SYNC_KEY) || 0)
    if (!force && !forced && Date.now() - last < LAST_SYNC_MS) return
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
  } catch {}

  const officer = getStoredOfficer()
  void cacheDockOfficers(officer?.id)
  const dermaga = getStoredDermaga()
  if (dermaga?.id) void syncDermagaOfficersToDb(dermaga.id)

  void refreshStoredRoutes().catch(() => null)

  void syncGeofencesFromBackend().catch(() => null)
}

const LAST_SYNC_KEY = 'trip.officers.lastSync'
const LAST_SYNC_MS = 5 * 60 * 1000
