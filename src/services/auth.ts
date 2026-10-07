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

function isValidRoute(r: unknown): r is Route {
  return typeof r === 'object' && r !== null && !!(r as Route).id && !!(r as Route).name
}

function isNonEmptyString(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0
}

function saveRoutesMap(map: Record<string, Route[]>): void {
  // Validasi & bersihkan data rute sebelum simpan — data corrupt/rusak diskard
  const clean: Record<string, Route[]> = {}
  if (map && typeof map === 'object') {
    for (const [k, list] of Object.entries(map)) {
      if (!k || !Array.isArray(list)) continue
      const filtered = list.filter(isValidRoute)
      if (filtered.length) clean[k] = filtered
    }
  }
  try { localStorage.setItem(ROUTES_KEY, JSON.stringify(clean)) }
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
      const offline = await loginOffline(username, password)
      if (offline.success) return { success: true, officer: offline.officer }
      return { success: false, error: 'Server tidak terjangkau dan data petugas belum tersimpan di perangkat.' }
    }
    return { success: false, error: result.error?.message || 'Backend unreachable' }
  }

  api.setToken(result.data.token)
  saveOfficer(result.data.officer)
  void cachePin(result.data.officer.id, password)

  // ── LOGIN PERTAMA KALI (ONLINE): tarik & simpan SEMUA petugas satu dermaga
  //    ke penyimpanan lokal, supaya pergantian akun tetap jalan saat offline.
  void cacheDockOfficers(result.data.officer.id, result.data.dermagas)
  // Rute master per dermaga juga ikut di-cache untuk layar Pilih Rute offline.
  void refreshStoredRoutes().catch(() => null)

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
      const offline = await loginOffline(officerId, pin)
      if (offline.success && offline.session) {
        return { success: true, offline: true, data: offline.session }
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
  // Simpan HASH PIN (wajib) agar verifikasi PIN offline berfungsi
  void cachePin(officerId, pin)

  // Cache seluruh petugas satu dermaga ke penyimpanan lokal (offline-first)
  void cacheDockOfficers(String(result.data.officer?.id ?? officerId), result.data.dermagas)

  // Simpan rute per dermaga agar layar Pilih Rute memakai data master terbaru
  if (result.data.routes) saveRoutesMap(result.data.routes)

  // Single-dermaga: simpan otomatis
  if (result.data.dermagas?.length === 1) saveDermaga(result.data.dermagas[0])

  return { success: true, data: result.data }
}

/** Bentuk petugas tersimpan di database offline (mobile format). */
export interface OfflineOfficerRecord {
  id: string
  name: string
  username?: string
  region?: string
  regions?: string[]
  regionId?: string
  regionName?: string
  regionCode?: string
  status?: string
  pin?: string
  /** Scope dermaga akses — dipakai saat login offline untuk memilih dermaga */
  dermagaAccess?: Array<{ id: string; name: string; code: string; region_id?: string }>
}

/**
 * Cari petugas di ROSTER localStorage (trip.officers.v1 / cache per-dermaga).
 * Pencadang bila baris di DB offline belum ada (mis. sebelum migrasi selesai).
 */
function findStoredOfficerRecord(identifier: string): OfflineOfficerRecord | null {
  const key = String(identifier).toLowerCase()
  const pools: OfflineOfficerRecord[][] = []
  const read = (k: string): OfflineOfficerRecord[] => {
    try {
      const raw = localStorage.getItem(k)
      const list = raw ? JSON.parse(raw) : []
      return Array.isArray(list) ? list : []
    } catch { return [] }
  }
  pools.push(read('trip.officers.v1'))
  // Cache per-dermaga (semua dermaga yang pernah disimpan)
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith('trip.dermaga.officers.')) pools.push(read(k))
    }
  } catch { /* ignore */ }

  for (const pool of pools) {
    const hit = pool.find(o =>
      String(o.id) === String(identifier) ||
      String(o.username ?? '').toLowerCase() === key ||
      String(o.name ?? '').toLowerCase() === key,
    )
    if (hit) return hit
  }
  return null
}

/**
 * Susun sesi offline dari data petugas tersimpan di perangkat.
 * Menerima id ATAU username/ nama — resolusi dilakukan ke DB offline dulu,
 * lalu ke roster localStorage, sehingga pergantian antar petugas dalam satu
 * dermaga tetap mulus saat perangkat sedang offline.
 */
async function buildOfflineSession(identifier: string): Promise<LoginResponse | null> {
  let row: OfflineOfficerRecord | null = null
  try { row = await findOfflineOfficer<OfflineOfficerRecord>(identifier) } catch { row = null }
  if (!row) row = findStoredOfficerRecord(identifier)
  if (!row) return null
  // Petugas yang dinonaktifkan admin tidak boleh login (offline maupun online)
  if (row.status && /nonaktif/i.test(String(row.status))) return null

  const region = String(row.region ?? row.regionCode ?? row.regionId ?? '')
  const officer: StoredOfficer = {
    id: String(row.id ?? identifier),
    name: String(row.name ?? ''),
    regionId: String(row.regionId ?? region),
    regionName: String(row.regionName ?? region),
    regionCode: String(row.regionCode ?? region),
    // dermagaAccess disimpan di payload officer agar route/dermaga scope aktif offline
  }
  activeOfficerId = officer.id
  saveOfficer(officer)
  api.setToken(null) // sesi offline — tidak ada JWT sampai kembali online
  // Pastikan baris petugas ikut tersimpan di DB offline utk lookup berikutnya
  void saveOfficers([{
    id: officer.id,
    username: row.username,
    name: officer.name,
    regionId: officer.regionId,
    regionName: officer.regionName,
    regionCode: officer.regionCode,
    isActive: true,
    payload: { ...officer, username: row.username, dermagaAccess: row.dermagaAccess },
  }])
  return { token: '', officer }
}

/**
 * LOGIN OFFLINE: verifikasi PIN terhadap hash lokal lalu bangun sesi offline.
 * Dipakai LoginPage (`tryOfflineLogin`) dan PinVerifyScreen — menjamin
 * pergantian petugas dalam satu dermaga tetap jalan tanpa jaringan.
 */
export async function loginOffline(
  identifier: string,
  pin: string,
): Promise<{ success: boolean; officer?: StoredOfficer; session?: LoginResponse }> {
  if (!identifier || !pin) return { success: false }
  const ok = await verifyPinOffline(identifier, pin)
  if (!ok) return { success: false }
  const session = await buildOfflineSession(identifier)
  if (!session) return { success: false }
  return { success: true, officer: session.officer, session }
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

/** Masa berlaku JWT terakhir (epoch ms) — null bila tidak bisa dibaca. */
function jwtExpiryMs(token?: string | null): number | null {
  const t = token ?? api.token
  if (!t) return null
  try {
    const base64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(base64)) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * VALIDASI ULANG TOKEN sebelum antrean sinkron dikirim ulang.
 *
 * 1. Token masih berlaku (> 60 detik lagi) → langsung pakai.
 * 2. Token hampir kedaluwarsa → coba `POST /auth/refresh` (JWT lama masih
 *    diterima) sehingga sesi diperpanjang tanpa memasukkan ulang PIN.
 * 3. Refresh gagal → login ulang otomatis (ensureBackendSession).
 *
 * Mengembalikan false bila sesi benar-benar tidak bisa dipulihkan — caller
 * wajib MENUNDA pengiriman (jangan membakar percobaan 401 yang sia-sia).
 */
export async function renewSessionIfNeeded(): Promise<boolean> {
  if (!api.isAuthenticated) return ensureBackendSession()

  const exp = jwtExpiryMs(api.token)
  if (exp === null || Date.now() < exp - 60_000) return true // masih berlaku

  const r = await api.post<{ token?: string; officer?: StoredOfficer }>('/auth/refresh', {})
  if (r.ok && r.data?.token) {
    api.setToken(r.data.token)
    if (r.data.officer) saveOfficer(r.data.officer)
    return true
  }
  // Refresh ditolak → paksa login ulang
  api.setToken(null)
  return ensureBackendSession()
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
    // Hapus HANYA entri petugas ini dari map legacy — entri petugas LAIN
    // harus tetap ada agar mereka tetap bisa diverifikasi saat offline.
    const legacy = loadLegacyPinMap()
    if (officerId in legacy) {
      delete legacy[officerId]
      const keys = Object.keys(legacy)
      if (keys.length) localStorage.setItem(LEGACY_PIN_KEY, JSON.stringify(legacy))
      else localStorage.removeItem(LEGACY_PIN_KEY)
    }
  } catch { /* quota */ }
}

/**
 * Verifikasi PIN terhadap kredensial tersimpan di perangkat — dipakai saat
 * server tidak terjangkau sehingga tidak memicu error jaringan.
 *
 * Urutan resolusi petugas (agar pergantian akun antar dermaga mulus):
 *   1. DB offline (IndexedDB/SQLite) — id / username / nama
 *   2. Roster localStorage (trip.officers.v1 + cache per-dermaga)
 * Lalu cocokkan hash PIN, terakhir fallback ke PIN polos legacy.
 */
export async function verifyPinOffline(identifier: string, pin: string): Promise<boolean> {
  if (!identifier || !pin) return false

  // Petugas bisa dicari lewat id, username, maupun nama
  let officerId = String(identifier)
  let resolved = false
  let inactive = false
  try {
    const row = await findOfflineOfficer<OfflineOfficerRecord & { isActive?: boolean; is_active?: number; payload?: { status?: string } }>(identifier)
    if (row?.id) { officerId = String(row.id); resolved = true }
    const status = row?.status ?? row?.payload?.status
    if (status && /nonaktif/i.test(String(status))) inactive = true
    if (row?.isActive === false || row?.is_active === 0) inactive = true
  } catch { /* database offline belum siap */ }

  const storedRecord = findStoredOfficerRecord(identifier)
  if (!resolved && storedRecord?.id) { officerId = String(storedRecord.id); resolved = true }
  if (storedRecord && storedRecord.status && /nonaktif/i.test(String(storedRecord.status))) inactive = true
  if (inactive) return false

  try {
    if (await verifyStoredPin(officerId, pin)) return true
  } catch { /* lanjut ke fallback legacy */ }

  // Fallback data lama (PIN polos) → upgrade ke hash bila cocok
  const legacy = loadLegacyPinMap()
  const stored = legacy[officerId] ?? legacy[identifier]
  if (stored && (stored === pin || stored === `plain:${pin}`)) {
    await cachePin(officerId, pin)
    return true
  }

  // Roster lama yang menyimpan PIN polos pada object petugas
  const plain = storedRecord?.pin
  if (plain && plain === pin) {
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

/** Bentuk petugas dari backend untuk keperluan roster/dermaga. */
interface RosterOfficer {
  id: string | number
  name: string
  username?: string | null
  region_id?: string
  region_name?: string
  region_code?: string
  regions?: Array<{ id: string; name: string; code: string }>
  dermagas?: Array<{ id: string; name: string; code: string; region_id?: string }>
  is_active?: number | boolean
  /** Hash bcrypt PIN dari server — untuk verifikasi PIN offline */
  pin_hash?: string
}

function toStoredOfficer(o: RosterOfficer): StoredOfficer & { username?: string; status?: string } {
  const primary = o.regions?.[0]
  return {
    id: String(o.id),
    name: String(o.name ?? ''),
    username: o.username ?? undefined,
    regionId: String(o.region_id ?? primary?.id ?? ''),
    regionName: String(o.region_name ?? primary?.name ?? ''),
    regionCode: String(o.region_code ?? primary?.code ?? ''),
    status: o.is_active === 0 || o.is_active === false ? 'Nonaktif' : 'Aktif',
  } as StoredOfficer & { username?: string; status?: string }
}

/**
 * Simpan roster ke DB offline (untuk login & verifikasi PIN) sekaligus ke
 * cache localStorage per-dermaga (untuk layar Ganti Petugas).
 */
async function persistRoster(officers: RosterOfficer[], dermagaIds: string[]): Promise<void> {
  if (!officers.length) return
  const shaped = officers.map(toStoredOfficer)

  // 1. DB offline (SQLite native / localStorage web)
  try {
    await saveOfficers(officers.map((o, i) => ({
      id: String(o.id),
      username: o.username ?? undefined,
      name: shaped[i].name,
      regionId: shaped[i].regionId,
      regionName: shaped[i].regionName,
      regionCode: shaped[i].regionCode,
      isActive: o.is_active === undefined ? true : Boolean(o.is_active),
      payload: shaped[i],
    })))
    // Simpan hash PIN server supaya PIN bisa diverifikasi OFFLINE untuk
    // semua petugas di wilayah, bukan hanya yang pernah login di perangkat ini.
    for (const o of officers) {
      if (o.pin_hash) void setPinHash(String(o.id), o.pin_hash)
    }
  } catch { /* db belum siap — cache di bawah tetap jalan */ }

  // 2. Cache per-dermaga (localStorage)
  for (const did of dermagaIds) {
    const subset = officers.filter(o => (o.dermagas ?? []).some(d => String(d.id) === String(did)))
    if (!subset.length) continue
    const key = `trip.dermaga.officers.${did}`
    try {
      const prevRaw = localStorage.getItem(key)
      const prev = prevRaw ? JSON.parse(prevRaw) : []
      const merged: Array<Record<string, unknown>> = Array.isArray(prev) ? prev : []
      for (const o of subset) {
        const s = toStoredOfficer(o) as unknown as Record<string, unknown>
        const i = merged.findIndex(x => String(x['id']) === String(s['id']))
        if (i >= 0) merged[i] = { ...merged[i], ...s }
        else merged.push(s)
      }
      localStorage.setItem(key, JSON.stringify(merged))
    } catch { /* quota — data lama tetap aman */ }
  }
}

async function fetchMyRegionRoster(): Promise<RosterOfficer[] | null> {
  const r = await api.get<RosterOfficer[]>('/officers/my-region')
  if (!r.ok || !Array.isArray(r.data)) return null
  return r.data
}

/**
 * Tarik & simpan SELURUH petugas satu dermaga (plus peminta) ke perangkat.
 * Dipanggil setiap login ONLINE berhasil — inilah yang membuat pergantian
 * akun antar petugas dalam dermaga yang sama tetap bisa saat offline.
 */
export async function cacheDockOfficers(
  officerId?: string,
  dermagas?: Array<{ id: string }>,
): Promise<void> {
  try {
    const id = String(officerId ?? getStoredOfficer()?.id ?? '')
    const dockIds = new Set<string>((dermagas ?? []).map(d => String(d.id)))

    const all = await fetchMyRegionRoster()
    if (all?.length) {
      const me = all.find(o => String(o.id) === id)
      for (const d of me?.dermagas ?? []) dockIds.add(String(d.id))

      const mates = all.filter(o => (o.dermagas ?? []).some(d => dockIds.has(String(d.id))))
      const list = me && !mates.some(m => String(m.id) === String(me.id))
        ? [me, ...mates]
        : mates

      if (list.length) {
        await persistRoster(list, [...dockIds])
        return
      }
      // Tidak ada info dermaga → simpan seluruh petugas wilayah agar PIN
      // tetap bisa diverifikasi offline.
      await persistRoster(all, [])
      return
    }

    // Fallback: endpoint presisi per dermaga (bila my-region kosong/gagal)
    for (const did of dockIds) await syncDermagaOfficersToDb(did)
  } catch { /* offline — cache sebelumnya tetap aman */ }
}

/**
 * Sinkronisasi data petugas SATU dermaga ke penyimpanan lokal. Idempoten.
 * Endpoint utama : GET /dermagas/:id/officers (baru, presisi)
 * Cadangan       : GET /officers/my-region (backend lama tanpa endpoint utama)
 */
export async function syncDermagaOfficersToDb(dermagaId?: string): Promise<void> {
  if (!dermagaId) return
  try {
    const r = await api.get<{ officers?: RosterOfficer[] }>(`/dermagas/${dermagaId}/officers`)
    if (r.ok && r.data?.officers?.length) {
      await persistRoster(r.data.officers, [String(dermagaId)])
      return
    }
    // Backend lama (404) → pakai roster wilayah, filter irisan dermaga
    if (r.error?.code === '404') {
      const all = await fetchMyRegionRoster()
      const subset = (all ?? []).filter(o =>
        (o.dermagas ?? []).some(d => String(d.id) === String(dermagaId)))
      if (subset.length) await persistRoster(subset, [String(dermagaId)])
    }
  } catch { /* offline — data sebelumnya tetap aman */ }
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
