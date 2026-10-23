# Deploy API Intranet ke `ubuntu.local` (192.168.1.123)

Status: **23 Okt 2026**. Server pusat kantor = `ubuntu.local` = `192.168.1.123`
(kabel LAN ke router Linksys `192.168.1.1`, port forwarding 8000/5173/3000).
Preset "Intranet Kantor" di aplikasi mobile mengarah ke `http://192.168.1.123:3000/api`.

## Kenapa dokumen ini perlu

`ubuntu.local` **tidak membuka SSH** (port 22 tertutup) dan `blackarch`
(host dev) tidak bisa mengirim berkas ke sana. Jadi langkah di bawah harus
dijalankan **orang yang sedang berada di depan `ubuntu.local`**.

Kalau hanya perlu tahu apakah sudah jalan, cek dari `blackarch`:

```bash
curl -s -m 5 http://192.168.1.123:3000/api/health   # harus balas JSON "status":"ok"
```

Kalau jawabannya `connection refused` -> API intranet belum jalan di sana.

## Kondisi saat dokumen ini dibuat

| Komponen | `ubuntu.local` (.123) | `blackarch` (.2) |
|----------|----------------------|------------------|
| Web admin `:8000` | ✅ bundle terbaru (fitur endpoint ada) | ✅ |
| Mobile `:5173` | ✅ | ✅ |
| API intranet `:3000` | ❌ **mati** (belum di-deploy) | ✅ (cadangan) |
| SSH masuk | ❌ port 22 tertutup | ✅ |

Jadi satu-satunya yang kurang adalah **container API di `ubuntu.local`**.

## Langkah (jalankan di `ubuntu.local`)

### 1. Ambil kode terbaru
```bash
cd <path-repo-di-ubuntu.local>
git pull origin main
```
Pastikan `Dockerfile.backend`, `supabase/functions/api/local_server.ts`, dan
service `api-intranet` di `docker-compose.yml` sudah ada.

### 2. Pasang secret
Secret sudah disiapkan di `blackarch` (file `~/trip-intranet-ubuntu.env`,
chmod 600). Salin ke `ubuntu.local` (USB / flashdisk / sabotase file sharing),
lalu di `ubuntu.local`:

```bash
mkdir -p supabase/functions/api
cp <file-yang-dicopy> supabase/functions/api/.env.secrets
chmod 600 supabase/functions/api/.env.secrets
```

Isinya 4 baris: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`,
`LAN_IP=192.168.1.123`.

> **Jangan** commit file ini. `.gitignore` sudah mengexclude `.env.local`
> dan `.env.secrets`.

Alternatif tanpa file: jalankan `./restart-all-ubuntu.sh` dan tempel nilainya
saat script bertanya (input disembunyikan).

### 3. Jalankan
```bash
./restart-all-ubuntu.sh
```
Script: pull -> build image web + image API -> bersihkan container lama ->
`docker compose up -d` -> health check 8000/5173/3000 -> cetak URL LAN.

### 4. Verifikasi (di `ubuntu.local` maupun dari `blackarch`)
```bash
curl -s http://192.168.1.123:3000/api/health
# {"status":"ok","version":"...","mode":"intranet",...}

docker ps | grep trip-api      # harus "Up", bukan "Exited"
docker logs trip-api | tail    # tidak boleh ada "PERINGATAN: JWT_SECRET kosong"
```

## Jebakan yang sudah pernah kejadian

1. **`JWT_SECRET` kosong** -> `Deno.env.get("JWT_SECRET") ?? default` tidak
   menangkap string kosong, kunci HMAC jadi 0 byte, `SubtleCrypto` melempar
   `Key length is zero`, dan **setiap** request auth-protected membalas **500**
   (bukan 401). Sudah diperbaiki di `_shared.ts` (pakai `||`). Kalau masih
   500, cek isi `.env.local` benar-benar punya baris `JWT_SECRET=<nilai>`.
2. **`JWT_SECRET` intranet harus sama persis dengan Supabase.** Kalau beda,
   token yang issued cloud tidak valid di intranet -> petugas tampak login
   sukses lalu langsung "session expired". Kalau secret cloud tidak diketahui,
   set yang baru di kedua sisi:
   ```bash
   supabase secrets set JWT_SECRET=<nilai-acak-panjang> --project-ref bmiruktfruunegtbydyw
   ```
   (Edge Runtime langsung memakai nilai baru tanpa perlu deploy ulang, tapi
   token lama jadi tidak valid -> petugas harus login ulang.)
3. **`deno cache` tidak menerima flag izin** (`--allow-net` dst). Perintah
   yang benar: `deno cache --node-modules-dir=none api/local_server.ts`.
   Kalau cache kosong, container mengunduh dependency saat start (lambat).
4. **`--node-modules-dir=none` wajib** di CMD, kalau tidak Deno membaca
   `package.json` repo dan gagal: `Could not find a matching package for
   'npm:bcryptjs@2.4.3'`.
5. **`supabase/functions/api/.env.local` tidak boleh ikut build context.**
   `.dockerignore` sudah mengecualikannya.
6. **Jangan menambah alias `192.168.1.123` di `blackarch`** - alamat itu
   milik `ubuntu.local`; duplikat IP bikin `.123` tidak terjangkau.

## Kalau `ubuntu.local` memang tidak mau dipakai

Alternatifnya pindahkan `blackarch` jadi `192.168.1.123` **setelah**
`ubuntu.local` dimatikan dari jaringan, lalu ubah preset di
`src/environments/environment.ts` + `environment.prod.ts` (nilainya sudah
benar untuk kedua skenario karena address-nya tetap `.123`).
