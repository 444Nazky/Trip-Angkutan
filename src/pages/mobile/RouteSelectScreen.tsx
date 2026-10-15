import { useEffect, useState } from 'react'
import { ChevronLeft, Map, MapPin, Ruler, Clock, Anchor, Lock, RefreshCw, AlertTriangle, MapPinOff } from 'lucide-react'
import { refreshStoredRoutes, getStoredRoutes, type UiRoute } from '../../services/auth'
import {
  getActiveGeofenceSnapshot,
  forceSyncGeofencesFromBackend,
  resetGpsFixCache,
  GEOFENCE_UPDATED_EVENT,
  type GeofencePoint,
} from '../../services/geofence'
import { useApp } from '../store'
import type { MobileScreen } from '../types'
import { isDevMode } from '../../services/runtimeEnv'




interface RouteSelectScreenProps {
  go: (s: MobileScreen) => void
  selectedDockId?: string | null
}




export default function RouteSelectScreen({ go, selectedDockId }: RouteSelectScreenProps) {
  const { draft, patchDraft, officer } = useApp()

  const dockId = selectedDockId ?? null
  const accessibleDermagas = officer.dermagaAccess || []
  const dock = dockId ? accessibleDermagas.find(d => d.id === dockId) ?? null : null
  const dockName = dock?.name ?? null

  const [routes, setRoutes] = useState<UiRoute[]>(() => getStoredRoutes())
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    setLoading(true)
    refreshStoredRoutes().then(fresh => {
      if (alive && fresh) setRoutes(fresh)
    }).finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [])

  const dermagaFiltered = dockId
    ? routes.filter(r => r.dermagaId === dockId)
    : []

  const isEmptyTrip = draft.condition === 'kosong'
  const [activeGeofence, setActiveGeofence] = useState<GeofencePoint | null>(null)
  const [geoStatus, setGeoStatus] = useState<'checking' | 'inside' | 'blocked' | 'mismatch'>('checking')
  const [configMissing, setConfigMissing] = useState(false)
  const [syncingGeo, setSyncingGeo] = useState(false)
  const [syncNote, setSyncNote] = useState<string | null>(null)
  const [dockMismatch, setDockMismatch] = useState<{
    selectedDock: string
    actualGeofence: string
    actualGeofenceId: string
  } | null>(null)

  useEffect(() => {
    let alive = true

    const evaluate = async (): Promise<void> => {
      const result = await getActiveGeofenceSnapshot()
      if (!alive) return

      if (result.valid && result.activePoint) {
        setActiveGeofence(result.activePoint)
        setConfigMissing(false)
        setSyncNote(null)

        if (dockId && result.activePoint.dermagaId) {
          if (result.activePoint.dermagaId !== dockId) {
            setDockMismatch({
              selectedDock: dockId,
              actualGeofence: result.activePoint.name,
              actualGeofenceId: result.activePoint.id,
            })
            setGeoStatus('mismatch')
            return
          }
        }
        setDockMismatch(null)
        setGeoStatus('inside')
      } else {
        setActiveGeofence(null)
        setDockMismatch(null)
        setGeoStatus('blocked')
        setConfigMissing(result.configMissing === true)
      }
    }

    const evaluateWithSelfHeal = async (): Promise<void> => {
      const first = await getActiveGeofenceSnapshot()
      if (!alive) return
      if (first.valid || !first.configMissing) { void evaluate(); return }

      setSyncingGeo(true)
      const sync = await forceSyncGeofencesFromBackend()
      if (!alive) return
      setSyncingGeo(false)
      if (sync.ok && sync.count > 0) {
        await evaluate()
        return
      }
      setActiveGeofence(null)
      setDockMismatch(null)
      setGeoStatus('blocked')
      setConfigMissing(true)
      setSyncNote(
        sync.reason === 'unauthorized'
          ? 'Sesi ke server belum siap — hubungi admin untuk mendaftarkan titik lokasi Master Rute.'
          : sync.reason === 'empty'
            ? 'Geofence belum dikonfigurasi admin (Master Rute) — hubungi admin untuk mendaftarkan titik lokasi — pindah ke dermaga resmi untuk input trip.'
            : 'Konfigurasi geofence belum tersimpan dan server tidak terjangkau — sambungkan ke jaringan lalu tekan Sinkronkan.',
      )
    }

    void evaluateWithSelfHeal()
    const timer = window.setInterval(() => { void evaluate() }, 15000)
    const onFocus = () => { void evaluate() }
    const onOnline = () => { void evaluateWithSelfHeal() }
    const onGeofenceUpdated = () => { void evaluate() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener(GEOFENCE_UPDATED_EVENT, onGeofenceUpdated)
    return () => {
      alive = false
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener(GEOFENCE_UPDATED_EVENT, onGeofenceUpdated)
    }
  }, [])

  const handleSyncGeofence = async () => {
    setSyncingGeo(true)
    setSyncNote(null)
    const sync = await forceSyncGeofencesFromBackend()
    const snap = await getActiveGeofenceSnapshot()
    setSyncingGeo(false)
    if (snap.valid && snap.activePoint) {
      setActiveGeofence(snap.activePoint)
      setConfigMissing(false)

      if (dockId && snap.activePoint.dermagaId) {
        if (snap.activePoint.dermagaId !== dockId) {
          setDockMismatch({
            selectedDock: dockId,
            actualGeofence: snap.activePoint.name,
            actualGeofenceId: snap.activePoint.id,
          })
          setGeoStatus('mismatch')
          setSyncNote(`Ditemukan di ${snap.activePoint.name} — bukan ${dock?.name ?? dockId}`)
          return
        }
      }
      setDockMismatch(null)
      setGeoStatus('inside')
      setSyncNote(`Konfigurasi terbaru diterima (${sync.count} titik)`)
      return
    }
    setActiveGeofence(null)
    setDockMismatch(null)
    setGeoStatus('blocked')
    setConfigMissing(snap.configMissing === true)
    setSyncNote(
      sync.reason === 'empty'
        ? 'Geofence belum dikonfigurasi admin (Master Rute) — hubungi admin.'
        : sync.reason === 'unauthorized'
          ? 'Sesi server belum siap — coba lagi setelah beberapa detik.'
          : sync.ok
            ? 'Konfigurasi sudah terbaru, tetapi lokasi Anda masih di luar area.'
            : 'Gagal menghubungi server — periksa jaringan.',
    )
  }

  const list = geoStatus === 'checking' || geoStatus === 'blocked'
    ? []
    : activeGeofence
      ? dermagaFiltered.filter(r => activeGeofence.allowedRoutes.includes(r.code))
      : []

  const validSelected = draft.routeCode && list.some(r => r.code === draft.routeCode)
    ? draft.routeCode
    : null

  const handleContinue = () => {
    if (!draft.condition) { go('trip-condition'); return }
    if (!validSelected) return
    if (activeGeofence && !activeGeofence.allowedRoutes.includes(validSelected)) return
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

      {/* ── Status geofence real-time ── */}
      {geoStatus === 'checking' && (
        <div className="rounded-xl bg-slate-50 border border-slate-200 p-3 mb-3 flex items-center gap-2 text-[12px] text-slate-500">
          <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin shrink-0" />
          Memeriksa lokasi GPS...
        </div>
      )}
      {geoStatus === 'inside' && activeGeofence && (
        <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 mb-3 flex items-center gap-2">
          <Lock size={13} className="text-blue-600 shrink-0" />
          <p className="text-[12px] text-blue-700">
            <span className="font-semibold">{activeGeofence.name}</span>
            <span className="text-blue-500"> — rute dikunci ke {activeGeofence.allowedRoutes.join(', ')} (radius {activeGeofence.radiusMeters}m)</span>
          </p>
        </div>
      )}
      {/* ── DERMAGA MISMATCH: petugas di dermaga berbeda ── */}
      {geoStatus === 'mismatch' && dockMismatch && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-3 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center shrink-0">
              <MapPinOff size={18} className="text-amber-600" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-amber-800 text-[13px] mb-1">
                Lokasi Tidak Sesuai Dermaga
              </p>
              <p className="text-[11px] text-amber-700 leading-relaxed">
                Anda terdeteksi di <span className="font-semibold">{dockMismatch.actualGeofence}</span>,
                bukan di <span className="font-semibold">{dock?.name ?? dockMismatch.selectedDock}</span>.
                Silakan berpindah ke dermaga yang sesuai untuk melanjutkan input trip.
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              resetGpsFixCache()
              void handleSyncGeofence()
            }}
            disabled={syncingGeo}
            className="mt-3 w-full py-2.5 rounded-lg bg-white border border-amber-200 text-[12px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60 text-amber-700 active:scale-[0.98] transition-all hover:bg-amber-50"
          >
            <RefreshCw size={14} className={syncingGeo ? 'animate-spin' : ''} />
            {syncingGeo ? 'Memeriksa Lokasi…' : 'Periksa Ulang Lokasi'}
          </button>
          {syncNote && (
            <p className="text-[11px] text-amber-600 mt-2 text-center font-medium">{syncNote}</p>
          )}
        </div>
      )}
      {geoStatus === 'blocked' && (
        <div className="rounded-xl border border-red-200 bg-rose-50 p-4 mb-3 shadow-sm">
          {/* Header dengan ikon AlertTriangle */}
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-red-100 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} className="text-[#DC2626]" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-red-800 text-[13px] mb-1">
                Di Luar Area Geofence Resmi
              </p>
              <p className="text-[11px] text-red-700 leading-relaxed">
                {configMissing
                  ? 'Geofence belum dikonfigurasi admin (Master Rute) — hubungi admin untuk mendaftarkan titik lokasi — pindah ke dermaga resmi untuk input trip.'
                  : 'Lokasi Anda saat ini berada di luar area bertugas yang diizinkan. Silakan berpindah ke titik lokasi/dermaga resmi untuk melanjutkan input trip.'
                }
              </p>
            </div>
          </div>

          {/* Tombol Periksa Ulang Lokasi */}
          <button
            onClick={() => {
              resetGpsFixCache()
              void handleSyncGeofence()
            }}
            disabled={syncingGeo}
            className="mt-3 w-full py-2.5 rounded-lg bg-white border border-red-200 text-[12px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60 text-red-700 active:scale-[0.98] transition-all hover:bg-red-50"
          >
            <RefreshCw size={14} className={syncingGeo ? 'animate-spin' : ''} />
            {syncingGeo ? 'Memeriksa Lokasi…' : 'Periksa Ulang Lokasi'}
          </button>

          {/* Catatan sinkronisasi */}
          {syncNote && (
            <p className="text-[11px] text-red-600 mt-2 text-center font-medium">{syncNote}</p>
          )}

          {/* ── DEV MODE OVERRIDE: hanya terlihat di development build ── */}
          {isDevMode() && (
            <div className="mt-3 pt-3 border-t border-red-200">
              <button
                onClick={() => {
                  setActiveGeofence({
                    id: 'dev-override',
                    name: 'DEV MODE Override',
                    latitude: -6.1891005,
                    longitude: 106.8371641,
                    radiusMeters: 1000,
                    allowedRoutes: dermagaFiltered.map(r => r.code),
                    enabled: true,
                    strictEnforceOutsideArea: false,
                  })
                  setGeoStatus('inside')
                  setConfigMissing(false)
                }}
                className="w-full py-2 rounded-lg bg-amber-100 border border-amber-300 text-[11px] font-bold text-amber-800 flex items-center justify-center gap-1.5 active:scale-[0.98] transition-all"
              >
                🔧 DEV MODE: Lewati Geofence (Testing Only)
              </button>
              <p className="text-[9px] text-amber-600 mt-1.5 text-center">
                Mode pengembangan — tombol ini tidak muncul di production build
              </p>
            </div>
          )}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="rounded-2xl border border-slate-100 bg-white p-4 mb-2 flex items-center gap-3 text-[12px] text-slate-500">
          <span className="w-4 h-4 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin shrink-0" />
          Memuat rute terbaru...
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
        disabled={!validSelected || geoStatus !== 'inside'}
        className="w-full bg-[#0F172A] text-white font-bold py-4 rounded-2xl text-[13px] disabled:opacity-40 hover:bg-slate-800 active:scale-[0.98] transition-all"
      >
        {!draft.condition
          ? 'Pilih Rute Ini'
          : draft.condition === 'muatan' ? 'Lanjut Input Kendaraan' : 'Lanjut Ambil Foto'}
      </button>
    </div>
  )
}
