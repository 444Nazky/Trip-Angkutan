// ─── localDb.ts — Penyimpanan Lokal Tahan-Banting ─────────────────────────────
// Lapisan penyimpanan OFFLINE-FIRST dipakai bersama oleh sync.ts (antrean trip)
// dan store.tsx (daftar trip):
//
//   • IndexedDB (utama) — bertahan saat app ditutup / direstart / di-refresh,
//     kapasitas jauh lebih besar dari localStorage (foto base64 muat di sini).
//   • localStorage (fallback) — dipakai otomatis bila IndexedDB gagal/tidak
//     tersedia (WebView lawas, mode privat, dsb) sehingga fungsi tetap jalan.
//
// Struktur object store (keyPath inline):
//   pending — antrean sinkronisasi trip (key: syncId)
//   trips   — daftar trip yang tercatat di aplikasi (key: id)
//   meta    — penanda migrasi & state kecil (key: k)
//
// CATATAN: nama DB dipertahankan 'trip-sync-v2' agar data antrean yang sudah
// tersedia di perangkat petugas TIDAK hilang saat perangkat naik versi skema
// (onupgradeneeded hanya MENAMBAH store baru, tidak menghapus yang lama).

const DB_NAME = 'trip-sync-v2'
const DB_VERSION = 2

export type StoreName = 'pending' | 'trips' | 'meta'

const STORE_PENDING: StoreName = 'pending'
const STORE_TRIPS: StoreName = 'trips'
const STORE_META: StoreName = 'meta'
const ALL_STORES: StoreName[] = [STORE_PENDING, STORE_TRIPS, STORE_META]

const KEY_PATH: Record<StoreName, string> = {
  pending: 'syncId',
  trips: 'id',
  meta: 'k',
}

/** Prefix localStorage untuk mode fallback (kunci per store). */
const LS_PREFIX = 'trip.localdb.v1.'

let _db: IDBDatabase | null = null
let _dbPromise: Promise<IDBDatabase | null> | null = null
/** true → pakai localStorage karena IndexedDB gagal/tidak tersedia. */
let _fallback = false

function openDB(): Promise<IDBDatabase | null> {
  if (_db) return Promise.resolve(_db)
  if (_dbPromise) return _dbPromise

  _dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        _fallback = true
        resolve(null)
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      // Database di-upgrade tab lain → tutup agar tidak memblokir.
      req.onblocked = () => { /* biarkan; retry berikutnya akan berhasil */ }
      req.onupgradeneeded = () => {
        const db = req.result
        for (const name of ALL_STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: KEY_PATH[name] })
          }
        }
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => { try { db.close() } catch { /* ignore */ }; _db = null; _dbPromise = null }
        _db = db
        resolve(db)
      }
      req.onerror = () => {
        console.warn('[local-db] IndexedDB gagal dibuka, fallback localStorage:', req.error)
        _fallback = true
        resolve(null)
      }
    } catch (err) {
      console.warn('[local-db] IndexedDB tidak tersedia, fallback localStorage:', err)
      _fallback = true
      resolve(null)
    }
  })
  return _dbPromise
}

/** Pastikan koneksi terbuka (idempoten). */
export async function initLocalDb(): Promise<'indexeddb' | 'localStorage'> {
  const db = await openDB()
  return db ? 'indexeddb' : 'localStorage'
}

export function localDbBackend(): 'indexeddb' | 'localStorage' {
  return _fallback || !_db ? 'localStorage' : 'indexeddb'
}

// ── Fallback: localStorage per-store ──────────────────────────────────────────

function lsKey(store: StoreName): string { return `${LS_PREFIX}${store}` }

function lsRead<T>(store: StoreName): Record<string, T> {
  try {
    const raw = localStorage.getItem(lsKey(store))
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' ? parsed as Record<string, T> : {}
  } catch { return {} }
}

function lsWrite<T>(store: StoreName, map: Record<string, T>): void {
  try { localStorage.setItem(lsKey(store), JSON.stringify(map)) }
  catch (err) { console.warn('[local-db] fallback localStorage penuh/gagal:', err) }
}

// ── API generik ──────────────────────────────────────────────────────────────

/** Baca SELURUH isi store. Tidak pernah melempar — gagal = array kosong. */
export async function dbAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDB()
  if (!db) return Object.values(lsRead<T>(store))
  return new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).getAll()
      req.onsuccess = () => resolve((req.result ?? []) as T[])
      req.onerror = () => { console.warn(`[local-db] gagal baca ${store}:`, req.error); resolve([]) }
    } catch (err) {
      console.warn(`[local-db] gagal baca ${store}:`, err)
      resolve([])
    }
  })
}

/** Baca SATU item berdasarkan key inline. */
export async function dbGet<T>(store: StoreName, key: string): Promise<T | null> {
  const db = await openDB()
  if (!db) return lsRead<T>(store)[key] ?? null
  return new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).get(key)
      req.onsuccess = () => resolve((req.result ?? null) as T | null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

/** Tulis SATU item (upsert by key inline). Gagal tulis TIDAK menghapus data lama. */
export async function dbPut<T extends object>(store: StoreName, value: T): Promise<boolean> {
  const db = await openDB()
  const key = String((value as Record<string, unknown>)[KEY_PATH[store]] ?? '')
  if (!key) return false
  if (!db) {
    const map = lsRead<T>(store)
    map[key] = value
    lsWrite(store, map)
    return true
  }
  return new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => { console.warn(`[local-db] gagal tulis ${store}:`, tx.error); resolve(false) }
      tx.onabort = () => resolve(false)
    } catch (err) {
      console.warn(`[local-db] gagal tulis ${store}:`, err)
      resolve(false)
    }
  })
}

/** Tulis BANYAK item dalam satu transaksi (lebih cepat & atomik). */
export async function dbPutMany<T extends object>(store: StoreName, values: T[]): Promise<boolean> {
  if (!values.length) return true
  const db = await openDB()
  if (!db) {
    const map = lsRead<T>(store)
    for (const v of values) {
      const key = String((v as Record<string, unknown>)[KEY_PATH[store]] ?? '')
      if (key) map[key] = v
    }
    lsWrite(store, map)
    return true
  }
  return new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readwrite')
      const os = tx.objectStore(store)
      for (const v of values) os.put(v)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => { console.warn(`[local-db] gagal tulis massal ${store}:`, tx.error); resolve(false) }
      tx.onabort = () => resolve(false)
    } catch (err) {
      console.warn(`[local-db] gagal tulis massal ${store}:`, err)
      resolve(false)
    }
  })
}

/** Hapus SATU item. Hanya dipanggil setelah server mengonfirmasi sukses. */
export async function dbDelete(store: StoreName, key: string): Promise<boolean> {
  const db = await openDB()
  if (!db) {
    const map = lsRead(store)
    if (!(key in map)) return true
    delete map[key]
    lsWrite(store, map)
    return true
  }
  return new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).delete(key)
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => resolve(false)
      tx.onabort = () => resolve(false)
    } catch { resolve(false) }
  })
}

export async function dbCount(store: StoreName): Promise<number> {
  const db = await openDB()
  if (!db) return Object.keys(lsRead(store)).length
  return new Promise(resolve => {
    try {
      const tx = db.transaction(store, 'readonly')
      const req = tx.objectStore(store).count()
      req.onsuccess = () => resolve(req.result ?? 0)
      req.onerror = () => resolve(0)
    } catch { resolve(0) }
  })
}

/** Kosongkan SATU store — hanya untuk aksi eksplisit petugas ("Reset Data"). */
export async function dbClear(store: StoreName): Promise<void> {
  const db = await openDB()
  if (!db) { try { localStorage.removeItem(lsKey(store)) } catch { /* ignore */ } return }
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
      tx.onabort = () => resolve()
    } catch { resolve() }
  })
}

// ── Meta (penanda migrasi / state kecil) ─────────────────────────────────────

export async function metaGet(key: string): Promise<unknown> {
  const row = await dbGet<{ k: string; v: unknown }>('meta', key)
  return row?.v ?? null
}

export async function metaSet(key: string, value: unknown): Promise<void> {
  await dbPut<{ k: string; v: unknown }>('meta', { k: key, v: value })
}

// ── Proteksi penghapusan oleh browser ────────────────────────────────────────

/**
 * Minta browser OS TIDAK menghapus storage origin (Chrome 68+, Android).
 * Ini pelengkap IndexedDB: mencegah eviction otomatis saat storage penuh.
 * Selalu resolve (tidak semua browser mendukung).
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const stor = navigator.storage
    if (!stor) return false
    if (stor.persisted && (await stor.persisted())) return true
    if (stor.persist) return await stor.persist()
  } catch { /* tidak didukung — abaikan */ }
  return false
}
