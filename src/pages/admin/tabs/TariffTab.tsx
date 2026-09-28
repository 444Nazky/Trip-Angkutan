import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import type { TariffRow } from '../components/types'
import { fetchTariffs, createTariff, updateTariff, deleteTariff, fetchRegionTariffs, upsertRegionTariff, type RegionTariffRow } from '../../../services/tariffs'
import { ensureAdminBackendSession } from '../../../services/auth'

interface TariffTabProps {
  tariffs: TariffRow[]
  serverState: 'connecting' | 'online' | 'offline'
  onSaveTariffs: (t: TariffRow[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

export function TariffTab({ tariffs, serverState, onSaveTariffs, showToast }: TariffTabProps) {
  const [regionTariffs, setRegionTariffs] = useState<RegionTariffRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [addTar, setAddTar] = useState(false)
  const [editTarIdx, setEditTarIdx] = useState<number | null>(null)
  const [tarForm, setTarForm] = useState({ golongan: '', type: '', loaded: '', loadedNum: 0, empty: '', emptyNum: 0, desc: '' })
  const [editTar, setEditTar] = useState({ golongan: '', type: '', loaded: '', loadedNum: 0, empty: '', emptyNum: 0, desc: '' })

  const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

  // Load region tariffs on mount
  if (!loaded) {
    ensureAdminBackendSession().then(ok => {
      if (ok) fetchRegionTariffs().then(rt => { if (rt) setRegionTariffs(rt) })
    })
    setLoaded(true)
  }

  const handleAddTar = async () => {
    if (!tarForm.type || !tarForm.golongan) return showToast('Lengkapi form!', 'error')
    const row: TariffRow = { ...tarForm, loaded: fmtRp(tarForm.loadedNum), empty: fmtRp(tarForm.emptyNum) }
    if (serverState === 'online') {
      const id = await createTariff(row)
      if (id) row.id = id
    }
    onSaveTariffs([...tariffs, row])
    setTarForm({ golongan: '', type: '', loaded: '', loadedNum: 0, empty: '', emptyNum: 0, desc: '' })
    setAddTar(false)
    showToast('Tarif ditambahkan')
  }

  const handleUpdTar = async () => {
    const row: TariffRow = { ...editTar, loaded: fmtRp(editTar.loadedNum), empty: fmtRp(editTar.emptyNum) }
    const ns = [...tariffs]
    if (editTarIdx !== null) { ns[editTarIdx] = row; onSaveTariffs(ns) }
    if (serverState === 'online' && row.id) {
      const ok = await updateTariff(row)
      if (!ok) showToast('Server gagal', 'error')
    }
    setEditTarIdx(null)
    showToast('Tarif diupdate')
  }

  const handleDelTar = async (i: number) => {
    if (!confirm('Hapus?')) return
    const row = tariffs[i]
    const ns = tariffs.filter((_, idx) => idx !== i)
    onSaveTariffs(ns)
    if (editTarIdx === i) setEditTarIdx(null)
    else if (editTarIdx !== null && editTarIdx > i) setEditTarIdx(editTarIdx - 1)
    if (serverState === 'online' && row?.id) await deleteTariff(row)
    showToast('Tarif dihapus')
  }

  const handleSaveRegionTariff = async (rt: RegionTariffRow) => {
    const [a, b] = await Promise.all([
      upsertRegionTariff({ regionId: rt.id, tariffType: 'lokal', nominalTariff: rt.lokal_tariff ?? 0, isActive: !!rt.lokal_active }),
      upsertRegionTariff({ regionId: rt.id, tariffType: 'eksternal', nominalTariff: rt.eksternal_tariff ?? 0, isActive: !!rt.eksternal_active }),
    ])
    if (!a || !b) return showToast('Server gagal', 'error')
    const fresh = await fetchRegionTariffs()
    if (fresh) setRegionTariffs(fresh)
    showToast(`Tarif region ${rt.code} diupdate`)
  }

  return (
    <div className="space-y-4">
      {/* Status + Tambah */}
      <div className="flex items-center justify-between">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
          serverState === 'online' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${serverState === 'online' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          Server: {serverState === 'online' ? 'Tersambung' : 'Offline'}
        </span>
        <button onClick={() => setAddTar(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700">
          <Plus size={14} />Tambah Golongan
        </button>
      </div>

      {/* Form Tambah */}
      {addTar && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-lg">
          <h3 className="font-bold mb-4">Tambah Golongan</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] text-slate-500 block mb-1">Golongan</label>
              <input value={tarForm.golongan} onChange={e => setTarForm({...tarForm, golongan: e.target.value})}
                placeholder="I, II, III" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div><label className="text-[11px] text-slate-500 block mb-1">Jenis</label>
              <input value={tarForm.type} onChange={e => setTarForm({...tarForm, type: e.target.value})}
                placeholder="Truck Besar" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          </div>
          <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">Deskripsi</label>
            <input value={tarForm.desc} onChange={e => setTarForm({...tarForm, desc: e.target.value})}
              className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] text-slate-500 block mb-1">Muatan (Rp)</label>
              <input type="number" value={tarForm.loadedNum || ''} onChange={e => setTarForm({...tarForm, loadedNum: parseInt(e.target.value) || 0})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div><label className="text-[11px] text-slate-500 block mb-1">Kosong (Rp)</label>
              <input type="number" value={tarForm.emptyNum || ''} onChange={e => setTarForm({...tarForm, emptyNum: parseInt(e.target.value) || 0})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setAddTar(false)} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
            <button onClick={handleAddTar} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">Simpan</button>
          </div>
        </div>
      )}

      {/* Form Edit */}
      {editTarIdx !== null && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-lg">
          <h3 className="font-bold mb-4">Edit Golongan</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] text-slate-500 block mb-1">Golongan</label>
              <input value={editTar.golongan} onChange={e => setEditTar({...editTar, golongan: e.target.value})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div><label className="text-[11px] text-slate-500 block mb-1">Jenis</label>
              <input value={editTar.type} onChange={e => setEditTar({...editTar, type: e.target.value})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          </div>
          <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">Deskripsi</label>
            <input value={editTar.desc} onChange={e => setEditTar({...editTar, desc: e.target.value})}
              className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] text-slate-500 block mb-1">Muatan</label>
              <input type="number" value={editTar.loadedNum || ''} onChange={e => setEditTar({...editTar, loadedNum: parseInt(e.target.value) || 0})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div><label className="text-[11px] text-slate-500 block mb-1">Kosong</label>
              <input type="number" value={editTar.emptyNum || ''} onChange={e => setEditTar({...editTar, emptyNum: parseInt(e.target.value) || 0})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          </div>
          <div className="flex gap-3">
            <button onClick={() => setEditTarIdx(null)} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
            <button onClick={handleUpdTar} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">Update</button>
          </div>
        </div>
      )}

      {/* Tabel Master Golongan */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
            <tr><th className="text-left p-4">Gol</th><th className="text-left p-4">Jenis</th><th className="text-left p-4">Muatan</th><th className="text-left p-4">Kosong</th><th className="text-left p-4">Aksi</th></tr>
          </thead>
          <tbody className="divide-y">
            {tariffs.map((t, i) => (
              <tr key={`${t.golongan}-${i}`} className="hover:bg-slate-50">
                <td className="p-4 font-mono font-bold">{t.golongan}</td>
                <td className="p-4 font-bold">{t.type}</td>
                <td className="p-4 text-blue-700 font-bold">{t.loaded}</td>
                <td className="p-4 text-slate-500">{t.empty}</td>
                <td className="p-4">
                  <button onClick={() => { setEditTarIdx(i); setEditTar(t) }} className="text-blue-600 font-bold text-sm mr-4">Edit</button>
                  <button onClick={() => handleDelTar(i)} className="text-red-500 font-bold text-sm">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Konfigurasi Tarif Region */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100">
          <p className="font-bold text-slate-800">Konfigurasi Tarif Terpusat (Penarifan Plat)</p>
          <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
            <p><b className="text-slate-700">Internal</b> = <b>selalu Rp 0</b> (dikunci, tidak dapat diubah).</p>
            <p><b className="text-slate-700">Lokal</b> = tarif cadangan kebijakan — <b>bisa diubah</b> per region dan dapat diaktifkan/nonaktifkan.</p>
            <p><b className="text-slate-700">Eksternal</b> = tarif region pos pemeriksaan (menyesuaikan region).</p>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
            <tr>
              <th className="text-left p-4">Region</th>
              <th className="text-left p-4">Internal</th>
              <th className="text-left p-4">Lokal (Rp)</th>
              <th className="text-left p-4">Eksternal (Rp)</th>
              <th className="text-right p-4">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            <tr className="bg-slate-50/60">
              <td className="p-4 font-bold text-slate-600">Semua region</td>
              <td className="p-4"><span className="inline-flex items-center gap-1.5 bg-slate-800 text-white text-[11px] font-black px-2.5 py-1 rounded-full">Rp 0 · Dikunci</span></td>
              <td className="p-4 text-[11px] text-slate-400" colSpan={2}>Plat internal tidak dikenakan tarif</td>
              <td className="p-4 text-right text-[11px] text-slate-300">—</td>
            </tr>
            {regionTariffs.map((rt, i) => (
              <tr key={rt.id} className="hover:bg-slate-50">
                <td className="p-4 font-bold">{rt.name} <span className="text-slate-400 font-mono text-[11px] font-normal">{rt.code}</span></td>
                <td className="p-4"><span className="bg-slate-100 text-slate-500 text-[11px] font-bold px-2.5 py-1 rounded-full">Rp 0 (dikunci)</span></td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} value={rt.lokal_tariff ?? 0}
                      onChange={e => { const v = [...regionTariffs]; v[i] = { ...rt, lokal_tariff: parseInt(e.target.value) || 0 }; setRegionTariffs(v) }}
                      className="w-28 border rounded-lg px-2 py-1.5 text-[13px]" />
                    <label className="flex items-center gap-1 text-[11px] text-slate-500 font-semibold">
                      <input type="checkbox" checked={!!rt.lokal_active}
                        onChange={e => { const v = [...regionTariffs]; v[i] = { ...rt, lokal_active: e.target.checked ? 1 : 0 }; setRegionTariffs(v) }} />Aktif
                    </label>
                  </div>
                </td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <input type="number" min={0} value={rt.eksternal_tariff ?? 0}
                      onChange={e => { const v = [...regionTariffs]; v[i] = { ...rt, eksternal_tariff: parseInt(e.target.value) || 0 }; setRegionTariffs(v) }}
                      className="w-28 border rounded-lg px-2 py-1.5 text-[13px]" />
                    <label className="flex items-center gap-1 text-[11px] text-slate-500 font-semibold">
                      <input type="checkbox" checked={!!rt.eksternal_active}
                        onChange={e => { const v = [...regionTariffs]; v[i] = { ...rt, eksternal_active: e.target.checked ? 1 : 0 }; setRegionTariffs(v) }} />Aktif
                    </label>
                  </div>
                </td>
                <td className="p-4 text-right">
                  <button onClick={() => void handleSaveRegionTariff(rt)} className="text-blue-600 font-bold text-sm">Simpan</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
