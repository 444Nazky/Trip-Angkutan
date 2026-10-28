import { api, toActionResult, failureReason, type ActionResult } from './api'



export interface GeofenceRule {
  id: string
  locationName: string
  /** Dermaga pemilik titik. Wajib dikirim agar titik TIDAK berlaku untuk semua
   *  dermaga (NULL = "berlaku umum"), yang dulu membuat daftar geofence petugas
   *  saling bercampur antar dermaga. */
  dermagaId?: string | null
  latitude: number
  longitude: number
  radiusMeters: number
  allowedRouteCodes: string[]
  allowedDirections: string[]
  description: string
  /** admin dashboard bisa menonaktifkan titik tanpa menghapusnya */
  enabled?: boolean
}



export async function fetchGeofenceRules(): Promise<GeofenceRule[] | null> {
  const rules = await api.getOk<GeofenceRule[]>('/geofences')
  if (!rules) return null
  return rules.map(r => ({
    ...r,
    allowedRouteCodes: Array.isArray(r.allowedRouteCodes) ? r.allowedRouteCodes : String(r.allowedRouteCodes ?? '').split(',').filter(Boolean),
    allowedDirections: Array.isArray(r.allowedDirections) ? r.allowedDirections : String(r.allowedDirections ?? '').split(',').filter(Boolean),
  }))
}



export async function createGeofenceRule(
  data: Omit<GeofenceRule, 'id'>
): Promise<ActionResult<string>> {
  const res = await api.post<{ id: string }>('/geofences', {
    locationName: data.locationName,
    // ponytail: dermagaId WAJIB ikut. Dulu field ini tidak pernah dikirim sehingga
    // setiap titik tersimpan dermaga_id = NULL ("berlaku umum") → semua dermaga
    // mendapat semua titik, radius saling tumpang tindih, dan filter per-dermaga
    // di aplikasi mobile tidak pernah bisa diandalkan.
    dermagaId: data.dermagaId ?? null,
    latitude: data.latitude,
    longitude: data.longitude,
    radiusMeters: data.radiusMeters,
    allowedRouteCodes: data.allowedRouteCodes,
    allowedDirections: data.allowedDirections,
    description: data.description,
    ...(data.enabled === undefined ? {} : { enabled: data.enabled }),
  })
  if (!res.ok) {
    return { ok: false, reason: failureReason(res, 'Titik geofence gagal ditambahkan karena server menolak permintaan') }
  }
  const id = res.data?.id
  return id
    ? { ok: true, data: id }
    : { ok: false, reason: 'Titik geofence gagal ditambahkan karena server tidak mengembalikan id' }
}



export async function updateGeofenceRule(
  id: string,
  data: Partial<GeofenceRule>
): Promise<ActionResult> {
  const res = await api.put(`/geofences/${id}`, data)
  return toActionResult(res, 'Titik geofence gagal diperbarui karena server menolak permintaan')
}



export async function deleteGeofenceRule(id: string): Promise<ActionResult> {
  const res = await api.delete(`/geofences/${id}`)
  return toActionResult(res, 'Titik geofence gagal dihapus karena server menolak permintaan')
}



export interface RouteGeofencePoint {
  id: string
  locationName: string
  dermagaId?: string | null
  latitude: number
  longitude: number
  radiusMeters: number
  description?: string
}



export async function fetchGeofencePointsForRoute(
  routeCode: string,
  dermagaId?: string | null,
): Promise<RouteGeofencePoint[]> {
  const all = await fetchGeofenceRules()
  if (!all) return []
  const normalizedRouteCode = routeCode.trim().toUpperCase()
  return all.filter(g =>
    g.allowedRouteCodes.some(code => code.trim().toUpperCase() === normalizedRouteCode)
      && (!dermagaId || !g.dermagaId || g.dermagaId === dermagaId),
  )
}



export async function createRouteGeofencePoint(
  routeCode: string,
  data: Omit<GeofenceRule, 'id' | 'allowedRouteCodes' | 'allowedDirections'>,
  opts?: { dermagaId?: string | null }
): Promise<ActionResult<string>> {
  return createGeofenceRule({
    ...data,
    dermagaId: opts?.dermagaId ?? data.dermagaId ?? null,
    allowedRouteCodes: [routeCode],
    allowedDirections: [],
  })
}
