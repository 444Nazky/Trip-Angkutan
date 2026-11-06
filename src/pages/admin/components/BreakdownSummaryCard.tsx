import { useMemo, useState } from 'react'
import { reportGolongan, type ReportTrip } from '../../../services/trips'
import { vehicleTypeKey } from '../../../services/vehicleTypes'
import { CurrencyDisplay } from './CurrencyDisplay'

type Mode = 'golongan' | 'jenis'

interface Bucket {
  key: string
  ids: Set<string>
  adaIds: Set<string>
  revenue: number
}

interface Row {
  key: string
  trips: number
  ada: number
  tanpa: number
  revenue: number
  pct: number
}

interface Column {
  key: string
  trips: number
  revenue: number
  rows: Row[]
}

// Eksternal selalu paling kanan (user: pindahkan card golongan Eksternal).
const GOLONGAN_ORDER = ['Internal', 'Lokal', 'Eksternal']
const GOLONGAN_RANK = new Map(GOLONGAN_ORDER.map((g, i) => [g, i]))

function masterIndex(masterTypes: string[]) {
  const names = [...new Set(masterTypes.map(n => String(n).trim()).filter(Boolean))]
  const rank = new Map<string, number>()
  const byKey = new Map<string, string>()
  names.forEach((n, i) => {
    rank.set(n, i)
    byKey.set(vehicleTypeKey(n), n)
  })
  return { names, rank, byKey }
}

function typeDisplayName(raw: unknown, byKey: Map<string, string>): string {
  const t = String(raw ?? '').trim()
  if (!t) return '-'
  // Samakan ejaan data lawas (mis. "Truck Kecil") ke nama master ("Truk Kecil").
  return byKey.get(vehicleTypeKey(t)) ?? t
}

function buildBreakdown(
  reportTrips: ReportTrip[],
  mode: Mode,
  masterTypes: string[],
): { columns: Column[]; unclassified: number } {
  const { names: masterNames, rank: masterRank, byKey: masterByKey } = masterIndex(masterTypes)
  const cols = new Map<string, Map<string, Bucket>>()
  const colIds = new Map<string, Set<string>>()
  const colRevenue = new Map<string, number>()
  let unclassified = 0

  for (const t of reportTrips) {
    const vehicles = t.vehicles ?? []
    if (vehicles.length === 0) {
      unclassified += 1
      continue
    }
    for (const v of vehicles) {
      const g = reportGolongan(v)
      const type = typeDisplayName(v.vehicle_type, masterByKey)
      const colKey = mode === 'golongan' ? g : type
      const rowKey = mode === 'golongan' ? type : g

      let rows = cols.get(colKey)
      if (!rows) { rows = new Map(); cols.set(colKey, rows) }
      let bucket = rows.get(rowKey)
      if (!bucket) { bucket = { key: rowKey, ids: new Set(), adaIds: new Set(), revenue: 0 }; rows.set(rowKey, bucket) }

      bucket.ids.add(t.id)
      if (Number(v.has_load) > 0) bucket.adaIds.add(t.id)
      bucket.revenue += Number(v.tariff_amount) || 0

      let ids = colIds.get(colKey)
      if (!ids) { ids = new Set(); colIds.set(colKey, ids) }
      ids.add(t.id)
      colRevenue.set(colKey, (colRevenue.get(colKey) ?? 0) + (Number(v.tariff_amount) || 0))
    }
  }

  const colRank = (key: string) =>
    mode === 'golongan'
      ? GOLONGAN_RANK.get(key) ?? GOLONGAN_ORDER.length
      : masterRank.get(key) ?? masterNames.length
  const rowRank = (key: string) =>
    mode === 'golongan'
      ? masterRank.get(key) ?? masterNames.length
      : GOLONGAN_RANK.get(key) ?? GOLONGAN_ORDER.length

  // Mode golongan: tiga golongan selalu tampil. Mode jenis: semua jenis di
  // master tampil. Jenis/golongan lawas di luar master ikut tampil di akhir.
  const baseCols = mode === 'golongan' ? GOLONGAN_ORDER : masterNames
  const extraCols = [...cols.keys()].filter(k => !baseCols.includes(k))
  const colKeys = [...baseCols, ...extraCols].sort(
    (a, b) => colRank(a) - colRank(b) || a.localeCompare(b),
  )

  const baseRows = mode === 'golongan' ? masterNames : GOLONGAN_ORDER

  const columns: Column[] = colKeys.map(colKey => {
    const rowsMap = cols.get(colKey) ?? new Map<string, Bucket>()
    const trips = colIds.get(colKey)?.size ?? 0
    const extraRows = [...rowsMap.keys()].filter(k => !baseRows.includes(k))
    const rowKeys = [...baseRows, ...extraRows].sort(
      (a, b) => rowRank(a) - rowRank(b) || a.localeCompare(b),
    )
    const rows: Row[] = rowKeys.map(key => {
      const b = rowsMap.get(key)
      const tripCount = b?.ids.size ?? 0
      return {
        key,
        trips: tripCount,
        ada: b?.adaIds.size ?? 0,
        tanpa: b ? b.ids.size - b.adaIds.size : 0,
        revenue: b?.revenue ?? 0,
        pct: trips > 0 ? (tripCount / trips) * 100 : 0,
      }
    })
    return { key: colKey, trips, revenue: colRevenue.get(colKey) ?? 0, rows }
  })

  return { columns, unclassified }
}

interface Props {
  reportTrips: ReportTrip[]
  /** Nama jenis kendaraan dari master database (`/vehicle-types`). */
  vehicleTypes?: string[]
  revealed: boolean
  onToggleReveal: () => void
}

export function BreakdownSummaryCard({ reportTrips, vehicleTypes = [], revealed, onToggleReveal }: Props) {
  const [mode, setMode] = useState<Mode>('golongan')
  const { columns, unclassified } = useMemo(
    () => buildBreakdown(reportTrips, mode, vehicleTypes),
    [reportTrips, mode, vehicleTypes],
  )

  return (
    <div className="bg-[var(--admin-surface)] rounded-2xl border border-[var(--admin-border)] shadow-[var(--admin-shadow-card)]">
      <div className="flex items-center justify-between gap-3 flex-wrap px-5 pt-5 pb-4 border-b border-[var(--admin-border-subtle)]">
        <div>
          <h4 className="font-black text-[var(--admin-text)] text-[15px]">Breakdown Summary Card</h4>
          <p className="text-[11px] text-[var(--admin-text-faint)]">Trip, muatan, dan tarif per golongan &amp; jenis kendaraan - mengikuti filter laporan yang sama.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-1 text-[11px] font-bold">
          {([
            ['golongan', 'Golongan → Jenis Kendaraan'],
            ['jenis', 'Jenis Kendaraan → Golongan'],
          ] as [Mode, string][]).map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value)}
              aria-pressed={mode === value}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                mode === value
                  ? 'bg-[var(--admin-surface)] text-[var(--admin-accent-text)] border border-[var(--admin-accent-border)] shadow-sm'
                  : 'text-[var(--admin-text-muted)] hover:text-[var(--admin-text-soft)] border border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {columns.length === 0 ? (
        <p className="px-5 py-8 text-center text-[12px] text-[var(--admin-text-faint)]">
          {unclassified > 0
            ? `${unclassified} trip tanpa data kendaraan tidak bisa dikelompokkan.`
            : 'Belum ada data pada rentang ini.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5 items-start">
        {columns.map(col => (
          <div key={col.key} data-testid="breakdown-column" className="rounded-xl border border-[var(--admin-border)] overflow-hidden">
            <div data-testid="breakdown-column-header" className="flex items-start justify-between gap-3 px-4 py-3 bg-[var(--admin-surface-muted)] border-b border-[var(--admin-border)]">
              <p className="text-[13px] font-black text-[var(--admin-text-soft)]">
                {mode === 'golongan' ? 'Golongan' : 'Jenis'}: {col.key}
              </p>
              <div className="text-right">
                <p className="text-[12px] font-black text-[var(--admin-accent-text)] leading-tight">{col.trips} Trip</p>
                <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={col.revenue} className="text-[11px] font-semibold text-[var(--admin-text-faint)]" />
              </div>
            </div>
            <div className="divide-y divide-[var(--admin-border-subtle)] max-h-72 overflow-y-auto overscroll-contain">
              {col.rows.map(row => {
                const revenueRelevant = (mode === 'golongan' ? col.key : row.key) === 'Eksternal'
                return (
                  <div key={row.key} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-[12px] font-bold text-[var(--admin-text-soft)] truncate" title={row.key}>{row.key}</p>
                      <p className="text-[11px] font-black text-[var(--admin-text)] tabular-nums whitespace-nowrap">
                        {row.trips} Trip <span className="text-[var(--admin-text-faint)] font-semibold">({row.pct.toFixed(1)}%)</span>
                      </p>
                    </div>
                    <div className="mt-1.5 h-1.5 rounded-full bg-[var(--admin-surface-sunken)] overflow-hidden">
                      <div className="h-full rounded-full bg-[var(--admin-accent)]" style={{ width: row.trips > 0 ? `${Math.max(2, row.pct)}%` : '0%' }} />
                    </div>
                    {revenueRelevant && row.trips > 0 && (
                      <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-[var(--admin-border-subtle)] bg-[var(--admin-surface-muted)] p-2">
                        {([
                          { label: 'Ada Muatan', count: row.ada, tone: 'text-[var(--admin-success-text)] bg-[var(--admin-success-soft)] border-[var(--admin-success-border)]', bar: 'bg-[var(--admin-success)]' },
                          { label: 'Tanpa Muatan', count: row.tanpa, tone: 'text-[var(--admin-text-muted)] bg-[var(--admin-surface-sunken)] border-[var(--admin-border)]', bar: 'bg-[var(--admin-neutral)]' },
                        ]).map(({ label, count, tone, bar }) => (
                          <div key={label}>
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${tone}`}>{label}</span>
                              <span className="text-[10px] font-bold text-[var(--admin-text-muted)] tabular-nums">{count} Trip</span>
                            </div>
                            <div className="mt-1 h-1 rounded-full bg-[var(--admin-border)] overflow-hidden">
                              <div className={`h-full rounded-full ${bar}`} style={{ width: row.trips > 0 ? `${Math.max(2, (count / row.trips) * 100)}%` : '0%' }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
        </div>
      )}

      {unclassified > 0 && columns.length > 0 && (
        <p className="px-5 pb-4 text-[10px] text-[var(--admin-text-faint)]">
          {unclassified} trip tanpa data kendaraan tidak ikut dihitung di atas.
        </p>
      )}
    </div>
  )
}
