import { useEffect, useState } from 'react'
import { Truck, Lock, LayoutGrid, Table2, Hash, Users, BarChart2, Settings, LogOut, Plus, Pencil, Trash2, Download, ChevronLeft, ChevronDown, Check, X } from 'lucide-react'
import { useApp } from '../store'
import { tariffData } from '../data'
import { ensureAdminBackendSession } from '../../services/auth'
import { fetchTariffs, createTariff, updateTariff, deleteTariff, fetchRegionTariffs, upsertRegionTariff, type RegionTariffRow } from '../../services/tariffs'
import { fetchTrips, fetchTripReports, type BackendTrip, type ReportTrip } from '../../services/trips'
import { fetchPlates, createPlate, updatePlate, deletePlate, type PlateRecord, type PlateStatus } from '../../services/plates'
import { fetchRegions, type Region } from '../../services/regions'
import { api } from '../../services/api'
import type { AdminTab } from '../types'

interface TariffRow { id?: string; golongan: string; type: string; loaded: string; loadedNum: number; empty: string; emptyNum: number; desc: string }
interface Officer { id: number; name: string; initials: string; region: string; regions?: string[]; pin: string; status: string; device: string; trips: number; lastActive: string; joined: string }
interface BackendOfficerRow { id: string; name: string; region_id: string; regions: Region[] }
interface Toast { msg: string; type: 'success' | 'error' }

export default function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [tab, setTab] = useState<AdminTab>('overview')
  const [toast, setToast] = useState<Toast | null>(null)

  const { trips: localTrips, tariffs, saveTariffs, officers, saveOfficers } = useApp()
  // Server trips fetched from backend (these are the "real" trips)
  const [serverTrips, setServerTrips] = useState<BackendTrip[]>([])
  // Tariff backend connectivity: 'connecting' until the first attempt finishes
  const [serverState, setServerState] = useState<'connecting' | 'online' | 'offline'>('connecting')
  // Laporan (trip + vehicle detail from /reports/trips)
  const [reportTrips, setReportTrips] = useState<ReportTrip[]>([])
  const [reportState, setReportState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [openTripId, setOpenTripId] = useState<string | null>(null)
  // Registrasi plat & konfigurasi tarif region
  const [regions, setRegions] = useState<Region[]>([])
  const [regionTariffs, setRegionTariffs] = useState<RegionTariffRow[]>([])
  const [plates, setPlates] = useState<PlateRecord[]>([])
  const [plateState, setPlateState] = useState<'idle' | 'loading' | 'ready' | 'offline'>('idle')
  const [plateForm, setPlateForm] = useState({ plate: '', owner: '', originRegionId: '', status: 'internal' as PlateStatus })
  const [editPlateId, setEditPlateId] = useState<string | null>(null)
  const [backendOfficers, setBackendOfficers] = useState<BackendOfficerRow[]>([])
  const [editRegions, setEditRegions] = useState<string[]>([])
  const [editTarIdx, setEditTarIdx] = useState<number | null>(null)
  const [addTar, setAddTar] = useState(false)
  const [tarForm, setTarForm] = useState({ golongan: '', type: '', loaded: '', loadedNum: 0, empty: '', emptyNum: 0, desc: '' })
  const [editTar, setEditTar] = useState({ golongan: '', type: '', loaded: '', loadedNum: 0, empty: '', emptyNum: 0, desc: '' })

  const [addOff, setAddOff] = useState(false)
  const [editOffIdx, setEditOffIdx] = useState<number | null>(null)
  const [offForm, setOffForm] = useState({ name: '', region: 'BADAU', pin: '', device: '' })
  const [editOff, setEditOff] = useState<Officer | null>(null)

  const showToast = (msg: string, type: Toast['type'] = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fmtRp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`
  const regionCodes = regions.length > 0 ? regions.map(r => r.code) : ['BADAU', 'ENTIKONG']

  // On mount: get an admin JWT and load Master Tarif + Trips from server.
  // Server data wins; localStorage stays as the offline fallback/cache.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const ok = await ensureAdminBackendSession()
      if (!alive) return
      if (!ok) { setServerState('offline'); return }

      // Fetch tariffs
      const rows = await fetchTariffs()
      if (!alive) return
      if (rows === null) { setServerState('offline'); return }
      if (rows.length > 0) saveTariffs(rows)

      // Fetch trips from backend
      const tripsData = await fetchTrips()
      if (!alive) return
      if (tripsData !== null) {
        setServerTrips(tripsData)
      }

      // Registrasi plat + tarif region + daftar region + petugas (backend)
      const regs = await fetchRegions()
      if (!alive) return
      if (regs) setRegions(regs)

      const rts = await fetchRegionTariffs()
      if (!alive) return
      if (rts) setRegionTariffs(rts)

      const pls = await fetchPlates()
      if (!alive) return
      if (pls) { setPlates(pls); setPlateState('ready') } else setPlateState('offline')

      const offs = await api.get<BackendOfficerRow[]>('/officers')
      if (alive && offs.ok && offs.data) setBackendOfficers(offs.data)

      setServerState('online')
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Laporan: load lazily on first open of the tab
  const loadReports = async () => {
    setReportState('loading')
    const ok = await ensureAdminBackendSession()
    if (!ok) { setReportState('offline'); return }
    const rows = await fetchTripReports()
    if (rows === null) { setReportState('offline'); return }
    setReportTrips(rows)
    setReportState('ready')
  }

  useEffect(() => {
    if (tab === 'reports' && reportState === 'idle') void loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, reportState])

  // Master Plat: lazy-load saat tab dibuka (fallback kalau mount tadi offline)
  const loadPlates = async () => {
    setPlateState('loading')
    const ok = await ensureAdminBackendSession()
    if (!ok) { setPlateState('offline'); return }
    const [pls, regs] = await Promise.all([fetchPlates(), fetchRegions()])
    if (pls === null) { setPlateState('offline'); return }
    setPlates(pls)
    if (regs) setRegions(regs)
    setPlateState('ready')
  }

  useEffect(() => {
    if (tab === 'plates' && plateState === 'idle') void loadPlates()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, plateState])

  // Tarif region: ambil konfigurasi saat tab Master Tarif dibuka (kalau belum ada)
  useEffect(() => {
    if (tab === 'tariff' && regionTariffs.length === 0) {
      void (async () => {
        if (await ensureAdminBackendSession()) {
          const rt = await fetchRegionTariffs()
          if (rt) setRegionTariffs(rt)
        }
      })()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, regionTariffs.length])

  // Tariff CRUD — local state always updates (works offline), server is
  // pushed to best-effort when connected; failure flips us to 'offline'.
  const handleAddTar = async () => {
    if (!tarForm.type || !tarForm.golongan) return showToast('Lengkapi form!', 'error')
    const row: TariffRow = { ...tarForm, loaded: fmtRp(tarForm.loadedNum), empty: fmtRp(tarForm.emptyNum) }

    if (serverState === 'online') {
      const id = await createTariff(row)
      if (id) {
        row.id = id
      } else {
        setServerState('offline')
        showToast('Server gagal — tarif disimpan lokal', 'error')
      }
    }

    saveTariffs([...tariffs, row])
    setTarForm({ golongan: '', type: '', loaded: '', loadedNum: 0, empty: '', emptyNum: 0, desc: '' })
    setAddTar(false)
    showToast('Tarif ditambahkan')
  }

  const handleUpdTar = async () => {
    const row: TariffRow = { ...editTar, loaded: fmtRp(editTar.loadedNum), empty: fmtRp(editTar.emptyNum) }
    const ns = [...tariffs]
    if (editTarIdx !== null) { ns[editTarIdx] = row; saveTariffs(ns) }

    if (serverState === 'online') {
      let ok = false
      if (row.id) {
        ok = await updateTariff(row)
      } else {
        const newId = await createTariff(row)
        ok = newId !== null
        if (newId) row.id = newId
        else row.id = undefined
      }
      if (!ok) {
        setServerState('offline')
        showToast('Server gagal — perubahan tersimpan lokal', 'error')
      }
    }

    setEditTarIdx(null)
    showToast('Tarif diupdate')
  }

  const handleDelTar = async (i: number) => {
    if (!confirm('Hapus?')) return
    const row = tariffs[i]
    saveTariffs(tariffs.filter((_, idx) => idx !== i))
    // Keep the open edit form pointing at the right row after deletion
    if (editTarIdx === i) setEditTarIdx(null)
    else if (editTarIdx !== null && editTarIdx > i) setEditTarIdx(editTarIdx - 1)

    if (serverState === 'online' && row?.id) {
      const ok = await deleteTariff(row)
      if (!ok) {
        setServerState('offline')
        showToast('Server gagal — hapus lokal saja', 'error')
        return
      }
    }
    showToast('Tarif dihapus')
  }

  // Registrasi plat — local state selalu ikut, server best-effort
  const resetPlateForm = () => {
    setPlateForm({ plate: '', owner: '', originRegionId: '', status: 'internal' })
    setEditPlateId(null)
  }

  const handleSavePlate = async () => {
    if (!plateForm.plate.trim()) return showToast('Nomor plat wajib diisi!', 'error')
    const input = {
      plate: plateForm.plate.trim().toUpperCase(),
      owner: plateForm.owner.trim() || undefined,
      originRegionId: plateForm.originRegionId || null,
      status: plateForm.status,
    }

    const okEdit = editPlateId ? await updatePlate(editPlateId, input) : null
    if (editPlateId) {
      if (!okEdit) return showToast('Server gagal — plat tidak terupdate', 'error')
    } else {
      const id = await createPlate(input)
      if (!id) return showToast('Server gagal daftar plat (duplikat/offline?)', 'error')
    }

    const fresh = await fetchPlates()
    if (fresh) setPlates(fresh)
    resetPlateForm()
    showToast(editPlateId ? 'Plat diupdate' : 'Plat terdaftar')
  }

  const handleDelPlate = async (id: string) => {
    if (!confirm('Hapus plat ini?')) return
    const ok = await deletePlate(id)
    if (!ok) return showToast('Server gagal — plat tidak terhapus', 'error')
    setPlates(plates.filter(p => p.id !== id))
    if (editPlateId === id) resetPlateForm()
    showToast('Plat dihapus')
  }

  // Tarif region — simpan konfigurasi (lokal + eksternal) ke server
  const handleSaveRegionTariff = async (rt: RegionTariffRow) => {
    const [a, b] = await Promise.all([
      upsertRegionTariff({ regionId: rt.id, tariffType: 'lokal', nominalTariff: rt.lokal_tariff ?? 0, isActive: !!rt.lokal_active }),
      upsertRegionTariff({ regionId: rt.id, tariffType: 'eksternal', nominalTariff: rt.eksternal_tariff ?? 0, isActive: !!rt.eksternal_active }),
    ])
    if (!a || !b) return showToast('Server gagal — tarif region tidak tersimpan', 'error')
    showToast(`Tarif region ${rt.code} diupdate`)
  }

  // Officer CRUD
  const handleAddOff = () => {
    if (!offForm.name || !offForm.pin) return showToast('Lengkapi form!', 'error')
    const initials = offForm.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    const row: Officer = { id: Date.now(), name: offForm.name, initials, region: offForm.region, pin: offForm.pin, status: 'Aktif', device: offForm.device || '-', trips: 0, lastActive: '-', joined: new Date().toLocaleDateString('id-ID') }
    saveOfficers([...officers, row])
    setOffForm({ name: '', region: 'BADAU', pin: '', device: '' })
    setAddOff(false)
    showToast('Petugas ditambahkan')
  }

  const handleUpdOff = async () => {
    if (!editOff) return
    const initials = editOff.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    const chosen = editRegions.length > 0 ? editRegions : [editOff.region]
    const ns = [...officers]
    if (editOffIdx !== null) ns[editOffIdx] = { ...editOff, region: chosen[0], regions: chosen, initials }
    saveOfficers(ns)

    // Many-to-many: sinkron daftar wilayah ke server (petugas yang terdaftar di backend)
    const be = backendOfficers.find(b => String(b.id) === String(editOff.id) || b.name === editOff.name)
    if (be) {
      const ids = chosen.map(c => regions.find(r => r.code === c)?.id).filter(Boolean) as string[]
      if (ids.length > 0) {
        const res = await api.put(`/officers/${be.id}/regions`, { regionIds: ids })
        if (!res.ok) showToast('Wilayah tersimpan lokal — gagal sinkron ke server', 'error')
      }
    }

    setEditOffIdx(null)
    setEditOff(null)
    showToast('Petugas diupdate')
  }

  const handleDelOff = (i: number) => {
    if (!confirm('Hapus?')) return
    saveOfficers(officers.filter((_, idx) => idx !== i))
    // Keep the open edit form pointing at the right row after deletion
    if (editOffIdx === i) { setEditOffIdx(null); setEditOff(null) }
    else if (editOffIdx !== null && editOffIdx > i) setEditOffIdx(editOffIdx - 1)
    showToast('Petugas dihapus')
  }

  const toggleOffStatus = (i: number) => {
    const ns = [...officers]
    ns[i] = { ...ns[i], status: ns[i].status === 'Aktif' ? 'Nonaktif' : 'Aktif' }
    saveOfficers(ns)
    showToast('Status diubah')
  }

  const navItems: { key: AdminTab; label: string; Icon: any }[] = [
    { key: 'overview', label: 'Dashboard', Icon: LayoutGrid },
    { key: 'tariff', label: 'Master Tarif', Icon: Table2 },
    { key: 'plates', label: 'Master Plat', Icon: Hash },
    { key: 'officers', label: 'Petugas', Icon: Users },
    { key: 'reports', label: 'Laporan', Icon: BarChart2 },
    { key: 'settings', label: 'Pengaturan', Icon: Settings },
  ]

  return (
    <div className="flex min-h-screen">
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] px-4 py-3 rounded-xl shadow-lg text-sm font-medium flex items-center gap-2 ${toast.type === 'success' ? 'bg-blue-600 text-white' : 'bg-red-500 text-white'}`}>
          {toast.type === 'success' ? <Check size={16} /> : <X size={16} />}
          {toast.msg}
        </div>
      )}

      <div className="w-60 bg-[#0F172A] min-h-screen flex flex-col shrink-0 fixed left-0 top-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center"><Truck size={18} className="text-white" /></div>
            <div><p className="text-white font-black text-[13px]">Trip Angkutan</p><p className="text-slate-500 text-[10px]">Admin</p></div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => { setTab(key); setEditTarIdx(null); setAddTar(false); setEditOffIdx(null); setAddOff(false); setEditPlateId(null) }}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left text-[13px] ${tab === key ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white hover:bg-slate-800'}`}>
              <Icon size={16} />{label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <button onClick={onLogout} className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 text-[12px] font-semibold transition-colors">
            <LogOut size={14} />Logout
          </button>
        </div>
      </div>

      <div className="flex-1 ml-60 bg-slate-100 min-h-screen">
        <div className="p-8">
          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100 font-bold text-slate-800 flex justify-between items-center">
                  <span>Trip Terbaru dari Server</span>
                  <button
                    onClick={() => {
                      ensureAdminBackendSession().then(() => fetchTrips().then(t => t && setServerTrips(t)))
                    }}
                    className="text-blue-600 text-sm font-bold hover:underline"
                  >
                    Refresh
                  </button>
                </div>
                <table className="w-full text-[13px]">
                  <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
                    <tr><th className="text-left p-4">No Trip</th><th className="text-left p-4">Rute</th><th className="text-left p-4">Petugas</th><th className="text-left p-4">Status</th><th className="text-left p-4">Tanggal</th></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {serverTrips.length === 0 ? (
                      <tr><td colSpan={5} className="p-8 text-center text-slate-400">Belum ada trip dari server</td></tr>
                    ) : serverTrips.slice(0, 10).map(t => (
                      <tr key={t.id} className="hover:bg-slate-50">
                        <td className="p-4 font-mono text-slate-600">{t.no_trip}</td>
                        <td className="p-4 font-bold">{t.route_from} → {t.route_to}</td>
                        <td className="p-4">{t.officer_name || t.officer_id}</td>
                        <td className="p-4"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${t.status_muatan === 'muatan' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>{t.status_muatan}</span></td>
                        <td className="p-4 text-slate-500">{t.created_at}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === 'tariff' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
                  serverState === 'online' ? 'bg-emerald-50 text-emerald-600'
                  : serverState === 'offline' ? 'bg-amber-50 text-amber-600'
                  : 'bg-slate-100 text-slate-500'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    serverState === 'online' ? 'bg-emerald-500'
                    : serverState === 'offline' ? 'bg-amber-500'
                    : 'bg-slate-400 animate-pulse'
                  }`} />
                  {serverState === 'online' ? 'Server: Tersambung'
                  : serverState === 'offline' ? 'Server: Offline (lokal)'
                  : 'Memeriksa server...'}
                </span>
                <button onClick={() => setAddTar(true)} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2 hover:bg-blue-700">
                  <Plus size={14} />Tambah Golongan
                </button>
              </div>

              {addTar && (
                <div className="bg-white rounded-2xl p-6 shadow-sm max-w-lg">
                  <h3 className="font-bold mb-4">Tambah Golongan</h3>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div><label className="text-[11px] text-slate-500 block mb-1">Golongan</label><input value={tarForm.golongan} onChange={e => setTarForm({...tarForm, golongan: e.target.value})} placeholder="I, II, III" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                    <div><label className="text-[11px] text-slate-500 block mb-1">Jenis</label><input value={tarForm.type} onChange={e => setTarForm({...tarForm, type: e.target.value})} placeholder="Truck Besar" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  </div>
                  <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">Deskripsi</label><input value={tarForm.desc} onChange={e => setTarForm({...tarForm, desc: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div><label className="text-[11px] text-slate-500 block mb-1">Muatan (Rp)</label><input type="number" value={tarForm.loadedNum || ''} onChange={e => setTarForm({...tarForm, loadedNum: parseInt(e.target.value) || 0})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                    <div><label className="text-[11px] text-slate-500 block mb-1">Kosong (Rp)</label><input type="number" value={tarForm.emptyNum || ''} onChange={e => setTarForm({...tarForm, emptyNum: parseInt(e.target.value) || 0})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setAddTar(false)} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
                    <button onClick={handleAddTar} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Simpan</button>
                  </div>
                </div>
              )}

              {editTarIdx !== null && (
                <div className="bg-white rounded-2xl p-6 shadow-sm max-w-lg">
                  <h3 className="font-bold mb-4">Edit Golongan</h3>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div><label className="text-[11px] text-slate-500 block mb-1">Golongan</label><input value={editTar.golongan} onChange={e => setEditTar({...editTar, golongan: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                    <div><label className="text-[11px] text-slate-500 block mb-1">Jenis</label><input value={editTar.type} onChange={e => setEditTar({...editTar, type: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  </div>
                  <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">Deskripsi</label><input value={editTar.desc} onChange={e => setEditTar({...editTar, desc: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div><label className="text-[11px] text-slate-500 block mb-1">Muatan</label><input type="number" value={editTar.loadedNum || ''} onChange={e => setEditTar({...editTar, loadedNum: parseInt(e.target.value) || 0})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                    <div><label className="text-[11px] text-slate-500 block mb-1">Kosong</label><input type="number" value={editTar.emptyNum || ''} onChange={e => setEditTar({...editTar, emptyNum: parseInt(e.target.value) || 0})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  </div>
                  <div className="flex gap-3">
                    <button onClick={() => setEditTarIdx(null)} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
                    <button onClick={handleUpdTar} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Update</button>
                  </div>
                </div>
              )}

              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
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
            </div>
          )}

          {tab === 'plates' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-slate-900 text-lg">Master Plat</h3>
                  <p className="text-slate-500 text-[12px]">Registrasi nomor plat — plat terdaftar sebagai <b>internal</b> tidak dikenakan tarif saat discan petugas</p>
                </div>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
                  plateState === 'ready' ? 'bg-emerald-50 text-emerald-600'
                  : plateState === 'offline' ? 'bg-amber-50 text-amber-600'
                  : 'bg-slate-100 text-slate-500'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    plateState === 'ready' ? 'bg-emerald-500'
                    : plateState === 'offline' ? 'bg-amber-500'
                    : 'bg-slate-400 animate-pulse'
                  }`} />
                  {plateState === 'ready' ? 'Server: Tersambung'
                  : plateState === 'offline' ? 'Server: Offline'
                  : 'Memuat...'}
                </span>
              </div>

              {/* Form tambah / edit plat */}
              <div className="bg-white rounded-2xl p-6 shadow-sm max-w-3xl">
                <h3 className="font-bold mb-4">{editPlateId ? 'Edit Plat' : 'Daftar Plat Baru'}</h3>
                <div className="grid grid-cols-4 gap-4 mb-4">
                  <div><label className="text-[11px] text-slate-500 block mb-1">No. Plat *</label>
                    <input value={plateForm.plate} onChange={e => setPlateForm({...plateForm, plate: e.target.value.toUpperCase()})} placeholder="B 1234 XY"
                      className="w-full border rounded-xl px-3 py-2 text-sm font-mono tracking-wide" /></div>
                  <div><label className="text-[11px] text-slate-500 block mb-1">Pemilik (opsional)</label>
                    <input value={plateForm.owner} onChange={e => setPlateForm({...plateForm, owner: e.target.value})} placeholder="Nama pemilik"
                      className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  <div><label className="text-[11px] text-slate-500 block mb-1">Region Asal (opsional)</label>
                    <select value={plateForm.originRegionId} onChange={e => setPlateForm({...plateForm, originRegionId: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="">—</option>
                      {regions.map(r => <option key={r.id} value={r.id}>{r.name} ({r.code})</option>)}
                    </select></div>
                  <div><label className="text-[11px] text-slate-500 block mb-1">Status</label>
                    <select value={plateForm.status} onChange={e => setPlateForm({...plateForm, status: e.target.value as PlateStatus})} className="w-full border rounded-xl px-3 py-2 text-sm">
                      <option value="internal">internal</option>
                      <option value="lokal">lokal</option>
                      <option value="eksternal">eksternal</option>
                    </select></div>
                </div>
                <div className="flex gap-3">
                  {editPlateId && <button onClick={resetPlateForm} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>}
                  <button onClick={() => void handleSavePlate()} className={`${editPlateId ? 'flex-1' : 'w-48'} py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700`}>
                    {editPlateId ? 'Update' : 'Daftarkan'}
                  </button>
                </div>
              </div>

              {/* Tabel plat terdaftar */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
                    <tr><th className="text-left p-4">No. Plat</th><th className="text-left p-4">Pemilik</th><th className="text-left p-4">Region Asal</th><th className="text-left p-4">Status</th><th className="text-right p-4">Aksi</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {plateState === 'loading' ? (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400 animate-pulse">Memuat plat...</td></tr>
                    ) : plates.length === 0 ? (
                      <tr><td colSpan={5} className="p-6 text-center text-slate-400">Belum ada plat terdaftar</td></tr>
                    ) : plates.map(p => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="p-4 font-mono font-bold tracking-wide">{p.plate}</td>
                        <td className="p-4">{p.owner || <span className="text-slate-300">—</span>}</td>
                        <td className="p-4">{p.origin_region_code || <span className="text-slate-300">—</span>}</td>
                        <td className="p-4">
                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${
                            p.status === 'internal' ? 'bg-slate-800 text-white'
                            : p.status === 'lokal' ? 'bg-blue-100 text-blue-700'
                            : 'bg-amber-100 text-amber-700'
                          }`}>{p.status}</span>
                        </td>
                        <td className="p-4 text-right">
                          <button onClick={() => { setEditPlateId(p.id); setPlateForm({ plate: p.plate, owner: p.owner || '', originRegionId: p.origin_region_id || '', status: p.status }) }}
                            className="text-blue-600 font-bold text-sm mr-4">Edit</button>
                          <button onClick={() => void handleDelPlate(p.id)} className="text-red-500 font-bold text-sm">Hapus</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Tarif Region — konfigurasi penarifan plat per region */}
              <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                  <p className="font-bold text-slate-800">Tarif Region (Penarifan Plat)</p>
                  <p className="text-[11px] text-slate-400">Kendaraan <b>lokal</b> saat ini Rp 0 (cadangan kebijakan), <b>eksternal</b> menyesuaikan region pos pemeriksaan.</p>
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
                    <tr><th className="text-left p-4">Region</th><th className="text-left p-4">Tarif Lokal (Rp)</th><th className="text-left p-4">Tarif Eksternal (Rp)</th><th className="text-right p-4">Aksi</th></tr>
                  </thead>
                  <tbody className="divide-y">
                    {regionTariffs.length === 0 ? (
                      <tr><td colSpan={4} className="p-6 text-center text-slate-400">Belum ada data region dari server</td></tr>
                    ) : regionTariffs.map((rt, i) => (
                      <tr key={rt.id} className="hover:bg-slate-50">
                        <td className="p-4 font-bold">{rt.name} <span className="text-slate-400 font-mono text-[11px] font-normal">{rt.code}</span></td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <input type="number" min={0} value={rt.lokal_tariff ?? 0}
                              onChange={e => { const v = [...regionTariffs]; v[i] = { ...rt, lokal_tariff: parseInt(e.target.value) || 0 }; setRegionTariffs(v) }}
                              className="w-28 border rounded-lg px-2 py-1.5 text-[13px]" disabled={!rt.lokal_active && (rt.lokal_tariff ?? 0) === 0} />
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
          )}

          {tab === 'officers' && (
            <div className="space-y-4">
              <div className="flex justify-end">
                <button onClick={() => setAddOff(true)} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm flex items-center gap-2">
                  <Plus size={14} />Tambah Petugas
                </button>
              </div>

              {addOff && (
                <div className="bg-white rounded-2xl p-6 shadow-sm max-w-lg">
                  <h3 className="font-bold mb-4">Tambah Petugas</h3>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div><label className="text-[11px] text-slate-500 block mb-1">Nama</label><input value={offForm.name} onChange={e => setOffForm({...offForm, name: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                    <div><label className="text-[11px] text-slate-500 block mb-1">Wilayah</label>
                      <select value={offForm.region} onChange={e => setOffForm({...offForm, region: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm">
                        {regionCodes.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">PIN</label><input type="password" maxLength={6} value={offForm.pin} onChange={e => setOffForm({...offForm, pin: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  <div className="flex gap-3">
                    <button onClick={() => setAddOff(false)} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
                    <button onClick={handleAddOff} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Simpan</button>
                  </div>
                </div>
              )}

              {editOffIdx !== null && editOff && (
                <div className="bg-white rounded-2xl p-6 shadow-sm max-w-lg">
                  <h3 className="font-bold mb-4">Edit Petugas</h3>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div><label className="text-[11px] text-slate-500 block mb-1">Nama</label><input value={editOff.name} onChange={e => setEditOff({...editOff, name: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                    <div><label className="text-[11px] text-slate-500 block mb-1">Wilayah</label>
                      <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1.5">
                        {regionCodes.map(c => (
                          <label key={c} className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-600">
                            <input type="checkbox" checked={editRegions.includes(c)}
                              onChange={e => setEditRegions(prev => e.target.checked ? [...prev, c] : prev.filter(x => x !== c))} />
                            {c}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mb-4"><label className="text-[11px] text-slate-500 block mb-1">PIN Baru</label><input type="password" maxLength={6} value={editOff.pin} onChange={e => setEditOff({...editOff, pin: e.target.value})} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
                  <div className="flex gap-3">
                    <button onClick={() => { setEditOffIdx(null); setEditOff(null) }} className="flex-1 py-3 rounded-xl border text-slate-700 font-semibold">Batal</button>
                    <button onClick={handleUpdOff} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold">Update</button>
                  </div>
                </div>
              )}

              {regionCodes.map(region => (
                <div key={region} className="bg-white rounded-2xl shadow-sm overflow-hidden">
                  <div className="px-6 py-3 bg-[#0F172A] text-white font-bold flex items-center gap-2"><Lock size={14} className="text-blue-400" />{region} ({officers.filter(o => o.region === region).length} petugas)</div>
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase">
                      <tr><th className="text-left p-4">Nama</th><th className="text-left p-4">Status</th><th className="text-left p-4">Aksi</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {officers.filter(o => (o.regions && o.regions.length > 0 ? o.regions : [o.region]).includes(region)).map((o, _, arr) => {
                        const i = officers.indexOf(o)
                        return (
                          <tr key={o.id} className="hover:bg-slate-50">
                            <td className="p-4 font-bold">{o.name}</td>
                            <td className="p-4"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${o.status === 'Aktif' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{o.status}</span></td>
                            <td className="p-4">
                              <button onClick={() => { setEditOffIdx(i); setEditOff(o); setEditRegions(o.regions && o.regions.length > 0 ? o.regions : [o.region]) }} className="text-blue-600 font-bold text-sm mr-3">Edit</button>
                              <button onClick={() => toggleOffStatus(i)} className="text-amber-500 font-bold text-sm mr-3">{o.status === 'Aktif' ? 'Nonaktifkan' : 'Aktifkan'}</button>
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
          )}

          {tab === 'reports' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-black text-slate-900 text-lg">Laporan Trip</h3>
                  <p className="text-slate-500 text-[12px]">Detail kendaraan, kategori, dan tarif per trip</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-full ${
                    reportState === 'ready' ? 'bg-emerald-50 text-emerald-600'
                    : reportState === 'offline' ? 'bg-amber-50 text-amber-600'
                    : 'bg-slate-100 text-slate-500'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      reportState === 'ready' ? 'bg-emerald-500'
                      : reportState === 'offline' ? 'bg-amber-500'
                      : 'bg-slate-400 animate-pulse'
                    }`} />
                    {reportState === 'ready' ? 'Server: Tersambung'
                    : reportState === 'offline' ? 'Server: Offline'
                    : 'Memuat laporan...'}
                  </span>
                  <button onClick={() => void loadReports()} disabled={reportState === 'loading'}
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700 disabled:opacity-50">
                    {reportState === 'loading' ? 'Memuat...' : 'Refresh'}
                  </button>
                </div>
              </div>

              {reportState === 'ready' && (
                <div className="grid grid-cols-4 gap-4">
                  {[
                    { label: 'Total Trip', val: reportTrips.length, color: 'bg-blue-100 text-blue-600' },
                    { label: 'Trip Muatan', val: reportTrips.filter(t => t.status_muatan === 'muatan').length, color: 'bg-sky-100 text-sky-600' },
                    { label: 'Total Unit Kendaraan', val: reportTrips.reduce((s, t) => s + (t.vehicle_count || 0), 0), color: 'bg-amber-100 text-amber-600' },
                    { label: 'Total Pendapatan', val: fmtRp(reportTrips.reduce((s, t) => s + (t.trip_revenue || 0), 0)), color: 'bg-emerald-100 text-emerald-600' },
                  ].map(({ label, val, color }) => (
                    <div key={label} className="bg-white rounded-2xl p-5 shadow-sm">
                      <p className="text-slate-500 text-[11px] mb-1">{label}</p>
                      <p className={`text-2xl font-black ${color.split(' ')[1]}`}>{val}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="bg-white rounded-2xl shadow-sm divide-y divide-slate-100 overflow-hidden">
                {reportState === 'offline' ? (
                  <div className="p-8 text-center text-slate-400 text-sm">Tidak dapat terhubung ke server. Pastikan backend berjalan.</div>
                ) : reportState !== 'ready' ? (
                  <div className="p-8 text-center text-slate-400 text-sm animate-pulse">Memuat laporan dari server...</div>
                ) : reportTrips.length === 0 ? (
                  <div className="p-8 text-center text-slate-400 text-sm">Belum ada trip di server</div>
                ) : reportTrips.map(t => {
                  const open = openTripId === t.id
                  return (
                    <div key={t.id}>
                      <button onClick={() => setOpenTripId(open ? null : t.id)}
                        className="w-full px-6 py-4 flex items-center gap-4 hover:bg-slate-50 text-left">
                        <span className="font-mono text-[12px] text-slate-500 w-36 shrink-0">{t.no_trip}</span>
                        <span className="font-bold text-slate-800 w-32 shrink-0">{t.route_from} → {t.route_to}</span>
                        <span className="text-slate-600 text-[13px] w-32 shrink-0">{t.officer_name || '-'}</span>
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${t.status_muatan === 'muatan' ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                          {t.status_muatan === 'muatan' ? 'Ada Muatan' : 'Kosong'}
                        </span>
                        <span className="text-slate-400 text-[12px] w-10 shrink-0">{t.vehicle_count} unit</span>
                        <span className="ml-auto font-black text-slate-900">{fmtRp(t.trip_revenue || 0)}</span>
                        <ChevronDown size={16} className={`text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
                      </button>

                      {open && (
                        <div className="px-6 pb-5 pt-1 bg-slate-50/60 border-t border-slate-100">
                          <div className="flex flex-wrap gap-x-8 gap-y-1 py-3 text-[12px]">
                            <span><span className="text-slate-400">Kategori:</span> <span className="font-semibold text-slate-700">{t.keterangan && t.keterangan !== '-' ? t.keterangan : '-'}</span></span>
                            <span><span className="text-slate-400">Wilayah:</span> <span className="font-semibold text-slate-700">{t.region_name || '-'}</span></span>
                            <span><span className="text-slate-400">Tanggal:</span> <span className="font-semibold text-slate-700">{t.created_at}</span></span>
                          </div>

                          {t.vehicles.length === 0 ? (
                            <p className="text-slate-400 text-[13px] py-3">Tidak ada kendaraan — trip dalam kondisi kosong.</p>
                          ) : (
                            <div className="bg-white rounded-xl overflow-hidden border border-slate-100">
                              <table className="w-full text-[13px]">
                                <thead className="bg-slate-100 text-slate-400 text-[10px] uppercase">
                                  <tr>
                                    <th className="text-left p-3">No. Plat</th>
                                    <th className="text-left p-3">Jenis</th>
                                    <th className="text-left p-3">Kategori</th>
                                    <th className="text-left p-3">Beban</th>
                                    <th className="text-right p-3">Tarif</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                  {t.vehicles.map((v, i) => {
                                    const cat = v.golongan
                                    const catColor = cat === 'Internal' ? 'bg-slate-800 text-white'
                                      : cat === 'Eksternal (Berganji)' ? 'bg-amber-500 text-white'
                                      : cat === 'Eksternal (Tanpa Garansi)' ? 'bg-rose-500 text-white'
                                      : 'bg-blue-100 text-blue-700'
                                    return (
                                      <tr key={`${v.no_polisi}-${i}`} className="hover:bg-slate-50">
                                        <td className="p-3 font-mono font-bold text-slate-700">{v.no_polisi}</td>
                                        <td className="p-3">{v.vehicle_type}</td>
                                        <td className="p-3"><span className={`px-2 py-1 rounded-full text-[10px] font-bold ${catColor}`}>{cat}</span></td>
                                        <td className="p-3">
                                          <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${v.has_load ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                                            {v.has_load ? 'Ada Muatan' : 'Kosong'}
                                          </span>
                                        </td>
                                        <td className="p-3 text-right font-bold text-slate-900">{fmtRp(v.tariff_amount || 0)}</td>
                                      </tr>
                                    )
                                  })}
                                  <tr className="bg-slate-50">
                                    <td colSpan={4} className="p-3 text-right font-bold text-slate-600 text-[12px]">Total Tarif Trip ({t.vehicles.length} unit)</td>
                                    <td className="p-3 text-right font-black text-emerald-600">{fmtRp(t.trip_revenue || 0)}</td>
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {tab === 'settings' && (
            <div className="space-y-6">
              <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                <h3 className="text-lg font-bold text-slate-800 mb-1">Pengaturan & Konfigurasi Sistem</h3>
                <p className="text-xs text-slate-500 mb-6">Kelola preferensi sesi, database backend, dan diagnostik aplikasi admin</p>

                <div className="grid grid-cols-2 gap-6">
                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
                    <p className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Status Koneksi API</p>
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${serverState === 'online' ? 'bg-emerald-500' : serverState === 'offline' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                      <span className="text-sm font-semibold text-slate-800">
                        {serverState === 'online' ? 'Backend Online (JWT Terverifikasi)' : serverState === 'offline' ? 'Backend Offline (Mode Lokal)' : 'Menghubungkan...'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400">Endpoint: http://localhost:3000/api</p>
                    <button
                      onClick={async () => {
                        const ok = await ensureAdminBackendSession()
                        setServerState(ok ? 'online' : 'offline')
                        showToast(ok ? 'Koneksi backend aktif' : 'Gagal terhubung ke backend', ok ? 'success' : 'error')
                      }}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs hover:bg-blue-700 transition-colors"
                    >
                      Tes Ulang Koneksi
                    </button>
                  </div>

                  <div className="p-4 rounded-xl bg-slate-50 border border-slate-100 space-y-3">
                    <p className="text-[12px] font-bold text-slate-700 uppercase tracking-wide">Penyimpanan & Cache Lokal</p>
                    <p className="text-xs text-slate-600">
                      {tariffs.length} tarif tersimpan · {officers.length} petugas · {localTrips.length} trip lokal
                    </p>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => {
                          if (confirm('Reset tarif lokal ke data bawaan?')) {
                            saveTariffs(tariffData)
                            showToast('Tarif lokal telah direset')
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-bold text-xs hover:bg-white transition-colors"
                      >
                        Reset Default Tarif
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Hapus seluruh sesi cache aplikasi? Anda akan logout.')) {
                            onLogout()
                          }
                        }}
                        className="px-3 py-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200 font-bold text-xs hover:bg-red-100 transition-colors"
                      >
                        Hapus Sesi & Keluar
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}