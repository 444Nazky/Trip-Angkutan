import { useState, useEffect } from 'react'
import { ChevronLeft, Globe, Lock, Server, RefreshCw, CheckCircle, WifiOff, Loader2, Smartphone } from 'lucide-react'
import { probeServer } from '../../services/sync'
import { getCurrentVersion, checkForUpdate, type UpdateState } from '../../services/ota'
import { semverLabel } from '../../services/ota'
import type { MobileScreen } from '../types'

interface SettingsScreenProps {
  go: (s: MobileScreen) => void
}

export default function SettingsScreen({ go }: SettingsScreenProps) {
  const [connection, setConnection] = useState<{ ok: boolean | null; checking: boolean }>({ ok: null, checking: false })
  const [currentVersion, setCurrentVersion] = useState<string>('—')
  const [otaState, setOtaState] = useState<UpdateState>({ status: 'idle' })
  const [checkingUpdate, setCheckingUpdate] = useState(false)

  const online = typeof navigator !== 'undefined' ? navigator.onLine : false
  const serverOk = connection.ok
  const checking = connection.checking
  const masked = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin.replace(/^https?:\/\//, '').slice(0, 24) + '…'
    : '—'

  // Ambil versi aplikasi saat ini
  useEffect(() => {
    getCurrentVersion().then(v => {
      if (v) setCurrentVersion(v)
    })
  }, [])

  // Cek koneksi server
  const checkConnection = () => {
    setConnection({ ok: null, checking: true })
    void probeServer(true).then((ok) => setConnection({ ok, checking: false }))
  }

  // Cek update OTA
  const checkForAppUpdate = async () => {
    setCheckingUpdate(true)
    try {
      await checkForUpdate(currentVersion, setOtaState)
    } finally {
      setCheckingUpdate(false)
    }
  }

  // Tentukan status versi
  const versionDisplay = currentVersion !== '—' ? semverLabel(currentVersion) : '—'
  const hasUpdateAvailable = otaState.status === 'ready'
  const updateProgress = otaState.progress

  return (
    <div className="px-4 pt-2 pb-4">
      {/* ── Header Navigasi dengan Tombol Kembali ── */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => go('profile')}
          className="w-10 h-10 rounded-xl bg-slate-100 hover:bg-slate-200 active:bg-slate-300 flex items-center justify-center transition-colors"
        >
          <ChevronLeft size={20} className="text-slate-600" />
        </button>
        <h1 className="font-black text-slate-900 text-[20px]">Pengaturan</h1>
      </div>

      {/* ── Kartu Versi Aplikasi & OTA Update ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-4">
        <div className="p-4">
          <div className="flex items-start gap-4">
            {/* Ikon Aplikasi */}
            <div className="w-12 h-12 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl flex items-center justify-center shrink-0 shadow-lg shadow-violet-200">
              <Smartphone size={22} className="text-white" />
            </div>

            {/* Info Versi */}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1">Versi Aplikasi</p>
              <p className="font-mono font-black text-[24px] text-slate-900 leading-none">{versionDisplay}</p>

              {/* Status Update */}
              <div className="mt-2 flex items-center gap-2">
                {hasUpdateAvailable ? (
                  <>
                    <CheckCircle size={14} className="text-emerald-500" />
                    <span className="text-[11px] font-semibold text-emerald-600">
                      Update {semverLabel(otaState.latestVersion ?? '')} Tersedia
                    </span>
                  </>
                ) : checkingUpdate || otaState.status === 'checking' || otaState.status === 'downloading' ? (
                  <>
                    <Loader2 size={14} className="text-blue-500 animate-spin" />
                    <span className="text-[11px] font-medium text-blue-600">
                      {otaState.status === 'downloading' && updateProgress !== undefined
                        ? `Mengunduh... ${updateProgress}%`
                        : 'Memeriksa update...'}
                    </span>
                  </>
                ) : !online ? (
                  <>
                    <WifiOff size={14} className="text-slate-400" />
                    <span className="text-[11px] text-slate-500">Offline</span>
                  </>
                ) : (
                  <>
                    <CheckCircle size={14} className="text-emerald-500" />
                    <span className="text-[11px] font-medium text-emerald-600">Aplikasi Menggunakan Versi Terkini</span>
                  </>
                )}
              </div>

              {/* Progress Bar saat download */}
              {otaState.status === 'downloading' && updateProgress !== undefined && (
                <div className="mt-3">
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${updateProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Tombol Aksi */}
            <button
              onClick={() => void checkForAppUpdate()}
              disabled={checkingUpdate || !online}
              className="shrink-0 flex items-center gap-2 bg-violet-600 hover:bg-violet-700 active:bg-violet-800 disabled:bg-slate-200 disabled:text-slate-400 text-white text-[12px] font-bold px-4 py-2.5 rounded-xl transition-all disabled:cursor-not-allowed"
            >
              {checkingUpdate ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Cek...
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  Cek Pembaruan
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Kartu Jaringan / Koneksi Server ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-4">
        <div className="p-4">
          <div className="flex items-start gap-4">
            {/* Ikon Jaringan */}
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
              serverOk === true
                ? 'bg-emerald-100'
                : serverOk === false
                  ? 'bg-amber-100'
                  : 'bg-slate-100'
            }`}>
              <Globe size={22} className={
                serverOk === true
                  ? 'text-emerald-600'
                  : serverOk === false
                    ? 'text-amber-600'
                    : 'text-slate-500'
              } />
            </div>

            {/* Info Koneksi */}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide mb-1">Koneksi Server</p>
              <p className="text-[15px] font-semibold text-slate-900">
                {serverOk === null
                  ? 'Memeriksa koneksi...'
                  : serverOk
                    ? 'Server Terhubung'
                    : 'Server Tidak Terjangkau'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {serverOk === null
                  ? 'Sedang memverifikasi koneksi ke server'
                  : serverOk
                    ? 'Ping aktif — data tersinkronisasi'
                    : 'Mode lokal aktif — data offline'}
              </p>
            </div>

            {/* Status Badge */}
            <div className="shrink-0">
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
                serverOk === true
                  ? 'bg-emerald-100 text-emerald-700'
                  : serverOk === false
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-500'
              }`}>
                {serverOk === true ? (
                  <>
                    <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                    Online
                  </>
                ) : serverOk === false ? (
                  <>
                    <span className="w-2 h-2 bg-amber-500 rounded-full" />
                    Offline
                  </>
                ) : (
                  'Cek...'
                )}
              </span>
            </div>
          </div>

          {/* Tombol Cek Koneksi */}
          <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
            <button
              onClick={() => void checkConnection()}
              disabled={checking}
              className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 disabled:bg-slate-50 disabled:text-slate-400 text-slate-700 text-[12px] font-semibold px-4 py-2 rounded-xl transition-all disabled:cursor-not-allowed"
            >
              {checking ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Memeriksa...
                </>
              ) : (
                <>
                  <RefreshCw size={14} />
                  Periksa Koneksi
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Kartu Konfigurasi Server (Read-only) ── */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden mb-4">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-4">
            <Lock size={14} className="text-slate-400 shrink-0" />
            <p className="text-[12px] font-bold text-slate-500 uppercase tracking-wide">Konfigurasi Server</p>
          </div>

          {/* Endpoint Box */}
          <div className="flex items-center gap-3 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
            <Server size={16} className="text-slate-400 shrink-0" />
            <span className="flex-1 text-[13px] font-mono text-slate-700 truncate select-all">{masked}</span>
            <span className="shrink-0 text-[9px] font-black uppercase tracking-wider text-slate-400 bg-white border border-slate-200 rounded px-2 py-1">
              Read-only
            </span>
          </div>

          {/* Info Lock */}
          <div className="flex items-start gap-2 mt-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
            <Lock size={12} className="shrink-0 mt-0.5 text-amber-500" />
            <span>Endpoint dikunci oleh administrator</span>
          </div>
        </div>
      </div>

      {/* ── Footer Info ── */}
      <div className="mt-6 pt-4 border-t border-slate-100">
        <p className="text-[11px] text-slate-400 text-center leading-relaxed">
          Trip Angkutan · Aplikasi mitra operasional petugas lapangan
        </p>
        <p className="text-[10px] text-slate-400 text-center mt-1">
          Offline-first · {online ? 'Online' : 'Offline'}
        </p>
      </div>
    </div>
  )
}
