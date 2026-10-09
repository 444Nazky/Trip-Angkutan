#!/usr/bin/env node
/*
 * publish-ota-git.mjs — publish OTA via git CLI (tanpa GitHub API token).
 * Memakai kredensial git lokal (credential helper) yang sudah terkonfigurasi.
 *
 * Langkah:
 *   1. git worktree add sementara ke origin/mobile
 *   2. hapus ALL chunk/main/styles/asset/ota lama dari tree publish
 *   3. salin www/ ke ota/ dan root untuk kompatibilitas aplikasi lama
 *   4. generate version.json (versi = semver+timestamp; hash SHA-256 per file)
 */

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const ROOT = path.resolve(import.meta.dirname, '..')
const WEB_DIR = path.join(ROOT, 'www')
const BRANCH = 'mobile'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ota-publish-'))

const run = (cmd, cwd = ROOT) => execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim()

function collectAssets(dir, base = dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...collectAssets(full, base))
    else out.push(path.relative(base, full))
  }
  return out
}

try {
  run(`git fetch origin ${BRANCH}`)
  run(`git worktree add --detach ${TMP} origin/${BRANCH}`)

  const assets = collectAssets(WEB_DIR)
  console.log(`Found ${assets.length} built assets in ${WEB_DIR}`)

  // Guard: jangan pernah publish bundel kosong/parsial. Ini yang bikin perangkat
  // menarik versi baru lalu diam (manifest.assets kosong → app tak unduh apa pun).
  if (!assets.includes('index.html') || assets.length < 3) {
    console.error(`❌ www/ tampak belum dibuild (index.html=${assets.includes('index.html')}, total=${assets.length}). Jalankan "npm run build" dulu.`)
    process.exit(1)
  }

  // ── 2a — versi semantik manusiawi + bundle cleanup bersih ─────────────────
  // Versi target: "<semver>+<timestamp>" (contoh: "1.0.2+1791495863895").
  // Semver manusiawi; timestamp-layer tetap jadi guard anti-stuck/ambigu di
  // isNewer() (pencarian segmen numerik) tanpa mengubah semantik banding.
  let baseSemver = '1.0.0'
  try {
    const prevRaw = fs.readFileSync(path.join(TMP, 'version.json'), 'utf8')
    const prev = JSON.parse(prevRaw)
    if (prev.version && typeof prev.version === 'string') {
      const m = prev.version.match(/^([\d.]+)/)
      if (m) baseSemver = m[1]
    }
  } catch { /* fallback 1.0.0 */ }
  const parts = baseSemver.split('.').map(Number)
  parts[0] = parts[0] ?? 0
  parts[1] = parts[1] ?? 0
  parts[2] = (parts[2] ?? 0) + 1
  const semver = `${parts[0]}.${parts[1]}.${parts[2]}`
  const version = `${semver}+${Date.now()}`

  // Hapus semua artifact bundel lama dari tree origin/mobile SEBELUM copy baru.
  // Tanpa ini, chunk/main/styles yang basi menumpuk & bisa serve versi lama /
  // membuat perangkat "tidak deteksi perubahan" (bug pull kedua).
  for (const name of fs.readdirSync(TMP)) {
    if (/^(?:chunk|main|styles)-[\w-]+\.(?:js|css)$/.test(name)) {
      fs.rmSync(path.join(TMP, name), { force: true })
    }
  }
  fs.rmSync(path.join(TMP, 'assets'), { recursive: true, force: true })
  fs.rmSync(path.join(TMP, 'ota'), { recursive: true, force: true })

  fs.cpSync(WEB_DIR, path.join(TMP, 'ota'), { recursive: true })
  fs.cpSync(WEB_DIR, TMP, { recursive: true })

  // Rebuild manifest aset dari disk (jangan pakai daftar yang mungkin masih
  // mengandung build lama yang masih terselip di WEB_DIR).
  const seen = new Set()
  const manifestAssets = []
  for (const a of assets) {
    if (seen.has(a)) continue
    seen.add(a)
    const full = path.join(TMP, a)
    if (!fs.statSync(full).isFile()) continue
    manifestAssets.push(a)
  }

  // Integritas: hitung ulang SHA-256 aset nyata yang ada di tree publish.
  const integrity = {}
  try {
    const crypto = await import('node:crypto')
    for (const name of manifestAssets) {
      const full = path.join(TMP, name)
      if (!fs.statSync(full).isFile()) continue
      const bytes = fs.readFileSync(full)
      integrity[name] = crypto.createHash('sha256').update(bytes).digest('hex')
    }
  } catch { /* opsional — publish tetap lanjut */ }

  const manifest = JSON.stringify({ version, assets: manifestAssets, integrity }, null, 2)
  fs.writeFileSync(path.join(TMP, 'version.json'), manifest)

  run('git add -A', TMP)
  const dirty = run('git status --porcelain', TMP)
  if (!dirty) {
    console.log('Tidak ada perubahan aset — skip push.')
    process.exit(0)
  }
  run(`git commit -m "chore(ota): bump version to ${version} [skip ci]"`, TMP)
  run(`git push origin HEAD:${BRANCH}`, TMP)
  console.log('✅ OTA assets + version.json pushed to', BRANCH)
} finally {
  try { run(`git worktree remove --force ${TMP}`) } catch { /* */ }
  fs.rmSync(TMP, { recursive: true, force: true })
}
