import { useEffect, lazy, Suspense, useState } from 'react'
import AdminDashboard from './pages/admin/AdminDashboard'
import { AppProvider, useApp } from './pages/store'
import { initializeSync } from './services/sync'

// Lazy load MobileApp agar tidak masuk bundle admin (:8000).
const MobileApp = lazy(() => import('./pages/mobile/MobileApp'))

// Build admin (:8000) ditandai atribut data-admin di <html> (PHP/Netlify).
export function isAdminBuild(): boolean {
  try {
    return document.querySelector('[data-admin]') null
  } catch {
    return false
  }
}

/**
 * Guard utama: petugas BUKAN admin membuka admin build.
 * Jika petugas non-admin membuka :8000, otomatis logout & tampilkan penolakan.
 */
function Shell() {
  const { userType, logout } = useApp()
  const [checked, setChecked] = useState(false)

  // Lazy-load initialization saja.
  useEffect(() => {
    initializeSync()
    setChecked(true)
  }, [])

  const isAdmin = isAdminBuild()
  const isUserAdmin = userType === 'admin'

  // Admin build tanpa kuki → tolak akses.
  if (isAdmin && checked && !isUserAdmin) {
    logout()
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontSize: '13px', color: '#dc2626',
        textAlign: 'center', padding: '1rem', background: '#fef2f2'
      }}>
        <div>
          <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
            Akses ditolak
          </p>
          <p>Sesi tidak valid atau Anda bukan Administrator.</p>
          <p style={{ marginTop: '0.5rem', fontSize: '12px', color: '#666' }}>
            Hubungi administrator untuk akses.
          </p>
        </div>
      </div>
    )
  }

  // Petugas non-admin membuka :8000 → logout & blokir.
  if (isAdmin && !isUserAdmin) {
    logout()
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontSize: '13px', color: '#dc2626',
        textAlign: 'center', padding: '1rem'
      }}>
        <div>
          <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
            Akses ditolak — hanya administrator yang dapat membuka dashboard admin.
          </p>
          <p style={{ marginTop: '0.5rem', color: '#666' }}>
            Hubungi administrator jika ini kesalahan.
          </p>
        </div>
      </div>
    )
  }

  // Admin build → AdminDashboard.
  if (isAdmin && isUserAdmin) {
    return <AdminDashboard onLogout={logout} />
  }

  // Mobile app — admin session di browser petugas → logout & blokir.
  if (isUserAdmin) {
    logout()
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontSize: '13px', color: '#92400e',
        textAlign: 'center', padding: '1rem', background: '#fffbeb'
      }}>
        <div>
          <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
            Sesi admin aktif di browser petugas.
          </p>
          <p style={{ marginTop: '0.5rem', color: '#666' }}>
            Selesaikan di peranti mobile.
          </p>
        </div>
      </div>
    )
  }

  // Petugas BUKAN admin → Mobile app (lazy-loaded).
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
