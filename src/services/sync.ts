// ─── Sync Service ─────────────────────────────────────────────────────────────
// Handles trip data synchronization between mobile app and backend

import { api } from './api'
import { ensureBackendSession } from './auth'
import type { Trip } from '../pages/store'

const SYNC_QUEUE_KEY = 'trip.syncQueue.v1'
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 5000

interface SyncItem {
  trip: Trip
  attempts: number
  lastError?: string
  createdAt: number
}

interface SyncResult {
  id: string
  success: boolean
  error?: string
  code?: string
}

// ─── Queue Management ─────────────────────────────────────────────────────────

function loadQueue(): SyncItem[] {
  try {
    const raw = localStorage.getItem(SYNC_QUEUE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveQueue(queue: SyncItem[]) {
  try {
    localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue))
  } catch { /* quota */ }
}

export function addToSyncQueue(trip: Trip): void {
  const queue = loadQueue()
  // Avoid duplicates
  if (queue.some(q => q.trip.id === trip.id)) return
  queue.push({ trip, attempts: 0, createdAt: Date.now() })
  saveQueue(queue)
}

export function removeFromSyncQueue(tripId: string): void {
  saveQueue(loadQueue().filter(q => q.trip.id !== tripId))
}

export function getSyncQueue(): SyncItem[] {
  return loadQueue()
}

export function getPendingCount(): number {
  return loadQueue().length
}

// ─── Trip Sync ────────────────────────────────────────────────────────────────

async function postTripToServer(trip: Trip): Promise<SyncResult> {
  // Transform app trip to backend format
  const payload = {
    statusMuatan: trip.load === 'Ada Muatan' ? 'muatan' : 'kosong',
    routeFrom: trip.route.split(' → ')[0],
    routeTo: trip.route.split(' → ')[1],
    keterangan: trip.category || 'Internal',
    fotoKosongPath: null,
    vehicles: trip.vehicles?.map(v => ({
      noPolisi: v.plate,
      vehicleType: v.type,
      golongan: v.category,
      hasLoad: trip.load === 'Ada Muatan',
      tariffAmount: v.tariff,
    })) || [],
  }

  // Step 1: Create trip record
  const tripResult = await api.post<{ id: string; noTrip: string }>('/trips', payload)

  if (!tripResult.ok || !tripResult.data) {
    return {
      id: trip.id,
      success: false,
      error: tripResult.error?.message,
      code: tripResult.error?.code,
    }
  }

  // Step 2: Add vehicles to trip (if any)
  if (payload.vehicles.length > 0) {
    for (const vehicle of payload.vehicles) {
      const vehicleResult = await api.post(`/trips/${tripResult.data.id}/vehicles`, {
        ...vehicle,
        fotoPath: null,
        latitude: null,
        longitude: null,
      })

      if (!vehicleResult.ok) {
        // Log but don't fail - trip is created
        console.error('Failed to sync vehicle:', vehicleResult.error)
      }
    }
  }

  return { id: trip.id, success: true }
}

async function syncTrip(trip: Trip): Promise<SyncResult> {
  console.log('[Sync] Starting sync for trip:', trip.id)

  // The login screen never talks to the backend, so make sure a JWT exists
  // before posting (otherwise POST /trips 401s forever).
  const hasSession = await ensureBackendSession()
  console.log('[Sync] Backend session:', hasSession ? 'OK' : 'FAILED')

  if (!hasSession) {
    return { id: trip.id, success: false, error: 'Tidak ada sesi backend' }
  }

  let result = await postTripToServer(trip)
  console.log('[Sync] Post result:', result.success ? 'SUCCESS' : 'FAILED', result.error)

  // Token expired or rejected mid-flight — api cleared it on 401; re-auth once
  if (result.code === '401' && (await ensureBackendSession())) {
    result = await postTripToServer(trip)
  }

  return result
}

// ─── Background Sync ──────────────────────────────────────────────────────────

let syncInProgress = false
let syncListeners: ((count: number) => void)[] = []

export function onSyncQueueChange(callback: (count: number) => void) {
  syncListeners.push(callback)
  return () => {
    syncListeners = syncListeners.filter(cb => cb !== callback)
  }
}

function notifyListeners() {
  const count = getPendingCount()
  syncListeners.forEach(cb => cb(count))
}

export async function processSyncQueue(): Promise<SyncResult[]> {
  if (syncInProgress) {
    console.log('[Sync] Already in progress, skipping')
    return []
  }
  syncInProgress = true

  const queue = loadQueue()
  console.log('[Sync] Queue length:', queue.length)

  if (queue.length === 0) {
    console.log('[Sync] Queue empty, nothing to sync')
    syncInProgress = false
    return []
  }

  const results: SyncResult[] = []
  const updatedQueue: SyncItem[] = []

  for (const item of queue) {
    const result = await syncTrip(item.trip)

    if (result.success) {
      results.push(result)
      try {
        const rawTrips = localStorage.getItem('trip.trips.v1')
        if (rawTrips) {
          const list: Trip[] = JSON.parse(rawTrips)
          const updated = list.map(t => (t.id === item.trip.id ? { ...t, synced: true } : t))
          localStorage.setItem('trip.trips.v1', JSON.stringify(updated))
          window.dispatchEvent(new Event('storage'))
        }
      } catch { /* quota */ }
    } else {
      item.attempts++
      item.lastError = result.error

      if (item.attempts < MAX_RETRIES) {
        updatedQueue.push(item)
      } else {
        // Max retries reached - keep in queue but mark as failed
        updatedQueue.push(item)
        console.error(`Trip ${item.trip.id} failed after ${MAX_RETRIES} attempts:`, result.error)
      }
    }

    // Small delay between requests
    await new Promise(r => setTimeout(r, 500))
  }

  saveQueue(updatedQueue)
  notifyListeners()
  syncInProgress = false

  return results
}

// ─── Auto Sync on App Start ───────────────────────────────────────────────────

let initialized = false

export async function initializeSync() {
  if (initialized) return
  initialized = true

  const queue = loadQueue()
  if (queue.length === 0) return

  // Process queue on app start (if online)
  if (navigator.onLine) {
    await processSyncQueue()
  }

  // Listen for online events
  window.addEventListener('online', async () => {
    console.log('Network online - processing sync queue')
    await processSyncQueue()
  })

  window.addEventListener('offline', () => {
    console.log('Network offline - queuing trips locally')
  })
}
