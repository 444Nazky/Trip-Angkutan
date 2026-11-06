import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, CarFront, ChevronRight, Download, ListChecks, RefreshCw, Search, Users, X, type LucideIcon } from 'lucide-react'
import {
  fetchTripCancellations,
  fetchTripCancellationSummary,
  formatReportDateTime,
  dayKeyWib,
  type TripCancellation,
  type TripCancellationSummary,
} from '../../../services/trips'
import { CANCEL_REASONS } from '../../../services/cancelReasons'
import { api } from '../../../services/api'
import { downloadXlsx } from '../../../services/xlsx'

interface CancellationsTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
  /** Tutup panel pembatalan (kembali ke halaman sebelumnya). */
  onClose?: () => void
}

type RangeKey = 'today' | '7d' | '30d' | '90d' | 'all'

const INPUT_CLS =
  'w-full rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface)] px-3 py-2 text-sm text-[var(--admin-text-soft)] outline-none transition focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]'
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
  { key: '90d', label: '90 Hari', days: 90 },
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

interface CancelGroup {
  key: string
  officer: string
  reason: string
  /** Jumlah dokumen pembatalan di grup ini. */
  count: number
  rows: CancelVehicleRow[]
}

/**
 * Kelompokkan pembatalan menurut "Petugas → Alasan Terbanyak".
 *
 * Setiap dokumen bisa berisi beberapa kendaraan, dan satu baris tabel =
 * satu kendaraan. Dokumen tanpa rincian kendaraan tetap tampil satu baris
 * (kolom kendaraan "-") supaya tidak ada pembatalan yang hilang dari daftar.
 */
function buildCancelGroups(rows: TripCancellation[]): CancelGroup[] {
  const map = new Map<string, CancelGroup>()
  for (const c of rows) {
    const officer = c.officer_name?.trim() || 'Tanpa nama'
    const reason = c.reason?.trim() || 'Tanpa alasan'
    const key = `${officer}|${reason}`
    let group = map.get(key)
    if (!group) { group = { key, officer, reason, count: 0, rows: [] }; map.set(key, group) }
    group.count += 1

    const vehicles = c.vehicles && c.vehicles.length > 0 ? c.vehicles : [null]
    vehicles.forEach((vehicle, i) => {
      group.rows.push({
        key: `${c.id}-${i}-${vehicle?.plate ?? 'tanpa-kendaraan'}`,
        cancel: c,
        vehicle,
      })
    })
  }

  // Petugas: pembatalan terbanyak dulu. Di dalamnya: alasan yang paling sering.
  const byOfficer = new Map<string, CancelGroup[]>()
  for (const group of map.values()) {
    const list = byOfficer.get(group.officer) ?? []
    list.push(group)
    byOfficer.set(group.officer, list)
  }
  const officerTotal = (list: CancelGroup[]) => list.reduce((s, g) => s + g.count, 0)

  return [...byOfficer.entries()]
    .sort((a, b) => officerTotal(b[1]) - officerTotal(a[1]) || a[0].localeCompare(b[0]))
    .flatMap(([, list]) => [...list].sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)))
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
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  const [rows, setRows] = useState<TripCancellation[]>([])
  const [summary, setSummary] = useState<TripCancellationSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading')
  const [error, setError] = useState<string | null>(null)
  /** Baris kendaraan yang rinciannya dibuka (klik baris). */
  const [expanded, setExpanded] = useState<string | null>(null)
  /** Grup (petugas → alasan) yang ditutupi manual. */
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set())
  const [allGroupsOpen, setAllGroupsOpen] = useState(true)

  /** Rentang tanggal hasil dari preset yang dipilih. */
  const dateRange = useMemo(() => {
    const preset = RANGE_PRESETS.find(p => p.key === range)
    if (!preset || preset.days === null) return { startDate: undefined, endDate: undefined }
    return { startDate: daysAgoWib(preset.days), endDate: todayWib() }
  }, [range])

  const filters = useMemo(
    () => ({
      ...dateRange,
      reason: reason || undefined,
      q: appliedSearch || undefined,
    }),
    [dateRange, reason, appliedSearch],
  )

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
  const groups = useMemo(() => buildCancelGroups(rows), [rows])
  const vehicleTotal = summary?.vehicleCount ?? groups.reduce((s, g) => s + g.rows.length, 0)

  // Golongan yang muncul pada kendaraan yang dibatalkan.
  const golonganList = useMemo(() => {
    const seen = new Set<string>()
    for (const g of groups) {
      for (const row of g.rows) {
        const cat = row.vehicle?.category?.trim()
        if (cat) seen.add(cat)
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

  const groupIsOpen = (key: string) => (allGroupsOpen ? !closedGroups.has(key) : closedGroups.has(key))
  const toggleGroup = (key: string) => {
    setClosedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }
  const setAllGroups = (open: boolean) => {
    setAllGroupsOpen(open)
    setClosedGroups(new Set())
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

        <div>
          <label className="mb-1 block text-[11px] font-bold text-[var(--admin-text-muted)]">Alasan</label>
          <select value={reason} onChange={e => setReason(e.target.value)} className={`${INPUT_CLS} min-w-[190px]`}>
            <option value="">Semua alasan</option>
            {CANCEL_REASONS.map(r => (
              <option key={r} value={r}>{r}</option>
            ))}
            {/* Alasan di luar daftar baku (mis. versi aplikasi lama) tetap
                bisa difilter lewat tabel ringkasan. */}
            {summary?.byReason
              ?.map(d => d.reason)
              .filter(r => !(CANCEL_REASONS as readonly string[]).includes(r))
              .map(r => (
                <option key={r} value={r}>{r}</option>
              ))}
          </select>
        </div>

        <form
          className="flex-1 min-w-[200px]"
          onSubmit={e => { e.preventDefault(); setAppliedSearch(search.trim()) }}
        >
          <label className="mb-1 block text-[11px] font-bold text-[var(--admin-text-muted)]">Cari</label>
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--admin-text-faint)]" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="No. dokumen, rute, atau keterangan"
                className={`${INPUT_CLS} py-2 pl-9 pr-3`}
              />
            </div>
            <button type="submit" className={BTN_GHOST}>Cari</button>
          </div>
        </form>
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
              Daftar Rincian Trip Dibatalkan (Petugas → Alasan Terbanyak)
            </h4>
            <p className="text-[11px] text-[var(--admin-text-muted)]">
              Satu baris = satu kendaraan. Klik baris untuk melihat keterangan, tarif, dan foto draft.
            </p>
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setAllGroups(false)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                !allGroupsOpen
                  ? 'border-[var(--admin-accent)] bg-[var(--admin-accent)] text-[var(--admin-accent-contrast)]'
                  : 'border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]'
              }`}
            >
              Collapse All
            </button>
            <button
              onClick={() => setAllGroups(true)}
              className={`rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-colors ${
                allGroupsOpen
                  ? 'border-[var(--admin-accent)] bg-[var(--admin-accent)] text-[var(--admin-accent-contrast)]'
                  : 'border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]'
              }`}
            >
              Expand All
            </button>
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
                </tr>
              </thead>
              <tbody>
                {groups.map(group => {
                  const open = groupIsOpen(group.key)
                  return (
                    <Fragment key={group.key}>
                      {/* Header grup: Petugas → Alasan */}
                      <tr
                        onClick={() => toggleGroup(group.key)}
                        data-testid="cancel-group-header"
                        className="cursor-pointer bg-[var(--admin-surface-inverse)] text-[var(--admin-text-inverse)] transition-colors hover:bg-[var(--admin-surface-inverse-hover)]"
                      >
                        <td colSpan={6} className="px-4 py-2.5">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="flex items-center gap-1.5">
                              <ChevronRight size={13}
                                className={`text-[var(--admin-text-inverse-faint)] transition-transform ${open ? 'rotate-90' : ''}`} />
                              <span className="text-[13px] font-black">{group.officer}</span>
                              <span className="text-[11px] text-[var(--admin-text-inverse-muted)]">· {group.reason}</span>
                            </span>
                            <span className="text-[11px] font-semibold text-[var(--admin-text-inverse-muted)]">
                              {group.count} trip · {group.rows.length} unit
                            </span>
                          </span>
                        </td>
                      </tr>

                      {open && group.rows.map(row => {
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
                              <td className="pl-10 pr-3 py-2.5 font-mono text-[11px] font-bold text-[var(--admin-text-soft)]">{c.no_cancel}</td>
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
                            </tr>

                            {isOpen && (
                              <tr>
                                <td colSpan={6} className="bg-[var(--admin-surface-muted)] px-10 py-3">
                                  <div className="grid gap-3 md:grid-cols-2">
                                    <div className="space-y-1 text-[11px] text-[var(--admin-text-muted)]">
                                      <p>
                                        <span className="font-bold text-[var(--admin-text-soft)]">Alasan:</span> {c.reason}
                                      </p>
                                      {c.note && (
                                        <p>
                                          <span className="font-bold text-[var(--admin-text-soft)]">Keterangan petugas:</span> {c.note}
                                        </p>
                                      )}
                                      <p>
                                        <span className="font-bold text-[var(--admin-text-soft)]">Rute:</span>{' '}
                                        {[c.route_from, c.route_to].filter(Boolean).join(' → ') || c.route_code || '-'}
                                      </p>
                                      <p>
                                        <span className="font-bold text-[var(--admin-text-soft)]">Muatan saat batal:</span>{' '}
                                        {c.condition === 'muatan' ? 'Muatan' : c.condition === 'kosong' ? 'Kosong' : '-'}
                                      </p>
                                    </div>
                                    <div className="space-y-1 text-[11px] text-[var(--admin-text-muted)]">
                                      {v && (
                                        <p>
                                          <span className="font-bold text-[var(--admin-text-soft)]">Kendaraan:</span>{' '}
                                          {v.type || '-'} · {v.plate || '-'} · {v.category || '-'}
                                          {v.load ? ` · ${v.load}` : ''}
                                        </p>
                                      )}
                                      <p>
                                        <span className="font-bold text-[var(--admin-text-soft)]">Tarif (Rp):</span>{' '}
                                        {Number(v?.tariff ?? 0).toLocaleString('id-ID')}
                                      </p>
                                      <p>
                                        <span className="font-bold text-[var(--admin-text-soft)]">Wilayah:</span>{' '}
                                        {c.region_code || '-'}
                                      </p>
                                    </div>
                                  </div>
                                  <CancelPhotos photos={c.photos} count={c.photo_count} />
                                </td>
                              </tr>
                            )}
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
 * Foto draft pembatalan.
 *
 * `photos` kosong pada dokumen yang dikirim aplikasi versi lama: yang tersisa
 * hanya `photo_count`, jadi admin diberi tahu supaya tidak mengira foto hilang.
 */
function CancelPhotos({
  photos,
  count,
}: {
  photos?: Array<{ url: string; label?: string | null }> | null
  count?: number
}) {
  const list = photos ?? []
  if (!list.length) {
    return count && count > 0 ? (
      <p className="mt-2 text-[11px] text-[var(--admin-text-faint)]">
        {count} foto tidak tersedia - dikirim aplikasi versi lama.
      </p>
    ) : null
  }
  // Server menyimpan URL berkas sebagai path relatif ("/files/..."). Halaman
  // admin disajikan dari port berbeda (8000) daripada API (3000), jadi path
  // relatif akan dicari di server admin dan fotonya 404.
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11px] font-bold text-[var(--admin-text-soft)]">Foto draft</p>
      <div className="flex flex-wrap gap-2">
        {list.map((p, i) => (
          <a
            key={`${p.url}-${i}`}
            href={fileUrl(p.url)}
            target="_blank"
            rel="noreferrer"
            className="group block w-24"
            title={p.label ?? 'Foto draft'}
          >
            <img
              src={fileUrl(p.url)}
              alt={p.label ?? 'Foto draft'}
              loading="lazy"
              className="h-24 w-24 rounded-lg border border-[var(--admin-border)] object-cover transition group-hover:border-[var(--admin-accent)]"
            />
            <span className="mt-1 block truncate text-[10px] text-[var(--admin-text-muted)]">
              {p.label ?? 'Foto draft'}
            </span>
          </a>
        ))}
      </div>
    </div>
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
