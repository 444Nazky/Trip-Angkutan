/**
 * Admin-only context (no offline-sync, no mobile screens).
 *
 * Dashboard memakai context ini untuk sesi admin + data referensi yang
 * diedit lewat tab Master (tarif & petugas) dan ditampilkan di Pengaturan.
 * Semua anggota diberi tipe eksplisit supaya kontrak dengan komponen admin
 * jelas (tipe konteks TIDAK boleh diturunkan dari nilai default — itu sumber
 * bug "Property does not exist" sebelumnya).
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react'
import type { TariffRow, Officer } from './admin/components/types'

const ADMIN_KEY = 'trip.auth.admin.v1'

/** Kunci localStorage sama dengan era hybrid — data lama tetap terbaca. */
const LS = {
  trips: 'trip.trips.v1',
  tariffs: 'trip.tariffs.v1',
  officers: 'trip.officers.v1',
} as const

function loadStoredSession(): { token: string; username: string } | null {
  try {
    const raw = localStorage.getItem(ADMIN_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as { token: string; username: string }
    if (!s?.token) return null
    return s
  } catch { return null }
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

/** Ringkas trip lokal (Pengaturan hanya butuh jumlah & id). */
export interface Trip {
  id: string
  date?: string
  status?: string
  [key: string]: unknown
}

interface StoreValue {
  userType: 'admin' | 'guest'
  token: string
  logout: () => void
  /** Trip yang tersimpan di browser (ukuran: tab Pengaturan). */
  trips: Trip[]
  tariffs: TariffRow[]
  saveTariffs: (rows: TariffRow[]) => void
  officers: Officer[]
  saveOfficers: (rows: Officer[]) => void
}

const defaultCtx: StoreValue = {
  userType: 'guest',
  token: '',
  logout: () => { /* overridden by provider */ },
  trips: [],
  tariffs: [],
  saveTariffs: () => { /* overridden by provider */ },
  officers: [],
  saveOfficers: () => { /* overridden by provider */ },
}

const AppContext = createContext<StoreValue>(defaultCtx)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [sess, setSess] = useState(loadStoredSession)
  const [trips, setTrips] = useState<Trip[]>(() => load<Trip[]>(LS.trips, []))
  const [tariffs, setTariffs] = useState<TariffRow[]>(() => load<TariffRow[]>(LS.tariffs, []))
  const [officers, setOfficers] = useState<Officer[]>(() => load<Officer[]>(LS.officers, []))

  const userType = sess ? 'admin' : 'guest'
  const token = sess?.token ?? ''

  const logout = useCallback(() => {
    localStorage.removeItem(ADMIN_KEY)
    setSess(null)
  }, [])

  const saveTariffs = useCallback((rows: TariffRow[]) => setTariffs(rows), [])
  const saveOfficers = useCallback((rows: Officer[]) => setOfficers(rows), [])

  // Persist referensi master agar tab Pengaturan & guard data tetap sinkron
  useEffect(() => {
    try { localStorage.setItem(LS.trips, JSON.stringify(trips)) } catch { /* quota */ }
  }, [trips])
  useEffect(() => {
    try { localStorage.setItem(LS.tariffs, JSON.stringify(tariffs)) } catch { /* quota */ }
  }, [tariffs])
  useEffect(() => {
    try { localStorage.setItem(LS.officers, JSON.stringify(officers)) } catch { /* quota */ }
  }, [officers])

  const ctx = useMemo<StoreValue>(
    () => ({ userType, token, logout, trips, tariffs, saveTariffs, officers, saveOfficers }),
    [userType, token, logout, trips, tariffs, saveTariffs, officers, saveOfficers],
  )

  return <AppContext.Provider value={ctx}>{children}</AppContext.Provider>
}

export function useApp(): StoreValue {
  return useContext(AppContext)
}
