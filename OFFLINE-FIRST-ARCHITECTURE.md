# Arsitektur Offline-First Mobile Trip Angkutan

> **Catatan**: Geofencing akan diimplementasi nanti setelah koordinat dermaga/rute diberikan.

---

## 1. Prinsip Desain

```
┌─────────────────────────────────────────────────────────────┐
│  PRINSIP OFFLINE-FIRST MOBILE TRIP ANGKUTAN                 │
│                                                              │
│  1. LOCAL-FIRST      → SIMPAN KE LOKAL DULU, baru sync   │
│  2. GAGAL = TIDAK MENGGANGGU → retry diam-diam         │
│  3. KONEKSI = OPSIONAL → offline TETAP berfungsi penuh   │
│  4. SERVER = CADANGAN → sinkronisasi otomatis saat online       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Arsitektur Lapisan

```
┌─────────────────────────────────────────────────────┐
│                 LAPISAN 1: UI/LAYARAN                │
│  HomeScreen │ TripActive │ Camera │ HistoryScreen │ dll.    │
└────────────────┬─────────────────────────────────┘
                 │ useApp() / Zustand-like state
                 ▼
┌─────────────────────────────────────────────────────┐
│ LAPISAN 2: STORE (localStorage + Zustand-like state)     │
│  • trips[]         • officers[]  • tariffs[]              │
│  • draft{}         • credentials • session               │
└────────────────────┬──────────────────────────────────┘
                     │                    ▲
                     ▼
┌────────────────────┴──────────────────────────────────┐
│             LAPISAN 3: SYNC ENGINE (sync.ts)             │
│  • processSyncQueue()     • probeServer()    • retry     │
│  • onSyncQueueChange()   • online/offline events          │
└────────────────────┬──────────────────────────────────┘
                     │ HTTP POST / GET
          ┌──────────┴──────────┐
          ▼                         ▼
   ┌─────────────┐          ┌──────────────┐
   │  LAPISAN 4 │          │    LAPISAN 4  │
   │  (local)   │          │    (remote)   │
   │ IndexedDB   │          │  Backend API   │
   │ localStorage│          │  / offlineDb  │
   │ SQLite      │          │  adminPull   │
   └─────────────┘          └──────────────┘
```

---

## 3. Diagram Alur Offline-First Lengkap

```
┌─────────────────────────────────────────────────────────────────────┐
│  START                                                              │
│  │                                                                  │
│  ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ 1. INITIALIZE OFFLINE STORAGE                                   │    │
│  │ 2. CEK navigator.onLine → probeServer()                        │    │
│  └───────┬─────────────────────────────────────────────────── ────┘    │
│          │                                                        │
│          ▼                                                        │
│  ┌───────────────────────────────────────────────────────────────┐    │
│  │ ONLINE? → YA → syncOfficers(), syncTariffs(), probeServer()   │    │
│  └───────┬─────────────────────────────────────────────────────┘    │
│          │ TIDAK                                                  │
│          ▼                                                        │
│  ┌─────────────────────────────────────────────────────────────┐     │
│  │ LANJUT OFFLINE → load from IndexedDB/localStorage              │     │
│  └───────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘

│
└──┬─────────────────────────────────────────────────────────────
   │ CEK STORED SESSION
   ▼
   ┌─────────────────────────────────────────────────────────────┐
   │ Ada session tersimpan?                                      │
   └───────┬────────────────────────────────────────────────┘
           │
           ├─── YA → ┌────────────────────────────┐ → HomeScreen
           │        │ Load dari localStorage    │
           │        │ render Trip tersimpan    │
           │        └──────────────────────────┘
           │
           ▼
           ├─ TIDAK → LoginPage
           ▼
           ┌─────────────────────────────────────────────────────┐
           │ A. AUTH (OFFLINE-CAPABLE)                        │
           │                                                │
           │ loginWithPin(offline) → verifyPinHash(local)        │
           │ load dermaga + routes dari IndexedDB               │
           │ onSyncQueueChange(syncCount)                      │
           └──────────────────────────────────────────────────┘
           │
           ▼
           ┌─────────────────────────────────────────────────────┐
           │ HomeScreen                                         │
           │                                                   │
           │ ┌───────────────────────────────────────────────┐   │
           │ │ B. TRIP MUATAN KOSONG (OFFLINE)              │   │
           │ │ 1. validasi geofencing (nanti koordinasi)         │   │
           │ │ 2. input data → commitTripOffline(draft)           │   │
           │ │ 3. hapus durasi, wajib foto bukti               │
           │ │ 4. submit() → simpan lokal + antrean               │
           │ └───────────────────────────────────────────────┘   │
           │                                                   │
           │ ┌───────────────────────────────────────────────┐   │
           │ │ C. TRIP ADA MUATAN (OFFLINE-CAPABLE)           │
           │ │ 1. validasi geofencing (nanti koordinasi)       │
           │ │ 2. input kendaraan → loop opsional                  │
           │ │ 3. swafoto WAJIB                               │
           │ │ 4. End Trip lokal                                 │
           │ │ 5. antren ke SyncQueue                          │
           │ └───────────────────────────────────────────────┘   │
           │                                                   │
           │ ┌───────────────────────────────────────────────┐   │
           │ │ D. RIWAYAT (OFFLINE-CAPABLE                      │   │
           │ │ 1. tampilkan dari IndexedDB (bukan fetch baru)       │
           │ │ 2. pagination, filter dari data tersimpan lokal      │
           │ └───────────────────────────────────────────────┘   │
           │                                                   │
           │ ┌───────────────────────────────────────────────┐   │
           │ │ E. SINKRONISASI OTOMATIS                     │
           │ │ Online → upload antrean + pull master terbaru        │
           │ │ Offline → tunggu & retry diam-diam               │
           │ └───────────────────────────────────────────────┘   │
           └───────────────────────────────────────────────────┘
```

---

## 4. Data Master untuk Offline

### 4.1 Struktur Penyimpanan

```
IndexedDB: trip_offline
├── officers          ← daftar petugas + hash PIN
├── credentials      ← PIN hash bcrypt
├── trips            ← trip tersimpan + sync state
├── photos          ← foto base64 (inline)
├── tariffs         ← tarif offline
├── plates          ← plat kendaraan
├── regions          ← region kode
└── queues          ← sync queue

localStorage (fallback)
├── trip.officers.v1
├── trip.trips.v1
└── trip.syncQueue.v1
```

### 4.2 Skema Sync Item

```typescript
interface SyncQueueItem {
  id: string           // keyPath
  trip: Trip
  attempts: number
  lastError?: string
  lastErrorCode?: string
  needsAttention?: boolean
  createdAt: number
  lastAttemptAt?: number
  photos: PhotoEntry[]       // lokal base64
  tripPhoto?: PhotoEntry
  trip: Trip
}
```

### 4.3 Seed Data Bawaan (Login Offline Sejak Instal Pertama)

Sumber: `src/services/seedData.ts` — daftar petugas + hash PIN bcrypt + rute
dermaga ditanam langsung di dalam kode aplikasi, sehingga login **100% offline
bisa terjadi tanpa sinkronisasi awal dan tanpa menembak endpoint server**.

| Aspek | Perilaku |
|-------|----------|
| Isi | 9 petugas (id, username, nama, region, akses dermaga) + hash bcrypt PIN + 8 dermaga rute dua arah |
| Penanaman | `initOfflineDb()` → **insert-if-absent** (SQLite / fallback localStorage) + merge roster `trip.officers.v1` + merge cache rute `trip.auth.routes.v1` |
| Anti-rusak | Baris/hash/rute yang sudah ada TIDAK pernah ditimpa → data hasil sync/OTA dari dashboard admin menang, data default tidak pernah terhapus |
| Verifikasi | `verifyPinOffline()` → DB offline → roster → **fallback seed** (`verifySeedPin`) — semuanya lokal & instan, tanpa jeda jaringan |
| Login | `LoginPage` & `PinVerifyScreen`: **verifikasi lokal lebih dulu** → bila online, sesi JWT + tarik roster admin berjalan di LATAR BELAKANG (`SESSION_READY_EVENT`) |
| Update via OTA | Rilis OTA menambah petugas → naikkan `SEED_VERSION` → perangkat lama melengkapi daftar saat init tanpa kehilangan data |
| Sync berkala | Event `online`, resume aplikasi (`syncOnResume`), & penanda `trip.sync.forceRoster` pasca-OTA menarik penambahan/penonaktifan petugas ke lokal (upsert, bukan timpa) |

---

## 5. Alur Trip Offline-First Detail

### 5.1 Muatan Kosong

```
TripConditionScreen → RouteSelectScreen → TripSummaryScreen → CameraScreen → TripActiveScreen → TripCompleteScreen

│
├── [OFFLINE] SIMPAN + ANTRIKAN
│   Trip tersimpan IndexedDB
│   Swafoto tersimpan lokal
└── [ONLINE] SYNC OTOMATIS
```

### 5.2 Ada Muatan

```
TripConditionScreen → VehicleFormScreen (loop) → TripSummaryScreen → CameraScreen → [SWAFOTO WAJIB] → TripCompleteScreen

│
├── [OFFLINE] SIMPAN + ANTRIKAN
│   Semua input tersimpan IndexedDB
│   Swafoto tersimpan lokal
└── [ONLINE] SYNC OTOMATIS
```

---

## 6. Sinkronisasi Dua Arah

```typescript
// ON RESUME / ONLINE EVENT
async function handleConnectionRestored(): Promise<void> {
  // 1. Probe server
  if (await probeServer()) {
    // 2. Pull perubahan terbaru
    await syncOfficers(true)
    await syncTariffs()
    // 3. Upload antrean lokal
    await processSyncQueue()
  }
}

// PROSES ANTREAN
async function processItem(item: SyncQueueItem): Promise<void> {
  // POST multipart + retry exponential backoff
  // HANYA keluar dari antrean jika HTTP 200/201
  // Error = tetap simpan, retry later
}
```

---

## 7. Offline-First Services

```typescript
// services/offline-first/
├── offline-db.ts         ← IndexedDB / SQLite / localStorage
├── sync.ts              ← antrean upload + retry
├── adminPull.ts         ← pull data master
├── auth.ts              ← login offline + PIN hash
└── geofencing.ts       ← TBD: validasi lokasi nanti

// services/
├── api.ts               ← HTTP client
├── cameras.ts            ← native camera
├── plates.ts            ← plate recognition
└── officers.ts          ← daftar petugas
```

---

## 8. Kondisi Offline Handling

| Situasi | Perilaku |
|---------|----------|
| Online → Offline | Proses latar mati, UI tetap jalan |
| Offline → Online | Probe + Pull master + Upload antrean |
| Offline = FALSE di webview | Probe tambahan sebelum sync |
| Sinkronisasi gagal | Retry otomatis (exp. backoff) |
| Sinkronisasi offline | Item tetap di antrean, tidak dibuang |

---

## 9. File Modifikasi

```diff
mobile-trip/src/
+ services/seedData.ts    # DATA BAWAAN: petugas + hash PIN + rute (seed)
+ services/offlineDb.ts   # SQLite lokal + seeding insert-if-absent
+ services/offline-first/
+   offline-db.ts         # IndexedDB wrapper
+   sync-queue.ts         # Upload antrean + retry
+   admin-pull.ts         # Pull master data (+ force flag pasca-OTA)
+   auth-offline.ts       # Login offline + PIN hash

mobile-trip/src/pages/
  HomeScreen.tsx          # Offline indicator + sync status
  TripActiveScreen.tsx      # Offline submit
  CameraScreen.tsx          # Simpan foto offline
  HistoryScreen.tsx          # Load dari IndexedDB
  TripCompleteScreen.tsx      # Tampilkan status sync
```

---

## 10. API Endpoint Plan

| Metode | Endpoint | Offline-Capable |
|--------|----------|-----------------|
| GET | /dermagas | ✅ |
| GET | /officers | ✅ |
| GET | /tariffs | ✅ |
| GET | /plates | ✅ |
| GET | /trips | ✅ |
| POST | /trips | ✅ |
| POST | /auth/login | ✅ |
| POST | /auth/refresh | ✅ |
