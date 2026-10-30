import { useState, useEffect } from 'react'
import { Truck, Wifi, WifiOff, Cloud, CloudOff, AlertTriangle, FileText, Clock, ChevronRight, Trash2 } from 'lucide-react'
import { fmtDate, fmtTime, useApp } from '../store'
import { classifyTripSync, onSyncQueueChange, type SyncItem, type TripSyncState } from '../../services/sync'
import {
  draftPhotoCount,
  draftRemainingMs,
  draftResumeTarget,
  draftRouteLabel,
  formatDraftRemaining,
  hasDraftContent,
} from '../../services/tripDraft'
import type { MobileScreen } from '../types'




function SyncBadge({ state }: { state: TripSyncState }) {
  if (state === 'synced') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
        <Cloud size={10} /> Terkirim
      </span>
    )
  }

  if (state === 'failed') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full">
        <AlertTriangle size={10} /> Gagal
      </span>
    )
  }

  return (
    <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
      <CloudOff size={10} /> {state === 'pending' ? 'Menunggu' : 'Tersimpan di lokal'}
    </span>
  )
}




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




interface HistoryScreenProps {
  go: (s: MobileScreen) => void
}




export default function HistoryScreen({ go }: HistoryScreenProps) {
  const { trips, setDetailTripId, officer, draft, draftInfo, discardDraft } = useApp()
  const [filter, setFilter] = useState<'all' | 'muatan' | 'kosong'>('all')

  // Antrean sync = sumber status pengiriman (bukan `trip.synced` saja),
  // supaya trip yang ditolak server tampil "Gagal", bukan "Terkirim".
  const [queue, setQueue] = useState<SyncItem[]>([])
  useEffect(() => onSyncQueueChange((_n, q) => setQueue(q)), [])
  const stateOf = (id: string, synced: boolean | undefined) =>
    classifyTripSync(id, synced, queue).state

  // Draft trip yang belum terkirim: tampil di Riwayat supaya petugas yang
  // tidak sengaja menutup form bisa melanjutkannya, bukan mengulang dari nol.
  const draftActive = hasDraftContent(draft)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!draftActive) {
      setConfirmDiscard(false)
      return
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [draftActive, draftInfo?.expiresAt])
  const draftRemaining = draftRemainingMs(draftInfo, now)
  const draftChangedAt = draftInfo ? new Date(draftInfo.savedAt) : null

  const myTrips = trips
    .filter(t => t.officerId ? String(t.officerId) === String(officer.id) : t.officer === officer.name)
    // Urutkan kronologis terbaru lebih dulu; sumbernya tetap data lokal.
    .sort((a, b) => {
      const ta = Date.parse(a.completedAt ?? '') || 0
      const tb = Date.parse(b.completedAt ?? '') || 0
      return tb - ta
    })
  const filtered = filter === 'all'
    ? myTrips
    : myTrips.filter(t => filter === 'muatan' ? t.load === 'Ada Muatan' : t.load === 'Kosong')

  const syncedCount = myTrips.filter(t => stateOf(t.id, t.synced) === 'synced').length
  const failedCount = myTrips.filter(t => stateOf(t.id, t.synced) === 'failed').length
  const localCount = myTrips.filter(t => {
    const s = stateOf(t.id, t.synced)
    return s === 'pending' || s === 'local'
  }).length

  return (
    <div className="px-4 pt-2 pb-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-slate-900 text-[20px]">Riwayat Trip</h2>
        <ConnectionIndicator />
      </div>

      {/* Summary Stats */}
      <div className="flex gap-2 text-[11px] flex-wrap">
        <div className="flex items-center gap-1 bg-emerald-50 text-emerald-600 px-3 py-1.5 rounded-full font-semibold">
          <Cloud size={10} />
          <span>{syncedCount} terkirim</span>
        </div>
        {failedCount > 0 && (
          <div className="flex items-center gap-1 bg-red-50 text-red-600 px-3 py-1.5 rounded-full font-semibold">
            <AlertTriangle size={10} />
            <span>{failedCount} gagal kirim</span>
          </div>
        )}
        <div className="flex items-center gap-1 bg-slate-100 text-slate-500 px-3 py-1.5 rounded-full font-semibold">
          <CloudOff size={10} />
          <span>{localCount} lokal</span>
        </div>
      </div>

      {/* Draft trip yang belum terkirim — bisa dilanjutkan atau dibuang */}
      {draftActive && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                <FileText size={16} />
              </div>
              <div className="min-w-0">
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-amber-700">Draft · belum terkirim</p>
                <p className="truncate text-[14px] font-bold text-slate-900">{draftRouteLabel(draft)}</p>
              </div>
            </div>
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
              <Clock size={10} />
              {draftInfo ? `Sisa ${formatDraftRemaining(draftRemaining)}` : 'Sisa 12j'}
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-semibold">
            <span className="rounded-full bg-white/80 px-2 py-1 text-slate-600 ring-1 ring-amber-100">
              {draft.condition === 'kosong'
                ? 'Kosong'
                : draft.condition === 'muatan'
                  ? 'Muatan'
                  : 'Status muatan belum dipilih'}
            </span>
            <span className="rounded-full bg-white/80 px-2 py-1 text-slate-600 ring-1 ring-amber-100">
              {draft.vehicles.length} kendaraan
            </span>
            <span className="rounded-full bg-white/80 px-2 py-1 text-slate-600 ring-1 ring-amber-100">
              {draftPhotoCount(draft)} foto
            </span>
            {draftChangedAt && (
              <span className="rounded-full bg-white/80 px-2 py-1 text-slate-500 ring-1 ring-amber-100">
                Diubah {fmtDate(draftChangedAt)} · {fmtTime(draftChangedAt)}
              </span>
            )}
          </div>

          <p className="mt-2 text-[10px] leading-relaxed text-amber-800/80">
            Tersimpan di perangkat. Otomatis dihapus 12 jam setelah draft dibuat.
          </p>

          {confirmDiscard ? (
            <div className="mt-3 rounded-xl bg-white p-3 ring-1 ring-amber-200">
              <p className="text-[11px] text-slate-600">Hapus draft ini? Semua isian dan fotonya akan hilang.</p>
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => setConfirmDiscard(false)}
                  className="flex-1 rounded-lg border border-slate-200 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  onClick={() => {
                    discardDraft()
                    setConfirmDiscard(false)
                  }}
                  className="flex-1 rounded-lg bg-red-500 py-2 text-[11px] font-semibold text-white hover:bg-red-600"
                >
                  Hapus draft
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => go(draftResumeTarget(draft))}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-[12px] font-semibold text-white hover:bg-slate-800 active:scale-[0.99]"
              >
                Lanjutkan <ChevronRight size={14} />
              </button>
              <button
                onClick={() => setConfirmDiscard(true)}
                className="flex items-center justify-center gap-1 rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
              >
                <Trash2 size={13} /> Hapus
              </button>
            </div>
          )}
        </section>
      )}

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
                <SyncBadge state={stateOf(t.id, t.synced)} />
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
