import { reportGolongan, type ReportTrip } from './trips'



export interface RecapRow {
  jenis: string
  loaded: number
  empty: number
  total: number
  revenue: number
}



export interface RecapGroup {
  golongan: string
  rows: RecapRow[]
  loaded: number
  empty: number
  total: number
  revenue: number
}



const GOLONGAN_ORDER = ['Internal', 'Eksternal', 'Lokal']

// Urutan jenis kendaraan untuk tabel rekap. Dulu daftar ini ditulis manual di frontend ('Mobil', 'Motor', 'Truck Besar', ...) dan baris yang tidak ada…

export function recapRouteKey(trip: ReportTrip): string {
  const from = (trip.route_from_name || trip.route_from || '').trim()
  const to = (trip.route_to_name || trip.route_to || '').trim()
  return from || to ? `${from}|${to}` : ''
}



export function recapRouteLabel(trip: ReportTrip): string {
  const from = (trip.route_from_name || trip.route_from || '').trim()
  const to = (trip.route_to_name || trip.route_to || '').trim()
  return [from, to].filter(Boolean).join(' - ')
}



export function buildRecap(trips: ReportTrip[]): RecapGroup[] {
  const groups = new Map<string, Map<string, RecapRow>>()

  for (const trip of trips) {
    for (const vehicle of trip.vehicles ?? []) {
      const golongan = reportGolongan(vehicle)
      const jenis = (vehicle.vehicle_type || '-').trim() || '-'
      const rows = groups.get(golongan) ?? new Map<string, RecapRow>()
      groups.set(golongan, rows)
      const row = rows.get(jenis) ?? { jenis, loaded: 0, empty: 0, total: 0, revenue: 0 }
      rows.set(jenis, row)
      if (Number(vehicle.has_load) > 0) row.loaded++
      else row.empty++
      row.total++
      row.revenue += Number(vehicle.tariff_amount || 0)
    }
  }

  return [...groups.entries()]
    .map(([golongan, jenisMap]) => {
      // Hanya jenis yang benar-benar ada di data trip. Tidak ada lagi baris kosong untuk jenis kendaraan yang tidak pernah dipakai.
      const rows = [...jenisMap.values()].sort((a, b) => a.jenis.localeCompare(b.jenis))
      return {
        golongan,
        rows,
        loaded: rows.reduce((n, r) => n + r.loaded, 0),
        empty: rows.reduce((n, r) => n + r.empty, 0),
        total: rows.reduce((n, r) => n + r.total, 0),
        revenue: rows.reduce((n, r) => n + r.revenue, 0),
      }
    })
    .sort((a, b) => {
      const ia = GOLONGAN_ORDER.indexOf(a.golongan)
      const ib = GOLONGAN_ORDER.indexOf(b.golongan)
      const oa = ia < 0 ? GOLONGAN_ORDER.length : ia
      const ob = ib < 0 ? GOLONGAN_ORDER.length : ib
      return oa - ob || a.golongan.localeCompare(b.golongan)
    })
}
