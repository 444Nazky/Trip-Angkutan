import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminDashboard from './pages/admin/AdminDashboard'
import { api } from './services/api'
import './index.css'

const root = document.getElementById('root')!

if (document.documentElement.dataset['admin'] !== undefined) {
  const adminLogout = () => {
    api.setToken(null)
    try { localStorage.removeItem('trip.admin') } catch { /* quota */ }
    location.reload()
  }
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <AdminDashboard onLogout={adminLogout} />
    </React.StrictMode>,
  )
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}