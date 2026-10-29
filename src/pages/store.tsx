import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  VEHICLE_TYPES_UPDATED_EVENT,
  getStoredVehicleTypes,
  vehicleTypeKey,
  type VehicleType,
} from '../services/vehicleTypes'
import {
  addToSyncQueue,
  onTripSynced,
  retrySyncItem,
  notifyQueueListeners,
  readQueuedPhotos,
  type QueuedPhotos,
} from '../services/sync'
import { ensureBackendSession, getStoredOfficer, logout as endBackendSession, refreshBackendSession, SESSION_READY_EVENT } from '../services/auth'
import { api } from '../services/api'
import { dbAll, dbClear, dbGet, dbPutMany, initLocalDb, metaGet, metaSet } from '../services/localDb'
import { syncOfficersToLocal, getStoredOfficers, OFFICERS_UPDATED_EVENT } from '../services/officers'
import { TARIFF_UPDATED_EVENT } from '../services/masterTariffs'
import { prefetchAllCriticalData } from '../services/prefetch'
import type { MobileScreen, Officer } from './types'



export interface VehicleEntry {
  plate: string
  type: string
  category: string
  golongan?: string
  load?: 'loaded' | 'empty'
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
  // Id trip yang dipakai SEBAGAI KUNCI IDEMPOTEN di server. Dulu server memakai `id` (format "TRP-2026-0001") sebagai kunci.
  clientTripId?: string
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
  syncedTarget?: string
  officerId?: string
  selfieUrl?: string
  selfieCapturedAt?: string
  updatedAt?: number
}



export interface Draft {
  routeCode: string | null
  condition: 'kosong' | 'muatan' | null
  vehicles: VehicleEntry[]
  vehicleForm: { plate: string; type: string; category: string; load: 'loaded' | 'empty' }
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
  selfieUrl?: string
  selfieCapturedAt?: string
  cameraReturn?: MobileScreen

  cameraFrom: MobileScreen

  cameraMode: 'photo' | 'ocr' | 'selfie'

  ocrResult?: string

  ocrError?: string
  startedAt: number | null
}



export interface TariffRow {
  id?: string
  golongan: string
  type: string
  loaded: string
  loadedNum: number
  empty: string
  emptyNum: number
  desc: string
}



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
  /** true setelah riwayat dimuat dari IndexedDB (sumber kebenaran). */
  tripsLoaded: boolean
  tariffs: TariffRow[]
  vehicleTypes: VehicleType[]
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



const DRAFT_STORAGE_KEY = 'trip.draft.v1'



const emptyDraft: Draft = {
  routeCode: null,
  condition: null,
  vehicles: [],
  vehicleForm: { plate: '', type: '', category: '', load: 'loaded' },
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



// Cari tarif master untuk satu jenis kendaraan.
export function tariffFor(vehicleType: string): TariffRow | undefined {
  const list = load<TariffRow[]>(LS.tariffs, [])
  const want = vehicleTypeKey(vehicleType)
  if (!want) return undefined
  return list.find(t => vehicleTypeKey(t.type) === want)
}



export function golonganFor(vehicleType: string): string {
  return tariffFor(vehicleType)?.golongan ?? ''
}

// Tarif satu kendaraan sesuai kondisi muatannya. Internal tidak ditagih; selain itu pakai loadedNum / emptyNum master tarif.
export function vehicleTariff(vehicleType: string, category: string, load: 'loaded' | 'empty'): number {
  if (category.trim().toLowerCase() === 'internal') return 0
  const t = tariffFor(vehicleType)
  if (!t) return 0
  return load === 'empty' ? t.emptyNum : t.loadedNum
}



// Nomor urut trip. Disimpan di localStorage TERPISAH dari daftar trip, supaya penomoran tidak reset ketika petugas menghapus riwayat ("Hapus Semua…
const TRIP_SEQ_KEY = 'trip.seq.v1'



function readTripSeq(): number {
  try {
    const raw = localStorage.getItem(TRIP_SEQ_KEY)
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : 0
  } catch {
    return 0
  }
}



function writeTripSeq(value: number): void {
  try { localStorage.setItem(TRIP_SEQ_KEY, String(value)) } catch {  }
}



export function nextTripId(trips: Trip[]): string {
  let max = readTripSeq()
  for (const t of trips) {
    const m = /TRP-(\d{4})-(\d{4})/.exec(t.id)
    if (m) max = Math.max(max, parseInt(m[2], 10))
  }
  const next = max + 1
  writeTripSeq(next)
  const base = `TRP-${new Date().getFullYear()}-${String(next).padStart(4, '0')}`
  // Pengaman: kalau id yang dihitung sudah dipakai (mis.
  if (trips.some(t => t.id === base)) {
    const suffix = Math.random().toString(36).slice(2, 5).toUpperCase()
    return `${base}-${suffix}`
  }
  return base
}

// Kunci idempoten untuk trip: UUID, dibuat SEKALI saat trip dicatat.
export function newClientTripId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fallback di bawah */ }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}



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



/** Apakah trip masih menyimpan data foto (bukan hasil cache metadata). */
function hasTripPhoto(trip: Trip): boolean {
  if (trip.photoUrl) return true
  if (trip.selfieUrl) return true
  return !!trip.vehicles?.some(v => !!v.photoUrl)
}



// Perbandingan murah untuk memutuskan "state tidak berubah": cukup ada/tidaknya foto.
function samePhotoPresence(a: Trip | undefined, b: Trip | undefined): boolean {
  if (!a || !b) return a === b
  return hasTripPhoto(a) === hasTripPhoto(b)
}


// Buang data foto (base64) dari sebuah trip.
export function stripTripPhotos(trip: Trip): Trip {
  return {
    ...trip,
    photoUrl: undefined,
    selfieUrl: undefined,
    vehicles: trip.vehicles?.map(v => ({ ...v, photoUrl: undefined })),
  }
}



// Salin foto (beserta metadata jepretannya) dari versi yang SUDAH tersimpan ke versi baru yang tidak membawa foto. Aturan: foto hanya bergerak MAJU.
export function withStoredPhotos(next: Trip, stored?: Trip): Trip {
  if (!stored) return next
  const picked: Partial<Trip> = {}
  if (!next.photoUrl && stored.photoUrl) {
    picked.photoUrl = stored.photoUrl
    picked.photoCapturedAt = stored.photoCapturedAt
    picked.photoLatitude = stored.photoLatitude
    picked.photoLongitude = stored.photoLongitude
  }
  if (!next.selfieUrl && stored.selfieUrl) {
    picked.selfieUrl = stored.selfieUrl
    picked.selfieCapturedAt = stored.selfieCapturedAt
  }
  const vehicles = next.vehicles?.map(v => {
    if (v.photoUrl) return v
    const plate = v.plate?.trim().toUpperCase()
    // Cocokkan per plat, bukan per index: urutan kendaraan bisa berubah dan index yang bergeser akan menempelkan foto ke unit yang salah.
    const match = stored.vehicles?.find(s => !!s.photoUrl && !!plate && s.plate?.trim().toUpperCase() === plate)
    return match
      ? {
          ...v,
          photoUrl: match.photoUrl,
          photoCapturedAt: match.photoCapturedAt,
          photoLatitude: match.photoLatitude,
          photoLongitude: match.photoLongitude,
        }
      : v
  })
  return { ...next, ...picked, vehicles }
}



function applyQueuedPhotos(trip: Trip, q: QueuedPhotos): Trip {
  const vehicles = trip.vehicles?.map((v, i) => {
    const url = q.vehiclePhotos[i]
    return !v.photoUrl && url ? { ...v, photoUrl: url } : v
  })
  return {
    ...trip,
    photoUrl: trip.photoUrl ?? q.tripPhotoUrl,
    selfieUrl: trip.selfieUrl ?? q.selfieUrl,
    vehicles,
  }
}



async function recoverPhotosFromQueue(trips: Trip[]): Promise<Trip[]> {
  const missing = trips.filter(t => !hasTripPhoto(t))
  if (!missing.length) return trips
  const healed = new Map<string, Trip>()
  for (const t of missing) {
    const queued = await readQueuedPhotos(t.id)
    if (queued) healed.set(String(t.id), applyQueuedPhotos(t, queued))
  }
  if (!healed.size) return trips
  return trips.map(t => healed.get(String(t.id)) ?? t)
}



// Simpan riwayat ke IndexedDB tanpa pernah menghapus foto yang sudah tersimpan. Diekspor agar bisa diuji langsung (lihat store.persistence.test.tsx).
export async function persistTrips(trips: Trip[]): Promise<void> {
  try {
    const rows: Trip[] = []
    for (const t of trips) {
      if (hasTripPhoto(t)) { rows.push(t); continue }
      // Trip tanpa foto = lapisan cache metadata. Baca versi tersimpan dulu supaya foto tetap utuh di IndexedDB.
      const stored = await dbGet<Trip>('trips', t.id).catch(() => null)
      rows.push(withStoredPhotos(t, stored ?? undefined))
    }
    const ok = await dbPutMany<Trip>('trips', rows)
    if (!ok) {
      console.warn('[store] riwayat gagal disimpan ke IndexedDB (kuota penuh?) — foto masih ada di antrean sync')
    }
  } catch (err) {
    console.warn('[store] riwayat gagal disimpan ke IndexedDB:', err)
  }
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
    let winner =
      prev.synced === true && t.synced !== true ? prev :
      t.synced === true && prev.synced !== true ? t :
      nextTs >= prevTs ? t : prev
    if (winner === t && !hasTripPhoto(t) && hasTripPhoto(prev)) winner = prev
    byId.set(key, winner)
  }
  return [...byId.values()]
}



// Isi ulang `dermagaAccess` yang kosong dari roster yang sudah tersinkron dari server.
const EMPTY_OFFICER: Officer = {
  id: '',
  name: '',
  username: '',
  initials: '',
  region: '',
  regions: [],
  pin: '',
  status: 'Aktif',
  device: '-',
  trips: 0,
  lastActive: '-',
  joined: '-',
  dermagaAccess: [],
}



export function healDermagaAccess(list: Officer[]): Officer[] {
  const byId = new Map(getStoredOfficers().map(s => [String(s.id), s.dermagaAccess ?? []]))
  return list.map(o => {
    if (o.dermagaAccess?.length) return o
    const fromSeed = byId.get(String(o.id))
    return fromSeed?.length ? { ...o, dermagaAccess: fromSeed } : o
  })
}



export function AppProvider({ children }: { children: ReactNode }) {
  const [loggedIn, setLoggedIn] = useState<boolean>(() => load(LS.session, false))
  const [userType, setUserType] = useState<'admin' | 'member'>(() => load('trip.userType', 'member'))
  const [officerId, setOfficerIdState] = useState<string>(() => String(load(LS.officer, '')))
  // ponytail: JANGAN mengisi riwayat dengan data contoh. Riwayat & laporan harus murni berasal dari trip yang benar-benar dicatat petugas di perangkat.
  const [trips, setTrips] = useState<Trip[]>(() => normalizeTrips(load(LS.trips, [] as Trip[])))
  const [tariffs, setTariffs] = useState<TariffRow[]>(() => load<TariffRow[]>(LS.tariffs, []))
  // Master jenis kendaraan (dari database). Dipakai form kendaraan supaya pilihannya sama persis dengan dashboard admin.
  const [vehicleTypes, setVehicleTypes] = useState<VehicleType[]>(() => getStoredVehicleTypes())
  const [officers, setOfficers] = useState<Officer[]>(() => {
    // Tidak ada roster contoh: daftar petugas hanya berasal dari server.
    const saved = load<Officer[]>(LS.officers, [])
    return healDermagaAccess(saved)
  })
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  // Draft (termasuk foto base64) dipulihkan dari IndexedDB setelah refresh / aplikasi ditutup. Sebelumnya draft hanya di useState → semua foto hilang.
  const draftHydratedRef = useRef(false)
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        await initLocalDb()
        const saved = await metaGet(DRAFT_STORAGE_KEY)
        if (!alive) return
        if (saved && typeof saved === 'object') {
          // Jangan timpa draft yang sudah mulai diisi pengguna sebelum restore.
          setDraft(cur => (cur === emptyDraft ? saved as Draft : cur))
        }
      } catch (err) {
        console.warn('[store] gagal memulihkan draft:', err)
      } finally {
        if (alive) draftHydratedRef.current = true
      }
    })()
    return () => { alive = false }
  }, [])

  // Simpan draft (debounce) supaya foto yang baru diambil tidak hilang saat layar di-refresh atau aplikasi ditutup paksa.
  useEffect(() => {
    if (!draftHydratedRef.current) return
    const timer = setTimeout(() => {
      void metaSet(DRAFT_STORAGE_KEY, draft === emptyDraft ? null : draft)
    }, 300)
    return () => clearTimeout(timer)
  }, [draft])
  const tripsRef = useRef<Trip[]>(trips)
  useEffect(() => { tripsRef.current = trips }, [trips])
  const [tripsLoaded, setTripsLoaded] = useState(false)
  const [detailTripId, setDetailTripId] = useState<string | null>(null)
  const [pendingOfficerId, setPendingOfficerId] = useState<string | null>(null)
  const [verifyIntent, setVerifyIntent] = useState<VerifyIntent>('security')
  const [, setActiveDermagaId] = useState<string | null>(null)

  const refreshOfficersRef = useRef<((force?: boolean) => Promise<void>) | null>(null)

  useEffect(() => {
    void initLocalDb()
    // Foto (base64) hanya di IndexedDB; localStorage menyimpan metadata saja supaya kuota localStorage tidak habis dan trip tidak hilang dari riwayat.
    try {
      localStorage.setItem(LS.trips, JSON.stringify(trips.map(stripTripPhotos)))
    } catch (err) {
      console.warn('[store] localStorage penuh — data aman di IndexedDB:', err)
    }
    // JANGAN menulis ke IndexedDB sebelum hidrasi selesai: state awal diisi dari cache metadata (tanpa foto), dan menulisnya lebih dulu menghapus SEMUA…
    if (!tripsLoaded) return
    void persistTrips(trips)
  }, [trips, tripsLoaded])

  // Sumber kebenaran riwayat = IndexedDB (lengkap dengan foto).
  useEffect(() => {
    let alive = true
    void (async () => {
      const stored = await dbAll<Trip>('trips')
      if (!alive) return
      const full = await recoverPhotosFromQueue(normalizeTrips(stored))
      if (!alive) return
      setTrips(prev => {
        const prevById = new Map(prev.map(t => [String(t.id), t]))
        const fullIds = new Set(full.map(t => t.id))
        const onlyLocal = prev.filter(t => !fullIds.has(t.id))
        // Hidrasi hanya boleh MENAMBAH foto — tidak pernah menguranginya.
        const merged = mergeTrips(full, onlyLocal)
          .map(t => withStoredPhotos(t, prevById.get(String(t.id))))
        if (merged.length === prev.length) {
          const same = merged.every((t, i) => t === prev[i]
            || (t.updatedAt === prev[i]?.updatedAt && samePhotoPresence(t, prev[i])))
          if (same) return prev
        }
        return merged
      })
      setTripsLoaded(true)
    })()
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onStorage = () => {
      // Data dari tab lain hanya metadata (foto disimpan di IndexedDB), jadi merge tanpa menimpa foto yang sudah ada di state.
      setTrips(prev => mergeTrips(prev, normalizeTrips(load(LS.trips, [] as Trip[])).map(stripTripPhotos)))
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
    try { localStorage.setItem(LS.tariffs, JSON.stringify(tariffs)) } catch {  }
  }, [tariffs])
  useEffect(() => {
    const onTariffs = () => {
      const next = load<TariffRow[]>(LS.tariffs, [])
      setTariffs(prev => (prev.length === next.length ? prev : next))
    }
    window.addEventListener(TARIFF_UPDATED_EVENT, onTariffs)
    return () => window.removeEventListener(TARIFF_UPDATED_EVENT, onTariffs)
  }, [])
  useEffect(() => {
    const onTypes = () => setVehicleTypes(getStoredVehicleTypes())
    window.addEventListener(VEHICLE_TYPES_UPDATED_EVENT, onTypes)
    return () => window.removeEventListener(VEHICLE_TYPES_UPDATED_EVENT, onTypes)
  }, [])
  useEffect(() => {
    try { localStorage.setItem(LS.officers, JSON.stringify(officers)) } catch {  }
  }, [officers])
  useEffect(() => {
    try { localStorage.setItem(LS.officer, JSON.stringify(officerId)) } catch {  }
  }, [officerId])
  useEffect(() => {
    try { localStorage.setItem(LS.session, JSON.stringify(loggedIn)) } catch {  }
  }, [loggedIn])
  useEffect(() => {
    try { localStorage.setItem('trip.userType', userType) } catch {  }
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
    } catch {  }
    // Tidak ada roster (belum sync / belum login) -> petugas kosong, bukan data contoh. Dulu fallback-nya `officerList[0]` (petugas palsu).
    return officers[0] ?? (EMPTY_OFFICER as Officer)
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
      vehicleForm: { plate: v.plate, type: v.type, category: v.category, load: v.load ?? 'loaded' },
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
    // Kunci idempoten dibuat SEKALI di sini. Kalau trip ini di-retry (mis.
    const tripWithSync: Trip = { ...t, clientTripId: t.clientTripId ?? newClientTripId(), synced: false }
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
      selfieUrl: draft.selfieUrl,
      selfieCapturedAt: draft.selfieCapturedAt,
    }
    commitTrip(trip)
  }, [draft, officer.name, officer.id, commitTrip])
  const finishMuatanTrip = useCallback(() => {
    if (draft.condition !== 'muatan') return
    if (!draft.photoUrl) {
      console.warn('[trip] finishMuatanTrip ditolak: foto bukti trip belum diambil')
      return
    }
    if (!draft.selfieUrl) {
      console.warn('[trip] finishMuatanTrip ditolak: swafoto petugas belum diambil')
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
      // `load` = kondisi TRIP, bukan kondisi muatan tiap kendaraan. Trip dengan kendaraan tetap 'Ada Muatan' walau semua unitnya mengangkut kosong;
      load: vehicles.length > 0 ? 'Ada Muatan' : 'Kosong',
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
  }, [draft, officer.name, officer.id, commitTrip])
  const markTripSynced = useCallback((id: string, target?: string) => {
    setTrips(prev => prev.map(t => (
      t.id === id ? { ...t, synced: true, syncedTarget: target ?? t.syncedTarget } : t
    )))
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
    try { localStorage.removeItem(LS.trips) } catch {  }
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
      // tarik manual = segarkan semua: petugas + titik (tanpa logout) ponytail: foreground = force agar edit admin langsung sampai
      void prefetchAllCriticalData({ force: true }).catch(() => undefined)

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
  }, [refreshOfficers])

  useEffect(() => {
    refreshOfficersRef.current = refreshOfficers
  }, [refreshOfficers])

  useEffect(() => {
    const unsub = onTripSynced((id, target) => markTripSynced(id, target))
    return unsub
  }, [markTripSynced])

  useEffect(() => {
    const pullAuthorizedMasterData = () => {
      void refreshOfficers(true)
      void prefetchAllCriticalData({ force: true }).catch(() => undefined)
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

  useEffect(() => {
    const onUpdated = (e: Event) => {
      const roster = (e as CustomEvent).detail?.roster
      if (!Array.isArray(roster) || !roster.length) return
      setOfficers(prev => {
        const byId = new Map(prev.map(o => [String(o.id), o]))
        for (const o of roster) {
          const prevO = byId.get(String(o.id))
          byId.set(String(o.id), prevO ? { ...prevO, ...o } : o)
        }
        return [...byId.values()]
      })
    }
    window.addEventListener(OFFICERS_UPDATED_EVENT, onUpdated)
    return () => window.removeEventListener(OFFICERS_UPDATED_EVENT, onUpdated)
  }, [])

  const value = useMemo<StoreValue>(() => ({
    loggedIn, login, logout, userType,
    officer, setOfficerId, refreshOfficers,
    trips,
    tripsLoaded,
    tariffs,
    vehicleTypes,
    officers, saveOfficers,
    draft, resetDraft, patchDraft, addVehicle, patchDraftVehicle, removeDraftVehicle, editDraftVehicle,
    startTrip, finishEmptyTrip, finishMuatanTrip,
    patchTripPhoto, patchVehiclePhoto,
    detailTripId, setDetailTripId,
    pendingOfficerId, verifyIntent, beginVerify, clearVerify,
    setActiveDermaga,
    clearAllTrips,
  }), [loggedIn, login, logout, userType, officer, setOfficerId, refreshOfficers, trips, tripsLoaded, tariffs, vehicleTypes, officers, saveOfficers,
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
