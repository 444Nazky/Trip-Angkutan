import { api } from './api'
import { refreshBackendSession } from './auth'
import { dbAll, dbDelete, dbPut, initLocalDb } from './localDb'
import type { Draft, VehicleEntry } from '../pages/store'
import type { Officer } from '../pages/types'

// Daftar alasan ada di modul terpisah supaya halaman admin bisa memakainya
// tanpa menarik modul antrean offline (IndexedDB) ke bundle dashboard.
export { CANCEL_REASONS, isCancelReason, type CancelReason } from './cancelReasons'

/**
 * Dokumen pembatalan.
 *
 * Ini YANG DIKIRIM ke server saat petugas membatalkan trip: bukan "hapus"
 * (yang menghapus jejak), tapi dokumen berisi alasan + rincian trip yang
 * dibatalkan, supaya admin tahu trip mana yang batal dan kenapa.
 */
export interface CancelDocument {
  /** Id lokal (kunci antrean). */
  cancelId: string
  /** UUID idempoten — retry tidak boleh membuat dokumen ganda. */
  clientCancelId: string
  /** Alasan pembatalan (wajib). */
  reason: string
  /** Keterangan tambahan dari petugas (opsional). */
  note: string
  routeFrom: string
  routeTo: string
  routeCode: string
  /** 'muatan' | 'kosong' | '' (belum dipilih). */
  condition: string
  vehicleCount: number
  vehicles: Array<{
    plate: string
    type: string
    category: string
    load: string
    tariff: number
  }>
  photoCount: number
  /**
   * Foto draft yang ikut dikirim sebagai bukti pembatalan.
   *
   * Disimpan sebagai data URL di antrean lokal; baru diubah jadi berkas saat
   * dikirim. Dokumen dari versi aplikasi lama tidak punya field ini.
   */
  photos?: CancelPhoto[]
  /** Kapan draft dibuat (epoch ms). */
  draftCreatedAt: number | null
  /** Kapan trip dimulai (epoch ms). */
  startedAt: number | null
  /** Kjango pembatalan (ISO). */
  cancelledAt: string
  officerId: string
  officerName: string
}

/** Foto draft yang dilampirkan pada dokumen pembatalan. */
export interface CancelPhoto {
  dataUrl: string
  mimeType: string
  label: string
}

/**
 * Item antrean pembatalan (dengan status percobaan kirim). */
export interface CancelQueueItem extends CancelDocument {
  attempts: number
  lastError?: string
  lastAttemptAt?: number
}

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch { /* fallback di bawah */ }
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Susun dokumen pembatalan dari draft yang sedang diisi.
 *
 * Rincian trip ikut diambil (rute, kendaraan, jumlah foto) supaya dokumen
 * yang diterima server benar-benar menjelaskan trip mana yang dibatalkan.
 */
export function buildCancelDocument(
  draft: Draft,
  officer: Pick<Officer, 'id' | 'name'>,
  reason: string,
  note = '',
): CancelDocument {
  const routeCode = (draft.routeCode ?? '').trim()
  const sep = routeCode.lastIndexOf('-')
  const routeFrom = sep > 0 ? routeCode.slice(0, sep).trim() : ''
  const routeTo = sep > 0 ? routeCode.slice(sep + 1).trim() : ''
  const vehicles: VehicleEntry[] = draft.vehicles ?? []
  const photoCount =
    (draft.photoUrl ? 1 : 0) +
    (draft.selfieUrl ? 1 : 0) +
    vehicles.filter(v => !!v.photoUrl).length

  const photos: CancelPhoto[] = []
  const addPhoto = (dataUrl: string | null | undefined, label: string) => {
    const url = String(dataUrl ?? '').trim()
    if (!url) return
    const mime = /^data:([^;,]+)/.exec(url)?.[1] ?? 'image/jpeg'
    photos.push({ dataUrl: url, mimeType: mime, label })
  }
  addPhoto(draft.photoUrl, 'Foto kondisi draft')
  addPhoto(draft.selfieUrl, 'Swafoto petugas')
  vehicles.forEach((v, i) => {
    addPhoto(v.photoUrl, `Foto kendaraan ${v.plate?.trim() || i + 1}`)
  })

  const clientCancelId = randomId()
  return {
    cancelId: `cancel:${clientCancelId}`,
    clientCancelId,
    reason: String(reason ?? '').trim(),
    note: String(note ?? '').trim(),
    routeFrom,
    routeTo,
    routeCode,
    condition: draft.condition ?? '',
    vehicleCount: vehicles.length,
    vehicles: vehicles.map(v => ({
      plate: (v.plate ?? '').trim(),
      type: v.type ?? '',
      category: v.category ?? '',
      load: v.load ?? '',
      tariff: v.tariff ?? 0,
    })),
    photoCount,
    photos,
    draftCreatedAt: draft.startedAt ?? null,
    startedAt: draft.startedAt ?? null,
    cancelledAt: new Date().toISOString(),
    officerId: String(officer.id ?? ''),
    officerName: officer.name ?? '',
  }
}

/** Semua dokumen pembatalan yang belum terkirim. */
export async function readCancelQueue(): Promise<CancelQueueItem[]> {
  try {
    await initLocalDb()
    const rows = await dbAll<CancelQueueItem>('pending-cancel')
    return rows.sort((a, b) => (a.cancelledAt ?? '').localeCompare(b.cancelledAt ?? ''))
  } catch {
    return []
  }
}

/**
 * Masukkan dokumen pembatalan ke antrean.
 *
 * Antrean (bukan langsung kirim) karena petugas sering offline di lapangan:
 * dokumen tetap tersimpan di perangkat dan dikirim begitu ada koneksi.
 */
export async function queueCancelDocument(doc: CancelDocument): Promise<void> {
  await initLocalDb()
  const item: CancelQueueItem = { ...doc, attempts: 0 }
  await dbPut<CancelQueueItem>('pending-cancel', item)
  window.setTimeout(() => { void processCancelQueue() }, 150)
}

/**
 * Kirim satu dokumen pembatalan.
 *
 * Tanpa foto cukup JSON (jalur lama). Dengan foto harus multipart, karena
 * berkas tidak bisa ditumpangkan pada JSON.
 */
async function sendCancelDocument(item: CancelQueueItem) {
  const payload = {
    clientCancelId: item.clientCancelId,
    reason: item.reason,
    note: item.note,
    routeFrom: item.routeFrom,
    routeTo: item.routeTo,
    routeCode: item.routeCode,
    condition: item.condition,
    vehicleCount: item.vehicleCount,
    vehicles: item.vehicles,
    photoCount: item.photoCount,
    startedAt: item.startedAt ? new Date(item.startedAt).toISOString() : null,
    cancelledAt: item.cancelledAt,
  }
  const photos = item.photos ?? []
  if (!photos.length) {
    return api.post<{ id?: string; noCancel?: string }>('/trips/cancel', payload)
  }

  const form = new FormData()
  const meta: { index: number; label: string }[] = []
  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i]
    const blob = await (await fetch(photo.dataUrl)).blob()
    const ext = photo.mimeType === 'image/png' ? 'png' : photo.mimeType === 'image/webp' ? 'webp' : 'jpg'
    form.append('photos', blob, `foto-${i}.${ext}`)
    meta.push({ index: i, label: photo.label })
  }
  form.append('payload', JSON.stringify({ ...payload, photos: meta }))
  // Unggah foto lebih lambat dari JSON biasa; beri waktu lebih.
  return api.post<{ id?: string; noCancel?: string }>('/trips/cancel', form, 60000)
}

/**
 * Kirim antrean pembatalan ke server.
 *
 * Berhasil  -> item dihapus dari antrean.
 * Gagal     -> item DISIMPAN dengan pesan error (dicoba lagi nanti).
 */
export async function processCancelQueue(): Promise<void> {
  const items = await readCancelQueue()
  if (!items.length) return

  for (const item of items) {
    try {
      let res = await sendCancelDocument(item)
      // 401 = token ditolak. Satu percobaan login ulang, lalu kirim lagi.
      if (!res.ok && res.error?.code === '401') {
        const ok = await refreshBackendSession()
        if (ok) res = await sendCancelDocument(item)
      }
      if (res.ok) {
        await dbDelete('pending-cancel', item.cancelId)
        continue
      }
      await dbPut<CancelQueueItem>('pending-cancel', {
        ...item,
        attempts: (item.attempts ?? 0) + 1,
        lastAttemptAt: Date.now(),
        lastError: res.error?.message ?? `Server menolak (HTTP ${res.error?.code ?? '?'})`,
      })
    } catch (err) {
      await dbPut<CancelQueueItem>('pending-cancel', {
        ...item,
        attempts: (item.attempts ?? 0) + 1,
        lastAttemptAt: Date.now(),
        lastError: err instanceof Error ? err.message : 'Gagal mengirim dokumen pembatalan',
      })
    }
  }
}

/** Jumlah dokumen pembatalan yang belum terkirim. */
export async function pendingCancelCount(): Promise<number> {
  return (await readCancelQueue()).length
}
