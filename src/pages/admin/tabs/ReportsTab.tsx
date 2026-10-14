import { Fragment, useState, useEffect } from 'react'
import { Camera, ChevronRight, Download, ExternalLink, Eye, EyeOff, Table2 } from 'lucide-react'
import { fetchTrips, fetchTripReports, fetchReportFilters, fetchReportRecap, formatReportDateTime, dayKeyWib, type BackendTrip, type ReportTrip, type ReportFilters, type ReportRecapRow } from '../../../services/trips'
import { downloadXlsx } from '../../../services/xlsx'
import { CurrencyDisplay, useCurrencyReveal } from '../components/CurrencyDisplay'
import { PhotoViewer, resolvePhotoUrl } from '../components/PhotoViewer'

function vehiclePhotoCaption(trip: ReportTrip, vehicle: ReportTrip['vehicles'][number]): string {
  const metadata = [
    vehicle.foto_captured_at ? formatReportDateTime(vehicle.foto_captured_at).full : '',
    typeof vehicle.latitude === 'number' && typeof vehicle.longitude === 'number'
      ? `${vehicle.latitude.toFixed(5)}, ${vehicle.longitude.toFixed(5)}` : '',
  ].filter(Boolean).join(' · ')
  return `${trip.no_trip} · ${vehicle.no_polisi} · ${vehicle.vehicle_type} · ${vehicle.golongan}${metadata ? ` · ${metadata}` : ''}`
}

interface ReportsTabProps {
  serverState: 'connecting' | 'online' | 'offline'
  serverTrips: BackendTrip[]
  onServerTripsChange: (t: BackendTrip[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
  baseUrl?: string
}

export function ReportsTab({ serverState, serverTrips, onServerTripsChange, showToast, baseUrl = '' }: ReportsTabProps) {
  const { revealed, toggle } = useCurrencyReveal()
  const [reportTrips, setReportTrips] = useState<ReportTrip[]>([])
  const [recap, setRecap] = useState<ReportRecapRow[]>([])
  const [reportState, setReportState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  const [reportFilters, setReportFilters] = useState<ReportFilters>({})
  const [filterOptions, setFilterOptions] = useState<{ golongan: string[]; vehicleTypes: string[] }>({ golongan: [], vehicleTypes: [] })
  const [viewingPhotos, setViewingPhotos] = useState<{ id: string; url: string; caption?: string }[] | null>(null)

  const loadReports = async (filters?: ReportFilters) => {
    setReportState('loading')
    const f = filters ?? reportFilters
    const [rows, recapRows] = await Promise.all([fetchTripReports(f), fetchReportRecap(f)])
    if (rows === null) { setReportState('offline'); return }
    setReportTrips(rows)
    setRecap(recapRows ?? [])
    setReportState('ready')
  }

  useEffect(() => {
    if (reportState === 'idle') {
      Promise.all([fetchReportFilters(), fetchTrips()]).then(([opts, trips]) => {
        if (opts) setFilterOptions(opts)
        if (trips) onServerTripsChange(trips)
      })
      void loadReports()
    }
  }, [reportState])

  const applyReportFilter = (patch: Partial<ReportFilters>) => {
    let next = { ...reportFilters, ...patch }
    const today = dayKeyWib(new Date().toISOString())
    if (next.startDate && !next.endDate) next = { ...next, endDate: today }
    if (next.endDate && !next.startDate) next = { ...next, startDate: '1970-01-01' }
    setReportFilters(next)
    setOpenTripId(null)
    void loadReports(next)
  }

  const applyDatePreset = (days: number | null) => {
    if (!days) { clearReportFilters(); return }
    const today = dayKeyWib(new Date().toISOString())
    const start = dayKeyWib(new Date(Date.now() - (days - 1) * 86400000).toISOString())
    const next: ReportFilters = { ...reportFilters, startDate: start, endDate: today }
    setReportFilters(next)
    setOpenTripId(null)
    void loadReports(next)
  }

  const clearReportFilters = () => {
    setReportFilters({})
    setOpenTripId(null)
    void loadReports({})
  }

  const handleExport = () => {
    if (reportState !== 'ready' || reportTrips.length === 0) return showToast('Tidak ada data', 'error')
    const now = new Date()
    const stamped = formatReportDateTime(now.toISOString().slice(0, 19).replace('T', ' '), { withSeconds: true })
    const dateSlug = now.toISOString().slice(0, 10)
    const header = ['No Trip', 'Tanggal', 'Jam (WIB)', 'Tempat / Wilayah', 'Rute Asal', 'Rute Tujuan', 'Rute', 'Petugas', 'Status Muatan', 'Kategori', 'Jumlah Unit', 'Total Tarif (Rp)']
    const rentang = reportFilters.startDate || reportFilters.endDate
      ? `${reportFilters.startDate || 'Awal'} s/d ${reportFilters.endDate || 'Akhir'}`
      : 'Semua tanggal'
    const place = (t: ReportTrip) => t.region_name ? `${t.region_name}${t.region_code ? ` (${t.region_code})` : ''}` : '-'
    const asal = (t: ReportTrip) => t.route_from ? `${t.route_from_name ? `${t.route_from_name} (` : ''}${t.route_from}${t.route_from_name ? ')' : ''}` : '-'
    const tujuan = (t: ReportTrip) => t.route_to ? `${t.route_to_name ? `${t.route_to_name} (` : ''}${t.route_to}${t.route_to_name ? ')' : ''}` : '-'

    // Sheet 1 — ringkasan trip
    const tripRows: (string | number | null)[][] = [
      ['Laporan Trip Angkutan'],
      ['Dicetak', stamped.full],
      ['Rentang Tanggal', rentang],
      ['Filter Golongan', reportFilters.golongan || 'Semua'],
      ['Filter Jenis Kendaraan', reportFilters.vehicleType || 'Semua'],
      ['Jumlah Trip', totalTrip],
      [],
      header,
      ...reportTrips.map(t => {
        const d = formatReportDateTime(t.created_at)
        return [t.no_trip, d.date, d.time, place(t), asal(t), tujuan(t),
          `${t.route_from || '-'} → ${t.route_to || '-'}`, t.officer_name || '-',
          t.status_muatan === 'muatan' ? 'Ada Muatan' : 'Kosong',
          t.keterangan && t.keterangan !== '-' ? t.keterangan : '-',
          t.vehicle_count || 0, t.trip_revenue || 0]
      }),
    ]


    const vehRows: (string | number | null)[][] = [
      ['Detail Kendaraan per Trip'],
      ['Rentang Tanggal', rentang],
      [],
      ['No Trip', 'Tanggal', 'Jam (WIB)', 'Tempat / Wilayah', 'No. Polisi', 'Jenis Kendaraan', 'Golongan', 'Kategori', 'Beban', 'Tarif (Rp)'],
      ...reportTrips.flatMap(t => {
        const d = formatReportDateTime(t.created_at)
        return t.vehicles.map(v => [t.no_trip, d.date, d.time, place(t), v.no_polisi, v.vehicle_type,
          v.master_golongan || (v.golongan.length <= 3 ? v.golongan : '-'), v.golongan,
          v.has_load ? 'Ada Muatan' : 'Kosong', v.tariff_amount || 0])
      }),
    ]

    downloadXlsx(`laporan-trip-${dateSlug}.xlsx`, [
      { name: 'Laporan Trip', rows: tripRows },
      { name: 'Detail Kendaraan', rows: vehRows },
    ])
    showToast('Laporan Excel (.xlsx) diunduh')
  }

  const golonganOptions = filterOptions.golongan.length > 0 ? filterOptions.golongan : []
  const jenisOptions = filterOptions.vehicleTypes.length > 0 ? filterOptions.vehicleTypes : []

  // Analitik ringkas
  const totalTrip = reportTrips.length
  const totalUnit = reportTrips.reduce((s, t) => s + (t.vehicle_count || 0), 0)
  const totalRevenue = reportTrips.reduce((s, t) => s + (t.trip_revenue || 0), 0)
  const muatanCount = reportTrips.filter(t => t.status_muatan === 'muatan').length
  const kosongCount = totalTrip - muatanCount
  const muatanPct = totalTrip ? (muatanCount / totalTrip) * 100 : 0

  // Grafik 1 — trip per hari (maksimal 14 hari dalam rentang terpilih)
  const reportDaily = Array.from(
    reportTrips.reduce((m, t) => {
      const k = dayKeyWib(t.created_at)
      m.set(k, (m.get(k) || 0) + 1)
      return m
    }, new Map<string, number>()),
    ([day, count]) => ({ day, count }),
  ).sort((a, b) => a.day.localeCompare(b.day)).slice(-14)

  const maxDaily = Math.max(1, ...reportDaily.map(d => d.count))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Laporan Trip</h3>
          <p className="text-slate-500 text-[12px]">Data trip, kendaraan, dan tarif</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 ${
            reportState === 'ready' ? 'text-slate-600' : reportState === 'offline' ? 'text-amber-700 border-amber-200' : 'text-slate-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${reportState === 'ready' ? 'bg-emerald-500' : reportState === 'offline' ? 'bg-amber-500' : 'bg-slate-400 animate-pulse'}`} />
            {reportState === 'ready' ? 'Tersambung' : reportState === 'offline' ? 'Offline' : 'Memuat...'}
          </span>
          <button onClick={() => void loadReports()} disabled={reportState === 'loading'}
            className="border border-slate-200 text-slate-700 px-3.5 py-2 rounded-lg font-semibold text-sm hover:bg-slate-50 disabled:opacity-50">
            Refresh
          </button>
          



          <button onClick={() => { window.location.hash = '#/sheet' }} disabled={reportState !== 'ready'}
            title="Buka spreadsheet live yang tersinkron langsung dari database"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50">
            <Table2 size={15} /> Buka Spreadsheet
          </button>
          <button onClick={() => window.open(`${window.location.pathname}#/sheet`, '_blank')} disabled={reportState !== 'ready'}
            title="Buka spreadsheet di tab baru" aria-label="Buka spreadsheet di tab baru"
            className="border border-slate-200 text-slate-600 px-2.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
            <ExternalLink size={15} />
          </button>
          <button onClick={handleExport} disabled={reportState !== 'ready'}
            title="Unduh berkas .xlsx (cara lama, opsional)"
            className="border border-slate-200 text-slate-700 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
            <Download size={15} /> .xlsx
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-sm flex flex-wrap items-end gap-4">
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1.5">Dari</label>
          <input type="date" value={reportFilters.startDate || ''} onChange={e => applyReportFilter({ startDate: e.target.value || undefined })}
            className="border rounded-xl px-3 py-2 text-sm bg-white" /></div>
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1.5">Sampai</label>
          <input type="date" value={reportFilters.endDate || ''} onChange={e => applyReportFilter({ endDate: e.target.value || undefined })}
            className="border rounded-xl px-3 py-2 text-sm bg-white" /></div>
        <div className="flex gap-1.5">
          {[{ label: 'Hari Ini', days: 1 }, { label: '7 Hari', days: 7 }, { label: '30 Hari', days: 30 }].map(p => (
            <button key={p.label} onClick={() => applyDatePreset(p.days)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-500 hover:bg-slate-50">
              {p.label}
            </button>
          ))}
        </div>
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1.5">Golongan</label>
          <select value={reportFilters.golongan || ''} onChange={e => applyReportFilter({ golongan: e.target.value || undefined })}
            className="border rounded-xl px-3 py-2 text-sm min-w-[140px] bg-white">
            <option value="">Semua</option>
            {golonganOptions.map(g => <option key={g} value={g}>Gol {g}</option>)}
          </select></div>
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1.5">Jenis Kendaraan</label>
          <select value={reportFilters.vehicleType || ''} onChange={e => applyReportFilter({ vehicleType: e.target.value || undefined })}
            className="border rounded-xl px-3 py-2 text-sm min-w-[150px] bg-white">
            <option value="">Semua</option>
            {jenisOptions.map(j => <option key={j} value={j}>{j}</option>)}
          </select></div>
        <button onClick={clearReportFilters} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50">Reset</button>
        <span className="ml-auto text-[12px] text-slate-400 font-semibold">{totalTrip} trip</span>
      </div>

      {/* Ringkasan */}
      {reportState === 'ready' && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center">
            <p className="text-slate-400 text-[11px] font-semibold uppercase">Total Trip</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{totalTrip}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center">
            <p className="text-slate-400 text-[11px] font-semibold uppercase">Muatan</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{muatanCount}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center">
            <p className="text-slate-400 text-[11px] font-semibold uppercase">Unit</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{totalUnit}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center">
            <p className="text-slate-400 text-[11px] font-semibold uppercase">Pendapatan</p>
            <CurrencyDisplay amount={totalRevenue} className="text-2xl font-black text-slate-900 mt-1" />
          </div>
        </div>
      )}

      {/* Grafik analitik — di atas tabel agar terasa sebagai laporan utuh */}
      {reportState === 'ready' && totalTrip > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Trip per hari */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Trip per Hari</h4>
                <p className="text-[11px] text-slate-400">maksimal 14 hari terakhir dalam rentang terpilih</p>
              </div>
              <span className="text-[11px] font-bold text-slate-400">puncak {maxDaily} trip/hari</span>
            </div>
            <div className="flex items-end gap-1.5 h-40">
              {reportDaily.map((d, i) => (
                <div key={d.day} title={`${d.day} · ${d.count} trip`}
                  className="h-full flex-1 min-w-0 flex flex-col justify-end items-center gap-1">
                  <span className="text-[9px] font-bold text-slate-500 tabular-nums">{d.count}</span>
                  <div className="w-full rounded-t-md bg-blue-600 transition-all"
                    style={{ height: `${Math.max(6, (d.count / maxDaily) * 70)}%` }} />
                  <span className={`text-[9px] text-slate-400 whitespace-nowrap ${reportDaily.length > 8 && i % 2 === 1 ? 'opacity-0' : ''}`}>
                    {Number(d.day.slice(8))}/{d.day.slice(5, 7)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Komposisi muatan */}
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h4 className="font-bold text-slate-800 text-sm">Komposisi Muatan</h4>
            <p className="text-[11px] text-slate-400 mb-4">trip bermuatan vs kosong</p>
            <div className="flex items-center gap-5">
              <div className="relative w-28 h-28 shrink-0 rounded-full"
                style={{ background: `conic-gradient(var(--admin-accent) 0 ${muatanPct}%, #cbd5e1 ${muatanPct}% 100%)` }}>
                <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center">
                  <span className="text-xl font-black text-slate-900 tabular-nums leading-none">{totalTrip}</span>
                  <span className="text-[9px] font-bold text-slate-400 mt-0.5">TRIP</span>
                </div>
              </div>
              <div className="space-y-2.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                  <span className="text-slate-600 font-semibold">Ada Muatan</span>
                  <span className="font-black text-slate-800 tabular-nums">{muatanCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  <span className="text-slate-600 font-semibold">Kosong</span>
                  <span className="font-black text-slate-800 tabular-nums">{kosongCount}</span>
                </div>
                <p className="text-[11px] text-slate-400 pt-1">{Math.round(muatanPct)}% trip bermuatan</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Rekap wilayah — trip dari petugas berbeda dalam satu region+Dermaga
          digabung jadi satu baris operasional (petugas tetap tercatat sbg metadata) */}
      {reportState === 'ready' && recap.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h4 className="font-bold text-slate-800 text-sm">Rekap Wilayah</h4>
              <p className="text-[11px] text-slate-400">trip lintas petugas dirangkum per region & Dermaga</p>
            </div>
            <span className="text-[11px] font-bold text-slate-400">{recap.length} wilayah</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 text-left font-bold border-b border-slate-200">Tempat</th>
                  <th className="px-4 py-2.5 text-left font-bold border-b border-slate-200">Dermaga</th>
                  <th className="px-4 py-2.5 text-right font-bold border-b border-slate-200">Trip</th>
                  <th className="px-4 py-2.5 text-right font-bold border-b border-slate-200">Unit</th>
                  <th className="px-4 py-2.5 text-right font-bold border-b border-slate-200">Pendapatan</th>
                  <th className="px-4 py-2.5 text-left font-bold border-b border-slate-200">Petugas (metadata)</th>
                </tr>
              </thead>
              <tbody>
                {recap.map(r => (
                  <tr key={`${r.region_id}-${r.dermaga_id || 'none'}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3 border-b border-slate-100">
                      <p className="font-bold text-slate-900 text-[13px]">{r.region_name}</p>
                      <p className="text-[10px] text-slate-400">{r.region_code}{r.first_trip_at ? ` · ${formatReportDateTime(r.first_trip_at).date}` : ''}</p>
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100">
                      <span className="inline-block bg-slate-100 border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] font-bold text-slate-600">
                        {r.dermaga_name || '—'}{r.dermaga_code ? ` (${r.dermaga_code})` : ''}
                      </span>
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100 text-right font-black text-slate-900 tabular-nums">{r.trip_count}</td>
                    <td className="px-4 py-3 border-b border-slate-100 text-right font-bold text-slate-700 tabular-nums">{r.vehicle_count}</td>
                    <td className="px-4 py-3 border-b border-slate-100 text-right">
                      <CurrencyDisplay amount={r.revenue} className="font-bold text-slate-900" />
                    </td>
                    <td className="px-4 py-3 border-b border-slate-100">
                      <div className="flex flex-wrap gap-1.5">
                        {r.officers.map(o => (
                          <span key={`${r.region_id}-${o.name}`}
                            className="inline-block bg-blue-50 border border-blue-100 rounded-full px-2 py-0.5 text-[11px] text-slate-600">
                            {o.name}{o.username ? <span className="text-slate-400"> · @{o.username}</span> : null}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal Foto */}
      {viewingPhotos && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewingPhotos(null)}>
          <div onClick={e => e.stopPropagation()} className="max-w-4xl w-full">
            <PhotoViewer photos={viewingPhotos} onClose={() => setViewingPhotos(null)} baseUrl={baseUrl} />
          </div>
        </div>
      )}

      {/* Tabel */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50">
              <th colSpan={9} className="px-4 py-3 border-b border-slate-200">
                <div className="flex justify-end gap-2">
                  <button onClick={toggle}
                    className={`px-3.5 py-2 rounded-lg border font-semibold text-sm flex items-center gap-2 ${revealed ? 'border-blue-500 text-blue-600 bg-white' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'}`}>
                    {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                    {revealed ? 'Hide' : 'Show'} Nominal
                  </button>
                  <button onClick={() => {
                    const photos = reportTrips.flatMap(t => [
                      ...(t.foto_kosong_path ? [{
                        id: `trip-${t.id}`,
                        url: t.foto_kosong_path,
                        caption: `${t.no_trip} · Bukti trip`,
                      }] : []),
                      ...t.vehicles.filter(v => v.foto_path).map(v => ({
                        id: `vehicle-${v.id}`,
                        url: v.foto_path as string,
                        caption: vehiclePhotoCaption(t, v),
                      })),
                    ])
                    setViewingPhotos(photos)
                  }}
                    disabled={reportState !== 'ready'}
                    className="bg-blue-600 text-white px-3.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700">
                    <Camera size={15} /> Foto ({reportTrips.reduce((count, t) => count + (t.foto_kosong_path ? 1 : 0) + t.vehicles.filter(v => !!v.foto_path).length, 0)})
                  </button>
                </div>
              </th>
            </tr>
            <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="text-left px-4 py-2.5 border-b border-slate-200 w-8">#</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">No Trip</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Tanggal</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Wilayah</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Rute</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Muatan</th>
              <th className="text-right px-3 py-2.5 border-b border-slate-200">Unit</th>
              <th className="text-right px-4 py-2.5 border-b border-slate-200">Pendapatan</th>
              <th className="border-b border-slate-200 w-8" />
            </tr>
          </thead>
          <tbody>
            {reportState === 'offline' ? (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400">Offline</td></tr>
            ) : reportState !== 'ready' ? (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400 animate-pulse">Memuat...</td></tr>
            ) : reportTrips.length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400">Belum ada trip</td></tr>
            ) : reportTrips.map((t, idx) => {
              const open = openTripId === t.id
              const d = formatReportDateTime(t.created_at)
              return (
                <Fragment key={t.id}>
                  <tr onClick={() => setOpenTripId(open ? null : t.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${open ? 'bg-blue-50/60' : idx % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums align-middle">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-700">{t.no_trip}</td>
                    <td className="px-3 py-2.5 text-slate-700">{d.date} {d.time}</td>
                    <td className="px-3 py-2.5 text-slate-700">{t.region_name || '-'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{t.route_from_name || t.route_from} → {t.route_to_name || t.route_to}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${t.status_muatan === 'muatan' ? 'border-slate-300 text-slate-700' : 'border-slate-200 text-slate-400'}`}>
                        {t.status_muatan === 'muatan' ? 'Ada' : 'Kosong'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{t.vehicle_count}</td>
                    <td className="px-4 py-2.5 text-right">
                      <CurrencyDisplay amount={t.trip_revenue || 0} />
                    </td>
                    <td className="px-2 py-2.5 text-center text-slate-400"><ChevronRight size={14} className="mx-auto" /></td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="text-[12px] text-slate-600 mb-3">
                          <span className="font-semibold mr-4">Petugas: {t.officer_name || '-'}</span>
                          <span>Kategori: {t.keterangan || '-'}</span>
                        </div>
                        {t.foto_kosong_path && (
                          <div className="flex items-center gap-3 mb-3 p-3 rounded-xl border border-slate-200 bg-white max-w-xl">
                            <button
                              type="button"
                              onClick={() => setViewingPhotos([{
                                id: `trip-${t.id}`,
                                url: t.foto_kosong_path!,
                                caption: `${t.no_trip} · Bukti trip`,
                              }])}
                              className="w-16 h-12 shrink-0 overflow-hidden rounded-lg bg-slate-100"
                              aria-label={`Lihat foto bukti trip ${t.no_trip}`}
                            >
                              <img src={resolvePhotoUrl(t.foto_kosong_path, baseUrl)} alt="" className="w-full h-full object-cover" />
                            </button>
                            <span className="text-[12px] font-semibold text-slate-700">Foto bukti trip</span>
                          </div>
                        )}
                        {t.vehicles.length > 0 && (
                          <div className="max-w-full overflow-x-auto rounded-xl border border-slate-200">
                          <table className="w-full min-w-[680px] text-[13px] bg-white">
                            <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                              <tr><th className="text-left p-3">Foto</th><th className="text-left p-3">Plat</th><th className="text-left p-3">Jenis</th><th className="text-left p-3">Kategori</th><th className="text-left p-3">Muatan</th><th className="text-right p-3">Tarif</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {t.vehicles.map((v, i) => (
                                <tr key={`${v.no_polisi}-${i}`}>
                                  <td className="p-3">
                                    {v.foto_path ? (
                                      <button
                                        type="button"
                                        onClick={() => setViewingPhotos([{
                                          id: `vehicle-${v.id}`,
                                          url: v.foto_path!,
                                          caption: vehiclePhotoCaption(t, v),
                                        }])}
                                        className="block w-16 h-12 sm:w-20 sm:h-14 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 hover:ring-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        aria-label={`Lihat foto kendaraan ${v.no_polisi}`}
                                      >
                                        <img src={resolvePhotoUrl(v.foto_path, baseUrl)} alt={`Kendaraan ${v.no_polisi}`} className="w-full h-full object-cover" />
                                      </button>
                                    ) : <span className="text-[10px] text-slate-400">Tidak ada foto</span>}
                                  </td>
                                  <td className="p-3 font-mono font-bold">{v.no_polisi}</td>
                                  <td className="p-3">{v.vehicle_type}</td>
                                  <td className="p-3"><span className={`px-2 py-1 rounded text-[10px] font-semibold border ${v.golongan === 'Internal' ? 'border-slate-800 text-slate-800' : v.golongan === 'Eksternal' ? 'border-slate-400 text-slate-600' : 'border-slate-200 text-slate-500'}`}>{v.golongan}</span></td>
                                  <td className="p-3">{v.has_load ? 'Ada Muatan' : 'Kosong'}</td>
                                  <td className="p-3 text-right font-bold"><CurrencyDisplay amount={v.tariff_amount || 0} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold text-slate-700">
              <td colSpan={7} className="px-4 py-3 border-t-2 border-slate-300 text-right text-[12px]">
                Total {totalTrip} trip · {totalUnit} unit
              </td>
              <td className="px-4 py-3 border-t-2 border-slate-300 text-right">
                <CurrencyDisplay amount={totalRevenue} className="text-emerald-700 font-black" />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
