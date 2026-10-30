import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calendar, Download, ExternalLink, Image as ImageIcon, MapPin, RefreshCw, Search, Table2, X } from 'lucide-react'
import { ensureAdminSession } from '../../services/auth'
import {
  fetchTripReports,
  fetchReportFilters,
  formatReportDateTime,
  dayKeyWib,
  reportPlace,
  reportAsal,
  reportTujuan,
  reportRentang,
  reportGolongan,
  tarifSourceLabel,
  OPERATIONAL_CATEGORIES,
  type ReportTrip,
  type ReportVehicle,
  type ReportFilters,
  type ReportFilterOptions,
} from '../../services/trips'
import { downloadXlsx } from '../../services/xlsx'
import { environment } from '../../environments/environment'
import { resolvePhotoUrl } from './components/PhotoViewer'
import { fetchGeofenceRules, type GeofenceRule } from '../../services/geofences'
import { locationDistanceText, nearestGeofence } from '../../services/locationDistance'



const fmtRp = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`
const fotoUrl = (path: string | null | undefined) => {
  if (!path) return null
  return resolvePhotoUrl(path, environment.apiBaseUrl)
}

const fmtCoords = (lat?: number | null, lng?: number | null) => {
  if (!lat || !lng) return null
  return { lat: Number(lat).toFixed(5), lng: Number(lng).toFixed(5), gmaps: `https://www.google.com/maps?q=${lat},${lng}` }
}

type LocCell = { dist: string | null; lat: string; lng: string; gmaps: string; tooltip?: string }



const ThumbnailCell = ({ foto_path, no_trip, label }: { foto_path: string | null | undefined; no_trip: string; label?: string }) => {
  const url = fotoUrl(foto_path)
  const [open, setOpen] = useState(false)
  if (!url) return <span className="text-slate-300 italic text-[11px]">-</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-7 h-7 rounded border border-slate-200 overflow-hidden hover:ring-2 hover:ring-blue-400 transition-all shrink-0 bg-slate-50"
        title="Lihat foto kendaraan"
      >
        <img src={url} alt="kendaraan" className="w-full h-full object-cover" loading="lazy" />
      </button>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:text-blue-700 transition-colors"
        title="Buka di tab baru"
      >
        <ExternalLink size={12} />
      </a>
      {/*
        Pratinjau foto HARUS lewat portal ke <body>. Kalau dirender di tempat,
        modal ini berada di dalam <td> pada kartu tabel yang memakai
        overflow-hidden + z-index rendah, sehingga foto bisa terpotong atau
        tertutup kartu di sekitarnya (dan body scroll ikut bergeser).
      */}
      {open && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Dokumentasi ${label ?? 'Kendaraan'} ${no_trip}`}
          className="fixed inset-0 z-[10000] flex items-center justify-center overflow-y-auto bg-black/85 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative flex w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2 bg-slate-800 text-white text-xs font-semibold">
              <span className="flex items-center gap-2">
                <ImageIcon size={13} /> Dokumentasi {label ? ` - ${label}` : 'Kendaraan'}
              </span>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/20 rounded"><X size={14} /></button>
            </div>
            <div className="bg-slate-900 p-2 flex items-center justify-center">
              <img src={url} alt="kendaraan" className="block h-auto max-h-[65vh] w-auto max-w-full object-contain rounded-lg" />
            </div>
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-mono">Trip: {no_trip}{label ? ` - ${label}` : ''}</span>
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline flex items-center gap-1">
                <ExternalLink size={11} /> Buka Asli
              </a>
            </div>
          </div>
        </div>,
        document.body
      )}
    </span>
  )
}

type LoadState = 'loading' | 'ready' | 'offline'



// Auto-refresh laporan.
// 15 detik terlalu agresif: satu query laporan menarik hingga 1.000 trip +
// kendaraan + tarif, jadi satu tab admin yang terbuka saja bisa menghabiskan
// kuota egress proyek (sudah lewat 131% di siklus ini). 5 menit + refresh
// seketika saat tab kembali kelihatan tetap terasa "live" untuk operasional.
const AUTO_REFRESH_MS = 300_000

// Kolom tabel datar: satu baris untuk satu unit kendaraan, tanpa nomor urut dan
// tanpa kolom Unit (jenis kendaraan dan nomor polisi sudah mewakili unit tersebut).
const COLUMNS = [
  { key: 'noTrip', label: 'No Trip' },
  { key: 'tanggal', label: 'Tanggal' },
  { key: 'jam', label: 'Jam (WIB)' },
  { key: 'tempat', label: 'Tempat / Wilayah' },
  { key: 'asal', label: 'Rute Asal' },
  { key: 'tujuan', label: 'Rute Tujuan' },
  { key: 'petugas', label: 'Petugas' },
  { key: 'polisi', label: 'No. Polisi' },
  { key: 'jenis', label: 'Jenis Kendaraan' },
  { key: 'golongan', label: 'Golongan' },
  { key: 'muatan', label: 'Status Muatan' },
  { key: 'tarif', label: 'Tarif (Rp)' },
  { key: 'foto', label: 'Foto' },
  { key: 'lokasi', label: 'Lokasi' },
] as const

const STATUS_MUATAN = [
  { value: '', label: 'Semua' },
  { value: 'ada', label: 'Ada Muatan' },
  { value: 'tanpa', label: 'Tanpa Muatan' },
]

// Baris kendaraan: rincian satu unit di dalam sebuah trip (tampilan datar/itemized).
type VehicleRow = {
  trip: ReportTrip
  vehicle: ReportVehicle
  dateKey: string
  date: string
  time: string
  category: string
  tarif: number
  loc: LocCell | null
  /** Baris pertama dari trip ini, dipakai untuk menampilkan bukti foto trip. */
  firstOfTrip: boolean
}

// Pengelompokan baris berdasarkan tanggal, bukan per trip.
type DateGroup = {
  key: string
  label: string
  rows: VehicleRow[]
  tripCount: number
  vehicleCount: number
  revenue: number
}

export default function ReportSheet() {
  const [rows, setRows] = useState<ReportTrip[]>([])
  const [filters, setFilters] = useState<ReportFilters>({})
  const [options, setOptions] = useState<ReportFilterOptions>({ golongan: [], vehicleTypes: [] })
  const [searchText, setSearchText] = useState('')

  const [geoRules, setGeoRules] = useState<GeofenceRule[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [lastSync, setLastSync] = useState('')
  const [tick, setTick] = useState(0)
  const alive = useRef(true)

  const load = useCallback(async (f: ReportFilters) => {
    setState(s => (s === 'ready' ? s : 'loading'))
    const sess = await ensureAdminSession()
    if (!alive.current) return
    if (!sess.ok) { setState('offline'); return }
    const [data, opts] = await Promise.all([fetchTripReports(f), fetchReportFilters()])
    if (!alive.current) return
    if (data === null) { setState('offline'); return }
    setRows(data)
    if (opts) setOptions(opts)
    setState('ready')
    setLastSync(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
  }, [])

  useEffect(() => {
    alive.current = true
    fetchGeofenceRules().then(rules => {
      if (alive.current && rules) setGeoRules(rules)
    }).catch(() => null)
    return () => { alive.current = false }
  }, [])

  useEffect(() => {
    alive.current = true
    void load(filters)
    const id = setInterval(() => {
      // Jangan refresh saat tab tidak terlihat: query laporan itu berat (hingga
      // 1.000 trip + kendaraan + tarif) dan membanjiri egress tiap 15 detik.
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      setTick(t => t + 1)
      void load(filters)
    }, AUTO_REFRESH_MS)
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      setTick(t => t + 1)
      void load(filters)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [filters, load])

  // Pencarian diketik dengan jeda agar tidak membebani server tiap ketikan.
  useEffect(() => {
    const term = searchText.trim()
    const id = setTimeout(() => {
      setFilters(prev => (prev.q === (term || undefined) ? prev : { ...prev, q: term || undefined }))
    }, 400)
    return () => clearTimeout(id)
  }, [searchText])

  const apply = (patch: ReportFilters) => setFilters(prev => ({ ...prev, ...patch }))

  const golonganOptions = options.golongan.length > 0 ? options.golongan : OPERATIONAL_CATEGORIES

  // Seluruh unit kendaraan dijadikan baris datar (itemized row), lalu dikelompokkan per tanggal.
  const dateGroups = useMemo<DateGroup[]>(() => {
    const byDate = new Map<string, VehicleRow[]>()
    const tripsByDate = new Map<string, Set<string>>()

    for (const trip of rows) {
      const vehicles = trip.vehicles ?? []
      if (vehicles.length === 0) continue

      const stamp = formatReportDateTime(trip.created_at)
      const key = dayKeyWib(trip.created_at)
      const bucket = byDate.get(key) ?? []
      const tripIds = tripsByDate.get(key) ?? new Set<string>()
      tripIds.add(trip.id)
      tripsByDate.set(key, tripIds)

      vehicles.forEach((vehicle, index) => {
        const base = fmtCoords(vehicle.latitude, vehicle.longitude)
        const nearest = nearestGeofence({ latitude: vehicle.latitude, longitude: vehicle.longitude }, geoRules)
        bucket.push({
          trip,
          vehicle,
          dateKey: key,
          date: stamp.date,
          time: stamp.time,
          category: reportGolongan(vehicle),
          tarif: Number(vehicle.tariff_amount || 0),
          loc: base && {
            dist: locationDistanceText({ latitude: vehicle.latitude, longitude: vehicle.longitude }, geoRules),
            lat: base.lat,
            lng: base.lng,
            gmaps: base.gmaps,
            tooltip: nearest
              ? `${base.lat}, ${base.lng} - titik: ${nearest.pointName} (${nearest.pointLat}, ${nearest.pointLng})`
              : `${base.lat}, ${base.lng}`,
          },
          firstOfTrip: index === 0,
        })
      })

      byDate.set(key, bucket)
    }

    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, list]) => {
        list.sort((a, b) => b.trip.created_at.localeCompare(a.trip.created_at)
          || a.vehicle.no_polisi.localeCompare(b.vehicle.no_polisi))
        const parsed = new Date(`${key}T00:00:00`)
        return {
          key,
          label: Number.isNaN(parsed.getTime())
            ? key
            : parsed.toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }),
          rows: list,
          tripCount: tripsByDate.get(key)?.size ?? 0,
          vehicleCount: list.length,
          revenue: list.reduce((sum, row) => sum + row.tarif, 0),
        }
      })
  }, [rows, geoRules])

  const vehicleRows = useMemo(() => dateGroups.flatMap(g => g.rows), [dateGroups])

  const totalTrip = dateGroups.reduce((n, g) => n + g.tripCount, 0)
  const totalUnit = vehicleRows.length
  const totalRevenue = vehicleRows.reduce((s, r) => s + r.tarif, 0)

  const buildSheets = () => {
    const now = new Date()

    const meta: (string | number | null)[][] = [
      ['Laporan Spreadsheet Trip dan Detail Kendaraan'],
      ['Dicetak', now.toLocaleString('id-ID')],
      ['Rentang Tanggal', reportRentang(filters)],
      ['Pencarian', filters.q || 'Semua'],
      ['Filter Golongan', filters.golongan || 'Semua'],
      ['Filter Jenis Kendaraan', filters.vehicleType || 'Semua'],
      ['Filter Status Muatan', filters.muatan === 'ada' ? 'Ada Muatan' : filters.muatan === 'tanpa' ? 'Tanpa Muatan' : 'Semua'],
      ['Sinkron Terakhir', lastSync],
      ['Jumlah Trip', totalTrip],
      ['Jumlah Unit', totalUnit],
      [],
    ]

    // Satu baris untuk satu unit kendaraan, urut per tanggal seperti tampilan tabel.
    const body: (string | number | null)[][] = vehicleRows.map(r => [
      r.trip.no_trip,
      r.date,
      r.time,
      reportPlace(r.trip),
      reportAsal(r.trip),
      reportTujuan(r.trip),
      r.trip.officer_name || '-',
      r.vehicle.no_polisi,
      r.vehicle.vehicle_type || '-',
      r.category,
      Number(r.vehicle.has_load) > 0 ? 'Ada Muatan' : 'Tanpa Muatan',
      r.tarif,
      fotoUrl(r.vehicle.foto_path) || null,
      r.loc ? (r.loc.dist || `${r.loc.lat}, ${r.loc.lng}`) : null,
    ])

    const header = COLUMNS.map(c => c.label)
    return [
      {
        name: 'Laporan Trip dan Kendaraan',
        rows: [
          ...meta,
          header,
          ...body,
          [],
          ['TOTAL', `${totalTrip} trip - ${totalUnit} unit`, '', '', '', '', '', '', '', '', '', totalRevenue, '', ''],
        ],
      },
    ]
  }

  const presets = [{ label: 'Hari Ini', days: 1 }, { label: '7 Hari', days: 7 }, { label: '30 Hari', days: 30 }]
  const applyPreset = (days: number) => {
    const end = new Date()
    const start = new Date(Date.now() - (days - 1) * 86400000)
    const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    apply({ startDate: key(start), endDate: key(end) })
  }

  const resetFilters = () => {
    setSearchText('')
    setFilters({})
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">

      <header className="sticky top-0 z-30 bg-white border border-slate-200 shadow-sm">
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
          <span className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Table2 size={17} />
          </span>
          <div className="mr-auto">
            <h1 className="font-extrabold text-slate-900 text-[15px] leading-tight">Laporan Spreadsheet</h1>
            <p className="text-[11px] text-slate-400">
              Satu baris untuk satu unit kendaraan, dikelompokkan per tanggal - refresh otomatis tiap 15 detik
              {lastSync && <> - terakhir {lastSync} WIB</>}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
            state === 'ready' ? 'border-slate-200 text-slate-600'
            : state === 'offline' ? 'border-amber-200 text-amber-700' : 'border-slate-200 text-slate-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              state === 'ready' ? 'bg-emerald-500' : state === 'offline' ? 'bg-amber-500' : 'bg-slate-400 animate-pulse'
            }`} />
            {state === 'ready' ? 'Connected' : state === 'offline' ? 'Offline' : 'Connecting...'}
          </span>
          <button onClick={() => void load(filters)} disabled={state === 'loading'}
            className="border border-slate-200 text-slate-700 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={14} className={state === 'loading' ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => { window.location.hash = '#/sheet/rekap' }}
            disabled={state !== 'ready'}
            title="Buka rekap per golongan dan jenis kendaraan"
            className="bg-blue-600 text-white px-3.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50">
            <Table2 size={15} /> Rekap
          </button>
          <button onClick={() => downloadXlsx(`laporan-trip-${new Date().toISOString().slice(0, 10)}.xlsx`, buildSheets())}
            disabled={state !== 'ready' || vehicleRows.length === 0}
            className="border border-slate-200 text-slate-700 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
            <Download size={15} /> .xlsx
          </button>
          <button onClick={() => { window.location.hash = '' }}
            className="border border-slate-200 text-slate-500 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-slate-50"
            title="Kembali ke dashboard (tab ini bisa ditutup)">
            <X size={15} /> Tutup
          </button>
        </div>

        <div className="px-5 pb-3 flex flex-wrap items-end gap-3">
          <label className="text-[11px] font-bold text-slate-500">
            Dari
            <input type="date" value={filters.startDate || ''} onChange={e => apply({ startDate: e.target.value || undefined, ...(e.target.value ? {} : { endDate: undefined }) })}
              className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white" />
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Sampai
            <input type="date" value={filters.endDate || ''} onChange={e => apply({ endDate: e.target.value || undefined, ...(e.target.value ? {} : { startDate: undefined }) })}
              className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white" />
          </label>
          <div className="flex gap-1.5">
            {presets.map(p => (
              <button key={p.label} onClick={() => applyPreset(p.days)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-500 hover:bg-white">
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-[11px] font-bold text-slate-500">
            Pencarian
            <span className="block mt-1 relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="No trip, plat, petugas, rute"
                className="border rounded-lg pl-8 pr-3 py-1.5 text-sm bg-white min-w-[230px]"
              />
            </span>
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Golongan
            <select value={filters.golongan || ''} onChange={e => apply({ golongan: e.target.value || undefined })}
              className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white min-w-[130px]">
              <option value="">Semua</option>
              {golonganOptions.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Jenis Kendaraan
            <select value={filters.vehicleType || ''} onChange={e => apply({ vehicleType: e.target.value || undefined })}
              className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white min-w-[150px]">
              <option value="">Semua</option>
              {options.vehicleTypes.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-bold text-slate-500">
            Status Muatan
            <select value={filters.muatan || ''} onChange={e => apply({ muatan: (e.target.value || undefined) as ReportFilters['muatan'] })}
              className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white min-w-[150px]">
              {STATUS_MUATAN.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <button onClick={resetFilters}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold text-xs hover:bg-white">
            Reset
          </button>
          <span className="ml-auto text-[11px] text-slate-400 font-semibold self-center">Sinkron ke-{tick + 1}</span>
        </div>
      </header>

      <main className="p-5">
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full border-collapse text-[13px] min-w-[1500px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                  {COLUMNS.map(c => (
                    <th key={c.key} className={`px-3 py-2.5 border border-slate-200 bg-slate-100 ${
                      c.key === 'tarif' ? 'text-right'
                      : c.key === 'foto' ? 'text-center w-28'
                      : 'text-left'
                    }`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state === 'offline' ? (
                  <tr><td colSpan={COLUMNS.length} className="p-10 text-center text-slate-400">Tidak tersambung ke server</td></tr>
                ) : state === 'loading' && rows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="p-10 text-center text-slate-400 animate-pulse">Memuat laporan...</td></tr>
                ) : dateGroups.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="p-10 text-center text-slate-400">Tidak ada data pada filter ini</td></tr>
                ) : dateGroups.map(group => (
                  <Fragment key={`date-${group.key}`}>
                    <tr className="bg-slate-800 text-white">
                      <td colSpan={8} className="px-3 py-2.5 border border-slate-700">
                        <span className="flex items-center gap-1.5 font-bold text-sm">
                          <Calendar size={13} className="text-slate-400" />
                          {group.label}
                        </span>
                        <span className="ml-3 text-[11px] font-normal text-slate-300">
                          {group.tripCount} trip - {group.vehicleCount} unit
                        </span>
                      </td>
                      <td colSpan={3} className="px-3 py-2.5 border border-slate-700 text-right text-[11px] font-semibold uppercase tracking-wide text-slate-300">
                        Subtotal
                      </td>
                      <td className="px-3 py-2.5 border border-slate-700 text-right font-black tabular-nums">
                        {fmtRp(group.revenue)}
                      </td>
                      <td colSpan={2} className="border border-slate-700" />
                    </tr>
                    {group.rows.map((r, idx) => {
                      const v = r.vehicle
                      const hasLoad = Number(v.has_load) > 0
                      return (
                        <tr key={`veh-${r.trip.id}-${v.id}`} className={idx % 2 === 1 ? 'bg-white' : 'bg-slate-50/40'}>
                          <td className="px-3 py-2 border border-slate-200 font-mono text-[11px] font-semibold text-slate-700 whitespace-nowrap">{r.trip.no_trip}</td>
                          <td className="px-3 py-2 border border-slate-200 text-[11px] text-slate-500 whitespace-nowrap">{r.date}</td>
                          <td className="px-3 py-2 border border-slate-200 text-[11px] text-slate-500 tabular-nums whitespace-nowrap">{r.time}</td>
                          <td className="px-3 py-2 border border-slate-200 text-slate-700">{reportPlace(r.trip)}</td>
                          <td className="px-3 py-2 border border-slate-200 text-slate-700">{reportAsal(r.trip)}</td>
                          <td className="px-3 py-2 border border-slate-200 text-slate-700">{reportTujuan(r.trip)}</td>
                          <td className="px-3 py-2 border border-slate-200 text-slate-700">{r.trip.officer_name || '-'}</td>
                          <td className="px-3 py-2 border border-slate-200 font-semibold text-slate-800 whitespace-nowrap">{v.no_polisi}</td>
                          <td className="px-3 py-2 border border-slate-200 text-slate-700">{v.vehicle_type || '-'}</td>
                          <td className="px-3 py-2 border border-slate-200">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border border-slate-300 bg-white text-slate-700">
                              {r.category}
                            </span>
                          </td>
                          <td className="px-3 py-2 border border-slate-200">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                              hasLoad
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : 'border-slate-200 bg-white text-slate-500'
                            }`}>
                              {hasLoad ? 'Ada Muatan' : 'Tanpa Muatan'}
                            </span>
                          </td>
                          <td className="px-3 py-2 border border-slate-200 text-right">
                            <span className="block font-bold text-slate-900 tabular-nums">{fmtRp(r.tarif)}</span>
                            <span className="block text-[10px] text-slate-400">{tarifSourceLabel(v.tarif_source)}</span>
                          </td>
                          <td className="px-3 py-2 border border-slate-200 text-center">
                            <div className="flex flex-col items-center gap-1">
                              <ThumbnailCell foto_path={v.foto_path} no_trip={r.trip.no_trip} label={v.no_polisi} />
                            </div>
                          </td>
                          <td className="px-3 py-2 border border-slate-200">
                            {r.loc ? (
                              <a
                                href={r.loc.gmaps}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-700 hover:underline"
                                title={r.loc.tooltip || `${r.loc.lat}, ${r.loc.lng}`}
                              >
                                <MapPin size={11} />
                                {r.loc.dist || `${r.loc.lat}, ${r.loc.lng}`}
                              </a>
                            ) : (
                              <span className="text-slate-300 italic text-[11px]">-</span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </Fragment>
                ))}
              </tbody>
              {vehicleRows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-700">
                    <td colSpan={7} className="px-3 py-3 border border-slate-300 text-[12px]">
                      TOTAL {totalTrip} trip - {totalUnit} unit
                    </td>
                    <td colSpan={4} className="border border-slate-300" />
                    <td className="px-3 py-3 border border-slate-300 text-right font-black text-slate-900 tabular-nums">
                      {fmtRp(totalRevenue)}
                    </td>
                    <td colSpan={2} className="border border-slate-300" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1.5">
          <ExternalLink size={12} />
          Data diambil langsung dari database. Tombol Rekap menampilkan ringkasan per golongan dan jenis kendaraan.
        </p>
      </main>
    </div>
  )
}
