import { Fragment, useState, useEffect } from 'react'
import { Download, Eye, EyeOff } from 'lucide-react'
import { fetchTrips, fetchTripReports, fetchReportFilters, fetchReportSummary, formatReportDateTime, dayKeyWib, type BackendTrip, type ReportTrip, type ReportFilters, type ReportSummary } from '../../../services/trips'
import { ensureAdminBackendSession } from '../../../services/auth'
import { downloadXlsx } from '../../../services/xlsx'
import { CurrencyDisplay, useCurrencyReveal } from '../components/CurrencyDisplay'
import { PhotoViewer } from '../components/PhotoViewer'

interface ReportsTabProps {
  serverState: 'connecting' | 'online' | 'offline'
  serverTrips: BackendTrip[]
  onServerTripsChange: (t: BackendTrip[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function ReportsTab({ serverState, serverTrips, onServerTripsChange, showToast }: ReportsTabProps) {
  const { revealed, toggle } = useCurrencyReveal()
  const [reportTrips, setReportTrips] = useState<ReportTrip[]>([])
  const [reportState, setReportState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  const [reportFilters, setReportFilters] = useState<ReportFilters>({})
  const [filterOptions, setFilterOptions] = useState<{ golongan: string[]; vehicleTypes: string[] }>({ golongan: [], vehicleTypes: [] })
  const [viewingPhotos, setViewingPhotos] = useState<{ id: string; url: string; caption?: string }[] | null>(null)

  const loadReports = async (filters?: ReportFilters) => {
    setReportState('loading')
    const ok = await ensureAdminBackendSession()
    if (!ok) { setReportState('offline'); return }
    const rows = await fetchTripReports(filters ?? reportFilters)
    if (rows === null) { setReportState('offline'); return }
    setReportTrips(rows)
    setReportState('ready')
  }

  useEffect(() => {
    if (reportState === 'idle') {
      Promise.all([fetchReportFilters(), fetchTrips()]).then(([opts, trips]) => {
        if (opts) setFilterOptions(opts)
        if (trips) onServerTripsChange(trips)
      })
      void loadReports()
    }
  }, [reportState])

  const applyReportFilter = (patch: Partial<ReportFilters>) => {
    let next = { ...reportFilters, ...patch }
    const today = dayKeyWib(new Date().toISOString())
    if (next.startDate && !next.endDate) next = { ...next, endDate: today }
    if (next.endDate && !next.startDate) next = { ...next, startDate: '1970-01-01' }
    setReportFilters(next)
    setOpenTripId(null)
    void loadReports(next)
  }

  const applyDatePreset = (days: number | null) => {
    if (!days) { clearReportFilters(); return }
    const today = dayKeyWib(new Date().toISOString())
    const start = dayKeyWib(new Date(Date.now() - (days - 1) * 86400000).toISOString())
    const next: ReportFilters = { ...reportFilters, startDate: start, endDate: today }
    setReportFilters(next)
    setOpenTripId(null)
    void loadReports(next)
  }

  const clearReportFilters = () => {
    setReportFilters({})
    setOpenTripId(null)
    void loadReports({})
  }

  const handleExport = () => {
    if (reportState !== 'ready' || reportTrips.length === 0) return showToast('Tidak ada data', 'error')
    const now = new Date()
    const stamped = formatReportDateTime(now.toISOString().slice(0, 19).replace('T', ' '), { withSeconds: true })
    const dateSlug = now.toISOString().slice(0, 10)
    const header = ['No Trip', 'Tanggal', 'Jam (WIB)', 'Tempat / Wilayah', 'Rute Asal', 'Rute Tujuan', 'Rute', 'Petugas', 'Status Muatan', 'Kategori', 'Jumlah Unit', 'Total Tarif (Rp)']
    const rentang = reportFilters.startDate || reportFilters.endDate
      ? `${reportFilters.startDate || 'Awal'} s/d ${reportFilters.endDate || 'Akhir'}`
      : 'Semua tanggal'
    const place = (t: ReportTrip) => t.region_name ? `${t.region_name}${t.region_code ? ` (${t.region_code})` : ''}` : '-'
    const asal = (t: ReportTrip) => t.route_from ? `${t.route_from_name ? `${t.route_from_name} (` : ''}${t.route_from}${t.route_from_name ? ')' : ''}` : '-'
    const tujuan = (t: ReportTrip) => t.route_to ? `${t.route_to_name ? `${t.route_to_name} (` : ''}${t.route_to}${t.route_to_name ? ')' : ''}` : '-'

    // Sheet 1 — ringkasan trip
    const tripRows: (string | number | null)[][] = [
      ['Laporan Trip Angkutan'],
      ['Dicetak', stamped.full],
      ['Rentang Tanggal', rentang],
      ['Filter Golongan', reportFilters.golongan || 'Semua'],
      ['Filter Jenis Kendaraan', reportFilters.vehicleType || 'Semua'],
      ['Jumlah Trip', totalTrip],
      [],
      header,
      ...reportTrips.map(t => {
        const d = formatReportDateTime(t.created_at)
        return [t.no_trip, d.date, d.time, place(t), asal(t), tujuan(t),
          `${t.route_from || '-'} → ${t.route_to || '-'}`, t.officer_name || '-',
          t.status_muatan === 'muatan' ? 'Ada Muatan' : 'Kosong',
          t.keterangan && t.keterangan !== '-' ? t.keterangan : '-',
          t.vehicle_count || 0, t.trip_revenue || 0]
      }),
    ]

    // Sheet 2 — detail kendaraan per trip
    const vehRows: (string | number | null)[][] = [
      ['Detail Kendaraan per Trip'],
      ['Rentang Tanggal', rentang],
      [],
      ['No Trip', 'Tanggal', 'Jam (WIB)', 'Tempat / Wilayah', 'No. Polisi', 'Jenis Kendaraan', 'Golongan', 'Kategori', 'Beban', 'Tarif (Rp)'],
      ...reportTrips.flatMap(t => {
        const d = formatReportDateTime(t.created_at)
        return t.vehicles.map(v => [t.no_trip, d.date, d.time, place(t), v.no_polisi, v.vehicle_type,
          v.master_golongan || (v.golongan.length <= 3 ? v.golongan : '-'), v.golongan,
          v.has_load ? 'Ada Muatan' : 'Kosong', v.tariff_amount || 0])
      }),
    ]

    downloadXlsx(`laporan-trip-${dateSlug}.xlsx`, [
      { name: 'Laporan Trip', rows: tripRows },
      { name: 'Detail Kendaraan', rows: vehRows },
    ])
    showToast('Laporan Excel (.xlsx) diunduh')
  }

  const golonganOptions = filterOptions.golongan.length > 0 ? filterOptions.golongan : []
  const jenisOptions = filterOptions.vehicleTypes.length > 0 ? filterOptions.vehicleTypes : []

  // Analitik ringkas
  const totalTrip = reportTrips.length
  const totalUnit = reportTrips.reduce((s, t) => s + (t.vehicle_count || 0), 0)
  const totalRevenue = reportTrips.reduce((s, t) => s + (t.trip_revenue || 0), 0)
  const muatanCount = reportTrips.filter(t => t.status_muatan === 'muatan').length
  const kosongCount = totalTrip - muatanCount
  const muatanPct = totalTrip ? (muatanCount / totalTrip) * 100 : 0

  // Grafik 1 — trip per hari (maksimal 14 hari dalam rentang terpilih)
  const reportDaily = Array.from(
    reportTrips.reduce((m, t) => {
      const k = dayKeyWib(t.created_at)
      m.set(k, (m.get(k) || 0) + 1)
      return m
    }, new Map<string, number>()),
    ([day, count]) => ({ day, count }),
  ).sort((a, b) => a.day.localeCompare(b.day)).slice(-14)

  const maxDaily = Math.max(1, ...reportDaily.map(d => d.count))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Laporan Trip</h3>
          <p className="text-slate-500 text-[12px]">Data trip, kendaraan, dan tarif</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
            reportState === 'ready' ? 'bg-emerald-50 text-emerald-600' : reportState === 'offline' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${reportState === 'ready' ? 'bg-emerald-500' : reportState === 'offline' ? 'bg-amber-500' : 'bg-slate-400 animate-pulse'}`} />
            {reportState === 'ready' ? 'Tersambung' : reportState === 'offline' ? 'Offline' : 'Memuat...'}
          </span>
          <button onClick={() => void loadReports()} disabled={reportState === 'loading'}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700 disabled:opacity-50">
            Refresh
          </button>
          <button onClick={handleExport} disabled={reportState !== 'ready'}
            className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-emerald-700 disabled:opacity-50">
            <Download size={15} /> Ekspor Excel
          </button>
        </div>
      </div>

      {/* Filter */}
      <div className="bg-white rounded-2xl p-4 shadow-sm flex flex-wrap items-end gap-4">
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
            {golonganOptions.map(g => <option key={g} value={g}>Gol {g}</option>)}
          </select></div>
        <div><label className="text-[11px] font-bold text-slate-500 block mb-1.5">Jenis Kendaraan</label>
          <select value={reportFilters.vehicleType || ''} onChange={e => applyReportFilter({ vehicleType: e.target.value || undefined })}
            className="border rounded-xl px-3 py-2 text-sm min-w-[150px] bg-white">
            <option value="">Semua</option>
            {jenisOptions.map(j => <option key={j} value={j}>{j}</option>)}
          </select></div>
        <button onClick={clearReportFilters} className="px-4 py-2 rounded-xl border border-slate-300 text-slate-600 font-bold text-sm hover:bg-slate-50">Reset</button>
        <span className="ml-auto text-[12px] text-slate-400 font-semibold">{totalTrip} trip</span>
      </div>

      {/* Ringkasan */}
      {reportState === 'ready' && (
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
            <p className="text-slate-500 text-[11px] font-bold uppercase">Total Trip</p>
            <p className="text-2xl font-black text-slate-900 mt-1">{totalTrip}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
            <p className="text-slate-500 text-[11px] font-bold uppercase">Muatan</p>
            <p className="text-2xl font-black text-blue-600 mt-1">{muatanCount}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
            <p className="text-slate-500 text-[11px] font-bold uppercase">Unit</p>
            <p className="text-2xl font-black text-amber-600 mt-1">{totalUnit}</p>
          </div>
          <div className="bg-white rounded-2xl p-5 shadow-sm text-center">
            <p className="text-slate-500 text-[11px] font-bold uppercase">Pendapatan</p>
            <CurrencyDisplay amount={totalRevenue} className="text-2xl font-black text-emerald-600 mt-1" />
          </div>
        </div>
      )}

      {/* Tombol aksi */}
      {reportState === 'ready' && (
        <div className="flex justify-end gap-2">
          <button onClick={toggle}
            className={`px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 ${revealed ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-slate-700 text-white hover:bg-slate-800'}`}>
            {revealed ? <><EyeOff size={15} /> Sembunyikan Nominal</> : <><Eye size={15} /> Tampilkan Nominal</>}
          </button>
          <button onClick={() => {
            const photos = serverTrips
              .filter(t => (t as any).photo_url)
              .map(t => ({ id: t.id, url: (t as any).photo_url as string, caption: t.no_trip }))
            setViewingPhotos(photos.length > 0 ? photos : null)
          }}
            className="bg-slate-700 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-slate-800">
            📷 Lihat Foto Dokumentasi
          </button>
        </div>
      )}

      {/* Grafik analitik */}
      {reportState === 'ready' && totalTrip > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Trip per hari */}
          <div className="lg:col-span-2 bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
              <div>
                <h4 className="font-bold text-slate-800 text-sm">Trip per Hari</h4>
                <p className="text-[11px] text-slate-400">maksimal 14 hari terakhir dalam rentang terpilih</p>
              </div>
              <span className="text-[11px] font-bold text-slate-400">puncak {maxDaily} trip/hari</span>
            </div>
            <div className="flex items-end gap-1.5 h-40">
              {reportDaily.map((d, i) => (
                <div key={d.day} title={`${d.day} · ${d.count} trip`}
                  className="h-full flex-1 min-w-0 flex flex-col justify-end items-center gap-1">
                  <span className="text-[9px] font-bold text-slate-500 tabular-nums">{d.count}</span>
                  <div className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-blue-400 transition-all"
                    style={{ height: `${Math.max(6, (d.count / maxDaily) * 70)}%` }} />
                  <span className={`text-[9px] text-slate-400 whitespace-nowrap ${reportDaily.length > 8 && i % 2 === 1 ? 'opacity-0' : ''}`}>
                    {Number(d.day.slice(8))}/{d.day.slice(5, 7)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Komposisi muatan */}
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
            <h4 className="font-bold text-slate-800 text-sm">Komposisi Muatan</h4>
            <p className="text-[11px] text-slate-400 mb-4">trip bermuatan vs kosong</p>
            <div className="flex items-center gap-5">
              <div className="relative w-28 h-28 shrink-0 rounded-full"
                style={{ background: `conic-gradient(#2563eb 0 ${muatanPct}%, #cbd5e1 ${muatanPct}% 100%)` }}>
                <div className="absolute inset-[10px] bg-white rounded-full flex flex-col items-center justify-center">
                  <span className="text-xl font-black text-slate-900 tabular-nums leading-none">{totalTrip}</span>
                  <span className="text-[9px] font-bold text-slate-400 mt-0.5">TRIP</span>
                </div>
              </div>
              <div className="space-y-2.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                  <span className="text-slate-600 font-semibold">Ada Muatan</span>
                  <span className="font-black text-slate-800 tabular-nums">{muatanCount}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-slate-300" />
                  <span className="text-slate-600 font-semibold">Kosong</span>
                  <span className="font-black text-slate-800 tabular-nums">{kosongCount}</span>
                </div>
                <p className="text-[11px] text-slate-400 pt-1">{Math.round(muatanPct)}% trip bermuatan</p>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* Modal Foto */}
      {viewingPhotos && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setViewingPhotos(null)}>
          <div onClick={e => e.stopPropagation()} className="max-w-4xl w-full">
            <PhotoViewer photos={viewingPhotos} onClose={() => setViewingPhotos(null)} />
          </div>
        </div>
      )}

      {/* Tabel */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="text-left px-4 py-2.5 border-b border-slate-200 w-8">#</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">No Trip</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Tanggal</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Wilayah</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Rute</th>
              <th className="text-left px-3 py-2.5 border-b border-slate-200">Muatan</th>
              <th className="text-right px-3 py-2.5 border-b border-slate-200">Unit</th>
              <th className="text-right px-4 py-2.5 border-b border-slate-200">Pendapatan</th>
              <th className="border-b border-slate-200 w-8" />
            </tr>
          </thead>
          <tbody>
            {reportState === 'offline' ? (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400">Offline</td></tr>
            ) : reportState !== 'ready' ? (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400 animate-pulse">Memuat...</td></tr>
            ) : reportTrips.length === 0 ? (
              <tr><td colSpan={9} className="p-8 text-center text-slate-400">Belum ada trip</td></tr>
            ) : reportTrips.map((t, idx) => {
              const open = openTripId === t.id
              const d = formatReportDateTime(t.created_at)
              return (
                <Fragment key={t.id}>
                  <tr onClick={() => setOpenTripId(open ? null : t.id)}
                    className={`cursor-pointer hover:bg-slate-50 ${open ? 'bg-blue-50/60' : idx % 2 === 1 ? 'bg-slate-50/40' : ''}`}>
                    <td className="px-4 py-2.5 text-slate-400 tabular-nums align-middle">{idx + 1}</td>
                    <td className="px-3 py-2.5 font-mono font-semibold text-slate-700">{t.no_trip}</td>
                    <td className="px-3 py-2.5 text-slate-700">{d.date} {d.time}</td>
                    <td className="px-3 py-2.5 text-slate-700">{t.region_name || '-'}</td>
                    <td className="px-3 py-2.5 text-slate-600">{t.route_from_name || t.route_from} → {t.route_to_name || t.route_to}</td>
                    <td className="px-3 py-2.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${t.status_muatan === 'muatan' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                        {t.status_muatan === 'muatan' ? 'Ada' : 'Kosong'}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{t.vehicle_count}</td>
                    <td className="px-4 py-2.5 text-right">
                      <CurrencyDisplay amount={t.trip_revenue || 0} />
                    </td>
                    <td className="px-2 py-2.5 text-center text-slate-400">▶</td>
                  </tr>
                  {open && (
                    <tr className="bg-slate-50/80">
                      <td colSpan={9} className="px-4 py-3">
                        <div className="text-[12px] text-slate-600 mb-3">
                          <span className="font-semibold mr-4">Petugas: {t.officer_name || '-'}</span>
                          <span>Kategori: {t.keterangan || '-'}</span>
                        </div>
                        {t.vehicles.length > 0 && (
                          <table className="w-full text-[13px] bg-white rounded-xl overflow-hidden border border-slate-200">
                            <thead className="bg-slate-100 text-[10px] uppercase text-slate-500">
                              <tr><th className="text-left p-3">Plat</th><th className="text-left p-3">Jenis</th><th className="text-left p-3">Kategori</th><th className="text-right p-3">Tarif</th></tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {t.vehicles.map((v, i) => (
                                <tr key={`${v.no_polisi}-${i}`}>
                                  <td className="p-3 font-mono font-bold">{v.no_polisi}</td>
                                  <td className="p-3">{v.vehicle_type}</td>
                                  <td className="p-3"><span className={`px-2 py-1 rounded text-[10px] font-bold ${v.golongan === 'Internal' ? 'bg-slate-800 text-white' : v.golongan === 'Eksternal' ? 'bg-amber-500 text-white' : 'bg-blue-100 text-blue-700'}`}>{v.golongan}</span></td>
                                  <td className="p-3 text-right font-bold"><CurrencyDisplay amount={v.tariff_amount || 0} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="bg-slate-100 font-bold text-slate-700">
              <td colSpan={7} className="px-4 py-3 border-t-2 border-slate-300 text-right text-[12px]">
                Total {totalTrip} trip · {totalUnit} unit
              </td>
              <td className="px-4 py-3 border-t-2 border-slate-300 text-right">
                <CurrencyDisplay amount={totalRevenue} className="text-emerald-700 font-black" />
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
