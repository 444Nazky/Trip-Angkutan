import { useState, useEffect } from 'react'
import { Eye, EyeOff, Settings } from 'lucide-react'
import { api } from '../services/api'
import {
  loginOffline,
  memberLogin,
  SESSION_READY_EVENT,
  verifyPinOffline,
} from '../services/auth'
import { initializeSync } from '../services/sync'
import { getStoredOfficers, syncOfficersToLocal } from '../services/officers'
import ServerSettingsModal from '../components/ServerSettingsModal'




interface LoginPageProps {
  onLogin: (userType: 'member' | 'admin') => void
}




export async function tryOfflineLogin(u: string, p: string): Promise<boolean> {
  if (!u || !p) return false

  try {
    const res = await loginOffline(u, p)
    if (res.success) {
      window.dispatchEvent(new Event(SESSION_READY_EVENT))
      return true
    }
  } catch {
    /* database offline belum siap — lanjut ke roster */
  }

  try {
    const officers = getStoredOfficers()
    const match = officers.find(o => String(o.id) === u || o.name === u || o.username === u)
    if (match && (await verifyPinOffline(String(match.id), p))) {
      api.setToken(null)
      localStorage.setItem('trip.auth.officer.v1', JSON.stringify({
        id: String(match.id),
        name: match.name,
        regionId: match.region,
        regionName: match.region,
        regionCode: match.region,
        offlineMode: true,
      }))
      window.dispatchEvent(new Event(SESSION_READY_EVENT))
      return true
    }
  } catch { /* no-op */ }
  return false
}




export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showPw, setShowPw] = useState(false)
  const [showServer, setShowServer] = useState(false)

  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off  = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('ID petugas & PIN harus diisi.')
      return
    }
    if (loading) return
    setLoading(true)
    setError(null)
    const u = username.trim()
    const p = password
    try {
      // ponytail: online-first — 401 server = kredensial salah, jangan ditutupi login offline.
      // Offline hanya fallback saat jaringan mati, bukan saat kredensial ditolak.
      if (navigator.onLine) {
        const result = await memberLogin(u, p)
        if (result.success) {
          void initializeSync()
          void syncOfficersToLocal(true).catch(() => undefined)
          window.dispatchEvent(new Event(SESSION_READY_EVENT))
          onLogin('member')
          return
        }
        const msg = result.error || ''
        if (/timeout|network|failed|fetch|terjangkau|merespon|unreachable/i.test(msg)) {
          if (await tryOfflineLogin(u, p)) {
            void initializeSync()
            onLogin('member')
            void syncOfficersToLocal(true).catch(() => undefined)
            return
          }
          setError('Server tidak terjangkau dan PIN lokal tidak cocok. Masuk online lalu sinkronkan data petugas.')
        } else {
          // ponytail: tampilkan pesan spesifik backend (tidak terdaftar/nonaktif/PIN salah)
          // supaya admin tahu apa yang harus dicocokkan di dashboard.
          setError(/tidak terdaftar|nonaktif|PIN salah/i.test(msg) ? msg : 'Username atau password salah.')
        }
        return
      }

      if (await tryOfflineLogin(u, p)) {
        void initializeSync()
        onLogin('member')
        return
      }

      setError('Akun atau PIN tidak tersedia di perangkat ini. Masuk online lalu sinkronkan data petugas.')
      return
    } catch {
      setError('Verifikasi gagal. Silakan coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleLogin()
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">

      {/* ── Minimalist Header ── */}
      <div className="px-6 pt-16 pb-8">
        <div className="flex items-center gap-4">
          <img src="./assets/karyamas_clean.png" alt="Logo" className="w-14 h-14 object-contain" />
          <div className="flex-1">
            <h1 className="text-lg font-semibold text-slate-800">Trip Angkutan</h1>
            <p className="text-xs text-slate-400">Kalimantan Barat</p>
          </div>
          <button
            type="button"
            onClick={() => setShowServer(true)}
            aria-label="Pengaturan Server"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 hover:bg-white transition-colors"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* ── Status & Form ── */}
      <div className="flex-1 px-6">
        {/* Online Status */}
        <div className="flex items-center gap-2 mb-8">
          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-xs text-slate-400">{isOnline ? 'Online' : 'Offline Mode'}</span>
        </div>

        {/* Welcome Text */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-slate-800">Masuk</h2>
          <p className="text-sm text-slate-400 mt-1">Gunakan ID Petugas dan PIN Anda</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Username */}
          <div>
            <input
              type="text"
              value={username}
              onChange={e => { setError(null); setUsername(e.target.value) }}
              onKeyDown={onKey}
              placeholder="ID Petugas"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-[#1B3D6D] focus:ring-0 transition-colors"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="one-time-code"
              maxLength={6}
              value={password}
              onChange={e => { setError(null); setPassword(e.target.value.replace(/\D/g, '')) }}
              onKeyDown={onKey}
              placeholder="PIN"
              className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-[#1B3D6D] focus:ring-0 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 bg-red-50 rounded-xl">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={() => void handleLogin()}
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-medium text-sm text-white bg-[#1B3D6D] hover:bg-[#0f2847] disabled:opacity-50 transition-colors mt-2"
          >
            {loading ? 'Memproses…' : 'Masuk'}
          </button>
        </div>

        {/* Offline hint */}
        {!isOnline && (
          <p className="text-xs text-center text-slate-400 mt-6">
            Gunakan ID & PIN yang pernah login di perangkat ini
          </p>
        )}
      </div>

      {/* ── Footer ── */}
      <p className="text-center text-[11px] text-slate-300 pb-8">
        Trip Angkutan Kalimantan Barat
      </p>

      {showServer && <ServerSettingsModal onClose={() => setShowServer(false)} />}
    </div>
  )
}
