import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Lock, Plus, MoreVertical, Pencil, UserX, Trash2 } from 'lucide-react'
import { fetchRegions, type Region } from '../../../services/regions'
import { fetchRoutes, fetchDermagas } from '../../../services/dermagas'
import { api, failureReason } from '../../../services/api'
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
    const region = b.regions?.[0]?.name ?? b.region_code ?? b.region_id
    const regions = b.regions && b.regions.length > 0 ? b.regions.map(r => r.name) : [region]
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



/**
 * Menu aksi petugas.
 *
 * Menu dirender lewat portal ke `document.body` dengan posisi fixed: kalau
 * dirender di dalam sel tabel, container grup wilayah memakai
 * `overflow-hidden` sehingga menu ikut terpotong.
 */
const MENU_WIDTH = 160
const MENU_HEIGHT = 132

function ActionMenu({ onEdit, onToggle, onDelete, isActive }: { onEdit: () => void; onToggle: () => void; onDelete: () => void; isActive: boolean }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', handleClick)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (open) return setOpen(false)
    const r = btnRef.current?.getBoundingClientRect()
    if (!r) return
    const left = Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8)
    const top = r.bottom + MENU_HEIGHT + 8 > window.innerHeight
      ? Math.max(8, r.top - MENU_HEIGHT - 4)
      : r.bottom + 4
    setPos({ top, left })
    setOpen(true)
  }

  return (
    <>
      <button ref={btnRef} onClick={toggle}
        className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500">
        <MoreVertical size={16} />
      </button>
      {open && createPortal(
        <div ref={menuRef} style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
          className="fixed z-[1000] bg-white rounded-xl shadow-lg border border-slate-200 py-1 min-w-[140px]">
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
        </div>,
        document.body,
      )}
    </>
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
  const [offForm, setOffForm] = useState({ name: '', region: '', pin: '', device: '', dermagaIds: [] as string[] })
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

  const regionNames = [...new Set(regions.filter(r => !HIDDEN_REGION_CODES.includes(r.code)).map(r => r.name))]
  const officerRegions = (o: Officer) =>
    (o.regions && o.regions.length > 0 ? o.regions : [o.region])
  const inRegionGroup = (o: Officer, group: string) =>
    group === 'LAINNYA'
      ? !officerRegions(o).some(n => regionNames.includes(n))
      : officerRegions(o).includes(group)

  const officerGroups = [
    ...regionNames,
    ...(localOfficers.some(o => !officerRegions(o).some(n => regionNames.includes(n))) ? ['LAINNYA'] : []),
  ]

  const regionNameOfDermaga = (d: RouteDermaga) => d.region_name || regions.find(r => r.id === d.region_id)?.name || ''
  const dermagaOptionsFor = (names: string[]) => routeDermagas.filter(d => names.includes(regionNameOfDermaga(d)))
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
      const dermagaLabel = dermaga ? dermaga.region_name || dermaga.code : ''
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
    const region = regions.find(r => r.name === offForm.region)
    if (!region) return showToast('Pilih wilayah', 'error')
    // ponytail: username dikirim eksplisit — rumus SAMA dengan fallback tampilan
    // (nama lowercase tanpa spasi) dan derivasi backend, jadi @ di tabel = login.
    const username = offForm.name.trim().toLowerCase().replace(/\s+/g, '')
    const res = await api.post<{ id: string }>('/officers', {
      name: offForm.name.trim(), username, pin: offForm.pin, regionId: region?.id,
      regionIds: region ? [region.id] : undefined,
      dermagaIds: offForm.dermagaIds.length > 0 ? offForm.dermagaIds : undefined,
    })
    if (!res.ok || !res.data) {
      return showToast(
        res.ok
          ? 'Petugas gagal ditambahkan karena server tidak mengembalikan data petugas'
          : failureReason(res, 'Petugas gagal ditambahkan karena server menolak permintaan'),
        'error',
      )
    }
    await reloadAndSync(await api.getOk<BackendOfficerRow[]>('/officers'))
    setOffForm({ name: '', region: '', pin: '', device: '', dermagaIds: [] })
    setAddOff(false)
    showToast('Petugas ditambahkan')
  }

  const handleUpdOff = async () => {
    if (!editOff) return
    const chosen = editRegions.length > 0 ? editRegions : [editOff.region]
    const ids = chosen.map(n => regions.find(r => r.name === n)?.id).filter(Boolean) as string[]
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
      if (!res.ok) return showToast(failureReason(res, 'Wilayah petugas gagal disimpan karena server menolak permintaan'), 'error')
    }
    const validDm = new Set(dermagaOptionsFor(chosen).map(d => d.id))
    const dmIds = editDermagaIds.filter(id => validDm.has(id))
    const dmRes = await api.put(`/officers/${be.id}/dermagas`, { dermagaIds: dmIds })
    if (!dmRes.ok) return showToast(failureReason(dmRes, 'Akses dermaga gagal disimpan karena server menolak permintaan'), 'error')

    // ponytail: ambang PIN disamakan dengan create (≥4). Dulu hanya ==6 yang
    // dikirim sehingga PIN 4-5 digit "terupdate" di UI tapi tidak di DB.
    if (editOff.pin && editOff.pin.length >= 4) {
      const pinRes = await api.put(`/officers/${be.id}/pin`, { pin: editOff.pin })
      if (!pinRes.ok) return showToast(failureReason(pinRes, 'PIN gagal disimpan karena server menolak permintaan'), 'error')
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
      if (!res.ok) return showToast(failureReason(res, 'Petugas gagal dihapus karena server menolak permintaan'), 'error')
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
      if (!res.ok) return showToast(failureReason(res, 'Status petugas gagal diubah karena server menolak permintaan'), 'error')
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
    <div className="space-y-4">
      <div className="flex justify-end">
        <button onClick={() => setAddOff(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 hover:bg-blue-700">
          <Plus size={14} />Tambah Petugas
        </button>
      </div>

      {addOff && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-lg">
          <h3 className="font-bold mb-4">Tambah Petugas</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] text-slate-500 block mb-1">Nama</label>
              <input value={offForm.name} onChange={e => setOffForm({...offForm, name: e.target.value})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div><label className="text-[11px] text-slate-500 block mb-1">Wilayah</label>
              <select value={offForm.region} onChange={e => setOffForm({...offForm, region: e.target.value, dermagaIds: []})}
                className="w-full border rounded-xl px-3 py-2 text-sm">
                {regionNames.map(n => <option key={n} value={n}>{n}</option>)}
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

      {editOffIdx !== null && editOff && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm max-w-lg">
          <h3 className="font-bold mb-4">Edit Petugas</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div><label className="text-[11px] text-slate-500 block mb-1">Nama</label>
              <input value={editOff.name} onChange={e => setEditOff({...editOff, name: e.target.value})}
                className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div><label className="text-[11px] text-slate-500 block mb-1">Wilayah</label>
              <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">
                {regionNames.map(n => (
                  <label key={n} className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                    <input type="checkbox" checked={editRegions.includes(n)}
                      onChange={e => setEditRegions(prev => e.target.checked ? [...prev, n] : prev.filter(x => x !== n))} />
                    {n}
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
                    {regionNameOfDermaga(d)} · {d.name} ({d.code})
                  </label>
                ))}
              </div>
            )}
          </div>
          <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">PIN Baru</label>
            <input type="password" maxLength={6} value={editOff.pin ?? ''} onChange={e => setEditOff({...editOff, pin: e.target.value})}
              className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
          <div className="flex gap-3">
            <button onClick={() => { setEditOffIdx(null); setEditOff(null); setEditDermagaIds([]) }}
              className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
            <button onClick={handleUpdOff} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700">Update</button>
          </div>
        </div>
      )}

      {localOfficers.length === 0 && !loading && (
        <div className="bg-white rounded-2xl p-8 text-center border border-slate-200 shadow-sm">
          <p className="text-slate-500 font-semibold mb-1">Belum ada petugas</p>
          <p className="text-slate-400 text-sm">Klik "Tambah Petugas" untuk menambahkan petugas pertama</p>
        </div>
      )}

      {officerGroups.map(region => {
        const groupOfficers = localOfficers.filter(o => inRegionGroup(o, region))
        if (groupOfficers.length === 0) return null
        return (
          <div key={region} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden admin-card stagger-item">
            <div className="px-6 py-3 bg-slate-800 text-white font-bold flex items-center gap-2">
              <Lock size={14} className="text-slate-400" />
              {region === 'LAINNYA' ? 'Lainnya' : region} ({groupOfficers.length} petugas)
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-100 text-slate-500 text-[10px] uppercase tracking-wide">
                <tr><th className="text-left p-4 border-b border-slate-200">Nama</th><th className="text-left p-4 border-b border-slate-200">Dermaga</th><th className="text-left p-4 border-b border-slate-200">Rute</th><th className="text-left p-4 border-b border-slate-200">Status</th><th className="text-left p-4 border-b border-slate-200">Aksi</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupOfficers.map((o, oIdx) => {
                  const localIdx = localOfficers.indexOf(o)
                  return (
                    <tr key={o.id} className={`${oIdx % 2 === 1 ? 'bg-slate-50/40' : ''} hover:bg-slate-50 transition-colors duration-150`}>
                      <td className="p-4"><p className="font-bold text-sm">{o.name}</p><p className="text-[11px] text-slate-400">@{o.username}</p></td>
                      <td className="p-4">
                        {(o.dermagaAccess ?? []).length === 0 || !o.dermagaAccess?.[0]?.id
                          ? <span className="text-slate-300 text-xs">—</span>
                          : <span className="flex flex-wrap gap-1">
                            {o.dermagaAccess!.map(d => (
                              <span key={d.id} className="px-2 py-0.5 rounded-md border border-slate-200 text-slate-500 text-[10px] font-semibold">{d.code}</span>
                            ))}
                          </span>
                        }

                      </td>
                      <td className="p-4 text-[11px] text-slate-600 max-w-xs">
                        <span className="line-clamp-2" title={formatOfficerRoutes(o)}>
                          {formatOfficerRoutes(o)}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${o.status === 'Aktif' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{o.status}</span>
                      </td>
                      <td className="p-4">
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
