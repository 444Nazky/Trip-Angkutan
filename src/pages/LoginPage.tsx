import { useState } from 'react'
import { ArrowRight, AlertCircle } from 'lucide-react'
import { adminLogin } from '../services/auth'

interface LoginPageProps {
  /** Called with 'admin' on success so App.tsx sets userType. */
  onLogin: (userType: 'admin') => void
}

/**
 * Admin login form — shown only when the backend rejects stored admin credentials.
 *
 * SECURITY: This component is NEVER imported by the mobile build (lazy Shell guards App.tsx).
 * It is ONLY reachable from the admin build via <AdminDashboard authDenied> prop.
 */
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
      const result = await adminLogin(username.trim(), password)

      if (result.success) {
        onLogin('admin')
        return
      }

      // adminLogin returns 'invalid' (401) or 'network' (server unreachable)
      setError(result.error === 'network'
        ? 'Tidak bisa terhubung ke server.'
        : 'Username atau password salah.')
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
    <div className="min-h-screen bg-slate-100 font-sans flex items-center justify-center p-4">
      <div className="w-full max-w-[360px]">
        <div className="bg-white rounded-2xl border border-zinc-200 p-8 shadow-sm">
          <div className="mb-6">
            <h2 className="text-[22px] font-semibold text-zinc-900 leading-tight">
              Masuk Administrator
            </h2>
            <p className="text-sm text-zinc-500 mt-1">
              Gunakan kredensial Administrator.
            </p>
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
                placeholder="admin"
                autoComplete="username"
                autoCapitalize="none"
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zindigo-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors"
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
                autoComplete="current-password"
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
              className="w-full mt-1 bg-indigo-600 hover:bg-indigo-700 disabled:bg-zinc-300 text-white text-sm font-medium py-2.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Masuk</span>
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-zinc-400 mt-8">
          Sistem Informasi Angkutan · Kalimantan Barat
        </p>
      </div>
    </div>
  )
}
