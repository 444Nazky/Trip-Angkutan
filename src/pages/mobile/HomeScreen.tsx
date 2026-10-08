import { Truck, ChevronRight, ArrowRight, RefreshCw } from 'lucide-react'
import { useApp } from '../store'
import { getPendingCount, onSyncQueueChange, syncNow } from '../../services/sync'
import { useState, useEffect } from 'react'
import type { MobileScreen } from '../types'

interface HomeScreenProps {
  go: (s: MobileScreen) => void
  /** Dipanggil saat petugas menekan "Mulai Trip". MobileApp menangani cek dual-access dermaga. */
  onStartTrip: () => void
}

type SyncState = { synced: number; failed: number; busy?: boolean; reachable?: boolean } | null

export default function HomeScreen({ go, onStartTrip }: HomeScreenProps) {
  const { officer, trips, resetDraft, setDetailTripId } = useApp()
  const [pendingCount, setPendingCount] = useState(getPendingCount)
  const [syncState, setSyncState] = useState<SyncState>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    // Refresh count saat focus window
    const h = () => setPendingCount(getPendingCount())
    window.addEventListener('focus', h)
    const unsub = onSyncQueueChange(setPendingCount)
    setPendingCount(getPendingCount())
    return () => { window.removeEventListener('focus', h); unsub() }
  }, [])

  /** TOMBOL MANUAL — "Paksa Sinkronisasi". Verifikasi koneksi memakai ping
   *  aktif, jadi tetap bisa ditekan walau navigator.onLine salah baca. */
  const handleSync = async () => {
    if (busy) return
    setBusy(true)
    setSyncState(null)
    try {
      const r = await syncNow()
      setSyncState(r)
      setPendingCount(getPendingCount())
      if (r.failed === 0) {
        setTimeout(() => { setSyncState(null); setPendingCount(getPendingCount()) }, 3500)
      }
    } finally {
      setBusy(false)
      setPendingCount(getPendingCount())
    }
  }

  const syncLabel = (() => {
    if (busy) return 'Menyinkronkan…'
    if (syncState && syncState.reachable === false) return 'Offline — server belum terjangkau'
    if (syncState && syncState.failed === 0) return `${syncState.synced} trip tersinkron ✓`
    if (syncState && syncState.failed > 0) return `${syncState.failed} belum terkirim — ketuk untuk ulangi`
    if (pendingCount > 0) return `${pendingCount} trip menunggu sinkronisasi`
    return 'Semua data sudah tersinkron'
  })()

  const syncTone = (() => {
    if (syncState && syncState.reachable === false) return 'amber'
    if (syncState && syncState.failed === 0) return 'green'
    if (syncState && syncState.failed > 0) return 'red'
    if (busy || pendingCount > 0) return 'amber'
    return 'slate'
  })()

  const myTrips = trips.filter(t =>
    t.officerId ? String(t.officerId) === String(officer.id) : t.officer === officer.name,
  )
  // Tanpa akses dermaga → trip tidak bisa dimulai. Daripada senyap (console.warn),
  // tampilkan pesan yang bisa dibaca petugas dan arahkan ke admin.
  const hasDockAccess = (officer.dermagaAccess?.length ?? 0) > 0
  const units = new Set(
    myTrips
      .flatMap(t => (t.vehicles && t.vehicles.length ? t.vehicles.map(v => v.plate) : [t.vehicle]))
      .filter(p => p && p !== '-'),
  )
  return (
    <div className="flex flex-col px-4 pt-2 pb-4" style={{ gap: 16 }}>
      {/* Trip CTA */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-[28px] p-5 relative overflow-hidden">
        <div className="absolute right-4 top-4 w-24 h-24 rounded-full bg-white/10" />
        <div className="absolute right-10 bottom-3 w-14 h-14 rounded-full bg-blue-800/40" />
        <div className="relative">
          <p className="text-blue-100 text-[13px] font-semibold mb-1">Siap bertugas?</p>
          <h2 className="text-white font-black text-[22px] leading-tight mb-4">Mulai Trip<br />Baru Sekarang</h2>
          {hasDockAccess ? (
            <button
              onClick={() => { resetDraft(); onStartTrip() }}
              className="bg-white text-blue-700 font-bold py-3.5 rounded-2xl text-[14px] hover:bg-blue-50 active:scale-95 transition-all w-full flex items-center justify-center gap-2 shadow-lg"
            >
              Mulai Trip <ArrowRight size={16} />
            </button>
          ) : (
            <div className="rounded-2xl bg-white/15 border border-white/25 px-4 py-3.5 text-center">
              <p className="text-white font-black text-[13px]">Hubungi Admin</p>
              <p className="text-blue-100 text-[11px] leading-snug mt-1">
                Akun ini belum memiliki akses dermaga — trip belum bisa dimulai.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Sinkronisasi — tombol PAKSA SINKRONISASI manual petugas */}
      {(busy || pendingCount > 0 || !!syncState) && (
        <button
          onClick={() => { void handleSync() }}
          disabled={busy}
          className={`w-full border rounded-2xl p-4 flex items-center gap-3 transition-colors ${
            syncTone === 'green'
              ? 'bg-green-50 border-green-200 hover:bg-green-100'
              : syncTone === 'red'
                ? 'bg-red-50 border-red-200 hover:bg-red-100'
                : syncTone === 'slate'
                  ? 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  : 'bg-amber-50 border-amber-200 hover:bg-amber-100'
          } disabled:cursor-default`}
        >
          <RefreshCw
            size={18}
            className={`${busy || pendingCount > 0 ? 'animate-spin ' : ''}${
              syncTone === 'green' ? 'text-emerald-500'
                : syncTone === 'red' ? 'text-red-500'
                : syncTone === 'slate' ? 'text-slate-400'
                : 'text-amber-500'
            }`}
          />
          <span className={`text-[13px] font-semibold flex-1 text-left ${
            syncTone === 'green' ? 'text-green-700'
              : syncTone === 'red' ? 'text-red-600'
              : syncTone === 'slate' ? 'text-slate-500'
              : 'text-amber-700'
          }`}>
            {syncLabel}
          </span>
          <span className={`text-[11px] font-black px-2.5 py-1 rounded-full bg-white/80 border ${
            syncTone === 'slate'
              ? 'text-slate-500 border-slate-200'
              : syncTone === 'green'
                ? 'text-green-700 border-green-200'
                : syncTone === 'red'
                  ? 'text-red-600 border-red-200'
                  : 'text-amber-700 border-amber-200'
          }`}>
            {busy ? 'Memproses…' : 'Paksa Sinkronisasi'}
          </span>
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
