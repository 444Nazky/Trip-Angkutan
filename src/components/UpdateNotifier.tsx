import { useEffect, useState, useCallback } from 'react'
import { hardReloadToNewBundle } from '../services/otaReload'
import { Download, RefreshCw, X, Check, AlertCircle, WifiOff, Trash2 } from 'lucide-react'
import {
  getCurrentVersion,
  checkForUpdate,
  applyUpdate,
  resetAppCacheFully,
  semverLabel,
  type UpdateState
} from '../services/ota'

// ─── Props ────────────────────────────────────────────────────────────────────

export interface UpdateNotifierProps {
  /** Apakah auto-check saat mount (default: true) */
  autoCheck?: boolean
  /** Interval auto-check dalam ms (default: 30 menit) */
  checkInterval?: number
  /** Delay sebelum check pertama dalam ms (default: 5 detik) */
  initialDelay?: number
  /** Posisi notifikasi: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
}

// ─── Posisi styling ───────────────────────────────────────────────────────────

const positionClasses = {
  'bottom-right': 'bottom-20 right-4',
  'bottom-left': 'bottom-20 left-4',
  'top-right': 'top-4 right-4',
  'top-left': 'top-4 left-4',
} as const

// ─── Progress bar component ────────────────────────────────────────────────────

function ProgressBar({ progress, detail }: { progress?: number; detail?: string }) {
  if (progress === undefined) return null

  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>{detail ?? 'Mengunduh paket penuh…'}</span>
        <span>{progress}%</span>
      </div>
      <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-blue-400 transition-all duration-300 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

// ─── Icon component ──────────────────────────────────────────────────────────────

function StatusIcon({ status }: { status: UpdateState['status'] }) {
  const iconClass = "shrink-0"

  switch (status) {
    case 'checking':
    case 'downloading':
      return <Download className={`${iconClass} animate-bounce text-blue-500`} size={18} />
    case 'ready':
      return <Check className={`${iconClass} text-green-500`} size={18} />
    case 'error':
      return <AlertCircle className={`${iconClass} text-amber-500`} size={18} />
    case 'offline':
      return <WifiOff className={`${iconClass} text-slate-400`} size={18} />
    default:
      return <RefreshCw className={`${iconClass} text-slate-400`} size={18} />
  }
}

// ─── Badge variant (compact) ────────────────────────────────────────────────────

interface CompactBadgeProps {
  state: UpdateState
  onApply: () => void
  onDismiss: () => void
  position: string
}

function CompactBadge({ state, onApply, onDismiss, position }: CompactBadgeProps) {
  // Hanya tampil saat state critical atau ready
  if (state.status !== 'ready') return null

  const displayVersion = semverLabel(state.latestVersion ?? '')

  return (
    <div className={`fixed ${position} z-50 animate-in slide-in-from-bottom-2 fade-in duration-300`}>
      <div className="flex items-center gap-3 bg-slate-800/95 backdrop-blur-sm text-white rounded-full pl-4 pr-1 py-1.5 shadow-2xl border border-slate-700/50">
        <StatusIcon status={state.status} />
        <span className="text-sm font-medium">
          Update {displayVersion} siap
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={onApply}
            className="p-1.5 rounded-full bg-blue-500 hover:bg-blue-400 active:scale-95 transition-all"
            title="Terapkan update"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={onDismiss}
            className="p-1.5 rounded-full hover:bg-slate-700 active:scale-95 transition-all"
            title="Nanti saja"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sheet variant (full) ─────────────────────────────────────────────────────

interface SheetProps {
  state: UpdateState
  onApply: () => void
  onDismiss: () => void
  onRetry: () => void 
  onHardReset: () => void
  position: string
}

function UpdateSheet({ state, onApply, onDismiss, onRetry, onHardReset }: SheetProps) {
  const { status, error } = state
  const displayVersion = semverLabel(state.latestVersion ?? '')
  const activeVersion = state.activeVersion ? semverLabel(state.activeVersion) : null
  const [resetting, setResetting] = useState(false)

  // Tidak tampil jika idle atau checking
  if (status === 'idle' || status === 'checking') return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-6 animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden w-full max-w-md animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2 text-white">
            <StatusIcon status={status} />
            <span className="font-bold text-lg">
              {status === 'downloading' ? 'Memperbarui...' :
               status === 'ready' ? 'Update Siap!' :
               status === 'offline' ? 'Offline' : 'Update Gagal'}
            </span>
          </div>
          {status !== 'downloading' && (
            <button
              onClick={onDismiss}
              className="p-1 rounded-full hover:bg-white/20 transition-colors"
            >
              <X size={18} className="text-white" />
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Version info — perpindahan versi dibuat eksplisit */}
          {state.latestVersion && (
            <div className="flex items-center gap-2 mb-3">
              <span className="text-slate-500 text-sm">
                {activeVersion && activeVersion !== displayVersion ? 'Versi:' : 'Versi baru:'}
              </span>
              {activeVersion && activeVersion !== displayVersion && (
                <>
                  <span className="font-mono text-slate-400 text-sm">{activeVersion}</span>
                  <span className="text-slate-400">→</span>
                </>
              )}
              <span className="font-mono font-semibold text-slate-800">{displayVersion}</span>
            </div>
          )}

          {/* Progress bar */}
          {state.status === 'downloading' && (
            <ProgressBar progress={state.progress} detail="Membersihkan cache lama & mengunduh paket penuh…" />
          )}

          {status === 'downloading' && (
            <p className="mt-1 text-xs text-slate-400">
              Jangan tutup aplikasi. Cache versi lama dihapus lebih dulu, lalu seluruh berkas
              diunduh ulang sebagai satu paket utuh.
            </p>
          )}

          {/* Error message */}
          {status === 'error' && error && (
            <div className="mt-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-sm text-amber-700">{error}</p>
              <button
                onClick={onHardReset}
                className="mt-2 text-xs font-bold text-amber-800 bg-amber-200 hover:bg-amber-300 rounded-lg py-1.5 px-2 transition-colors"
              >
                Reset Update
              </button>
            </div>
          )}

     
          {status === 'offline' && (
            <div className="mt-2 p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center gap-2">
              <WifiOff size={16} className="text-slate-500 shrink-0" />
              <p className="text-sm text-slate-600">
                pastikan sudah terhubung ke jaringan intranet
              </p>
              <button
                onClick={onHardReset}
                className="mt-2 text-xs font-bold text-slate-600 bg-slate-200 hover:bg-slate-300 rounded-lg py-1.5 px-2 transition-colors"
              >
                Reset Koneksi
              </button>
            </div>
          )}

      
          {status === 'ready' && (
            <p className="text-base text-slate-600 mb-4">
              Update sudah siap diterapkan. Aplikasi akan memperbarui secara otomatis saat Anda menekan tombol di bawah.
            </p>
          )}

   
          <div className="flex gap-2 mt-4">
            {status === 'error' && (
              <button
                onClick={onRetry}
                className="flex-1 py-3.5 px-4 bg-blue-500 text-base hover:bg-blue-600 active:scale-[0.98] text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <RefreshCw size={16} />
                Coba Lagi
              </button>
            )}

            {status === 'ready' && (
              <>
                <button
                  onClick={onDismiss}
                  className="flex-1 py-3.5 px-4 bg-slate-100 text-base hover:bg-slate-200 active:scale-[0.98] text-slate-600 font-medium rounded-xl transition-all"
                >
                  Nanti
                </button>
                <button
                  onClick={onApply}
                  className="flex-1 py-3.5 px-4 bg-blue-500 text-base hover:bg-blue-600 active:scale-[0.98] text-white font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Check size={16} />
                  Terapkan
                </button>
              </>
            )}

            {status === 'offline' && (
              <button
                onClick={onDismiss}
                className="flex-1 py-3.5 px-4 bg-slate-100 text-base hover:bg-slate-200 active:scale-[0.98] text-slate-600 font-medium rounded-xl transition-all"
              >
                Tutup
              </button>
            )}
          </div>

          {/* Fallback lapangan — SELALU tersedia (bukan hanya saat error/offline).
              Menghapus seluruh cache OTA + registrasi Service Worker lalu memuat
              ulang aplikasi, pengganti "Clear Data" manual dari Setting Android.
              Dipakai saat unduhan menggantung / jaringan timeout berulang. */}
          <button
            onClick={async () => {
              setResetting(true)
              try { await onHardReset() } finally { setResetting(false) }
            }}
            disabled={resetting}
            className="mt-3 w-full py-2.5 px-4 bg-white border border-slate-200 text-sm hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60 text-slate-500 font-medium rounded-xl transition-all flex items-center justify-center gap-2"
            title="Hapus semua cache pembaruan & muat ulang aplikasi dari bundel bawaan"
          >
            <Trash2 size={15} />
            {resetting ? 'Membersihkan cache…' : 'Reset & Paksa Pembaruan'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function UpdateNotifier({
  autoCheck = true,
  checkInterval = 30 * 60 * 1000,
  initialDelay = 5000,
  position = 'bottom-right',
}: UpdateNotifierProps) {
  const [state, setState] = useState<UpdateState>({ status: 'idle' })
  const [currentVersion, setCurrentVersion] = useState<string>('0.0.0')
  const positionClass = position in positionClasses ? positionClasses[position] : positionClasses['bottom-right']

  // Initialize version on mount
  useEffect(() => {
    getCurrentVersion().then(v => {
      if (v) {
        setCurrentVersion(v)
      }
    })
  }, [])

  // Check for updates
  const performCheck = useCallback(async () => {
    try {
      await checkForUpdate(currentVersion, setState)
    } catch (err) {
      console.warn('[UpdateNotifier] Check failed:', err)
    }
  }, [currentVersion])

  // Auto-check on mount
  useEffect(() => {
    if (!autoCheck) return

    // Initial delay to let app load first
    const timer = setTimeout(() => {
      void performCheck()
    }, initialDelay)

    return () => clearTimeout(timer)
  }, [autoCheck, initialDelay, performCheck])

  // Periodic background check
  useEffect(() => {
    if (!autoCheck) return

    const intervalId = setInterval(() => {
      void performCheck()
    }, checkInterval)

    return () => clearInterval(intervalId)
  }, [autoCheck, checkInterval, performCheck])

  // Cek ulang segera saat perangkat kembali online
  useEffect(() => {
    if (!autoCheck) return
    const onOnline = () => { void performCheck() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [autoCheck, performCheck])

  // Apply update → aktivasi atomik (bundle terverifikasi) → reload ber-versi
  const handleApply = useCallback(async () => {
    setState(s => ({ ...s, status: 'downloading' }))
    const success = await applyUpdate()
    if (!success) {
      setState({ status: 'error', error: 'Gagal menerapkan pembaruan' })
      return
    }
    const applied = await getCurrentVersion()
    if (applied) setCurrentVersion(applied)
    await hardReloadToNewBundle(applied ?? undefined)
  }, [currentVersion])

  // Dismiss update notification
  const handleDismiss = useCallback(() => {
    setState({ status: 'idle' })
  }, [])

  // Retry failed update
  const handleRetry = useCallback(() => {
    void performCheck()
  }, [performCheck])

  // Fallback lapangan: purge SELURUH cache OTA + state + registrasi Service
  // Worker, lalu reload bersih ke bundel bawaan APK (pengganti "Clear Data"
  // manual dari Setting Android).
  const handleHardReset = useCallback(async () => {
    await resetAppCacheFully()
    await hardReloadToNewBundle()
  }, [])

  // Render based on state
  const shouldShowBadge = state.status === 'ready'
  const shouldShowSheet = state.status !== 'idle' && state.status !== 'checking'

  if (!shouldShowBadge && !shouldShowSheet) {
    return null
  }

  return (
    <>
      {/* Compact badge for ready state */}
      {shouldShowBadge && (
        <CompactBadge
          state={state}
          onApply={handleApply}
          onDismiss={handleDismiss}
          position={positionClass}
        />
      )}

      {/* Full sheet for other states */}
      {shouldShowSheet && state.status !== 'ready' && (
        <UpdateSheet
          state={state}
          onApply={handleApply}
          onDismiss={handleDismiss}
          onRetry={handleRetry}
          onHardReset={handleHardReset}
          position={positionClass}
        />
      )}
    </>
  )
}

// ─── Hook for direct usage ─────────────────────────────────────────────────────