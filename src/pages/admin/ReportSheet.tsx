import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ClipboardCopy, Download, ExternalLink, Image as ImageIcon, MapPin, RefreshCw, Search, Table2, X } from 'lucide-react'
import { ensureAdminSession } from '../../services/auth'
import {
  fetchTripReports,
  fetchReportFilters,
  formatReportDateTime,
  vehicleUnitLabel,
  reportPlace,
  reportAsal,
  reportTujuan,
  reportRentang,
  reportGolongan,
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
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setOpen(false)}>
          <div className="relative max-w-2xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-2 bg-slate-800 text-white text-xs font-semibold">
              <span className="flex items-center gap-2">
                <ImageIcon size={13} /> Dokumentasi {label ? ` - ${label}` : 'Kendaraan'}
              </span>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/20 rounded"><X size={14} /></button>
            </div>
            <div className="bg-slate-900 p-2 flex items-center justify-center">
              <img src={url} alt="kendaraan" className="max-h-[65vh] w-auto object-contain rounded-lg" />
            </div>
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-mono">Trip: {no_trip}{label ? ` - ${label}` : ''}</span>
              <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline flex items-center gap-1">
                <ExternalLink size={11} /> Buka Asli
              </a>
            </div>
          </div>
        </div>
      )}
    </span>
  )
}

// Komponen untuk menampilkan seluruh foto dokumentasi sebuah trip
const AllPhotosCell = ({ photos, no_trip, vehicleCount }: { photos?: string[]; no_trip: string; vehicleCount: number }) => {
  const [open, setOpen] = useState(false)
  const validPhotos = photos?.filter(Boolean) ?? []
  if (validPhotos.length === 0) return <span className="text-slate-300 italic text-[11px]">-</span>

  const tripPhoto = validPhotos[0]
  const vehiclePhotos = validPhotos.slice(1)

  return (
    <span className="inline-flex items-center gap-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-700 text-[11px] font-semibold hover:bg-blue-100 transition-colors"
        title={`Lihat ${validPhotos.length} foto dokumentasi`}
      >
        <ImageIcon size={11} />
        {validPhotos.length} Foto
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setOpen(false)}>
          <div className="relative max-w-4xl w-full bg-white rounded-2xl shadow-2xl overflow-hidden my-8" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 bg-slate-800 text-white">
              <span className="flex items-center gap-2 font-semibold text-sm">
                <ImageIcon size={14} /> Dokumentasi Lengkap Trip {no_trip}
              </span>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/20 rounded">
                <X size={16} />
              </button>
            </div>

            {/* Foto bukti trip */}
            {tripPhoto && (
              <div className="border-b border-slate-200">
                <div className="px-4 py-2 bg-amber-50 text-amber-800 text-[11px] font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  Foto Bukti Trip (Konfirmasi {validPhotos.length > 1 ? `${vehicleCount} Kendaraan` : ''})
                </div>
                <div className="bg-slate-900 p-3 flex items-center justify-center">
                  <img src={fotoUrl(tripPhoto)!} alt="foto bukti trip" className="max-h-[50vh] w-auto object-contain rounded-lg" />
                </div>
              </div>
            )}

            {/* Foto kendaraan */}
            {vehiclePhotos.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-slate-100 text-slate-700 text-[11px] font-bold flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-500" />
                  Foto Dokumentasi Kendaraan ({vehiclePhotos.length} unit)
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 bg-slate-50">
                  {vehiclePhotos.map((photo, idx) => (
                    <div key={idx} className="relative rounded-lg overflow-hidden border border-slate-200 bg-white">
                      <img
                        src={fotoUrl(photo)!}
                        alt={`kendaraan ${idx + 1}`}
                        className="w-full h-32 object-cover cursor-pointer hover:opacity-90 transition-opacity"
                        onClick={() => window.open(fotoUrl(photo)!, '_blank')}
                      />
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1">
                        <span className="text-white text-[10px] font-semibold">Kendaraan {idx + 1}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-mono">Total: {validPhotos.length} foto dokumentasi</span>
              <a href={fotoUrl(validPhotos[0])!} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline flex items-center gap-1">
                <ExternalLink size={11} /> Buka Foto Pertama
              </a>
            </div>
          </div>
        </div>
      )}
    </span>
  )
}

type LoadState = 'loading' | 'ready' | 'offline'



const AUTO_REFRESH_MS = 15_000

// Kolom tabel gabungan: rekap trip dan rincian kendaraan dalam satu tabel.
const COLUMNS = [
  { key: 'no', label: '#' },
  { key: 'noTrip', label: 'No Trip' },
  { key: 'tanggal', label: 'Tanggal' },
  { key: 'jam', label: 'Jam (WIB)' },
  { key: 'tempat', label: 'Tempat / Wilayah' },
  { key: 'asal', label: 'Rute Asal' },
  { key: 'tujuan', label: 'Rute Tujuan' },
  { key: 'petugas', label: 'Petugas' },
  { key: 'polisi', label: 'No. Polisi' },
  { key: 'unit', label: 'Unit' },
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

// Baris trip: rekap satu perjalanan beserta rincian kategori dan totalannya.
type TripRow = {
  kind: 'trip'
  trip: ReportTrip
  date: string
  time: string
  unitCount: number
  revenue: number
  categorySummary: string
  typeSummary: string
  photos: string[]
}

// Baris kendaraan: rincian satu unit di dalam sebuah trip.
type VehicleRow = {
  kind: 'vehicle'
  no: number
  trip: ReportTrip
  vehicle: ReportVehicle
  unit: string
  category: string
  tarif: number
  loc: LocCell | null
}

type TableRow = TripRow | VehicleRow

export default function ReportSheet() {
  const [rows, setRows] = useState<ReportTrip[]>([])
  const [filters, setFilters] = useState<ReportFilters>({})
  const [options, setOptions] = useState<ReportFilterOptions>({ golongan: [], vehicleTypes: [] })
  const [searchText, setSearchText] = useState('')

  const [geoRules, setGeoRules] = useState<GeofenceRule[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [lastSync, setLastSync] = useState('')
  const [tick, setTick] = useState(0)
  const [copied, setCopied] = useState(false)
  const alive = useRef(true)

  const load = useCallback(async (f: ReportFilters) => {
    setState(s => (s === 'ready' ? s : 'loading'))
    const ok = await ensureAdminSession()
    if (!alive.current) return
    if (!ok) { setState('offline'); return }
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
    const id = setInterval(() => { setTick(t => t + 1); void load(filters) }, AUTO_REFRESH_MS)
    return () => { alive.current = false; clearInterval(id) }
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

  // Trip yang tetap punya kendaraan setelah filter, beserta rinciannya.
  const tripGroups = useMemo(() => {
    return rows
      .filter(t => (t.vehicles?.length ?? 0) > 0)
      .map(t => {
        const d = formatReportDateTime(t.created_at)
        const vehicles = t.vehicles ?? []
        const categoryCount = new Map<string, number>()
        const typeSet = new Set<string>()
        let revenue = 0
        for (const v of vehicles) {
          const cat = reportGolongan(v)
          categoryCount.set(cat, (categoryCount.get(cat) ?? 0) + 1)
          if (v.vehicle_type) typeSet.add(v.vehicle_type)
          revenue += Number(v.tariff_amount || 0)
        }
        const categorySummary = [...categoryCount.entries()]
          .map(([cat, n]) => `${n} ${cat}`)
          .join(', ') || '-'
        const typeSummary = typeSet.size === 0
          ? '-'
          : typeSet.size === 1
            ? [...typeSet][0]
            : `${typeSet.size} jenis`
        return { trip: t, date: d.date, time: d.time, vehicles, revenue, categorySummary, typeSummary }
      })
  }, [rows])

  const tableRows = useMemo<TableRow[]>(() => {
    const out: TableRow[] = []
    let no = 0
    for (const g of tripGroups) {
      out.push({
        kind: 'trip',
        trip: g.trip,
        date: g.date,
        time: g.time,
        unitCount: g.vehicles.length,
        revenue: g.revenue,
        categorySummary: g.categorySummary,
        typeSummary: g.typeSummary,
        photos: g.trip.all_photos ?? [],
      })
      for (const v of g.vehicles) {
        const base = fmtCoords(v.latitude, v.longitude)
        const nd = nearestGeofence({ latitude: v.latitude, longitude: v.longitude }, geoRules)
        const loc: LocCell | null = base && {
          dist: locationDistanceText({ latitude: v.latitude, longitude: v.longitude }, geoRules),
          lat: base.lat,
          lng: base.lng,
          gmaps: base.gmaps,
          tooltip: nd ? `${base.lat}, ${base.lng} - titik: ${nd.pointName} (${nd.pointLat}, ${nd.pointLng})` : `${base.lat}, ${base.lng}`,
        }
        out.push({
          kind: 'vehicle',
          no: ++no,
          trip: g.trip,
          vehicle: v,
          unit: vehicleUnitLabel(g.vehicles, v),
          category: reportGolongan(v),
          tarif: Number(v.tariff_amount || 0),
          loc,
        })
      }
    }
    return out
  }, [tripGroups, geoRules])

  const vehicleRows = useMemo(() => tableRows.filter((r): r is VehicleRow => r.kind === 'vehicle'), [tableRows])

  const totalTrip = tripGroups.length
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

    const body: (string | number | null)[][] = []
    for (const g of tripGroups) {
      body.push([
        '', g.trip.no_trip, g.date, g.time, reportPlace(g.trip), reportAsal(g.trip), reportTujuan(g.trip),
        g.trip.officer_name || '-', '', `${g.vehicles.length} unit`, g.typeSummary, g.categorySummary,
        g.trip.status_muatan === 'muatan' ? 'Ada Muatan' : 'Tanpa Muatan', g.revenue,
        g.trip.all_photos?.length ? `${g.trip.all_photos.length} foto` : null, '',
      ])
      for (const v of g.vehicles) {
        const row = vehicleRows.find(r => r.kind === 'vehicle' && r.trip.id === g.trip.id && r.vehicle.id === v.id)
        body.push([
          row ? row.no : '', g.trip.no_trip, g.date, g.time, reportPlace(g.trip), reportAsal(g.trip), reportTujuan(g.trip),
          g.trip.officer_name || '-', v.no_polisi, row ? row.unit : '-', v.vehicle_type || '-',
          reportGolongan(v), Number(v.has_load) > 0 ? 'Ada Muatan' : 'Tanpa Muatan',
          Number(v.tariff_amount || 0), fotoUrl(v.foto_path) || null,
          row?.loc ? (row.loc.dist || `${row.loc.lat}, ${row.loc.lng}`) : null,
        ])
      }
    }

    const header = COLUMNS.map(c => c.label)
    return [
      {
        name: 'Laporan Trip dan Kendaraan',
        rows: [
          ...meta,
          header,
          ...body,
          [],
          ['TOTAL', `${totalTrip} trip`, '', '', '', '', '', '', '', `${totalUnit} unit`, '', '', '', totalRevenue, '', ''],
        ],
      },
    ]
  }

  const copyTsv = async () => {
    const tsvRows = vehicleRows.map(r => {
      const t = r.trip
      const d = formatReportDateTime(t.created_at)
      return [
        r.no,
        t.no_trip,
        d.date,
        d.time,
        reportPlace(t),
        reportAsal(t),
        reportTujuan(t),
        t.officer_name || '-',
        r.vehicle.no_polisi,
        r.unit,
        r.vehicle.vehicle_type || '-',
        r.category,
        Number(r.vehicle.has_load) > 0 ? 'Ada Muatan' : 'Tanpa Muatan',
        r.tarif,
        fotoUrl(r.vehicle.foto_path) || '-',
        r.loc ? (r.loc.dist || `${r.loc.lat}, ${r.loc.lng}`) : '-',
      ].map(c => String(c ?? '')).join('\t')
    })
    const tsv = [
      COLUMNS.map(c => c.label).join('\t'),
      ...tsvRows,
      ['', 'TOTAL', '', '', '', '', '', '', '', `${totalUnit} unit`, '', '', '', totalRevenue, '', ''].join('\t'),
    ].join('\n')
    try {
      await navigator.clipboard.writeText(tsv)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = tsv
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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

      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
          <span className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Table2 size={17} />
          </span>
          <div className="mr-auto">
            <h1 className="font-extrabold text-slate-900 text-[15px] leading-tight">Laporan Spreadsheet</h1>
            <p className="text-[11px] text-slate-400">
              Rekap trip dan rincian kendaraan dalam satu tabel - refresh otomatis tiap 15 detik
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
          <button onClick={copyTsv} disabled={state !== 'ready' || vehicleRows.length === 0}
            className={`px-3.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50 ${
              copied ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}>
            {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {copied ? 'Copied!' : 'Export'}
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
            <table className="w-full border-collapse text-[13px] min-w-[1700px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                  {COLUMNS.map((c, i) => (
                    <th key={c.key} className={`px-3 py-2.5 border-b border-slate-200 bg-slate-100 ${
                      i === 0 ? 'w-10 text-left'
                      : /Unit|Tarif/.test(c.label) ? 'text-right'
                      : c.key === 'foto' ? 'text-center w-24'
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
                ) : tableRows.length === 0 ? (
                  <tr><td colSpan={COLUMNS.length} className="p-10 text-center text-slate-400">Tidak ada data pada filter ini</td></tr>
                ) : tableRows.map((r, idx) => {
                  if (r.kind === 'trip') {
                    const t = r.trip
                    return (
                      <tr key={`trip-${t.id}`} className="bg-slate-100/70 border-y border-slate-200">
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-300" />
                        <td className="px-3 py-2 border-b border-slate-200 font-mono font-bold text-slate-800">{t.no_trip}</td>
                        <td className="px-3 py-2 border-b border-slate-200 font-semibold text-slate-700">{r.date}</td>
                        <td className="px-3 py-2 border-b border-slate-200 font-semibold text-slate-700">{r.time}</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-700">{reportPlace(t)}</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-700">{reportAsal(t)}</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-700">{reportTujuan(t)}</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-700">{t.officer_name || '-'}</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-300 italic text-[11px]">-</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-right font-bold text-slate-700">{r.unitCount} unit</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-600 text-[11px]">{r.typeSummary}</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-600 text-[11px]">{r.categorySummary}</td>
                        <td className="px-3 py-2 border-b border-slate-200">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                            t.status_muatan === 'muatan'
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              : 'border-slate-200 bg-white text-slate-500'
                          }`}>
                            {t.status_muatan === 'muatan' ? 'Ada Muatan' : 'Tanpa Muatan'}
                          </span>
                        </td>
                        <td className="px-3 py-2 border-b border-slate-200 text-right font-black text-slate-900">{fmtRp(r.revenue)}</td>
                        <td className="px-3 py-2 border-b border-slate-200 text-center">
                          <AllPhotosCell photos={r.photos} no_trip={t.no_trip} vehicleCount={r.unitCount} />
                        </td>
                        <td className="px-3 py-2 border-b border-slate-200 text-slate-300 italic text-[11px]">-</td>
                      </tr>
                    )
                  }

                  const v = r.vehicle
                  const hasLoad = Number(v.has_load) > 0
                  return (
                    <tr key={`veh-${v.id}`} className={idx % 2 === 1 ? 'bg-white' : 'bg-slate-50/40'}>
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-400 tabular-nums">{r.no}</td>
                      <td className="px-3 py-2 border-b border-slate-100 font-mono text-[11px] text-slate-400">{r.trip.no_trip}</td>
                      <td className="px-3 py-2 border-b border-slate-100" />
                      <td className="px-3 py-2 border-b border-slate-100" />
                      <td className="px-3 py-2 border-b border-slate-100" />
                      <td className="px-3 py-2 border-b border-slate-100" />
                      <td className="px-3 py-2 border-b border-slate-100" />
                      <td className="px-3 py-2 border-b border-slate-100" />
                      <td className="px-3 py-2 border-b border-slate-100 font-semibold text-slate-800">{v.no_polisi}</td>
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-700">{r.unit}</td>
                      <td className="px-3 py-2 border-b border-slate-100 text-slate-700">{v.vehicle_type || '-'}</td>
                      <td className="px-3 py-2 border-b border-slate-100">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border border-slate-300 bg-white text-slate-700">
                          {r.category}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border ${
                          hasLoad
                            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                            : 'border-slate-200 bg-white text-slate-500'
                        }`}>
                          {hasLoad ? 'Ada Muatan' : 'Tanpa Muatan'}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100 text-right font-bold text-slate-900 tabular-nums">{fmtRp(r.tarif)}</td>
                      <td className="px-3 py-2 border-b border-slate-100 text-center">
                        <ThumbnailCell foto_path={v.foto_path} no_trip={r.trip.no_trip} label={r.unit} />
                      </td>
                      <td className="px-3 py-2 border-b border-slate-100">
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
              </tbody>
              {tableRows.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-700">
                    <td className="px-3 py-3 border-t-2 border-slate-300" />
                    <td className="px-3 py-3 border-t-2 border-slate-300 text-[12px]">TOTAL</td>
                    <td className="px-3 py-3 border-t-2 border-slate-300 text-[12px] text-slate-400" colSpan={8}>
                      {totalTrip} trip - {totalUnit} unit
                    </td>
                    <td className="px-3 py-3 border-t-2 border-slate-300" />
                    <td className="px-3 py-3 border-t-2 border-slate-300" />
                    <td className="px-3 py-3 border-t-2 border-slate-300" />
                    <td className="px-3 py-3 border-t-2 border-slate-300 text-right font-black text-slate-900">
                      {fmtRp(totalRevenue)}
                    </td>
                    <td className="px-3 py-3 border-t-2 border-slate-300" />
                    <td className="px-3 py-3 border-t-2 border-slate-300" />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1.5">
          <ExternalLink size={12} />
          Data diambil langsung dari database. Tombol Export menyalin tabel (TSV) siap tempel ke Google Sheets atau Excel.
        </p>
      </main>
    </div>
  )
}
