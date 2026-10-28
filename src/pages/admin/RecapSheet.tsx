import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Download, RefreshCw, Table2 } from 'lucide-react'
import { ensureAdminSession } from '../../services/auth'
import { fetchTripReports, type ReportFilters, type ReportTrip } from '../../services/trips'
import { buildRecap, recapRouteKey, recapRouteLabel } from '../../services/recap'
import { downloadXlsx } from '../../services/xlsx'
import {
  BADGE,
  BADGE_MUTED,
  BADGE_OK,
  BADGE_WARN,
  BTN_COMPACT,
  CARD,
  DOT_MUTED,
  DOT_OK,
  DOT_WARN,
  EMPTY_STATE,
  FOOT_CELL,
  FOOT_ROW,
  GROUP_ROW,
  INPUT,
  LABEL,
  PAGE_SUBTITLE,
  PAGE_TITLE,
  SHEET_BODY,
  SHEET_HEADER,
  STAT_LABEL,
  TABLE_CELL_GRID,
  TABLE_HEAD_CELL_GRID,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
} from './theme'

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

type LoadState = 'loading' | 'ready' | 'offline'

export default function RecapSheet() {
  const [rows, setRows] = useState<ReportTrip[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [route, setRoute] = useState('')
  const [state, setState] = useState<LoadState>('loading')
  const [lastSync, setLastSync] = useState('')
  const alive = useRef(true)

  const load = useCallback(async () => {
    setState(s => (s === 'ready' ? s : 'loading'))
    const sess = await ensureAdminSession()
    if (!alive.current) return
    if (!sess.ok) { setState('offline'); return }

    const filters: ReportFilters = {
      ...(startDate && endDate ? { startDate, endDate } : {}),
    }
    const data = await fetchTripReports(filters)
    if (!alive.current) return
    if (data === null) { setState('offline'); return }
    setRows(data)
    setState('ready')
    setLastSync(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))
  }, [startDate, endDate])

  useEffect(() => {
    alive.current = true
    void load()
    return () => { alive.current = false }
  }, [load])

  const routes = useMemo(() => {
    const map = new Map<string, string>()
    for (const trip of rows) {
      const key = recapRouteKey(trip)
      if (key) map.set(key, recapRouteLabel(trip))
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [rows])

  const groups = useMemo(() => {
    const list = route ? rows.filter(trip => recapRouteKey(trip) === route) : rows
    return buildRecap(list)
  }, [rows, route])

  const total = groups.reduce(
    (acc, g) => ({
      loaded: acc.loaded + g.loaded,
      empty: acc.empty + g.empty,
      total: acc.total + g.total,
      revenue: acc.revenue + g.revenue,
    }),
    { loaded: 0, empty: 0, total: 0, revenue: 0 },
  )

  const applyPreset = (days: number) => {
    const end = new Date()
    const start = new Date(Date.now() - (days - 1) * 86400000)
    setStartDate(dateKey(start))
    setEndDate(dateKey(end))
  }

  const exportRecap = () => {
    const header = ['Golongan', 'Jenis Kendaraan', 'Tanpa Muatan', 'Dengan Muatan', 'Total Kendaraan', 'Total Pendapatan (Rp)']
    const body = groups.flatMap(g => g.rows.map(r => [g.golongan, r.jenis, r.empty, r.loaded, r.total, r.revenue]))
    downloadXlsx(
      `rekap-trip-${new Date().toISOString().slice(0, 10)}.xlsx`,
      [{ name: 'Rekap Trip', rows: [header, ...body, ['', 'Total All Golongan', total.empty, total.loaded, total.total, total.revenue]] }],
    )
  }

  const resetFilters = () => {
    setStartDate('')
    setEndDate('')
    setRoute('')
  }

  return (
    <div className={SHEET_BODY}>
      <header className={SHEET_HEADER}>
        <div className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
          <span className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Table2 size={17} />
          </span>
          <div className="mr-auto">
            <h1 className={PAGE_TITLE}>Rekap Trip</h1>
            <p className={PAGE_SUBTITLE}>
              Ringkasan kendaraan dan pendapatan per golongan dan jenis kendaraan
              {lastSync && <> - terakhir {lastSync} WIB</>}
            </p>
          </div>
          <span className={`${BADGE} ${
            state === 'ready' ? BADGE_OK : state === 'offline' ? BADGE_WARN : BADGE_MUTED
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              state === 'ready' ? DOT_OK : state === 'offline' ? DOT_WARN : DOT_MUTED
            }`} />
            {state === 'ready' ? 'Connected' : state === 'offline' ? 'Offline' : 'Connecting...'}
          </span>
          <button onClick={exportRecap} disabled={groups.length === 0}
            className={BTN_COMPACT}
            title="Unduh rekap sebagai file Excel">
            <Download size={15} /> .xlsx
          </button>
          <button onClick={() => void load()} disabled={state === 'loading'}
            className={BTN_COMPACT}>
            <RefreshCw size={14} className={state === 'loading' ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => { window.location.hash = '#/sheet' }}
            className={BTN_COMPACT}
            title="Kembali ke laporan spreadsheet">
            <ArrowLeft size={15} /> Kembali
          </button>
        </div>
      </header>

      <main className="p-5">
        <section className={`${CARD} p-4 mb-4`}>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className={`${STAT_LABEL} mb-1.5`}>Periode</p>
              <div className="flex items-end gap-2">
                <label className={LABEL}>
                  Dari
                  <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                    className={`${INPUT} mt-1 max-w-[170px]`} />
                </label>
                <label className={LABEL}>
                  Sampai
                  <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                    className={`${INPUT} mt-1 max-w-[170px]`} />
                </label>
              </div>
            </div>

            <div className="flex gap-1.5">
              {[
                { label: 'Hari Ini', days: 1 },
                { label: '7 Hari', days: 7 },
                { label: '30 Hari', days: 30 },
              ].map(p => (
                <button key={p.label} onClick={() => applyPreset(p.days)}
                  className={BTN_COMPACT}>
                  {p.label}
                </button>
              ))}
            </div>

            <label className={LABEL}>
              Rute
              <select value={route} onChange={e => setRoute(e.target.value)}
                className={`${INPUT} mt-1 min-w-[220px]`}>
                <option value="">Semua Rute</option>
                {routes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </label>

            <button onClick={resetFilters} className={BTN_COMPACT}>
              Reset
            </button>

            <span className="ml-auto self-end pb-2 text-[11px] text-slate-400 font-medium">
              {startDate && endDate ? `${startDate} s/d ${endDate}` : 'Semua tanggal'}
            </span>
          </div>
        </section>

        <section className={TABLE_WRAP}>
          <div className="overflow-auto max-h-[calc(100vh-250px)]">
            <table className="w-full border-collapse text-[13px] min-w-[860px]">
              <thead className="sticky top-0 z-10">
                <tr className={TABLE_HEAD_ROW}>
                  <th className={`${TABLE_HEAD_CELL_GRID} text-left w-[120px]`}>Golongan</th>
                  <th className={`${TABLE_HEAD_CELL_GRID} text-left`}>Jenis Kendaraan</th>
                  <th className={`${TABLE_HEAD_CELL_GRID} text-center w-[150px]`}>Tanpa Muatan</th>
                  <th className={`${TABLE_HEAD_CELL_GRID} text-center w-[150px]`}>Dengan Muatan</th>
                  <th className={`${TABLE_HEAD_CELL_GRID} text-center w-[140px]`}>Total Kendaraan</th>
                  <th className={`${TABLE_HEAD_CELL_GRID} text-right w-[180px]`}>Total Pendapatan (Rp)</th>
                </tr>
              </thead>

              {state !== 'ready' ? (
                <tbody>
                  <tr>
                    <td colSpan={6} className={EMPTY_STATE}>
                      {state === 'offline' ? 'Tidak tersambung ke server' : 'Memuat rekap...'}
                    </td>
                  </tr>
                </tbody>
              ) : groups.length === 0 ? (
                <tbody>
                  <tr><td colSpan={6} className={EMPTY_STATE}>Tidak ada data pada filter ini</td></tr>
                </tbody>
              ) : groups.map((group, gi) => (
                <tbody key={`gol-${group.golongan}`}>
                  {gi > 0 && (
                    <tr><td colSpan={6} className={`${GROUP_ROW} h-[10px] p-0`} /></tr>
                  )}
                  {group.rows.map((row, idx) => (
                    <tr key={`${group.golongan}-${row.jenis}`} className="hover:bg-slate-50/60">
                      {idx === 0 && (
                        <td rowSpan={group.rows.length}
                          className={`${TABLE_CELL_GRID} align-middle text-left font-semibold text-slate-900`}>
                          {group.golongan}
                        </td>
                      )}
                      <td className={`${TABLE_CELL_GRID} text-slate-700`}>{row.jenis}</td>
                      <td className={`${TABLE_CELL_GRID} text-center tabular-nums`}>{row.empty}</td>
                      <td className={`${TABLE_CELL_GRID} text-center tabular-nums`}>{row.loaded}</td>
                      <td className={`${TABLE_CELL_GRID} text-center tabular-nums`}>{row.total}</td>
                      <td className={`${TABLE_CELL_GRID} text-right tabular-nums`}>{row.revenue}</td>
                    </tr>
                  ))}
                </tbody>
              ))}

              {groups.length > 0 && (
                <tfoot>
                  <tr className={FOOT_ROW}>
                    <td colSpan={2} className={`${FOOT_CELL} uppercase tracking-wide text-[11px]`}>
                      Total All Golongan
                    </td>
                    <td className={`${FOOT_CELL} text-center tabular-nums`}>{total.empty}</td>
                    <td className={`${FOOT_CELL} text-center tabular-nums`}>{total.loaded}</td>
                    <td className={`${FOOT_CELL} text-center tabular-nums`}>{total.total}</td>
                    <td className={`${FOOT_CELL} text-right tabular-nums`}>{total.revenue}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>
      </main>
    </div>
  )
}
