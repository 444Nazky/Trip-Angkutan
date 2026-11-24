# Security Audit — Trip Angkutan

Dokumen ini merangkum hasil audit keamanan source-first yang dijalankan pada
**2026-11-20** terhadap commit `d4de05598ad692719346045e597e612467589666` (branch `main`).

## 1. Ruang lingkup dan metodologi

- Profil audit: `standard`, source-first, sandboxed-source-and-local-only.
- Fokus: `src/`, `server/`, `scripts/`, `android/`, deployment config (`docker-compose.yml`, `nginx.conf`, `Dockerfile*`).
- Dikeluarkan: `node_modules/`, hasil build (`www/`), `graphify-out/`, log, backup, dan file runtime/db.
- Tidak ada endpoint deployed, layanan eksternal, atau identitas produksi yang dihubungi. Tidak ada eksekusi target-controlled code karena kontrol sandbox penuh tidak tersedia.
- Artefak lengkap: `~/security-audit-skill/trip-angkutan/run-1/` (`REPORT.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md`, `findings.json`, `coverage-ledger.json`).
- Tidak ada audit/ledger sebelumnya yang ditemukan; tidak ada temuan lama yang diwariskan.

## 2. Ringkasan eksekutif

Ditemukan **8 temuan confirmed** (1 critical, 4 high, 3 medium) dan **8 lead needs-validation**.
Seluruh temuan confirmed **sudah diperbaiki** di source dan telah diverifikasi dengan lint, typecheck, compose config, serta regression test yang relevan.
Lead needs-validation tetap tercatat sebagai risiko yang belum terbukti, tanpa level severitas.

Prioritas berikut memakai level dampak yang berhasil dibuktikan, bukan sekadar kelayakan eksploitasi:

| Prioritas | Arti |
|---|---|
| P0 | Critical — perbaiki dan segera verifikasi ulang |
| P1 | High — perbaiki sebelum rilis berikutnya |
| P2 | Medium — perbaiki dalam siklus normal |
| P3/P4 | Rendah/informasi — hardening |

## 3. Temuan confirmed dan status perbaikan

### 1. [CRITICAL] APK publish endpoint uses source-known default secret and no principal binding

- **Prioritas:** P0 — segera
- **Fingerprint:** `apk-publish-secret-default-fallback`
- **Lokasi utama:** `server/api/index.ts:329` (route dispatch)
- **Akar masalah:** A high-privilege software-distribution endpoint is authorized by a shared secret with a hardcoded default identical to the operator default, with no fail-closed requirement, no admin identity, and no binding between publisher and artifact.
- **Dampak terbukti:** Arbitrary APK bytes with a chosen version are stored and advertised as the latest release to every field client; there is no code-signing check and the hash is computed from the attacker's own bytes, enabling distribution of arbitrary code to all devices via the trusted update channel.
- **Korban/sumber terdampak:** Unauthenticated LAN caller who can read repository source
- **Hasil observasi:** Source-visible and independently reproduced from current source: the request passes the sole x-publish-secret gate and reaches the APK storage upload and app_versions upsert; the advertised hash is computed from the attacker's own bytes, so client verification cannot establish authenticity.
- **Perbaikan:** Remove the hardcoded 'trip-angkut-secret' fallback in both appVersion.ts and publish-apk.mjs; require an explicitly configured, non-default PUBLISH_SECRET at startup by adding it to the local_server.ts preflight REQUIRED list with a default-value rejection; and add requireAdmin(req) to the publish route so the shared secret is not the sole authority.
- **File perbaikan:** `server/api/handlers/appVersion.ts`, `server/api/local_server.ts`, `server/api/.env.example`, `scripts/publish-apk.mjs`, `restart.sh`
- **Verifikasi:** compose config + bash -n restart.sh + node --check publish-apk.mjs

### 2. [HIGH] APK update integrity verification fails open with same-channel hash

- **Prioritas:** P1 — tinggi
- **Fingerprint:** `apk-update-integrity-fail-open`
- **Lokasi utama:** `server/api/handlers/appVersion.ts:79` (getAppVersion)
- **Akar masalah:** Integrity is best-effort, fail-open, and has no trust root independent of the artifact channel.
- **Dampak terbukti:** An unverified application APK reaches the system installer for the field devices.
- **Korban/sumber terdampak:** On-path LAN attacker tampering with the cleartext /app-version response, or a publisher using the source-visible default PUBLISH_SECRET (trip-angkut-secret)
- **Hasil observasi:** Source shows all absence/error branches in verifyApkHash return success before installUpdate opens the native installer.
- **Perbaikan:** Require an independently rooted digest/signature (e.g. developer signature pinned in the app), fail closed on every error and absence, pin the download origin, and serve metadata/APK over TLS.
- **File perbaikan:** `src/services/updateService.ts`, `server/api/handlers/appVersion.ts`, `src/services/updateFlow.test.ts`
- **Verifikasi:** src/services/updateFlow.test.ts

### 3. [HIGH] PostgREST anonymous role is DB owner with trust auth and no RLS

- **Prioritas:** P1 — tinggi
- **Fingerprint:** `server-db/postgrest-anon-equals-owner-trust-no-rls`
- **Lokasi utama:** `docker-compose.yml:80` (db environment)
- **Akar masalah:** The database boundary has no privilege drop, authentication, or row scoping; the API wrapper is the sole control.
- **Dampak terbukti:** Full read/write over all tables including admin_credentials password hashes; the connection role is the POSTGRES_USER superuser/owner.
- **Korban/sumber terdampak:** Lower-trust host-local process or compose peer
- **Hasil observasi:** With no PGRST_JWT_SECRET, PostgREST executes the request as PGRST_DB_ANON_ROLE, which equals the owner/superuser in PGRST_DB_URI; trust auth removes the DB password, so the unauthenticated GET runs with full owner privileges and returns credential rows.
- **Perbaikan:** Use a non-owner authenticator, restricted anon role, RLS policies, password auth, and remove the debug port.
- **File perbaikan:** `docker-compose.yml`
- **Verifikasi:** docker compose config --quiet

### 4. [HIGH] Intranet API treats requests without Authorization as admin by default

- **Prioritas:** P1 — tinggi
- **Fingerprint:** `server.api.admin-auth-disabled-default-unauthenticated-admin`
- **Lokasi utama:** `server/api/local_server.ts:83` (deployment default)
- **Akar masalah:** The missing-credential path is treated as positive admin authority and the insecure value is the shipped default.
- **Dampak terbukti:** Full admin capability set including officer management, import/restore and APK publishing.
- **Korban/sumber terdampak:** Unauthenticated LAN device or cross-site page
- **Hasil observasi:** Complete source trace: a no-header request yields an admin context via auth(), requireAdmin() accepts it, and the admin-only officer handler reaches its DB-update success branch. Dynamic reproduction was not possible offline (Deno absent; server tests import remote modules), so the observed result is source-level, matching the candidate's framing.
- **Perbaikan:** Fail closed on a missing Authorization header, default ADMIN_AUTH_DISABLED to 0 in local_server.ts and .env.example, require a verified admin token on every admin handler, and restrict the API bind address to the trusted interface.
- **File perbaikan:** `server/api/local_server.ts`, `server/api/_shared.ts`, `server/api/.env.example`, `restart.sh`
- **Verifikasi:** source review + .env.example/restart.sh

### 5. [HIGH] Offline PIN gate accepts any six digits via no-argument loginOffline

- **Prioritas:** P1 — tinggi
- **Fingerprint:** `src/services/auth.ts/loginOffline.no-arg-skips-PIN-verification`
- **Lokasi utama:** `src/pages/mobile/PinVerifyScreen.tsx:61` (confirm())
- **Akar masalah:** The session-presence shortcut (loginOffline with no identifier/pin) was reused as a PIN verification gate; the entered value is never compared to the target officer's stored hash or the server before the active officer is changed.
- **Dampak terbukti:** Switches active officer identity without authorization and exposes that officer's cached offline data and trip-writing capability.
- **Korban/sumber terdampak:** Person with unlocked shared device who does not know the target officer's PIN
- **Hasil observasi:** loginOffline() is called with no arguments; the no-arg branch returns success at auth.ts:358 from the stored session without comparing pressedPin (the verifying checkOfflineCredential at :363 is only reached with arguments). finishAuth() then calls setOfficerId(targetId) at PinVerifyScreen.tsx:47, and the only online re-check is a swallowed fire-and-forget loginWithPin. Any six digits switch the active officer.
- **Perbaikan:** In PinVerifyScreen.confirm, do not rely on the no-argument stored-session shortcut. Verify the entered PIN for the target officer first — call loginOffline(targetId, pressedPin) (the verifying overload that runs checkOfflineCredential against the stored hash) and/or await loginWithPin(targetId, pressedPin), and only call finishAuth() when it returns success. Keep the no-argument loginOffline shortcut for startup/session checks only.
- **File perbaikan:** `src/pages/mobile/PinVerifyScreen.tsx`, `src/pages/mobile/PinVerifyScreen.pin.test.tsx`
- **Verifikasi:** src/pages/mobile/PinVerifyScreen.pin.test.tsx

### 6. [MEDIUM] Cleartext PIN survives logout and silently re-authenticates

- **Prioritas:** P2 — sedang
- **Fingerprint:** `client-storage.cleartext-pin-silent-relogin-after-logout`
- **Lokasi utama:** `src/services/auth.ts:190` (loginWithPin)
- **Akar masalah:** Credentials are persisted in cleartext under multiple localStorage keys on login, but logout revokes only one of them; the no-token branch of renewSessionIfNeeded consumes the surviving key to silently mint a new session token without user interaction.
- **Dampak terbukti:** A later device user regains the prior officer's authenticated session and authority without knowing the PIN, but this requires prior physical/local access to the device and does not by itself grant admin rights.
- **Korban/sumber terdampak:** A later user of a shared field device who knows neither the prior officer's PIN nor password, but has physical/local access to the app's localStorage after that officer explicitly logged out.
- **Hasil observasi:** The retained credential is consumed with no user interaction: silentReLogin POSTs /auth/login and installs a new token for the prior officer. The existing bounded test sessionRecovery.test.ts:83-90 asserts exactly this result (renewSessionIfNeeded() returns true, fakeJwt installed, sole POST is /auth/login, no PIN prompt), and auth.ts:552-556 confirms logout leaves the consumed key intact.
- **Perbaikan:** Revoke every stored login credential on logout and gate silent re-login on an explicit active-session marker that logout resets, so no interaction-free re-authentication is possible after logout.
- **File perbaikan:** `src/services/auth.ts`, `src/services/sessionRecovery.test.ts`
- **Verifikasi:** src/services/sessionRecovery.test.ts

### 7. [MEDIUM] Officer deactivation, deletion and transfer do not revoke existing 90-day tokens

- **Prioritas:** P2 — sedang
- **Fingerprint:** `server.api.officer-deactivation-token-not-revoked`
- **Lokasi utama:** `server/api/handlers/officers.ts:438` (updateOfficerStatus)
- **Akar masalah:** Authorization uses immutable login-time claims and never reconciles with mutable officer state (is_active, existence, region_id).
- **Dampak terbukti:** Continued trip/cancellation writes and old-region reads for a deactivated or transferred officer, without gaining admin privilege.
- **Korban/sumber terdampak:** Deactivated or transferred officer replaying a stored, unexpired officer Bearer token
- **Hasil observasi:** Source shows verifyToken enforcing only HMAC+exp and the write handlers reaching a successful trips/trip_cancellations insert without any is_active check; getTrips filters on the token's stale region claim.
- **Perbaikan:** Re-check is_active, officer existence and current region_id on every authenticated request (or add a revocation/token-version claim and shorten TTL) before authorizing trip writes and reads.
- **File perbaikan:** `server/api/_shared.ts`
- **Verifikasi:** source review (auth revalidates officer state)

### 8. [MEDIUM] Region-scoped GET /master/tariffs cached under region-agnostic key

- **Prioritas:** P2 — sedang
- **Fingerprint:** `server/api/index.ts/cache-key-omits-region-claim`
- **Lokasi utama:** `server/api/index.ts:680` (cache setup)
- **Akar masalah:** The HTTP cache key omits a first-class identity input (the officer's region claim) that changes the cached representation.
- **Dampak terbukti:** Cross-region disclosure of tariff rows and wrong vehicle pricing on billing; no credentials, admin data, or writes are exposed.
- **Korban/sumber terdampak:** Officer in region B issuing GET /master/tariffs after an officer in region A has populated the shared cache entry
- **Hasil observasi:** Both requests produce the identical key 'officer|/master/tariffs'; the HIT response bypasses the handler and returns the other region's tariff rows.
- **Perbaikan:** Include the officer's region/tenant identity in the HTTP cache key (or in cacheScope) so cached representations are partitioned per region; alternatively exclude /master/tariffs from HTTP caching.
- **File perbaikan:** `server/api/index.ts`
- **Verifikasi:** source review (cacheScope)

## 4. Needs validation (belum ada severitas)

Ini kandidat dengan trace source yang nyata tetapi blokernya berada di luar source/local evidence.
Jangan dianggap sebagai vulnerability confirmed; prioritas di bawah adalah prioritas **validasi**, bukan level severitas.

| Judul | Fingerprint | Trace utama | Blocker | Prioritas validasi |
|---|---|---|---|---|
| Native APK install bridge accepts unvalidated path under broad FileProvider roots | `apk-installer-fileprovider-overbroad-roots` | src/services/apkInstaller.ts:99 → android/app/src/main/java/com/plantation/tripangkut/ApkInstallerPlugin.java:56 → android/app/src/main/res/xml/file_paths.xml:12 | WebView/origin policy dan perilaku FileProvider di perangkat tidak source-visible; perlu emulator. | perlu validasi |
| Biometric step-up is not bound to acting officer on Android | `client-storage.biometric-stepup-not-bound-to-officer` | src/pages/mobile/TripSummaryScreen.tsx:163 → src/services/biometric.ts:104 → android/app/src/main/java/com/plantation/tripangkut/NativeBiometricPlugin.java:75 | Tidak ada emulator/SDK; enrollment sidik jari per perangkat di luar source. | perlu validasi |
| Server .env.local config git-tracked under .tmp-backup; secret liveness not source-observable | `obvious.committed-server-env-local-tmp-backup` | .tmp-backup/server/api/.env.local:1 → .gitignore:96 → server/api/.env.example:57 | Isi blob rahasia sengaja tidak dibaca; apakah kunci masih live tidak dapat dibuktikan. | perlu validasi |
| resolve-link follows redirects without revalidating the host | `server/api/handlers/geofences.ts/resolve-link-redirect-revalidation` | server/api/index.ts:172 → server/api/handlers/geofences.ts:124 → server/api/handlers/geofences.ts:130 | Perilaku redirect host allowlist dan reachability internal tidak source-visible. | perlu validasi |
| ZIP restore bounds compressed size but not expansion | `server/api/handlers/restoreMobile.ts/decompression-amplification` | server/api/handlers/restoreMobile.ts:316 → server/api/handlers/restoreMobile.ts:341 → server/api/handlers/restoreMobile.ts:711 | Deno/jszip tidak tersedia; limit memori dan supervisor recovery di luar source. | perlu validasi |
| Trip idempotency is client-controlled and non-atomic | `server/api/handlers/trips.ts/completeTrip-idempotency` | server/api/handlers/trips.ts:454 → server/api/handlers/trips.ts:58 → server/api/handlers/trips.ts:513 | Deno tidak ada; race konkuren tidak bisa direproduksi lokal. | perlu validasi |
| POST /trips/complete parses unbounded multipart before authentication | `server/api/handlers/trips.ts/completeTrip-multipart-unbounded` | server/api/handlers/trips.ts:454 → server/api/handlers/trips.ts:455 → server/api/handlers/trips.ts:465 | Deno tidak ada; body/proxy/cgroup limits di luar source. | perlu validasi |
| Offline ZIP export includes previous officer's synced trips | `src/services/exportDb.ts/stale-trip-cross-officer-export` | src/services/auth.ts:196 → src/services/exportDb.ts:188 → src/services/exportDb.ts:293 | Kebijakan pemakaian perangkat bersama dan konsumen ZIP tidak source-visible. | perlu validasi |

Rencana resolusi lengkap (local fixture dan owner-observed deployment check) ada di
`~/security-audit-skill/trip-angkutan/run-1/NEEDS-VALIDATION.md`.

## 5. Hardening dan pola positif

- Admin write handlers uniformly gate on requireAdmin; only the peer-owned ADMIN_AUTH_DISABLED default exposes them.
- Cleartext LAN transport is a documented design decision and no lower-trust endpoint-injection source exists.
- Tracked runtime SQLite DBs; legacy reset-officer-pins.sql known PIN; TLS optional and cleartext default.
- Content-Type-only photo trust; no magic-byte sniffing; no nosniff header on /files.
- Offline PIN hashes are weak but app data is OS-sandboxed with allowBackup=false, so no lower-trust reader established.
- Dermaga id accepted if it merely exists, without officer assignment check.
- FileProvider roots should be updated/; detached signature needed for update authenticity.
- Archive encryption passphrase is source-visible; resolvePhotoUrl scheme passthrough is defense-in-depth; import upserts arbitrary rows.
- clearAllTrips defined but unused; offline PIN hashes unsalted SHA-256/FNV; admin default credential in client source.
- Non-constant-time HMAC compare; no exp type/nbf/iss/aud validation; weak PIN minimum on update; username enumeration; non-transactional delete; CORS wildcard default.
- Pola positif: value PostgREST diparameterisasi; containment guard pada path objek; nama foto generated + allowlist MIME; XLSX memakai `inlineStr` tanpa formula; `withCors` menghapus kredensial pada wildcard; algoritma JWT dipin; tidak ada cookie, `eval`, shell-string injection, atau endpoint debug produksi.

## 6. Cakupan dan keterbatasan

- 45 unit coverage: 18 covered, 16 candidate (masing-masing sudah memperoleh keputusan independen), 11 deferred.
- Audit **partial**: final coverage critic tidak kembali clean; 11 unit diberi status deferred setelah early stop karena keterbatasan resource. Ini bukan bukti bahwa area tersebut aman.
- 16 kandidat divalidasi independen di Phase 3; 16 record final diverifikasi ulang di Phase 5; tidak ada replacement.
- 8 needs-validation masih terbuka dan tidak diberi severitas.

## 7. Catatan operasional setelah perbaikan

- `ADMIN_AUTH_DISABLED` kini default `0`; request tanpa token bukan lagi admin. `restart.sh` menghasilkan `ADMIN_PASSWORD` saat bootstrap bila kosong.
- `PUBLISH_SECRET` wajib dan tidak punya fallback source; `restart.sh` menghasilkan nilainya bila kosong. Salin ke mesin publisher sebagai `PUBLISH_SECRET`/`--secret`.
- `scripts/publish-apk.mjs` sekarang memerlukan `--token`/`ADMIN_TOKEN` dan `--secret`/`PUBLISH_SECRET`.
- Publish hanya menerima `apkBase64`; rilis lama tanpa `apk_hash` akan ditolak client dan harus dipublish ulang.
- PostgREST tidak lagi dipublish ke `127.0.0.1:3001`; akses dibatasi jaringan compose internal `backend`.
- Verifikasi lokal: `npm run lint` (0 error, 2 warning lama), `tsc --noEmit -p tsconfig.app.json`, `docker compose config --quiet`, regression test target pass. Full suite memiliki 3 kegagalan lama di `src/services/tripCancel.test.ts` yang tidak terkait perubahan ini.
