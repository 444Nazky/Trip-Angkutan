// ─── Shared Data ──────────────────────────────────────────────────────────────

import { getStoredRoutes, hasDockScopedRoutes, type UiRoute } from '../services/auth'

export const ROUTES = [
  { code: 'SJRE-SBDZ', from: 'SJRE', to: 'SBDZ', label: 'Sijangkung → Sabadi', distance: '42 km', duration: '1j 10m' },
  { code: 'SBDZ-SJRE', from: 'SBDZ', to: 'SJRE', label: 'Sabadi → Sijangkung', distance: '42 km', duration: '1j 10m' },
  { code: 'SJRE-BDAU', from: 'SJRE', to: 'BDAU', label: 'Sijangkung → Badau', distance: '18 km', duration: '35m' },
  { code: 'BDAU-SJRE', from: 'BDAU', to: 'SJRE', label: 'Badau → Sijangkung', distance: '18 km', duration: '35m' },
]

/** Prefer backend routes scoped to the active dock; use static defaults only before route data exists. */
export function activeRoutes(): UiRoute[] {
  const stored = getStoredRoutes()
  return stored.length > 0 || hasDockScopedRoutes() ? stored : ROUTES
}

/** Seed trips — dikosongkan agar data dummy tidak tampil di history. */
export const allTrips = []

export const tariffData = [
  { golongan: 'I', type: 'Motor', loaded: 'Rp 15.000', loadedNum: 15000, empty: 'Rp 8.000', emptyNum: 8000, desc: 'Sepeda motor roda dua' },
  { golongan: 'II', type: 'Mobil', loaded: 'Rp 45.000', loadedNum: 45000, empty: 'Rp 20.000', emptyNum: 20000, desc: 'Mobil penumpang / pickup kecil' },
  { golongan: 'III', type: 'Truck Kecil', loaded: 'Rp 120.000', loadedNum: 120000, empty: 'Rp 55.000', emptyNum: 55000, desc: 'Truck ringan s/d 3 ton' },
  { golongan: 'IV', type: 'Truck Sedang', loaded: 'Rp 280.000', loadedNum: 280000, empty: 'Rp 130.000', emptyNum: 130000, desc: 'Truck sedang 3–8 ton' },
  { golongan: 'V', type: 'Truck Besar', loaded: 'Rp 450.000', loadedNum: 450000, empty: 'Rp 200.000', emptyNum: 200000, desc: 'Truck besar / trailer di atas 8 ton' },
]

export interface DermagaAccess {
  id: string
  code?: string
  name: string
  region_id?: string
}

export const officerList = [
  { id: '1', name: 'Budi Santoso', initials: 'BS', region: 'BADAU', pin: '123456', status: 'Aktif', device: '-', trips: 0, lastActive: '-', joined: '-', dermagaAccess: [{ id: 'BADAU-D1', code: 'D1', name: 'Dermaga 1' }] },
  { id: '2', name: 'Andi Pratama', initials: 'AP', region: 'BADAU', pin: '123456', status: 'Aktif', device: '-', trips: 0, lastActive: '-', joined: '-', dermagaAccess: [{ id: 'BADAU-D2', code: 'D2', name: 'Dermaga 2' }] },
  { id: '3', name: 'Dewi Kusuma', initials: 'DK', region: 'BADAU', pin: '123456', status: 'Aktif', device: '-', trips: 0, lastActive: '-', joined: '-', dermagaAccess: [{ id: 'BADAU-D1', code: 'D1', name: 'Dermaga 1' }, { id: 'BADAU-D2', code: 'D2', name: 'Dermaga 2' }] },
  { id: '4', name: 'Siti Rahayu', initials: 'SR', region: 'BADAU', pin: '123456', status: 'Aktif', device: '-', trips: 0, lastActive: '-', joined: '-', dermagaAccess: [{ id: 'BADAU-D1', code: 'D1', name: 'Dermaga 1' }] },
  { id: '5', name: 'Agung Suntoso', initials: 'AS', region: 'BELITUNG', pin: '123456', status: 'Aktif', device: '-', trips: 0, lastActive: '-', joined: '-', dermagaAccess: [{ id: 'BELITUNG-D1', code: 'D1', name: 'Dermaga 1' }] },
  { id: '6', name: 'Rahmat Hidayat', initials: 'RH', region: 'BELITUNG', pin: '123456', status: 'Aktif', device: '-', trips: 0, lastActive: '-', joined: '-', dermagaAccess: [{ id: 'BELITUNG-D2', code: 'D2', name: 'Dermaga 2' }] },
  { id: '7', name: 'Hendra Gunawan', initials: 'HG', region: 'KELAPAKAMPIT', pin: '123456', status: 'Aktif', device: '-', trips: 0, lastActive: '-', joined: '-', dermagaAccess: [{ id: 'KELAPAKAMPIT-D1', code: 'D1', name: 'Dermaga 1' }] },
  { id: '8', name: 'Maya Sari', initials: 'MS', region: 'KELAPAKAMPIT', pin: '123456', status: 'Aktif', device: '-', trips: 0, lastActive: '-', joined: '-', dermagaAccess: [{ id: 'KELAPAKAMPIT-D2', code: 'D2', name: 'Dermaga 2' }] },
]

// 5 local 4 3 