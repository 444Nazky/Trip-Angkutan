import { useEffect, useState } from 'react'
import { ChevronLeft, Lock, RefreshCw, LogOut } from 'lucide-react'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

// ─── Officer Switch Screen ─────────────────────────────────────────────────────
interface OfficerSwitchScreenProps {
  go: (s: MobileScreen) => void
}

export default function OfficerSwitchScreen({ go }: OfficerSwitchScreenProps) {
  const { officer, beginVerify, officers, refreshOfficers, logout } = useApp()
  const [syncing, setSyncing] = useState(false)

  const pull = async () => {
    setSyncing(true)
    try { await refreshOfficers(true) } finally { setSyncing(false) }
  }

  // Refresh officer list when screen opens
  useEffect(() => {
    void refreshOfficers(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Region display text
  const myRegions = officer.regions && officer.regions.length > 0 ? officer.regions : [officer.region]

  // STRICT FILTER: region SAMA + minimal 1 dermaga irisan dengan officer aktif
  const myDermagaIds = new Set((officer.dermagaAccess || []).map(d => d.id))
  const filtered = officers.filter(o => {
    // Exclude self
    if (o.id === officer.id) return false

    // Get officer's regions
    const theirRegions = o.regions && o.regions.length > 0 ? o.regions : [o.region]
    const sameRegion = theirRegions.some(r => myRegions.includes(r))
    if (!sameRegion) return false

    // Get officer's dermaga access
    const theirs = o.dermagaAccess || []

    // Aktif punya dermaga → wajib ada irisan
    if (myDermagaIds.size > 0) {
      const shareDermaga = theirs.some(d => myDermagaIds.has(d.id))
      return shareDermaga
    }

    // Aktif tanpa dermaga → tampilkan juga yg tanpa dermaga
    return theirs.length === 0
  })

  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <button onClick={() => go('profile')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>

      {/* Header - Region Lock */}
      <div className="bg-[#0F172A] rounded-3xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Lock size={14} className="text-amber-400" />
          <span className="text-amber-400 text-[11px] font-black tracking-widest uppercase">Ganti Petugas</span>
        </div>
        <h2 className="text-white font-black text-[18px] mb-0.5">Daftar Rekan Kerja</h2>
        <p className="text-slate-400 text-[12px]">
          Hanya rekan dg dermaga sama: <span className="text-emerald-400 font-black">{myRegions.join(', ')}</span>
        </p>
        <button
          onClick={() => void pull()}
          disabled={syncing}
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition-colors disabled:opacity-60"
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Menyinkronkan...' : 'Sinkronkan'}
        </button>
      </div>

      {/* Officer list */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 text-center">
            <p className="text-[13px] font-bold text-slate-700 mb-1">Tidak ada rekan dg dermaga sama</p>
            <p className="text-[11px] text-slate-400">Petugas lain tidak memiliki akses dermaga yang bersinggungan</p>
          </div>
        )}
        {filtered.map(o => (
          <button
            key={o.id}
            onClick={() => {
              if (o.status !== 'Aktif') return
              beginVerify({ pendingOfficerId: o.id, intent: 'switch' })
              go('pin-verify')
            }}
            className={`w-full bg-white rounded-2xl px-4 py-4 shadow-sm border border-slate-100 flex items-center gap-4 text-left transition-all ${
              o.status === 'Nonaktif' ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md active:scale-[0.98]'
            }`}
          >
            <div className="w-12 h-12 rounded-2xl bg-blue-600 text-white flex items-center justify-center font-black text-sm shrink-0">
              {o.initials || o.name.split(' ').map((n: string) => n[0]).join('')}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold text-slate-900 text-[13px]">{o.name}</p>
              <p className="text-[11px] text-slate-400">{o.device} · {o.trips} trip</p>
              <p className="text-[10px] text-slate-300">Terakhir aktif: {o.lastActive}</p>
            </div>
            <span className={`text-[10px] font-black px-2.5 py-1 rounded-full shrink-0 ${
              o.status === 'Aktif' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
            }`}>
              {o.status}
            </span>
          </button>
        ))}
      </div>

      {/* Logout button */}
      <button
        onClick={() => {
          logout()
        }}
        className="w-full flex items-center justify-center gap-2 py-3 text-red-500 font-bold text-[13px] rounded-2xl hover:bg-red-50 active:bg-red-100 transition-colors mt-4 border border-red-200"
      >
        <LogOut size={15} /> Logout Akun
      </button>
    </div>
  )
}
