import { useEffect, useRef } from "react"
import { App as CapacitorApp } from "@capacitor/app"
import MobileApp from "./pages/mobile/MobileApp"
import LoginPage from "./pages/LoginPage"
import { AppProvider, useApp } from "./pages/store"
import { initializeSync } from "./services/sync"
import { syncOnResume } from "./services/adminPull"
import { initOfflineDb } from "./services/offlineDb"
import { getCurrentVersion, restoreBundleFromStorage } from "./services/ota"
import { syncGeofencesFromBackend, GEOFENCE_AUTH_EXPIRED_EVENT } from "./services/geofence"
import UpdateNotifier from "./components/UpdateNotifier"

function Shell() {
  const { loggedIn, login, logout, userType } = useApp()
  const latestVersionRef = useRef<string | null>(null)

  useEffect(() => {
    initializeSync()
    void initOfflineDb()
    void restoreBundleFromStorage()
    void syncGeofencesFromBackend()
  }, [])

  // Token kedaluwarsa/invalid (server balas 401) → kembalikan ke layar login
  // (LoginPage menanganinya via PinVerifyScreen) agar petugas bisa memulihkan
  // sesi sendiri — bukan diam-diam "stuck" dengan banner "belum terkirim".
  useEffect(() => {
    const onAuthExpired = () => {
      console.warn('[App] Sesi backend invalid (401) → kembali ke layar login')
      logout()
    }
    window.addEventListener(GEOFENCE_AUTH_EXPIRED_EVENT, onAuthExpired)
    return () => window.removeEventListener(GEOFENCE_AUTH_EXPIRED_EVENT, onAuthExpired)
  }, [logout])

  // Initialize version reference untuk UpdateNotifier
  useEffect(() => {
    getCurrentVersion().then(v => {
      if (v) latestVersionRef.current = v
    })

    // Listen untuk foreground resume - UpdateNotifier akan handle auto-check
    let sub: { remove?: () => void } | undefined
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) syncOnResume()
    }).then(s => { sub = s })
    return () => { sub?.remove?.() }
  }, [])

  if (!loggedIn) return <LoginPage onLogin={() => login('member')} />
  if (userType === 'admin') { logout(); return <LoginPage onLogin={() => login('member')} /> }

  return (
    <div className="app-root bg-slate-50">
      {/* UpdateNotifier menangani semua state OTA: check, download, ready, error, offline */}
      <UpdateNotifier
        autoCheck={true}
        initialDelay={5000}
        checkInterval={30 * 60 * 1000}
        position="bottom-right"
        onUpdateApplied={(v) => console.log('[App] Update applied:', v)}
      />
      <MobileApp />
    </div>
  )
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
