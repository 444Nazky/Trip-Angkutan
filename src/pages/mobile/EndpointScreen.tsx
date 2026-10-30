import EndpointPicker from '../../components/EndpointPicker'
import type { MobileScreen } from '../types'

interface EndpointScreenProps {
  go: (s: MobileScreen) => void
}

export default function EndpointScreen({ go }: EndpointScreenProps) {
  return (
    <div className="flex flex-col px-4 pb-6 pt-3" style={{ gap: 16 }}>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <EndpointPicker showExtraActions={false} />
      </div>

      <button
        onClick={() => go('profile')}
        className="rounded-xl border border-slate-200 bg-white py-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 active:scale-[0.99]"
      >
        Kembali ke Profil
      </button>
    </div>
  )
}
