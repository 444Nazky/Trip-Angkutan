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
      {/* Header Standar Minimalis */}
      <div className="bg-white border-b border-slate-100 px-4 py-3 flex items-center gap-3">
        <button
          onClick={() => go('profile')}
          className="w-10 h-10 flex items-center justify-center -ml-2 text-slate-700 hover:text-slate-900 transition-colors"
        >
          <ChevronLeft size={22} />
        </button>
        <h1 className="text-slate-800 text-lg font-bold">Pengaturan</h1>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Aplikasi */}
        <section>
          <div className="bg-white rounded-2xl p-3.5 shadow-sm border border-slate-100 space-y-2.5">
            {/* Versi */}
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Server size={16} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-medium text-slate-800">Versi Aplikasi</p>
                <p className="font-mono text-[12px] text-slate-500">{versionDisplay}</p>
              </div>
            </div>
            {/* Pembaruan */}
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <CheckCircle size={16} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-medium text-slate-800">Pembaruan</p>
                <p className="text-[11px] text-slate-400">{note ?? 'Periksa versi terbaru'}</p>
              </div>
              <button
                onClick={() => void (updateVersion ? applyNow() : checkForAppUpdate())}
                disabled={checkingUpdate}
                className="bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full transition-all"
              >
                {checkingUpdate ? <RefreshCw size={11} className="animate-spin inline" /> : null}
                {updateVersion ? 'Terapkan' : 'Periksa'}
              </button>
            </div>
          </div>
        </section>

        {/* Koneksi */}
        <section>
          <div className="bg-white rounded-2xl p-3.5 shadow-sm border border-slate-100 space-y-2.5">
            {/* Jaringan */}
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-medium text-slate-800">Jaringan</p>
              </div>
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${isOnline ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-100 text-slate-500'}`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            {/* Server */}
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <Server size={16} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-medium text-slate-800">Server</p>
              </div>
              <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${serverBadgeClass}`}>
                {serverStatus}
              </span>
            </div>
            {/* Periksa Koneksi */}
            <button
              onClick={() => void checkConnection()}
              disabled={connection.checking}
              className="w-full border border-blue-200 text-blue-600 hover:bg-blue-50 text-[12px] font-semibold py-2 rounded-xl flex items-center justify-center gap-2 transition-all disabled:opacity-50"
            >
              {connection.checking ? (
                <><RefreshCw size={13} className="animate-spin" /> Memeriksa…</>
              ) : (
                <><RefreshCw size={13} /> Periksa Koneksi</>
              )}
            </button>
          </div>
        </section>

        {/* Geofencing */}
        <section>
          <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
            <button
              onClick={() => go('geofence-config')}
              className="w-full flex items-center gap-3 px-3.5 py-3 active:scale-[0.98] transition-transform text-left"
            >
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                <MapPin size={16} />
              </div>
              <div className="flex-1">
                <p className="text-[13px] font-medium text-slate-800">Titik Wilayah Validasi</p>
              </div>
              <ChevronLeft size={16} className="text-slate-300 rotate-180" />
            </button>
          </div>
        </section>

        {/* Server URL */}
        <section>
          <div className="bg-slate-50 border border-slate-200 focus-within:border-blue-400 rounded-xl px-3 py-2.5 flex items-center gap-2 transition-all">
            <Globe size={14} className="text-slate-400 shrink-0" />
            <span className="font-mono text-[11px] text-slate-500 break-all">{masked}</span>
          </div>
        </section>

        {/* Branding Footer */}
        <div className="pt-4 text-center">
          <p className="text-[11px] text-slate-400">TripAngkutan • Offline-first</p>
        </div>
      </div>
    </div>
  )
}
