import { useEffect, useState } from 'react'
import { ChevronLeft, Camera, Play, Truck, ImageOff, Pencil, Trash2, MapPin, Package, MapPinOff } from 'lucide-react'
import { activeRoutes } from '../data'
import { fmtDate, fmtTime, nextTripId, unitLabel, useApp } from '../store'
import { validateRouteForCurrentLocation, type GeofencePoint } from '../../services/geofence'
import type { MobileScreen } from '../types'

interface TripSummaryScreenProps {
  go: (s: MobileScreen) => void
}

export default function TripSummaryScreen({ go }: TripSummaryScreenProps) {
  const {
    draft, officer, trips, resetDraft, startTrip, patchDraft, patchDraftVehicle,
    finishEmptyTrip, finishMuatanTrip, removeDraftVehicle, editDraftVehicle,
  } = useApp()

  // ── Geofence State ─────────────────────────────────────────────────
  const [geofenceError, setGeofenceError] = useState<string | null>(null)
  const [geofenceLoading, setGeofenceLoading] = useState(false)
  const [activeGeofence, setActiveGeofence] = useState<GeofencePoint | null>(null)

  // Cek geofence saat mount
  useEffect(() => {
    if (!draft.routeCode) return
    setGeofenceLoading(true)
    setGeofenceError(null)
    validateRouteForCurrentLocation(draft.routeCode)
      .then(result => {
        if (!result.valid) {
          setGeofenceError(result.reason ?? 'Lokasi tidak valid')
        }
        setActiveGeofence(result.activePoint ?? null)
        setGeofenceError(result.valid ? null : (result.reason ?? 'Lokasi tidak valid'))
      })
      .catch(() => setGeofenceError(null))
      .finally(() => setGeofenceLoading(false))
  }, [draft.routeCode])

  const allRoutes = activeRoutes()
  const route = allRoutes.find(r => r.code === draft.routeCode) ?? allRoutes[0]
  const now = new Date()
  const tripId = nextTripId(trips)
  const vehicles = draft.vehicles
  const conditionLabel = draft.condition === 'muatan' ? 'Ada Muatan' : 'Kosong'
  const photoTaken = draft.photo
  const backTo = draft.condition === 'kosong' ? 'route-select' : 'vehicle-form'
  const vehiclesMissingPhoto = vehicles
    .map((v, i) => ({ v, i, label: unitLabel(vehicles, i) }))
    .filter(x => !x.v.photoUrl)
  const selfieTaken = !!draft.selfieUrl
  const selfieRequired = draft.condition === 'muatan'
  const selfiePending = selfieRequired && !selfieTaken
  const allDocsComplete = photoTaken && vehiclesMissingPhoto.length === 0 && (!selfieRequired || selfieTaken)

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
      setGeofenceError(result.reason ?? 'Lokasi tidak valid')
      return false
    }
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

  // SATU KARTU FOTO — dinamis: hijau + thumbnail saat siap, tombol utama aktif.
  // THUMBNAIL: prioritaskan photoUrl, selfie hanya tampil setelah photo siap
  const previewPhoto = draft.photoUrl
  const previewSelfie = draft.selfieUrl
  const thumbnailUrl = previewPhoto || (photoTaken && previewSelfie ? previewSelfie : undefined)
  const actionType = !photoTaken ? 'photo' : selfiePending ? 'selfie' : vehiclesMissingPhoto.length > 0 ? 'vehicle' : 'done'
  const mainText = draft.condition === 'kosong' ? 'Langsung Selesaikan Trip Kosong' : 'Kirim Saja'
  const goCapture = () => {
    if (actionType === 'photo') { patchDraft({ cameraFrom: 'trip-summary', cameraMode: 'photo' }); go('camera'); return }
    if (actionType === 'selfie') { patchDraft({ selfieMode: true, cameraFrom: 'trip-summary', cameraMode: 'photo', cameraReturn: 'trip-summary' }); go('camera'); return }
    if (actionType === 'vehicle') { patchDraft({ cameraFrom: 'vehicle-form', cameraMode: 'photo', cameraReturn: 'trip-summary', vehiclePhotoTarget: draft.vehicles.findIndex(v => !v.photoUrl) }); go('camera') }
  }
  const onMain = async () => {
    if (!allDocsComplete) return
    const geoOk = await handleGeofenceSubmit()
    if (!geoOk) return
    handleSubmit()
  }

  return (
    <div className="px-4 pt-2 pb-4">
      <button onClick={() => go(backTo)} className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium">
        <ChevronLeft size={16} /> Kembali
      </button>
      <h2 className="font-black text-slate-900 text-[20px] mb-0.5">Ringkasan Trip</h2>
      <p className="text-slate-500 text-[13px] mb-4">Periksa data sebelum memulai trip</p>

      <div className="bg-[#0F172A] rounded-3xl p-5 mb-4 text-white">
        <p className="text-slate-400 text-[10px] font-bold uppercase tracking-wide mb-3">Rincian Trip</p>
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
        {/* Edit sebelum submit — rute & kondisi masih boleh diubah */}
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => go('route-select')}
            className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-black text-blue-300 bg-blue-500/15 hover:bg-blue-500/25 rounded-xl py-2.5 transition-colors"
            title="Ubah rute perjalanan"
          >
            <MapPin size={13} /> Ubah Rute
          </button>
          <button
            onClick={() => go('trip-condition')}
            className="flex-1 flex items-center justify-center gap-1.5 text-[11px] font-black text-amber-300 bg-amber-500/15 hover:bg-amber-500/25 rounded-xl py-2.5 transition-colors"
            title="Ubah kondisi muatan (kosong / ada muatan)"
          >
            <Package size={13} /> Ubah Kondisi
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 mb-4">
        <p className="text-[11px] font-bold text-slate-600 mb-3 uppercase tracking-wide">Kendaraan ({vehicles.length})</p>
        {vehicles.length === 0 ? (
          <p className="text-[11px] text-slate-400">Trip tanpa kendaraan (kosong)</p>
        ) : vehicles.map((v, i) => (
          <div key={`${v.plate}-${i}`} className={`flex items-center gap-3 ${i > 0 ? 'pt-3 border-t border-slate-100 mt-3' : ''}`}>
            {v.photoUrl ? (
              <img src={v.photoUrl} alt={`Foto ${unitLabel(vehicles, i)}`} className="w-9 h-9 rounded-xl object-cover border border-slate-200 shrink-0" />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-amber-50 border border-dashed border-amber-300 flex items-center justify-center shrink-0"><ImageOff size={14} className="text-amber-500" /></div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-black uppercase bg-slate-800 text-white px-1.5 py-0.5 rounded">{unitLabel(vehicles, i)}</span>
                <span className="font-mono text-[11px] font-black text-slate-800">{v.plate}</span>
              </div>
              <p className="text-[10px] text-slate-400 truncate">{v.type} · {v.category}</p>
            </div>
            {!v.photoUrl && (
              <button
                onClick={() => { patchDraft({ cameraFrom: 'vehicle-form', cameraMode: 'photo', cameraReturn: 'trip-summary', vehiclePhotoTarget: i }); go('camera') }}
                className="text-[10px] font-black text-amber-700 bg-amber-100 rounded-lg px-2 py-1.5 shrink-0"
                title="Ambil foto dokumentasi kendaraan ini"
              >
                Ambil Foto
              </button>
            )}
            {/* Edit sebelum submit — perbaiki data / buang kendaraan */}
            <button
              onClick={() => { editDraftVehicle(i); go('vehicle-form') }}
              className="text-[10px] font-black text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg px-2 py-1.5 shrink-0"
              title={`Ubah data ${unitLabel(vehicles, i)}`}
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={() => removeDraftVehicle(i)}
              className="text-[10px] font-black text-red-600 bg-red-50 hover:bg-red-100 rounded-lg px-2 py-1.5 shrink-0"
              title={`Hapus ${unitLabel(vehicles, i)} dari trip ini`}
            >
              <Trash2 size={11} />
            </button>
            {v.plateStatus && (
              <span className={`text-[9px] font-black px-2 py-1 rounded-full ${
                v.plateStatus === 'internal' ? 'bg-slate-800 text-white'
                  : v.plateStatus === 'lokal' ? 'bg-blue-100 text-blue-700'
                  : 'bg-amber-100 text-amber-700'
              }`}>{v.plateStatus}</span>
            )}
          </div>
        ))}
      </div>

      {/* ── Geofence Error Banner ── */}
      {geofenceError && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-4 mb-4 flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center shrink-0">
            <MapPinOff size={16} className="text-red-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold text-red-700 mb-1">Lokasi Tidak Valid</p>
            <p className="text-[12px] text-red-600">{geofenceError}</p>
          </div>
        </div>
      )}

      {/* ── Geofence Active Indicator ── */}
      {activeGeofence && !geofenceError && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 mb-4 flex items-center gap-2">
          <MapPin size={14} className="text-blue-600" />
          <p className="text-[12px] text-blue-700">
            <span className="font-semibold">{activeGeofence.name}</span>
            <span className="text-blue-500"> — hanya rute {activeGeofence.allowedRoutes.join(', ')}</span>
          </p>
        </div>
      )}

      {/* SATU KARTU FOTO — dinamis: hijau + thumbnail saat siap, tombol utama aktif. */}
      <div className={`rounded-2xl p-4 border mb-4 flex items-center gap-3 ${allDocsComplete ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'}`}>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${allDocsComplete ? 'bg-emerald-100' : 'bg-amber-100'}`}>
          <Camera size={16} className={allDocsComplete ? 'text-emerald-500' : 'text-amber-500'} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-[12px] font-bold ${allDocsComplete ? 'text-emerald-700' : 'text-amber-700'}`}>
            {allDocsComplete
              ? 'Foto kamera siap'
              : actionType === 'photo' ? 'Foto bukti trip belum diambil'
              : actionType === 'selfie' ? 'Swafoto penutup belum diambil'
              : 'Foto kendaraan belum lengkap'}
          </p>
          <p className={`text-[10px] ${allDocsComplete ? 'text-emerald-600' : 'text-amber-600'}`}>
            {allDocsComplete ? 'Bukti trip tersimpan — siap dikirim' : 'Wajib diambil sebelum trip dikirim'}
          </p>
        </div>
        {actionType !== 'done' && (
          <button
            onClick={goCapture}
            className="text-[11px] font-black text-amber-700 bg-amber-100 rounded-xl px-3 py-2 shrink-0"
          >
            {actionType === 'photo' ? 'Ambil Foto' : actionType === 'selfie' ? 'Ambil Swafoto' : 'Lengkapi Foto'}
          </button>
        )}
        {/* Tampilkan thumbnail foto bukti trip yang sudah diambil */}
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt="Bukti Trip"
            className="w-10 h-10 rounded-lg object-cover border shrink-0"
            style={{ borderColor: allDocsComplete ? '#a7f3d0' : '#fde68a' }}
          />
        )}
      </div>

      <button
        onClick={onMain}
        disabled={!allDocsComplete || !!geofenceError || geofenceLoading}
        className="w-full bg-blue-600 text-white font-bold py-4 rounded-2xl text-[13px] hover:bg-blue-700 active:scale-[0.98] transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <Play size={15} fill="white" />
        {mainText}
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
