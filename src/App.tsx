import { useEffect } from 'react'
import MobileApp from './pages/mobile/MobileApp'
import LoginPage from './pages/LoginPage'
import { AppProvider, useApp } from './pages/store'
import { initializeSync } from './services/sync'

/**
 * Shell aplikasi mobile (branch main — siap export Capacitor/Android).
 *
 * Branch ini HANYA berisi aplikasi petugas. Dashboard admin tidak ada di
 * sini — login administrator dilakukan di build branch `admin`
 * (http://localhost:8000 / Netlify), bukan lewat aplikasi mobile.
 */
function Shell() {
  const { loggedIn, login, logout, userType } = useApp()
  useEffect(() => { initializeSync() }, [])

  // Belum masuk → form login petugas (member).
  if (!loggedIn) return <LoginPage onLogin={() => login('member')} />

  // Sisa sesi admin dari build hybrid lama di browser ini → tutup, agar
  // aplikasi mobile tidak pernah menampilkan rute/komponen admin.
  if (userType === 'admin') {
    logout()
    return <LoginPage onLogin={() => login('member')} />
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      <div className="flex items-center justify-center h-dvh w-full overflow-hidden p-0 sm:p-6">
        <MobileApp />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
