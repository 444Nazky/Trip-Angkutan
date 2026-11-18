import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronRight, CloudOff, Loader2, RefreshCw } from 'lucide-react'
import { useApp } from '../store'
import type { MobileScreen } from '../types'
import {
  classifyTripSync,
  onSyncQueueChange,
  retrySyncItem,
  syncNow,
  type SyncItem,
} from '../../services/sync'

interface SyncTripsScreenProps {
  go: (s: MobileScreen) => void
}

/**
 * Daftar trip yang belum terkirim.
 *
 * Sinkron otomatis sudah dihapus, jadi layar ini adalah tempat petugas melihat
 * antrean, membaca alasan gagal, dan mengirim ulang secara manual.
 */
export default function SyncTripsScreen({ go }: SyncTripsScreenProps) {
  const { trips, officer, setDetailTripId } = useApp()
  const [queue, setQueue] = useState<SyncItem[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => onSyncQueueChange((_n, q) => setQueue(q)), [])

  const rows = useMemo(() => {
    const byId = new Map<string, { trip: (typeof trips)[number]; status: ReturnType<typeof classifyTripSync> }>()
    for (const t of trips) {
      if (t.canceled || t.synced === true) continue
      byId.set(String(t.id), { trip: t, status: classifyTripSync(t.id, t.synced, queue) })
    }
    // Trip yang masih di antrean tetapi sudah tidak ada di daftar lokal tetap
    // ditampilkan supaya tidak ada data yang "hilang" dari pandangan petugas.
    for (const item of queue) {
      const id = String(item.trip?.id ?? '')
      if (!id || byId.has(id)) continue
      byId.set(id, { trip: item.trip, status: classifyTripSync(id, item.trip?.synced, queue) })
    }
    return [...byId.values()].sort((a, b) => {
      const ta = Date.parse(a.trip.completedAt ?? '') || 0
      const tb = Date.parse(b.trip.completedAt ?? '') || 0
      return tb - ta
    })
  }, [trips, queue])

  const pending = rows.filter(r => r.status.state === 'pending').length
  const failedCount = rows.filter(r => r.status.state === 'failed').length
  const local = rows.filter(r => r.status.state === 'local').length

  const runSync = async () => {
    if (busy) return
    setBusy(true)
    setMessage('')
    setFailed(false)
    try {
      for (const row of rows) {
        if (row.status.state === 'local') await retrySyncItem(row.trip)
      }
      if (rows.some(r => r.status.state === 'local')) {
        await new Promise(resolve => setTimeout(resolve, 400))
      }
      const result = await syncNow()
      if (result.reachable === false) {
        setFailed(true)
        setMessage('Server tidak terjangkau. Sambungkan ke jaringan kantor.')
      } else if (result.busy) {
        setMessage('Sinkron sedang berjalan. Tunggu sebentar.')
      } else if (result.failed > 0) {
        setFailed(true)
        setMessage(`${result.failed} trip masih gagal. Periksa pesan di bawah.`)
      } else {
        setMessage('Semua trip berhasil dikirim.')
      }
    } catch {
      setFailed(true)
      setMessage('Sinkron gagal. Periksa koneksi lalu coba lagi.')
    } finally {
      setBusy(false)
    }
  }

  const openDetail = (id: string) => {
    setDetailTripId(id)
    go('history-detail')
  }

  return (
    <div className="space-y-4 px-4 pb-6 pt-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-black text-slate-900">Sinkron Trip</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">Trip yang belum terkirim ke server.</p>
        </div>
        <button
          onClick={() => void runSync()}
          disabled={busy || rows.length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-[11px] font-bold text-white disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {busy ? 'Mengirim…' : 'Sinkron Semua'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-2 py-2">
          <p className="text-base font-black text-amber-700">{pending}</p>
          <p className="text-[9px] font-semibold text-amber-700">Menunggu</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-2 py-2">
          <p className="text-base font-black text-red-600">{failedCount}</p>
          <p className="text-[9px] font-semibold text-red-600">Gagal</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-2 py-2">
          <p className="text-base font-black text-slate-600">{local}</p>
          <p className="text-[9px] font-semibold text-slate-500">Belum antre</p>
        </div>
      </div>

      {message && (
        <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[11px] ${
          failed ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
        }`}>
          {failed ? <AlertTriangle size={14} className="mt-0.5 shrink-0" /> : <CheckCircle2 size={14} className="mt-0.5 shrink-0" />}
          <span>{message}</span>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-8 text-center">
          <CheckCircle2 size={30} className="mx-auto text-emerald-500" />
          <p className="mt-2 text-sm font-bold text-emerald-800">Semua trip terkirim</p>
          <p className="mt-1 text-[11px] text-emerald-700">Tidak ada data yang menunggu.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(({ trip, status }) => (
            <button
              key={trip.id}
              onClick={() => openDetail(trip.id)}
              className="flex w-full items-start gap-3 rounded-2xl border border-slate-200 bg-white p-3 text-left active:bg-slate-50"
            >
              <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                status.state === 'failed'
                  ? 'bg-red-50 text-red-600'
                  : status.state === 'pending'
                    ? 'bg-amber-50 text-amber-600'
                    : 'bg-slate-100 text-slate-500'
              }`}>
                {status.state === 'failed' ? <AlertTriangle size={16} /> : <CloudOff size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-[12px] font-bold text-slate-900">
                    {trip.routeFrom && trip.routeTo ? `${trip.routeFrom} → ${trip.routeTo}` : trip.route || 'Trip'}
                  </p>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${
                    status.state === 'failed'
                      ? 'bg-red-50 text-red-600'
                      : status.state === 'pending'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-slate-100 text-slate-500'
                  }`}>
                    {status.state === 'failed' ? 'GAGAL' : status.state === 'pending' ? 'MENUNGGU' : 'BELUM ANTRE'}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-slate-500">
                  {trip.date} · {trip.time} · {trip.officer || officer.name} · {trip.vehicles?.length ?? 0} unit
                </p>
                <p className="text-[10px] text-slate-500">
                  {trip.id} · {trip.load === 'Kosong' ? 'Ponton tanpa muatan' : 'Ponton dengan muatan'}
                </p>
                {status.state === 'failed' && status.error && (
                  <p className="mt-1 line-clamp-2 text-[10px] font-semibold text-red-600">{status.error}</p>
                )}
              </div>
              <ChevronRight size={16} className="mt-2 shrink-0 text-slate-300" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
