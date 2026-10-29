import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminDashboard from './pages/admin/AdminDashboard'
import { api } from './services/api'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'



const root = document.getElementById('root')!



if (document.documentElement.dataset['admin'] !== undefined) {
  const adminLogout = () => {
    api.setToken(null)
    try { localStorage.removeItem('trip.admin') } catch {  }
    location.reload()
  }
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary label="Admin Dashboard">
        <AdminDashboard onLogout={adminLogout} />
      </ErrorBoundary>
    </React.StrictMode>,
  )
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary label="Aplikasi">
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
