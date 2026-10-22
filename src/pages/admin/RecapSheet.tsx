import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, RefreshCw, Table2 } from 'lucide-react'
import { ensureAdminSession } from '../../services/auth'
import { fetchTripReports, type ReportFilters, type ReportTrip } from '../../services/trips'
import { buildRecap, recapRouteKey, recapRouteLabel } from '../../services/recap'

const fmtRp = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`
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
    const ok = await ensureAdminSession()
    if (!alive.current) return
    if (!ok) { setState('offline'); return }

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

  const resetFilters = () => {
    setStartDate('')
    setEndDate('')
    setRoute('')
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="px-5 py-3 flex items-center gap-3 flex-wrap">
          <span className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0">
            <Table2 size={17} />
          </span>
          <div className="mr-auto">
            <h1 className="font-extrabold text-slate-900 text-[15px] leading-tight">Rekap Trip</h1>
            <p className="text-[11px] text-slate-400">
              Ringkasan kendaraan dan pendapatan per golongan dan jenis kendaraan
              {lastSync && <> - terakhir {lastSync} WIB</>}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${
            state === 'ready' ? 'border-slate-200 text-slate-600'
            : state === 'offline' ? 'border-amber-200 text-amber-700' : 'border-slate-200 text-slate-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              state === 'ready' ? 'bg-emerald-500' : state === 'offline' ? 'bg-amber-500' : 'bg-slate-400 animate-pulse'
            }`} />
            {state === 'ready' ? 'Connected' : state === 'offline' ? 'Offline' : 'Connecting...'}
          </span>
          <button onClick={() => void load()} disabled={state === 'loading'}
            className="border border-slate-200 text-slate-700 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={14} className={state === 'loading' ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => { window.location.hash = '#/sheet' }}
            className="border border-slate-200 text-slate-500 px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-slate-50"
            title="Kembali ke laporan spreadsheet">
            <ArrowLeft size={15} /> Kembali
          </button>
        </div>

        <div className="px-5 pb-3 flex flex-wrap items-end gap-3">
          <div className="flex items-end gap-2">
            <label className="text-[11px] font-bold text-slate-500">
              Dari
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white" />
            </label>
            <label className="text-[11px] font-bold text-slate-500">
              Sampai
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white" />
            </label>
          </div>
          <div className="flex gap-1.5">
            {[
              { label: 'Hari Ini', days: 1 },
              { label: '7 Hari', days: 7 },
              { label: '30 Hari', days: 30 },
            ].map(p => (
              <button key={p.label} onClick={() => applyPreset(p.days)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-500 hover:bg-white">
                {p.label}
              </button>
            ))}
          </div>
          <label className="text-[11px] font-bold text-slate-500">
            Rute
            <select value={route} onChange={e => setRoute(e.target.value)}
              className="block mt-1 border rounded-lg px-3 py-1.5 text-sm bg-white min-w-[220px]">
              <option value="">Semua</option>
              {routes.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <button onClick={resetFilters}
            className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-600 font-bold text-xs hover:bg-white">
            Reset
          </button>
          <span className="ml-auto text-[11px] text-slate-400 font-semibold self-center">
            {startDate && endDate ? `${startDate} s/d ${endDate}` : 'Semua tanggal'}
          </span>
        </div>
      </header>

      <main className="p-5">
        <div className="bg-white border border-slate-200 shadow-sm rounded-2xl overflow-hidden">
          <div className="overflow-auto max-h-[calc(100vh-220px)]">
            <table className="w-full border-collapse text-[13px] min-w-[760px]">
              <thead className="sticky top-0 z-10">
                <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 border-b border-slate-200 bg-slate-100 text-left">Jenis Kendaraan</th>
                  <th className="px-4 py-2.5 border-b border-slate-200 bg-slate-100 text-center">Dengan Muatan</th>
                  <th className="px-4 py-2.5 border-b border-slate-200 bg-slate-100 text-center">Tanpa Muatan</th>
                  <th className="px-4 py-2.5 border-b border-slate-200 bg-slate-100 text-center">Total Kendaraan</th>
                  <th className="px-4 py-2.5 border-b border-slate-200 bg-slate-100 text-right">Total Pendapatan (Rp)</th>
                </tr>
              </thead>
              {state !== 'ready' ? (
                <tbody>
                  <tr>
                    <td colSpan={5} className="p-10 text-center text-slate-400">
                      {state === 'offline' ? 'Tidak tersambung ke server'
                        : rows.length === 0 ? 'Memuat rekap...' : 'Memuat rekap...'}
                    </td>
                  </tr>
                </tbody>
              ) : groups.length === 0 ? (
                <tbody>
                  <tr><td colSpan={5} className="p-10 text-center text-slate-400">Tidak ada data pada filter ini</td></tr>
                </tbody>
              ) : groups.map(group => (
                <tbody key={`gol-${group.golongan}`}>
                  <tr className="bg-slate-800 text-white">
                    <td className="px-4 py-2.5 border-b border-slate-700 font-bold">{group.golongan}</td>
                    <td className="px-4 py-2.5 border-b border-slate-700 text-center tabular-nums">{group.loaded}</td>
                    <td className="px-4 py-2.5 border-b border-slate-700 text-center tabular-nums">{group.empty}</td>
                    <td className="px-4 py-2.5 border-b border-slate-700 text-center font-bold tabular-nums">{group.total}</td>
                    <td className="px-4 py-2.5 border-b border-slate-700 text-right font-black tabular-nums">{fmtRp(group.revenue)}</td>
                  </tr>
                  {group.rows.map((row, idx) => (
                    <tr key={`${group.golongan}-${row.jenis}`} className={idx % 2 === 1 ? 'bg-white' : 'bg-slate-50/40'}>
                      <td className="px-4 py-2 border-b border-slate-100 text-slate-700">{row.jenis}</td>
                      <td className="px-4 py-2 border-b border-slate-100 text-center tabular-nums">{row.loaded}</td>
                      <td className="px-4 py-2 border-b border-slate-100 text-center tabular-nums">{row.empty}</td>
                      <td className="px-4 py-2 border-b border-slate-100 text-center font-semibold tabular-nums">{row.total}</td>
                      <td className="px-4 py-2 border-b border-slate-100 text-right font-semibold text-slate-900 tabular-nums">{fmtRp(row.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              ))}
              {groups.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-100 font-bold text-slate-700">
                    <td className="px-4 py-3 border-t-2 border-slate-300 text-[12px]">TOTAL</td>
                    <td className="px-4 py-3 border-t-2 border-slate-300 text-center tabular-nums">{total.loaded}</td>
                    <td className="px-4 py-3 border-t-2 border-slate-300 text-center tabular-nums">{total.empty}</td>
                    <td className="px-4 py-3 border-t-2 border-slate-300 text-center tabular-nums">{total.total}</td>
                    <td className="px-4 py-3 border-t-2 border-slate-300 text-right font-black text-slate-900 tabular-nums">{fmtRp(total.revenue)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </main>
    </div>
  )
}
