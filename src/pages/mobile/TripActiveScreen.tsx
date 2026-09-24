import { useEffect, useRef, useState } from 'react'
import { Square } from 'lucide-react'
import { ROUTES } from '../data'
import {
  durationToSeconds, fmtElapsed, fmtTime, formatRp, kmNumber, useApp,
} from '../store'
import type { MobileScreen } from '../types'

interface TripActiveScreenProps {
  go: (s: MobileScreen) => void
}

export default function TripActiveScreen({ go }: TripActiveScreenProps) {
  const { draft, officer, trips, commitTrip, patchDraft } = useApp()

  const route = ROUTES.find(r => r.code === draft.routeCode) ?? ROUTES[0]
  const [startedAt, setStartedAt] = useState<number>(() => draft.startedAt ?? Date.now())
  const finishingRef = useRef(false)
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - (draft.startedAt ?? Date.now())) / 1000),
  )

  useEffect(() => {
    if (!draft.startedAt) patchDraft({ startedAt: startedAt })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [startedAt])

  const totalSec = durationToSeconds(route.duration)
  const progress = Math.min(elapsed / totalSec, 0.95)
  const distanceKm = kmNumber(route.distance)
  const remainingKm = Math.max(0, Math.round(distanceKm * (1 - progress)))
  const etaDate = new Date(startedAt + totalSec * 1000)
  const departDate = new Date(startedAt)

  const hhmmss = (() => {
    const h = String(Math.floor(elapsed / 3600)).padStart(2, '0')
    const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0')
    const s = String(elapsed % 60).padStart(2, '0')
    return `${h}:${m}:${s}`
  })()
  const etaMinutes = Math.max(0, Math.ceil((totalSec - elapsed) / 60))

  const finish = () => {
    // Guard against double-tap creating duplicate trips
    if (finishingRef.current) return
    finishingRef.current = true

    const vehicles = draft.vehicles
    const total = vehicles.reduce((sum, v) => sum + v.tariff, 0)
    const isMuatan = draft.condition === 'muatan'
    const now = new Date()
    commitTrip({
      id: (function () {
        let max = 0
        for (const t of trips) {
          const m = /TRP-(\d{4})-(\d{4})/.exec(t.id)
          if (m) max = Math.max(max, parseInt(m[2], 10))
        }
        return `TRP-${now.getFullYear()}-${String(max + 1).padStart(4, '0')}`
      })(),
      route: `${route.from} → ${route.to}`,
      status: 'Selesai',
      time: fmtTime(now),
      date: `${now.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'][now.getMonth()]} ${now.getFullYear()}`,
      load: isMuatan ? 'Ada Muatan' : 'Kosong',
      vehicle: isMuatan && vehicles[0] ? vehicles[0].plate : '-',
      type: isMuatan && vehicles[0] ? vehicles[0].type : '-',
      category: isMuatan && vehicles[0] ? vehicles[0].category : '-',
      revenue: formatRp(isMuatan ? total : 0),
      revenueNum: isMuatan ? total : 0,
      officer: officer.name,
      duration: fmtElapsed(elapsed),
      photo: draft.photo,
      photoUrl: draft.photoUrl,
      vehicles: isMuatan ? vehicles : [],
      synced: false,
    })
    go('trip-complete')
  }

  return (
    <div className="px-4 pt-2 pb-4 animate-fade-in">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-black text-slate-900 text-[20px]">Trip Berlangsung</h2>
        <span className="text-[11px] font-bold bg-blue-100 text-blue-600 px-3 py-1 rounded-full flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> In Transit
        </span>
      </div>

      <div className="bg-[#0F172A] rounded-3xl p-6 mb-4 text-center">
        <p className="text-slate-400 text-[11px] mb-2 uppercase tracking-wide">Durasi Berjalan</p>
        <p className="text-white font-mono font-black text-[40px] tracking-widest mb-3">{hhmmss}</p>
        <div className="w-full bg-slate-800 rounded-full h-2 mb-3">
          <div className="bg-blue-500 h-2 rounded-full transition-all duration-1000" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <p className="text-slate-500 text-[11px]">Estimasi tiba: ±{etaMinutes} menit lagi</p>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4">
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1">
            <div className="w-3 h-3 rounded-full bg-blue-500" />
            <div className="w-0.5 h-12 bg-slate-200" />
            <div className="w-3 h-3 rounded-full border-2 border-slate-300" />
          </div>
          <div className="flex-1 flex flex-col justify-between h-16">
            <div>
              <p className="font-bold text-slate-900 text-[13px]">{route.from} – {route.label.split(' → ')[0]}</p>
              <p className="text-[10px] text-slate-400">Titik Keberangkatan · {fmtTime(departDate)}</p>
            </div>
            <div>
              <p className="font-bold text-slate-500 text-[13px]">{route.to} – {route.label.split(' → ')[1]}</p>
              <p className="text-[10px] text-slate-400">Estimasi tiba: ~{fmtTime(etaDate)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="font-bold text-blue-600 text-[13px]">{route.distance}</p>
            <p className="text-[10px] text-slate-400">Sisa ~{remainingKm} km</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4">
        <p className="text-[11px] font-bold text-slate-500 mb-3 uppercase tracking-wide">
          {draft.condition === 'muatan' ? 'Kendaraan Diangkut' : 'Kendaraan'}
        </p>
        {draft.vehicles.length > 0 ? (
          draft.vehicles.map((v, i) => (
            <div key={`${v.plate}-${i}`} className={`flex items-center gap-3 ${i > 0 ? 'pt-2.5 border-t border-slate-100 mt-2.5' : ''}`}>
              <span className="text-lg">🚛</span>
              <div>
                <p className="font-mono text-[11px] font-black text-slate-800">{v.plate}</p>
                <p className="text-[10px] text-slate-400">{v.type}</p>
              </div>
            </div>
          ))
        ) : (
          <p className="text-[11px] text-slate-400">Trip kosong — tanpa kendaraan diangkut</p>
        )}
      </div>

      <button
        onClick={finish}
        className="w-full bg-emerald-600 text-white font-bold py-4 rounded-2xl text-[13px] hover:bg-emerald-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
      >
        <Square size={14} fill="white" /> Selesaikan Trip
      </button>
    </div>
  )
}
