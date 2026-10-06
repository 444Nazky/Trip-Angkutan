import { useState } from 'react'
import { ChevronLeft, Lock, Delete } from 'lucide-react'
import { loginWithPin } from '../../services/auth'
import { verifyPin as verifyOfflinePin } from '../../services/offlineDb'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

// PinVerifyScreen — verifikasi PIN petugas untuk mulai trip / ganti petugas.
// BISA berfungsi offline karena hash PIN tersimpan di IndexedDB per device.
// Proses: online-first → fallback offline bila jaringan gagal.

interface PinVerifyScreenProps { go: (s: MobileScreen) => void }

export default function PinVerifyScreen({ go }: PinVerifyScreenProps) {
  const { officer, officers, pendingOfficerId, verifyIntent, setOfficerId, clearVerify } = useApp()

  // Resolve target officer dari pendingOfficerId (ganti petugas) atau officer aktif
  const target = pendingOfficerId != null
    ? (officers.find(o => String(o.id) === String(pendingOfficerId)) ?? officer
    : officer

  const [digits, setDigits] = useState<string[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const pressedPin = digits.join('')

  /** Tambah digit / hapus digit terakhir */
  const press = (d: string) => {
    setError(false)
    if (d === 'del') { setDigits(p => p.slice(0, -1)); return }
    if (digits.length < 6) setDigits(p => [...p, d])
  }

  /** Tampilkan feedback PIN salah */
  const rejectPin = (reason?: string) => {
    setError(true)
    setTimeout(() => { setDigits([]); setError(false) }, 700)
    if (reason) console.warn('[pin-verify] PIN salah:', reason)
  }

  /** Konfirmasi: online duluan, fallback offline IndexedDB */
  const confirm = async () => {
    if (pressedPin.length < 6) return
    setLoading(true)
    setError(false)

    // ── 1. Online attempt ──────────────────────────────
    const isOnline = navigator.onLine
    if (isOnline) {
      try {
        const result = await loginWithPin(String(target?.id ?? ''), pressedPin)
        if (result.success) { finishAuth(); return }
        // Server menolak → cek apakah jaringan atau kredensial
        const msg = result.error?.message ?? ''
        if (msg && /timeout|network|failed.to.fetch|terjangkau|unreachable|ECONNREFUSED/i.test(msg)) {
          // Jaringan gagal → coba offline
          const lokal = await verifyOffline(String(target?.id, pressedPin)
          if (lokal) { finishAuth(); return }
        }
        // Kredensial salah, bukan jaringan
        rejectPin(result.error?.message)
        setLoading(false)
        return
      } catch (e) {
        // Exception → offline fallback
        console.warn('[pin-verify] online attempt exception:', e)
      }
    }

    // ── 2. Offline fallback ──────────────────────────
    const lokal = await verifyOffline(String(target?.id ?? ''), pressedPin)
    if (lokal) {
      // Offline session built → update app state
      if (verifyIntent === 'switch') setOfficerId(String(target?.id ?? ''))
      clearVerify()
      go('profile')
    } else {
      rejectPin('Offline — hash PIN belum tersedia,login online dulu')
    }
    setLoading(false)
  }

  const finishAuth = () => {
    if (verifyIntent === 'switch') setOfficerId(String(target?.id ?? ''))
    clearVerify()
    go('profile')
  }

  return (
    <div className="px-4 pt-2 pb-4 flex flex-col items-center">

      <button
        onClick={() => go(verifyIntent === 'switch' ? 'officer-switch' : 'profile')}
        className="self-start flex items-center gap-1.5 text-slate-500 text-[13px] mb-8 hover:text-slate-700 font-medium"
      >
        <ChevronLeft size={16} /> Kembali
      </button>

      {/* Icon + judul */}
      <div className="w-16 h-16 rounded-3xl bg-[#0F172A] flex items-center justify-center mb-4 shadow-lg">
        <Lock size={28} className="text-amber-400" />
      </div>
      <h2 className="font-black text-slate-900 text-[22px] mb-1">Verifikasi PIN</h2>
      <p className="text-slate-500 text-[13px] text-center mb-1">
        {verifyIntent === 'switch'
          ? `Login Sebagai ${target?.name ?? '…'}`
          : `Petugas: ${target?.name ?? officer?.name ?? '…'}`}
      </p>
      {!navigator.onLine && (
        <p className="text-amber-600 text-[11px] font-semibold mb-1">Offline — verifikasi lokal aktif</p>
      )}

      {/* Dot indicators */}
      <div className="flex gap-3 mb-7">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-11 h-11 rounded-2xl border-2 flex items-center justify-center transition-all ${
              error ? 'border-red-400'
                : i < digits.length ? 'border-blue-500'
                : 'border-slate-200'
            }`}
          >
            {i < digits.length && (
              <div className={`w-3 h-3 rounded-full ${error ? 'bg-red-400' : 'bg-blue-500'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <p className="text-red-500 text-[12px] font-semibold mb-3 animate-fade-in">
          PIN salah — coba lagi
        </p>
      )}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
        {['1','2','3','4','5','6','7','8','9','','0','del'].map(k => (
          k === '' ? <div key="empty" />
            : (
              <button
                key={k}
                onClick={() => press(k)}
                className="h-14 rounded-2xl font-bold text-lg flex items-center justify-center transition-all active:scale-95 disabled:opacity-40 bg-white shadow-sm border border-slate-100 text-slate-900 hover:bg-slate-50"
                disabled={loading}
              >
                {k === 'del' ? <Delete size={18} /> : k}
              </button>
            )
        ))}
      </div>

      {/* Konfirmasi */}
      <button
        onClick={confirm}
        disabled={pressedPin.length < 6 || loading}
        className="mt-6 w-full max-w-[260px] bg-[#0F172A] text-white font-bold py-4 rounded-2xl text-[13px] disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
      >
        {loading
          ? <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Memverifikasi…</>
          : 'Konfirmasi PIN'}
      </button>

      {!navigator.onLine && (
        <p className="text-slate-400 text-[11px] mt-2">Offline — hash PIN tersimpan di perangkat</p>
      )}
    </div>
  )
}
