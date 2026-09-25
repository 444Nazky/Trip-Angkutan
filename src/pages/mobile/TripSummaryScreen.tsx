import { ChevronLeft, Camera, Play, AlertTriangle, Truck } from 'lucide-react'
import { ROUTES } from '../data'
import { fmtDate, fmtTime, nextTripId, useApp } from '../store'
import type { MobileScreen } from '../types'

interface TripSummaryScreenProps {
  go: (s: MobileScreen) => void
}

export default function TripSummaryScreen({ go }: TripSummaryScreenProps) {
  const { draft, officer, trips, resetDraft, startTrip, patchDraft } = useApp()

  const route = ROUTES.find(r => r.code === draft.routeCode) ?? ROUTES[0]
  const now = new Date()
  const tripId = nextTripId(trips)
  const vehicles = draft.vehicles
  const conditionLabel = draft.condition === 'muatan' ? 'Ada Muatan' : 'Kosong'
  // Submit trip hanya boleh setelah foto via kamera diambil
  const photoTaken = draft.photo
  const backTo = draft.condition === 'kosong' ? 'route-select' : 'vehicle-form'

  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <button onClick={() => go(backTo)} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>
      <h2 className="font-black text-slate-900 text-[20px] mb-0.5">Ringkasan Trip</h2>
      <p className="text-slate-500 text-[13px] mb-4">Periksa data sebelum memulai trip</p>

      <div className="bg-[#0F172A] rounded-3xl p-5 mb-4 text-white">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <Truck size={18} className="text-white" />
          </div>
          <div>
            <p className="text-slate-400 text-[10px]">ID Trip (Auto-generate)</p>
            <p className="font-mono font-black text-[13px]">{tripId}</p>
          </div>
          <span className="ml-auto text-[10px] font-black bg-amber-500 text-white px-2.5 py-1 rounded-full">Draft</span>
        </div>
        <div className="space-y-2.5">
          {[
            ['Rute', `${route.from} → ${route.to}`],
            ['Kondisi', conditionLabel],
            ['Petugas', officer.name],
            ['Tanggal', `${fmtDate(now)} · ${fmtTime(now)}`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between items-center border-b border-slate-800 pb-2.5">
              <span className="text-slate-400 text-[11px]">{k}</span>
              <span className="text-white text-[11px] font-semibold">{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4">
        <p className="text-[11px] font-bold text-slate-600 mb-3 uppercase tracking-wide">Kendaraan ({vehicles.length})</p>
        {vehicles.length === 0 ? (
          <p className="text-[11px] text-slate-400">Trip tanpa kendaraan (kosong)</p>
        ) : vehicles.map((v, i) => (
          <div key={`${v.plate}-${i}`} className={`flex items-center gap-3 ${i > 0 ? 'pt-3 border-t border-slate-100 mt-3' : ''}`}>
            {v.photoUrl ? (
              <img src={v.photoUrl} alt={`Foto ${v.plate}`} className="w-9 h-9 rounded-xl object-cover border border-slate-200 shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-lg shrink-0">🚛</div>
            )}
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[11px] font-black text-slate-800">{v.plate}</p>
              <p className="text-[10px] text-slate-400 truncate">{v.type} · {v.category}</p>
            </div>
            {v.plateStatus && (
              <span className={`text-[9px] font-black uppercase px-2 py-1 rounded-full shrink-0 ${
                v.plateStatus === 'internal' ? 'bg-slate-800 text-white'
                : v.plateStatus === 'lokal' ? 'bg-blue-100 text-blue-700'
                : 'bg-amber-100 text-amber-700'
              }`}>{v.plateStatus}</span>
            )}
          </div>
        ))}
      </div>

      {/* Bukti foto — wajib via kamera sebelum submit trip */}
      <div className={`rounded-2xl p-4 border mb-4 flex items-center gap-3 ${photoTaken ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${photoTaken ? 'bg-emerald-100' : 'bg-amber-100'}`}>
          <Camera size={16} className={photoTaken ? 'text-emerald-500' : 'text-amber-500'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[12px] font-bold ${photoTaken ? 'text-emerald-700' : 'text-amber-700'}`}>
            {photoTaken ? 'Foto kamera siap' : 'Foto kamera belum diambil'}
          </p>
          <p className={`text-[10px] ${photoTaken ? 'text-emerald-600' : 'text-amber-600'}`}>
            {photoTaken ? 'Bukti trip tersimpan pada ringkasan ini' : 'Wajib ambil foto via kamera sebelum submit trip'}
          </p>
        </div>
        {!photoTaken && (
          <button
            onClick={() => { patchDraft({ cameraFrom: 'trip-summary' }); go('camera') }}
            className="text-[11px] font-black text-amber-700 bg-amber-100 rounded-xl px-3 py-2 shrink-0"
          >
            Ambil Foto
          </button>
        )}
        {photoTaken && draft.photoUrl && (
          <img src={draft.photoUrl} alt="Bukti Trip" className="w-10 h-10 rounded-lg object-cover border border-emerald-200 shrink-0" />
        )}
      </div>

      <button
        onClick={() => { startTrip(); go('trip-active') }}
        disabled={!photoTaken}
        title={photoTaken ? 'Mulai trip' : 'Ambil foto via kamera terlebih dahulu'}
        className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-[13px] hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {photoTaken ? (
          <><Play size={15} fill="white" /> Submit Trip — Mulai Sekarang</>
        ) : (
          <><AlertTriangle size={15} /> Ambil Foto Kamera Dulu</>
        )}
      </button>
      <button
        onClick={() => { resetDraft(); go('home') }}
        className="w-full mt-2 py-3.5 rounded-2xl text-slate-500 font-semibold text-[13px] hover:bg-slate-100 transition-colors"
      >
        Batal
      </button>
    </div>
  )
}
