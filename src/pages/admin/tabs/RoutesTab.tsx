import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MapPin, Plus, Pencil, Trash2, X, Link2, ExternalLink, Check, GripVertical } from 'lucide-react'
import { fetchRoutes, fetchDermagas, createRoute, updateRoute, deleteRoute, reorderRoutes } from '../../../services/dermagas'
import { fetchGeofencePointsForRoute, createRouteGeofencePoint, updateGeofenceRule, deleteGeofenceRule } from '../../../services/geofences'
import { isShortMapsLink, parseMapsUrl, resolveMapsShortLink, osmEmbeddedMapUrl, googleMapsLink, type ParsedGeo } from '../../../services/geo'
import { GEOFENCE_ROLE_LABEL, type GeofencePointRole } from '../../../utils/geofenceRole'
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
  /** Baris yang sedang di-drag (drag handle di kolom kiri). */
  const [draggingRouteId, setDraggingRouteId] = useState<string | null>(null)
  /** Baris target saat pointer berada di atasnya. */
  const [dragOverRouteId, setDragOverRouteId] = useState<string | null>(null)

  const [showGeofencePanel, setShowGeofencePanel] = useState(false)
  const [geofencePoints, setGeofencePoints] = useState<GeofencePoint[]>([])
  const [activeGeofence, setActiveGeofence] = useState<GeofencePoint | null>(null)
  const [mapsLink, setMapsLink] = useState('')
  const [resolvingLink, setResolvingLink] = useState(false)

  const [coordsFromLink, setCoordsFromLink] = useState(false)

  const [manualCoords, setManualCoords] = useState(false)
  const [currentRouteForGeofence, setCurrentRouteForGeofence] = useState<RouteRow | null>(null)

  const resolveTimer = useRef<number | null>(null)

  /**
   * Kelompokkan rute berdasarkan Region → Dermaga
   * Agar admin mudah mengedit data tanpa tercampur berdasarkan kode rute
   */
  function groupRoutesByRegionAndDermaga(rows: RouteRow[]): Record<string, Record<string, RouteRow[]>> {
    const grouped: Record<string, Record<string, RouteRow[]>> = {}
    for (const r of rows) {
      const region = r.region_name || r.region_id || 'Tanpa Wilayah'
      const dermaga = r.dermaga_name || r.dermaga_code || 'Tanpa Dermaga'
      if (!grouped[region]) grouped[region] = {}
      if (!grouped[region][dermaga]) grouped[region][dermaga] = []
      grouped[region][dermaga].push(r)
    }
    // Urutkan region berdasarkan nama
    const sorted: Record<string, Record<string, RouteRow[]>> = {}
    Object.keys(grouped).sort().forEach(key => {
      sorted[key] = grouped[key]
      // Urutkan dermaga dalam setiap region
      const dermagaSorted: Record<string, RouteRow[]> = {}
      Object.keys(sorted[key]).sort().forEach(dKey => {
        dermagaSorted[dKey] = sorted[key][dKey]
      })
      sorted[key] = dermagaSorted
    })
    return sorted
  }

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
      distance: '',
      duration: '',
      geofencePoints: [],
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSave = async () => {
    const f = routeForm
    if (!f.name.trim() || !f.route_from.trim() || !f.route_to.trim()) return showToast('Nama, asal, tujuan wajib!', 'error')
    if (!editRouteId && !f.dermaga_id) return showToast('Pilih dermaga!', 'error')
    // Perkiraan jarak & durasi tidak lagi dikelola dari dashboard, tapi nilainya
    // di server tidak boleh hilang saat rute diedit: handler server SELALU
    // menulis `distance: distance || null`, jadi field yang tidak dikirim akan
    // dihapus. Karena itu nilai lama ikut dikirimkan apa adanya.
    const existing = editRouteId ? routeRows.find(r => r.id === editRouteId) : undefined
    const payload = {
      dermaga_id: f.dermaga_id,
      name: f.name.trim(),
      route_from: f.route_from.trim().toUpperCase(),
      route_to: f.route_to.trim().toUpperCase(),
      distance: existing?.distance || undefined,
      duration: existing?.duration || undefined,
    }
    const saved = editRouteId
      ? await updateRoute(editRouteId, payload)
      : await createRoute(payload)
    if (!saved.ok) return showToast(saved.reason ?? 'Rute gagal disimpan karena server menolak permintaan', 'error')
    showToast(editRouteId ? 'Rute diperbarui' : 'Rute ditambahkan')
    resetForm()
    const fresh = await fetchRoutes()
    if (fresh) setRouteRows(fresh as RouteRow[])
  }

  const handleDel = async (id: string) => {
    if (!confirm('Hapus rute ini?')) return
    const res = await deleteRoute(id)
    if (!res.ok) return showToast(res.reason ?? 'Rute gagal dihapus karena server menolak permintaan', 'error')
    if (editRouteId === id) resetForm()
    showToast('Rute dihapus')
    const fresh = await fetchRoutes()
    if (fresh) setRouteRows(fresh as RouteRow[])
  }

  /**
   * Pindahkan rute yang sedang di-drag ke posisi rute target, lalu simpan
   * urutan baru ke server. Hanya boleh di dalam dermaga yang sama — urutan
   * antar dermaga tidak punya arti.
   */
  const handleReorderDrop = async (target: RouteRow) => {
    const sourceId = draggingRouteId
    setDraggingRouteId(null)
    setDragOverRouteId(null)
    if (!sourceId || sourceId === target.id) return

    const source = routeRows.find(r => r.id === sourceId)
    if (!source || source.dermaga_id !== target.dermaga_id) return

    const fromIdx = routeRows.findIndex(r => r.id === sourceId)
    const toIdx = routeRows.findIndex(r => r.id === target.id)
    if (fromIdx < 0 || toIdx < 0) return

    const next = [...routeRows]
    const [moved] = next.splice(fromIdx, 1)
    const insertAt = next.findIndex(r => r.id === target.id)
    next.splice(insertAt, 0, moved)
    setRouteRows(next)

    const ids = next.filter(r => r.dermaga_id === target.dermaga_id).map(r => r.id)
    const res = await reorderRoutes(target.dermaga_id, ids)
    if (!res.ok) {
      showToast(res.reason ?? 'Urutan rute gagal disimpan karena server menolak permintaan', 'error')
      const fresh = await fetchRoutes()
      if (fresh) setRouteRows(fresh as RouteRow[])
      return
    }
    showToast('Urutan rute disimpan')
  }

  const loadGeofencePoints = async (routeCode: string, dermagaId?: string) => {
    if (!routeCode) return
    const points = await fetchGeofencePointsForRoute(routeCode, dermagaId)
    const mapped: GeofencePoint[] = points.map(p => ({
      id: p.id,
      locationName: p.locationName,
      pointType: p.pointType ?? 'both',
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

  const startAddGeofence = (role: GeofencePointRole) => {
    setActiveGeofence({
      id: undefined,
      locationName: '',
      pointType: role,
      latitude: '',
      longitude: '',
      radiusMeters: '100',
      description: '',
    })
    setMapsLink('')
    setCoordsFromLink(false)
    setManualCoords(false)
  }

  // `role` dipakai saat titik lama ('both') diedit dari slot tertentu: setelah
  // disimpan perannya menjadi eksplisit (awal atau tujuan), bukan 'both' lagi.
  const startEditGeofence = (point: GeofencePoint, role?: GeofencePointRole) => {
    setActiveGeofence({ ...point, pointType: role ?? point.pointType })
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
    const { id, locationName, pointType, latitude, longitude, radiusMeters, description } = activeGeofence

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
      pointType,
      latitude: Number(lat),
      longitude: Number(lon),
      radiusMeters: Number(rad),
      description: description.trim(),
    }

    if (id) {
      // Edit titik lama (mis. ubah koordinat): sekalian ikat ke dermaga rute ini
      // supaya data lama yang NULL ikut terrapikan, tanpa pernah mengosongkannya.
      const res = await updateGeofenceRule(id, {
        ...data,
        ...(routeDermagaId ? { dermagaId: routeDermagaId } : {}),
      })
      if (!res.ok) {
        showToast(res.reason ?? 'Titik geofence gagal diperbarui karena server menolak permintaan', 'error')
        return
      }
    } else {
      const res = await createRouteGeofencePoint(routeCode, data, { dermagaId: routeDermagaId })
      if (!res.ok) {
        showToast(res.reason ?? 'Titik geofence gagal ditambahkan karena server menolak permintaan', 'error')
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
    const res = await deleteGeofenceRule(point.id)
    if (!res.ok) {
      showToast(res.reason ?? 'Titik geofence gagal dihapus karena server menolak permintaan', 'error')
      return
    }
    showToast('Titik geofence dihapus')
    await loadGeofencePoints(routeCode, currentRouteForGeofence?.dermaga_id)
  }

  const getRouteCode = () => {
    if (!currentRouteForGeofence) return ''
    return `${currentRouteForGeofence.route_from}-${currentRouteForGeofence.route_to}`
  }

  // Panel geofence hanya punya DUA slot: titik awal dan titik tujuan.
  // Titik lama tanpa peran ('both') ditempatkan ke slot pertama yang kosong
  // supaya tetap bisa diedit/dihapus, bukan disembunyikan.
  const startSlotPoint = geofencePoints.find(p => p.pointType !== 'end')
  const endSlotPoint = geofencePoints.find(p => p.pointType !== 'start' && p !== startSlotPoint)
  const otherGeofencePoints = geofencePoints.filter(p => p !== startSlotPoint && p !== endSlotPoint)
  const geofenceSlotsFull = !!startSlotPoint && !!endSlotPoint

  return (
    <div className="space-y-4">

      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Master Rute</h3>
          <p className="text-slate-500 text-[12px]">Rute per wilayah dan dermaga.</p>
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-4">
          <div className="col-span-2">
            <label className="text-[11px] text-slate-500 block mb-1">Dermaga *</label>
            <select value={routeForm.dermaga_id} onChange={e => setRouteForm({ ...routeForm, dermaga_id: e.target.value })}
              disabled={!!editRouteId} className="w-full border rounded-xl px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">— Pilih Dermaga —</option>
              {routeDermagas.map(d => (
                <option key={d.id} value={d.id}>{d.region_name || d.region_id} · {d.name}</option>
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
        <div className="flex gap-3">
          {editRouteId && <button onClick={resetForm} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>}
          <button onClick={() => void handleSave()}
            className={`${editRouteId ? 'flex-1' : 'w-48'} py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700`}>
            {editRouteId ? 'Update' : 'Tambah Rute'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[1020px] border-collapse text-[13px]">
          <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-2.5 border border-slate-200 text-center w-[44px]" title="Tarik untuk menyusun urutan">
                <GripVertical size={13} className="mx-auto text-slate-400" />
              </th>
              <th className="px-3 py-2.5 border border-slate-200 text-left w-[260px]">Nama Rute</th>
              <th className="px-3 py-2.5 border border-slate-200 text-left w-[120px]">Asal</th>
              <th className="px-3 py-2.5 border border-slate-200 text-left w-[120px]">Tujuan</th>
              <th className="px-3 py-2.5 border border-slate-200 text-right w-[210px]">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {routeRows.length === 0 && (
              <tr><td colSpan={5} className="p-8 text-center text-slate-400">
                {routeState === 'offline' ? 'Offline' : 'Belum ada rute'}
              </td></tr>
            )}
            {/* Kelompokkan berdasarkan Region → Dermaga */}
            {Object.entries(groupRoutesByRegionAndDermaga(routeRows)).map(([regionName, regions]) => (
              <React.Fragment key={regionName}>
                <tr className="bg-slate-800">
                  <td colSpan={5} className="px-3 py-2 border border-slate-700 text-left">
                    <span className="font-bold text-white text-[13px]">{regionName}</span>
                  </td>
                </tr>
                {Object.entries(regions).map(([dermagaName, routes]) => (
                  <React.Fragment key={dermagaName}>
                    <tr className="bg-slate-100">
                      <td colSpan={5} className="px-3 py-2 border border-slate-200 text-left">
                        <span className="font-semibold text-slate-600 text-xs flex items-center gap-2">
                          <span className="w-1 h-1 rounded-full bg-slate-400" />
                          {dermagaName}
                          <span className="text-slate-400 font-normal">({routes.length} rute)</span>
                        </span>
                      </td>
                    </tr>
                    {routes.map((r, rIdx) => (
                      <tr
                        key={r.id}
                        onDragOver={(e) => {
                          if (!draggingRouteId || draggingRouteId === r.id) return
                          const source = routeRows.find(x => x.id === draggingRouteId)
                          if (!source || source.dermaga_id !== r.dermaga_id) return
                          e.preventDefault()
                          e.dataTransfer.dropEffect = 'move'
                          if (dragOverRouteId !== r.id) setDragOverRouteId(r.id)
                        }}
                        onDragLeave={() => setDragOverRouteId(prev => prev === r.id ? null : prev)}
                        onDrop={(e) => { e.preventDefault(); void handleReorderDrop(r) }}
                        className={`admin-table-row ${
                          editRouteId === r.id ? 'bg-blue-50' : `${rIdx % 2 === 1 ? 'bg-slate-50/40' : ''} hover:bg-slate-50/60`
                        } ${
                          dragOverRouteId === r.id ? 'ring-2 ring-inset ring-blue-400' : ''
                        } ${draggingRouteId === r.id ? 'opacity-40' : ''}`}
                      >
                        <td className="px-2 py-2 border border-slate-200 text-center align-middle">
                          <button
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.effectAllowed = 'move'
                              e.dataTransfer.setData('text/plain', r.id)
                              setDraggingRouteId(r.id)
                            }}
                            onDragEnd={() => { setDraggingRouteId(null); setDragOverRouteId(null) }}
                            title="Tarik untuk menyusun urutan rute"
                            aria-label={`Ubah urutan ${r.name}`}
                            className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700 active:cursor-grabbing"
                          >
                            <GripVertical size={15} />
                          </button>
                        </td>
                        <td className="px-3 py-2 border border-slate-200 font-semibold text-slate-800">{r.name}</td>
                        <td className="px-3 py-2 border border-slate-200 font-mono text-slate-600 text-xs whitespace-nowrap">{r.route_from}</td>
                        <td className="px-3 py-2 border border-slate-200 font-mono text-slate-600 text-xs whitespace-nowrap">{r.route_to}</td>
                        <td className="px-3 py-2 border border-slate-200 text-right whitespace-nowrap">
                          <button onClick={() => startEdit(r)} className="text-blue-600 font-semibold text-xs mr-3 hover:underline">Edit</button>
                          <button onClick={() => void openGeofencePanel(r)} className="text-emerald-600 font-semibold text-xs mr-3 hover:underline inline-flex items-center gap-1">
                            <MapPin size={12} /> Geofence
                          </button>
                          <button onClick={() => void handleDel(r.id)} className="text-red-500 font-semibold text-xs hover:underline">Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
        </div>
      </div>

      {showGeofencePanel && createPortal((
        <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">

            <div className="flex items-center justify-between p-6 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                  <MapPin size={20} className="text-emerald-600" />
                </div>
                <div>
                  <h3 className="font-black text-slate-900 text-lg">Titik Geofence</h3>
                  <p className="text-slate-500 text-xs">
                    Rute: <span className="font-mono font-bold text-blue-700">{currentRouteForGeofence?.name || getRouteCode()}</span>
                    {currentRouteForGeofence && (
                      <span className="ml-2 text-emerald-700 font-semibold">({currentRouteForGeofence.route_from} → {currentRouteForGeofence.route_to})</span>
                    )}
                  </p>
                </div>
              </div>
              <button onClick={closeGeofencePanel} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-4">

              <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-snug text-slate-600">
                <span className="font-bold text-slate-800">Titik Awal</span>: mulai trip, kirim, dan edit.{' '}
                <span className="font-bold text-slate-800">Titik Tujuan</span>: kirim saja.
              </p>

              {([
                {
                  role: 'start' as const,
                  title: 'Titik Awal',
                  hint: 'Mulai, kirim, dan edit trip.',
                  point: startSlotPoint,
                },
                {
                  role: 'end' as const,
                  title: 'Titik Tujuan',
                  hint: 'Kirim trip. Edit tidak tersedia.',
                  point: endSlotPoint,
                },
              ]).map(slot => (
                <div
                  key={slot.role}
                  className={`rounded-xl p-4 border ${slot.point ? 'bg-slate-50 border-slate-200' : 'bg-amber-50 border-amber-200'}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{slot.title}</p>
                      <p className="text-[10px] text-slate-400">{slot.hint}</p>
                    </div>
                    {slot.point && (
                      <div className="flex gap-1 shrink-0">
                        <a
                          href={slot.point.latitude && slot.point.longitude ? googleMapsLink(parseFloat(slot.point.latitude), parseFloat(slot.point.longitude)) : '#'}
                          target="_blank"
                          rel="noreferrer"
                          title="Buka di Google Maps"
                          className="p-2 text-slate-400 hover:text-emerald-600 rounded-lg hover:bg-emerald-50"
                        >
                          <ExternalLink size={14} />
                        </a>
                        <button
                          onClick={() => startEditGeofence(slot.point!, slot.role)}
                          title={`Edit ${slot.title}`}
                          className="p-2 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => deleteGeofencePoint(slot.point!, getRouteCode())}
                          title={`Hapus ${slot.title}`}
                          className="p-2 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {slot.point ? (
                    <>
                      <p className="mt-2 font-semibold text-slate-900">{slot.point.locationName}</p>
                      <p className="text-xs text-slate-500 font-mono mt-1">
                        {slot.point.latitude}, {slot.point.longitude} · {slot.point.radiusMeters}m
                      </p>
                      {slot.point.description && (
                        <p className="text-xs text-slate-400 mt-1">{slot.point.description}</p>
                      )}
                      {slot.point.latitude && slot.point.longitude && !isNaN(parseFloat(slot.point.latitude)) && (
                        <div className="mt-2">
                          <iframe
                            title={`Preview ${slot.point.locationName}`}
                            src={osmEmbeddedMapUrl(parseFloat(slot.point.latitude), parseFloat(slot.point.longitude))}
                            className="w-full h-32 rounded-lg border border-slate-200"
                            loading="lazy"
                          />
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-amber-800">
                      Belum diatur — petugas tidak bisa {slot.role === 'end' ? 'mengirim trip' : 'memulai trip'}.
                    </p>
                  )}
                </div>
              ))}

              {otherGeofencePoints.length > 0 && (
                <div className="rounded-xl border border-slate-200 p-3">
                  <p className="text-[11px] font-semibold text-slate-500 mb-1">Titik tambahan</p>
                  {otherGeofencePoints.map((point, idx) => (
                    <div key={point.id || idx} className="flex items-center justify-between gap-2 py-1">
                      <p className="text-xs text-slate-700 truncate">
                        {point.locationName}{' '}
                        <span className="text-slate-400 font-mono">{point.latitude}, {point.longitude}</span>
                      </p>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => startEditGeofence(point)}
                          title="Edit titik"
                          className="p-1.5 text-slate-400 hover:text-blue-600 rounded-lg hover:bg-blue-50"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={() => deleteGeofencePoint(point, getRouteCode())}
                          title="Hapus titik"
                          className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-400 mt-1">
                    Tidak dipakai di alur awal/tujuan. Hapus bila tidak perlu.
                  </p>
                </div>
              )}

              {activeGeofence !== null && (
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200 space-y-4">
                  <h4 className="font-bold text-blue-900 text-sm">
                    {activeGeofence.id ? 'Edit ' : 'Tambah '}
                    {activeGeofence.pointType === 'end'
                      ? 'Titik Tujuan'
                      : activeGeofence.pointType === 'start'
                        ? 'Titik Awal'
                        : 'Titik'}
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
                      Tempel link Google Maps — koordinat terisi otomatis.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-slate-600 block mb-1 flex items-center gap-2">
                        Latitude
                        {coordsFromLink && (
                          <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-full">
                            <Check size={11} /> Terisi Otomatis
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
                            <Check size={11} /> Terisi Otomatis
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

                  <div className={`rounded-xl border px-3 py-2.5 text-[11px] leading-snug ${
                    activeGeofence.pointType === 'end'
                      ? 'border-amber-200 bg-amber-50 text-amber-800'
                      : activeGeofence.pointType === 'start'
                        ? 'border-blue-200 bg-blue-50 text-blue-800'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                  }`}>
                    <p className="font-bold">{GEOFENCE_ROLE_LABEL[activeGeofence.pointType]}</p>
                    <p className="mt-0.5">
                      {activeGeofence.pointType === 'end'
                        ? 'Dipakai saat petugas submit trip (mis. SBDZ).'
                        : activeGeofence.pointType === 'start'
                          ? 'Dipakai saat petugas input kendaraan (mis. SJRE).'
                          : 'Titik tambahan. Atur ulang sebagai awal atau tujuan.'}
                    </p>
                  </div>

                  <div>                      <label className="text-xs font-semibold text-slate-600 block mb-1">Radius (meter) <span className="font-normal text-slate-400">— bawaan 100</span></label>
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
                      Jarak toleransi dari titik ini.
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
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <button
                      onClick={() => startAddGeofence('start')}
                      disabled={!!startSlotPoint}
                      title={startSlotPoint ? 'Titik awal sudah ada — klik ikon pensil untuk mengubahnya' : 'Tambah titik awal'}
                      className="py-3 bg-blue-600 text-white font-bold text-sm rounded-xl hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Plus size={16} /> Tambah Titik Awal
                    </button>
                    <button
                      onClick={() => startAddGeofence('end')}
                      disabled={!!endSlotPoint}
                      title={endSlotPoint ? 'Titik tujuan sudah ada — klik ikon pensil untuk mengubahnya' : 'Tambah titik tujuan'}
                      className="py-3 bg-emerald-600 text-white font-bold text-sm rounded-xl hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      <Plus size={16} /> Tambah Titik Tujuan
                    </button>
                  </div>
                  <p className="text-center text-[10px] text-slate-400 mt-2">
                    {geofenceSlotsFull
                      ? 'Titik awal dan tujuan sudah diatur. Klik pensil untuk mengubah.'
                      : 'Rute ini hanya memakai dua titik: awal dan tujuan.'}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      ), document.body)}
    </div>
  )
}
