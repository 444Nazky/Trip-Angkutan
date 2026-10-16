import { CapacitorHttp, Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
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

// Device ID cache untuk menghindari pemanggilan berulang
let _cachedDeviceId: string | null = null;

/**
 * Ambil device ID unik untuk pelaporan versi.
 * Cache hasilnya agar tidak perlu fetch berkali-kali.
 */
async function getDeviceId(): Promise<string> {
  if (_cachedDeviceId) return _cachedDeviceId;

  try {
    const info = await Device.getId();
    // Gunakan identifier yang tersedia
    const id = (info as { identifier?: string })?.identifier;
    if (id) {
      _cachedDeviceId = id;
      return id;
    }
  } catch {
    // Fallback: continue ke localStorage
  }

  // Fallback: generate ID acak dan simpan di localStorage
  _cachedDeviceId = localStorage.getItem('trip.deviceId') || `device-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  localStorage.setItem('trip.deviceId', _cachedDeviceId);
  return _cachedDeviceId;
}

/**
 * LAPORKAN VERSI KE BACKEND
 *
 * PENTING: Mobile HARUS memanggil fungsi ini setiap:
 * 1. Setelah OTA update BERHASIL diinstall
 * 2. Saat startup aplikasi
 *
 * Ini memastikan server selalu tahu versi yang benar-benar terinstall
 */
async function reportVersionToServer(version: string): Promise<boolean> {
  try {
    const deviceId = await getDeviceId();
    const url = `${getUpdateApiUrl()}/report-version`;

    const response = await CapacitorHttp.request({
      url,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      data: {
        deviceId,
        version,
        platform: Capacitor.getPlatform(),
      },
    });

    if (response.status === 200) {
      console.log(`[Version] Berhasil laporkan versi ${version} ke server`);
      return true;
    }
    console.warn(`[Version] Gagal laporkan versi: status ${response.status}`);
    return false;
  } catch (error) {
    console.warn('[Version] Gagal laporkan versi ke server:', error);
    return false;
  }
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

const STORAGE_KEYS = {
  CURRENT_VERSION: 'trip.update.currentVersion',
  PENDING_VERSION: 'trip.update.pendingVersion',
  LAST_CHECK: 'trip.update.lastCheck',
  UPDATE_INFO: 'trip.update.info',
} as const;




/** SHA-256 heksadesimal dari byte; null bila WebCrypto tidak tersedia (uji/web lama). */
async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource)
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
  } catch {
    return null
  }
}




/** base64 → byte (hasil Filesystem.readFile). */
function base64ToBytes(base64: string): Uint8Array | null {
  try {
    const clean = base64.includes(',') ? base64.slice(base64.indexOf(',') + 1) : base64
    if (typeof atob === 'function') {
      const bin = atob(clean)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    }
    const B = (globalThis as { Buffer?: { from: (s: string, e: string) => Uint8Array } }).Buffer
    return B ? B.from(clean, 'base64') : null
  } catch {
    return null
  }
}




// versi native (App Info Android) — biar UI tak beda dgn sistem
export async function getNativeVersion(): Promise<string | null> {
  try {
    const { App } = await import('@capacitor/app')
    const info = await App.getInfo()
    return info?.version || null
  } catch {
    return null
  }
}




// baseUrl sudah berakhiran /api — jangan ditambah /api lagi
export function getUpdateApiUrl(): string {
  return `${api.baseUrl.replace(/\/api\/?$/i, '')}/api/v1`;
}




// downloadUrl dari server bisa absolute (Railway/CDN) atau relatif.
// Path relatif harus ditempel ke ORIGIN, bukan ke api.baseUrl: baseUrl sudah
// berakhir `/api`, sehingga '/releases/x.apk' dulu menjadi '/api/releases/x.apk'
// (404 — static /releases dilayani di root) dan '/api/v1/...' menjadi
// '/api/api/v1/...'. Keduanya membuat unduhan APK selalu gagal.
export function resolveDownloadUrl(downloadUrl: string): string {
  const url = String(downloadUrl ?? '').trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (!url) return url;
  const origin = api.baseUrl.replace(/\/api\/?$/i, '');
  return `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}




function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}




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




const NO_CACHE_HEADERS = {
  'Cache-Control': 'no-cache, no-store, must-revalidate',
  'Pragma': 'no-cache',
  'Expires': '0',
  'Accept': 'application/json',
} as const;




/**
 * Ambil JSON dari server update.
 *
 * Jalur native memakai CapacitorHttp, tetapi plugin native bisa tidak aktif di
 * build tertentu (gagal dalam milidetik) — dulu itu membuat cek versi SELALU
 * gagal diam-diam dan update tak pernah terdeteksi. Sekarang ada fallback ke
 * fetch WebView (tanpa CORS di shell Capacitor).
 */
async function httpJson(url: string): Promise<{ status: number; data: unknown } | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const res = await CapacitorHttp.request({ url, method: 'GET', headers: { ...NO_CACHE_HEADERS } })
      return { status: res.status, data: res.data }
    } catch (error) {
      console.warn('[Update] HTTP native gagal, fallback ke fetch WebView:', error)
    }
  }
  try {
    const res = await fetch(url, { cache: 'no-store', headers: { ...NO_CACHE_HEADERS } })
    const data = await res.json().catch(() => null)
    return { status: res.status, data }
  } catch (error) {
    console.error('[Update] Request gagal:', error)
    return null
  }
}




type VersionCheck = { ok: true; info: UpdateInfo } | { ok: false; reason: 'not-available' | 'network' }




async function checkVersionFromServer(currentVersion: string): Promise<VersionCheck> {
  const url = `${getUpdateApiUrl()}/app-version?current=${encodeURIComponent(currentVersion)}&t=${Date.now()}`;

  const res = await httpJson(url)
  if (!res) return { ok: false, reason: 'network' }

  if (res.status === 200) {
    if (!res.data || typeof (res.data as UpdateInfo).latestVersion !== 'string') {
      return { ok: false, reason: 'network' }
    }
    return { ok: true, info: res.data as UpdateInfo }
  }

  if (res.status === 404) {
    console.log('[Update] Update API not available yet (404)')
    return { ok: false, reason: 'not-available' }
  }

  console.warn(`[Update] Cek versi gagal: status ${res.status}`)
  return { ok: false, reason: 'network' }
}




async function fetchReleaseNotes(version: string): Promise<ReleaseNotes | null> {
  const url = `${getUpdateApiUrl()}/release-notes/${encodeURIComponent(version)}?t=${Date.now()}`;
  const res = await httpJson(url)
  if (!res || res.status !== 200 || !res.data) return null
  return res.data as ReleaseNotes
}




async function getApkPath(version: string): Promise<string> {
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




// lempar apk ke installer android
function openApkWithSystemInstaller(uri: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const plugin = (window as unknown as { cordova?: { plugins?: { fileOpener2?: {
      open: (path: string, mime: string, opt: { success: () => void; error: (e: unknown) => void }) => void
    } } } }).cordova?.plugins?.fileOpener2
    if (!plugin) {
      reject(new Error('Installer APK tidak tersedia di perangkat ini — minta admin mengirim APK terbaru untuk dipasang manual'))
      return
    }
    plugin.open(uri, 'application/vnd.android.package-archive', {
      success: () => resolve(),
      error: (e) => reject(e instanceof Error ? e : new Error('Gagal membuka installer')),
    })
  })
}




async function downloadApk(version: string, downloadUrl: string): Promise<string> {  const apkPath = await getApkPath(version);

  await cleanupOldApkFiles(version);

  try {
    const result = await Filesystem.downloadFile({
      url: `${resolveDownloadUrl(downloadUrl)}?t=${Date.now()}`,
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
    // Versi NATIVE (App.getInfo) adalah sumber kebenaran; versi tersimpan hanya
    // cadangan untuk web. Nilai lama yang sempat ditulis setelah unduh (padahal
    // belum terpasang) tidak boleh dipercaya — itu akar klaim "sudah update" palsu.
    const version = await this.refreshInstalledVersion()
    console.log('[Update] Versi terpasang:', version)
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
      // Versi native selalu jadi acuan: build yang di-download belum tentu terpasang.
      await this.refreshInstalledVersion();

      const result = await checkVersionFromServer(this._currentVersion);

      if (!result.ok) {
        // API update belum ada (404) → anggap tidak ada update; jaringan/server
        // bermasalah → BERI TAHU, jangan diam-diam bilang "sudah terbaru".
        this._state = result.reason === 'not-available' ? 'up-to-date' : 'error';
        this._updateInfo = null;
        if (result.reason !== 'not-available') {
          this._error = {
            code: 'NETWORK_ERROR',
            message: `Gagal menghubungi server update (${getUpdateApiUrl()})`,
          };
        }
        this.notify();
        return null;
      }

      const info = result.info;
      this._updateInfo = info;

      if (!info.updateAvailable) {
        this._state = 'up-to-date';
        this._error = null;
        this.notify();
        return info;
      }

      try {
        localStorage.setItem(STORAGE_KEYS.UPDATE_INFO, JSON.stringify(info));
        localStorage.setItem(STORAGE_KEYS.LAST_CHECK, new Date().toISOString());
      } catch {
        // Ignore storage errors
      }

      this._state = 'downloading';
      this._pendingVersion = info.latestVersion;
      this.notify();

      if (info.downloadUrl) {
        await this.downloadUpdate(info.latestVersion, info.downloadUrl, info.apkHash);
      } else {
        // Server menyatakan ada update tetapi tidak memberi URL unduhan yang sah —
        // laporkan apa adanya daripada menampilkan tombol "Pasang" yang pasti gagal.
        this._state = 'error';
        this._error = {
          code: 'DOWNLOAD_FAILED',
          message: 'Server menyatakan ada versi baru, tetapi paket APK-nya tidak tersedia. Laporkan ke admin.',
        };
        this.notify();
      }

      return info;
    } catch (error) {
      this._state = 'error';
      this._error = {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Gagal terhubung ke server'
      };
      this.notify();
      return null;
    }
  }

  async downloadUpdate(version: string, downloadUrl: string, expectedHash?: string | null): Promise<boolean> {
    this._state = 'downloading';
    this._pendingVersion = version;
    this._error = null;
    this.notify();

    let retries = 0;
    const maxRetries = 3;

    while (retries < maxRetries) {
      try {
        const path = await downloadApk(version, downloadUrl);

        // Verifikasi integritas SEBELUM menawarkan pemasangan.
        const verified = await this.verifyApkHash(path, version, expectedHash)
        if (!verified.ok) {
          try { await Filesystem.deleteFile({ path, directory: Directory.Data }) } catch { /* sudah hilang */ }
          this._state = 'error';
          this._error = { code: 'HASH_MISMATCH', message: verified.message };
          this.notify();
          return false;
        }

        // CATATAN PENTING: versi aplikasi TIDAK diubah di sini. Berkas baru saja
        // diunduh; instalasi bisa dibatalkan pengguna. Menulis versi di sini dulu
        // membuat aplikasi (dan server) mengklaim sudah ter-update padahal masih
        // versi lama. Versi resmi hanya berubah bila APK benar-benar terpasang
        // (dibaca ulang dari App.getInfo() saat aplikasi hidup lagi).
        this._state = 'ready';
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
    this._error = null;
    this.notify();

    try {
      const apkPath = await getApkPath(this._pendingVersion);

      // web tak punya installer, panduan manual yang tampil
      if (!Capacitor.isNativePlatform()) return true;

      // Berkas wajib ada dan berukuran wajar. Dulu kegagalan unduhan (mis. respons
      // 404 JSON beberapa ratus byte) tetap "berhasil" dibuka sebagai APK.
      const info = await Filesystem.stat({ path: apkPath, directory: Directory.Data }).catch(() => null)
      if (!info) {
        this._state = 'error';
        this._error = {
          code: 'DOWNLOAD_FAILED',
          message: 'Berkas APK tidak ditemukan di perangkat. Unduh ulang pembaruan.',
        };
        this.notify();
        return false;
      }
      if (typeof info.size === 'number' && info.size > 0 && info.size < 1_000_000) {
        this._state = 'error';
        this._error = {
          code: 'DOWNLOAD_FAILED',
          message: `Berkas APK cacat (${info.size} byte) — kemungkinan respons error server. Unduh ulang.`,
        };
        this.notify();
        return false;
      }

      const { uri } = await Filesystem.getUri({ path: apkPath, directory: Directory.Data })

      // buka installer sistem (ACTION_VIEW via FileProvider)
      await openApkWithSystemInstaller(uri)

      // Installer sistem yang berjalan TIDAK berarti sudah terpasang (pengguna bisa
      // membatalkan). Status tetap di keputusan pengguna sampai versi native benar-
      // benar berubah — diperiksa `refreshInstalledVersion()` saat aplikasi aktif lagi.
      return true
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




  /**
   * Sinkronkan versi terpasang dengan kenyataan (App.getInfo).
   *
   * Dipanggil saat cek update dan saat aplikasi kembali aktif: kalau APK baru
   * benar-benar terpasang, versi native naik → laporkan ke server & bersihkan
   * tawaran update. Kalau masih versi lama, jangan pernah mengklaim berhasil.
   */
  async refreshInstalledVersion(): Promise<string> {
    let native: string | null = null
    try {
      const { App } = await import('@capacitor/app')
      const info = await App.getInfo()
      native = info?.version || null
    } catch { /* non-native */ }

    if (native) {
      const berubah = native !== this._currentVersion
      this._currentVersion = native
      setStoredVersion(native)
      if (berubah) {
        console.log('[Update] Versi native sekarang:', native)
        reportVersionToServer(native).catch(() => {})
      }
      const pending = this._pendingVersion
      if (pending) {
        // `pending` sudah terpasang kalau versi native tidak lebih lama darinya.
        const sudahTerpasang = !isNewerVersion(native, pending)
        if (sudahTerpasang) {
          this._pendingVersion = null
          this._updateInfo = null
          this._state = 'up-to-date'
          this._error = null
          this.notify()
        } else if (this._state === 'installing') {
          // Installer dibuka tetapi versi belum berubah → jangan klaim sukses.
          this._state = 'ready'
          this._error = {
            code: 'INSTALL_FAILED',
            message: `Pemasangan belum selesai — aplikasi masih versi ${native}. Tekan Pasang lagi, lalu setujui dialog pemasangan Android.`,
          }
          this.notify()
        }
      }
      return native
    }

    const stored = getStoredVersion()
    this._currentVersion = stored || (this._currentVersion === '0.0.0' ? '1.0.0' : this._currentVersion) || '1.0.0'
    return this._currentVersion
  }




  private async verifyApkHash(
    path: string,
    version: string,
    expectedHash?: string | null,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    const expected = String(expectedHash ?? '').trim().toLowerCase()
    if (!expected) {
      console.warn(`[Update] Server tidak mengirim hash untuk ${version} — integritas tidak diverifikasi`)
      return { ok: true }
    }

    // skip hash kalo di web — berkas APK tidak bisa dibaca via FilesystemWeb
    try {
      if (Capacitor.getPlatform() === 'web') {
        console.warn(`[Update] Skip verifikasi hash di web untuk ${version}`)
        return { ok: true }
      }
    } catch { /* Capacitor belum siap */ }

    try {
      const file = await Filesystem.readFile({ path, directory: Directory.Data })
      const raw = typeof file.data === 'string' ? file.data : ''
      const bytes = raw ? base64ToBytes(raw) : null
      if (!bytes) {
        console.warn('[Update] Isi APK tidak bisa dibaca untuk verifikasi hash — lanjut tanpa verifikasi')
        return { ok: true }
      }
      const actual = await sha256Hex(bytes)
      if (!actual) {
        console.warn('[Update] WebCrypto tidak tersedia — hash tidak diverifikasi')
        return { ok: true }
      }
      if (actual !== expected) {
        return { ok: false, message: `Hash APK tidak cocok (file rusak/tidak lengkap). Unduh ulang pembaruan ${version}.` }
      }
      console.log(`[Update] Hash APK ${version} terverifikasi`)
      return { ok: true }
    } catch (error) {
      console.warn('[Update] Verifikasi hash gagal dijalankan:', error)
      return { ok: true }
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
