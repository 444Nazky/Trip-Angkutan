import { useState, useEffect } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { api } from '../services/api'
import {
  getStoredOfficer,
  loginOffline,
  loginWithPin,
  memberLogin,
  SESSION_READY_EVENT,
  verifyPinOffline,
} from '../services/auth'
import { initializeSync, syncNow } from '../services/sync'
import { getStoredOfficers } from '../services/officers'

interface LoginPageProps {
  onLogin: (userType: 'member' | 'admin') => void
}

export default function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [showPw, setShowPw] = useState(false)

  // ── Listener online/offline ─────────────────────────────────────
  useEffect(() => {
    const on  = () => setIsOnline(true)
    const off  = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  const handleLogin = async () => {
    if (!username.trim() || !password) {
      setError('ID petugas & PIN harus diisi.')
      return
    }
    if (loading) return
    setLoading(true)
    setError(null)
    const u = username.trim()
    const p = password
    try {
      // ── 1. VERIFIKASI LOKAL — selalu lebih dulu ───────────────────────
      // Membaca database offline + DATA BAWAAN (seed) secara instan:
      // tanpa jeda network request, langsung bisa100% offline.
      if (await tryOfflineLogin(u, p)) {
        void initializeSync()
        onLogin('member')
        // ── 2. Ada internet → sesi backend + update petugas dari dashboard
        //       admin ditarik di LATAR BELAKANG (tidak menunda login).
        if (navigator.onLine) void establishOnlineSession(u, p)
        return
      }

      if (!navigator.onLine) {
        setError('Akun atau PIN tidak tersedia di perangkat ini. Masuk online lalu sinkronkan data petugas.')
        return
      }

      // ── 3. Gagal lokal & online → serahkan ke server ──────────────────
      // Kasus: petugas baru dibuat admin / PIN baru yang belum tersinkron.
      const result = await memberLogin(u, p)
      if (result.success) {
        void initializeSync()
        onLogin('member')
        return
      }
      const msg = result.error || ''
      if (/timeout|network|failed|fetch|terjangkau|merespon/i.test(msg)) {
        setError('Server tidak terjangkau dan PIN lokal tidak cocok. Masuk online lalu sinkronkan data petugas.')
      } else if (/unauthorized|401|invalid/i.test(msg)) {
        setError('Username atau password salah.')
      } else {
        setError(msg || 'Login gagal.')
      }
    } catch {
      setError('Verifikasi gagal. Silakan coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  /**
   * Verifikasi LOKAL instan — baca DB offline (SQLite/localStorage) yang sudah
   * mencakup DATA BAWAAN (seed), tanpa menyentuh jaringan.
   * Sukses → sesi offline dibangun; caller melanjutkan sync online di latar.
   */
  async function tryOfflineLogin(u: string, p: string): Promise<boolean> {
    if (!u || !p) return false

    try {
      const res = await loginOffline(u, p)
      if (res.success) return true
    } catch {
      /* database offline belum siap — lanjut ke roster */
    }

    try {
      const officers = getStoredOfficers()
      const match = officers.find(o => String(o.id) === u || o.name === u || o.username === u)
      if (match && (await verifyPinOffline(String(match.id), p))) {
        api.setToken(null)
        localStorage.setItem('trip.auth.officer.v1', JSON.stringify({
          id: String(match.id),
          name: match.name,
          regionId: match.region,
          regionName: match.region,
          regionCode: match.region,
          offlineMode: true,
        }))
        return true
      }
    } catch { /* no-op */ }
    return false
  }

  /**
   * LATAR BELAKANG setelah login lokal sukses (saat ada internet):
   *   1. Ambil JWT (member-login → fallback login PIN per petugas).
   *   2. Tarik penambahan / penonaktifan petugas dari dashboard admin ke
   *      penyimpanan lokal (sinkron otomatis, data bawaan tidak dirusak).
   *   3. Proses antrean trip yang tertunda.
   * Gagal total → aplikasi tetap berjalan normal dalam mode offline.
   */
  async function establishOnlineSession(u: string, p: string): Promise<void> {
    try {
      await memberLogin(u, p)
      if (!api.isAuthenticated) {
        // Kata sandi bukan password member → coba PIN petugas per akun
        const id = getStoredOfficer()?.id
        if (id) await loginWithPin(String(id), p)
      }
      if (api.isAuthenticated) {
        void syncNow().catch(() => undefined)
        // Beri tahu store: token siap → tarik roster admin terbaru.
        window.dispatchEvent(new Event(SESSION_READY_EVENT))
      }
    } catch { /* tetap mode offline — sinkron menyusul saat koneksi ada */ }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void handleLogin()
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">

      {/* ── Minimalist Header ── */}
      <div className="px-6 pt-16 pb-8">
        <div className="flex items-center gap-4">
          <img src="./assets/karyamas_clean.png" alt="Logo" className="w-14 h-14 object-contain" />
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Trip Angkutan</h1>
            <p className="text-xs text-slate-400">Kalimantan Barat</p>
          </div>
        </div>
      </div>

      {/* ── Status & Form ── */}
      <div className="flex-1 px-6">
        {/* Online Status */}
        <div className="flex items-center gap-2 mb-8">
          <div className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-xs text-slate-400">{isOnline ? 'Online' : 'Offline Mode'}</span>
        </div>

        {/* Welcome Text */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold text-slate-800">Masuk</h2>
          <p className="text-sm text-slate-400 mt-1">Gunakan ID Petugas dan PIN Anda</p>
        </div>

        {/* Form */}
        <div className="space-y-4">
          {/* Username */}
          <div>
            <input
              type="text"
              value={username}
              onChange={e => { setError(null); setUsername(e.target.value) }}
              onKeyDown={onKey}
              placeholder="ID Petugas"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-[#1B3D6D] focus:ring-0 transition-colors"
            />
          </div>

          {/* Password */}
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => { setError(null); setPassword(e.target.value) }}
              onKeyDown={onKey}
              placeholder="PIN"
              className="w-full px-4 py-3.5 bg-white border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-300 focus:outline-none focus:border-[#1B3D6D] focus:ring-0 transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-3 bg-red-50 rounded-xl">
              <p className="text-xs text-red-500">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            onClick={() => void handleLogin()}
            disabled={loading}
            className="w-full py-3.5 rounded-xl font-medium text-sm text-white bg-[#1B3D6D] hover:bg-[#0f2847] disabled:opacity-50 transition-colors mt-2"
          >
            {loading ? 'Memproses…' : 'Masuk'}
          </button>
        </div>

        {/* Offline hint */}
        {!isOnline && (
          <p className="text-xs text-center text-slate-400 mt-6">
            Gunakan ID & PIN yang pernah login di perangkat ini
          </p>
        )}
      </div>

      {/* ── Footer ── */}
      <p className="text-center text-[11px] text-slate-300 pb-8">
        Trip Angkutan Kalimantan Barat
      </p>
    </div>
  )
}
