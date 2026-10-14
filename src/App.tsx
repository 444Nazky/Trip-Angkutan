import { useCallback, useEffect, useState } from 'react'
import AdminDashboard from './pages/admin/AdminDashboard'
import LoginPage from './pages/LoginPage'
import { AppProvider, AUTH_EVENT, useApp } from './pages/store'
import { ensureAdminSession } from './services/auth'

// ── Build detection ─────────────────────────────────────────────────────────

/** Admin build ditandai atribut `data-admin` di <html>. MobileApp di-stub saja karena admin bundle tidak butuh mobile screens. */
export function isAdminBuild(): boolean {
  try {
    return document.documentElement.hasAttribute('data-admin')
  } catch { return false }
}

/** Sinkronisasi LoginPage → Shell: bersihkan sesi tersimpan. */
export function clearSession() {
  try { localStorage.removeItem('trip.auth.admin.v1') } catch { /* noop */ }
}

// ── Shell: guard utama admin build. Hanya mengenali sesi administrator murni. ──
function Shell() {
  const [status, setStatus] = useState<'loading' | 'admin' | 'login'>('loading')
  const { logout } = useApp()

  const validate = useCallback(async () => {
    setStatus('loading')
    try {
      const s = await ensureAdminSession()
      setStatus(s.ok ? 'admin' : 'login')
    } catch {
      setStatus('login')
    }
  }, [])

  useEffect(() => { validate() }, [validate])

  // Setelah LoginPage menyimpan kredensial baru, validasi ulang.
  useEffect(() => {
    function onLogin() { validate() }
    window.addEventListener(AUTH_EVENT, onLogin)
    return () => window.removeEventListener(AUTH_EVENT, onLogin)
  }, [validate])

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontSize: '14px', color: '#374151' }}>
        <p>Memuat sesi…</p>
      </div>
    )
  }

  if (status === 'admin') {
    return <AdminDashboard onLogout={() => { logout(); setStatus('login') }} />
  }

  return <LoginPage onLogin={validate} />
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
