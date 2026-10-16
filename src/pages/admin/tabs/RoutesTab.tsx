import { useEffect, useRef, useState } from 'react'
import { MapPin, Plus, Pencil, Trash2, X, Link2, ExternalLink } from 'lucide-react'
import { fetchRoutes, fetchDermagas, createRoute, updateRoute, deleteRoute } from '../../../services/dermagas'
import { fetchGeofencePointsForRoute, createRouteGeofencePoint, updateGeofenceRule, deleteGeofenceRule } from '../../../services/geofences'
import { isShortMapsLink, parseMapsUrl, resolveMapsShortLink, osmEmbeddedMapUrl, googleMapsLink, type ParsedGeo } from '../../../services/geo'
import type { RouteRow, RouteDermaga, RouteFormState, GeofencePoint } from '../components/types'
import { emptyRouteForm } from '../components/types'




interface RoutesTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}



export function RoutesTab({ showToast }: RoutesTabProps) {
  const [routeRows, setRouteRows] = useState<RouteRow[]>([])
  const [routeDermagas, setRouteDermagas] = useState<RouteDermaga[]>([])
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [routeForm, setRouteForm] = useState<RouteFormState>(emptyRouteForm)
  const [editRouteId, setEditRouteId] = useState<string | null>(null)

  const [showGeofencePanel, setShowGeofencePanel] = useState(false)
  const [geofencePoints, setGeofencePoints] = useState<GeofencePoint[]>([])
  const [activeGeofence, setActiveGeofence] = useState<GeofencePoint | null>(null)
  const [mapsLink, setMapsLink] = useState('')
  const [resolvingLink, setResolvingLink] = useState(false)

  const [coordsFromLink, setCoordsFromLink] = useState(false)

  const [manualCoords, setManualCoords] = useState(false)
  const [currentRouteForGeofence, setCurrentRouteForGeofence] = useState<RouteRow | null>(null)

  const resolveTimer = useRef<number | null>(null)

  useEffect(() => () => {
    if (resolveTimer.current !== null) window.clearTimeout(resolveTimer.current)
  }, [])

  const loadRoutes = async () => {
    if (routeState !== 'idle') return
    setRouteState('loading')
    const [rts, dms] = await Promise.all([fetchRoutes(), fetchDermagas()])
    if (rts === null) { setRouteState('offline'); return }
    setRouteRows(rts as RouteRow[])
    if (dms) setRouteDermagas(dms as RouteDermaga[])
    setRouteState('ready')
  }

  if (routeState === 'idle') void loadRoutes()

  const resetForm = () => {
    setEditRouteId(null)
    setRouteForm(emptyRouteForm)
  }

  const startEdit = (r: RouteRow) => {
    setEditRouteId(r.id)
    setRouteForm({
      dermaga_id: r.dermaga_id,
      name: r.name,
      route_from: r.route_from,
      route_to: r.route_to,
      distance: r.distance ?? '',
      duration: r.duration ?? '',
      geofencePoints: [],
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSave = async () => {
    const f = routeForm
    if (!f.name.trim() || !f.route_from.trim() || !f.route_to.trim()) return showToast('Nama, asal, tujuan wajib!', 'error')
    if (!editRouteId && !f.dermaga_id) return showToast('Pilih dermaga!', 'error')
    const payload = {
      dermaga_id: f.dermaga_id,
      name: f.name.trim(),
      route_from: f.route_from.trim().toUpperCase(),
      route_to: f.route_to.trim().toUpperCase(),
      distance: f.distance.trim() || undefined,
      duration: f.duration.trim() || undefined,
    }
    const saved = editRouteId
      ? await updateRoute(editRouteId, payload)
      : (await createRoute(payload)) !== null
    if (!saved) return showToast('Server gagal', 'error')
    showToast(editRouteId ? 'Rute diperbarui' : 'Rute ditambahkan')
    resetForm()
    const fresh = await fetchRoutes()
    if (fresh) setRouteRows(fresh as RouteRow[])
  }

  const handleDel = async (id: string) => {
    if (!confirm('Hapus rute ini?')) return
    const ok = await deleteRoute(id)
    if (!ok) return showToast('Server gagal', 'error')
    if (editRouteId === id) resetForm()
    showToast('Rute dihapus')
    const fresh = await fetchRoutes()
    if (fresh) setRouteRows(fresh as RouteRow[])
  }

  const loadGeofencePoints = async (routeCode: string, dermagaId?: string) => {
    if (!routeCode) return
    const points = await fetchGeofencePointsForRoute(routeCode, dermagaId)
    const mapped: GeofencePoint[] = points.map(p => ({
      id: p.id,
      locationName: p.locationName,
      latitude: String(p.latitude),
      longitude: String(p.longitude),
      radiusMeters: String(p.radiusMeters),
      description: p.description || '',
    }))
    setGeofencePoints(mapped)
  }

  const openGeofencePanel = async (r: RouteRow) => {
    setShowGeofencePanel(true)
    setActiveGeofence(null)
    setMapsLink('')
    setCurrentRouteForGeofence(r)
    const routeCode = `${r.route_from}-${r.route_to}`
    await loadGeofencePoints(routeCode, r.dermaga_id)
  }

  const closeGeofencePanel = () => {
    setShowGeofencePanel(false)
    setActiveGeofence(null)
    setGeofencePoints([])
    setMapsLink('')
    setCurrentRouteForGeofence(null)
  }

  const startAddGeofence = () => {
    setActiveGeofence({
      id: undefined,
      locationName: '',
      latitude: '',
      longitude: '',
      radiusMeters: '100',
      description: '',
    })
    setMapsLink('')
    setCoordsFromLink(false)
    setManualCoords(false)
  }

  const startEditGeofence = (point: GeofencePoint) => {
    setActiveGeofence({ ...point })
    setMapsLink('')

    setCoordsFromLink(false)
    setManualCoords(true)
  }

  const cancelGeofenceEdit = () => {
    setActiveGeofence(null)
    setMapsLink('')
    setCoordsFromLink(false)
    setManualCoords(false)
  }

  const extractCoordsFromMapsLink = async (raw: string): Promise<ParsedGeo | null> => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    let candidate = trimmed

    if (isShortMapsLink(trimmed)) {
      setResolvingLink(true)
      const resolved = await resolveMapsShortLink(trimmed)
      setResolvingLink(false)
      if (!resolved) {
        showToast('Short link gagal di-resolve. Buka link di tab baru, lalu copy URL penuh.', 'error')
        return null
      }
      candidate = resolved
    }
    const parsed = parseMapsUrl(candidate)
    if (!parsed) return null
    return parsed
  }

  const applyParsedCoords = (parsed: ParsedGeo) => {
    setActiveGeofence(prev => {
      if (!prev) return null

      const radius = prev.radiusMeters.trim() ? prev.radiusMeters : '100'
      return { ...prev, latitude: String(parsed.latitude), longitude: String(parsed.longitude), radiusMeters: radius }
    })
    setCoordsFromLink(true)
    setManualCoords(false)

    showToast('Koordinat terisi otomatis dari link Google Maps')
  }

  const handleMapsLinkChanged = (value: string) => {
    setMapsLink(value)
    if (resolveTimer.current !== null) { window.clearTimeout(resolveTimer.current); resolveTimer.current = null }
    const raw = value.trim()
    if (!raw || !activeGeofence) return

    if (!isShortMapsLink(raw)) {
      const quick = parseMapsUrl(raw)
      if (quick) { applyParsedCoords(quick); return }
    }

    if (/^https?:\/\//i.test(raw)) {
      resolveTimer.current = window.setTimeout(() => {
        resolveTimer.current = null
        void extractCoordsFromMapsLink(raw).then(parsed => {
          if (parsed) applyParsedCoords(parsed)
        })
      }, 500)
    }
  }

  const handleMapsLinkGeofence = async () => {
    const raw = mapsLink.trim()
    if (!raw || !activeGeofence) return
    const parsed = await extractCoordsFromMapsLink(raw)
    if (!parsed) {
      showToast('Koordinat tidak ditemukan di link. Coba paste URL penuh.', 'error')
      return
    }
    applyParsedCoords(parsed)
  }

  const saveGeofencePoint = async (routeCode: string) => {
    if (!activeGeofence) return
    const { id, locationName, latitude, longitude, radiusMeters, description } = activeGeofence

    if (!locationName.trim()) {
      showToast('Nama lokasi wajib diisi', 'error')
      return
    }

    const PLACEHOLDER_RE = /otomatis|link maps|latitude|longitude|^[-—]$/i
    const rawLat = latitude.trim()
    const rawLon = longitude.trim()
    if (!rawLat || !rawLon || PLACEHOLDER_RE.test(rawLat) || PLACEHOLDER_RE.test(rawLon)) {
      showToast('Koordinat belum terisi. Tempel link Google Maps atau isi Latitude & Longitude manual.', 'error')
      return
    }

    const lat = Number.parseFloat(rawLat.replace(',', '.'))
    const lon = Number.parseFloat(rawLon.replace(',', '.'))
    const rad = Number.parseFloat(radiusMeters.replace(',', '.'))
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      showToast('Latitude & Longitude harus berupa angka', 'error')
      return
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      showToast('Koordinat di luar rentang valid (lat ±90, lng ±180)', 'error')
      return
    }
    if (!Number.isFinite(rad) || rad <= 0 || rad > 10000) {
      showToast('Radius harus angka valid 1–10000 meter', 'error')
      return
    }

    // ponytail: titik baru WAJIB memakai dermaga rute ini. Dulu dermagaId tidak
    // pernah dikirim → titik tersimpan "berlaku umum" dan muncul di SEMUA dermaga
    // petugas (radius saling menimpa → "Lokasi Tidak Sesuai Dermaga" palsu).
    const routeDermagaId = currentRouteForGeofence?.dermaga_id ?? null
    const data = {
      locationName: locationName.trim(),
      latitude: Number(lat),
      longitude: Number(lon),
      radiusMeters: Number(rad),
      description: description.trim(),
    }

    if (id) {
      // Edit titik lama (mis. ubah koordinat): sekalian ikat ke dermaga rute ini
      // supaya data lama yang NULL ikut terrapikan, tanpa pernah mengosongkannya.
      const ok = await updateGeofenceRule(id, {
        ...data,
        ...(routeDermagaId ? { dermagaId: routeDermagaId } : {}),
      })
      if (!ok) {
        showToast('Gagal update titik geofence', 'error')
        return
      }
    } else {
      const newId = await createRouteGeofencePoint(routeCode, data, { dermagaId: routeDermagaId })
      if (!newId) {
        showToast('Gagal tambah titik geofence', 'error')
        return
      }
    }

    showToast(id ? 'Titik geofence diperbarui' : 'Titik geofence ditambahkan')
    setActiveGeofence(null)
    await loadGeofencePoints(routeCode, currentRouteForGeofence?.dermaga_id)
  }

  const deleteGeofencePoint = async (point: GeofencePoint, routeCode: string) => {
    if (!point.id) {
      setGeofencePoints(prev => prev.filter(p => p !== point))
      return
    }
    if (!confirm('Hapus titik geofence ini?')) return
    const ok = await deleteGeofenceRule(point.id)
    if (!ok) {
      showToast('Gagal hapus titik geofence', 'error')
      return
    }
    showToast('Titik geofence dihapus')
    await loadGeofencePoints(routeCode, currentRouteForGeofence?.dermaga_id)
  }

  const getRouteCode = () => {
    if (!currentRouteForGeofence) return ''
    return `${currentRouteForGeofence.route_from}-${currentRouteForGeofence.route_to}`
  }

  return (
    <div className="space-y-4">

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Master Rute</h3>
          <p className="text-slate-500 text-[12px]">Rute per wilayah & Dermaga — nama rute bisa diubah dinamis</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
          routeState === 'ready' ? 'bg-emerald-50 text-emerald-600' : routeState === 'offline' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${routeState === 'ready' ? 'bg-emerald-500' : routeState === 'offline' ? 'bg-amber-500' : 'bg-slate-400 animate-pulse'}`} />
          {routeState === 'ready' ? 'Server: Tersambung' : routeState === 'offline' ? 'Offline' : 'Memuat...'}
        </span>
      </div>

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-4xl">
        <h3 className="font-bold mb-4">{editRouteId ? 'Edit Rute' : 'Tambah Rute Baru'}</h3>
        <div className="grid grid-cols-6 gap-4 mb-4">
          <div className="col-span-2">
            <label className="text-[11px] text-slate-500 block mb-1">Dermaga *</label>
            <select value={routeForm.dermaga_id} onChange={e => setRouteForm({ ...routeForm, dermaga_id: e.target.value })}
              disabled={!!editRouteId} className="w-full border rounded-xl px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">— Pilih Dermaga —</option>
              {routeDermagas.map(d => (
                <option key={d.id} value={d.id}>{d.region_name || d.region_id} · {d.name} ({d.code})</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-slate-500 block mb-1">Nama Rute *</label>
            <input value={routeForm.name} onChange={e => setRouteForm({ ...routeForm, name: e.target.value })}
              placeholder="Sijangkung → Sabadi" className="w-full border rounded-xl px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Asal *</label>
            <input value={routeForm.route_from} onChange={e => setRouteForm({ ...routeForm, route_from: e.target.value.toUpperCase() })}
              placeholder="SJRE" className="w-full border rounded-xl px-3 py-2 text-sm font-mono tracking-wide" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Tujuan *</label>
            <input value={routeForm.route_to} onChange={e => setRouteForm({ ...routeForm, route_to: e.target.value.toUpperCase() })}
              placeholder="SBDZ" className="w-full border rounded-xl px-3 py-2 text-sm font-mono tracking-wide" />
          </div>
        </div>
        <div className="grid grid-cols-6 gap-4 mb-4">
          <div><label className="text-[11px] text-slate-500 block mb-1">Jarak</label>
            <input value={routeForm.distance} onChange={e => setRouteForm({ ...routeForm, distance: e.target.value })}
              placeholder="42 km" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          <div><label className="text-[11px] text-slate-500 block mb-1">Durasi</label>
            <input value={routeForm.duration} onChange={e => setRouteForm({ ...routeForm, duration: e.target.value })}
              placeholder="1j 10m" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
        </div>
        <div className="flex gap-3">
          {editRouteId && <button onClick={resetForm} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>}
          <button onClick={() => void handleSave()}
            className={`${editRouteId ? 'flex-1' : 'w-48'} py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700`}>
            {editRouteId ? 'Update' : 'Tambah Rute'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
            <tr>
              <th className="text-left p-4">Wilayah</th><th className="text-left p-4">Dermaga</th>
              <th className="text-left p-4">Nama Rute</th><th className="text-left p-4">Asal</th>
              <th className="text-left p-4">Tujuan</th><th className="text-left p-4">Jarak</th>
              <th className="text-left p-4">Durasi</th><th className="text-right p-4">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {routeRows.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-slate-400">
                {routeState === 'offline' ? 'Offline' : 'Belum ada rute'}
              </td></tr>
            )}
            {routeRows.map(r => (
              <tr key={r.id} className={editRouteId === r.id ? 'bg-blue-50' : 'hover:bg-slate-50'}>
                <td className="p-4 font-semibold text-slate-700">{r.region_name || '—'}</td>
                <td className="p-4 text-slate-500">{r.dermaga_name || '—'} <span className="text-[10px] text-slate-400">({r.dermaga_code || ''})</span></td>
                <td className="p-4 font-semibold text-slate-800">{r.name}</td>
                <td className="p-4 font-mono text-slate-600">{r.route_from}</td>
                <td className="p-4 font-mono text-slate-600">{r.route_to}</td>
                <td className="p-4 text-slate-500">{r.distance || '—'}</td>
                <td className="p-4 text-slate-500">{r.duration || '—'}</td>
                <td className="p-4 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(r)} className="text-blue-600 font-bold text-sm mr-3 hover:underline">Edit</button>
                  <button onClick={() => void openGeofencePanel(r)} className="text-emerald-600 font-bold text-sm mr-3 hover:underline flex items-center gap-1">
                    <MapPin size={12} /> Geofence
                  </button>
                  <button onClick={() => void handleDel(r.id)} className="text-red-500 font-bold text-sm hover:underline">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showGeofencePanel && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">

            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <MapPin size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-lg">Titik Geofence</h3>
                  <p className="text-slate-500 text-xs">
                    Rute: <span className="font-mono font-semibold">{currentRouteForGeofence?.name || getRouteCode()}</span>
                    {currentRouteForGeofence && (
                      <span className="ml-2">({currentRouteForGeofence.route_from} → {currentRouteForGeofence.route_to})</span>
                    )}
                  </p>
                </div>
              </div>
              <button onClick={closeGeofencePanel} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">

              {geofencePoints.length === 0 && !activeGeofence && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800 text-center">
                  Belum ada titik geofence untuk rute ini.<br />
                  Tambahkan titik untuk validasi lokasi petugas.
                </div>
              )}

              {geofencePoints.map((point, idx) => (
                <div key={point.id || idx} className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <p className="font-semibold text-slate-900">{point.locationName}</p>
                      <p className="text-xs text-slate-500 font-mono mt-1">
                        {point.latitude}, {point.longitude} · {point.radiusMeters}m
                      </p>
                      {point.description && (
                        <p className="text-xs text-slate-400 mt-1">{point.description}</p>
                      )}
                      {point.latitude && point.longitude && !isNaN(parseFloat(point.latitude)) && (
                        <div className="mt-2">
                          <iframe
                            title={`Preview ${point.locationName}`}
                            src={osmEmbeddedMapUrl(parseFloat(point.latitude), parseFloat(point.longitude))}
                            className="w-full h-32 rounded-lg border border-slate-200"
                            loading="lazy"
                          />
                        </div>
                      )}
                    </div>
                    <div className="flex gap-1 ml-3">
                      <a
                        href={point.latitude && point.longitude ? googleMapsLink(parseFloat(point.latitude), parseFloat(point.longitude)) : '#'}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-emerald-50"
                      >
                        <ExternalLink size={14} />
                      </a>
                      <button
                        onClick={() => startEditGeofence(point)}
                        className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => deleteGeofencePoint(point, getRouteCode())}
                        className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              {activeGeofence !== null && (
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200 space-y-4">
                  <h4 className="font-bold text-blue-900 text-sm">
                    {activeGeofence.id ? 'Edit Titik' : 'Tambah Titik Baru'}
                  </h4>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">
                      Paste Link Google Maps <span className="font-normal text-slate-400">(koordinat otomatis)</span>
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                          value={mapsLink}
                          onChange={e => handleMapsLinkChanged(e.target.value)}
                          onPaste={e => {
                            const text = e.clipboardData.getData('text')
                            if (text) { e.preventDefault(); handleMapsLinkChanged(text) }
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void handleMapsLinkGeofence() } }}
                          placeholder="https://maps.app.goo.gl/1Gsfc4xo2wGbpf3k9"
                          className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <button
                        onClick={() => void handleMapsLinkGeofence()}
                        disabled={!mapsLink.trim() || resolvingLink}
                        title="Koordinat biasanya terisi otomatis — tombol ini cadangan"
                        className="px-4 py-2.5 bg-slate-800 text-white text-xs font-bold rounded-xl hover:bg-slate-900 disabled:opacity-40"
                      >
                        {resolvingLink ? 'Memproses…' : 'Isi Otomatis'}
                      </button>
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Tempel URL pendek (maps.app.goo.gl) atau URL penuh Google Maps — koordinat terisi otomatis. Bila gagal,
                      tekan <span className="font-semibold">Isi Otomatis</span> atau isi koordinat manual di bawah.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 block mb-1 flex items-center gap-2">
                        Latitude
                        {coordsFromLink && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            ✓ Terisi Otomatis
                          </span>
                        )}
                      </label>
                      <input
                        value={activeGeofence.latitude}
                        readOnly={!manualCoords}
                        disabled={!manualCoords}
                        inputMode="decimal"
                        onChange={e => setActiveGeofence(prev => prev ? { ...prev, latitude: e.target.value } : null)}
                        placeholder="Tempel link, atau aktifkan isian manual"
                        className={`w-full border rounded-xl px-3 py-2.5 text-xs font-mono ${!manualCoords ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-blue-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'}`}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-slate-600 block mb-1 flex items-center gap-2">
                        Longitude
                        {coordsFromLink && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            ✓ Terisi Otomatis
                          </span>
                        )}
                      </label>
                      <input
                        value={activeGeofence.longitude}
                        readOnly={!manualCoords}
                        disabled={!manualCoords}
                        inputMode="decimal"
                        onChange={e => setActiveGeofence(prev => prev ? { ...prev, longitude: e.target.value } : null)}
                        placeholder="Tempel link, atau aktifkan isian manual"
                        className={`w-full border rounded-xl px-3 py-2.5 text-xs font-mono ${!manualCoords ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-blue-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500'}`}
                      />
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-[11px] text-slate-500 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={manualCoords}
                      onChange={e => setManualCoords(e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    Isi koordinat manual (koreksi bila hasil otomatis kurang tepat)
                  </label>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Nama Lokasi</label>
                    <input
                      value={activeGeofence.locationName}
                      onChange={e => setActiveGeofence(prev => prev ? { ...prev, locationName: e.target.value } : null)}
                      placeholder="cth: Dermaga Badau - Titik A"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Radius (meter) <span className="font-normal text-slate-400">— default 100 meter</span></label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      step={1}
                      value={activeGeofence.radiusMeters}
                      onChange={e => setActiveGeofence(prev => prev ? { ...prev, radiusMeters: e.target.value } : null)}
                      placeholder="100"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">
                      Radius aman zona geofence untuk pengukuran jarak akurat di aplikasi mobile.
                    </p>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-600 block mb-1">Keterangan <span className="font-normal text-slate-400">(opsional)</span></label>
                    <input
                      value={activeGeofence.description}
                      onChange={e => setActiveGeofence(prev => prev ? { ...prev, description: e.target.value } : null)}
                      placeholder="Deskripsi titik geofence..."
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {activeGeofence.latitude && activeGeofence.longitude && !isNaN(parseFloat(activeGeofence.latitude)) && (
                    <div>
                      <iframe
                        title="Preview titik"
                        src={osmEmbeddedMapUrl(parseFloat(activeGeofence.latitude), parseFloat(activeGeofence.longitude))}
                        className="w-full h-40 rounded-xl border border-slate-200"
                        loading="lazy"
                      />
                    </div>
                  )}

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={cancelGeofenceEdit}
                      className="flex-1 py-2.5 text-slate-600 font-semibold text-xs border border-slate-200 rounded-xl hover:bg-slate-100"
                    >
                      Batal
                    </button>
                    <button
                      onClick={() => saveGeofencePoint(getRouteCode())}
                      className="flex-1 py-2.5 bg-blue-600 text-white font-bold text-xs rounded-xl hover:bg-blue-700"
                    >
                      Simpan
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-200">
              {!activeGeofence && (
                <button
                  onClick={startAddGeofence}
                  className="w-full py-3 bg-emerald-600 text-white font-bold text-sm rounded-xl hover:bg-emerald-700 flex items-center justify-center gap-2"
                >
                  <Plus size={16} /> Tambah Titik Geofence
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
