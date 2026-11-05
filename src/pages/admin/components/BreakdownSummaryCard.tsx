import { useMemo, useState } from 'react'
import { OPERATIONAL_CATEGORIES, reportGolongan, type ReportTrip } from '../../../services/trips'
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

const OPERATIONAL_ORDER = new Map(OPERATIONAL_CATEGORIES.map((g, i) => [g, i]))

function sortColumnKeys(keys: string[], mode: Mode): string[] {
  return [...keys].sort((a, b) => {
    if (mode === 'golongan') {
      const ia = OPERATIONAL_ORDER.get(a) ?? OPERATIONAL_CATEGORIES.length
      const ib = OPERATIONAL_ORDER.get(b) ?? OPERATIONAL_CATEGORIES.length
      return ia !== ib ? ia - ib : a.localeCompare(b)
    }
    return a.localeCompare(b)
  })
}

function buildBreakdown(reportTrips: ReportTrip[], mode: Mode): { columns: Column[]; unclassified: number } {
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
      const type = (v.vehicle_type ?? '').trim() || '-'
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

  const columns: Column[] = sortColumnKeys([...cols.keys()], mode).map(colKey => {
    const rowsMap = cols.get(colKey)!
    const trips = colIds.get(colKey)?.size ?? 0
    const rows: Row[] = [...rowsMap.values()]
      .map(b => ({
        key: b.key,
        trips: b.ids.size,
        ada: b.adaIds.size,
        tanpa: b.ids.size - b.adaIds.size,
        revenue: b.revenue,
        pct: trips > 0 ? (b.ids.size / trips) * 100 : 0,
      }))
      .sort((a, b) => b.trips - a.trips || a.key.localeCompare(b.key))
    return { key: colKey, trips, revenue: colRevenue.get(colKey) ?? 0, rows }
  })

  return { columns, unclassified }
}

interface Props {
  reportTrips: ReportTrip[]
  revealed: boolean
  onToggleReveal: () => void
}

export function BreakdownSummaryCard({ reportTrips, revealed, onToggleReveal }: Props) {
  const [mode, setMode] = useState<Mode>('golongan')
  const { columns, unclassified } = useMemo(() => buildBreakdown(reportTrips, mode), [reportTrips, mode])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap px-5 pt-5 pb-4 border-b border-slate-100">
        <div>
          <h4 className="font-black text-slate-900 text-[15px]">Breakdown Summary Card</h4>
          <p className="text-[11px] text-slate-400">Trip, muatan, dan tarif per golongan &amp; jenis kendaraan - mengikuti filter laporan yang sama.</p>
        </div>
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 text-[11px] font-bold">
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
                  ? 'bg-white text-blue-600 border border-blue-200 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 border border-transparent'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {columns.length === 0 ? (
        <p className="px-5 py-8 text-center text-[12px] text-slate-400">
          {unclassified > 0
            ? `${unclassified} trip tanpa data kendaraan tidak bisa dikelompokkan.`
            : 'Belum ada data pada rentang ini.'}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 p-5 items-start">
          {columns.map(col => (
            <div key={col.key} className="rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-4 py-3 bg-slate-50/80 border-b border-slate-200">
                <p className="text-[13px] font-black text-slate-800">
                  {mode === 'golongan' ? 'Golongan' : 'Jenis'}: {col.key}
                </p>
                <div className="text-right">
                  <p className="text-[12px] font-black text-blue-600 leading-tight">{col.trips} Trip</p>
                  <CurrencyDisplay revealed={revealed} onToggleReveal={onToggleReveal} amount={col.revenue} className="text-[11px] font-semibold text-slate-400" />
                </div>
              </div>
              <div className="divide-y divide-slate-100">
                {col.rows.map(row => {
                  const revenueRelevant = (mode === 'golongan' ? col.key : row.key) === 'Eksternal'
                  return (
                    <div key={row.key} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[12px] font-bold text-slate-700 truncate" title={row.key}>{row.key}</p>
                        <p className="text-[11px] font-black text-slate-800 tabular-nums whitespace-nowrap">
                          {row.trips} Trip <span className="text-slate-400 font-semibold">({row.pct.toFixed(1)}%)</span>
                        </p>
                      </div>
                      <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.max(2, row.pct)}%` }} />
                      </div>
                      {revenueRelevant && (
                        <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                          {([
                            { label: 'Ada Muatan', count: row.ada, tone: 'text-emerald-700 bg-emerald-50 border-emerald-200', bar: 'bg-emerald-500' },
                            { label: 'Tanpa Muatan', count: row.tanpa, tone: 'text-slate-500 bg-slate-100 border-slate-200', bar: 'bg-slate-400' },
                          ]).map(({ label, count, tone, bar }) => (
                            <div key={label}>
                              <div className="flex items-center justify-between gap-2">
                                <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border ${tone}`}>{label}</span>
                                <span className="text-[10px] font-bold text-slate-600 tabular-nums">{count} Trip</span>
                              </div>
                              <div className="mt-1 h-1 rounded-full bg-slate-200/70 overflow-hidden">
                                <div className={`h-full rounded-full ${bar}`} style={{ width: `${row.trips > 0 ? Math.max(2, (count / row.trips) * 100) : 0}%` }} />
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
        <p className="px-5 pb-4 text-[10px] text-slate-400">
          {unclassified} trip tanpa data kendaraan tidak ikut dihitung di atas.
        </p>
      )}
    </div>
  )
}
