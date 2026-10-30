/**
 * Master tarif untuk APLIKASI MOBILE — sumber tunggal data tarif di perangkat.
 *
 * Dipakai oleh: adminPull (sinkron master), prefetch (pengisian data awal),
 * dan store (state UI form kendaraan).
 *
 * Format simpan: localStorage `trip.tariffs.v1` (dipakai store sebagai LS.tariffs).
 * Catatan: `services/tariffs.ts` adalah modul CRUD tarif untuk ADMIN dashboard —
 * jangan dipakai mobile.
 */

import { api } from './api'

/** Kunci yang sama dipakai store (`LS.tariffs`) — jangan diubah sendiri. */
export const TARIFFS_STORAGE_KEY = 'trip.tariffs.v1'

/** Dipancarkan saat tarif berubah supaya UI (form kendaraan) langsung ikut. */
export const TARIFF_UPDATED_EVENT = 'trip:tariffs-updated'

export interface StoredTariff {
  id: string
  golongan: string
  type: string
  loaded: string
  loadedNum: number
  empty: string
  emptyNum: number
  desc: string
}

interface ServerTariff {
  id?: string
  golongan?: string
  vehicle_type?: string
  loaded_tariff?: number
  empty_tariff?: number
  description?: string | null
}

function fmtRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

function toStoredTariff(s: ServerTariff): StoredTariff | null {
  const type = String(s.vehicle_type ?? '').trim()
  if (!type) return null
  const loadedNum = Number(s.loaded_tariff) || 0
  const emptyNum = Number(s.empty_tariff) || 0
  return {
    id: String(s.id ?? ''),
    golongan: String(s.golongan ?? '').trim(),
    type,
    loaded: fmtRp(loadedNum),
    loadedNum,
    empty: fmtRp(emptyNum),
    emptyNum,
    desc: String(s.description ?? ''),
  }
}

/** Tarif yang tersimpan di perangkat (kosong = belum pernah tersinkron). */
export function getStoredTariffs(): StoredTariff[] {
  try {
    const raw = localStorage.getItem(TARIFFS_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(r => (r && typeof r === 'object' ? (r as Partial<StoredTariff>) : null))
      .filter((r): r is Partial<StoredTariff> => r !== null)
      .map(r => ({
        id: String(r.id ?? ''),
        golongan: String(r.golongan ?? ''),
        type: String(r.type ?? ''),
        loaded: String(r.loaded ?? ''),
        loadedNum: Number(r.loadedNum) || 0,
        empty: String(r.empty ?? ''),
        emptyNum: Number(r.emptyNum) || 0,
        desc: String(r.desc ?? ''),
      }))
      .filter(r => r.type)
  } catch {
    return []
  }
}

export function saveTariffs(tariffs: StoredTariff[]): void {
  try { localStorage.setItem(TARIFFS_STORAGE_KEY, JSON.stringify(tariffs)) } catch { /* quota */ }
  try { window.dispatchEvent(new Event(TARIFF_UPDATED_EVENT)) } catch { /* ignore */ }
}

/**
 * Tarik master tarif admin ke perangkat petugas.
 *
 * Dipakai `tariffFor()` saat petugas menambah kendaraan, jadi nominal yang
 * tersimpan di trip = tarif admin terakhir, bukan angka contoh bawaan.
 * Hasil kosong TIDAK menimpa cache (sama seperti geofence/region): tabel yang
 * sedang kosong sesaat tidak boleh menghapus tarif yang sudah dipakai.
 */
export async function pullTariffsToLocal(): Promise<number> {
  const cached = getStoredTariffs()
  const res = await api.get<ServerTariff[]>('/master/tariffs').catch(() => null)
  if (!res || !res.ok || !Array.isArray(res.data)) return cached.length
  const rows = res.data
    .map(toStoredTariff)
    .filter((r): r is StoredTariff => r !== null)
  if (rows.length === 0) return cached.length
  saveTariffs(rows)
  return rows.length
}
