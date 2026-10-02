import { useState } from 'react'
import { Lock, Check, X } from 'lucide-react'

interface ChangePasswordProps {
  onLogout?: () => void
  /** Called when logout completes — if provided, logout is left to the parent */
  showToast?: (msg: string, type?: 'success' | 'error') => void
}

export function ChangePasswordSection({ onLogout, showToast }: ChangePasswordProps) {
  const [done, setDone] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const logout = () => {
    sessionStorage.removeItem('trip.auth.token.v1')
    onLogout?.()
    window.location.href = '/'
  }

  const handle = async () => {
    setErr(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/change-admin-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: cur, newPassword: next }),
      })
      const data = await res.json().catch(() => ({ error: 'Tidak terhubung' }))
      if (!res.ok) {
        setErr(data?.error || 'Gagal.')
        return
      }
      setDone(true)
      showToast?.('Password admin diganti.', 'success')
      setCur(''); setNext(''); setConfirm('')
    } catch { setErr('Tidak terhubung.') } finally { setLoading(false) }
  }

  const [cur, setCur] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const ready = cur.length > 0 && next.length >= 6 && confirm.length > 0

  if (done) return (
    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-center gap-3">
      <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center">
        <Check size={16} />
      </div>
      <div className="flex-1">
        <p className="text-sm font-semibold text-emerald-800">Password admin diganti.</p>
        <p className="text-xs text-emerald-600">Simpan di tempat aman.</p>
      </div>
      <button onClick={() => setDone(false)} className="text-emerald-400 hover:text-emerald-600">
        <X size={16} />
      </button>
    </div>
  )

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Lock size={15} className="text-slate-500 shrink-0" />
        <p className="text-sm font-semibold text-slate-800">Ganti Password Admin</p>
      </div>
      <p className="text-[11px] text-slate-400 -mt-2">Ubah kredensial tanpa akses database.</p>
      <div className="space-y-3">
        <div>
          <label className="text-[11px] font-semibold block mb-1.5 uppercase">Password Lama</label>
          <input
            type="password"
            value={cur} autoComplete="current-password"
            onChange={e => { setErr(null); setCur(e.target.value) }}
            onKeyDown={k => { if (k.key === 'Enter') void handle() }}
            placeholder="Masukkan password lama"
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold block mb-1.5">
            Baru <span className="normal-case font-normal text-slate-400">(min. 6 karakter)</span>
          </label>
          <input
            type="password" value={next} autoComplete="new-password"
            onChange={e => { setErr(null); setNext(e.target.value) }}
            onKeyDown={k => { if (k.key === 'Enter') void handle() }}
            placeholder="Password baru"
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        <div>
          <label className="text-[11px] font-semibold block mb-1.5">Konfirmasi</label>
          <input
            type="password"
            value={confirm}
            onChange={e => { setErr(null); setConfirm(e.target.value) }}
            onKeyDown={k => { if (k.key === 'Enter') void handle() }}
            placeholder="Ketik ulang password"
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm"
          />
        </div>
        {err && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <X size={12} />{err}
          </p>
        )}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => void handle()}
            disabled={loading || !ready}
            className="px-5 py-2 rounded-xl font-semibold bg-zinc-900 text-white disabled:bg-zinc-300 cursor-pointer hover:bg-zinc-800 transition-colors"
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-transparent rounded-full animate-spin />
                Menyimpan…
              </span>
            ) : (
              'Simpan Password'
            )}
          </button>
          {onLogout && (
            <button onClick={onLogout}
              className="px-4 py-2 rounded-xl text-slate-500 border border-slate-200 hover:border-slate-300 transition-colors">
              Batal
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
