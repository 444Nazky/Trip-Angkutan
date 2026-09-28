import { useState } from 'react'
import { Truck, Lock, Eye, EyeOff, ArrowRight, AlertCircle, ChevronDown, ChevronLeft, MapPin } from 'lucide-react'
import { regionLogin, loginWithPin, type RegionInfo, type RegionOfficer } from '../services/auth'
import { officerList } from './data'

interface LoginPageProps {
  onLogin: (userType: 'admin' | 'member', officerId?: string) => void
}

/**
 * Revisi #4 — alur login baru (2 langkah):
 *  1. Login wilayah  : kode wilayah + password wilayah (BADAU / badau123)
 *  2. Pilih petugas  : daftar petugas milik wilayah tsb → verifikasi PIN masing-masing
 * Mode Administrator tetap tersedia lewat tautan di bawah.
 */
export default function LoginPage({ onLogin }: LoginPageProps) {
  const [adminMode, setAdminMode] = useState(false)
  const [step, setStep] = useState<'region' | 'officer'>('region')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Langkah 1 — wilayah
  const [regionCode, setRegionCode] = useState('')
  const [regionPass, setRegionPass] = useState('')
  const [region, setRegion] = useState<RegionInfo | null>(null)
  const [officers, setOfficers] = useState<RegionOfficer[]>([])

  // Langkah 2 — petugas + PIN
  const [adminUser, setAdminUser] = useState('')
  const [adminPass, setAdminPass] = useState('')
  const [selected, setSelected] = useState<RegionOfficer | null>(null)
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)

  const showError = (msg: string) => {
    setError(msg)
    setTimeout(() => setError(null), 4000)
  }

  const isConnError = (msg: string) => /timeout|network|failed|fetch|merespon|terjangkau/i.test(msg)

  // ── Langkah 1: login wilayah ──────────────────────────────────────────────
  const handleRegionLogin = async () => {
    setError(null)
    setLoading(true)
    try {
      const result = await regionLogin(regionCode.trim(), regionPass)
      if (result.success && result.region && result.officers) {
        if (result.officers.length === 0) {
          showError('Wilayah ini belum memiliki petugas aktif')
        } else {
          setRegion(result.region)
          setOfficers(result.officers)
          setStep('officer')
        }
      } else {
        showError(
          isConnError(result.error || '')
            ? 'Tidak bisa terhubung ke server. Pastikan backend berjalan.'
            : (result.error || 'Login wilayah gagal'),
        )
      }
    } catch (err) {
      console.error('[Login] region error:', err)
      showError('Terjadi kesalahan. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  // ── Langkah 2: verifikasi PIN petugas ─────────────────────────────────────
  const handleOfficerLogin = async () => {
    if (!selected) return
    setError(null)
    setLoading(true)
    try {
      const result = await loginWithPin(selected.id, pin)
      if (result.success) {
        onLogin('member', selected.id)
        return // halaman diganti state global
      }
      const msg = result.error?.message || ''
      showError(
        isConnError(msg)
          ? 'Tidak bisa terhubung ke server. Pastikan backend berjalan.'
          : 'PIN salah. Coba lagi.',
      )
      setPin('')
    } catch (err) {
      console.error('[Login] pin error:', err)
      showError('Terjadi kesalahan. Coba lagi.')
      setPin('')
    } finally {
      setLoading(false)
    }
  }

  // ── Langkah 2: keypad PIN ────────────────────────────────────────────────────
  const pressPin = (d: string) => {
    setError(null)
    if (d === 'del') { setPin(p => p.slice(0, -1)); return }
    if (pin.length < 6) setPin(p => p + d)
  }

  // ── Admin (mode lama, tetap dipertahankan) ────────────────────────────────
  const handleAdminLogin = async () => {
    setError(null)
    setLoading(true)
    try {
      if (adminUser === 'admin' && adminPass === 'admin123') {
        onLogin('admin')
        return
      }
      showError('Username atau password salah')
    } finally {
      setLoading(false)
    }
  }

  const toggleAdminMode = () => {
    setAdminMode(!adminMode)
    setAdminUser('')
    setAdminPass('')
    setError(null)
  }

  const backToRegion = () => {
    setStep('region')
    setSelected(null)
    setPin('')
    setError(null)
  }

  const initials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 via-slate-50 to-blue-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 text-white mb-4 shadow-lg shadow-blue-600/30">
            <Truck size={28} />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Trip Angkutan</h1>
          <p className="text-sm text-slate-500 mt-1">Kalimantan Barat · v2.5.0</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 p-6 border border-slate-100">
          {adminMode ? (
            <>
              <h2 className="text-lg font-bold text-slate-800 mb-1">Administrator</h2>
              <p className="text-sm text-slate-500 mb-6">Masuk ke dashboard admin</p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">
                    Username
                  </label>
                  <input
                    value={adminUser}
                    onChange={e => setAdminUser(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
                    placeholder="Masukkan username"
                    className={`w-full px-4 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors ${
                      error ? 'border-red-300 bg-red-50' : 'border-slate-200 focus:border-blue-500 bg-slate-50/50'
                    }`}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">
                    Password
                  </label>
                  <div className="relative">
                    <input
                      type={showPin ? 'text' : 'password'}
                      value={adminPass}
                      onChange={e => setAdminPass(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
                      placeholder="Masukkan password"
                      className={`w-full pl-4 pr-10 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors ${
                        error ? 'border-red-300 bg-red-50' : 'border-slate-200 focus:border-blue-500 bg-slate-50/50'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && <ErrorBox msg={error} />}

                <button
                  onClick={handleAdminLogin}
                  disabled={!adminUser || !adminPass || loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white font-bold py-3.5 rounded-xl text-sm transition-all active:scale-[0.98] shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? <Spinner label="Memverifikasi..." /> : <>Masuk <ArrowRight size={16} /></>}
                </button>
              </div>
            </>
          ) : step === 'region' ? (
            <>
              {/* ── Langkah 1: Login Wilayah ── */}
              <div className="flex items-center gap-2 mb-1">
                <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-blue-50 text-blue-600">
                  <MapPin size={15} />
                </span>
                <h2 className="text-lg font-bold text-slate-800">Login Wilayah</h2>
              </div>
              <p className="text-sm text-slate-500 mb-6">Masuk sesuai akun wilayah kerja</p>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">
                    Wilayah
                  </label>
                  <input
                    value={regionCode}
                    onChange={e => { setError(null); setRegionCode(e.target.value.toUpperCase()) }}
                    onKeyDown={e => e.key === 'Enter' && regionPass && handleRegionLogin()}
                    placeholder="BADAU"
                    autoCapitalize="characters"
                    className={`w-full px-4 py-3 rounded-xl border-2 text-sm font-bold tracking-wider text-slate-800 placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-400 focus:outline-none transition-colors ${
                      error ? 'border-red-300 bg-red-50' : 'border-slate-200 focus:border-blue-500 bg-slate-50/50'
                    }`}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-600 mb-1.5 block uppercase tracking-wide">
                    Password
                  </label>
                  <div className="relative">
                    <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPin ? 'text' : 'password'}
                      value={regionPass}
                      onChange={e => { setError(null); setRegionPass(e.target.value) }}
                      onKeyDown={e => e.key === 'Enter' && regionCode && handleRegionLogin()}
                      placeholder="Password wilayah"
                      className={`w-full pl-10 pr-10 py-3 rounded-xl border-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none transition-colors ${
                        error ? 'border-red-300 bg-red-50' : 'border-slate-200 focus:border-blue-500 bg-slate-50/50'
                      }`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {error && <ErrorBox msg={error} />}

                <button
                  onClick={handleRegionLogin}
                  disabled={!regionCode.trim() || !regionPass || loading}
                  className="w-full bg-blue-600 hover:bg-blue-500 disabled:bg-blue-300 text-white font-bold py-3.5 rounded-xl text-sm transition-all active:scale-[0.98] shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2 mt-2"
                >
                  {loading ? <Spinner label="Memverifikasi..." /> : <>Masuk <ArrowRight size={16} /></>}
                </button>
              </div>
            </>
          ) : (
            <>
              {/* ── Langkah 2: Pilih Petugas + PIN ── */}
              <button
                onClick={backToRegion}
                className="flex items-center gap-1.5 text-slate-500 text-sm mb-3 hover:text-slate-700"
              >
                <ChevronLeft size={16} /> Ganti wilayah
              </button>

              {/* Header gelap — region lock */}
              <div className="bg-[#0F172A] rounded-3xl p-5 mb-5">
                <div className="flex items-center gap-2 mb-2">
                  <Lock size={14} className="text-amber-400" />
                  <span className="text-amber-400 text-[11px] font-bold tracking-wide">REGION LOCK AKTIF</span>
                </div>
                <h2 className="text-white font-extrabold text-lg mb-0.5">Pilih Petugas</h2>
                <p className="text-slate-400 text-xs">
                  Hanya petugas wilayah{' '}
                  <span className="text-emerald-400 font-bold">{region?.code}</span> yang ditampilkan
                </p>
              </div>

              {!selected ? (
                <>
                  <div className="space-y-3 max-h-[46vh] overflow-y-auto pr-0.5">
                    {officers.map(o => {
                      // Info tambahan (perangkat, jumlah trip) bila ada di data lokal
                      const meta = officerList.find(x => x.name === o.name)
                      return (
                        <button
                          key={o.id}
                          onClick={() => { setSelected(o); setError(null) }}
                          className="w-full bg-white rounded-2xl px-4 py-4 shadow-sm border border-slate-100 flex items-center gap-4 text-left transition-all hover:shadow-md active:scale-[0.98]"
                        >
                          <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm bg-blue-100 text-blue-700 shrink-0">
                            {initials(o.name)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-slate-900 text-sm truncate">{o.name}</p>
                            <p className="text-[11px] text-slate-400 truncate">
                              {meta ? `${meta.device} · ${meta.trips} trip` : `${region?.name} · Petugas`}
                            </p>
                            <p className="text-[10px] text-slate-300 truncate">
                              {meta ? `Terakhir aktif: ${meta.lastActive}` : 'Verifikasi PIN masing-masing'}
                            </p>
                          </div>
                          <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-600 shrink-0">
                            Aktif
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-[11px] text-slate-400 text-center mt-4">
                    {officers.length} petugas aktif · PIN masing-masing
                  </p>
                </>
              ) : (
                <>
                  {/* Kartu petugas terpilih */}
                  <div className="flex items-center gap-3 rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 mb-4">
                    <span className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-xs font-black text-white shrink-0">
                      {initials(selected.name)}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{selected.name}</p>
                      <p className="text-[11px] text-slate-400">{region?.name} · Petugas</p>
                    </div>
                    <button
                      onClick={() => { setSelected(null); setPin(''); setError(null) }}
                      className="ml-auto text-[11px] font-semibold text-blue-600"
                    >
                      Ganti
                    </button>
                  </div>                  {/* Verifikasi PIN — keypad */}
                  <div className="flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl bg-[#0F172A] flex items-center justify-center mb-3 shadow-lg">
                      <Lock size={24} className="text-amber-400" />
                    </div>
                    <h3 className="font-extrabold text-slate-900 text-base mb-0.5">Verifikasi PIN</h3>
                    <p className="text-slate-500 text-[12px] text-center">
                      Masukkan 6-digit PIN{' '}
                      <span className="font-bold text-slate-700">{selected.name}</span>
                    </p>

                    {/* Dot indicators */}
                    <div className="flex gap-2.5 my-5">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div
                          key={i}
                          className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center transition-all ${
                            error ? 'border-red-400 bg-red-50'
                            : i < pin.length ? 'border-blue-500 bg-blue-500'
                            : 'border-slate-200 bg-slate-50/50'
                          }`}
                        >
                          {i < pin.length && (
                            <div className={`w-2.5 h-2.5 rounded-full ${error ? 'bg-red-400' : 'bg-white'}`} />
                          )}
                        </div>
                      ))}
                    </div>

                    {error && <div className="w-full mb-3"><ErrorBox msg={error} /></div>}

                    {/* Keypad */}
                    <div className="grid grid-cols-3 gap-2.5 w-full max-w-[240px]">
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map(key =>
                        key === '' ? <div key="empty" /> : (
                          <button
                            key={key}
                            onClick={() => pressPin(key)}
                            className={`h-12 rounded-xl font-bold text-lg flex items-center justify-center transition-all active:scale-95 ${
                              key === 'del'
                                ? 'bg-slate-100 text-slate-600 hover:bg-slate-200 text-sm'
                                : 'bg-white shadow-sm text-slate-900 hover:bg-slate-50 border border-slate-100'
                            }`}
                          >
                            {key === 'del' ? '⌫' : key}
                          </button>
                        ),
                      )}
                    </div>

                    <button
                      onClick={handleOfficerLogin}
                      disabled={pin.length < 6 || loading}
                      className="mt-5 w-full bg-[#0F172A] text-white font-bold py-3.5 rounded-xl text-sm disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                      {loading ? <Spinner label="Memverifikasi..." /> : <>Konfirmasi <ArrowRight size={15} /></>}
                    </button>

                    <button
                      onClick={() => { setSelected(null); setPin(''); setError(null) }}
                      className="mt-3 text-[11px] font-semibold text-slate-400 hover:text-slate-600"
                    >
                      Ganti petugas
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* Admin Toggle (Hidden - Click to reveal) */}
        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={toggleAdminMode}
            className="text-slate-400 hover:text-slate-600 text-xs flex items-center gap-1 mx-auto transition-colors"
          >
            {adminMode ? 'Kembali ke Login Wilayah' : 'Login Administrator'}
            <ChevronDown size={14} className={adminMode ? 'rotate-180' : ''} />
          </button>
        </div>

        {/* Footer */}
        <p className="text-center text-slate-400 text-xs mt-8">
          Kalimantan Barat · Trip Angkutan
        </p>
      </div>
    </div>
  )
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3 animate-fade-in">
      <AlertCircle size={16} className="text-red-500 shrink-0" />
      <p className="text-red-600 text-xs font-medium">{msg}</p>
    </div>
  )
}

function Spinner({ label }: { label: string }) {
  return (
    <>
      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      {label}
    </>
  )
}
