#!/usr/bin/env node
// Reset all officer PINs to 123456
const dbMod = require('./src/db');
const bcrypt = require('bcryptjs');

async function main() {
  await dbMod.loadDb();
  const db = dbMod.db;

  const pin = bcrypt.hashSync('123456', 10);
  db.prepare('UPDATE officers SET pin = ?').run(pin);

  const before = db.prepare('SELECT count(*) as c FROM officers').get();
  console.log('Updated', before.c, 'officers to PIN=123456');
}

main().catch(e => { console.error(e.message); process.exit(1); });
