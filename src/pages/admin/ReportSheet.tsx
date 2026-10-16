import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ClipboardCopy, Download, ExternalLink, Image as ImageIcon, MapPin, RefreshCw, Table2, X } from 'lucide-react'
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
  type ReportTrip,
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
                <ImageIcon size={13} /> Dokumentasi {label ? `· ${label}` : 'Kendaraan'}
              </span>
              <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/20 rounded"><X size={14} /></button>
            </div>
            <div className="bg-slate-900 p-2 flex items-center justify-center">
              <img src={url} alt="kendaraan" className="max-h-[65vh] w-auto object-contain rounded-lg" />
            </div>
            <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
              <span className="font-mono">Trip: {no_trip}{label ? ` · ${label}` : ''}</span>
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

type ViewMode = 'trip' | 'vehicle'
type LoadState = 'loading' | 'ready' | 'offline'



const AUTO_REFRESH_MS = 15_000

interface VehRow extends Array<string | number | LocCell | null> {
  0: number; 1: string; 2: string; 3: string; 4: string; 5: string;
  6: string; 7: string; 8: string; 9: string; 10: number;
  11: string | null;
  12: LocCell | null;
  length: 13;
}



const asVehRow = (r: [number, string, string, string, string, string, string, string, string, string, number, string | null, LocCell | null]): VehRow => r as unknown as VehRow



export default function ReportSheet() {
  const [rows, setRows] = useState<ReportTrip[]>([])
  const [filters, setFilters] = useState<ReportFilters>({})
  const [options, setOptions] = useState<ReportFilterOptions>({ golongan: [], vehicleTypes: [] })

  const [geoRules, setGeoRules] = useState<GeofenceRule[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [view, setView] = useState<ViewMode>('trip')
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

  const apply = (patch: ReportFilters) => setFilters(prev => ({ ...prev, ...patch }))

  const tripHeader = ['#', 'No Trip', 'Tanggal', 'Jam (WIB)', 'Tempat / Wilayah', 'Rute Asal', 'Rute Tujuan', 'Petugas', 'Muatan', 'Unit', 'Pendapatan (Rp)']
  const vehHeader = ['#', 'No Trip', 'Tanggal', 'Jam (WIB)', 'Tempat / Wilayah', 'No. Polisi', 'Unit', 'Jenis Kendaraan', 'Golongan', 'Kategori', 'Tarif (Rp)', 'Foto', 'Lokasi']

  const tripMatrix = useMemo(() => rows.map((t, i) => {
    const d = formatReportDateTime(t.created_at)
    return [i + 1, t.no_trip, d.date, d.time, reportPlace(t), reportAsal(t), reportTujuan(t),
      t.officer_name || '-', t.status_muatan === 'muatan' ? 'Ada Muatan' : 'Kosong',
      t.vehicle_count || 0, t.trip_revenue || 0]
  }), [rows])

  const vehFlat = useMemo(() => rows.flatMap(t => t.vehicles.map(v => ({ t, v }))), [rows])
  const vehMatrix = useMemo(() => vehFlat.map(({ t, v }, i) => {
    const d = formatReportDateTime(t.created_at)
    const base = fmtCoords(v.latitude, v.longitude)

    const nd = nearestGeofence({ latitude: v.latitude, longitude: v.longitude }, geoRules)
    const loc: LocCell | null = base && {
      dist: locationDistanceText({ latitude: v.latitude, longitude: v.longitude }, geoRules),
      lat: base.lat,
      lng: base.lng,
      gmaps: base.gmaps,
      tooltip: nd ? `${base.lat}, ${base.lng} · titik: ${nd.pointName} (${nd.pointLat}, ${nd.pointLng})` : `${base.lat}, ${base.lng}`,
    }
    return asVehRow([i + 1, t.no_trip, d.date, d.time, reportPlace(t), v.no_polisi,
      vehicleUnitLabel(t.vehicles, v), v.vehicle_type,
      v.master_golongan || (v.golongan.length <= 3 ? v.golongan : '-'), v.golongan, v.tariff_amount || 0,
      v.foto_path, loc])
  }), [vehFlat, geoRules])

  const totalTrip = rows.length
  const totalUnit = rows.reduce((s, t) => s + (t.vehicle_count || 0), 0)
  const totalRevenue = rows.reduce((s, t) => s + (t.trip_revenue || 0), 0)
  const totalTarif = vehMatrix.reduce((s, r) => s + Number((r[10] as number) || 0), 0)

  const header = view === 'trip' ? tripHeader : vehHeader
  const matrix = view === 'trip' ? tripMatrix : vehMatrix

  const buildSheets = () => {
    const now = new Date()

    const vehExcelMatrix: (string | number | null)[][] = vehMatrix.map(r => [
      r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10],
      fotoUrl(r[11]) || null,

      r[12] ? (r[12].dist || `${r[12].lat}, ${r[12].lng}`) : null,
    ])
    const meta: (string | number | null)[][] = [
      ['Laporan Spreadsheet'],
      ['Dicetak', now.toLocaleString('id-ID')],
      ['Rentang Tanggal', reportRentang(filters)],
      ['Filter Golongan', filters.golongan || 'Semua'],
      ['Filter Jenis Kendaraan', filters.vehicleType || 'Semua'],
      ['Sinkron Terakhir', lastSync],
      ['Jumlah Trip', totalTrip],
      [],
    ]
    return [
      { name: 'Laporan Trip', rows: [...meta, tripHeader, ...tripMatrix, [], ['TOTAL', '', '', '', '', '', '', '', '', totalUnit, totalRevenue]] },
      { name: 'Detail Kendaraan', rows: [['Detail Kendaraan per Trip'], [], vehHeader, ...vehExcelMatrix, [], ['TOTAL', '', '', '', '', '', '', '', '', '', totalTarif, '', '']] },
    ]
  }

  const copyTsv = async () => {
    const tsvRows = matrix.map(r => r.map((cell, ci) => {
      if (view === 'vehicle' && ci === 11) return fotoUrl(cell as string | null) || '-'
      if (view === 'vehicle' && ci === 12) {
        const loc = cell as LocCell | null
        return loc?.dist || (loc ? `${loc.lat}, ${loc.lng}` : '-')
      }
      return String(cell ?? '')
    }))
    const tsv = [
      header.join('\t'),
      ...tsvRows.map(r => r.join('\t')),
      view === 'trip'
        ? ['', 'TOTAL', '', '', '', '', '', '', '', totalUnit, totalRevenue].join('\t')
        : ['', 'TOTAL', '', '', '', '', '', '', '', '', totalTarif, '', ''].join('\t'),
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
              Tersinkron langsung dari database · refresh otomatis tiap 15 detik
              {lastSync && <> · terakhir {lastSync} WIB</>}
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
          <button onClick={copyTsv} disabled={state !== 'ready' || matrix.length === 0}
            className={`px-3.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 disabled:opacity-50 ${
              copied ? 'bg-emerald-600 text-white' : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}>
            {copied ? <Check size={15} /> : <ClipboardCopy size={15} />} {copied ? 'Copied!' : 'Export'}
          </button>
          <button onClick={() => downloadXlsx(`laporan-trip-${new Date().toISOString().slice(0, 10)}.xlsx`, buildSheets())}
            disabled={state !== 'ready' || matrix.length === 0}
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
            Golongan
            <select value={filters.golongan || ''} onChange={e => apply({ golongan: e.target.value || undefined })}
              className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white min-w-[130px]">
              <option value="">Semua</option>
              {options.golongan.map(g => <option key={g} value={g}>Gol {g}</option>)}
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
          <button onClick={() => setFilters({})}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold text-xs hover:bg-white">
            Reset
          </button>
          <span className="ml-auto text-[11px] text-slate-400 font-semibold self-center">Sinkron ke-{tick + 1}</span>
        </div>

        <div className="px-5 flex items-end gap-1 -mb-px">
          {([['trip', 'Laporan Trip'], ['vehicle', 'Detail Kendaraan']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setView(key)}
              className={`px-4 py-2 rounded-t-lg border border-b-0 text-[12px] font-bold ${
                view === key ? 'bg-white border-slate-200 text-blue-600 -mb-px' : 'bg-slate-100 border-transparent text-slate-400 hover:text-slate-600'
              }`}>
              {label}
            </button>
          ))}
        </div>
      </header>

      <main className="p-5">
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full border-collapse text-[13px] min-w-[1100px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                  {header.map((h, i) => (
                    <th key={h} className={`px-3 py-2.5 border-b border-slate-200 bg-slate-100 ${
                      i === 0 ? 'w-10 text-left'
                      : /Unit|Tarif|Pendapatan/.test(h) ? 'text-right'
                      : h === 'Foto' ? 'text-center w-16'
                      : 'text-left'
                    }`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state === 'offline' ? (
                  <tr><td colSpan={header.length} className="p-10 text-center text-slate-400">Tidak tersambung ke server</td></tr>
                ) : state === 'loading' && rows.length === 0 ? (
                  <tr><td colSpan={header.length} className="p-10 text-center text-slate-400 animate-pulse">Memuat laporan...</td></tr>
                ) : matrix.length === 0 ? (
                  <tr><td colSpan={header.length} className="p-10 text-center text-slate-400">Tidak ada data pada filter ini</td></tr>
                ) : matrix.map((r, idx) => (
                  <tr key={idx} className={idx % 2 === 1 ? 'bg-slate-50/60' : ''}>
                    {r.map((cell, ci) => {
                      if (view === 'vehicle' && ci === 11) {
                        const fotoPath = cell as string | null
                        const noTrip = r[1] as string
                        const unitLabel = r[6] as string
                        return (
                          <td key={ci} className="px-3 py-2 border-b border-slate-100 text-center">
                            <ThumbnailCell foto_path={fotoPath} no_trip={noTrip} label={unitLabel} />
                          </td>
                        )
                      }

                      if (view === 'vehicle' && ci === 12) {
                        const loc = cell as LocCell | null
                        if (!loc) return <td key={ci} className="px-3 py-2 border-b border-slate-100 text-slate-300 italic text-[11px]">-</td>
                        return (
                          <td key={ci} className="px-3 py-2 border-b border-slate-100">
                            <a
                              href={loc.gmaps}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-700 hover:underline"
                              title={loc.tooltip || `${loc.lat}, ${loc.lng}`}
                            >
                              <MapPin size={11} />
                              {loc.dist || `${loc.lat}, ${loc.lng}`}
                            </a>
                          </td>
                        )
                      }
                      return (
                        <td key={ci} className={`px-3 py-2 border-b border-slate-100 ${
                          ci === 0 ? 'text-slate-400 tabular-nums'
                          : typeof cell === 'number' ? 'text-right tabular-nums' : ''
                        } ${ci === 1 ? 'font-mono font-semibold text-slate-700' : 'text-slate-700'}`}>
                          {typeof cell === 'number' && ci > 0 && ci === 10
                            ? fmtRp(cell)
                            : typeof cell === 'string' || typeof cell === 'number'
                              ? cell
                              : String(cell ?? '')}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              {matrix.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-700">
                    <td className="px-3 py-3 border-t-2 border-slate-300" />
                    <td className="px-3 py-3 border-t-2 border-slate-300 text-[12px]">TOTAL</td>
                    <td className="px-3 py-3 border-t-2 border-slate-300 text-[12px] text-slate-400" colSpan={view === 'trip' ? 7 : 8}>
                      {totalTrip} trip · {totalUnit} unit
                    </td>
                    <td className="px-3 py-3 border-t-2 border-slate-300 text-right font-black text-slate-900" colSpan={view === 'trip' ? 2 : 3}>
                      {fmtRp(view === 'trip' ? totalRevenue : totalTarif)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mt-3 flex items-center gap-1.5">
          <ExternalLink size={12} />
          Data diambil langsung dari database — tanpa unduh/impor berkas. Tombol <b>Salin</b> menyalin tabel (TSV) siap tempel ke Google Sheets / Excel.
        </p>
      </main>
    </div>
  )
}
