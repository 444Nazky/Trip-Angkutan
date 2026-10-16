#!/usr/bin/env node
// publish-ota-server.mjs — kirim bundel modul web ke server API sendiri.
// pakai: node scripts/publish-ota-server.mjs [--server=URL] [--secret=S] [--notes="..."] [--force-update] [--min-version=1.0.0]

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'



const ROOT = path.resolve(import.meta.dirname, '..')
const WEB_DIR = path.join(ROOT, 'www')
const MANIFEST_FILE = path.join(ROOT, 'version.json')

const args = process.argv.slice(2)
const argValue = (name) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const hasFlag = (name) => args.includes(`--${name}`)

const SERVER = (argValue('server') || process.env.TRIP_API_URL || 'http://localhost:3000').replace(/\/+$/, '')
const SECRET = argValue('secret') || process.env.PUBLISH_SECRET || 'trip-angkut-secret'



function collectAssets(dir, base = dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectAssets(full, base))
    else out.push(path.relative(base, full).split(path.sep).join('/'))
  }
  return out
}



function nextVersion() {
  let base = '1.0.0'
  try {
    const prev = JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'))
    const match = String(prev.version ?? '').match(/^(\d+)\.(\d+)\.(\d+)/)
    if (match) base = `${match[1]}.${match[2]}.${Number(match[3]) + 1}`
  } catch { /* belum ada manifest → mulai 1.0.0 */ }
  return `${base}+${Date.now()}`
}



if (!fs.existsSync(path.join(WEB_DIR, 'index.html'))) {
  console.error('❌ www/ belum dibuild. Jalankan "npm run build" dulu.')
  process.exit(1)
}



const assets = collectAssets(WEB_DIR)
if (!assets.includes('index.html') || assets.length < 3) {
  console.error(`❌ www/ tampak parsial (index.html=${assets.includes('index.html')}, total=${assets.length}).`)
  process.exit(1)
}

const version = nextVersion()
const files = {}
const integrity = {}

for (const asset of assets) {
  const bytes = fs.readFileSync(path.join(WEB_DIR, asset))
  files[asset] = bytes.toString('base64')
  integrity[asset] = crypto.createHash('sha256').update(bytes).digest('hex')
}

console.log(`Bundel: ${assets.length} berkas → versi ${version}`)
console.log(`Server: ${SERVER}`)



const payload = {
  version,
  files,
  integrity,
  releaseNotes: argValue('notes') || '',
  minVersion: argValue('min-version') || null,
  isForceUpdate: hasFlag('force-update'),
}

let response
try {
  response = await fetch(`${SERVER}/api/v1/publish-ota`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publish-secret': SECRET },
    body: JSON.stringify(payload),
  })
} catch (error) {
  console.error(`❌ Gagal menghubungi server: ${error.message}`)
  process.exit(1)
}

const body = await response.json().catch(() => null)
if (!response.ok) {
  console.error(`❌ Publish gagal (${response.status}): ${body?.message || 'tanpa pesan'}`)
  process.exit(1)
}



// Manifest lokal ikut diperbarui supaya versi bundel di perangkat = yang dipublikasikan.
fs.writeFileSync(MANIFEST_FILE, `${JSON.stringify({ version, assets, integrity }, null, 2)}\n`)

console.log(`✅ ${body?.message || `Modul ${version} dipublikasikan`}`)
if (body?.pruned?.length) console.log(`   bundel lama dihapus: ${body.pruned.join(', ')}`)
console.log('   Perangkat akan menariknya otomatis lewat tombol "Cek & Perbarui Aplikasi".')
