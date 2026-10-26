import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Cpu, Database, Globe, HardDrive, RefreshCw, Server, ShieldCheck, Wifi } from 'lucide-react'
import {
  fetchServerStats,
  formatBytes,
  formatMs,
  formatUptime,
  intranetStatsBaseUrl,
  type ComponentStatus,
  type MetricsBucket,
  type ServerStats,
} from '../../../services/serverStats'

/**
 * Panel statistik server untuk tab "Endpoint".
 *
 * Gaya visual: terminal/btop - panel gelap, angka monospace, bar horizontal,
 * dan grafik batang per menit. Data diambil dari server intranet port 3000
 * (`http://192.168.1.123:3000/api/server-stats`), bukan dari Supabase.
 */

const POLL_INTERVAL_MS = 5000

const STATUS_COLOR: Record<ComponentStatus, string> = {
  ok: '#10B981',
  degraded: '#F59E0B',
  down: '#EF4444',
  unknown: '#94A3B8',
}

const STATUS_LABEL: Record<ComponentStatus, string> = {
  ok: 'Normal',
  degraded: 'Terbatas',
  down: 'Gangguan',
  unknown: 'Tidak diketahui',
}

function statusIcon(status: ComponentStatus) {
  if (status === 'ok') return <ShieldCheck size={13} />
  if (status === 'degraded') return <Activity size={13} />
  if (status === 'down') return <Wifi size={13} />
  return <Activity size={13} />
}

/** Bar horizontal dengan rasio terisi (0..1). */
function Meter({ ratio, color }: { ratio: number; color: string }) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-700/60">
      <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
    </div>
  )
}

/** Grafik batang per menit: total request (abu) + error (merah) bertumpuk. */
function TrafficChart({ buckets }: { buckets: { minute: number; total: number; ok: number; err: number }[] }) {
  const data = useMemo(() => buckets.slice(-60), [buckets])

  if (data.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-xl border border-slate-700/60 bg-slate-900/40 text-[11px] text-slate-500">
        Belum ada data request.
      </div>
    )
  }

  const max = Math.max(1, ...data.map(b => b.total))

  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
      <div className="flex h-40 items-end gap-[2px]">
        {data.map(b => {
          const totalH = (b.total / max) * 100
          const errH = b.total ? (b.err / b.total) * totalH : 0
          return (
            <div
              key={b.minute}
              title={`${new Date(b.minute).toLocaleTimeString('id-ID')} · ${b.total} request · ${b.err} error`}
              className="group relative flex flex-1 flex-col justify-end"
              style={{ minWidth: 2 }}
            >
              <div
                className="rounded-t-[2px] bg-slate-500/70 transition-colors group-hover:bg-slate-400"
                style={{ height: `${Math.max(totalH, b.total > 0 ? 3 : 1)}%` }}
              />
              {b.err > 0 && (
                <div className="rounded-b-[2px]" style={{ height: `${errH}%`, backgroundColor: '#EF4444' }} />
              )}
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span>{data.length ? new Date(data[0].minute).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm bg-slate-500" /> request</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: '#EF4444' }} /> error</span>
        </span>
        <span>{data.length ? new Date(data[data.length - 1].minute).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}</span>
      </div>
    </div>
  )
}

/** Tabel angka pendamping grafik: 10 menit terakhir, terbaru di atas. */
function TrafficTable({ buckets }: { buckets: MetricsBucket[] }) {
  const rows = useMemo(() => buckets.slice(-10).reverse(), [buckets])
  if (rows.length === 0) return null

  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-slate-700/60">
      <table className="w-full text-left text-[11px]">
        <thead className="bg-slate-800/60 text-[10px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-2 font-semibold">Waktu</th>
            <th className="px-3 py-2 font-semibold">Request</th>
            <th className="px-3 py-2 font-semibold">Sukses</th>
            <th className="px-3 py-2 font-semibold">Error</th>
            <th className="px-3 py-2 font-semibold">Success Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map(b => {
            const rate = b.total ? Math.round((b.ok / b.total) * 100) : 100
            return (
              <tr key={b.minute} className="text-slate-300">
                <td className="px-3 py-1.5 font-mono text-[10px]">
                  {new Date(b.minute).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-3 py-1.5 font-mono">{b.total}</td>
                <td className="px-3 py-1.5 font-mono" style={{ color: '#10B981' }}>{b.ok}</td>
                <td className="px-3 py-1.5 font-mono" style={{ color: b.err ? '#EF4444' : '#64748B' }}>{b.err}</td>
                <td className="px-3 py-1.5 font-mono" style={{ color: rate >= 95 ? '#10B981' : rate >= 80 ? '#F59E0B' : '#EF4444' }}>{rate}%</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ServerStatsPanel() {
  const [stats, setStats] = useState<ServerStats | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const mounted = useRef(true)

  const load = async () => {
    const res = await fetchServerStats()
    if (!mounted.current) return
    if (res.ok) {
      setStats(res.data)
      setError(null)
    } else {
      setError(res.error)
      setStats(null)
    }
    setLoading(false)
  }

  useEffect(() => {
    mounted.current = true
    void load()
    const id = setInterval(() => { void load() }, POLL_INTERVAL_MS)
    return () => { mounted.current = false; clearInterval(id) }
  }, [])

  // Tick 1 detik supaya teks waktu relatif ("3 detik lalu") terus bergerak
  // walau data statistik tidak berubah.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const base = intranetStatsBaseUrl()
  const m = stats?.metrics

  return (
    <div className="flex min-h-[calc(100vh-4.5rem)] w-full flex-col rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-lg">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <Server size={18} />
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-100">Statistik Server Port 3000</h3>
            <p className="font-mono text-[10px] text-slate-500">{base}/server-stats</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {stats && (
            <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
              {stats.mode === 'intranet' ? 'Intranet' : 'Cloud'} · {stats.instance}
            </span>
          )}
          <button
            onClick={() => { setLoading(true); void load() }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 px-3 py-1.5 text-[11px] font-semibold text-slate-300 transition-colors hover:bg-slate-800"
          >
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
            Muat ulang
          </button>
        </div>
      </div>

      {/* Status koneksi */}
      {!stats && (
        <div className={`rounded-xl border px-4 py-3 text-[12px] ${error ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-slate-700 bg-slate-800/40 text-slate-400'}`}>
          {error
            ? `Server intranet tidak dapat dibaca: ${error}. Pastikan server port 3000 hidup dan URL di atas benar.`
            : 'Menghubungi server intranet port 3000…'}
        </div>
      )}

      {stats && m && (
        <div className="space-y-4">
          {/* Kartu metrik utama */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total Requests" value={m.total.toLocaleString('id-ID')} hint={`${m.ok} sukses · ${m.clientError} 4xx · ${m.serverError} 5xx`} color="#3B82F6" />
            <StatCard
              label="Success Rate"
              value={`${m.successRate}%`}
              hint={`${m.clientError + m.serverError} gagal dari ${m.total} request`}
              color={m.successRate >= 95 ? '#10B981' : m.successRate >= 80 ? '#F59E0B' : '#EF4444'}
            />
            <StatCard label="Request / Menit" value={String(m.rpsLastMinute)} hint={`${m.requestsLastHour} request dalam 1 jam terakhir`} color="#22D3EE" />
            <StatCard label="Latensi Rata-rata" value={formatMs(m.avgMs)} hint={`p95 ${formatMs(m.p95Ms)} · maks ${formatMs(m.maxMs)}`} color="#A78BFA" />
          </div>

          {/* Bilah sumber daya + uptime */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <HardDrive size={12} /> Memori RSS
                </span>
                <span className="font-mono text-[11px] font-bold text-slate-200">{formatBytes(m.memory.rss)}</span>
              </div>
              <Meter ratio={m.memory.rss / (512 * 1024 * 1024)} color="#3B82F6" />
              <p className="mt-1.5 text-[10px] text-slate-500">
                Heap {formatBytes(m.memory.heapUsed)} / {formatBytes(m.memory.heapTotal)}
              </p>
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <Cpu size={12} /> Uptime
                </span>
                <span className="font-mono text-[11px] font-bold text-slate-200">{formatUptime(m.uptimeMs)}</span>
              </div>
              <Meter ratio={Math.min(1, m.uptimeMs / (24 * 3600 * 1000))} color="#10B981" />
              <p className="mt-1.5 text-[10px] text-slate-500">
                Mulai {new Date(m.startedAt).toLocaleString('id-ID')}
              </p>
            </div>

            <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                  <Globe size={12} /> Klien Aktif
                </span>
                <span className="font-mono text-[11px] font-bold text-slate-200">{m.uniqueClientsLastHour}</span>
              </div>
              <Meter ratio={Math.min(1, m.uniqueClientsLastHour / 50)} color="#F59E0B" />
              <p className="mt-1.5 text-[10px] text-slate-500">IP unik dalam 1 jam terakhir</p>
            </div>
          </div>

          {/* Grafik + status komponen */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <Activity size={12} /> Grafik Request per Menit
              </p>
              <TrafficChart buckets={m.buckets} />
              <TrafficTable buckets={m.buckets} />
            </div>

            <div className="lg:col-span-2">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <Database size={12} /> Status Komponen Server
              </p>
              <div className="space-y-2">
                {stats.components.map(c => (
                  <div key={c.id} className="flex items-start gap-2.5 rounded-lg border border-slate-700/60 bg-slate-800/40 px-3 py-2">
                    <span className="mt-0.5" style={{ color: STATUS_COLOR[c.status] }}>{statusIcon(c.status)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-bold text-slate-200">{c.label}</span>
                        <span className="font-mono text-[10px] font-bold" style={{ color: STATUS_COLOR[c.status] }}>
                          {STATUS_LABEL[c.status]}{c.ms ? ` · ${c.ms} ms` : ''}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[10px] text-slate-500" title={c.detail}>{c.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Top endpoint */}
          {m.topPaths.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Endpoint Teramai</p>
              <div className="overflow-x-auto rounded-xl border border-slate-700/60">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-slate-800/60 text-[10px] uppercase tracking-wide text-slate-400">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Path</th>
                      <th className="px-3 py-2 font-semibold">Request</th>
                      <th className="px-3 py-2 font-semibold">Error</th>
                      <th className="px-3 py-2 font-semibold">Rata-rata</th>
                      <th className="px-3 py-2 font-semibold">Terakhir</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {m.topPaths.map(p => (
                      <tr key={p.path} className="text-slate-300">
                        <td className="px-3 py-1.5 font-mono text-[10px]">{p.path}</td>
                        <td className="px-3 py-1.5 font-mono">{p.count}</td>
                        <td className="px-3 py-1.5 font-mono" style={{ color: p.errors ? '#EF4444' : '#64748B' }}>{p.errors}</td>
                        <td className="px-3 py-1.5 font-mono">{formatMs(p.avgMs)}</td>
                        <td className="px-3 py-1.5 font-mono">{formatMs(p.lastMs)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <p className="text-[10px] text-slate-600">
            Diperbarui {new Date(stats.generatedAt).toLocaleTimeString('id-ID')}
            {m.lastRequestAt ? ` · request terakhir ${formatMs(Date.now() - m.lastRequestAt)} yang lalu` : ''}
          </p>
          <span className="hidden" aria-hidden="true">{tick}</span>
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
  color,
}: {
  label: string
  value: string
  hint: string
  color: string
}) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-xl font-black" style={{ color }}>{value}</p>
      <p className="mt-0.5 text-[10px] text-slate-500">{hint}</p>
    </div>
  )
}
