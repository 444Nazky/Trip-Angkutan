# Project Guidelines - Trip Angkutan

## graphify Usage
- Untuk pertanyaan codebase, pertama jalan `graphify query "<pertanyaan>"` jika graphify-out/graph.json ada
- Pakai `graphify path "<A>" "<B>"` untuk relasi dan `graphify explain "<konsep>"` untuk konsep spesifik
- Setelah modifikasi code, jalan `graphify update .` agar graph selalu current

## CSS Variables - ATURAN KRITIS

### JANGAN GUNAKAN CSS VARIABLES YANG TIDAK TERDEFINISI
Sebelum pakai CSS variable di inline styles atau component CSS:
1. Selalu verifikasi variable tsb terdefinisi di global styles (index.html, global CSS files, atau Tailwind config)
2. Jika variable tidak terdefinisi, pakai nilai hardcoded sebagai ganti
3. Warna aman yang umum: `#3B82F6` (blue-500), `#10B981` (green-500), `#EF4444` (red-500)

### CSS Variables yang Aman
- Warna yang terdefinisi di Tailwind config aman dipakai lewat Tailwind classes
- CSS variables custom sebaiknya didefinisikan di `:root` atau di component styles

### File CSS yang Relevan untuk Chart/Graph Component
- `src/pages/admin/tabs/ReportsTab.tsx` - Lihat bagaimana grafik komposisi muatan pakai warna hardcoded `#3B82F6`
- Pola: bandingkan dengan file terkait untuk memastikan variable CSS dipakai dengan benar

### Setup Linter Otomatis
Untuk meminimalisir kesalahan serupa, setup pengecekan otomatis:
- Tambahkan script di `package.json` untuk memeriksa semua file TypeScript/TSX
- Cari semua instance `var(--` dalam inline styles dan verifikasi variable tersebut terdefinisi

---

### Penggunaan Emoji
- JANGAN pakai emoji di antarmuka UI
- Pakai teks biasa atau ikon dari lucide-react sebagai ganti

### Pemisah Teks
- Pakai `-` (strip) sebagai pemisah teks, bukan `·` (titik tengah)

### Navigasi Sidebar
- Kelola navigasi tab dengan benar: `AdminDashboard.tsx` mengelola tab berbeda (`reports`, `tariff`, dst.)
- Pastikan file component yang dimuat sesuai dengan tab yang dipilih
- Contoh: tab `reports` → `ReportsTab`, tab `tariff` → `TariffTab`

### Referensi File untuk Halaman Admin
- Halaman laporan utama: `src/pages/admin/ReportSheet.tsx`
- Komponen tab laporan: `src/pages/admin/tabs/ReportsTab.tsx`
- Tab master tarif: `src/pages/admin/tabs/TariffTab.tsx`

## Aset UI
### Logo SVG
- Logo admin: `admin-www/Assets/karyamasv.svg`
- Pastikan folder `assets/` atau `Assets/` ada dan berisi file yang dibutuhkan
- Update graphify setelah menambah/mengubah aset

## Checklist Sebelum Deploy
- Setiap kali ada perubahan frontend:
  1. Build: `npm run build`
  2. Copy ke admin-www: `cp -r www/* /path/to/admin-www/ && cp -r www/* /path/to/admin-ci/`
  3. Sinkronisasi ke direktori yang di-serve: pastikan file JS terupdate di `admin-www/assets/js/`
- Backend:
  - Deploy: `supabase functions deploy api --project-ref bmiruktfruunegtbydyw`

## Masalah Umum dan Solusi

### Masalah: Grafik/chart tidak tampil
- Cek apakah CSS variables yang dipakai di `conic-gradient`, `linear-gradient`, atau inline styles sudah terdefinisi
- Pakai browser DevTools untuk inspeksi elemen dan cek computed styles

### Masalah: Perubahan tidak muncul setelah deploy
- Clear browser cache (Ctrl+Shift+R atau Cmd+Shift+R)
- Cek apakah versi lama di-serve dari cache
- Verifikasi output build mengandung kode baru

### Masalah: TypeScript errors
- Jalankan `npx tsc --noEmit --skipLibCheck` untuk identifikasi masalah
- Pastikan semua definisi tipe sudah benar
