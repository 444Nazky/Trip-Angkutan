import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { allTrips, officerList, tariffData } from './data'
import { addToSyncQueue, onTripSynced, retrySyncItem, notifyQueueListeners } from '../services/sync'
import { ensureBackendSession, getStoredOfficer, logout as endBackendSession, refreshBackendSession, SESSION_READY_EVENT } from '../services/auth'
import { api } from '../services/api'
import { dbAll, dbClear, dbPutMany, initLocalDb } from '../services/localDb'
import { syncOfficersToLocal } from '../services/officers'
import { syncGeofencesFromBackend } from '../services/geofence'
import { seedRoster } from '../services/seedData'
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
  routeCode?: string
  routeFrom?: string
  routeTo?: string
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
  officerId?: string
  selfieUrl?: string
  selfieCapturedAt?: string
  updatedAt?: number
}




export interface Draft {
  routeCode: string | null
  condition: 'kosong' | 'muatan' | null
  vehicles: VehicleEntry[]
  vehicleForm: { plate: string; type: string; category: string }
  editVehicleIndex?: number | null
  photo: boolean
  photoUrl?: string
  photoCapturedAt?: string
  photoLatitude?: number | null
  photoLongitude?: number | null
  vPhoto: boolean
  vPhotoUrl?: string
  vPhotoCapturedAt?: string
  vPhotoLatitude?: number | null
  vPhotoLongitude?: number | null
  retakeTarget?: { tripId: string; kind: 'trip' | 'vehicle'; index?: number }
  vehiclePhotoTarget?: number
  selfieMode?: boolean
  selfieUrl?: string
  selfieCapturedAt?: string
  cameraReturn?: MobileScreen

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
  tariffs: TariffRow[]
  officers: Officer[]
  saveOfficers: (rows: Officer[]) => void
  draft: Draft
  resetDraft: () => void
  patchDraft: (p: Partial<Draft>) => void
  addVehicle: (v: VehicleEntry) => void
  patchDraftVehicle: (index: number, fields: Partial<VehicleEntry>) => void
  removeDraftVehicle: (index: number) => void
  editDraftVehicle: (index: number) => void
  startTrip: () => void
  finishEmptyTrip: () => void
  finishMuatanTrip: () => void
  patchTripPhoto: (tripId: string, fields: Partial<Trip>) => void
  patchVehiclePhoto: (tripId: string, vehicleIndex: number, fields: Partial<VehicleEntry>) => void
  detailTripId: string | null
  setDetailTripId: (id: string | null) => void
  pendingOfficerId: string | null
  verifyIntent: VerifyIntent
  beginVerify: (opts: { pendingOfficerId: string | null; intent: VerifyIntent }) => void
  clearVerify: () => void

  setActiveDermaga: (id: string | null) => void
  clearAllTrips: () => void
}

const emptyDraft: Draft = {
  routeCode: null,
  condition: null,
  vehicles: [],
  vehicleForm: { plate: '', type: '', category: '' },
  editVehicleIndex: null,
  photo: false,
  photoUrl: undefined,
  photoCapturedAt: undefined,
  photoLatitude: undefined,
  photoLongitude: undefined,
  vPhoto: false,
  vPhotoUrl: undefined,
  vPhotoCapturedAt: undefined,
  vPhotoLatitude: undefined,
  vPhotoLongitude: undefined,
  retakeTarget: undefined,
  vehiclePhotoTarget: undefined,
  selfieMode: undefined,
  selfieUrl: undefined,
  selfieCapturedAt: undefined,
  cameraReturn: undefined,
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




export function unitLabel(list: VehicleEntry[] | undefined, index: number): string {
  const arr = list ?? []
  const v = arr[index]
  if (!v) return `Kendaraan ${index + 1}`
  const key = (v.type ?? '').trim().toLowerCase()
  let n = 0
  for (let i = 0; i <= index; i++) {
    if ((arr[i]?.type ?? '').trim().toLowerCase() === key) n++
  }
  const name = (v.type || 'Kendaraan').replace(/^Truck/i, 'Truk')
  return `${name} ${n}`
}




function normalizeTrips(list: Trip[]): Trip[] {
  return list.map(t => ({
    ...t,
    category: normalizeCategory(t.category) ?? t.category,
    vehicles: t.vehicles?.map(v => ({ ...v, category: normalizeCategory(v.category) ?? v.category })),
  }))
}




export function mergeTrips(a: Trip[], b: Trip[]): Trip[] {
  const byId = new Map<string, Trip>()
  for (const t of [...a, ...b]) {
    const key = String(t.id)
    const prev = byId.get(key)
    if (!prev) { byId.set(key, t); continue }
    const prevUpd = prev.updatedAt ?? 0
    const nextUpd = t.updatedAt ?? 0
    if (prevUpd !== nextUpd) { byId.set(key, prevUpd > nextUpd ? prev : t); continue }
    const prevTs = Date.parse(prev.completedAt ?? '') || 0
    const nextTs = Date.parse(t.completedAt ?? '') || 0
    const winner =
      prev.synced === true && t.synced !== true ? prev :
      t.synced === true && prev.synced !== true ? t :
      nextTs >= prevTs ? t : prev
    byId.set(key, winner)
  }
  return [...byId.values()]
}




export function healDermagaAccess(list: Officer[]): Officer[] {
  const byId = new Map(seedRoster().map(s => [String(s.id), s.dermagaAccess ?? []]))
  return list.map(o => {
    if (o.dermagaAccess?.length) return o
    const fromSeed = byId.get(String(o.id))
    return fromSeed?.length ? { ...o, dermagaAccess: fromSeed } : o
  })
}




export function AppProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean>(() => load(LS.session, false))
  const [userType, setUserType] = useState<'admin' | 'member'>(() => load('trip.userType', 'member'))
  const [officerId, setOfficerIdState] = useState<string>(() => String(load(LS.officer, officerList[0].id)))
  const [trips, setTrips] = useState<Trip[]>(() => normalizeTrips(load(LS.trips, seedTrips)))
  const [tariffs] = useState<TariffRow[]>(() => load(LS.tariffs, tariffData))
  const [officers, setOfficers] = useState<Officer[]>(() => {
    const saved = load<Officer[]>(LS.officers, [])
    return healDermagaAccess(saved.length ? saved : (seedRoster() as unknown as Officer[]))
  })
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const tripsRef = useRef<Trip[]>(trips)
  useEffect(() => { tripsRef.current = trips }, [trips])
  const [detailTripId, setDetailTripId] = useState<string | null>(null)
  const [pendingOfficerId, setPendingOfficerId] = useState<string | null>(null)
  const [verifyIntent, setVerifyIntent] = useState<VerifyIntent>('security')
  const [, setActiveDermagaId] = useState<string | null>(null)

  const refreshOfficersRef = useRef<((force?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    void initLocalDb()
    try {
      localStorage.setItem(LS.trips, JSON.stringify(trips))
    } catch (err) {
      console.warn('[store] localStorage penuh — data aman di IndexedDB:', err)
    }
    void dbPutMany<Trip>('trips', trips)
  }, [trips])

  useEffect(() => {
    let alive = true
    void (async () => {
      const stored = await dbAll<Trip>('trips')
      if (!alive || !stored.length) return
      setTrips(prev => {
        const merged = mergeTrips(normalizeTrips(stored), prev)
        return merged.length === prev.length ? prev : merged
      })
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onStorage = () => {
      setTrips(prev => mergeTrips(prev, normalizeTrips(load(LS.trips, seedTrips))))
      setLoggedIn(load(LS.session, false))
      const so = getStoredOfficer()
      if (so?.id) {
        setOfficerIdState(prev => (String(prev) === String(so.id) ? prev : String(so.id)))
        void ensureBackendSession(String(so.id))
      }
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

  const officer = useMemo(() => {
    const inRoster = officers.find(o => String(o.id) === String(officerId))
    if (inRoster) return inRoster
    try {
      const so = getStoredOfficer()
      if (so?.id && String(so.id) === String(officerId)) {
        return {
          id: String(so.id),
          name: so.name,
          username: (so as { username?: string }).username,
          initials: so.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
          region: so.regionCode || so.regionId || '',
          regions: so.regionCode ? [so.regionCode] : [],
          pin: '',
          status: 'Aktif',
          device: '-',
          trips: 0,
          lastActive: '-',
          joined: '-',
          dermagaAccess: (so as { dermagaAccess?: Officer['dermagaAccess'] }).dermagaAccess ?? [],
        } as Officer
      }
    } catch { /* fallthrough */ }
    return officers[0] ?? officerList[0]
  }, [officers, officerId])

  const login = useCallback((type: 'admin' | 'member') => {
    setUserType(type)
    setLoggedIn(true)
    if (type === 'member') {
      const authenticatedOfficerId = getStoredOfficer()?.id
      const id = authenticatedOfficerId ? String(authenticatedOfficerId) : officerId
      if (authenticatedOfficerId) setOfficerIdState(id)

      void ensureBackendSession(id)
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
  const patchDraftVehicle = useCallback(
    (index: number, fields: Partial<VehicleEntry>) => setDraft(d => ({
      ...d,
      vehicles: d.vehicles.map((v, i) => (i === index ? { ...v, ...fields } : v)),
    })),
    [],
  )
  const removeDraftVehicle = useCallback((index: number) => setDraft(d => {
    const vehicles = d.vehicles.filter((_, i) => i !== index)
    return {
      ...d,
      vehicles,
      editVehicleIndex: d.editVehicleIndex != null && d.editVehicleIndex >= vehicles.length
        ? null
        : d.editVehicleIndex,
    }
  }), [])
  const editDraftVehicle = useCallback((index: number) => setDraft(d => {
    const v = d.vehicles[index]
    if (!v) return d
    return {
      ...d,
      editVehicleIndex: index,
      vehicleForm: { plate: v.plate, type: v.type, category: v.category },
      vPhoto: !!v.photoUrl,
      vPhotoUrl: v.photoUrl,
      vPhotoCapturedAt: v.photoCapturedAt,
      vPhotoLatitude: v.photoLatitude,
      vPhotoLongitude: v.photoLongitude,
      cameraFrom: 'vehicle-form',
      cameraMode: 'photo',
      cameraReturn: 'vehicle-form',
    }
  }), [])
  const startTrip = useCallback(() => setDraft(d => ({ ...d, startedAt: d.startedAt ?? Date.now() })), [])
  const commitTrip = useCallback((
    t: Trip,
    photos?: { dataUrl: string; mimeType: string }[],
    tripPhoto?: { dataUrl: string; mimeType: string },
  ) => {
    const tripWithSync = { ...t, synced: false }
    setTrips(prev => [tripWithSync, ...prev])
    setDetailTripId(t.id)
    setDraft(emptyDraft)
    const photoList = photos?.length
      ? photos
      : (t.vehicles ?? []).map(v => ({ dataUrl: v.photoUrl ?? '', mimeType: 'image/jpeg' }))
    const tripPhotoEntry = tripPhoto ?? (t.photoUrl ? { dataUrl: t.photoUrl, mimeType: 'image/jpeg' } : undefined)
    void addToSyncQueue(tripWithSync, photoList, tripPhotoEntry)
  }, [])
  const finishEmptyTrip = useCallback(() => {
    if (!draft.photoUrl) {
      console.warn('[trip] finishEmptyTrip dipanggil tanpa foto bukti — dibatalkan')
      return
    }
    const now = new Date()
    const id = nextTripId(tripsRef.current)
    const routeCode = draft.routeCode ?? ''
    const sepIdx = routeCode.lastIndexOf('-')
    const routeFrom = sepIdx > 0 ? routeCode.slice(0, sepIdx).trim() : ''
    const routeTo = sepIdx > 0 ? routeCode.slice(sepIdx + 1).trim() : ''
    const routeLabel = sepIdx > 0
      ? `${routeFrom} → ${routeTo}`
      : routeCode || 'Tidak Diketahui'
    const trip: Trip = {
      id,
      route: routeLabel,
      routeCode,
      routeFrom,
      routeTo,
      status: 'Selesai',
      time: fmtClock(now),
      date: fmtDate(now),
      load: 'Kosong',
      vehicle: '-',
      type: '-',
      category: '-',
      revenue: '-',
      revenueNum: 0,
      officer: officer.name,
      officerId: String(officer.id),
      duration: '-',
      photo: !!draft.photoUrl,
      photoUrl: draft.photoUrl,
      photoCapturedAt: draft.photoCapturedAt,
      photoLatitude: draft.photoLatitude ?? null,
      photoLongitude: draft.photoLongitude ?? null,
      startedAt: draft.startedAt ? new Date(draft.startedAt).toISOString() : now.toISOString(),
      completedAt: now.toISOString(),
      vehicles: [],
      synced: false,
    }
    commitTrip(trip)
  }, [draft, officer.name, commitTrip])
  const finishMuatanTrip = useCallback(() => {
    if (draft.condition !== 'muatan') return
    if (!draft.photoUrl) {
      console.warn('[trip] finishMuatanTrip ditolak: foto bukti trip belum diambil')
      return
    }
    const now = new Date()
    const id = nextTripId(tripsRef.current)
    const routeCode = draft.routeCode ?? ''
    const sepIdx = routeCode.lastIndexOf('-')
    const routeFrom = sepIdx > 0 ? routeCode.slice(0, sepIdx).trim() : ''
    const routeTo = sepIdx > 0 ? routeCode.slice(sepIdx + 1).trim() : ''
    const routeLabel = sepIdx > 0 ? `${routeFrom} → ${routeTo}` : routeCode || 'Tidak Diketahui'
    const startedAt = draft.startedAt ? new Date(draft.startedAt) : now
    const elapsed = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000))
    const vehicles = draft.vehicles
    const total = vehicles.reduce((sum, v) => sum + (v.tariff ?? 0), 0)
    const trip: Trip = {
      id,
      route: routeLabel,
      routeCode,
      routeFrom,
      routeTo,
      status: 'Selesai',
      time: fmtClock(now),
      date: fmtDate(now),
      load: 'Ada Muatan',
      vehicle: vehicles[0]?.plate ?? '-',
      type: vehicles[0]?.type ?? '-',
      category: vehicles[0]?.category ?? '-',
      revenue: formatRp(total),
      revenueNum: total,
      officer: officer.name,
      officerId: String(officer.id),
      duration: fmtElapsed(elapsed),
      photo: !!draft.photoUrl,
      photoUrl: draft.photoUrl,
      photoCapturedAt: draft.photoCapturedAt,
      photoLatitude: draft.photoLatitude ?? null,
      photoLongitude: draft.photoLongitude ?? null,
      startedAt: startedAt.toISOString(),
      completedAt: now.toISOString(),
      vehicles,
      synced: false,
      selfieUrl: draft.selfieUrl,
      selfieCapturedAt: draft.selfieCapturedAt,
    }
    commitTrip(trip)
  }, [draft, officer.name, commitTrip])
  const markTripSynced = useCallback((id: string) => {
    setTrips(prev => prev.map(t => (t.id === id ? { ...t, synced: true } : t)))
  }, [])
  const patchTripPhoto = useCallback((tripId: string, fields: Partial<Trip>) => {
    const current = tripsRef.current.find(t => t.id === tripId)
    if (!current) return
    const updated: Trip = { ...current, ...fields, synced: false, updatedAt: Date.now() }
    setTrips(prev => prev.map(t => (t.id === tripId ? updated : t)))
    void retrySyncItem(updated)
  }, [])
  const patchVehiclePhoto = useCallback((tripId: string, vehicleIndex: number, fields: Partial<VehicleEntry>) => {
    const current = tripsRef.current.find(t => t.id === tripId)
    if (!current?.vehicles?.[vehicleIndex]) return
    const vehicles = current.vehicles.map((v, i) => (i === vehicleIndex ? { ...v, ...fields } : v))
    const updated: Trip = { ...current, vehicles, synced: false, updatedAt: Date.now() }
    setTrips(prev => prev.map(t => (t.id === tripId ? updated : t)))
    void retrySyncItem(updated)
  }, [])
  const beginVerify = useCallback((opts: { pendingOfficerId: string | null; intent: VerifyIntent }) => {
    setPendingOfficerId(opts.pendingOfficerId)
    setVerifyIntent(opts.intent)
  }, [])
  const clearVerify = useCallback(() => setPendingOfficerId(null), [])
  const saveOfficers = useCallback((rows: Officer[]) => setOfficers(rows), [])

  const clearAllTrips = useCallback(() => {
    setTrips([])
    setDetailTripId(null)
    try { localStorage.removeItem(LS.trips) } catch { /* ignore */ }
    void dbClear('trips')
    void dbClear('pending')
    notifyQueueListeners()
  }, [])

  const refreshOfficers = useCallback(async (force = false) => {
    let synced
    try {
      synced = await syncOfficersToLocal(force)
    } catch (err) {
      console.warn('[officers] Sinkronisasi gagal:', err)
      return
    }
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
      // tarik manual = segarkan semua: petugas + titik (tanpa logout)
      // ponytail: foreground = force agar edit admin langsung sampai
      void syncGeofencesFromBackend({ force: true })

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

  useEffect(() => {
    void refreshOfficers(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshOfficers])

  useEffect(() => {
    refreshOfficersRef.current = refreshOfficers
  }, [refreshOfficers])

  useEffect(() => {
    const unsub = onTripSynced(id => markTripSynced(id))
    return unsub
  }, [markTripSynced])

  useEffect(() => {
    const pullAuthorizedMasterData = () => {
      void refreshOfficers(true)
      // ponytail: online/kembali-sesi = force, lihat catatan di atas
      void syncGeofencesFromBackend({ force: true })
    }
    const onOnline = () => pullAuthorizedMasterData()
    const onSessionReady = () => pullAuthorizedMasterData()
    window.addEventListener('online', onOnline)
    window.addEventListener(SESSION_READY_EVENT, onSessionReady)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener(SESSION_READY_EVENT, onSessionReady)
    }
  }, [refreshOfficers])

  const value = useMemo<StoreValue>(() => ({
    loggedIn, login, logout, userType,
    officer, setOfficerId, refreshOfficers,
    trips,
    tariffs,
    officers, saveOfficers,
    draft, resetDraft, patchDraft, addVehicle, patchDraftVehicle, removeDraftVehicle, editDraftVehicle,
    startTrip, finishEmptyTrip, finishMuatanTrip,
    patchTripPhoto, patchVehiclePhoto,
    detailTripId, setDetailTripId,
    pendingOfficerId, verifyIntent, beginVerify, clearVerify,
    setActiveDermaga,
    clearAllTrips,
  }), [loggedIn, login, logout, userType, officer, setOfficerId, refreshOfficers, trips, tariffs, officers, saveOfficers,
    draft, resetDraft, patchDraft, addVehicle, patchDraftVehicle, removeDraftVehicle, editDraftVehicle,
    startTrip, finishEmptyTrip, finishMuatanTrip,
    patchTripPhoto, patchVehiclePhoto, detailTripId, pendingOfficerId, verifyIntent, beginVerify, clearVerify,
    setActiveDermaga, clearAllTrips])

  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}




export function useApp(): StoreValue {
  const ctx = useContext(StoreCtx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
