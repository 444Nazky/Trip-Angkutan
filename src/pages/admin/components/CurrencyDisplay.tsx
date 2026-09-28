import { useState } from 'react'

interface CurrencyDisplayProps {
  amount: number
  className?: string
  prefix?: string
}

export function CurrencyDisplay({ amount, className = '', prefix = 'Rp ' }: CurrencyDisplayProps) {
  const [revealed, setRevealed] = useState(false)

  const formatted = `${prefix}${amount.toLocaleString('id-ID')}`

  return (
    <span
      className={`cursor-pointer select-none font-bold tabular-nums transition-colors ${className}`}
      onClick={() => setRevealed(r => !r)}
      onMouseEnter={() => setRevealed(true)}
      onMouseLeave={() => setRevealed(false)}
      title="Klik atau hover untuk lihat nominal"
    >
      {revealed ? (
        <span className="text-emerald-600">{formatted}</span>
      ) : (
        <span className="text-slate-400">***</span>
      )}
    </span>
  )
}
