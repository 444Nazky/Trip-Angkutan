import EndpointPicker from '../../../components/EndpointPicker'
import { ServerStatsPanel } from '../components/ServerStatsPanel'

interface EndpointTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function EndpointTab({ showToast }: EndpointTabProps) {
  return (
    <div className="space-y-5">
      {/* Statistik server intranet port 3000 (gaya btop/panel metrik Supabase). */}
      <ServerStatsPanel />

      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <EndpointPicker onApplied={() => showToast('Endpoint diterapkan')} />
      </div>
    </div>
  )
}
