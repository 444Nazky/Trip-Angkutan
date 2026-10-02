import React, { useState } from 'react'
import { Lock, Check, X } from 'lucide-react'

interface ChangePasswordSectionProps {
  onLogout: () => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

async function postChange(body: { currentPassword: string; newPassword: string }) {
  const res = await fetch('/api/auth/change-admin-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({ error: 'Tidak dapat terhubung' }))
    throw new Error(data.error || 'Gagal')
  }
  return res.json()
}

export function ChangePasswordSection({ onLogout, showToast }: ChangePasswordSectionProps) {
  const [oldPass, setOldPass] = useState('')
  const [newPass, setNewPass] = useState('')
  const [confirmPass, setConfirmPass] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const ready = oldPass.length > 0 && newPass.length >= 6 && confirmPass.length > 0

  const submit = async () => {
    if (!ready || saving) return
    if (newPass !== confirmPass) { setErr('Password baru tidak cocok.'); return }
    setSaving(true)
    setErr(null)
    try {
      await postChange({ currentPassword: oldPass, newPassword: newPass })
      setOldPass(''); setNewPass(''); setConfirmPass('')
      showToast('Password admin diganti.', 'success')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : 'Gagal.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="px-6 py-5 border-b border-slate-100">
        <div className="flex items-center gap-3 mb-1">
          <Lock size={15} className="text-slate-500 shrink-0" />
          <p className="text-sm font-bold text-slate-800">Ganti Password Admin</p>
        </div>
        <p className="text-[11px] text-slate-400 ml-8">Ubah kredensial tanpa akses database.</p>
      </div>
      <div className="p-6 space-y-4">
        {/* Lama */}
        <div>
          <label className="text-[11px] font-semibold text-slate-600 uppercase block mb-1.5">Password Lama</label>
          <input
            type="password" value={oldPass}
            onChange={e => { setErr(null); setOldPass(e.target.value) }}
            onKeyDown={k => { if (k.key === 'Enter') void submit() }}
            placeholder="Masukkan password lama"
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400"
          />
        </div>
        {/* Baru */}
        <div>
          <label className="text-[11px] font-semibold text-slate-600 block mb-1.5">
            Password Baru <span className="normal-case font-normal text-slate-400">(min. 6 karakter)
          </label>
          <input
            type="password" value={newPass}
            onChange={e => { setErr(null); setNewPass(e.target.value) }}
            onKeyDown={k => { if (k.key === 'Enter') void submit() }}
            placeholder="Password baru"
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400"
          />
        </div>
        {/* Konfirmasi */}
        <div>
          <label className="text-[11px] font-semibold text-slate-600 uppercase block mb-1.5">Konfirmasi Baru</label>
          <input
            type="password" value={confirmPass}
            onChange={e => { setErr(null); setConfirmPass(e.target.value) }}
            onKeyDown={k => { if (k.key === 'Enter') void submit() }}
            placeholder="Ketik ulang password baru"
            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder-slate-400"
          />
        </div>
        {err && (
          <p className="text-xs text-red-600 flex items-center gap-1.5">
            <X size={12} />{err}
          </p>
        )}
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={() => void submit()}
            disabled={!ready || saving}
            className="px-5 py-2 rounded-xl text-sm font-semibold bg-zinc-900 text-white disabled:bg-zinc-300 disabled:cursor-not-allowed hover:bg-zinc-800 transition-colors"
          >
            {saving
              ? <span className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-transparent rounded-full animate-spin" />
                  Menyimpan…
                </span>
              : <span className="flex items-center gap-1.5">
                  <Check size={13} />Simpan Password
                </span>}
          </button>
          <button
            onClick={onLogout}
            className="px-4 py-2 rounded-xl text-sm text-slate-500 border border-slate-200 hover:border-slate-300 transition-colors"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  )
}
