/**
 * Daftar alasan pembatalan trip.
 *
 * Dipisah dari `tripCancel.ts` supaya halaman admin bisa memakai daftar ini
 * tanpa menarik modul antrean offline (IndexedDB) ke bundle dashboard.
 *
 * Daftar ini bukan teks bebas: alasan yang terkategori membuat dokumen
 * pembatalan bisa dibaca admin tanpa perlu menebak maksud petugas.
 */
export const CANCEL_REASONS = [
  'Kendaraan batal dimuat',
  'Pelanggan membatalkan',
  'Rute / tujuan berubah',
  'Data masuk salah',
  'Kendaraan tidak ditemukan',
  'Lainnya',
] as const

export type CancelReason = typeof CANCEL_REASONS[number]

export function isCancelReason(value: string): value is CancelReason {
  return (CANCEL_REASONS as readonly string[]).includes(value)
}
