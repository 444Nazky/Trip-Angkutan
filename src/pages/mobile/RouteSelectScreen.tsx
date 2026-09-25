import { ChevronLeft, Lock, Map, MapPin } from 'lucide-react'
import { ROUTES } from '../data'
import { useApp } from '../store'
import type { MobileScreen } from '../types'
import { EMPTY_ROUTE_CODE } from './TripConditionScreen'

interface RouteSelectScreenProps {
  go: (s: MobileScreen) => void
}

export default function RouteSelectScreen({ go }: RouteSelectScreenProps) {
  const { draft, patchDraft, officer } = useApp()
  const selected = draft.routeCode

  // Trip tanpa muatan: rute dibatasi & dikunci hanya SJRE → SBDZ.
  // Trip bermuatan: seluruh rute bebas dipilih.
  const isEmptyTrip = draft.condition === 'kosong'
  const routes = isEmptyTrip ? ROUTES.filter(r => r.code === EMPTY_ROUTE_CODE) : ROUTES

  // Guard: rute lama yang tidak valid saat kondisi berubah ke "kosong"
  const validSelected = selected && routes.some(r => r.code === selected)
    ? selected
    : isEmptyTrip ? EMPTY_ROUTE_CODE : selected

  const handleContinue = () => {
    if (!draft.condition) {
      go('trip-condition')
      return
    }
    if (draft.condition === 'muatan') {
      go('vehicle-form')
      return
    }
    // Trip kosong: wajib foto kamera sebelum lanjut ke ringkasan
    patchDraft({
      routeCode: draft.routeCode || EMPTY_ROUTE_CODE,
      cameraFrom: 'trip-summary',
    })
    go('camera')
  }

  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <button
        onClick={() => go(draft.condition ? 'trip-condition' : 'home')}
        className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium"
      >
        <ChevronLeft size={16} /> Kembali
      </button>
      <h2 className="font-black text-slate-900 text-[20px] mb-0.5">Pilih Rute</h2>
      <p className="text-slate-500 text-[13px] mb-4">
        {isEmptyTrip
          ? 'Trip kosong — rute dibatasi hanya SJRE → SBDZ'
          : 'Tentukan asal dan tujuan perjalanan'}
      </p>

      <div className="bg-[#0F172A] rounded-2xl p-4 mb-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center">
          <MapPin size={16} className="text-emerald-400" />
        </div>
        <div>
          <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide">Wilayah Aktif</p>
          <p className="text-white font-bold text-[13px]">{officer.region}</p>
        </div>
        {isEmptyTrip
          ? <Lock size={16} className="text-amber-400 ml-auto" />
          : <Map size={16} className="text-slate-600 ml-auto" />}
      </div>

      <div className="space-y-2.5 mb-5">
        {routes.map(r => {
          const locked = isEmptyTrip
          const isSelected = validSelected === r.code
          return (
            <button
              key={r.code}
              onClick={() => patchDraft({ routeCode: r.code })}
              className={`w-full rounded-2xl p-4 text-left border-2 transition-all ${isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-blue-600' : 'bg-slate-100'}`}>
                    {locked && !isSelected
                      ? <Lock size={16} className="text-slate-500" />
                      : <Map size={16} className={isSelected ? 'text-white' : 'text-slate-500'} />}
                  </div>
                  <div>
                    <p className="font-bold text-slate-900 text-[13px]">{r.from} → {r.to}</p>
                    <p className="text-[11px] text-slate-400">{r.label}</p>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300'}`}>
                  {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </div>
              <div className="flex gap-4 pl-[52px]">
                <span className="text-[10px] text-slate-400">📏 {r.distance}</span>
                <span className="text-[10px] text-slate-400">⏱ {r.duration}</span>
                {locked && (
                  <span className="text-[10px] font-bold text-amber-600 ml-auto flex items-center gap-1">
                    <Lock size={10} /> Terkunci (Trip Kosong)
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      <button
        onClick={handleContinue}
        disabled={!validSelected}
        className="w-full bg-[#0F172A] text-white font-bold py-4 rounded-2xl text-[13px] disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all"
      >
        {!draft.condition
          ? 'Pilih Rute Ini'
          : draft.condition === 'muatan' ? 'Lanjut Input Kendaraan' : 'Lanjut Ambil Foto'}
      </button>
    </div>
  )
}
