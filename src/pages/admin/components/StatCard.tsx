import type { ReactNode } from 'react'

/**
 * Kartu KPI dashboard admin.
 *
 * Strukturnya mengikuti kotak KPI laporan monitoring (kotak kiri-garis
 * aksen + judul kapital + nilai besar + baris rincian), tapi tampilannya
 * tetap memakai bahasa visual dashboard yang lama: kartu putih, sudut
 * membulat, border slate, bayangan halus, dan label uppercase.
 *
 * Warna aksen WAJIB hex literal (lihat aturan CSS variables di CLAUDE.md):
 * `var(--admin-accent)` tidak terdefinisi -> garis/kolom tidak tampil.
 */

type StatTone = 'default' | 'success' | 'muted' | 'accent' | 'danger'

const TONE_TEXT: Record<StatTone, string> = {
  default: 'text-slate-800',
  success: 'text-emerald-600',
  muted: 'text-slate-400',
  accent: 'text-blue-600',
  danger: 'text-red-600',
}

export function StatRow({
  label,
  value,
  tone = 'default',
  onClick,
}: {
  label: string
  value: ReactNode
  tone?: StatTone
  onClick?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[11px] font-semibold text-slate-500 truncate">{label}</span>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700 hover:bg-slate-100"
        >
          {value}
        </button>
      ) : (
        <span className={`text-[11px] font-bold tabular-nums ${TONE_TEXT[tone]}`}>{value}</span>
      )}
    </div>
  )
}

export function StatCard({
  accent = '#3B82F6',
  title,
  subtitle,
  value,
  children,
}: {
  accent?: string
  title: string
  subtitle?: string
  value: ReactNode
  children?: ReactNode
}) {
  return (
    <div
      className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <p className="text-slate-400 text-[11px] font-semibold uppercase tracking-wide">{title}</p>
      {subtitle && <p className="text-[11px] text-slate-400 mt-0.5">{subtitle}</p>}
      <div className="mt-1 text-2xl font-black text-slate-900">{value}</div>
      {children ? (
        <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-col gap-1.5">
          {children}
        </div>
      ) : null}
    </div>
  )
}
