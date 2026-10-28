import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Activity, Cpu, Database, Globe, HardDrive, MemoryStick, RefreshCw, Server, ShieldCheck, Wifi } from 'lucide-react'
import {
  fetchServerStats,
  formatBytes,
  formatMs,
  formatUptime,
  intranetStatsBaseUrl,
  type ComponentStatus,
  type MetricsBucket,
  type ServerStats,
  type SystemMetrics,
} from '../../../services/serverStats'

/**
 * Panel statistik server untuk tab "Endpoint".
 *
 * Gaya visual: terminal/btop - panel gelap, angka monospace, bar horizontal,
 * dan grafik batang per menit. Data diambil dari server intranet port 3000
 * (`http://192.168.1.123:3000/api/server-stats`), bukan dari alamat lain.
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

/** Lebar container yang diamati (dalam piksel) supaya SVG bisa digambar real-size. */
function useElementWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.getBoundingClientRect().width)
    update()
    // jsdom (unit test) tidak punya ResizeObserver -> pakai event resize.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}

/**
 * Path kurva mulus (cardinal spline) dari titik-titik data.
 *
 * Inilah yang bikin grafik terasa "kripto": garisnya tidak patah-patah
 * seperti diagram batang, tapi melengkung mulus seperti grafik harga aset.
 */
function smoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return ''
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const cur = points[i]
    const midX = (prev.x + cur.x) / 2
    d += ` C ${midX} ${prev.y}, ${midX} ${cur.y}, ${cur.x} ${cur.y}`
  }
  return d
}

/**
 * Grafik request per menit bergaya kripto: area gradien, garis melengkung
 * glowing, titik terakhir yang menonjol, plus garis tipis untuk error.
 */
function TrafficChart({ buckets }: { buckets: MetricsBucket[] }) {
  const data = useMemo(() => buckets.slice(-60), [buckets])
  const [wrapRef, width] = useElementWidth()

  const H = 180
  const PAD_L = 34
  const PAD_R = 8
  const PAD_T = 10
  const PAD_B = 20

  const max = Math.max(1, ...data.map(b => b.total))
  const peak = data.reduce((acc, b) => (b.total > acc.total ? b : acc), { minute: 0, total: 0, ok: 0, err: 0 })

  const innerW = Math.max(0, width - PAD_L - PAD_R)
  const innerH = H - PAD_T - PAD_B
  const step = data.length > 1 ? innerW / (data.length - 1) : innerW

  const toPoints = (value: (b: MetricsBucket) => number) =>
    data.map((b, i) => ({
      x: PAD_L + i * step,
      y: PAD_T + innerH - (Math.max(0, value(b)) / max) * innerH,
    }))

  const linePts = toPoints(b => b.total)
  const errPts = toPoints(b => b.err)
  const linePath = smoothPath(linePts)
  const errPath = smoothPath(errPts)
  const areaPath = linePath
    ? `${linePath} L ${linePts[linePts.length - 1].x} ${PAD_T + innerH} L ${linePts[0].x} ${PAD_T + innerH} Z`
    : ''
  const last = linePts[linePts.length - 1]

  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="flex min-h-40 flex-1 flex-col rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
      <div ref={wrapRef} className="relative min-h-[180px] w-full flex-1">
        {data.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-[11px] text-slate-500">
            Belum ada data request.
          </div>
        ) : width > 0 && (
          <svg width={width} height={H} className="block overflow-visible">
            <defs>
              <linearGradient id="trafficFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22D3EE" stopOpacity={0.45} />
                <stop offset="55%" stopColor="#3B82F6" stopOpacity={0.16} />
                <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="trafficStroke" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#3B82F6" />
                <stop offset="60%" stopColor="#22D3EE" />
                <stop offset="100%" stopColor="#A78BFA" />
              </linearGradient>
              <filter id="trafficGlow" x="-20%" y="-40%" width="140%" height="180%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Grid + label sumbu Y */}
            {gridLines.map(r => {
              const y = PAD_T + innerH - r * innerH
              return (
                <g key={r}>
                  <line
                    x1={PAD_L}
                    y1={y}
                    x2={PAD_L + innerW}
                    y2={y}
                    stroke="#334155"
                    strokeWidth={r === 0 ? 1 : 0.5}
                    strokeDasharray={r === 0 ? undefined : '3 4'}
                  />
                  <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#64748B" fontFamily="monospace">
                    {Math.round(r * max)}
                  </text>
                </g>
              )
            })}

            {/* Area gradien di bawah garis */}
            <path d={areaPath} fill="url(#trafficFill)" />

            {/* Garis error (merah tipis) */}
            {data.some(b => b.err > 0) && (
              <path d={errPath} fill="none" stroke="#EF4444" strokeWidth={1} strokeOpacity={0.7} />
            )}

            {/* Garis utama + glow */}
            <path
              d={linePath}
              fill="none"
              stroke="url(#trafficStroke)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#trafficGlow)"
            />

            {/* Titik terakhir */}
            <circle cx={last.x} cy={last.y} r={9} fill="#22D3EE" fillOpacity={0.15} />
            <circle cx={last.x} cy={last.y} r={3.5} fill="#22D3EE" stroke="#0F172A" strokeWidth={1.5} />

            {/* Label sumbu X */}
            <text x={PAD_L} y={H - 5} fontSize={9} fill="#64748B" fontFamily="monospace">
              {data.length ? new Date(data[0].minute).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
            </text>
            <text x={PAD_L + innerW} y={H - 5} textAnchor="end" fontSize={9} fill="#64748B" fontFamily="monospace">
              {data.length ? new Date(data[data.length - 1].minute).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-'}
            </text>
          </svg>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full bg-[#22D3EE]" /> request</span>
          <span className="flex items-center gap-1"><i className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: '#EF4444' }} /> error</span>
        </span>
        <span className="font-mono">
          puncak {peak.total} req/menit · total {data.reduce((s, b) => s + b.total, 0)} req
        </span>
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

/**
 * Panel kondisi hardware mesin server: processor, RAM, storage, load
 * average, dan uptime mesin. Data berasal dari `/proc` + `df` di server.
 */
function SystemPanel({ system }: { system: SystemMetrics }) {
  const cpu = system.cpu
  const mem = system.memory
  const cpuPct = cpu.usagePercent ?? cpu.averageSinceBootPercent
  const cpuColor = cpuPct >= 85 ? '#EF4444' : cpuPct >= 60 ? '#F59E0B' : '#22D3EE'
  const memColor = mem.usedPercent >= 85 ? '#EF4444' : mem.usedPercent >= 60 ? '#F59E0B' : '#3B82F6'

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-700/60 bg-slate-800/40 px-3 py-2 font-mono text-[10px] text-slate-400">
        <span className="flex items-center gap-1.5 text-slate-200">
          <Server size={12} /> {system.hostname}
        </span>
        <span>{system.os}</span>
        <span>uptime mesin {formatUptime(system.uptimeSeconds * 1000)}</span>
        {!system.available && <span className="text-amber-400">metrik sistem tidak terbaca di server ini</span>}
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* Processor */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <Cpu size={12} /> Processor
            </span>
            <span className="font-mono text-[11px] font-bold" style={{ color: cpuColor }}>{cpuPct.toFixed(1)}%</span>
          </div>
          <Meter ratio={cpuPct / 100} color={cpuColor} />
          <p className="mt-1.5 truncate text-[10px] text-slate-500" title={cpu.model}>{cpu.model}</p>
          <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-[10px] text-slate-400">
            <span>{cpu.cores || '-'} core</span>
            <span>{cpu.mhz ? `${cpu.mhz} MHz` : '-'}</span>
            <span className="text-right">
              load {cpu.loadAvg.map(v => v.toFixed(2)).join(' / ')}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-slate-600">
            rata-rata sejak boot {cpu.averageSinceBootPercent.toFixed(1)}%
          </p>
        </div>

        {/* Memori */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <MemoryStick size={12} /> Memori (RAM)
            </span>
            <span className="font-mono text-[11px] font-bold" style={{ color: memColor }}>
              {mem.usedPercent.toFixed(1)}%
            </span>
          </div>
          <Meter ratio={mem.usedPercent / 100} color={memColor} />
          <p className="mt-1.5 font-mono text-[10px] text-slate-300">
            {formatBytes(mem.used)} / {formatBytes(mem.total)}
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-[10px] text-slate-400">
            <span>bebas {formatBytes(mem.available)}</span>
            <span className="text-right">
              swap {formatBytes(mem.swapUsed)} / {formatBytes(mem.swapTotal)}
            </span>
          </div>
        </div>

        {/* Storage */}
        <div className="rounded-xl border border-slate-700/60 bg-slate-800/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              <HardDrive size={12} /> Penyimpanan
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {system.disks.length} filesystem
            </span>
          </div>
          {system.disks.length === 0 ? (
            <p className="text-[10px] text-slate-500">Informasi disk tidak tersedia.</p>
          ) : (
            <div className="space-y-2.5">
              {system.disks.map(d => (
                <div key={d.path}>
                  <div className="flex items-center justify-between font-mono text-[10px]">
                    <span className="text-slate-300">{d.label}</span>
                    <span className="text-slate-400">{d.usedPercent.toFixed(1)}%</span>
                  </div>
                  <div className="mt-1">
                    <Meter ratio={d.usedPercent / 100} color={d.usedPercent >= 85 ? '#EF4444' : d.usedPercent >= 60 ? '#F59E0B' : '#10B981'} />
                  </div>
                  <p className="mt-0.5 font-mono text-[10px] text-slate-500" title={d.path}>
                    {formatBytes(d.used)} terpakai / {formatBytes(d.total)} · {formatBytes(d.free)} bebas
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
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
    <div className="flex min-h-screen w-full flex-col bg-slate-900 p-5">
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
        <div className="flex flex-1 flex-col gap-4">
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

          {/* Kondisi hardware mesin server */}
          {stats.system && (
            <div className="flex flex-col">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <Cpu size={12} /> Kondisi Hardware Server
              </p>
              <SystemPanel system={stats.system} />
            </div>
          )}

          {/* Grafik + status komponen */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-5">
            <div className="flex min-h-0 flex-col lg:col-span-3">
              <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
                <Activity size={12} /> Grafik Request per Menit
              </p>
              <TrafficChart buckets={m.buckets} />
              <TrafficTable buckets={m.buckets} />
            </div>

            <div className="min-h-0 lg:col-span-2">
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
            <div className="flex min-h-0 flex-1 flex-col">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-400">Endpoint Teramai</p>
              <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-700/60">
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
