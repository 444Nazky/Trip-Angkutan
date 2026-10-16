import { useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import { adminLogin, AUTH_EVENT } from '../services/auth'




interface Props {
  onLogin?: () => void
}



export default function LoginPage({ onLogin }: Props) {
  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setErr('Username dan password wajib diisi.')
      return
    }
    setBusy(true)
    setErr(null)
    const session = await adminLogin(username.trim(), password)
    setBusy(false)
    if (!session.ok) {
      setErr(session.authDenied ? 'Username atau password salah.' : 'Server tidak merespon.')
      return
    }

    window.dispatchEvent(new CustomEvent(AUTH_EVENT))
    setTimeout(() => onLogin?.(), 150)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 px-4">
      <form
        onSubmit={submit}
        className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-sm space-y-4 border border-slate-200"
      >
        <div className="flex flex-col items-center gap-2 mb-2">
          <div className="w-12 h-12 rounded-2xl bg-[#0F172A] flex items-center justify-center">
            <Lock size={20} className="text-amber-400" />
          </div>
          <h1 className="font-black text-slate-900 text-lg">Masuk Administrator</h1>
          <p className="text-[12px] text-slate-500 text-center">
            Sesi admin ditolak server — masukkan ulang kredensial.
          </p>
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-600 block mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoComplete="username"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-slate-600 block mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="••••••••"
            className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {err && <p className="text-red-500 text-xs font-semibold">{err}</p>}

        <button
          type="submit"
          disabled={busy}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold py-3 rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
        >
          {busy && <Loader2 size={15} className="animate-spin" />}
          Masuk
        </button>
      </form>
    </div>
  )
}
