import { useState } from 'react'
import { Truck, ArrowRight } from 'lucide-react'

interface AdminLoginPageProps {
  onLogin: () => void
}

export default function AdminLoginPage({ onLogin }: AdminLoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handle = () => {
    if (!username.trim() || !password) { setError('Username dan password harus diisi.')
      return
    }
    if (username.trim() === 'admin' && password === 'admin123') { onLogin(); return }
    setError('Username atau password salah.')
  }

  const key = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void handle() }

  return (
    <div className="min-h-screen bg-[#f4f4f5] flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-[340px]">

        {/* Brand */}
        <div className="flex items-center gap-3 mb-10">
          <div className="w-8 h-8 bg-zinc-900 rounded-lg flex items-center justify-center shrink-0">
            <Truck size={16} className="text-white" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-semibold text-zinc-900 leading-none">Dashboard Admin</p>
            <p className="text-[11px] text-zinc-400 mt-0.5">Trip Angkutan</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-8">
          <h2 className="text-[22px] font-semibold text-zinc-900 mb-1">Masuk</h2>
          <p className="text-sm text-zinc-500 mb-6">Administrator dashboard.</p>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-zinc-700 mb-1.5 block uppercase tracking-wider">Username</label>
              <input
                type="text"
                value={username}
                onChange={e => { setError(null); setUsername(e.target.value) }
                onKeyDown={key}
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
                onChange={e => { setError(null); setPassword(e.target.value) }
                onKeyDown={key}
                placeholder="••••••"
                autoComplete="current-password"
                className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600">{error</p>
            )}

            <button
              onClick={() => void handle()}
              disabled={loading}
              className="w-full mt-1 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-300 text-white text-sm py-2.5 rounded-xl transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Masuk <ArrowRight size={15} />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
