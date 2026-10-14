#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────────────────
 * organize-build.mjs — Rapikan struktur hasil build ke folder terpusat.
 *
 * Latar: `ng build` (Angular application builder / esbuild) selalu menempatkan
 * chunk di ROOT www/ (chunk-*.js, main-*.js, styles-*.css) sehingga direktori
 * utama berantakan dan sulit dibedakan dari aset statis.
 *
 * Tugas script ini (dijalankan OTOMATIS setelah `ng build`):
 *   1. Pindahkan bundle JS  → www/assets/js/
 *   2. Pindahkan bundle CSS → www/assets/css/
 *   3. Tulis ulang referensi di www/index.html (href/src) ke jalur baru.
 *   4. VERIFIKASI: setiap referensi lokal di index.html & setiap impor dinamis
 *      `./chunk-*.js` harus menunjuk berkas yang benar-benar ada.
 *
 * MENGAPA AMAN untuk aplikasi mobile + OTA:
 *   • index.html tetap di root www → base href="/" & navigasi SW tetap sama.
 *   • SEMUA JS pindah SEKALIGUS (entry + chunk) → impor dinamis antar chunk
 *     memakai jalur RELATIF (`./chunk-x.js`) dan tetap valid karena berada di
 *     folder yang sama. Tidak ada satu pun string path di dalam JS yang perlu
 *     diubah → tidak ada risiko white screen akibat rewrite keliru.
 *   • CSS tidak punya `url(...)` lokal (semua data:/https) → aman dipindah.
 *   • version.json (OTA) dibuat dari isi www SETELAH script ini jalan, sehingga
 *     manifest selalu konsisten dengan struktur di lapangan.
 *
 * Script IDEMPOTEN: dijalankan ulang tidak menggandakan apa pun.
 * Gagal verifikasi → exit 1 (build gagal keras, jangan deploy bundle rusak).
 * ──────────────────────────────────────────────────────────────────────────── */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WWW = path.join(ROOT, 'www')

const JS_OUT = path.join('assets', 'js')
const CSS_OUT = path.join('assets', 'css')

/** Nama bundle yang dikeluarkan Angular/esbuild di root www. */
const BUNDLE_JS = /^(?:chunk|main)-[\w-]+\.js$/
const BUNDLE_CSS = /^(?:chunk|main|styles)-[\w-]+\.css$/
/** Berkas yang TIDAK BOLEH dipindah dari root (dibaca aplikasi/OTA). */
const KEEP_AT_ROOT = new Set(['sw.js', 'index.html', 'version.json', 'prerendered-routes.json', '3rdpartylicenses.txt'])

const errors = []
const log = (msg) => console.log(msg)

function ensureWww() {
  if (!fs.existsSync(WWW)) {
    console.error(`✖ Folder build tidak ditemukan: ${WWW}\n  Jalankan \`ng build\` dulu (npm run build).`)
    process.exit(1)
  }
}

/**
 * Buang bundle LAMA di folder tujuan (dari build sebelumnya yang tidak dibersihkan
 * Angular) supaya hash basi tidak menumpuk dan tidak ikut terbawa manifest OTA.
 * HANYA dijalankan bila ada bundle BARU yang dipindah dari root — agar script
 * aman diulang (idempoten) pada hasil build yang sudah tertata.
 */
function pruneStaleBundles(keep) {
  const removed = []
  for (const rel of [JS_OUT, CSS_OUT]) {
    const dir = path.join(WWW, rel)
    if (!fs.existsSync(dir)) continue
    for (const name of fs.readdirSync(dir)) {
      const bare = name.replace(/\.map$/, '')
      if (!(BUNDLE_JS.test(bare) || BUNDLE_CSS.test(bare))) continue
      if (keep.has(name)) continue // milik build saat ini — jangan disentuh
      fs.rmSync(path.join(dir, name), { force: true })
      removed.push(path.join(rel, name))
    }
  }
  return removed
}

/** Pindahkan bundle dari root www ke folder tujuan. Kembalikan daftar nama. */
function moveBundles() {
  const moved = []
  const entries = fs.readdirSync(WWW, { withFileTypes: true })
  const dirs = []

  // Buat folder tujuan lebih dulu
  for (const rel of [JS_OUT, CSS_OUT]) {
    const abs = path.join(WWW, rel)
    if (!fs.existsSync(abs)) fs.mkdirSync(abs, { recursive: true })
    else dirs.push(abs)
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (KEEP_AT_ROOT.has(entry.name)) continue

    const isJs = BUNDLE_JS.test(entry.name) || BUNDLE_JS.test(entry.name.replace(/\.map$/, ''))
    const isCss = BUNDLE_CSS.test(entry.name) || BUNDLE_CSS.test(entry.name.replace(/\.map$/, ''))
    if (!isJs && !isCss) continue

    const targetRel = isJs ? JS_OUT : CSS_OUT
    const from = path.join(WWW, entry.name)
    const to = path.join(WWW, targetRel, entry.name)
    // Jangan timpa: bila nama sama sudah ada di tujuan, buang sumber (duplikat)
    if (fs.existsSync(to)) fs.rmSync(from, { force: true })
    else fs.renameSync(from, to)
    moved.push({ name: entry.name, to: path.relative(WWW, to) })
  }
  return moved
}

/** Tulis ulang href/src di index.html yang menunjuk bundle yang dipindah. */
function rewriteIndexHtml(moved) {
  const indexPath = path.join(WWW, 'index.html')
  if (!fs.existsSync(indexPath)) {
    errors.push('index.html tidak ada di www/')
    return
  }
  let html = fs.readFileSync(indexPath, 'utf8')
  let count = 0

  for (const { name, to } of moved) {
    if (name.endsWith('.map')) continue
    // Hanya ganti nilai atribut "…" yang persis nama berkasnya (tanpa menyentuh
    // URL eksternal/font CDN yang kebetulan mirip).
    const quoted = `"${name}"`
    if (html.includes(quoted)) {
      const parts = html.split(quoted)
      html = parts.join(`"${to}"`)
      count += parts.length - 1
    }
  }

  fs.writeFileSync(indexPath, html)
  return count
}

/** Kumpulkan referensi lokal dari index.html (href/src tanpa skema eksternal). */
function collectHtmlRefs(html) {
  const refs = []
  const re = /\b(?:href|src)=["']([^"']+)["']/g
  let m
  while ((m = re.exec(html))) {
    const value = m[1]
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|data:)/i.test(value)) continue // http/data/#/protocol-relative
    refs.push(value.split('?')[0].split('#')[0])
  }
  return refs
}

function verify(moved) {
  // 1. Tidak boleh ada bundle tersisa di root www
  for (const name of fs.readdirSync(WWW)) {
    if (BUNDLE_JS.test(name) || BUNDLE_CSS.test(name)) {
      errors.push(`Bundle masih tertinggal di root www: ${name}`)
    }
  }

  // 2. Seluruh referensi lokal di index.html harus ada
  const indexPath = path.join(WWW, 'index.html')
  if (fs.existsSync(indexPath)) {
    const html = fs.readFileSync(indexPath, 'utf8')
    for (const ref of collectHtmlRefs(html)) {
      const target = path.join(WWW, ref.replace(/^\.?\//, ''))
      if (!fs.existsSync(target)) errors.push(`index.html merujuk berkas hilang: ${ref}`)
    }
  }

  // 3. Impor dinamis antar-chunk harus tetap valid relatif terhadap file pemanggil
  const jsFiles = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full)
      else if (e.name.endsWith('.js')) jsFiles.push(full)
    }
  }
  walk(WWW)

  for (const file of jsFiles) {
    const code = fs.readFileSync(file, 'utf8')
    // Tangkap `./chunk-x.js`, './main-x.js', dll. di dalam string/template literal
    const re = /["'`](?:\.\/)?((?:chunk|main|styles)-[\w-]+\.js)["'`]/g
    let m
    while ((m = re.exec(code))) {
      const target = path.join(path.dirname(file), m[1])
      if (!fs.existsSync(target)) {
        errors.push(`Impor rusak di ${path.relative(WWW, file)} → ./${m[1]}`)
      }
    }
  }

  // 4. Service worker OTA tetap di root (registrasi memakai 'sw.js')
  if (!fs.existsSync(path.join(WWW, 'sw.js'))) errors.push('sw.js hilang dari root www — OTA tidak akan terdaftar')
}

function main() {
  ensureWww()

  // Urutan penting: pindahkan dulu, baru bersihkan yang basi — kalau dibalik,
  // jalankan kedua kalinya akan menghapus bundle yang baru saja tertata.
  const moved = moveBundles()
  const pruned = moved.length
    ? pruneStaleBundles(new Set(moved.map(m => m.name)))
    : []
  const rewritten = rewriteIndexHtml(moved)
  verify(moved)

  if (errors.length) {
    console.error('\n✖ Organisasi build GAGAL — referensi tidak konsisten:\n')
    for (const e of errors) console.error(`  - ${e}`)
    console.error('\n  Build TIDAK layak di-deploy. Perbaiki lalu jalankan ulang.\n')
    process.exit(1)
  }

  const js = moved.filter(m => m.to.startsWith(JS_OUT))
  const css = moved.filter(m => m.to.startsWith(CSS_OUT))

  log('\n── Struktur bundle setelah dirapikan ─────────────────────────')
  log(`  assets/js/   : ${js.length} berkas`)
  log(`  assets/css/  : ${css.length} berkas`)
  log(`  referensi index.html diperbarui: ${rewritten}`)
  if (pruned.length) log(`  bundle lama dibersihkan: ${pruned.length}`)
  if (moved.length === 0) log('  (tidak ada bundle baru — struktur sudah rapi, verifikasi ulang lulus)')
  log('  ✓ Verifikasi lulus: semua referensi & impor chunk terpecah benar.\n')
}

main()
