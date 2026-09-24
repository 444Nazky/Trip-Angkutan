import { useState } from 'react'
import { ChevronLeft, Database, Trash2, Shield, Globe, Check, AlertTriangle } from 'lucide-react'
import { useApp } from '../store'
import { getPendingCount } from '../../services/sync'
import type { MobileScreen } from '../types'

interface SettingsScreenProps {
  go: (s: MobileScreen) => void
}

export default function SettingsScreen({ go }: SettingsScreenProps) {
  const { officer, trips } = useApp()
  const [cleared, setCleared] = useState(false)
  const pendingCount = getPendingCount()

  const handleClearCache = () => {
    if (!confirm('Hapus cache data sesi lokal? (Data akun tetap tersimpan)')) return
    sessionStorage.clear()
    setCleared(true)
    setTimeout(() => setCleared(false), 3000)
  }

  return (
    <div className="px-4 pt-2 pb-6 animate-fade-in">
      <button onClick={() => go('profile')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Profil
      </button>

      <h2 className="font-black text-slate-900 text-[20px] mb-1">Pengaturan Aplikasi</h2>
      <p className="text-slate-500 text-[13px] mb-5">Preferensi perangkat dan diagnostik sistem</p>

      {/* Info Status Sistem */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-100 flex items-center justify-center text-blue-600">
            <Globe size={18} />
          </div>
          <div>
            <p className="text-[12px] font-bold text-slate-800">Status Jaringan</p>
            <p className="text-[10px] text-slate-400">
              {navigator.onLine ? 'Terhubung (Online)' : 'Terputus (Offline mode)'}
            </p>
          </div>
          <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${navigator.onLine ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
            {navigator.onLine ? 'Online' : 'Offline'}
          </span>
        </div>

        <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-600">
            <Database size={18} />
          </div>
          <div>
            <p className="text-[12px] font-bold text-slate-800">Data Lokal</p>
            <p className="text-[10px] text-slate-400">{trips.length} trip tercatat · {pendingCount} pending sync</p>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-3 border-t border-slate-100">
          <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
            <Shield size={18} />
          </div>
          <div>
            <p className="text-[12px] font-bold text-slate-800">Region Aktif</p>
            <p className="text-[10px] text-slate-400">{officer.region} (Device: {officer.device || 'Mobile'})</p>
          </div>
        </div>
      </div>

      {/* Tindakan Pemeliharaan */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-5">
        <p className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wide">Pemeliharaan & Cache</p>
        <button
          onClick={handleClearCache}
          className="w-full py-3 px-4 rounded-xl border border-slate-200 text-slate-700 font-semibold text-[12px] flex items-center justify-between hover:bg-slate-50 active:bg-slate-100 transition-colors"
        >
          <span className="flex items-center gap-2">
            <Trash2 size={16} className="text-slate-400" />
            Bersihkan Cache Sesi
          </span>
          {cleared ? (
            <span className="text-emerald-600 font-bold text-[11px] flex items-center gap-1">
              <Check size={13} /> Selesai
            </span>
          ) : (
            <span className="text-[11px] text-slate-400">Jalankan</span>
          )}
        </button>
      </div>

      <div className="bg-amber-50 rounded-2xl p-4 border border-amber-200 flex items-start gap-3">
        <AlertTriangle size={18} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-[11px] font-bold text-amber-800">Mode Local-First Aktif</p>
          <p className="text-[10px] text-amber-700 leading-relaxed mt-0.5">
            Semua pencatatan trip otomatis tersimpan di perangkat terlebih dahulu dan disinkronkan ke server pusat saat internet tersedia.
          </p>
        </div>
      </div>
    </div>
  )
}
