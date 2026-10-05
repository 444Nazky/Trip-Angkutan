/**
 * Admin-only context (no offline-sync, no mobile screens).
 *
 * Dashboard memakai konteks ini untuk sesi admin + data master (tarif & petugas)
 * yang diedit lewat tab Pengaturan. Semua anggota berdampingan jelas.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
} from 'react'
import type { TariffRow, Officer } from './admin/components/types'
import { logout as auth_logout } from '../services/auth'

export const AUTH_EVENT = 'admin-login'

const LS_KEYS = {
  trips: 'trip.trips.v1',
  tariffs: 'trip.tariffs.v1',
  officers: 'trip.officers.v1',
} as const

/** Kunci sesi token (ADMIN_KEY) agar LoginPage sinkron dengan Shell. */
const ADMIN_KEY = 'trip.auth.admin.v1'

function loadStoredSession(): { token: string; username: string } | null {
  try {
    const raw = localStorage.getItem(ADMIN_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (s?.token) return s
    }
  } catch { /* quota */ }
  return null
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch { return fallback }
}

export interface Trip {
  id: string
  date?: string
  status?: string
  [k: string]: unknown
}

interface StoreValue {
  userType: 'admin' | 'guest'
  token: string
  logout: () => void
  trips: Trip[]
  tariffs: TariffRow[]
  saveTariffs: (rows: TariffRow[]) => void
  officers: Officer[]
  saveOfficers: (rows: Officer[]) => void
}

const defaultCtx = {
  userType: 'guest',
  token: '',
  logout: () => { /* override by provider */ },
  trips: [] as Trip[],
  tariffs: [] as TariffRow[],
  saveTariffs: (_r: TariffRow[]) => { /* override */ },
  officers: [] as Officer[],
  saveOfficers: (_r: Officer[]) => { /* override */ },
} satisfies StoreValue

const AppContext = createContext<StoreValue>(defaultCtx)

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [sess, setSess] = useState(loadStoredSession)
  const [trips, setTrips] = useState<Trip[]>(() => load(LS_KEYS.trips, []))
  const [tariffs, setTariffs] = useState<TariffRow[]>(() => load(LS_KEYS.tariffs, []))
  const [officers, setOfficers] = useState<Officer[]>(() => load(LS_KEYS.officers, []))
  const token = sess?.token ?? ''
  const userType = sess ? 'admin' : 'guest'

  // Hapus semua jejak admin + sync logout + bersihkan UI.
  const logout = useCallback(() => {
    auth_logout()          // bersihkan token API + localStorage
    setSess(null)
  }, [])

  const saveTariffs = useCallback((rows: TariffRow[]) => setTariffs(rows), [])
  const saveOfficers = useCallback((rows: Officer[]) => setOfficers(rows), [])

  // Simpan data master agar tetap ada saat browser ditutup.
  useEffect(() => { try { localStorage.setItem(LS_KEYS.trips, JSON.stringify(trips)) } catch { /* quota */ } }, [trips])
  useEffect(() => { try { localStorage.setItem(LS_KEYS.tariffs, JSON.stringify(tariffs)) } catch { /* quota */ } }, [tariffs])
  useEffect(() => { try { localStorage.setItem(LS_KEYS.officers, JSON.stringify(officers)) } catch { /* quota */ } }, [officers])

  const ctx = useMemo<StoreValue>(
    () => ({ userType, token, logout, trips, tariffs: [], saveTariffs, officers: [], saveOfficers }),
    [userType, token, logout],
  )

  return <AppContext.Provider value={ctx}>{children}</AppContext.Provider>
}

export function useApp(): StoreValue {
  return useContext(AppContext)
}
