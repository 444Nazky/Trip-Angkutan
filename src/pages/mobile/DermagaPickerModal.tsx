import { useState } from 'react'
import { Anchor, Check, X } from 'lucide-react'

// ─── DermagaPickerModal ────────────────────────────────────────────────────────
// Modal overlay ringan yang muncul saat petugas akses-ganda menekan "Mulai Trip".
// Petugas harus memilih dermaga untuk trip ini sebelum bisa melanjutkan.
// Pilihan bersifat per-trip: pop-up akan muncul kembali di trip berikutnya.

interface DermagaItem {
  id: string
  name: string
}

interface DermagaPickerModalProps {
  dermagas: DermagaItem[]
  onSelect: (dermagaId: string) => void
  onCancel: () => void
}

export default function DermagaPickerModal({ dermagas, onSelect, onCancel }: DermagaPickerModalProps) {
  const [selected, setSelected] = useState<string | null>(null)

  const handleConfirm = () => {
    if (!selected) return
    onSelect(selected)
  }

  return (
    // Backdrop semi-transparan
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
    >
      {/* Card dialog — muncul dari bawah */}
      <div className="w-full max-w-md bg-white rounded-t-3xl px-5 pt-5 pb-8 shadow-2xl animate-slide-up">

        {/* Handle bar */}
        <div className="w-10 h-1 rounded-full bg-slate-200 mx-auto mb-5" />

        {/* Header */}
        <div className="bg-[#0F172A] rounded-2xl p-4 mb-5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Anchor size={14} className="text-amber-400" />
              <span className="text-amber-400 text-[11px] font-black tracking-widest uppercase">Dual Access</span>
            </div>
            <button
              onClick={onCancel}
              className="w-7 h-7 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
            >
              <X size={14} className="text-white" />
            </button>
          </div>
          <h2 className="text-white font-black text-[18px] mb-0.5">Pilih Dermaga Trip</h2>
          <p className="text-slate-400 text-[12px]">
            Anda memiliki akses ke {dermagas.length} dermaga. Pilih dermaga untuk trip ini.
          </p>
        </div>

        {/* Daftar dermaga */}
        <div className="space-y-3 mb-5">
          {dermagas.map(dm => (
            <button
              key={dm.id}
              onClick={() => setSelected(dm.id)}
              className={`w-full rounded-2xl p-4 border-2 transition-all flex items-center gap-4 ${
                selected === dm.id
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-100 bg-white hover:border-slate-200'
              }`}
            >
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
                selected === dm.id ? 'bg-blue-600' : 'bg-slate-100'
              }`}>
                <Anchor size={20} className={selected === dm.id ? 'text-white' : 'text-slate-500'} />
              </div>
              <div className="flex-1 text-left">
                <p className="font-bold text-slate-900 text-[14px]">{dm.name}</p>
                <p className="text-[11px] text-slate-400">Tap untuk memilih dermaga ini</p>
              </div>
              {selected === dm.id && (
                <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                  <Check size={14} className="text-white" />
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Tombol aksi */}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 rounded-xl border-2 border-slate-200 text-slate-700 font-semibold text-[13px] hover:bg-slate-50 active:scale-95 transition-all"
          >
            Batal
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selected}
            className="flex-2 flex-grow-[2] py-3.5 rounded-xl bg-blue-600 text-white font-bold text-[13px] disabled:opacity-40 hover:bg-blue-700 active:scale-95 transition-all"
          >
            Lanjut Trip
          </button>
        </div>
      </div>
    </div>
  )
}
