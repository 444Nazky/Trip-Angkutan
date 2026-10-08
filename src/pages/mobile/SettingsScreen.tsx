import { useEffect, useState } from 'react'
import { Shield, Globe, Check, AlertTriangle, Server, RotateCcw, Lock } from 'lucide-react'
import { getMaskedApiUrl, onSyncQueueChange, probeServer } from '../../services/sync'
import { applyUpdate, checkForUpdate, getCurrentVersion } from '../../services/ota'
import type { MobileScreen } from '../types'

interface SettingsScreenProps {
  go: (s: MobileScreen) => void
}

export default function SettingsScreen({ go }: SettingsScreenProps) {
  const [cleared, setCleared] = useState(false)
  const [, setPendingCount] = useState(0)
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [serverOk, setServerOk] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(false)

  // Antrean sinkron — berlangganan perubahan supaya angka selalu akurat
  useEffect(() => onSyncQueueChange(setPendingCount), [])

  // Verifikasi koneksi PAKTI (ping /api/health) — navigator.onLine sering menipu
  useEffect(() => {
    let alive = true
    const on = () => setIsOnline(true)
    const off = () => setIsOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    void probeServer(true).then(ok => { if (alive) setServerOk(ok) })
    return () => {
      alive = false
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  // ── Cek versi / update aplikasi ──────────────────────────────────────────
  const [appVersion, setAppVersion] = useState('—')
  const [versionState, setVersionState] = useState<'idle' | 'checking' | 'latest' | 'available' | 'error'>('idle')
  const [latestVersion, setLatestVersion] = useState<string | null>(null)
  const [applying, setApplying] = useState(false)

  useEffect(() => { void getCurrentVersion().then(v => setAppVersion(v ?? '—')) }, [])

  const handleCheckVersion = async () => {
    setVersionState('checking')
    try {
      const res = await checkForUpdate(await getCurrentVersion())
      if (res.available) {
        setLatestVersion(res.version ?? null)
        setVersionState('available')
      } else {
        setVersionState('latest')
      }
    } catch {
      setVersionState('error')
    }
  }

  const handleApplyUpdate = async () => {
    setApplying(true)
    const ok = await applyUpdate()
    if (ok) {
      window.location.reload()
    } else {
      setApplying(false)
      setVersionState('error')
    }
  }

  const checkConnection = async () => {
    setChecking(true)
    try {
      const ok = await probeServer(true)
      setServerOk(ok)
      setIsOnline(ok)
    } finally { setChecking(false) }
  }

  // URL server: hanya sebagian tengah hostname yang disensor (read-only)
  const masked = getMaskedApiUrl()

  // Cache clear
  function clearCache() {
    if (!confirm('Bersihkan cache sesi?')) return
    sessionStorage.clear()
    setCleared(true)
    setTimeout(() => setCleared(false), 2500)
  }

  // Tombol/fungsi "Hapus Data Lokal" DIHAPUS atas instruksi mentor (keamanan):
  // mencegah hilangnya data trip yang belum sempat terkirim ke server.
  // Pengguna tidak lagi diberi cara menghapus antrean/riwayat dari UI.

  return (
    <div className="px-4 pt-3 pb-6 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <button onClick={() => go('profile')} className="flex-1 text-left text-blue-600 text-[13px] font-bold">
          { String.raw`←` } Profil
        </button>
      </div>

      <div>
        <h2 className="font-black text-[20px] text-slate-900">Pengaturan</h2>
        <p className="text-[11px] text-slate-400 mt-0.5">
          Perangkat & server
        </p>
      </div>

      {/* Status */}
      <div className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-slate-100">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isOnline ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}`}>
          <Globe size={18} />
        </div>
        <div className="flex-1">
          <p className="text-[12px] font-bold text-slate-800 leading-none">Jaringan</p>
          <p className="text-[10px] text-slate-400 mt-0.5">
            {serverOk === null
              ? 'Memeriksa koneksi ke server…'
              : serverOk
                ? 'Server terjangkau (ping aktif ✓)'
                : 'Server belum terjangkau — mode lokal aktif'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
            serverOk === true
              ? 'bg-emerald-100 text-emerald-700'
              : serverOk === false
                ? 'bg-amber-100 text-amber-700'
                : 'bg-slate-100 text-slate-500'
          }`}>
            {serverOk === true ? 'Terhubung' : serverOk === false ? 'Offline' : 'Cek…'}
          </span>
          <button
            onClick={() => void checkConnection()}
            disabled={checking}
            className="text-[9px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded px-1.5 py-0.5 disabled:opacity-50"
          >
            {checking ? 'Memeriksa…' : 'Cek Koneksi'}
          </button>
        </div>
      </div>

      {/* Versi Aplikasi / Update OTA */}
      <div className="bg-white rounded-2xl px-4 py-3.5 sh    adow-sm border border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-violet-100 text-violet-600 rounded-xl flex items-center justify-center shrink-0">
            <RotateCcw size={18} />
          </div>
          <div className="flex-1">
            <p className="text-[12px] font-bold text-slate-800">Versi Aplikasi</p>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {versionState === 'checking' ? 'Memeriksa pembaruan…'
                : versionState === 'latest' ? 'Aplikasi sudah versi terbaru'
                : versionState === 'available' ? `Update tersedia: ${latestVersion ?? 'versi baru'}`
                : versionState === 'error' ? 'Gagal memeriksa update'
                : `Terpasang: ${appVersion}`}
            </p>
          </div>
          {versionState === 'available' ? (
            <button
              onClick={() => void handleApplyUpdate()}
              disabled={applying}
              className="text-[10px] font-black text-white bg-blue-600 hover:bg-blue-700 rounded-lg px-3 py-1.5 disabled:opacity-50 shrink-0"
            >
              {applying ? 'Memperbarui…' : 'Update Sekarang'}
            </button>
          ) : (
            <button
              onClick={() => void handleCheckVersion()}
              disabled={versionState === 'checking'}
              className="text-[10px] font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg px-3 py-1.5 disabled:opacity-50 shrink-0"
            >
              {versionState === 'checking' ? 'Memeriksa…' : 'Cek Versi'}
            </button>
          )}
        </div>
      </div>

      
      <div className="bg-white rounded-2xl px-4 py-4 shadow-sm border border-slate-100">
        <div className="flex items-center gap-2 mb-3">
          <Lock size={13} className="text-slate-400 shrink-0" />
          <p className="text-[11px] font-black text-slate-500 uppercase tracking-widest">Konfigurasi Server</p>
        </div>
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3">
          <Server size={13} className="text-slate-400 shrink-0" />
          <span className="flex-1 text-[12px] font-mono text-slate-600 truncate select-none">{masked}</span>
          <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 bg-white border border-slate-200 rounded px-1.5 py-0.5 shrink-0">
            Read-only
          </span>
        </div>
        <div className="flex items-start gap-2 mt-3 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <Lock size={11} className="shrink-0 mt-0.5" />
          <span>Endpoint locked by default by admin</span>
        </div>
      </div>



    </div>
  )
}
