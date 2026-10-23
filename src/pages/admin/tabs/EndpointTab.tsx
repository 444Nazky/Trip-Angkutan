import EndpointPicker from '../../../components/EndpointPicker'
import { ServerStatsCard } from './ServerStatsCard'

interface EndpointTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function EndpointTab({ showToast }: EndpointTabProps) {
  return (
    <div>
      <ServerStatsCard />
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <EndpointPicker onApplied={() => showToast('Endpoint diterapkan')} />
      </div>
    </div>
  )
}
