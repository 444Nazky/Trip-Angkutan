#!/usr/bin/env node
/**
 * Audit berkas APK vs metadata rilis.
 *
 * Kenapa ada: di repo ini pernah tersimpan `app-1.0.8.apk` yang isinya 1.0.6 dan
 * `app-1.0.12.apk` yang isinya 1.0.9. Update API mengiklankan versi sesuai NAMA
 * BERKAS, jadi petugas memasang "update" yang isinya versi lama: versi aplikasi
 * tak pernah berubah, popup update muncul selamanya, dan mobile terus "mismatch"
 * saat membandingkan versi dari server.
 *
 * Jalankan sebelum rilis / setelah memindahkan APK:
 *   node scripts/verify-apks.mjs
 *
 * Exit 1 bila ada ketidakcocokan (nama berkas ≠ versionName di dalam APK, atau
 * metadata mengklaim versi yang berbeda dari berkasnya).
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'

const ROOT = path.resolve(import.meta.dirname, '..')

function findAapt2() {
  const candidates = []
  if (process.env.AAPT2) candidates.push(process.env.AAPT2)
  const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Android', 'Sdk')]
  for (const root of sdkRoots) {
    if (!root) continue
    const buildTools = path.join(root, 'build-tools')
    if (fs.existsSync(buildTools)) {
      for (const v of fs.readdirSync(buildTools).sort().reverse()) {
        candidates.push(path.join(buildTools, v, 'aapt2'))
      }
    }
  }
  for (const c of ['aapt2', 'aapt']) {
    try {
      execFileSync(c, ['version'], { stdio: 'ignore' })
      candidates.push(c)
    } catch { /* tidak ada */ }
  }
  return candidates.find(c => {
    try {
      fs.accessSync(c, fs.constants.X_OK)
      return true
    } catch {
      return false
    }
  }) ?? null
}

function badging(aapt2, apkPath) {
  const out = execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const line = out.split('\n').find(l => l.startsWith('package:')) ?? ''
  const versionName = /versionName='([^']*)'/.exec(line)?.[1] ?? ''
  const versionCode = /versionCode='([0-9]+)'/.exec(line)?.[1] ?? ''
  return { versionName, versionCode }
}

const targets = [
  { label: 'mobile', apks: path.join(ROOT, 'backend', 'apks'), metadata: path.join(ROOT, 'backend', 'metadata', 'versions.json') },
  { label: 'endpoint', apks: path.join(ROOT, '..', 'endpoint-trip Endpoint Branch', 'backend', 'apks'), metadata: path.join(ROOT, '..', 'endpoint-trip Endpoint Branch', 'backend', 'metadata', 'versions.json') },
].filter(t => fs.existsSync(t.apks))

const aapt2 = findAapt2()
if (!aapt2) {
  console.error('aapt2 tidak ditemukan. Set ANDROID_HOME (Android SDK) atau AAPT2=/path/aapt2 lalu ulangi.')
  process.exit(2)
}

let problems = 0

for (const target of targets) {
  console.log(`\n== ${target.label}: ${path.relative(ROOT, target.apks)}`)
  const files = fs.readdirSync(target.apks).filter(f => /^app-\d+\.\d+\.\d+\.apk$/.test(f))
  const real = new Map()
  for (const file of files) {
    const label = file.replace(/^app-/, '').replace(/\.apk$/, '')
    const { versionName, versionCode } = badging(aapt2, path.join(target.apks, file))
    real.set(label, versionName)
    const ok = versionName === label
    if (!ok) problems++
    console.log(`  ${ok ? 'ok  ' : 'BEDA'} ${file.padEnd(18)} versionName=${versionName} versionCode=${versionCode}`)
  }

  let metadata = null
  try {
    metadata = JSON.parse(fs.readFileSync(target.metadata, 'utf8'))
  } catch { /* metadata belum ada */ }
  if (!metadata) {
    console.log('  (metadata/versions.json tidak ada — dilewati)')
    continue
  }

  for (const [version, release] of Object.entries(metadata.releases ?? {})) {
    const realName = real.get(version)
    const declared = String(release.apkVersionName ?? '').trim()
    if (realName && realName !== version) {
      problems++
      console.log(`  BEDA metadata ${version}: berkas lokal berisi ${realName}`)
    }
    if (declared && declared !== version) {
      problems++
      console.log(`  BEDA metadata ${version}: apkVersionName=${declared}`)
    }
    if (!realName && !declared) {
      console.log(`  INFO ${version}: tanpa berkas lokal & tanpa apkVersionName (tidak bisa diverifikasi dari sini)`)
    }
  }
  const latest = metadata.latest?.version
  if (latest) {
    const latestReal = real.get(latest)
    console.log(`  latest=${latest}${latestReal ? ` (berkas lokal berisi ${latestReal})` : ' (tanpa berkas lokal)'}`)
  }
}

console.log('')
if (problems === 0) {
  console.log('SEMUA APK & METADATA KONSISTEN')
  process.exit(0)
}
console.error(`${problems} ketidakcocokan — jangan rilis sebelum dibereskan.`)
process.exit(1)
