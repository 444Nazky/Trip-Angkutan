// Master jenis kendaraan - satu-satunya daftar jenis kendaraan yang sah.
import { api, toActionResult, type ActionResult } from './api'



export interface VehicleType {
  id: string
  name: string
  key: string
  sortOrder: number
  isActive: boolean
}



export interface ServerVehicleType {
  id?: string
  name?: string
  key?: string
  sortOrder?: number
  is_active?: number
}



export function vehicleTypeKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/truck/g, 'truk')
    .replace(/[^a-z0-9]/g, '')
}



function toRow(s: ServerVehicleType): VehicleType | null {
  const name = String(s.name ?? '').trim()
  if (!name) return null
  return {
    id: String(s.id ?? ''),
    name,
    key: String(s.key ?? vehicleTypeKey(name)),
    sortOrder: Number(s.sortOrder ?? 0) || 0,
    isActive: s.is_active === undefined ? true : Number(s.is_active) === 1,
  }
}



export async function fetchVehicleTypes(includeInactive = false): Promise<VehicleType[] | null> {
  const url = includeInactive ? '/vehicle-types?includeInactive=1' : '/vehicle-types'
  const rows = await api.getOk<ServerVehicleType[]>(url)
  if (!rows) return null
  return rows.map(toRow).filter((r): r is VehicleType => r !== null)
}



export async function createVehicleType(name: string): Promise<ActionResult> {
  const res = await api.post<{ id: string }>('/vehicle-types', { name })
  return toActionResult(res, 'Jenis kendaraan gagal ditambahkan karena server menolak permintaan')
}

/** Ubah jenis kendaraan (nama / urutan / status aktif). */
export async function updateVehicleType(
  id: string,
  patch: { name?: string; sortOrder?: number; isActive?: boolean },
): Promise<ActionResult> {
  const res = await api.put(`/vehicle-types/${id}`, patch)
  return toActionResult(res, 'Jenis kendaraan gagal diperbarui karena server menolak permintaan')
}



export async function deleteVehicleType(id: string): Promise<ActionResult> {
  const res = await api.delete(`/vehicle-types/${id}`)
  return toActionResult(res, 'Jenis kendaraan gagal dihapus karena server menolak permintaan')
}

// ── Sisi petugas (HP): cache lokal supaya dropdown tetap ada saat offline ───

export const VEHICLE_TYPES_STORAGE_KEY = 'trip.vehicleTypes.v1'



export const VEHICLE_TYPES_UPDATED_EVENT = 'trip:vehicle-types-updated'



export function getStoredVehicleTypes(): VehicleType[] {
  try {
    const raw = localStorage.getItem(VEHICLE_TYPES_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((v) => (v && typeof v === 'object' ? (v as Partial<VehicleType>) : null))
      .filter((v): v is Partial<VehicleType> => v !== null)
      .map((v) => ({
        id: String(v.id ?? ''),
        name: String(v.name ?? ''),
        key: String(v.key ?? vehicleTypeKey(v.name)),
        sortOrder: Number(v.sortOrder ?? 0) || 0,
        isActive: v.isActive === undefined ? true : !!v.isActive,
      }))
      .filter((v) => v.name)
  } catch {
    return []
  }
}



function saveVehicleTypes(rows: VehicleType[]): void {
  try {
    localStorage.setItem(VEHICLE_TYPES_STORAGE_KEY, JSON.stringify(rows))
  } catch {
  }
  try {
    window.dispatchEvent(new Event(VEHICLE_TYPES_UPDATED_EVENT))
  } catch {
  }
}

// Tarik daftar jenis kendaraan dari server ke perangkat.
export async function pullVehicleTypesToLocal(): Promise<number> {
  const cached = getStoredVehicleTypes()
  const rows = await fetchVehicleTypes().catch(() => null)
  if (!rows || rows.length === 0) return cached.length
  saveVehicleTypes(rows)
  return rows.length
}
