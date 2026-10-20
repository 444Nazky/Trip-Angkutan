import { useEffect } from "react"
import { App as CapacitorApp } from "@capacitor/app"
import MobileApp from "./pages/mobile/MobileApp"
import LoginPage from "./pages/LoginPage"
import AdminDashboard from "./pages/admin/AdminDashboard"
import { AppProvider, useApp } from "./pages/store"
import { initializeSync } from "./services/sync"
import { startConnectivitySync, syncOnResume } from "./services/adminPull"
import { initOfflineDb } from "./services/offlineDb"
import { checkAndRequestLocationOnStartup } from "./services/permission"
import { api } from "./services/api"
import { isLocalhostDev } from "./services/ota"

// Completely disable automatic update checks - updates are MANUAL ONLY via Profile screen
const AUTO_UPDATE_DISABLED = isLocalhostDev()

function Shell() {
  const { loggedIn, login, logout, userType } = useApp()

  useEffect(() => {
    initializeSync()
    void initOfflineDb()
    startConnectivitySync()
    void checkAndRequestLocationOnStartup()

    // Debug: log status token saat startup
    console.debug('[App] Startup - token:', {
      hasToken: api.isAuthenticated,
      tokenLength: api.token?.length ?? 0,
      baseUrl: api.baseUrl,
      autoUpdateDisabled: AUTO_UPDATE_DISABLED,
    })

    // NO automatic geofence sync on startup - user triggers manually from Profile
    // NO automatic version checks
    // NO automatic sync on resume either

    // Log startup info - URL sudah DIKUNCI ke Supabase Production di api.ts
    console.debug('[App] Startup - URL Production:', api.baseUrl)
  }, [])

  // Resume sync on app state change (foreground/background)
  useEffect(() => {
    let sub: { remove?: () => void } | undefined
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) syncOnResume()
      // NO automatic geofence sync on resume, NO automatic version checks
    }).then(s => { sub = s })
    return () => { sub?.remove?.() }
  }, [])

  const handleLogout = () => {
    logout()
  }

  // NO UpdateNotifier at all - updates are manual only via Profile screen
  return (
    <div className="app-root bg-slate-50">
      {!loggedIn ? (
        <LoginPage onLogin={login} />
      ) : userType === 'admin' ? (
        <AdminDashboard onLogout={handleLogout} />
      ) : (
        <MobileApp />
      )}
    </div>
  )
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
