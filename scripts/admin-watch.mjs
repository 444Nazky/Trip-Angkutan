#!/usr/bin/env node
/**
 * Hot-reload Admin Dashboard (PHP :8000)
 * =================================================
 * Dashboard admin menyajikan build statis dari folder `www/` yang disalin ke
 * `admin-ci/` (dilayani `php -S localhost:8000`). Supaya perubahan kode langsung
 * tampil setelah refresh tanpa masalah cache:
 *
 *   1. `ng build --watch` → membangun ulang `www/` setiap file disimpan
 *   2. Sinkron otomatis    → file `www/` disalin ke `admin-ci/`, bundle basi
 *                            (main-*, styles-*, chunk-* lama) ikut dibersihkan
 *   3. `admin-ci/index.html` memakai nama file ber-hash unik + header no-store
 *      dari `index.php`, jadi refresh browser selalu mengambil versi terbaru
 *
 * Pemakaian:
 *   node scripts/admin-watch.mjs             # mode watch (jalan terus)
 *   node scripts/admin-watch.mjs --once      # build sekali + sinkron, lalu keluar
 *   node scripts/admin-watch.mjs --sync-only # hanya sinkronkan www → admin-ci
 */

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const WWW = path.join(ROOT, 'www')
const ADMIN = path.join(ROOT, 'admin-ci')

// File di admin-ci yang bukan hasil build dan tidak boleh tersentuh
const KEEP = new Set(['index.php', 'admin.log', '.gitkeep'])

const mode = process.argv.includes('--once')
  ? 'once'
  : process.argv.includes('--sync-only')
    ? 'sync-only'
    : 'watch'

const log = (msg) => console.log(`[admin-watch] ${msg}`)

/** Daftar semua file relatif di dalam dir (rekursif). */
function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listFiles(full, base, out)
    else out.push(path.relative(base, full))
  }
  return out
}

/** "Signature" build saat ini: nama file + ukuran + mtime. */
function manifest() {
  const map = new Map()
  for (const rel of listFiles(WWW)) {
    const st = fs.statSync(path.join(WWW, rel))
    map.set(rel, `${st.size}:${st.mtimeMs}`)
  }
  return map
}

let lastSynced = new Map()

/** Salin www → admin-ci dan buang bundle yang sudah tidak dipakai. */
function sync() {
  if (!fs.existsSync(path.join(WWW, 'index.html'))) {
    log('www/ belum siap (index.html tidak ada) — sinkron dilewati')
    return false
  }

  const before = listFiles(ADMIN)
  fs.cpSync(WWW, ADMIN, { recursive: true, force: true })

  const keep = new Set(listFiles(WWW))
  let removed = 0
  for (const rel of before) {
    if (keep.has(rel) || KEEP.has(rel)) continue
    fs.rmSync(path.join(ADMIN, rel), { force: true })
    removed++
  }

  lastSynced = manifest()

  const mainJs = listFiles(ADMIN).find((f) => /^main-[A-Z0-9]+\.js$/.test(f))
  const stale = before.filter((f) => /^(main|styles|chunk)-/.test(f) && !keep.has(f))
  log(
    `tersinkron → admin-ci/ (${stale.length} bundle basi dibersihkan` +
      `${removed > stale.length ? `, ${removed - stale.length} file lama` : ''}` +
      `${mainJs ? `, aktif: ${mainJs}` : ''})`,
  )
  return true
}

/** Jalankan satu build (tanpa watch). */
function buildOnce() {
  log('build production → www/ ...')
  const res = spawnSync('npx', ['ng', 'build'], { cwd: ROOT, stdio: 'inherit' })
  if (res.status !== 0) {
    log('build GAGAL — sinkron dibatalkan agar admin-ci tidak rusak')
    process.exit(res.status ?? 1)
  }
}

if (mode === 'sync-only') {
  sync()
  process.exit(0)
}

if (mode === 'once') {
  buildOnce()
  sync()
  process.exit(0)
}

// ─── Mode watch ───────────────────────────────────────────────────────────────
buildOnce()
sync()
log('mode watch aktif — simpan file, build ulang & sinkron otomatis')

const child = spawn('npx', ['ng', 'build', '--watch'], {
  cwd: ROOT,
  stdio: ['ignore', 'inherit', 'inherit'],
})

// Polling manifest www/ (aman di Linux, tidak bergantung pada inotify)
let building = false
const timer = setInterval(() => {
  if (building) return
  let now
  try {
    now = manifest()
  } catch {
    return
  }
  if (now.size === 0) return
  if (now.size === lastSynced.size && [...now].every(([k, v]) => lastSynced.get(k) === v)) {
    return
  }
  // Tunggu sampai tulisan build selesai (ukuran stabil)
  building = true
  setTimeout(() => {
    try {
      sync()
    } catch (err) {
      log(`sinkron gagal: ${err.message}`)
    }
    building = false
  }, 600)
}, 800)

const stop = () => {
  clearInterval(timer)
  child.kill('SIGTERM')
  log('dihentikan')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => {
  clearInterval(timer)
  log(`ng build --watch berakhir (code ${code})`)
  process.exit(code ?? 0)
})
