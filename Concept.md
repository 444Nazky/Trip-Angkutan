---
revisi: dalam bentuk ringkasan
date: 2026-09-29
---

### RINGKASAN EKSEKUTIF MASTER REVISI & ARSITEKTUR SISTEM TRIP ANGKUTAN

1. STRUKTUR WILAYAH, DERMAGA, & MASTER RUTE
- Badau (BADAU): Dermaga 1 (SJRE ⇄ SBDZ) | Dermaga 2 (AAAA ⇄ BBBB)
- Belitung (BELITUNG): Dermaga 1 (CCCC ⇄ DDDD) | Dermaga 2 (EEEE ⇄ FFFF)
- Kelapa Kampit (KELAPAKAMPIT): Dermaga 1 (GGGG ⇄ HHHH) | Dermaga 2 (IIII ⇄ JJJJ)
- Entikong (ENTIKONG): Dermaga 1 (A4A4 ⇄ B8B8) | Dermaga 2 (C3C3 ⇄ D6D6)
* Catatan: Nama rute dapat diubah secara dinamis melalui tab "Master Rute" di admin dashboard. Relasi disimpan di tabel dermagas + junction officer_dermagas.

2. ATURAN AKSES MOBILE & LOGIN
- Alur Autentikasi: Login langsung menggunakan kredensial akun petugas (tanpa login region terpisah). Tombol "Login as Administrator" telah dihapus dari antarmuka utama/mobile.
- Filter Rute (`GET /api/routes/mine`): Petugas hanya dapat melihat rute dari dermaga yang diaksesnya secara ketat. Trip kosong dikunci ke rute utama atau rute statis cadangan jika dermaga tak punya rute tersebut.
- Akses Ganda / Multi-Dermaga: Petugas dengan akses lebih dari satu dermaga (misal: Dewi Kusuma / Andi Pratama) akan melalui pop-up pemilihan dermaga (`POST /auth/select-dermaga`) sebelum masuk ke alur input trip.
- Switch Account & Logout: Tombol Ganti Akun di profil menggunakan filter ketat (Region SAMA + minimal 1 dermaga irisan). Menu Logout tersedia terpisah untuk keluar sesi secara penuh.

3. ANTARMUKA MOBILE (UI/UX)
- Tampilan Responsif & Desain Bingkai: Dioptimalkan untuk perangkat seluler, dengan bingkai pembatas 390px khusus tampilan desktop dan layar penuh di perangkat mobile sesungguhnya.
- Penghapusan Status Bar: Indikator jam, sinyal, dan wifi tiruan dihilangkan agar tampilan menyerupai aplikasi native.
- Area Aman Hero Section (`safe-area-inset`): Menggunakan padding proporsional (`calc(var(--ion-safe-area-top) + env(safe-area-inset-top) + 12px)`) agar tajuk biru tidak menabrak notch atau berjarak terlalu lebar.
- Animasi Transisi: Menghindari penggunaan efek fade berulang; digantikan dengan transisi stack standar yang responsif.
- Input Kendaraan: Diubah menjadi minimalis dengan 4 field utama yang wajib diisi lengkap (termasuk kategori external/internal/lokal) sebelum tombol simpan diaktifkan, serta menyertakan dokumentasi foto secara komprehensif.

4. ADMIN DASHBOARD & EKOSISTEM CLOUD
- Tampilan Minimalis & Kontras: Menggunakan latar belakang off-white (`bg-slate-50`) dengan kartu putih bergaris tepi tipis dan efek bayangan halus (`shadow-sm`) demi memperkuat hierarki visual.
- Tema & Kustomisasi Aksen: Warna biru dikembalikan sebagai default, disertai pilihan tema aksen (Biru, Hitam, Hijau, Ungu, Kuning) melalui tab Pengaturan. Seluruh emoji pada tombol/status diganti dengan ikon Lucide berbasis SVG.
- Sensor Nominal Keuangan (Ala DANA/OVO): Dilengkapi tombol global (ikon mata) di sebelah tombol foto untuk menyembunyikan/menampilkan seluruh nominal pendapatan secara serentak dengan satu kali klik (`***`).
- Pemecahan Kode & Struktur Modular: File `AdminDashboard.tsx` dipecah ke dalam modul-modul kecil (tab terpisah dan komponen tersendiri) agar setiap file berada di bawah 500 baris kode.
- Pemusatan Konfigurasi Tarif: Pengaturan tarif terpusat dipindahkan dari halaman Master Plat ke halaman Master Tarif.
- Foto Dokumentasi & Ekspor Live: Admin kini dapat melihat foto dokumentasi melalui modal interaktif yang selalu aktif. Tombol Ekspor Spreadsheet mengarah langsung ke lembar kerja live (`#/sheet`) yang tersinkronisasi otomatis setiap 15 detik tanpa repot unduh-impor manual.








lakukan inisiatif untuk improvisasi serta crosscheck semuanya, pastikan berjalan lancar