import { useEffect } from "react"
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
import { appUpdate } from "./services/appUpdate"

function Shell() {
  const { loggedIn, login, logout, userType } = useApp()

  // Check if this is admin mode (from URL query param ?admin=true)
  const isAdminMode = typeof window !== 'undefined' && window.location.search.includes('admin=true')

  // Auto-login as admin if in admin mode
  useEffect(() => {
    if (isAdminMode && !loggedIn) {
      login('admin')
    }
  }, [isAdminMode, loggedIn, login])

  useEffect(() => {
    if (!isAdminMode) {
      initializeSync()
      void initOfflineDb()
      void checkAndRequestLocationOnStartup()
      // ponytail: SATU prefetch (rute + geofence + tarif + akses dermaga),
      // bukan beberapa request terpisah. Prefetch punya TTL + single-flight
      // sehingga tidak mengulang request yang sama.
      void autoDetectApiBaseUrl()
        .then(() => prefetchAllCriticalData({ force: true }))
        .catch(() => prefetchAllCriticalData({ force: true }))
      // GPS watch: fix GPS selalu hangat -> layar "Pilih Rute" tidak nunggu
      // cold start GPS (detik-detik) setiap kali dibuka.
      startGpsWatch()
    }
  }, [isAdminMode])

  // Only use CapacitorApp if available (native mobile context)
  useEffect(() => {
    if (isAdminMode) return // Skip in admin mode

    // Dynamic import to avoid breaking admin dashboard
    import('@capacitor/app').then(({ App: CapacitorApp }) => {
      let sub: { remove?: () => void } | undefined
      CapacitorApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          syncOnResume()
          // Tarik master data (PIN/petugas/akses/rute/geofence/tarif) dari
          // dashboard admin begitu aplikasi aktif kembali.
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
      // Capacitor not available (web/admin context) - skip
      console.log('[App] Capacitor not available, skipping app state listener')
    })
  }, [isAdminMode])

  // In admin mode, always show AdminDashboard (skip login page)
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

  // Mobile officer mode - show login page
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

// Auto-login component for admin mode
function AdminAutoLogin({ onLogin }: { onLogin: () => void }) {
  useEffect(() => {
    const doAutoLogin = async () => {
      try {
        const baseUrl = api.baseUrl
        const res = await fetch(`${baseUrl}/auth/admin-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'admin', password: 'admin123456' })
        })
        const data = await res.json()
        if (res.ok && data.token) {
          api.setToken(data.token)
          localStorage.setItem('trip.admin', JSON.stringify(data.admin))
          onLogin()
        } else {
          console.error('Admin auto-login failed:', data.error)
        }
      } catch (err) {
        console.error('Admin auto-login failed:', err)
      }
    }
    doAutoLogin()
  }, [onLogin])

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <div className="text-center">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-slate-500 text-sm">Memuat Admin Dashboard...</p>
      </div>
    </div>
  )
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
