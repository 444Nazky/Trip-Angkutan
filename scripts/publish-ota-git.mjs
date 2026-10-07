#!/usr/bin/env node
/*
 * publish-ota-git.mjs — publish OTA via git CLI (tanpa GitHub API token).
 * Memakai kredensial git lokal (credential helper) yang sudah terkonfigurasi.
 *
 * Langkah:
 *   1. git worktree add sementara ke origin/mobile
 *   2. hapus aset lama di root worktree yang berasal dari build sebelumnya
 *   3. salin isi www/ ke root worktree
 *   4. generate version.json (versi = short SHA origin/mobile + timestamp)
 *   5. commit & push origin HEAD:mobile
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

  // Bersihkan aset build lama di root worktree agar tidak menumpuk
  for (const top of fs.readdirSync(WEB_DIR)) {
    fs.rmSync(path.join(TMP, top), { recursive: true, force: true })
  }
  fs.cpSync(WEB_DIR, TMP, { recursive: true })

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const version = `${pkg.version}+${Date.now()}`
  const manifest = JSON.stringify({ version, assets }, null, 2)
  fs.writeFileSync(path.join(TMP, 'version.json'), manifest)

  run('git add -A', TMP)
  const dirty = run('git status --porcelain', TMP)
  if (!dirty) {
    console.log('Tidak ada perubahan aset — skip push.')
    process.exit(0)
  }
  run(`git commit -m "chore(ota): bump version to ${version}"`, TMP)
  run(`git push origin HEAD:${BRANCH}`, TMP)
  console.log('✅ OTA assets + version.json pushed to', BRANCH)
} finally {
  try { run(`git worktree remove --force ${TMP}`) } catch { /* */ }
  fs.rmSync(TMP, { recursive: true, force: true })
}
