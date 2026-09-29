import { useState, useEffect } from 'react'
import { ChevronLeft, Camera, Check, Clock3, Truck, Wifi, WifiOff, Cloud, CloudOff } from 'lucide-react'
import { useApp } from '../store'
import { getSyncQueue } from '../../services/sync'
import type { MobileScreen } from '../types'

// ─── Connection Indicator ────────────────────────────────────────────────────────
function ConnectionIndicator() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true)

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all ${
      isOnline
        ? 'bg-emerald-50 text-emerald-600'
        : 'bg-slate-100 text-slate-500'
    }`}>
      {isOnline ? <Wifi size={12} /> : <WifiOff size={12} />}
      {isOnline ? 'Online' : 'Offline'}
    </div>
  )
}

// ─── History Detail Screen ─────────────────────────────────────────────────────
interface HistoryDetailScreenProps {
  go: (s: MobileScreen) => void
}

export default function HistoryDetailScreen({ go }: HistoryDetailScreenProps) {
  const { trips, detailTripId, officer } = useApp()
  // Scope to this officer's trips — never leak another officer's trip detail
  const myTrips = trips.filter(x => x.officer === officer.name)
  const t = myTrips.find(x => x.id === detailTripId) ?? myTrips[0]
  const vehicles = t.vehicles && t.vehicles.length > 0
    ? t.vehicles
    : [{ plate: t.vehicle, type: t.type, category: t.category, tariff: t.revenueNum }]
  const isSynced = t.synced === true
  const queue = getSyncQueue()
  const inQueue = queue.some(q => q.trip.id === t.id)

  if (!t) {
    return (
      <div className="px-4 pt-2 pb-4">
        <button onClick={() => go('history')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
          <ChevronLeft size={16} /> Riwayat
        </button>
        <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 text-center">
          <p className="text-[13px] font-bold text-slate-700">Belum ada trip</p>
          <p className="text-[11px] text-slate-400 mt-1">Trip yang Anda catat akan muncul di sini</p>
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 pt-2 pb-4">
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => go('history')} className="flex items-center gap-1.5 text-slate-500 text-[13px] hover:text-slate-700 font-medium">
          <ChevronLeft size={16} /> Riwayat
        </button>
        <ConnectionIndicator />
      </div>

      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="font-mono text-[11px] text-slate-400">{t.id}</p>
          <h2 className="font-black text-slate-900 text-[18px]">{t.route}</h2>
        </div>
        <span className="text-[11px] font-bold bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-full">{t.status}</span>
      </div>

      {/* Info Card */}
      <div className="bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-4">
          {[{ l: 'Tanggal', v: t.date }, { l: 'Jam Mulai', v: t.time }, { l: 'Durasi', v: t.duration }, { l: 'Petugas', v: t.officer }].map(({ l, v }) => (
            <div key={l}><p className="text-slate-500 text-[10px] mb-0.5">{l}</p><p className="text-white font-semibold text-[12px]">{v}</p></div>
          ))}
        </div>
      </div>

      {/* Kendaraan */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-3">
        <p className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wide">Detail Kendaraan ({vehicles.length})</p>
        {vehicles.map((v, i) => (
          <div key={`${v.plate}-${i}`} className={`flex items-center gap-3 ${i > 0 ? 'pt-3 mt-3 border-t border-slate-100' : ''}`}>
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center"><Truck size={18} className="text-slate-400" /></div>
            <div className="flex-1">
              <p className="font-mono text-[12px] font-black text-slate-900">{v.plate}</p>
              <p className="text-[10px] text-slate-400">{v.type} · {v.category}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Foto */}
      {t.photo && (
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-3">
          <p className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wide">Foto Bukti</p>
          {t.photoUrl ? (
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <img src={t.photoUrl} alt="Bukti Muatan" className="w-full h-48 object-cover" />
            </div>
          ) : (
            <div className="bg-slate-100 rounded-xl h-32 flex items-center justify-center">
              <div className="text-center"><Camera size={28} className="text-slate-300 mx-auto" /><p className="text-[10px] text-slate-400 mt-1">Foto tersimpan</p></div>
            </div>
          )}
        </div>
      )}

      {/* Sync Status */}
      <div className={`rounded-2xl p-4 flex items-center gap-3 border ${isSynced ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${isSynced ? 'bg-emerald-100' : 'bg-amber-100'}`}>
          {isSynced
            ? <Cloud size={16} className="text-emerald-500" strokeWidth={2.5} />
            : <CloudOff size={16} className="text-amber-500" strokeWidth={2.5} />}
        </div>
        <div className="flex-1">
          <p className={`text-[12px] font-bold ${isSynced ? 'text-emerald-700' : 'text-amber-700'}`}>
            {isSynced ? 'Berhasil terkirim ke Server' : 'Masih menunggu koneksi, tersimpan di lokal'}
          </p>
          <p className={`text-[10px] ${isSynced ? 'text-emerald-600' : 'text-amber-600'}`}>
            {isSynced
              ? `Data berhasil dikirim ke server · ${t.date}`
              : inQueue
                ? 'Menunggu koneksi untuk mengirim...'
                : 'Data aman tersimpan di perangkat'}
          </p>
        </div>
      </div>

      {/* Connection Info */}
      <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 mt-3">
        <p className="text-[11px] font-bold text-slate-500 mb-2 uppercase tracking-wide">Status Koneksi</p>
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${navigator.onLine ? 'bg-emerald-100' : 'bg-slate-200'}`}>
            {navigator.onLine
              ? <Wifi size={14} className="text-emerald-500" />
              : <WifiOff size={14} className="text-slate-400" />}
          </div>
          <div>
            <p className={`text-[12px] font-semibold ${navigator.onLine ? 'text-emerald-700' : 'text-slate-500'}`}>
              {navigator.onLine ? 'Terhubung ke server' : 'Tidak terhubung'}
            </p>
            <p className="text-[10px] text-slate-400">
              {navigator.onLine
                ? 'Data trip akan otomatis dikirim ke admin'
                : 'Data trip tersimpan di lokal, otomatis terkirim saat online'}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
