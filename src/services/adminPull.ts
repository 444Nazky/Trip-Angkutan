// ─── Officer Pull Service ──────────────────────────────────────────────
// Pulls officer changes from admin dashboard to mobile app.
//
// This service is separate from auth.ts because it runs in the background
// and doesn't need auth state. It uses its own admin-session logic.
//
// Features:
// 1. Pull new officers (admin creates officer → mobile syncs on next resume)
// 2. Pull password/PIN changes (admin changes password → mobile updates hash)
// 3. Pull deactivation (admin disables officer → mobile removes from local cache)

import { api } from './api'
import { cacheDockOfficers, syncDermagaOfficersToDb, getStoredDermaga, getStoredOfficer, refreshStoredRoutes } from './auth'
import {
  type OfficerRow,
  initOfflineDb,
  listOfficers,
  saveOfficers,
  setPinHash,
  hashPin,
} from './offlineDb'

// ── Types ──────────────────────────────────────────────────────

export interface AdminOfficer {
  id: string
  name: string
  username?: string
  /** HANYA petugas yang akan dipakai. */
  is_active: number
}

/** Sinkronisasi data admin ke localStorage (mobile) dengan HANYA petugas terkait, caching hasil admin. */

// ── Sync pull on resume ─────────────────────────────────────
// Tarik ulang data petugas dari admin (petugas baru, ganti PIN,
// penonaktifan) dan simpan hash PIN-nya untuk login offline.
export function syncOnResume(force = false): void {
  try {
    const last = Number(localStorage.getItem(LAST_SYNC_KEY) || 0)
    if (!force && Date.now() - last < LAST_SYNC_MS) return
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()))
  } catch { /* quota */ }

  const officer = getStoredOfficer()
  void cacheDockOfficers(officer?.id)
  const dermaga = getStoredDermaga()
  if (dermaga?.id) void syncDermagaOfficersToDb(dermaga.id)
  // Master Rute terbaru dari Web Admin → dipakai offline di layar Pilih Rute
  void refreshStoredRoutes().catch(() => null)
}

// ── Pull data petugas dari admin dashboard ──────────────────────────

const LAST_SYNC_KEY = 'trip.officers.lastSync'
const LAST_SYNC_MS = 5 * 60 * 1000 // 5 min
