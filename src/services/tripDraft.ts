import type { Draft } from '../pages/store'

/**
 * Batas umur draft trip: 12 jam sejak draft DIBUAT.
 *
 * Draft = trip yang sudah diisi petugas tetapi belum terkirim. Batas ini
 * sengaja dihitung dari waktu pembuatan, BUKAN waktu perubahan terakhir:
 * versi lama menyimpan `savedAt` yang bergeser setiap kali form disentuh,
 * sehingga draft bisa hidup berhari-hari selama sesekali dibuka. Dengan
 * patokan `createdAt`, draft benar-benar hilang paling lambat 12 jam setelah
 * petugas mulai mengisinya — tanggal trip di draft tidak pernah tertinggal
 * jauh dari kenyataan.
 */
export const DRAFT_TTL_MS = 12 * 60 * 60 * 1000

/** Keterangan umur draft yang ditampilkan di UI. */
export interface DraftInfo {
  /** Kapan draft pertama kali berisi (dasar batas 12 jam). */
  createdAt: number
  /** Kapan draft terakhir diubah. */
  savedAt: number
  /** createdAt + DRAFT_TTL_MS. */
  expiresAt: number
}

export type DraftResumeTarget = 'trip-condition' | 'route-select' | 'trip-summary'

/**
 * Apakah draft berisi sesuatu yang layak ditampilkan/disimpan.
 *
 * Field teknis (cameraMode, cameraFrom, editVehicleIndex, ...) tidak
 * dihitung: berpindah ke layar kamera lalu kembali tidak boleh memunculkan
 * draft kosong di Riwayat.
 */
export function hasDraftContent(d: Draft | null | undefined): boolean {
  if (!d) return false
  return (
    !!d.condition ||
    !!d.routeCode ||
    (d.vehicles?.length ?? 0) > 0 ||
    !!d.photoUrl ||
    !!d.vPhotoUrl ||
    !!d.selfieUrl ||
    !!d.vehicleForm?.plate?.trim()
  )
}

/** Sisa umur draft dalam milidetik (0 kalau sudah lewat). */
export function draftRemainingMs(info: DraftInfo | null | undefined, now = Date.now()): number {
  if (!info) return 0
  return Math.max(0, info.expiresAt - now)
}

/** "45 mnt", "11j 20m", "12j" — ringkas untuk chip di kartu Riwayat. */
export function formatDraftRemaining(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'kedaluwarsa'
  const totalMinutes = Math.ceil(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${minutes} mnt`
  return minutes > 0 ? `${hours}j ${minutes}m` : `${hours}j`
}

/**
 * Judul draft: rute kalau sudah dipilih, kalau belum pakai status muatan.
 * Dipakai kartu Riwayat supaya petugas langsung tahu draft mana ini.
 */
export function draftRouteLabel(d: Draft): string {
  const code = (d.routeCode ?? '').trim()
  if (code) {
    const sep = code.lastIndexOf('-')
    if (sep > 0) {
      const from = code.slice(0, sep).trim()
      const to = code.slice(sep + 1).trim()
      if (from && to) return `${from} → ${to}`
    }
    return code
  }
  if (d.condition === 'kosong') return 'Trip kosong · rute belum dipilih'
  if (d.condition === 'muatan') return 'Trip muatan · rute belum dipilih'
  return 'Trip baru · status muatan belum dipilih'
}

/** Jumlah foto yang sudah tersimpan di draft (trip, swafoto, kendaraan). */
export function draftPhotoCount(d: Draft): number {
  let n = 0
  if (d.photoUrl) n++
  if (d.selfieUrl) n++
  if (d.vPhotoUrl) n++
  for (const v of d.vehicles ?? []) if (v.photoUrl) n++
  return n
}

/**
 * Layar tempat draft dilanjutkan: sedekat mungkin dengan langkah terakhir
 * yang sudah dikerjakan, tanpa memaksa petugas mengulang dari awal.
 */
export function draftResumeTarget(d: Draft): DraftResumeTarget {
  if (!d.condition) return 'trip-condition'
  if (!d.routeCode) return 'route-select'
  return 'trip-summary'
}
