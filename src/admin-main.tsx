import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import AdminLoginPage from './pages/admin/AdminLoginPage'
import { AppProvider } from './pages/store'
import AdminDashboard from './pages/admin/AdminDashboard'
import { api } from './services/api'
import './index.css'

function AdminApp() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    // Check if already logged in as admin
    const storedAdmin = localStorage.getItem('trip.admin')
    const hasToken = !!api.token
    return !!(storedAdmin && hasToken)
  })

  const handleLogin = () => {
    setIsAuthenticated(true)
  }

  const handleLogout = () => {
    api.setToken(null)
    localStorage.removeItem('trip.admin')
    localStorage.removeItem('trip.auth.token.v2')
    setIsAuthenticated(false)
  }

  if (!isAuthenticated) {
    return <AdminLoginPage onLogin={handleLogin} />
  }

  return <AdminDashboard onLogout={handleLogout} />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppProvider>
      <AdminApp />
    </AppProvider>
  </React.StrictMode>,
)
