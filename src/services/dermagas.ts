// ─── Regions, Dermagas, Routes Service ───────────────────────────────────────

import { api } from './api'
import type { Region, Dermaga, Route } from '../pages/types'

export { type Region, type Dermaga, type Route }

export async function fetchRegions(): Promise<Region[] | null> {
  const result = await api.get<Region[]>('/regions')
  return result.ok ? result.data ?? null : null
}

export async function fetchDermagas(): Promise<Dermaga[] | null> {
  const result = await api.get<Dermaga[]>('/dermagas')
  return result.ok ? result.data ?? null : null
}

export async function fetchRoutes(): Promise<Route[] | null> {
  const result = await api.get<Route[]>('/routes')
  return result.ok ? result.data ?? null : null
}

export async function createDermaga(data: Omit<Dermaga, 'id'>): Promise<string | null> {
  const result = await api.post<{ id: string }>('/dermagas', data)
  return result.ok ? result.data?.id ?? null : null
}

export async function updateDermaga(id: string, data: Partial<Dermaga>): Promise<boolean> {
  const result = await api.put(`/dermagas/${id}`, data)
  return result.ok
}

export async function deleteDermaga(id: string): Promise<boolean> {
  const result = await api.delete(`/dermagas/${id}`)
  return result.ok
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

// Assign officer to dermaga(s)
export async function assignOfficerDermagas(officerId: string, dermagaIds: string[]): Promise<boolean> {
  const result = await api.put(`/officers/${officerId}/dermagas`, { dermagaIds })
  return result.ok
}
