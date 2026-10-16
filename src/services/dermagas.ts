import { api } from './api'



export interface Dermaga {
  id: string
  region_id: string
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



export async function createRoute(data: Omit<Route, 'id'>): Promise<string | null> {
  const result = await api.post<{ id: string }>('/routes', data)
  return result.ok ? result.data?.id ?? null : null
}



export async function updateRoute(id: string, data: Partial<Route>): Promise<boolean> {
  const result = await api.put(`/routes/${id}`, data)
  return result.ok
}



export async function deleteRoute(id: string): Promise<boolean> {
  const result = await api.delete(`/routes/${id}`)
  return result.ok
}
