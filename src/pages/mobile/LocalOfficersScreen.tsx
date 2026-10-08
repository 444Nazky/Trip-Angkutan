import { useState, useEffect } from 'react'
import { Users, Wifi, WifiOff, RefreshCw, ChevronLeft } from 'lucide-react'
import { listOfficers } from '../../services/offlineDb'
import { getLastCredentialsSync, syncOfficerCredentials } from '../../services/credentialSync'
import type { MobileScreen } from '../types'

interface LocalOfficer {
  id: string
  username?: string
  name: string
  pin?: string
  status?: string
  region?: string
  regionName?: string
  region_name?: string
  regionCode?: string
  region_code?: string
  isActive?: boolean
}

interface LocalOfficersScreenProps {
  go: (s: MobileScreen) => void
}

export default function LocalOfficersScreen({ go }: LocalOfficersScreenProps) {
  const [officers, setOfficers] = useState<LocalOfficer[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const loadOfficers = async () => {
    setLoading(true)
    try {
      const data = await listOfficers<LocalOfficer>()
      setOfficers(data.filter(o => !o.pin && o.isActive !== false && !/^(nonaktif|non-aktif|inactive)$/i.test(o.status ?? '')))
      setLastSync(getLastCredentialsSync() || null)
    } catch (e) {
      console.error('[LocalOfficersScreen] Gagal load officers:', e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadOfficers()
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    try {
      const result = await syncOfficerCredentials()
      if (result.synced > 0) await loadOfficers()
      if (result.error) setSyncError(result.error)
    } catch {
      setSyncError('Sinkronisasi gagal. Coba lagi.')
    } finally {
      setSyncing(false)
    }
  }

  const formatSyncTime = (ts: number | null) => {
    if (!ts) return 'Belum pernah'
    const date = new Date(ts)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMin = Math.floor(diffMs / 60000)

    if (diffMin < 1) return 'Baru saja'
    if (diffMin < 60) return `${diffMin} menit lalu`
    const diffHours = Math.floor(diffMin / 60)
    if (diffHours < 24) return `${diffHours} jam lalu`
    return date.toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const formatStatus = (status?: string) => {
    if (!status) return 'Aktif'
    if (/^(nonaktif|non-aktif|inactive)$/i.test(status)) return 'Nonaktif'
    if (/^(active|aktif)$/i.test(status)) return 'Aktif'
    return status
  }

  return (
    <div className="px-4 pt-3 pb-6 space-y-4 min-h-full">
      {/* Header dengan navigasi kembali */}
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => go('profile')}
          className="w-9 h-9 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
        >
          <ChevronLeft size={20} className="text-slate-600" />
        </button>
        <div className="flex items-center gap-2">
          <Users size={20} className="text-slate-600" />
          <h2 className="font-black text-slate-900 text-[18px]">Daftar Petugas Lokal</h2>
        </div>
      </div>

      {/* Info sinkronisasi */}
      <div className="bg-white rounded-2xl px-4 py-3.5 shadow-sm border border-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${officers.length > 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-[12px] text-slate-600">
            {officers.length > 0
              ? `${officers.length} petugas tersimpan`
              : 'Belum ada data offline'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-slate-400">
            Sync: <span className="font-medium text-slate-500">{formatSyncTime(lastSync)}</span>
          </span>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 text-white text-[11px] font-semibold transition-colors"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sinkron...' : 'Sync'}
          </button>
        </div>
      </div>

      {syncError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <p className="text-red-600 text-[12px]">{syncError}</p>
        </div>
      )}

      {/* Status konektivitas */}
      <div className="flex items-center gap-2">
        <Wifi size={14} className="text-slate-400" />
        <span className="text-[11px] text-slate-500">
          Data tersimpan di perangkat untuk login offline
        </span>
      </div>

      {/* Daftar petugas */}
      <div className="space-y-3 pb-4">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-8 h-8 border-3 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
        ) : officers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center bg-white rounded-2xl border border-slate-100">
            <WifiOff size={48} className="text-slate-300 mb-4" />
            <p className="text-slate-500 text-[14px] font-semibold mb-2">Belum Ada Data Offline</p>
            <p className="text-slate-400 text-[12px] max-w-[240px]">
              Tekan "Sync" untuk mengunduh data petugas dari server
            </p>
          </div>
        ) : (
          officers.map((officer) => (
            <div
              key={officer.id}
              className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100"
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                  <Users size={20} className="text-slate-500" />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="font-bold text-slate-900 text-[14px] truncate">{officer.name}</p>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                      officer.isActive !== false
                        ? 'bg-emerald-50 text-emerald-600'
                        : 'bg-slate-100 text-slate-500'
                    }`}>
                      {formatStatus(officer.status)}
                    </span>
                  </div>
                  <p className="text-slate-400 text-[12px]">@{officer.username || officer.id}</p>
                  {(officer.regionName || officer.region_name || officer.region) && (
                    <p className="text-slate-400 text-[11px] mt-1">
                      {officer.regionName || officer.region_name || officer.region}
                      {(officer.regionCode || officer.region_code) && ` (${officer.regionCode || officer.region_code})`}
                    </p>
                  )}
                </div>

                {/* ID badge */}
                <div className="text-right shrink-0">
                  <span className="text-[11px] text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded-lg">
                    #{String(officer.id).padStart(3, '0')}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
