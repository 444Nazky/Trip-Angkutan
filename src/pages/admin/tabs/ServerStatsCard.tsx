import { useEffect, useState } from 'react'
import { Activity, Clock, Cpu, HardDrive, RefreshCw, Server } from 'lucide-react'
import { api, getApiBaseUrl } from '../../../services/api'

interface StatsResponse {
  status: string
  mode: 'intranet' | 'cloud'
  instance: string
  startedAt: string
  uptimeSeconds: number
  requests: {
    total: number
    ok: number
    clientErrors: number
    serverErrors: number
    successRate: number
    avgMs: number
    rpm: number
    recentAvgMs: number
  }
  memory: { rssBytes: number; heapUsedBytes: number; heapTotalBytes: number } | null
  cpu: { load1: number; load5: number; load15: number } | null
  runtime: { platform: string; arch: string; denoVersion: string }
  topEndpoints: { path: string; count: number; errors: number; avgMs: number }[]
}

const REFRESH_MS = 30_000

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}h ${h}j`
  if (h > 0) return `${h}j ${m}m`
  return `${m}m`
}

function formatBytes(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-xl font-black text-slate-900 mt-0.5">{value}</p>
      {hint && <p className="text-[10px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  )
}

export function ServerStatsCard() {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [baseUrl, setBaseUrl] = useState('')

  useEffect(() => {
    let alive = true

    const load = async () => {
      setBaseUrl(getApiBaseUrl())
      const data = await api.getOk<StatsResponse>('/stats')
      if (!alive) return
      setLoading(false)
      if (data) {
        setStats(data)
        setError(null)
      } else {
        setError('Tidak bisa membaca statistik server (butuh login admin).')
      }
    }

    load()
    const timer = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(timer) }
  }, [])

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-4">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-900 text-white flex items-center justify-center">
            <Server size={16} />
          </div>
          <div>
            <p className="text-[13px] font-bold text-slate-900">Statistik Server</p>
            <p className="text-[10px] text-slate-500">{baseUrl || 'memuat…'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${stats ? 'bg-emerald-500' : 'bg-slate-300'}`} />
          <span className="text-[11px] font-semibold text-slate-600">
            {loading ? 'memuat…' : stats ? stats.mode : 'offline'}
          </span>
          <button
            onClick={() => { setLoading(true); setError(null); setStats(null) }}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"
            title="Muat ulang"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {error ? (
        <p className="px-6 py-6 text-[12px] text-slate-500">{error}</p>
      ) : !stats ? (
        <p className="px-6 py-6 text-[12px] text-slate-500">Membaca statistik…</p>
      ) : (
        <div className="p-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Metric label="Uptime" value={formatUptime(stats.uptimeSeconds)} hint={`mulai ${new Date(stats.startedAt).toLocaleString('id-ID')}`} />
            <Metric label="Total Request" value={String(stats.requests.total)} hint={`${stats.requests.rpm} req/menit`} />
            <Metric label="Success Rate" value={`${stats.requests.successRate}%`} hint={`${stats.requests.ok} sukses`} />
            <Metric label="Rata-rata Respons" value={`${stats.requests.avgMs} ms`} hint={`terkini ${stats.requests.recentAvgMs} ms`} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-3">
            <div className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
              <HardDrive size={16} className="text-slate-400" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Memori</p>
                <p className="text-[12px] font-semibold text-slate-800">
                  {stats.memory ? `${formatBytes(stats.memory.heapUsedBytes)} / ${formatBytes(stats.memory.heapTotalBytes)}` : 'n/a'}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
              <Cpu size={16} className="text-slate-400" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Load CPU</p>
                <p className="text-[12px] font-semibold text-slate-800">
                  {stats.cpu ? `${stats.cpu.load1.toFixed(2)} / ${stats.cpu.load5.toFixed(2)} / ${stats.cpu.load15.toFixed(2)}` : 'n/a'}
                </p>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 px-4 py-3 flex items-center gap-3">
              <Clock size={16} className="text-slate-400" />
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Runtime</p>
                <p className="text-[12px] font-semibold text-slate-800">
                  Deno {stats.runtime.denoVersion} · {stats.runtime.platform}/{stats.runtime.arch}
                </p>
              </div>
            </div>
          </div>

          {stats.topEndpoints.length > 0 && (
            <div className="mt-4 rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-50 border-b border-slate-200">
                <Activity size={13} className="text-slate-400" />
                <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Endpoint Teratas</p>
              </div>
              <table className="w-full text-[11px]">
                <tbody>
                  {stats.topEndpoints.map((e) => (
                    <tr key={e.path} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-1.5 font-mono text-slate-700">{e.path}</td>
                      <td className="px-4 py-1.5 text-right text-slate-600">{e.count}x</td>
                      <td className="px-4 py-1.5 text-right text-slate-500">{e.avgMs} ms</td>
                      <td className={`px-4 py-1.5 text-right font-semibold ${e.errors > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {e.errors > 0 ? `${e.errors} error` : 'ok'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
