// ─── Sync Status Widget ────────────────────────────────────────────────
// Shows sync status and triggers manual sync from within the app settings.

import { useEffect, useState } from 'react'
import { RefreshCw, CheckCircle, AlertCircle, Wifi, WifiOff, Database } from 'lucide-react'
import { performInitialSync, getSyncStatus, isOnline, hasLocalMasterData, type SyncStatus } from '../services/offline-init'
import { getOfflineSession } from '../services/offline-auth'

interface SyncWidgetProps {
  compact?: boolean
  onSyncComplete?: () => void
}

export default function SyncWidget({ compact = false, onSyncComplete }: SyncWidgetProps) {
  const [syncing, setSyncing] = useState(false)
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus())
  const [stage, setStage] = useState<string | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [online, setOnline] = useState(isOnline())

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  async function handleSync() {
    if (syncing || !online) return
    setSyncing(true)
    setErrors([])
    const result = await performInitialSync((s) => { setStage(s) })
    setStatus(getSyncStatus())
    setSyncing(false)
    setStage(null)
    if (result.success) onSyncComplete?.()
    else setErrors(result.errors)
  }

  const session = getOfflineSession()
  const hasData = hasLocalMasterData()

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500">
        {online ? <Wifi size={12} className="text-green-600" /> : <WifiOff size={12} className="text-zinc-400" />}
        <span>{online ? 'Online' : 'Offline'}</span>
        {status.lastSyncAt && (
          <span className="text-zinc-400">
            · sinkronisasi terakhir {new Date(status.lastSyncAt).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' })}
          </span>
        )}
        {online && !syncing && (
          <button onClick={handleSync} className="hover:text-zinc-900 transition-colors ml-1">
            <RefreshCw size={12} />
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 p-5 font-sans">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${online ? 'bg-green-50' : 'bg-zinc-100'}`}>
          {online ? <Wifi size={16} className="text-green-600" /> : <WifiOff size={16} className="text-zinc-400" />}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">
            {online ? 'Sinkronisasi Data' : 'Mode Offline'}
          </h3>
          <p className="text-xs text-zinc-400">
            {online ? 'Data master tersimpan di perangkat' : 'Menggunakan data tersimpan lokal'}
          </p>
        </div>
      </div>

      {/* Session */}
      {session && (
        <div className="bg-zinc-50 rounded-xl px-3 py-2 text-xs text-zinc-600 mb-3 flex items-center gap-2">
          <CheckCircle size={12} className="text-green-600 shrink-0" />
          <span className="font-medium">{session.officerName}</span>
          <span className="text-zinc-400">· {session.regionName}</span>
        </div>
      )}

      {/* Counts */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Petugas', value: status.syncedOfficers },
          { label: 'Dermaga', value: status.syncedDermagas },
          { label: 'Rute', value: status.syncedRoutes },
        ].map(({ label, value }) => (
          <div key={label} className="bg-zinc-50 rounded-xl px-3 py-2 text-center">
            <p className="text-lg font-bold text-zinc-900">{value}</p>
            <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
          </div>
        ))}
      </div>

      {/* Last sync */}
      {status.lastSyncAt && (
        <p className="text-xs text-zinc-400 mb-3">
          Sinkronisasi terakhir:{' '}
          {new Date(status.lastSyncAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}

      {/* Errors */}
      {errors.length > 0 && (
        <div className="space-y-1 mb-3">
          {errors.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-xs text-red-600 bg-red-50 rounded-lg p-2 text-left">
              <AlertCircle size={12} className="shrink-0 mt-0.5" />
              {e}
            </div>
          ))}
        </div>
      )}

      {/* Sync button */}
      {online && (
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-full py-2.5 bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-400 text-white rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:cursor-not-allowed"
        >
          {syncing ? (
            <>
              <RefreshCw size={14} className="animate-spin" />
              {stage || 'Sinkronisasi...'}
            </>
          ) : (
            <>
              <RefreshCw size={14} />
              Sinkronisasi Sekarang
            </>
          )}
        </button>
      )}

      {!online && (
        <p className="text-xs text-amber-600 text-center">
          Tidak ada koneksi. Data tetap tersedia secara offline.
        </p>
      )}
    </div>
  )
}
