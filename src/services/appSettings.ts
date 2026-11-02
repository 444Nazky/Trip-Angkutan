/**
 * Pengaturan runtime aplikasi (ditarik dari server intranet).
 *
 * Satu-satunya pengaturan saat ini: batas umur draft trip (menit).
 * Nilai ini diubah dari dashboard admin (tab "Pengaturan") dan dipakai
 * aplikasi mobile supaya petugas tidak perlu build baru untuk mengubah
 * batas waktu.
 *
 * Nilai disimpan di perangkat (localStorage) supaya tetap berlaku saat
 * server tidak bisa dihubungi - petugas di lapangan sering offline.
 */

import { api } from './api'

/** Nilai bawaan kalau server belum pernah bisa dihubungi. */
export const DEFAULT_DRAFT_TTL_MINUTES = 15

const STORAGE_KEY = 'trip.appSettings.v1'

export interface AppSettings {
  /** Batas umur draft trip, dalam menit. */
  draftTtlMinutes: number
}

function sanitizeMinutes(raw: unknown): number {
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n < 1) return DEFAULT_DRAFT_TTL_MINUTES
  if (n > 240) return 240
  return n
}

/** Pengaturan tersimpan di perangkat (atau nilai bawaan). */
export function getCachedSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { draftTtlMinutes: DEFAULT_DRAFT_TTL_MINUTES }
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { draftTtlMinutes: sanitizeMinutes(parsed?.draftTtlMinutes) }
  } catch {
    return { draftTtlMinutes: DEFAULT_DRAFT_TTL_MINUTES }
  }
}

function writeCachedSettings(value: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch { /* storage penuh / tidak tersedia */ }
}

/**
 * Tarik pengaturan terbaru dari server.
 *
 * Kalau server tidak menjawab, nilai tersimpan di perangkat DIPAKAI (bukan
 * ditimpa dengan nilai bawaan) - jadi perubahan setting admin tidak hilang
 * hanya karena sesaat offline.
 */
export async function pullAppSettings(): Promise<AppSettings> {
  try {
    const res = await api.get<AppSettings>('/settings', 8000)
    if (res.ok && res.data) {
      const next: AppSettings = { draftTtlMinutes: sanitizeMinutes(res.data.draftTtlMinutes) }
      writeCachedSettings(next)
      return next
    }
  } catch { /* offline - pakai nilai tersimpan */ }
  return getCachedSettings()
}
