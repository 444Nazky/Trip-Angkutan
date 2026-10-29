import { api, toActionResult, failureReason, type ActionResult } from './api'



export interface Dermaga {
  id: string
  /** Wilayah pemilik dermaga. `null` = dermaga yatim (wilayahnya sudah dihapus). */
  region_id: string | null
  name: string
  code: string
  region_name?: string
  region_code?: string
}



export interface Route {
  id: string
  dermaga_id: string
  name: string
  route_from: string
  route_to: string
  distance?: string | null
  duration?: string | null
}



export async function fetchDermagas(): Promise<Dermaga[] | null> {
  return api.getOk<Dermaga[]>('/dermagas')
}



export async function fetchRoutes(): Promise<Route[] | null> {
  return api.getOk<Route[]>('/routes')
}


export async function createDermaga(data: { region_id: string; name: string; code: string }): Promise<ActionResult<string>> {
  const result = await api.post<{ id: string }>('/dermagas', data)
  if (!result.ok) {
    return { ok: false, reason: failureReason(result, 'Dermaga gagal ditambahkan karena server menolak permintaan') }
  }
  const id = result.data?.id
  return id
    ? { ok: true, data: id }
    : { ok: false, reason: 'Dermaga gagal ditambahkan karena server tidak mengembalikan id' }
}


export async function deleteDermaga(id: string): Promise<ActionResult> {
  const result = await api.delete(`/dermagas/${id}`)
  return toActionResult(result, 'Dermaga gagal dihapus karena server menolak permintaan')
}

/**
 * Ubah data dermaga (nama / kode / wilayah).
 *
 * Server hanya mengubah field yang benar-benar dikirim (`updateDermaga` di
 * `server/api/handlers/master.ts`), jadi `name` boleh dikirim sendiri tanpa
 * ikut mengubah kode atau wilayah.
 */
export async function updateDermaga(
  id: string,
  data: { name?: string; code?: string; region_id?: string },
): Promise<ActionResult> {
  const result = await api.put(`/dermagas/${id}`, data)
  return toActionResult(result, 'Dermaga gagal diperbarui karena server menolak permintaan')
}



export async function createRoute(data: Omit<Route, 'id'>): Promise<ActionResult<string>> {
  const result = await api.post<{ id: string }>('/routes', data)
  if (!result.ok) {
    return { ok: false, reason: failureReason(result, 'Rute gagal ditambahkan karena server menolak permintaan') }
  }
  const id = result.data?.id
  return id
    ? { ok: true, data: id }
    : { ok: false, reason: 'Rute gagal ditambahkan karena server tidak mengembalikan id' }
}



export async function updateRoute(id: string, data: Partial<Route>): Promise<ActionResult> {
  const result = await api.put(`/routes/${id}`, data)
  return toActionResult(result, 'Rute gagal diperbarui karena server menolak permintaan')
}



export async function deleteRoute(id: string): Promise<ActionResult> {
  const result = await api.delete(`/routes/${id}`)
  return toActionResult(result, 'Rute gagal dihapus karena server menolak permintaan')
}
