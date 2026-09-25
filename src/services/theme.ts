// ─── Admin Theme Settings ─────────────────────────────────────────────────────
// Preferensi tampilan dashboard admin (tab Pengaturan). Diterapkan lewat
// atribut `data-theme` / `data-accent` pada <html> dan variabel CSS
// `--admin-zoom`, sehingga seluruh CSS-nya hidup di src/index.css yang
// di-scope khusus `html[data-admin]` — aplikasi mobile tidak terpengaruh.

export type ThemeMode = 'light' | 'dark'
export type AccentKey = 'blue' | 'green' | 'violet' | 'amber'

export interface AdminTheme {
  /** Terang / Gelap */
  mode: ThemeMode
  /** Skala ukuran font & tampilan (dipakai sebagai `zoom` pada body) */
  zoom: number
  /** Warna aksen tombol/aktif */
  accent: AccentKey
}

export const THEME_STORAGE_KEY = 'trip.admin.theme.v1'

export const DEFAULT_THEME: AdminTheme = { mode: 'light', zoom: 1, accent: 'blue' }

export const ZOOM_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.9, label: 'Kecil' },
  { value: 1, label: 'Sedang' },
  { value: 1.1, label: 'Besar' },
  { value: 1.25, label: 'Sangat Besar' },
]

export const ACCENT_OPTIONS: Array<{ key: AccentKey; label: string; swatch: string; hover: string }> = [
  { key: 'blue', label: 'Biru', swatch: '#2563eb', hover: '#1d4ed8' },
  { key: 'green', label: 'Hijau', swatch: '#059669', hover: '#047857' },
  { key: 'violet', label: 'Ungu', swatch: '#7c3aed', hover: '#6d28d9' },
  { key: 'amber', label: 'Kuning', swatch: '#d97706', hover: '#b45309' },
]

/** Baca preferensi tersimpan; nilai rusak jatuh ke default. */
export function loadTheme(): AdminTheme {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return { ...DEFAULT_THEME }
    const parsed = JSON.parse(raw) as Partial<AdminTheme>
    const mode: ThemeMode = parsed.mode === 'dark' ? 'dark' : 'light'
    const zoom = typeof parsed.zoom === 'number' && parsed.zoom >= 0.75 && parsed.zoom <= 1.5 ? parsed.zoom : DEFAULT_THEME.zoom
    const accent = ACCENT_OPTIONS.some(a => a.key === parsed.accent) ? (parsed.accent as AccentKey) : DEFAULT_THEME.accent
    return { mode, zoom, accent }
  } catch {
    return { ...DEFAULT_THEME }
  }
}

/** Terapkan tema ke dokumen (dipanggil saat mount & setiap pengaturan berubah). */
export function applyTheme(theme: AdminTheme) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset['theme'] = theme.mode
  el.dataset['accent'] = theme.accent
  el.style.setProperty('--admin-zoom', String(theme.zoom))
}

/** Terapkan + simpan permanen di perangkat ini. */
export function saveTheme(theme: AdminTheme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
  } catch { /* quota */ }
  applyTheme(theme)
}
