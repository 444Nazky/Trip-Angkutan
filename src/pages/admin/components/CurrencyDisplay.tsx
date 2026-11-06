interface CurrencyDisplayProps {
  amount: number
  revealed: boolean
  onToggleReveal: () => void
  className?: string
  prefix?: string
}

/**
 * Nominal uang yang bisa disembunyikan.
 *
 * Warna nominal yang terlihat MEWARISI `className` pemanggil, supaya kartu
 * KPI, header tabel gelap, dan total kaki tabel bisa memakai warna yang
 * selaras dengan permukaannya (dulu emerald-600 dipaksa di sini sehingga
 * header tabel gelap jadi angka hijau tua yang kontrasnya buruk).
 * Nominal tersembunyi memakai token "faint" yang sama dengan teks
 * keterangan lain.
 */
export function CurrencyDisplay({ amount, revealed, onToggleReveal, className = '', prefix = 'Rp ' }: CurrencyDisplayProps) {
  const formatted = `${prefix}${amount.toLocaleString('id-ID')}`

  return (
    <span
      className={`cursor-pointer select-none font-bold tabular-nums transition-colors ${className}`}
      onClick={onToggleReveal}
      title={revealed ? 'Klik untuk sembunyikan' : 'Klik untuk lihat nominal'}
    >
      {revealed ? (
        <span>{formatted}</span>
      ) : (
        <span className="text-[var(--admin-text-faint)]">Rp ••••••</span>
      )}
    </span>
  )
}
