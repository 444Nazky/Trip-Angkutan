import { useState, useEffect } from 'react'
import { Table2, Hash, Users, BarChart2, Settings, LogOut, MapPin } from 'lucide-react'
import { fetchTariffs } from '../../services/tariffs'
import { fetchTrips } from '../../services/trips'
import { ensureAdminSession } from '../../services/auth'
import { api } from '../../services/api'
import type { AdminTab } from './components/types'
import type { BackendOfficerRow } from './components/types'
import type { TariffRow } from './components/types'
import type { BackendTrip } from '../../services/trips'
import type { PlateRecord } from '../../services/plates'
import type { Officer } from './components/types'
import { loadTheme, applyTheme } from '../../services/theme'
import { environment } from '../../environments/environment'
import ReportSheet from './ReportSheet'
import RecapSheet from './RecapSheet'

import { TariffTab } from './tabs/TariffTab'
import { PlatesTab } from './tabs/PlatesTab'
import { RoutesTab } from './tabs/RoutesTab'
import { OfficersTab } from './tabs/OfficersTab'
import { ReportsTab } from './tabs/ReportsTab'
import { SettingsTab } from './tabs/SettingsTab'



export default function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const [tariffs, setTariffs] = useState<TariffRow[]>([])
  const [officers, setOfficers] = useState<Officer[]>([])
  const [revealed, setRevealed] = useState(false)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [tab, setTab] = useState<AdminTab>('reports')
  const [serverState, setServerState] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [, setServerTrips] = useState<BackendTrip[]>([])
  const [plates, setPlates] = useState<PlateRecord[]>([])


  const [sheetMode, setSheetMode] = useState<'sheet' | 'rekap' | ''>(() => {
    if (typeof window === 'undefined') return ''
    return window.location.hash === '#/sheet/rekap' ? 'rekap' : window.location.hash === '#/sheet' ? 'sheet' : ''
  })
  useEffect(() => {
    const onHash = () => setSheetMode(
      window.location.hash === '#/sheet/rekap' ? 'rekap' : window.location.hash === '#/sheet' ? 'sheet' : '',
    )
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  function mergeBackendOfficers(rows: BackendOfficerRow[], prev: Officer[]): Officer[] {
    return rows.map(b => {
      const old = prev.find(o => String(o.id) === String(b.id)) ?? prev.find(o => o.name === b.name)
      const region = b.regions?.[0]?.code ?? b.region_code ?? b.region_id
      return {
        id: String(b.id), name: b.name,
        initials: b.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
        region,
        regions: b.regions && b.regions.length > 0 ? b.regions.map(r => r.code) : [region],
        pin: old?.pin ?? '', status: b.is_active ? 'Aktif' : 'Nonaktif',
        device: old?.device ?? '-', trips: old?.trips ?? 0,
        lastActive: old?.lastActive ?? '-', joined: old?.joined ?? '-',
        dermagaAccess: b.dermagas && b.dermagas.length > 0 ? b.dermagas : old?.dermagaAccess,
      }
    })
  }

  useEffect(() => { applyTheme(loadTheme()) }, [])

  // Dependency array WAJIB ada di sini. Tanpa itu, efek ini jalan ulang
  // setiap render -> setiap setState memicu render -> efek jalan lagi:
  // request storm tak terbatas ke /tariffs, /trips, dan /officers.
  // `officers` sengaja TIDAK jadi dependency; state lama dipakai lewat
  // functional update supaya tidak memicu loop.
  useEffect(() => {
    let alive = true
    ;(async () => {
      const sess = await ensureAdminSession()
      if (!alive) return
      if (!sess.ok) {
        setServerState('offline'); return
      }

      const [tarr, tri] = await Promise.all([fetchTariffs(), fetchTrips()])
      if (!alive) return
      if (tarr !== null && tarr.length > 0) setTariffs(tarr)
      if (tri !== null) setServerTrips(tri)

      const offs = await api.getOk<BackendOfficerRow[]>('/officers')
      if (alive && offs) setOfficers(prev => mergeBackendOfficers(offs, prev))

      setServerState('online')
    })()
    return () => { alive = false }
  }, [])

  // Navigation: Laporan as primary, other management tabs
  const navItems: { key: AdminTab; label: string; Icon: any }[] = [
    { key: 'reports', label: 'Laporan', Icon: BarChart2 },
    { key: 'tariff', label: 'Master Tarif', Icon: Table2 },
    { key: 'plates', label: 'Master Plat', Icon: Hash },
    { key: 'routes', label: 'Master Rute', Icon: MapPin },
    { key: 'officers', label: 'Petugas', Icon: Users },
    { key: 'settings', label: 'Pengaturan', Icon: Settings },
  ]

  return sheetMode === 'rekap' ? <RecapSheet /> : sheetMode === 'sheet' ? <ReportSheet /> : (
    <div className="flex bg-slate-900 min-h-screen">
        <div className="w-64 bg-[#0F172A] min-h-screen flex flex-col shrink-0 fixed left-0 top-0">
  <div className="p-6 border-b border-slate-800">
    <div className="flex items-center gap-4">

      <div className="w-11 h-11 rounded-lg bg-white flex items-center justify-center overflow-hidden shadow-lg">
        <img src="/assets/karyamasv.svg" alt="Logo" className="w-full h-full object-contain" />
      </div>

      <div>
        <p className="text-white font-black text-[14px]">Dashboard Trip</p>
        <p className="text-slate-500 text-[10px]">Karyamas Plantation</p>
      </div>
    </div>
  </div>

        <nav className="flex-1 p-3 space-y-0.5">
          {navItems.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setTab(key)}
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left text-[13px] admin-nav-item transition-all duration-150 ${
                tab === key ? 'bg-blue-600 text-white font-bold' : 'text-slate-400 hover:text-white hover:bg-slate-800'
              }`}>
              <Icon size={16} />{label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-800">
          <button onClick={onLogout} className="w-full flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-slate-500 hover:text-red-400 hover:bg-red-500/10 text-[12px] font-semibold">
            <LogOut size={14} />Logout
          </button>
        </div>
      </div>

      <div className="flex-1 ml-64 bg-slate-50 min-h-screen">
        <div className="p-8 max-w-[1400px] admin-tab-content">
          {tab === 'reports' && (
            <ReportsTab
              onServerTripsChange={setServerTrips}
              showToast={showToast}
              revealed={revealed}
              onToggleReveal={() => setRevealed(r => !r)}
              baseUrl={environment.apiBaseUrl}
            />
          )}

          {tab === 'tariff' && (
            <TariffTab
              tariffs={tariffs}
              serverState={serverState}
              onSaveTariffs={setTariffs}
              showToast={showToast}
            />
          )}

          {tab === 'plates' && (
            <PlatesTab
              plates={plates}
              onPlatesChange={setPlates}
              showToast={showToast}
            />
          )}

          {tab === 'routes' && (
            <RoutesTab showToast={showToast} />
          )}

          {tab === 'officers' && (
            <OfficersTab
              officers={officers}
              onSaveOfficers={setOfficers}
              showToast={showToast}
            />
          )}

          {tab === 'settings' && (
            <SettingsTab
              onLogout={onLogout}
              serverState={serverState}
              tariffs={tariffs}
              officers={officers}
              showToast={showToast}
            />
          )}
        </div>
      </div>

      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl text-sm font-semibold shadow-lg ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
