import { useState, useEffect, useCallback } from 'react'
import { Sparkles, Download, CheckCircle2, AlertTriangle, X, RefreshCw, ArrowRight } from 'lucide-react'
import { updateService, type UpdateState, type UpdateInfo, type UpdateError } from '../services/updateService'




interface UpdateNotifierProps {
  onUpdateReady?: (version: string) => void
  onUpdateApplied?: () => void
  onError?: (error: UpdateError) => void
  autoCheck?: boolean
  showForceUpdate?: boolean
}




interface UpdateNotifierUI {
  state: UpdateState
  info: UpdateInfo | null
  error: UpdateError | null
  pendingVersion: string | null
  currentVersion: string
}




// hook buat pantau state update
export function useUpdateNotifier(): UpdateNotifierUI {
  const [state, setState] = useState<UpdateState>('idle')
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [error, setError] = useState<UpdateError | null>(null)



  useEffect(() => {
    const unsubscribe = updateService.subscribe((newState, newInfo, newError) => {
      setState(newState)
      setInfo(newInfo || null)
      setError(newError || null)
    })

    return unsubscribe
  }, [])



  return {
    state,
    info,
    error,
    pendingVersion: updateService.pendingVersion,
    currentVersion: updateService.currentVersion,
  }
}




// komponen popup / toast notifikasi update
export function UpdateNotifier({
  onUpdateReady,
  onUpdateApplied,
  onError,
  autoCheck = true,
  showForceUpdate = true,
}: UpdateNotifierProps) {
  const { state, info, error, pendingVersion } = useUpdateNotifier()
  const [dismissed, setDismissed] = useState(false)



  useEffect(() => {
    if (autoCheck && (state === 'idle' || state === 'up-to-date')) {
      void updateService.checkForUpdate()
    }
  }, [autoCheck])



  useEffect(() => {
    if (state === 'ready' && pendingVersion) {
      setDismissed(false)
      onUpdateReady?.(pendingVersion)
    }
    if (state === 'installing') {
      onUpdateApplied?.()
    }
    if (state === 'error' && error) {
      onError?.(error)
    }
  }, [state, pendingVersion, error, onUpdateReady, onUpdateApplied, onError])



  const installUpdate = useCallback(async () => {
    await updateService.installUpdate()
  }, [])



  const retryUpdate = useCallback(async () => {
    if (info?.downloadUrl) {
      await updateService.downloadUpdate(info.latestVersion, info.downloadUrl, info.apkHash)
    }
  }, [info])



  const resetUpdate = useCallback(async () => {
    setDismissed(true)
    await updateService.reset()
  }, [])



  // sembunyikan jika idle, up-to-date, atau proses background check/download
  if (state === 'up-to-date' || state === 'idle' || state === 'checking' || state === 'downloading') {
    return null
  }

  if (dismissed && !info?.isForceUpdate) {
    return null
  }



  // modal update wajib
  if (showForceUpdate && info?.isForceUpdate && state !== 'installing') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl text-center border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 mb-4 shadow-inner">
            <Sparkles size={32} />
          </div>

          <h3 className="text-lg font-bold text-slate-800">Pembaruan Wajib</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Versi baru <span className="font-semibold text-indigo-600">{info?.latestVersion}</span> diperlukan agar aplikasi dapat terus berjalan dengan optimal.
          </p>

          {info?.releaseNotes && (
            <div className="mt-4 max-h-32 overflow-y-auto rounded-xl bg-slate-50 p-3 text-left text-[11px] text-slate-600 border border-slate-100">
              <p className="font-semibold text-slate-700 mb-1">Catatan Rilis:</p>
              <p className="whitespace-pre-line leading-normal">{info.releaseNotes}</p>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-2">
            {state === 'ready' ? (
              <button
                onClick={() => void installUpdate()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-xs font-semibold text-white shadow-md shadow-indigo-200 hover:bg-indigo-700 active:scale-[0.98] transition-all"
              >
                <Download size={15} /> Pasang Pembaruan Sekarang
              </button>
            ) : state === 'error' ? (
              <button
                onClick={() => void retryUpdate()}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-rose-600 py-3 text-xs font-semibold text-white shadow-md shadow-rose-200 hover:bg-rose-700 active:scale-[0.98] transition-all"
              >
                <RefreshCw size={15} /> Coba Unduh Lagi
              </button>
            ) : null}
          </div>
        </div>
      </div>
    )
  }



  // floating toast elegan saat siap pasang atau error
  return (
    <div className="fixed top-4 inset-x-0 z-[9990] flex justify-center px-4 pointer-events-none">
      <div className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-3.5 shadow-xl shadow-slate-900/10 backdrop-blur-md transition-all animate-in slide-in-from-top-4 duration-300">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${state === 'ready' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            {state === 'ready' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <h4 className="text-xs font-bold text-slate-800">
                {state === 'ready' ? 'Pembaruan Siap' : 'Pembaruan Gagal'}
              </h4>
              <button
                onClick={() => void resetUpdate()}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Tutup"
              >
                <X size={14} />
              </button>
            </div>

            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
              {state === 'ready'
                ? `Versi ${info?.latestVersion || pendingVersion} sudah siap dipasang ke perangkat.`
                : (error?.message || 'Gagal mengunduh pembaruan.')}
            </p>

            <div className="mt-3 flex items-center gap-2">
              {state === 'ready' && (
                <button
                  onClick={() => void installUpdate()}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition-all"
                >
                  Pasang Sekarang <ArrowRight size={12} />
                </button>
              )}

              {state === 'error' && (
                <button
                  onClick={() => void retryUpdate()}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm hover:bg-rose-700 active:scale-95 transition-all"
                >
                  <RefreshCw size={12} /> Coba Lagi
                </button>
              )}

              <button
                onClick={() => setDismissed(true)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 hover:bg-slate-100 transition-colors"
              >
                Nanti
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}




interface UpdateStatusBadgeProps {
  className?: string
}




// badge status versi
export function UpdateStatusBadge({ className = '' }: UpdateStatusBadgeProps) {
  const { state, info, currentVersion } = useUpdateNotifier()



  if (state === 'up-to-date' || state === 'idle') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 border border-emerald-100 ${className}`}>
        v{currentVersion}
      </span>
    )
  }

  if (state === 'ready') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 border border-indigo-100 ${className}`}>
        Ada v{info?.latestVersion || '?'}
      </span>
    )
  }

  if (state === 'error') {
    return (
      <span className={`inline-flex items-center gap-1 rounded-md bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 border border-rose-100 ${className}`}>
        Update gagal
      </span>
    )
  }

  return null
}




export const updateStyles = ''




export default UpdateNotifier
