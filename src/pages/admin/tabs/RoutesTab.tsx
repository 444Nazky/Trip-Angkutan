import { useState } from 'react'
import { fetchRoutes, fetchDermagas, createRoute, updateRoute, deleteRoute } from '../../../services/dermagas'
import { ensureAdminBackendSession } from '../../../services/auth'
import type { RouteRow, RouteDermaga, RouteFormState } from '../components/types'
import { emptyRouteForm } from '../components/types'

interface RoutesTabProps {
  serverState: 'connecting' | 'online' | 'offline'
  showToast: (msg: string, type: 'success' | 'error') => void
}

export function RoutesTab({ serverState, showToast }: RoutesTabProps) {
  const [routeRows, setRouteRows] = useState<RouteRow[]>([])
  const [routeDermagas, setRouteDermagas] = useState<RouteDermaga[]>([])
  const [routeState, setRouteState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [routeForm, setRouteForm] = useState<RouteFormState>(emptyRouteForm)
  const [editRouteId, setEditRouteId] = useState<string | null>(null)

  const loadRoutes = async () => {
    if (routeState !== 'idle') return
    setRouteState('loading')
    const ok = await ensureAdminBackendSession()
    if (!ok) { setRouteState('offline'); return }
    const [rts, dms] = await Promise.all([fetchRoutes(), fetchDermagas()])
    if (rts === null) { setRouteState('offline'); return }
    setRouteRows(rts as RouteRow[])
    if (dms) setRouteDermagas(dms as RouteDermaga[])
    setRouteState('ready')
  }

  if (routeState === 'idle') void loadRoutes()

  const resetForm = () => {
    setEditRouteId(null)
    setRouteForm(emptyRouteForm)
  }

  const startEdit = (r: RouteRow) => {
    setEditRouteId(r.id)
    setRouteForm({
      dermaga_id: r.dermaga_id,
      name: r.name,
      route_from: r.route_from,
      route_to: r.route_to,
      distance: r.distance ?? '',
      duration: r.duration ?? '',
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSave = async () => {
    const f = routeForm
    if (!f.name.trim() || !f.route_from.trim() || !f.route_to.trim()) return showToast('Nama, asal, tujuan wajib!', 'error')
    if (!editRouteId && !f.dermaga_id) return showToast('Pilih dermaga!', 'error')
    const payload = {
      dermaga_id: f.dermaga_id,
      name: f.name.trim(),
      route_from: f.route_from.trim().toUpperCase(),
      route_to: f.route_to.trim().toUpperCase(),
      distance: f.distance.trim() || undefined,
      duration: f.duration.trim() || undefined,
    }
    const saved = editRouteId
      ? await updateRoute(editRouteId, payload)
      : (await createRoute(payload)) !== null
    if (!saved) return showToast('Server gagal', 'error')
    showToast(editRouteId ? 'Rute diperbarui' : 'Rute ditambahkan')
    resetForm()
    const fresh = await fetchRoutes()
    if (fresh) setRouteRows(fresh as RouteRow[])
  }

  const handleDel = async (id: string) => {
    if (!confirm('Hapus rute ini?')) return
    const ok = await deleteRoute(id)
    if (!ok) return showToast('Server gagal', 'error')
    if (editRouteId === id) resetForm()
    showToast('Rute dihapus')
    const fresh = await fetchRoutes()
    if (fresh) setRouteRows(fresh as RouteRow[])
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-black text-slate-900 text-lg">Master Rute</h3>
          <p className="text-slate-500 text-[12px]">Rute per wilayah & dermaga — nama rute bisa diubah dinamis</p>
        </div>
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
          routeState === 'ready' ? 'bg-emerald-50 text-emerald-600' : routeState === 'offline' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${routeState === 'ready' ? 'bg-emerald-500' : routeState === 'offline' ? 'bg-amber-500' : 'bg-slate-400 animate-pulse'}`} />
          {routeState === 'ready' ? 'Server: Tersambung' : routeState === 'offline' ? 'Offline' : 'Memuat...'}
        </span>
      </div>

      {/* Form */}
      <div className="bg-white rounded-2xl p-6 shadow-sm max-w-4xl">
        <h3 className="font-bold mb-4">{editRouteId ? 'Edit Rute' : 'Tambah Rute Baru'}</h3>
        <div className="grid grid-cols-6 gap-4 mb-4">
          <div className="col-span-2">
            <label className="text-[11px] text-slate-500 block mb-1">Dermaga *</label>
            <select value={routeForm.dermaga_id} onChange={e => setRouteForm({ ...routeForm, dermaga_id: e.target.value })}
              disabled={!!editRouteId} className="w-full border rounded-xl px-3 py-2 text-sm disabled:bg-slate-100">
              <option value="">— Pilih dermaga —</option>
              {routeDermagas.map(d => (
                <option key={d.id} value={d.id}>{d.region_name || d.region_id} · {d.name} ({d.code})</option>
              ))}
            </select>
          </div>
          <div className="col-span-2">
            <label className="text-[11px] text-slate-500 block mb-1">Nama Rute *</label>
            <input value={routeForm.name} onChange={e => setRouteForm({ ...routeForm, name: e.target.value })}
              placeholder="Sijangkung → Sabadi" className="w-full border rounded-xl px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Asal *</label>
            <input value={routeForm.route_from} onChange={e => setRouteForm({ ...routeForm, route_from: e.target.value.toUpperCase() })}
              placeholder="SJRE" className="w-full border rounded-xl px-3 py-2 text-sm font-mono tracking-wide" />
          </div>
          <div>
            <label className="text-[11px] text-slate-500 block mb-1">Tujuan *</label>
            <input value={routeForm.route_to} onChange={e => setRouteForm({ ...routeForm, route_to: e.target.value.toUpperCase() })}
              placeholder="SBDZ" className="w-full border rounded-xl px-3 py-2 text-sm font-mono tracking-wide" />
          </div>
        </div>
        <div className="grid grid-cols-6 gap-4 mb-4">
          <div><label className="text-[11px] text-slate-500 block mb-1">Jarak</label>
            <input value={routeForm.distance} onChange={e => setRouteForm({ ...routeForm, distance: e.target.value })}
              placeholder="42 km" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          <div><label className="text-[11px] text-slate-500 block mb-1">Durasi</label>
            <input value={routeForm.duration} onChange={e => setRouteForm({ ...routeForm, duration: e.target.value })}
              placeholder="1j 10m" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
        </div>
        <div className="flex gap-3">
          {editRouteId && <button onClick={resetForm} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>}
          <button onClick={() => void handleSave()}
            className={`${editRouteId ? 'flex-1' : 'w-48'} py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700`}>
            {editRouteId ? 'Update' : 'Tambah Rute'}
          </button>
        </div>
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
            <tr>
              <th className="text-left p-4">Wilayah</th><th className="text-left p-4">Dermaga</th>
              <th className="text-left p-4">Nama Rute</th><th className="text-left p-4">Asal</th>
              <th className="text-left p-4">Tujuan</th><th className="text-left p-4">Jarak</th>
              <th className="text-left p-4">Durasi</th><th className="text-right p-4">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {routeRows.length === 0 && (
              <tr><td colSpan={8} className="p-8 text-center text-slate-400">
                {routeState === 'offline' ? 'Offline' : 'Belum ada rute'}
              </td></tr>
            )}
            {routeRows.map(r => (
              <tr key={r.id} className={editRouteId === r.id ? 'bg-blue-50' : 'hover:bg-slate-50'}>
                <td className="p-4 font-semibold text-slate-700">{r.region_name || '—'}</td>
                <td className="p-4 text-slate-500">{r.dermaga_name || '—'} <span className="text-[10px] text-slate-400">({r.dermaga_code || ''})</span></td>
                <td className="p-4 font-semibold text-slate-800">{r.name}</td>
                <td className="p-4 font-mono text-slate-600">{r.route_from}</td>
                <td className="p-4 font-mono text-slate-600">{r.route_to}</td>
                <td className="p-4 text-slate-500">{r.distance || '—'}</td>
                <td className="p-4 text-slate-500">{r.duration || '—'}</td>
                <td className="p-4 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(r)} className="text-blue-600 font-bold text-sm mr-3 hover:underline">Edit</button>
                  <button onClick={() => void handleDel(r.id)} className="text-red-500 font-bold text-sm hover:underline">Hapus</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
