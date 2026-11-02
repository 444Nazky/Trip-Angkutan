import { ServerStatsPanel } from '../components/ServerStatsPanel'
import { AppSettingsPanel } from '../components/AppSettingsPanel'

interface SettingsTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function SettingsTab({ showToast }: SettingsTabProps) {
  return (
    <div className="space-y-6">
      <AppSettingsPanel showToast={showToast} />
      <ServerStatsPanel />
    </div>
  )
}
