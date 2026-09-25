import { useState } from 'react'
import { ChevronLeft, Lock } from 'lucide-react'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

interface TripConditionScreenProps {
  go: (s: MobileScreen) => void
}

// Kode rute yang dikunci untuk trip tanpa muatan (spesifikasi: hanya SJRE → SBDZ)
export const EMPTY_ROUTE_CODE = 'SJRE-SBDZ'

export default function TripConditionScreen({ go }: TripConditionScreenProps) {
  const { draft, patchDraft } = useApp()
  const [condition, setCondition] = useState<'kosong' | 'muatan' | null>(draft.condition)

  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <button onClick={() => go('home')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>
      <h2 className="font-black text-slate-900 text-[20px] mb-0.5">Status Muatan</h2>
      <p className="text-slate-500 text-[13px] mb-4">Pilih status muatan trip ini sebelum memilih rute</p>

      <div className="space-y-3 mb-5">
        {[
          {
            key: 'kosong',
            label: 'Kosong / Tidak Ada Muatan',
            desc: 'Kendaraan berjalan tanpa muatan — rute dikunci SJRE → SBDZ',
            emoji: '🚛',
          },
          {
            key: 'muatan',
            label: 'Ada Angkutan',
            desc: 'Kendaraan membawa muatan — pilihan rute bebas tanpa batasan',
            emoji: '📦',
          },
        ].map(opt => (
          <button
            key={opt.key}
            onClick={() => {
              const next = opt.key as 'kosong' | 'muatan'
              setCondition(next)
              if (next === 'kosong') {
                // Trip kosong: buang kendaraan/foto yang mungkin terlanjur diisi
                // dan kunci rute hanya SJRE → SBDZ.
                patchDraft({
                  condition: 'kosong',
                  vehicles: [],
                  vehicleForm: { plate: '', type: '', category: '' },
                  photo: false,
                  photoUrl: undefined,
                  cameraMode: 'photo',
                  ocrResult: undefined,
                  ocrError: undefined,
                  routeCode: EMPTY_ROUTE_CODE,
                })
              } else {
                patchDraft({ condition: 'muatan' })
              }
            }}
            className={`w-full rounded-3xl p-5 text-left border-2 transition-all ${condition === opt.key ? opt.key === 'muatan' ? 'border-blue-500 bg-blue-50' : 'border-slate-400 bg-slate-50' : 'border-slate-100 bg-white hover:border-slate-200'}`}
          >
            <div className="flex items-start gap-4">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center text-2xl shrink-0 ${condition === opt.key && opt.key === 'muatan' ? 'bg-blue-100' : condition === opt.key ? 'bg-slate-200' : 'bg-slate-100'}`}>{opt.emoji}</div>
              <div className="flex-1">
                <p className="font-bold text-slate-900 text-[13px] mb-0.5">{opt.label}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{opt.desc}</p>
                {opt.key === 'kosong' && condition === 'kosong' && (
                  <span className="inline-flex items-center gap-1 mt-2 text-[10px] font-black uppercase tracking-wide text-slate-600 bg-slate-200 rounded-full px-2 py-0.5">
                    <Lock size={10} /> Rute terkunci SJRE → SBDZ
                  </span>
                )}
              </div>
              <div className={`w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${condition === opt.key ? opt.key === 'muatan' ? 'border-blue-500 bg-blue-500' : 'border-slate-500 bg-slate-500' : 'border-slate-200'}`}>
                {condition === opt.key && <div className="w-2 h-2 rounded-full bg-white" />}
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={() => go('route-select')}
        disabled={!condition}
        className="w-full bg-[#0F172A] text-white font-bold py-4 rounded-2xl text-[13px] disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all"
      >
        {condition === 'muatan' ? 'Lanjut Pilih Rute' : condition === 'kosong' ? 'Lanjut (Rute Terkunci)' : 'Pilih Status Muatan'}
      </button>
    </div>
  )
}
