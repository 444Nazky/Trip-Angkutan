interface CurrencyDisplayProps {
  amount: number
  revealed: boolean
  onToggleReveal: () => void
  className?: string
  prefix?: string
}



export function CurrencyDisplay({ amount, revealed, onToggleReveal, className = '', prefix = 'Rp ' }: CurrencyDisplayProps) {
  const formatted = `${prefix}${amount.toLocaleString('id-ID')}`

  return (
    <span
      className={`cursor-pointer select-none font-bold tabular-nums transition-colors ${className}`}
      onClick={onToggleReveal}
      title={revealed ? 'Klik untuk sembunyikan' : 'Klik untuk lihat nominal'}
    >
      {revealed ? (
        <span className="text-emerald-600">{formatted}</span>
      ) : (
        <span className="text-slate-400">Rp ••••••</span>
      )}
    </span>
  )
}
