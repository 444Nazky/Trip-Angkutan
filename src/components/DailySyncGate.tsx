import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Cloud, Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { useApp } from '../pages/store'
import { syncNow } from '../services/sync'
import { prefetchAllCriticalData } from '../services/prefetch'
import { markSyncedToday, needsDailySync, todayKey } from '../services/syncPolicy'

/**
 * Gerbang sinkron wajib per ganti tanggal.
 *
 * Muncul setiap hari (tanggal 1, lalu tanggal 2, dst.) sampai petugas
 * menekan Sinkron dan server menerima data. Tidak ada sinkron otomatis:
 * gerbang ini yang memandu satu-satunya jalur sinkron master + antrean.
 */
export default function DailySyncGate() {
  const { refreshOfficers } = useApp()
  const [visible, setVisible] = useState(() => needsDailySync())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [offlineAllowed, setOfflineAllowed] = useState(false)
  const [doneInfo, setDoneInfo] = useState('')
  const lastDateRef = useRef(todayKey())

  useEffect(() => {
    const check = () => {
      const today = todayKey()
      if (today !== lastDateRef.current) {
        lastDateRef.current = today
        setOfflineAllowed(false)
        setDoneInfo('')
      }
      setVisible(needsDailySync())
    }
    const timer = window.setInterval(check, 30_000)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [])

  const runSync = useCallback(async () => {
    setBusy(true)
    setError('')
    setDoneInfo('')
    try {
      const [queue, master] = await Promise.all([
        syncNow(),
        prefetchAllCriticalData({ force: true }),
      ])
      void refreshOfficers(true)
      const reachable = queue.reachable !== false && master.success
      if (!reachable) {
        setError('Server tidak terjangkau. Coba lagi saat online.')
        setOfflineAllowed(true)
        return
      }
      markSyncedToday()
      setDoneInfo(
        queue.failed > 0
          ? `Master data diperbarui, tetapi ${queue.failed} trip masih menunggu. Coba sinkron lagi.`
          : 'Sinkron berhasil. Data master dan trip sudah diperbarui.',
      )
      setVisible(false)
    } catch {            setError('Sinkron gagal. Periksa koneksi lalu coba lagi.')
      setOfflineAllowed(true)
    } finally {
      setBusy(false)
    }
  }, [refreshOfficers])

  if (!visible) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
            <Cloud size={22} />
          </span>
          <div>
            <h2 className="text-[15px] font-black text-slate-900">Wajib Sinkron Hari Ini</h2>
            <p className="text-[11px] text-slate-500">Berlaku sekali setiap ganti tanggal</p>
          </div>
        </div>

        <p className="mb-4 text-[12px] leading-relaxed text-slate-600">
          Sinkronkan master dan trip. Berlaku sampai tanggal berganti.
        </p>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] text-red-700">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" /> {error}
          </div>
        )}
        {doneInfo && (
          <div className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[11px] text-emerald-700">
            {doneInfo}
          </div>
        )}

        <button
          onClick={() => void runSync()}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-3.5 text-sm font-bold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}
          {busy ? 'Menyinkronkan…' : 'Sinkron Sekarang'}
        </button>

        {offlineAllowed && (
          <button
            onClick={() => setVisible(false)}
            className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-slate-200 py-2.5 text-[11px] font-semibold text-slate-500"
          >
            <WifiOff size={13} /> Lanjut tanpa sinkron (offline)
          </button>
        )}
      </div>
    </div>
  )
}
