import { defineConfig } from 'vite'

/**
 * Konfigurasi Vite — Trip Angkutan.
 *
 * Penting: `ng serve` (Angular dev-server) menyusun konfigurasi Vite-nya
 * sendiri dan TIDAK membaca file ini. Polling hot-reload untuk aplikasi
 * mobile diatur lewat `architect.serve.options.poll` di `angular.json`
 * (1000 ms), yang diteruskan Angular ke `server.watch` Vite.
 *
 * File ini dipakai bila Vite dijalankan secara langsung (`npx vite preview`,
 * tool eksternal), supaya opsi watcher-nya tetap konsisten dengan Angular.
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
})
