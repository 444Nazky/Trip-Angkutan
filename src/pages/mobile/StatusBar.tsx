import { useEffect, useState } from 'react'

export default function StatusBar() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(interval)
  }, [])

  const time = now.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  return (
    <div className="h-8 shrink-0 px-6 flex items-center justify-between text-[11px] font-bold text-slate-800" aria-label={`Waktu ${time}`}>
      <span>{time}</span>
      <div className="flex items-center gap-1.5" aria-hidden="true">
        <span className="tracking-[-2px]">●●●</span>
        <span className="text-[10px]">Wi-Fi</span>
        <span className="w-5 h-2.5 rounded-sm border border-slate-700 relative">
          <span className="absolute inset-y-[2px] left-[2px] right-[5px] rounded-[1px] bg-slate-700" />
        </span>
      </div>
    </div>
  )
}
