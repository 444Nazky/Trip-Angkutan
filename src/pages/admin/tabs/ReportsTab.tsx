import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
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

// ─────────────────────────────────────────────────────────────────────────────
// Pengelompokan tabel laporan
//
//   06-11-2026/
//   ├── Internal/   → semua kendaraan golongan Internal pada tanggal itu
//   ├── Eksternal/  → semua kendaraan golongan Eksternal pada tanggal itu
//   └── Lokal/      → semua kendaraan golongan Lokal pada tanggal itu
//
// Trip TIDAK lagi jadi baris sendiri: semua kendaraannya digabung ke dalam
// grup golongan, jadi satu baris = satu kendaraan.
// ─────────────────────────────────────────────────────────────────────────────

// Urutan grup golongan (dipakai juga di kartu breakdown: Internal di atas).
const GOL_ORDER = ['Internal', 'Eksternal', 'Lokal']

function golRank(g: string): number {
  const i = GOL_ORDER.indexOf(g)
  return i === -1 ? GOL_ORDER.length : i
}

interface VehicleRow {
  trip: ReportTrip
  vehicle: ReportTrip['vehicles'][number]
}

interface GolGroup {
  key: string
  rows: VehicleRow[]
  trips: number
  units: number
  revenue: number
  /** Ringkasan jumlah unit per jenis kendaraan di dalam grup ini. */
  summary: string
}

interface DateGroup {
  date: string
  label: string
  weekday: string
  tripCount: number
  units: number
  revenue: number
  gols: GolGroup[]
  tripsWithoutVehicles: number
}

/** "2026-11-06" -> "06-11-2026" (format folder sesuai urutan tanggal). */
function dateFolderLabel(date: string): string {
  const [y, m, d] = date.split('-')
  if (!y || !m || !d) return date
  return `${d}-${m}-${y}`
}

function dateWeekday(date: string): string {
  const obj = new Date(`${date}T00:00:00`)
  if (Number.isNaN(obj.getTime())) return ''
  return obj.toLocaleDateString('id-ID', { weekday: 'long' })
}

/**
 * Bangun hierarki tanggal → golongan → kendaraan dari daftar trip.
 * Semua kendaraan dari seluruh trip pada tanggal yang sama digabung per
 * golongan, jadi membuka satu grup = seluruh kendaraan golongan itu.
 */
function buildDateGroups(trips: ReportTrip[]): DateGroup[] {
  const byDate = new Map<string, { trips: ReportTrip[]; rows: VehicleRow[] }>()
  for (const t of trips) {
    const date = dayKeyWib(t.created_at)
    let group = byDate.get(date)
    if (!group) { group = { trips: [], rows: [] }; byDate.set(date, group) }
    group.trips.push(t)
    for (const vehicle of t.vehicles ?? []) group.rows.push({ trip: t, vehicle })
  }

  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, group]) => {
      const byGol = new Map<string, VehicleRow[]>()
      for (const row of group.rows) {
        const key = reportGolongan(row.vehicle)
        if (!byGol.has(key)) byGol.set(key, [])
        byGol.get(key)!.push(row)
      }
      // Golongan baku selalu tampil (meski 0 unit) supaya strukturnya
      // konsisten; golongan di luar master ikut tampil di akhir.
      const keys = [...new Set([...GOL_ORDER, ...byGol.keys()])]
        .sort((a, b) => golRank(a) - golRank(b) || a.localeCompare(b))

      const gols: GolGroup[] = keys.map(key => {
        const rows = [...(byGol.get(key) ?? [])].sort((a, b) =>
          a.trip.no_trip.localeCompare(b.trip.no_trip)
          || String(a.vehicle.id ?? '').localeCompare(String(b.vehicle.id ?? '')))
        // Ringkasan jenis kendaraan: "Truck Besar: 2 unit | Motor: 1 unit".
        const perType = new Map<string, number>()
        for (const row of rows) {
          const type = (row.vehicle.vehicle_type ?? '').trim() || '-'
          perType.set(type, (perType.get(type) ?? 0) + 1)
        }
        const summary = [...perType.entries()]
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([type, count]) => `${type}: ${count} unit`)
          .join(' | ')
        return {
          key,
          rows,
          trips: new Set(rows.map(r => String(r.trip.id))).size,
          units: rows.length,
          revenue: rows.reduce((s, r) => s + (Number(r.vehicle.tariff_amount) || 0), 0),
          summary,
        }
      })

      return {
        date,
        label: dateFolderLabel(date),
        weekday: dateWeekday(date),
        tripCount: group.trips.length,
        units: group.rows.length,
        revenue: group.rows.reduce((s, r) => s + (Number(r.vehicle.tariff_amount) || 0), 0),
        gols,
        tripsWithoutVehicles: group.trips.filter(t => (t.vehicles ?? []).length === 0).length,
      }
    })
}



export function ReportsTab({ onServerTripsChange, revealed, onToggleReveal, baseUrl = '', onOpenCancellations }: ReportsTabProps) {
  const [reportTrips, setReportTrips] = useState<ReportTrip[]>([])
  const [reportState, setReportState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  // Mode tampilan tabel laporan (halaman dashboard saja; halaman detail
  // kendaraan tidak terpengaruh). Ada dua level: tanggal → golongan.
  //   'collapse' -> hanya header tanggal (isi tanggal tersembunyi)
  //   'header'   -> header tanggal + header golongan, kendaraan tertutup (default)
  //   'all'      -> semua terbuka, semua kendaraan tampil
  // Klik individual pada header tanggal / golongan menimpa mode tersebut.
  const [expandMode, setExpandMode] = useState<'collapse' | 'header' | 'all'>('header')
  // Override per item: true = dipaksa terbuka, false = dipaksa tertutup.
  // Key golongan = "<tanggal>|<golongan>".
  const [dateOpenOverrides, setDateOpenOverrides] = useState<Record<string, boolean>>({})
  const [golOpenOverrides, setGolOpenOverrides] = useState<Record<string, boolean>>({})

  const dateIsOpen = (date: string) =>
    dateOpenOverrides[date] ?? (expandMode !== 'collapse')
  const golIsOpen = (key: string) =>
    golOpenOverrides[key] ?? (expandMode === 'all')

  const toggleDate = (date: string) =>
    setDateOpenOverrides(prev => ({ ...prev, [date]: !dateIsOpen(date) }))
  const toggleGol = (key: string) =>
    setGolOpenOverrides(prev => ({ ...prev, [key]: !golIsOpen(key) }))

  const expandTo = (mode: 'collapse' | 'header' | 'all') => {
    setExpandMode(mode)
    setDateOpenOverrides({})
    setGolOpenOverrides({})
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

  // Hierarki tabel: tanggal → golongan → kendaraan.
  const dateGroups = useMemo(() => buildDateGroups(reportTrips), [reportTrips])

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
        <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-[var(--admin-surface-muted)]">
              <th colSpan={10} className="px-4 py-3 border-b border-[var(--admin-border)]">
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
              <th className="text-left pl-10 pr-3 py-2.5 border-b border-[var(--admin-border)]">No Trip</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Jam</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Wilayah</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Rute</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Petugas</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">No. Polisi</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Jenis Kendaraan</th>
              <th className="text-left px-3 py-2.5 border-b border-[var(--admin-border)]">Muatan</th>
              <th className="text-right px-3 py-2.5 border-b border-[var(--admin-border)]">Tarif</th>
              <th className="text-left px-4 py-2.5 border-b border-[var(--admin-border)]">Foto</th>
            </tr>
          </thead>
          <tbody>
            {reportState === 'offline' ? (
              <tr>
                <td colSpan={10} className="p-8 text-center">
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
              <tr><td colSpan={10} className="p-8 text-center text-[var(--admin-text-faint)] animate-pulse">Memuat...</td></tr>
            ) : reportTrips.length === 0 ? (
              <tr><td colSpan={10} className="p-8 text-center text-[var(--admin-text-faint)]">Belum ada trip</td></tr>
            ) : (
              // Hierarki: tanggal → golongan → kendaraan.
              dateGroups.flatMap(group => {
                const dateOpen = dateIsOpen(group.date)
                const rows: ReactNode[] = []

                // Header tanggal (klik = buka/tutup isi tanggal ini)
                rows.push(
                  <tr key={`date-${group.date}`} onClick={() => toggleDate(group.date)}
                    data-testid="report-date-header"
                    className="bg-[var(--admin-surface-inverse)] text-[var(--admin-text-inverse)] cursor-pointer hover:bg-[var(--admin-surface-inverse-hover)] transition-colors">
                    <td colSpan={6} className="px-4 py-2.5">
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="flex items-center gap-1.5">
                          <Calendar size={14} className="text-[var(--admin-text-inverse-faint)]" />
                          <span className="font-black text-sm tracking-wide">{group.label}</span>
                          <span className="text-[11px] text-[var(--admin-text-inverse-muted)] capitalize">{group.weekday}</span>
                          <ChevronRight size={14} className={`text-[var(--admin-text-inverse-faint)] transition-transform ${dateOpen ? 'rotate-90' : ''}`} />
                        </span>
                        <span className="text-[11px] font-semibold text-[var(--admin-text-inverse-muted)]">
                          {group.tripCount} trip · {group.units} unit
                        </span>
                      </span>
                    </td>
                    <td colSpan={4} className="px-4 py-2.5 text-right font-black text-sm whitespace-nowrap">
                      <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={group.revenue} className="text-[var(--admin-success-on-dark)]" />
                    </td>
                  </tr>
                )

                if (!dateOpen) return rows

                // Header golongan per tanggal (klik = buka/tutup seluruh
                // kendaraan golongan itu)
                for (const gol of group.gols) {
                  const golKey = `${group.date}|${gol.key}`
                  const golOpen = golIsOpen(golKey)
                  rows.push(
                    <tr key={`gol-${golKey}`} onClick={() => toggleGol(golKey)}
                      data-testid="report-gol-header"
                      data-gol={gol.key}
                      className="bg-[var(--admin-surface-sunken)] cursor-pointer hover:bg-[var(--admin-surface-hover)] transition-colors">
                      <td colSpan={6} className="pl-10 pr-3 py-2">
                        <span className="flex items-center gap-2 flex-wrap">
                          <span className="flex items-center gap-1.5">
                            <ChevronRight size={13} className={`text-[var(--admin-text-faint)] transition-transform ${golOpen ? 'rotate-90' : ''}`} />
                            <span className="text-[13px] font-black text-[var(--admin-text)]">{gol.key}</span>
                          </span>
                          <span className="text-[10px] font-bold text-[var(--admin-text-faint)]">
                            {gol.trips} trip · {gol.units} unit
                          </span>
                          {gol.summary && (
                            <span title={gol.summary}
                              className="max-w-[420px] truncate text-[10px] font-semibold text-[var(--admin-text-muted)] bg-[var(--admin-surface)] border border-[var(--admin-border)] rounded px-2 py-0.5">
                              Rincian: {gol.summary}
                            </span>
                          )}
                        </span>
                      </td>
                      <td colSpan={4} className="px-4 py-2 text-right whitespace-nowrap">
                        <span className="text-[11px] font-bold text-[var(--admin-text-muted)] mr-3">{gol.units} unit</span>
                        <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={gol.revenue} className="text-[var(--admin-success-text)] font-black text-[12px]" />
                      </td>
                    </tr>
                  )

                  if (!golOpen) continue

                  // Seluruh kendaraan golongan ini pada tanggal tersebut
                  for (const { trip, vehicle } of gol.rows) {
                    const d = formatReportDateTime(trip.created_at)
                    const hasLoad = Number(vehicle.has_load) > 0
                    rows.push(
                      <tr key={`${group.date}-${gol.key}-${vehicle.id ?? trip.id}-${vehicle.no_polisi}`}
                        data-testid="report-vehicle-row"
                        className="border-b border-[var(--admin-border-subtle)] hover:bg-[var(--admin-surface-hover)] transition-colors">
                        <td className="pl-10 pr-3 py-2.5 font-mono font-semibold text-[var(--admin-text-soft)]">{trip.no_trip}</td>
                        <td className="px-3 py-2.5 text-[var(--admin-text-muted)] text-xs whitespace-nowrap">{d.time}</td>
                        <td className="px-3 py-2.5 text-[var(--admin-text)]">{trip.region_name || '-'}</td>
                        <td className="px-3 py-2.5 text-[var(--admin-text-muted)] whitespace-nowrap">
                          {trip.route_from_name || trip.route_from || '-'} → {trip.route_to_name || trip.route_to || '-'}
                        </td>
                        <td className="px-3 py-2.5 text-[var(--admin-text-muted)]">{trip.officer_name || '-'}</td>
                        <td className="px-3 py-2.5 font-mono text-[var(--admin-text-soft)]">{vehicle.no_polisi}</td>
                        <td className="px-3 py-2.5 text-[var(--admin-text-muted)]">{vehicle.vehicle_type}</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${
                            hasLoad
                              ? 'border-[var(--admin-success-border)] text-[var(--admin-success-text)] bg-[var(--admin-success-soft)]'
                              : 'border-[var(--admin-border)] text-[var(--admin-text-faint)]'
                          }`}>
                            {hasLoad ? 'Ada Muatan' : 'Tanpa Muatan'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right whitespace-nowrap text-[var(--admin-text-soft)]">
                          <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={vehicle.tariff_amount || 0} />
                          <span className="block text-[9px] font-normal text-[var(--admin-text-faint)]">{tarifSourceLabel(vehicle.tarif_source)}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          {(() => {
                            // Foto kendaraan + bukti trip (swafoto & foto
                            // kosong). Klik membuka semua foto trip tsb.
                            const thumbs = [
                              ...(vehicle.foto_path ? [{
                                id: `vehicle-${vehicle.id}`,
                                url: vehicle.foto_path as string,
                                caption: vehiclePhotoCaption(trip, vehicle, geoRules),
                              }] : []),
                              ...(trip.selfie_photo ? [{
                                id: `selfie-${trip.id}`,
                                url: trip.selfie_photo,
                                caption: `${trip.no_trip} - Swafoto petugas`,
                              }] : []),
                              ...(trip.foto_kosong_path ? [{
                                id: `trip-${trip.id}`,
                                url: trip.foto_kosong_path,
                                caption: `${trip.no_trip} - Bukti trip`,
                              }] : []),
                            ]
                            if (thumbs.length === 0) {
                              return <span className="text-[10px] text-[var(--admin-text-faint)]">-</span>
                            }
                            return (
                              <button
                                type="button"
                                onClick={() => setViewingPhotos(thumbs)}
                                className="flex items-center gap-1 rounded-lg hover:ring-2 hover:ring-[var(--admin-accent)]"
                                aria-label={`Lihat ${thumbs.length} foto ${trip.no_trip}`}
                              >
                                {thumbs.slice(0, 3).map(p => (
                                  <img
                                    key={p.id}
                                    src={resolvePhotoUrl(p.url, baseUrl)}
                                    alt=""
                                    loading="lazy"
                                    className="h-9 w-9 rounded-md object-cover ring-1 ring-[var(--admin-border)]"
                                  />
                                ))}
                                {thumbs.length > 3 && (
                                  <span className="text-[10px] font-bold text-[var(--admin-text-muted)]">+{thumbs.length - 3}</span>
                                )}
                              </button>
                            )
                          })()}
                        </td>
                      </tr>
                    )
                  }
                }
                return rows
              })
            )}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--admin-surface-sunken)] font-bold text-[var(--admin-text-soft)]">
              <td colSpan={10} className="px-4 py-3 border-t-2 border-[var(--admin-border-strong)] text-right text-[12px]">
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
    </div>
  )
}
