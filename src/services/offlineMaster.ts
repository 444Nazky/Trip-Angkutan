/**
 * Master data untuk mode offline: region + master plat + tarif per region.
 *
 * Kenapa modul ini ada:
 * - `GET /plates` (master plat) butuh admin, dan `GET /region-tariffs` juga
 *   admin. Petugas di lapangan TIDAK PERNAH bisa menarik data itu ke HP.
 * - Akibatnya `POST /plates/check` (cek status plat: internal/lokal/eksternal)
 *   hanya jalan ketika ada sinyal. Tanpa sinyal, petugas tidak tahu apakah
 *   kendaraannya internal (Rp 0) atau eksternal — dan tarif region pun tidak
 *   pernah ada di perangkat.
 *
 * Solusi: backend menyediakan satu endpoint `GET /master/offline` yang
 * mengembalikan paket master (region + plat + tarif region) dalam satu
 * request, lalu modul ini menyimpannya di perangkat.
 *
 * Catatan privasi: paket TIDAK memuat nama pemilik kendaraan (`owner`) —
 * hanya nomor plat, status, dan region asal, karena itu yang dibutuhkan untuk
 * menentukan apakah kendaraan ditagih.
 */

import { api } from './api'

export type PlateStatus = 'internal' | 'lokal' | 'eksternal'

export interface OfflinePlate {
  /** Kunci pencocokan: huruf+angka saja, tanpa spasi (mis. "B1234XY"). */
  key: string
  /** Nomor plat seperti tersimpan di server (untuk ditampilkan). */
  plate: string
  status: PlateStatus
  originRegionId: string | null
  originRegionCode: string | null
}

export interface OfflineRegion {
  id: string
  name: string
  code: string
}

export interface OfflineRegionTariff {
  regionId: string
  regionCode: string | null
  tariffType: 'lokal' | 'eksternal'
  nominalTariff: number
  isActive: boolean
}

export interface OfflineMasterPack {
  pulledAt: number
  regions: OfflineRegion[]
  plates: OfflinePlate[]
  regionTariffs: OfflineRegionTariff[]
}

export const OFFLINE_MASTER_KEY = 'trip.master.offline.v1'

const EMPTY_PACK: OfflineMasterPack = { pulledAt: 0, regions: [], plates: [], regionTariffs: [] }

/**
 * Kunci pencocokan plat: huruf + angka saja, huruf besar.
 *
 * Plat bisa tersimpan dengan spasi ("B 1234 XY") maupun tanpa ("B1234XY"),
 * sedangkan petugas mengetik dengan format mobile. Semua disamakan di sini
 * supaya pencocokan tidak bocor karena beda spasi.
 */
export function normalizePlateKey(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function isPlateStatus(raw: unknown): raw is PlateStatus {
  return raw === 'internal' || raw === 'lokal' || raw === 'eksternal'
}

function parsePack(raw: string | null): OfflineMasterPack | null {
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const p = parsed as Partial<OfflineMasterPack>
    const regions: OfflineRegion[] = Array.isArray(p.regions)
      ? p.regions
          .filter((r): r is OfflineRegion => !!r && typeof r === 'object')
          .map(r => ({ id: String(r.id ?? ''), name: String(r.name ?? ''), code: String(r.code ?? '') }))
          .filter(r => r.id || r.code)
      : []
    const plates: OfflinePlate[] = Array.isArray(p.plates)
      ? p.plates
          .filter((x): x is OfflinePlate => !!x && typeof x === 'object')
          .map(x => ({
            key: normalizePlateKey(x.key || x.plate),
            plate: String(x.plate ?? '').toUpperCase(),
            status: isPlateStatus(x.status) ? x.status : 'internal',
            originRegionId: x.originRegionId ? String(x.originRegionId) : null,
            originRegionCode: x.originRegionCode ? String(x.originRegionCode) : null,
          }))
          .filter(x => x.key)
      : []
    const regionTariffs: OfflineRegionTariff[] = Array.isArray(p.regionTariffs)
      ? p.regionTariffs
          .filter((t): t is OfflineRegionTariff => !!t && typeof t === 'object')
          .map(t => ({
            regionId: String(t.regionId ?? ''),
            regionCode: t.regionCode ? String(t.regionCode) : null,
            tariffType: t.tariffType === 'eksternal' ? 'eksternal' : 'lokal',
            nominalTariff: Number(t.nominalTariff ?? 0) || 0,
            isActive: t.isActive !== false,
          }))
          .filter(t => t.regionId)
      : []
    return {
      pulledAt: Number(p.pulledAt ?? 0) || 0,
      regions,
      plates,
      regionTariffs,
    }
  } catch {
    return null
  }
}

/** Paket master yang tersimpan di perangkat (null bila belum pernah ditarik). */
export function getOfflineMaster(): OfflineMasterPack | null {
  try {
    const raw = localStorage.getItem(OFFLINE_MASTER_KEY)
    return parsePack(raw)
  } catch {
    return null
  }
}

/**
 * Simpan paket master ke perangkat.
 *
 * Hasil kosong TIDAK menimpa cache lama: respons kosong sesaat (mis. tabel
 * sedang di-reset di server) tidak boleh menghapus data yang sudah dipakai
 * petugas di lapangan.
 */
export function saveOfflineMaster(pack: OfflineMasterPack): boolean {
  try {
    const payload: OfflineMasterPack = {
      pulledAt: pack.pulledAt || Date.now(),
      regions: pack.regions ?? [],
      plates: pack.plates ?? [],
      regionTariffs: pack.regionTariffs ?? [],
    }
    localStorage.setItem(OFFLINE_MASTER_KEY, JSON.stringify(payload))
    return true
  } catch {
    // Kuota localStorage penuh → pertahankan cache lama.
    return false
  }
}

export function clearOfflineMaster(): void {
  try {
    localStorage.removeItem(OFFLINE_MASTER_KEY)
  } catch {
    /* abaikan */
  }
}

/**
 * Tarik paket master offline dari server.
 *
 * Satu request untuk region + plat + tarif region supaya kuota Edge Function
 * tidak naik. Gagal (offline / 401) TIDAK menghapus cache lokal.
 */
export async function pullOfflineMaster(): Promise<{
  ok: boolean
  plates: number
  regions: number
  tariffs: number
}> {
  const cached = getOfflineMaster()
  const res = await api.get<Partial<OfflineMasterPack>>('/master/offline').catch(() => null)
  if (!res || !res.ok || !res.data || typeof res.data !== 'object') {
    return {
      ok: false,
      plates: cached?.plates.length ?? 0,
      regions: cached?.regions.length ?? 0,
      tariffs: cached?.regionTariffs.length ?? 0,
    }
  }

  const data = res.data
  const regions: OfflineRegion[] = Array.isArray(data.regions)
    ? data.regions
        .filter((r): r is OfflineRegion => !!r && typeof r === 'object')
        .map(r => ({ id: String(r.id ?? ''), name: String(r.name ?? ''), code: String(r.code ?? '') }))
        .filter(r => r.id || r.code)
    : []
  const plates: OfflinePlate[] = Array.isArray(data.plates)
    ? data.plates
        .filter((p): p is OfflinePlate => !!p && typeof p === 'object')
        .map(p => ({
          key: normalizePlateKey(p.key || p.plate),
          plate: String(p.plate ?? '').toUpperCase(),
          status: isPlateStatus(p.status) ? p.status : 'internal',
          originRegionId: p.originRegionId ? String(p.originRegionId) : null,
          originRegionCode: p.originRegionCode ? String(p.originRegionCode) : null,
        }))
        .filter(p => p.key)
    : []
  const regionTariffs: OfflineRegionTariff[] = Array.isArray(data.regionTariffs)
    ? data.regionTariffs
        .filter((t): t is OfflineRegionTariff => !!t && typeof t === 'object')
        .map(t => ({
          regionId: String(t.regionId ?? ''),
          regionCode: t.regionCode ? String(t.regionCode) : null,
          tariffType: t.tariffType === 'eksternal' ? 'eksternal' : 'lokal',
          nominalTariff: Number(t.nominalTariff ?? 0) || 0,
          isActive: t.isActive !== false,
        }))
        .filter(t => t.regionId)
    : []

  // Server balas kosong → jangan timpa cache yang masih berguna.
  if (plates.length === 0 && regions.length === 0) {
    return {
      ok: false,
      plates: cached?.plates.length ?? 0,
      regions: cached?.regions.length ?? 0,
      tariffs: cached?.regionTariffs.length ?? 0,
    }
  }

  saveOfflineMaster({ pulledAt: Date.now(), regions, plates, regionTariffs })
  return { ok: true, plates: plates.length, regions: regions.length, tariffs: regionTariffs.length }
}

/** Cari master plat di cache offline (sudah dinormalisasi spasi). */
export function findOfflinePlate(plate: string): OfflinePlate | null {
  const key = normalizePlateKey(plate)
  if (!key) return null
  const pack = getOfflineMaster()
  if (!pack) return null
  return pack.plates.find(p => p.key === key) ?? null
}

/** Kode region dari cache offline. */
export function getOfflineRegionCode(regionId: string | null | undefined): string | null {
  if (!regionId) return null
  const pack = getOfflineMaster()
  if (!pack) return null
  const region = pack.regions.find(r => r.id === String(regionId))
  if (region?.code) return region.code
  const tariff = pack.regionTariffs.find(t => t.regionId === String(regionId))
  return tariff?.regionCode ?? null
}

/** Tarif per region (lokal/eksternal) dari cache offline. */
export function getOfflineRegionTariff(
  regionId: string | null | undefined,
  tariffType: 'lokal' | 'eksternal',
): number {
  if (!regionId) return 0
  const pack = getOfflineMaster()
  if (!pack) return 0
  const row = pack.regionTariffs.find(
    t => t.regionId === String(regionId) && t.tariffType === tariffType && t.isActive,
  )
  return row ? Number(row.nominalTariff) || 0 : 0
}

/** Ringkasan isi cache offline (untuk layar pengaturan / debug). */
export function getOfflineMasterStatus(): {
  hasPack: boolean
  pulledAt: number | null
  plates: number
  regions: number
  tariffs: number
} {
  const pack = getOfflineMaster()
  if (!pack) return { hasPack: false, pulledAt: null, plates: 0, regions: 0, tariffs: 0 }
  return {
    hasPack: true,
    pulledAt: pack.pulledAt || null,
    plates: pack.plates.length,
    regions: pack.regions.length,
    tariffs: pack.regionTariffs.length,
  }
}
