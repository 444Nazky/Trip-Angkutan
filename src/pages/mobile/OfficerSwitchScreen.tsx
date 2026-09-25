import { useEffect, useState } from 'react'
import { ChevronLeft, Lock, RefreshCw } from 'lucide-react'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

// ─── Officer Switch Screen ─────────────────────────────────────────────────────
interface OfficerSwitchScreenProps {
  go: (s: MobileScreen) => void
}

export default function OfficerSwitchScreen({ go }: OfficerSwitchScreenProps) {
  const { officer, beginVerify, officers, refreshOfficers } = useApp()
  const [syncing, setSyncing] = useState(false)

  const pull = async () => {
    setSyncing(true)
    try { await refreshOfficers(true) } finally { setSyncing(false) }
  }

  // Tarik daftar petugas terbaru setiap layar dibuka (sinkron real-time dengan
  // dashboard admin: status aktif/nonaktif & wilayah selalu yang terkini).
  useEffect(() => {
    void refreshOfficers(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Petugas yang berbagi minimal satu wilayah dengan petugas aktif saat ini
  const myRegions = officer.regions && officer.regions.length > 0 ? officer.regions : [officer.region]
  const regionOfficers = officers.filter(o => {
    const regs = o.regions && o.regions.length > 0 ? o.regions : [o.region]
    return regs.some(r => myRegions.includes(r))
  })
  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <button onClick={() => go('profile')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>

      <div className="bg-[#0F172A] rounded-3xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Lock size={14} className="text-amber-400" />
          <span className="text-amber-400 text-[11px] font-black tracking-widest uppercase">Region Lock Aktif</span>
        </div>
        <h2 className="text-white font-black text-[18px] mb-0.5">Ganti Petugas</h2>
        <p className="text-slate-400 text-[12px]">
          Hanya petugas wilayah <span className="text-emerald-400 font-black">{myRegions.join(', ')}</span> yang ditampilkan
        </p>
        <button
          onClick={() => void pull()}
          disabled={syncing}
          className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-300 bg-white/10 hover:bg-white/20 rounded-full px-3 py-1.5 transition-colors disabled:opacity-60"
        >
          <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
          {syncing ? 'Menyinkronkan...' : 'Sinkronkan daftar petugas'}
        </button>
      </div>

      <div className="space-y-3">
        {regionOfficers.length === 0 && (
          <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 text-center">
            <p className="text-[13px] font-bold text-slate-700 mb-1">Tidak ada petugas aktif</p>
            <p className="text-[11px] text-slate-400">Petugas wilayah {officer.region} belum terdaftar</p>
          </div>
        )}
        {regionOfficers.map(o => (
          <button
            key={o.id}
            onClick={() => {
              if (o.status !== 'Aktif') return
              beginVerify({ pendingOfficerId: o.id, intent: 'switch' })
              go('pin-verify')
            }}
            className={`w-full bg-white rounded-2xl px-4 py-4 shadow-sm border border-slate-100 flex items-center gap-4 text-left transition-all ${o.status === 'Nonaktif' ? 'opacity-50 cursor-not-allowed' : 'hover:shadow-md active:scale-[0.98]'}`}
          >
            <img src="/assets/guest-profile.jpeg" alt={o.name} className="w-12 h-12 rounded-2xl object-cover" />
            <div className="flex-1">
              <p className="font-bold text-slate-900 text-[13px]">{o.name}</p>
              <p className="text-[11px] text-slate-400">{o.device} · {o.trips} trip</p>
              <p className="text-[10px] text-slate-300">Terakhir aktif: {o.lastActive}</p>
            </div>
            <span className={`text-[10px] font-black px-2.5 py-1 rounded-full ${o.status === 'Aktif' ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'}`}>{o.status}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
