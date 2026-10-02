import { useState } from 'react'
import { Truck, ArrowRight, AlertCircle } from 'lucide-react'

interface AdminLoginProps {
  onLogin: () => void
}

export default function AdminLogin({ onLogin }: AdminLoginProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('Username dan password harus diisi.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('https://aplikasi-trip-production.up.railway.app/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.token) {
        try {
          localStorage.setItem('trip.admin.token', data.token)
          localStorage.setItem('trip.admin.officer', JSON.stringify(data.officer || {}))
        } catch (_) {}
        onLogin()
      } else {
        setError(data.error || 'Login gagal.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tidak dapat terhubung.')
    } finally {
      setLoading(false)
    }
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleLogin()
  }

  return (
    <div className="min-h-screen bg-[#f4f4f5] flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-[360px]">
        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0">
            <Truck size={16} className="text-white" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 leading-none">Trip Admin</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Kalimantan Barat</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-8">
          <div className="mb-6">
            <h2 className="text-[22px] font-semibold text-zinc-900 leading-tight">Masuk Admin</h2>
            <p className="text-sm text-zinc-500 mt-1">Kredensial admin.</p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-zinc-700 mb-1.5 block uppercase tracking-wider">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => { setError(null) ; setUsername(e.target.value) }}
                onKeyDown={handleKey}
                placeholder="admin"
                autoComplete="username"
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-zinc-700 mb-1.5 block uppercase tracking-wider">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => { setError(null) ; setPassword(e.target.value) }}
                onKeyDown={handleKey}
                placeholder="••••"
                autoComplete="current-password"
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2.5">
                <AlertCircle size={14} className="shrink-0" />
                {error}
              </div>
            )}

            <button
              onClick={() => void handleLogin()}
              disabled={loading}
              className="w-full mt-1 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 text-white text-sm font-medium py-2.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Masuk <ArrowRight size={15} /></>
              )}
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-zinc-300 mt-8">Sistem Informasi Angkutan Umum · Kalimantan Barat</p>
      </div>
    </div>
  )
}
