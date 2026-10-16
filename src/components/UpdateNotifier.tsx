import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, RefreshCw, Sparkles, X } from 'lucide-react'
import { appUpdate, type AppUpdateState } from '../services/appUpdate'



// Satu sumber status pembaruan untuk seluruh UI.
export function useAppUpdate(): AppUpdateState {
  const [state, setState] = useState<AppUpdateState>(appUpdate.state)
  useEffect(() => appUpdate.subscribe(setState), [])
  return state
}



interface UpdateNotifierProps {
  autoCheck?: boolean
}



export default function UpdateNotifier({ autoCheck = true }: UpdateNotifierProps) {
  const state = useAppUpdate()
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)



  useEffect(() => {
    if (autoCheck) void appUpdate.check()
  }, [autoCheck])



  useEffect(() => {
    if (state.status === 'ready') setDismissed(false)
  }, [state.status, state.version])



  const apply = useCallback(async () => {
    setBusy(true)
    try {
      await appUpdate.apply()
    } finally {
      setBusy(false)
    }
  }, [])



  const retry = useCallback(async () => {
    setBusy(true)
    try {
      await appUpdate.check()
    } finally {
      setBusy(false)
    }
  }, [])



  if (state.status === 'installing' && state.kind === 'apk') {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-4 z-[9990] flex justify-center px-4">
        <div className="pointer-events-auto w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white/95 p-3.5 shadow-xl backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
              <Download size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <h4 className="text-xs font-bold text-slate-800">Menyelesaikan pemasangan…</h4>
              <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">
                Setujui dialog pemasangan Android. Versi baru terhitung setelah aplikasi hidup kembali.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const showToast = state.status === 'ready' || state.status === 'error'
  if (!showToast) return null
  if (dismissed && !state.isForce) return null



  const label = state.error ? 'Pembaruan Gagal' : 'Pembaruan Siap'
  const detail = state.status === 'error'
    ? state.error
    : `Versi ${state.version ?? '—'} siap dipasang${state.kind === 'module' ? ' (tanpa ganti APK)' : ''}.`



  if (state.isForce && state.status === 'ready') {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
        <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-center shadow-2xl border border-slate-100">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <Sparkles size={32} />
          </div>
          <h3 className="text-lg font-bold text-slate-800">Pembaruan Wajib</h3>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Versi <span className="font-semibold text-indigo-600">{state.version}</span> diperlukan agar aplikasi tetap berjalan optimal.
          </p>
          {state.notes && (
            <div className="mt-4 max-h-32 overflow-y-auto rounded-xl border border-slate-100 bg-slate-50 p-3 text-left text-[11px] text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">Catatan Rilis:</p>
              <p className="whitespace-pre-line leading-normal">{state.notes}</p>
            </div>
          )}
          <button
            onClick={() => void apply()}
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3 text-xs font-semibold text-white shadow-md shadow-indigo-200 transition-all hover:bg-indigo-700 disabled:opacity-60"
          >
            <Download size={15} /> Perbarui Sekarang
          </button>
        </div>
      </div>
    )
  }



  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[9990] flex justify-center px-4">
      <div className="pointer-events-auto w-full max-w-sm overflow-hidden rounded-2xl border border-slate-200/80 bg-white/95 p-3.5 shadow-xl shadow-slate-900/10 backdrop-blur-md">
        <div className="flex items-start gap-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${state.status === 'ready' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
            {state.status === 'ready' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-1">
              <h4 className="text-xs font-bold text-slate-800">{label}</h4>
              <button
                onClick={() => setDismissed(true)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label="Tutup"
              >
                <X size={14} />
              </button>
            </div>
            <p className="mt-0.5 text-[11px] leading-relaxed text-slate-500">{detail}</p>
            <div className="mt-3 flex items-center gap-2">
              {state.status === 'ready' && (
                <button
                  onClick={() => void apply()}
                  disabled={busy}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-all hover:bg-emerald-700 disabled:opacity-60"
                >
                  Perbarui Sekarang
                </button>
              )}
              {state.status === 'error' && (
                <button
                  onClick={() => void retry()}
                  disabled={busy}
                  className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-all hover:bg-rose-700 disabled:opacity-60"
                >
                  <RefreshCw size={12} /> Coba Lagi
                </button>
              )}
              <button
                onClick={() => setDismissed(true)}
                className="rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100"
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
