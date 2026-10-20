/**
 * Update service - cek versi terbaru dari server.
 */

import { api } from './api'

export interface UpdateInfo {
  latestVersion: string
  updateAvailable: boolean
  isForceUpdate: boolean
  downloadUrl?: string
  releaseNotes?: string
  apkSize?: number
  apkHash?: string
  minVersion?: string
  releaseDate?: string
}

export interface UpdateState {
  status: 'idle' | 'checking' | 'ready' | 'installing' | 'error' | 'downloading'
  isReady?: boolean
  error?: string
}

const _currentVersion: string | null = null
let _state: UpdateState = { status: 'idle' }
let _error: { message: string; code?: string } | null = null
let _pendingVersion: string | null = null

export function resolveDownloadUrl(raw: string): string {
  const url = String(raw || '').trim()
  if (!url) return ''
  if (/^https?:\/\//i.test(url)) return url
  // Rute relatif dihitung dari API base Supabase (…/functions/v1/api)
  return `${api.url}/${url.startsWith('/') ? url.slice(1) : url}`
}

export async function checkUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  try {
    const result = await api.get<UpdateInfo>(`/app-version?current=${encodeURIComponent(currentVersion)}`, 10000)
    if (result.ok && result.data) return result.data
  } catch (e) {
    console.warn('[update] check failed:', e)
  }
  return null
}

export function getNativeVersion(): string | null {
  return _currentVersion
}

export function isNewerVersion(current: string | null, latest: string): boolean {
  if (!current) return true
  const c = current.split('.').map(Number)
  const l = latest.split('.').map(Number)
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cn = c[i] || 0
    const ln = l[i] || 0
    if (ln > cn) return true
    if (ln < cn) return false
  }
  return false
}

export function shouldForceUpdate(current: string, minVersion: string): boolean {
  return isNewerVersion(current, minVersion)
}

export function getUpdateApiUrl(): string {
  return api.url + '/app-version'
}

export class UpdateService {
  get currentVersion() { return _currentVersion }
  get state(): UpdateState { return _state }
  get error() { return _error }
  get pendingVersion() { return _pendingVersion }

  async checkForUpdate(): Promise<UpdateInfo | null> {
    _state = { status: 'checking' }
    try {
      const info = await checkUpdate(_currentVersion || '0.0.0')
      if (info?.updateAvailable) {
        _state = { status: 'ready', isReady: true }
        _pendingVersion = info.latestVersion
      } else {
        _state = { status: 'idle' }
      }
      return info
    } catch (e) {
      const msg = String(e)
      _state = { status: 'error', error: msg }
      _error = { message: msg }
      return null
    }
  }

  async downloadUpdate(_url: string, _filepath: string, _options?: unknown): Promise<boolean> {
    _state = { status: 'downloading' }
    try {
      return true
    } catch (e) {
      const msg = String(e)
      _state = { status: 'error', error: msg }
      _error = { message: msg, code: 'DOWNLOAD_FAILED' }
      return false
    }
  }

  async installUpdate(): Promise<boolean> {
    _state = { status: 'installing' }
    return true
  }

  async refreshInstalledVersion(): Promise<string | null> {
    return _currentVersion
  }

  async reset(): Promise<void> {
    _state = { status: 'idle' }
    _error = null
    _pendingVersion = null
  }
}

export const updateService = new UpdateService()
