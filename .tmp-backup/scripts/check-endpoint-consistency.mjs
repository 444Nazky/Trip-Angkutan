#!/usr/bin/env node
/* ────────────────────────────────────────────────────────────────────────────
 * check-endpoint-consistency.mjs — Penjaga "split-brain" endpoint.
 *
 * GEJALA YANG DIHINDARI:
 *   Aplikasi mobile (APK/OTA) mengirim trip ke server A, sementara dashboard
 *   admin membaca server B. Petugas melihat "berhasil terkirim", tapi trip
 *   tidak pernah muncul di dashboard — dan tidak ada pesan error sama sekali.
 *
 *   Ini yang terjadi di lapangan: APK versi lama masih memakai default
 *   Supabase (cloud), sedangkan dashboard admin + server intranet kantor sudah
 *   pindah ke server lokal (port 3000). Keduanya sama-sama "sukses", tapi
 *   datanya masuk ke dua database yang BERBEDA.
 *
 * ATURAN YANG DIPERIKSA (gagal = build berhenti):
 *   1. `apiBaseUrl` dan `intranetApiBaseUrl` di environment harus menunjuk
 *      server yang SAMA. Ini menjamin mobile app & dashboard admin tidak
 *      pernah dibandingkan ke backend berbeda, bahkan kalau ada kode yang
 *      memakai `apiBaseUrl` secara langsung.
 *   2. Endpoint default TIDAK boleh domain `.supabase.co`. Server cloud
 *      sudah tidak dipakai; kalau muncul lagi, hampir pasti data officer
 *      akan masuk ke database yang tidak dibaca dashboard.
 *   3. Endpoint default harus punya host jaringan privat (LAN) — inilah
 *      server kantor.
 *
 * Dijalankan otomatis setelah `ng build` (lihat package.json -> build).
 * ──────────────────────────────────────────────────────────────────────────── */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const WWW = path.join(ROOT, 'www')
const ASSET_JS = path.join(WWW, 'assets', 'js')

const errors = []
const notes = []

function fail(msg) { errors.push(msg) }

/**
 * Ekstrak nilai environment object dari bundle yang sudah di-minify.
 *
 * CATATAN PENTING: minifier sering "mengangkat" nilai yang dipakai berulang
 * ke konstanta terpisah, jadi bentuknya tidak selalu literal:
 *
 *     Se$1=`http://192.168.1.123:3000/api`
 *     B$1={production:!0,apiBaseUrl:Se$1,intranetApiBaseUrl:Se$1,...}
 *
 * Karena itu `pick` mencari nilai dalam dua tahap: literal dulu, kalau tidak
 * ketemu lalu identifier yang dirujuk, lalu identifier itu cari definisinya.
 * Tanpa tahap kedua, build yang SEBENARNYA benar akan dianggap gagal.
 */
function parseEnvFromSource(src) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const QUOTES = new Set(['"', "'", '`'])

  /**
   * Baca satu literal string pada posisi `i`. Returns null kalau bukan string.
   * Menangani escape sequence supaya `http:\/\/` tidak terpotong.
   */
  const readStringAt = (i) => {
    const q = src[i]
    if (!QUOTES.has(q)) return null
    let out = ''
    for (let j = i + 1; j < src.length; j++) {
      const c = src[j]
      if (c === '\\') { out += src[j + 1] ?? ''; j++; continue }
      if (c === q) return { value: out, end: j + 1 }
      out += c
    }
    return null
  }

  /** Nilai yang masuk akal untuk endpoint: URL http(s). */
  const looksLikeUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim())

  /**
   * Ambil nilai sebuah key dari bundle minify:
   *   1. literal langsung     -> apiBaseUrl:`http://...`
   *   2. identifier ter-hoist -> apiBaseUrl:Se$1, lalu `Se$1=` dibaca
   * Nilai yang bukan URL dianggap tidak ketemu (supaya tidak salah tangkap
   * potongan kode lain yang kebetulan diawali nama key yang sama).
   */
  const pick = (key) => {
    const k = esc(key)
    const afterKey = new RegExp('(?<![\\w$])' + k + '\\s*:\\s*').exec(src)
    if (!afterKey) return null
    let i = afterKey.index + afterKey[0].length

    // Tahap 1: literal langsung.
    const lit = readStringAt(i)
    if (lit && looksLikeUrl(lit.value)) return lit.value.trim()

    // Tahap 2: identifier yang dirujuk (konstanta hasil hoisting minifier).
    const idMatch = /^[A-Za-z_$][\w$]*/.exec(src.slice(i))
    if (!idMatch) return null
    const ident = idMatch[0]
    const defRe = new RegExp('(?<![\\w$])' + esc(ident) + '\\s*=\\s*')
    const def = defRe.exec(src)
    if (!def) return null
    const defStr = readStringAt(def.index + def[0].length)
    if (defStr && looksLikeUrl(defStr.value)) return defStr.value.trim()

    return null
  }

  return {
    apiBaseUrl: pick('apiBaseUrl'),
    intranetApiBaseUrl: pick('intranetApiBaseUrl'),
  }
}

/** Baca bundle dari disk lalu parse isinya. */
function readEnvFromBundle(file) {
  return parseEnvFromSource(fs.readFileSync(file, 'utf8'))
}

function isPrivateHost(url) {
  try {
    const host = new URL(url).hostname
    return /^127\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^localhost$/i.test(host)
  } catch { return false }
}

/**
 * Aturan split-brain dalam bentuk murni (tanpa I/O) supaya bisa diuji.
 * Return daftar pesan error; array kosong = endpoint konsisten.
 */
export function checkEndpointConsistency(env) {
  const problems = []

  if (!env.apiBaseUrl || !env.intranetApiBaseUrl) {
    problems.push('Environment bundle tidak lengkap — pola apiBaseUrl/intranetApiBaseUrl berubah. Perbarui script ini.')
    return problems
  }

  // 1. Keduanya harus menunjuk server yang SAMA.
  const norm = (u) => String(u).replace(/\/+$/, '').replace(/\/api$/, '')
  if (norm(env.apiBaseUrl) !== norm(env.intranetApiBaseUrl)) {
    problems.push(
      `apiBaseUrl (${env.apiBaseUrl}) dan intranetApiBaseUrl (${env.intranetApiBaseUrl}) ` +
      `menunjuk server BERBEDA. Aplikasi mobile dan dashboard admin akan menulis/membaca ` +
      `database yang berbeda — trip "berhasil terkirim" tapi tidak muncul di dashboard.`,
    )
  }

  // 2. Tidak boleh ada cloud default.
  for (const [key, value] of Object.entries(env)) {
    if (value && /\.supabase\.co/i.test(value)) {
      problems.push(`${key} masih menunjuk ke Supabase cloud (${value}). Server cloud tidak dipakai lagi — data officer akan masuk ke database yang tidak dibaca dashboard.`)
    }
  }

  // 3. Harus host jaringan privat (server kantor).
  if (env.intranetApiBaseUrl && !isPrivateHost(env.intranetApiBaseUrl)) {
    problems.push(`intranetApiBaseUrl (${env.intranetApiBaseUrl}) bukan host jaringan privat. Seharusnya menunjuk ke server kantor (192.168.x.x / 10.x.x.x).`)
  }

  return problems
}

export { readEnvFromBundle, isPrivateHost, parseEnvFromSource }

function main() {
  if (!fs.existsSync(ASSET_JS)) {
    console.error(`✖ Folder build tidak ditemukan: ${ASSET_JS}\n  Jalankan \`ng build\` dulu.`)
    process.exit(1)
  }
  const bundle = fs.readdirSync(ASSET_JS).find(f => /^main-[\w-]+\.js$/.test(f))
  if (!bundle) {
    console.error(`✖ Bundle utama tidak ditemukan di ${ASSET_JS}`)
    process.exit(1)
  }

  const file = path.join(ASSET_JS, bundle)
  const env = readEnvFromBundle(file)
  console.log(`→ Memeriksa bundle: ${path.relative(ROOT, file)}`)
  console.log(`   apiBaseUrl         = ${env.apiBaseUrl ?? '(tidak ditemukan)'}`)
  console.log(`   intranetApiBaseUrl = ${env.intranetApiBaseUrl ?? '(tidak ditemukan)'}`)

  if (!env.apiBaseUrl || !env.intranetApiBaseUrl) {
    fail('Environment bundle tidak lengkap — pola apiBaseUrl/intranetApiBaseUrl berubah. Perbarui script ini.')
  } else {
    for (const p of checkEndpointConsistency(env)) fail(p)
  }

  // Info tambahan: kalau folder admin-www hasil deploy lama masih ada,
  // bandingkan endpoint-nya supaya deploy basiKetahuan.
  const adminBundleDir = path.join(ROOT, 'admin-www', 'assets', 'js')
  if (fs.existsSync(adminBundleDir)) {
    const adminBundle = fs.readdirSync(adminBundleDir).find(f => /^main-[\w-]+\.js$/.test(f))
    if (adminBundle) {
      const adminEnv = readEnvFromBundle(path.join(adminBundleDir, adminBundle))
      if (adminEnv.apiBaseUrl && env.apiBaseUrl &&
          adminEnv.apiBaseUrl.replace(/\/+$/, '') !== env.apiBaseUrl.replace(/\/+$/, '')) {
        notes.push(
          `admin-www/ masih memakai endpoint LAMA (${adminEnv.apiBaseUrl}) ` +
          `sedangkan build baru memakai ${env.apiBaseUrl}. Salin ulang www/ ke admin-www/ sebelum deploy.`,
        )
      }
    }
  }

  for (const n of notes) console.warn(`⚠ ${n}`)
  if (errors.length) {
    console.error('\n✖ Build DIBATASI — endpoint tidak konsisten:')
    for (const e of errors) console.error(`   • ${e}`)
    process.exit(1)
  }
  console.log('✔ Endpoint konsisten: aplikasi mobile & dashboard admin memakai server yang sama.')
}

// Hanya jalankan pemeriksaan kalau file ini dipanggil langsung
// (`node scripts/check-endpoint-consistency.mjs`), bukan saat di-import
// oleh unit test.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main()
}
