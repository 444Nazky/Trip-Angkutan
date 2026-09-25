// ─── Trips API Service ─────────────────────────────────────────────────────────
// Fetch trips from backend for admin dashboard

import { api } from './api'

export interface BackendTrip {
  id: string
  no_trip: string
  officer_id: string
  region_id: string
  status_muatan: 'muatan' | 'kosong'
  route_from: string
  route_to: string
  keterangan: string | null
  foto_kosong_path: string | null
  is_synced: number
  created_at: string
  vehicle_count: number
  /** Joined from officers table (present on GET /trips) */
  officer_name?: string | null
  region_code?: string | null
}

export async function fetchTrips(): Promise<BackendTrip[] | null> {
  const result = await api.get<BackendTrip[]>('/trips')
  if (!result.ok || !result.data) {
    return null
  }
  return result.data
}

// ─── Admin report: trips with full vehicle detail ─────────────────────────────

export interface ReportVehicle {
  no_polisi: string
  vehicle_type: string
  /** Kategori: 'Internal' | 'Eksternal (Berganji)' | 'Eksternal (Tanpa Garansi)' (legacy rows may hold a golongan roman numeral) */
  golongan: string
  /** Golongan master tarif (I..V) bila tersedia */
  master_golongan?: string | null
  has_load: number
  tariff_amount: number
}

export interface ReportTrip {
  id: string
  no_trip: string
  route_from: string | null
  route_to: string | null
  status_muatan: 'muatan' | 'kosong'
  keterangan: string | null
  created_at: string
  officer_name?: string | null
  region_name?: string | null
  region_code?: string | null
  /** Nama wilayah asal/tujuan (join regions on code) — untuk detail tempat */
  route_from_name?: string | null
  route_to_name?: string | null
  vehicle_count: number
  trip_revenue: number | null
  vehicles: ReportVehicle[]
}

/** Filter laporan (golongan & jenis kendaraan dari master tarif). */
export interface ReportFilters {
  golongan?: string
  vehicleType?: string
  route?: string
  status?: string
}

function toQuery(f?: ReportFilters): string {
  if (!f) return ''
  const params = new URLSearchParams()
  if (f.golongan) params.set('golongan', f.golongan)
  if (f.vehicleType) params.set('vehicleType', f.vehicleType)
  if (f.route) params.set('route', f.route)
  if (f.status) params.set('status', f.status)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/** Admin-only (GET /reports/trips). Returns null on failure. */
export async function fetchTripReports(filters?: ReportFilters): Promise<ReportTrip[] | null> {
  const result = await api.get<ReportTrip[]>(`/reports/trips${toQuery(filters)}`)
  if (!result.ok || !result.data) return null
  return result.data
}

/** Opsi filter laporan (golongan + jenis kendaraan) dari master tarif. */
export interface ReportFilterOptions {
  golongan: string[]
  vehicleTypes: string[]
}

export async function fetchReportFilters(): Promise<ReportFilterOptions | null> {
  const result = await api.get<ReportFilterOptions>('/reports/trips/filters')
  if (!result.ok || !result.data) return null
  return result.data
}

/**
 * Format timestamp UTC dari SQLite (`YYYY-MM-DD HH:MM:SS`) ke waktu Indonesia
 * Barat (Asia/Jakarta, UTC+7) agar tanggal & jam di laporan akurat.
 */
export function formatReportDateTime(
  raw: string | null | undefined,
  opts: { withSeconds?: boolean } = {},
): { date: string; time: string; full: string } {
  if (!raw) return { date: '-', time: '-', full: '-' }
  // SQLite CURRENT_TIMESTAMP disimpan dalam UTC
  const iso = /Z|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: raw, time: '', full: raw }

  const date = d.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const time = d.toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
    ...(opts.withSeconds ? { second: '2-digit' } : {}),
    hour12: false,
  }).replace(/\./g, ':')
  return { date, time, full: `${date} · ${time} WIB` }
}

export async function fetchTripDetail(id: string): Promise<BackendTrip | null> {
  const result = await api.get<BackendTrip>(`/trips/${id}`)
  if (!result.ok || !result.data) {
    return null
  }
  return result.data
}
