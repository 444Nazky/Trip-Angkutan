import { useEffect, useState } from 'react'
import { ChevronLeft, Camera, Truck, MapPin, Package, AlertCircle, Pencil, Plus } from 'lucide-react'
import { activeRoutes } from '../data'
import { fmtDate, fmtTime, nextTripId, unitLabel, useApp } from '../store'
import { validateRouteForCurrentLocation } from '../../services/geofence'
import type { MobileScreen } from '../types'

interface TripSummaryScreenProps {
  go: (s: MobileScreen) => void
}

export default function TripSummaryScreen({ go }: TripSummaryScreenProps) {
  const {
    draft, trips, resetDraft, startTrip, patchDraft, editDraftVehicle,
    finishEmptyTrip, finishMuatanTrip,
  } = useApp()

  const hasTripPhoto = !!draft.photoUrl
  const [geofenceError, setGeofenceError] = useState<string | null>(null)
  const [geofenceBlocked, setGeofenceBlocked] = useState(false)
  const [geofenceLoading, setGeofenceLoading] = useState(false)

  // Geofence polling
  useEffect(() => {
    if (!draft.routeCode) return
    let alive = true
    const run = () => {
      setGeofenceLoading(true)
      validateRouteForCurrentLocation(draft.routeCode!)
        .then(result => {
          if (!alive) return
          setGeofenceBlocked(result.blocked === true)
          setGeofenceError(result.valid ? null : (result.reason ?? 'Lokasi tidak valid'))
        })
        .catch(() => { if (alive) setGeofenceError(null) })
        .finally(() => { if (alive) setGeofenceLoading(false) })
    }
    run()
    const timer = window.setInterval(run, 20000)
    window.addEventListener('focus', run)
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', run) }
  }, [draft.routeCode])

  const route = activeRoutes().find(r => r.code === draft.routeCode) ?? activeRoutes()[0]
  const vehicles = draft.vehicles
  const backTo = draft.condition === 'kosong' ? 'route-select' : 'vehicle-form'
  const canSubmit = hasTripPhoto && vehicles.filter(v => !v.photoUrl).length === 0

  // Submit handler
  const handleSubmit = async () => {
    if (!canSubmit || geofenceError || geofenceBlocked || geofenceLoading) return
    const result = await validateRouteForCurrentLocation(draft.routeCode!)
    if (!result.valid) {
      setGeofenceBlocked(result.blocked === true)
      setGeofenceError(result.reason ?? 'Lokasi tidak valid')
      return
    }
    startTrip()
    draft.condition === 'kosong' ? finishEmptyTrip() : finishMuatanTrip()
    go('trip-complete')
  }

  // Batal
  const handleBatal = () => {
    resetDraft()
    go('home')
  }

  const handleAddVehicle = () => {
    patchDraft({
      vehicleForm: { plate: '', type: '', category: '' },
      editVehicleIndex: null,
      vPhoto: false,
      vPhotoUrl: undefined,
      vPhotoCapturedAt: undefined,
      vPhotoLatitude: undefined,
      vPhotoLongitude: undefined,
      vehiclePhotoTarget: undefined,
      cameraReturn: undefined,
    })
    go('vehicle-form')
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="mx-auto max-w-md">
        <header className="flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-4 backdrop-blur-sm">
          <button onClick={() => go(backTo)} className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-300 bg-transparent text-slate-600">
            <ChevronLeft size={18} />
          </button>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400">Trip</p>
            <h2 className="text-base font-semibold text-slate-900">Ringkasan</h2>
          </div>
        </header>

        <main className="space-y-4 p-4">
          <section className="rounded-2xl bg-[#0F172A] p-4 text-white shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white">
                  <Truck size={18} />
                </div>
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/60">ID Trip</p>
                  <p className="font-mono text-sm font-semibold text-white">{nextTripId(trips)}</p>
                </div>
              </div>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-white">
                {draft.condition === 'kosong' ? 'Kosong' : 'Muatan'}
              </span>
            </div>

            <div className="rounded-xl bg-white/5 p-3 ring-1 ring-white/10">
              <div className="mb-2 flex items-center gap-2 text-white/60">
                <MapPin size={14} className="text-emerald-400" />
                <span className="text-[10px] font-medium uppercase tracking-[0.16em]">Rute</span>
              </div>
              <p className="text-sm font-semibold text-white">{route.from} <span className="text-white/50">→</span> {route.to}</p>
              <p className="mt-1 text-[11px] text-white/60">{route.code}</p>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
                <p className="text-[9px] uppercase tracking-[0.16em] text-white/50">Tanggal</p>
                <p className="mt-1 font-medium text-white">{fmtDate(new Date())}</p>
              </div>
              <div className="rounded-xl bg-white/5 p-2.5 ring-1 ring-white/10">
                <p className="text-[9px] uppercase tracking-[0.16em] text-white/50">Waktu</p>
                <p className="mt-1 font-medium text-white">{fmtTime(new Date())}</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-200">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package size={14} className="text-slate-500" />
                <h3 className="text-sm font-semibold text-slate-800">Kendaraan</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-slate-400">{vehicles.length} unit</span>
                {draft.condition !== 'kosong' && (
                  <button
                    onClick={handleAddVehicle}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5 text-[10px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98]"
                  >
                    <Plus size={12} /> Tambah
                  </button>
                )}
              </div>
            </div>

            {vehicles.length === 0 ? (
              <p className="rounded-xl bg-slate-50 p-3 text-[12px] text-slate-500 ring-1 ring-slate-200">
                Trip tanpa kendaraan
              </p>
            ) : (
              <div className="space-y-2">
                {vehicles.map((v, i) => (
                  <div key={`${v.plate}-${i}`} className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 ring-1 ring-slate-200">
                    <span className="inline-flex min-w-[28px] items-center justify-center rounded-md bg-slate-900 px-1.5 py-1 text-[9px] font-bold text-white">
                      {unitLabel(vehicles, i)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[12px] font-medium text-slate-800">{v.plate}</p>
                      <p className="text-[10px] text-slate-500">{v.type} · {v.category}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {v.photoUrl ? (
                        <img src={v.photoUrl} alt="" className="h-10 w-10 rounded-lg object-cover ring-1 ring-slate-200" />
                      ) : (
                        <button
                          onClick={() => { patchDraft({ cameraFrom: 'vehicle-form', cameraMode: 'photo', cameraReturn: 'trip-summary', vehiclePhotoTarget: i }); go('camera') }}
                          className="rounded-lg border border-slate-300 bg-transparent px-2.5 py-1.5 text-[10px] font-medium text-slate-600 transition-colors hover:bg-white"
                        >
                          Foto
                        </button>
                      )}
                      <button
                        onClick={() => { editDraftVehicle(i); go('vehicle-form') }}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-transparent text-slate-500 transition-colors hover:bg-white"
                        aria-label={`Edit kendaraan ${v.plate}`}
                        title="Edit kendaraan"
                      >
                        <Pencil size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={`rounded-2xl border bg-white p-4 shadow-sm ${hasTripPhoto ? 'border-slate-200 ring-1 ring-slate-100' : 'border-amber-300 ring-1 ring-amber-100'}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${hasTripPhoto ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-600'}`}>
                  <Camera size={16} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">Foto Bukti</p>
                  <p className="text-[10px] text-slate-500">{hasTripPhoto ? 'tersimpan' : 'ambil foto bukti trip sebelum submit'}</p>
                </div>
              </div>
              <button
                onClick={() => { patchDraft({ cameraFrom: 'trip-summary', cameraMode: 'photo' }); go('camera') }}
                className={`rounded-lg border bg-transparent px-3 py-1.5 text-[11px] font-semibold transition-colors ${hasTripPhoto ? 'border-slate-300 text-slate-700 hover:bg-slate-50' : 'border-amber-400 text-amber-800 hover:bg-amber-50 active:bg-amber-100'}`}
              >
                {hasTripPhoto ? 'Ubah' : 'Ambil'}
              </button>
            </div>

            {hasTripPhoto && draft.photoUrl && (
              <img src={draft.photoUrl} alt="" className="mt-3 h-32 w-full rounded-xl object-cover ring-1 ring-slate-200" />
            )}
          </section>

          {geofenceError && (
            <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-[11px] ${geofenceBlocked ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
              <AlertCircle size={14} className="shrink-0" />
              <span>{geofenceBlocked ? 'Luar area geofence' : 'Lokasi tidak valid'}</span>
            </div>
          )}

          <div className="space-y-2 pt-1">
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || !!geofenceError || geofenceBlocked}
              className="w-full rounded-2xl bg-blue-600 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {draft.condition === 'kosong' ? 'Selesaikan' : 'Kirim Trip'}
            </button>
            <button onClick={handleBatal} className="w-full rounded-xl border border-slate-200 bg-transparent py-2.5 text-sm font-medium text-slate-500 transition-colors hover:bg-white">
              Batal
            </button>
          </div>
        </main>
      </div>
    </div>
  )
}