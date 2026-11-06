import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, CarFront, ChevronRight, Download, ListChecks, RefreshCw, Users, X, type LucideIcon } from 'lucide-react'
import {
  fetchTripCancellations,
  fetchTripCancellationSummary,
  formatReportDateTime,
  dayKeyWib,
  type TripCancellation,
  type TripCancellationSummary,
} from '../../../services/trips'
import { api } from '../../../services/api'
import { typedCancelReason } from '../../../services/cancelReasons'
import { downloadXlsx } from '../../../services/xlsx'

interface CancellationsTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
  /** Tutup panel pembatalan (kembali ke halaman sebelumnya). */
  onClose?: () => void
}

type RangeKey = 'today' | '7d' | '30d' | 'all'

const BTN_GHOST =
  'inline-flex items-center justify-center gap-1.5 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-1.5 text-[11px] font-bold text-[var(--admin-text-muted)] transition hover:bg-[var(--admin-surface-hover)] disabled:opacity-40'

/**
 * Server menyimpan URL foto sebagai path relatif ("/files/...").
 * Halaman admin disajikan dari port berbeda (8000) daripada API (3000),
 * jadi path relatif harus diarahkan ke origin API.
 */
function fileUrl(url: string): string {
  if (/^(https?:|data:|blob:)/i.test(url)) return url
  const origin = api.baseUrl.replace(/\/api\/?$/, '')
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`
}

const RANGE_PRESETS: { key: RangeKey; label: string; days: number | null }[] = [
  { key: 'today', label: 'Hari Ini', days: 1 },
  { key: '7d', label: '7 Hari', days: 7 },
  { key: '30d', label: '30 Hari', days: 30 },
  { key: 'all', label: 'Semua', days: null },
]

/** Urutan golongan pada daftar rincian (sama dengan tabel laporan). */
const GOL_ORDER = ['Internal', 'Eksternal', 'Lokal']

/** Tanggal WIB hari ini (YYYY-MM-DD). */
function todayWib(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date())
}

/**
 * Tanggal WIB `days` hari yang lalu (YYYY-MM-DD).
 *
 * Hitungan dilakukan pada tanggal WIB sebagai "hari kalender", bukan pada
 * jam lokal peramban. Kalau tidak, peramban yang zona waktunya berbeda dari
 * WIB bisa menggeser batas awal/akhir satu hari.
 */
function daysAgoWib(days: number): string {
  const [y, m, d] = todayWib().split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() - (days - 1))
  return dt.toISOString().slice(0, 10)
}

/** "2026-11-03 16:20 WIB" (tanggal ISO + jam WIB). */
function cancelTimeLabel(raw: string | null | undefined): string {
  if (!raw) return '-'
  const d = formatReportDateTime(raw)
  if (d.full === '-') return '-'
  return `${dayKeyWib(raw)} ${d.time} WIB`
}

/** Nama pertama saja ("Budi Santoso" -> "Budi") untuk daftar ringkas. */
function shortName(name: string | null | undefined): string {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return 'Tanpa nama'
  return trimmed.split(/\s+/)[0]
}

/** Gabung daftar jadi kalimat: "A, B & C" (bukan "A, B, C"). */
function joinNatural(list: string[]): string {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} & ${list[list.length - 1]}`
}

type CancelVehicle = NonNullable<TripCancellation['vehicles']>[number]

interface CancelVehicleRow {
  key: string
  cancel: TripCancellation
  vehicle: CancelVehicle | null
}

interface CancelDateGroup {
  /** Tanggal (YYYY-MM-DD) — semua pembatalan tanggal ini digabung. */
  key: string
  /** Jumlah dokumen/trip pembatalan pada tanggal ini. */
  tripCount: number
  rows: CancelVehicleRow[]
}

interface CancelOfficerGroup {
  key: string
  officer: string
  /** Total unit kendaraan seluruh tanggal petugas ini. */
  unitCount: number
  dates: CancelDateGroup[]
}

/** Tanggal pembatalan (YYYY-MM-DD): tanggal mulai, mundur ke tanggal batal. */
function tripDateKey(c: TripCancellation): string {
  return dayKeyWib(c.started_at ?? c.cancelled_at)
}

/** "2026-11-22" -> "22-11-2026" (label folder tanggal). */
function toDmy(date: string): string {
  const [y, m, d] = date.split('-')
  if (!y || !m || !d) return date
  return `${d}-${m}-${y}`
}

/**
 * Kelompokkan pembatalan menurut "Petugas → Tanggal → kendaraan".
 *
 * Satu petugas = satu grup; di dalamnya semua pembatalan pada TANGGAL yang
 * sama digabung jadi satu grup tanggal (berapa pun dokumennya), dan satu baris
 * tabel = satu kendaraan. Dokumen tanpa rincian kendaraan tetap tampil satu
 * baris (kolom kendaraan "-") supaya tidak ada pembatalan yang hilang.
 */
function buildOfficerGroups(rows: TripCancellation[]): CancelOfficerGroup[] {
  const byOfficer = new Map<string, CancelOfficerGroup>()
  for (const c of rows) {
    const officer = c.officer_name?.trim() || 'Tanpa nama'
    let group = byOfficer.get(officer)
    if (!group) {
      group = { key: officer, officer, unitCount: 0, dates: [] }
      byOfficer.set(officer, group)
    }

    const date = tripDateKey(c)
    let day = group.dates.find(d => d.key === date)
    if (!day) {
      day = { key: date, tripCount: 0, rows: [] }
      group.dates.push(day)
    }
    day.tripCount += 1

    const vehicles = c.vehicles && c.vehicles.length > 0 ? c.vehicles : [null]
    const tripRows: CancelVehicleRow[] = vehicles.map((vehicle, i) => ({
      key: `${c.id}-${i}-${vehicle?.plate ?? 'tanpa-kendaraan'}`,
      cancel: c,
      vehicle,
    }))
    day.rows.push(...tripRows)
    group.unitCount += tripRows.length
  }

  // Petugas: unit terbanyak dulu, lalu nama. Tanggal: terbaru dulu.
  return [...byOfficer.values()]
    .sort((a, b) => b.unitCount - a.unitCount || a.officer.localeCompare(b.officer))
    .map(g => ({
      ...g,
      dates: [...g.dates]
        .sort((a, b) => b.key.localeCompare(a.key))
        .map(d => ({
          ...d,
          rows: [...d.rows].sort((a, b) =>
            a.cancel.no_cancel.localeCompare(b.cancel.no_cancel)
            || String(a.vehicle?.plate ?? '').localeCompare(String(b.vehicle?.plate ?? ''))),
        })),
    }))
}

/**
 * Tab "Pembatalan Trip" — pemantauan trip yang dibatalkan petugas beserta
 * alasannya.
 *
 * Trip yang dibatalkan WAJIB punya alasan (dokumen pembatalan), jadi di sini
 * alasannya adalah isi utama halaman, bukan sekadar kolom tambahan.
 *
 * Satu baris filter di atas mengatur SELURUH isi halaman (kartu, tabel) —
 * semua digambar dari potongan data yang sama, jadi angkanya selalu cocok satu
 * sama lain.
 */
export function CancellationsTab({ showToast, onClose }: CancellationsTabProps) {
  const [range, setRange] = useState<RangeKey>('30d')

  const [rows, setRows] = useState<TripCancellation[]>([])
  const [summary, setSummary] = useState<TripCancellationSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading')
  const [error, setError] = useState<string | null>(null)
  /** Baris kendaraan yang rinciannya dibuka (klik baris). */
  const [expanded, setExpanded] = useState<string | null>(null)
  /**
   * Buka/tutup dua level: petugas → tanggal.
   *   'collapse' -> hanya header petugas
   *   'header'   -> header petugas + tanggal, kendaraan tertutup
   *   'all'      -> semua terbuka sampai kendaraan (default)
   * Klik individual menimpa mode; override hilang saat ganti mode.
   */
  const [expandMode, setExpandMode] = useState<'collapse' | 'header' | 'all'>('all')
  const [officerOpenOverrides, setOfficerOpenOverrides] = useState<Record<string, boolean>>({})
  const [dateOpenOverrides, setDateOpenOverrides] = useState<Record<string, boolean>>({})

  /** Rentang tanggal hasil dari preset yang dipilih. */
  const dateRange = useMemo(() => {
    const preset = RANGE_PRESETS.find(p => p.key === range)
    if (!preset || preset.days === null) return { startDate: undefined, endDate: undefined }
    return { startDate: daysAgoWib(preset.days), endDate: todayWib() }
  }, [range])

  const filters = dateRange

  const load = useCallback(async () => {
    setState(s => (s === 'ready' ? 'ready' : 'loading'))
    const [list, sum] = await Promise.all([
      fetchTripCancellations(filters),
      fetchTripCancellationSummary(filters),
    ])
    if (list === null && sum === null) {
      setState('offline')
      setError('Server tidak menjawab permintaan dokumen pembatalan.')
      return
    }
    setRows(list ?? [])
    setSummary(sum)
    setState('ready')
    setError(null)
  }, [filters])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh: pembatalan baru dari petugas harus langsung terlihat.
  // Hanya jalan saat tab terlihat supaya tidak membebani server.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void load()
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [load])

  const exportXlsx = () => {
    if (!rows.length) return showToast('Tidak ada data untuk diekspor', 'error')
    const header = [
      'No. Dokumen', 'Tanggal (WIB)', 'Petugas', 'Region', 'Rute', 'Status Muatan',
      'Alasan', 'Keterangan', 'Jumlah Kendaraan', 'Jumlah Foto',
    ]
    const body = rows.map(c => [
      c.no_cancel,
      c.cancelled_at ? formatReportDateTime(c.cancelled_at).full : '-',
      c.officer_name ?? '-',
      c.region_code ?? '-',
      [c.route_from, c.route_to].filter(Boolean).join(' → ') || (c.route_code ?? '-'),
      c.condition === 'muatan' ? 'Muatan' : c.condition === 'kosong' ? 'Kosong' : '-',
      c.reason,
      c.note ?? '-',
      c.vehicle_count ?? 0,
      c.photo_count ?? 0,
    ])
    const vehicleRows: (string | number | null)[][] = [
      ['Detail Kendaraan per Pembatalan'],
      [],
      ['No. Dokumen', 'Tanggal (WIB)', 'Petugas', 'No. Polisi', 'Jenis Kendaraan', 'Kategori', 'Beban', 'Tarif (Rp)'],
      ...rows.flatMap(c =>
        (c.vehicles ?? []).map(v => [
          c.no_cancel,
          c.cancelled_at ? formatReportDateTime(c.cancelled_at).full : '-',
          c.officer_name ?? '-',
          v.plate ?? '-',
          v.type ?? '-',
          v.category ?? '-',
          v.load ?? '-',
          v.tariff ?? 0,
        ]),
      ),
    ]
    downloadXlsx('pembatalan-trip.xlsx', [
      { name: 'Pembatalan Trip', rows: [header, ...body] },
      { name: 'Detail Kendaraan', rows: vehicleRows },
    ])
    showToast('Pembatalan Trip (.xlsx) diunduh')
  }

  // ── Angka untuk kartu ringkasan ───────────────────────────────────────────
  const total = summary?.total ?? rows.length
  const groups = useMemo(() => buildOfficerGroups(rows), [rows])
  const vehicleTotal = summary?.vehicleCount ?? groups.reduce((s, g) => s + g.unitCount, 0)

  // Golongan yang muncul pada kendaraan yang dibatalkan.
  const golonganList = useMemo(() => {
    const seen = new Set<string>()
    for (const g of groups) {
      for (const day of g.dates) {
        for (const row of day.rows) {
          const cat = row.vehicle?.category?.trim()
          if (cat) seen.add(cat)
        }
      }
    }
    return [...seen].sort((a, b) => {
      const ia = GOL_ORDER.indexOf(a)
      const ib = GOL_ORDER.indexOf(b)
      return (ia === -1 ? GOL_ORDER.length : ia) - (ib === -1 ? GOL_ORDER.length : ib) || a.localeCompare(b)
    })
  }, [groups])

  // Alasan teratas + keterangan pendukungnya.
  const topReason = summary?.byReason?.[0]
  const topReasonNote = useMemo(() => {
    if (!topReason) return ''
    const match = rows.find(c => c.reason === topReason.reason && c.note)
    return match?.note ?? ''
  }, [rows, topReason])

  // Petugas: jumlah orang + daftar singkat namanya. Kalau dua petugas
  // berbagi nama pertama, nama lengkapnya yang dipakai supaya tidak ambigu.
  const officerNames = useMemo(() => {
    const names = [...new Set(groups.map(g => g.officer))]
    const shorts = names.map(shortName)
    const counts = new Map<string, number>()
    shorts.forEach(s => counts.set(s, (counts.get(s) ?? 0) + 1))
    return names.map((name, i) => (counts.get(shorts[i]) ?? 0) > 1 ? name : shorts[i])
  }, [groups])
  const officerCount = summary?.byOfficer?.length ?? groups.length

  const officerIsOpen = (key: string) => officerOpenOverrides[key] ?? (expandMode !== 'collapse')
  const dateIsOpen = (key: string) => dateOpenOverrides[key] ?? (expandMode === 'all')
  const toggleOfficer = (key: string) =>
    setOfficerOpenOverrides(prev => ({ ...prev, [key]: !officerIsOpen(key) }))
  const toggleDate = (key: string) =>
    setDateOpenOverrides(prev => ({ ...prev, [key]: !dateIsOpen(key) }))
  const setAllGroups = (mode: 'collapse' | 'header' | 'all') => {
    setExpandMode(mode)
    setOfficerOpenOverrides({})
    setDateOpenOverrides({})
  }

  return (
    <div className="space-y-4">
      {/* Panel: judul + status + aksi */}
      <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-[var(--admin-shadow-card)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-[var(--admin-text)]">
              Detail &amp; Klasifikasi Pembatalan Trip
            </h3>
            <p className="mt-0.5 max-w-2xl text-[12px] text-[var(--admin-text-muted)]">
              Trip yang dibatalkan petugas beserta alasannya — setiap pembatalan
              menghasilkan dokumen, jadi tidak ada trip yang hilang tanpa jejak.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold ${
              state === 'ready'
                ? 'bg-[var(--admin-success-soft)] text-[var(--admin-success-text)]'
                : state === 'offline'
                  ? 'bg-[var(--admin-warning-soft)] text-[var(--admin-warning-text)]'
                  : 'bg-[var(--admin-surface-sunken)] text-[var(--admin-text-muted)]'
            }`}>
              <span className={`h-1.5 w-1.5 rounded-full ${
                state === 'ready'
                  ? 'bg-[var(--admin-success)]'
                  : state === 'offline'
                    ? 'bg-[var(--admin-warning)]'
                    : 'animate-pulse bg-[var(--admin-neutral)]'
              }`} />
              {state === 'ready' ? 'Server: Tersambung' : state === 'offline' ? 'Server tidak merespons' : 'Memuat...'}
            </span>
            <button onClick={() => void load()} disabled={state === 'loading'} className={BTN_GHOST}>
              <RefreshCw size={12} /> Muat ulang
            </button>
            <button onClick={exportXlsx} disabled={!rows.length} className={BTN_GHOST}>
              <Download size={12} /> Ekspor .xlsx
            </button>
            {onClose && (
              <button
                onClick={onClose}
                aria-label="Tutup detail pembatalan"
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] text-[var(--admin-text-muted)] transition hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text)]"
              >
                <X size={15} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* SATU baris filter di atas semua — mengatur kartu dan tabel sekaligus,
          jadi semua menunjuk potongan data yang sama. */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-4 shadow-[var(--admin-shadow-card)]">
        <div>
          <label className="mb-1 block text-[11px] font-bold text-[var(--admin-text-muted)]">Rentang</label>
          <div className="flex gap-1.5">
            {RANGE_PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setRange(p.key)}
                className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--admin-accent-soft)] ${
                  range === p.key
                    ? 'border-[var(--admin-accent)] bg-[var(--admin-accent)] text-[var(--admin-accent-contrast)]'
                    : 'border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-[var(--admin-danger-border)] bg-[var(--admin-danger-soft)] px-4 py-3">
          <p className="text-[13px] font-bold text-[var(--admin-danger-text)]">{error}</p>
          <p className="mt-0.5 text-[11px] text-[var(--admin-danger-text)]">
            Pastikan tabel <span className="font-mono">trip_cancellations</span> sudah ada di
            database (jalankan migrasi server).
          </p>
        </div>
      )}

      {/* Empat kartu ringkasan */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SummaryCard
          label="Total Pembatalan"
          Icon={Ban}
          value={total.toLocaleString('id-ID')}
          unit="Trip"
          hint="Total transaksi dibatalkan"
        />
        <SummaryCard
          label="Golongan & Jenis Kendaraan"
          Icon={CarFront}
          value={vehicleTotal.toLocaleString('id-ID')}
          unit="Unit"
          hint={golonganList.length > 0 ? joinNatural(golonganList) : 'Belum ada kendaraan dibatalkan'}
        />
        <SummaryCard
          label="Alasan Teratas"
          Icon={ListChecks}
          value={(topReason?.count ?? 0).toLocaleString('id-ID')}
          unit={topReason?.reason}
          hint={topReasonNote || 'Alasan pembatalan terbanyak'}
        />
        <SummaryCard
          label="Petugas"
          Icon={Users}
          value={officerCount.toLocaleString('id-ID')}
          unit="Orang"
          hint={officerNames.length > 0 ? officerNames.join(', ') : 'Belum ada petugas'}
        />
      </div>

      {/* Daftar rincian trip dibatalkan */}
      <div className="overflow-hidden rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] shadow-[var(--admin-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--admin-border)] px-4 py-3">
          <div>
            <h4 className="text-[13px] font-black text-[var(--admin-text)]">
              Daftar Rincian Trip Dibatalkan (Petugas → Tanggal)
            </h4>
            <p className="text-[11px] text-[var(--admin-text-muted)]">
              Satu baris = satu kendaraan. Klik baris untuk melihat alasan pembatalan.
            </p>
          </div>
          <div className="flex gap-1.5">
            {([
              ['collapse', 'Collapse All'],
              ['header', 'Expand Header'],
              ['all', 'Expand All'],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setAllGroups(mode)}
                aria-pressed={expandMode === mode}
                className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                  expandMode === mode
                    ? 'border-[var(--admin-accent)] bg-[var(--admin-accent)] text-[var(--admin-accent-contrast)]'
                    : 'border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {state === 'loading' && rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-[var(--admin-text-faint)] animate-pulse">Memuat...</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-[var(--admin-text-faint)]">
            Belum ada trip yang dibatalkan pada rentang ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-[var(--admin-surface-sunken)] text-[10px] uppercase tracking-wide text-[var(--admin-text-muted)]">
                <tr>
                  <th className="border-b border-[var(--admin-border)] px-4 py-2.5 text-left">No Trip / Info Group</th>
                  <th className="border-b border-[var(--admin-border)] px-3 py-2.5 text-left">Waktu Batal</th>
                  <th className="border-b border-[var(--admin-border)] px-3 py-2.5 text-left">Golongan</th>
                  <th className="border-b border-[var(--admin-border)] px-3 py-2.5 text-left">Jenis Kendaraan</th>
                  <th className="border-b border-[var(--admin-border)] px-3 py-2.5 text-left">No. Polisi</th>
                  <th className="border-b border-[var(--admin-border)] px-3 py-2.5 text-left">Petugas Autorisasi</th>
                  <th className="border-b border-[var(--admin-border)] px-3 py-2.5 text-left">Foto</th>
                </tr>
              </thead>
              <tbody>
                {groups.map(group => {
                  const officerOpen = officerIsOpen(group.key)
                  return (
                    <Fragment key={group.key}>
                      {/* Header petugas */}
                      <tr
                        onClick={() => toggleOfficer(group.key)}
                        data-testid="cancel-group-header"
                        className="cursor-pointer bg-[var(--admin-surface-inverse)] text-[var(--admin-text-inverse)] transition-colors hover:bg-[var(--admin-surface-inverse-hover)]"
                      >
                        <td colSpan={7} className="px-4 py-2.5">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="flex items-center gap-1.5">
                              <ChevronRight size={13}
                                className={`text-[var(--admin-text-inverse-faint)] transition-transform ${officerOpen ? 'rotate-90' : ''}`} />
                              <span className="text-[13px] font-black">{group.officer}</span>
                            </span>
                            <span className="text-[11px] font-semibold text-[var(--admin-text-inverse-muted)]">
                              {group.dates.reduce((s, d) => s + d.tripCount, 0)} trip · {group.unitCount} unit
                            </span>
                          </span>
                        </td>
                      </tr>

                      {officerOpen && group.dates.map(day => {
                        const dateOpen = dateIsOpen(day.key)
                        return (
                          <Fragment key={day.key}>
                            {/* Header tanggal (folder) — semua trip tanggal ini */}
                            <tr
                              onClick={() => toggleDate(day.key)}
                              data-testid="cancel-date-header"
                              className="cursor-pointer bg-[var(--admin-surface-sunken)] transition-colors hover:bg-[var(--admin-surface-hover)]"
                            >
                              <td colSpan={7} className="pl-10 pr-3 py-2">
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className="flex items-center gap-1.5">
                                    <ChevronRight size={12}
                                      className={`text-[var(--admin-text-faint)] transition-transform ${dateOpen ? 'rotate-90' : ''}`} />
                                    <span className="text-[12px] font-black text-[var(--admin-text)]">{toDmy(day.key)}</span>
                                  </span>
                                  <span className="text-[10px] font-semibold text-[var(--admin-text-muted)]">
                                    {day.tripCount} trip · {day.rows.length} unit
                                  </span>
                                </span>
                              </td>
                            </tr>

                            {dateOpen && day.rows.map(row => {
                              const c = row.cancel
                              const v = row.vehicle
                              const isOpen = expanded === row.key
                              return (
                                <Fragment key={row.key}>
                                  <tr
                                    onClick={() => setExpanded(isOpen ? null : row.key)}
                                    onKeyDown={event => {
                                      if (event.key === 'Enter' || event.key === ' ') {
                                        event.preventDefault()
                                        setExpanded(isOpen ? null : row.key)
                                      }
                                    }}
                                    tabIndex={0}
                                    aria-expanded={isOpen}
                                    data-testid="cancel-vehicle-row"
                                    className="cursor-pointer border-b border-[var(--admin-border-subtle)] transition-colors hover:bg-[var(--admin-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--admin-accent)]"
                                  >
                                    <td className="pl-14 pr-3 py-2.5 font-mono text-[11px] font-bold text-[var(--admin-text-soft)]">{c.no_cancel}</td>
                                    <td className="whitespace-nowrap px-3 py-2.5 text-[11px] text-[var(--admin-text-muted)]">
                                      {cancelTimeLabel(c.cancelled_at)}
                                    </td>
                                    <td className="px-3 py-2.5">
                                      <span className={`rounded px-2 py-0.5 text-[10px] font-semibold border ${golBadgeClass(v?.category)}`}>
                                        {v?.category?.trim() || '-'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2.5 text-[var(--admin-text-muted)]">{v?.type?.trim() || '-'}</td>
                                    <td className="px-3 py-2.5 font-mono text-[var(--admin-text-soft)]">{v?.plate?.trim() || '-'}</td>
                                    <td className="px-3 py-2.5 text-[var(--admin-text-soft)]">{c.officer_name || '-'}</td>
                                    <td className="px-3 py-2.5">
                                      <CancelPhotoThumbs photos={c.photos} count={c.photo_count} />
                                    </td>
                                  </tr>

                                  {isOpen && (
                                    <tr>
                                      <td colSpan={7} className="bg-[var(--admin-surface-muted)] px-10 py-2 text-[11px] text-[var(--admin-text-muted)]">
                                        <span className="font-bold text-[var(--admin-text-soft)]">alasan =</span>{' '}
                                        {typedCancelReason(c.reason, c.note) || '-'}
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })}
                          </Fragment>
                        )
                      })}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/** Badge golongan kendaraan. */
function golBadgeClass(category?: string): string {
  const c = String(category ?? '').trim()
  if (c.includes('Internal')) return 'border-[var(--admin-border-strong)] text-[var(--admin-text)]'
  if (c.includes('Eksternal')) return 'border-[var(--admin-neutral)] text-[var(--admin-text-muted)]'
  return 'border-[var(--admin-border)] text-[var(--admin-text-faint)]'
}

/**
 * Thumbnail foto draft pembatalan untuk kolom tabel (buka di tab baru).
 *
 * `photos` kosong pada dokumen yang dikirim aplikasi versi lama: yang tersisa
 * hanya `photo_count`, jadi ditampilkan sebagai angka supaya tidak dikira hilang.
 * URL relatif ("/files/...") diarahkan ke origin API (port beda dari admin).
 */
function CancelPhotoThumbs({
  photos,
  count,
}: {
  photos?: Array<{ url: string; label?: string | null }> | null
  count?: number
}) {
  const list = photos ?? []
  if (!list.length) {
    return count && count > 0 ? (
      <span className="text-[10px] text-[var(--admin-text-faint)]" title="Foto tidak tersedia - dikirim aplikasi versi lama">
        {count} foto
      </span>
    ) : (
      <span className="text-[10px] text-[var(--admin-text-faint)]">-</span>
    )
  }
  return (
    <span className="flex items-center gap-1">
      {list.slice(0, 3).map((p, i) => (
        <a
          key={`${p.url}-${i}`}
          href={fileUrl(p.url)}
          target="_blank"
          rel="noreferrer"
          title={p.label ?? 'Foto draft'}
          onClick={e => e.stopPropagation()}
          className="h-9 w-9 overflow-hidden rounded-md ring-1 ring-[var(--admin-border)] transition hover:ring-[var(--admin-accent)]"
        >
          <img
            src={fileUrl(p.url)}
            alt={p.label ?? 'Foto draft'}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        </a>
      ))}
      {list.length > 3 && (
        <span className="text-[10px] font-bold text-[var(--admin-text-muted)]">+{list.length - 3}</span>
      )}
    </span>
  )
}

/**
 * Kartu ringkasan (label kecil, angka besar + satuan, keterangan di bawah).
 */
function SummaryCard({
  label,
  value,
  unit,
  hint,
  Icon,
}: {
  label: string
  value: string
  unit?: string
  hint?: string
  Icon: LucideIcon
}) {
  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-4 py-3 shadow-[var(--admin-shadow-card)]">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-[var(--admin-text-faint)]">
        <Icon size={13} className="text-[var(--admin-text-muted)]" /> {label}
      </div>
      <p className="mt-1.5 flex items-baseline gap-1.5 text-xl font-black text-[var(--admin-text)]">
        {value}
        {unit && <span className="text-[12px] font-bold text-[var(--admin-text-muted)]">{unit}</span>}
      </p>
      {hint && (
        <p className="mt-0.5 truncate text-[11px] text-[var(--admin-text-faint)]" title={hint}>{hint}</p>
      )}
    </div>
  )
}
