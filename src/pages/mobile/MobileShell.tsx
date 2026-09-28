import FloatingBottomNav from './FloatingBottomNav'
import type { MobileScreen } from '../types'

interface MobileShellProps {
  children: React.ReactNode
  activeNav: string
  onNav: (s: MobileScreen) => void
}

export default function MobileShell({ children, activeNav, onNav }: MobileShellProps) {
  return (
    <div className="app-frame">
      <div className="flex-1 overflow-y-auto hide-scrollbar pb-2">{children}</div>
      <div className="shrink-0 relative z-30">
        <FloatingBottomNav activeScreen={activeNav} onNavigate={(s) => onNav(s as MobileScreen)} />
      </div>
    </div>
  )
}
