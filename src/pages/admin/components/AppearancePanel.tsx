import { useState } from 'react'
import { Check, Moon, RotateCcw, Sun } from 'lucide-react'
import {
  ACCENT_OPTIONS,
  DEFAULT_THEME,
  ZOOM_OPTIONS,
  loadTheme,
  saveTheme,
  type AdminTheme,
} from '../../../services/theme'

/**
 * Panel "Tampilan" di halaman Pengaturan.
 *
 * Semua pilihan di sini benar-benar berlaku: nilainya disimpan di perangkat
 * (localStorage) lalu diterapkan ke <html> lewat saveTheme()/applyTheme(),
 * sehingga seluruh dashboard admin langsung berubah tanpa muat ulang.
 * Tidak ada opsi yang hanya "pajangan".
 */
export function AppearancePanel() {
  const [theme, setTheme] = useState<AdminTheme>(() => loadTheme())

  const update = (patch: Partial<AdminTheme>) => {
    setTheme(prev => {
      const next = { ...prev, ...patch }
      saveTheme(next)
      return next
    })
  }

  const reset = () => {
    const next = { ...DEFAULT_THEME }
    saveTheme(next)
    setTheme(next)
  }

  const isDefault =
    theme.mode === DEFAULT_THEME.mode &&
    theme.zoom === DEFAULT_THEME.zoom &&
    theme.accent === DEFAULT_THEME.accent

  return (
    <div className="rounded-2xl border border-[var(--admin-border)] bg-[var(--admin-surface)] p-5 shadow-[var(--admin-shadow-card)]">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--admin-accent-soft)] text-[var(--admin-accent-text)]">
          {theme.mode === 'dark' ? <Moon size={17} /> : <Sun size={17} />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-[14px] font-bold text-[var(--admin-text)]">Tampilan</h3>
          <p className="mt-0.5 text-[12px] leading-relaxed text-[var(--admin-text-muted)]">
            Atur mode gelap, ukuran teks, dan warna aksen dashboard. Pengaturan
            disimpan di perangkat ini dan langsung berlaku.
          </p>
        </div>
        <button
          onClick={reset}
          disabled={isDefault}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--admin-border)] px-2.5 py-1.5 text-[11px] font-bold text-[var(--admin-text-muted)] transition-colors hover:bg-[var(--admin-surface-hover)] hover:text-[var(--admin-text-soft)] disabled:cursor-not-allowed disabled:opacity-40"
          title="Kembalikan tampilan ke bawaan (terang, ukuran sedang, aksen biru)"
        >
          <RotateCcw size={12} /> Reset
        </button>
      </div>

      {/* Mode terang / gelap */}
      <div className="mt-5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">Mode Warna</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            { value: 'light', label: 'Terang', desc: 'Latar putih, cocok untuk ruangan terang', Icon: Sun },
            { value: 'dark', label: 'Gelap', desc: 'Latar gelap, nyaman untuk malam', Icon: Moon },
          ] as const).map(({ value, label, desc, Icon }) => {
            const active = theme.mode === value
            return (
              <button
                key={value}
                onClick={() => update({ mode: value })}
                aria-pressed={active}
                className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  active
                    ? 'border-[var(--admin-accent-border)] bg-[var(--admin-accent-soft)]'
                    : 'border-[var(--admin-border)] bg-[var(--admin-surface)] hover:bg-[var(--admin-surface-hover)]'
                }`}
              >
                <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                  active
                    ? 'bg-[var(--admin-accent)] text-[var(--admin-accent-contrast)]'
                    : 'bg-[var(--admin-surface-sunken)] text-[var(--admin-text-muted)]'
                }`}>
                  <Icon size={15} />
                </span>
                <span className="min-w-0">
                  <span className={`block text-[13px] font-bold ${active ? 'text-[var(--admin-accent-text)]' : 'text-[var(--admin-text-soft)]'}`}>
                    {label}
                  </span>
                  <span className="block text-[11px] text-[var(--admin-text-faint)]">{desc}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Ukuran tampilan */}
      <div className="mt-5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">Ukuran Tampilan</p>
        <div className="flex flex-wrap gap-2">
          {ZOOM_OPTIONS.map(option => {
            const active = theme.zoom === option.value
            return (
              <button
                key={option.value}
                onClick={() => update({ zoom: option.value })}
                aria-pressed={active}
                className={`rounded-lg border px-3 py-1.5 text-[12px] font-bold transition-colors ${
                  active
                    ? 'border-[var(--admin-accent-border)] bg-[var(--admin-accent-soft)] text-[var(--admin-accent-text)]'
                    : 'border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]'
                }`}
              >
                {option.label}
                <span className="ml-1.5 font-semibold text-[var(--admin-text-faint)]">{Math.round(option.value * 100)}%</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Warna aksen */}
      <div className="mt-5">
        <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--admin-text-muted)]">Warna Aksen</p>
        <div className="flex flex-wrap gap-2">
          {ACCENT_OPTIONS.map(option => {
            const active = theme.accent === option.key
            return (
              <button
                key={option.key}
                onClick={() => update({ accent: option.key })}
                aria-pressed={active}
                title={`Aksen ${option.label}`}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[12px] font-bold transition-colors ${
                  active
                    ? 'border-[var(--admin-border-strong)] bg-[var(--admin-surface-muted)] text-[var(--admin-text)]'
                    : 'border-[var(--admin-border)] text-[var(--admin-text-muted)] hover:bg-[var(--admin-surface-hover)]'
                }`}
              >
                <span className="flex h-4 w-4 items-center justify-center rounded-full" style={{ backgroundColor: option.swatch }}>
                  {active && <Check size={10} className="text-white" />}
                </span>
                {option.label}
              </button>
            )
          })}
        </div>
      </div>

      <p className="mt-4 text-[11px] text-[var(--admin-text-faint)]">
        Berlaku di dashboard ini saja (bukan aplikasi mobile petugas).
      </p>
    </div>
  )
}
