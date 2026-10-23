# Handover — Server Intranet Harus Berjalan di Ubuntu `192.168.1.123`

**Untuk:** agen / operator yang bekerja di **PC kantor (Ubuntu, `servernazky`)** — `192.168.1.123`
**Dari:** sesi di **blackarch (`444Nazky`)** — `192.168.1.2`
**Tanggal:** 2026-10-23
**Konteks insiden:** `docs/NETWORK-INCIDENT-2026-10-23.md`

---

## 1. Yang diminta

Tiga port produksi harus **dilayani dari Ubuntu `192.168.1.123`** dan hanya dari sana:

| Port | Layanan | URL yang dipakai petugas |
|------|---------|--------------------------|
| 8000 | Admin Dashboard | `http://192.168.1.123:8000` |
| 5173 | Mobile Client | `http://192.168.1.123:5173` |
| 3000 | Backend Intranet (API) | `http://192.168.1.123:3000/api` |

Blackarch `192.168.1.2` **tidak boleh** lagi menjadi server. Saat ini di `.2` juga ada
stack Docker yang membuka ketiga port tersebut (duplikat), dan itu menimbulkan dua
sumber data/instance yang berbeda.

## 2. Bukti terakhir (diukur dari `.2` pada 2026-10-23)

```
MAC NIC blackarch (.2)   : a8:2b:dd:e6:eb:fb
MAC ARP  .123            : 8c:ec:4b:c3:eb:a2      <- host fisik berbeda

http://192.168.1.123:8000/        -> 200
http://192.168.1.123:5173/        -> 200
http://192.168.1.123:3000/api/health -> 200 {"mode":"intranet", ...}

# blackarch juga bind 0.0.0.0 pada port yang sama:
127.0.0.1:8000 -> 200   (docker-proxy)
127.0.0.1:5173 -> 200   (docker-proxy)
127.0.0.1:3000 -> 200   {"instance":"4942d7b7-..."}   <- API berbeda dari .123
```

Artinya: **sisi Ubuntu sudah hidup dan menjawab dari LAN** (bukan `127.0.0.1`).
Yang belum beres hanya soal *otoritas* — dua mesin sama-sama melayani port yang sama.

## 3. Langkah di Ubuntu `192.168.1.123` (jalankan di mesin itu)

```bash
cd <folder-deploy-ubuntu>            # clone git repo ini di PC kantor
git fetch --all && git log --oneline -5
# HEAD harus sudah memuat commit ini (dual endpoint + validasi endpoint):
#   38b8346 feat: dual endpoint (Supabase cloud + intranet LAN) + backend API intranet :3000
#   e59f943 fix(api): satukan validasi endpoint dan perbaiki probe CORS

# 1) konfigurasi API intranet (wajib ada, boleh ada nilai kosong saat uji)
ls -l supabase/functions/api/.env.local || \
  cp supabase/functions/api/.env.example supabase/functions/api/.env.local
# isi minimal: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET

# 2) bangun ulang (bukan cuma restart) supaya kode baru masuk image
docker compose up -d --build
docker compose ps

# 3) pastikan binding publik, bukan 127.0.0.1
ss -tlnH | grep -E ':(8000|5173|3000)\b'

# 4) IP & firewall
ip -4 addr show dev eno1        # harus 192.168.1.123
sudo ufw status                 # inactive, atau allow 8000/5173/3000

# 5) bukti siap ditempel balik
./scripts/diagnose-lan-connectivity.sh
curl -s http://192.168.1.123:3000/api/health
```

Kriteria lulus:

- `ss` menampilkan `0.0.0.0:8000`, `0.0.0.0:5173`, `0.0.0.0:3000` (bukan `127.0.0.1:`).
- `docker compose ps` → tiga container `Up` (`trip-web`, `trip-api`).
- Ketiga `curl` dari luar host → 200, dan `/api/health` berisi `"mode":"intranet"`.
- `restart-all-ubuntu.sh` selesai tanpa error (script memverifikasi ketiga port
  lewat `wait_http`; path health yang dipakai `/api/health` dan memang 200).

## 4. Setelah Ubuntu siap — matikan duplikat di blackarch `192.168.1.2`

Dijalankan oleh pemilik `.2` (butuh sudo; sesi ini tidak punya akses docker/sudo):

```bash
sudo docker stop trip-web trip-api     # restart: unless-stopped -> tetap mati
sudo ss -tlnH | grep -E ':(8000|5173|3000)\b'   # harus kosong
```

Jangan jalankan `docker compose up` di `.2` lagi. Kalau butuh API untuk pengujian
lokal, pakai port lain (mis. `PORT=3996`) dan jangan pakai 3000/8000/5173.

## 5. Yang harus dilaporkan balik

Tempel di komentar commit / doc ini:

1. `hostname` + `hostname -I` mesin Ubuntu.
2. `docker compose ps`.
3. Output `./scripts/diagnose-lan-connectivity.sh`.
4. Body `curl -s http://192.168.1.123:3000/api/health`.
5. Apakah `sudo ufw status` inactive atau ada rule allow.
