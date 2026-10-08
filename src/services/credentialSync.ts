import { api } from './api'
import { getStoredOfficer, refreshStoredRoutes } from './auth'
import { syncOfficersToLocal } from './officers'
import { probeServer } from './sync'

const LAST_SYNC_KEY = 'trip.credentials.last_sync'

type SyncResult = { synced: number; error?: string }
let syncing: Promise<SyncResult> | null = null

export function getLastCredentialsSync(): number {
  try { return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0 } catch { return 0 }
}

export function syncOfficerCredentials(): Promise<SyncResult> {
  if (syncing) return syncing

  syncing = (async () => {
    if (!(await probeServer(true))) return { synced: 0, error: 'Server tidak terjangkau. Coba lagi saat online.' }
    if (!api.isAuthenticated || !getStoredOfficer()) {
      return { synced: 0, error: 'Masuk secara online terlebih dahulu untuk menyinkronkan petugas.' }
    }

    try {
      const officers = await syncOfficersToLocal(true)
      if (!officers.length) return { synced: 0, error: 'Sesi petugas tidak valid atau tidak ada data. Masuk ulang secara online.' }

      const routes = await refreshStoredRoutes()
      if (routes === null) {
        return { synced: officers.length, error: 'Petugas tersimpan, tetapi rute gagal disinkronkan. Coba lagi.' }
      }

      localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
      return { synced: officers.length }
    } catch (err) {
      return { synced: 0, error: err instanceof Error ? err.message : 'Gagal menyimpan data petugas.' }
    }
  })().finally(() => { syncing = null })

  return syncing
}
