import { useState, useEffect } from 'react'
import { fetchPlates, createPlate, updatePlate, deletePlate, type PlateRecord, type PlateStatus } from '../../../services/plates'
import { fetchRegions } from '../../../services/regions'
import type { Region } from '../components/types'

interface PlatesTabProps {
  plates: PlateRecord[]
  serverState: 'connecting' | 'online' | 'offline'
  onPlatesChange: (p: PlateRecord[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function PlatesTab({ plates, serverState, onPlatesChange, showToast }: PlatesTabProps) {
  const [regions, setRegions] = useState<Region[]>([])
  const [plateForm, setPlateForm] = useState({ plate: '', owner: '', originRegionId: '', status: 'internal' as PlateStatus })
  const [editPlateId, setEditPlateId] = useState<string | null>(null)
  const [plateState, setPlateState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')

  useEffect(() => {
    if (plateState !== 'idle') return
    setPlateState('loading')
    Promise.all([fetchPlates(), fetchRegions()]).then(([pls, regs]) => {
      if (pls === null) { setPlateState('offline'); return }
      onPlatesChange(pls)
      if (regs) setRegions(regs)
      setPlateState('ready')
    })
  }, [plateState])

  const resetForm = () => {
    setPlateForm({ plate: '', owner: '', originRegionId: '', status: 'internal' })
    setEditPlateId(null)
  }

  const handleSave = async () => {
    if (!plateForm.plate.trim()) return showToast('Nomor plat wajib diisi!', 'error')
    const input = {
      plate: plateForm.plate.trim().toUpperCase(),
      owner: plateForm.owner.trim() || undefined,
      originRegionId: plateForm.originRegionId || null,
      status: plateForm.status,
    }
    if (editPlateId) {
      const ok = await updatePlate(editPlateId, input)
      if (!ok) return showToast('Server gagal', 'error')
    } else {
      const id = await createPlate(input)
      if (!id) return showToast('Server gagal', 'error')
    }
    const fresh = await fetchPlates()
    if (fresh) onPlatesChange(fresh)
    resetForm()
    showToast(editPlateId ? 'Plat diupdate' : 'Plat terdaftar')
  }

  const handleDel = async (id: string) => {
    if (!confirm('Hapus plat ini?')) return
    const ok = await deletePlate(id)
    if (!ok) return showToast('Server gagal', 'error')
    onPlatesChange(plates.filter(p => p.id !== id))
    if (editPlateId === id) resetForm()
    showToast('Plat dihapus')
  }

  const statusColor = (s: string) =>
    s === 'internal' ? 'bg-slate-800 text-white' : s === 'lokal' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Master Plat</h3>
          <p className="text-slate-500 text-[12px]">Plat <b>internal</b> tidak dikenakan tarif saat discan</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
          plateState === 'ready' ? 'bg-emerald-50 text-emerald-600' : plateState === 'offline' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${plateState === 'ready' ? 'bg-emerald-500' : plateState === 'offline' ? 'bg-amber-500' : 'bg-slate-400 animate-pulse'}`} />
          {plateState === 'ready' ? 'Server: Tersambung' : plateState === 'offline' ? 'Offline' : 'Memuat...'}
        </span>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-3xl">
        <h3 className="font-bold mb-4">{editPlateId ? 'Edit Plat' : 'Daftar Plat Baru'}</h3>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div><label className="text-[11px] text-slate-500 block mb-1">No. Plat *</label>
            <input value={plateForm.plate} onChange={e => setPlateForm({...plateForm, plate: e.target.value.toUpperCase()})}
              placeholder="B 1234 XY" className="w-full border rounded-xl px-3 py-2 text-sm font-mono tracking-wide" /></div>
          <div><label className="text-[11px] text-slate-500 block mb-1">Pemilik (opsional)</label>
            <input value={plateForm.owner} onChange={e => setPlateForm({...plateForm, owner: e.target.value})}
              placeholder="Nama pemilik" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          <div><label className="text-[11px] text-slate-500 block mb-1">Region Asal</label>
            <select value={plateForm.originRegionId} onChange={e => setPlateForm({...plateForm, originRegionId: e.target.value})}
              className="w-full border rounded-xl px-3 py-2 text-sm">
              <option value="">—</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
            </select></div>
          <div><label className="text-[11px] text-slate-500 block mb-1">Status</label>
            <select value={plateForm.status} onChange={e => setPlateForm({...plateForm, status: e.target.value as PlateStatus})}
              className="w-full border rounded-xl px-3 py-2 text-sm">
              <option value="internal">internal</option>
              <option value="lokal">lokal</option>
              <option value="eksternal">eksternal</option>
            </select></div>
        </div>
        <div className="flex gap-3">
          {editPlateId && <button onClick={resetForm} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>}
          <button onClick={() => void handleSave()}
            className={`${editPlateId ? 'flex-1' : 'w-48'} py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700`}>
            {editPlateId ? 'Update' : 'Daftarkan'}
          </button>
        </div>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
            <tr><th className="text-left p-4">No. Plat</th><th className="text-left p-4">Pemilik</th><th className="text-left p-4">Region Asal</th><th className="text-left p-4">Status</th><th className="text-right p-4">Aksi</th></tr>
          </thead>
          <tbody className="divide-y">
            {plateState === 'loading' ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-400 animate-pulse">Memuat...</td></tr>
            ) : plates.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-400">Belum ada plat terdaftar</td></tr>
            ) : plates.map(p => (
              <tr key={p.id} className="hover:bg-slate-50">
                <td className="p-4 font-mono font-bold tracking-wide">{p.plate}</td>
                <td className="p-4">{p.owner || <span className="text-slate-300">—</span>}</td>
                <td className="p-4">{p.origin_region_code || <span className="text-slate-300">—</span>}</td>
                <td className="p-4">
                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${statusColor(p.status)}`}>{p.status}</span>
                </td>
                <td className="p-4 text-right">
                  <button onClick={() => { setEditPlateId(p.id); setPlateForm({ plate: p.plate, owner: p.owner || '', originRegionId: p.origin_region_id || '', status: p.status }) }}
                    className="text-blue-600 font-bold text-sm mr-4">Edit</button>
                  <button onClick={() => void handleDel(p.id)} className="text-red-500 font-bold text-sm">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
