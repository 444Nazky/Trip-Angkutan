#!/usr/bin/env node
// sync versi gradle + package.json + version.json
// pakai: node scripts/sync-version.mjs 1.0.6 [--root=DIR] [--code=9]

import fs from 'node:fs'
import path from 'node:path'

const argv = process.argv.slice(2)
const version = argv.find(a => /^\d+\.\d+\.\d+$/.test(a))
const rootArg = argv.find(a => a.startsWith('--root='))
const codeArg = argv.find(a => a.startsWith('--code='))
const moduleArg = argv.includes('--module')
const ROOT = rootArg ? path.resolve(rootArg.slice('--root='.length)) : path.resolve(import.meta.dirname, '..')

if (!version) {
  console.error('pakai: node scripts/sync-version.mjs 1.0.6 [--root=DIR] [--code=9] [--module]')
  process.exit(1)
}

const done = []
const skipped = []


function save(file, text) {
  fs.writeFileSync(file, text)
  done.push(path.relative(ROOT, file))
}


// sync package.json
function syncPackageJson() {
  const file = path.join(ROOT, 'package.json')
  if (!fs.existsSync(file)) return skipped.push('package.json')

  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
  pkg.version = version
  save(file, `${JSON.stringify(pkg, null, 2)}\n`)
}


// sync versi gradle
function syncGradle() {
  const file = path.join(ROOT, 'android', 'app', 'build.gradle')
  if (!fs.existsSync(file)) return skipped.push('android/app/build.gradle')

  let text = fs.readFileSync(file, 'utf8')
  // Hanya baris deklarasi yang boleh diganti. Versi lama memakai regex polos
  // (`/versionCode\s+\d+/`) yang lebih dulu mengenai baris KOMENTAR
  // ("// Rilis 1.0.2 (versionCode 11)"), jadi versionCode asli tidak pernah
  // naik - hasil: APK rebuilt tetap versionCode lama dan Android menolak
  // upgrade ("INSTALL_FAILED").
  const codeNow = Number((text.match(/^\s*versionCode\s+(\d+)/m) || [])[1] || 0)
  const codeNext = codeArg ? Number(codeArg.slice('--code='.length)) : codeNow + 1

  if (codeNext <= codeNow) {
    console.error(`versionCode harus naik (sekarang ${codeNow})`)
    process.exit(1)
  }

  text = text.replace(/^(\s*)versionCode\s+\d+/m, `$1versionCode ${codeNext}`)
  text = text.replace(/^(\s*)versionName\s+"[^"]*"/m, `$1versionName "${version}"`)
  save(file, text)
  console.log(`versionCode ${codeNow} -> ${codeNext}`)
}


// sync version.json (assets + integrity dibiarkan apa adanya)
//
// CATATAN: version.json adalah manifest bundel MODUL (saluran OTA), bukan
// versi paket APK. Nilainya dikelola `scripts/publish-ota-server.mjs` (versi
// modul naik sendiri dari versi modul aktif di server). Kalau script ini ikut
// menimpanya, versi modul mundur ke versi APK dan bundel yang baru
// dipublikasikan tidak pernah terpilih sebagai "active" - pembaruan modul
// diam-diam berhenti bekerja. Jadi file ini HANYA disentuh bila diminta
// eksplisit lewat --module.
function syncVersionJson() {
  if (!moduleArg) return skipped.push('version.json (versi modul dikelola publish-ota-server.mjs)')
  const file = path.join(ROOT, 'version.json')
  if (!fs.existsSync(file)) return skipped.push('version.json')

  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.version = `${version}+${Date.now()}`
  save(file, `${JSON.stringify(json, null, 2)}\n`)
}


syncPackageJson()
syncGradle()
syncVersionJson()

console.log(`versi ${version} ditulis ke: ${done.join(', ') || '-'}`)
if (skipped.length) console.log(`dilewati (tidak ada): ${skipped.join(', ')}`)
