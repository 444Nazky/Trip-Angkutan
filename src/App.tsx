import { useEffect, lazy, Suspense } from 'react'
import AdminDashboard from './pages/admin/AdminDashboard'
import LoginPage from './pages/LoginPage'
import { AppProvider, useApp } from './pages/store'
import { initializeSync } from './services/sync'

// Lazy load MobileApp agar tidak masuk bundle admin Netlify. MobileApp hanya
// di-load saat serving mobile user (non-admin host & non-admin session).
const MobileApp = lazy(() => import('./pages/mobile/MobileApp'))

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

  // Satu form login untuk semua peran. Kredensial khusus admin
  // (admin/admin123 atau password hasil ganti) langsung diarahkan ke
  // dashboard admin yang utuh — di aplikasi yang sama, tanpa form login
  // terpisah dan tanpa redirect ke app lain.
  if (!isAdminHost() && !loggedIn) return <LoginPage onLogin={login} />

  // Host admin (:8000) atau sesi admin → dashboard (gerbang login internal
  // muncul otomatis hanya bila kredensial ditolak / password sudah diganti).
  if (isAdminHost() || (loggedIn && userType === 'admin')) {
    return <AdminDashboard onLogout={logout} />
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      <div className="flex items-center justify-center h-dvh w-full overflow-hidden p-0 sm:p-6">
        <Suspense fallback={null}>
          <MobileApp />
        </Suspense>
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
