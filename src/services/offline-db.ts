// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE-DB — Wrapper IndexedDB / SQLite / localStorage
//
// Menyediakan API tunggal untuk:
//   • IndexedDB (browser native) — kapasitas besar, persistensi kuat
//   • SQLite (@capacitor-community/sqlite) — native mobile, kapasitas besar
//   • localStorage fallback — terakhir jika IndexedDB tidak tersedia
//   • sessionStorage fallback — ultimate fallback
//
// Tabel:
//   officers     — petugas satu dermaga/region (login offline)
//   credentials  — hash PIN petugas (tidak pernah PIN polos)
//   trips        — trip tersimpan + sync state
//   photos       — foto bukti (base64 inline)
//   tariffs      — tarif kendaraan (offline)
//   plates       — plat kendaraan (offline)
//   regions      — region kode (offline)
//   queue        — sync antrean upload trip
//   sync_meta    — metadata sync (lastSync, version, dll)
// ─────────────────────────────────────────────────────────────────────────────

import { Capacitor } from '@capacitor/core'
import { CapacitorSQLite } from '@capacitor-community/sqlite'
import bcrypt from 'bcryptjs'

export type OfflineBackend = 'sqlite' | 'indexeddb' | 'localstorage' | 'session'

const DB_NAME = 'trip_offline_v2'
const DB_VERSION = 1

// ── Schema ──────────────────────────────────────────────────────────────────
const SCHEMA = `
CREATE TABLE IF NOT EXISTS officers (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT,
  name TEXT NOT NULL,
  region_id TEXT,
  region_name TEXT,
  region_code TEXT,
  is_active INTEGER DEFAULT 1,
  payload TEXT,
  updated_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS credentials (
  officer_id TEXT PRIMARY KEY NOT NULL,
  pin_hash TEXT NOT NULL,
  updated_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS trips (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  synced INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT 0,
  updated_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tariffs (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS regions (
  id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER DEFAULT 0
);
`

// ── Types ──────────────────────────────────────────────────────────────────
export interface OfficerRow {
  id: string
  username?: string
  name: string
  regionId?: string
  regionName?: string
  regionCode?: string
  isActive?: boolean
  payload: unknown
  updatedAt?: number
}

export interface TripRow {
  id: string
  data: string // JSON stringified Trip
  synced: boolean
  createdAt: number
  updatedAt: number
}

export interface SyncMetaRow {
  key: string
  value: string
  updatedAt: number
}

// ── Backend Detection & Init ──────────────────────────────────────────────
let _backend: OfflineBackend = 'localstorage'
let _conn: SQLite | null = null
let _initPromise: Promise<OfflineBackend> | null = null
let _idb: IDBDatabase | null = null

interface SQLite {
  execute(sql: string): Promise<void>
  run(sql: string, values?: unknown[]): Promise<void>
  query<T>(sql: string, values?: unknown[]): Promise<T[]>
}

export function getBackend(): OfflineBackend { return _backend }
export function isBackendReady(): boolean {
  return _initPromise !== null
}

async function openSqlite(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const sqlite = new (await import('@capacitor-community/sqlite')).SQLiteConnection(
      (await import('@capacitor-community/sqlite')).CapacitorSQLite
    )
    const db = await sqlite.createConnection(DB_NAME, false, 'no-encryption', DB_VERSION, false)
    await db.open()
    await db.execute(SCHEMA)
    _conn = db
    return true
  } catch (err) {
    console.warn('[offline-db] SQLite gagal:', err)
    return false
  }
}

async function openIndexedDB(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      const stores = [
        'officers', 'credentials', 'trips', 'tariffs', 'regions', 'sync_meta'
      ]
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) {
          const s = db.createObjectStore(store, { keyPath: store === 'sync_meta' ? 'key' : 'id' })
          if (store === 'sync_meta') {
            s.createIndex('updatedAt', 'updatedAt')
          }
        }
      }
    }
    req.onsuccess = () => { _idb = req.result; resolve(true) }
    req.onerror = () => resolve(false)
  })
}

// Fallback ke localStorage
function openLocalStorage(): boolean {
  try {
    localStorage.setItem('__test_quota__', '1')
    localStorage.removeItem('__test_quota__')
    return true
  } catch { return false }
}

/** Inisialisasi storage engine (idempotent) */
export async function initOfflineDb(): Promise<OfflineBackend> {
  if (_initPromise) return _initPromise
  _initPromise = (async () => {
    // Urutan prioritas: SQLite native > IndexedDB > localStorage > sessionStorage
    if (await openSqlite()) {
      _backend = 'sqlite'
      await migrateLegacyData()
      return 'sqlite'
    }
    if (await openIndexedDB()) {
      _backend = 'indexeddb'
      await migrateLegacyData()
      return 'indexeddb'
    }
    if (openLocalStorage()) {
      _backend = 'localstorage'
      return 'localstorage'
    }
    console.warn('[offline-db] semua storage gagal, pakai sessionStorage')
    _backend = 'session'
    return 'session'
  })()
  return _initPromise
}

// ── Legacy Migration ────────────────────────────────────────────────────────
const LEGACY_KEYS = {
  officers: 'trip.officers.v1',
  trips: 'trip.trips.v1',
  tariffs: 'trip.tariffs.v1',
  regions: 'trip.regions.v1',
}

async function migrateLegacyData(): Promise<void> {
  try {
    for (const [store, key] of Object.entries(LEGACY_KEYS)) {
      const raw = localStorage.getItem(key)
      if (!raw) continue
      let data: unknown
      try { data = JSON.parse(raw) } catch { continue }
      if (Array.isArray(data)) {
        const storeName = store.slice(0, -1) // 'officers' -> 'officer', 'trips' -> 'trip'
        if (store === 'trips') {
          for (const trip of data) {
            if (trip && typeof trip === 'object' && 'id' in trip) {
              await dbPut(storeName, String((trip as { id: unknown }).id), { data: JSON.stringify(trip), synced: false, createdAt: Date.now(), updatedAt: Date.now() })
            }
          }
        } else {
          for (const item of data) {
            if (item && typeof item === 'object' && 'id' in item) {
              await dbPut(storeName, String((item as { id: unknown }).id), item)
            }
          }
        }
      }
    }
  } catch (e) {
    console.warn('[offline-db] migrasi gagal:', e)
  }
}

// ── Core DB Operations ────────────────────────────────────────────────────

/** Simpan satu record */
export async function dbPut<T extends object>(
  store: 'officers' | 'credentials' | 'trips' | 'tariffs' | 'regions',
  id: string,
  data: T
): Promise<void> {
  await initOfflineDb()
  const row = { id, ...data }
  if (_conn) {
    await (_conn.run(`INSERT OR REPLACE INTO ${store} (id, data, updated_at) VALUES (?, ?, ?)`, [id, JSON.stringify(data), Date.now()]))
  } else if (_idb) {
    return new Promise((res, rej) => {
      const tx = _idb!.transaction(store, 'readwrite')
      tx.objectStore(store).put({ ...row, data: JSON.stringify(data) })
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } else {
    try {
      localStorage.setItem(`${store}:${id}`, JSON.stringify(data))
    } catch { /* quota full */ }
  }
}

/** Ambil satu record */
export async function dbGet<T>(store: string, id: string): Promise<T | null> {
  await initOfflineDb()
  if (_conn) {
    const rows = await _conn.query<Record<string, unknown>>(`SELECT data FROM ${store} WHERE id = ?`, [id])
    if (!rows?.length) return null
    try { return JSON.parse(String(rows[0]?.data ?? rows[0])) } catch { return null }
  }
  if (_idb) {
    return new Promise((res, rej) => {
      const tx = _idb!.transaction(store, 'readonly')
      const req = tx.objectStore(store).get(id)
      req.onsuccess = () => {
        const row = req.result as { data?: string } | undefined
        if (!row) return res(null)
        try { res(row.data ? JSON.parse(row.data) : (row as unknown as T)) } catch { res(null) }
      }
      req.onerror = () => res(null)
    })
  }
  const raw = localStorage.getItem(`${store}:${id}`)
  if (!raw) return null
  try { return JSON.parse(raw) } catch { return null }
}

/** Ambil semua record dari satu store */
export async function dbAll<T>(store: string): Promise<T[]> {
  await initOfflineDb()
  const rows: T[] = []
  if (_conn) {
    try {
      const rawRows = await _conn.query<Record<string, unknown>>(`SELECT id, data, synced, created_at, updated_at FROM ${store}`)
      return rawRows.map(row => {
        try { return row['data'] ? JSON.parse(String(row['data'])) : row as unknown as T } catch { return row as unknown as T }
      })
    } catch { /* query gagal */ }
  }
  if (_idb) {
    return new Promise((res) => {
      const tx = _idb!.transaction(store, 'readonly')
      const req = tx.objectStore(store).getAll()
      req.onsuccess = () => {
        res(
          (req.result as Array<{ data?: string }>).map(r => {
            try { return r?.data ? JSON.parse(r.data) : r as unknown as T } catch { return r as unknown as T }
          })
        )
      }
      req.onerror = () => res([])
    })
  }
  const prefix = `${store}:`
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key?.startsWith(prefix)) {
      try {
        const raw = localStorage.getItem(key ?? '')
        if (raw) {
          const v = JSON.parse(raw)
          rows.push(v as T)
        }
      } catch { /* corrupt row */ }
    }
  }
  return rows
}

/** Hapus satu record */
export async function dbDelete(store: string, id: string): Promise<void> {
  await initOfflineDb()
  if (_conn) {
    await (_conn as unknown as { run(sql: string, vals?: unknown[]): Promise<void> }).run(`DELETE FROM ${store} WHERE id = ?`, [id])
  } else if (_idb) {
    return new Promise((res) => {
      const tx = _idb!.transaction(store, 'readwrite')
      tx.objectStore(store).delete(id)
      tx.oncomplete = () => res()
      tx.onerror = () => res()
    })
  } else {
    localStorage.removeItem(`${store}:${id}`)
  }
}

/** Hitung record */
export async function dbCount(store: string): Promise<number> {
  await initOfflineDb()
  if (_conn) {
    const rows = await _conn.query(`SELECT COUNT(*) as cnt FROM ${store}`)
    const cnt = Array.isArray(rows) ? (rows[0] as { cnt?: number })?.cnt : 0
    return typeof cnt === 'number' ? cnt : 0
  }
  if (_idb) {
    return new Promise((res) => {
      const tx = _idb!.transaction(store, 'readonly')
      const req = tx.objectStore(store).count()
      req.onsuccess = () => { res(req.result as number) }
      req.onerror = () => res(0)
    })
  }
  const prefix = `${store}:`
  let n = 0
  for (let i = 0; i < localStorage.length; i++) {
    if (localStorage.key(i)?.startsWith(prefix)) n++
  }
  return n
}

/** Bulk insert */
export async function dbPutMany<T extends { id: string }>(
  store: string,
  items: T[]
): Promise<void> {
  for (const item of items) { await dbPut(store, item.id, item) }
}

/** Sync meta */
export async function metaGet(key: string): Promise<string | null> {
  const row = await dbGet<{ key: string; value: string }>('sync_meta', key)
  return row?.value ?? null
}

export async function metaSet(key: string, value: string): Promise<void> {
  await dbPut('sync_meta', key, { key, value })
}

// ── Officers ──────────────────────────────────────────────────────────────

export interface StoredOfficer {
  id: string
  name: string
  regionId?: string
  regionName?: string
  regionCode?: string
  payload?: unknown
}

export async function saveOfficer(officer: StoredOfficer): Promise<void> {
  await dbPut('officers', officer.id, officer)
}

export async function getOfficer(id: string): Promise<StoredOfficer | null> {
  return dbGet<StoredOfficer>('officers', id)
}

export async function listOfficers(): Promise<StoredOfficer[]> {
  return dbAll<StoredOfficer>('officers')
}

/**
 * Cari SATU petugas di database offline berdasarkan identifier (id, username, atau nama).
 * Dipakai auth.ts saat verifikasi PIN offline untuk memastikan data petugas
 * valid sebelum login offline diproses.
 */
export async function findOfficer<T = StoredOfficer>(
  identifier: string
): Promise<T | null> {
  const id = String(identifier).toLowerCase()
  const all = await dbAll<StoredOfficer>('officers')
  const hit = all.find(o =>
    String(o.id).toLowerCase() === id ||
    String((o as StoredOfficer & { username?: string }).username ?? '').toLowerCase() === id ||
    String(o.name).toLowerCase() === id
  )
  return (hit as T | undefined) ?? null
}

// ── PIN / Auth ──────────────────────────────────────────────────────────

export async function setPinHash(officerId: string, hash: string): Promise<void> {
  await initOfflineDb()
  if (_conn) {
    await (_conn as unknown as { run(sql: string, vals?: unknown[]): Promise<void> }).run(
      `INSERT OR REPLACE INTO credentials (officer_id, pin_hash, updated_at) VALUES (?, ?, ?)`,
      [officerId, hash, Date.now()]
    )
  } else if (_idb) {
    const tx = _idb.transaction('credentials', 'readwrite')
    tx.objectStore('credentials').put({ officer_id: officerId, pin_hash: hash, updated_at: Date.now() })
  } else {
    localStorage.setItem(`pin:${officerId}`, hash)
  }
}

export async function getPinHash(officerId: string): Promise<string | null> {
  await initOfflineDb()
  if (_conn) {
    const rows = await (_conn as unknown as { query(sql: string, vals?: unknown[]): Promise<unknown[]> }).query(
      `SELECT pin_hash FROM credentials WHERE officer_id = ? LIMIT 1`, [officerId]
    )
    return (rows?.[0] as string) ?? null
  }
  if (_idb) {
    return new Promise((res) => {
      const tx = _idb.transaction('credentials', 'readonly')
      const req = tx.objectStore('credentials').get(officerId)
      req.onsuccess = () => res((req.result as { pin_hash?: string })?.pin_hash ?? null)
      req.onerror = () => res(null)
    })
  }
  return localStorage.getItem(`pin:${officerId}`) ?? null
}

export async function verifyPinOffline(officerId: string, pin: string): Promise<boolean> {
  const stored = await getPinHash(officerId)
  if (!stored) return false
  // bcrypt (dari server)
  if (stored.startsWith('$2a$') || stored.startsWith('$2b$')) {
    try { return bcrypt.compareSync(pin, stored) } catch { return false }
  }
  // SHA-256 / FNV-1a fallback
  return stored === await hashPin(officerId, pin)
}

export async function hashPin(officerId: string, pin: string): Promise<string> {
  const payload = `trip.pin:${officerId}:${pin}`
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
    return `sha256:${[...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')}`
  }
  return `fnv1a:${fnv1a(payload)}`
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

// ── Proteksi Storage Persistence ──────────────────────────────────────

/**
 * Minta browser/OS TIDAK menghapus penyimpanan saat storage penuh.
 * Perlu disimpan setelah init offline-db berhasil.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const stor = navigator.storage
    if (!stor) return false
    if (typeof stor.persisted === 'boolean' && stor.persisted) return true
    if (typeof stor.persist === 'function') return stor.persist()
    return false
  } catch { return false }
}
