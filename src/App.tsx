import { useEffect } from "react"
import { App as CapacitorApp } from "@capacitor/app"
import MobileApp from "./pages/mobile/MobileApp"
import LoginPage from "./pages/LoginPage"
import { AppProvider, useApp } from "./pages/store"
import { initializeSync } from "./services/sync"
import { syncOnResume } from "./services/adminPull"
import { initOfflineDb } from "./services/offlineDb"
import { syncGeofencesFromBackend } from "./services/geofence"
import { checkAndRequestLocationOnStartup } from "./services/permission"
import { autoDetectApiBaseUrl } from "./services/api"
import UpdateNotifier from "./components/UpdateNotifier"
import { appUpdate } from "./services/appUpdate"

function Shell() {
  const { loggedIn, login, logout, userType } = useApp()

  useEffect(() => {
    initializeSync()
    void initOfflineDb()
    void checkAndRequestLocationOnStartup()
    // Endpoint bawaan (build rilis = Railway) belum tentu yang terjangkau dari
    // jaringan petugas. Cari kandidat yang benar-benar menjawab, baru tarik data —
    // dulu satu-satunya default adalah Railway sehingga server uji/LAN tak terpakai.
    void autoDetectApiBaseUrl()
      // ponytail: start/resume = force — fetch murah, edit admin langsung sampai
      .then(base => { if (base) void syncGeofencesFromBackend({ force: true }) })
      .catch(() => { void syncGeofencesFromBackend({ force: true }) })
  }, [])

  // ponytail: tidak ada tendangan ke login saat 401 — sesi dibuat tidak
  // expired; sync gagal = pakai cache lokal dan coba lagi berikutnya.

  useEffect(() => {
    let sub: { remove?: () => void } | undefined
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        syncOnResume()
        // ponytail: resume = force (lihat catatan di atas), bukan background
        void syncGeofencesFromBackend({ force: true })
        // Setelah pengguna menyetujui pemasangan APK, aplikasi hidup kembali di sini:
        // versi native dibaca ulang supaya status "sudah ter-update" hanya muncul
        // kalau APK-nya benar-benar terpasang.
        void appUpdate.syncInstalledVersion()
      }
    }).then(s => { sub = s })
    return () => { sub?.remove?.() }
  }, [])

  const isAdminSession = loggedIn && userType === 'admin'

  useEffect(() => {
    if (isAdminSession) logout()
  }, [isAdminSession, logout])

  return (
    <div className="app-root bg-slate-50">
      <UpdateNotifier
        autoCheck={true}
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
