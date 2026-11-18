/**
 * Peran titik geofence.
 *
 * - `start` : titik awal — dipakai saat petugas memilih rute / input kendaraan.
 * - `end`   : titik tujuan — dipakai saat petugas submit trip (end trip).
 * - `both`  : berlaku untuk keduanya (bawaan titik lama).
 *
 * Titik lama tidak punya kolom ini di database, jadi `undefined` HARUS
 * dianggap `both` agar perilaku yang sudah berjalan tidak berubah.
 */
export type GeofencePointRole = 'start' | 'end' | 'both'
export type GeofencePhase = 'start' | 'end'

export function normalizeGeofenceRole(value: unknown): GeofencePointRole {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'start' || raw === 'awal' || raw === 'input') return 'start'
  if (raw === 'end' || raw === 'tujuan' || raw === 'submit') return 'end'
  return 'both'
}

/** Apakah titik dengan peran ini dipakai pada tahap `phase`. */
export function geofenceRoleServes(
  role: GeofencePointRole | undefined,
  phase: GeofencePhase,
): boolean {
  const value = normalizeGeofenceRole(role)
  return phase === 'start' ? value !== 'end' : value !== 'start'
}

export const GEOFENCE_ROLE_LABEL: Record<GeofencePointRole, string> = {
  start: 'Titik Awal (Input)',
  end: 'Titik Tujuan (End Trip)',
  both: 'Titik Tambahan',
}
