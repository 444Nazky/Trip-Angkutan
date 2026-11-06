import { Fragment, useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronRight, ExternalLink, Eye, EyeOff, Table2, Calendar } from 'lucide-react'
import { fetchTrips, fetchTripReports, fetchReportFilters, fetchTripCancellations, formatReportDateTime, dayKeyWib, vehicleUnitLabel, reportGolongan, tarifSourceLabel, type BackendTrip, type ReportTrip, type ReportFilters, type TripCancellation, type ReportDermagaOption, type ReportRouteOption } from '../../../services/trips'
import { CurrencyDisplay } from '../components/CurrencyDisplay'
import { BreakdownSummaryCard } from '../components/BreakdownSummaryCard'
import { PhotoViewer, resolvePhotoUrl } from '../components/PhotoViewer'
import { fetchGeofenceRules, type GeofenceRule } from '../../../services/geofences'
import { ensureAdminSession, SESSION_READY_EVENT } from '../../../services/auth'
import { locationDistanceText } from '../../../services/locationDistance'
import { fetchVehicleTypes, getStoredVehicleTypes } from '../../../services/vehicleTypes'



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
  /** Buka tab "Pembatalan Trip" (pemantauan lengkap). */
  onOpenCancellations?: () => void
}



export function ReportsTab({ onServerTripsChange, revealed, onToggleReveal, baseUrl = '', onOpenCancellations }: ReportsTabProps) {
  const [reportTrips, setReportTrips] = useState<ReportTrip[]>([])
  const [reportState, setReportState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  // Mode tampilan tabel trip (halaman dashboard saja; halaman detail
  // kendaraan tidak terpengaruh):
  //   'collapse' -> hanya header tanggal yang tampil (trip disembunyikan)
  //   'header'   -> header tanggal + baris trip, detail kendaraan ditutup
  //   'all'      -> semua terbuka termasuk detail tiap trip (default)
  const [expandMode, setExpandMode] = useState<'collapse' | 'header' | 'all'>('all')
  const [closedDates, setClosedDates] = useState<Set<string>>(new Set())
  const [closedTrips, setClosedTrips] = useState<Set<string>>(new Set())
  const [openTrips, setOpenTrips] = useState<Set<string>>(new Set())

  const toggleId = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  const tripDetailOpen = (id: string) =>
    expandMode === 'all' ? !closedTrips.has(id) : openTrips.has(id)
  const toggleTrip = (id: string) => {
    if (expandMode === 'all') setClosedTrips(prev => toggleId(prev, id))
    else setOpenTrips(prev => toggleId(prev, id))
  }
  const toggleDate = (date: string, allDates: string[]) => {
    if (expandMode === 'collapse') {
      // Dari keadaan serba tertutup: klik satu tanggal = buka hanya tanggal itu.
      setClosedDates(new Set(allDates.filter(d => d !== date)))
      setExpandMode('header')
      return
    }
    setClosedDates(prev => toggleId(prev, date))
  }
  const expandTo = (mode: 'collapse' | 'header' | 'all') => {
    setExpandMode(mode)
    setClosedDates(new Set())
    setClosedTrips(new Set())
    setOpenTrips(new Set())
  }
  // Badge golongan per trip: gabungkan kategori operasional kendaraan di
  // trip tsb (bisa campuran). Jujur dari data, bukan satu label global.
  const tripGolongan = (t: ReportTrip): string => {
    const gs = [...new Set((t.vehicles ?? []).map(v => reportGolongan(v)))]
    return gs.length > 0 ? gs.join(' + ') : '-'
  }
  const [reportFilters, setReportFilters] = useState<ReportFilters>({})
  const [filterOptions, setFilterOptions] = useState<{ golongan: string[]; vehicleTypes: string[]; dermagas: ReportDermagaOption[]; routes: ReportRouteOption[] }>({ golongan: [], vehicleTypes: [], dermagas: [], routes: [] })
  const [viewingPhotos, setViewingPhotos] = useState<{ id: string; url: string; caption?: string }[] | null>(null)

  const [geoRules, setGeoRules] = useState<GeofenceRule[]>([])
  // Master jenis kendaraan (/vehicle-types) - supaya breakdown menampilkan
  // SEMUA jenis, termasuk yang belum punya trip pada filter ini.
  const [vehicleTypeNames, setVehicleTypeNames] = useState<string[]>([])
  // Dokumen pembatalan trip (dari aplikasi mobile), hanya pada rentang
  // tanggal yang sama dengan laporan - supaya angka di kartu Total Trip
  // cocok dengan /reports/trips dan database.
  const [cancellations, setCancellations] = useState<TripCancellation[]>([])

  const cancelFilters = useMemo(
    () => ({ startDate: reportFilters.startDate, endDate: reportFilters.endDate }),
    [reportFilters],
  )
  const loadCancellations = useCallback(() => {
    fetchTripCancellations(cancelFilters)
      .then(c => { if (c) setCancellations(c) })
      .catch(() => null)
  }, [cancelFilters])

  useEffect(() => { loadCancellations() }, [loadCancellations])

  /**
   * Muat laporan dari server.
   *
   * Dua jebakan yang dulu membuat trip "hilang" dari dashboard:
   *   1. Tab Laporan bisa mount SEBELUM sesi admin siap -> 403 -> state
   *      'offline' dan tidak pernah dicoba lagi. Sekarang: pastikan sesi,
   *      lalu ulangi; kalau tetap gagal, tampilkan alasannya (bukan cuma
   *      kata "Offline") supaya penyebabnya bisa ditindaklanjuti.
   *   2. Server sempat menjawab 5xx/timeout sesaat -> satu percobaan langsung
   *      dianggap gagal permanen. Sekarang ada beberapa percobaan berjeda.
   */
  const loadReports = useCallback(async (filters?: ReportFilters, opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    if (!silent) {
      setReportState('loading')
      setReportError(null)
    }
    const f = filters ?? reportFilters

    let rows = await fetchTripReports(f)
    if (rows === null) {
      // Sesi admin belum siap (atau basi) -> siapkan lalu ulangi.
      const sess = await ensureAdminSession()
      if (sess.ok) rows = await fetchTripReports(f)
      else {
        setReportState('offline')
        setReportError(sess.error ?? 'Sesi admin tidak bisa dibuat')
        return
      }
    }

    if (rows === null) {
      // Beberapa percobaan lagi dengan jeda pendek (server sesaat bermasalah).
      for (let attempt = 0; attempt < 2 && rows === null; attempt++) {
        await new Promise(r => setTimeout(r, 1200))
        rows = await fetchTripReports(f)
      }
    }

    if (rows === null) {
      setReportState('offline')
      setReportError('Server tidak menjawab permintaan laporan.')
      return
    }
    setReportTrips(rows)
    setReportState('ready')
    setReportError(null)
  }, [reportFilters])

  // Pemulihan otomatis: begitu sesi backend siap (event dari auth), muat ulang
  // laporan yang sebelumnya offline tanpa perlu interaksi pengguna.
  useEffect(() => {
    const onReady = () => { void loadReports() }
    window.addEventListener(SESSION_READY_EVENT, onReady)
    return () => window.removeEventListener(SESSION_READY_EVENT, onReady)
  }, [loadReports])

  // Auto-refresh berkala: trip baru dari mobile harus langsung terlihat di
  // dashboard tanpa perlu menekan tombol Refresh. Hanya jalan saat tab terlihat
  // supaya tidak membebani server.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void loadReports(undefined, { silent: true })
      loadCancellations()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [loadReports, loadCancellations])

  useEffect(() => {
    if (reportState === 'idle') {
      Promise.all([fetchReportFilters(), fetchTrips()]).then(([opts, trips]) => {
        if (opts) setFilterOptions({
          golongan: opts.golongan ?? [],
          vehicleTypes: opts.vehicleTypes ?? [],
          dermagas: opts.dermagas ?? [],
          routes: opts.routes ?? [],
        })
        if (trips) onServerTripsChange(trips)
      })
      void loadReports()

      fetchGeofenceRules().then(rules => { if (rules) setGeoRules(rules) }).catch(() => null)
      fetchVehicleTypes()
        .then(rows => {
          const names = (rows ?? getStoredVehicleTypes())
            .filter(t => t.isActive !== false)
            .slice()
            .sort((a, b) => (a.sortOrder - b.sortOrder) || a.name.localeCompare(b.name))
            .map(t => t.name)
            .filter(Boolean)
          if (names.length > 0) setVehicleTypeNames(names)
        })
        .catch(() => null)
    }
    // Semua kerja di dalam blok ini dijaga `reportState === 'idle'`, sehingga
    // penambahan dependency tidak memicu fetch ulang saat filter berubah.
  }, [reportState, loadReports, onServerTripsChange])

  const applyReportFilter = (patch: Partial<ReportFilters>) => {
    let next = { ...reportFilters, ...patch }
    const today = dayKeyWib(new Date().toISOString())
    if (next.startDate && !next.endDate) next = { ...next, endDate: today }
    if (next.endDate && !next.startDate) next = { ...next, startDate: '1970-01-01' }
    setReportFilters(next)
    void loadReports(next)
  }

  const applyDatePreset = (days: number | null) => {
    if (!days) { clearReportFilters(); return }
    const today = dayKeyWib(new Date().toISOString())
    const start = dayKeyWib(new Date(Date.now() - (days - 1) * 86400000).toISOString())
    const next: ReportFilters = { ...reportFilters, startDate: start, endDate: today }
    setReportFilters(next)
    void loadReports(next)
  }

  const clearReportFilters = () => {
    setReportFilters({})
    void loadReports({})
  }

  // Jenis kendaraan: ambil dari master vehicle_types (semua pilihan sah),
  // bukan dari trip yang sudah terkirim. Fallback ke opsi server bila master
  // gagal dimuat.
  const jenisOptions = vehicleTypeNames.length > 0 ? vehicleTypeNames : filterOptions.vehicleTypes
  const golonganOptions = filterOptions.golongan
  const dermagaOptions = filterOptions.dermagas
  const routeOptions = filterOptions.routes

  const totalTrip = reportTrips.length
  const totalUnit = reportTrips.reduce((s, t) => s + (t.vehicle_count || 0), 0)
  const totalRevenue = reportTrips.reduce((s, t) => s + (t.trip_revenue || 0), 0)
  const muatanCount = reportTrips.filter(t => t.status_muatan === 'muatan').length
  const muatanPct = totalTrip ? (muatanCount / totalTrip) * 100 : 0
  const tanpaMuatan = totalTrip - muatanCount
  const tanpaMuatanPct = totalTrip ? (tanpaMuatan / totalTrip) * 100 : 0
  const avgRevenuePerTrip = totalTrip ? Math.round(totalRevenue / totalTrip) : 0

  // Server membatasi /reports/trips ke 1000 baris terbaru. Kalau tepat di batas,
  // angka di dasbor (termasuk breakdown) belum tentu penuh - beri tahu operator.
  const reportTruncated = reportTrips.length >= 1000

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Laporan Trip</h3>
          <p className="text-slate-500 text-[12px]">Data trip, kendaraan, dan tarif. Kendaraan Internal tidak ditagih (Rp 0).</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-slate-200 ${
            reportState === 'ready' ? 'text-slate-600' : reportState === 'offline' ? 'text-amber-700 border-amber-200' : 'text-slate-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${reportState === 'ready' ? 'bg-emerald-500' : reportState === 'offline' ? 'bg-amber-500' : 'bg-slate-400 animate-pulse'}`} />
            {reportState === 'ready' ? 'Tersambung' : reportState === 'offline' ? 'Gagal memuat' : 'Memuat...'}
          </span>
          {reportState === 'offline' && reportError && (
            <span className="text-[11px] font-semibold text-red-600 max-w-[280px] truncate" title={reportError}>
              {reportError}
            </span>
          )}
          <button onClick={() => void loadReports()} disabled={reportState === 'loading'}
            className="border border-slate-200 text-slate-700 px-3.5 py-2 rounded-lg font-semibold text-sm hover:bg-slate-50 disabled:opacity-50">
            Refresh
          </button>

          <button onClick={() => { window.location.hash = '#/sheet' }} disabled={reportState !== 'ready'}
            title="Buka detail kendaraan per trip - tersinkron langsung dari database"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700 disabled:opacity-50">
            <Table2 size={15} /> Detail Kendaraan
          </button>
          <button onClick={() => window.open(`${window.location.pathname}#/sheet`, '_blank')} disabled={reportState !== 'ready'}
            title="Buka detail kendaraan di tab baru" aria-label="Buka detail kendaraan di tab baru"
            className="border border-slate-200 text-slate-600 px-2.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
            <ExternalLink size={15} />
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
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1.5">Dermaga</label>
          <select value={reportFilters.dermagaId || ''} onChange={e => applyReportFilter({ dermagaId: e.target.value || undefined })}
            className="border rounded-xl px-3 py-2 text-sm min-w-[150px] bg-white">
            <option value="">Semua</option>
            {dermagaOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1.5">Rute</label>
          <select value={reportFilters.routeId || ''} onChange={e => applyReportFilter({ routeId: e.target.value || undefined })}
            className="border rounded-xl px-3 py-2 text-sm min-w-[210px] bg-white">
            <option value="">Semua</option>
            {routeOptions.map(r => (
              <option key={r.id} value={r.id}>
                {r.route_from} → {r.route_to}{r.dermaga_name ? ` · ${r.dermaga_name}` : ''}
              </option>
            ))}
          </select></div>
      </div>

      {reportState === 'ready' && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center flex flex-col items-center justify-center">
            <p className="text-slate-400 text-[11px] font-semibold uppercase">Total Trip</p>
            <p className="text-2xl font-black text-slate-900 mt-2 tabular-nums leading-none">{totalTrip}</p>
            <p className="mt-1 text-[10px] font-bold text-slate-400">
              Trip Berhasil: {totalTrip} Trip
              <span className="mx-1.5 text-slate-200">|</span>
              Trip Dibatalkan: {cancellations.length} Trip
            </p>
            <button
              onClick={() => onOpenCancellations?.()}
              disabled={!onOpenCancellations}
              className="mt-2 text-[10px] font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Buka Pemantauan
            </button>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center flex flex-col items-center justify-center">
            <p className="text-slate-400 text-[11px] font-semibold uppercase">Trip Bermuatan</p>
            <p className="text-2xl font-black text-slate-900 mt-2 tabular-nums leading-none">{muatanCount}</p>
            <p className="mt-2 text-[10px] font-bold text-slate-400">{muatanPct.toFixed(0)}% dari total trip</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center flex flex-col items-center justify-center">
            <p className="text-slate-400 text-[11px] font-semibold uppercase">Trip Tanpa Muatan</p>
            <p className="text-2xl font-black text-slate-900 mt-2 tabular-nums leading-none">{tanpaMuatan}</p>
            <p className="mt-2 text-[10px] font-bold text-slate-400">{tanpaMuatanPct.toFixed(0)}% dari total trip</p>
          </div>
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm text-center flex flex-col items-center justify-center">
            <p className="text-slate-400 text-[11px] font-semibold uppercase">Pendapatan</p>
            <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={totalRevenue} className="text-2xl font-black text-slate-900 mt-2" />
            <p className="mt-2 text-[10px] font-bold text-slate-400">
              Rata-rata <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={avgRevenuePerTrip} className="inline font-black text-slate-500" /> / trip
            </p>
          </div>
        </div>
      )}

      {reportTruncated && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-[11px] font-semibold text-amber-800">
          Menampilkan 1000 trip terbaru dari server. Persempit rentang tanggal agar angka di dasbor dan breakdown akurat.
        </p>
      )}

      {reportState === 'ready' && totalTrip > 0 && (
        <BreakdownSummaryCard reportTrips={reportTrips} vehicleTypes={vehicleTypeNames} revealed={revealed} onToggleReveal={onToggleReveal} />
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
              <th colSpan={12} className="px-4 py-3 border-b border-slate-200">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex gap-1.5">
                    {([
                      ['collapse', 'Collapse All'],
                      ['header', 'Expand Header'],
                      ['all', 'Expand All'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => expandTo(value)}
                        aria-pressed={expandMode === value}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                          expandMode === value
                            ? 'border-blue-600 bg-blue-600 text-white'
                            : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
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
                </div>
              </th>
            </tr>
            <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="text-left px-4 py-2.5 border-b border-slate-200 w-8">#</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">No Trip</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Jam</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Wilayah</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Rute Asal</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Rute Tujuan</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Muatan</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Golongan</th>
              <th className="text-right px-3 py-2.5 border-b border-slate-200">Unit</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Foto</th>
              <th className="text-right px-4 py-2.5 border-b border-slate-200">Pendapatan</th>
              <th className="border-b border-slate-200 w-8" />
            </tr>
          </thead>
          <tbody>
            {reportState === 'offline' ? (
              <tr>
                <td colSpan={12} className="p-8 text-center">
                  <p className="text-slate-500 font-semibold">Laporan tidak bisa dimuat</p>
                  <p className="text-[12px] text-slate-400 mt-1">{reportError ?? 'Server tidak menjawab.'}</p>
                  <button
                    onClick={() => void loadReports()}
                    className="mt-3 border border-slate-200 text-slate-700 px-3.5 py-2 rounded-lg font-semibold text-sm hover:bg-slate-50"
                  >
                    Coba Lagi
                  </button>
                </td>
              </tr>
            ) : reportState !== 'ready' ? (
              <tr><td colSpan={12} className="p-8 text-center text-slate-400 animate-pulse">Memuat...</td></tr>
            ) : reportTrips.length === 0 ? (
              <tr><td colSpan={12} className="p-8 text-center text-slate-400">Belum ada trip</td></tr>
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
                const dateVisible = expandMode !== 'collapse' && !closedDates.has(date)

                return [
                  // Date group header row (klik = buka/tutup grup tanggal ini)
                  <tr key={`date-${date}`} onClick={() => toggleDate(date, sortedDates)}
                    className="bg-slate-800 text-white cursor-pointer hover:bg-slate-700 transition-colors">
                    <td colSpan={3} className="px-4 py-2.5 font-bold text-sm">
                      <span className="flex items-center gap-1">
                        <Calendar size={14} className="text-slate-400" />
                        {formattedDate}
                        <ChevronRight size={14} className={`text-slate-400 transition-transform ${dateVisible ? 'rotate-90' : ''}`} />
                      </span>
                      <span className="ml-3 text-slate-300 text-xs font-normal">({dayTrips.length} trip - {dayTotal} unit)</span>
                    </td>
                    <td colSpan={6} className="px-3 py-2.5 text-right">
                      <span className="text-slate-300 text-xs">Total:</span>
                    </td>
                    <td colSpan={2} className="px-4 py-2.5 text-right font-black text-sm">
                      <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={dayRevenue} className="text-emerald-300" />
                    </td>
                    <td />
                  </tr>,
                  // Trip rows for this date (hanya kalau grup tanggal terbuka)
                  ...(dateVisible ? dayTrips.map((t) => {
                    const open = tripDetailOpen(t.id)
                    const d = formatReportDateTime(t.created_at)
                    const currentIdx = globalIdx++
                    return (
                      <Fragment key={t.id}>
                        <tr onClick={() => toggleTrip(t.id)}
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
                          <td className="px-3 py-2.5">
                            {(() => {
                              const g = tripGolongan(t)
                              const tone = g.includes('Internal')
                                ? 'border-slate-800 text-slate-800'
                                : g.includes('Eksternal')
                                  ? 'border-slate-400 text-slate-600'
                                  : 'border-slate-200 text-slate-500'
                              return <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${tone}`}>{g}</span>
                            })()}
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
                            {(t.vehicles ?? []).length > 0 && (t.vehicles ?? []).every(v => String(v.tarif_source ?? '') === 'internal') && (
                              <span className="block text-[9px] font-normal text-slate-400 mt-0.5">Internal - tidak ditagih</span>
                            )}
                          </td>
                          <td className="px-2 py-2.5 text-center text-slate-400"><ChevronRight size={14} className="mx-auto" /></td>
                        </tr>
                        {open && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={12} className="px-4 py-3">
                        <div className="text-[12px] text-slate-600 mb-3">
                          <span className="font-semibold mr-4">Petugas: {t.officer_name || '-'}</span>
                          <span className="mr-4">Dermaga: {t.dermaga_name || '-'}</span>
                          <span className="mr-4">Rute: {t.route_name || `${t.route_from || '-'} → ${t.route_to || '-'}`}</span>
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
              }) : [])
              ]
            })
            })()}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold text-slate-700">
              <td colSpan={12} className="px-4 py-3 border-t-2 border-slate-300 text-right text-[12px]">
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
