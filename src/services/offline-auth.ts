// ─── Offline Auth Service ─────────────────────────────────────────────
// Handles authentication entirely offline by validating credentials
// against master data stored locally on the device.

import { getMasterOfficers, getMasterDermagas, getMasterRoutes, type MasterOfficer, type MasterDermaga, type MasterRoute } from './offline-init'

// ── Session Storage ─────────────────────────────────────────────────
const SESSION_KEY = 'trip.auth.session'
const ACTIVE_DERMAGA_KEY = 'trip.auth.activeDermaga'

export interface OfflineSession {
  officerId: string
  officerName: string
  regionId: string
  regionCode: string
  regionName: string
  activeDermagaId: string | null
  activeRouteId: string | null
  loggedInAt: string
}

// ── Password Hasher (simple SHA-256 via Web Crypto) ──────────────────
async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(salt + ':' + password)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

// ── PIN Hasher ─────────────────────────────────────────────────────
async function hashPin(pin: string, salt: string): Promise<string> {
  return hashPassword(pin, salt)
}

// ── Getters ────────────────────────────────────────────────────────
export function getOfflineSession(): OfflineSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function getActiveDermagaId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_DERMAGA_KEY)
  } catch {
    return null
  }
}

export function setActiveDermagaId(id: string | null): void {
  try {
    if (id) localStorage.setItem(ACTIVE_DERMAGA_KEY, id)
    else localStorage.removeItem(ACTIVE_DERMAGA_KEY)
  } catch { /* quota */ }
}

// ── Access Validation ────────────────────────────────────────────────
export interface AccessScope {
  dermagaIds: string[]
  routeIds: string[]
}

/**
 * Get the access scope for an officer (cached on the session).
 * Returns null if the officer doesn't exist or is inactive.
 */
export function getOfficerScope(officerId: string): AccessScope | null {
  const officers = getMasterOfficers()
  const officer = officers.find(o => String(o.id) === String(officerId))
  if (!officer || !officer.active) return null

  return {
    dermagaIds: officer.dermaga_access || [],
    routeIds: officer.route_access || [],
  }
}

/**
 * Validate that an officer can access a specific dermaga.
 */
export function canAccessDermaga(officerId: string, dermagaId: string): boolean {
  const scope = getOfficerScope(officerId)
  if (!scope) return false
  return scope.dermagaIds.includes(dermagaId)
}

/**
 * Validate that an officer can access a specific route.
 */
export function canAccessRoute(officerId: string, routeId: string): boolean {
  const scope = getOfficerScope(officerId)
  if (!scope) return false
  return scope.routeIds.includes(routeId)
}

/**
 * List dermagas the officer has access to.
 */
export function getAccessibleDermagas(officerId: string): MasterDermaga[] {
  const scope = getOfficerScope(officerId)
  if (!scope) return []
  const dermagas = getMasterDermagas()
  return dermagas.filter(d => scope.dermagaIds.includes(d.id) && d.active)
}

/**
 * List routes the officer has access to.
 */
export function getAccessibleRoutes(officerId: string, dermagaId?: string): MasterRoute[] {
  const scope = getOfficerScope(officerId)
  if (!scope) return []
  let routes = getMasterRoutes().filter(r => scope.routeIds.includes(r.id) && r.active)
  if (dermagaId) {
    routes = routes.filter(r => r.dermaga_id === dermagaId)
  }
  return routes
}

// ── Login ──────────────────────────────────────────────────────────
export interface LoginResult {
  success: boolean
  error?: string
  session?: OfflineSession
}

/**
 * Authenticate using username/password against local master data.
 * Works completely offline.
 */
export async function loginOffline(
  username: string,
  password: string,
): Promise<LoginResult> {
  const officers = getMasterOfficers()
  const officer = officers.find(
    o => o.username?.toLowerCase() === username.toLowerCase()
  )

  if (!officer) {
    return { success: false, error: 'Petugas tidak ditemukan' }
  }

  if (!officer.active) {
    return { success: false, error: 'Akun tidak aktif. Hubungi administrator.' }
  }

  // Hash and compare password
  const hash = await hashPassword(password, officer.id)
  if (hash !== officer.passwordHash) {
    return { success: false, error: 'Password salah' }
  }

  const session: OfflineSession = {
    officerId: officer.id,
    officerName: officer.name,
    regionId: officer.region_id,
    regionCode: officer.region_code,
    regionName: officer.region_name,
    activeDermagaId: null,
    activeRouteId: null,
    loggedInAt: new Date().toISOString(),
  }

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch { /* quota */ }

  return { success: true, session }
}

/**
 * Authenticate using PIN against local master data.
 * Used for quick officer switching.
 */
export async function loginWithPinOffline(
  officerId: string,
  pin: string,
): Promise<LoginResult> {
  const officers = getMasterOfficers()
  const officer = officers.find(o => String(o.id) === String(officerId))

  if (!officer) {
    return { success: false, error: 'Petugas tidak ditemukan' }
  }

  if (!officer.active) {
    return { success: false, error: 'Akun tidak aktif. Hubungi administrator.' }
  }

  const hash = await hashPin(pin, officer.id)
  if (hash !== officer.pin) {
    return { success: false, error: 'PIN salah' }
  }

  const session: OfflineSession = {
    officerId: officer.id,
    officerName: officer.name,
    regionId: officer.region_id,
    regionCode: officer.region_code,
    regionName: officer.region_name,
    activeDermagaId: null,
    activeRouteId: null,
    loggedInAt: new Date().toISOString(),
  }

  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch { /* quota */ }

  return { success: true, session }
}

/**
 * Login with both credentials — tries online first, falls back to offline.
 * The online path is handled by the parent auth.ts; this function ONLY does offline.
 */
export async function loginWithCredentials(
  username: string,
  password: string,
): Promise<LoginResult> {
  return loginOffline(username, password)
}

// ── Session Management ───────────────────────────────────────────────
export function updateSession(partial: Partial<OfflineSession>): void {
  const current = getOfflineSession()
  if (!current) return
  const updated = { ...current, ...partial }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(updated))
  } catch { /* quota */ }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY)
    localStorage.removeItem(ACTIVE_DERMAGA_KEY)
  } catch { /* quota */ }
}

export function isLoggedIn(): boolean {
  return getOfflineSession() !== null
}

/**
 * Validate the current session is still valid (officer still exists & active).
 */
export function validateSession(): boolean {
  const session = getOfflineSession()
  if (!session) return false

  const officers = getMasterOfficers()
  const officer = officers.find(o => o.id === session.officerId)
  return !!officer && officer.active
}

// ── Password Setup (for first-time device setup) ─────────────────────
/**
 * Update the local password hash for an officer.
 * Used when the device is online and syncing from admin.
 */
export function updateOfficerPassword(
  officerId: string,
  newHash: string,
): void {
  const officers = getMasterOfficers()
  const idx = officers.findIndex(o => o.id === officerId)
  if (idx === -1) return
  officers[idx] = { ...officers[idx], passwordHash: newHash, updatedAt: new Date().toISOString() }
  try {
    localStorage.setItem('trip.master.officers', JSON.stringify(officers))
  } catch { /* quota */ }
}

/**
 * Update the PIN for an officer.
 */
export function updateOfficerPin(
  officerId: string,
  newPinHash: string,
): void {
  const officers = getMasterOfficers()
  const idx = officers.findIndex(o => o.id === officerId)
  if (idx === -1) return
  officers[idx] = { ...officers[idx], pin: newPinHash, updatedAt: new Date().toISOString() }
  try {
    localStorage.setItem('trip.master.officers', JSON.stringify(officers))
  } catch { /* quota */ }
}

// ── Offline Auth Status ─────────────────────────────────────────────
export interface AuthStatus {
  ready: boolean
  officerCount: number
  dermagaCount: number
  routeCount: number
  sessionActive: boolean
  lastSync: string | null
}

export function getAuthStatus(): AuthStatus {
  const session = getOfflineSession()
  return {
    ready: session !== null,
    officerCount: getMasterOfficers().filter(o => o.active).length,
    dermagaCount: getMasterDermagas().filter(d => d.active).length,
    routeCount: getMasterRoutes().length,
    sessionActive: session !== null,
    lastSync: session?.loggedInAt ?? null,
  }
}
