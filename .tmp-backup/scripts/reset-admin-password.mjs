#!/usr/bin/env node
// reset-admin-password.mjs — setel ulang password admin dashboard di database lokal.
//
// Pakai: node scripts/reset-admin-password.mjs [--password=RAHASIA] [--username=admin]
//
// Dijalankan di PC kantor, di mesin yang menjalankan server API intranet.
// Script ini menulis langsung ke tabel admin_credentials melalui PostgREST
// lokal, sehingga tidak perlu SQL interaktif.
//
// Perilaku:
//   - Tanpa --password, password acak dibuat dan dicetak di layar.
//   - Password lama langsung tidak berlaku.
//   - Password disimpan sebagai hash bcrypt, sama seperti saat operator
//     menggantinya lewat dashboard.

import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'

const POSTGREST_URL = (process.env.POSTGREST_URL || 'http://127.0.0.1:3001').replace(/\/+$/, '')

const args = process.argv.slice(2)
const argValue = (name) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)

const username = (argValue('username') || 'admin').trim()
const explicitPassword = argValue('password')
const password = explicitPassword && explicitPassword.length >= 8
  ? explicitPassword
  : crypto.randomBytes(12).toString('base64url').slice(0, 16)

if (explicitPassword && explicitPassword.length < 8) {
  console.error('Password minimal 8 karakter.')
  process.exit(1)
}

async function main() {
  const health = await fetch(`${POSTGREST_URL}/admin_credentials?limit=1`, {
    headers: { Accept: 'application/json' },
  })
  if (!health.ok) {
    console.error(`Database lokal tidak dapat dihubungi (${POSTGREST_URL}).`)
    console.error('Pastikan container db dan rest sudah berjalan: docker compose up -d db rest')
    process.exit(1)
  }

  const hashed = bcrypt.hashSync(password, 10)
  const res = await fetch(`${POSTGREST_URL}/admin_credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify({ username, password: hashed }),
  })
  if (!res.ok) {
    console.error(`Gagal menulis kredensial admin: HTTP ${res.status} ${await res.text()}`)
    process.exit(1)
  }

  console.log('Password admin dashboard berhasil disetel ulang.')
  console.log(`Username : ${username}`)
  console.log(`Password : ${password}`)
  console.log('Simpan password ini, atau ganti lewat menu Ubah Password di dashboard.')
}

main().catch((error) => {
  console.error(`Gagal: ${error instanceof Error ? error.message : error}`)
  process.exit(1)
})
