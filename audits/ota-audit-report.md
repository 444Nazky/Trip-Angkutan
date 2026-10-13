# Audit Report — OTA Update System + Repo-wide Over-Engineering

Date: 2026-10-13
Scope: whole tree (`mobile` branch), over-engineering only for Part A. No code changed.

---

## Part A — Over-engineering audit (ranked, biggest cut first)

```
delete backend/node_modules/ — 940 tracked files of vendored deps. `npm ci` in backend/. [backend/]
delete backend/uploads/*.jpg (39) + data/*.db + data/backups/*.db (11, 3.4MB) — runtime data, not source. [.gitignore]
delete src/services/geofence.ts.tmp.173771.821a03a14351 (534 lines) — editor temp file, duplicate of geofence.ts. nothing. [src/services/]
shrink OTA cache-purge logic written 3× — purgeOtherVersions(), resetOtaStorage(), sw.js activate() all hand-roll "delete caches matching trip-ota-*". one deleteOtaCaches(keep) helper. [src/services/ota.ts:283,352 · src/sw.js:24]
delete getCapacitorHttp() + _capacitorHttp — dynamic `import('@capacitor/core')` inside a file that already statically imports Capacitor from it. use the existing import. [src/services/ota.ts:358]
native @capacitor/network — one call site isOnline(), and navigator.onLine is already its own fallback. drop the dep. [src/services/ota.ts:127]
delete SW features with no producer: `ota_bypass=1`, PURGE_ALL message, LEGACY_COMPLEMENT, OTA_CACHE — grep finds references only in sw.js and sw.test.ts. nothing. [src/sw.js:17,21,52,82]
delete activateBundle() — one-line alias for activateStagedBundle(), referenced only by ota.test.ts. [src/services/ota.ts:641]
delete auditOta() DEV early-return — 30 lines duplicating the function's own tail (cache-count + return). hoist the shared block. [src/services/ota.ts:773]
shrink nativeFetch header rebuild — Object.entries(...).reduce(...) → new Headers(response.headers). [src/services/ota.ts:385]
yagni UpdateNotifierProps — minAppVersion never read; zIndex prop loses to hardcoded z-[100]/style={{zIndex:100}}; onStateChange/onUpdateApplied have no caller that needs them. trim the interface. [src/components/UpdateNotifier.tsx:23,31,149]
delete App.tsx latestVersionRef — written in an effect, never read. nothing. [src/App.tsx:15]
delete 9 dead exports (0 refs incl. tests): cachePin, evictPinCache, calculateDistance, getDefaultGeofencePoints, findActiveGeofencePoint, fetchBackendOfficers, SEED_ROUTES, seedAsMobileOfficer, clearOfflineData. nothing. [src/services/*.ts]
shrink sleep()/delay() — identical promise-timer defined in both ota.ts and otaReload.ts. one helper. [src/services/ota.ts:236 · src/services/otaReload.ts:64]
yagni environment.ts pair — two files, identical apiBaseUrl, environment.production is never read. one const; delete fileReplacements config. [src/environments/]
shrink devModeSkipRemote() — the DEV+MODE guard is written twice (ota.ts and geofence.ts). one shared helper. [src/services/ota.ts:429 · src/services/geofence.ts:10]
delete environment.ts's 15-line prose comment — spec notes living in a config file. move to PRD.md or drop. [src/environments/environment.ts]
shrink isNavigation() — `pathname === '/' || pathname.endsWith('/')`: first clause is redundant. [src/sw.js:124]
delete skills vendoring — .agents/, .claude/, .kilo/, skills-lock.json (30 tracked files) are agent tooling, not app source. [.agents .claude .kilo]
delete overlapping doc stack — Architecture.md + System-Design.md + Concept.md + Structure.md + ALUR_APLIKASI.md + OFFLINE-FIRST-ARCHITECTURE.md + AUDIT-OFFLINE-FIRST.md (~1,500 lines) restate README.md. keep README + one architecture doc. [*.md]
yagni UpdateState.downloaded + readMarker() — applyUpdate reads the asset list from localStorage AND from the on-disk marker; two sources of truth for one value. the marker. [src/services/ota.ts:966]
```

**Net: ~2,100 lines, ~3 deps removable** (`@capacitor/network` outright; `@angular/compiler` + `rxjs` move to `devDependencies` — nothing in `src/` imports either), plus 980 tracked vendor/data files.

---

## Part B — What is actually wrong with the OTA (correctness, out of Part A scope)

### 1. `nativeFetch` corrupts binary assets on native — the blocker (HIGH)

`src/services/ota.ts:379` calls `capHttp.request({...})` **without `responseType`**.

Android's `HttpRequestHandler.readData` defaults to `ResponseType.DEFAULT` →
`readStreamAsString(stream)` (`node_modules/@capacitor/android/.../HttpRequestHandler.java:255`).
So a PNG/JPEG is UTF-8-decoded into a JS string (invalid bytes → `U+FFFD`),
then `new Response(response.data)` re-encodes it as UTF-8 → **different bytes**.

`version.json` ships 3 binary assets every release:
`assets/guest-profile.jpeg`, `assets/karyamas_clean.png`, `assets/icon/favicon.png`.

→ SHA-256 mismatch → `verifyBytes` fails → retry fails → `Verifikasi berkas gagal — update dibatalkan`.

Even adding `responseType: 'arrayBuffer'` is not enough: Capacitor returns **base64**
in `data`, and `new Response(base64String)` encodes the base64 *text*, it does not
decode it. The whole CapacitorHttp branch has never produced correct bytes.

**Why the tests never caught it:** `ota.test.ts:110` mocks `@capacitor/core` as
`{ Capacitor: {...} }` — so `CapacitorHttp` is `undefined` and every test run takes
the plain `fetch` branch. And the fake server only serves **text** (`sha256(text)`).
The exact code path that runs in the APK is the one with zero coverage.

### 2. Full re-download every 30 minutes if the user does not tap "Terapkan" (HIGH)

State stays `'ready'`. `UpdateNotifier`'s 30-min interval calls `checkForUpdate`
unconditionally → reaches step 2 → `removeVersionStorage(remote.version)` deletes the
**already fully verified staged bundle** → re-downloads all 17 files. Every cycle.
`clearStuckOtaState()` explicitly does *not* treat this as stuck.

### 3. Update checks only run after login (HIGH for "not detected")

`<UpdateNotifier>` is rendered inside `Shell` **after** `if (!loggedIn) return <LoginPage/>`
(`src/App.tsx:49`). A device sitting on the login screen — including the 401-expired
state you just fixed in `594461d` — never runs a version check at all.
`ProfileScreen`'s manual button has the same gate.

### 4. `auditOta()` fetches the manifest without `?t=` (MEDIUM)

`src/services/ota.ts:793` — no cache-buster. GitHub raw sends
`cache-control: max-age=300` (verified), so the diagnostic can report a stale
remote version and hide a real release. `fetchManifest()` does it right; this copy does not.

### 5. `isNewer()` compares the `+timestamp` suffix before semver (MEDIUM)

`src/services/ota.ts:479` — when both versions carry `+`, the semver segment is
**never looked at**; only `parseInt(ts)`. A publish from a machine whose clock is
behind the previous publisher reports "not newer" forever, and a deliberate
downgrade publish reads as an upgrade. Match semver first, use `+ts` only as tiebreak.

### 6. DEV mode can never reproduce the flow (MEDIUM)

`devModeSkipRemote()` returns `not-found`, so localhost always shows
"Aplikasi sudah versi terbaru". The comment justifies this as CORS protection, but
`raw.githubusercontent.com` sends `access-control-allow-origin: *` (verified) —
the skip is unnecessary and it is precisely where you would debug the bug.

### 7. Apply is manual only (LOW)

`'ready'` waits for a tap; `minAppVersion` (the prop meant for forced updates) is
never implemented. On a field device you are always one release behind until someone
opens the sheet.

### 8. Two UIs drive one global state (LOW)

`ProfileScreen` and `UpdateNotifier` both call `checkForUpdate`/`applyUpdate`, which
share the module-level `controller` AbortController and the same
`localStorage['trip.ota.state']`. One cancels the other and overwrites its state.

---

## Not verified (needs a device log)

Whether #1 or #3 is the actual cause of "V1.0.1 → V1.0.2 not detected" in the field.
Determining test: install a release APK, publish, then capture
`adb logcat | grep OTA` on a cold start **before** logging in. If no `[OTA]` line
appears → #3. If `Verifikasi berkas gagal` appears → #1.

---

## Status per 13 Okt 2026 — Part B diremediasi (APK 1.0.3 / OTA 1.0.11)

| # | Temuan | Status | Perbaikan |
|---|--------|--------|-----------|
| 1 | `nativeFetch` merusak aset biner → verifikasi SHA-256 selalu gagal | ✅ FIX | `fetchBytes()`: CapacitorHttp `responseType:'arraybuffer'` + decode `fromBase64()`, fallback ke fetch WebView |
| 2 | Unduh ulang paket penuh tiap siklus 30 menit bila "Terapkan" belum ditekan | ✅ FIX | short-circuit: `status==='ready'` + `latestVersion` sama + jumlah berkas cocok → langsung `ready` tanpa purge/unduh |
| 3 | Cek versi hanya berjalan setelah login | ✅ FIX | `UpdateNotifier` dirender di luar gerbang `if (!loggedIn)` (`App.tsx`) |
| 4 | `auditOta()` fetch manifest tanpa `?t=` | ✅ FIX | ditambah `?t=${Date.now()}` |
| 5 | `isNewer()` membandingkan `+timestamp` sebelum semver | ✅ FIX | semver dulu; timestamp hanya tiebreak |
| 6 | DEV mode tidak bisa mereproduksi alur | ⏸️ DITERIMA | `devModeSkipRemote()` tetap, tetapi hanya aktif saat `DEV && MODE==='development'` (vitest & produksi tidak terpengaruh) |
| 7 | Apply masih manual (belum ada forced update) | ⏸️ BACKLOG | butuh keputusan UX (auto-apply + hitung mundur) |
| 8 | Dua UI menggerakkan satu state OTA global | ⏸️ BACKLOG | perlu satu store OTA bersama |

### Bukti verifikasi (exit status ditangkap)
- `npx tsc --noEmit` → **exit 0**.
- `npx vitest run` → **79/79 lulus** (7 berkas), termasuk 5 test baru: aset biner jalur native,
  update KEDUA dengan aset biner, fallback tanpa plugin, `isNewer` semver-first, dan anti-unduh-ulang.
- Falsifikasi test: `responseType` diubah ke `'text'` → test biner **GAGAL** (bukti test punya gigi), lalu dipulihkan.
- Verifikasi live CDN: **17/17 hash aset `origin/mobile` cocok** dengan manifest; bundel terbit memuat
  penanda `fallback ke fetch WebView`.
- APK `1.0.3` (versionCode 4): bundel di dalam APK **identik byte-per-byte** dengan `www/` hasil build (17/17).

### Limitasi yang masih ada
1. **Staleness CDN ≤5 menit** — `raw.githubusercontent` mengirim `cache-control: max-age:300` dan `?t=`
   TIDAK menembus cache CDN. Klien bisa membaca manifest lama sekali, gagal (cooldown error 2 menit),
   lalu pulih di siklus berikutnya.
2. **Publish beruntun < 5 menit berisiko** — publish MENGHAPUS chunk ber-hash lama dari tree, sehingga
   manifest yang masih ter-cache CDN bisa menunjuk berkas yang sudah tidak ada → satu siklus gagal.
3. **APK baru selalu menarik OTA sekali** (localStorage kosong → versi lokal `0.0.0`). Normal, sekaligus
   menjadi uji jalur update pada instalasi bersih.
4. Belum ada verifikasi otomatis siklus update beruntun **di perangkat Android** — perlu
   `adb logcat | grep OTA` sesuai bagian "Not verified" di atas.

## Dokumentasi terkait
- `02 - Mistakes/`: *OTA Gagal Update di APK — CapacitorHttp ResponseType TEXT*
- Log book harian: `Intern/log book/2026-10-13.md` (Sesi 8)
- README.md proyek: bagian **🔄 OTA Update System**
