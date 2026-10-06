// ─── Offline-first Local Database ─────────────────────────────────────────────
// Basis data lokal untuk mode offline:
//   • Native (Android/iOS) → SQLite (@capacitor-community/sqlite)
//   • Web / plugin belum   → fallback otomatis ke localStorage
// Keduanya memakai API yang sama sehingga caller tidak perlu peduli backend.
//
// Tabel:
//   officers     — daftar petugas satu dermaga/region (referensi untuk login
//                  offline & layar Ganti Petugas)
//   credentials  — hash PIN petugas (tidak pernah menyimpan PIN polos)

import { Capacitor } from '@capacitor/core'

export type LocalBackend = 'sqlite' | 'localStorage'

const DB_NAME = 'trip_offline'
const DB_VERSION = 1
const LS_OFFICERS = 'trip.officers.v1'
const LS_CREDENTIALS = 'trip.officers.credentials.v1'

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
`

/** Baris petugas yang disimpan — payload memuat object mobile lengkap. */
export interface OfficerRow {
  id: string
  username?: string
  name: string
  regionId?: string
  regionName?: string
  regionCode?: string
  isActive?: boolean
  payload: unknown
}

let backend: LocalBackend = 'localStorage'
interface SqliteConn {
  execute: (statements: string, transaction?: boolean) => Promise<unknown>
  run: (statement: string, values?: unknown[]) => Promise<unknown>
  query: (statement: string, values?: unknown[]) => Promise<{ values?: unknown[] }>
}
let conn: SqliteConn | null = null
let initPromise: Promise<LocalBackend> | null = null

async function openSqlite(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  try {
    const mod = await import('@capacitor-community/sqlite')
    const sqlite = new mod.SQLiteConnection(mod.CapacitorSQLite)
    const connection = await sqlite.createConnection(
      DB_NAME,
      false,
      'no-encryption',
      DB_VERSION,
      false,
    )
    await connection.open()
    await connection.execute(SCHEMA)
    conn = connection as unknown as SqliteConn
    return true
  } catch (err) {
    console.warn('[offline-db] SQLite tidak tersedia, pakai localStorage:', err)
    conn = null
    return false
  }
}

/** Baca data lama di localStorage sekali pindah ke SQLite. */
async function migrateFromLocalStorage(): Promise<void> {
  try {
    const rawOfficers = localStorage.getItem(LS_OFFICERS)
    if (rawOfficers) {
      const list = JSON.parse(rawOfficers)
      if (Array.isArray(list)) await saveOfficers(list)
    }
    const rawCreds = localStorage.getItem(LS_CREDENTIALS)
    if (rawCreds) {
      const map = JSON.parse(rawCreds) as Record<string, string>
      for (const [id, hash] of Object.entries(map)) {
        await setPinHash(id, hash)
      }
    }
  } catch { /* data rusak — abaikan */ }
}

/**
 * Inisialisasi (idempoten). Mengembalikan backend yang dipakai.
 * Aman dipanggil berulang & gagal total tidak mematikan aplikasi.
 */
export function initOfflineDb(): Promise<LocalBackend> {
  if (!initPromise) {
    initPromise = (async () => {
      const ok = await openSqlite()
      backend = ok ? 'sqlite' : 'localStorage'
      if (ok) await migrateFromLocalStorage()
      return backend
    })()
  }
  return initPromise
}

export function getBackend(): LocalBackend {
  return backend
}

function lsOfficers(): OfficerRow[] {
  try {
    const raw = localStorage.getItem(LS_OFFICERS)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

/** Simpan/meg-barui daftar petugas (upsert per id). */
export async function saveOfficers(rows: OfficerRow[]): Promise<void> {
  if (!rows?.length) return
  await initOfflineDb()
  const now = Date.now()
  const toRow = (r: OfficerRow): OfficerRow => ({
    id: String(r.id),
    username: r.username,
    name: r.name ?? String(r.id),
    regionId: r.regionId,
    regionName: r.regionName,
    regionCode: r.regionCode,
    isActive: r.isActive ?? true,
    payload: r.payload ?? r,
  })

  if (backend === 'sqlite' && conn) {
    try {
      for (const r of rows) {
        const row = toRow(r)
        await conn.run(
          `INSERT INTO officers (id, username, name, region_id, region_name, region_code, is_active, payload, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET username=excluded.username, name=excluded.name,
             region_id=excluded.region_id, region_name=excluded.region_name,
             region_code=excluded.region_code, is_active=excluded.is_active,
             payload=excluded.payload, updated_at=excluded.updated_at`,
          [
            row.id, row.username ?? null, row.name, row.regionId ?? null,
            row.regionName ?? null, row.regionCode ?? null, row.isActive ? 1 : 0,
            JSON.stringify(row.payload), now,
          ],
        )
      }
      return
    } catch (err) {
      console.warn('[offline-db] gagal tulis SQLite, fallback localStorage:', err)
    }
  }

  // Fallback localStorage (merge per id)
  const merged = new Map<string, OfficerRow>(lsOfficers().map(o => [String(o.id), o]))
  for (const r of rows) {
    const row = toRow(r)
    merged.set(row.id, { ...(merged.get(row.id) ?? {}), ...row })
  }
  try {
    localStorage.setItem(LS_OFFICERS, JSON.stringify([...merged.values()]))
  } catch { /* quota */ }
}

/** Ambil seluruh daftar petugas tersimpan. */
export async function listOfficers<T = OfficerRow>(): Promise<T[]> {
  await initOfflineDb()
  if (backend === 'sqlite' && conn) {
    try {
      const res = await conn.query('SELECT payload FROM officers ORDER BY name ASC')
      const values = (res?.values ?? []) as unknown[][]
      return values
        .map(v => {
          try { return JSON.parse(String(v[0])) as T } catch { return null }
        })
        .filter((v): v is T => v !== null)
    } catch (err) {
      console.warn('[offline-db] gagal baca SQLite:', err)
    }
  }
  return lsOfficers().map(o => (o.payload as T) ?? (o as unknown as T))
}

/** Cari petugas berdasarkan id ATAU username (untuk login offline). */
export async function findOfficer<T = OfficerRow>(identifier: string): Promise<T | null> {
  const all = await listOfficers<T>()
  const key = String(identifier).toLowerCase()
  return (
    all.find(o => {
      const row = o as unknown as OfficerRow
      return String(row.id) === String(identifier) ||
        String(row.username ?? '').toLowerCase() === key ||
        String(row.name ?? '').toLowerCase() === key
    }) ?? null
  )
}

// ── Kredensial (hash PIN) ────────────────────────────────────────────────────

function lsCredentials(): Record<string, string> {
  try {
    const raw = localStorage.getItem(LS_CREDENTIALS)
    const map = raw ? JSON.parse(raw) : {}
    return map && typeof map === 'object' ? map : {}
  } catch { return {} }
}

/** Hash SHA-256 untuk PIN. Fallback aman bila crypto.subtle tidak tersedia. */
export async function hashPin(officerId: string, pin: string): Promise<string> {
  const payload = `trip.pin:${officerId}:${pin}`
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await globalThis.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(payload),
      )
      return `sha256:${[...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')}`
    }
  } catch { /* fallback di bawah */ }
  // Fallback (WebView tanpa crypto) — tetap jangan simpan PIN polos
  return `fnv:${fnv1a(payload)}`
}

function fnv1a(str: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

export async function setPinHash(officerId: string, hash: string): Promise<void> {
  if (!officerId || !hash) return
  await initOfflineDb()
  if (backend === 'sqlite' && conn) {
    try {
      await conn.run(
        `INSERT INTO credentials (officer_id, pin_hash, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(officer_id) DO UPDATE SET pin_hash=excluded.pin_hash, updated_at=excluded.updated_at`,
        [String(officerId), hash, Date.now()],
      )
      return
    } catch (err) {
      console.warn('[offline-db] gagal simpan kredensial:', err)
    }
  }
  try {
    const map = lsCredentials()
    map[String(officerId)] = hash
    localStorage.setItem(LS_CREDENTIALS, JSON.stringify(map))
  } catch { /* quota */ }
}

export async function getPinHash(officerId: string): Promise<string | null> {
  await initOfflineDb()
  if (backend === 'sqlite' && conn) {
    try {
      const res = await conn.query(
        'SELECT pin_hash FROM credentials WHERE officer_id = ? LIMIT 1',
        [String(officerId)],
      )
      const value = (res?.values as unknown[][] | undefined)?.[0]?.[0]
      if (value) return String(value)
    } catch (err) {
      console.warn('[offline-db] gagal baca kredensial:', err)
    }
  }
  return lsCredentials()[String(officerId)] ?? null
}

/** Cocokkan PIN terhadap hash tersimpan. Mendukung hash lama (plain/legacy). */
export async function verifyPin(officerId: string, pin: string): Promise<boolean> {
  const stored = await getPinHash(officerId)
  if (!stored) return false
  if (stored.startsWith('sha256:') || stored.startsWith('fnv:')) {
    return stored === (await hashPin(officerId, pin))
  }
  // Legacy: nilai tersimpan belum berupa hash
  return stored === pin || stored === `plain:${pin}`
}

/** Hapus seluruh data offline (dipanggil saat logout/reset). */
export async function clearOfflineData(): Promise<void> {
  await initOfflineDb()
  if (backend === 'sqlite' && conn) {
    try {
      await conn.execute('DELETE FROM officers; DELETE FROM credentials;')
    } catch { /* fallback di bawah */ }
  }
  try {
    localStorage.removeItem(LS_CREDENTIALS)
  } catch { /* quota */ }
}
