import { useState, useEffect } from 'react'
import { Truck, Wifi, WifiOff, Cloud, CloudOff, AlertTriangle, FileText, Clock, ChevronRight, Ban } from 'lucide-react'
import { fmtDate, fmtTime, useApp } from '../store'
import { classifyTripSync, onSyncQueueChange, type SyncItem, type TripSyncState } from '../../services/sync'
import {
  draftExpired,
  draftPhotoCount,
  draftRemainingMs,
  draftResumeTarget,
  draftRouteLabel,
  formatDraftRemaining,
  hasCountedDraft,
} from '../../services/tripDraft'
import { onCancelQueueChange, readDeliveredCancels, type DeliveredCancel } from '../../services/tripCancel'
import { api, isIntranetBaseUrl, pingBaseUrl } from '../../services/api'
import CancelTripDialog from '../../components/CancelTripDialog'
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
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    let active = true
    let checking = false

    const checkIntranet = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsConnected(false)
        return
      }

      const endpoint = api.baseUrl
      if (!isIntranetBaseUrl(endpoint)) {
        setIsConnected(false)
        return
      }
      if (checking) return

      checking = true
      try {
        const result = await pingBaseUrl(endpoint, 4000)
        if (active) {
          setIsConnected(result.ok && typeof navigator !== 'undefined' && navigator.onLine && api.baseUrl === endpoint)
        }
      } catch {
        if (active) setIsConnected(false)
      } finally {
        checking = false
      }
    }

    const handleOnline = () => { void checkIntranet() }
    const handleOffline = () => setIsConnected(false)
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void checkIntranet()
    }, 15_000)

    void checkIntranet()
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  return (
    <div className={`flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all ${
      isConnected
        ? 'bg-emerald-50 text-emerald-600'
        : 'bg-slate-100 text-slate-500'
    }`}>
      {isConnected ? <Wifi size={12} /> : <WifiOff size={12} />}
      {isConnected ? 'Online' : 'Offline'}
    </div>
  )
}




interface HistoryScreenProps {
  go: (s: MobileScreen) => void
}




export default function HistoryScreen({ go }: HistoryScreenProps) {
  const { trips, setDetailTripId, officer, draft, draftInfo, draftLocked, draftTtlMinutes, cancelDraft } = useApp()
  const [filter, setFilter] = useState<'all' | 'muatan' | 'kosong'>('all')

  // Antrean sync = sumber status pengiriman (bukan `trip.synced` saja),
  // supaya trip yang ditolak server tampil "Gagal", bukan "Terkirim".
  const [queue, setQueue] = useState<SyncItem[]>([])
  useEffect(() => onSyncQueueChange((_n, q) => setQueue(q)), [])
  const stateOf = (id: string, synced: boolean | undefined) =>
    classifyTripSync(id, synced, queue).state

  // Draft trip yang belum terkirim: tampil di Riwayat supaya petugas yang
  // tidak sengaja menutup form bisa melanjutkannya, bukan mengulang dari nol.
  //
  // ATURAN DRAFT: yang ditampilkan hanya draft yang sudah TERHITUNG, yaitu
  // petugas sudah menginput minimal 1 kendaraan (untuk trip kosong: minimal
  // foto bukti). Isian yang baru berupa status muatan atau rute belum
  // dihitung sebagai draft, jadi tidak muncul di sini.
  const draftActive = hasCountedDraft(draft)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!draftActive) {
      setCancelOpen(false)
      return
    }
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [draftActive, draftInfo?.expiresAt])
  const draftRemaining = draftRemainingMs(draftInfo, now)
  const draftChangedAt = draftInfo ? new Date(draftInfo.savedAt) : null
  // Draft yang lewat batas 15 menit: isiannya dibekukan (tidak bisa diedit /
  // menambah kendaraan), tapi masih boleh dikirim atau dibatalkan.
  const expired = draftLocked || draftExpired(draftInfo, now)

  // Dokumen pembatalan yang belum sampai ke server.
  const [pendingCancels, setPendingCancels] = useState<string[]>([])
  const [deliveredCancels, setDeliveredCancels] = useState<Record<string, DeliveredCancel>>({})
  // Langganan (bukan baca sekali) supaya teks "menunggu dikirim" berubah
  // sendiri begitu dokumen batal diterima server.
  useEffect(() => {
    let alive = true
    const off = onCancelQueueChange(items => {
      if (!alive) return
      setPendingCancels(items.map(i => i.cancelId))
      void readDeliveredCancels().then(map => { if (alive) setDeliveredCancels(map) })
    })
    return () => { alive = false; off() }
  }, [])

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

  const canceledCount = myTrips.filter(t => t.canceled).length
  const syncedCount = myTrips.filter(t => !t.canceled && stateOf(t.id, t.synced) === 'synced').length
  const failedCount = myTrips.filter(t => stateOf(t.id, t.synced) === 'failed').length
  const localCount = myTrips.filter(t => {
    if (t.canceled) return false
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
        {canceledCount > 0 && (
          <div className="flex items-center gap-1 bg-red-50 text-red-600 px-3 py-1.5 rounded-full font-semibold">
            <Ban size={10} />
            <span>{canceledCount} dibatalkan</span>
          </div>
        )}
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

      {/* Draft trip yang belum terkirim — bisa dilanjutkan, dikirim, atau dibatalkan */}
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
            <span className={`flex shrink-0 items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[10px] font-bold ring-1 ${
              expired ? 'text-red-700 ring-red-200' : 'text-amber-700 ring-amber-200'
            }`}>
              <Clock size={10} />
              {expired
                ? 'Kedaluwarsa'
                : draftInfo
                  ? `Sisa ${formatDraftRemaining(draftRemaining)}`
                  : `Sisa ${draftTtlMinutes} mnt`}
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
            {expired
              ? 'Draft kedaluwarsa. Kirim atau batalkan untuk membuka Mulai Trip.'
              : 'Lanjutkan atau batalkan draft untuk membuka Mulai Trip.'}
          </p>

          <div className="mt-3 flex gap-2">
            {expired ? (
              <button
                onClick={() => go('trip-summary')}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-[12px] font-semibold text-white hover:bg-slate-800 active:scale-[0.99]"
              >
                Kirim Trip <ChevronRight size={14} />
              </button>
            ) : (
              <button
                onClick={() => go(draftResumeTarget(draft))}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-900 py-2.5 text-[12px] font-semibold text-white hover:bg-slate-800 active:scale-[0.99]"
              >
                Lanjutkan <ChevronRight size={14} />
              </button>
            )}
            <button
              onClick={() => setCancelOpen(true)}
              className="flex items-center justify-center gap-1 rounded-xl border border-amber-300 bg-white px-3 py-2.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
            >
              <Ban size={13} /> Batalkan
            </button>
          </div>
        </section>
      )}

      <CancelTripDialog
        open={cancelOpen}
        title="Batalkan Draft"
        summary={`${draftRouteLabel(draft)} · ${draft.vehicles.length} kendaraan · ${draftPhotoCount(draft)} foto`}
        onClose={() => setCancelOpen(false)}
        onConfirm={(reason, note) => {
          cancelDraft(reason, note)
          setCancelOpen(false)
        }}
      />

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
                {t.canceled ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full">
                    <Ban size={10} /> Dibatalkan
                  </span>
                ) : (
                  <SyncBadge state={stateOf(t.id, t.synced)} />
                )}
              </div>
              <p className="font-mono text-[11px] text-slate-400">{t.id}</p>
              {t.canceled && (
                <p className="mt-1 text-[10px] leading-relaxed text-red-600">
                  Alasan: {t.cancelReason || '-'}
                  {t.cancelNote ? ` — ${t.cancelNote}` : ''}
                  {t.cancelId && pendingCancels.includes(t.cancelId)
                    ? ' · dokumen pembatalan menunggu dikirim'
                    : t.cancelId && deliveredCancels[t.cancelId]
                      ? ' · dokumen pembatalan sudah diterima server'
                      : ' · status dokumen pembatalan belum terkonfirmasi'}
                </p>
              )}
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
