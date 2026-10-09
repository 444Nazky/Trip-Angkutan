import { useEffect } from 'react'
import { Check } from 'lucide-react'
import { useApp } from '../store'
import { processSyncQueue } from '../../services/sync'
import type { MobileScreen } from '../types'

interface TripCompleteScreenProps {
  go: (s: MobileScreen) => void
}

export default function TripCompleteScreen({ go }: TripCompleteScreenProps) {
  const { trips, detailTripId } = useApp()
  const t = trips.find(x => x.id === detailTripId)

  useEffect(() => {
    if (!detailTripId) go('home')
    // Trigger background sync after trip is committed
    processSyncQueue()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!t) return null

  const unitCount = t.vehicles && t.vehicles.length > 0
    ? t.vehicles.length
    : (t.vehicle !== '-' ? 1 : 0)

  return (
    <div className="px-4 pt-6 pb-4 flex flex-col items-center">
      <div className="w-20 h-20 rounded-3xl bg-emerald-100 flex items-center justify-center mb-4">
        <Check size={38} className="text-emerald-500" strokeWidth={3} />
      </div>
      <h2 className="font-black text-slate-900 text-[24px] mb-1 text-center">Trip Selesai!</h2>
      <p className="text-slate-500 text-[13px] text-center mb-5">
        Trip {t.id} berhasil dicatat dan disimpan
      </p>

      <div className="w-full bg-[#0F172A] rounded-3xl p-5 mb-4">
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Rute', val: t.route },
            { label: 'Durasi', val: t.duration },
            { label: 'Kendaraan', val: unitCount > 0 ? `${unitCount} unit` : 'Kosong' },
            { label: 'Kondisi', val: t.load },
          ].map(({ label, val }) => (
            <div key={label}>
              <p className="text-slate-500 text-[10px] mb-0.5">{label}</p>
              <p className="text-white font-bold text-[13px]">{val}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="w-full bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-5 flex items-center gap-3">
        <Check size={18} className="text-emerald-500" strokeWidth={2.5} />
        <div>
          <p className="text-[12px] font-bold text-emerald-700">Tersimpan di Perangkat</p>
          <p className="text-[10px] text-emerald-600">
            {t.date} · {t.time} · sinkronisasi berjalan di background
          </p>
        </div>
      </div>

      <div className="flex gap-3 w-full">
        <button
          onClick={() => go('history-detail')}
          className="flex-1 py-3.5 rounded-2xl border-2 border-slate-200 text-slate-700 font-semibold text-[13px] hover:bg-slate-50"
        >
          Lihat Detail
        </button>
        <button
          onClick={() => go('home')}
          className="flex-1 py-3.5 rounded-2xl bg-blue-600 text-white font-bold text-[13px] hover:bg-blue-700"
        >
          Kembali ke Home
        </button>
      </div>
    </div>
  )
}
