export type ThemeMode = 'light' | 'dark'



export type AccentKey = 'blue' | 'black' | 'green' | 'violet' | 'amber'



export interface AdminTheme {
  mode: ThemeMode
  zoom: number
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
  { key: 'black', label: 'Hitam', swatch: '#0f172a', hover: '#1e293b' },
  { key: 'green', label: 'Hijau', swatch: '#059669', hover: '#047857' },
  { key: 'violet', label: 'Ungu', swatch: '#7c3aed', hover: '#6d28d9' },
  { key: 'amber', label: 'Kuning', swatch: '#d97706', hover: '#b45309' },
]

/**
 * Palet aksen admin - sumber tunggal warna aksen.
 *
 * Nilai di sini ditulis ke <html> sebagai CSS variable
 * (--admin-accent, --admin-accent-hover, ...) oleh applyTheme().
 * Halaman Dashboard memakai token itu, jadi mengganti aksen cukup lewat
 * tema: tidak ada kelas warna hardcode yang harus dihitung ulang.
 *
 * `soft` = latar berfacebook (chip aktif, header kolom),
 * `border` = garis pembatas Chip/garis aksen,
 * `text` = teks aksen di atas permukaan terang.
 */
export const ACCENT_PALETTE: Record<
  AccentKey,
  { base: string; hover: string; soft: string; border: string; text: string; contrast: string }
> = {
  blue: {
    base: '#2563eb', hover: '#1d4ed8', soft: '#eff6ff',
    border: '#bfdbfe', text: '#1d4ed8', contrast: '#ffffff',
  },
  black: {
    base: '#0f172a', hover: '#1e293b', soft: '#f1f5f9',
    border: '#cbd5e1', text: '#0f172a', contrast: '#ffffff',
  },
  green: {
    base: '#059669', hover: '#047857', soft: '#ecfdf5',
    border: '#a7f3d0', text: '#047857', contrast: '#ffffff',
  },
  violet: {
    base: '#7c3aed', hover: '#6d28d9', soft: '#f5f3ff',
    border: '#ddd6fe', text: '#6d28d9', contrast: '#ffffff',
  },
  amber: {
    base: '#d97706', hover: '#b45309', soft: '#fffbeb',
    border: '#fde68a', text: '#b45309', contrast: '#ffffff',
  },
}



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



export function applyTheme(theme: AdminTheme) {
  if (typeof document === 'undefined') return
  const el = document.documentElement
  el.dataset['theme'] = theme.mode
  el.dataset['accent'] = theme.accent
  el.style.setProperty('--admin-zoom', String(theme.zoom))
  // Token aksen ditulis ke <html> supaya seluruh halaman admin (kartu,
  // tombol, tabel) memakai warna yang sama dari satu sumber.
  const palette = ACCENT_PALETTE[theme.accent] ?? ACCENT_PALETTE[DEFAULT_THEME.accent]
  el.style.setProperty('--admin-accent', palette.base)
  el.style.setProperty('--admin-accent-hover', palette.hover)
  el.style.setProperty('--admin-accent-soft', palette.soft)
  el.style.setProperty('--admin-accent-border', palette.border)
  el.style.setProperty('--admin-accent-text', palette.text)
  el.style.setProperty('--admin-accent-contrast', palette.contrast)
}



export function saveTheme(theme: AdminTheme) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme))
  } catch {}
  applyTheme(theme)
}
