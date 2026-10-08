// ─── Initialization Screen ──────────────────────────────────────────────
// Shown on first launch or when master data needs to be synced.

import { useEffect, useState, useRef } from 'react'
import { Truck, Wifi, WifiOff, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react'
import { performInitialSync, getSyncStatus, STORAGE_KEYS } from '../services/offline-init'
import { clearAllMasterData } from '../services/offline-init'
import { getOfflineSession } from '../services/offline-auth'

interface InitScreenProps {
  onReady: () => void
  onOffline: () => void
}

interface SyncProgress {
  stage: string
  percent: number
  errors: string[]
}

export default function InitScreen({ onReady, onOffline }: InitScreenProps) {
  const [progress, setProgress] = useState<SyncProgress>({ stage: 'Memeriksa koneksi...', percent: 0, errors: [] })
  const [status, setStatus] = useState(getSyncStatus())
  const [retries, setRetries] = useState(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    // Auto-start sync when online
    if (!navigator.onLine) {
      setProgress({ stage: 'Offline — menggunakan data tersimpan', percent: 0, errors: [] })
      return
    }

    const session = getOfflineSession()
    const hasSession = session !== null

    // If we have a session and data is fresh, skip sync screen
    if (hasSession && status.lastSyncAt) {
      const lastSync = new Date(status.lastSyncAt).getTime()
      const hoursSince = (Date.now() - lastSync) / 3_600_000
      if (hoursSince < 24) {
        onReady()
        return
      }
    }

    void runSync()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runSync() {
    setProgress({ stage: 'Menghubungi server...', percent: 0, errors: [] })
    const result = await performInitialSync((stage, percent) => {
      if (mounted.current) setProgress(prev => ({ ...prev, stage, percent }))
    })

    if (!mounted.current) return

    if (result.success) {
      setStatus(getSyncStatus())
      onReady()
    } else {
      setProgress(prev => ({ ...prev, stage: 'Sinkronisasi gagal', errors: result.errors }))
      setRetries(r => r + 1)
    }
  }

  function handleRetry() {
    void runSync()
  }

  function handleUseOffline() {
    clearAllMasterData()
    onOffline()
  }

  const online = navigator.onLine

  return (
    <div className="min-h-screen bg-gradient-to-b from-zinc-50 to-zinc-100 flex items-center justify-center p-6 font-sans">
      <div className="w-full max-w-sm text-center">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center shadow-lg">
            <Truck size={28} className="text-white" strokeWidth={1.5} />
          </div>
        </div>

        <h1 className="text-2xl font-semibold text-zinc-900 mb-1">Sinkronisasi Awal</h1>
        <p className="text-sm text-zinc-500 mb-8">Trip Angkutan · Kalimantan Barat</p>

        {/* Status Card */}
        <div className="bg-white rounded-2xl border border-zinc-200 p-6 mb-4 text-left">

          {/* Connection status */}
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-zinc-100">
            {online ? (
              <Wifi size={20} className="text-green-600 shrink-0" />
            ) : (
              <WifiOff size={20} className="text-red-500 shrink-0" />
            )}
            <div>
              <p className={`text-sm font-medium ${online ? 'text-green-700' : 'text-red-600'}`}>
                {online ? 'Terhubung ke internet' : 'Offline'}
              </p>
              <p className="text-xs text-zinc-400 mt-0.5">
                {online ? 'Mendownload data master...' : 'Akan menggunakan data tersimpan'}
              </p>
            </div>
          </div>

          {/* Sync Stage */}
          <div className="mb-3">
            <p className="text-sm text-zinc-700">{progress.stage}</p>
            {online && (
              <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-zinc-900 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            )}
          </div>

          {/* Data Counts */}
          {status.lastSyncAt && (
            <div className="grid grid-cols-2 gap-2 text-xs text-zinc-500 mb-3">
              <div className="bg-zinc-50 rounded-lg p-2">
                <span className="font-semibold text-zinc-700">{status.syncedOfficers}</span> Petugas
              </div>
              <div className="bg-zinc-50 rounded-lg p-2">
                <span className="font-semibold text-zinc-700">{status.syncedDermagas}</span> Dermaga
              </div>
              <div className="bg-zinc-50 rounded-lg p-2">
                <span className="font-semibold text-zinc-700">{status.syncedRoutes}</span> Rute
              </div>
              <div className="bg-zinc-50 rounded-lg p-2">
                <span className="font-semibold text-zinc-700">{status.syncedConfig}</span> Konfigurasi
              </div>
            </div>
          )}

          {/* Errors */}
          {progress.errors.length > 0 && (
            <div className="space-y-1 mb-3">
              {progress.errors.map((err, i) => (
                <div key={i} className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-2 text-left">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" />
                  {err}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          {online && progress.errors.length > 0 && (
            <button
              onClick={handleRetry}
              className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 text-white text-sm font-medium rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <RefreshCw size={15} />
              Coba Lagi ({retries})
            </button>
          )}

          {online && progress.errors.length === 0 && progress.percent < 100 && (
            <p className="text-xs text-zinc-400">Sinkronisasi sedang berlangsung...</p>
          )}

          <button
            onClick={onOffline}
            disabled={progress.percent < 100 && online}
            className="w-full py-3 bg-white hover:bg-zinc-50 disabled:bg-zinc-100 disabled:text-zinc-400 border border-zinc-200 text-sm text-zinc-600 rounded-xl flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed"
          >
            {progress.percent >= 100 || !online ? (
              <>
                <WifiOff size={15} />
                {online ? 'Lewati sinkronisasi' : 'Gunakan mode Offline'}
              </>
            ) : (
              'Tunggu sinkronisasi selesai...'
            )}
          </button>
        </div>

        <p className="text-[10px] text-zinc-300 mt-6">
          Data tersimpan di perangkat ini secara lokal.<br />
          {status.lastSyncAt
            ? `Sinkronisasi terakhir: ${new Date(status.lastSyncAt).toLocaleString('id-ID')}`
            : 'Belum pernah sinkronisasi.'}
        </p>
      </div>
    </div>
  )
}
