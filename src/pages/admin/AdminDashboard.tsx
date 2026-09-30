import { useState, useEffect } from 'react'
import { Truck, LayoutGrid, Table2, Hash, Users, BarChart2, Settings, LogOut, Check, X } from 'lucide-react'
import { useApp } from '../store'
import { fetchTariffs, fetchRegionTariffs } from '../../services/tariffs'
import { fetchRegions } from '../../services/regions'
import { fetchPlates } from '../../services/plates'
import { fetchTrips, fetchReportFilters, fetchReportSummary, dayKeyWib } from '../../services/trips'
import { ensureAdminBackendSession } from '../../services/auth'
import { api } from '../../services/api'
import type { AdminTab } from './components/types'
import type { TariffRow, RegionTariffRow, BackendOfficerRow, Region } from './components/types'
import type { BackendTrip } from '../../services/trips'
import type { PlateRecord } from '../../services/plates'
import type { Officer } from './components/types'
import { CurrencyProvider } from './components/CurrencyDisplay'
import { getApiBaseUrl } from '../../services/api'
import { loadTheme, applyTheme } from '../../services/theme'
import ReportSheet from './ReportSheet'

// Tabs
import { OverviewTab, TariffTab, PlatesTab, RoutesTab, OfficersTab, ReportsTab, SettingsTab } from './tabs'

export default function AdminDashboard({ onLogout }: { onLogout: () => void }) {
  const { trips: localTrips, tariffs, saveTariffs, officers, saveOfficers } = useApp()
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null)
  const [tab, setTab] = useState<AdminTab>('overview')
  const [serverState, setServerState] = useState<'connecting' | 'online' | 'offline'>('connecting')
  const [serverTrips, setServerTrips] = useState<BackendTrip[]>([])
  const [tariffs2, setTariffs2] = useState<TariffRow[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [plates, setPlates] = useState<PlateRecord[]>([])
  const [backendOfficers, setBackendOfficers] = useState<BackendOfficerRow[]>([])
  const [dashSummary, setDashSummary] = useState<{ totalTrips: number; totalRevenue: number; totalVehicles: number } | null>(null)
  const [dashAt, setDashAt] = useState('')

  // Mode Spreadsheet Live (tab baru dibuka dari tombol "Ekspor Spreadsheet" — `#/sheet`)
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

  // Merge backend officers
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
      const ok = await ensureAdminBackendSession()
      if (!alive) return
      if (!ok) { setServerState('offline'); return }

      const [tarr, regn, tri] = await Promise.all([fetchTariffs(), fetchRegions(), fetchTrips()])
      if (!alive) return
      if (tarr !== null && tarr.length > 0) { setTariffs2(tarr); saveTariffs(tarr) }
      if (regn) setRegions(regn)
      if (tri !== null) setServerTrips(tri)

      const [offs, filts] = await Promise.all([api.get<BackendOfficerRow[]>('/officers'), fetchReportFilters()])
      if (alive && offs.ok && offs.data) {
        setBackendOfficers(offs.data)
        saveOfficers(mergeBackendOfficers(offs.data, officers))
      }

      setServerState('online')
    })()
    return () => { alive = false }
  }, [])

  const activeOfficerCount = officers.filter(o => o.status === 'Aktif').length

  const loadOverview = async () => {
    const ok = await ensureAdminBackendSession()
    if (!ok) { setServerState('offline'); return }
    // Ringkasan khusus HARI INI (WIB) — dipakai kartu "Trip/Pendapatan/Unit Hari Ini"
    const today = dayKeyWib(new Date().toISOString())
    const [trips, summ] = await Promise.all([fetchTrips(), fetchReportSummary(today, today)])
    if (trips) setServerTrips(trips)
    setServerState('online')
    setDashSummary(summ)
    setDashAt(new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }))
  }

  useEffect(() => {
    if (tab !== 'overview') return
    void loadOverview()
    const id = setInterval(() => void loadOverview(), 15000)
    return () => clearInterval(id)
  }, [tab])

  const navItems: { key: AdminTab; label: string; Icon: any }[] = [
    { key: 'overview', label: 'Dashboard', Icon: LayoutGrid },
    { key: 'tariff', label: 'Master Tarif', Icon: Table2 },
    { key: 'plates', label: 'Master Plat', Icon: Hash },
    { key: 'routes', label: 'Master Rute', Icon: Hash },
    { key: 'officers', label: 'Petugas', Icon: Users },
    { key: 'reports', label: 'Laporan', Icon: BarChart2 },
    { key: 'settings', label: 'Pengaturan', Icon: Settings },
  ]

  return sheetMode ? <ReportSheet /> : (
    <CurrencyProvider>
      <div className="flex bg-slate-900 min-h-screen">
        <div className="w-60 bg-[#0F172A] min-h-screen flex flex-col shrink-0 fixed left-0 top-0">
  <div className="p-6 border-b border-slate-800">
    <div className="flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center overflow-hidden">
        <img src="/Assets/karyamas.jpeg" alt="Logo Karyamas" className="w-full h-full object-cover" />
      </div>

      <div>
        <p className="text-white font-black text-[13px]">Dashboard Trip</p>
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

      {/* Content — latar off-white agar kartu putih punya kontras & batas jelas */}
      <div className="flex-1 ml-60 bg-slate-50 min-h-screen">
        <div className="p-8 max-w-[1400px]">
          {tab === 'overview' && (
            <OverviewTab
              serverTrips={serverTrips}
              dashSummary={dashSummary}
              dashAt={dashAt}
              activeOfficerCount={activeOfficerCount}
              officers={officers}
              serverState={serverState}
              onRefresh={() => void loadOverview()}
              onOpenReports={() => setTab('reports')}
            />
          )}

          {tab === 'tariff' && (
            <TariffTab
              tariffs={tariffs2.length > 0 ? tariffs2 : tariffs}
              serverState={serverState}
              onSaveTariffs={(t) => { setTariffs2(t); saveTariffs(t) }}
              showToast={showToast}
            />
          )}

          {tab === 'plates' && (
            <PlatesTab
              plates={plates}
              serverState={serverState}
              onPlatesChange={setPlates}
              showToast={showToast}
            />
          )}

          {tab === 'routes' && (
            <RoutesTab serverState={serverState} showToast={showToast} />
          )}

          {tab === 'officers' && (
            <OfficersTab
              officers={officers}
              serverState={serverState}
              onSaveOfficers={saveOfficers}
              showToast={showToast}
            />
          )}

          {tab === 'reports' && (
            <ReportsTab
              serverState={serverState}
              serverTrips={serverTrips}
              onServerTripsChange={setServerTrips}
              showToast={showToast}
              baseUrl={getApiBaseUrl()}
            />
          )}

          {tab === 'settings' && (
            <SettingsTab
              onLogout={onLogout}
              serverState={serverState}
              tariffs={tariffs2.length > 0 ? tariffs2 : tariffs}
              officers={officers}
              localTrips={localTrips}
              showToast={showToast}
            />
          )}
        </div>
      </div>
    </div>
  </CurrencyProvider>
  )
}