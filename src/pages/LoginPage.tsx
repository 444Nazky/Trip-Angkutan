import { useState } from 'react'
import { Truck, Lock, ChevronLeft } from 'lucide-react'
import { loginWithPin } from '../services/auth'
import type { ApiError } from '../services/api'

interface LoginPageProps {
  onLogin: (officerId: string) => void
  onAdmin?: () => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [selected, setSelected] = useState<{ id: string; name: string } | null>(null)
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handlePin = (key: string) => {
    setError(null)
    if (key === 'del') { setPin(p => p.slice(0, -1); return }
    if (pin.length >= 6) return
    const next = pin + key
    setPin(next)
    if (next.length === 6) void confirmLogin(next)
  }

  const confirmLogin = async (p: string) => {
    if (!selected) return
    setLoading(true)
    const result = await loginWithPin(selected.id, p)
    setLoading(false)
    if (result.success) { onLogin(selected.id); return }
    setError(result.error?.message || 'PIN salah')
    setPin('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-blue-50 to-blue-100 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-blue-600 text-white items-center justify-center mb-4 shadow-lg shadow-blue-600/30">
            <Truck size={28} />
          </div>
          <h1 className="text-2xl font-extrabold text-slate-900">Trip Angkutan</h1>
          <p className="text-sm text-slate-500 mt-1">Kalimantan Barat · Versi mobile</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-100 p-6">
          {!selected ? (
            <>
              <h2 className="text-lg font-bold text-slate-800 mb-1">Pilih Petugas</h2>
              <p className="text-sm text-slate-500 mb-6">Tekan kartu petugas, masukkan PIN masing-masing.</p>

              <div className="space-y-2">
                {[
                  { id: '1', name: 'Budi Santoso', region: 'Badau' },
                  { id: '2', name: 'Andi Pratama', region: 'Badau' },
                  { id: '3', name: 'Siti Rahayu', region: 'Badau' },
                  { id: '5', name: 'Dewi Kusuma', region: 'Badau' },
                ].map(o => (
                  <button
                    key={o.id}
                    onClick={() => { setSelected(o); setError(null) }}
                    className="w-full text-left bg-slate-50 hover:bg-slate-100 active:scale-[0.98] rounded-xl p-4 flex items-center gap-3 border border-slate-100 transition-all"
                  >
                    <div className="w-11 h-11 rounded-full bg-blue-600 text-white flex items-center justify-center font-black text-sm shrink-0">{o.name.split(' ').map(n => n[0]).join('')}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-slate-900">{o.name}</p>
                      <p className="text-xs text-slate-400">{o.region}</p>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  </button>
                ))}
              </div>

              {error && <p className="mt-4 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-600">{error}</p>}
            </>
          ) : (
            <>
              {/* Kembali */}
              <button
                onClick={() => { setSelected(null); setPin(''); setError(null) }}
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4"
              >
                <ChevronLeft size={16} /> Ganti petugas
              </button>

              {/* Header gelap */}
              <div className="bg-slate-900 rounded-2xl p-5 text-center">
                <div className="w-12 h-12 rounded-full bg-blue-600 flex items-center justify-center text-white font-black text-lg mb-3">
                  {selected.name.split(' ').map(n => n[0]).join('')}
                </div>
                <p className="text-white font-black text-base">{selected.name}</p>
                <p className="text-slate-400 text-xs">Masukkan PIN 6-digit</p>

                {/* Dot indicator */}
                <div className="flex justify-center gap-2.5 mt-4 mb-5">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
                        i < pin.length ? 'bg-blue-600 border-blue-600' : 'border-slate-600'
                      }`}
                    />
                  ))}
                </div>

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-2 max-w-[200px] mx-auto">
                  {['1','2','3','4','5','6','7','8','9','','0','del'].map(k =>
                    k === '' ? <div key="blank" /> :
                    <button
                      key={k}
                      onClick={() => handlePin(k)}
                      className={k === 'del'
                        ? 'h-11 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 active:scale-95 text-lg'
                        : 'h-11 rounded-xl bg-white text-slate-900 hover:bg-slate-50 active:scale-95 text-lg font-bold'
                      }
                    >
                      {k === 'del' ? '⌫' : k}
                    </button>
                  )}
                </div>

                {/* Error */}
                {error && (
                  <p className="mt-3 text-xs text-red-400">{error}</p>
                )}
                {loading && <p className="mt-3 text-xs text-slate-400 animate-pulse">Memverifikasi...</p>}
              </div>
            </>
          )}
        </div>

        <p className="text-center text-xs text-slate-400 mt-6">Kalimantan Barat · Angkutan</p>
      </div>
    </div>
  )
}
