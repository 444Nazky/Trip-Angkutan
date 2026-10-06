// ─── Auth Service ─────────────────────────────────────────────────────────────
// Handles authentication with backend API

import { api, type ApiError } from './api'
import {
  findOfficer as findOfflineOfficer,
  hashPin,
  saveOfficers,
  setPinHash,
  verifyPin as verifyStoredPin,
} from './offlineDb'

const OFFICER_KEY = 'trip.auth.officer.v1'
const DERMAGA_KEY = 'trip.auth.dermaga.v1'
const ROUTES_KEY = 'trip.auth.routes.v1'

// Demo PIN shared by all seeded officers
export const DEMO_PIN = '123456'

// Officer the app *wants* to be authenticated as, even while offline
let activeOfficerId: string | null = null

export interface Dermaga {
  id: string
  name: string
  code: string
  region_name: string
  region_code: string
}

export interface Route {
  id: string
  name: string
  route_from: string
  route_to: string
  distance?: string
  duration?: string
}

export interface StoredOfficer {
  id: string
  name: string
  regionId: string
  regionName: string
  regionCode: string
}

export interface LoginResponse {
  token: string
  officer: StoredOfficer
  dermagas?: Dermaga[]
  routes?: Record<string, Route[]>
  isDualAccess?: boolean
}

// ── Revisi #4: login wilayah (langkah 1) ───────────────────────────────────
export interface RegionInfo { id: string; name: string; code: string }
export interface RegionOfficer { id: string; name: string }

/**
 * Login wilayah: kode region + password region (contoh BADAU / badau123).
 * Berhasil → daftar petugas wilayah tsb (tanpa PIN) untuk langkah berikutnya.
 */
export async function regionLogin(
  regionCode: string,
  password: string,
): Promise<{
  success: boolean
  error?: string
  region?: RegionInfo
  officers?: RegionOfficer[]
}> {
  const result = await api.post<{ region: RegionInfo; officers: RegionOfficer[] }>(
    '/auth/region-login',
    { regionCode, password },
  )

  if (!result.ok || !result.data) {
    return { success: false, error: result.error?.message || 'Backend tidak terjangkau' }
  }

  return { success: true, region: result.data.region, officers: result.data.officers }
}

// ── Rute petugas (dari login PIN / pilih dermaga) ─────────────────────────────
export interface UiRoute {
  code: string
  from: string
  to: string
  label: string
  distance?: string
  duration?: string
  /** ID dermaga asal rute — dipakai filter per dermaga di RouteSelectScreen */
  dermagaId?: string
}

function saveRoutesMap(map: Record<string, Route[]>) {
  try { localStorage.setItem(ROUTES_KEY, JSON.stringify(map)) }
  catch { /* quota */ }
}

/**
 * Rute milik petugas yang sedang login (dari backend, per dermaga).
 * Kembalikan bentuk UI — kosong bila belum pernah login (caller fallback data statis).
 */
export function getStoredRoutes(): UiRoute[] {
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    if (!raw) return []
    const map = JSON.parse(raw) as Record<string, Route[]>
    const out: UiRoute[] = []
    for (const [dermagaId, list] of Object.entries(map)) {
      for (const route of list || []) {
        if (!route?.route_from || !route?.route_to) continue
        const code = `${route.route_from}-${route.route_to}`
        if (out.some(item => item.code === code && item.dermagaId === dermagaId)) continue
        out.push({
          code,
          from: route.route_from,
          to: route.route_to,
          label: route.name || `${route.route_from} → ${route.route_to}`,
          distance: route.distance || undefined,
          duration: route.duration || undefined,
          dermagaId,
        })
      }
    }
    return out
  } catch {
    return []
  }
}

/**
 * Muat ulang rute petugas dari backend (`GET /routes/mine`) — dipanggil saat
 * layar Pilih Rute dibuka supaya hasil edit Master Rute admin langsung
 * terlihat tanpa harus logout/login ulang.
 * Kembalikan daftar rute terbaru, atau null bila gagal (pakai cache).
 */
export async function refreshStoredRoutes(): Promise<UiRoute[] | null> {
  const result = await api.get<(Route & { dermaga_id: string })[]>('/routes/mine')
  if (!result.ok || !result.data) return null

  const map: Record<string, Route[]> = {}
  for (const r of result.data) {
    if (!map[r.dermaga_id]) map[r.dermaga_id] = []
    // Simpan route_from/route_to terpisah dari dermaga_id agar map tetap bersih
    map[r.dermaga_id].push({
      id: r.id,
      name: r.name,
      route_from: r.route_from,
      route_to: r.route_to,
      distance: r.distance,
      duration: r.duration,
    })
  }
  saveRoutesMap(map)
  // getStoredRoutes() sudah menyertakan dermagaId dari key map
  return getStoredRoutes()
}

/** True when backend route data or a dock selection must prevent static fallback. */
export function hasDockScopedRoutes(): boolean {
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    if (!raw) return !!getStoredDermaga()
    const map = JSON.parse(raw) as Record<string, Route[]>
    return !!getStoredDermaga() || Object.keys(map).length > 0
  } catch {
    return !!getStoredDermaga()
  }
}

export function getStoredOfficer(): StoredOfficer | null {
  try {
    const raw = localStorage.getItem(OFFICER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function getStoredDermaga(): Dermaga | null {
  try {
    const raw = localStorage.getItem(DERMAGA_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveOfficer(officer: StoredOfficer) {
  try {
    localStorage.setItem(OFFICER_KEY, JSON.stringify(officer))
  } catch { /* quota */ }
}

function saveDermaga(dermaga: Dermaga) {
  try {
    localStorage.setItem(DERMAGA_KEY, JSON.stringify(dermaga))
  } catch { /* quota */ }
}

function clearOfficer() {
  try {
    localStorage.removeItem(OFFICER_KEY)
    localStorage.removeItem(DERMAGA_KEY)
    evictPinCache()
  } catch { /* quota */ }
}

// Login with username/password (member login) and obtain backend JWT
export async function memberLogin(
  username: string,
  password: string
): Promise<{ success: boolean; error?: string; officer?: StoredOfficer }> {
  const result = await api.post<LoginResponse>('/auth/member-login', { username, password })

  if (!result.ok || !result.data) {
    // Gagal karena jaringan → coba verifikasi lokal agar petugas tetap bisa masuk
    if (isNetworkError(result.error)) {
      const offline = await verifyPinOffline(username, password)
      if (offline) return { success: true, officer: getStoredOfficer() ?? undefined }
      return { success: false, error: 'Server tidak terjangkau dan data petugas belum tersimpan di perangkat.' }
    }
    return { success: false, error: result.error?.message || 'Backend unreachable' }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)
  void cachePin(result.data.officer.id, password)

  return { success: true, officer: result.data.officer }
}

/** True bila error disebabkan jaringan (bukan kredensial salah). */
function isNetworkError(err?: ApiError): boolean {
  if (!err) return true
  if (err.code && !/^5\d\d$/.test(err.code)) return false
  return /timeout|network|failed to fetch|terjangkau|offline|merespon|unreachable/i.test(err.message)
}

// Login with PIN (for officer switching).
export async function loginWithPin(
  officerId: string,
  pin: string,
): Promise<{ success: boolean; error?: ApiError; data?: LoginResponse; offline?: boolean }> {
  const result = await api.post<LoginResponse>('/auth/login', { officerId, pin })

  if (!result.ok || !result.data) {
    // Server tidak terjangkau → verifikasi PIN terhadap hash tersimpan di perangkat
    if (isNetworkError(result.error)) {
      const ok = await verifyPinOffline(officerId, pin)
      if (ok) {
        const session = await buildOfflineSession(officerId)
        if (session) return { success: true, offline: true, data: session }
      }
      return {
        success: false,
        error: { message: 'Server tidak terjangkau — PIN tidak dapat diverifikasi.' },
      }
    }
    return { success: false, error: result.error }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)
  void cachePin(officerId, pin)

  // Simpan PIN hash (wajib, spy verifikasi offline berfungsi)
  void cachePin(officerId, pin)

  // Sinkronisasi daftar petugas dermaga ke IndexedDB + storage lokal
  // Data ini dipakai untuk: login offline, layar Ganti Petugas, verifikasi PIN offline.
  if (result.data.dermagas?.length) {
    for (const d of result.data.dermagas) {
      void syncDermagaOfficersToDb(d.id)
    }
  } else if (result.data.officer?.regionId) {
    void syncDermagaOfficersToDb(result.data.officer.regionId)
  }

  // Simpan rute per dermaga agar layar Pilih Rute memakai data master terbaru
  if (result.data.routes) saveRoutesMap(result.data.routes)

  // Single-dermaga: simpan otomatis
  if (result.data.dermagas?.length === 1) saveDermaga(result.data.dermagas[0])

  return { success: true, data: result.data }
}

/** Bentuk petugas tersimpan di database offline (mobile format). */
interface OfflineOfficerRecord {
  id: string
  name: string
  username?: string
  region?: string
  regions?: string[]
  regionId?: string
  regionName?: string
  regionCode?: string
  status?: string
}

/** Susun sesi offline dari data petugas tersimpan di perangkat. */
async function buildOfflineSession(officerId: string): Promise<LoginResponse | null> {
  const row = await findOfflineOfficer<OfflineOfficerRecord>(officerId)
  if (!row) return null

  const region = String(row.region ?? row.regionCode ?? row.regionId ?? '')
  const officer: StoredOfficer = {
    id: String(row.id ?? officerId),
    name: String(row.name ?? ''),
    regionId: String(row.regionId ?? region),
    regionName: String(row.regionName ?? region),
    regionCode: String(row.regionCode ?? region),
  }
  activeOfficerId = officer.id
  saveOfficer(officer)
  api.setToken(null) // sesi offline — tidak ada JWT sampai kembali online
  return { token: '', officer }
}

// Select dermaga for dual-access officers
export async function selectDermaga(dermagaId: string): Promise<{ success: boolean; error?: string }> {
  const result = await api.post<{ dermaga: Dermaga; routes: Route[] }>('/auth/select-dermaga', { dermagaId })

  if (!result.ok || !result.data) {
    return { success: false, error: result.error?.message }
  }

  saveDermaga(result.data.dermaga)
  // Gabungkan rute dermaga terpilih dengan rute dermaga lain yang sudah tersimpan
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    const map: Record<string, Route[]> = raw ? JSON.parse(raw) : {}
    map[result.data.dermaga.id] = result.data.routes || []
    saveRoutesMap(map)
  } catch { /* quota */ }
  return { success: true, error: undefined }
}

export function logout() {
  api.setToken(null)
  clearOfficer()
}

/**
 * Refresh JWT with latest claims from database.
 */
export async function refreshBackendSession(officerId?: string): Promise<boolean> {
  const id = officerId ?? activeOfficerId ?? getStoredOfficer()?.id
  if (id == null || id === '') return false

  activeOfficerId = String(id)

  if (!api.isAuthenticated) {
    const result = await loginWithPin(String(id), DEMO_PIN)
    return result.success
  }

  const result = await api.post<LoginResponse>('/auth/refresh', {})
  if (result.ok && result.data) {
    api.setToken(result.data.token)
    saveOfficer(result.data.officer)
    return true
  }

  return false
}

export function isLoggedIn(): boolean {
  return api.isAuthenticated && !!getStoredOfficer()
}

// Decode the stored JWT payload without verification (UI-level checks only)
function jwtPayload(): { role?: string; officerId?: string | number } | null {
  const token = api.token
  if (!token) return null
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(base64))
  } catch {
    return null
  }
}

/**
 * Fetch an admin JWT for the dashboard.
 */
export async function ensureAdminBackendSession(): Promise<boolean> {
  const result = await api.post<{ token: string }>('/auth/admin-login', {
    username: 'admin',
    password: 'admin123',
  })

  if (result.ok && result.data) {
    api.setToken(result.data.token)
    return true
  }
  return false
}

/**
 * Ensure we have a valid backend JWT for the given officer.
 */
export async function ensureBackendSession(officerId?: string): Promise<boolean> {
  if (officerId != null && officerId !== '') {
    activeOfficerId = officerId
    const stored = getStoredOfficer()
    if (stored && String(stored.id) !== String(officerId)) {
      api.setToken(null)
    }
  }

  const payload = jwtPayload()
  if (payload && (payload.role === 'admin' || payload.officerId == null)) {
    api.setToken(null)
  }

  if (api.isAuthenticated) return true

  const id = officerId ?? activeOfficerId ?? getStoredOfficer()?.id
  if (id == null || id === '') return false

  const result = await loginWithPin(String(id), DEMO_PIN)
  return result.success
}

// ── Kredensial offline (hash PIN) ──────────────────────────────────────────
// Map legacy menyimpan PIN polos — dipertahankan hanya untuk migrasi.
const LEGACY_PIN_KEY = 'trip.auth.pin.v1'

function loadLegacyPinMap(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(LEGACY_PIN_KEY) ?? '{}') }
  catch { return {} }
}

/** Simpan HASH PIN petugas setelah login online berhasil (tidak pernah PIN polos). */
export async function cachePin(officerId: string, pin: string): Promise<void> {
  if (!officerId || !pin) return
  try {
    await setPinHash(officerId, await hashPin(officerId, pin))
    localStorage.removeItem(LEGACY_PIN_KEY)
  } catch { /* quota */ }
}

/**
 * Verifikasi PIN terhadap kredensial tersimpan di perangkat — dipakai saat
 * server tidak terjangkau sehingga tidak memicu error jaringan.
 */
export async function verifyPinOffline(identifier: string, pin: string): Promise<boolean> {
  if (!identifier || !pin) return false

  // Petugas bisa dicari lewat id, username, maupun nama
  let officerId = identifier
  try {
    const row = await findOfflineOfficer<OfflineOfficerRecord>(identifier)
    if (row?.id) officerId = String(row.id)
  } catch { /* database offline belum siap */ }

  try {
    if (await verifyStoredPin(officerId, pin)) return true
  } catch { /* lanjut ke fallback legacy */ }

  // Fallback data lama (PIN polos) → upgrade ke hash bila cocok
  const legacy = loadLegacyPinMap()
  const stored = legacy[officerId] ?? legacy[identifier]
  if (stored && stored === pin) {
    await cachePin(officerId, pin)
    return true
  }
  return false
}

/**
 * Hapus PIN polos legacy. Hash PIN tetap disimpan agar petugas tetap bisa
 * verifikasi offline setelah logout/login (hash tidak sensitif).
 */
export function evictPinCache() {
  try { localStorage.removeItem(LEGACY_PIN_KEY) } catch { /* quota */ }
}

/** Sinkronisasi data petugas satu dermaga ke IndexedDB. Idempoten.
 *  Dipanggil saat login BERHASIL (online), agar data tersedia SAAT offline. */
export async function syncDermagaOfficersToDb(dermagaId?: string): Promise<void> {
  if (!dermagaId) return
  try {
    const r = await api.get<{ officers?: StoredOfficer[] }>(`/dermaga/${dermagaId}/officers`)
    if (!r.ok || !r.data?.officers) return
    // Simpan ke IndexedDB offlineDb (sudah menangani SQLite/localStorage)
    await saveOfficers(r.data.officers.map(o => ({
      id: String(o.id),
      name: o.name,
      username: o.username,
      regionId: o.regionId,
      regionName: o.regionName,
      regionCode: o.regionCode,
      isActive: true,
      payload: o,
    })))
    // Legacy localStorage tetap sync (untuk layar officer-switch)
    const key = `trip.dermaga.officers.${dermagaId}`
    const prev: StoredOfficer[] = JSON.parse(localStorage.getItem(key) ?? '[]')
    const merged = [...prev]
    for (const o of r.data.officers ?? []) {
      const i = merged.findIndex(x => String(x.id) === String(o.id))
      if (i >= 0) merged[i] = o; else merged.push(o)
    }
    localStorage.setItem(key, JSON.stringify(merged))
  } catch { /* offline — gagal async, data sebelumnya tetap aman */ }
}

/** Hapus data petugas dermaga dari storage (logout/pergantian akun). */
export async function clearDermagaOfficersFromDb(dermagaId?: string): Promise<void> {
  if (!dermagaId) return
  try { localStorage.removeItem(`trip.dermaga.officers.${dermagaId}`) } catch {}
}

/** Ambil daftar petugas satu dermaga dari localStorage (hasil sync terbaru). */
export function getDermagaOfficersFromStorage(dermagaId: string): StoredOfficer[] {
  try { return JSON.parse(localStorage.getItem(`trip.dermaga.officers.${dermagaId}`) ?? '[]') }
  catch { return [] }
}
