import { useState, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Camera, ChevronRight, ExternalLink, Eye, EyeOff, Table2 } from 'lucide-react'
import { fetchTrips, fetchTripReports, fetchReportFilters, fetchTripCancellations, formatReportDateTime, dayKeyWib, vehicleUnitLabel, reportGolongan, type BackendTrip, type ReportTrip, type ReportFilters, type TripCancellation, type ReportDermagaOption, type ReportRouteOption } from '../../../services/trips'
import { CurrencyDisplay } from '../components/CurrencyDisplay'
import { BreakdownSummaryCard } from '../components/BreakdownSummaryCard'
import { PhotoViewer } from '../components/PhotoViewer'
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
  // Mode tampilan tabel kendaraan (halaman dashboard saja). Semua data
  // digabung dan dikelompokkan menjadi 3 bagian: Internal, Eksternal, Lokal.
  //   'collapse' -> hanya baris grup golongan yang tampil
  //   'header'   -> semua grup terbuka (default)
  //   'all'      -> sama dengan 'header' (tabel hanya 2 level)
  const [expandMode, setExpandMode] = useState<'collapse' | 'header' | 'all'>('header')
  const [openGols, setOpenGols] = useState<Set<string>>(new Set())
  const [closedGols, setClosedGols] = useState<Set<string>>(new Set())

  const toggleId = (set: Set<string>, id: string) => {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }
  // Klik grup golongan: mode 'collapse' -> buka/tutup grup itu saja; mode
  // lain -> tutup/buka grup itu tanpa memengaruhi grup lain.
  const toggleGol = (key: string) => {
    if (expandMode === 'collapse') setOpenGols(prev => toggleId(prev, key))
    else setClosedGols(prev => toggleId(prev, key))
  }
  const expandTo = (mode: 'collapse' | 'header' | 'all') => {
    setExpandMode(mode)
    setOpenGols(new Set())
    setClosedGols(new Set())
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
          <h3 className="font-black text-[var(--admin-text)] text-lg">Laporan Trip</h3>
          <p className="text-[var(--admin-text-muted)] text-[12px]">Data trip, kendaraan, dan tarif. Kendaraan Internal tidak ditagih (Rp 0).</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border border-[var(--admin-border)] ${
            reportState === 'ready' ? 'text-[var(--admin-text-muted)]' : reportState === 'offline' ? 'text-[var(--admin-warning-text)] border-[var(--admin-warning-border)]' : 'text-[var(--admin-text-faint)]'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${reportState === 'ready' ? 'bg-[var(--admin-success)]' : reportState === 'offline' ? 'bg-[var(--admin-warning)]' : 'bg-[var(--admin-neutral)] animate-pulse'}`} />
            {reportState === 'ready' ? 'Tersambung' : reportState === 'offline' ? 'Gagal memuat' : 'Memuat...'}
          </span>
          {reportState === 'offline' && reportError && (
            <span className="text-[11px] font-semibold text-[var(--admin-danger-text)] max-w-[280px] truncate" title={reportError}>
              {reportError}
            </span>
          )}
          <button onClick={() => void loadReports()} disabled={reportState === 'loading'}
            className="border border-[var(--admin-border)] text-[var(--admin-text-soft)] px-3.5 py-2 rounded-lg font-semibold text-sm hover:bg-[var(--admin-surface-hover)] disabled:opacity-50">
            Refresh
          </button>

          <button onClick={() => { window.location.hash = '#/sheet' }} disabled={reportState !== 'ready'}
            title="Buka detail kendaraan per trip - tersinkron langsung dari database"
            className="bg-[var(--admin-accent)] text-[var(--admin-accent-contrast)] px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-[var(--admin-accent-hover)] disabled:opacity-50">
            <Table2 size={15} /> Detail Kendaraan
          </button>
          <button onClick={() => window.open(`${window.location.pathname}#/sheet`, '_blank')} disabled={reportState !== 'ready'}
            title="Buka detail kendaraan di tab baru" aria-label="Buka detail kendaraan di tab baru"
            className="border border-[var(--admin-border)] text-[var(--admin-text-muted)] px-2.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-[var(--admin-surface-hover)] disabled:opacity-50">
            <ExternalLink size={15} />
          </button>
        </div>
      </div>

      <div className="bg-[var(--admin-surface)] rounded-2xl p-4 border border-[var(--admin-border)] shadow-[var(--admin-shadow-card)] flex flex-wrap items-end gap-4">
        <div><label className="text-[11px] font-bold text-[var(--admin-text-muted)] block mb-1.5">Dari</label>
          <input type="date" value={reportFilters.startDate || ''} onChange={e => applyReportFilter({ startDate: e.target.value || undefined })}
            className="border border-[var(--admin-border)] rounded-xl px-3 py-2 text-sm bg-[var(--admin-surface)] text-[var(--admin-text-soft)]" /></div>
        <div><label className="text-[11px] font-bold text-[var(--admin-text-muted)] block mb-1.5">Sampai</label>
          <input type="date" value={reportFilters.endDate || ''} onChange={e => applyReportFilter({ endDate: e.target.value || undefined })}
            className="border border-[var(--admin-border)] rounded-xl px-3 py-2 text-sm bg-[var(--admin-surface)] text-[var(--admin-text-soft)]" /></div>
        <div className="flex gap-1.5">
          {[{ label: 'Hari Ini', days: 1 }, { label: '7 Hari', days: 7 }, { label: '30 Hari', days: 30 }].map(p => (
            <button key={p.label} onClick={() => applyDatePreset(p.days)}
              className="px-3 py-1.5 rounded-lg border border-[var(--admin-border)] text-[11px] font-bold text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]">
              {p.label}
            </button>
          ))}
        </div>
        <div><label className="text-[11px] font-bold text-[var(--admin-text-muted)] block mb-1.5">Golongan</label>
          <select value={reportFilters.golongan || ''} onChange={e => applyReportFilter({ golongan: e.target.value || undefined })}
            className="border border-[var(--admin-border)] rounded-xl px-3 py-2 text-sm min-w-[140px] bg-[var(--admin-surface)] text-[var(--admin-text-soft)]">
            <option value="">Semua</option>
            {golonganOptions.map(g => <option key={g} value={g}>{g}</option>)}
          </select></div>
        <div><label className="text-[11px] font-bold text-[var(--admin-text-muted)] block mb-1.5">Jenis Kendaraan</label>
          <select value={reportFilters.vehicleType || ''} onChange={e => applyReportFilter({ vehicleType: e.target.value || undefined })}
            className="border border-[var(--admin-border)] rounded-xl px-3 py-2 text-sm min-w-[150px] bg-[var(--admin-surface)] text-[var(--admin-text-soft)]">
            <option value="">Semua</option>
            {jenisOptions.map(j => <option key={j} value={j}>{j}</option>)}
          </select></div>
        <div><label className="text-[11px] font-bold text-[var(--admin-text-muted)] block mb-1.5">Dermaga</label>
          <select value={reportFilters.dermagaId || ''} onChange={e => applyReportFilter({ dermagaId: e.target.value || undefined })}
            className="border border-[var(--admin-border)] rounded-xl px-3 py-2 text-sm min-w-[150px] bg-[var(--admin-surface)] text-[var(--admin-text-soft)]">
            <option value="">Semua</option>
            {dermagaOptions.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select></div>
        <div><label className="text-[11px] font-bold text-[var(--admin-text-muted)] block mb-1.5">Rute</label>
          <select value={reportFilters.routeId || ''} onChange={e => applyReportFilter({ routeId: e.target.value || undefined })}
            className="border border-[var(--admin-border)] rounded-xl px-3 py-2 text-sm min-w-[210px] bg-[var(--admin-surface)] text-[var(--admin-text-soft)]">
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
          <div className="bg-[var(--admin-surface)] rounded-2xl p-5 border border-[var(--admin-border)] shadow-[var(--admin-shadow-card)] text-center flex flex-col items-center justify-center">
            <p className="text-[var(--admin-text-faint)] text-[11px] font-semibold uppercase">Total Trip</p>
            <p className="text-2xl font-black text-[var(--admin-text)] mt-2 tabular-nums leading-none">{totalTrip}</p>
            <p className="mt-1 text-[10px] font-bold text-[var(--admin-text-faint)]">
              Trip Berhasil: {totalTrip} Trip
              <span className="mx-1.5 text-[var(--admin-border-strong)]">|</span>
              Trip Dibatalkan: {cancellations.length} Trip
            </p>
            <button
              onClick={() => onOpenCancellations?.()}
              disabled={!onOpenCancellations}
              className="mt-2 text-[10px] font-bold px-3 py-1.5 rounded-lg border border-[var(--admin-border)] text-[var(--admin-text-muted)] transition-colors hover:bg-[var(--admin-surface-hover)] disabled:opacity-50"
            >
              Buka Pemantauan
            </button>
          </div>
          <div className="bg-[var(--admin-surface)] rounded-2xl p-5 border border-[var(--admin-border)] shadow-[var(--admin-shadow-card)] text-center flex flex-col items-center justify-center">
            <p className="text-[var(--admin-text-faint)] text-[11px] font-semibold uppercase">Trip Bermuatan</p>
            <p className="text-2xl font-black text-[var(--admin-text)] mt-2 tabular-nums leading-none">{muatanCount}</p>
            <p className="mt-2 text-[10px] font-bold text-[var(--admin-text-faint)]">{muatanPct.toFixed(0)}% dari total trip</p>
          </div>
          <div className="bg-[var(--admin-surface)] rounded-2xl p-5 border border-[var(--admin-border)] shadow-[var(--admin-shadow-card)] text-center flex flex-col items-center justify-center">
            <p className="text-[var(--admin-text-faint)] text-[11px] font-semibold uppercase">Trip Tanpa Muatan</p>
            <p className="text-2xl font-black text-[var(--admin-text)] mt-2 tabular-nums leading-none">{tanpaMuatan}</p>
            <p className="mt-2 text-[10px] font-bold text-[var(--admin-text-faint)]">{tanpaMuatanPct.toFixed(0)}% dari total trip</p>
          </div>
          <div className="bg-[var(--admin-surface)] rounded-2xl p-5 border border-[var(--admin-border)] shadow-[var(--admin-shadow-card)] text-center flex flex-col items-center justify-center">
            <p className="text-[var(--admin-text-faint)] text-[11px] font-semibold uppercase">Pendapatan</p>
            <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={totalRevenue} className="text-2xl font-black text-[var(--admin-text)] mt-2" />
            <p className="mt-2 text-[10px] font-bold text-[var(--admin-text-faint)]">
              Rata-rata <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={avgRevenuePerTrip} className="inline font-black text-[var(--admin-text-muted)]" /> / trip
            </p>
          </div>
        </div>
      )}

      {reportTruncated && (
        <p className="rounded-xl border border-[var(--admin-warning-border)] bg-[var(--admin-warning-soft)] px-4 py-2 text-[11px] font-semibold text-[var(--admin-warning-text)]">
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

      <div className="bg-[var(--admin-surface)] rounded-2xl border border-[var(--admin-border)] shadow-[var(--admin-shadow-card)] overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-[var(--admin-surface-muted)]">
              <th colSpan={13} className="px-4 py-3 border-b border-[var(--admin-border)]">
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
                            ? 'border-[var(--admin-accent)] bg-[var(--admin-accent)] text-[var(--admin-accent-contrast)]'
                            : 'border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                  <button onClick={onToggleReveal}
                    className={`px-3.5 py-2 rounded-lg border font-semibold text-sm flex items-center gap-2 ${revealed ? 'border-[var(--admin-accent-border)] text-[var(--admin-accent-text)] bg-[var(--admin-surface)]' : 'border-[var(--admin-border)] text-[var(--admin-text-muted)] bg-[var(--admin-surface)] hover:bg-[var(--admin-surface-hover)]'}`}>
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
                    className="bg-[var(--admin-accent)] text-[var(--admin-accent-contrast)] px-3.5 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-[var(--admin-accent-hover)]">
                    <Camera size={15} /> Foto ({reportTrips.reduce((count, t) => count + (t.foto_kosong_path ? 1 : 0) + (t.selfie_photo ? 1 : 0) + t.vehicles.filter(v => !!v.foto_path).length, 0)})
                  </button>
                  </div>
                </div>
              </th>
            </tr>
            <tr className="bg-[var(--admin-surface-sunken)] text-[10px] uppercase tracking-wide text-[var(--admin-text-muted)]">
              <th className="text-left pl-12 pr-3 py-2.5 border-b border-[var(--admin-border)]">No Trip</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Tanggal</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Jam</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Wilayah</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Rute Asal</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Rute Tujuan</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Petugas</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">No. Polisi</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Jenis</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Golongan</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Muatan</th>
              <th className="text-right px-3 py-2.5 border-b border-[var(--admin-border)]">Unit</th>
              <th className="text-right px-4 py-2.5 border-b border-[var(--admin-border)]">Tarif</th>
            </tr>
          </thead>
          <tbody>
            {reportState === 'offline' ? (
              <tr>
                <td colSpan={13} className="p-8 text-center">
                  <p className="text-[var(--admin-text-muted)] font-semibold">Laporan tidak bisa dimuat</p>
                  <p className="text-[12px] text-[var(--admin-text-faint)] mt-1">{reportError ?? 'Server tidak menjawab.'}</p>
                  <button
                    onClick={() => void loadReports()}
                    className="mt-3 border border-[var(--admin-border)] text-[var(--admin-text-soft)] px-3.5 py-2 rounded-lg font-semibold text-sm hover:bg-[var(--admin-surface-hover)]"
                  >
                    Coba Lagi
                  </button>
                </td>
              </tr>
            ) : reportState !== 'ready' ? (
              <tr><td colSpan={13} className="p-8 text-center text-[var(--admin-text-faint)] animate-pulse">Memuat...</td></tr>
            ) : reportTrips.length === 0 ? (
              <tr><td colSpan={13} className="p-8 text-center text-[var(--admin-text-faint)]">Belum ada trip</td></tr>
            ) : (() => {
              // Formulir per-kendaraan: satu baris = satu kendaraan.
              // Tidak ada pengelompokan per trip/tanggal lagi - semua data
              // digabung dan dikelompokkan menjadi 3 bagian: Internal,
              // Eksternal, Lokal. Trip tanpa kendaraan tidak punya baris
              // di sini - jumlahnya disebutkan di tfoot.
              const vehicleRows = reportTrips.flatMap(trip =>
                (trip.vehicles ?? []).map(vehicle => ({ trip, vehicle })),
              )
              if (vehicleRows.length === 0) {
                return (
                  <tr><td colSpan={13} className="p-8 text-center text-[var(--admin-text-faint)]">{reportTrips.length} trip tanpa data kendaraan</td></tr>
                )
              }

              const GOL_ORDER = ['Eksternal', 'Lokal', 'Internal']
              const golRank = (g: string) => {
                const i = GOL_ORDER.indexOf(g)
                return i === -1 ? GOL_ORDER.length : i
              }
              const sortGol = (a: string, b: string) => golRank(a) - golRank(b) || a.localeCompare(b)

              const byGol = new Map<string, typeof vehicleRows>()
              for (const row of vehicleRows) {
                const g = reportGolongan(row.vehicle)
                if (!byGol.has(g)) byGol.set(g, [])
                byGol.get(g)!.push(row)
              }
              for (const rows of byGol.values()) {
                rows.sort((a, b) =>
                  a.trip.no_trip.localeCompare(b.trip.no_trip)
                  || String(a.vehicle.id).localeCompare(String(b.vehicle.id)))
              }
              const golKeys = [...byGol.keys()].sort(sortGol)

              const sumTarif = (rows: typeof vehicleRows) =>
                rows.reduce((s, r) => s + (Number(r.vehicle.tariff_amount) || 0), 0)
              const distinctTrips = (rows: typeof vehicleRows) =>
                new Set(rows.map(r => r.trip.id)).size
              const masterRank = new Map(vehicleTypeNames.map((n, i) => [n, i]))
              const ringkasan = (rows: typeof vehicleRows) => {
                const counts = new Map<string, number>()
                for (const r of rows) {
                  const k = (r.vehicle.vehicle_type ?? '').trim() || '-'
                  counts.set(k, (counts.get(k) ?? 0) + 1)
                }
                return [...counts.entries()]
                  .sort((a, b) => (masterRank.get(a[0]) ?? 9999) - (masterRank.get(b[0]) ?? 9999) || a[0].localeCompare(b[0]))
                  .map(([k, v]) => `${k}: ${v} unit`)
                  .join(' | ')
              }
              const golBadgeClass = (g: string) =>
                g.includes('Internal') ? 'border-[var(--admin-border-strong)] text-[var(--admin-text)]'
                  : g.includes('Eksternal') ? 'border-[var(--admin-neutral)] text-[var(--admin-text-muted)]'
                    : 'border-[var(--admin-border)] text-[var(--admin-text-faint)]'
              const muatanBadgeClass = (hasLoad: number) =>
                Number(hasLoad) > 0
                  ? 'border-[var(--admin-success-border)] text-[var(--admin-success-text)] bg-[var(--admin-success-soft)]'
                  : 'border-[var(--admin-border)] text-[var(--admin-text-faint)]'
              const groupVisible = (g: string) =>
                expandMode === 'collapse' ? openGols.has(g) : !closedGols.has(g)

              return golKeys.flatMap(g => {
                const rows = byGol.get(g)!
                const gOpen = groupVisible(g)
                const header = (
                  <tr key={g} onClick={() => toggleGol(g)}
                    className="bg-[var(--admin-surface-inverse)] text-[var(--admin-text-inverse)] cursor-pointer hover:bg-[var(--admin-surface-inverse-hover)] transition-colors">
                    <td colSpan={11} className="px-4 py-2.5 font-bold text-sm">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1">
                          <ChevronRight size={14} className={`text-[var(--admin-text-inverse-faint)] transition-transform ${gOpen ? 'rotate-90' : ''}`} />
                          Golongan: {g} ({distinctTrips(rows)} Trip)
                        </span>
                        <span title={ringkasan(rows)}
                          className="max-w-[420px] truncate text-[var(--admin-text-inverse-muted)] text-[10px] font-semibold bg-[var(--admin-chip-inverse-bg)] border border-[var(--admin-border-inverse)] rounded px-2 py-0.5">
                          Rincian: {ringkasan(rows)}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right font-bold text-xs whitespace-nowrap">{rows.length} Unit</td>
                    <td className="px-4 py-2.5 text-right font-black text-sm whitespace-nowrap">
                      <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={sumTarif(rows)} className="text-[var(--admin-success-on-dark)]" />
                    </td>
                  </tr>
                )
                const body = gOpen
                  ? rows.map(({ trip, vehicle }) => {
                      const d = formatReportDateTime(trip.created_at)
                      const g2 = reportGolongan(vehicle)
                      return (
                        <tr key={`${trip.id}-${vehicle.id}`}
                          className="border-b border-[var(--admin-border-subtle)] hover:bg-[var(--admin-surface-hover)] transition-colors">
                          <td className="pl-12 pr-3 py-2.5 font-mono font-semibold text-[var(--admin-text-soft)]">{trip.no_trip}</td>
                          <td className="px-3 py-2.5 text-[var(--admin-text-muted)] text-xs whitespace-nowrap">{d.date}</td>
                          <td className="px-3 py-2.5 text-[var(--admin-text-muted)] text-xs">{d.time}</td>
                          <td className="px-3 py-2.5 text-[var(--admin-text)]">{trip.region_name || '-'}</td>
                          <td className="px-3 py-2.5 text-[var(--admin-text-muted)]">{trip.route_from_name || trip.route_from || '-'}</td>
                          <td className="px-3 py-2.5 text-[var(--admin-text-muted)]">{trip.route_to_name || trip.route_to || '-'}</td>
                          <td className="px-3 py-2.5 text-[var(--admin-text-muted)]">{trip.officer_name || '-'}</td>
                          <td className="px-3 py-2.5 font-mono text-[var(--admin-text-soft)]">{vehicle.no_polisi}</td>
                          <td className="px-3 py-2.5 text-[var(--admin-text-muted)]">{vehicle.vehicle_type}</td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${golBadgeClass(g2)}`}>{g2}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${muatanBadgeClass(vehicle.has_load)}`}>
                              {Number(vehicle.has_load) > 0 ? 'Ada Muatan' : 'Tanpa Muatan'}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right tabular-nums text-[var(--admin-text-faint)] text-xs">1 Unit</td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap text-[var(--admin-text-soft)]">
                            <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={vehicle.tariff_amount || 0} />
                            {String(vehicle.tarif_source ?? '') === 'internal' && (
                              <span className="block text-[9px] font-normal text-[var(--admin-text-faint)]">Internal - tidak ditagih</span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  : []
                return [header, ...body]
              })
            })()}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--admin-surface-sunken)] font-bold text-[var(--admin-text-soft)]">
              <td colSpan={13} className="px-4 py-3 border-t-2 border-[var(--admin-border-strong)] text-right text-[12px]">
                Total {totalTrip} trip - {totalUnit} unit
                {reportTrips.some(t => (t.vehicles ?? []).length === 0) && (
                  <span className="ml-3 text-[10px] font-semibold text-[var(--admin-text-faint)]">
                    ({reportTrips.filter(t => (t.vehicles ?? []).length === 0).length} trip tanpa data kendaraan tidak tampil)
                  </span>
                )}
                <span className="ml-4">
                  <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={totalRevenue} className="text-[var(--admin-success-text)] font-black" />
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
