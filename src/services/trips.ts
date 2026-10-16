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

  officer_name?: string | null
  region_code?: string | null
}



export async function fetchTrips(): Promise<BackendTrip[] | null> {
  return api.getOk<BackendTrip[]>('/trips')
}



export interface ReportVehicle {
  id: string
  no_polisi: string
  vehicle_type: string

  golongan: string

  master_golongan?: string | null
  has_load: number
  tariff_amount: number
  foto_path: string | null
  foto_captured_at?: string | null
  latitude?: number | null
  longitude?: number | null

  photo_url?: string | null
}



export interface ReportTrip {
  id: string
  no_trip: string
  route_from: string | null
  route_to: string | null
  status_muatan: 'muatan' | 'kosong'
  keterangan: string | null
  foto_kosong_path: string | null
  foto_captured_at?: string | null
  foto_latitude?: number | null
  foto_longitude?: number | null
  started_at?: string | null
  completed_at?: string | null
  created_at: string
  officer_name?: string | null
  region_name?: string | null
  region_code?: string | null

  route_from_name?: string | null
  route_to_name?: string | null
  vehicle_count: number
  trip_revenue: number | null
  vehicles: ReportVehicle[]
}



export function vehicleUnitLabel(
  vehicles: ReportVehicle[],
  vehicle: ReportVehicle | undefined,
): string {
  if (!vehicle) return '-'
  const idx = Math.max(0, vehicles.findIndex(x => x.id === vehicle.id))
  const type = (vehicle.vehicle_type || 'Kendaraan').trim()
  const key = type.toLowerCase()
  let n = 0
  for (let i = 0; i <= idx; i++) {
    if ((vehicles[i]?.vehicle_type ?? '').trim().toLowerCase() === key) n++
  }
  return `${type.replace(/^Truck/i, 'Truk')} ${n}`
}



export interface ReportFilters {
  golongan?: string
  vehicleType?: string
  route?: string
  status?: string

  startDate?: string
  endDate?: string
}



function toQuery(f?: ReportFilters): string {
  if (!f) return ''
  const params = new URLSearchParams()
  if (f.golongan) params.set('golongan', f.golongan)
  if (f.vehicleType) params.set('vehicleType', f.vehicleType)
  if (f.route) params.set('route', f.route)
  if (f.status) params.set('status', f.status)
  if (f.startDate) params.set('startDate', f.startDate)
  if (f.endDate) params.set('endDate', f.endDate)
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}



export async function fetchTripReports(filters?: ReportFilters): Promise<ReportTrip[] | null> {
  return api.getOk<ReportTrip[]>(`/reports/trips${toQuery(filters)}`)
}



export interface ReportFilterOptions {
  golongan: string[]
  vehicleTypes: string[]
}



export async function fetchReportFilters(): Promise<ReportFilterOptions | null> {
  return api.getOk<ReportFilterOptions>('/reports/trips/filters')
}



export interface ReportSummary {
  totalTrips: number
  totalVehicles: number
  totalRevenue: number
}



export async function fetchReportSummary(
  startDate?: string,
  endDate?: string,
): Promise<ReportSummary | null> {
  const params = new URLSearchParams()
  if (startDate) params.set('startDate', startDate)
  if (endDate) params.set('endDate', endDate)
  const qs = params.toString()
  return api.getOk<ReportSummary>(`/reports/summary${qs ? `?${qs}` : ''}`)
}



export function dayKeyWib(raw: string | null | undefined): string {
  if (!raw) return '-'
  const iso = /Z|[+-]\d{2}:\d{2}$/.test(raw) ? raw : `${raw.replace(' ', 'T')}Z`
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return raw.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(d)
}



export function formatReportDateTime(
  raw: string | null | undefined,
  opts: { withSeconds?: boolean } = {},
): { date: string; time: string; full: string } {
  if (!raw) return { date: '-', time: '-', full: '-' }

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



export function reportPlace(t: ReportTrip): string {
  return t.region_name ? `${t.region_name}${t.region_code ? ` (${t.region_code})` : ''}` : '-'
}



function placePair(name?: string | null, code?: string | null): string {
  if (name) return code ? `${name} (${code})` : name
  return code || '-'
}



export function reportAsal(t: ReportTrip): string {
  return placePair(t.route_from_name, t.route_from)
}



export function reportTujuan(t: ReportTrip): string {
  return placePair(t.route_to_name, t.route_to)
}



export function reportRentang(f: ReportFilters): string {
  return f.startDate || f.endDate
    ? `${f.startDate || 'Awal'} s/d ${f.endDate || 'Akhir'}`
    : 'Semua tanggal'
}
