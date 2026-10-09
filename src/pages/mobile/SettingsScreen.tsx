import { useState, useEffect } from 'react'
import { ChevronLeft, Smartphone, Globe, WifiOff, Lock, RefreshCw, CheckCircle, Loader2 } from 'lucide-react'
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

  return (
    <div className="min-h-full bg-white">
      {/* Header */}
      <div className="flex items-center px-4 py-3 border-b border-[#E5E5EA]">
        <button
          onClick={() => go('profile')}
          className="w-11 h-11 flex items-center justify-start -ml-2"
        >
          <ChevronLeft size={20} className="text-[#007AFF]" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-[#1C1C1E] mr-11">
          Pengaturan
        </h1>
      </div>

      {/* Content */}
      <div className="px-4 py-6">
        {/* Section: Versi */}
        <div className="mb-8">
          <p className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide px-4 mb-2">
            Versi Aplikasi
          </p>
          <div className="bg-white rounded-xl overflow-hidden">
            <div className="flex items-center px-4 py-3">
              {/* App Icon */}
              <div className="w-11 h-11 bg-[#F2F2F7] rounded-xl flex items-center justify-center mr-3">
                <Smartphone size={22} className="text-[#8E8E93]" />
              </div>

              {/* Info */}
              <div className="flex-1">
                <p className="text-[17px] text-[#1C1C1E]">Trip Angkutan</p>
                <p className="text-[13px] text-[#8E8E93] mt-0.5">Versi {versionDisplay}</p>
              </div>

              {/* Action */}
              <button
                onClick={() => void checkForAppUpdate()}
                disabled={checkingUpdate || !online}
                className="text-[15px] text-[#007AFF] disabled:text-[#C7C7CC]"
              >
                {checkingUpdate ? 'Memuat...' : 'Periksa Update'}
              </button>
            </div>
          </div>
        </div>

        {/* Section: Koneksi */}
        <div className="mb-8">
          <p className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide px-4 mb-2">
            Koneksi
          </p>
          <div className="bg-white rounded-xl overflow-hidden">
            {/* Server */}
            <div className="px-4 py-3.5">
              <div className="flex items-center">
                <div className="w-9 h-9 bg-[#F2F2F7] rounded-lg flex items-center justify-center mr-3">
                  <Globe size={18} className="text-[#8E8E93]" />
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-medium text-[#1C1C1E]">Server</p>
                  <p className="text-[13px] text-[#8E8E93]">
                    {serverOk === null ? 'Memeriksa...' : serverOk ? 'Terhubung' : 'Tidak terjangkau'}
                  </p>
                </div>
                <span className={`text-[12px] px-2.5 py-1 rounded-full ${
                  serverOk === true ? 'bg-[#E8F5E9] text-[#34C759]' : 'bg-[#FFF3E0] text-[#FF9500]'
                }`}>
                  {serverOk === true ? 'Online' : serverOk === false ? 'Offline' : '...'}
                </span>
              </div>
            </div>

            <div className="h-px bg-[#E5E5EA] mx-4" />

            {/* OTA Status */}
            <div className="px-4 py-3.5">
              <div className="flex items-center">
                <div className="w-9 h-9 bg-[#F2F2F7] rounded-lg flex items-center justify-center mr-3">
                  {hasUpdateAvailable ? (
                    <RefreshCw size={18} className="text-[#007AFF]" />
                  ) : online ? (
                    <CheckCircle size={18} className="text-[#34C759]" />
                  ) : (
                    <WifiOff size={18} className="text-[#8E8E93]" />
                  )}
                </div>
                <div className="flex-1">
                  <p className="text-[15px] font-medium text-[#1C1C1E]">OTA Update</p>
                  <p className="text-[13px] text-[#8E8E93]">
                    {hasUpdateAvailable
                      ? `Update ${semverLabel(otaState.latestVersion ?? '')} tersedia`
                      : 'Sinkron otomatis aktif'}
                  </p>
                </div>
                <span className={`text-[12px] px-2.5 py-1 rounded-full ${
                  hasUpdateAvailable
                    ? 'bg-[#E3F2FD] text-[#007AFF]'
                    : online
                      ? 'bg-[#E8F5E9] text-[#34C759]'
                      : 'bg-[#F2F2F7] text-[#8E8E93]'
                }`}>
                  {hasUpdateAvailable ? 'Update' : online ? 'Aktif' : 'Offline'}
                </span>
              </div>
            </div>

            <div className="h-px bg-[#E5E5EA] mx-4" />

            {/* Periksa Koneksi */}
            <div className="px-4 py-3.5">
              <button
                onClick={() => void checkConnection()}
                disabled={checking}
                className="w-full flex items-center justify-center gap-2 text-[15px] text-[#007AFF] disabled:text-[#C7C7CC]"
              >
                {checking ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Memeriksa...
                  </>
                ) : (
                  <>
                    <RefreshCw size={16} />
                    Periksa Koneksi
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Section: Server Config */}
        <div className="mb-8">
          <p className="text-[13px] font-semibold text-[#8E8E93] uppercase tracking-wide px-4 mb-2">
            Konfigurasi Server
          </p>
          <div className="bg-white rounded-xl overflow-hidden">
            <div className="flex items-center px-4 py-3.5">
              <Lock size={16} className="text-[#8E8E93] mr-3 shrink-0" />
              <span className="flex-1 text-[14px] font-mono text-[#8E8E93] truncate select-all">
                {masked}
              </span>
              <span className="ml-3 text-[12px] text-[#8E8E93] bg-[#F2F2F7] px-2 py-1 rounded shrink-0">
                Read-only
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-6 text-center">
          <p className="text-[13px] text-[#8E8E93]">
            Trip Angkutan
          </p>
          <p className="text-[12px] text-[#C7C7CC] mt-1">
            Offline-first · Data tersimpan lokal
          </p>
        </div>
      </div>
    </div>
  )
}
