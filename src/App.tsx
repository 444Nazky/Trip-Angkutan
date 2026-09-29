import { useEffect } from 'react'
import MobileApp from './pages/mobile/MobileApp'
import AdminDashboard from './pages/admin/AdminDashboard'
import LoginPage from './pages/LoginPage'
import { AppProvider, useApp } from './pages/store'
import { initializeSync } from './services/sync'

/** Build admin (CodeIgniter di :8000) ditandai atribut data-admin di <html>. */
function isAdminHost() {
  try {
    return document.querySelector('[data-admin]') !== null
  } catch {
    return false
  }
}

function Shell() {
  const { loggedIn, login, logout, userType } = useApp()
  useEffect(() => { initializeSync() }, [])

  // Halaman login hanya untuk aplikasi mobile. Dashboard admin dibuka
  // langsung tanpa opsi "Login Administrator" (sesi backend diambil sendiri
  // oleh dashboard lewat /auth/admin-login).
  if (isAdminHost()) return <AdminDashboard onLogout={logout} />

  if (!loggedIn) return <LoginPage onLogin={() => login('member')} />

  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      {userType === 'admin' ? (
        <AdminDashboard onLogout={logout} />
      ) : (
        <div className="flex items-center justify-center h-dvh w-full overflow-hidden p-0 sm:p-6">
          <MobileApp />
        </div>
      )}
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
