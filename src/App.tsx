import { useEffect, useState, useCallback, useRef } from "react"
import { AppState } from "@capacitor/app"
import MobileApp from "./pages/mobile/MobileApp"
import LoginPage from "./pages/LoginPage"
import { AppProvider, useApp } from "./pages/store"
import { initializeSync } from "./services/sync"
import { getCurrentVersion, checkForUpdate, applyUpdate, setCurrentVersion } from "./services/ota"
import type { UpdateState } from "./services/ota"

function UpdateHUD({
  state,
  onApply,
  onDismiss,
}: {
  state: UpdateState
  onApply?: () => void
  onDismiss?: () => void
}) {
  if (state.status === "idle") return null
  const p = state.progress ?? 0
  const label: string | null =
    state.status === "checking"
      ? "Memeriksa update…"
      : state.status === "downloading"
        ? `Mengunduh ${state.latestVersion ?? "bundle baru"}`
        : state.status === "ready"
          ? `Update ${state.latestVersion ?? "siap"}`
          : state.status === "offline"
            ? "Offline — versi tersimpan"
            : state.status === "error"
              ? `Gagal: ${state.error}`
              : null
  if (!label) return null
  const isReady = state.status === "ready"
  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex flex-col gap-2 rounded-xl px-3 py-2.5 text-xs shadow-2xl ${
        isReady ? "bg-slate-800 text-white" : "bg-slate-800/80 text-sky-200"
      }`}
    >
      <span className="font-semibold leading-tight">{label}</span>
      {state.status === "downloading" && (
        <div className="h-1 overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-blue-400 transition-all duration-200" style={{ width: `${p}%` }} />
        </div>
      )}
      {isReady ? (
        <div className="flex items-center gap-2">
          <button
            onClick={onApply}
            className="rounded bg-blue-600 px-2 py-1 text-xs font-semibold hover:bg-blue-500 active:bg-blue-700"
          >
            Terapkan &amp; mulai ulang
          </button>
          <button
            onClick={onDismiss}
            className="text-slate-400 text-[10px] underline underline-offset-2"
          >
            Nanti
          </button>
        </div>
      ) : (
        <button
          onClick={onDismiss}
          className="text-center text-[10px] text-slate-400 underline underline-offset-2"
        >
          Tutup
        </button>
      )}
    </div>
  )
}

function Shell() {
  const [ota, setOta] = useState<UpdateState>({ status: 'idle' })
  const { loggedIn, login, logout, userType } = useApp()
  const latestVersionRef = useRef<string | null>(null)

  useEffect(() => { initializeSync() }, [])

  // Ambil versi tersimpan dan polling saat app aktif dari background
  useEffect(() => {
    getCurrentVersion().then(v => { latestVersionRef.current = v })
    let sub: { remove?: () => void } | undefined
    AppState.addListener('change', (s) => {
      if (s === 'active') {
        const v = latestVersionRef.current
        if (v) checkForUpdate(v, setOta)
      }
    }).then(s => { sub = s })
    return () => sub?.remove?.()
  }, [])

  // Polling berkala (30 menit) saat app di foreground
  useEffect(() => {
    const id = setInterval(() => {
      const v = latestVersionRef.current
      if (v) checkForUpdate(v, setOta)
    }, 30 * 60 * 1000)
    return () => clearInterval(id)
  }, [])

  const apply = () => { if (applyUpdate()) window.location.reload() }
  const dismiss = () => setOta({ status: 'idle' })

  if (!loggedIn) return <LoginPage onLogin={() => login('member')} />
  if (userType === 'admin') { logout(); return <LoginPage onLogin={() => login('member')} />

  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      <UpdateHUD state={ota} onApply={apply} onDismiss={dismiss} />
      <MobileApp />
    </div>
  )
}
}

export default function App() {
  return <AppProvider><Shell /></AppProvider>
}
</parameter>
