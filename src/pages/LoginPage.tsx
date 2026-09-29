import { useState } from 'react'
import { Truck, User, Lock, Eye, EyeOff, ArrowRight, AlertCircle } from 'lucide-react'
import { memberLogin } from '../services/auth'

interface LoginPageProps {
  onLogin: (userType: 'admin' | 'member') => void
}

/**
 * Login page mobile — username & password authentication
 * Menghubungi API backend untuk verifikasi kredensial.
 */
export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Handle login
  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Username dan password harus diisi')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const result = await memberLogin(username.trim(), password)

      if (result.success) {
        onLogin('member')
        return
      }

      // Tampilkan error dari server atau fallback message
      const msg = result.error || ''
      if (/timeout|network|failed|fetch|merespon|terjangkau/i.test(msg)) {
        setError('Tidak bisa terhubung ke server. Pastikan backend berjalan.')
      } else if (/unauthorized|401|invalid/i.test(msg)) {
        setError('Username atau password salah')
      } else {
        setError(msg || 'Login gagal. Coba lagi.')
      }
    } catch {
      setError('Terjadi kesalahan. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  // Handle enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      void handleLogin()
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white mb-4 shadow-lg shadow-blue-600/30">
            <Truck size={28} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">Trip Angkutan</h1>
          <p className="text-sm text-slate-500 mt-1">Kalimantan Barat · Versi mobile</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-6">
          <h2 className="text-lg font-bold text-slate-800 mb-1">Masuk</h2>
          <p className="text-sm text-slate-500 mb-6"></p>

          <div className="space-y-4">
            {/* Username */}
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">
                Username / ID Petugas
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={username}
                  onChange={e => { setError(null); setUsername(e.target.value) }}
                  onKeyDown={handleKeyDown}
                  placeholder="Masukkan username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className={`w-full pl-10 pr-4 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors ${
                    error ? 'border-red-300 bg-red-50' : 'border-slate-200 focus:border-blue-500 bg-slate-50/50'
                  }`}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">
                Password / Kata Sandi
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => { setError(null); setPassword(e.target.value) }}
                  onKeyDown={handleKeyDown}
                  placeholder="Masukkan password"
                  className={`w-full pl-10 pr-10 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors ${
                    error ? 'border-red-300 bg-red-50' : 'border-slate-200 focus:border-blue-500 bg-slate-50/50'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 animate-fade-in">
                <AlertCircle size={16} className="text-red-500 shrink-0" />
                <p className="text-red-600 text-xs font-medium">{error}</p>
              </div>
            )}

            {/* Login Button */}
            <button
              onClick={() => void handleLogin()}
              disabled={!username.trim() || !password || loading}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white font-bold py-3.5 rounded-xl text-sm transition-all active:scale-[0.98] shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Memverifikasi...
                </>
              ) : (
                <>
                  Masuk
                  <ArrowRight size={16} />
                </>
              )}
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-400 mt-8">Kalimantan Barat · Angkutan</p>
      </div>
    </div>
  )
}
