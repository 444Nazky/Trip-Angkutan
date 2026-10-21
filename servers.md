# servers.md — Panduan untuk AI Agent di PC Kantor

Dokumen ini ditulis di laptop rumah dan di-push ke repo yang sama.
Aplikasi: **Trip Angkutan** — satu bundle: Admin dashboard (:8000) + Mobile officer (:5173), backend **Supabase Edge Function**.

---

## 1. Infrastruktur di PC kantor

- Repo: `/home/nazky/Trip-Angkutan` (remote: `github.com:444Nazky/Aplikasi-Trip-Ionic`, branch `main`)
- Docker dengan **legacy builder** (buildx tidak terpasang → `docker compose build` GAGAL.
  Abaikan warning `DEPRECATED: legacy builder` — itu normal).
- Jalankan aplikasi dengan script:
  ```bash
  cd /home/nazky/Trip-Angkutan
  ./restart-all.sh
  ```
  Script ini: auto `git pull` → `docker build -t trip-angkutan .` → `docker compose -f "/home/nazky/Trip-Angkutan/docker-compose.yml" up -d` → verifikasi curl.
- Server lokal PHP / `ng serve` / `php -S` sudah DEPRECATED — jangan dipakai lagi.
- Kalau butuh sudo dan tidak bisa, gunakan `pkexec`.
- Kompose butuh path ABSOLUT untuk `-f`; path relatif gagal karena sudo berubah cwd ke `/root`.

## 2. Sumber kebenaran (yang BUKAN di PC kantor)

- **Docker tidak pernah menerima kode dari remote.** Ia hanya membaca
  sumber dari folder tempat ia dijalankan. Kalau folder di PC kantor
  checkout commit lama, hasil build = kode lama. Tampilan begitu.
  Mesin laptop menghasilkan bundle `main-*.js` sendiri; PC kantor
  bisa menghasilkan hash beda — itu NORMAL, yang penting commit-nya sama.
- Semua perbaikan kode dibuat di laptop lalu di-push. PC kantor CUKUP:
  > `git pull` yang berhasil + `./restart-all.sh`
- **TUGAS DI PC KANTOR BUKAN MEMODIFIKASI KODE.**
  Jangan menyalin file `www/` secukupnya, jangan mengedit `src/`,
  `Dockerfile`, `nginx.conf`, `docker-compose.yml`, `supabase/`.

---

## 3. Masalah A — PC kantor masih menampilkan kode lama

Gejala: browser `http://192.168.1.123:8000` menampilkan **LOGIN MOBILE**
("Masuk - Gunakan ID Petugas dan PIN Anda") padahal harusnya **ADMIN DASHBOARD**.

Penyebab: repo di PC kantor checkout commit lama. Kode lama belum punya
pemisahan admin/mobile (atribut `data-admin` di index.html), jadi :8000 tampil versi mobile.

Perbaikan:
1. `cd /home/nazky/Trip-Angkutan && git pull origin main`
   (kalau ada perubahan lokal: `git stash` dulu)
2. Commit terakhir harus commit terbaru dari laptop. Kalau bingung, tanyakan
   nomor commit terbaru ke pengguna/laptop (`git log --oneline -1` di laptop).
3. `./restart-all.sh`
4. Verifikasi (TIDAK boleh gagal sebelum bilang selesai):
   ```bash
   curl -s http://localhost:8000 | grep -oE 'data-admin|Admin Trip Angkutan|main-[A-Za-z0-9_-]{8}\.js'
   ```
   Harus mampu menampilkan `data-admin` + `<title>Admin Trip Angkutan</title>`:
   pada hasill. Kalau mendefinisikan "Masuk - Gunakan ID Petugas" → masih kode lama →
   `git pull` belum sukses.
5. Browser harap menghidupkan pembaruan (`ctrl+shift+r`).

## 4. Masalah B — Dashboard admin tidak sinkron ke Supabase

Backend Supabase SEHAT, jangan coba memperbaiki servernya:
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api/health
# → 200
# CORS-nya `access-control-allow-origin: *` sehingga browser origin mana pun boleh
```

URL Supabase **dibake ke dalam bundle** dari `src/environments/environment.ts`
(`https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api`).

Penyebab umum di PC kantor (urutan cek):

1. **Kode lama ter-serve** (Lihat Masalah A dulu — diagnose sebelum menyetor Supabase).
   Bukti kode baru:
   ```bash
   BUNDLE=$(curl -s http://localhost:8000 | grep -oE 'main-[A-Za-z0-9_-]{8}\.js' | head -1)
   curl -s "http://localhost:8000/assets/js/$BUNDLE" > /tmp/b.js
   grep -c "bmiruktfruunegtbydyw" /tmp/b.js   # HARUS >= 1. 0 = kode lama!
   ```
2. **localStorage override** — aplikasi membolehkan override URL server via
   localStorage `trip.api.baseUrl` (fitur `ServerSettingsModal`). Kalau bekas
   pengaturan server lama (PHP/local dev) masih ada di **browser** PC kantor,
   semua request API mengarah ke server mati supabase tidak dipakai sama sekali.
   Perbaikan di **browser** (DevTools → Console, di halaman :8000):
   ```js
   localStorage.getItem('trip.api.baseUrl')
   // kalau isinya bukan null dan BUKAN
   // "https://bmiruktfruunegtbydyw.supabase.co/functions/v1/api":
   localStorage.removeItem('trip.api.baseUrl'); location.reload();
   ```
3. **Token admin basi** (kalau dashboard masuk tapi data 401/kosong):
   ```js
   localStorage.removeItem('trip.auth.token.v2'); localStorage.removeItem('trip.admin'); location.reload();
   ```
4. **PC kantor tidak bisa keluar internet** (kalau curl di terminal juga gagal):
   ini masalah jaringan, bukan kode — minta pengguna cek koneksi/diagnostik.

## 5. Aturan keras

- JANGAN ubah kode sumber, Supabase, atau container aktif di PC kantor.
- Semua "perbaikan" dipadukan dari: `git pull` + `./restart-all.sh` + bersih-bersih localStorage browser.
- Kalau `git pull` gagal karena kredensial → STOP, minta pengguna
  (`gh auth login` / SSH / personal access token) — jangan melanggar DURING.
- Laporkan setiap hasil langkah (output command) pada kumpulan log yang jelas.
