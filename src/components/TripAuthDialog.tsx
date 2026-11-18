import { useEffect, useRef, useState } from 'react'
import { Fingerprint, Loader2, ShieldCheck, X } from 'lucide-react'
import { useApp } from '../pages/store'
import { verifyBiometric } from '../services/biometric'
import MobileModal from './MobileModal'

interface TripAuthDialogProps {
  open: boolean
  onClose: () => void
  onVerified: () => void
  /** Judul dialog; bawaan untuk pengiriman trip. */
  title?: string
  subtitle?: string
}

/**
 * Gerbang sidik jari sebelum aksi penting (kirim trip, edit trip, tambah
 * kendaraan). HANYA sidik jari/passkey yang terdaftar di HP petugas — tidak ada
 * cadangan PIN. Kalau sensor tidak tersedia atau ditolak, petugas harus
 * mencoba lagi di perangkat yang sama.
 */
export default function TripAuthDialog({
  open,
  onClose,
  onVerified,
  title = 'Verifikasi Pengiriman',
  subtitle = 'Sebelum data trip dikirim ke server',
}: TripAuthDialogProps) {
  const { officer } = useApp()
  const [phase, setPhase] = useState<'checking' | 'failed'>('checking')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const attemptedRef = useRef(false)

  const applyResult = (result: Awaited<ReturnType<typeof verifyBiometric>>) => {
    if (result === 'ok') { onVerified(); return }
    setPhase('failed')
    if (result === 'unavailable') {
      setMessage('Perangkat ini belum memiliki sidik jari terdaftar. Daftarkan sidik jari di pengaturan HP petugas lalu coba lagi.')
      return
    }
    setMessage(result === 'cancelled'
      ? 'Verifikasi sidik jari dibatalkan. Coba lagi untuk melanjutkan.'
      : 'Sidik jari tidak cocok. Coba lagi dengan sidik jari yang terdaftar di HP ini.')
  }

  useEffect(() => {
    if (!open) {
      attemptedRef.current = false
      setPhase('checking')
      setMessage('')
      setBusy(false)
      return
    }
    if (attemptedRef.current) return
    attemptedRef.current = true
    let alive = true
    setPhase('checking')
    setMessage('')
    void verifyBiometric(officer).then(result => {
      if (alive) applyResult(result)
    })
    return () => { alive = false }
  }, [open, officer, onVerified])

  if (!open) return null

  const retryBiometric = async () => {
    setBusy(true)
    setMessage('')
    const result = await verifyBiometric(officer)
    setBusy(false)
    applyResult(result)
  }

  return (
    <MobileModal
      open={open}
      onClose={onClose}
      overlayClassName="bg-black/60"
      panelClassName="max-w-sm rounded-3xl bg-white p-5 shadow-2xl"
    >
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">
              <ShieldCheck size={20} />
            </span>
            <div>
              <h3 className="text-[15px] font-bold text-slate-900">{title}</h3>
              <p className="text-[11px] text-slate-500">{subtitle}</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-label="Tutup">
            <X size={16} />
          </button>
        </div>

        {phase !== 'failed' ? (
          <div className="flex flex-col items-center gap-3 py-4">
            {phase === 'checking' || busy
              ? <Loader2 size={28} className="animate-spin text-blue-600" />
              : <Fingerprint size={44} className="text-blue-600" />}
            <p className="text-center text-[12px] text-slate-600">
              {phase === 'checking' || busy
                ? 'Meminta sidik jari perangkat…'
                : 'Sentuh sensor sidik jari untuk melanjutkan.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <Fingerprint size={30} className="text-amber-600" />
              <p className="text-center text-[11px] leading-relaxed text-amber-800">
                Sidik jari petugas yang terdaftar di HP ini wajib dipakai. Verifikasi PIN tidak tersedia.
              </p>
            </div>
            <button
              onClick={() => void retryBiometric()}
              disabled={busy}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              {busy ? 'Memeriksa…' : 'Coba Sidik Jari Lagi'}
            </button>
          </div>
        )}

        {message && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{message}</p>
        )}
    </MobileModal>
  )
}
