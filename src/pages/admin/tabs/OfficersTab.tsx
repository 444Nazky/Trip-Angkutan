import { useState, useEffect } from 'react'
import { Lock, Plus } from 'lucide-react'
import { fetchRegions } from '../../../services/regions'
import { fetchRoutes, fetchDermagas } from '../../../services/dermagas'
import { api } from '../../../services/api'
import { ensureAdminBackendSession } from '../../../services/auth'
import type { Officer, BackendOfficerRow, Region, RouteRow, RouteDermaga, DermagaAccess } from '../components/types'

interface OfficersTabProps {
  officers: Officer[]
  serverState: 'connecting' | 'online' | 'offline'
  onSaveOfficers: (o: Officer[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}

const HIDDEN_REGION_CODES = ['SBDZ', 'SJRE']

function mergeBackendOfficers(rows: BackendOfficerRow[], prev: Officer[]): Officer[] {
  return rows.map(b => {
    const old = prev.find(o => String(o.id) === String(b.id)) ?? prev.find(o => o.name === b.name)
    const region = b.regions?.[0]?.code ?? b.region_code ?? b.region_id
    return {
      id: String(b.id),
      name: b.name,
      initials: b.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      region,
      regions: b.regions && b.regions.length > 0 ? b.regions.map(r => r.code) : [region],
      pin: old?.pin ?? '',
      status: b.is_active ? 'Aktif' : 'Nonaktif',
      device: old?.device ?? '-',
      trips: old?.trips ?? 0,
      lastActive: old?.lastActive ?? '-',
      joined: old?.joined ?? '-',
      dermagaAccess: b.dermagas && b.dermagas.length > 0 ? b.dermagas : old?.dermagaAccess,
    }
  })
}

export function OfficersTab({ officers, serverState, onSaveOfficers, showToast }: OfficersTabProps) {
  const [regions, setRegions] = useState<Region[]>([])
  const [routeRows, setRouteRows] = useState<RouteRow[]>([])
  const [routeDermagas, setRouteDermagas] = useState<RouteDermaga[]>([])
  const [backendOfficers, setBackendOfficers] = useState<BackendOfficerRow[]>([])
  const [addOff, setAddOff] = useState(false)
  const [editOffIdx, setEditOffIdx] = useState<number | null>(null)
  const [offForm, setOffForm] = useState({ name: '', region: 'BADAU', pin: '', device: '', dermagaIds: [] as string[] })
  const [editOff, setEditOff] = useState<Officer | null>(null)
  const [editRegions, setEditRegions] = useState<string[]>([])
  const [editDermagaIds, setEditDermagaIds] = useState<string[]>([])

  useEffect(() => {
    ensureAdminBackendSession().then(ok => {
      if (!ok) return
      Promise.all([fetchRegions(), fetchRoutes(), fetchDermagas(), api.get<BackendOfficerRow[]>('/officers')])
        .then(([regs, rts, dms, offs]) => {
          if (regs) setRegions(regs)
          if (rts) setRouteRows(rts as RouteRow[])
          if (dms) setRouteDermagas(dms as RouteDermaga[])
          if (offs.ok && offs.data) {
            setBackendOfficers(offs.data)
            onSaveOfficers(mergeBackendOfficers(offs.data, officers))
          }
        })
    })
  }, [])

  const regionCodes = regions.map(r => r.code).filter(c => !HIDDEN_REGION_CODES.includes(c))
  const officerRegionCodes = (o: Officer) => (o.regions && o.regions.length > 0 ? o.regions : [o.region])
  const inRegionGroup = (o: Officer, group: string) =>
    group === 'LAINNYA'
      ? !officerRegionCodes(o).some(c => regionCodes.includes(c))
      : officerRegionCodes(o).includes(group)

  const officerGroups = [
    ...regionCodes,
    ...(officers.some(o => !officerRegionCodes(o).some(c => regionCodes.includes(c))) ? ['LAINNYA'] : []),
  ]

  const regionCodeOfDermaga = (d: RouteDermaga) => d.region_code || regions.find(r => r.id === d.region_id)?.code || ''
  const dermagaOptionsFor = (codes: string[]) => routeDermagas.filter(d => codes.includes(regionCodeOfDermaga(d)))
  const routesForOfficer = (o: Officer) => {
    const ids = new Set((o.dermagaAccess ?? []).map(d => d.id))
    return ids.size > 0 ? routeRows.filter(r => ids.has(r.dermaga_id)) : []
  }
  const toggleId = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  const findBackendOfficer = (o: { id?: string; name: string }) =>
    backendOfficers.find(b => String(b.id) === String(o.id)) ?? backendOfficers.find(b => b.name === o.name)

  const handleAddOff = async () => {
    if (!offForm.name || !offForm.pin) return showToast('Lengkapi form!', 'error')
    const region = regions.find(r => r.code === offForm.region)
    const res = await api.post<{ id: string }>('/officers', {
      name: offForm.name, pin: offForm.pin, regionId: region?.id,
      regionIds: region ? [region.id] : undefined, dermagaIds: offForm.dermagaIds.length > 0 ? offForm.dermagaIds : undefined,
    })
    if (!res.ok || !res.data) return showToast('Gagal tambah petugas', 'error')
    const offs = await api.get<BackendOfficerRow[]>('/officers')
    if (offs.ok && offs.data) { setBackendOfficers(offs.data); onSaveOfficers(mergeBackendOfficers(offs.data, officers)) }
    setOffForm({ name: '', region: 'BADAU', pin: '', device: '', dermagaIds: [] })
    setAddOff(false)
    showToast('Petugas ditambahkan')
  }

  const handleUpdOff = async () => {
    if (!editOff) return
    const chosen = editRegions.length > 0 ? editRegions : [editOff.region]
    const ids = chosen.map(c => regions.find(r => r.code === c)?.id).filter(Boolean) as string[]
    const be = findBackendOfficer(editOff)
    if (be) {
      if (ids.length > 0) await api.put(`/officers/${be.id}/regions`, { regionIds: ids })
      const validDm = new Set(dermagaOptionsFor(chosen).map(d => d.id))
      const dmIds = editDermagaIds.filter(id => validDm.has(id))
      await api.put(`/officers/${be.id}/dermagas`, { dermagaIds: dmIds })
      if (editOff.pin && editOff.pin.length === 6) await api.put(`/officers/${be.id}/pin`, { pin: editOff.pin })
      const offs = await api.get<BackendOfficerRow[]>('/officers')
      if (offs.ok && offs.data) { setBackendOfficers(offs.data); onSaveOfficers(mergeBackendOfficers(offs.data, officers)) }
    }
    setEditOffIdx(null)
    setEditOff(null)
    setEditDermagaIds([])
    showToast('Petugas diupdate')
  }

  const handleDelOff = async (i: number) => {
    if (!confirm('Hapus?')) return
    const officer = officers[i]
    const be = findBackendOfficer(officer)
    if (be) {
      const res = await api.delete(`/officers/${be.id}`)
      if (!res.ok) return showToast('Gagal hapus', 'error')
      const offs = await api.get<BackendOfficerRow[]>('/officers')
      if (offs.ok && offs.data) { setBackendOfficers(offs.data); onSaveOfficers(mergeBackendOfficers(offs.data, officers)) }
    }
    showToast('Petugas dihapus')
  }

  const toggleOffStatus = async (i: number) => {
    const officer = officers[i]
    const newStatus = officer.status === 'Aktif' ? 'Nonaktif' : 'Aktif'
    const be = findBackendOfficer(officer)
    if (be) {
      const res = await api.put(`/officers/${be.id}/status`, { isActive: newStatus === 'Aktif' })
      if (!res.ok) return showToast('Gagal sync status', 'error')
      const offs = await api.get<BackendOfficerRow[]>('/officers')
      if (offs.ok && offs.data) { setBackendOfficers(offs.data); onSaveOfficers(mergeBackendOfficers(offs.data, officers)) }
    }
    showToast(`Status diubah ke ${newStatus}`)
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setAddOff(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700">
          <Plus size={14} />Tambah Petugas
        </button>
      </div>

      {/* Form Tambah */}
      {addOff && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 max-w-lg">
          <h3 className="font-bold mb-4">Tambah Petugas</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] text-slate-500 block mb-1">Nama</label>
              <input value={offForm.name} onChange={e => setOffForm({...offForm, name: e.target.value})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div><label className="text-[11px] text-slate-500 block mb-1">Wilayah</label>
              <select value={offForm.region} onChange={e => setOffForm({...offForm, region: e.target.value, dermagaIds: []})}
                className="w-full border rounded-xl px-3 py-2 text-sm">
                {regionCodes.map(c => <option key={c} value={c}>{c}</option>)}
              </select></div>
          </div>
          <div className="mb-4">
            <label className="text-[11px] text-slate-500 block mb-1.5">Dermaga</label>
            {dermagaOptionsFor([offForm.region]).length === 0 ? (
              <p className="text-[11px] text-slate-400">Belum ada dermaga</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {dermagaOptionsFor([offForm.region]).map(d => (
                  <label key={d.id} className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                    <input type="checkbox" checked={offForm.dermagaIds.includes(d.id)}
                      onChange={() => setOffForm({ ...offForm, dermagaIds: toggleId(offForm.dermagaIds, d.id) })} />
                    {d.name} ({d.code})
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">PIN</label>
            <input type="password" maxLength={6} value={offForm.pin} onChange={e => setOffForm({...offForm, pin: e.target.value})}
              className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          <div className="flex gap-3">
            <button onClick={() => setAddOff(false)} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
            <button onClick={handleAddOff} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">Simpan</button>
          </div>
        </div>
      )}

      {/* Form Edit */}
      {editOffIdx !== null && editOff && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 max-w-lg">
          <h3 className="font-bold mb-4">Edit Petugas</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] text-slate-500 block mb-1">Nama</label>
              <input value={editOff.name} onChange={e => setEditOff({...editOff, name: e.target.value})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div><label className="text-[11px] text-slate-500 block mb-1">Wilayah</label>
              <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">
                {regionCodes.map(c => (
                  <label key={c} className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                    <input type="checkbox" checked={editRegions.includes(c)}
                      onChange={e => setEditRegions(prev => e.target.checked ? [...prev, c] : prev.filter(x => x !== c))} />
                    {c}
                  </label>
                ))}
              </div></div>
          </div>
          <div className="mb-4">
            <label className="text-[11px] text-slate-500 block mb-1.5">Dermaga</label>
            {dermagaOptionsFor(editRegions).length === 0 ? (
              <p className="text-[11px] text-slate-400">Centang wilayah dulu</p>
            ) : (
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {dermagaOptionsFor(editRegions).map(d => (
                  <label key={d.id} className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                    <input type="checkbox" checked={editDermagaIds.includes(d.id)}
                      onChange={() => setEditDermagaIds(prev => toggleId(prev, d.id))} />
                    {regionCodeOfDermaga(d)} · {d.name} ({d.code})
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">PIN Baru</label>
            <input type="password" maxLength={6} value={editOff.pin} onChange={e => setEditOff({...editOff, pin: e.target.value})}
              className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          <div className="flex gap-3">
            <button onClick={() => { setEditOffIdx(null); setEditOff(null); setEditDermagaIds([]) }}
              className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
            <button onClick={handleUpdOff} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">Update</button>
          </div>
        </div>
      )}

      {/* Tabel per grup */}
      {officerGroups.map(region => (
        <div key={region} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-6 py-3 bg-[#0F172A] text-white font-bold flex items-center gap-2">
            <Lock size={14} className="text-blue-400" />
            {region === 'LAINNYA' ? 'Lainnya' : region} ({officers.filter(o => inRegionGroup(o, region)).length} petugas)
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
              <tr><th className="text-left p-4">Nama</th><th className="text-left p-4">Dermaga</th><th className="text-left p-4">Rute</th><th className="text-left p-4">Status</th><th className="text-left p-4">Aksi</th></tr>
            </thead>
            <tbody className="divide-y">
              {officers.filter(o => inRegionGroup(o, region)).map((o, _, arr) => {
                const i = officers.indexOf(o)
                return (
                  <tr key={o.id} className="hover:bg-slate-50">
                    <td className="p-4 font-bold">{o.name}</td>
                    <td className="p-4">
                      {(o.dermagaAccess ?? []).length === 0 ? <span className="text-slate-300 text-xs">—</span> : (
                        <span className="flex flex-wrap gap-1">
                          {o.dermagaAccess!.map(d => (
                            <span key={d.id} className="px-2 py-0.5 rounded-md border border-slate-200 text-slate-500 text-[10px] font-semibold">{d.code}</span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="p-4 text-[12px] text-slate-600">
                      {routesForOfficer(o).length === 0 ? <span className="text-slate-300">—</span> : (
                        <span className="flex flex-wrap gap-1">
                          {routesForOfficer(o).map(r => (
                            <span key={r.id} className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-bold">
                              {r.name || `${r.route_from} → ${r.route_to}`}
                            </span>
                          ))}
                        </span>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${o.status === 'Aktif' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{o.status}</span>
                    </td>
                    <td className="p-4">
                      <button onClick={() => { setEditOffIdx(i); setEditOff(o); setEditRegions(o.regions && o.regions.length > 0 ? o.regions : [o.region]); setEditDermagaIds((o.dermagaAccess ?? []).map(d => d.id)) }}
                        className="text-blue-600 font-bold text-sm mr-3">Edit</button>
                      <button onClick={() => toggleOffStatus(i)}
                        className="text-amber-500 font-bold text-sm mr-3">{o.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}</button>
                      <button onClick={() => handleDelOff(i)} className="text-red-500 font-bold text-sm">Hapus</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
