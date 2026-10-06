import { useState, useEffect } from 'react'
import { Eye, EyeOff, Wifi, WifiOff, AlertCircle } from 'lucide-react'
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
      const ok = await tryOfflineLogin(username.trim(), password)
      if (ok) return
      setError('Akun tidak ditemukan di perangkat ini. Hubungkan internet untuk login pertama kali.')
      setLoading(false)
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
    <div className="min-h-screen flex flex-col bg-white">

      {/* ── Header ── */}
      <div className="relative overflow-hidden">
        {/* Gradient Header */}
        <div className="bg-gradient-to-br from-[#1B3D6D] via-[#1a4a8a] to-[#FFBD15] px-6 pb-20 pt-14">
          {/* Logo Container */}
          <div className="flex flex-col items-center gap-2">
            <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-xl ring-4 ring-white/30">
              <img
                src="Assets/karyamas_clean.svg"
                alt="Logo"
                width={48}
                height={48}
                className="object-contain"
                onError={e => {
                  e.currentTarget.style.display = 'none'
                }}
              />
            </div>
            <span className="text-white/90 text-sm font-semibold tracking-widest uppercase">Trip Angkutan</span>
          </div>
        </div>

        {/* Wave Decoration */}
        <div className="h-8 bg-gradient-to-b from-[#1B3D6D] to-transparent -mt-1" />
      </div>

      {/* ── Status Badge ── */}
      <div className="flex justify-center -mt-4 relative z-10">
        <div className={`flex items-center gap-1.5 text-[10px] font-bold px-4 py-1.5 rounded-full backdrop-blur-sm shadow-sm ${
          isOnline
            ? 'bg-emerald-50/90 text-emerald-700 ring-1 ring-emerald-200/50'
            : 'bg-amber-50/90 text-amber-700 ring-1 ring-amber-200/50'
        }`}>
          {isOnline ? <Wifi size={10} /> : <WifiOff size={10} />}
          {isOnline ? 'Online' : 'Offline'}
        </div>
      </div>

      {/* ── Form Card ── */}
      <div className="flex-1 px-6 pt-10 pb-8">
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-6 space-y-5 border border-slate-100">

          {/* Judul */}
          <div className="text-center">
            <h2 className="text-2xl font-bold text-[#1B3D6D]">Selamat Datang</h2>
            <p className="text-sm text-slate-400 mt-1">Masuk ke akun Anda</p>
          </div>

          {/* Fields */}
          <div className="space-y-4">
            {/* Username */}
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">ID Petugas</label>
              <input
                type="text"
                value={username}
                onChange={e => { setError(null); setUsername(e.target.value) }}
                onKeyDown={onKey}
                placeholder="cth: p001"
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full mt-2 px-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-300 focus:outline-none focus:border-[#FFBD15] focus:ring-2 focus:ring-[#FFBD15]/20 transition-all"
              />
            </div>

            {/* Password */}
            <div>
              <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Kata Sandi</label>
              <div className="relative mt-2">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setError(null); setPassword(e.target.value) }}
                  onKeyDown={onKey}
                  placeholder="PIN atau password"
                  className="w-full px-4 py-3.5 pr-12 bg-slate-50 border border-slate-200 rounded-xl text-sm placeholder:text-slate-300 focus:outline-none focus:border-[#FFBD15] focus:ring-2 focus:ring-[#FFBD15]/20 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#1B3D6D] transition-colors"
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Lupa Password */}
            <div className="flex justify-end">
              <button type="button" className="text-xs text-[#1B3D6D] hover:text-[#FFBD15] font-medium transition-colors">
                Lupa Password?
              </button>
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <AlertCircle size={16} className="text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-500">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              onClick={() => void handleLogin()}
              disabled={loading}
              className="w-full py-4 rounded-xl font-bold text-sm text-white bg-[#1B3D6D] hover:bg-[#0f2847] active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-lg shadow-[#1B3D6D]/20"
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Memproses…
                </span>
              ) : 'Masuk'}
            </button>
          </div>

          {/* Petunjuk offline */}
          {!isOnline && (
            <p className="text-xs text-center text-amber-600 bg-amber-50 rounded-xl px-4 py-3">
              Mode offline — gunakan ID & PIN yang pernah login di perangkat ini.
            </p>
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <p className="text-center text-[10px] text-slate-300 pb-6">
        Trip Angkutan Kalimantan Barat · v1.0
      </p>
    </div>
  )
}
