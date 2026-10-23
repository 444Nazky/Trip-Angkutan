import { useEffect, useState } from 'react'
import { Check, CheckCircle2, CloudOff, Clock, RefreshCw, AlertTriangle } from 'lucide-react'
import { useApp } from '../store'
import { classifyTripSync, onSyncQueueChange, processSyncQueue, refreshSyncQueue, type SyncItem } from '../../services/sync'
import type { MobileScreen } from '../types'

interface TripCompleteScreenProps {
  go: (s: MobileScreen) => void
}

/**
 * Layar konfirmasi trip. Status sinkronisasi HARUS jujur:
 * - tersimpan lokal + belum terkirim  -> amber (menunggu)
 * - sudah terkirim ke server          -> hijau
 * - gagal permanen / butuh perhatian  -> merah + tombol coba lagi
 *
 * Sebelumnya layar ini selalu hijau "Trip Selesai!" walau server belum
 * menerima apa pun, sehingga petugas mengira data sudah masuk.
 */
export default function TripCompleteScreen({ go }: TripCompleteScreenProps) {
  const { trips, detailTripId } = useApp()
  const t = trips.find(x => x.id === detailTripId)

  const [queue, setQueue] = useState<SyncItem[]>([])
  useEffect(() => onSyncQueueChange((_n, q) => setQueue(q)), [])

  useEffect(() => {
    if (!detailTripId) go('home')
    processSyncQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!t) return null

  // SATU sumber kebenaran: antrean sync. `t.synced` saja tidak cukup —
  // trip yang ditolak server (4xx) tetap `synced === false` tapi harus
  // ditampilkan sebagai GAGAL, bukan "menunggu".
  const syncStatus = classifyTripSync(t.id, t.synced, queue)
  const failed = syncStatus.state === 'failed'
  const pending = syncStatus.state === 'pending'
  const synced = syncStatus.state === 'synced'

  const status = failed
    ? {
        tone: 'border-red-200 bg-red-50',
        icon: 'text-red-500',
        text: 'text-red-700',
        title: 'Gagal Terkirim ke Server',
        detail: syncStatus.error
          ? `${syncStatus.error}${syncStatus.attempts > 1 ? ` (percobaan ${syncStatus.attempts})` : ''}`
          : 'Server menolak data. Periksa lalu coba lagi.',
        Icon: AlertTriangle,
      }
    : pending
      ? {
          tone: 'border-amber-200 bg-amber-50',
          icon: 'text-amber-500',
          text: 'text-amber-700',
          title: 'Menunggu Sinkronisasi',
          detail: 'Tersimpan di perangkat. Data akan dikirim saat koneksi tersedia.',
          Icon: Clock,
        }
      : synced
        ? {
            tone: 'border-emerald-200 bg-emerald-50',
            icon: 'text-emerald-500',
            text: 'text-emerald-700',
            title: 'Terkirim ke Server',
            detail: 'Data trip sudah diterima server kantor.',
            Icon: CheckCircle2,
          }
        : {
            tone: 'border-slate-200 bg-slate-50',
            icon: 'text-slate-400',
            text: 'text-slate-600',
            title: 'Tersimpan di Perangkat',
            detail: 'Belum masuk antrean sinkronisasi. Coba kirim ulang.',
            Icon: Clock,
          }

  const unitCount = t.vehicles && t.vehicles.length > 0
    ? t.vehicles.length
    : (t.vehicle !== '-' ? 1 : 0)

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col items-center">
      <div className={`w-20 h-20 rounded-3xl flex items-center justify-center mb-4 ${
        failed ? 'bg-red-100' : pending ? 'bg-amber-100' : 'bg-emerald-100'
      }`}>
        <Check size={38} className={failed ? 'text-red-500' : pending ? 'text-amber-500' : 'text-emerald-500'} strokeWidth={3} />
      </div>
      <h2 className="font-black text-slate-900 text-[24px] mb-1 text-center">
        {failed ? 'Trip Gagal Dikirim!' : 'Trip Tercatat!'}
      </h2>
      <p className="text-slate-500 text-[13px] text-center mb-5">
        {failed
          ? `Trip ${t.id} BELUM masuk ke server — belum ada data di dashboard admin`
          : `Trip ${t.id} tersimpan di perangkat`}
      </p>

      <div className="w-full bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Rute', val: t.route },
            { label: 'Durasi', val: t.duration },
            { label: 'Kendaraan', val: unitCount > 0 ? `${unitCount} unit` : 'Kosong' },
            { label: 'Kondisi', val: t.load },
          ].map(({ label, val }) => (
            <div key={label}>
              <p className="text-slate-500 text-[10px] mb-0.5">{label}</p>
              <p className="text-white font-bold text-[13px]">{val}</p>
            </div>
          ))}
        </div>
      </div>

      <div className={`w-full border rounded-2xl p-4 mb-5 flex items-center gap-3 ${status.tone}`}>
        <status.Icon size={18} className={status.icon} strokeWidth={2.5} />
        <div className="min-w-0 flex-1">
          <p className={`text-[12px] font-bold ${status.text}`}>{status.title}</p>
          <p className={`text-[10px] ${status.text} opacity-90`}>
            {t.date} · {t.time} · {status.detail}
          </p>
        </div>
        {(failed || pending || syncStatus.state === 'local') && (
          <button
            onClick={() => { void processSyncQueue({ retryAll: true }); refreshSyncQueue() }}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-700 text-[10px] font-bold"
            title="Kirim ulang ke server"
          >
            <RefreshCw size={11} /> Coba
          </button>
        )}
      </div>

      <div className="flex gap-3 w-full">
        <button
          onClick={() => go('history-detail')}
          className="flex-1 py-3.5 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold text-[13px] hover:bg-slate-50"
        >
          Lihat Detail
        </button>
        <button
          onClick={() => go('home')}
          className="flex-1 py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-[13px] hover:bg-blue-700"
        >
          Kembali ke Home
        </button>
      </div>
    </div>
  )
}
