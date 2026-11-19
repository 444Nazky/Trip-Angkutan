import EndpointPicker from '../../components/EndpointPicker'

export default function EndpointScreen() {
  return (
    <div className="flex flex-col px-4 pb-6 pt-3" style={{ gap: 16 }}>
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <EndpointPicker showExtraActions={false} showManualInput={false} />
      </div>
    </div>
  )
}
