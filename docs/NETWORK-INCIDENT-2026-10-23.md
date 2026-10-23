# Laporan Insiden Jaringan — Perangkat Mobile Gagal Mengakses Server Intranet

**Tanggal:** 2026-10-23
**Host:** `ubuntu` (PC kantor, iface LAN `eno1`)
**Target yang gagal:** `http://192.168.1.123:8000` (Admin Dashboard) dari perangkat mobile
**Tujuan lanjutan:** backend intranet `http://192.168.1.123:3000/api` (API Edge Function)

---

## 0. TEMUAN PENTING — ada DUA clone repo, yang dideploy bukan yang dikerjakan

Ini yang membuat build di terminal terlihat "berhasil" padahal perbaikannya
tidak masuk ke server.

| Peran | Path | Commit | Isi |
|-------|------|--------|-----|
| Repo workspace (tempat kita bekerja) | `/home/nazky/.coord/repos/<id>/Trip-Angkutan` | `0bbe6d2` + perubahan belum di-commit | ✅ dual-endpoint, `Dockerfile.backend`, `api-intranet`, perbaikan `.dockerignore` |
| **Folder deploy server** | **`/home/nazky/Trip-Angkutan`** | `0bbe6d2` | ❌ `docker-compose.yml` lama (tanpa `api-intranet`, port implisit), **tidak ada** `Dockerfile.backend`, **tidak ada** `local_server.ts`, **tidak ada** `.env.example` |

Keduanya clone dari GitHub yang sama (`github.com/444Nazky/Trip-Angkutan.git`),
tetapi **perubahan kita belum di-push ke `origin/main`**, jadi
`./restart-all-ubuntu.sh` yang Anda jalankan di `~/Trip-Angkutan` membangun
**kode lama**. Build-nya sukses dan image-nya tetap `93576c63f007` — makanya
tidak ada yang berubah.

**Cara sinkron** (sudah disiapkan, tanpa menyentuh GitHub):

```bash
./scripts/deploy-to-office-server.sh --dry-run   # lihat apa yang akan berubah
./scripts/deploy-to-office-server.sh             # backup + rsync + restart
```

Script ini: backup `~/Trip-Angkutan` → `~/Trip-Angkutan.bak.<timestamp>`,
lalu `rsync` (exclude `.git`, `node_modules`, `.env.local`) dari repo workspace
ke folder deploy, lalu menjalankan `restart-all-ubuntu.sh` di sana.

> Alternatif: commit + push ke `origin/main`, lalu `git pull` di
> `~/Trip-Angkutan` — lebih "kebersihan" tapi menyentuh remote bersama.

**Ingat:** `.env.local` **tidak** ikut ter-sync (sengaja dikecualikan, sudah
`chmod 600` dan gitignored). Setelah sync, secret
`SUPABASE_SERVICE_ROLE_KEY` + `JWT_SECRET` harus diisi **manual** di
`/home/nazky/Trip-Angkutan/supabase/functions/api/.env.local`.

---

## 1. Ringkasan Eksekutif

Semua **pemeriksaan sisi server lulus**. Port 8000 dan 5173 sudah `bind` ke
`0.0.0.0`, nginx di dalam container merespons `HTTP 200` baik lewat
`localhost` maupun lewat IP LAN `192.168.1.123`, dan semua asset JS/CSS/SVG
ter-load `200`. Firewall UFW memang nonaktif (`/etc/ufw/ufw.conf` →
`ENABLED=no`).

Artinya: **kerusakan berada di jalur jaringan antara HP dan server**, bukan di
aplikasi. Dari empat butir yang diminta, butir **(3) AP/Client Isolation** dan
**(4) perangkat mobile salah SSID / data seluler** adalah penyebab yang paling
mungkin, dan keduanya memang harus dikonfigurasi di router Linksys serta di
HP — bukan di server.

Selain itu ditemukan **dua cacat nyata di server** yang harus diperbaiki
(tepat satu sudah saya perbaiki):

| # | Temuan | Severity | Status |
|---|--------|----------|--------|
| A | IP `192.168.1.123` berstatus **DHCP (dynamic)** → bisa bergeser | Tinggi | ✅ Script siap (butuh sudo) |
| B | **Tidak ada listener di port 3000** — backend intranet belum pernah jalan | Tinggi | ⏳ Dikerjakan sesi paralel |
| C | `docker compose up` **gagal total** karena `env_file` `.env.local` hilang | Tinggi | ✅ Diperbaiki |
| D | Port `8000/5173/3000` ditulis tanpa prefix `0.0.0.0` (implisit, mudah keliru) | Rendah | ✅ Diperbaiki |

---

## 2. Butir (1) — Binding port docker-compose

**Status: LOLOS (dan sekarang ditulis eksplisit).**

Bukti:

```
$ docker ps --format '{{.Names}} -> {{.Ports}}'
trip-web -> 0.0.0.0:5173->5173/tcp, [::]:5173->5173/tcp,
           0.0.0.0:8000->8000/tcp, [::]:8000->8000/tcp

$ ss -tln | grep -E ':8000|:5173'
LISTEN 0 511 0.0.0.0:5173 0.0.0.0:*
LISTEN 0 511 0.0.0.0:8000 0.0.0.0:*
```

Perubahan yang saya buat di `docker-compose.yml` — port ditulis eksplisit ke
`0.0.0.0` supaya tidak pernah bisa terbalik jadi `127.0.0.1` di revisi
nanti:

```yaml
ports:
  - "0.0.0.0:8000:8000"
  - "0.0.0.0:5173:5173"
  # ...
  - "0.0.0.0:3000:3000"
```

Catatan: **service `web` (nginx) hanya mengekspos 8000 + 5173.** Kalau di masa
depan ada backend lain (mis. backend intranet versi non-Deno), port-nya harus
diberi baris `ports:` sendiri — tidak otomatis ikut ter-expose.

---

## 3. Butir (2) — Stabilitas IP Ubuntu

**Status: BELUM AMAN — masih DHCP.**

```
$ ip -4 addr show dev eno1
inet 192.168.1.123/24 brd 192.168.1.255 scope global dynamic noprefixroute eno1
                                   ^^^^^^^ dynamic = dari DHCP, bisa bergeser

$ ip route
default via 192.168.1.1 dev eno1 proto dhcp src 192.168.1.123 metric 20100
```

`192.168.1.123` saat ini memang **benar** (sudah dicek via HTTP 200 dan ping),
tetapi saat ini berstatus **DHCP** — sewaktu-waktu alamat ini bisa diberikan
perpindah ke perangkat lain, dan karena `192.168.1.123` adalah alamat yang
dicetak di konfigurasi HP, semua HP langsung kehilangan akses tanpa ada yang
berubah di server.

**Perbaikan:** `scripts/setup-static-ip-eno1.sh` (butuh `sudo`).

```bash
sudo ./scripts/setup-static-ip-eno1.sh
```

Script tersebut: mem-backup konfigurasi lama ke `/var/backups/trip-REQ/`,
mengubah profile NetworkManager `netplan-eno1` menjadi `ipv4.method manual`
dengan `192.168.1.123/24`, gateway `192.168.1.1`, DNS `192.168.1.1 8.8.8.8`,
sekaligus menulis `/etc/netplan/99-trip-REQ-eno1.yaml` supaya tetap berlaku
setelah reinstall/upgrade. Rollback tersedia:

```bash
sudo ./scripts/setup-static-ip-eno1.sh --rollback
```

> Jalankan lewat **konsol fisik**, bukan SSH murni — alamat IP bisa berubah di
> tengah proses dan koneksi SSH bisa putus.

---

## 4. Butir (3) — AP Isolation / Client Isolation di Router Linksys

**Status: INI PENYEBAB YANG PALING MUNGKIN — harus dikonfigurasi manual di router.**

### Bukti topologi

Router yang dipakai = **Linksys Smart Wi-Fi** di `192.168.1.1`
(MAC `24:F5:A2:3E:E5:80`, OUI Linksys/Cisco). Deteksi:

```
$ ip neigh show dev eno1
192.168.1.1 lladdr 24:f5:a2:3e:e5:80 REACHABLE

$ curl -s http://192.168.1.1/ | head -5
2017 Belkin International, Inc. and/or its affiliates. All rights reserved.
--> Linksys Smart Wi-Fi Router
```

SSID yang dipancarkan router ini (dari scan WiFi server):

| SSID | BSSID | Frekuensi | Catatan |
|------|-------|-----------|---------|
| **esteh bakar** | `24:F5:A2:3E:E5:81` | 2432 MHz (ch 5) | **SSID utama kantor** — router Linksys |
| — | — | — | **Tidak ada SSID 5 GHz** dari router ini |
| — | — | — | **Tidak ada SSID Guest yang menyala** |

Server tersambung ke router lewat **kabel LAN** (`eno1`), sedangkan HP
tersambung lewat **WiFi** — kombinasi persis yang paling sering dihantam
**Wireless Isolation**.

### Gejalanya persis cocok

Pada router Linksys Smart Wi-Fi, opsi **"Wireless Isolation"** (nama lama:
*AP Isolation* / *Client Isolation*, menu **Wireless Settings → Advanced**)
memblokir trafik antara:

*klien WiFi ↔ klien WiFi*, dan
*klien WiFi ↔ klien kabel (LAN)* ← **ini kasus kita**.

Kalau opsi ini nyala, HP bisa ping gateway `192.168.1.1` (router selalu boleh
dibujar), tapi `http://192.168.1.123:8000` **tidak akan pernah sampai** — dan
server pun **tidak akan melihat MAC HP sama sekali** di tabel ARP. Ini persis
sinyal yang akan dideteksi oleh skrip diagnosis di bawah.

### Langkah perbaikan di router

1. Buka `http://192.168.1.1` dari browser (PC yang terhubung kabel).
2. Login dengan **password admin router** (Linky Smart Wi-Fi → *Sign In*).
3. Menu **Wireless Settings** → **Advanced** (atau *Security* / *Client
   Isolation*, tergantung firmware).
4. Matikan **"Wireless Isolation"** / **"AP Isolation"** / **"Client
   Isolation"** untuk band 2.4 GHz (dan 5 GHz kalau ada).
5. **Simpan/Apply**, lalu putus-pasang WiFi HP supaya IP baru-RJAR negotiate
   ulang.
6. Pastikan **"Allow access to local network"** untuk **Guest Network** = ON,
   atau lebih aman: **matikan Guest Network** sepenuhnya.

### Bukti pendukung (sisi server)

`/etc/ufw/ufw.conf` → `ENABLED=no`, jadi UFW memang mati seperti diklaim.
Sisa aturan iptables mentah tidak bisa saya baca tanpa `sudo` — mohon jalankan
satu perintah ini untuk menutup celah terakhir:

```bash
sudo iptables -L -n -v && sudo ufw status verbose
```

---

## 5. Butir (4) — SSID utama vs Guest Network vs data seluler

**Status: perlu verifikasi di HP.**

Fakta yang sudah terpetakan:

* SSID utama kantor = **`esteh bakar`** (router Linksys `192.168.1.1`).
* **Tidak ada SSID Guest yang menyala** di surrounding → kemungkinan besar
  Guest Network memang tidak diaktifkan. Tapi bisa juga HP yang tersambung ke
  SSID Guest dengan nama berbeda — jadi pastikan.
* Server sendiri tersambung ke WiFi **lain**: `mister tuan p`
  (BSSID `CE:69:C2:3E:49:15`, IP `10.187.220.40/24`, gateway `10.187.220.99`).
  WiFi ini **bukan** router kantor.
* **Hanya 2 perangkat di LAN `192.168.1.0/24` saat pemeriksaan**: router
  (`192.168.1.1`) dan server (`192.168.1.123`). **Tidak ada satu pun perangkat
  mobile yang terhubung ke SSID utama** pada saat itu.

### Daftarkan pemeriksaan di HP (Android)

1. **Matikan data seluler / nonaktifkan "Auto-switch to mobile data"**
   (Android 12+: *Settings → Network & internet → SIMs → Auto-switching*).
   Kalau data seluler nyala, Android bisa otomatis pindah ke seluler saat
   WiFi "lemah" — dan `192.168.1.123` jelas tidak ada di jaringan seluler.
2. **Pastikan tersambung ke SSID `esteh bakar`**, bukan `mister tuan p`,
   bukan SSID Guest, bukan HP/LAP orang lain.
3. **Matikan "Private DNS" / "APN khusus"** kalau masih gagal.
4. Buka `http://192.168.1.123:8000` **dengan cellular data dimatikan total**.
5. Cek **IP HP** (Settings → About → Status → IP address). Harus `192.168.1.x`
   (bukan `10.187.220.x` dan bukan `192.168.1.x` dari segment lain).
   - Kalau muncul `10.x.x.x` → HP tidak di router kantor.
   - Kalau `169.254.x.x` → gagal dapat DHCP.
6. Dari HP, uji juga `http://192.168.1.1` (router). **Kalau router bisa
   dijawab tapi `192.168.1.123` tidak** → itu konfirmasi **Wireless
   Isolation** aktif.

### Perhatikan routing server (tidak blocking, tapi perlu diketahui)

```
default via 10.187.220.99 dev wlxd0374581f962 metric 600     ← internet lewat WiFi lain
default via 192.168.1.1  dev eno1                 metric 20100 ← LAN kantor
192.168.1.0/24 dev eno1 src 192.168.1.123 metric 100          ← jalur ke LAN
```

Trafik ke `192.168.1.0/24` **selalu** lewat `eno1` karena prefix-nya lebih
spesifik, jadi asymmetric routing **tidak** menjadi penyebab di sini. Yang
penting: backend intranet :3000 butuh **internet** untuk menjangkau Supabase,
dan jalur internet-nya lewat WiFi `mister tuan p` — pastikan WiFi itu tetap
nyala (server ini hanya punya satu jalur internet itu).

---

## 6. Temuan Tambahan — Backend Intranet Port 3000

Ini koreksi dari draf awal: **tidak ada satu pun listener di port 3000.**

```
$ ss -tln | grep 3000            # (kosong)
$ curl -m 4 http://192.168.1.123:3000/api/health
curl: (7) Failed to connect to 192.168.1.123 port 3000
```

Penyebabnya:

* Container `api-intranet` belum pernah di-build/run di mesin ini.
* `supabase/functions/api/.env.local` **tidak ada** → `docker compose config`
  **GAGAL TOTAL**, artinya perintah `docker compose up -d` apa pun akan gagal
  dan bisa menjatuhkan seluruh stack (web + admin).

**Yang sudah saya kerjakan:**

* Membuat `supabase/functions/api/.env.example` (ter.track di git) berisi
  seluruh env wajib: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`,
  `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `PORT`, `HOST`.
* Membuat `supabase/functions/api/.env.local` dari example tersebut
  (chmod 600, sudah masuk `.gitignore`) → `docker compose config` sekarang
  **lulus**.
* `Dockerfile.backend` + service `api-intranet` sudah ada di working tree
  (dikerjakan sesi paralel "server").

**Yang masih perlu diisi manusia** (kunci ini tidak ada di repo):

```bash
# isi di supabase/functions/api/.env.local
SUPABASE_SERVICE_ROLE_KEY=...   # Supabase Dashboard > Project Settings > API
JWT_SECRET=...                 # HARUS sama dengan Edge Function di Supabase
```

> `JWT_SECRET` wajib dicocokkan dengan yang dipakai Edge Function di Supabase.
> Kalau beda, token yang diterbitkan cloud tidak valid di intranet dan user
> akan terus ter-logout.

Koneksi server → Supabase sudah diverifikasi **OK**:
`https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/health` → `200`.

---

## 7. Alat Diagnosis Bukti

`scripts/diagnose-lan-connectivity.sh` — **tidak butuh root**, bisa dipakai
untuk membuktikan di mana jalur terputus.

```bash
# Snapshot kondisi server
./scripts/diagnose-lan-connectivity.sh

# Mode live: jalankan, lalu dari HP buka http://192.168.1.123:8000
./scripts/diagnose-lan-connectivity.sh --live
```

Cara membaca output mode live:

| Output | Arti | Tindakan |
|--------|------|----------|
| `PERANGKAT BARU DI LAN: 192.168.1.x lladdr <mac> ...` | Paket HP **sampai** ke server | Jaringan OK → masalah di layer aplikasi/captive portal. Cek juga URL & cache browser/service worker. |
| `TCP: koneksi masuk diterima ...` | SYN HP diterima, port 8000 terbuka | Jalur OK → server sudah melayani. |
| **Tidak ada baris sama sekali** | Trafik HP **tidak pernah sampai** | **Wireless Isolation aktif / HP di SSID lain / data seluler nyala.** |

Versi dengan durasi: `--live 120` (120 detik).

---

## 8. Checklist Tindakan (urutan)

**Sudah dikerjakan oleh saya:**

- [x] Verifikasi & pertegas binding `0.0.0.0` untuk 8000 / 5173 / 3000
- [x] Buat `.env.example` + `.env.local` agar `docker compose` tidak gagal
- [x] Skrip diagnosis konektivitas LAN (tanpa root)
- [x] Skrip setup IP statis `192.168.1.123` (dengan backup + rollback)
- [x] Verifikasi asset admin dashboard termuat 200 dari IP LAN

**Perlu privileges `sudo` (server):**

- [ ] `sudo ./scripts/setup-static-ip-eno1.sh` → kunci IP `192.168.1.123`
- [ ] `sudo iptables -L -n -v && sudo ufw status verbose` → pastikan tidak ada
      aturan iptables mentah yang memblokir (UFW sudah nonaktif, tapi rule
      manual bisa tetap ada)
- [ ] Isi `supabase/functions/api/.env.local` dengan `SUPABASE_SERVICE_ROLE_KEY`
      dan `JWT_SECRET`, lalu `docker compose up -d` dan pastikan port 3000 listen
- [ ] Verifikasi `ss -tln | grep 3000` dan
      `curl http://192.168.1.123:3000/api/health` → 200

**Perlu dilakukan di router Linksys (`http://192.168.1.1`):**

- [ ] **Wireless Settings → Advanced → matikan "Wireless Isolation" /
      "AP Isolation" / "Client Isolation"**
- [ ] Matikan **Guest Network**, atau pastikan "Allow access to local network"
      = ON
- [ ] Pastikan SSID utama = `esteh bakar` aktif dan tidak disembunyikan

**Perlu dilakukan di perangkat mobile:**

- [ ] Matikan **data seluler** (dan matikan auto-switch ke seluler)
- [ ] Connect ke SSID **`esteh bakar`**
- [ ] Cek IP HP = `192.168.1.x`
- [ ] Uji `http://192.168.1.1` (harus bisa) lalu `http://192.168.1.123:8000`
- [ ] Bila masih gagal, jalankan `./scripts/diagnose-lan-connectivity.sh --live`
      sambil mencoba membuka URL dari HP — hasilnya menentukan Isolation vs.
      SSID salah vs. data seluler.

---

## 9. Verifikasi Ulang (2026-10-23 09:10 WIB)

Pemeriksaan diulang langsung di host `ubuntu`. Hasilnya:

| Butir | Hasil terbaru | Bukti |
|-------|---------------|-------|
| (1) Binding docker | **LOLOS** | `trip-web -> 0.0.0.0:8000->8000/tcp, 0.0.0.0:5173->5173/tcp`; `curl http://192.168.1.123:8000/` → `200`, `:5173` → `200` |
| (2) IP statis | **BELUM PERSISTEN** — perlu `sudo` | `ip -4 addr` kini `valid_lft forever` (alamat manual), tetapi profile NetworkManager masih `ipv4.method: auto` dan `/etc/netplan/99-trip-REQ-eno1.yaml` **belum ada**; netplan masih DHCP sehingga reboot bisa mengembalikan alamat |
| (3) AP/Client Isolation | **Belum bisa dibuktikan dari server** | ARP `eno1` hanya berisi router `192.168.1.1`; belum ada HP di LAN saat pemeriksaan |
| (4) SSID / data seluler | **Perlu cek di HP** | Scan ulang: hanya `esteh bakar` (BSSID `24:F5:A2:3E:E5:81`, ch 5) milik Linksys; tidak ada SSID Guest yang menyala |
| UFW | **NONAKTIF (terkonfirmasi)** | `grep ^ENABLED /etc/ufw/ufw.conf` → `ENABLED=no` |
| Port 3000 | **MASIH TERTUTUP** | `ss -tln` tidak memuat `:3000`; `.env.local` ada tetapi `SUPABASE_SERVICE_ROLE_KEY` dan `JWT_SECRET` masih **kosong** |

Catatan penting soal (2): perubahan `nmcli` sempat diterapkan, tetapi profile
`netplan-eno1` yang dikelola netplan menulis ulang konfigurasi sehingga
`ipv4.method` kembali `auto`. Karena itu langkah `sudo` di bawah **wajib**
dijalankan agar IP benar-benar tidak meminta DHCP lagi (dan router tidak bisa
memberikan `.123` ke perangkat lain).

Alternatif tanpa mengubah server: buat **DHCP reservation** di Linksys untuk
MAC server `8C:EC:4B:C3:EB:A2` → `192.168.1.123`. Ini sama-sama mengunci IP.

Perintah yang tinggal dijalankan (butuh password sudo):

```bash
cd /home/nazky/.coord/repos/dae6f0e0-851d-4be9-8fcb-ce2ec3872abb/Trip-Angkutan
sudo ./scripts/setup-static-ip-eno1.sh
sudo iptables -L -n -v && sudo ufw status verbose
```

---

## 10. Lampiran — Perintah verifikasi cepat

```bash
# 1) Port & binding
ss -tln | grep -E ':8000|:5173|:3000'
docker ps --format '{{.Names}} -> {{.Ports}}'

# 2) HTTP dari IP LAN
for p in 8000 5173 3000; do
  curl -s -o /dev/null -m 4 -w "$p -> %{http_code}\n" "http://192.168.1.123:$p/"
done

# 3) Address & rute
ip -4 addr show dev eno1
ip route

# 4) Perangkat lain di LAN (per tweaked client isolation akan terlihat di sini)
ip neigh show dev eno1

# 5) SSID yang terlihat
nmcli -f BSSID,SSID,FREQ,SIGNAL device wifi list --rescan yes

# 6) Firewall
sudo ufw status verbose && sudo iptables -L -n -v
```
