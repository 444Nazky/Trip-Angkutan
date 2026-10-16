import { useEffect, useState } from 'react'
import { ChevronLeft, MapPin, Plus, Trash2, Pencil, Check, RefreshCw } from 'lucide-react'
import {
  getStoredGeofencePoints,
  saveGeofencePoints,
  isValidGeofencePoint,
  getActiveGeofenceSnapshot,
  GEOFENCE_UPDATED_EVENT,
  forceSyncGeofencesFromBackend,
  getLastGeofenceDiagnosis,
  scopedGeofencePoints,
  type GeofencePoint,
  type GeofenceScopeDiagnosis,
} from '../../services/geofence'
import { useApp } from '../store'
import type { MobileScreen } from '../types'



interface GeofenceConfigScreenProps {
  go: (s: MobileScreen) => void
}



interface DraftPoint {
  id: string
  name: string
  latitude: string
  longitude: string
  radiusMeters: string
  allowedRoutes: string
  strictEnforceOutsideArea: boolean
  dermagaId: string
}

const emptyDraft: DraftPoint = {
  id: '',
  name: '',
  latitude: '',
  longitude: '',
  radiusMeters: '100',
  allowedRoutes: '',
  strictEnforceOutsideArea: true,
  dermagaId: '',
}



function parseRoutes(raw: string): string[] {
  return Array.from(new Set(
    raw.split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean),
  ))
}



export default function GeofenceConfigScreen({ go }: GeofenceConfigScreenProps) {
  const { userType, officer } = useApp()
  const isAdmin = userType === 'admin'

  const [points, setPoints] = useState<GeofencePoint[]>(() => scopedGeofencePoints(getStoredGeofencePoints()))
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<DraftPoint>(emptyDraft)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [diag, setDiag] = useState<GeofenceScopeDiagnosis | null>(() => getLastGeofenceDiagnosis())

  useEffect(() => {
    const onUpdate = () => {
      setPoints(scopedGeofencePoints(getStoredGeofencePoints()))
      setDiag(getLastGeofenceDiagnosis())
    }
    window.addEventListener(GEOFENCE_UPDATED_EVENT, onUpdate)
    return () => window.removeEventListener(GEOFENCE_UPDATED_EVENT, onUpdate)
  }, [])

  useEffect(() => {
    void getActiveGeofenceSnapshot().then(r => {
      if (r.valid && r.activePoint) setActiveId(r.activePoint.id)
    })
  }, [])

  const handleSync = async () => {
    setSyncing(true)
    setError(null)
    try {
      // ponytail: sinkronisasi TIDAK lagi digantung pada renew session terpisah.
      // Dulu renew dipanggil duluan dan — karena tanpa token renew mustahil —
      // tombol selalu berakhir "Sesi habis", padahal petugas sudah login. Sekarang
      // sync mencoba sendiri (termasuk login-diam-diam) dan selalu memakai cache
      // lokal sebagai last-known-good.
      const result = await forceSyncGeofencesFromBackend()
      console.log('[GeofenceConfig] Sync result:', result)
      if (result.reason === 'unauthorized') {
        setError('Sesi server belum siap — data lokal tetap dipakai. Coba lagi saat online.')
      } else if (result.reason === 'network') {
        setError('Gagal terhubung ke server. Periksa koneksi internet — titik lokal tetap dipakai.')
      } else if (result.count === 0) {
        setError('Belum ada titik geofence di server untuk dermaga/rute Anda. Minta admin mendaftarkannya di Master Rute.')
      }
      // Ambil data terbaru dari storage
      setPoints(scopedGeofencePoints(getStoredGeofencePoints()))
      setDiag(getLastGeofenceDiagnosis())
    } catch (e) {
      console.error('[GeofenceConfig] Sync error:', e)
      setError('Gagal menyinkronkan. Coba lagi nanti.')
    } finally {
      setSyncing(false)
    }
  }

  const commit = (next: GeofencePoint[]) => {
    setPoints(next)
    saveGeofencePoints(next)
  }

  const startAdd = () => {
    setDraft({ ...emptyDraft, id: `geo-${Date.now().toString(36)}` })
    setEditingId(null)
    setShowForm(true)
    setError(null)
  }

  const startEdit = (p: GeofencePoint) => {
    setDraft({
      id: p.id,
      name: p.name,
      latitude: String(p.latitude),
      longitude: String(p.longitude),
      radiusMeters: String(p.radiusMeters),
      allowedRoutes: p.allowedRoutes.join(', '),
      strictEnforceOutsideArea: p.strictEnforceOutsideArea !== false,
      dermagaId: p.dermagaId ?? '',
    })
    setEditingId(p.id)
    setShowForm(true)
    setError(null)
  }

  const buildPoint = (base: GeofencePoint | null): GeofencePoint => ({
    id: draft.id.trim(),
    name: draft.name.trim(),
    dermagaId: draft.dermagaId || undefined,
    latitude: Number(draft.latitude),
    longitude: Number(draft.longitude),
    radiusMeters: Number(draft.radiusMeters),
    allowedRoutes: parseRoutes(draft.allowedRoutes),
    enabled: base?.enabled ?? true,
    strictEnforceOutsideArea: draft.strictEnforceOutsideArea,
  })

  const saveDraft = () => {
    const candidate = buildPoint(editingId ? points.find(p => p.id === editingId) ?? null : null)
    const errors = isValidGeofencePoint(candidate)
    if (errors.length > 0) {
      setError(errors.join(' · '))
      return
    }
    if (editingId) {
      commit(points.map(p => (p.id === editingId ? candidate : p)))
    } else {
      if (points.some(p => p.id === candidate.id)) {
        setError('ID titik geofence sudah dipakai')
        return
      }
      commit([...points, candidate])
    }
    setShowForm(false)
    setError(null)
  }

  const removePoint = (id: string) => {
    if (!isAdmin) return
    commit(points.filter(p => p.id !== id))
  }

  const toggleEnabled = (id: string) => {
    if (!isAdmin) return
    commit(points.map(p => (p.id === id ? { ...p, enabled: !p.enabled } : p)))
  }

  return (
    <div className="min-h-full bg-white">
      <div className="flex items-center px-4 py-3 border-b border-slate-200">
        <button onClick={() => go('profile')} className="w-11 h-11 flex items-center justify-start -ml-2">
          <ChevronLeft size={20} className="text-blue-600" />
        </button>
        <h1 className="flex-1 text-center text-[17px] font-semibold text-slate-900 mr-11">Konfigurasi Geofence</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="w-10 h-10 flex items-center justify-center text-blue-600 disabled:opacity-50"
          title="Sinkronkan dari server"
        >
          <RefreshCw size={18} className={syncing ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="px-4 py-5 space-y-4">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">
            {error}
          </div>
        )}

        {showForm && isAdmin && (
          <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/50 p-4 space-y-3">
            <p className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">
              {editingId ? 'Ubah Titik Geofence' : 'Titik Geofence Baru'}
            </p>
            <input
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              placeholder="Nama lokasi (mis. Badau Dermaga 1)"
              className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[14px] focus:outline-none focus:border-blue-500 bg-white"
            />
            <div className="relative">
              <select
                value={draft.dermagaId}
                onChange={e => setDraft({ ...draft, dermagaId: e.target.value })}
                className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-[14px] focus:outline-none focus:border-blue-500 bg-white appearance-none"
              >
                <option value="">Pilih Dermaga (opsional)</option>
                {officer.dermagaAccess?.map(d => (
                  <option key={d.id} value={d.id}>{d.name} ({d.code})</option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs">▾</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={draft.latitude}
                onChange={e => setDraft({ ...draft, latitude: e.target.value })}
                placeholder="Latitude (mis. -6.1891005)"
                inputMode="decimal"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-[13px] focus:outline-none focus:border-blue-500 bg-white"
              />
              <input
                value={draft.longitude}
                onChange={e => setDraft({ ...draft, longitude: e.target.value })}
                placeholder="Longitude (mis. 106.8371641)"
                inputMode="decimal"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-[13px] focus:outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={draft.radiusMeters}
                onChange={e => setDraft({ ...draft, radiusMeters: e.target.value })}
                placeholder="Radius (meter)"
                inputMode="numeric"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-[13px] focus:outline-none focus:border-blue-500 bg-white"
              />
              <input
                value={draft.allowedRoutes}
                onChange={e => setDraft({ ...draft, allowedRoutes: e.target.value })}
                placeholder="Rute: SJRE-SBDZ, SBDZ-SJRE"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-[13px] focus:outline-none focus:border-blue-500 bg-white"
              />
            </div>
            <label className="flex items-center justify-between bg-white rounded-xl border border-slate-300 px-3 py-2.5">
              <span className="text-[12px] text-slate-700 font-semibold">
                Strict Enforce Outside Area
                <span className="block text-[10px] font-normal text-slate-500">
                  Aktif = di luar area / GPS buruk memblokir SEMUA input trip
                </span>
              </span>
              <input
                type="checkbox"
                checked={draft.strictEnforceOutsideArea}
                onChange={e => setDraft({ ...draft, strictEnforceOutsideArea: e.target.checked })}
                className="w-5 h-5 accent-blue-600 shrink-0"
              />
            </label>
            {error && <p className="text-[12px] text-red-600 font-semibold">{error}</p>}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setShowForm(false); setError(null) }}
                className="flex-1 py-2.5 rounded-xl border border-slate-300 text-slate-600 font-semibold text-[13px] active:bg-slate-100"
              >
                Batal
              </button>
              <button
                onClick={saveDraft}
                className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white font-bold text-[13px] active:bg-blue-700 flex items-center justify-center gap-1.5"
              >
                <Check size={15} /> Simpan
              </button>
            </div>
          </div>
        )}

        {!showForm && isAdmin && (
          <button
            onClick={startAdd}
            className="w-full py-3 rounded-xl border border-dashed border-blue-300 bg-blue-50 text-blue-700 font-bold text-[13px] flex items-center justify-center gap-2 active:bg-blue-100"
          >
            <Plus size={16} /> Tambah Titik Geofence
          </button>
        )}

        <div className="space-y-3">
          {points.map(p => (
            <div key={p.id} className={`rounded-2xl border p-4 ${
              p.id === activeId ? 'border-blue-300 bg-blue-50' : 'border-slate-200 bg-white'
            }`}>
              <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  p.enabled ? 'bg-emerald-100' : 'bg-slate-100'
                }`}>
                  <MapPin size={16} className={p.enabled ? 'text-emerald-600' : 'text-slate-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-slate-900">{p.name || p.id}</p>
                  <p className="text-[11px] font-mono text-slate-500 mt-0.5">
                    {p.latitude}, {p.longitude}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {p.dermagaId && (
                      <span className="text-[10px] font-bold bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                        Dermaga: {officer.dermagaAccess?.find(d => d.id === p.dermagaId)?.name ?? p.dermagaId}
                      </span>
                    )}
                    <span className="text-[10px] font-bold bg-slate-800 text-white px-2 py-0.5 rounded-full">
                      R {p.radiusMeters}m
                    </span>
                    {p.allowedRoutes.map(r => (
                      <span key={r} className="text-[10px] font-bold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{r}</span>
                    ))}
                    {!p.enabled && (
                      <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">Nonaktif</span>
                    )}
                    {p.strictEnforceOutsideArea === false && (
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">Non-strict</span>
                    )}
                    {p.id === activeId && (
                      <span className="text-[10px] font-bold bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Anda di sini</span>
                    )}
                  </div>
                </div>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100">
                  <button
                    onClick={() => startEdit(p)}
                    className="flex-1 py-2 rounded-lg bg-blue-50 text-blue-700 font-bold text-[12px] flex items-center justify-center gap-1.5"
                  >
                    <Pencil size={13} /> Ubah
                  </button>
                  <button
                    onClick={() => toggleEnabled(p.id)}
                    className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 font-bold text-[12px]"
                  >
                    {p.enabled ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                  <button
                    onClick={() => removePoint(p.id)}
                    className="py-2 px-3 rounded-lg bg-red-50 text-red-600 font-bold text-[12px]"
                    title="Hapus titik"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))}

          {points.length === 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-[12px] text-amber-800">
              <p className="font-semibold mb-1">Belum ada titik geofence tersimpan.</p>
              <p>Tekan tombol sinkronkan di kanan atas untuk menarik data dari server, atau tambah manual.</p>
              {diag && (
                <p className="mt-2 text-[11px] text-amber-700">
                  Sync terakhir: server mengirim {diag.received} titik, {diag.active} aktif, {diag.scoped} cocok
                  dengan rute Anda{diag.assignedCodes.length > 0 ? ` (${diag.assignedCodes.join(', ')})` : ' (rute belum tersinkron)'}.
                  {diag.received > 0 && diag.scoped === 0
                    ? ' Minta admin daftarkan titik untuk rute Anda di Master Rute.'
                    : ''}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
