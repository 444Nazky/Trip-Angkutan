import { useState, useEffect } from 'react'
import { LayoutGrid, Table2, Hash, Users, BarChart2, Settings, LogOut, MapPin } from 'lucide-react'
import { fetchTariffs } from '../../services/tariffs'
import { fetchTrips, fetchReportSummary, dayKeyWib } from '../../services/trips'
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
import LoginPage from '../LoginPage'
import ReportSheet from './ReportSheet'

import { OverviewTab } from './tabs/OverviewTab'
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
  const [tab, setTab] = useState<AdminTab>('overview')
  const [serverState, setServerState] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [serverTrips, setServerTrips] = useState<BackendTrip[]>([])
  const [plates, setPlates] = useState<PlateRecord[]>([])
  const [dashSummary, setDashSummary] = useState<{ totalTrips: number; totalRevenue: number; totalVehicles: number } | null>(null)
  const [dashAt, setDashAt] = useState('')

  const [authDenied, setAuthDenied] = useState(false)
  const [authRetry, setAuthRetry] = useState(0)

  const [sheetMode, setSheetMode] = useState(() => typeof window !== 'undefined' && window.location.hash === '#/sheet')
  useEffect(() => {
    const onHash = () => setSheetMode(window.location.hash === '#/sheet')
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

  useEffect(() => {
    let alive = true
    ;(async () => {
      const sess = await ensureAdminSession()
      if (!alive) return
      if (!sess.ok) {
        if (sess.authDenied) { setAuthDenied(true); return }
        setServerState('offline'); return
      }
      setAuthDenied(false)

      const [tarr, tri] = await Promise.all([fetchTariffs(), fetchTrips()])
      if (!alive) return
      if (tarr !== null && tarr.length > 0) setTariffs(tarr)
      if (tri !== null) setServerTrips(tri)

      const offs = await api.getOk<BackendOfficerRow[]>('/officers')
      if (alive && offs) setOfficers(mergeBackendOfficers(offs, officers))

      setServerState('online')
    })()
    return () => { alive = false }
  }, [authRetry])

  const activeOfficerCount = officers.filter(o => o.status === 'Aktif').length

  const loadOverview = async () => {
    const sess = await ensureAdminSession()
    if (!sess.ok) {
      if (sess.authDenied) { setAuthDenied(true); return }
      setServerState('offline'); return
    }

    const today = dayKeyWib(new Date().toISOString())
    const [trips, summ] = await Promise.all([fetchTrips(), fetchReportSummary(today, today)])
    if (trips) setServerTrips(trips)
    setServerState('online')
    setDashSummary(summ)
    setDashAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))
  }

  useEffect(() => {
    if (tab !== 'overview' || authDenied) return
    void loadOverview()
    const id = setInterval(() => void loadOverview(), 15000)
    return () => clearInterval(id)
  }, [tab, authDenied])

  const navItems: { key: AdminTab; label: string; Icon: any }[] = [
    { key: 'overview', label: 'Dashboard', Icon: LayoutGrid },
    { key: 'tariff', label: 'Master Tarif', Icon: Table2 },
    { key: 'plates', label: 'Master Plat', Icon: Hash },
    { key: 'routes', label: 'Master Rute', Icon: MapPin },
    { key: 'officers', label: 'Petugas', Icon: Users },
    { key: 'reports', label: 'Laporan', Icon: BarChart2 },

    { key: 'settings', label: 'Pengaturan', Icon: Settings },
  ]

  if (authDenied) return (
    <LoginPage onLogin={() => { setAuthDenied(false); setAuthRetry(k => k + 1) }} />
  )

  return sheetMode ? <ReportSheet /> : (
    <div className="flex bg-slate-900 min-h-screen">
        <div className="w-64 bg-[#0F172A] min-h-screen flex flex-col shrink-0 fixed left-0 top-0">
  <div className="p-6 border-b border-slate-800">
    <div className="flex items-center gap-4">

      <div className="w-11 h-11 rounded-lg bg-white flex items-center justify-center overflow-hidden shadow-lg">
        <img src="/Assets/karyamasv.svg" alt="Logo" className="w-full h-full object-contain" />
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
              className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-left text-[13px] ${
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
        <div className="p-8 max-w-[1400px]">
          {tab === 'overview' && (
            <OverviewTab
              serverTrips={serverTrips}
              dashSummary={dashSummary}
              dashAt={dashAt}
              activeOfficerCount={activeOfficerCount}
              officers={officers}
              serverState={serverState}
              revealed={revealed}
              onToggleReveal={() => setRevealed(r => !r)}
              onRefresh={() => void loadOverview()}
              onOpenReports={() => setTab('reports')}
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

          {tab === 'reports' && (
            <ReportsTab
              onServerTripsChange={setServerTrips}
              showToast={showToast}
              revealed={revealed}
              onToggleReveal={() => setRevealed(r => !r)}
              baseUrl={environment.apiBaseUrl}
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
