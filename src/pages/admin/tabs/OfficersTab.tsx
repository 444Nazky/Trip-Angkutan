import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD,
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
import { useState, useEffect, useRef } from 'react'
import { Lock, Plus, MoreVertical, Pencil, UserX, Trash2 } from 'lucide-react'
import { fetchRegions, type Region } from '../../../services/regions'
import { fetchRoutes, fetchDermagas } from '../../../services/dermagas'
import { api } from '../../../services/api'
import type { Officer, BackendOfficerRow, RouteRow, RouteDermaga } from '../components/types'




interface OfficersTabProps {
  officers: Officer[]
  onSaveOfficers: (o: Officer[]) => void
  showToast: (msg: string, type?: 'success' | 'error') => void
}



const HIDDEN_REGION_CODES = ['SBDZ', 'SJRE']



function mergeBackendOfficers(rows: BackendOfficerRow[], prev: Officer[]): Officer[] {
  return rows.map(b => {
    const old = prev.find(o => String(o.id) === String(b.id)) ?? prev.find(o => o.name === b.name)
    const region = b.regions?.[0]?.code ?? b.region_code ?? b.region_id
    const regions = b.regions && b.regions.length > 0 ? b.regions.map(r => r.code) : [region]
    const dermagaAccess = b.dermagas && b.dermagas.length > 0
      ? b.dermagas
      : old?.dermagaAccess && old.dermagaAccess.length > 0
        ? old.dermagaAccess
        : [{ id: '', name: '', code: 'D1' }]
    return {
      id: String(b.id),
      name: b.name,
      username: b.username || b.name?.toLowerCase().replace(/\s+/g, '') || b.id,
      initials: b.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
      region,
      regions,
      pin: old?.pin ?? '',
      status: b.is_active ? 'Aktif' : 'Nonaktif',
      device: old?.device ?? '-',
      trips: old?.trips ?? 0,
      lastActive: old?.lastActive ?? '-',
      joined: old?.joined ?? '-',
      dermagaAccess,
    }
  })
}



function ActionMenu({ onEdit, onToggle, onDelete, isActive }: { onEdit: () => void; onToggle: () => void; onDelete: () => void; isActive: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
        className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500">
        <MoreVertical size={16} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-50 min-w-[140px]">
          <button onClick={() => { onEdit(); setOpen(false) }}
            className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-slate-700">
            <Pencil size={14} /> Edit
          </button>
          <button onClick={() => { onToggle(); setOpen(false) }}
            className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-slate-50 text-amber-600">
            <UserX size={14} /> {isActive ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
          <button onClick={() => { onDelete(); setOpen(false) }}
            className="w-full px-4 py-2 text-left text-sm flex items-center gap-2 hover:bg-red-50 text-red-500">
            <Trash2 size={14} /> Hapus
          </button>
        </div>
      )}
    </div>
  )
}



export function OfficersTab({ officers, onSaveOfficers, showToast }: OfficersTabProps) {
  const [localOfficers, setLocalOfficers] = useState<Officer[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [routeRows, setRouteRows] = useState<RouteRow[]>([])
  const [routeDermagas, setRouteDermagas] = useState<RouteDermaga[]>([])
  const [backendOfficers, setBackendOfficers] = useState<BackendOfficerRow[]>([])
  const [loading, setLoading] = useState(true)
  const [addOff, setAddOff] = useState(false)
  const [editOffIdx, setEditOffIdx] = useState<number | null>(null)
  const [offForm, setOffForm] = useState({ name: '', region: 'BADAU', pin: '', device: '', dermagaIds: [] as string[] })
  const [editOff, setEditOff] = useState<Officer | null>(null)
  const [editRegions, setEditRegions] = useState<string[]>([])
  const [editDermagaIds, setEditDermagaIds] = useState<string[]>([])

  // Fetch ini sengaja hanya sekali saat mount: menambahkan `officers` ke
  // dependency array akan memicu siklus fetch -> onSaveOfficers -> parent
  // berubah -> fetch lagi. Nilai terbaru dibaca lewat ref.
  const officersRef = useRef(officers)
  useEffect(() => { officersRef.current = officers })

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
        fetchRegions(),
        fetchRoutes(),
        fetchDermagas(),
        api.getOk<BackendOfficerRow[]>('/officers'),
      ]).then(([regs, rts, dms, offs]) => {
        if (!alive) return
        if (regs) setRegions(regs)
        if (rts) setRouteRows(rts as RouteRow[])
        if (dms) setRouteDermagas(dms as RouteDermaga[])
        if (offs) {
          setBackendOfficers(offs)
          const merged = mergeBackendOfficers(offs, officersRef.current)
          setLocalOfficers(merged)
          onSaveOfficers(merged)
        }
        setLoading(false)
      })
    return () => { alive = false }
  }, [onSaveOfficers])

  const regionCodes = regions.map(r => r.code).filter(c => !HIDDEN_REGION_CODES.includes(c))
  const officerRegionCodes = (o: Officer) =>
    (o.regions && o.regions.length > 0 ? o.regions : [o.region])
  const inRegionGroup = (o: Officer, group: string) =>
    group === 'LAINNYA'
      ? !officerRegionCodes(o).some(c => regionCodes.includes(c))
      : officerRegionCodes(o).includes(group)

  const officerGroups = [
    ...regionCodes,
    ...(localOfficers.some(o => !officerRegionCodes(o).some(c => regionCodes.includes(c))) ? ['LAINNYA'] : []),
  ]

  const regionCodeOfDermaga = (d: RouteDermaga) => d.region_code || regions.find(r => r.id === d.region_id)?.code || ''
  const dermagaOptionsFor = (codes: string[]) => routeDermagas.filter(d => codes.includes(regionCodeOfDermaga(d)))
  const routesForOfficer = (o: Officer) => {
    const ids = new Set((o.dermagaAccess ?? []).map(d => d.id))
    return ids.size > 0 ? routeRows.filter(r => ids.has(r.dermaga_id)) : []
  }

  /**
   * Format routes for display - shows route_from -> route_to for each route
   * Groups by dermaga for officers with dual access (2 dermagas)
   */
  const formatOfficerRoutes = (o: Officer): string => {
    const routes = routesForOfficer(o)
    if (routes.length === 0) return '—'

    // Group routes by dermaga
    const byDermaga = new Map<string, typeof routes>()
    for (const r of routes) {
      const dermagaId = r.dermaga_id
      if (!byDermaga.has(dermagaId)) byDermaga.set(dermagaId, [])
      byDermaga.get(dermagaId)!.push(r)
    }

    // Format: DERMAGA · ROUTE: ASAL -> TUJUAN | ASAL -> TUJUAN
    const parts: string[] = []
    for (const [dermagaId, dermagaRoutes] of byDermaga) {
      const dermaga = routeDermagas.find(d => d.id === dermagaId)
      const dermagaLabel = dermaga ? `${dermaga.region_name || dermaga.code} ${dermaga.code}` : ''
      const routeLabels = dermagaRoutes.map(r => `${r.route_from} → ${r.route_to}`).join(' | ')
      parts.push(`${dermagaLabel ? dermagaLabel + ' · ' : ''}RUTE = ${routeLabels}`)
    }
    return parts.join(' | ')
  }

  const toggleId = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list, id]
  const findBackendOfficer = (o: { id?: string; name: string }) =>
    backendOfficers.find(b => String(b.id) === String(o.id)) ?? backendOfficers.find(b => b.name === o.name)

  const reloadAndSync = (offs: BackendOfficerRow[] | null) => {
    if (offs) {
      const merged = mergeBackendOfficers(offs, officers)
      setBackendOfficers(offs)
      setLocalOfficers(merged)
      onSaveOfficers(merged)
    }
  }

  const handleAddOff = async () => {
    if (!offForm.name || !offForm.pin) return showToast('Lengkapi form!', 'error')
    if (offForm.pin.length < 4) return showToast('PIN minimal 4 digit!', 'error')
    const region = regions.find(r => r.code === offForm.region)
    // ponytail: username dikirim eksplisit — rumus SAMA dengan fallback tampilan
    // (nama lowercase tanpa spasi) dan derivasi backend, jadi @ di tabel = login.
    const username = offForm.name.trim().toLowerCase().replace(/\s+/g, '')
    const res = await api.post<{ id: string }>('/officers', {
      name: offForm.name.trim(), username, pin: offForm.pin, regionId: region?.id,
      regionIds: region ? [region.id] : undefined,
      dermagaIds: offForm.dermagaIds.length > 0 ? offForm.dermagaIds : undefined,
    })
    if (!res.ok || !res.data) return showToast('Gagal tambah petugas', 'error')
    await reloadAndSync(await api.getOk<BackendOfficerRow[]>('/officers'))
    setOffForm({ name: '', region: 'BADAU', pin: '', device: '', dermagaIds: [] })
    setAddOff(false)
    showToast('Petugas ditambahkan')
  }

  const handleUpdOff = async () => {
    if (!editOff) return
    const chosen = editRegions.length > 0 ? editRegions : [editOff.region]
    const ids = chosen.map(c => regions.find(r => r.code === c)?.id).filter(Boolean) as string[]
    const be = findBackendOfficer(editOff)
    if (!be) {
      showToast('Petugas ini belum ada di server — tidak bisa diperbarui', 'error')
      return
    }

    // SEMUA panggilan harus dicek. Versi lama mengabaikan hasilnya lalu
    // selalu menampilkan "Petugas diupdate" - padahal server bisa saja
    // menolak (403/500) dan akses dermaga tidak berubah sama sekali.
    if (ids.length > 0) {
      const res = await api.put(`/officers/${be.id}/regions`, { regionIds: ids })
      if (!res.ok) return showToast(res.error?.message ?? 'Gagal menyimpan wilayah', 'error')
    }
    const validDm = new Set(dermagaOptionsFor(chosen).map(d => d.id))
    const dmIds = editDermagaIds.filter(id => validDm.has(id))
    const dmRes = await api.put(`/officers/${be.id}/dermagas`, { dermagaIds: dmIds })
    if (!dmRes.ok) return showToast(dmRes.error?.message ?? 'Gagal menyimpan akses dermaga', 'error')

    // ponytail: ambang PIN disamakan dengan create (≥4). Dulu hanya ==6 yang
    // dikirim sehingga PIN 4-5 digit "terupdate" di UI tapi tidak di DB.
    if (editOff.pin && editOff.pin.length >= 4) {
      const pinRes = await api.put(`/officers/${be.id}/pin`, { pin: editOff.pin })
      if (!pinRes.ok) return showToast(pinRes.error?.message ?? 'Gagal menyimpan PIN', 'error')
    }

    await reloadAndSync(await api.getOk<BackendOfficerRow[]>('/officers'))
    setEditOffIdx(null)
    setEditOff(null)
    setEditDermagaIds([])
    showToast('Petugas diupdate')
  }

  const handleDelOff = async (localIdx: number) => {
    if (!confirm('Hapus?')) return
    const officer = localOfficers[localIdx]
    const be = findBackendOfficer(officer)
    if (be) {
      const res = await api.delete(`/officers/${be.id}`)
      if (!res.ok) return showToast('Gagal hapus', 'error')
      await reloadAndSync(await api.getOk<BackendOfficerRow[]>('/officers'))
    }
    showToast('Petugas dihapus')
  }

  const toggleOffStatus = async (localIdx: number) => {
    const officer = localOfficers[localIdx]
    const newStatus = officer.status === 'Aktif' ? 'Nonaktif' : 'Aktif'
    const be = findBackendOfficer(officer)
    if (be) {
      const res = await api.put(`/officers/${be.id}/status`, { isActive: newStatus === 'Aktif' })
      if (!res.ok) return showToast('Gagal sync status', 'error')
      await reloadAndSync(await api.getOk<BackendOfficerRow[]>('/officers'))
    }
    showToast(`Status diubah ke ${newStatus}`)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-slate-300 border-t-blue-500 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-slate-400 text-sm">Memuat data petugas...</p>
        </div>
      </div>
    )
  }

  return (
    <div className={PAGE}>
      <PageHeader
        title="Petugas"
        subtitle="Kelola petugas lapangan, wilayah, dan akses dermaga"
        actions={
          <button onClick={() => setAddOff(true)} className={BTN_PRIMARY}>
            <Plus size={14} />Tambah Petugas
          </button>
        }
      />

      {addOff && (
        <div className={`${CARD} max-w-lg p-6`}>
          <h3 className={`${SECTION_TITLE} mb-4`}>Tambah Petugas</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className={`${LABEL} mb-1 block`}>Nama</label>
              <input value={offForm.name} onChange={e => setOffForm({...offForm, name: e.target.value})}
                className={INPUT} /></div>
            <div><label className={`${LABEL} mb-1 block`}>Wilayah</label>
              <select value={offForm.region} onChange={e => setOffForm({...offForm, region: e.target.value, dermagaIds: []})}
                className={INPUT}>
                {regionCodes.map(c => <option key={c} value={c}>{c}</option>)}
              </select></div>
          </div>

          <div className="mb-4">
            <label className={`${LABEL} mb-1.5 block`}>Dermaga</label>
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
            )}''

          </div>
          <div className="mb-4"><label className={`${LABEL} mb-1 block`}>PIN</label>
            <input type="password" maxLength={6} value={offForm.pin} onChange={e => setOffForm({...offForm, pin: e.target.value})}
              className={INPUT} /></div>
          <div className="flex gap-3">
            <button onClick={() => setAddOff(false)} className={`${BTN_SECONDARY} flex-1 py-3`}>Batal</button>
            <button onClick={handleAddOff} className={`${BTN_PRIMARY} flex-1 py-3`}>Simpan</button>
          </div>
        </div>
      )}

      {editOffIdx !== null && editOff && (
        <div className={`${CARD} max-w-lg p-6`}>
          <h3 className={`${SECTION_TITLE} mb-4`}>Edit Petugas</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className={`${LABEL} mb-1 block`}>Nama</label>
              <input value={editOff.name} onChange={e => setEditOff({...editOff, name: e.target.value})}
                className={INPUT} /></div>
            <div><label className={`${LABEL} mb-1 block`}>Wilayah</label>
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
            <label className={`${LABEL} mb-1.5 block`}>Dermaga</label>
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
          <div className="mb-4"><label className={`${LABEL} mb-1 block`}>PIN Baru</label>
            <input type="password" maxLength={6} value={editOff.pin ?? ''} onChange={e => setEditOff({...editOff, pin: e.target.value})}
              className={INPUT} /></div>
          <div className="flex gap-3">
            <button onClick={() => { setEditOffIdx(null); setEditOff(null); setEditDermagaIds([]) }}
              className={`${BTN_SECONDARY} flex-1 py-3`}>Batal</button>
            <button onClick={handleUpdOff} className={`${BTN_PRIMARY} flex-1 py-3`}>Update</button>
          </div>
        </div>
      )}

      {localOfficers.length === 0 && !loading && (
        <div className={`${CARD} p-8 text-center`}>
          <p className="text-slate-500 font-semibold mb-1">Belum ada petugas</p>
          <p className="text-slate-400 text-sm">Klik "Tambah Petugas" untuk menambahkan petugas pertama</p>
        </div>
      )}

      {officerGroups.map(region => {
        const groupOfficers = localOfficers.filter(o => inRegionGroup(o, region))
        if (groupOfficers.length === 0) return null
        return (
          <div key={region} className={`${TABLE_WRAP} admin-card stagger-item`}>
            <div className="flex items-center gap-2 bg-slate-100 px-4 py-2.5 text-[12px] font-bold uppercase tracking-wide text-slate-600">
              <Lock size={13} className="text-slate-400" />
              {region === 'LAINNYA' ? 'Lainnya' : region} ({groupOfficers.length} petugas)
            </div>
            <table className="w-full">
              <thead className={TABLE_HEAD_ROW}>
                <tr><th className={`${TABLE_HEAD_CELL} text-left`}>Nama</th><th className={`${TABLE_HEAD_CELL} text-left`}>Dermaga</th><th className={`${TABLE_HEAD_CELL} text-left`}>Rute</th><th className={`${TABLE_HEAD_CELL} text-left`}>Status</th><th className={`${TABLE_HEAD_CELL} text-left`}>Aksi</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupOfficers.map((o) => {
                  const localIdx = localOfficers.indexOf(o)
                  return (
                    <tr key={o.id} className="admin-table-row hover:bg-slate-50/60">
                      <td className={TABLE_CELL}><p className="text-[12.5px] font-bold text-slate-800">{o.name}</p><p className="text-[11px] text-slate-400">@{o.username}</p></td>
                      <td className={TABLE_CELL}>
                        {(o.dermagaAccess ?? []).length === 0 || !o.dermagaAccess?.[0]?.id
                          ? <span className="text-slate-300 text-xs">—</span>
                          : <span className="flex flex-wrap gap-1">
                            {o.dermagaAccess!.map(d => (
                              <span key={d.id} className="px-2 py-0.5 rounded-md border border-slate-200 text-slate-500 text-[10px] font-semibold">{d.code}</span>
                            ))}
                          </span>
                        }

                      </td>
                      <td className={`${TABLE_CELL} max-w-xs text-[11px] text-slate-600`}>
                        <span className="line-clamp-2" title={formatOfficerRoutes(o)}>
                          {formatOfficerRoutes(o)}
                        </span>
                      </td>
                      <td className={TABLE_CELL}>
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${o.status === 'Aktif' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{o.status}</span>
                      </td>
                      <td className={TABLE_CELL}>
                        <ActionMenu
                          onEdit={() => { setEditOffIdx(localIdx); setEditOff(o); setEditRegions(o.regions && o.regions.length > 0 ? o.regions : [o.region]); setEditDermagaIds((o.dermagaAccess ?? []).filter(d => d.id).map(d => d.id)) }}
                          onToggle={() => toggleOffStatus(localIdx)}
                          isActive={o.status === 'Aktif'}
                          onDelete={() => handleDelOff(localIdx)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )
      })}
    </div>
  )
}
