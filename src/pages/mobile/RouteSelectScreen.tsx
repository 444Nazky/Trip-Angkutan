import { useEffect, useState } from 'react'
import { ChevronLeft, Map, MapPin, Ruler, Clock, Anchor, Navigation, Loader2, ShieldAlert, RefreshCw } from 'lucide-react'
import { refreshStoredRoutes, getStoredRoutes, type UiRoute } from '../../services/auth'
import { getGeofencedLocation, getGeofenceConfig } from '../../services/location'
import { findActiveGeofenceRule, getHardLockedRoute, type GeofenceRule } from '../../services/geofence'
import { useApp } from '../store'
import type { MobileScreen } from '../types'

interface RouteSelectScreenProps {
  go: (s: MobileScreen) => void
  /**
   * ID dermaga yang dipilih di popup Mulai Trip.
   * WAJIB dipakai filter — MobileApp pass ini saat petugas pilih dermaga.
   * null/undefined = popup dermaga masih terbuka, tampilkan empty state.
   */
  selectedDockId?: string | null
}

export default function RouteSelectScreen({ go, selectedDockId }: RouteSelectScreenProps) {
  const { draft, patchDraft, officer } = useApp()

  const dockId = selectedDockId ?? null
  const accessibleDermagas = officer.dermagaAccess || []
  const dock = dockId ? accessibleDermagas.find(d => d.id === dockId) ?? null : null
  const dockName = dock?.name ?? null

  // Rute dari backend. selectedDockId null = popup dermaga terbuka, kosong. TIDAK fallback semua dock.
  const [routes, setRoutes] = useState<UiRoute[]>(() => getStoredRoutes())
  const [loading, setLoading] = useState(false)
  const [geofenceRule, setGeofenceRule] = useState<GeofenceRule | null>(null)
  const [geofenceError, setGeofenceError] = useState<string | null>(null)

  // ── GEOFENCE-FIRST GATE ────────────────────────────────────────────────────
  // Rute TIDAK ditampilkan sebelum pemeriksaan lokasi selesai: ambil GPS fix,
  // cocokkan ke titik geofence aktif (config hasil sync admin), lalu:
  //   • di dalam titik → lock rute yang diizinkan (hanya rute tsb tampil)
  //   • GPS gagal / bocor → error state, tombol "Coba Lagi"; RUTE DISEMBUNYIKAN
  // Rute tanpa gate = petugas bisa pilih rute salah sebelum validasi selesai.
  const geoConfig = getGeofenceConfig()
  const gateRequired = geoConfig.rules.length > 0 // tanpa rule → wajar tampil semua
  const [geoStatus, setGeoStatus] = useState<'pending' | 'ok' | 'error'>(gateRequired ? 'pending' : 'ok')

  const runGeoCheck = async () => {
    if (!gateRequired) { setGeoStatus('ok'); return }
    setGeoStatus('pending')
    setGeofenceError(null)
    const loc = await getGeofencedLocation()
    if (!loc) {
      setGeofenceError('Lokasi GPS tidak terbaca. Aktifkan GPS/literan dan coba lagi — rute tampil setelah lokasi terverifikasi.')
      setGeoStatus('error')
      return
    }
    const rule = findActiveGeofenceRule(loc.latitude, loc.longitude, getGeofenceConfig(), loc.accuracy)
    setGeofenceRule(rule)
    setGeoStatus('ok')
  }

  useEffect(() => {
    void runGeoCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Segarkan rute tiap layar dibuka (Master Rute admin terlihat langsung).
  useEffect(() => {
    let alive = true
    setLoading(true)
    refreshStoredRoutes().then(fresh => {
      if (alive && fresh) setRoutes(fresh)
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  // Filter mutlak: hanya rute dockId yang dipilih.
  const dermagaFiltered = dockId
    ? routes.filter(r => r.dermagaId === dockId)
    : []

  const isEmptyTrip = draft.condition === 'kosong'

  // Hard-lock route berdasarkan hasil geofence nyata (bukan stub lagi):
  // saat petugas di dalam titik geofence, hanya rute yang diizinkan tampil.
  // (Dideklarasi SEBELUM 'list' yang memakainya.)
  const lockedRoute = getHardLockedRoute(geofenceRule)

  // GATE: saat geofence memeriksa (pending) / gagal (error), RUTE DISEMBUNYIKAN.
  // Saat lock aktif, hanya rute yang diizinkan titik geofence yang tampil.
  const list = geoStatus !== 'ok'
    ? []
    : lockedRoute
      ? dermagaFiltered.filter(r => r.code === lockedRoute)
      : dermagaFiltered
  const isRouteLocked = lockedRoute !== null && list.some(r => r.code === lockedRoute)

  // Guard: rute lama tidak valid saat kondisi berubah.
  const validSelected = draft.routeCode && list.some(r => r.code === draft.routeCode)
    ? draft.routeCode
    : null

  const handleContinue = () => {
    if (!draft.condition) { go('trip-condition'); return }
    if (!validSelected) {
      // Jika ada rute yang di-lock, tampilkan info
      if (isRouteLocked) {
        const locked = list.find(r => r.code === lockedRoute)
        if (locked) {
          patchDraft({ routeCode: locked.code })
          if (draft.condition === 'muatan') {
            go('vehicle-form')
          } else {
            patchDraft({ cameraFrom: 'trip-summary', cameraMode: 'photo' })
            go('camera')
          }
          return
        }
      }
      return
    }
    if (draft.condition === 'muatan') {
      patchDraft({ routeCode: validSelected })
      go('vehicle-form')
    } else {
      patchDraft({ routeCode: validSelected, cameraFrom: 'trip-summary', cameraMode: 'photo' })
      go('camera')
    }
  }

  return (
    <div className="px-4 pt-2 pb-4">
      <button
        onClick={() => go(draft.condition ? 'trip-condition' : 'home')}
        className="flex items-center gap-1.5 text-slate-500 text-[13px] mb-4 hover:text-slate-700 font-medium"
      >
        <ChevronLeft size={16} /> Kembali
      </button>
      <h2 className="font-black text-slate-900 text-[20px] mb-0.5">Pilih Rute</h2>
      <p className="text-slate-500 text-[13px] mb-4">
        {isEmptyTrip
          ? 'Trip kosong — pilih rute perjalanan'
          : dockName
            ? `Rute dari ${dockName} (${dock?.code ?? ''})`
            : 'Pilih rute perjalanan'}
      </p>

      {/* Banner */}
      <div className="bg-[#0F172A] rounded-2xl p-4 mb-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
          <MapPin size={16} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-slate-400 text-[10px] font-semibold uppercase tracking-wide">Wilayah Aktif</p>
          <p className="text-white font-bold text-[13px]">{officer.region}</p>
          {dockName && (
            <div className="flex items-center gap-1 mt-0.5">
              <Anchor size={10} className="text-amber-400" />
              <p className="text-amber-400 text-[10px] font-semibold">{dockName}</p>
            </div>
          )}
        </div>
        <Map size={16} className="text-slate-600 shrink-0" />
      </div>

      {/* GEOFENCE GATE: loading & error — rute disembunyikan hingga lokasi terverifikasi */}
      {gateRequired && geoStatus === 'pending' && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 mb-4 flex items-center gap-3 text-[12px] text-blue-800">
          <Loader2 size={16} className="animate-spin text-blue-600 shrink-0" />
          <div>
            <p className="font-bold">Memeriksa lokasi Anda…</p>
            <p className="text-[10px] text-blue-600 mt-0.5">Validasi geofencing berjalan — daftar rute muncul setelah titik lokasi terverifikasi.</p>
          </div>
        </div>
      )}
      {gateRequired && geoStatus === 'error' && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 mb-4 flex items-start gap-3 text-[12px] text-red-800">
          <ShieldAlert size={16} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-bold">Lokasi belum terverifikasi</p>
            <p className="text-[10px] text-red-600 mt-0.5">{geofenceError}</p>
            <button
              onClick={() => void runGeoCheck()}
              className="mt-2 flex items-center gap-1.5 bg-red-600 text-white text-[11px] font-bold px-3 py-2 rounded-xl hover:bg-red-700 active:scale-95 transition-all"
            >
              <RefreshCw size={12} /> Coba Lagi
            </button>
          </div>
        </div>
      )}

      {/* Geofencing Lock Banner */}
      {isRouteLocked && (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <Navigation size={18} className="text-blue-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[12px] font-bold text-blue-800">Rute Dikunci Otomatis</p>
            <p className="text-[10px] text-blue-600 mt-1">
              Berdasarkan lokasi Anda, rute dipaksa: <span className="font-semibold">{lockedRoute?.replace('-', ' → ')}</span>
            </p>
          </div>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 mb-2 flex items-center gap-3 text-[12px] text-slate-500">
          <span className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin shrink-0" />
          Memuat rute terbaru...
        </div>
      )}

      {/* Empty state */}
      {!loading && list.length === 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-800 mb-4">
          {dockName
            ? `Tidak ada rute untuk ${dockName}. Hubungi admin untuk menambahkan rute.`
            : 'Pilih dermaga untuk melihat rute.'}
        </div>
      )}

      <div className="space-y-2.5 mb-5">
        {!loading && list.map(r => {
          const isSelected = validSelected === r.code
          return (
            <button
              key={r.code}
              onClick={() => patchDraft({ routeCode: r.code })}
              className={`w-full rounded-2xl p-4 text-left border-2 transition-all ${
                isSelected ? 'border-blue-500 bg-blue-50 shadow-sm' : 'border-slate-100 bg-white hover:border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isSelected ? 'bg-blue-600' : 'bg-slate-100'}`}>
                      <Map size={16} className={isSelected ? 'text-white' : 'text-slate-500'} />
                    </div>
                  <div>
                    <p className="font-bold text-slate-900 text-[13px]">{r.from} → {r.to}</p>
                    <p className="text-[11px] text-slate-400">{r.label}</p>
                  </div>
                </div>
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
                }`}>
                  {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                </div>
              </div>
              <div className="flex gap-4 pl-[52px]">
                <span className="text-[10px] text-slate-400 flex items-center gap-1"><Ruler size={10} /> {r.distance || '—'}</span>
                <span className="text-[10px] text-slate-400 flex items-center gap-1"><Clock size={10} /> {r.duration || '—'}</span>
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
