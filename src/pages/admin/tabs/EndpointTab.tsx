import EndpointPicker from '../../../components/EndpointPicker'
import { CARD } from '../theme'
import { PageHeader } from '../components/PageHeader'

interface EndpointTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function EndpointTab({ showToast }: EndpointTabProps) {
  return (
    <div className="space-y-4">
      <PageHeader
        title="Endpoint Server"
        subtitle="Pilih server yang dipakai aplikasi mobile - Supabase cloud atau Intranet Kantor."
      />
      <div className={CARD}>
        <div className="p-6">
          <EndpointPicker onApplied={() => showToast('Endpoint diterapkan')} />
        </div>
      </div>
    </div>
  )
}
