// ─── Default Seed Data (bawaan aplikasi) ─────────────────────────────────────
// Daftar petugas + kredensial yang DITANAM langsung di dalam kode aplikasi
// mobile, sehingga LOGIN100% OFFLINE bisa terjadi sejak instalasi pertama:
//   • Tidak perlu sinkronisasi awal.
//   • Tidak perlu menembak endpoint server.
//
// Prinsip yang dijaga:
//   • Yang disimpan adalah HASH bcrypt dari PIN — PIN polos TIDAK pernah
//     ditulis ke dalam kode (hash identik dengan pin_hash milik server,
//     sehingga verifikasi lokal maupun online memberi hasil sama).
//   • Penanaman (seeding) bersifat INSERT-IF-ABSENT: baris yang sudah ada
//     tidak pernah ditimpa → data hasil sinkronisasi/OTA dari dashboard admin
//     tidak rusak, dan data default tidak pernah terhapus saat sync berjalan.
//   • Saat rilis OTA menambah petugas bawaan, naikkan SEED_VERSION — perangkat
//     lama akan melengkapi daftar tanpa kehilangan data yang sudah tersimpan.

import bcrypt from 'bcryptjs'

/** Naikkan saat menambah/mengubah isi seed pada rilis OTA. */
export const SEED_VERSION = 1
export const SEED_VERSION_KEY = 'trip.officers.seedVersion'

/** Kunci roster petugas di localStorage (sama dengan milik officers.ts). */
const ROSTER_KEY = 'trip.officers.v1'
/** Kunci cache rute per dermaga (sama dengan milik auth.ts). */
const ROUTES_KEY = 'trip.auth.routes.v1'

export interface SeedDermaga {
  id: string
  name: string
  code: string
  region_id: string
}

export interface SeedOfficer {
  id: string
  username: string
  name: string
  /** bcrypt hash PIN (server-compatible) — PIN polos tidak pernah disimpan. */
  pinHash: string
  /**
   * Status bawaan petugas: 1 = Aktif, 0 = Nonaktif.
   * Opsional (default 1) — rilis OTA dapat menanam petugas yang sudah
   * dinonaktifkan tanpa perlu menunggu sinkronisasi pertama dari server.
   */
  isActive?: 0 | 1
  regionId: string
  regionName: string
  regionCode: string
  /** Scope dermaga akses petugas (dipakai pemilihan dermaga offline). */
  dermagaAccess: SeedDermaga[]
}

export interface SeedRoute {
  id: string
  name: string
  route_from: string
  route_to: string
  distance?: string
  duration?: string
}

// ── Wilayah operasional ──────────────────────────────────────────────────────

const REGIONS = {
  ENTIKONG: { id: '502f59b2-dae7-4f38-9692-89f1b729a729', name: 'Entikong', code: 'ENTIKONG' },
  BADAU: { id: 'f6aefe26-2b5a-4a43-9fac-be1508f11665', name: 'Badau', code: 'BADAU' },
  BELITUNG: { id: '55831492-3922-4b5c-8580-3474b98c3679', name: 'Belitung', code: 'BELITUNG' },
  KELAPAKAMPIT: { id: '18758498-2495-4387-93b5-d33e99b47b43', name: 'Kelapa Kampit', code: 'KELAPAKAMPIT' },
} as const

const DERMAGA = {
  BADAU_D1: { id: '10724ce5-f710-4ef6-a383-8710bc5b451f', name: 'Dermaga 1', code: 'D1', region_id: REGIONS.BADAU.id },
  BADAU_D2: { id: 'f3401fb6-116e-4cde-9579-a8010e90e964', name: 'Dermaga 2', code: 'D2', region_id: REGIONS.BADAU.id },
  ENTIKONG_D1: { id: '83d12643-72a1-4063-99ad-1f1d81d807d0', name: 'Dermaga 1', code: 'D1', region_id: REGIONS.ENTIKONG.id },
  ENTIKONG_D2: { id: 'fc75f867-e376-4d25-923f-7f66b4dfb909', name: 'Dermaga 2', code: 'D2', region_id: REGIONS.ENTIKONG.id },
  BELITUNG_D1: { id: '9fff82cd-76a1-462a-b5bd-ebf5fffbe288', name: 'Dermaga 1', code: 'D1', region_id: REGIONS.BELITUNG.id },
  BELITUNG_D2: { id: 'bce6428f-d154-44ca-b7f8-810023c68a69', name: 'Dermaga 2', code: 'D2', region_id: REGIONS.BELITUNG.id },
  KPK_D1: { id: 'dd6b4b11-f130-46b5-a4f7-7bccba2d80bf', name: 'Dermaga 1', code: 'D1', region_id: REGIONS.KELAPAKAMPIT.id },
  KPK_D2: { id: '6d0c826f-491d-43c5-8fd5-30db32959e87', name: 'Dermaga 2', code: 'D2', region_id: REGIONS.KELAPAKAMPIT.id },
} as const

// ── Daftar petugas bawaan (id & hash = data server resmi) ────────────────────

export const SEED_OFFICERS: SeedOfficer[] = [
  {
    id: 'f2984978-eca2-46a9-b1bc-07252e36dc95',
    username: 'rizkymaulana',
    name: 'Rizky Maulana',
    pinHash: '$2a$10$MeDg2y0HEvPzss1a1gZnh.Jto58JA.I9fMg3wkAf2xCWgC6HhTW2q',
    regionId: REGIONS.ENTIKONG.id,
    regionName: REGIONS.ENTIKONG.name,
    regionCode: REGIONS.ENTIKONG.code,
    dermagaAccess: [DERMAGA.ENTIKONG_D1],
  },
  {
    id: '0cb61d4b-b83f-42b0-8fc1-9dfb16d1675b',
    username: 'budisantoso',
    name: 'Budi Santoso',
    pinHash: '$2a$10$MeDg2y0HEvPzss1a1gZnh.Jto58JA.I9fMg3wkAf2xCWgC6HhTW2q',
    regionId: REGIONS.BADAU.id,
    regionName: REGIONS.BADAU.name,
    regionCode: REGIONS.BADAU.code,
    dermagaAccess: [DERMAGA.BADAU_D1],
  },
  {
    id: 'd226ff51-f16f-4997-ac0c-fa4293824d1e',
    username: 'andipratama',
    name: 'Andi Pratama',
    pinHash: '$2a$10$RgBlt3924WCbcw/mD5OmpeuZoz493izyJRt0zNjXTToSFVdQMZ5kC',
    regionId: REGIONS.BADAU.id,
    regionName: REGIONS.BADAU.name,
    regionCode: REGIONS.BADAU.code,
    dermagaAccess: [DERMAGA.BADAU_D2],
  },
  {
    id: '8c9a1525-58ed-42ef-9c9a-91f7d1c53ef4',
    username: 'dewikusuma',
    name: 'Dewi Kusuma',
    pinHash: '$2a$10$5JfIh1IdfLcjcW1W3Gna7OUUg3f/XDH0vm3925xO/kf3FJ6vGMxcW',
    regionId: REGIONS.BADAU.id,
    regionName: REGIONS.BADAU.name,
    regionCode: REGIONS.BADAU.code,
    dermagaAccess: [DERMAGA.BADAU_D1, DERMAGA.BADAU_D2],
  },
  {
    id: 'a0e458ec-5ddf-4958-a8fe-de30fce13158',
    username: 'sitirahayu',
    name: 'Siti Rahayu',
    pinHash: '$2a$10$SET68CioakXByRCzJ44OCe4IXG5O92uO6xOEMALP9MCueaR6KThRW',
    regionId: REGIONS.BADAU.id,
    regionName: REGIONS.BADAU.name,
    regionCode: REGIONS.BADAU.code,
    dermagaAccess: [DERMAGA.BADAU_D1],
  },
  {
    id: 'c3a55842-6160-4c0b-8981-56819fbd7ef7',
    username: 'agungsuntoso',
    name: 'Agung Suntoso',
    pinHash: '$2a$10$X62ajHIxJ4cGPts4d8elX.ZrwWREBGlsHoU/i7Qlk5kaWikWCRmJy',
    regionId: REGIONS.BELITUNG.id,
    regionName: REGIONS.BELITUNG.name,
    regionCode: REGIONS.BELITUNG.code,
    dermagaAccess: [DERMAGA.BELITUNG_D1],
  },
  {
    id: '7e6016bc-6507-439a-93f1-784ac5b7d85c',
    username: 'rahmathidayat',
    name: 'Rahmat Hidayat',
    pinHash: '$2a$10$ajN5h14TpdLSUeoG7KBLEeDeXoy0qweA3b9tRutbdkN.A0EYNpChi',
    regionId: REGIONS.BELITUNG.id,
    regionName: REGIONS.BELITUNG.name,
    regionCode: REGIONS.BELITUNG.code,
    dermagaAccess: [DERMAGA.BELITUNG_D2],
  },
  {
    id: '0d40614e-95d2-47ec-a92a-c9556efe85f8',
    username: 'hendragunawan',
    name: 'Hendra Gunawan',
    pinHash: '$2a$10$ajN5h14TpdLSUeoG7KBLEeDeXoy0qweA3b9tRutbdkN.A0EYNpChi',
    regionId: REGIONS.KELAPAKAMPIT.id,
    regionName: REGIONS.KELAPAKAMPIT.name,
    regionCode: REGIONS.KELAPAKAMPIT.code,
    dermagaAccess: [DERMAGA.KPK_D1],
  },
  {
    id: 'a862bdc6-d2e9-450f-9f4d-02b5817dd5a0',
    username: 'mayasari',
    name: 'Maya Sari',
    pinHash: '$2a$10$ajN5h14TpdLSUeoG7KBLEeDeXoy0qweA3b9tRutbdkN.A0EYNpChi',
    regionId: REGIONS.KELAPAKAMPIT.id,
    regionName: REGIONS.KELAPAKAMPIT.name,
    regionCode: REGIONS.KELAPAKAMPIT.code,
    dermagaAccess: [DERMAGA.KPK_D2],
  },
]

// ── Rute master bawaan (per dermaga, dua arah — identik dengan server) ───────

export const SEED_ROUTES: Record<string, SeedRoute[]> = {
  [DERMAGA.BADAU_D1.id]: [
    { id: `seed:${DERMAGA.BADAU_D1.id}:SJRE-SBDZ`, name: 'Sijangkung → Sabadi', route_from: 'SJRE', route_to: 'SBDZ', distance: '42 km', duration: '1j 10m' },
    { id: `seed:${DERMAGA.BADAU_D1.id}:SBDZ-SJRE`, name: 'Sabadi → Sijangkung', route_from: 'SBDZ', route_to: 'SJRE', distance: '42 km', duration: '1j 10m' },
  ],
  [DERMAGA.BADAU_D2.id]: [
    { id: `seed:${DERMAGA.BADAU_D2.id}:AAAA-BBBB`, name: 'AAAA → BBBB', route_from: 'AAAA', route_to: 'BBBB' },
    { id: `seed:${DERMAGA.BADAU_D2.id}:BBBB-AAAA`, name: 'BBBB → AAAA', route_from: 'BBBB', route_to: 'AAAA' },
  ],
  [DERMAGA.ENTIKONG_D1.id]: [
    { id: `seed:${DERMAGA.ENTIKONG_D1.id}:A4A4-B8B8`, name: 'A4A4 → B8B8', route_from: 'A4A4', route_to: 'B8B8' },
    { id: `seed:${DERMAGA.ENTIKONG_D1.id}:B8B8-A4A4`, name: 'B8B8 → A4A4', route_from: 'B8B8', route_to: 'A4A4' },
  ],
  [DERMAGA.ENTIKONG_D2.id]: [
    { id: `seed:${DERMAGA.ENTIKONG_D2.id}:C3C3-D6D6`, name: 'C3C3 → D6D6', route_from: 'C3C3', route_to: 'D6D6' },
    { id: `seed:${DERMAGA.ENTIKONG_D2.id}:D6D6-C3C3`, name: 'D6D6 → C3C3', route_from: 'D6D6', route_to: 'C3C3' },
  ],
  [DERMAGA.BELITUNG_D1.id]: [
    { id: `seed:${DERMAGA.BELITUNG_D1.id}:CCCC-DDDD`, name: 'CCCC → DDDD', route_from: 'CCCC', route_to: 'DDDD' },
    { id: `seed:${DERMAGA.BELITUNG_D1.id}:DDDD-CCCC`, name: 'DDDD → CCCC', route_from: 'DDDD', route_to: 'CCCC' },
  ],
  [DERMAGA.BELITUNG_D2.id]: [
    { id: `seed:${DERMAGA.BELITUNG_D2.id}:EEEE-FFFF`, name: 'EEEE → FFFF', route_from: 'EEEE', route_to: 'FFFF' },
    { id: `seed:${DERMAGA.BELITUNG_D2.id}:FFFF-EEEE`, name: 'FFFF → EEEE', route_from: 'FFFF', route_to: 'EEEE' },
  ],
  [DERMAGA.KPK_D1.id]: [
    { id: `seed:${DERMAGA.KPK_D1.id}:GGGG-HHHH`, name: 'GGGG → HHHH', route_from: 'GGGG', route_to: 'HHHH' },
    { id: `seed:${DERMAGA.KPK_D1.id}:HHHH-GGGG`, name: 'HHHH → GGGG', route_from: 'HHHH', route_to: 'GGGG' },
  ],
  [DERMAGA.KPK_D2.id]: [
    { id: `seed:${DERMAGA.KPK_D2.id}:IIII-JJJJ`, name: 'IIII → JJJJ', route_from: 'IIII', route_to: 'JJJJ' },
    { id: `seed:${DERMAGA.KPK_D2.id}:JJJJ-IIII`, name: 'JJJJ → IIII', route_from: 'JJJJ', route_to: 'IIII' },
  ],
}

// ── Utilitas pencarian & verifikasi ──────────────────────────────────────────

/** Cari petugas bawaan lewat id ATAU username ATAU nama (case-insensitive). */
export function findSeedOfficer(identifier: string): SeedOfficer | null {
  const key = String(identifier ?? '').trim().toLowerCase()
  if (!key) return null
  return SEED_OFFICERS.find(s =>
    s.id === String(identifier).trim() ||
    s.username.toLowerCase() === key ||
    s.name.toLowerCase() === key,
  ) ?? null
}

/**
 * Verifikasi PIN terhadap hash bawaan. Dipakai sebagai lapisan terakhir saat
 * database lokal belum sempat terisi (mis. percobaan login pertama begitu
 * aplikasi dibuka) — tetap instan, tanpa jaringan.
 */
export function verifySeedPin(identifier: string, pin: string): boolean {
  const seed = findSeedOfficer(identifier)
  if (!seed || !pin) return false
  try {
    if (seed.pinHash.startsWith('$2')) return bcrypt.compareSync(pin, seed.pinHash)
    return seed.pinHash === pin
  } catch {
    return false
  }
}

// ── Bentuk roster mobile (format identik toMobileOfficer) ────────────────────

export interface SeedMobileOfficer {
  id: string
  name: string
  username: string
  initials: string
  region: string
  regions: string[]
  pin: ''
  status: string
  device: string
  trips: number
  lastActive: string
  joined: string
  dermagaAccess: SeedDermaga[]
}

export function seedAsMobileOfficer(s: SeedOfficer): SeedMobileOfficer {
  const active = (s.isActive ?? 1) === 1
  return {
    id: s.id,
    name: s.name,
    username: s.username,
    initials: s.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2),
    region: s.regionCode,
    regions: [s.regionCode],
    pin: '',
    status: active ? 'Aktif' : 'Nonaktif',
    device: '-',
    trips: 0,
    lastActive: '-',
    joined: '-',
    dermagaAccess: s.dermagaAccess,
  }
}

/** Seluruh petugas bawaan dalam format roster mobile. */
export function seedRoster(): SeedMobileOfficer[] {
  return SEED_OFFICERS.map(seedAsMobileOfficer)
}

// ── Penanaman data turunan (roster & rute) ───────────────────────────────────

/**
 * Gabungkan petugas bawaan ke roster `trip.officers.v1` — HANYA menambah entri
 * yang belum ada; entri hasil sync admin tidak pernah ditimpa/dihapus.
 */
export function seedRosterIfAbsent(): void {
  try {
    const raw = localStorage.getItem(ROSTER_KEY)
    const list = raw ? JSON.parse(raw) : []
    const rows: Array<Record<string, unknown>> = Array.isArray(list) ? list : []
    const have = new Set(rows.map(r => String(r['id'])))
    let changed = false
    for (const s of SEED_OFFICERS) {
      if (have.has(s.id)) continue
      rows.push(seedAsMobileOfficer(s) as unknown as Record<string, unknown>)
      changed = true
    }
    if (changed) localStorage.setItem(ROSTER_KEY, JSON.stringify(rows))
  } catch { /* quota / data rusak — abaikan */ }
}

/**
 * Tanam rute bawaan ke cache `trip.auth.routes.v1` — hanya untuk dermaga yang
 * BELUM punya rute tersimpan. Rute hasil sinkronisasi server tetap menang.
 */
export function seedRouteCacheIfAbsent(): void {
  try {
    const raw = localStorage.getItem(ROUTES_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    const map: Record<string, SeedRoute[]> =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    let changed = false
    for (const [dermagaId, routes] of Object.entries(SEED_ROUTES)) {
      const existing = map[dermagaId]
      if (Array.isArray(existing) && existing.length) continue
      map[dermagaId] = routes
      changed = true
    }
    if (changed) localStorage.setItem(ROUTES_KEY, JSON.stringify(map))
  } catch { /* quota / data rusak — abaikan */ }
}
