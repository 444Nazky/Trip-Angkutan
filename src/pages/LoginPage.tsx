import { useState } from 'react'
import { Truck, Lock, User, Eye, EyeOff, ArrowRight, AlertCircle, ChevronDown } from 'lucide-react'
import { memberLogin } from '../services/auth'

interface LoginPageProps {
  onLogin: (userType: 'admin' | 'member', officerId?: string) => void
}

const USERS = {
  member: { username: '', password: '123456', name: 'Petugas' },
  admin: { username: 'admin', password: 'admin123', name: 'Admin' },
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [adminMode, setAdminMode] = useState(false)

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  const handleLogin = async () => {
    setError(null)
    setLoading(true)

    try {
      if (adminMode) {
        // Admin: check against fixed credentials
        if (username === 'admin' && password === 'admin123') {
          onLogin('admin')
        } else {
          showError('Username atau password salah')
        }
      } else {
        // Member: use backend API for validation
        const result = await memberLogin(username, password)
        if (result.success) {
          onLogin('member', result.officer?.id)
        } else {
          // Bedakan kesalahan kredensial vs masalah koneksi/server
          const msg = result.error || ''
          const isConn = /timeout|network|failed|fetch|merespon/i.test(msg)
          showError(
            isConn
              ? 'Tidak bisa terhubung ke server. Pastikan backend berjalan.'
              : 'Username atau password salah'
          )
        }
      }
    } catch (err) {
      console.error('[Login] Error:', err)
      showError('Terjadi kesalahan. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  const toggleAdminMode = () => {
    setAdminMode(!adminMode)
    setUsername('')
    setPassword('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white mb-4 shadow-lg shadow-blue-600/30">
            <Truck size={28} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Trip Angkutan</h1>
          <p className="text-sm text-slate-500 mt-1">Wilayah BADAU</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-slate-100">
          <h2 className="text-lg font-bold text-slate-800 mb-1">Selamat Datang</h2>
          <p className="text-sm text-slate-500 mb-6">
            {adminMode ? 'Masuk sebagai Administrator' : 'Masuk sebagai Petugas'}
          </p>

          <div className="space-y-4">
            {/* Username */}
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">
                Username
              </label>
              <div className="relative">
                <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  placeholder="Masukkan username"
                  className={`w-full pl-10 pr-4 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors ${
                    error
                      ? 'border-red-300 bg-red-50'
                      : 'border-slate-200 focus:border-blue-500 bg-slate-50/50'
                  }`}
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">
                Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  placeholder="Masukkan password"
                  className={`w-full pl-10 pr-10 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors ${
                    error
                      ? 'border-red-300 bg-red-50'
                      : 'border-slate-200 focus:border-blue-500 bg-slate-50/50'
                  }`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
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
              onClick={handleLogin}
              disabled={!username || !password || loading}
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

        {/* Admin Toggle (Hidden - Click to reveal) */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={toggleAdminMode}
            className="text-slate-400 hover:text-slate-600 text-xs flex items-center gap-1 mx-auto transition-colors"
          >
            {adminMode ? 'Kembali ke Login Petugas' : 'Login Administrator'}
            <ChevronDown size={14} className={adminMode ? 'rotate-180' : ''} />
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-400 text-xs mt-8">
          Kalimantan Barat · v2.4.1
        </p>
      </div>
    </div>
  )
}
