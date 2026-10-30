import { useState } from 'react'
import { Info, HelpCircle, X, Check, ShieldCheck, ChevronDown, ChevronUp } from 'lucide-react'




interface SideloadingHelperProps {
  variant?: 'full' | 'compact' | 'inline'
  onHelpRequested?: () => void
}




// panduan instalasi apk non-playstore
export function SideloadingHelper({
  variant = 'full',
  onHelpRequested
}: SideloadingHelperProps) {
  const [isOpen, setIsOpen] = useState(false)



  if (variant === 'inline') {
    return (
      <details className="group rounded-xl border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-600 transition-colors">
        <summary className="flex cursor-pointer list-none items-center justify-between font-medium text-slate-700">
          <span className="flex items-center gap-1.5 text-indigo-600">
            <Info size={14} /> Apa itu izin instalasi luar Play Store?
          </span>
          <ChevronDown size={14} className="transition-transform group-open:rotate-180 text-slate-400" />
        </summary>
        <div className="mt-2.5 pt-2.5 border-t border-slate-200/60 leading-relaxed text-[11px] text-slate-500">
          <p>
            Android mewajibkan izin khusus untuk memperbarui aplikasi internal perusahaan.
          </p>
          <ol className="mt-1.5 list-decimal pl-4 space-y-1">
            <li>Saat dialog muncul, pilih <strong>"Izinkan"</strong> atau <strong>"Tetap Izinkan"</strong>.</li>
            <li>Jika diarahkan ke Pengaturan, aktifkan <strong>"Sumber tidak dikenal"</strong> untuk aplikasi ini.</li>
            <li>Kembali ke aplikasi dan pasang pembaruan.</li>
          </ol>
        </div>
      </details>
    )
  }



  if (variant === 'compact') {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
      >
        <HelpCircle size={13} /> Butuh bantuan instalasi?
      </button>
    )
  }



  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-slate-50"
        aria-expanded={isOpen}
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
            <ShieldCheck size={18} />
          </span>
          <div>
            <p className="text-xs font-semibold text-slate-800">Panduan Instalasi Pembaruan</p>
            <p className="text-[10px] text-slate-400">Petunjuk izin instalasi paket APK</p>
          </div>
        </div>
        {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
      </button>

      {isOpen && (
        <div className="border-t border-slate-100 p-4 space-y-4 text-xs text-slate-600 bg-slate-50/50">
          <div>
            <h4 className="font-semibold text-slate-800 text-[11px] mb-1">Langkah Pemasangan:</h4>
            <ol className="list-decimal pl-4 space-y-1.5 text-[11px] text-slate-500">
              <li>Tap tombol <strong>"Pasang Sekarang"</strong> saat notifikasi muncul.</li>
              <li>Jika muncul peringatan sistem, tap <strong>"Setelan"</strong> lalu centang <strong>"Izinkan dari sumber ini"</strong>.</li>
              <li>Tekan tombol kembali, lalu pilih <strong>"Install / Pasang"</strong>.</li>
            </ol>
          </div>

          <div className="rounded-xl bg-emerald-50 p-3 border border-emerald-100 text-[11px] text-emerald-800 flex items-start gap-2">
            <Check size={15} className="shrink-0 mt-0.5 text-emerald-600" />
            <p>File pembaruan aman dan telah diverifikasi dari server resmi internal.</p>
          </div>

          {onHelpRequested && (
            <button
              onClick={onHelpRequested}
              className="w-full rounded-xl bg-slate-200 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-300 transition-colors"
            >
              Hubungi Bantuan IT
            </button>
          )}
        </div>
      )}
    </div>
  )
}




interface InstallResultHandlerProps {
  onSuccess?: () => void
  onFailure?: (error: string) => void
}




// handler hasil install
export function InstallResultHandler({
  onSuccess: _onSuccess,
  onFailure: _onFailure
}: InstallResultHandlerProps) {
  return null
}




interface InstallInstructionsModalProps {
  isOpen: boolean
  onClose: () => void
  version: string
}




// modal panduan instalasi
export function InstallInstructionsModal({
  isOpen,
  onClose,
  version
}: InstallInstructionsModalProps) {
  if (!isOpen) return null



  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="text-xs font-bold text-slate-800 flex items-center gap-2">
            <ShieldCheck size={16} className="text-indigo-600" /> Pembaruan {version} Siap
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={15} />
          </button>
        </div>

        <div className="mt-4 space-y-3 text-xs text-slate-600">
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600">1</span>
            <p className="text-[11px] leading-relaxed">Paket APK pembaruan akan dibuka otomatis oleh sistem Android.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600">2</span>
            <p className="text-[11px] leading-relaxed">Jika diminta izin, tap <strong>"Izinkan"</strong> atau aktifkan izin instalasi.</p>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-600">3</span>
            <p className="text-[11px] leading-relaxed">Selesaikan instalasi lalu buka kembali aplikasi.</p>
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-slate-100 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-200 transition-colors"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )
}




export const sideloadingStyles = ''




export default SideloadingHelper
