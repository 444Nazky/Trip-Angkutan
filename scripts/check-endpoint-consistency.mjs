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

/** Ekstrak nilai environment object dari bundle yang sudah di-minify. */
function readEnvFromBundle(file) {
  const src = fs.readFileSync(file, 'utf8')
  const pick = (key) => {
    const re = new RegExp(`${key}:\\s*[\`'"]((?:[^\`'"]|\`[^\`]*\`)*)[\`'"]`)
    const m = re.exec(src)
    return m ? m[1] : null
  }
  return {
    apiBaseUrl: pick('apiBaseUrl'),
    intranetApiBaseUrl: pick('intranetApiBaseUrl'),
  }
}

function isPrivateHost(url) {
  try {
    const host = new URL(url).hostname
    return /^127\.|^10\.|^172\.(1[6-9]|2\d|3[01])\.|^192\.168\.|^localhost$/i.test(host)
  } catch { return false }
}

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
    // 1. Both must point to the SAME server.
    const norm = (u) => String(u).replace(/\/+$/, '').replace(/\/api$/, '')
    if (norm(env.apiBaseUrl) !== norm(env.intranetApiBaseUrl)) {
      fail(
        `apiBaseUrl (${env.apiBaseUrl}) dan intranetApiBaseUrl (${env.intranetApiBaseUrl}) ` +
        `menunjuk server BERBEDA. Aplikasi mobile dan dashboard admin akan menulis/membaca ` +
        `database yang berbeda — trip "berhasil terkirim" tapi tidak muncul di dashboard.`,
      )
    }

    // 2. No cloud default.
    for (const [key, value] of Object.entries(env)) {
      if (value && /\.supabase\.co/i.test(value)) {
        fail(`${key} masih menunjuk ke Supabase cloud (${value}). Server cloud tidak dipakai lagi — data officer akan masuk ke database yang tidak dibaca dashboard.`)
      }
    }

    // 3. Must be the LAN server.
    const target = env.intranetApiBaseUrl
    if (target && !isPrivateHost(target)) {
      fail(`intranetApiBaseUrl (${target}) bukan host jaringan privat. Seharusnya menunjuk ke server kantor (192.168.x.x / 10.x.x.x).`)
    }
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

main()
