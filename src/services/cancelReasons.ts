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

/**
 * Teks alasan yang benar-benar DIKETIK petugas.
 *
 * Dokumen dari aplikasi versi lama menyimpan alasan sebagai salah satu
 * pilihan baku (`CANCEL_REASONS`) dan kalimat penjelasan petugas di `note`.
 * Versi terbaru memakai satu input manual, jadi teks yang diketik ada di
 * `reason` dan `note` kosong. Fungsi ini mengembalikan kalimat petugas untuk
 * KEDUA bentuk dokumen, supaya admin tidak menampilkan label pilihan
 * (mis. "Lainnya") padahal petugas menulis alasan sendiri.
 */
export function typedCancelReason(
  reason?: string | null,
  note?: string | null,
): string {
  const free = String(reason ?? '').trim()
  const typed = String(note ?? '').trim()
  if (typed && (!free || isCancelReason(free))) return typed
  return free || typed
}
