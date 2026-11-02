import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * Grafik tren pembatalan per hari.
 *
 * Satu seri (jumlah pembatalan per hari) -> TIDAK butuh legend; judul kartu
 * sudah menyebut apa yang digambar. Bentuk: area + garis 2px, sesuai pola
 * ServerStatsPanel supaya konsisten dengan dashboard yang sudah ada.
 *
 * Sumbu X = tanggal (WIB), sumbu Y = jumlah. Tidak ada sumbu kedua: hanya
 * satu ukuran, jadi tidak ada dual-axis.
 *
 * Hover: crosshair mencari posisi X terdekat + tooltip yang menampilkan
 * tanggal dan jumlah. Nilai yang sama bisa dibaca lewat label di bawah
 * (kartu tabel di tab pembatalan), jadi tooltip hanya menambah, tidak
 * menjadi satu-satunya jalan ke angka.
 */
interface DailyTrendProps {
  data: { day: string; count: number }[]
}

const LINE_COLOR = '#3B82F6'
const GRID = '#E2E8F0'
const AXIS_TEXT = '#64748B'

/** Lebar container yang diamati (dalam piksel) supaya SVG digambar real-size. */
function useElementWidth(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => setWidth(el.getBoundingClientRect().width)
    update()
    // jsdom (unit test) tidak punya ResizeObserver -> pakai event resize.
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return [ref, width]
}

/** Tanggal ringkas untuk label sumbu X ("01 Nov"). */
function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00+07:00`)
  if (Number.isNaN(d.getTime())) return day
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
  }).format(d)
}

export function DailyTrend({ data }: DailyTrendProps) {
  const [wrapRef, width] = useElementWidth()
  const [hover, setHover] = useState<number | null>(null)

  const H = 150
  const PAD_L = 30
  const PAD_R = 10
  const PAD_T = 10
  const PAD_B = 20

  if (!data.length) {
    return (
      <p className="px-1 py-6 text-center text-[12px] text-slate-400">
        Belum ada pembatalan pada rentang ini.
      </p>
    )
  }

  const max = Math.max(1, ...data.map(d => d.count))
  const innerW = Math.max(0, width - PAD_L - PAD_R)
  const innerH = H - PAD_T - PAD_B
  const step = data.length > 1 ? innerW / (data.length - 1) : innerW

  const points = data.map((d, i) => ({
    x: PAD_L + i * step,
    y: PAD_T + innerH - (d.count / max) * innerH,
    day: d.day,
    count: d.count,
  }))

  const linePath = points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${PAD_T + innerH} L ${points[0].x} ${PAD_T + innerH} Z`

  const hovered = hover !== null ? points[hover] : null
  const gridLines = [0, 0.5, 1]

  /** Posisi X terdekat dari koordinat pointer. */
  const pickIndex = (clientX: number, rect: DOMRect): number => {
    const rel = clientX - rect.left - PAD_L
    if (step <= 0) return 0
    const idx = Math.round(rel / step)
    return Math.max(0, Math.min(points.length - 1, idx))
  }

  return (
    <div className="relative">
      <div ref={wrapRef} className="relative w-full" style={{ height: H }}>
        {width > 0 && (
          <svg
            width={width}
            height={H}
            className="block"
            role="img"
            aria-label={`Tren pembatalan per hari, ${data.length} hari, total ${data.reduce((s, d) => s + d.count, 0)} pembatalan`}
            onMouseMove={e => {
              const rect = e.currentTarget.getBoundingClientRect()
              setHover(pickIndex(e.clientX, rect))
            }}
            onMouseLeave={() => setHover(null)}
          >
            {/* Gridline: hairline solid, satu langkah dari permukaan. */}
            {gridLines.map(f => {
              const y = PAD_T + innerH - f * innerH
              return (
                <g key={f}>
                  <line
                    x1={PAD_L}
                    x2={PAD_L + innerW}
                    y1={y}
                    y2={y}
                    stroke={GRID}
                    strokeWidth={1}
                  />
                  <text
                    x={PAD_L - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize={9}
                    fill={AXIS_TEXT}
                    fontFamily="monospace"
                  >
                    {Math.round(f * max)}
                  </text>
                </g>
              )
            })}

            <path d={areaPath} fill={LINE_COLOR} fillOpacity={0.1} />
            <path d={linePath} fill="none" stroke={LINE_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

            {/* Crosshair: snapped ke titik data terdekat. */}
            {hovered && (
              <>
                <line
                  x1={hovered.x}
                  x2={hovered.x}
                  y1={PAD_T}
                  y2={PAD_T + innerH}
                  stroke={LINE_COLOR}
                  strokeWidth={1}
                  strokeOpacity={0.4}
                />
                <circle cx={hovered.x} cy={hovered.y} r={4} fill={LINE_COLOR} stroke="#ffffff" strokeWidth={2} />
              </>
            )}

            <text x={PAD_L} y={H - 5} fontSize={9} fill={AXIS_TEXT} fontFamily="monospace">
              {shortDay(points[0].day)}
            </text>
            <text x={PAD_L + innerW} y={H - 5} textAnchor="end" fontSize={9} fill={AXIS_TEXT} fontFamily="monospace">
              {shortDay(points[points.length - 1].day)}
            </text>
          </svg>
        )}

        {/* Tooltip: nilai didahulukan, label menyusul. */}
        {hovered && width > 0 && (
          <div
            className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 shadow-lg"
            style={{
              left: Math.min(Math.max(hovered.x - 60, 0), Math.max(0, width - 130)),
              top: Math.max(hovered.y - 46, 0),
            }}
          >
            <p className="text-[12px] font-bold tabular-nums text-slate-900">{hovered.count}</p>
            <p className="text-[10px] text-slate-500">{hovered.day}</p>
          </div>
        )}
      </div>
    </div>
  )
}
