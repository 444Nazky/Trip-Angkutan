import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { formatPlateNumber, sanitizePlateInput } from '../utils/plateFormatter'

/**
 * Data latih koreksi plat (offline).
 *
 * Saat petugas mengoreksi plat hasil scan, potongan gambar plat + plat prediksi
 * + plat yang benar disimpan di perangkat. Kumpulan ini bisa diekspor (JSON)
 * lalu dipakai untuk menyempurnakan model detektor/OCR di luar aplikasi.
 *
 * Disimpan di IndexedDB terpisah dari database trip supaya tidak memperberat
 * antrean sinkronisasi dan tidak pernah ikut terkirim ke server.
 */

const DB_NAME = 'plate-dataset-v1'
const DB_VERSION = 1
const STORE = 'samples'
/** Batas jumlah sampel di perangkat: ~20 KB per potongan ≈ 10 MB. */
export const MAX_SAMPLES = 500

export interface PlateSample {
  id?: number
  /** Kunci dedupe internal (tidak diekspor). */
  key?: string
  /** Plat hasil scan otomatis yang kemudian dikoreksi. */
  predicted: string
  /** Plat final yang dipakai petugas. */
  corrected: string
  /** Potongan gambar plat (data URL JPEG). */
  image: string
  /** Nama petugas yang mengoreksi, untuk penelusuran kualitas. */
  officer?: string
  createdAt: string
}

export interface PlateSampleInput {
  predicted: string
  corrected: string
  image: string
  officer?: string
}

function canonicalPlate(value: string): string {
  return formatPlateNumber(sanitizePlateInput(String(value ?? '')))
}

/**
 * Validasi + normalisasi satu sampel. Mengembalikan null bila sampel tidak
 * layak dipakai sebagai data latih (plat kosong, gambar bukan data URL, atau
 * koreksi tidak benar-benar mengubah plat).
 */
export function normalizePlateSample(input: PlateSampleInput, now = new Date()): PlateSample | null {
  const predicted = canonicalPlate(input.predicted)
  const corrected = canonicalPlate(input.corrected)
  if (!corrected) return null
  if (!/^data:image\//.test(input.image ?? '')) return null
  // Prediksi sama dengan koreksi bukan sampel koreksi; tidak ada sinyal belajar.
  if (predicted && predicted === corrected) return null
  return {
    predicted,
    corrected,
    image: input.image,
    officer: input.officer?.trim() || undefined,
    createdAt: now.toISOString(),
  }
}

/** Kunci dedupe sederhana: plat + gambar yang identik tidak disimpan dua kali. */
export function sampleKey(sample: Pick<PlateSample, 'predicted' | 'corrected' | 'image'>): string {
  return `${sample.predicted}|${sample.corrected}|${sample.image.length}|${sample.image.slice(-64)}`
}

// ── Penyimpanan ────────────────────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase | null> | null = null
let memory: PlateSample[] = []
let memoryId = 0

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise(resolve => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null)
        return
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
          // Indeks kunci dedupe: cukup baca kunci, tidak perlu memuat semua gambar.
          store.createIndex('key', 'key', { unique: false })
        }
      }
      req.onsuccess = () => {
        const db = req.result
        db.onversionchange = () => { try { db.close() } catch { /* ignore */ }; dbPromise = null }
        resolve(db)
      }
      req.onerror = () => {
        console.warn('[plate-dataset] IndexedDB gagal dibuka:', req.error)
        resolve(null)
      }
    } catch (err) {
      console.warn('[plate-dataset] IndexedDB tidak tersedia:', err)
      resolve(null)
    }
  })
  return dbPromise
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T>,
): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  try {
    const tx = db.transaction(STORE, mode)
    // Listener dipasang SEBELUM operasi dijalankan: transaksi bisa selesai
    // lebih dulu, dan listener yang dipasang setelahnya tidak akan terpanggil
    // (janji menggantung).
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onabort = () => reject(tx.error)
      tx.onerror = () => reject(tx.error)
    })
    let result: T
    try {
      result = await fn(tx.objectStore(STORE))
    } catch (err) {
      try { tx.abort() } catch { /* sudah selesai */ }
      await done.catch(() => { /* diabaikan */ })
      throw err
    }
    await done
    return result
  } catch (err) {
    console.warn('[plate-dataset] operasi gagal:', err)
    return null
  }
}

/** Simpan satu sampel koreksi. Mengembalikan true bila benar-benar tersimpan. */
export async function recordPlateSample(input: PlateSampleInput): Promise<boolean> {
  const sample = normalizePlateSample(input)
  if (!sample) return false
  const key = sampleKey(sample)

  const stored = await withStore('readwrite', async store => {
    const existing = await requestToPromise(store.index('key').getKey(key))
    if (existing !== undefined) return false
    // Buang sampel tertua bila sudah mencapai batas.
    const total = await requestToPromise(store.count())
    if (total >= MAX_SAMPLES) {
      const all = await requestToPromise(store.getAll() as IDBRequest<PlateSample[]>)
      const oldest = [...all]
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, total - MAX_SAMPLES + 1)
      for (const s of oldest) if (s.id !== undefined) store.delete(s.id)
    }
    store.add({ ...sample, key })
    return true
  })

  if (stored === null) {
    // Fallback memori (mis. WebView tanpa IndexedDB): tetap bisa diekspor
    // selama aplikasi masih terbuka.
    const key = sampleKey(sample)
    if (memory.some(s => sampleKey(s) === key)) return false
    memory = [...memory, { ...sample, id: ++memoryId }].slice(-MAX_SAMPLES)
    return true
  }
  return stored
}

export async function countPlateSamples(): Promise<number> {
  const count = await withStore('readonly', async store => requestToPromise(store.count()))
  return count ?? memory.length
}

export async function listPlateSamples(): Promise<PlateSample[]> {
  const all = await withStore('readonly', async store => requestToPromise(store.getAll() as IDBRequest<PlateSample[]>))
  const samples = all ?? memory
  return [...samples].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function clearPlateSamples(): Promise<void> {
  await withStore('readwrite', async store => { store.clear(); return true })
  memory = []
}

// ── Ekspor ─────────────────────────────────────────────────────────────────

/** Payload JSON siap diserahkan ke pelatihan model. */
export function buildDatasetExport(samples: PlateSample[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({
    version: 1,
    kind: 'plate-corrections',
    exportedAt,
    count: samples.length,
    // `image` = potongan plat (JPEG data URL), `corrected` = label ground truth.
    samples: samples.map(({ predicted, corrected, image, officer, createdAt }) => ({
      image,
      predicted,
      corrected,
      officer,
      createdAt,
    })),
  })
}

export interface DatasetExportResult {
  count: number
  /** Lokasi berkas di perangkat (Android) atau nama berkas unduhan (web). */
  location: string
}

/**
 * Ekspor semua sampel ke berkas JSON.
 * Android: `Documents/data-latih-plat-<tanggal>.json`; web: unduhan biasa.
 */
export async function exportPlateDataset(): Promise<DatasetExportResult> {
  const samples = await listPlateSamples()
  const json = buildDatasetExport(samples)
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const fileName = `data-latih-plat-${stamp}.json`

  if (Capacitor.isNativePlatform()) {
    const res = await Filesystem.writeFile({
      path: fileName,
      data: json,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
      recursive: true,
    })
    return { count: samples.length, location: res.uri }
  }

  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { count: samples.length, location: fileName }
}
