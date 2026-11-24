import type { Officer, BackendOfficerRow } from './types'

/**
 * Gabungkan baris petugas dari server dengan state lama di dashboard.
 *
 * Server adalah sumber kebenaran: array `dermagas`/`regions` kosong berarti
 * akses memang dicabut, bukan alasan memakai daftar lama. State lama hanya
 * dipakai untuk mempertahankan PIN yang tidak dikirim server.
 */
export function mergeBackendOfficers(rows: BackendOfficerRow[], prev: Officer[]): Officer[] {
  return rows.map(b => {
    const old = prev.find(o => String(o.id) === String(b.id)) ?? prev.find(o => o.name === b.name)
    const regions = (b.regions ?? []).map(r => r.name)
    const region = regions[0] ?? b.region_code ?? b.region_id ?? '-'
    return {
      id: String(b.id),
      name: b.name,
      username: b.username || b.name?.toLowerCase().replace(/\s+/g, '') || b.id,
      initials: b.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      region,
      regions,
      pin: old?.pin ?? '',
      status: b.is_active ? 'Aktif' : 'Nonaktif',
      dermagaAccess: b.dermagas ?? [],
    }
  })
}
