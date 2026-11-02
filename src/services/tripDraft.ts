import type { Draft } from '../pages/store'
import { metaGet, metaSet } from './localDb'

/**
 * Batas umur draft trip: 15 MENIT sejak draft DIBUAT (nilai bawaan).
 *
 * Draft = trip yang sudah diisi petugas tetapi belum terkirim. Batas ini
 * sengaja dihitung dari waktu pembuatan, BUKAN waktu perubahan terakhir:
 * versi lama menyimpan `savedAt` yang bergeser setiap kali form disentuh,
 * sehingga draft bisa hidup berhari-hari selama sesekali dibuka. Dengan
 * patokan `createdAt`, draft benar-benar hilang paling lambat 15 menit
 * setelah petugas mulai mengisinya — tanggal trip di draft tidak pernah
 * tertinggal jauh dari kenyataan.
 *
 * Setelah batas terlampaui draft TIDAK dihapus paksa: isiannya dibekukan
 * (tidak bisa diedit / menambah kendaraan) supaya petugas tetap bisa
 * mengirim trip-nya atau membatalkannya dengan alasan. Penghapusan total
 * baru terjadi saat draft dikirim atau dibatalkan.
 *
 * NILAI INI BISA DIUBAH dari dashboard admin (tab "Pengaturan"). Nilai di
 * bawah hanya nilai bawaan - lihat `services/appSettings.ts` dan state
 * `draftTtlMs` di `pages/store.tsx` untuk nilai yang benar-benar dipakai.
 */
export const DRAFT_TTL_MS = 15 * 60 * 1000

/** Batas umur draft dalam menit (nilai bawaan, untuk ditampilkan di UI). */
export const DRAFT_MAX_MINUTES = Math.round(DRAFT_TTL_MS / 60000)

/** Keterangan umur draft yang ditampilkan di UI. */
export interface DraftInfo {
  /** Kapan draft pertama kali berisi (dasar batas 15 menit). */
  createdAt: number
  /** Kapan draft terakhir diubah. */
  savedAt: number
  /** createdAt + DRAFT_TTL_MS. */
  expiresAt: number
}

export type DraftResumeTarget = 'trip-condition' | 'route-select' | 'trip-summary'

/**
 * Apakah draft berisi isian apa pun yang layak disimpan.
 *
 * Dipakai untuk penyimpanan lokal (supaya isian yang sudah diketik tidak
 * hilang saat aplikasi ditutup). Field teknis (cameraMode, cameraFrom,
 * editVehicleIndex, ...) tidak dihitung: berpindah ke layar kamera lalu
 * kembali tidak boleh menyisakan draft kosong.
 *
 * Untuk "apakah ini sudah menjadi draft" pakalah `hasCountedDraft`.
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

/**
 * Apakah draft sudah TERHITUNG sebagai draft sungguhan.
 *
 * ATURAN: draft hanya terhitung kalau petugas sudah menginput minimal 1
 * kendaraan. Isian yang baru berupa pilihan status muatan atau rute BELUM
 * terhitung: isian seperti itu tidak disimpan, tidak muncul di Riwayat,
 * tidak mengunci tombol "Mulai Trip", dan tidak mulai menghitung batas 15
 * menit. Jadi mengunci layar bukan berarti iniciada trip.
 *
 * Pengecualian trip KOSONG: alur trip kosong memang tidak pernah menambah
 * kendaraan (Rute → Foto Bukti → Ringkasan), jadi isian minimum-nya adalah
 * foto bukti trip.
 *
 * Dipakai sebagai sumber kebenaran tunggal oleh store (penyimpanan + TTL),
 * Beranda (kunci tombol Mulai Trip), dan Riwayat (kartu draft) supaya ketiga
 * layar tidak berbeda pendapat soal "apakah ada draft".
 */
export function hasCountedDraft(d: Draft | null | undefined): boolean {
  if (!d) return false
  if (d.condition === 'kosong') return !!d.photoUrl
  return (d.vehicles?.length ?? 0) > 0
}

/** Sisa umur draft dalam milidetik (0 kalau sudah lewat). */
export function draftRemainingMs(info: DraftInfo | null | undefined, now = Date.now()): number {
  if (!info) return 0
  return Math.max(0, info.expiresAt - now)
}

/**
 * Draft sudah kedaluwarsa?
 *
 * Draft yang lewat batas 15 menit tidak boleh diedit lagi (tambah/ubah
 * kendaraan, ganti foto) — tapi masih bisa dikirim atau dibatalkan.
 */
export function draftExpired(info: DraftInfo | null | undefined, now = Date.now()): boolean {
  if (!info) return false
  return now >= info.expiresAt
}

/** "45 mnt", "11j 20m", "12j" — ringkas untuk chip di Riwayat. */
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

// ── Penyimpanan draft per petugas ───────────────────────────────────────────
//
// DULU hanya ada SATU draft untuk seluruh petugas di perangkat. Begitu
// petugas berganti (mis. device dipakai shift pagi & sore), draft milik
// petugas lama muncul di layar petugas baru — dan sebaliknya.
// Sekarang setiap petugas punya draft-nya sendiri, tersimpan di kunci
// terpisah, jadi tidak saling menimpa.

const DRAFT_KEY_PREFIX = 'trip.draft.v2:'
/** Kunci lama (satu draft untuk semua petugas) — dipakai sekali saat migrasi. */
const LEGACY_DRAFT_KEY = 'trip.draft.v1'

export interface StoredDraft {
  savedAt: number
  createdAt?: number
  officerId?: string
  draft: Draft
}

/** Kunci penyimpanan draft milik seorang petugas. */
export function draftKeyFor(officerId?: string | null): string {
  const key = String(officerId ?? '').trim()
  return `${DRAFT_KEY_PREFIX}${key || 'anon'}`
}

/**
 * Baca draft milik seorang petugas.
 *
 * Kalau draft untuk petugas itu belum ada, draft LAMA (versi satu draft
 * untuk semua petugas) diambil kalau miliknya cocok — lalu dihapus supaya
 * tidak pernah muncul lagi di perangkat lain.
 */
export async function readDraftFor(officerId?: string | null): Promise<StoredDraft | null> {
  const key = draftKeyFor(officerId)
  const own = await metaGet(key) as StoredDraft | null
  if (own && typeof own === 'object' && own.draft) return own

  // Migrasi dari kunci lama (sekali saja). Dua bentuk yang pernah dipakai:
  //   - { savedAt, createdAt, officerId, draft }  (format StoredDraft)
  //   - draft mentah (format paling lama, tanpa savedAt)
  const legacyRaw = await metaGet(LEGACY_DRAFT_KEY) as (StoredDraft & { draft?: Draft }) | null
  if (!legacyRaw || typeof legacyRaw !== 'object') return null
  const legacyDraft = (legacyRaw.draft ?? legacyRaw) as Draft
  if (!legacyDraft || typeof legacyDraft !== 'object') return null
  const legacyOwner = String(legacyRaw.officerId ?? '')
  const wanted = String(officerId ?? '')
  if (legacyOwner && wanted && legacyOwner !== wanted) return null
  // Draft format lama tidak punya savedAt: waktunya dihitung dari sekarang.
  const savedAt = typeof legacyRaw.savedAt === 'number' ? legacyRaw.savedAt : Date.now()
  const migrated: StoredDraft = {
    savedAt,
    createdAt: typeof legacyRaw.createdAt === 'number' ? legacyRaw.createdAt : savedAt,
    officerId: wanted || legacyOwner,
    draft: legacyDraft,
  }
  await metaSet(key, migrated)
  await metaSet(LEGACY_DRAFT_KEY, null)
  return migrated
}

/** Simpan draft milik seorang petugas (null = hapus). */
export async function writeDraftFor(
  officerId: string | null | undefined,
  value: StoredDraft | null,
): Promise<void> {
  await metaSet(draftKeyFor(officerId), value)
}
