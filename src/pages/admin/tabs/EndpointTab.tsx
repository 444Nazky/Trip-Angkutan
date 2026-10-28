import EndpointPicker from '../../../components/EndpointPicker'
import { CARD } from '../theme'

interface EndpointTabProps {
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function EndpointTab({ showToast }: EndpointTabProps) {
  return (
    <div className={CARD}>
      <div className="p-6">
        <h3 className="text-lg font-black text-slate-900">Endpoint Server</h3>
        <p className="mt-0.5 text-[12px] text-slate-500">
          Pilih server yang dipakai aplikasi mobile - Supabase cloud atau Intranet Kantor.
        </p>
      </div>
      <div className="border-t border-slate-200 p-6">
        <EndpointPicker onApplied={() => showToast('Endpoint diterapkan')} />
      </div>
    </div>
  )
}
