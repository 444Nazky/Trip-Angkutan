import StatusBar from './StatusBar'
import FloatingBottomNav from './FloatingBottomNav'
import type { MobileScreen } from '../types'

interface MobileShellProps {
  children: React.ReactNode
  activeNav: string
  onNav: (s: MobileScreen) => void
}

export default function MobileShell({ children, activeNav, onNav }: MobileShellProps) {
  return (
    <div
      className="w-[390px] h-[844px] max-h-screen bg-[#F1F5F9] rounded-[48px] overflow-hidden relative flex flex-col border border-slate-300/60"
      style={{ boxShadow: '0 32px 80px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.8)' }}
    >
      <StatusBar />
      <div className="flex-1 overflow-y-auto hide-scrollbar pb-2">{children}</div>
      <div className="shrink-0 relative z-30">
        <FloatingBottomNav activeScreen={activeNav} onNavigate={(s) => onNav(s as MobileScreen)} />
      </div>
    </div>
  )
}
