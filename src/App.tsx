import { useCallback, useEffect, useState } from "react"
import MobileApp from "./pages/mobile/MobileApp"
import LoginPage from "./pages/LoginPage"
import AdminDashboard from "./pages/admin/AdminDashboard"
import { AppProvider, useApp } from "./pages/store"
import { initializeSync } from "./services/sync"
import { syncOnResume } from "./services/adminPull"
import { initOfflineDb } from "./services/offlineDb"
import { startGpsWatch, stopGpsWatch } from "./services/geofence"
import { prefetchAllCriticalData, startMasterDataAutoSync, stopMasterDataAutoSync } from "./services/prefetch"
import { checkAndRequestLocationOnStartup } from "./services/permission"
import { autoDetectApiBaseUrl, api } from "./services/api"
import { ensureAdminSession, setAdminCredentials } from "./services/auth"
import { appUpdate } from "./services/appUpdate"



function Shell() {
  const { loggedIn, login, logout, userType } = useApp()

  const isAdminMode = typeof window !== 'undefined' && window.location.search.includes('admin=true')

  useEffect(() => {
    if (!isAdminMode) {
      initializeSync()
      void initOfflineDb()
      void checkAndRequestLocationOnStartup()
      // ponytail: SATU prefetch (rute + geofence + tarif + akses dermaga), bukan beberapa request terpisah.
      void autoDetectApiBaseUrl()
        .then(() => prefetchAllCriticalData({ force: true }))
        .catch(() => prefetchAllCriticalData({ force: true }))
      startGpsWatch()
    }
  }, [isAdminMode])

  useEffect(() => {
    if (isAdminMode) return

    import('@capacitor/app').then(({ App: CapacitorApp }) => {
      let sub: { remove?: () => void } | undefined
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          syncOnResume()
          void prefetchAllCriticalData({ force: true })
          startMasterDataAutoSync()
          void appUpdate.syncInstalledVersion()
          startGpsWatch()
        } else {
          stopGpsWatch()
          stopMasterDataAutoSync()
        }
      }).then(s => { sub = s })
      return () => { sub?.remove?.() }
    }).catch(() => {
      console.log('[App] Capacitor not available, skipping app state listener')
    })
  }, [isAdminMode])

  if (isAdminMode) {
    return (
      <div className="app-root bg-slate-50">
        {loggedIn && userType === 'admin' ? (
          <AdminDashboard onLogout={() => {
            api.setToken(null)
            localStorage.removeItem('trip.admin')
            logout()
          }} />
        ) : (
          <AdminAutoLogin onLogin={() => login('admin')} />
        )}
      </div>
    )
  }

  return (
    <div className="app-root bg-slate-50">
      {!loggedIn ? (
        <LoginPage onLogin={() => login('member')} />
      ) : (
        <MobileApp />
      )}
    </div>
  )
}

// Auto-login component for admin mode. PENTING: dashboard admin HANYA boleh dirender setelah token admin benar-benar ada.
function AdminAutoLogin({ onLogin }: { onLogin: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [showForm, setShowForm] = useState(false)

  const attempt = useCallback(async (cred?: { username: string; password: string }) => {
    setBusy(true)
    setError(null)
    try {
      if (cred) setAdminCredentials(cred)
      const sess = await ensureAdminSession()
      if (sess.ok) {
        onLogin()
        return
      }
      setError(sess.error ?? 'Login admin gagal')
      setShowForm(true)
    } finally {
      setBusy(false)
    }
  }, [onLogin])

  useEffect(() => {
    void attempt()
  }, [attempt])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-sm border border-slate-200">
        {!showForm ? (
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-3"></div>
            <p className="text-slate-500 text-sm">Memuat Admin Dashboard...</p>
            {error && <p className="text-red-600 text-[12px] mt-2">{error}</p>}
          </div>
        ) : (
          <form
            onSubmit={e => {
              e.preventDefault()
              void attempt({ username, password })
            }}
            className="space-y-3"
          >
            <h2 className="text-base font-black text-slate-900">Masuk sebagai Admin</h2>
            <p className="text-[12px] text-red-600">{error ?? 'Kredensial admin ditolak server.'}</p>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="Username"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
            />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !username || !password}
              className="w-full rounded-xl bg-blue-600 text-white py-2.5 text-sm font-bold disabled:opacity-50"
            >
              {busy ? 'Memeriksa...' : 'Masuk'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}



export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
