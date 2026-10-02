import { useState } from 'react'
import { Truck, ArrowRight, AlertCircle } from 'lucide-react'
import { memberLogin } from '../services/auth'

interface LoginPageProps {
  onLogin: (userType: 'member' | 'admin') => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
      const msg = result.error || ''
      if (/timeout|network|failed|fetch|merespon|terjangkau/i.test(msg)) {
        setError('Tidak bisa terhubung ke server.')
      } else if (/unauthorized|401|invalid/i.test(msg)) {
        setError('Username atau password salah.')
      } else {
        setError(msg || 'Login gagal.')
      }
    } catch {
      setError('Terjadi kesalahan.')
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleLogin()
  }

  return (
    <div className="min-h-screen bg-[#f4f4f5] flex items-center justify-center p-4 font-sans">
      {/* Card */}
      <div className="w-full max-w-[360px]">
        {/* Logo mark */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0">
            <Truck size={16} className="text-white" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 leading-none">Trip Angkutan</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Kalimantan Barat</p>
          </div>
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-8">
          <div className="mb-6">
            <h2 className="text-[22px] font-semibold text-zinc-900 leading-tight">Masuk</h2>
            <p className="text-sm text-zinc-500 mt-1">Gunakan akun petugas Anda.</p>
          </div>

          <div className="space-y-4">
            {/* Username */}
            <div>
              <label className="text-xs font-medium text-zinc-700 mb-1.5 block uppercase tracking-wider">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={e => { setError(null); setUsername(e.target.value) }}
                onKeyDown={handleKey}
                placeholder="ID petugas"
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label className="text-xs font-medium text-zinc-700 mb-1.5 block uppercase tracking-wider">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => { setError(null); setPassword(e.target.value) }}
                onKeyDown={handleKey}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors"
              />
            </div>

            {/* Error */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
                <AlertCircle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              onClick={() => void handleLogin()}
              disabled={loading}
              className="w-full mt-1 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 text-white text-sm font-medium py-2.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Memverifikasi...
                </>
              ) : (
                <>
                  Lanjutkan
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-zinc-300 mt-8">
          Sistem Informasi Angkutan Umum · Kalimantan Barat
        </p>
      </div>
    </div>
  )
}
