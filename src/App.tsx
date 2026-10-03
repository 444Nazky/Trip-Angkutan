import { useEffect, lazy, Suspense } from 'react'
import AdminDashboard from './pages/admin/AdminDashboard'
import LoginPage from './pages/LoginPage'
import { AppProvider, useApp } from './pages/store'
import { initializeSync } from './services/sync'

// Lazy load MobileApp agar tidak masuk bundle admin.
const MobileApp = lazy(() => import('./pages/mobile/MobileApp'))

// Build admin (:8000) ditandai atribut data-admin di <html> (PHP/Netlify).
function isAdminHost() {
  try {
    return document.querySelector('[data-admin]') !== null
  } catch {
    return false
  }
}

// Guard: petugas membuka :8000 → logout & blok.
function isAdmin() {
  try {
    return document.querySelector('[data-admin]') !== null && localStorage.getItem('trip.userType') === 'admin'
  } catch {
    return false
  }
}

function Shell() {
  const { userType, logout } = useApp()
  useEffect(() => { initializeSync() }, [])

  // Admin host tanpa kuki → tampilkan login.
  // Petugas di :8000 → bersihkan kuki & tampilkan penolakan.
  const admin = isAdminHost()
  if (admin) {
    // Jika kuki admin absah → tolak.
    if (userType !== 'admin') {
      logout()
      return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontSize:"13px",color:"#dc2626",textAlign:"center",padding:"1rem" }}>
        Akses ditolak — hanya administrator yang dapat membuka dashboard admin.
      </div>
    }
    return <AdminDashboard onLogout={logout} />
  }

  // Non-admin host (mobile app) — petugas logged-in admin di browser biasa.
  if (userType === 'admin') {
    return <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontSize:"13px",color:"#92400e",textAlign:"center",padding:"1rem" }}>
      Sesi admin aktif. Selesai digunakan di peranti mobile.
    </div>
  }

  // Petugas BUKAN admin → Mobile app.
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
