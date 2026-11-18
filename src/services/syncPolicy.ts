/**
 * Kebijakan sinkron manual.
 *
 * Aplikasi TIDAK lagi mengirim antrean atau menarik master data secara
 * otomatis. Sinkron hanya berjalan saat petugas menekan tombol, dan wajib
 * dilakukan sekali setiap ganti tanggal (tanggal 1, lalu tanggal 2, dst).
 *
 * Tanggal terakhir yang berhasil disinkronkan disimpan lokal supaya status
 * "sudah sinkron hari ini" tetap ada setelah aplikasi ditutup.
 */

const LAST_SYNC_DATE_KEY = 'trip.sync.lastDate.v1'

/** Event saat status sinkron harian berubah (untuk gerbang di MobileApp). */
export const DAILY_SYNC_EVENT = 'trip:daily-sync-changed'

/** Tanggal lokal perangkat dalam bentuk YYYY-MM-DD. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function lastSyncDate(): string | null {
  try {
    return localStorage.getItem(LAST_SYNC_DATE_KEY)
  } catch {
    return null
  }
}

/**
 * Wajib sinkron bila belum pernah sinkron, atau sinkron terakhir bukan hari
 * ini. Dengan begitu tanggal 1 wajib sinkron, dan tanggal 2 wajib lagi.
 */
export function needsDailySync(now: Date = new Date()): boolean {
  return lastSyncDate() !== todayKey(now)
}

/** Tandai sinkron hari ini berhasil. */
export function markSyncedToday(now: Date = new Date()): void {
  try {
    localStorage.setItem(LAST_SYNC_DATE_KEY, todayKey(now))
  } catch { /* kuota penuh: gerbang tetap muncul, tidak fatal */ }
  try {
    window.dispatchEvent(new CustomEvent(DAILY_SYNC_EVENT, { detail: { date: todayKey(now) } }))
  } catch { /* bukan browser */ }
}
