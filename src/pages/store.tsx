import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { allTrips, officerList, tariffData } from './data'
import { addToSyncQueue } from '../services/sync'
import { ensureBackendSession, logout as endBackendSession, refreshBackendSession } from '../services/auth'
import { api } from '../services/api'
import { syncOfficersToLocal } from '../services/officers'
import type { MobileScreen } from './types'

export interface VehicleEntry {
  plate: string
  type: string
  category: string
  tariff: number
  /** Foto dokumentasi kendaraan ini (dari kamera) */
  photoUrl?: string
  /** Hasil cek status plat saat input: internal / lokal / eksternal */
  plateStatus?: string
  /** Region asal kendaraan & pos pemeriksaan saat cek plat */
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
  /** Layar tujuan kembali setelah pengambilan foto kamera */
  cameraFrom: MobileScreen
  startedAt: number | null
}

type Officer = (typeof officerList)[number] & { regions?: string[] }
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
}

const emptyDraft: Draft = {
  routeCode: null,
  condition: null,
  vehicles: [],
  vehicleForm: { plate: '', type: '', category: '' },
  photo: false,
  photoUrl: undefined,
  cameraFrom: 'vehicle-form',
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
    // Exact match against master tariff (form options are built from it)
    list.find(t => t.type === vehicleType) ??
    // Partial match, e.g. legacy 'Truck' → 'Truck Kecil'/'Truck Sedang'/...
    list.find(t => t.type.startsWith(vehicleType)) ??
    list.find(t => vehicleType.startsWith(t.type)) ??
    list.find(t => t.type === 'Truck Sedang') ??
    // Master tariff wiped by admin — fall back to shipped defaults
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

const seedTrips: Trip[] = allTrips.map(t => ({
  ...t,
  load: t.load as Trip['load'],
  revenueNum: parseRp(t.revenue),
}))

export function AppProvider({ children }: { children: ReactNode }) {
  // Detect admin mode from the page title or known static signals
  const isAdminPage = typeof document !== 'undefined'
    && (document.title === 'Trip Angkutan' || document.querySelector('[data-admin]') !== null)
  const isAdminBuild = () => {
    try {
      return document.querySelector('[data-admin]') !== null
    } catch { return false }
  }

  const [loggedIn, setLoggedIn] = useState<boolean>(() => load(LS.session, false))
  const [userType, setUserType] = useState<'admin' | 'member'>(() => {
    if (isAdminBuild()) return 'admin'
    return load('trip.userType', 'member')
  })
  const [officerId, setOfficerIdState] = useState<string>(() => String(load(LS.officer, officerList[0].id)))
  const [trips, setTrips] = useState<Trip[]>(() => load(LS.trips, seedTrips))
  const [tariffs, setTariffs] = useState<TariffRow[]>(() => load(LS.tariffs, tariffData))
  const [officers, setOfficers] = useState<Officer[]>(() => load(LS.officers, officerList))
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [detailTripId, setDetailTripId] = useState<string | null>(null)
  const [pendingOfficerId, setPendingOfficerId] = useState<string | null>(null)
  const [verifyIntent, setVerifyIntent] = useState<VerifyIntent>('security')

  useEffect(() => {
    try { localStorage.setItem(LS.trips, JSON.stringify(trips)) } catch { /* quota */ }
  }, [trips])
  useEffect(() => {
    const onStorage = () => {
      setTrips(load(LS.trips, seedTrips))
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
    // Login screen is local-only — fetch a backend JWT so trip sync can authenticate
    if (type === 'member') void ensureBackendSession(officerId)
  }, [officerId])
  const logout = useCallback(() => {
    setLoggedIn(false)
    setUserType('member')
    // Clear session-scoped state so the next login starts clean
    setDetailTripId(null)
    setPendingOfficerId(null)
    setDraft(emptyDraft)
    endBackendSession()
  }, [])
  const setOfficerId = useCallback((id: string) => {
    setOfficerIdState(String(id))
    // Token must match the newly switched officer
    void ensureBackendSession(String(id))
  }, [])
  const resetDraft = useCallback(() => setDraft(emptyDraft), [])
  const patchDraft = useCallback((p: Partial<Draft>) => setDraft(d => ({ ...d, ...p })), [])
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
    // Add to sync queue for background upload
    addToSyncQueue(tripWithSync)
  }, [])
  const beginVerify = useCallback((opts: { pendingOfficerId: string | null; intent: VerifyIntent }) => {
    setPendingOfficerId(opts.pendingOfficerId)
    setVerifyIntent(opts.intent)
  }, [])
  const clearVerify = useCallback(() => setPendingOfficerId(null), [])
  const saveTariffs = useCallback((rows: TariffRow[]) => setTariffs(rows), [])
  const saveOfficers = useCallback((rows: Officer[]) => setOfficers(rows), [])

  // Ambil ulang daftar petugas dari server. `force = true` melewati cache
  // (dipakai layar Ganti Petugas agar status/wilayah terbaru langsung terbaca).
  const refreshOfficers = useCallback(async (force = false) => {
    if (isAdminBuild()) return
    const synced = await syncOfficersToLocal(force)
    if (synced.length === 0) return
    setOfficers(prev => {
      const hasCurrent = synced.some(o => String(o.id) === String(officerId))
      if (hasCurrent) return synced
      // Petugas aktif tidak boleh hilang dari daftar (mis. sementara offline)
      const current = prev.find(o => String(o.id) === String(officerId))
      return current ? [...synced, current] : synced
    })

    // Sinkronisasi paksa: wilayah petugas mungkin saja dipindah admin,
    // jadi terbitkan ulang JWT agar klaim region ikut terbaru.
    if (force) {
      const ok = await refreshBackendSession(String(officerId))

      // Akun dinonaktifkan admin — server menolak penerbitan token baru,
      // maka sesi petugas aktif harus dihentikan agar status admin dan
      // mobile selalu sinkron. Draft trip dipertahankan (belum tentu selesai).
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
    if (isAdminBuild()) return
    void refreshOfficers(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  }), [loggedIn, login, logout, userType, officer, setOfficerId, refreshOfficers, trips, commitTrip, tariffs, saveTariffs, officers, saveOfficers,
    draft, resetDraft, patchDraft, addVehicle, startTrip, markTripSynced, detailTripId, pendingOfficerId, verifyIntent, beginVerify, clearVerify])

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useApp(): StoreValue {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
