import { useState, useEffect } from 'react'
import { fetchPlates, createPlate, updatePlate, deletePlate, type PlateRecord, type PlateStatus } from '../../../services/plates'
import { fetchRegions, type Region } from '../../../services/regions'
import {
  BADGE,
  BADGE_MUTED,
  BADGE_OK,
  BADGE_WARN,
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
  DOT_MUTED,
  DOT_OK,
  DOT_WARN,
  INPUT,
  LABEL,
  PAGE,
  SECTION_TITLE,
  TABLE_CELL,
  TABLE_HEAD_CELL,
  TABLE_HEAD_ROW,
  TABLE_WRAP,
} from '../theme'
import { PageHeader } from '../components/PageHeader'




interface PlatesTabProps {
  plates: PlateRecord[]
  onPlatesChange: (p: PlateRecord[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}



export function PlatesTab({ plates, onPlatesChange, showToast }: PlatesTabProps) {
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
    // `onPlatesChange` identik dengan setter state parent (stabil), jadi
    // menambahkannya tidak memicu fetch ulang; guard `plateState` tetap penentu.
  }, [plateState, onPlatesChange])

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
    <div className={PAGE}>

      <PageHeader
        title="Master Plat"
        subtitle={<>Plat <b>internal</b> tidak dikenakan tarif saat discan</>}
        actions={
          <span className={`${BADGE} ${
            plateState === 'ready' ? BADGE_OK : plateState === 'offline' ? BADGE_WARN : BADGE_MUTED
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${plateState === 'ready' ? DOT_OK : plateState === 'offline' ? DOT_WARN : DOT_MUTED}`} />
            {plateState === 'ready' ? 'Server: Tersambung' : plateState === 'offline' ? 'Offline' : 'Memuat...'}
          </span>
        }
      />

      <div className={`${CARD} max-w-3xl p-6`}>
        <h3 className={`${SECTION_TITLE} mb-4`}>{editPlateId ? 'Edit Plat' : 'Daftar Plat Baru'}</h3>
        <div className="grid grid-cols-4 gap-4 mb-4">
          <div><label className={`${LABEL} mb-1 block`}>No. Plat *</label>
            <input value={plateForm.plate} onChange={e => setPlateForm({...plateForm, plate: e.target.value.toUpperCase()})}
              placeholder="B 1234 XY" className={`${INPUT} font-mono tracking-wide`} /></div>
          <div><label className={`${LABEL} mb-1 block`}>Pemilik (opsional)</label>
            <input value={plateForm.owner} onChange={e => setPlateForm({...plateForm, owner: e.target.value})}
              placeholder="Nama pemilik" className={INPUT} /></div>
          <div><label className={`${LABEL} mb-1 block`}>Region Asal</label>
            <select value={plateForm.originRegionId} onChange={e => setPlateForm({...plateForm, originRegionId: e.target.value})}
              className={INPUT}>
              <option value="">—</option>
              {regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
            </select></div>
          <div><label className={`${LABEL} mb-1 block`}>Status</label>
            <select value={plateForm.status} onChange={e => setPlateForm({...plateForm, status: e.target.value as PlateStatus})}
              className={INPUT}>
              <option value="internal">internal</option>
              <option value="lokal">lokal</option>
              <option value="eksternal">eksternal</option>
            </select></div>
        </div>
        <div className="flex gap-3">
          {editPlateId && <button onClick={resetForm} className={`${BTN_SECONDARY} flex-1`}>Batal</button>}
          <button onClick={() => void handleSave()}
            className={`${BTN_PRIMARY} ${editPlateId ? 'flex-1' : 'w-48'}`}>
            {editPlateId ? 'Update' : 'Daftarkan'}
          </button>
        </div>
      </div>

      <div className={TABLE_WRAP}>
        <table className="w-full">
          <thead className={TABLE_HEAD_ROW}>
            <tr><th className={`${TABLE_HEAD_CELL} text-left`}>No. Plat</th><th className={`${TABLE_HEAD_CELL} text-left`}>Pemilik</th><th className={`${TABLE_HEAD_CELL} text-left`}>Region Asal</th><th className={`${TABLE_HEAD_CELL} text-left`}>Status</th><th className={`${TABLE_HEAD_CELL} text-right`}>Aksi</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {plateState === 'loading' ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-400 animate-pulse">Memuat...</td></tr>
            ) : plates.length === 0 ? (
              <tr><td colSpan={5} className="p-6 text-center text-slate-400">Belum ada plat terdaftar</td></tr>
            ) : plates.map(p => (
              <tr key={p.id} className="admin-table-row hover:bg-slate-50/60">
                <td className={`${TABLE_CELL} font-mono font-bold tracking-wide`}>{p.plate}</td>
                <td className={TABLE_CELL}>{p.owner || <span className="text-slate-300">—</span>}</td>
                <td className={TABLE_CELL}>{p.origin_region_code || <span className="text-slate-300">—</span>}</td>
                <td className={TABLE_CELL}>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${statusColor(p.status)}`}>{p.status}</span>
                </td>
                <td className={`${TABLE_CELL} text-right`}>
                  <button onClick={() => { setEditPlateId(p.id); setPlateForm({ plate: p.plate, owner: p.owner || '', originRegionId: p.origin_region_id || '', status: p.status }) }}
                    className="mr-4 text-[12px] font-bold text-blue-600 hover:text-blue-700">Edit</button>
                  <button onClick={() => void handleDel(p.id)} className="text-[12px] font-bold text-red-500 hover:text-red-600">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
