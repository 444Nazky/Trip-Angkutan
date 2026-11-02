import { getNativeVersion, isNewerVersion, shouldForceUpdate, updateService } from './updateService'
import { isLocalhostDev } from './runtimeEnv'
import { isNativeAndroid } from './apkInstaller'



// Disable update checks for localhost development.
//
// PENTING: guard ini hanya untuk BROWSER dev server. Aplikasi native
// (Android/iOS) dimuat dari origin lokal `https://localhost` - kalau ikut
// dianggap dev, tombol "Cek Update" di Profil mati total di perangkat
// (selalu dijawab "Sudah Terbaru" tanpa menghubungi server).
//
// Nilainya dievaluasi saat runtime, bukan sekali saat import, supaya platform
// native sudah terdeteksi kapan pun modul ini dimuat.
const updateDisabled = () => isLocalhostDev()
if (updateDisabled()) {
  console.log('[Update] Localhost/DEV mode: Update notifications disabled')
}



// Pembaruan aplikasi SELALU lewat paket APK penuh.
//
// DULU ada dua kanal: bundel modul web (OTA) dan paket APK. Kanal OTA sudah
// dihapus seluruhnya — sekarang satu-satunya cara memperbarui aplikasi adalah
// memasang APK baru dari server intranet.
export type AppUpdateKind = 'apk'



export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'up-to-date'
  | 'offline'
  | 'error'



export interface AppUpdateState {
  status: AppUpdateStatus
  kind: AppUpdateKind | null
  version: string | null
  notes: string | null
  isForce: boolean
  error: string | null
}



type Listener = (state: AppUpdateState) => void

const IDLE: AppUpdateState = {
  status: 'idle',
  kind: null,
  version: null,
  notes: null,
  isForce: false,
  error: null,
}



class AppUpdateController {
  private _state: AppUpdateState = { ...IDLE }
  private _listeners = new Set<Listener>()
  private _currentApp: string | null = null
  private _checking: Promise<AppUpdateState> | null = null



  get state(): AppUpdateState {
    return this._state
  }



  get currentAppVersion(): string | null {
    return this._currentApp
  }



  subscribe(listener: Listener): () => void {
    this._listeners.add(listener)
    return () => { this._listeners.delete(listener) }
  }



  private set(patch: Partial<AppUpdateState>): void {
    this._state = { ...this._state, ...patch }
    for (const listener of [...this._listeners]) {
      try {
        listener(this._state)
      } catch (error) {
        console.error('[Update] listener gagal:', error)
      }
    }
  }



  async refreshVersions(): Promise<{ app: string | null }> {
    // Skip version refresh for localhost development
    if (updateDisabled()) {
      return { app: null }
    }
    try {
      this._currentApp = (await getNativeVersion()) ?? updateService.currentVersion ?? this._currentApp
    } catch { /* pakai nilai lama */ }
    this.set({})
    return { app: this._currentApp }
  }



  // Pemeriksaan ganda; hasil lama tidak ditumpuk agar tombol tidak dobel proses.
  check(): Promise<AppUpdateState> {
    // Skip update checks for localhost development
    if (updateDisabled()) {
      console.log('[Update] Localhost mode - skipping update check')
      return Promise.resolve({ ...IDLE, status: 'up-to-date' })
    }
    if (this._checking) return this._checking
    const run = this.runCheck().finally(() => { this._checking = null })
    this._checking = run
    return run
  }



  private async runCheck(): Promise<AppUpdateState> {
    this.set({ status: 'checking', error: null })
    await this.refreshVersions()

    // Paket APK HANYA bisa dipasang di aplikasi native Android. Di browser /
    // mobile web berkas APK tidak bisa dipasang, jadi kanal itu dilewati
    // seluruhnya - tidak ada kanal pengganti lagi.
    if (!isNativeAndroid()) {
      this.set({ status: 'up-to-date', kind: null, version: null, notes: null, error: null })
      return this._state
    }

    const apkInfo = await updateService.checkForUpdate().catch(() => null)
    if (apkInfo?.updateAvailable && updateService.state === 'ready') {
      const currentApp = this._currentApp ?? '0.0.0'
      const force = Boolean(apkInfo.isForceUpdate)
        || shouldForceUpdate(currentApp, apkInfo.minVersion ?? currentApp)
      this.set({
        status: 'ready',
        kind: 'apk',
        version: apkInfo.latestVersion,
        notes: apkInfo.releaseNotes,
        isForce: force,
        error: null,
      })
      return this._state
    }

    const apkError = updateService.error
    if (apkError?.message) {
      this.set({ status: 'error', kind: 'apk', version: null, error: apkError.message })
      return this._state
    }

    // Server sudah terjangkau dan versi terpasang adalah yang terbaru.
    this.set({ status: 'up-to-date', kind: null, version: null, notes: null, error: null })
    return this._state
  }



  async apply(): Promise<boolean> {
    // Tidak ada paket lebih baru yang menunggu: jangan memulai pemasangan yang
    // pasti gagal. Jawab "sudah versi terbaru" (status, bukan error).
    if (!this._state.kind || this._state.status === 'up-to-date') {
      this.set({ ...IDLE, status: 'up-to-date', error: null })
      return false
    }
    return this.applyApk()
  }



  private async applyApk(): Promise<boolean> {
    // Bisa terjadi kalau APK sudah dipasang di luar alur ini (mis. petugas
    // memasang manual) atau info versi basi: paket yang diminta sudah tidak
    // lebih baru dari versi terpasang → "sudah versi terbaru", bukan galat.
    const target = this._state.version
    const installed = await updateService.refreshInstalledVersion()
    if (target && !isNewerVersion(installed, target)) {
      this.set({ ...IDLE, status: 'up-to-date', error: null })
      return false
    }
    this.set({ status: 'installing', error: null })
    const started = await updateService.installUpdate()
    if (!started) {
      this.set({ status: 'error', kind: 'apk', version: null, error: updateService.error?.message ?? 'Gagal memulai pemasangan APK' })
      return false
    }
    // Versi baru hanya sah setelah aplikasi hidup kembali.
    setTimeout(() => { void this.syncInstalledVersion() }, 5000)
    return true
  }



  // Dipanggil saat aplikasi aktif lagi: versi native dibaca ulang dari sistem.
  async syncInstalledVersion(): Promise<string | null> {
    const applied = await updateService.refreshInstalledVersion()
    this._currentApp = applied
    if (this._state.kind === 'apk' && this._state.version && !isNewerVersion(applied, this._state.version)) {
      this.set({ ...IDLE, status: 'up-to-date' })
      return applied
    }
    if (this._state.status === 'installing' && this._state.kind === 'apk') {
      this.set({ status: 'ready', error: updateService.error?.message ?? null })
      return applied
    }
    this.set({})
    return applied
  }



  async reset(): Promise<void> {
    await updateService.reset()
    this.set({ ...IDLE })
  }
}



export const appUpdate = new AppUpdateController()
