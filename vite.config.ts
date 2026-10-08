import { defineConfig } from 'vite'

/**
 * Konfigurasi Vite — Trip Angkutan.
 *
 * Penting: `ng serve` / `ng build` (Angular dev-server & application builder)
 * menyusun konfigurasi Vite/esbuild-nya SENDIRI dan TIDAK membaca file ini.
 * Polling hot-reload aplikasi mobile diatur lewat `architect.serve.options.poll`
 * di `angular.json` (1000 ms), diteruskan Angular ke `server.watch` Vite.
 *
 * ── Struktur output bundle (berlaku untuk SEMUA bundler) ──────────────────────
 * Hasil build dirapikan ke folder terpusat agar direktori root tidak berantakan:
 *
 *   www/
 *   ├── index.html            ← referensi ditulis ulang ke assets/js|css
 *   ├── sw.js                 ← service worker OTA (harus tetap di root)
 *   ├── assets/               ← aset statis (icon, gambar)
 *   │   ├── js/               ← chunk-*.js, main-*.js
 *   │   └── css/              ← styles-*.css, main-*.css
 *   └── ...
 *
 * Pipeline resmi: `npm run build` = `ng build && node scripts/organize-build.mjs`
 * (script pascabuild memindahkan chunk + memperbaiki href/src + memverifikasi
 * bahwa tidak ada referensi/rute impor dinamis yang putus → anti white-screen).
 *
 * Blok `build.rollupOptions` di bawah membuat `npx vite build` (jalur alternatif)
 * menghasilkan STRUKTUR YANG SAMA, sehingga jalur path referensi identik baik
 * dipakai Angular builder maupun Vite murni.
 */
export default defineConfig({
  server: {
    port: 5173,
    watch: {
      // Polling: file watcher sensitif di Linux (inotify kadang telat pada
      // bind-mount / filesystem tertentu), perubahan file tetap terdeteksi.
      usePolling: true,
      interval: 1000,
    },
  },
  preview: {
    port: 5173,
  },
  build: {
    // Aset tematik (icon/gambar) tetap di assets/ — sama seperti output Angular
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        // Entry & code-splitting → assets/js/
        entryFileNames: 'assets/js/[name]-[hash].js',
        chunkFileNames: 'assets/js/[name]-[hash].js',
        // CSS → assets/css/, aset lain (img/font) → assets/
        assetFileNames: (assetInfo: { names?: string[]; name?: string }) => {
          const name = assetInfo.names?.[0] ?? assetInfo.name ?? ''
          return name.endsWith('.css')
            ? 'assets/css/[name]-[hash][extname]'
            : 'assets/[name]-[hash][extname]'
        },
      },
    },
  },
})
