import { useEffect, lazy, Suspense, useState } from 'react'
import AdminDashboard from './pages/admin/AdminDashboard'
import { AppProvider, useApp } from './pages/store'
import { initializeSync } from './services/sync'

// Lazy load MobileApp agar tidak masuk bundle admin.
const MobileApp = lazy(() => import('./pages/mobile/MobileApp'))

// ── Build detection ────────────────────────────────────────────────────────────────

/** Admin build ditandai atribut `data-admin` di <html> (dibuat manual atau server). */
export function isAdminBuild(): boolean {
  try {
    return document.documentElement.hasAttribute('data-admin')
  } catch {
    return false
  }
}

/**
 * Guard utama: petugas non-admin membuka admin build.
 * Jika halaman admin di-refresh tanpa sesi yang valid → logout & tampilkan penolakan.
 */
function Shell() {
  const { userType, logout } = useApp()
  const [checked, setChecked] = useState(false)

  // Inisialisasi sinkronisasi data.
  useEffect(() => {
    initializeSync()
    setChecked(true)
  }, [])

  const isAdminBuild = isAdminBuild()
  const isAdmin = userType === 'admin'

  // ── Admin build tanpa sesi yang valid ──────────────────────────────────────
  if (isAdminBuild && !checked) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontSize: '14px', color: '#374151',
        textAlign: 'center', padding: '1rem', background: '#f9fafb'
      }}>
        <p>Memuat sesi…</p>
      </div>
    )
  }

  // ── Admin build: petugas non-admin ─────────────────────────────────────────
  if (isAdminBuild && !isAdmin) {
    logout()
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontSize: '14px', color: '#dc2626',
        textAlign: 'center', padding: '1rem', background: '#fef2f2'
      }}>
        <div>
          <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
            Akses Ditolak
          </p>
          <p>Anda bukan Administrator.</p>
          <p style={{ marginTop: '0.5rem', fontSize: '12px', color: '#6b7280' }}>
            Halaman ini hanya untuk akun Administrator. Hubungi administrator untuk akses.
          </p>
        </div>
      </div>
    )
  }

  // ── Admin build: admin yang valid ─────────────────────────────────────────
  if (isAdminBuild && isAdmin) {
    return <AdminDashboard onLogout={logout} />
  }

  // ── Mobile build: admin session di browser petugas ─────────────────────────
  if (isAdmin) {
    logout()
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', fontSize: '14px', color: '#92400e',
        textAlign: 'center', padding: '1rem', background: '#fffbeb'
      }}>
        <div>
          <p style={{ fontWeight: '600', marginBottom: '0.5rem' }}>
            Sesi Admin Aktif
          </p>
          <p style={{ color: '#6b7280' }}>
            Selesaikan logout admin di dashboard admin.
          </p>
        </div>
      </div>
    )
  }

  // ── Mobile build: petugas non-admin → MobileApp ──────────────────────────
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
