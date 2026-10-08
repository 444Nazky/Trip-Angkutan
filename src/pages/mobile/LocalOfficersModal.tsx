import { useState, useEffect } from 'react'
import { Users, X, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { listOfficers } from '../../services/offlineDb'
import { getLastCredentialsSync, syncOfficerCredentials } from '../../services/credentialSync'

// ─── LocalOfficersModal ──────────────────────────────────────────────────
// Modal untuk menampilkan daftar petugas yang tersimpan secara lokal.
// Bisa digunakan untuk login offline.

interface LocalOfficer {
  id: string
  username?: string
  name: string
  /** Hanya baris data lama dengan PIN polos yang disembunyikan. */
  pin?: string
  status?: string
  region?: string
  regionName?: string
  region_name?: string
  regionCode?: string
  region_code?: string
  isActive?: boolean
}

interface LocalOfficersModalProps {
  onClose: () => void
}

export default function LocalOfficersModal({ onClose }: LocalOfficersModalProps) {
  const [officers, setOfficers] = useState<LocalOfficer[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [lastSync, setLastSync] = useState<number | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const loadOfficers = async () => {
    setLoading(true)
    try {
      const data = await listOfficers<LocalOfficer>()
      // Sembunyikan hanya baris ber-PIN polos (data lama) — petugas dengan
      // `pin: ''` (termasuk DATA BAWAAN/seed) tetap tampil untuk login offline.
      setOfficers(data.filter(o => !o.pin && o.isActive !== false && !/^(nonaktif|non-aktif|inactive)$/i.test(o.status ?? '')))
      setLastSync(getLastCredentialsSync() || null)
    } catch (e) {
      console.error('[LocalOfficersModal] Gagal load officers:', e)
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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="w-full max-w-md bg-white rounded-t-3xl px-5 pt-5 pb-8 shadow-2xl animate-slide-up max-h-[85vh] flex flex-col">

        {/* Handle bar */}
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-4" />

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Users size={18} className="text-slate-600" />
            <h2 className="font-black text-slate-900 text-[16px]">Daftar Petugas Lokal</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
          >
            <X size={16} className="text-slate-600" />
          </button>
        </div>

        {/* Info sync */}
        <div className="bg-slate-50 rounded-xl px-4 py-3 mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi size={14} className="text-slate-400" />
            <span className="text-[11px] text-slate-500">
              Sinkronisasi: <span className="font-semibold">{formatSyncTime(lastSync)}</span>
            </span>
          </div>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-slate-300 text-white text-[11px] font-semibold transition-colors"
          >
            <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Sinkron...' : 'Sync'}
          </button>
        </div>

        {syncError && <p className="text-red-600 text-[11px] mb-4" role="alert">{syncError}</p>}

        {/* Status info */}
        <div className="flex items-center gap-2 mb-4">
          <div className={`w-2 h-2 rounded-full ${officers.length > 0 ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span className="text-[11px] text-slate-500">
            {officers.length > 0
              ? `${officers.length} petugas tersimpan untuk login offline`
              : 'Tidak ada data petugas lokal'}
          </span>
        </div>

        {/* Daftar petugas */}
        <div className="flex-1 overflow-y-auto space-y-2 mb-4 min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-slate-200 border-t-slate-600 rounded-full animate-spin" />
            </div>
          ) : officers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <WifiOff size={32} className="text-slate-300 mb-3" />
              <p className="text-slate-500 text-[13px] font-medium mb-1">Belum Ada Data Offline</p>
              <p className="text-slate-400 text-[11px]">
                Tekan "Sync" untuk mengunduh data petugas
              </p>
            </div>
          ) : (
            officers.map((officer) => (
              <div
                key={officer.id}
                className="bg-white rounded-xl border border-slate-100 p-4 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <Users size={18} className="text-slate-500" />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-bold text-slate-900 text-[13px] truncate">{officer.name}</p>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        officer.isActive !== false
                          ? 'bg-emerald-50 text-emerald-600'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {formatStatus(officer.status)}
                      </span>
                    </div>
                    <p className="text-slate-400 text-[11px]">@{officer.username || officer.id}</p>
                    {(officer.regionName || officer.region_name || officer.region) && (
                      <p className="text-slate-400 text-[11px] mt-0.5">
                        {officer.regionName || officer.region_name || officer.region}
                        {(officer.regionCode || officer.region_code) && ` (${officer.regionCode || officer.region_code})`}
                      </p>
                    )}
                  </div>

                  {/* ID badge */}
                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-slate-400 font-mono">
                      #{String(officer.id).padStart(3, '0')}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="text-center">
          <p className="text-[10px] text-slate-400">
            Data ini tersimpan di perangkat Anda untuk login offline
          </p>
        </div>
      </div>
    </div>
  )
}
