/**
 * Offline database untuk menyimpan data peta petugas/dermaga/rute.
 */

import type { Officer } from './api'

export interface DbOfficer extends Officer {
  pin_hash?: string
  status?: string
  regionName?: string
  regionId?: string
  username?: string
  isActive?: boolean
  payload?: Record<string, unknown>
}

const DB_KEY = 'trip.offline.db'
const PIN_HASH_PREFIX = 'trip.pin.hash.'

interface Db {
  officers: Record<string, DbOfficer>
  updatedAt: number
}

let _db: Db | null = null

function openDb(): Db {
  if (_db) return _db
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (raw) _db = JSON.parse(raw)
  } catch {}
  _db = _db || { officers: {}, updatedAt: 0 }
  return _db
}

function saveDb() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(_db))
  } catch {}
}

export function findOfficer(id: string): DbOfficer | null {
  const db = openDb()
  return db.officers[id] || null
}

export function saveOfficer(id: string, data: Partial<DbOfficer>): void {
  const db = openDb()
  db.officers[id] = { ...db.officers[id], ...data }
  saveDb()
}

// ─── Officers list ─────────────────────────────────────────────────────────

export function listOfficers<T = DbOfficer>(): T[] {
  const db = openDb()
  return Object.values(db.officers) as T[]
}

export function saveOfficers(officers: Partial<DbOfficer>[]): void {
  const db = openDb()
  for (const o of officers) {
    if (o.id) {
      db.officers[o.id] = { ...db.officers[o.id], ...o } as DbOfficer
    }
  }
  db.updatedAt = Date.now()
  saveDb()
}

export function clearDb(): void {
  try { localStorage.removeItem(DB_KEY) } catch {}
  _db = null
}

// ─── PIN management ──────────────────────────────────────────────────────

export function setPinHash(officerId: string, hash: string): void {
  try { localStorage.setItem(PIN_HASH_PREFIX + officerId, hash) } catch {}
}

export function getPinHash(officerId: string): string | null {
  try { return localStorage.getItem(PIN_HASH_PREFIX + officerId) } catch { return null }
}

export function verifyPin(officerId: string, pin: string): boolean {
  const storedHash = getPinHash(officerId)
  if (!storedHash) return false
  // Simple comparison (in production, use proper hashing)
  return storedHash === pin || storedHash === `hash:${pin}`
}

export function hashPin(officerId: string, pin: string): string {
  // Simple hash for demo - in production use bcrypt
  // Uses officerId as salt
  return `hash:${officerId}:${pin}`
}

// ─── Init ────────────────────────────────────────────────────────────────

export function initOfflineDb(): void {
  openDb()
}
