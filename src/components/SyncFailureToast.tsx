import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { onSyncFailure, type SyncFailureDetail } from '../services/sync'

/**
 * Notifikasi "Gagal terkirim" untuk aplikasi mobile.
 *
 * Tujuan: setiap kegagalan sinkronisasi memunculkan kartu merah berisi
 * alasannya. Sebelumnya kegagalan hanya tersembunyi di state antrean, jadi
 * petugas bisa saja melihat tampilan hijau "Terkirim" di tempat lain dan
 * mengira datanya sudah masuk ke dashboard admin.
 *
 * Notifikasi yang sama untuk trip yang sama tidak diulang dalam 30 detik
 * (percobaan ulang otomatis bisa memunculkan belasan error beruntun).
 */
const REPEAT_SUPPRESS_MS = 30_000

export default function SyncFailureToast() {
  const [detail, setDetail] = useState<SyncFailureDetail | null>(null)
  const lastShown = useRef<{ tripId: string; at: number } | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    const off = onSyncFailure(d => {
      const now = Date.now()
      const prev = lastShown.current
      if (prev && prev.tripId === d.tripId && now - prev.at < REPEAT_SUPPRESS_MS) return
      lastShown.current = { tripId: d.tripId, at: now }
      setDetail(d)
      if (timer.current) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setDetail(null), 8000)
    })
    return () => {
      off()
      if (timer.current) window.clearTimeout(timer.current)
    }
  }, [])

  if (!detail) return null

  const headline = detail.permanent
    ? 'Gagal terkirim ke server'
    : 'Belum terkirim (menunggu koneksi)'

  return (
    <div className="fixed inset-x-3 bottom-4 z-[90] flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-red-200 bg-red-50 shadow-lg shadow-red-900/10 p-3.5 flex items-start gap-3">
        <span className="mt-0.5 shrink-0 w-7 h-7 rounded-xl bg-red-500 text-white flex items-center justify-center">
          <AlertTriangle size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black text-red-700">{headline}</p>
          <p className="text-[11px] text-red-600 mt-0.5 break-words">
            {detail.error}
            {detail.permanent
              ? ' — data belum masuk dashboard admin. Buka Riwayat untuk melengkapi data lalu kirim ulang.'
              : ' — data tersimpan di perangkat dan akan dikirim otomatis saat koneksi tersedia.'}
          </p>
        </div>
        <button
          onClick={() => setDetail(null)}
          className="shrink-0 text-red-400 hover:text-red-600 p-1"
          aria-label="Tutup notifikasi"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
