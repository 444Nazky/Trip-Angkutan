import { Anchor, Check } from 'lucide-react'
import { useApp } from '../store'
import { selectDermaga, type Dermaga } from '../../services/auth'
import { useState } from 'react'
import type { MobileScreen } from '../types'

interface DermagaSelectScreenProps {
  go: (s: MobileScreen) => void
  dermagas: Dermaga[]
  onSelected: (dermaga: Dermaga) => void
  onCancel: () => void
}

export default function DermagaSelectScreen({ go, dermagas, onSelected, onCancel }: DermagaSelectScreenProps) {
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    if (!selected) return
    setLoading(true)
    setError('')

    const result = await selectDermaga(selected)
    if (result.success) {
      const dermaga = dermagas.find(d => d.id === selected)
      if (dermaga) onSelected(dermaga)
    } else {
      setError(result.error || 'Gagal memilih dermaga')
    }
    setLoading(false)
  }

  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <div className="bg-[#0F172A] rounded-3xl p-5 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Anchor size={14} className="text-amber-400" />
          <span className="text-amber-400 text-[11px] font-black tracking-widest uppercase">Dual Access</span>
        </div>
        <h2 className="text-white font-black text-[18px] mb-0.5">Pilih Dermaga</h2>
        <p className="text-slate-400 text-[12px]">
          Anda memiliki akses ke {dermagas.length} dermaga. Pilih dermaga untuk sesi ini.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4">
          <p className="text-red-600 text-[12px] font-semibold">{error}</p>
        </div>
      )}

      <div className="space-y-3">
        {dermagas.map(dm => (
          <button
            key={dm.id}
            onClick={() => setSelected(dm.id)}
            className={`w-full bg-white rounded-2xl p-4 shadow-sm border-2 transition-all flex items-center gap-4 ${
              selected === dm.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-slate-100 hover:border-slate-200'
            }`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              selected === dm.id ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
            }`}>
              <Anchor size={20} />
            </div>
            <div className="flex-1 text-left">
              <p className="font-bold text-slate-900 text-[14px]">{dm.name}</p>
              <p className="text-[11px] text-slate-500">
                {dm.region_name} ({dm.region_code})
              </p>
            </div>
            {selected === dm.id && (
              <div className="w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
                <Check size={14} className="text-white" />
              </div>
            )}
          </button>
        ))}
      </div>

      <div className="flex gap-3 mt-5">
        <button
          onClick={onCancel}
          className="flex-1 py-3.5 rounded-xl border-2 border-slate-200 text-slate-700 font-semibold text-[13px]"
        >
          Batal
        </button>
        <button
          onClick={handleConfirm}
          disabled={!selected || loading}
          className="flex-1 py-3.5 rounded-xl bg-blue-600 text-white font-bold text-[13px] disabled:opacity-50"
        >
          {loading ? 'Memilih...' : 'Pilih Dermaga'}
        </button>
      </div>
    </div>
  )
}
