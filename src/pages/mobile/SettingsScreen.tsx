import { useEffect, useState } from 'react'
import { Database, Shield, Globe, Check, AlertTriangle, Server, RotateCcw, Lock, RefreshCw } from 'lucide-react'
import { getMaskedApiUrl, onSyncQueueChange, probeServer } from '../../services/sync'
import { dbClear } from '../../services/localDb'
import { applyUpdate, checkForUpdate, getCurrentVersion } from '../../services/ota'
import {
  syncOfficerCredentials,
  getLastCredentialsSync,
} from '../../services/credentialSync'
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

  // ── Credential Sync State ──────────────────────────────────────
  const [lastCredSync, setLastCredSync] = useState(0)
  const [credSyncing, setCredSyncing] = useState(false)
  const [credSyncResult, setCredSyncResult] = useState<{ message: string; error: boolean } | null>(null)

  const handleSyncCredentials = async () => {
    setCredSyncing(true)
    setCredSyncResult(null)
    try {
      const result = await syncOfficerCredentials()
      setCredSyncResult({
        message: result.error ?? `Tersinkron: ${result.synced} petugas dan rute`,
        error: !!result.error,
      })
      setLastCredSync(getLastCredentialsSync())
    } catch {
      setCredSyncResult({ message: 'Sinkronisasi gagal. Coba lagi.', error: true })
    } finally {
      setCredSyncing(false)
    }
  }

  useEffect(() => {
    setLastCredSync(getLastCredentialsSync())
  }, [])

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

  // Reset data — hapus localStorage DAN IndexedDB (antrean + daftar trip)
  async function resetData() {
    if (!confirm('Yakin?\n\nSemua data trip & petugas lokal akan dihapus.')) return
    const keys = [
      'trip.trips.v1', 'trip.trips.v2', 'trip.trips.v3',
      'trip.syncQueue.v1', 'trip.tariffs.v1',
      'trip.officers.v1', 'trip.officers.cache.v1',
      'trip.officers.credentials.v1',
      'trip.auth.officer.v1', 'trip.auth.dermaga.v1', 'trip.auth.routes.v1', 'trip.auth.pin.v1',
      'trip.dermaga.officers.v1', 'trip.api.baseUrl.v1',
      'trip.ota.state',
    ]
    keys.forEach(k => localStorage.removeItem(k))
    // Kunci per-dermaga (roster petugas)
    try {
      const legacy: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && (k.startsWith('trip.dermaga.officers.') || k.startsWith('trip.localdb.v1.'))) legacy.push(k)
      }
      legacy.forEach(k => localStorage.removeItem(k))
    } catch { /* ignore */ }
    // Object store IndexedDB
    await Promise.all([dbClear('trips'), dbClear('pending'), dbClear('meta')])
    alert('✓ Data direset.\n\nMuat ulang aplikasi.')
    window.location.reload()
  }

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
      <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-slate-100">
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
        <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-400">
          <Database size={11} className="shrink-0" />
        </div>
      </div>

      {/* Sinkronisasi Kredensial */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-amber-100 text-amber-600 rounded-xl flex items-center justify-center shrink-0">
            <Shield size={16} />
          </div>
          <div className="flex-1">
            <p className="text-[12px] font-bold text-slate-800 leading-tight">Data Petugas Offline</p>
            <p className="text-[10px] text-slate-500 mt-0.5">
              {lastCredSync
                ? `Terakhir: ${new Date(lastCredSync).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}`
                : 'Belum pernah sinkron'}
            </p>
            {credSyncResult && (
              <p className={`text-[9px] mt-0.5 ${credSyncResult.error ? 'text-red-500' : 'text-emerald-600'}`}>
                {credSyncResult.message}
              </p>
            )}
          </div>
          <button
            onClick={() => void handleSyncCredentials()}
            disabled={credSyncing}
            className="flex items-center gap-1.5 text-[10px] font-bold text-amber-700 bg-amber-200 hover:bg-amber-300 disabled:opacity-50 rounded-lg px-3 py-1.5 transition-colors"
          >
            <RefreshCw size={11} className={credSyncing ? 'animate-spin' : ''} />
            {credSyncing ? 'Sinkron…' : 'Sinkron'}
          </button>
        </div>
        <p className="text-[9px] text-slate-400 mt-2 pl-11">
          Tarik daftar petugas, hash PIN, dan rute wilayah dari server. Login online diperlukan.
        </p>
      </div>

      {/* Perawatan */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
        <button
          onClick={clearCache}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left active:bg-slate-50 transition">
          <Shield size={15} className="text-slate-400" />
          <span className="flex-1 text-[13px] font-semibold text-slate-700">Bersihkan Cache</span>
          {cleared && <Check size={12} className="text-emerald-600" />}
        </button>
        <button
          onClick={resetData}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-red-600 active:bg-red-50">
          <RotateCcw size={15} className="shrink-0" />
          <span className="flex-1 text-[13px] font-semibold">Reset Semua Data</span>
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-start gap-2.5">
        <AlertTriangle size={14} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-[10px] text-blue-700 leading-relaxed">
          <strong className="font-bold">Mode Lokal-First Aktif</strong>
          {` — data tersimpan di perangkat. Sinkronisasi berjalan otomatis saat online.`}
        </p>
      </div>
    </div>
  )
}
