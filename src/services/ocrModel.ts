/**
 * Model koreksi OCR dari dashboard admin (`/ocr`).
 *
 * Admin mengunggah foto plat + plat yang benar, lalu menekan "Latih model".
 * Server menyusun model kecil berisi:
 *   - `plates`: plat yang sudah dikonfirmasi manusia,
 *   - `confusions`: karakter yang sering tertukar (mis. 8 dibaca B).
 *
 * Aplikasi mengunduh model itu sekali (disimpan di localStorage), lalu
 * memakainya untuk "mengunci" hasil OCR yang mirip ke plat yang benar.
 * Ukurannya beberapa KB dan tanpa model ML tambahan, jadi tidak menambah
 * waktu pemindaian yang berarti.
 *
 * Offline-first: kalau server tidak terjangkau, model terakhir dari cache
 * tetap dipakai; kalau belum pernah ada, koreksi dilewati (tidak error).
 */

import { environment } from '../environments/environment'
import { formatPlateNumber, sanitizePlateInput } from '../utils/plateFormatter'

export interface PlateCorrectionModel {
  version: number
  samples: number
  plates: string[]
  confusions: [string, string, number][]
  trainedAt: string
  accuracy: number
}

const CACHE_KEY = 'trip.ocr.model.v1'
/** Model jarang berubah; cukup periksa sekali per 6 jam. */
const REFRESH_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 3500

let current: PlateCorrectionModel | null = null
let currentAt = 0
let loading: Promise<PlateCorrectionModel | null> | null = null

function baseUrl(): string {
  return environment.intranetApiBaseUrl ?? ''
}

function parse(raw: unknown): PlateCorrectionModel | null {
  const value = raw as Partial<PlateCorrectionModel> | null
  if (!value || typeof value.version !== 'number' || value.version <= 0) return null
  if (!Array.isArray(value.plates)) return null
  return {
    version: value.version,
    samples: Number(value.samples) || 0,
    plates: value.plates.filter((p): p is string => typeof p === 'string'),
    confusions: Array.isArray(value.confusions) ? value.confusions : [],
    trainedAt: String(value.trainedAt ?? ''),
    accuracy: Number(value.accuracy) || 0,
  }
}

function readCache(): PlateCorrectionModel | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; model?: unknown }
    if (typeof parsed.at === 'number') currentAt = parsed.at
    return parse(parsed.model)
  } catch {
    return null
  }
}

function writeCache(model: PlateCorrectionModel): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), model }))
  } catch { /* storage penuh / mode privat: model tetap dipakai di memori */ }
}

/** Model yang sedang aktif (null bila belum pernah diunduh). */
export function getPlateModel(): PlateCorrectionModel | null {
  return current
}

/**
 * Muat model dari server (dengan cache). Aman dipanggil berkali-kali.
 * Tidak pernah melempar error: kegagalan hanya berarti tanpa koreksi.
 */
export function loadPlateModel(force = false): Promise<PlateCorrectionModel | null> {
  if (loading) return loading
  if (!force && current && Date.now() - currentAt < REFRESH_MS) return Promise.resolve(current)
  if (!current) current = readCache()

  const base = baseUrl()
  if (!base) return Promise.resolve(current)

  loading = (async () => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/ocr/model?_t=${Date.now()}`, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: ctrl.signal,
      })
      if (!res.ok) return current
      const model = parse(await res.json())
      if (!model) return current
      // Versi server lebih lama daripada cache (mis. setelah reset) tetap
      // dipakai: server adalah sumber kebenaran.
      current = model
      currentAt = Date.now()
      writeCache(model)
      return current
    } catch {
      return current
    } finally {
      clearTimeout(timer)
      loading = null
    }
  })()

  return loading
}

/** Jarak edit sederhana (maksimum 1) untuk plat berukuran sama. */
function nearlyEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue
    if (++diff > 1) return false
  }
  return diff === 1
}

/**
 * Koreksi hasil OCR dengan plat yang sudah dikonfirmasi admin.
 *
 * Hanya dua kasus yang diubah, keduanya berisiko rendah:
 *   1. hasil OCR sama persis dengan plat terdaftar → tidak berubah (cocok);
 *   2. hasil OCR berbeda satu karakter dari TEPAT SATU plat terdaftar →
 *      dikembalikan ke plat terdaftar itu (mis. B 7777 XTE → B 7171 XYE).
 *
 * Lebih dari satu kandidat berarti ambigu: hasil OCR dibiarkan apa adanya.
 */
export function snapToKnownPlate(plate: string): string {
  const model = current
  if (!model || !plate) return plate
  const compact = plate.replace(/\s/g, '')
  if (!compact) return plate
  if (model.plates.includes(compact)) return plate

  let match = ''
  let matches = 0
  for (const known of model.plates) {
    if (!nearlyEqual(compact, known)) continue
    match = known
    if (++matches > 1) break
  }
  if (matches !== 1 || !match) return plate
  return formatPlateNumber(sanitizePlateInput(match))
}

/** Untuk pengujian: pasang model tanpa jaringan. */
export function setPlateModelForTest(model: PlateCorrectionModel | null): void {
  current = model
  currentAt = Date.now()
}
