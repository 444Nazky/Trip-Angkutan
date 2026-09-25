import { useState } from 'react'
import { ChevronLeft, Lock } from 'lucide-react'
import { useApp } from '../store'
import { loginWithPin, type Dermaga } from '../../services/auth'
import type { MobileScreen } from '../types'

// ─── PIN Verify Screen ─────────────────────────────────────────────────────────
interface PinVerifyScreenProps {
  go: (s: MobileScreen) => void
  onDermagaSelect?: (dermagas: Dermaga[]) => void
}

export default function PinVerifyScreen({ go, onDermagaSelect }: PinVerifyScreenProps) {
  const { officer, officers, pendingOfficerId, verifyIntent, setOfficerId, clearVerify } = useApp()
  const target = pendingOfficerId != null
    ? officers.find(o => String(o.id) === String(pendingOfficerId)) ?? officer
    : officer
  const [digits, setDigits] = useState<string[]>([])
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)

  const press = (d: string) => {
    setError(false)
    if (d === 'del') { setDigits(p => p.slice(0, -1)); return }
    if (digits.length < 6) setDigits(p => [...p, d])
  }

  const confirm = async () => {
    if (digits.length < 6) return

    const pin = digits.join('')
    setLoading(true)
    setError(false)

    try {
      const result = await loginWithPin(String(target.id), pin)

      if (result.success && result.data) {
        // Check for dual access - if so, show dermaga selection
        if (result.data.isDualAccess && result.data.dermagas && result.data.dermagas.length > 1) {
          onDermagaSelect?.(result.data.dermagas)
        }
        finishAuth()
        return
      }

      if (result.error?.code) {
        rejectPin()
        return
      }

      if (pin === '123456') {
        finishAuth()
      } else {
        rejectPin()
      }
    } catch {
      if (pin === '123456') {
        finishAuth()
      } else {
        rejectPin()
      }
    } finally {
      setLoading(false)
    }
  }

  const rejectPin = () => {
    setError(true)
    setTimeout(() => setDigits([]), 600)
  }

  const finishAuth = () => {
    if (verifyIntent === 'switch') {
      setOfficerId(String(target.id))
      clearVerify()
      go('profile')
    } else {
      clearVerify()
      go('profile')
    }
  }

  return (
    <div className="px-4 pt-2 pb-4 flex flex-col items-center animate-fade-in">
      <button onClick={() => go(verifyIntent === 'switch' ? 'officer-switch' : 'profile')} className="self-start flex items-center gap-1.5 text-slate-500 text-[13px] mb-8 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>

      <div className="w-16 h-16 rounded-3xl bg-[#0F172A] flex items-center justify-center mb-4 shadow-lg">
        <Lock size={28} className="text-amber-400" />
      </div>
      <h2 className="font-black text-slate-900 text-[22px] mb-1">Verifikasi PIN</h2>
      <p className="text-slate-500 text-[13px] text-center mb-1">
        {verifyIntent === 'switch' ? `Verifikasi PIN ${target.name}` : 'Masukkan 6-digit PIN Anda'}
      </p>
      <p className="text-slate-400 text-[11px] mb-7">Demo: gunakan PIN <span className="font-mono font-black text-blue-600">123456</span></p>

      {/* Dot indicators */}
      <div className="flex gap-3 mb-7">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`w-11 h-11 rounded-2xl border-2 flex items-center justify-center transition-all ${error ? 'border-red-400 bg-red-50' : i < digits.length ? 'border-blue-500 bg-blue-500' : 'border-slate-200 bg-white'}`}
          >
            {i < digits.length && <div className={`w-3 h-3 rounded-full ${error ? 'bg-red-400' : 'bg-white'}`} />}
          </div>
        ))}
      </div>

      {error && <p className="text-red-500 text-[12px] font-semibold mb-3 animate-fade-in">PIN salah. Coba lagi.</p>}

      {/* Numpad */}
      <div className="grid grid-cols-3 gap-3 w-full max-w-[260px]">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(key => (
          key === '' ? <div key="empty" /> :
            <button
              key={key}
              onClick={() => press(key)}
              className={`h-14 rounded-2xl font-bold text-lg flex items-center justify-center transition-all active:scale-95 ${key === 'del' ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 text-sm' : 'bg-white shadow-sm text-slate-900 hover:bg-slate-50 border border-slate-100'}`}
            >
              {key === 'del' ? '⌫' : key}
            </button>
        ))}
      </div>

      <button
        onClick={confirm}
        disabled={digits.length < 6 || loading}
        className="mt-6 w-full max-w-[260px] bg-[#0F172A] text-white font-bold py-4 rounded-2xl text-[13px] disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Verifikasi...
          </>
        ) : 'Konfirmasi'}
      </button>
    </div>
  )
}
