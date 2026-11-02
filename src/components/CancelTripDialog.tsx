import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Ban } from 'lucide-react'

interface CancelTripDialogProps {
  open: boolean
  /** Judul singkat, mis. "Batalkan Draft" / "Batalkan Trip". */
  title?: string
  /** Ringkasan isi trip yang dibatalkan (biar petugas yakin). */
  summary?: string
  onClose: () => void
  /** Dipanggil saat alasan terkumpul. */
  onConfirm: (reason: string) => void
}

/**
 * Dialog pembatalan trip.
 *
 * Alasan WAJIB diisi manual (maks. 55 huruf): pembatalan menghasilkan dokumen
 * yang dikirim ke server, jadi tanpa alasan admin tidak bisa menindaklanjuti.
 * Petugas mengetik sendiri alasannya — tidak ada daftar pilihan, supaya
 * alasan yang tidak tercakup daftar baku tetap bisa dicatat.
 */
export default function CancelTripDialog({
  open,
  title = 'Batalkan Trip',
  summary,
  onClose,
  onConfirm,
}: CancelTripDialogProps) {
  const [reason, setReason] = useState<string>('')

  useEffect(() => {
    if (open) {
      setReason('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  const canSubmit = reason.trim().length > 0

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      style={{ position: 'fixed', inset: 0 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="cancel-trip-dialog-title"
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 id="cancel-trip-dialog-title" className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Ban size={18} className="text-red-500" /> {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Tutup"
            className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
          >
            <X size={16} />
          </button>
        </div>

        {summary && (
          <p className="mb-3 rounded-xl bg-slate-50 px-3 py-2 text-[11px] text-slate-600 ring-1 ring-slate-200">
            {summary}
          </p>
        )}

        <p className="mb-2 text-[12px] font-semibold text-slate-700">
          Alasan pembatalan <span className="text-red-500">*</span>
        </p>
        <input
          value={reason}
          onChange={e => setReason(e.target.value.slice(0, 55))}
          maxLength={55}
          placeholder="Ketik alasan pembatalan (maks. 55 huruf)"
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-[12px] text-slate-800 focus:outline-none focus:ring-2 focus:ring-red-300"
        />
        {reason.length > 0 && (
          <p className="mt-1 text-[10px] text-slate-500">
            {reason.length}/55 huruf
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-xl border border-slate-200 bg-transparent py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            Kembali
          </button>
          <button
            onClick={() => { if (canSubmit) onConfirm(reason.trim()) }}
            disabled={!canSubmit}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold text-white transition-colors ${
              canSubmit ? 'bg-red-500 hover:bg-red-600' : 'cursor-not-allowed bg-slate-300'
            }`}
          >
            Batalkan Trip
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
