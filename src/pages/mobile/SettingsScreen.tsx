import { useState } from 'react'
import { ChevronLeft, Database, Shield, Globe, Check, AlertTriangle, Server, RotateCcw, Lock } from 'lucide-react'
import { useApp } from '../store'
import { getPendingCount, getMaskedApiUrl } from '../../services/sync'
import { getBackend } from '../../services/offlineDb'
import type { MobileScreen } from '../types'

interface SettingsScreenProps {
  go: (s: MobileScreen) => void
}

export default function SettingsScreen({ go }: SettingsScreenProps) {
  const { trips } = useApp()
  const [cleared, setCleared] = useState(false)
  const pendingCount = getPendingCount()
  const isOnline = navigator.onLine

  // URL server: hanya sebagian tengah hostname yang disensor (read-only)
  const masked = getMaskedApiUrl()
  const storageBackend = getBackend() === 'sqlite' ? 'SQLite (lokal)' : 'Penyimpanan lokal'

  // Cache clear
  function clearCache() {
    if (!confirm('Bersihkan cache sesi?')) return
    sessionStorage.clear()
    setCleared(true)
    setTimeout(() => setCleared(false), 2500)
  }

  // Reset data
  function resetData() {
    if (!confirm('Yakin?\n\nSemua data trip & petugas lokal akan dihapus.')) return
    const keys = [
      'trip.trips.v1', 'trip.trips.v2', 'trip.trips.v3',
      'trip.syncQueue.v1', 'trip.tariffs.v1',
      'trip.officers.v1', 'trip.officers.cache.v1',
      'trip.officers.credentials.v1',
      'trip.auth.officer.v1', 'trip.auth.dermaga.v1', 'trip.auth.routes.v1', 'trip.auth.pin.v1',
      'trip.dermaga.officers.v1', 'trip.api.baseUrl.v1',
      'trip.ota.state',
    ]
    keys.forEach(k => localStorage.removeItem(k))
    alert('✓ Data direset.\n\nMuat ulang aplikasi.')
    window.location.reload()
  }

  return (
    <div className="px-4 pt-3 pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={() => go('profile')} className="flex-1 text-left text-blue-600 text-[13px] font-bold">
          { String.raw`←` } Profil
        </button>
      </div>

      <div>
        <h2 className="font-black text-[20px] text-slate-900">Pengaturan</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Perangkat & server
        </p>
      </div>

      {/* Status */}
      <div className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-slate-100">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isOnline ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
          <Globe size={18} />
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-bold text-slate-800 leading-none">Jaringan</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {isOnline ? 'Terhubung ke internet' : 'Offline — mode lokal aktif'}
          </p>
        </div>
        <span className={`text-[10px] font-black px-2 py-0.5 rounded-full self-center ${isOnline ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
          {isOnline ? 'Online' : 'Offline'}
        </span>
      </div>

      {/* Data count */}
      <div className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 shadow-sm border border-slate-100">
        <div className="w-10 h-10 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center shrink-0">
          <Database size={18} />
        </div>
        <div>
          <p className="text-[12px] font-bold text-slate-800">{trips.length} trip tercatat</p>
          <p className="text-[10px] text-slate-400">{pendingCount} · offline queue</p>
        </div>
      </div>

      {/* Server URL — READ-ONLY, sebagian tengah disensor */}
      <div className="bg-white rounded-2xl px-4 py-4 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <Lock size={13} className="text-slate-400 shrink-0" />
          <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Konfigurasi Server</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3">
          <Server size={13} className="text-slate-400 shrink-0" />
          <span className="flex-1 text-[12px] font-mono text-slate-600 truncate select-none">{masked}</span>
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5 shrink-0">
            Read-only
          </span>
        </div>
        <div className="flex items-start gap-2 mt-3 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Lock size={11} className="shrink-0 mt-0.5" />
          <span>URL terkunci untuk petugas lapangan. Perubahan server hanya bisa dilakukan supervisor/admin.</span>
        </div>
        <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-400">
          <Database size={11} className="shrink-0" />
          <span>Data offline: {storageBackend}</span>
        </div>
      </div>

      {/* Perawatan */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
        <button
          onClick={clearCache}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 transition">
          <Shield size={15} className="text-slate-400" />
          <span className="flex-1 text-[13px] font-semibold text-slate-700">Bersihkan Cache</span>
          {cleared && <Check size={12} className="text-emerald-600" />}
        </button>
        <button
          onClick={resetData}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-red-600 active:bg-red-50">
          <RotateCcw size={15} className="shrink-0" />
          <span className="flex-1 text-[13px] font-semibold">Reset Semua Data</span>
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-start gap-2.5">
        <AlertTriangle size={14} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-blue-700 leading-relaxed">
          <strong className="font-bold">Mode Lokal-First Aktif</strong>
          {` — data tersimpan di perangkat. Sinkronisasi berjalan otomatis saat online.`}
        </p>
      </div>
    </div>
  )
}
