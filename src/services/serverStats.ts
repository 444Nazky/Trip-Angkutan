/**
 * Klien panel statistik server.
 *
 * Data diambil SELALU dari server INTRANET port 3000
 * (http://192.168.1.123:3000/api/server-stats) - bukan dari endpoint aktif
 * aplikasi dan bukan dari Supabase cloud.
 *
 * Alasannya: angka statistik itu kumulatif di dalam satu proses Deno yang
 * hidup terus di PC kantor. Instance Edge Function Supabase bisa mati dan
 * di-replace kapan saja, sehingga hitungannya tidak pernah akurat.
 */

import { environment } from '../environments/environment'
import { getAuthToken } from './api'

/** Base URL API intranet (port 3000) - sumber data statistik. */
export function intranetStatsBaseUrl(): string {
  const url = (environment as { intranetApiBaseUrl?: string }).intranetApiBaseUrl ?? ''
  return url.trim().replace(/\/+$/, '')
}

export type ComponentStatus = 'ok' | 'degraded' | 'down' | 'unknown'

export interface ServerComponent {
  id: string
  label: string
  status: ComponentStatus
  detail: string
  ms: number
}

export interface MetricsBucket {
  minute: number
  total: number
  ok: number
  err: number
}

export interface PathStat {
  path: string
  count: number
  errors: number
  avgMs: number
  lastMs: number
}

export interface ServerMetrics {
  startedAt: number
  uptimeMs: number
  total: number
  ok: number
  clientError: number
  serverError: number
  successRate: number
  avgMs: number
  p95Ms: number
  maxMs: number
  rpsLastMinute: number
  requestsLastHour: number
  memory: { rss: number; heapUsed: number; heapTotal: number; external: number }
  buckets: MetricsBucket[]
  topPaths: PathStat[]
  lastRequestAt: number | null
  uniqueClientsLastHour: number
}

export interface ServerStats {
  ok: true
  generatedAt: number
  mode: 'intranet' | 'cloud'
  instance: string
  version: string
  metrics: ServerMetrics
  components: ServerComponent[]
}

export type ServerStatsResult =
  | { ok: true; data: ServerStats }
  | { ok: false; error: string; ms: number }

/**
 * Ambil statistik dari server intranet port 3000.
 *
 * Token admin dikirim kalau tersedia supaya endpoint `/server-stats` (yang
 * mewajibkan role admin) menerimanya. JWT_SECRET server intranet sama
 * dengan yang dipakai Supabase, jadi token dari cloud tetap sah di sini.
 */
export async function fetchServerStats(timeoutMs = 8000): Promise<ServerStatsResult> {
  const base = intranetStatsBaseUrl()
  if (!base) {
    return { ok: false, error: 'URL server intranet belum dikonfigurasi.', ms: 0 }
  }

  const started = Date.now()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = { Accept: 'application/json' }
    const token = getAuthToken()
    if (token) headers['Authorization'] = `Bearer ${token}`

    const res = await fetch(`${base}/server-stats?_t=${Date.now()}`, {
      method: 'GET',
      headers,
      cache: 'no-store',
      signal: ctrl.signal,
    })

    const ms = Date.now() - started
    const text = await res.text()
    let payload: any = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      payload = null
    }

    if (!res.ok) {
      const msg = payload?.error?.message ?? payload?.error ?? `HTTP ${res.status}`
      return { ok: false, error: String(msg), ms }
    }
    if (!payload || payload.ok !== true || !payload.metrics) {
      return { ok: false, error: 'Respons server tidak dikenali.', ms }
    }
    return { ok: true, data: payload as ServerStats }
  } catch (e) {
    const ms = Date.now() - started
    if (e instanceof DOMException && e.name === 'AbortError') {
      return { ok: false, error: `Server tidak merespon (timeout ${timeoutMs} ms)`, ms }
    }
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Gagal menghubungi server intranet',
      ms,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Ubah byte menjadi MB dengan 1 angka desimal. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
  return `${mb.toFixed(1)} MB`
}

/** Ubah milidetik menjadi durasi pendek. */
export function formatMs(ms: number): string {
  if (!ms || ms < 0) return '-'
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const m = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return `${m}m ${s}s`
}

/** Ubah durasi uptime menjadi teks ringkas. */
export function formatUptime(ms: number): string {
  const s = Math.floor(Math.max(0, ms) / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h} jam ${m} menit`
  if (m > 0) return `${m} menit ${sec} detik`
  return `${sec} detik`
}
