#!/usr/bin/env node


const dbMod = require('./src/db')
const bcrypt = require('bcryptjs')



async function main() {
  await dbMod.loadDb()
  const db = dbMod.db

  const pin = bcrypt.hashSync('123456', 10)
  db.prepare('UPDATE officers SET pin = ?').run(pin)

  const officers = db.prepare('SELECT id, name FROM officers').all()
  console.log('══════════════════════════════════════════════════════════════')
  console.log('[reset] PIN PETUGAS DIRESET KE: 123456')
  console.log(`[reset] Total petugas diupdate: ${officers.length}`)
  console.log('══════════════════════════════════════════════════════════════')
  for (const o of officers) {
    console.log(`[reset]   - ${o.name} (${o.id})`)
  }
  console.log('══════════════════════════════════════════════════════════════')
}



main().catch(e => {
  console.error('[reset] Gagal reset PIN:', e.message)
  process.exit(1)
})
