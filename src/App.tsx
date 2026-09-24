import { useEffect } from 'react'
import MobileApp from './pages/mobile/MobileApp'
import AdminDashboard from './pages/admin/AdminDashboard'
import LoginPage from './pages/LoginPage'
import { AppProvider, useApp } from './pages/store'
import { initializeSync } from './services/sync'

function Shell() {
  const { loggedIn, login, logout, userType } = useApp()
  useEffect(() => { initializeSync() }, [])
  if (!loggedIn) return <LoginPage onLogin={login} />
  return (
    <div className="min-h-screen bg-slate-100 font-sans">
      <div className="fixed top-4 right-4 z-50">
        <button onClick={logout} className="px-4 py-2 bg-white rounded-xl text-xs font-bold text-slate-500 shadow-md">
          Logout
        </button>
      </div>
      {userType === 'admin' ? (
        <AdminDashboard onLogout={logout} />
      ) : (
        <div className="flex items-start justify-center min-h-screen pt-16 pb-8">
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
