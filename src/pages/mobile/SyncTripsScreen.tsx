import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowLeft, CheckCircle2, ChevronRight, CloudOff, Loader2, RefreshCw, Send } from 'lucide-react'
import { useApp } from '../store'
import type { MobileScreen } from '../types'
import {
  classifyTripSync,
  onSyncQueueChange,
  retrySyncItem,
  syncNow,
  syncTripNow,
  type SyncItem,
} from '../../services/sync'

interface SyncTripsScreenProps {
  go: (s: MobileScreen) => void
  onBack: () => void
}

/**
 * Daftar trip yang belum terkirim.
 *
 * Sinkron otomatis sudah dihapus, jadi layar ini adalah tempat petugas melihat
 * antrean, membaca alasan gagal, dan mengirim ulang secara manual.
 */
export default function SyncTripsScreen({ go, onBack }: SyncTripsScreenProps) {
  const { trips, officer, setDetailTripId } = useApp()
  const [queue, setQueue] = useState<SyncItem[]>([])
  const [busy, setBusy] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)
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

  const sendTrip = async (trip: (typeof rows)[number]['trip']) => {
    if (busy || sendingId) return
    setSendingId(String(trip.id))
    setMessage('')
    setFailed(false)
    try {
      const result = await syncTripNow(trip)
      if (result.ok) {
        setMessage('Trip berhasil dikirim.')
      } else {
        setFailed(true)
        setMessage(result.error ?? 'Trip belum diterima server.')
      }
    } catch {
      setFailed(true)
      setMessage('Pengiriman gagal. Periksa koneksi lalu coba lagi.')
    } finally {
      setSendingId(null)
    }
  }

  const openDetail = (id: string) => {
    setDetailTripId(id)
    go('history-detail')
  }

  return (
    <div className="space-y-4 px-4 pb-4 pt-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={onBack}
            aria-label="Kembali"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 active:scale-95"
          >
            <ArrowLeft size={17} />
          </button>
          <div className="min-w-0">
            <h2 className="font-black text-slate-900 text-[20px] leading-tight">Trip Belum Terkirim</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">{rows.length} trip menunggu dikirim.</p>
          </div>
        </div>
        <button
          onClick={() => void runSync()}
          disabled={busy || rows.length === 0}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-2.5 text-[11px] font-bold text-white disabled:opacity-40"
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {busy ? 'Mengirim…' : 'Kirim Semua'}
        </button>
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
        <div className="rounded-2xl border border-slate-100 bg-white px-6 py-10 text-center shadow-sm">
          <CheckCircle2 size={30} className="mx-auto text-emerald-500" />
          <p className="mt-3 text-[14px] font-bold text-slate-700">Semua trip sudah terkirim</p>
          <p className="mt-1 text-[12px] text-slate-400">Tidak ada data yang menunggu.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map(({ trip, status }) => (
            <div
              key={trip.id}
              className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <button
                  onClick={() => openDetail(trip.id)}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left active:opacity-70"
                >
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${
                    status.state === 'failed'
                      ? 'bg-red-50 text-red-500'
                      : status.state === 'pending'
                        ? 'bg-amber-50 text-amber-500'
                        : 'bg-slate-100 text-slate-400'
                  }`}>
                    {status.state === 'failed' ? <AlertTriangle size={20} /> : <CloudOff size={20} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <p className="truncate text-[14px] font-bold text-slate-900">
                        {trip.routeFrom && trip.routeTo ? `${trip.routeFrom} → ${trip.routeTo}` : trip.route || 'Trip'}
                      </p>
                      <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold ${
                        status.state === 'failed'
                          ? 'bg-red-50 text-red-600'
                          : status.state === 'pending'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-slate-100 text-slate-500'
                      }`}>
                        {status.state === 'failed' ? 'GAGAL' : status.state === 'pending' ? 'MENUNGGU' : 'BELUM ANTRE'}
                      </span>
                    </div>
                    <p className="font-mono text-[11px] text-slate-400">{trip.id}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                      <span>{trip.date} · {trip.time}</span>
                      <span>{trip.officer || officer.name}</span>
                      <span>{trip.vehicles?.length ?? 0} unit</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${trip.load === 'Ada Muatan' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                        {trip.load}
                      </span>
                    </div>
                    {status.state === 'failed' && status.error && (
                      <p className="mt-2 line-clamp-2 text-[10px] font-semibold text-red-600">{status.error}</p>
                    )}
                  </div>
                  <ChevronRight size={16} className="mt-3 shrink-0 text-slate-300" />
                </button>
                <button
                  onClick={() => void sendTrip(trip)}
                  disabled={busy || !!sendingId}
                  className="inline-flex shrink-0 items-center gap-1 self-center rounded-xl bg-blue-600 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-40"
                  title="Kirim trip ini saja"
                >
                  {sendingId === String(trip.id)
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Send size={12} />}
                  {sendingId === String(trip.id) ? 'Mengirim…' : 'Kirim'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
