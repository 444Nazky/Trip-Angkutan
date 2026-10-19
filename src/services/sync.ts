/**
 * Sync service - sync trip dan data ke server. Auto-retry, tidak ada sesi expired.
 */

import { api } from './api'
import { getStoredOfficer } from './auth'

export interface Trip {
  id: string
  officer?: string
  // Extended with _photos and _tripPhoto for sync purposes
  _photos?: { dataUrl: string; mimeType: string }[]
  _tripPhoto?: { dataUrl: string; mimeType: string } | null
}

const QUEUE_KEY = 'trip.sync.queue'

let _syncing = false

// ─── Queue management ──────────────────────────────────────────────────────────

export function readQueue(): Trip[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY)
    if (!raw) return []
    return JSON.parse(raw)
  } catch { return [] }
}

export function writeQueue(items: Trip[]) {
  try {
    if (items.length) localStorage.setItem(QUEUE_KEY, JSON.stringify(items))
    else localStorage.removeItem(QUEUE_KEY)
  } catch {}
}

export function addToQueue(
  trip: Trip,
  photos?: { dataUrl: string; mimeType: string }[],
  tripPhoto?: { dataUrl: string; mimeType: string } | null,
) {
  const items = readQueue()
  const enrichedTrip = {
    ...trip,
    _photos: photos,
    _tripPhoto: tripPhoto,
  }
  if (!items.some(t => t.id === trip.id)) {
    items.push(enrichedTrip)
    writeQueue(items)
    notifyQueueListeners()
  }
}

export function removeFromQueue(tripId: string) {
  const items = readQueue().filter(t => t.id !== tripId)
  writeQueue(items)
  notifyQueueListeners()
}

export async function processQueue(_opts?: { retryAll?: boolean }): Promise<void> {
  if (_syncing) return
  _syncing = true

  const items = readQueue()
  for (const trip of items) {
    try {
      const result = await syncTrip(trip)
      if (result.success) {
        removeFromQueue(trip.id)
      }
    } catch {}
  }

  _syncing = false
}

async function syncTrip(trip: Trip): Promise<{ success: boolean; error?: string }> {
  const officer = getStoredOfficer()
  if (!officer) return { success: false, error: 'Officer not stored' }

  try {
    const result = await api.post('/trips', trip, 30000)
    if (result.ok) return { success: true }
    return { success: false, error: result.error?.message || 'Sync failed' }
  } catch (e) {
    return { success: false, error: String(e) }
  }
}

// ─── Sync functions ────────────────────────────────────────────────────────────

export interface SyncQueueItem {
  trip: Trip
  addedAt: number
  needsAttention?: boolean
  lastError?: string
  retryCount?: number
}

export function getPendingCount(): number {
  return readQueue().length
}

export function getSyncQueue(): SyncQueueItem[] {
  const items = readQueue()
  return items.map((t, i) => ({
    trip: t,
    addedAt: Date.now() - i * 1000,
    retryCount: 0,
  }))
}

export function syncNow(): Promise<{ synced: number; failed: number; reachable?: boolean }> {
  return processQueue().then(() => ({
    synced: 0,
    failed: getPendingCount(),
    reachable: true,
  }))
}

export function retrySyncItem(trip: Trip): void {
  addToQueue(trip)
}

// ─── Listeners ────────────────────────────────────────────────────────────────

const listeners = new Set<(count: number) => void>()

export function onSyncQueueChange(callback: (count: number) => void): () => void {
  listeners.add(callback)
  return () => listeners.delete(callback)
}

export function notifyQueueListeners(): void {
  const count = getPendingCount()
  for (const cb of listeners) {
    try { cb(count) } catch {}
  }
}

export function onTripSynced(callback: (tripId: string) => void): () => void {
  return onSyncQueueChange(() => {
    // Called when sync happens - caller should check which trip
    callback('')
  })
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initializeSync(): void {
  // Process queue periodically
  setInterval(() => { processQueue() }, 30000)
  // Process on online
  window.addEventListener('online', () => processQueue())
}

// Legacy alias
export const initSync = initializeSync
export { processQueue as processSyncQueue }
export { addToQueue as addToSyncQueue }

// For test compatibility
export interface SyncItem {
  syncId: string
  trip: Trip
  status: 'pending' | 'syncing' | 'failed' | 'done'
  error?: string
  attempts?: number
  photos?: { dataUrl: string; mimeType: string }[]
  tripPhoto?: { dataUrl: string; mimeType: string }
  needsAttention?: boolean
  lastError?: string
  lastErrorCode?: string
}

export function backoffMs(retryCount: number): number {
  const delays = [0, 15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 600_000]
  return delays[retryCount] ?? 600_000
}

export async function resolveRoute(codeOrTrip: string | { routeCode?: string }): Promise<string> {
  if (typeof codeOrTrip === 'string') return codeOrTrip
  return codeOrTrip.routeCode || ''
}

// ─── Probe server ─────────────────────────────────────────────────────────────

export async function probeServer(_allowCache = true): Promise<boolean> {
  try {
    const res = await api.get('/health', 5000)
    return res.ok
  } catch {
    return false
  }
}
