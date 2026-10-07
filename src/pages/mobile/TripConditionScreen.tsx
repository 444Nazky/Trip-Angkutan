import { useEffect, useState } from 'react'
import { ChevronLeft, Package, Truck } from 'lucide-react'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

interface TripConditionScreenProps {
  go: (s: MobileScreen) => void
}

export default function TripConditionScreen({ go }: TripConditionScreenProps) {
  const { draft, patchDraft } = useApp()
  const [condition, setCondition] = useState<'kosong' | 'muatan' | null>(draft.condition)
  useEffect(() => { setCondition(draft.condition) }, [draft.condition])

  const bgForCondition = (key: string) => {
    if (condition !== key) return 'bg-slate-100'
    return key === 'muatan' ? 'bg-blue-100' : 'bg-slate-200'
  }
  const textColor = (key: string, selected: boolean) => {
    if (!selected) return 'text-slate-400'
    return key === 'muatan' ? 'text-blue-600' : 'text-slate-700'
  }
  const borderClass = (key: string) => {
    if (condition !== key) return 'border-slate-100 bg-white hover:border-slate-200'
    return key === 'muatan' ? 'border-blue-500 bg-blue-50' : 'border-slate-400 bg-slate-50'
  }
  const dotColor = (key: string) => {
    if (condition !== key) return 'border-slate-200'
    return key === 'muatan' ? 'border-blue-500 bg-blue-500' : 'border-slate-500 bg-slate-500'
  }

  return (
    <div className="px-4 pt-2 pb-4">
      <button onClick={() => go('home')} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>
      <h2 className="font-black text-slate-900 text-[20px] mb-0.5">Status Muatan</h2>
      <p className="text-slate-500 text-[13px] mb-4">Pilih status muatan trip ini sebelum memilih rute</p>

      <div className="space-y-3 mb-5">
        {/* Kosong */}
        <button
          onClick={() => {
            setCondition('kosong')
            patchDraft({
              condition: 'kosong',
              vehicles: [],
              vehicleForm: { plate: '', type: '', category: '' },
              photo: false,
              photoUrl: undefined,
              photoCapturedAt: undefined,
              photoLatitude: undefined,
              photoLongitude: undefined,
              vPhoto: false,
              vPhotoUrl: undefined,
              vPhotoCapturedAt: undefined,
              vPhotoLatitude: undefined,
              vPhotoLongitude: undefined,
              retakeTarget: undefined,
              cameraMode: 'photo',
              ocrResult: undefined,
              ocrError: undefined,
            })
          }}
          className={`w-full rounded-3xl p-5 text-left border-2 transition-all ${borderClass('kosong')}`}
        >
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${bgForCondition('kosong')}`}>
              <Truck size={20} className={textColor('kosong', condition === 'kosong')} />
            </div>
            <div className="flex-1">
              <p className="font-bold text-slate-900 text-[13px] mb-0.5">Kosong / Tidak Ada Muatan</p>
              <p className="text-[11px] text-slate-500 leading-relaxed">Kendaraan berjalan tanpa muatan — pilih rute bebas</p>
              
            </div>
            <div className={`w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${dotColor('kosong')}`}>
              {condition === 'kosong' && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>
          </div>
        </button>

        {/* Muatan */}
        <button
          onClick={() => {
            setCondition('muatan')
            patchDraft({ condition: 'muatan' })
          }}
          className={`w-full rounded-3xl p-5 text-left border-2 transition-all ${borderClass('muatan')}`}
        >
          <div className="flex items-start gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${bgForCondition('muatan')}`}>
              <Package size={20} className={textColor('muatan', condition === 'muatan')} />
            </div>
            <div className="flex-1">
              <p className="font-bold text-slate-900 text-[13px] mb-0.5">Ada Angkutan</p>
              <p className="text-[11px] text-slate-500 leading-relaxed">Kendaraan membawa muatan — pilihan rute bebas tanpa batasan</p>
            </div>
            <div className={`w-5 h-5 rounded-full border-2 shrink-0 mt-0.5 flex items-center justify-center ${dotColor('muatan')}`}>
              {condition === 'muatan' && <div className="w-2 h-2 rounded-full bg-white" />}
            </div>
          </div>
        </button>
      </div>

      <button
        onClick={() => go('route-select')}
        disabled={!condition}
        className="w-full bg-[#0F172A] text-white font-bold py-4 rounded-2xl text-[13px] disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all"
      >
        {condition === 'muatan' ? 'Lanjut Pilih Rute' : condition === 'kosong' ? 'Lanjut Pilih Rute' : 'Pilih Status Muatan'}
      </button>
    </div>
  )
}
