// ─── Offline Data Service ────────────────────────────────────────────────
// Handles initial data synchronization from Web Admin to local storage
// when the device is connected to the internet.

import { api } from './api'
export type { OfflineSession } from './offline-auth'

// ── Storage Keys ─────────────────────────────────────────────────────────
export const STORAGE_KEYS = {
  MASTER_USERS:     'trip.master.users.v1',
  MASTER_DERMAGA:   'trip.master.dermaga.v1',
  MASTER_ROUTES:    'trip.master.routes.v1',
  MASTER_CONFIG:    'trip.master.config.v1',
  MASTER_OFFICERS:  'trip.master.officers.v1',
  SYNC_STATUS:      'trip.master.syncStatus',
} as const

// ── Data Interfaces ────────────────────────────────────────────────────
export interface MasterUser {
  id: string
  username: string
  passwordHash: string
  name: string
  role: 'admin' | 'officer' | 'member'
  active: boolean
  createdAt: string
  updatedAt: string
}

export interface MasterDermaga {
  id: string
  name: string
  code: string
  region_id: string
  region_name: string
  region_code: string
  active: boolean
}

export interface MasterRoute {
  id: string
  name: string
  route_from: string
  route_to: string
  dermaga_id: string
  distance?: string
  duration?: string
  active: boolean
}

export interface MasterConfig {
  key: string
  value: string
  updatedAt: string
}

export interface MasterOfficer {
  id: string
  name: string
  username: string
  passwordHash: string
  pin: string
  region_id: string
  region_name: string
  region_code: string
  dermaga_access: string[]   // array of dermaga IDs
  route_access: string[]     // array of route IDs
  active: boolean
  createdAt: string
  updatedAt: string
}

// Extended officer with decoded access for offline auth
export interface OfflineOfficer extends MasterOfficer {
  dermagas?: MasterDermaga[]
  routes?: MasterRoute[]
}

// Sync status tracking
export interface SyncStatus {
  lastSyncAt: string | null
  syncedUsers: number
  syncedDermagas: number
  syncedRoutes: number
  syncedConfig: number
  syncedOfficers: number
  version: number
}

// ── Storage Helpers ────────────────────────────────────────────────────
function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function saveToStorage<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data))
  } catch { /* quota exceeded */ }
}

export function getSyncStatus(): SyncStatus {
  return loadFromStorage<SyncStatus>(STORAGE_KEYS.SYNC_STATUS, {
    lastSyncAt: null,
    syncedUsers: 0,
    syncedDermagas: 0,
    syncedRoutes: 0,
    syncedConfig: 0,
    syncedOfficers: 0,
    version: 1,
  })
}

function updateSyncStatus(partial: Partial<SyncStatus>): void {
  const current = getSyncStatus()
  saveToStorage(STORAGE_KEYS.SYNC_STATUS, { ...current, ...partial })
}

// ── Master Data Getters ────────────────────────────────────────────────
export function getMasterUsers(): MasterUser[] {
  return loadFromStorage<MasterUser[]>(STORAGE_KEYS.MASTER_USERS, [])
}

export function getMasterDermagas(): MasterDermaga[] {
  return loadFromStorage<MasterDermaga[]>(STORAGE_KEYS.MASTER_DERMAGA, [])
}

export function getMasterRoutes(): MasterRoute[] {
  return loadFromStorage<MasterRoute[]>(STORAGE_KEYS.MASTER_ROUTES, [])
}

export function getMasterConfig(): MasterConfig[] {
  return loadFromStorage<MasterConfig[]>(STORAGE_KEYS.MASTER_CONFIG, [])
}

export function getMasterOfficers(): MasterOfficer[] {
  return loadFromStorage<MasterOfficer[]>(STORAGE_KEYS.MASTER_OFFICERS, [])
}

// ── API Fetchers ─────────────────────────────────────────────────────
async function fetchUsers(): Promise<MasterUser[]> {
  const result = await api.get<MasterUser[]>('/master/users')
  return result.data ?? []
}

async function fetchDermagas(): Promise<MasterDermaga[]> {
  const result = await api.get<MasterDermaga[]>('/master/dermaga')
  return result.data ?? []
}

async function fetchRoutes(): Promise<MasterRoute[]> {
  const result = await api.get<MasterRoute[]>('/master/routes')
  return result.data ?? []
}

async function fetchConfig(): Promise<MasterConfig[]> {
  const result = await api.get<MasterConfig[]>('/master/config')
  return result.data ?? []
}

async function fetchOfficers(): Promise<MasterOfficer[]> {
  const result = await api.get<MasterOfficer[]>('/master/officers')
  return result.data ?? []
}

// ── Network Check ────────────────────────────────────────────────────
export function isOnline(): boolean {
  return navigator.onLine
}

// ── Full Initial Sync ────────────────────────────────────────────────
// Called once on app start when online, or when triggered manually
export async function performInitialSync(
  onProgress?: (stage: string, progress: number) => void
): Promise<{ success: boolean; errors: string[] }> {
  const errors: string[] = []

  if (!navigator.onLine) {
    return { success: false, errors: ['Tidak ada koneksi internet'] }
  }

  const stages = [
    { key: 'users',    fn: fetchUsers,    storage: STORAGE_KEYS.MASTER_USERS,      label: 'Mengunduh data petugas...' },
    { key: 'dermaga', fn: fetchDermagas, storage: STORAGE_KEYS.MASTER_DERMAGA,    label: 'Sinkronisasi dermaga...' },
    { key: 'routes',  fn: fetchRoutes,  storage: STORAGE_KEYS.MASTER_ROUTES,     label: 'Sinkronisasi rute...' },
    { key: 'config',   fn: fetchConfig,   storage: STORAGE_KEYS.MASTER_CONFIG,    label: 'Mengambil konfigurasi...' },
    { key: 'officers', fn: fetchOfficers, storage: STORAGE_KEYS.MASTER_OFFICERS,  label: 'Memproses hak akses...' },
  ]

  const counts: Partial<SyncStatus> = { lastSyncAt: new Date().toISOString() }

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i]
    onProgress?.(stage.label, (i / stages.length) * 100)

    try {
      const data = await stage.fn()
      saveToStorage(stage.storage, data)
      const countKey = `synced${stage.key.charAt(0).toUpperCase() + stage.key.slice(1)}` as keyof SyncStatus
      counts[countKey] = data.length
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`Gagal sinkronisasi ${stage.key}: ${msg}`)
    }
  }

  updateSyncStatus(counts)
  onProgress?.('Selesai', 100)

  return { success: errors.length === 0, errors }
}

// ── Partial Sync (per collection) ────────────────────────────────────
// Sync one collection at a time — used for background refresh
export async function syncCollection(
  collection: 'users' | 'dermaga' | 'routes' | 'config' | 'officers',
): Promise<{ success: boolean; count: number; error?: string }> {
  const collectionMap = {
    users:    { fetch: fetchUsers,    storage: STORAGE_KEYS.MASTER_USERS },
    dermaga:  { fetch: fetchDermagas,  storage: STORAGE_KEYS.MASTER_DERMAGA },
    routes:   { fetch: fetchRoutes,   storage: STORAGE_KEYS.MASTER_ROUTES },
    config:   { fetch: fetchConfig,   storage: STORAGE_KEYS.MASTER_CONFIG },
    officers: { fetch: fetchOfficers, storage: STORAGE_KEYS.MASTER_OFFICERS },
  }

  const { fetch, storage } = collectionMap[collection]

  try {
    const data = await fetch()
    saveToStorage(storage, data)
    return { success: true, count: data.length }
  } catch (err) {
    return {
      success: false,
      count: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    }
  }
}

// ── Version Check ────────────────────────────────────────────────────
// Returns true if we have any master data at all
export function hasLocalMasterData(): boolean {
  return (
    getMasterUsers().length > 0 ||
    getMasterDermagas().length > 0 ||
    getMasterRoutes().length > 0 ||
    getMasterOfficers().length > 0
  )
}

// ── Offline Readiness ────────────────────────────────────────────────
// Returns true if offline auth can proceed (officers + dermagas available locally)
export function isReadyForOfflineAuth(): boolean {
  return (
    getMasterOfficers().length > 0 &&
    getMasterDermagas().length > 0
  )
}

// ── Clear All Master Data ───────────────────────────────────────────
export function clearAllMasterData(): void {
  Object.values(STORAGE_KEYS).forEach(key => {
    try { localStorage.removeItem(key) } catch { /* quota */ }
  })
}
