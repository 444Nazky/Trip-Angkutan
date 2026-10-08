// ─── OfflineShell ──────────────────────────────────────────────────────
// Wraps the app to handle online/offline initialization seamlessly.
// Shows sync screen → login screen → app content.

import { type ReactNode, useState } from 'react'
import InitScreen from './InitScreen'
import OfflineLoginPage from './OfflineLoginPage'
import {
  getOfflineSession,
  updateSession,
  clearSession,
  type OfflineSession,
} from '../services/offline-auth'
import { performInitialSync, isOnline, STORAGE_KEYS } from '../services/offline-init'

export type OfflineShellPhase =
  | 'init'      // sync screen
  | 'login'     // credentials/PIN login
  | 'active'    // app running
  | 'no-data'   // offline + no cached data
  | 'error'     // sync failed

interface OfflineShellProps {
  children: (session: OfflineSession) => ReactNode
}

export default function OfflineShell({ children }: OfflineShellProps) {
  const existing = getOfflineSession()
  const [phase, setPhase] = useState<OfflineShellPhase>(
    existing ? 'active' : 'init',
  )
  const [syncErrors, setSyncErrors] = useState<string[]>([])

  function handleLogin(session: OfflineSession) {
    try {
      localStorage.setItem('trip.auth.session', JSON.stringify(session))
    } catch { /* quota */ }
    setPhase('active')
  }

  function handleLogout() {
    clearSession()
    setPhase('login')
  }

  if (phase === 'init') {
    return (
      <InitScreen
        onReady={() => {
          const session = getOfflineSession()
          setPhase(session ? 'active' : 'login')
        }}
        onOffline={() => {
          const session = getOfflineSession()
          if (session) setPhase('active')
          else setPhase('no-data')
        }}
      />
    )
  }

  if (phase === 'login') {
    return (
      <OfflineLoginPage
        onLogin={handleLogin}
        onBack={() => setPhase('init')}
      />
    )
  }

  if (phase === 'no-data') {
    return (
      <div className="flex items-center justify-center h-dvh bg-zinc-50 font-sans p-6 text-center">
        <div>
          <p className="text-sm text-zinc-500 mb-1">Tidak ada data tersimpan.</p>
          <p className="text-xs text-zinc-400 mb-6">
            Sambungkan ke internet untuk menginisialisasi data.
          </p>
          <button
            onClick={() => setPhase('init')}
            className="px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 text-white rounded-xl text-sm font-medium"
          >
            Coba Sinkronisasi Ulang
          </button>
        </div>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="flex items-center justify-center h-dvh bg-zinc-50 font-sans p-6 text-center">
        <div className="text-sm text-red-600">
          <p className="mb-1 font-medium">Sinkronisasi gagal</p>
          <p className="text-xs text-zinc-500 mb-4">{syncErrors[0]}</p>
          <button
            onClick={() => setPhase('init')}
            className="px-5 py-2.5 bg-zinc-900 text-white rounded-xl text-sm"
          >
            Coba lagi
          </button>
        </div>
      </div>
    )
  }

  // active
  return <>{children(getOfflineSession()!)}</>
}

// ── Re-export for convenience ──────────────────────────────────────────
export { clearSession as logoutOffline }
