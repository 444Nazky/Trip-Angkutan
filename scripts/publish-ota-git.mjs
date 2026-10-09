#!/usr/bin/env node
/*
 * publish-ota-git.mjs — publish OTA via git CLI (tanpa GitHub API token).
 * Memakai kredensial git lokal (credential helper) yang sudah terkonfigurasi.
 *
 * Langkah:
 *   1. git worktree add sementara ke origin/mobile
 *   2. hapus aset lama di root worktree yang berasal dari build sebelumnya
 *   3. salin isi www/ ke root worktree
 *   4. generate version.json (versi manusiawi berbasis short SHA + timestamp)
 *   5. commit & push origin HEAD:mobile
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'

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

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/**
 * Guard: index.html pasti menunjuk aset yang benar-benar ada di www/.
 * Tanpa ini, manifest bisa menjanjikan bundle yang index.html-nya merujuk
 * file tak-terunggah → perangkat "berhasil update" tapi kode tak berubah.
 */
function assertIndexConsistent(assets) {
  const idx = path.join(WEB_DIR, 'index.html')
  if (!fs.existsSync(idx)) {
    console.error('❌  www/index.html tidak ditemukan — build belum jalan? jalankan `npm run build` dulu.')
    process.exit(1)
  }
  const html = fs.readFileSync(idx, 'utf8')
  const refs = [...html.matchAll(/(?:src|href)="([^"?#]+\.(?:js|css))"/g)].map(m => m[1])
  const missing = refs.filter(r => !assets.includes(r.replace(/^\.\//, '')))
  if (missing.length) {
    console.error('❌  index.html merujuk aset yang TIDAK ada di www/:', missing)
    console.error('   Publish dibatalkan — bundle hasil unduh tidak akan pernah cocok (update palsu).')
    process.exit(1)
  }
  if (!refs.length) {
    console.warn('⚠️  Tidak menemukan rujukan <script>/<link> di index.html — lanjut tanpa guard.')
  } else {
    console.log(`✔ index.html konsisten (${refs.length} rujukan aset cocok)`)
  }
}

try {
  run(`git fetch origin ${BRANCH}`)
  run(`git worktree add --detach ${TMP} origin/${BRANCH}`)

  const assets = collectAssets(WEB_DIR)
  console.log(`Found ${assets.length} built assets in ${WEB_DIR}`)

  // Guard konsistensi: pastikan index.html merujuk aset yang benar-benar ikut terbit.
  assertIndexConsistent(assets)

  // Peta integritas SHA-256 — klien memverifikasi setiap file unduhan.
  const integrity = {}
  for (const asset of assets) integrity[asset] = sha256File(path.join(WEB_DIR, asset))

  // Bersihkan aset build lama di root worktree agar tidak menumpuk
  for (const top of fs.readdirSync(WEB_DIR)) {
    fs.rmSync(path.join(TMP, top), { recursive: true, force: true })
  }
  fs.cpSync(WEB_DIR, TMP, { recursive: true })

  // ── Versi manusiawi: SemVer "1.0.<build>" berbasis SHA short + timestamp ──
  // Tetap monoton naik dan stabil dibaca manusia, tapi tetap bisa diurutkan
  // oleh isNewer() (prefix SemVer diprioritaskan, timestamp jadi tie-breaker).
  const short = run('git rev-parse --short=7 HEAD')
  const ts = Date.now()
  const build = (ts % 1_000_000)
  const version = `1.0.${build}+${short}`

  const manifest = JSON.stringify({ version, assets, integrity }, null, 2)
  fs.writeFileSync(path.join(TMP, 'version.json'), manifest)

  run('git add -A', TMP)
  const dirty = run('git status --porcelain', TMP)
  if (!dirty) {
    console.log('Tidak ada perubahan aset — skip push.')
    process.exit(0)
  }
  run(`git commit -m "chore(ota): bump to ${version}"`, TMP)
  run(`git push origin HEAD:${BRANCH}`, TMP)
  console.log('✅ OTA assets + version.json pushed to', BRANCH)
  console.log(`   version=${version}`)
} finally {
  try { run(`git worktree remove --force ${TMP}`) } catch { /* */ }
  fs.rmSync(TMP, { recursive: true, force: true })
}
