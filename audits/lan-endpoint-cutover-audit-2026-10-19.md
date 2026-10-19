# 🌐 Audit — Cutover Endpoint LAN ke `192.168.1.124` (Jaringan Kantor)

**Tanggal:** 2026-10-19
**Cakupan:** mobile (`Aplikasi-Trip-Main Branch`), backend (`Aplikasi-Trip-Main Branch/backend`),
admin dashboard (`Trip-Dashboard Admin Branch` → `Aplikasi-Trip-Main Branch/admin-ci`),
runner `start-services.sh`, APK rilis
**Status:** ⚠️ **KODE & KONFIGURASI SIAP — RUNTIME SERVER BELUM AKTIF** (lihat §4)

---

## 1. Konfigurasi baru

| Layanan | Alamat |
|---------|--------|
| Backend API | `http://192.168.1.124:3000` |
| Mobile client | `http://192.168.1.124:5173` |
| Admin dashboard | `http://192.168.1.124:8000` |

Semua layanan listen di `0.0.0.0` supaya bisa diakses perangkat lain di jaringan yang sama.

## 2. Perubahan berkas

| Berkas | Perubahan |
|--------|-----------|
| `src/environments/environment.ts` | `apiBaseUrl` → `http://192.168.1.124:3000/api` (dulu Railway) |
| `src/environments/environment.prod.ts` | idem — nilai ini yang tertanam di APK rilis |
| `src/services/api.ts` | kandidat auto-deteksi: `LAN Wi-Fi (192.168.1.124)` jadi kandidat **pertama**; Railway tetap cadangan; kandidat laptop/emulator dipertahankan |
| `backend/src/index.js` | `DEV_ORIGINS` + `http://192.168.1.124:{5173,8000,3000}`; **`PRIVATE_LAN_ORIGIN`** — seluruh rentang privat RFC1918 (`10.x`, `192.168.x`, `172.16-31.x`) diizinkan di port berapa pun (lihat §3a) |
| `backend/.env.example` | `PORT=3000` + contoh `CORS_ORIGIN` tiga origin LAN |
| `Trip-Dashboard Admin Branch/src/environments/environment.ts` | `apiBaseUrl` → `http://192.168.1.124:3000/api` |
| `Trip-Dashboard Admin Branch/src/services/api.ts` | kandidat `LAN 192.168.1.124` (dulu `10.187.220.110`) |
| `admin-ci/` | bundle dibangun ulang dari sumber di atas |
| `start-services.sh` (root + salinan) | IP target, path `Aplikasi-Trip-Main Branch`, verifikasi berulang, cek jalur petugas |
| `.gitignore` | `android/keystore.properties`, `*.keystore` |
| `src/services/serverUrl.test.ts`, `Trip-Dashboard Admin Branch/src/services/api.test.ts` | asersi auto-deteksi diselaraskan (kandidat LAN kini pertama) + isolasi kunci cache antar-tes |

## 3. Bukti verifikasi (dijalankan, bukan asumsi)

| Uji | Perintah inti | Hasil |
|-----|---------------|-------|
| Runner menyalakan tiga layanan | `bash start-services.sh` | `API: OK`, `Mobile: OK`, `Admin: OK` |
| Binding jaringan | `ss -ltn` | `0.0.0.0:3000`, `0.0.0.0:5173`, `0.0.0.0:8000` |
| API hidup | `curl /api/health` | `{"status":"ok",...}` |
| CORS untuk klien LAN | `OPTIONS /api/trips` + `Origin: http://192.168.1.124:5173` dan `:8000` | `Access-Control-Allow-Origin` sesuai |
| Endpoint admin otomatis | `curl -H "Host: 192.168.1.124:8000" http://127.0.0.1:8000/` | HTTP 200, menyuntik `trip.admin.apiBaseUrl = http://192.168.1.124:3000/api`, bundle baru disajikan |
| Isi APK | `grep` seluruh isi APK | `production:!0,apiBaseUrl:\`http://192.168.1.124:3000/api\``; IP lama (`10.187.220.110`, `192.168.1.100`, `192.168.1.5`) **tidak ada** (exit=1) |
| Override tersembunyi | `grep __TRIP_API_BASE_URL__` | hanya *dibaca* `api.ts`, tidak ada yang men-set; tidak ada berkas `.env` |
| Tes unit mobile | `npm run test:unit` | 156/156 lulus |
| Tes unit admin | `npx vitest run` | 36/36 lulus |
| CORS seluruh rentang privat | preflight 8 origin (§3a) | privat lolos, origin publik/domain ditolak |

### 3a. Celah CORS yang ditemukan saat uji lewat IP LAN nyata

Uji runner lewat alamat LAN mesin klien (`http://192.168.1.2:5173` dan `:8000`) semula
**ditolak CORS**: allowlist hanya memuat `192.168.1.124`, sehingga dashboard/mobile yang dibuka
lewat IP LAN mana pun selain IP itu langsung gagal memanggil API (gejala klasik
“Server tidak merespon” padahal server hidup).

**Fix:** regex `PRIVATE_LAN_ORIGIN` untuk seluruh host privat RFC1918, apa pun port-nya.
Hasil preflight setelah fix:

| Origin | Respons |
|--------|---------|
| `http://192.168.1.2:5173` | diizinkan |
| `http://192.168.1.2:8000` | diizinkan |
| `http://192.168.1.124:5173` / `:8000` | diizinkan |
| `http://10.187.220.110:5173` | diizinkan |
| `https://evil.example.com` | **ditolak** (tanpa header ACAO) |
| `http://192.168.1.2.nip.io:5173` | **ditolak** — host harus berupa IP literal; domain/tunnel tetap wajib didaftarkan di `CORS_ORIGIN` |

**Artefak rilis:** `Aplikasi-Trip-v1.0.27-release.apk`
(16.290.958 byte, sha256 `a59bcc777030f07da11476293c4e5a86c84c60335005d5fd11838ec30884ccf9`),
`versionCode 29` / `versionName 1.0.27`, **ter-sign** `CN=Trip Angkutan`
(SHA-256 sertifikat `09f181c1c6fba02473345cfd515e49d0cc360c1dc6462eba7ddd3f72d4d3bce9`,
sama dengan rilis 1.0.26 → dapat dipasang menimpa tanpa uninstall).

## 4. Temuan jaringan — jalur ke `192.168.1.124` BELUM melayani

Diuji dari mesin klien `192.168.1.2` (NIC kabel, se-subnet dengan `.124`, jadi **tanpa** melewati NAT):

| Alamat | MAC (vendor) | TTL ICMP | TCP 3000 / 5173 / 8000 |
|--------|--------------|----------|------------------------|
| `192.168.1.1` | `24:f5:a2:3e:e5:80` — **Belkin/Linksys** (halaman admin :80 → HTTP 200) | 64 | tertutup |
| `192.168.1.124` | `8c:ec:4b:c3:eb:a2` — **Dell Inc.** | 64 | **tertutup** (RST dalam 0 ms) |
| `192.168.1.2` (mesin klien) | — | — | terbuka saat runner jalan |

Catatan penting: **`192.168.1.124` adalah PC Dell (server kantor), bukan router.** Router/jembatan
ada di `192.168.1.1` (Belkin/Linksys). Jadi "port forwarding ke `192.168.1.124`" memang
mengarah ke PC server — arah konfigurasinya benar.

Karena klien se-LAN terhubung **langsung** ke `.124` (bukan lewat router), status RST instan itu
datang dari PC Dell sendiri: **tidak ada yang listen di ketiga port**. Diuji juga saat runner
menyalakan ketiga layanan di mesin klien — `.124` tetap tertutup, sehingga tidak ada bukti
bahwa PC server sedang melayani.

**Kesimpulan:** konfigurasi port forwarding di Linksys bisa saja sudah benar, tetapi belum
menghasilkan koneksi karena layanan di PC `192.168.1.124` belum berjalan (atau terhalang
firewall — perlu dipastikan; RST instan lebih menunjuk ke "tidak ada listener").

## 5. Kesiapan runner `start-services.sh` (sisi kode)

| Item | Status |
|------|--------|
| Listen `0.0.0.0` untuk ketiga layanan | ✅ terverifikasi |
| `JWT_SECRET` lokal otomatis bila belum di-set (backend menolak start tanpa itu) | ✅ |
| Mobile dijalankan `npm start -- --host 0.0.0.0 --port 5173` (entry `src/index.html`) | ✅ |
| Admin `php -S 0.0.0.0:8000` dari `admin-ci/` | ✅ |
| Verifikasi menunggu kesiapan (bukan tebak 2 detik) | ✅ |
| Deteksi apakah `192.168.1.124` benar-benar melayani + pesan perbaikan bila tidak | ✅ |

Yang **belum** bisa diverifikasi dari sini: runner dijalankan di PC kantor itu sendiri
(`192.168.1.124`), termasuk kecocokan `PROJECT_DIR=/home/nazky/RPL/Intern/...` dan
ketersediaan `node`, `npm`, `php` di sana.

## 6. Langkah berikutnya

1. Jalankan `bash start-services.sh` **di PC `192.168.1.124`** (server kantor); pastikan
   `PROJECT_DIR` di skrip sesuai letak repo di mesin itu.
2. Bila skrip sudah jalan tetapi port tetap tertutup: izinkan inbound TCP `3000`, `5173`,
   `8000` pada firewall PC tersebut (Windows Firewall / `ufw`) dan batasi binding ke
   `0.0.0.0` (sudah dilakukan kode).
3. Ulangi uji dari mesin lain: `curl http://192.168.1.124:3000/api/health`.
4. Perubahan konfigurasi ini masih **belum di-commit**; PC kantor akan mendapatkannya hanya
   setelah commit/push atau penyalinan manual (termasuk `admin-ci/` dan APK).
5. Untuk klien yang **se-LAN**, port forwarding sebenarnya tidak diperlukan; forward di
   Linksys baru berperan bagi klien dari sisi WAN (jaringan lain).
