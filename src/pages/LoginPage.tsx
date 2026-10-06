import { useState, useEffect } from 'react'
import { ArrowRight, AlertCircle, Wifi, WifiOff, Eye, EyeOff } from 'lucide-react'
import { memberLogin, verifyPinOffline } from '../services/auth'
import { initializeSync } from '../services/sync'
import { getStoredOfficers } from '../services/officers'

interface LoginPageProps {
  onLogin: (userType: 'member' | 'admin') => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showPw, setShowPw] = useState(false)

  // ── Listener online/offline ────────────────────────────────────────
  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off  = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Username & password harus diisi.')
      return
    }
    setLoading(true)
    setError(null)
    if (!navigator.onLine) {
      void (async () => {
        const ok = await tryOfflineLogin(username.trim(), password)
        if (ok) return
        setError('Akun tidak ditemukan di perangkat ini. Hubungkan internet untuk login pertama kali.')
        setLoading(false)
      })()
      return
    }
    try {
      const result = await memberLogin(username.trim(), password)
      if (result.success) {
        void initializeSync()
        onLogin('member')
        return
      }
      const msg = result.error || ''
      if (/timeout|network|failed|fetch|terjangkau|merespon/i.test(msg)) {
        // Jaringan bermasalah — verifikasi lokal dulu sebelum menyerah
        const ok = await tryOfflineLogin(username.trim(), password)
        if (ok) return
        setError('Server tidak terjangkau — cek jaringan.')
      } else if (/unauthorized|401|invalid/i.test(msg)) {
        setError('Username atau password salah.')
      } else {
        setError(msg || 'Login gagal.')
      }
    } catch {
      setError('Terjadi kesalahan sistem.')
    } finally {
      setLoading(false)
    }
  }

  // ── Offline login ────────────────────────────────────────────────
  // Cocokkan kredensial dengan hash tersimpan di database lokal — tanpa
  // request jaringan sehingga tidak memicu error saat server mati.
  async function tryOfflineLogin(u: string, p: string): Promise<boolean> {
    if (!u || !p) return false

    let verified = false
    try {
      verified = await verifyPinOffline(u, p)
    } catch {
      verified = false
    }
    if (verified) {
      onLogin('member')
      return true
    }

    // Cadangan lama: daftar petugas hasil prefetch + PIN tersimpan
    try {
      const officers = getStoredOfficers()
      const match = officers.find(o => o.id === u || o.name === u || o.username === u)
      if (match && 'pin' in match && match.pin && match.pin === p) {
        localStorage.setItem('trip.auth.officer.v1', JSON.stringify({ ...match, offlineMode: true }))
        onLogin('member')
        return true
      }
    } catch { /* no-op */ }
    return false
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleLogin()
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      {/* ── Header ── */}
      <div className="bg-gradient-to-br from-blue-700 via-blue-600 to-blue-500 px-6 pt-16 pb-12">
        <div className="flex flex-col items-center gap-3">
          {/* Logo */}
          <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-lg">
            <img
              src="Assets/karyamas_clean.svg"
              alt="Logo"
              width={52}
              height={52}
              className="object-contain"
              onError={e => {
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
          <h1 className="text-lg font-bold text-white tracking-tight">Trip Angkutan</h1>
          {/* Online/Offline badge */}
          <div className={`flex items-center gap-1.5 text-[10px] font-bold px-3 py-1 rounded-full ${isOnline ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-400/30' : 'bg-amber-500/20 text-amber-200 ring-1 ring-amber-400/30'}`}>
            {isOnline ? <Wifi size={10} /> : <WifiOff size={10} />}
            {isOnline ? 'Online' : 'Offline'}
          </div>
        </div>
      </div>

      {/* ── Form Card ── */}
      <div className="flex-1 mx-4 -mt-4 bg-white rounded-t-3xl shadow-xl px-6 pt-10 pb-8 space-y-6">
        {/* Judul */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Masuk</h2>
          <p className="text-sm text-slate-400 mt-1">Masuk ke akun Anda</p>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          {/* Username */}
          <div>
            <label className="text-sm font-medium text-slate-600">ID Petugas</label>
            <input
              type="text"
              value={username}
              onChange={e => { setError(null); setUsername(e.target.value) }}
              onKeyDown={onKey}
              placeholder="cth: p001"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full mt-2 px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-300 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
            />
          </div>

          {/* Password */}
          <div>
            <label className="text-sm font-medium text-slate-600">Kata Sandi</label>
            <div className="relative mt-2">
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => { setError(null); setPassword(e.target.value) }}
                onKeyDown={onKey}
                placeholder="PIN atau password"
                className="w-full px-4 py-3.5 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-300 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition"
              />
              <button
                type="button"
                onClick={() => setShowPw(v => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          {/* Lupa Password */}
          <div className="flex justify-end">
            <button type="button" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
              Lupa Password?
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={() => void handleLogin()}
            disabled={loading}
            className="w-full py-4 rounded-xl font-bold text-base text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Memproses…
              </span>
            ) : (
              <span className="flex items-center justify-center gap-2">
                Masuk
                <ArrowRight size={18} />
              </span>
            )}
          </button>
        </div>

        {/* Petunjuk offline */}
        {!isOnline && (
          <p className="text-sm text-center text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            Mode offline — Anda bisa masuk memakai ID & PIN yang pernah digunakan di perangkat ini.
          </p>
        )}
      </div>

      {/* ── Footer ── */}
      <p className="text-center text-xs text-slate-400 py-6">
        Trip Angkutan Kalimantan Barat · v1.0
      </p>
    </div>
  )
}
