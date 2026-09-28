import { RouteIcon, Truck, Users, Wallet } from 'lucide-react'
import type { ReportSummary, BackendTrip } from '../../../services/trips'
import { formatReportDateTime } from '../../../services/trips'
import { CurrencyDisplay } from '../components/CurrencyDisplay'

interface OverviewTabProps {
  serverTrips: BackendTrip[]
  dashSummary: ReportSummary | null
  dashAt: string
  activeOfficerCount: number
  officers: { status: string }[]
  serverState: 'connecting' | 'online' | 'offline'
  onRefresh: () => void
  onOpenReports: () => void
}

export function OverviewTab({
  serverTrips,
  dashSummary,
  dashAt,
  activeOfficerCount,
  officers,
  serverState,
  onRefresh,
  onOpenReports,
}: OverviewTabProps) {
  const latestTrips = [...serverTrips]
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Ringkasan Cepat</h3>
          <p className="text-slate-500 text-[12px]">
            Info at-a-glance
            {dashAt && <> · diperbarui {dashAt} WIB</>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
            serverState === 'online' ? 'bg-emerald-50 text-emerald-600'
            : serverState === 'offline' ? 'bg-amber-50 text-amber-600'
            : 'bg-slate-100 text-slate-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              serverState === 'online' ? 'bg-emerald-500'
              : serverState === 'offline' ? 'bg-amber-500'
              : 'bg-slate-400 animate-pulse'
            }`} />
            {serverState === 'online' ? 'Server: Tersambung'
            : serverState === 'offline' ? 'Server: Offline'
            : 'Memeriksa...'}
          </span>
          <button
            onClick={onRefresh}
            className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-blue-700"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Kartu metrik */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Trip Hari Ini"
          val={dashSummary ? String(dashSummary.totalTrips) : '—'}
          sub={`${serverTrips.length} trip tersimpan`}
          Icon={RouteIcon}
          bg="bg-blue-50"
          fg="text-blue-600"
        />
        <MetricCard
          label="Pendapatan Hari Ini"
          amount={dashSummary?.totalRevenue ?? 0}
          sub="tarif eksternal tercatat"
          Icon={Wallet}
          bg="bg-emerald-50"
          fg="text-emerald-600"
        />
        <MetricCard
          label="Unit Hari Ini"
          val={dashSummary ? String(dashSummary.totalVehicles) : '—'}
          sub="kendaraan tercatat"
          Icon={Truck}
          bg="bg-amber-50"
          fg="text-amber-600"
        />
        <MetricCard
          label="Petugas Aktif"
          val={`${activeOfficerCount}/${officers.length}`}
          sub="siap bertugas"
          Icon={Users}
          bg="bg-violet-50"
          fg="text-violet-600"
        />
      </div>

      {/* 5 trip terbaru */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 font-bold text-slate-800 flex justify-between items-center gap-3 flex-wrap">
          <span className="flex items-center gap-2">
            5 Trip Terbaru
            <span className="flex items-center gap-1.5 text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />REAL-TIME
            </span>
          </span>
          <button onClick={onOpenReports} className="text-blue-600 text-sm font-bold hover:underline">
            Buka Laporan →
          </button>
        </div>
        <table className="w-full text-[13px]">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
            <tr>
              <th className="text-left p-4">No Trip</th>
              <th className="text-left p-4">Rute</th>
              <th className="text-left p-4">Petugas</th>
              <th className="text-left p-4">Muatan</th>
              <th className="text-left p-4">Tanggal</th>
              <th className="text-left p-4">Jam</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {latestTrips.length === 0 ? (
              <tr><td colSpan={6} className="p-8 text-center text-slate-400">Belum ada trip</td></tr>
            ) : latestTrips.map(t => {
              const d = formatReportDateTime(t.created_at)
              return (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="p-4 font-mono text-slate-600">{t.no_trip}</td>
                  <td className="p-4 font-bold">{t.route_from} → {t.route_to}</td>
                  <td className="p-4">{t.officer_name || t.officer_id}</td>
                  <td className="p-4">
                    <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                      t.status_muatan === 'muatan' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {t.status_muatan === 'muatan' ? 'Ada Muatan' : 'Kosong'}
                    </span>
                  </td>
                  <td className="p-4 text-slate-500 whitespace-nowrap">{d.date}</td>
                  <td className="p-4 text-slate-500 tabular-nums">{d.time}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MetricCard({
  label,
  val,
  sub,
  Icon,
  bg,
  fg,
}: {
  label: string
  val: string
  sub: string
  Icon: React.ComponentType<{ size?: number }>
  bg: string
  fg: string
}) {
  return (
    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2 mb-3">
        <p className="text-slate-500 text-[11px] font-bold uppercase tracking-wide">{label}</p>
        <span className={`w-8 h-8 shrink-0 rounded-xl flex items-center justify-center ${bg} ${fg}`}>
          <Icon size={15} />
        </span>
      </div>
      <p className="text-2xl font-black text-slate-900 tabular-nums truncate">{val}</p>
      <p className="text-[11px] text-slate-400 mt-1">{sub}</p>
    </div>
  )
}
