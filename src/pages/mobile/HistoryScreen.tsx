import { useState, useEffect } from 'react'
import { Truck, Wifi, WifiOff, Cloud, CloudOff } from 'lucide-react'
import { useApp } from '../store'
import { getSyncQueue } from '../../services/sync'
import type { MobileScreen } from '../types'

// ─── Sync Badge Component ─────────────────────────────────────────────────────
function SyncBadge({ tripId, isSynced }: { tripId: string; isSynced: boolean }) {
  const queue = getSyncQueue()
  const inQueue = queue.some(q => q.trip.id === tripId)

  if (isSynced) {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
        <Cloud size={10} /> Terkirim
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
      <CloudOff size={10} /> Tersimpan di lokal
    </span>
  )
}

// ─── Connection Indicator ──────────────────────────────────────────────────────
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

// ─── History Screen ────────────────────────────────────────────────────────────
interface HistoryScreenProps {
  go: (s: MobileScreen) => void
}

export default function HistoryScreen({ go }: HistoryScreenProps) {
  const { trips, setDetailTripId, officer } = useApp()
  const [filter, setFilter] = useState<'all' | 'muatan' | 'kosong'>('all')

  // Officers only see their own trips (matches HomeScreen)
  const myTrips = trips.filter(t =>
    t.officerId ? String(t.officerId) === String(officer.id) : t.officer === officer.name,
  )
  const filtered = filter === 'all'
    ? myTrips
    : myTrips.filter(t => filter === 'muatan' ? t.load === 'Ada Muatan' : t.load === 'Kosong')

  // Count summary
  const syncedCount = myTrips.filter(t => t.synced).length
  const localCount = myTrips.filter(t => !t.synced).length

  return (
    <div className="px-4 pt-2 pb-4 space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-slate-900 text-[20px]">Riwayat Trip</h2>
        <ConnectionIndicator />
      </div>

      {/* Summary Stats */}
      <div className="flex gap-2 text-[11px]">
        <div className="flex items-center gap-1 bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full font-semibold">
          <Cloud size={10} />
          <span>{syncedCount} terkirim</span>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 text-slate-500 px-3 py-1.5 rounded-full font-semibold">
          <CloudOff size={10} />
          <span>{localCount} lokal</span>
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {([['all', 'Semua'], ['muatan', 'Muatan'], ['kosong', 'Kosong']] as [typeof filter, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setFilter(k)}
            className={`px-4 py-2 rounded-xl text-[12px] font-bold transition-all ${filter === k ? 'bg-[#0F172A] text-white' : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300'}`}
          >{l}</button>
        ))}
      </div>

      {/* List */}
      <div className="space-y-3">
        {filtered.length === 0 && (
          <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-100 text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
              <Truck size={24} className="text-slate-400" />
            </div>
            <p className="text-[14px] font-bold text-slate-700 mb-2">Belum ada trip</p>
            <p className="text-[12px] text-slate-400 leading-relaxed">
              {filter === 'all'
                ? 'Trip yang Anda catat akan muncul di sini'
                : `Trip dengan status "${filter === 'muatan' ? 'Ada Muatan' : 'Kosong'}" akan muncul di sini`}
            </p>
          </div>
        )}
        {filtered.map(t => (
          <button
            key={t.id}
            onClick={() => { setDetailTripId(t.id); go('history-detail') }}
            className="w-full bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-start gap-4 text-left hover:shadow-md active:scale-[0.98] transition-all"
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${t.load === 'Ada Muatan' ? 'bg-blue-100' : 'bg-slate-100'}`}>
              <Truck size={20} className={t.load === 'Ada Muatan' ? 'text-blue-500' : 'text-slate-400'} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[14px] font-bold text-slate-900">{t.route}</p>
                <SyncBadge tripId={t.id} isSynced={t.synced ?? false} />
              </div>
              <p className="font-mono text-[11px] text-slate-400">{t.id}</p>
              <div className="flex items-center gap-3 mt-2">
                <span className="text-[11px] text-slate-400">{t.date} · {t.time}</span>
                <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${t.load === 'Ada Muatan' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>{t.load}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
