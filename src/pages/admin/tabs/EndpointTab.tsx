import EndpointPicker from '../../../components/EndpointPicker'
import { AppSettingsPanel } from '../components/AppSettingsPanel'
import { AppearancePanel } from '../components/AppearancePanel'

interface EndpointTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function EndpointTab({ showToast }: EndpointTabProps) {
  return (
    <div className="space-y-6">
      <AppearancePanel />
      <AppSettingsPanel showToast={showToast} />
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
        <EndpointPicker onApplied={() => showToast('Endpoint diterapkan')} />
      </div>
    </div>
  )
}
