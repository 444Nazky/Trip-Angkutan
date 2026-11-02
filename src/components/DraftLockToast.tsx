import { useEffect } from 'react'
import { AlertTriangle, History, PlayCircle, X } from 'lucide-react'

/**
 * Notifikasi panduan untuk draft trip yang belum dikirim.
 *
 * Muncul ketika petugas mengetuk tombol "Mulai Trip" padahal masih ada
 * draft yang belum dikirim. Isinya memberi tahu dua jalan keluar yang
 * memang tersedia: LANJUTKAN isian yang sudah ada, atau HAPUS draft itu di
 * halaman Riwayat (dibatalkan dengan alasan, bukan dihapus diam-diam).
 */
interface DraftLockToastProps {
  visible: boolean
  onClose: () => void
  onGoHistory: () => void
  /** Lanjutkan isian draft yang sudah ada (opsional). */
  onContinue?: () => void
  /** Sisa umur draft dalam milidetik — dipakai untuk menyorot urgency. */
  remainingMs?: number
}

/** Notifikasi ini menutup sendiri setelah beberapa detik. */
const AUTO_CLOSE_MS = 9000

export default function DraftLockToast({
  visible,
  onClose,
  onGoHistory,
  onContinue,
  remainingMs,
}: DraftLockToastProps) {
  useEffect(() => {
    if (!visible) return
    const timer = window.setTimeout(onClose, AUTO_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [visible, onClose])

  if (!visible) return null

  const remainingLabel = (() => {
    if (remainingMs == null) return null
    const minutes = Math.ceil(remainingMs / 60000)
    if (minutes <= 0) return 'Draft sudah lewat batas waktu'
    return `Sisa waktu draft sekitar ${minutes} menit`
  })()

  return (
    <div className="fixed inset-x-3 bottom-4 z-[90] flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md rounded-2xl border border-amber-200 bg-amber-50 shadow-lg shadow-amber-900/10 p-3.5 flex items-start gap-3">
        <span className="mt-0.5 shrink-0 w-7 h-7 rounded-xl bg-amber-500 text-white flex items-center justify-center">
          <AlertTriangle size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-black text-amber-800">Trip baru belum bisa dimulai</p>
          <p className="text-[11px] text-amber-700 mt-0.5 leading-relaxed">
            Masih ada draft trip yang belum dikirim. Lanjutkan atau hapus draft di halaman
            Riwayat (hapus berarti batalkan dengan alasan), lalu tombol Mulai Trip bisa dipakai
            lagi.
          </p>
          {remainingLabel && (
            <p className="text-[10px] font-semibold text-amber-600 mt-1">{remainingLabel}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {onContinue && (
              <button
                onClick={onContinue}
                className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-amber-600 active:scale-[0.98] transition-all"
              >
                <PlayCircle size={12} /> Lanjutkan Draft
              </button>
            )}
            <button
              onClick={onGoHistory}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-bold text-amber-700 hover:bg-amber-100 active:scale-[0.98] transition-all"
            >
              <History size={12} /> Buka Riwayat
            </button>
          </div>
zr        </div>
        <button
          onClick={onClose}
          className="shrink-0 text-amber-400 hover:text-amber-600 p-1"
          aria-label="Tutup notifikasi"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
