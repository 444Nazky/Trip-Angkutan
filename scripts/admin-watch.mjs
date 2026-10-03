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

// Assets yang perlu di-copy dari root project
const ASSETS_TO_COPY = ['Assets/karyamasv.svg']

const mode = process.argv.includes('--once')
  ? 'once'
  : process.argv.includes('--sync-only')
    ? 'sync-only'
    : 'watch'

const log = (msg) => console.log(`[admin-watch] ${msg}`)

/**
 * Jaminan anti-cache untuk entry point admin.
 *
 * `admin-ci/index.php` kadang ter-overwrite oleh buffer editor lama sehingga
 * header no-cache hilang dan refresh bisa menyajikan bundle basi. Fungsi ini
 * menaruh blok header kembali secara otomatis setiap sinkronisasi.
 */
const NO_CACHE_BLOCK = `
    // Hot-reload: index.html tidak boleh di-cache browser, supaya refresh
    // selalu memuat bundle terbaru (nama file ber-hash berubah tiap build)
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
    header('Pragma: no-cache');
    header('Expires: 0');`

function ensureNoCacheHeader() {
  const entry = path.join(ADMIN, 'index.php')
  if (!fs.existsSync(entry)) return
  let src = fs.readFileSync(entry, 'utf8')
  if (src.includes('Cache-Control: no-store')) return
  const anchor = "header('Content-Type: text/html; charset=utf-8');"
  if (!src.includes(anchor)) return
  src = src.replace(anchor, anchor + NO_CACHE_BLOCK)
  fs.writeFileSync(entry, src)
  log('header no-cache index.php dipulihkan')
}

/**
 * Auto-refresh: sisipkan klien kecil ke `admin-ci/index.html` yang menyalakan
 * ulang halaman begitu build berubah (dicek tiap 2 detik terhadap bundle yang
 * sedang tampil). Hanya dipasang di build admin — aplikasi mobile memakai
 * HMR/live-reload bawaan `ng serve`.
 * Kalau sedang mengetik di kolom form, refresh diganti tombol pengingat dulu.
 */
const LIVE_RELOAD_SNIPPET = (bundle) => `
<script id="__ADMIN_LIVE_RELOAD__">/* auto-refresh admin saat build berubah */
(function(){
  if(!document.documentElement.hasAttribute('data-admin'))return;
  var cur=${JSON.stringify(bundle)};
  function busy(){var a=document.activeElement;return a&&(a.tagName==='INPUT'||a.tagName==='TEXTAREA'||a.isContentEditable)}
  function hint(){if(document.getElementById('__lr'))return;var b=document.createElement('button');b.id='__lr';b.textContent='Build baru — klik untuk refresh';b.style.cssText='position:fixed;right:16px;bottom:16px;z-index:9999;background:#0f172a;color:#fff;font:600 12px system-ui;padding:10px 14px;border-radius:999px;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer;border:0';b.onclick=function(){location.reload()};document.body&&document.body.appendChild(b)}
  setInterval(function(){
    window.__AR_TICK=(window.__AR_TICK||0)+1;
    fetch('/?_='+Date.now(),{cache:'no-store'}).then(function(r){return r.text()}).then(function(t){
      var m=t.match(/main-[A-Z0-9]+\.js/); if(!m||m[0]===cur)return;
      window.__AR_SEEN=m[0];
      if(document.getElementById('__lr'))return;
      busy()?hint():location.reload();
    }).catch(function(){});
  },2000);
})();
</script>`

function ensureLiveReload() {
  // Disisipkan ke www/index.html (sumber salinan) supaya ikut terkopi ke
  // admin-ci dalam satu langkah — tanpa jendela race antar tulis file.
  const file = path.join(WWW, 'index.html')
  if (!fs.existsSync(file)) return
  let html = fs.readFileSync(file, 'utf8')
  if (html.includes('__ADMIN_LIVE_RELOAD__')) return
  const bundle = html.match(/main-[A-Z0-9]+\.js/)?.[0] || ''
  if (!bundle) return
  html = html.includes('</head>')
    ? html.replace('</head>', `${LIVE_RELOAD_SNIPPET(bundle)}\n</head>`)
    : html + LIVE_RELOAD_SNIPPET(bundle)
  fs.writeFileSync(file, html)
  log('klien auto-refresh dipasang')
}

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
  ensureLiveReload()
  fs.cpSync(WWW, ADMIN, { recursive: true, force: true })
  ensureNoCacheHeader()

  // Copy assets from root project
  for (const asset of ASSETS_TO_COPY) {
    const src = path.join(ROOT, asset)
    const dst = path.join(ADMIN, asset)
    if (fs.existsSync(src)) {
      const dir = path.dirname(dst)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      fs.copyFileSync(src, dst)
    }
  }

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
