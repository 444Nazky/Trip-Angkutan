import { useEffect } from 'react'
import MobileApp from './pages/mobile/MobileApp'
import AdminDashboard from './pages/admin/AdminDashboard'
import LoginPage from './pages/LoginPage'
import AdminLoginPage from './pages/admin/LoginPage'
import { AppProvider, useApp } from './pages/store'
import { initializeSync } from './services/sync'

export default function App() {
  const { loggedIn, login, logout, userType } = useApp()
  useEffect(() => { initializeSync() }, [])

  // Cek session admin langsung (sessionStorage, tidak terikat Ionic user).
  let adminSession = false
  try { adminSession = sessionStorage.getItem('trip.admin.session') === '1' } catch (_) {}

  if (adminSession) {
    return (
      <AdminDashboard
        onLogout={() => { try { sessionStorage.removeItem('trip.admin.session') } catch (_) {} ; logout() }}
      />
    )
  }

  // ?admin=login → halaman login terpisah.
  const params = new URLSearchParams(window.location.search)
  if (params.get('admin') === 'login') {
    return (
      <AdminLoginPage
        onLogin={() => { try { sessionStorage.setItem('trip.admin.session', '1') } catch (_) {} ; login('admin') }}
      />
    )
  }

  if (!loggedIn) {
    return <LoginPage onLogin={() => login('member')} />
  }

  return (
    <div className="min-h-screen bg-slate-100 font-sans flex flex-col min-h-dvh">
      {userType === 'admin'
        ? <AdminDashboard onLogout={logout} />
        : <div className="flex-1 flex"><MobileApp /></div>
      }
    </div>
  )
}
