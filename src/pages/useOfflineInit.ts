import { useCallback, useEffect, useRef, useState } from 'react'
import {
  performInitialSync,
  hasLocalMasterData,
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

      const session = getOfflineSession()
      if (session && validateSession()) {
        set({ phase: 'ready', session })
      } else {
        set({ phase: 'ready', session: null })
      }
    } else {

      const session = getOfflineSession()
      if (session && hasLocalMasterData()) {
        set({ phase: 'offline', session })
      } else {
        set({ phase: 'error', errors: result.errors, canRetry: true })
      }
    }
  }, [set])

  syncRef.current = runSync

  useEffect(() => {
    mountedRef.current = true
    if (!navigator.onLine) {

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
    try { localStorage.removeItem(k) } catch {}
  })
  try { localStorage.removeItem('trip.auth.session') } catch {}
  try { localStorage.removeItem('trip.auth.activeDermaga') } catch {}
}
