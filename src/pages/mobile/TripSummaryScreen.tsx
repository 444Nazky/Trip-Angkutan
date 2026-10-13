import { useEffect, useState, useCallback } from 'react'
import { ChevronLeft, Camera, Play, Truck, ImageOff, Pencil, Trash2, MapPin, Package, MapPinOff } from 'lucide-react'
import { activeRoutes } from '../data'
import { fmtDate, fmtTime, nextTripId, unitLabel, useApp } from '../store'
import { validateRouteForCurrentLocation, type GeofencePoint } from '../../services/geofence'
import type { MobileScreen } from '../types'

interface TripSummaryScreenProps {
  go: (s: MobileScreen) => void
}

const CONFIRM_TIMEOUT = 3000 // 3 detik

export default function TripSummaryScreen({ go }: TripSummaryScreenProps) {
  const {
    draft, officer, trips, resetDraft, startTrip, patchDraft, patchDraftVehicle,
    finishEmptyTrip, finishMuatanTrip, removeDraftVehicle, editDraftVehicle,
  } = useApp()

  // ── Photo State — HANYA Foto Bukti Trip (tanpa Swafoto) ───────────
  const hasTripPhoto = !!draft.photoUrl

  // ── Geofence State ─────────────────────────────────────────────────
  const [geofenceError, setGeofenceError] = useState<string | null>(null)
  const [geofenceBlocked, setGeofenceBlocked] = useState(false)
  const [geofenceLoading, setGeofenceLoading] = useState(false)
  const [activeGeofence, setActiveGeofence] = useState<GeofencePoint | null>(null)

  // ── Confirmation State ─────────────────────────────────────────────
  const [confirmBatal, setConfirmBatal] = useState(false)
  const [confirmBatalTimer, setConfirmBatalTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [confirmBatalCountdown, setConfirmBatalCountdown] = useState(3)

  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null)
  const [confirmDeleteTimer, setConfirmDeleteTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [confirmDeleteCountdown, setConfirmDeleteCountdown] = useState(3)

  // Cek geofence saat mount + polling setiap 20 detik (real-time strict)
  useEffect(() => {
    if (!draft.routeCode) return
    let alive = true
    const routeCode = draft.routeCode
    if (!routeCode) return
    const run = () => {
      setGeofenceLoading(true)
      setGeofenceError(null)
      validateRouteForCurrentLocation(routeCode)
        .then(result => {
          if (!alive) return
          setGeofenceBlocked(result.blocked === true)
          setActiveGeofence(result.activePoint ?? null)
          setGeofenceError(result.valid ? null : (result.reason ?? 'Lokasi tidak valid'))
        })
        .catch(() => { if (alive) setGeofenceError(null) })
        .finally(() => { if (alive) setGeofenceLoading(false) })
    }
    run()
    const timer = window.setInterval(run, 20000)
    window.addEventListener('focus', run)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
    }
  }, [draft.routeCode])

  const allRoutes = activeRoutes()
  const route = allRoutes.find(r => r.code === draft.routeCode) ?? allRoutes[0]
  const now = new Date()
  const tripId = nextTripId(trips)
  const vehicles = draft.vehicles
  const conditionLabel = draft.condition === 'muatan' ? 'Ada Muatan' : 'Kosong'
  const backTo = draft.condition === 'kosong' ? 'route-select' : 'vehicle-form'
  const vehiclesMissingPhoto = vehicles
    .map((v, i) => ({ v, i, label: unitLabel(vehicles, i) }))
    .filter(x => !x.v.photoUrl)

  useEffect(() => {
    // HANYA foto yang dimintan dari layar ini (vehiclePhotoTarget terpasang).
    // Tanpa guard ini, mode "Ubah kendaraan" (vPhoto sudah terisi dari kendaraan
    // lama) bisa salah terpasang & mengosongkan slot foto sebelum form dibuka.
    if (draft.vehiclePhotoTarget == null) return
    if (!draft.vPhoto || !draft.vPhotoUrl) return
    const target = draft.vehiclePhotoTarget ?? draft.vehicles.findIndex(v => !v.photoUrl)
    if (target === -1 || target == null) return
    patchDraftVehicle(target, {
      photoUrl: draft.vPhotoUrl,
      photoCapturedAt: draft.vPhotoCapturedAt,
      photoLatitude: draft.vPhotoLatitude,
      photoLongitude: draft.vPhotoLongitude,
    })
    patchDraft({
      vPhoto: false,
      vPhotoUrl: undefined,
      vPhotoCapturedAt: undefined,
      vPhotoLatitude: undefined,
      vPhotoLongitude: undefined,
      vehiclePhotoTarget: undefined,
      cameraReturn: undefined,
    })
  }, [draft.vPhoto, draft.vPhotoUrl, draft.vPhotoCapturedAt, draft.vPhotoLatitude, draft.vPhotoLongitude, draft.vehicles, draft.vehiclePhotoTarget, patchDraft, patchDraftVehicle])

  // ── Geofence Validation ─────────────────────────────────────────────
  const handleGeofenceSubmit = async () => {
    if (!draft.routeCode) return false
    setGeofenceLoading(true)
    setGeofenceError(null)
    const result = await validateRouteForCurrentLocation(draft.routeCode)
    setGeofenceLoading(false)
    if (!result.valid) {
      // Skenario C: blocked total — simpan flag agar banner merah tampil
      setGeofenceBlocked(result.blocked === true)
      setGeofenceError(result.reason ?? 'Lokasi tidak valid')
      return false
    }
    setGeofenceBlocked(false)
    setActiveGeofence(result.activePoint ?? null)
    return true
  }

  const handleSubmit = () => {
    if (draft.condition === 'kosong') {
      startTrip()
      finishEmptyTrip()
      go('trip-complete')
    } else {
      startTrip()
      finishMuatanTrip()
      go('trip-complete')
    }
  }

  // ── Foto Bukti Trip Logic ───────────────────────────────────────────
  // Ambil foto bukti trip (HANYA 1 FOTO)
  const goCapture = () => {
    patchDraft({ cameraFrom: 'trip-summary', cameraMode: 'photo' })
    go('camera')
  }

  // Submit — aktif setelah foto bukti trip terambil
  const canSubmit = hasTripPhoto && vehiclesMissingPhoto.length === 0
  const mainText = draft.condition === 'kosong' ? 'Langsung Selesaikan' : 'Kirim Sekarang'

  const onMain = async () => {
    if (!canSubmit) return
    const geoOk = await handleGeofenceSubmit()
    if (!geoOk) return
    handleSubmit()
  }

  // ── Batal Confirmation Logic ─────────────────────────────────────────
  const handleBatalClick = useCallback(() => {
    if (confirmBatal) {
      // Sudah di-klik sebelumnya, jalankan aksi
      if (confirmBatalTimer) clearTimeout(confirmBatalTimer)
      setConfirmBatal(false)
      setConfirmBatalCountdown(3)
      resetDraft()
      go('home')
    } else {
      // Minta konfirmasi
      setConfirmBatal(true)
      setConfirmBatalCountdown(3)

      // Countdown timer
      const countdownInterval = setInterval(() => {
        setConfirmBatalCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval)
            return 0
          }
          return prev - 1
        })
      }, 1000)

      // Auto-cancel setelah 3 detik
      const timer = setTimeout(() => {
        setConfirmBatal(false)
        setConfirmBatalCountdown(3)
        clearInterval(countdownInterval)
      }, CONFIRM_TIMEOUT)
      setConfirmBatalTimer(timer)
    }
  }, [confirmBatal, confirmBatalTimer, resetDraft, go])

  // ── Delete Vehicle Confirmation Logic ───────────────────────────────
  const handleDeleteClick = useCallback((index: number) => {
    if (confirmDeleteIndex === index) {
      // Sudah di-klik sebelumnya, jalankan aksi
      if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer)
      setConfirmDeleteIndex(null)
      setConfirmDeleteCountdown(3)
      removeDraftVehicle(index)
    } else {
      // Minta konfirmasi
      // Cancel konfirmasi sebelumnya jika ada
      if (confirmDeleteTimer) {
        clearTimeout(confirmDeleteTimer)
      }
      setConfirmDeleteIndex(index)
      setConfirmDeleteCountdown(3)

      // Countdown timer
      const countdownInterval = setInterval(() => {
        setConfirmDeleteCountdown(prev => {
          if (prev <= 1) {
            clearInterval(countdownInterval)
            return 0
          }
          return prev - 1
        })
      }, 1000)

      // Auto-cancel setelah 3 detik
      const timer = setTimeout(() => {
        setConfirmDeleteIndex(null)
        setConfirmDeleteCountdown(3)
        clearInterval(countdownInterval)
      }, CONFIRM_TIMEOUT)
      setConfirmDeleteTimer(timer)
    }
  }, [confirmDeleteIndex, confirmDeleteTimer, removeDraftVehicle])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (confirmBatalTimer) clearTimeout(confirmBatalTimer)
      if (confirmDeleteTimer) clearTimeout(confirmDeleteTimer)
    }
  }, [confirmBatalTimer, confirmDeleteTimer])

  return (
    <div className="px-4 pt-2 pb-6" style={{ gap: 16 }}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => go(backTo)}
          className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center"
        >
          <ChevronLeft size={20} className="text-slate-600" />
        </button>
        <div>
          <h2 className="font-black text-slate-900 text-[18px]">Ringkasan Trip</h2>
          <p className="text-slate-500 text-[12px]">Periksa data sebelum memulai</p>
        </div>
      </div>

      {/* Trip Details Card - Fixed Contrast */}
      <div className="bg-gradient-to-br from-slate-800 to-slate-900 rounded-[20px] p-5 text-white relative">
        {/* Header Row: Trip ID + Draft Badge */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl bg-blue-600 flex items-center justify-center shrink-0">
            <Truck size={18} className="text-white" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-slate-400 text-[10px] tracking-wide">ID Trip</p>
            <p className="font-mono font-bold text-[14px] text-white">{tripId}</p>
          </div>
          <span className="text-[10px] font-bold bg-amber-500/20 text-amber-300 px-3 py-1 rounded-full shrink-0">
            Draft
          </span>
        </div>

        {/* Route Card */}
        <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-3 mb-4">
          <div className="flex items-start gap-2">
            <MapPin size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-slate-400 text-[10px] tracking-wide mb-1">RUTE</p>
              <p className="font-semibold text-[14px] text-white">{route.from}</p>
              <p className="text-slate-500 text-[11px]">via {route.code}</p>
              <p className="font-semibold text-[14px] text-white mt-1">{route.to}</p>
            </div>
          </div>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          {/* Petugas */}
          <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-3">
            <p className="text-slate-400 text-[10px] tracking-wide mb-1">PETUGAS</p>
            <p className="font-semibold text-[13px] text-white truncate">{officer.name}</p>
          </div>
          {/* Kondisi */}
          <div className="bg-slate-800/80 border border-slate-700/50 rounded-xl p-3">
            <p className="text-slate-400 text-[10px] tracking-wide mb-1">KONDISI</p>
            <div className="flex items-center gap-2">
              <Package size={14} className={draft.condition === 'muatan' ? 'text-amber-400' : 'text-slate-400'} />
              <p className="font-semibold text-[13px] text-white">{conditionLabel}</p>
            </div>
          </div>
        </div>

        {/* Timestamp */}
        <div className="flex items-center gap-2 pt-3 border-t border-slate-700/50">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <p className="text-[11px] text-slate-400">{fmtDate(now)} - {fmtTime(now)}</p>
        </div>

        {/* Edit Actions - Clean Buttons */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={() => go('trip-condition')}
            className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-xl py-3"
          >
            <Package size={14} /> Ubah Kondisi
          </button>
          <button
            onClick={() => go('route-select')}
            className="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-semibold text-white bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-xl py-3"
          >
            <MapPin size={14} /> Ubah Rute
          </button>
        </div>
      </div>

      {/* Vehicle Section */}
      <div className="bg-white rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-[13px] font-bold text-slate-800">Kendaraan</h3>
          <span className="text-[11px] font-medium text-slate-500">{vehicles.length} unit</span>
        </div>

        {vehicles.length === 0 ? (
          <p className="text-[12px] text-slate-400 py-3">Trip tanpa kendaraan</p>
        ) : (
          <div>
            {vehicles.map((v, i) => {
              const isDeleting = confirmDeleteIndex === i
              return (
                <div key={`${v.plate}-${i}`} className="flex items-center gap-3 py-2">
                  {v.photoUrl ? (
                    <img src={v.photoUrl} alt="" className="w-11 h-11 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                      <ImageOff size={16} className="text-slate-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-bold uppercase bg-slate-800 text-white px-1.5 py-0.5 rounded shrink-0">{unitLabel(vehicles, i)}</span>
                      <span className="font-semibold text-[12px] text-slate-800">{v.plate}</span>
                      {v.plateStatus && (
                        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${
                          v.plateStatus === 'internal' ? 'bg-slate-800 text-white'
                            : v.plateStatus === 'lokal' ? 'bg-blue-100 text-blue-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}>{v.plateStatus}</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500">{v.type} - {v.category}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {!v.photoUrl && (
                      <button
                        onClick={() => { patchDraft({ cameraFrom: 'vehicle-form', cameraMode: 'photo', cameraReturn: 'trip-summary', vehiclePhotoTarget: i }); go('camera') }}
                        className="px-3 py-1.5 text-[11px] font-medium text-blue-600 bg-blue-50 rounded-lg"
                      >
                        Foto
                      </button>
                    )}
                    <button onClick={() => { editDraftVehicle(i); go('vehicle-form') }} className="p-1.5">
                      <Pencil size={14} className="text-slate-400" />
                    </button>
                    {/* Delete Button dengan Konfirmasi */}
                    {isDeleting ? (
                      <button
                        onClick={() => handleDeleteClick(i)}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-bold text-white bg-red-500 rounded-lg animate-pulse"
                      >
                        <Trash2 size={12} />
                        {confirmDeleteCountdown > 0 ? `Hapus (${confirmDeleteCountdown})` : 'Hapus'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDeleteClick(i)}
                        className="p-1.5"
                        title={`Hapus ${unitLabel(vehicles, i)}`}
                      >
                        <Trash2 size={14} className="text-slate-400" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Geofence Status */}
      {geofenceError && (
        <div className={`rounded-xl p-4 border ${
          geofenceBlocked ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-center gap-3">
            <MapPinOff size={18} className={geofenceBlocked ? 'text-red-600' : 'text-amber-600'} />
            <div className="flex-1">
              <p className={`text-[13px] font-bold ${geofenceBlocked ? 'text-red-700' : 'text-amber-700'}`}>
                {geofenceBlocked ? 'Luar Area Geofence' : 'Lokasi Tidak Valid'}
              </p>
              <p className={`text-[11px] ${geofenceBlocked ? 'text-red-600' : 'text-amber-600'}`}>
                {geofenceError}
              </p>
            </div>
          </div>
        </div>
      )}

      {activeGeofence && !geofenceError && !geofenceBlocked && (
        <div className="rounded-xl p-3 bg-slate-50 border border-slate-200">
          <div className="flex items-center gap-2">
            <MapPin size={16} className="text-slate-600" />
            <span className="text-[12px] text-slate-700 font-medium">{activeGeofence.name}</span>
          </div>
        </div>
      )}

      {/* Photo Proof */}
      <div className="bg-white rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${hasTripPhoto ? 'bg-slate-100' : 'bg-amber-50'}`}>
              <Camera size={18} className={hasTripPhoto ? 'text-slate-500' : 'text-amber-600'} />
            </div>
            <div>
              <p className="text-[13px] font-semibold text-slate-800">Foto Bukti Trip</p>
              <p className="text-[11px] text-slate-500">{hasTripPhoto ? 'Tersimpan' : 'Diperlukan sebelum mengirim'}</p>
            </div>
          </div>
          <button
            onClick={goCapture}
            className={`text-[12px] font-medium px-4 py-2 rounded-xl shrink-0 ${
              hasTripPhoto ? 'text-slate-600 bg-slate-100' : 'text-white bg-amber-500'
            }`}
          >
            {hasTripPhoto ? 'Ubah' : 'Ambil'}
          </button>
        </div>
        {hasTripPhoto && draft.photoUrl && (
          <img src={draft.photoUrl} alt="" className="mt-3 w-full h-40 object-cover rounded-xl" />
        )}
      </div>

      {/* Submit Button - High Contrast Blue */}
      <button
        onClick={onMain}
        disabled={!canSubmit || !!geofenceError || geofenceLoading || geofenceBlocked}
        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl text-[14px] flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <Play size={16} fill="white" />
        {mainText}
      </button>

      {/* Batal Button dengan Konfirmasi */}
      {confirmBatal ? (
        <button
          onClick={handleBatalClick}
          className="w-full flex items-center justify-center gap-2 py-3 text-white text-[13px] font-semibold bg-red-500 rounded-xl animate-pulse"
        >
          <Trash2 size={14} />
          Konfirmasi Batal ({confirmBatalCountdown > 0 ? confirmBatalCountdown : 'Batal?'})
        </button>
      ) : (
        <button
          onClick={handleBatalClick}
          className="w-full py-3 text-red-500 text-[13px] font-medium"
        >
          Batal
        </button>
      )}
    </div>
  )
}
