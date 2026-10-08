// ─── useOfflineInit Hook ──────────────────────────────────────────────
// React hook for managing offline initialization state and lifecycle.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  performInitialSync,
  getSyncStatus,
  hasLocalMasterData,
  isReadyForOfflineAuth,
  STORAGE_KEYS,
} from '../services/offline-init'
import {
  getOfflineSession,
  validateSession,
  type OfflineSession,
} from '../services/offline-auth'

export type InitState =
  | { phase: 'checking' }
  | { phase: 'syncing'; stage: string; percent: number }
  | { phase: 'ready' | 'offline'; session: OfflineSession | null }
  | { phase: 'error'; errors: string[]; canRetry: boolean }

export function useOfflineInit() {
  const [state, setState] = useState<InitState>({ phase: 'checking' })
  const mountedRef = useRef(true)
  const syncRef = useRef<() => Promise<void>>(async () => {})

  // Keep ref current so event listeners don't go stale
  const set = useCallback((s: InitState) => {
    if (mountedRef.current) setState(s as any)
  }, [])

  const runSync = useCallback(async () => {
    set({ phase: 'syncing', stage: 'Memeriksa...', percent: 0 })

    const result = await performInitialSync((stage, percent) => {
      if (mountedRef.current) set({ phase: 'syncing', stage, percent } as any)
    })

    if (!mountedRef.current) return

    if (result.success) {
      // Sync succeeded — check if we have an existing session
      const session = getOfflineSession()
      if (session && validateSession()) {
        set({ phase: 'ready', session })
      } else {
        set({ phase: 'ready', session: null })
      }
    } else {
      // Sync failed — try to load from cache and allow offline use
      const session = getOfflineSession()
      if (session && hasLocalMasterData()) {
        set({ phase: 'offline', session })
      } else {
        set({ phase: 'error', errors: result.errors, canRetry: true })
      }
    }
  }, [set])

  syncRef.current = runSync

  // Auto-start on mount
  useEffect(() => {
    mountedRef.current = true
    if (!navigator.onLine) {
      // Offline immediately — load cached data
      const session = getOfflineSession()
      if (session) {
        set({ phase: 'offline', session })
      } else if (hasLocalMasterData()) {
        set({ phase: 'offline', session: null })
      } else {
        set({ phase: 'error', errors: ['Tidak ada koneksi dan tidak ada data tersimpan.'], canRetry: false })
      }
      return
    }

    void runSync()
  }, [runSync, set])

  // Auto-retry when coming online
  useEffect(() => {
    const on = () => { void syncRef.current() }
    window.addEventListener('online', on)
    return () => window.removeEventListener('online', on)
  }, [])

  const retry = useCallback(() => void runSync(), [runSync])

  const useOffline = useCallback(() => {
    clearStorage()
    const session = getOfflineSession()
    set({ phase: 'offline', session: session ?? null })
  }, [set])

  return { state, retry, useOffline }
}

function clearStorage() {
  Object.values(STORAGE_KEYS).forEach(k => {
    try { localStorage.removeItem(k) } catch { /* ignore */ }
  })
  try { localStorage.removeItem('trip.auth.session') } catch { /* ignore */ }
  try { localStorage.removeItem('trip.auth.activeDermaga') } catch { /* ignore */ }
}
