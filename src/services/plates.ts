import { api } from './api'
import { getStoredOfficer } from './auth'
import {
  findOfflinePlate,
  getOfflineMaster,
  getOfflineRegionCode,
  getOfflineRegionTariff,
  normalizePlateKey,
  type PlateStatus,
} from './offlineMaster'

export type { PlateStatus }



export interface PlateCheck {
  found: boolean
  plate: string
  owner: string | null
  status: PlateStatus
  jenisTarif: 'lokal' | 'eksternal' | null
  originRegionId: string | null
  originRegionCode: string | null
  checkpointRegionId: string | null
  checkpointRegionCode: string | null
  tariffAmount: number
  /** true bila hasil dihitung dari cache lokal (server tidak terjangkau). */
  offline?: boolean
}



// ponytail: cache hasil cek plat di memori supaya plat yang sama tidak
// memicu request server berulang (mis. saat user mengoreksi lalu mengetik ulang).
const plateCheckCache = new Map<string, { at: number; data: PlateCheck | null }>()
const PLATE_CACHE_TTL = 5 * 60 * 1000

/**
 * Cek status plat TANPA server, memakai paket master offline.
 *
 * Aturan penentuan status disalin dari `handlers/plates.ts` (checkPlate) agar
 * hasil offline sama dengan hasil online:
 * - plat terdaftar internal  -> internal (tidak ditagih)
 * - plat terdaftar lokal     -> lokal, atau eksternal bila region asal != region cek
 * - plat terdaftar eksternal -> eksternal
 * - plat tidak terdaftar    -> lokal (bila region asal = region cek)
 *
 * Mengembalikan null bila paket master offline belum pernah ditarik.
 */
export function checkPlateOffline(
  plate: string,
  originRegionId?: string | null,
): PlateCheck | null {
  const key = normalizePlateKey(plate)
  if (!key) return null

  // Tanpa paket master offline TIDAK boleh ditebak: kita tidak tahu apakah
  // plat itu terdaftar internal (Rp 0) atau bukan. Menebak "lokal" yang
  // salah akan kenakan tarif pada kendaraan internal — lebih baik tidak ada
  // jawaban sama sekali.
  if (!getOfflineMaster()) return null

  const officer = getStoredOfficer()
  const checkpointRegionId = officer?.regionId ? String(officer.regionId) : null
  const registered = findOfflinePlate(key)
  if (!registered && !checkpointRegionId) return null

  let status: PlateStatus
  let origin: string | null
  if (registered?.status === 'internal') {
    status = 'internal'
    origin = registered.originRegionId || checkpointRegionId
  } else if (registered?.status) {
    status = registered.status
    origin = registered.originRegionId || originRegionId || checkpointRegionId
    if (status === 'lokal' && origin && checkpointRegionId && origin !== checkpointRegionId) {
      status = 'eksternal'
    }
  } else {
    origin = originRegionId || checkpointRegionId
    status = origin && checkpointRegionId && origin !== checkpointRegionId ? 'eksternal' : 'lokal'
  }

  const jenisTarif = status === 'internal' ? null : status
  const tariffAmount = jenisTarif ? getOfflineRegionTariff(checkpointRegionId, jenisTarif) : 0

  return {
    found: !!registered,
    plate: registered?.plate || key,
    owner: null,
    status,
    jenisTarif,
    originRegionId: origin,
    originRegionCode: getOfflineRegionCode(origin),
    checkpointRegionId,
    checkpointRegionCode: getOfflineRegionCode(checkpointRegionId),
    tariffAmount,
    offline: true,
  }
}

export async function checkPlate(
  plate: string,
  originRegionId?: string | null,
): Promise<PlateCheck | null> {
  const key = `${String(plate || '').trim().toUpperCase()}::${originRegionId ?? ''}`
  const cached = plateCheckCache.get(key)
  if (cached && Date.now() - cached.at < PLATE_CACHE_TTL) return cached.data

  const res = await api.post<PlateCheck>('/plates/check', {
    plate,
    originRegionId: originRegionId || undefined,
  })
  if (res.ok && res.data) {
    plateCheckCache.set(key, { at: Date.now(), data: res.data })
    return res.data
  }

  // Server tidak terjangkau (offline / timeout / sesi habis): pakai paket
  // master offline supaya petugas tetap bisa menentukan status kendaraan.
  const offline = checkPlateOffline(plate, originRegionId)
  // Kalau paket master offline belum ada, jangan di-cache: begitu paketnya
  // tiba, pemeriksaan berikutnya harus langsung memakai data baru.
  if (offline) plateCheckCache.set(key, { at: Date.now(), data: offline })
  return offline
}

export interface PlateRecord {
  id: string
  plate: string
  owner: string | null
  origin_region_id: string | null
  origin_region_code?: string | null
  origin_region_name?: string | null
  status: PlateStatus
  is_active: number
  created_at: string
}

export async function fetchPlates(): Promise<PlateRecord[] | null> {
  return api.getOk<PlateRecord[]>('/plates')
}

export async function createPlate(input: {
  plate: string
  owner?: string
  originRegionId?: string | null
  status: PlateStatus
}): Promise<string | null> {
  const res = await api.post<{ id: string }>('/plates', input)
  if (res.ok && res.data) return res.data.id
  return null
}

export async function updatePlate(
  id: string,
  input: { plate?: string; owner?: string; originRegionId?: string | null; status?: PlateStatus; isActive?: boolean },
): Promise<boolean> {
  const res = await api.put(`/plates/${id}`, input)
  return res.ok
}

export async function deletePlate(id: string): Promise<boolean> {
  const res = await api.delete(`/plates/${id}`)
  return res.ok
}
