import { useEffect, useRef, useState } from 'react'
import { Fingerprint, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react'
import { useApp } from '../pages/store'
import { verifyPinOffline } from '../services/auth'
import { verifyBiometric } from '../services/biometric'
import MobileModal from './MobileModal'

interface TripAuthDialogProps {
  open: boolean
  onClose: () => void
  onVerified: () => void
}

/**
 * Gerbang sebelum trip dikirim: sidik jari diutamakan, PIN sebagai cadangan.
 *
 * WebAuthn hanya tersedia di perangkat/WebView yang mendukung. Kalau tidak
 * tersedia atau gagal, dialog langsung menawarkan PIN petugas — pengiriman
 * tidak boleh macet total hanya karena perangkat tidak punya sensor.
 */
export default function TripAuthDialog({ open, onClose, onVerified }: TripAuthDialogProps) {
  const { officer } = useApp()
  const [phase, setPhase] = useState<'checking' | 'biometric' | 'pin'>('checking')
  const [message, setMessage] = useState('')
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const attemptedRef = useRef(false)

  useEffect(() => {
    if (!open) {
      attemptedRef.current = false
      setPhase('checking')
      setMessage('')
      setPin('')
      setBusy(false)
      return
    }
    if (attemptedRef.current) return
    attemptedRef.current = true
    let alive = true
    setPhase('checking')
    setMessage('')
    void verifyBiometric(officer).then(result => {
      if (!alive) return
      if (result === 'ok') { onVerified(); return }
      if (result === 'unavailable') {
        setPhase('pin')
        setMessage('Perangkat ini belum mendukung sidik jari. Masukkan PIN petugas.')
        return
      }
      setPhase('pin')
      setMessage(result === 'cancelled'
        ? 'Verifikasi sidik jari dibatalkan. Coba lagi atau gunakan PIN.'
        : 'Sidik jari gagal diverifikasi. Coba lagi atau gunakan PIN.')
    })
    return () => { alive = false }
  }, [open, officer, onVerified])

  if (!open) return null

  const retryBiometric = async () => {
    setBusy(true)
    setMessage('')
    const result = await verifyBiometric(officer)
    setBusy(false)
    if (result === 'ok') { onVerified(); return }
    if (result === 'unavailable') {
      setPhase('pin')
      setMessage('Perangkat ini belum mendukung sidik jari. Masukkan PIN petugas.')
      return
    }
    setMessage(result === 'cancelled'
      ? 'Verifikasi dibatalkan. Coba lagi atau gunakan PIN.'
      : 'Sidik jari gagal diverifikasi. Coba lagi atau gunakan PIN.')
  }

  const submitPin = async () => {
    if (!pin.trim()) return
    setBusy(true)
    setMessage('')
    // Id petugas adalah kunci kredensial offline yang paling pasti.
    const identifier = officer.id || officer.username || officer.name
    const ok = await verifyPinOffline(identifier, pin.trim())
    setBusy(false)
    if (ok) { onVerified(); return }
    setMessage('PIN tidak cocok. Periksa kembali.')
    setPin('')
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
              <h3 className="text-[15px] font-bold text-slate-900">Verifikasi Pengiriman</h3>
              <p className="text-[11px] text-slate-500">Sebelum data trip dikirim ke server</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500" aria-label="Tutup">
            <X size={16} />
          </button>
        </div>

        {phase === 'checking' || busy ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <Loader2 size={28} className="animate-spin text-blue-600" />
            <p className="text-[12px] font-medium text-slate-600">
              {phase === 'checking' ? 'Meminta sidik jari perangkat…' : 'Memeriksa…'}
            </p>
          </div>
        ) : phase === 'biometric' ? (
          <div className="flex flex-col items-center gap-3 py-4">
            <Fingerprint size={44} className="text-blue-600" />
            <p className="text-center text-[12px] text-slate-600">Sentuh sensor sidik jari untuk melanjutkan.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-700">
                <Fingerprint size={15} /> Sidik jari tidak tersedia
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Pakai PIN petugas. Sidik jari ditawarkan jika tersedia.
              </p>
            </div>
            <label className="block">
              <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                <KeyRound size={13} /> PIN Petugas
              </span>
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={e => setPin(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void submitPin() }}
                placeholder="Masukkan PIN"
                autoFocus
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-center text-lg font-bold tracking-[0.3em] text-slate-900 outline-none focus:border-blue-500"
              />
            </label>
            <button
              onClick={() => void submitPin()}
              disabled={!pin.trim()}
              className="w-full rounded-xl bg-blue-600 py-3 text-sm font-bold text-white disabled:opacity-40"
            >
              Verifikasi & Kirim
            </button>
            <button
              onClick={() => { setPhase('biometric'); void retryBiometric() }}
              className="w-full rounded-xl border border-slate-200 py-2.5 text-[12px] font-semibold text-slate-600"
            >
              Coba Sidik Jari Lagi
            </button>
          </div>
        )}

        {message && (
          <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800">{message}</p>
        )}

        {phase === 'biometric' && !busy && (
          <div className="mt-3 flex gap-2">
            <button onClick={() => void retryBiometric()} className="flex-1 rounded-xl bg-blue-600 py-2.5 text-[12px] font-bold text-white">
              Verifikasi
            </button>
            <button onClick={() => { setPhase('pin'); setMessage('') }} className="flex-1 rounded-xl border border-slate-200 py-2.5 text-[12px] font-semibold text-slate-600">
              Gunakan PIN
            </button>
          </div>
        )}
    </MobileModal>
  )
}
