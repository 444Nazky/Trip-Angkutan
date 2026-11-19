import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, MapPin, Navigation, RefreshCw, Settings2 } from 'lucide-react'
import { useApp } from '../store'
import { regionDisplayName } from '../../services/adminPull'
import type { MobileScreen } from '../types'
import {
  getActiveGeofenceSnapshot,
  getCurrentPosition,
  GEOFENCE_UPDATED_EVENT,
  type ActiveSnapshot,
  type GpsPosition,
} from '../../services/geofence'

interface ActiveLocationScreenProps {
  go: (s: MobileScreen) => void
}

/**
 * Lokasi aktif petugas dan titik geofence yang sedang terdeteksi.
 * Card ini dipindahkan dari halaman Profil ke menu tersendiri.
 */
export default function ActiveLocationScreen({ go }: ActiveLocationScreenProps) {
  const { officer } = useApp()
  const [gps, setGps] = useState<GpsPosition | null>(null)
  const [snapshot, setSnapshot] = useState<ActiveSnapshot | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const position = await getCurrentPosition({ force: true })
      setGps(position)
      setSnapshot(await getActiveGeofenceSnapshot(
        position ? { latitude: position.lat, longitude: position.lng } : undefined,
      ))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onUpdate = () => { void refresh() }
    window.addEventListener(GEOFENCE_UPDATED_EVENT, onUpdate)
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 30_000)
    return () => {
      window.removeEventListener(GEOFENCE_UPDATED_EVENT, onUpdate)
      window.clearInterval(timer)
    }
  }, [refresh])

  const point = snapshot?.activePoint
  const active = snapshot?.valid === true && !!point

  return (
    <div className="space-y-4 px-4 pb-6 pt-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-black text-slate-900">Lokasi Aktif</h2>
          <p className="mt-0.5 text-[11px] text-slate-500">Posisi GPS dan titik geofence saat ini.</p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-[11px] font-bold text-slate-700 disabled:opacity-40"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Perbarui
        </button>
      </div>

      <section className={`rounded-2xl border p-4 ${active ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="flex items-start gap-3">
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            active ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'
          }`}>
            {active ? <CheckCircle2 size={19} /> : <AlertTriangle size={19} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-bold ${active ? 'text-emerald-900' : 'text-amber-900'}`}>
              {active ? 'Di dalam titik geofence' : 'Di luar titik geofence'}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-600">
              {point ? `${point.name} · radius ${point.radiusMeters} m` : 'Tidak ada titik aktif.'}
            </p>
            {snapshot?.reason && <p className="mt-1 text-[10px] text-slate-500">{snapshot.reason}</p>}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center gap-2">
          <Navigation size={14} className="text-slate-500" />
          <h3 className="text-xs font-bold text-slate-800">Koordinat Perangkat</h3>
        </div>
        {gps ? (
          <div className="space-y-1.5 text-[11px]">
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Latitude</span>
              <span className="font-mono font-semibold text-slate-800">{gps.lat.toFixed(6)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Longitude</span>
              <span className="font-mono font-semibold text-slate-800">{gps.lng.toFixed(6)}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-slate-500">Akurasi</span>
              <span className="font-semibold text-slate-800">{gps.accuracy ? `${Math.round(gps.accuracy)} m` : '—'}</span>
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">
            GPS belum tersedia. Aktifkan izin lokasi lalu tekan Perbarui.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-slate-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-slate-800">Petugas</p>
            <p className="text-[11px] text-slate-500">{officer.name} · {regionDisplayName(officer.region, officer.regionName)}</p>
          </div>
        </div>
      </section>

      <button
        onClick={() => go('geofence-config')}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white py-3 text-[12px] font-bold text-slate-700 active:bg-slate-50"
      >
        <Settings2 size={14} /> Daftar Lokasi Aktif
      </button>
    </div>
  )
}
