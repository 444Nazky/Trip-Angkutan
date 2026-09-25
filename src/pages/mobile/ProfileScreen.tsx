import { useEffect } from 'react'
import { Truck, Map, ShieldCheck, Settings, ChevronRight, ArrowLeftRight, Lock } from 'lucide-react'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

interface ProfileScreenProps {
  go: (s: MobileScreen) => void
}

export default function ProfileScreen({ go }: ProfileScreenProps) {
  const { officer, trips, beginVerify, refreshOfficers } = useApp()

  // Pastikan status/wilayah petugas selalu terbaru (sinkron dengan admin)
  useEffect(() => {
    void refreshOfficers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const myTrips = trips.filter(t => t.officer === officer.name)
  const units = new Set(
    myTrips
      .flatMap(t => (t.vehicles && t.vehicles.length ? t.vehicles.map(v => v.plate) : [t.vehicle]))
      .filter(p => p && p !== '-'),
  )
  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <h2 className="font-black text-slate-900 text-[18px] mb-3">Profil Saya</h2>

      <div className="bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="flex items-center gap-4">
          <img src="/assets/guest-profile.jpeg" alt="Budi Santoso" className="w-14 h-14 rounded-2xl object-cover" />
          <div className="min-w-0">
            <p className="text-white font-bold text-[16px] leading-tight">{officer.name}</p>
            <p className="text-slate-400 text-[11px] mt-0.5">Petugas Lapangan · OFF-{String(officer.id).padStart(3, '0')}</p>
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 text-[10px] font-bold">{officer.region} · {officer.status}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 mt-4 pt-4 border-t border-white/10">
          {[{ v: String(myTrips.length), l: 'Trip' }, { v: String(units.size), l: 'Kendaraan' }].map((s, i) => (
            <div key={s.l} className={`text-center ${i > 0 ? 'border-l border-white/10' : ''}`}>
              <p className="text-white font-black text-[15px] leading-tight">{s.v}</p>
              <p className="text-slate-400 text-[10px] mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-1.5 mt-4 pt-3 border-t border-white/10">
          <Lock size={11} className="text-slate-500" />
          <span className="text-[10px] text-slate-500">Region Locked</span>
          <span className="ml-auto text-[10px] font-black text-emerald-400 tracking-widest">{officer.region}</span>
          <span className="text-[9px] text-slate-600">{officer.lastActive}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-4">
        {[
          { icon: Truck, label: 'Riwayat Trip', action: () => go('history') },
          { icon: Map, label: 'Rute Aktif', action: () => go('route-select') },
          { icon: ShieldCheck, label: 'Keamanan & PIN', action: () => { beginVerify({ pendingOfficerId: null, intent: 'security' }); go('pin-verify') } },
          { icon: Settings, label: 'Pengaturan', action: () => go('settings') },
        ].map((item, i) => (
          <button
            key={item.label}
            onClick={item.action}
            className={`w-full flex items-center gap-3 px-5 py-3.5 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left ${i > 0 ? 'border-t border-slate-100' : ''}`}
          >
            <item.icon size={16} className="text-slate-400" />
            <span className="flex-1 text-[13px] font-semibold text-slate-700">{item.label}</span>
            <ChevronRight size={15} className="text-slate-300" />
          </button>
        ))}
      </div>

      <button
        onClick={() => go('officer-switch')}
        className="w-full flex items-center justify-center gap-2 py-3 text-red-500 font-bold text-[13px] rounded-2xl hover:bg-red-50 active:bg-red-100 transition-colors"
      >
        <ArrowLeftRight size={15} /> Ganti Petugas
      </button>
    </div>
  )
}
