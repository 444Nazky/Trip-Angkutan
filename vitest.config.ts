import { defineConfig } from 'vitest/config'

/**
 * Konfigurasi unit test (Vitest) — Trip Angkutan.
 *
 * `ng test` (Angular/Karma) TIDAK dipakai untuk test ini; jalankan dengan:
 *   npm run test:unit        → vitest run (sekali jalan, untuk CI)
 *   npm run test:unit:watch  → vitest (mode watch)
 *
 * environment jsdom dipakai karena modul yang diuji (services/sync.ts)
 * membutuhkan localStorage, window, FormData, dan fetch/Blob.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    // Pasang localStorage jsdom (lihat vitest.setup.ts) sebelum modul diuji
    setupFiles: ['./vitest.setup.ts'],
    // File test tidak boleh menggantung: batasi waktu per test.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
})
