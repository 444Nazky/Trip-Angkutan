import { useEffect, useState } from 'react'
import { Truck, Map, Settings, ChevronRight, ArrowLeftRight, Lock, Users } from 'lucide-react'
import { useApp } from '../store'
import type { MobileScreen } from '../types'
import LocalOfficersModal from './LocalOfficersModal'

interface ProfileScreenProps {
  go: (s: MobileScreen) => void
}

export default function ProfileScreen({ go }: ProfileScreenProps) {
  const { officer, trips, refreshOfficers } = useApp()
  const [showLocalOfficers, setShowLocalOfficers] = useState(false)

  useEffect(() => {
    void refreshOfficers()

  }, [])

  const myTrips = trips.filter(t => t.officerId ? String(t.officerId) === String(officer.id) : t.officer === officer.name)

  const units = new Set(
    myTrips
      .flatMap(t => (t.vehicles && t.vehicles.length ? t.vehicles.map(v => v.plate) : [t.vehicle]))
      .filter(p => p && p !== '-'),
  )
  return (
    <div className="px-4 pt-2 pb-4 space-y-4 animate-fade-in">
      <h2 className="font-black text-slate-900 text-[18px] mb-4">Profil</h2>

      <div className="bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="flex items-center gap-4 mb-4">
          <img src="/assets/guest-profile.jpeg" alt={officer.name} className="w-16 h-16 rounded-2xl object-cover" />
          <div className="min-w-0">
            <p className="text-white font-bold text-[16px] leading-tight">{officer.name}</p>
            <p className="text-slate-400 text-[12px] mt-0.5">{String(officer.id).padStart(3, '0')}</p>
            <div className="flex items-center gap-1.5 mt-2">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <span className="text-emerald-400 text-[11px] font-bold">{officer.region} · {officer.status}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-white/10">
          {[{ v: String(myTrips.length), l: 'Trip' }, { v: String(units.size), l: 'Kendaraan' }].map((s, i) => (
            <div key={s.l} className={`text-center ${i > 0 ? 'border-l border-white/10 pl-4' : ''}`}>
              <p className="text-white font-black text-[18px] leading-tight">{s.v}</p>
              <p className="text-slate-400 text-[11px] mt-1">{s.l}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-white/10">
          <Lock size={12} className="text-slate-500" />
          <span className="text-[11px] text-slate-500">Region Locked</span>
          <span className="ml-auto text-[11px] font-black text-emerald-400 tracking-widest">{officer.region}</span>
          <span className="text-[10px] text-slate-600">{officer.lastActive}</span>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-4">
        {[
          { icon: Truck, label: 'Riwayat Trip', action: () => go('history') },
          { icon: Map, label: 'Rute Aktif', action: () => go('route-select') },
          { icon: Users, label: 'Daftar Petugas Lokal', action: () => setShowLocalOfficers(true), highlight: true },
          { icon: Settings, label: 'Pengaturan', action: () => go('settings') },
        ].map((item, i) => (
          <button
            key={item.label}
            onClick={item.action}
            className={`w-full flex items-center gap-3 px-5 py-4 hover:bg-slate-50 active:bg-slate-100 transition-colors text-left ${i > 0 ? 'border-t border-slate-100' : ''}`}
          >
            <item.icon size={18} className={item.highlight ? 'text-blue-500' : 'text-slate-400'} />
            <span className={`flex-1 text-[14px] font-semibold ${item.highlight ? 'text-blue-600 font-bold' : 'text-slate-700'}`}>{item.label}</span>
            {item.highlight && (
              <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full font-bold">Offline</span>
            )}
            <ChevronRight size={16} className="text-slate-300" />
          </button>
        ))}
      </div>

      <button
        onClick={() => go('officer-switch')}
        className="w-full flex items-center justify-center gap-2 py-3.5 text-red-500 font-bold text-[13px] rounded-2xl border border-red-200 hover:bg-red-50 active:bg-red-100 transition-colors"
      >
        <ArrowLeftRight size={15} /> Ganti Petugas
      </button>

      {/* Modal Daftar Petugas Lokal */}
      {showLocalOfficers && (
        <LocalOfficersModal onClose={() => setShowLocalOfficers(false)} />
      )}

    </div>
  )
}