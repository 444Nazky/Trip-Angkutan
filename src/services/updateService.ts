// ─── Update Service (Custom Self-Hosted API) ─────────────────────────────────
// Purge-First Full-Package APK Update System

import { CapacitorHttp } from '@capacitor/core';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { api } from './api';

export interface UpdateInfo {
  latestVersion: string;
  updateAvailable: boolean;
  isForceUpdate: boolean;
  downloadUrl: string | null;
  releaseNotes: string | null;
  apkSize: number | null;
  apkHash: string | null;
  minVersion: string | null;
  releaseDate: string | null;
}

export interface ReleaseNote {
  type: 'feature' | 'bugfix' | 'security' | 'improvement';
  title: string;
  description: string;
}

export interface ReleaseNotes {
  version: string;
  releaseDate: string | null;
  notes: ReleaseNote[];
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'
  | 'up-to-date';

export interface UpdateError {
  code: 'NETWORK_ERROR' | 'DOWNLOAD_FAILED' | 'HASH_MISMATCH' | 'INSTALL_FAILED' | 'STORAGE_FULL' | 'PERMISSION_DENIED' | 'UNKNOWN';
  message: string;
}

// Storage keys
const STORAGE_KEYS = {
  CURRENT_VERSION: 'trip.update.currentVersion',
  PENDING_VERSION: 'trip.update.pendingVersion',
  LAST_CHECK: 'trip.update.lastCheck',
  UPDATE_INFO: 'trip.update.info',
} as const;

// API Base URL
function getUpdateApiUrl(): string {
  return `${api.baseUrl}/api/v1`;
}

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Version Comparison ─────────────────────────────────────────────────────

function parseVersion(version: string): [number, number, number] {
  const parts = version.split('.').map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}

export function isNewerVersion(current: string, latest: string): boolean {
  const [c1, c2, c3] = parseVersion(current);
  const [l1, l2, l3] = parseVersion(latest);

  if (l1 > c1) return true;
  if (l1 === c1 && l2 > c2) return true;
  if (l1 === c1 && l2 === c2 && l3 > c3) return true;
  return false;
}

export function shouldForceUpdate(current: string, minVersion: string | null | undefined): boolean {
  if (!minVersion) return false;
  return isNewerVersion(current, minVersion);
}

// ─── API Calls ─────────────────────────────────────────────────────────────

async function checkVersionFromServer(currentVersion: string): Promise<UpdateInfo | null> {
  const url = `${getUpdateApiUrl()}/app-version?current=${encodeURIComponent(currentVersion)}&t=${Date.now()}`;

  try {
    const response = await CapacitorHttp.request({
      url,
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Accept': 'application/json',
      },
    });

    if (response.status === 200) {
      return response.data as UpdateInfo;
    }

    // 404 means update API not available yet - return null (silent skip)
    if (response.status === 404) {
      console.log('[Update] Update API not available yet (404)');
      return null;
    }

    // Other status codes - try again later
    throw new Error(`Server returned status ${response.status}`);
  } catch (error) {
    console.error('[Update] Version check failed:', error);
    // Network errors or 404 = update API not deployed yet
    // Don't show error to user, just return null
    return null;
  }
}

async function fetchReleaseNotes(version: string): Promise<ReleaseNotes | null> {
  const url = `${getUpdateApiUrl()}/release-notes/${encodeURIComponent(version)}?t=${Date.now()}`;

  try {
    const response = await CapacitorHttp.request({
      url,
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
        'Accept': 'application/json',
      },
    });

    if (response.status === 200) {
      return response.data as ReleaseNotes;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── APK Download ─────────────────────────────────────────────────────────

async function getApkPath(version: string): Promise<string> {
  // Ensure directory exists
  try {
    await Filesystem.readdir({
      path: 'updates',
      directory: Directory.Data,
    });
  } catch {
    await Filesystem.mkdir({
      path: 'updates',
      directory: Directory.Data,
    });
  }

  return `updates/app-${version}.apk`;
}

async function downloadApk(version: string, downloadUrl: string): Promise<string> {
  const apkPath = await getApkPath(version);

  // Clean up old APK files first (Purge-First)
  await cleanupOldApkFiles(version);

  try {
    const result = await Filesystem.downloadFile({
      url: `${api.baseUrl}${downloadUrl}?t=${Date.now()}`,
      path: apkPath,
      directory: Directory.Data,
    });

    if (!result || !result.path) {
      throw new Error('Download failed - no path returned');
    }

    console.log('[Update] APK downloaded to:', result.path);
    return result.path;
  } catch (error) {
    console.error('[Update] Download failed:', error);
    throw error;
  }
}

async function cleanupOldApkFiles(keepVersion: string): Promise<void> {
  try {
    const result = await Filesystem.readdir({
      path: 'updates',
      directory: Directory.Data,
    });

    for (const file of result.files || []) {
      if (file.name.startsWith('app-') && file.name.endsWith('.apk')) {
        const fileVersion = file.name.replace('app-', '').replace('.apk', '');
        if (fileVersion !== keepVersion) {
          await Filesystem.deleteFile({
            path: `updates/${file.name}`,
            directory: Directory.Data,
          });
          console.log('[Update] Deleted old APK:', file.name);
        }
      }
    }
  } catch {
    console.log('[Update] No old APK files to clean up');
  }
}

// ─── State Management ──────────────────────────────────────────────────────

function getStoredVersion(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.CURRENT_VERSION);
  } catch {
    return null;
  }
}

function setStoredVersion(version: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CURRENT_VERSION, version);
  } catch {
    console.warn('[Update] Failed to store version');
  }
}

function clearStoredState(): void {
  try {
    localStorage.removeItem(STORAGE_KEYS.PENDING_VERSION);
    localStorage.removeItem(STORAGE_KEYS.LAST_CHECK);
    localStorage.removeItem(STORAGE_KEYS.UPDATE_INFO);
  } catch {
    console.warn('[Update] Failed to clear stored state');
  }
}

// ─── Main Update Service ───────────────────────────────────────────────────

class UpdateService {
  private _state: UpdateState = 'idle';
  private _currentVersion: string = '0.0.0';
  private _updateInfo: UpdateInfo | null = null;
  private _pendingVersion: string | null = null;
  private _error: UpdateError | null = null;
  private _listeners: Set<(state: UpdateState, info?: UpdateInfo | null, error?: UpdateError | null) => void> = new Set();

  constructor() {
    this.init();
  }

  private async init(): Promise<void> {
    try {
      // Get version from capacitor config or localStorage
      // In a real app, this would come from the native layer
      const storedVersion = getStoredVersion();
      this._currentVersion = storedVersion || '1.0.0';
      console.log('[Update] Current app version:', this._currentVersion);
    } catch {
      console.log('[Update] Could not get app version, using default');
      this._currentVersion = '1.0.0';
    }
  }

  get state(): UpdateState {
    return this._state;
  }

  get currentVersion(): string {
    return this._currentVersion;
  }

  get updateInfo(): UpdateInfo | null {
    return this._updateInfo;
  }

  get pendingVersion(): string | null {
    return this._pendingVersion;
  }

  get error(): UpdateError | null {
    return this._error;
  }

  subscribe(callback: (state: UpdateState, info?: UpdateInfo | null, error?: UpdateError | null) => void): () => void {
    this._listeners.add(callback);
    return () => {
      this._listeners.delete(callback);
    };
  }

  private notify(state?: UpdateState, info?: UpdateInfo | null, error?: UpdateError | null): void {
    const newState = state ?? this._state;
    for (const listener of this._listeners) {
      try {
        listener(newState, info ?? this._updateInfo, error ?? this._error);
      } catch (e) {
        console.error('[Update] Listener error:', e);
      }
    }
  }

  async checkForUpdate(): Promise<UpdateInfo | null> {
    this._state = 'checking';
    this._error = null;
    this.notify();

    try {
      const result = await checkVersionFromServer(this._currentVersion);

      // If result is null, API is not available or network error
      // Silent skip - set to up-to-date without showing error
      if (result === null) {
        this._state = 'up-to-date';
        this._updateInfo = null;
        this.notify();
        return null;
      }

      this._updateInfo = result;

      try {
        localStorage.setItem(STORAGE_KEYS.UPDATE_INFO, JSON.stringify(result));
        localStorage.setItem(STORAGE_KEYS.LAST_CHECK, new Date().toISOString());
      } catch {
        // Ignore storage errors
      }

      if (result.updateAvailable) {
        this._state = 'downloading';
        this._pendingVersion = result.latestVersion;
        this.notify();

        if (result.downloadUrl) {
          await this.downloadUpdate(result.latestVersion, result.downloadUrl, result.apkHash);
        }
      } else {
        this._state = 'up-to-date';
        this.notify();
      }

      return result;
    } catch (error) {
      // Only show error if it's not a network/404 issue (those return null)
      this._state = 'error';
      this._error = {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Gagal terhubung ke server'
      };
      this.notify();
      return null;
    }
  }

  async downloadUpdate(version: string, downloadUrl: string, _expectedHash?: string | null): Promise<boolean> {
    this._state = 'downloading';
    this._pendingVersion = version;
    this.notify();

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        await downloadApk(version, downloadUrl);

        this._state = 'ready';
        setStoredVersion(version);
        this.notify();
        return true;

      } catch (error) {
        retries++;
        console.error(`[Update] Download attempt ${retries} failed:`, error);

        if (retries >= maxRetries) {
          this._state = 'error';
          this._error = {
            code: 'DOWNLOAD_FAILED',
            message: `Gagal mengunduh setelah ${maxRetries} percobaan`
          };
          this.notify();
          return false;
        }

        const delay = Math.pow(2, retries) * 1000;
        await sleep(delay);
      }
    }

    return false;
  }

  async installUpdate(): Promise<boolean> {
    if (!this._pendingVersion) {
      this._error = {
        code: 'UNKNOWN',
        message: 'Tidak ada update yang siap diinstal'
      };
      this.notify();
      return false;
    }

    this._state = 'installing';
    this.notify();

    try {
      const apkPath = await getApkPath(this._pendingVersion);

      console.log('[Update] APK ready for installation:', apkPath);
      console.log('[Update] On native Android, this would trigger the package installer');

      // On Android, opening the APK file directly through file manager
      // or sharing intent will trigger installation
      // In production, implement a native plugin for Intent.ACTION_VIEW

      return true;
    } catch (error) {
      console.error('[Update] Install failed:', error);
      this._state = 'error';
      this._error = {
        code: 'INSTALL_FAILED',
        message: error instanceof Error ? error.message : 'Gagal memulai instalasi'
      };
      this.notify();
      return false;
    }
  }

  async reset(): Promise<void> {
    this._state = 'idle';
    this._error = null;
    this._updateInfo = null;
    this._pendingVersion = null;

    try {
      const result = await Filesystem.readdir({
        path: 'updates',
        directory: Directory.Data,
      });

      for (const file of result.files || []) {
        if (file.name.startsWith('app-') && file.name.endsWith('.apk')) {
          await Filesystem.deleteFile({
            path: `updates/${file.name}`,
            directory: Directory.Data,
          });
        }
      }
    } catch {
      // Ignore cleanup errors
    }

    clearStoredState();
    this.notify();
  }

  async getReleaseNotes(version?: string): Promise<ReleaseNotes | null> {
    const ver = version || this._updateInfo?.latestVersion;
    if (!ver) return null;
    return fetchReleaseNotes(ver);
  }
}

export const updateService = new UpdateService();
export { UpdateService };
