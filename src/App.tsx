import { useEffect } from "react"
import { App as CapacitorApp } from "@capacitor/app"
import MobileApp from "./pages/mobile/MobileApp"
import LoginPage from "./pages/LoginPage"
import { AppProvider, useApp } from "./pages/store"
import { initializeSync } from "./services/sync"
import { syncOnResume } from "./services/adminPull"
import { initOfflineDb } from "./services/offlineDb"
import { restoreBundleFromStorage } from "./services/ota"
import { syncGeofencesFromBackend, GEOFENCE_AUTH_EXPIRED_EVENT } from "./services/geofence"
import UpdateNotifier from "./components/UpdateNotifier"

function Shell() {
  const { loggedIn, login, logout, userType } = useApp()

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

  // Foreground resume: cek OTA ditangani UpdateNotifier; di sini cukup sync data.
  useEffect(() => {
    let sub: { remove?: () => void } | undefined
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) syncOnResume()
    }).then(s => { sub = s })
    return () => { sub?.remove?.() }
  }, [])

  const isAdminSession = loggedIn && userType === 'admin'

  // Sesi admin tidak memakai shell mobile — dipulihkan di effect (dulu logout()
  // dipanggil saat render, padahal render boleh berjalan berkali-kali).
  useEffect(() => {
    if (isAdminSession) logout()
  }, [isAdminSession, logout])

  return (
    <div className="app-root bg-slate-50">
      {/* UpdateNotifier menangani semua state OTA: check, download, ready, error, offline.
          Sengaja dirender di LUAR gerbang login: sebelumnya komponen ini berada
          SETELAH `if (!loggedIn) return <LoginPage/>`, sehingga perangkat yang
          berhenti di layar login (mis. token kedaluwarsa) TIDAK PERNAH memeriksa
          versi baru — rilis baru jadi tidak terdeteksi sampai ada yang login. */}
      <UpdateNotifier
        autoCheck={true}
        initialDelay={5000}
        checkInterval={30 * 60 * 1000}
        position="bottom-right"
      />
      {loggedIn && !isAdminSession
        ? <MobileApp />
        : <LoginPage onLogin={() => login('member')} />}
    </div>
  )
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
