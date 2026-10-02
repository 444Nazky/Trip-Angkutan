import { useState } from 'react'
import { Truck, User, Lock, Eye, EyeOff, ArrowRight, AlertCircle, Loader2 } from 'lucide-react'
import { memberLogin } from '../services/auth'

interface LoginPageProps {
  onLogin: (userType: 'admin' | 'member') => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const adminLogin = async (u: string, p: string) => {
    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      })
      if (res.ok) { onLogin('admin'); return true }
      return false
    } catch { window.location.href = '/admin'; return false }
  }

  const handleLogin = async () => {
    const u = username.trim()
    const p = password
    if (!u || !p) { setError('Username dan password wajib diisi.'); return }
    setError(null); setLoading(true)
    try {
      if (u === 'admin') {
        const ok = await adminLogin(u, p)
        if (ok) return
        setError('Username atau password salah.')
        return
      }
      const result = await memberLogin(u, p)
      if (result.success) { onLogin('member'); return }
      const msg = result.error || ''
      if (/timeout|network|failed|fetch|merespon|terjangkau/i.test(msg)) setError('Tidak terhubung ke server. Pastikan backend berjalan.')
      else if (/unauthorized|401|invalid/i.test(msg)) setError(msg || 'Username atau password salah.')
      else setError(msg || 'Login gagal. Coba lagi.')
    } catch { setError('Terjadi kesalahan.') } finally { setLoading(false) }
  }

  const isFormFilled = username.trim().length > 0 && password.length > 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* ── Brand Header ── */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white mb-4 shadow-xl shadow-blue-600/25 ring-4 ring-blue-100">
            <Truck size={28} strokeWidth={2} />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight leading-none">Trip Angkutan</h1>
          <p className="text-sm text-slate-500 mt-1.5 font-medium">Kalimantan Barat</p>
        </div>

        {/* ── Login Card ── */}
        <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/60 border border-slate-100 p-7">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-slate-800">Masuk</h2>
            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">Silakan masukkan kredensial Anda.</p>
          </div>

          <div className="space-y-5">

            {/* Username Field */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
                Username / ID Petugas
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <User size={16} className="text-slate-400" strokeWidth={2} />
                </div>
                <input
                  value={username}
                  onChange={e => { setError(null); setUsername(e.target.value) }}
                  onKeyDown={k => { if (k.key === 'Enter') void handleLogin() }}
                  placeholder="cth: andi_simatupang"
                  autoComplete="username"
                  disabled={loading}
                  className={`w-full pl-10 pr-4 py-3 rounded-xl border-2 text-sm placeholder-slate-300 focus:outline-none transition-all duration-200 ${
                    error
                      ? 'border-red-300 bg-red-50 text-red-800 focus:border-red-400'
                      : 'border-slate-200 bg-slate-50/50 text-slate-800 placeholder-slate-300 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 focus:ring-opacity-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                />
              </div>
            </div>

            {/* Password Field */}
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5 block">
                Password / PIN
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none">
                  <Lock size={16} className="text-slate-400" strokeWidth={2} />
                </div>
                <input
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setError(null); setPassword(e.target.value) }}
                  onKeyDown={k => { if (k.key === 'Enter') void handleLogin() }}
                  placeholder="Kata sandi atau PIN"
                  autoComplete="current-password"
                  disabled={loading}
                  className={`w-full pl-10 pr-11 py-3 rounded-xl border-2 text-sm placeholder-slate-300 focus:outline-none transition-all duration-200 ${
                    error
                      ? 'border-red-300 bg-red-50 text-red-800 focus:border-red-400'
                      : 'border-slate-200 bg-slate-50/50 text-slate-800 placeholder-slate-300 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100 focus:ring-opacity-50'
                  } disabled:opacity-50 disabled:cursor-not-allowed`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(v => !v)}
                  disabled={loading}
                  aria-label={showPw ? 'Sembunyikan sandi' : 'Tampilkan sandi'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 active:scale-110 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed p-0.5 -mt-0.5"
                >
                  {showPw
                    ? <EyeOff size={16} strokeWidth={2} />
                    : <Eye size={16} strokeWidth={2} />
                  }
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <AlertCircle size={14} className="text-red-500 shrink-0 mt-px" strokeWidth={2.5} />
                <p className="text-xs text-red-600 font-medium leading-relaxed">{error}</p>
              </div>
            )}

            {/* Submit Button */}
            <button
              onClick={() => void handleLogin()}
              disabled={!isFormFilled || loading}
              className={`w-full flex items-center justify-center gap-2 font-bold py-3.5 rounded-xl text-sm tracking-wide transition-all duration-200 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100 shadow-lg ${
                isFormFilled && !loading
                  ? 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-600/20 hover:shadow-blue-500/30'
                  : 'bg-slate-200 text-slate-400 shadow-none'
              }`}
            >
              {loading ? (
                <>
                  <Loader2 size={16} className="animate-spin" strokeWidth={2.5} />
                  <span>Memverifikasi…</span>
                </>
              ) : (
                <>
                  <span>Masuk</span>
                  <ArrowRight size={16} strokeWidth={2.5} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[11px] text-slate-400 mt-8 leading-relaxed">
          Trip Angkutan · Kalimantan Barat
        </p>
      </div>
    </div>
  )
}
