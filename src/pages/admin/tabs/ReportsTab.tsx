import { Fragment, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronRight, Download, ExternalLink, Eye, EyeOff, Table2, Calendar } from 'lucide-react'
import { fetchTrips, fetchTripReports, fetchReportFilters, formatReportDateTime, dayKeyWib, vehicleUnitLabel, reportPlace, reportAsal, reportTujuan, reportRentang, reportGolongan, tarifSourceLabel, type BackendTrip, type ReportTrip, type ReportFilters } from '../../../services/trips'
import { downloadXlsx } from '../../../services/xlsx'
import { CurrencyDisplay } from '../components/CurrencyDisplay'
import { PhotoViewer, resolvePhotoUrl } from '../components/PhotoViewer'
import { fetchGeofenceRules, type GeofenceRule } from '../../../services/geofences'
import { locationDistanceText } from '../../../services/locationDistance'



function vehiclePhotoCaption(
  trip: ReportTrip,
  vehicle: ReportTrip['vehicles'][number],
  geoRules: GeofenceRule[],
): string {
  const metadata = [
    vehicle.foto_captured_at ? formatReportDateTime(vehicle.foto_captured_at).full : '',

    locationDistanceText(vehicle, geoRules)
      || (typeof vehicle.latitude === 'number' && typeof vehicle.longitude === 'number'
        ? `${vehicle.latitude.toFixed(5)}, ${vehicle.longitude.toFixed(5)}` : ''),
  ].filter(Boolean).join(' - ')
  const unit = vehicleUnitLabel(trip.vehicles, vehicle)
  return `${trip.no_trip} - ${unit} - ${vehicle.no_polisi} - ${vehicle.vehicle_type} - ${reportGolongan(vehicle)}${metadata ? ` - ${metadata}` : ''}`
}

interface ReportsTabProps {
  onServerTripsChange: (t: BackendTrip[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
  revealed: boolean
  onToggleReveal: () => void
  baseUrl?: string
}



export function ReportsTab({ onServerTripsChange, showToast, revealed, onToggleReveal, baseUrl = '' }: ReportsTabProps) {
  const [reportTrips, setReportTrips] = useState<ReportTrip[]>([])
  const [reportState, setReportState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  const [reportFilters, setReportFilters] = useState<ReportFilters>({})
  const [filterOptions, setFilterOptions] = useState<{ golongan: string[]; vehicleTypes: string[] }>({ golongan: [], vehicleTypes: [] })
  const [viewingPhotos, setViewingPhotos] = useState<{ id: string; url: string; caption?: string }[] | null>(null)

  const [geoRules, setGeoRules] = useState<GeofenceRule[]>([])

  const loadReports = async (filters?: ReportFilters) => {
    setReportState('loading')
    const f = filters ?? reportFilters
    const rows = await fetchTripReports(f)
    if (rows === null) { setReportState('offline'); return }
    setReportTrips(rows)
    setReportState('ready')
  }

  useEffect(() => {
    if (reportState === 'idle') {
      Promise.all([fetchReportFilters(), fetchTrips()]).then(([opts, trips]) => {
        if (opts) setFilterOptions(opts)
        if (trips) onServerTripsChange(trips)
      })
      void loadReports()

      fetchGeofenceRules().then(rules => { if (rules) setGeoRules(rules) }).catch(() => null)
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
    const header = ['No Trip', 'Tanggal', 'Jam (WIB)', 'Tempat / Wilayah', 'Rute Asal', 'Rute Tujuan', 'Rute', 'Kendaraan', 'Petugas', 'Status Muatan', 'Kategori', 'Jumlah Unit', 'Total Tarif (Rp)']
    const rentang = reportRentang(reportFilters)

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
        return [t.no_trip, d.date, d.time, reportPlace(t), reportAsal(t), reportTujuan(t),
          `${t.route_from || '-'} → ${t.route_to || '-'}`,
          t.vehicles.map(v => `${v.no_polisi} (${v.vehicle_type}, ${v.has_load ? 'Ada Muatan' : 'Kosong'})`).join(' | ') || '-',
          t.officer_name || '-',
          t.status_muatan === 'muatan' ? 'Ada Muatan' : 'Kosong',
          t.keterangan && t.keterangan !== '-' ? t.keterangan : '-',
          t.vehicle_count || 0, t.trip_revenue || 0]
      }),
    ]

    const vehRows: (string | number | null)[][] = [
      ['Detail Kendaraan per Trip'],
      ['Rentang Tanggal', rentang],
      [],
      ['No Trip', 'Tanggal', 'Jam (WIB)', 'Tempat / Wilayah', 'No. Polisi', 'Jenis Kendaraan', 'Golongan', 'Beban', 'Tarif (Rp)'],
      ...reportTrips.flatMap(t => {
        const d = formatReportDateTime(t.created_at)
        return t.vehicles.map(v => [t.no_trip, d.date, d.time, reportPlace(t), v.no_polisi, v.vehicle_type,
          reportGolongan(v),
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

  const totalTrip = reportTrips.length
  const totalUnit = reportTrips.reduce((s, t) => s + (t.vehicle_count || 0), 0)
  const totalRevenue = reportTrips.reduce((s, t) => s + (t.trip_revenue || 0), 0)
  const muatanCount = reportTrips.filter(t => t.status_muatan === 'muatan').length
  const kosongCount = totalTrip - muatanCount
  const muatanPct = totalTrip ? (muatanCount / totalTrip) * 100 : 0

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
            {golonganOptions.map(g => <option key={g} value={g}>{g}</option>)}
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
            <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={totalRevenue} className="text-2xl font-black text-slate-900 mt-1" />
          </div>
        </div>
      )}

      {reportState === 'ready' && totalTrip > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

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
                <div key={d.day} title={`${d.day} - ${d.count} trip`}
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

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm">
            <h4 className="font-bold text-slate-800 text-sm">Komposisi Muatan</h4>
            <p className="text-[11px] text-slate-400 mb-4">trip bermuatan vs kosong</p>
            <div className="flex items-center gap-5">
              <div className="relative w-28 h-28 shrink-0 rounded-full"
                style={{ background: `conic-gradient(#3B82F6 0 ${muatanPct}%, #cbd5e1 ${muatanPct}% 100%)` }}>
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
                  <span className="text-slate-600 font-semibold">Tanpa Muatan</span>
                  <span className="font-black text-slate-800 tabular-nums">{kosongCount}</span>
                </div>
                <p className="text-[11px] text-slate-400 pt-1">{Math.round(muatanPct)}% trip bermuatan</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewingPhotos && createPortal((
        <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" onClick={() => setViewingPhotos(null)}>
          <div onClick={e => e.stopPropagation()} className="max-w-4xl w-full">
            <PhotoViewer photos={viewingPhotos} onClose={() => setViewingPhotos(null)} baseUrl={baseUrl} />
          </div>
        </div>
      ), document.body)}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-50">
              <th colSpan={11} className="px-4 py-3 border-b border-slate-200">
                <div className="flex justify-end gap-2">
                  <button onClick={onToggleReveal}
                    className={`px-3.5 py-2 rounded-lg border font-semibold text-sm flex items-center gap-2 ${revealed ? 'border-blue-500 text-blue-600 bg-white' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'}`}>
                    {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
                    {revealed ? 'Hide' : 'Show'} Nominal
                  </button>
                  <button onClick={() => {
                    const photos = reportTrips.flatMap(t => [
                      ...(t.foto_kosong_path ? [{
                        id: `trip-${t.id}`,
                        url: t.foto_kosong_path,
                        caption: `${t.no_trip} - Bukti trip`,
                      }] : []),
                      ...(t.selfie_photo ? [{
                        id: `selfie-${t.id}`,
                        url: t.selfie_photo,
                        caption: `${t.no_trip} - Swafoto petugas`,
                      }] : []),
                      ...t.vehicles.filter(v => v.foto_path).map(v => ({
                        id: `vehicle-${v.id}`,
                        url: v.foto_path as string,
                        caption: vehiclePhotoCaption(t, v, geoRules),
                      })),
                    ])
                    setViewingPhotos(photos)
                  }}
                    disabled={reportState !== 'ready'}
                    className="bg-blue-600 text-white px-3.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700">
                    <Camera size={15} /> Foto ({reportTrips.reduce((count, t) => count + (t.foto_kosong_path ? 1 : 0) + (t.selfie_photo ? 1 : 0) + t.vehicles.filter(v => !!v.foto_path).length, 0)})
                  </button>
                </div>
              </th>
            </tr>
            <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="text-left px-4 py-2.5 border-b border-slate-200 w-8">#</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">No Trip</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Tanggal</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Wilayah</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Rute Asal</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Rute Tujuan</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Muatan</th>
              <th className="text-right px-3 py-2.5 border-b border-slate-200">Unit</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Foto</th>
              <th className="text-right px-4 py-2.5 border-b border-slate-200">Pendapatan</th>
              <th className="border-b border-slate-200 w-8" />
            </tr>
          </thead>
          <tbody>
            {reportState === 'offline' ? (
              <tr><td colSpan={11} className="p-8 text-center text-slate-400">Offline</td></tr>
            ) : reportState !== 'ready' ? (
              <tr><td colSpan={11} className="p-8 text-center text-slate-400 animate-pulse">Memuat...</td></tr>
            ) : reportTrips.length === 0 ? (
              <tr><td colSpan={11} className="p-8 text-center text-slate-400">Belum ada trip</td></tr>
            ) : (() => {
              // Group trips by date for cleaner hierarchy
              const groupedByDate = reportTrips.reduce((acc, t) => {
                const date = dayKeyWib(t.created_at)
                if (!acc[date]) acc[date] = []
                acc[date].push(t)
                return acc
              }, {} as Record<string, typeof reportTrips>)

              const sortedDates = Object.keys(groupedByDate).sort((a, b) => b.localeCompare(a))
              let globalIdx = 0

              return sortedDates.flatMap(date => {
                const dayTrips = groupedByDate[date]
                const dayTotal = dayTrips.reduce((s, t) => s + (t.vehicle_count || 0), 0)
                const dayRevenue = dayTrips.reduce((s, t) => s + (t.trip_revenue || 0), 0)
                const dateObj = new Date(date + 'T00:00:00')
                const formattedDate = dateObj.toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

                return [
                  // Date group header row
                  <tr key={`date-${date}`} className="bg-slate-800 text-white">
                    <td colSpan={3} className="px-4 py-2.5 font-bold text-sm">
                      <span className="flex items-center gap-1">
                        <Calendar size={14} className="text-slate-400" />
                        {formattedDate}
                      </span>
                      <span className="ml-3 text-slate-300 text-xs font-normal">({dayTrips.length} trip - {dayTotal} unit)</span>
                    </td>
                    <td colSpan={5} className="px-3 py-2.5 text-right">
                      <span className="text-slate-300 text-xs">Total:</span>
                    </td>
                    <td colSpan={2} className="px-4 py-2.5 text-right font-black text-sm">
                      <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={dayRevenue} className="text-emerald-300" />
                    </td>
                    <td />
                  </tr>,
                  // Trip rows for this date
                  ...dayTrips.map((t) => {
                    const open = openTripId === t.id
                    const d = formatReportDateTime(t.created_at)
                    const currentIdx = globalIdx++
                    return (
                      <Fragment key={t.id}>
                        <tr onClick={() => setOpenTripId(open ? null : t.id)}
                          className={`cursor-pointer hover:bg-slate-50 transition-colors duration-150 ${open ? 'bg-blue-50/60' : currentIdx % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                          <td className="px-4 py-2.5 text-slate-400 tabular-nums align-middle">{currentIdx + 1}</td>
                          <td className="px-3 py-2.5 font-mono font-semibold text-slate-700">{t.no_trip}</td>
                          <td className="px-3 py-2.5 text-slate-500 text-xs">{d.time}</td>
                          <td className="px-3 py-2.5 text-slate-700">{t.region_name || '-'}</td>
                          <td className="px-3 py-2.5 text-slate-600">{t.route_from_name || t.route_from || '-'}</td>
                          <td className="px-3 py-2.5 text-slate-600">{t.route_to_name || t.route_to || '-'}</td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${t.status_muatan === 'muatan' ? 'border-slate-300 text-slate-700' : 'border-slate-200 text-slate-400'}`}>
                              {t.status_muatan === 'muatan' ? 'Ada' : 'Kosong'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{t.vehicle_count}</td>
                          <td className="px-3 py-2.5">
                            {(() => {
                              const thumbs = [
                                ...(t.selfie_photo ? [{ id: `selfie-${t.id}`, url: t.selfie_photo, caption: `${t.no_trip} - Swafoto petugas` }] : []),
                                ...(t.foto_kosong_path ? [{ id: `trip-${t.id}`, url: t.foto_kosong_path, caption: `${t.no_trip} - Bukti trip` }] : []),
                                ...t.vehicles.filter(v => v.foto_path).map(v => ({ id: `vehicle-${v.id}`, url: v.foto_path as string, caption: vehiclePhotoCaption(t, v, geoRules) })),
                              ]
                              if (thumbs.length === 0) return <span className="text-[11px] text-slate-400">-</span>
                              return (
                                <button
                                  type="button"
                                  onClick={e => { e.stopPropagation(); setViewingPhotos(thumbs) }}
                                  className="flex items-center gap-1 rounded-lg hover:ring-2 hover:ring-blue-400"
                                  aria-label={`Lihat ${thumbs.length} foto ${t.no_trip}`}
                                >
                                  {thumbs.slice(0, 3).map(p => (
                                    <img
                                      key={p.id}
                                      src={resolvePhotoUrl(p.url, baseUrl)}
                                      alt=""
                                      loading="lazy"
                                      className="h-9 w-9 rounded-md object-cover ring-1 ring-slate-200"
                                    />
                                  ))}
                                  <span className="text-[10px] font-semibold text-slate-500">{thumbs.length}</span>
                                </button>
                              )
                            })()}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={t.trip_revenue || 0} />
                          </td>
                          <td className="px-2 py-2.5 text-center text-slate-400"><ChevronRight size={14} className="mx-auto" /></td>
                        </tr>
                        {open && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={11} className="px-4 py-3">
                        <div className="text-[12px] text-slate-600 mb-3">
                          <span className="font-semibold mr-4">Petugas: {t.officer_name || '-'}</span>
                          <span>Kategori: {t.keterangan || '-'}</span>
                        </div>
                        {t.selfie_photo && (
                          <div className="flex items-center gap-3 mb-3 p-3 rounded-xl border border-slate-200 bg-white max-w-xl">
                            <button
                              type="button"
                              onClick={() => setViewingPhotos([{
                                id: `selfie-${t.id}`,
                                url: t.selfie_photo!,
                                caption: `${t.no_trip} - Swafoto petugas`,
                              }])}
                              className="w-16 h-12 shrink-0 overflow-hidden rounded-lg bg-slate-100"
                              aria-label={`Lihat swafoto petugas ${t.no_trip}`}
                            >
                              <img src={resolvePhotoUrl(t.selfie_photo, baseUrl)} alt="" className="w-full h-full object-cover" />
                            </button>
                            <span className="text-[12px] font-semibold text-slate-700">Swafoto petugas</span>
                          </div>
                        )}
                        {t.foto_kosong_path && (
                          <div className="flex items-center gap-3 mb-3 p-3 rounded-xl border border-slate-200 bg-white max-w-xl">
                            <button
                              type="button"
                              onClick={() => setViewingPhotos([{
                                id: `trip-${t.id}`,
                                url: t.foto_kosong_path!,
                                caption: `${t.no_trip} - Bukti trip`,
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
                                      <>
                                        <button
                                          type="button"
                                          onClick={() => setViewingPhotos([{
                                            id: `vehicle-${v.id}`,
                                            url: v.foto_path!,
                                            caption: vehiclePhotoCaption(t, v, geoRules),
                                          }])}
                                          className="block w-16 h-12 sm:w-20 sm:h-14 overflow-hidden rounded-lg bg-slate-100 ring-1 ring-slate-200 hover:ring-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                          aria-label={`Lihat foto kendaraan ${v.no_polisi}`}
                                        >
                                          <img src={resolvePhotoUrl(v.foto_path, baseUrl)} alt={`Kendaraan ${v.no_polisi}`} className="w-full h-full object-cover" />
                                        </button>
                                        <span className="block mt-1 text-[9px] font-black uppercase text-slate-500">
                                          {vehicleUnitLabel(t.vehicles, v)}
                                        </span>
                                      </>
                                    ) : <span className="text-[10px] text-slate-400">Tidak ada foto</span>}
                                  </td>
                                  <td className="p-3 font-mono font-bold">{v.no_polisi}</td>
                                  <td className="p-3">{v.vehicle_type}</td>
                                  <td className="p-3"><span className={`px-2 py-1 rounded text-[10px] font-semibold border ${reportGolongan(v) === 'Internal' ? 'border-slate-800 text-slate-800' : reportGolongan(v) === 'Eksternal' ? 'border-slate-400 text-slate-600' : 'border-slate-200 text-slate-500'}`}>{reportGolongan(v)}</span></td>
                                  <td className="p-3">{v.has_load ? 'Ada Muatan' : 'Kosong'}</td>
                                  <td className="p-3 text-right">
                                    <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={v.tariff_amount || 0} />
                                    <span className="block text-[9px] font-normal text-slate-400 mt-0.5">{tarifSourceLabel(v.tarif_source)}</span>
                                  </td>
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
              })
              ]
            })
            })()}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold text-slate-700">
              <td colSpan={11} className="px-4 py-3 border-t-2 border-slate-300 text-right text-[12px]">
                Total {totalTrip} trip - {totalUnit} unit
                <span className="ml-4">
                  <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={totalRevenue} className="text-emerald-700 font-black" />
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
