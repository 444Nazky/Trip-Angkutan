import { Truck, ChevronRight, ArrowRight, RefreshCw } from 'lucide-react'
import { useApp } from '../store'
import { getPendingCount, onSyncQueueChange, processSyncQueue } from '../../services/sync'
import { useState, useEffect } from 'react'
import type { MobileScreen } from '../types'

interface HomeScreenProps {
  go: (s: MobileScreen) => void
  /** Dipanggil saat petugas menekan "Mulai Trip". MobileApp menangani cek dual-access dermaga. */
  onStartTrip: () => void
}

export default function HomeScreen({ go, onStartTrip }: HomeScreenProps) {
  const { officer, trips, resetDraft, setDetailTripId } = useApp()
  const [pendingCount, setPendingCount] = useState(getPendingCount)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    // Check pending count on mount
    setPendingCount(getPendingCount())
    // Check on window focus
    const handleFocus = () => setPendingCount(getPendingCount())
    window.addEventListener('focus', handleFocus)
    // Perubahan antrean (mis. terkirim otomatis saat online) langsung tercermin
    const unsubscribe = onSyncQueueChange(setPendingCount)
    return () => {
      window.removeEventListener('focus', handleFocus)
      unsubscribe()
    }
  }, [])
  const handleSync = async () => {
    if (syncing || !navigator.onLine) return
    setSyncing(true)
    try {
      await processSyncQueue({ retryAll: true })
      setPendingCount(getPendingCount())
    } finally {
      setSyncing(false)
    }
  }

  const myTrips = trips.filter(t => t.officer === officer.name)
  const units = new Set(
    myTrips
      .flatMap(t => (t.vehicles && t.vehicles.length ? t.vehicles.map(v => v.plate) : [t.vehicle]))
      .filter(p => p && p !== '-'),
  )
  return (
    <div className="flex flex-col px-4 pt-2 pb-4 animate-fade-in" style={{ gap: 16 }}>
      {/* Trip CTA */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-[28px] p-5 relative overflow-hidden">
        <div className="absolute right-4 top-4 w-24 h-24 rounded-full bg-white/10" />
        <div className="absolute right-10 bottom-3 w-14 h-14 rounded-full bg-blue-800/40" />
        <div className="relative">
          <p className="text-blue-100 text-[13px] font-semibold mb-1">Siap bertugas?</p>
          <h2 className="text-white font-black text-[22px] leading-tight mb-4">Mulai Trip<br />Baru Sekarang</h2>
          <button
            onClick={() => { resetDraft(); onStartTrip() }}
            className="bg-white text-blue-700 font-bold py-3.5 rounded-2xl text-[14px] hover:bg-blue-50 active:scale-95 transition-all w-full flex items-center justify-center gap-2 shadow-lg"
          >
            Mulai Trip <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* Sync Status */}
      {pendingCount > 0 && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 hover:bg-amber-100 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={18} className={syncing ? 'animate-spin text-amber-500' : 'text-amber-500'} />
          <span className="text-[13px] font-semibold text-amber-700">
            {syncing ? 'Menyinkronkan...' : `${pendingCount} trip menunggu sinkronisasi`}
          </span>
          {!syncing && <span className="ml-auto text-[11px] text-amber-500 font-bold">Tap untuk sync</span>}
        </button>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2" style={{ gap: 16 }}>
        {[
          { label: 'Trip', val: String(myTrips.length), sub: 'Total tercatat', color: 'blue' },
          { label: 'Kendaraan', val: String(units.size), sub: 'Unit unik', color: 'slate' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <p className={`text-[22px] font-black ${s.color === 'blue' ? 'text-blue-600' : 'text-slate-900'}`}>{s.val}</p>
            <p className="text-[12px] font-semibold text-slate-700 mt-1">{s.label}</p>
            <p className="text-[12px] text-slate-400 mt-0.5">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Recent Trips */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-slate-800 text-[15px]">Trip Terbaru</h3>
          <button onClick={() => go('history')} className="text-blue-600 text-[12px] font-bold flex items-center gap-1">
            Lihat Semua <ChevronRight size={14} />
          </button>
        </div>
        <div className="flex flex-col" style={{ gap: 12 }}>
          {myTrips.slice(0, 3).map(t => (
            <button
              key={t.id}
              onClick={() => { setDetailTripId(t.id); go('history-detail') }}
              className="w-full bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-center gap-4 hover:shadow-md active:scale-[0.98] transition-all text-left"
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${t.load === 'Ada Muatan' ? 'bg-blue-100' : 'bg-slate-100'}`}>
                <Truck size={20} className={t.load === 'Ada Muatan' ? 'text-blue-500' : 'text-slate-400'} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[14px] font-bold text-slate-800">{t.route}</p>
                <p className="text-[12px] text-slate-400 mt-0.5 ">{t.time} · {t.vehicle !== '-' ? t.vehicle : t.load}</p>
              </div>
              <div className="text-right shrink-0">
                <span className={`text-[11px] font-bold px-3 py-1.5 rounded-full ${t.load === 'Ada Muatan' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>{t.load}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
