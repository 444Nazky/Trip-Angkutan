import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { allTrips, officerList, tariffData } from './data'
import { addToSyncQueue, onTripSynced } from '../services/sync'
import { ensureBackendSession, getStoredOfficer, logout as endBackendSession, refreshBackendSession } from '../services/auth'
import { api } from '../services/api'
import { syncOfficersToLocal } from '../services/officers'
import type { MobileScreen } from './types'
import type { Officer } from './types'

export interface VehicleEntry {
  plate: string
  type: string
  category: string
  tariff: number

  photoUrl?: string
  photoCapturedAt?: string
  photoLatitude?: number | null
  photoLongitude?: number | null

  plateStatus?: string

  originRegion?: string
  checkpointRegion?: string
}

export interface Trip {
  id: string
  route: string
  status: string
  time: string
  date: string
  load: 'Ada Muatan' | 'Kosong'
  vehicle: string
  type: string
  category: string
  revenue: string
  revenueNum: number
  officer: string
  duration: string
  photo: boolean
  photoUrl?: string
  photoCapturedAt?: string
  photoLatitude?: number | null
  photoLongitude?: number | null
  startedAt?: string
  completedAt?: string
  vehicles?: VehicleEntry[]
  synced?: boolean
}

export interface Draft {
  routeCode: string | null
  condition: 'kosong' | 'muatan' | null
  vehicles: VehicleEntry[]
  vehicleForm: { plate: string; type: string; category: string }
  photo: boolean
  photoUrl?: string
  photoCapturedAt?: string
  photoLatitude?: number | null
  photoLongitude?: number | null

  cameraFrom: MobileScreen

  cameraMode: 'photo' | 'ocr'

  ocrResult?: string

  ocrError?: string
  startedAt: number | null
}

export type TariffRow = (typeof tariffData)[number] & { id?: string }
export type VerifyIntent = 'switch' | 'security'

interface StoreValue {
  loggedIn: boolean
  login: (userType: 'admin' | 'member') => void
  logout: () => void
  userType: 'admin' | 'member'
  officer: Officer
  setOfficerId: (id: string) => void
  refreshOfficers: (force?: boolean) => Promise<void>
  trips: Trip[]
  commitTrip: (t: Trip) => void
  tariffs: TariffRow[]
  saveTariffs: (rows: TariffRow[]) => void
  officers: Officer[]
  saveOfficers: (rows: Officer[]) => void
  draft: Draft
  resetDraft: () => void
  patchDraft: (p: Partial<Draft>) => void
  addVehicle: (v: VehicleEntry) => void
  startTrip: () => void
  markTripSynced: (id: string) => void
  detailTripId: string | null
  setDetailTripId: (id: string | null) => void
  pendingOfficerId: string | null
  verifyIntent: VerifyIntent
  beginVerify: (opts: { pendingOfficerId: string | null; intent: VerifyIntent }) => void
  clearVerify: () => void

  activeDermagaId: string | null
  setActiveDermaga: (id: string | null) => void
}

const emptyDraft: Draft = {
  routeCode: null,
  condition: null,
  vehicles: [],
  vehicleForm: { plate: '', type: '', category: '' },
  photo: false,
  photoUrl: undefined,
  photoCapturedAt: undefined,
  photoLatitude: undefined,
  photoLongitude: undefined,
  cameraFrom: 'vehicle-form',
  cameraMode: 'photo',
  startedAt: null,
}

const StoreCtx = createContext<StoreValue | null>(null)

const LS = {
  trips: 'trip.trips.v1',
  officer: 'trip.officerId.v1',
  session: 'trip.session.v1',
  tariffs: 'trip.tariffs.v1',
  officers: 'trip.officers.v1',
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function parseRp(s: string): number {
  const digits = s.replace(/[^\d]/g, '')
  return digits ? parseInt(digits, 10) : 0
}

export function formatRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

export function compactRp(n: number): string {
  if (n >= 1_000_000) return `Rp ${(n / 1_000_000).toFixed(1).replace('.0', '')}jt`
  if (n >= 1_000) return `${Math.round(n / 1_000)}rb`
  return String(n)
}

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

export function fmtDate(d: Date): string {
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`
}

export function fmtTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function durationToSeconds(s: string): number {
  const h = /(\d+)j/.exec(s)
  const m = /(\d+)m/.exec(s)
  return ((h ? parseInt(h[1], 10) : 0) * 60 + (m ? parseInt(m[1], 10) : 0)) * 60
}

export function kmNumber(s: string): number {
  return parseInt(s, 10) || 0
}

export function fmtElapsed(totalSec: number): string {
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}j ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m`
  return `${s}dtk`
}

export function tariffFor(vehicleType: string) {
  const list = load(LS.tariffs, tariffData)
  return (

    list.find(t => t.type === vehicleType) ??

    list.find(t => t.type.startsWith(vehicleType)) ??
    list.find(t => vehicleType.startsWith(t.type)) ??
    list.find(t => t.type === 'Truck Sedang') ??

    tariffData.find(t => t.type === 'Truck Sedang') ??
    tariffData[0]
  )
}

export function nextTripId(trips: Trip[]): string {
  let max = 0
  for (const t of trips) {
    const m = /TRP-(\d{4})-(\d{4})/.exec(t.id)
    if (m) max = Math.max(max, parseInt(m[2], 10))
  }
  return `TRP-${new Date().getFullYear()}-${String(max + 1).padStart(4, '0')}`
}

const seedTrips: Trip[] = (allTrips as Trip[]).map(t => ({
  ...t,
  load: t.load as Trip['load'],
  revenueNum: parseRp(t.revenue),
}))



export function normalizeCategory(c?: string): string | undefined {
  if (!c) return c

  
  if (!/^ekst/i.test(c)) return c
  return /tanpa|bebas/i.test(c) ? 'Eksternal Bebas' : 'Eksternal'
}

function normalizeTrips(list: Trip[]): Trip[] {
  return list.map(t => ({
    ...t,
    category: normalizeCategory(t.category) ?? t.category,
    vehicles: t.vehicles?.map(v => ({ ...v, category: normalizeCategory(v.category) ?? v.category })),
  }))
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean>(() => load(LS.session, false))
  const [userType, setUserType] = useState<'admin' | 'member'>(() => load('trip.userType', 'member'))
  const [officerId, setOfficerIdState] = useState<string>(() => String(load(LS.officer, officerList[0].id)))
  const [trips, setTrips] = useState<Trip[]>(() => normalizeTrips(load(LS.trips, seedTrips)))
  const [tariffs, setTariffs] = useState<TariffRow[]>(() => load(LS.tariffs, tariffData))
  const [officers, setOfficers] = useState<Officer[]>(() => load(LS.officers, officerList))
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [detailTripId, setDetailTripId] = useState<string | null>(null)
  const [pendingOfficerId, setPendingOfficerId] = useState<string | null>(null)
  const [verifyIntent, setVerifyIntent] = useState<VerifyIntent>('security')
  const [activeDermagaId, setActiveDermagaId] = useState<string | null>(null)

  // Prefetch daftar petugas dipanggil dari `login()` (didefinisikan sebelum
  // refreshOfficers) — ref memutus urutan deklarasi tanpa TDZ.
  const refreshOfficersRef = useRef<((force?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    try { localStorage.setItem(LS.trips, JSON.stringify(trips)) } catch { /* quota */ }
  }, [trips])
  useEffect(() => {
    const onStorage = () => {
      setTrips(normalizeTrips(load(LS.trips, seedTrips)))
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])
  useEffect(() => {
    try { localStorage.setItem(LS.tariffs, JSON.stringify(tariffs)) } catch { /* quota */ }
  }, [tariffs])
  useEffect(() => {
    try { localStorage.setItem(LS.officers, JSON.stringify(officers)) } catch { /* quota */ }
  }, [officers])
  useEffect(() => {
    try { localStorage.setItem(LS.officer, JSON.stringify(officerId)) } catch { /* quota */ }
  }, [officerId])
  useEffect(() => {
    try { localStorage.setItem(LS.session, JSON.stringify(loggedIn)) } catch { /* quota */ }
  }, [loggedIn])
  useEffect(() => {
    try { localStorage.setItem('trip.userType', userType) } catch { /* quota */ }
  }, [userType])

  const officer = useMemo(
    () => officers.find(o => String(o.id) === String(officerId)) ?? officers[0] ?? officerList[0],
    [officers, officerId],
  )

  const login = useCallback((type: 'admin' | 'member') => {
    setUserType(type)
    setLoggedIn(true)
    if (type === 'member') {
      const authenticatedOfficerId = getStoredOfficer()?.id
      const id = authenticatedOfficerId ? String(authenticatedOfficerId) : officerId
      if (authenticatedOfficerId) setOfficerIdState(id)

      
      void ensureBackendSession(id)
      // PREFETCH saat login online: unduh daftar rekan sekawasan ke penyimpanan
      // lokal SEBELUM dipakai — supaya saat offline layar Ganti Petugas tetap
      // menampilkan petugas yang sah (filter region + dermaga irisan).
      void refreshOfficersRef.current?.(true)
    }
  }, [officerId])
  const logout = useCallback(() => {
    setLoggedIn(false)
    setUserType('member')

    
    setDetailTripId(null)
    setPendingOfficerId(null)
    setDraft(emptyDraft)
    endBackendSession()
  }, [])
  const setOfficerId = useCallback((id: string) => {
    setOfficerIdState(String(id))

    
    void ensureBackendSession(String(id))
  }, [])
  const resetDraft = useCallback(() => {
    setDraft(emptyDraft)
    setActiveDermagaId(null)
  }, [])
  const patchDraft = useCallback((p: Partial<Draft>) => setDraft(d => ({ ...d, ...p })), [])
  const setActiveDermaga = useCallback((id: string | null) => setActiveDermagaId(id), [])
  const addVehicle = useCallback(
    (v: VehicleEntry) => setDraft(d => ({ ...d, vehicles: [...d.vehicles, v] })),
    [],
  )
  const startTrip = useCallback(() => setDraft(d => ({ ...d, startedAt: d.startedAt ?? Date.now() })), [])
  const markTripSynced = useCallback((id: string) => {
    setTrips(prev => prev.map(t => (t.id === id ? { ...t, synced: true } : t)))
  }, [])
  const commitTrip = useCallback((t: Trip) => {
    const tripWithSync = { ...t, synced: false }
    setTrips(prev => [tripWithSync, ...prev])
    setDetailTripId(t.id)
    setDraft(emptyDraft)

    
    addToSyncQueue(tripWithSync)
  }, [])
  const beginVerify = useCallback((opts: { pendingOfficerId: string | null; intent: VerifyIntent }) => {
    setPendingOfficerId(opts.pendingOfficerId)
    setVerifyIntent(opts.intent)
  }, [])
  const clearVerify = useCallback(() => setPendingOfficerId(null), [])
  const saveTariffs = useCallback((rows: TariffRow[]) => setTariffs(rows), [])
  const saveOfficers = useCallback((rows: Officer[]) => setOfficers(rows), [])

  

  const refreshOfficers = useCallback(async (force = false) => {
    const synced = await syncOfficersToLocal(force)
    if (synced.length === 0) return

    const syncedWithDermaga = synced.map(o => ({ ...o, dermagaAccess: o.dermagaAccess || [] }))

    setOfficers(prev => {
      const hasCurrent = syncedWithDermaga.some(o => String(o.id) === String(officerId))
      if (hasCurrent) return syncedWithDermaga
      const current = prev.find(o => String(o.id) === String(officerId))
      if (current) {
        return [...syncedWithDermaga, { ...current, dermagaAccess: current.dermagaAccess || [] }]
      }
      return syncedWithDermaga
    })


    


    if (force) {
      const ok = await refreshBackendSession(String(officerId))


      


      const me = synced.find(o => String(o.id) === String(officerId))
      if (!ok && me && me.status !== 'Aktif' && !api.isAuthenticated) {
        setLoggedIn(false)
        setDetailTripId(null)
        setPendingOfficerId(null)
        endBackendSession()
      }
    }
  }, [officerId])

  // Sync officers from backend on app start (mobile only) — tarik paksa agar
  // status/wilayah terbaru dari admin langsung terbaca saat aplikasi dibuka.
  useEffect(() => {
    void refreshOfficers(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshOfficers])

  useEffect(() => {
    refreshOfficersRef.current = refreshOfficers
  }, [refreshOfficers])

  // Trip berhasil di server - tandai synced:true di store.
  useEffect(() => {
    const unsub = onTripSynced(id => markTripSynced(id))
    return unsub
  }, [markTripSynced])

  // Pantau koneksi: begitu perangkat ONLINE lagi, selain antrean trip otomatis
  // terkirim (services/sync), daftar petugas juga ditarik ulang — aktif/nonaktif
  // & pemindahan region dari dashboard admin langsung sinkron real-time.
  useEffect(() => {
    const onOnline = () => { void refreshOfficers(true) }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [refreshOfficers])

  const value = useMemo<StoreValue>(() => ({
    loggedIn, login, logout, userType,
    officer, setOfficerId, refreshOfficers,
    trips, commitTrip,
    tariffs, saveTariffs,
    officers, saveOfficers,
    draft, resetDraft, patchDraft, addVehicle, startTrip, markTripSynced,
    detailTripId, setDetailTripId,
    pendingOfficerId, verifyIntent, beginVerify, clearVerify,
    activeDermagaId, setActiveDermaga,
  }), [loggedIn, login, logout, userType, officer, setOfficerId, refreshOfficers, trips, commitTrip, tariffs, saveTariffs, officers, saveOfficers,
    draft, resetDraft, patchDraft, addVehicle, startTrip, markTripSynced, detailTripId, pendingOfficerId, verifyIntent, beginVerify, clearVerify,
    activeDermagaId, setActiveDermaga])

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useApp(): StoreValue {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
