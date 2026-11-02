import { useState } from 'react'

/**
 * Grafik batang horizontal: jumlah pembatalan per alasan.
 *
 * Bentuk: ranked horizontal bars. Yang dibandingkan adalah MAGNITUDA
 * (jumlah per alasan), bukan identitas, jadi SEMUA batang memakai satu
 * warna — bukan palet kategorikal dan bukan ramp per nilai. Warna per batang
 * hanya akan menggandakan informasi yang sudah ditunjukkan panjang batang.
 *
 * Warna: biru admin (#3B82F6) — lolos uji kontras pada permukaan putih
 * (>= 3:1) dan dipakai juga di ServerStatsPanel, jadi satu bahasa visual
 * untuk seluruh dashboard.
 *
 * Setiap batang punya label nilai di ujungnya (direct label), jadi angkanya
 * terbaca tanpa hover. Tabelnya sendiri ada di tab pembatalan (table view),
 * jadi tidak ada angka yang hanya bisa dijangkau lewat hover.
 */
interface ReasonBarsProps {
  data: { reason: string; count: number }[]
  /** Total semua pembatalan (untuk persentase). */
  total: number
}

const BAR_COLOR = '#3B82F6'
const BAR_TRACK = '#E2E8F0'

export function ReasonBars({ data, total }: ReasonBarsProps) {
  const [hovered, setHovered] = useState<string | null>(null)

  if (!data.length) {
    return (
      <p className="px-1 py-6 text-center text-[12px] text-slate-400">
        Belum ada pembatalan pada rentang ini.
      </p>
    )
  }

  const max = Math.max(...data.map(d => d.count), 1)

  return (
    <ul className="space-y-3">
      {data.map(d => {
        const pct = total > 0 ? Math.round((d.count / total) * 100) : 0
        // Panjang batang relatif terhadap alasan TERBANYAK, bukan terhadap
        // total — supaya perbandingan antar-alasan terbaca jelas.
        const widthPct = Math.max(1, (d.count / max) * 100)
        const isHovered = hovered === d.reason
        return (
          <li
            key={d.reason}
            onMouseEnter={() => setHovered(d.reason)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span className="truncate text-[12px] font-medium text-slate-700" title={d.reason}>
                {d.reason}
              </span>
              <span className="shrink-0 text-[11px] font-bold tabular-nums text-slate-500">
                {d.count} · {pct}%
              </span>
            </div>
            {/* Bar: tinggi 10px (di bawah batas 24px), ujung data membulat 4px,
                pangkal siku di baseline. Track di belakang memakai abu-abu satu
                langkah dari permukaan, jadi batang terbaca sebagai isi. */}
            <div className="h-2.5 w-full rounded-sm" style={{ backgroundColor: BAR_TRACK }}>
              <div
                className="h-2.5 rounded-r transition-opacity"
                style={{
                  width: `${widthPct}%`,
                  backgroundColor: BAR_COLOR,
                  opacity: hovered && !isHovered ? 0.55 : 1,
                }}
              />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
