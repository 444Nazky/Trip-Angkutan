import { useState, useEffect } from 'react'
import { ChevronLeft, RefreshCw, MapPin, Globe, Wifi, WifiOff, Server, CheckCircle } from 'lucide-react'
import { probeServer } from '../../services/sync'
import {
  getCurrentVersion,
  checkForUpdate,
  applyUpdate,
  semverLabel,
  type UpdateState,
} from '../../services/ota'
import type { MobileScreen } from '../types'

interface SettingsScreenProps {
  go: (s: MobileScreen) => void
}

export default function SettingsScreen({ go }: SettingsScreenProps) {
  const [connection, setConnection] = useState<{ ok: boolean | null; checking: boolean }>({ ok: null, checking: false })
  const [currentVersion, setCurrentVersion] = useState<string>('—')
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateVersion, setUpdateVersion] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : false)

  const masked = typeof window !== 'undefined' && window.location.origin
    ? window.location.origin.replace(/^https?:\/\//, '').slice(0, 24) + '…'
    : '—'

  useEffect(() => {
    getCurrentVersion().then(v => { if (v) setCurrentVersion(v) })
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const checkConnection = () => {
    setConnection({ ok: null, checking: true })
    void probeServer(true).then(ok => setConnection({ ok, checking: false }))
  }

  const checkForAppUpdate = async () => {
    setCheckingUpdate(true)
    setNote(null)
    try {
      const local = currentVersion === '—' ? await getCurrentVersion() : currentVersion
      let last: UpdateState = { status: 'idle' }
      const r = await checkForUpdate(local, s => { last = s }, true)
      if (r.available) {
        setUpdateVersion(r.version ?? null)
        setNote(`Update ${semverLabel(r.version ?? '')} tersedia`)
      } else if (last.status === 'error') {
        setNote(last.error ?? 'Gagal memeriksa pembaruan')
      } else if (last.status === 'offline') {
        setNote('Tidak ada koneksi')
      } else {
        setNote('Sudah versi terbaru')
      }
    } finally {
      setCheckingUpdate(false)
    }
  }

  const applyNow = async () => {
    setNote('Menerapkan update…')
    if (await applyUpdate()) {
      window.location.reload()
    } else {
      setUpdateVersion(null)
      setNote('Gagal menerapkan update')
    }
  }

  const versionDisplay = currentVersion !== '—' ? semverLabel(currentVersion) : '—'

  const serverStatus = connection.ok === null ? 'Belum diperiksa' : connection.ok ? 'Terhubung' : 'Tidak terjangkau'
  const serverBadgeClass = connection.ok === null ? 'bg-slate-100 text-slate-500' : connection.ok ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100'

  return (
    <div className="min-h-full bg-slate-50 pb-20">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-b-[28px] px-5 pt-5 pb-8 relative overflow-hidden">
        <div className="absolute right-4 top-4 w-20 h-20 rounded-full bg-white/10" />
        <div className="absolute right-8 bottom-2 w-12 h-12 rounded-full bg-blue-800/40" />
        <div className="relative flex items-center gap-3 mb-1">
          <button
            onClick={() => go('profile')}
            className="w-10 h-10 flex items-center justify-center -ml-2 text-white/80 hover:text-white transition-colors"
          >
            <ChevronLeft size={24} />
          </button>
          <h1 className="text-white font-bold text-xl">Pengaturan</h1>
        </div>
        <p className="text-blue-100 text-xs pl-[38px]">Konfigurasi sistem & status koneksi</p>
      </div>

      <div className="px-4 -mt-4 space-y-4">
        {/* Aplikasi */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Aplikasi</h2>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
            {/* Versi */}
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <Server size={18} />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-slate-800">Versi Aplikasi</p>
                <p className="font-mono text-[13px] text-slate-500">{versionDisplay}</p>
              </div>
            </div>
            {/* Pembaruan */}
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <CheckCircle size={18} />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-slate-800">Pembaruan</p>
                <p className="text-[12px] text-slate-400">{note ?? 'Periksa versi terbaru'}</p>
              </div>
              <button
                onClick={() => void (updateVersion ? applyNow() : checkForAppUpdate())}
                disabled={checkingUpdate}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-all flex items-center gap-1.5"
              >
                {checkingUpdate && <RefreshCw size={12} className="animate-spin" />}
                {updateVersion ? 'Terapkan' : 'Periksa'}
              </button>
            </div>
          </div>
        </section>

        {/* Koneksi */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Koneksi</h2>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 space-y-3">
            {/* Jaringan */}
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                {isOnline ? <Wifi size={18} /> : <WifiOff size={18} />}
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-slate-800">Jaringan</p>
                <p className="text-[12px] text-slate-400">Koneksi internet perangkat</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${isOnline ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-500'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            {/* Server */}
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <Server size={18} />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-slate-800">Server</p>
                <p className="text-[12px] text-slate-400">Status endpoint backend</p>
              </div>
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${serverBadgeClass}`}>
                {serverStatus}
              </span>
            </div>
            {/* Periksa Koneksi */}
            <button
              onClick={() => void checkConnection()}
              disabled={connection.checking}
              className="w-full border border-blue-200 text-blue-600 hover:bg-blue-50 text-xs font-semibold py-2.5 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {connection.checking ? (
                <><RefreshCw size={14} className="animate-spin" /> Memeriksa…</>
              ) : (
                <><RefreshCw size={14} /> Periksa Koneksi</>
              )}
            </button>
          </div>
        </section>

        {/* Konfigurasi Geofencing */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Geofencing</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <button
              onClick={() => go('geofence-config')}
              className="w-full flex items-center gap-3 px-4 py-4 active:scale-[0.98] transition-transform text-left"
            >
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <MapPin size={18} />
              </div>
              <div className="flex-1">
                <p className="text-[14px] font-semibold text-slate-800">Titik Wilayah Validasi</p>
                <p className="text-[12px] text-slate-400">Konfigurasi area geofence</p>
              </div>
              <ChevronLeft size={18} className="text-slate-300 rotate-180" />
            </button>
          </div>
        </section>

        {/* Server URL */}
        <section>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Server</h2>
          <div className="bg-slate-50 border border-slate-200 focus-within:border-blue-500 focus-within:bg-white rounded-xl p-3 flex items-center gap-3 transition-all">
            <Globe size={16} className="text-slate-400 shrink-0" />
            <span className="font-mono text-[12px] text-slate-500 break-all">{masked}</span>
          </div>
        </section>

        {/* Branding Footer */}
        <div className="pt-6 text-center">
          <p className="text-xs text-slate-400 font-medium">TripAngkutan • Offline-first Data Tersimpan Lokal</p>
        </div>
      </div>
    </div>
  )
}
