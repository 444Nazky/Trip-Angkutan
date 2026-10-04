/**
 * Admin-only context (no offline-sync). Admin build uses this for session guard and logout.
 */
import React, {
  createContext, useCallback, useContext, useMemo, useState,
} from 'react'

const ADMIN_KEY = 'trip.auth.admin.v1'

function loadStored(): { token: string; username: string } | null {
  try {
    const raw = localStorage.getItem(ADMIN_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as { token: string; username: string }
    if (!s?.token) return null
    return s
  } catch { return null }
}

const defaultCtx = { userType: 'guest' as const, token: '' }
const AppContext = createContext(defaultCtx)

function noop() { /* admin build stubs */ }

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [sess, setSess] = useState(loadStored)
  const userType = sess ? 'admin' : 'guest'
  const token = sess?.token ?? ''

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_KEY)
    setSess(null)
  }, [])

  const ctx = useMemo(
    () => ({ userType, token, logout }),
    [userType, token]
  )

  return <AppContext.Provider value={ctx}>{children}</AppContext.Provider>
}

export function useApp() {
  return useContext(AppContext)
}
