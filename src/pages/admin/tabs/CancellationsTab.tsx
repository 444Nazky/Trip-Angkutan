import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { Ban, Download, RefreshCw, Search } from 'lucide-react'
import {
  fetchTripCancellations,
  fetchTripCancellationSummary,
  formatReportDateTime,
  type TripCancellation,
  type TripCancellationSummary,
} from '../../../services/trips'
import { CANCEL_REASONS } from '../../../services/cancelReasons'
import { downloadXlsx } from '../../../services/xlsx'
import { ReasonBars } from '../components/ReasonBars'
import { DailyTrend } from '../components/DailyTrend'

interface CancellationsTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

type RangeKey = 'today' | '7d' | '30d' | '90d' | 'all'

const RANGE_PRESETS: { key: RangeKey; label: string; days: number | null }[] = [
  { key: 'today', label: 'Hari Ini', days: 1 },
  { key: '7d', label: '7 Hari', days: 7 },
  { key: '30d', label: '30 Hari', days: 30 },
  { key: '90d', label: '90 Hari', days: 90 },
  { key: 'all', label: 'Semua', days: null },
]

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

/**
 * Tab "Pembatalan Trip" — pemantauan trip yang dibatalkan petugas beserta
 * alasannya.
 *
 * Trip yang dibatalkan WAJIB punya alasan (dokumen pembatalan), jadi di sini
 * alasannya adalah isi utama halaman, bukan sekadar kolom tambahan.
 *
 * Satu baris filter di atas mengatur SELURUH isi halaman (kartu, grafik,
 * tabel) — semua digambar dari potongan data yang sama, jadi angkanya selalu
 * cocok satu sama lain.
 */
export function CancellationsTab({ showToast }: CancellationsTabProps) {
  const [range, setRange] = useState<RangeKey>('30d')
  const [reason, setReason] = useState('')
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')

  const [rows, setRows] = useState<TripCancellation[]>([])
  const [summary, setSummary] = useState<TripCancellationSummary | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'offline'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

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

  const total = summary?.total ?? rows.length
  const topReason = summary?.byReason?.[0]

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 font-black text-slate-900 text-lg">
            <Ban size={18} className="text-red-500" /> Pembatalan Trip
          </h3>
          <p className="text-slate-500 text-[12px]">
            Trip yang dibatalkan petugas beserta alasannya — setiap pembatalan
            menghasilkan dokumen, jadi tidak ada trip yang hilang tanpa jejak.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={state === 'loading'}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} /> Muat Ulang
          </button>
          <button
            onClick={exportXlsx}
            disabled={!rows.length}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            <Download size={14} /> .xlsx
          </button>
        </div>
      </div>

      {/* SATU baris filter di atas semua — mengatur kartu, grafik, dan tabel
          sekaligus, jadi semua menunjuk potongan data yang sama. */}
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-[11px] font-bold text-slate-500">Rentang</label>
          <div className="flex gap-1.5">
            {RANGE_PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => setRange(p.key)}
                className={`rounded-lg border px-3 py-1.5 text-[11px] font-bold transition-colors ${
                  range === p.key
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-bold text-slate-500">Alasan</label>
          <select
            value={reason}
            onChange={e => setReason(e.target.value)}
            className="min-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
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
          <label className="mb-1 block text-[11px] font-bold text-slate-500">Cari</label>
          <div className="flex gap-1.5">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="No. dokumen, rute, atau keterangan"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700"
              />
            </div>
            <button
              type="submit"
              className="rounded-xl border border-slate-200 px-3 py-2 text-[11px] font-bold text-slate-600 transition-colors hover:bg-slate-50"
            >
              Cari
            </button>
          </div>
        </form>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3">
          <p className="text-[13px] font-bold text-red-700">{error}</p>
          <p className="mt-0.5 text-[11px] text-red-600">
            Pastikan tabel <span className="font-mono">trip_cancellations</span> sudah ada di
            database (jalankan migrasi server).
          </p>
        </div>
      )}

      {/* Kartu statistik — angkanya besar dan proporsional, bukan tabular. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Total pembatalan" value={total} />
        <StatTile
          label="Kendaraan dibatalkan"
          value={summary?.vehicleCount ?? 0}
        />
        <StatTile
          label="Alasan teratas"
          value={topReason?.count ?? 0}
          hint={topReason?.reason}
        />
        <StatTile
          label="Petugas terlibat"
          value={summary?.byOfficer?.length ?? 0}
        />
      </div>

      {/* Grafik */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h4 className="text-[13px] font-black text-slate-800">Pembatalan per alasan</h4>
          <p className="mb-3 text-[11px] text-slate-500">
            Alasan yang paling sering dipilih petugas.
          </p>
          <div className={state === 'loading' ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <ReasonBars data={summary?.byReason ?? []} total={total} />
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h4 className="text-[13px] font-black text-slate-800">Tren per hari</h4>
          <p className="mb-3 text-[11px] text-slate-500">
            Jumlah dokumen pembatalan yang masuk setiap hari.
          </p>
          <div className={state === 'loading' ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
            <DailyTrend data={summary?.byDay ?? []} />
          </div>
        </div>
      </div>

      {/* Tabel dokumen — table view: semua angka grafik bisa dibaca di sini
          juga, tidak hanya lewat hover. */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h4 className="text-[13px] font-black text-slate-800">Dokumen pembatalan</h4>
            <p className="text-[11px] text-slate-500">
              Klik baris untuk melihat rincian kendaraan yang dibatalkan.
            </p>
          </div>
          <span className="rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-bold text-red-600">
            {rows.length} dokumen
          </span>
        </div>

        {state === 'loading' && rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-slate-400 animate-pulse">Memuat...</p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-slate-400">
            Belum ada trip yang dibatalkan pada rentang ini.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 p-3 text-left">No. Dokumen</th>
                  <th className="border-b border-slate-200 p-3 text-left">Waktu</th>
                  <th className="border-b border-slate-200 p-3 text-left">Petugas</th>
                  <th className="border-b border-slate-200 p-3 text-left">Rute</th>
                  <th className="border-b border-slate-200 p-3 text-left">Alasan</th>
                  <th className="border-b border-slate-200 p-3 text-right">Kendaraan</th>
                  <th className="border-b border-slate-200 p-3 text-right">Foto</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map(c => {
                  const isOpen = expanded === c.id
                  return (
                    <Fragment key={c.id}>
                      <tr
                        onClick={() => setExpanded(isOpen ? null : c.id)}
                        className="cursor-pointer transition-colors duration-150 hover:bg-slate-50"
                      >
                        <td className="p-3 font-mono text-[11px] font-bold text-slate-700">{c.no_cancel}</td>
                        <td className="p-3 text-[11px] text-slate-600">
                          {c.cancelled_at ? formatReportDateTime(c.cancelled_at).full : '-'}
                        </td>
                        <td className="p-3 text-[12px] text-slate-700">
                          {c.officer_name ?? <span className="text-slate-300">-</span>}
                          {c.region_code && (
                            <span className="ml-1 text-[10px] text-slate-400">{c.region_code}</span>
                          )}
                        </td>
                        <td className="p-3 text-[11px] text-slate-600">
                          {[c.route_from, c.route_to].filter(Boolean).join(' → ') || c.route_code || '-'}
                        </td>
                        <td className="p-3">
                          <span className="rounded-full bg-red-50 px-2 py-1 text-[10px] font-bold text-red-700">
                            {c.reason}
                          </span>
                          {c.note && (
                            <p className="mt-1 max-w-[240px] truncate text-[10px] text-slate-500" title={c.note}>
                              {c.note}
                            </p>
                          )}
                        </td>
                        <td className="p-3 text-right text-[12px] tabular-nums text-slate-700">
                          {c.vehicle_count ?? 0}
                        </td>
                        <td className="p-3 text-right text-[12px] tabular-nums text-slate-700">
                          {c.photo_count ?? 0}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr>
                          <td colSpan={7} className="bg-slate-50 px-3 py-3">
                            <p className="mb-2 text-[11px] font-bold text-slate-600">
                              Rincian trip yang dibatalkan
                            </p>
                            {c.vehicles && c.vehicles.length > 0 ? (
                              <table className="w-full text-[11px]">
                                <thead className="text-[10px] uppercase text-slate-400">
                                  <tr>
                                    <th className="p-2 text-left">No. Polisi</th>
                                    <th className="p-2 text-left">Jenis</th>
                                    <th className="p-2 text-left">Kategori</th>
                                    <th className="p-2 text-left">Beban</th>
                                    <th className="p-2 text-right">Tarif (Rp)</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200">
                                  {c.vehicles.map((v, i) => (
                                    <tr key={`${c.id}-v${i}`}>
                                      <td className="p-2 font-mono font-bold text-slate-700">{v.plate || '-'}</td>
                                      <td className="p-2 text-slate-600">{v.type || '-'}</td>
                                      <td className="p-2 text-slate-600">{v.category || '-'}</td>
                                      <td className="p-2 text-slate-600">{v.load || '-'}</td>
                                      <td className="p-2 text-right tabular-nums text-slate-700">
                                        {Number(v.tariff ?? 0).toLocaleString('id-ID')}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <p className="text-[11px] text-slate-400">
                                Tidak ada rincian kendaraan pada dokumen ini.
                              </p>
                            )}
                            {c.note && (
                              <p className="mt-2 text-[11px] text-slate-600">
                                <span className="font-bold">Keterangan petugas:</span> {c.note}
                              </p>
                            )}
                          </td>
                        </tr>
                      )}
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

/**
 * Kartu statistik (stat tile).
 *
 * Nilainya proporsional (bukan `tabular-nums`) — angka besar yang berdiri
 * sendiri jadi terlihat renggang kalau semua digitnya selebar digit "0".
 */
function StatTile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900">{value.toLocaleString('id-ID')}</p>
      {hint && (
        <p className="mt-0.5 truncate text-[11px] text-slate-500" title={hint}>{hint}</p>
      )}
    </div>
  )
}
