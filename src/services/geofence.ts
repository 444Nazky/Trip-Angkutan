// ─── Geofence Service ────────────────────────────────────────────────────────
// Validasi lokasi GPS berbasis radius untuk membatasi penginputan rute.
// Titik geofence: koordinat + radius (meter) + rute yang diizinkan.

import { Geolocation } from '@capacitor/geolocation'
import { api } from './api'

// ── DEV MODE: Fallback Mock Location ─────────────────────────────────────────
// Koordinat Dermaga 1 Badau — HANYA untuk testing di VS Code Browser/WebView.
// IMPORTANT: import.meta.env.DEV adalah TRUE hanya saat ionic serve (dev build).
// Saat build production, import.meta.env.DEV = FALSE, jadi fallback ini TIDAK aktif.
const DEV_MODE_FALLBACK_LAT = -6.1891005
const DEV_MODE_FALLBACK_LON = 106.8371641
const DEV_MODE_FALLBACK_ACCURACY = 5 // Simulasi GPS akurat 5 meter

/**
 * Bolehkah mock location DEV dipakai?
 * • `import.meta.env.DEV` harus true (build produksi → false / env tidak ada).
 * • `import.meta.env.MODE` juga harus 'development' (atau tidak terdefinisi):
 *   – 'test' (vitest) → DIMATI, supaya tes mengukur jalur produksi yang asli
 *     (pemanggilan GPS native + kebijakan blokir), bukan mock location.
 *   – 'production'    → mati otomatis lewat syarat DEV.
 *
 * CATATAN: Fallback DEV HANYA dipakai JIKA GPS real gagal/timeout.
 * Fungsi getCurrentPosition() akan SELALU coba GPS real duluan.
 */
function devMockLocationAllowed(): boolean {
  const env = (import.meta as { env?: { DEV?: boolean; MODE?: string } }).env
  if (!env?.DEV) return false
  if (env.MODE && env.MODE !== 'development') return false
  return true
}

// ── Types ───────────────────────────────────────────────────────────────────

export interface GeofencePoint {
  /** ID unik titik geofence */
  id: string
  /** Nama lokasi (mis. "Badau Dermaga 1", "Dermaga Sabadi") */
  name: string
  /** Kode dermaga terkait (mis. "BADAU-D1") */
  dermagaId?: string
  /** Koordinat latitude */
  latitude: number
  /** Koordinat longitude */
  longitude: number
  /** Radius validasi dalam meter (default: 100m) */
  radiusMeters: number
  /** Kode rute yang DIIZINKAN di titik ini (mis. ["SJRE-SBDZ"]) */
  allowedRoutes: string[]
  /** Apakah geofence aktif */
  enabled: boolean
  /**
   * STRICT: bila true (default), berada di LUAR geofence / GPS mati /
   * akurasi > radius → BLOCK ALL (semua input trip diblok, tanpa toleransi).
   * Bila false, di luar area tetap valid (perilaku lembut, dipilih admin).
   */
  strictEnforceOutsideArea?: boolean
}
export interface ValidationResult {
  valid: boolean
  /**
   * BLOCK ALL: seluruh input trip terkunci — di luar geofence, GPS mati,
   * akurasi buruk (> radius), atau sembarang aturan strict lain.
   */
  blocked?: boolean
  reason?: string
  activePoint?: GeofencePoint
  /** Jarak meter ke titik aktif (untuk UI) */
  distanceMeters?: number
  /** Akurasi GPS terakhir dalam meter (null bila tidak diketahui) */
  accuracyMeters?: number | null
  /**
   * true → penyebab blokir adalah KONFIGURASI yang belum ada di perangkat
   * (belum pernah sync / sync gagal), bukan lokasi petugas di luar area.
   * UI memakai ini untuk menawarkan tombol "Sinkronkan Ulang" alih-alih
   * menyuruh petugas berpindah lokasi. Setelah `syncGeofencesFromBackend()`
   * berhasil, kasus ini hilang dengan sendirinya.
   */
  configMissing?: boolean
}

// ── Storage Key ──────────────────────────────────────────────────────────────

const GEOFENCE_STORAGE_KEY = 'trip.geofence.points'

// ── Haversine Distance Calculation ──────────────────────────────────────────

const EARTH_RADIUS_METERS = 6371000

export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180

  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))

  return EARTH_RADIUS_METERS * c
}



export function getStoredGeofencePoints(): GeofencePoint[] {
  try {
    const raw = localStorage.getItem(GEOFENCE_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeStoredPoint).filter((p): p is GeofencePoint => p !== null)
  } catch {
    return []
  }
}

/**
 * Normalisasi titik dari localStorage (termasuk payload lama / separuh field
 * hasil cache versi sebelumnya) agar `enabled`/`radiusMeters`/`allowedRoutes`
 * selalu punya nilai benar. Tanpa ini, titik cache lama yang belum memiliki
 * `enabled` akan dianggap NONAKTIF oleh findActiveGeofencePoint → petugas
 * terblokir padahal konfigurasinya ada.
 */
function normalizeStoredPoint(value: unknown): GeofencePoint | null {
  if (!value || typeof value !== 'object') return null
  const p = value as Partial<GeofencePoint>
  const latitude = Number(p.latitude)
  const longitude = Number(p.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  const radius = Number(p.radiusMeters)
  return {
    id: String(p.id ?? ''),
    name: String(p.name ?? 'Titik Geofence'),
    dermagaId: p.dermagaId,
    latitude,
    longitude,
    radiusMeters: Number.isFinite(radius) && radius > 0 ? radius : 100,
    allowedRoutes: toStringArray(p.allowedRoutes as string[] | string | undefined),
    enabled: p.enabled !== false,
    strictEnforceOutsideArea: p.strictEnforceOutsideArea !== false,
  }
}

/** Simpan titik geofence ke localStorage */
export function saveGeofencePoints(points: GeofencePoint[]): void {
  try {
    localStorage.setItem(GEOFENCE_STORAGE_KEY, JSON.stringify(points))
  } catch {
    console.warn('[geofence] Gagal menyimpan konfigurasi geofence')
  }
}


// ── TANPA titik geofence hardcoded ──────────────────────────────────────────
// Sumber kebenaran tunggal adalah Master Rute di Admin Dashboard, disinkronkan
// via syncGeofencesFromBackend() → GET /api/geofences. Sebelumnya di sini ada
// koordinat Badau Dermaga 1 & 2 yang di-hardcode; itu membuat rute palsu di
// region lain (Entikong/Belitung/Kelapa Kampit) dan menutupi kegagalan sync.
// Fungsi dipertahankan (dipakai untuk paritas antar-branch) tapi mengembalikan
// daftar KOSONG: tanpa config dari backend = tidak ada area yang dianggap sah.
export function getDefaultGeofencePoints(): GeofencePoint[] {
  return []
}

export function isValidGeofencePoint(point: Partial<GeofencePoint>): string[] {
  const errors: string[] = []

  if (!point.id?.trim()) errors.push('ID titik geofence wajib diisi')
  if (typeof point.latitude !== 'number' || point.latitude < -90 || point.latitude > 90)
    errors.push('Latitude harus antara -90 dan 90')
  if (typeof point.longitude !== 'number' || point.longitude < -180 || point.longitude > 180)
    errors.push('Longitude harus antara -180 dan 180')
  // Radius 10m–10km, standar operasional 100m. Perubahan radius hanya lewat
  // Admin Dashboard — bukan hardcode di kode sumber (ketentuan dinamis).
  if (typeof point.radiusMeters !== 'number' || point.radiusMeters < 10 || point.radiusMeters > 10000)
    errors.push('Radius harus antara 10m dan 10km')
  if (!Array.isArray(point.allowedRoutes) || point.allowedRoutes.length === 0)
    errors.push('Minimal satu rute harus diizinkan')

  return errors
}




// ── IMPLEMENTASI MENTAH (diawali requestGpsFix) ──────────────────────────────
// Pembungkus ber-cache ada DI BAWAH fungsi ini: lihat getCurrentPosition().
async function requestGpsFix(): Promise<GpsFix | null> {
  // ── SELALU coba GPS real duluan ────────────────────────────────────────────
  // DEV MODE fallback HANYA aktif jika GPS real gagal/timeout/ditolak.
  // Ini memungkinkan testing di VS Code Simple Browser untuk mendeteksi apakah
  // GPS hardware bisa diakses atau tidak (untuk debugging).

  try {
    const pos = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: GPS_TIMEOUT_MS,
      maximumAge: FIX_MAX_AGE_MS,
    })
    if (!pos?.coords) {
      console.warn('[geofence] GPS: coords null')
      // ── GPS gagal → DEV fallback jika DEV mode ─────────────────────────
      if (devMockLocationAllowed()) {
        console.log('[geofence] GPS gagal → DEV MODE fallback ke Dermaga 1')
        return {
          lat: DEV_MODE_FALLBACK_LAT,
          lon: DEV_MODE_FALLBACK_LON,
          accuracy: DEV_MODE_FALLBACK_ACCURACY,
        }
      }
      return null
    }
    console.log(`[geofence] GPS real: ${pos.coords.latitude}, ${pos.coords.longitude} (±${pos.coords.accuracy}m)`)
    return {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
    }
  } catch (err) {
    console.warn('[geofence] Gagal mendapatkan posisi GPS:', err)
    // ── Error GPS (izin ditolak/timeout) → DEV fallback jika DEV mode ───
    // VS Code Simple Browser sering menolak/timeout izin GPS
    if (devMockLocationAllowed()) {
      console.log('[geofence] GPS error → DEV MODE fallback ke Dermaga 1')
      return {
        lat: DEV_MODE_FALLBACK_LAT,
        lon: DEV_MODE_FALLBACK_LON,
        accuracy: DEV_MODE_FALLBACK_ACCURACY,
      }
    }
    return null
  }
}


export interface GpsFix {
  lat: number
  lon: number
  accuracy?: number | null
}

// ── Fix GPS ber-DEDO & ber-CACHE (performa pemindaian geofence) ──────────────
// Pemeriksaan geofence dipanggil dari banyak tempat: layar Pilih Rute (mount +
// tiap 15 dtk + focus + online), Ringkasan Trip (tiap 20 dtk), Konfigurasi
// Geofence, plus self-heal setelah sync. Tanpa penggabungan, tiap pemicu
// membuka sesi GPS sendiri-sendiri — penerima GNSS harus bangun dulu (bisa
// 1–10 dtk), jadi banner "Memeriksa lokasi" menggantung dan beberapa permintaan
// berjalan paralel. Tiga penghematan TANPA mengubah kebijakan akurasi (tetap fix
// presisi, tetap timeout 10 dtk):
//   1. PANGGILAN BERSAMAAN berbagi SATU promise → cuma satu sesi GPS.
//   2. FIX LEBIH MUDA DARI FIX_FRESH_MS dipakai ulang → event focus/online &
//      jendela self-heal instan; interval 15 dtk tetap mendeteksi gerak.
//   3. maximumAge dilonggarkan → Android boleh memakai fix GPS terakhir tanpa
//      menghidupkan penerima lagi.
const FIX_FRESH_MS = 12_000
const FIX_MAX_AGE_MS = 8_000
const GPS_TIMEOUT_MS = 10_000

let cachedFix: { value: GpsFix; at: number } | null = null
let inFlightFix: Promise<GpsFix | null> | null = null

/**
 * Buang fix tersimpan — dipakai tes & kasus yang butuh hasil benar-benar baru
 * (mis. tombol periksa ulang) tanpa menunggu jendela freshness.
 */
export function resetGpsFixCache(): void {
  cachedFix = null
}

/**
 * Ambil posisi GPS (API publik — dipanggil snapshot/rute/ringkasan).
 * • fix muda (< 12 dtk) → kembalikan cache, TANPA sesi GPS;
 * • permintaan paralel → berbagi satu promise (dedup);
 * • kegagalan tidak di-cache, jadi retry petugas tetap langsung menembak GPS.
 */
export async function getCurrentPosition(): Promise<GpsFix | null> {
  if (cachedFix && Date.now() - cachedFix.at < FIX_FRESH_MS) return cachedFix.value
  if (inFlightFix) return inFlightFix

  const pending = requestGpsFix()
    .then((fix) => {
      if (fix) cachedFix = { value: fix, at: Date.now() }
      return fix
    })
    .finally(() => { inFlightFix = null })

  inFlightFix = pending
  return pending
}

export function findActiveGeofencePoint(
  position: { lat: number; lon: number },
  points: GeofencePoint[],
): GeofencePoint | null {
  for (const point of points) {
    if (!point.enabled) continue

    const distance = calculateDistance(
      position.lat,
      position.lon,
      point.latitude,
      point.longitude,
    )

    if (distance <= point.radiusMeters) {
      return point
    }
  }
  return null
}




export async function validateRouteForCurrentLocation(
  routeCode: string,
  points?: GeofencePoint[],
): Promise<ValidationResult> {
  const geofencePoints = points ?? getStoredGeofencePoints()
  // STRICT default: kecuali admin menonaktif flag di titik mana pun,
  // semua kegagalan lokasi = BLOCK ALL.
  const strict = geofencePoints.some(p => p.enabled !== false && p.strictEnforceOutsideArea !== false)

  // Tanpa titik geofence sama sekali → lokasi tidak terverifikasi, trip BLOCKED.
  // (Kebijakan disamakan dengan RouteSelectScreen & getActiveGeofenceSnapshot:
  //  rute hanya boleh dipakai setelah lokasi terbukti berada di titik resmi.)
  if (geofencePoints.length === 0) {
    return {
      valid: false,
      blocked: true,
      configMissing: true,
      reason: 'Geofence belum dikonfigurasi admin (Master Rute) — input trip diblokir sampai titik lokasi didaftarkan',
    }
  }

  const anyEnabled = geofencePoints.some(p => p.enabled)
  if (!anyEnabled || geofencePoints.every(p => !p.enabled)) {
    return {
      valid: false,
      blocked: true,
      reason: 'Titik geofence dinonaktifkan admin — input trip diblokir',
    }
  }

  const position = await getCurrentPosition()

  // ── Skenario C: GPS mati / izin ditolak → BLOCK ALL (strict) ──
  if (!position) {
    return strict
      ? { valid: false, blocked: true, reason: 'GPS tidak tersedia atau izin lokasi ditolak — input trip diblokir' }
      : { valid: false, reason: 'Tidak dapat mendapatkan posisi GPS. Pastikan GPS aktif dan izin lokasi diberikan.' }
  }

  // ── Skenario C: akurasi buruk (> radius ketat, 100m) → BLOCK ALL ──
  const isActiveStrict = geofencePoints.some(p => p.enabled && p.strictEnforceOutsideArea !== false)
  if (position.accuracy != null && position.accuracy > 100) {
    return isActiveStrict
      ? { valid: false, blocked: true, reason: `Akurasi GPS terlalu rendah (±${Math.round(position.accuracy)}m > 100m) — input trip diblokir`, accuracyMeters: position.accuracy }
      : { valid: false, reason: 'Akurasi GPS terlalu rendah. Buka area terbuka lalu coba lagi.', accuracyMeters: position.accuracy }
  }

  const activePoint = findActiveGeofencePoint(position, geofencePoints)

  // ── Skenario C: di luar seluruh geofence → BLOCK ALL (strict) ──
  if (!activePoint) {
    return isActiveStrict
      ? { valid: false, blocked: true, reason: 'Di luar Area Geofence Resmi — seluruh input trip diblokir', accuracyMeters: position.accuracy }
      : {
          valid: false,
          reason:
            'Anda tidak berada di lokasi yang diizinkan untuk input trip. Mendeteksi Anda di luar area dermaga yang terdaftar.',
        }
  }

  const activeDistance = calculateDistance(
    position.lat,
    position.lon,
    activePoint.latitude,
    activePoint.longitude,
  )

  // Cek apakah rute diperbolehkan di titik ini
  if (!activePoint.allowedRoutes.includes(routeCode)) {
    const allowedList = activePoint.allowedRoutes.join(', ')
    return {
      valid: false,
      blocked: isActiveStrict,
      reason: `Rute ${routeCode} tidak diizinkan di lokasi ini (${activePoint.name}). Rute yang diperbolehkan: ${allowedList}`,
      activePoint,
      distanceMeters: activeDistance,
      accuracyMeters: position.accuracy,
    }
  }

  return {
    valid: true,
    activePoint,
    distanceMeters: activeDistance,
    accuracyMeters: position.accuracy,
  }
}

/**
 * Hitung jarak dari posisi saat ini ke titik geofence terdekat.
 * Berguna untuk menampilkan info ke pengguna.
 */
// ── CRUD Operations ─────────────────────────────────────────────────────────

/** Tambah titik geofence baru */
/** Perbarui titik geofence */
/** Hapus titik geofence */
/** Toggle aktif/nonaktif titik geofence */
/** Reset ke default geofence points */
// ── Backend Sync ──────────────────────────────────────────────────────────

const GEOFENCE_SYNC_KEY = 'trip.geofence.lastSync'
const GEOFENCE_SYNC_INTERVAL = 15 * 60 * 1000 // 15 menit (dilewati bila force)

/**
 * Event yang dipancarkan setiap kali daftar titik geofence BERUBAH hasil sync.
 * Layar yang sedang terbuka (mis. Pilih Rute) mendengarkannya untuk menilai
 * ulang lokasi tanpa perlu restart aplikasi.
 */
export const GEOFENCE_UPDATED_EVENT = 'trip:geofence-updated'

/** Event saat backend balas 401 → UI menampilkan layar login ulang (bukan stuck). */
export const GEOFENCE_AUTH_EXPIRED_EVENT = 'trip:geofence-auth-expired'

export interface GeofenceSyncResult {
  ok: boolean
  /** Jumlah titik geofence yang tersimpan di perangkat setelah sync. */
  count: number
  /** `unauthorized` = sesi backend belum siap/kedaluwarsa · `empty` = server memang belum punya titik. */
  reason: 'ok' | 'cached' | 'empty' | 'unauthorized' | 'network'
}

/**
 * Kontrak respons ACTUAL dari GET /api/geofences (endpoint backend geofences.js):
 *   { id, locationName, latitude, longitude, radiusMeters,
 *     allowedRouteCodes: string[], allowedDirections: string[], description }
 * Toleransi camelCase/snake_case & field opsional agar kompatibel dengan
 * versi backend lama maupun baru.
 */
interface BackendGeofence {
  id: string
  locationName?: string
  name?: string
  latitude: number | string
  longitude: number | string
  radiusMeters?: number
  allowedRouteCodes?: string[] | string
  allowedRoutes?: string[]
  dermagaId?: string
  description?: string
  enabled?: boolean
  strictEnforceOutsideArea?: boolean
}

function toStringArray(v: string[] | string | undefined): string[] {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean)
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

function mapBackendToGeofence(g: BackendGeofence): GeofencePoint {
  return {
    id: String(g.id),
    name: String(g.locationName ?? g.name ?? 'Titik Geofence'),
    dermagaId: g.dermagaId,
    latitude: Number(g.latitude),
    longitude: Number(g.longitude),
    radiusMeters: Number(g.radiusMeters) > 0 ? Number(g.radiusMeters) : 100,
    // Backend mengirim allowedRouteCodes; fallback ke allowedRoutes (versi lama)
    allowedRoutes: toStringArray(g.allowedRouteCodes).length > 0
      ? toStringArray(g.allowedRouteCodes)
      : toStringArray(g.allowedRoutes),
    enabled: g.enabled !== false,
    strictEnforceOutsideArea: g.strictEnforceOutsideArea !== false,
  }
}

/**
 * Sinkronkan titik geofence dari backend ke lokal (GET /api/geofences).
 *
 * KAPAN DIPANGGIL (semua jalur harus ada, kalau tidak petugas terkunci):
 *   • tepat setelah sesi backend siap / selesai login (token sudah terpasang),
 *   • saat koneksi pulih & saat aplikasi kembali ke depan (syncOnResume),
 *   • saat layar Pilih Rute menemukan konfigurasi kosong (self-heal),
 *   • tombol "Tarik dari Server Admin" di Pengaturan Geofence.
 *
 * PENTING: endpoint ini ber-`authenticate`. Memanggilnya SEBELUM token ada
 * hanya menghasilkan 401 — itulah sebabnya dulu perangkat yang baru dibuka
 * selalu "Geofence belum dikonfigurasi admin" sampai app di-resume.
 *
 * @param opts.force true → abaikan cooldown (dipakai setelah login & manual).
 */
export async function syncGeofencesFromBackend(opts: { force?: boolean } = {}): Promise<GeofenceSyncResult> {
  const cachedCount = () => getStoredGeofencePoints().length

  // Cooldown hanya untuk siklus otomatis; jalur force (login/pulih/manual) bebas.
  if (!opts.force) {
    try {
      const lastSync = Number(localStorage.getItem(GEOFENCE_SYNC_KEY) || 0)
      if (Date.now() - lastSync < GEOFENCE_SYNC_INTERVAL) {
        return { ok: true, count: cachedCount(), reason: 'cached' }
      }
    } catch { /* storage tidak tersedia */ }
  }

  try {
    // Tanpa token (belum login / sudah dibersihkan setelah 401) → jangan menembak
    // endpoint ber-`authenticate`: hanya menghasilkan spam 401 di console dan
    // membuat device tampak "stuck". Layar login & event SESSION_READY yang akan
    // memicu sync ulang setelah token ada.
    if (!api.isAuthenticated) {
      return { ok: false, count: cachedCount(), reason: 'unauthorized' }
    }
    const result = await api.get<BackendGeofence[]>('/geofences')
    if (!result.ok || !Array.isArray(result.data)) {
      // 401 = token kedaluwarsa/invalid → beri tahu UI supaya menampilkan layar
      // login ulang (bukan diam-diam "stuck"). Permintaan yang gagal TIDAK membuang
      // antrean trip maupun cache geofence lokal.
      if (result.error?.code === '401') {
        try { window.dispatchEvent(new Event(GEOFENCE_AUTH_EXPIRED_EVENT)) } catch { /* non-browser */ }
        return { ok: false, count: cachedCount(), reason: 'unauthorized' }
      }
      return { ok: false, count: cachedCount(), reason: 'network' }
    }

    const points = result.data
      .map(mapBackendToGeofence)
      .filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))

    if (points.length === 0) {
      // Backend belum punya titik: JANGAN pakai default/hardcoded, dan jangan
      // hapus cache lama (offline-first) — cukup tandai sudah sync.
      try { localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now())) } catch { /* */ }
      return { ok: true, count: cachedCount(), reason: 'empty' }
    }

    const before = JSON.stringify(getStoredGeofencePoints())
    saveGeofencePoints(points)
    try { localStorage.setItem(GEOFENCE_SYNC_KEY, String(Date.now())) } catch { /* */ }

    // Beri tahu layar yang terbuka bahwa konfigurasi berubah → nilai ulang lokasi.
    if (before !== JSON.stringify(points)) {
      try {
        window.dispatchEvent(new CustomEvent(GEOFENCE_UPDATED_EVENT, { detail: { count: points.length } }))
      } catch { /* non-browser */ }
    }
    return { ok: true, count: points.length, reason: 'ok' }
  } catch {
    // Offline — pakai cache lokal (sudah ada di getStoredGeofencePoints)
    return { ok: false, count: cachedCount(), reason: 'network' }
  }
}

/**
 * Paksa sinkronisasi geofence dari backend, abaikan cooldown.
 * Dipakai setelah login/sesi siap, saat koneksi pulih, dan tombol manual admin.
 */
export async function forceSyncGeofencesFromBackend(): Promise<GeofenceSyncResult> {
  return syncGeofencesFromBackend({ force: true })
}

// ── Baca posisi aktif + titik geofence untuk UI dashboard ─────────────────

export async function getActiveGeofenceSnapshot(
  points?: GeofencePoint[],
): Promise<ValidationResult> {
  const geofencePoints = points ?? getStoredGeofencePoints()
  const strict = geofencePoints.some(p => p.enabled && p.strictEnforceOutsideArea !== false)

  // Belum ada titik sama sekali (admin belum mengisi Master Rute / belum sync):
  // lokasi TIDAK BISA diverifikasi → rute tetap disembunyikan, tapi pesannya
  // harus jelas (bukan "di luar area", karena tidak ada area yang didefinisikan).
  if (geofencePoints.length === 0) {
    return {
      valid: false,
      blocked: true,
      configMissing: true,
      reason: 'Belum ada titik geofence tersimpan di perangkat ini — tarik konfigurasi terbaru dari Admin (Master Rute)',
    }
  }

  if (geofencePoints.every(p => !p.enabled)) {
    return strict
      ? { valid: false, blocked: true, reason: 'Geofence nonaktif — input trip diblokir' }
      : { valid: false, blocked: true, reason: 'Titik geofence dinonaktifkan admin — input trip diblokir' }
  }

  const position = await getCurrentPosition()
  // GPS mati / izin ditolak → BLOCK ALL (strict)
  if (!position) {
    return strict
      ? { valid: false, blocked: true, reason: 'GPS tidak tersedia atau izin lokasi ditolak — input trip diblokir' }
      : { valid: false, reason: 'Posisi GPS tidak tersedia' }
  }

  // Akurasi buruk (> 100m) → BLOCK ALL (strict)
  if (position.accuracy != null && position.accuracy > 100) {
    return strict
      ? { valid: false, blocked: true, reason: `Akurasi GPS terlalu rendah (±${Math.round(position.accuracy)}m > 100m) — input trip diblokir`, accuracyMeters: position.accuracy }
      : { valid: false, reason: 'Akurasi GPS terlalu rendah', accuracyMeters: position.accuracy }
  }

  const activePoint = findActiveGeofencePoint(position, geofencePoints)
  // Di luar seluruh geofence → BLOCK ALL (strict)
  if (!activePoint) {
    return strict
      ? { valid: false, blocked: true, reason: 'Di luar Area Geofence Resmi — seluruh input trip diblokir', accuracyMeters: position.accuracy }
      : { valid: false, reason: 'Tidak berada di dalam area geofence', accuracyMeters: position.accuracy }
  }

  const distanceMeters = calculateDistance(
    position.lat,
    position.lon,
    activePoint.latitude,
    activePoint.longitude,
  )
  return { valid: true, activePoint, distanceMeters, accuracyMeters: position.accuracy }
}
