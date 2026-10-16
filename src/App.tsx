import { useCallback, useEffect, useState } from 'react'
import AdminDashboard from './pages/admin/AdminDashboard'
import LoginPage from './pages/LoginPage'
import { AUTH_EVENT, logout } from './services/auth'
import { ensureAdminSession } from './services/auth'



function Shell() {
  const [status, setStatus] = useState<'loading' | 'admin' | 'login'>('loading')

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
  return <Shell />
}
