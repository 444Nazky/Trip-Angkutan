// ─── Offline Login Page ──────────────────────────────────────────────
// Full offline authentication with local master data.

import { useState, useEffect } from 'react'
import { Truck, Wifi, WifiOff, AlertCircle, LogIn, ShieldCheck } from 'lucide-react'
import {
  loginWithCredentials,
  loginWithPin,
  getOfflineSession,
  clearSession,
  isLoggedIn,
  getAccessibleDermagas,
} from '../services/offline-auth'
import { isOnline, getSyncStatus, hasLocalMasterData } from '../services/offline-init'
import type { OfflineSession } from '../services/offline-auth'

interface OfflineLoginPageProps {
  onLogin: (session: OfflineSession) => void
  onBack?: () => void
}

type AuthMode = 'credentials' | 'pin'

export default function OfflineLoginPage({ onLogin, onBack }: OfflineLoginPageProps) {
  const [mode, setMode] = useState<AuthMode>('credentials')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)

  useEffect(() => {
    const onNet = () => setOnline(true)
    const onOff = () => setOnline(false)
    window.addEventListener('online', onNet)
    window.addEventListener('offline', onOff)
    return () => {
      window.removeEventListener('online', onNet)
      window.removeEventListener('offline', onOff)
    }
  }, [])

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('Username dan password harus diisi')
      return
    }

    setLoading(true)
    setError(null)
    const result = await loginWithCredentials(username.trim(), password)
    setLoading(false)

    if (result.success && result.session) {
      onLogin(result.session)
    } else {
      setError(result.error || 'Login gagal')
    }
  }

  async function handlePin(e: React.FormEvent) {
    e.preventDefault()
    if (!pin || pin.length < 4) {
      setError('PIN harus 4 digit atau lebih')
      return
    }

    // PIN mode requires a session to know which officer to validate against
    const session = getOfflineSession()
    if (!session) {
      setError('Sesi tidak ditemukan. Gunakan login username/password dulu.')
      setMode('credentials')
      return
    }

    setLoading(true)
    setError(null)
    const result = await loginWithPin(session.officerId, pin)
    setLoading(false)

    if (result.success && result.session) {
      onLogin(result.session)
    } else {
      setError(result.error || 'PIN salah')
    }
  }

  function handleLogout() {
    clearSession()
    setPin('')
    setUsername('')
    setPassword('')
    setError(null)
  }

  const syncStatus = getSyncStatus()
  const hasData = hasLocalMasterData()
  const session = getOfflineSession()

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-6 font-sans">

      {/* Card */}
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-zinc-900 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Truck size={24} className="text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-xl font-semibold text-zinc-900">Masuk Offline</h1>
          <p className="text-xs text-zinc-400 mt-1">Trip Angkutan · Data tersimpan lokal</p>
        </div>

        {/* Network Status */}
        <div className={`flex items-center gap-2 justify-center mb-4 text-xs font-medium rounded-full px-3 py-1 w-fit mx-auto ${online ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {online ? <Wifi size={12} /> : <WifiOff size={12} />}
          {online ? 'Online — sinkronisasi latar belakang aktif' : 'Offline — autentikasi lokal'}
        </div>

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-4">
            <AlertCircle size={14} className="shrink-0" />
            {error}
          </div>
        )}

        {/* Session Info */}
        {session && (
          <div className="bg-zinc-900 text-white rounded-2xl p-4 mb-4 text-sm">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={16} className="text-green-400" />
              <span className="font-medium">Sesi tersimpan</span>
            </div>
            <p className="text-zinc-400 text-xs">{session.officerName}</p>
            <p className="text-zinc-500 text-xs">
              Dermaga: {session.activeDermagaId || 'belum dipilih'}
            </p>
            <button
              onClick={handleLogout}
              className="mt-3 text-xs text-zinc-500 hover:text-zinc-300 underline"
            >
              Keluar &amp; gunakan akun lain
            </button>
          </div>
        )}

        {/* Form */}
        <form onSubmit={mode === 'credentials' ? handleCredentials : handlePin} className="bg-white rounded-2xl border border-zinc-200 p-6 mb-4">
          {mode === 'credentials' ? (
            <>
              <div className="mb-4">
                <label className="block text-xs font-medium text-zinc-700 mb-1.5 uppercase tracking-wider">
                  Username
                </label>
                <input
                  type="text"
                  value={username}
                  onChange={e => { setError(null); setUsername(e.target.value) }}
                  placeholder="ID petugas"
                  autoCapitalize="none"
                  autoComplete="off"
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors"
                />
              </div>
              <div className="mb-5">
                <label className="block text-xs font-medium text-zinc-700 mb-1.5 uppercase tracking-wider">
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => { setError(null); setPassword(e.target.value) }}
                  placeholder="••••••"
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 placeholder:text-zinc-400 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Memverifikasi...
                  </>
                ) : (
                  <>
                    <LogIn size={15} />
                    Masuk
                  </>
                )}
              </button>
            </>
          ) : (
            <>
              <div className="mb-5">
                <label className="block text-xs font-medium text-zinc-700 mb-1.5 uppercase tracking-wider">
                  PIN
                </label>
                <input
                  type="password"
                  value={pin}
                  onChange={e => { setError(null); setPin(e.target.value.replace(/\D/g, '').slice(0, 8) }}
                  placeholder="• • • •"
                  maxLength={8}
                  inputMode="numeric"
                  className="w-full px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-sm text-zinc-900 text-center tracking-widest placeholder:text-zinc-300 focus:outline-none focus:border-zinc-400 focus:bg-white transition-colors text-2xl"
                  style={{ fontFamily: 'monospace' }}
                />
                <p className="text-xs text-zinc-400 mt-1.5 text-center">
                  {session?.officerName} · masukkan PIN 4–8 digit
                </p>
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed"
              >
                {loading ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Memverifikasi...
                  </>
                ) : (
                  <>
                    <LogIn size={15} />
                    Verifikasi PIN
                  </>
                )}
              </button>
            </>
          )}
        </form>

        {/* Toggle mode */}
        {mode === 'credentials' ? (
          session ? (
            <button
              onClick={() => { setError(null); setMode('pin') }}
              className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600 py-2 transition-colors"
            >
              Gunakan PIN saja
            </button>
          ) : null
        ) : (
          <button
            onClick={() => { setError(null); setMode('credentials') }}
            className="w-full text-center text-xs text-zinc-400 hover:text-zinc-600 py-2 transition-colors"
          >
            Gunakan username &amp; password
          </button>
        )}

        {/* Back */}
        {onBack && (
          <button
            onClick={onBack}
            className="mt-4 w-full text-center text-xs text-zinc-400 hover:text-zinc-600 py-2 transition-colors"
          >
            ← Kembali ke sinkronisasi
          </button>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-zinc-300 mt-6">
          {hasData
            ? `${syncStatus.syncedOfficers} petugas · ${syncStatus.syncedDermagas} dermaga tersimpan`
            : 'Belum ada data tersimpan — sambungkan ke internet'}
        </p>
      </div>
    </div>
  )
}
