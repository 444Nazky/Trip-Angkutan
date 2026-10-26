import { ServerStatsPanel } from '../components/ServerStatsPanel'
import { ChangePasswordSection } from '../ChangePassword'

interface SettingsTabProps {
  showToast?: (msg: string, type?: 'success' | 'error') => void
}

export function SettingsTab({ showToast }: SettingsTabProps) {
  return (
    <div className="space-y-6">
      <ServerStatsPanel />
      <ChangePasswordSection showToast={showToast} />
    </div>
  )
}
