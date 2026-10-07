import { useEffect, useState, useRef } from "react"
import { App as CapacitorApp } from "@capacitor/app"
import MobileApp from "./pages/mobile/MobileApp"
import LoginPage from "./pages/LoginPage"
import { AppProvider, useApp } from "./pages/store"
import { initializeSync } from "./services/sync"
import { syncOnResume } from "./services/adminPull"
import { initOfflineDb } from "./services/offlineDb"
import { getCurrentVersion, checkForUpdate, applyUpdate, registerOtaServiceWorker, restoreBundleFromStorage } from "./services/ota"
import type { UpdateState } from "./services/ota"

/**
 * Notifikasi update minimalis - hanya tampil saat update SIAP diterapkan.
 * Silent fail untuk semua error network, tidak mengganggu petugas lapangan.
 */
function UpdateBadge({
  state,
  onApply,
  onDismiss,
}: {
  state: UpdateState
  onApply?: () => void
  onDismiss?: () => void
}) {
  // Hanya tampil saat ada update siap install
  if (state.status !== "ready") return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full bg-slate-800 px-4 py-2 shadow-lg">
      <span className="text-sm font-medium text-white">
        Update {state.latestVersion}
      </span>
      <button
        onClick={onApply}
        className="rounded-full bg-blue-500 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-400"
      >
        Install
      </button>
      <button
        onClick={onDismiss}
        className="text-xs text-slate-400 hover:text-white"
      >
        Nanti
      </button>
    </div>
  )
}

function Shell() {
  const [ota, setOta] = useState<UpdateState>({ status: 'idle' })
  const { loggedIn, login, logout, userType } = useApp()
  const latestVersionRef = useRef<string | null>(null)

  useEffect(() => {
    initializeSync()
    void initOfflineDb()
    registerOtaServiceWorker()
    void restoreBundleFromStorage()
  }, [])

  // Cek update saat start (delay 5 detik untuk biarkan app load duluan)
  useEffect(() => {
    let cancelled = false
    getCurrentVersion().then(v => {
      if (cancelled || !v) return
      latestVersionRef.current = v
      window.setTimeout(() => { if (!cancelled) void checkForUpdate(v, setOta) }, 5000)
    })
    // Cek saat app aktif kembali
    let sub: { remove?: () => void } | undefined
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        const v = latestVersionRef.current
        if (v) void checkForUpdate(v, setOta)
        syncOnResume()
      }
    }).then(s => { sub = s })
    return () => {
      cancelled = true
      sub?.remove?.()
    }
  }, [])

  // Polling setiap 30 menit saat aktif
  useEffect(() => {
    const id = setInterval(() => {
      const v = latestVersionRef.current
      if (v) void checkForUpdate(v, setOta)
    }, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const apply = async () => { if (await applyUpdate()) window.location.reload() }
  const dismiss = () => setOta({ status: 'idle' })

  if (!loggedIn) return <LoginPage onLogin={() => login('member')} />
  if (userType === 'admin') { logout(); return <LoginPage onLogin={() => login('member')} /> }

  return (
    <div className="app-root bg-slate-50">
      <UpdateBadge state={ota} onApply={apply} onDismiss={dismiss} />
      <MobileApp />
    </div>
  )
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
