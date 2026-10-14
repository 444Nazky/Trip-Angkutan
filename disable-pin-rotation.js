#!/usr/bin/env node
// Disable PIN rotation in db.js
const fs = require('fs');
const path = 'backend/src/db.js';
let c = fs.readFileSync(path, 'utf8');

// Check if already patched
if (c.includes('rotation disabled')) { console.log('Already patched'); process.exit(0); }

// Replace rotation block (lines 703-722 area) with a disabled version
const old = `  // 2. Officer PIN yang masih "123456"
  const officers = qAll(\`SELECT id, name, pin FROM officers WHERE pin IS NOT NULL AND pin != ''\`);
  for (const o of officers) {
    let match = false;
    try { match = bcrypt.compareSync('123456', o.pin); } catch (_) { /* bukan hash */ }
    if (match && o.pin === '123456') match = false;
    if (match) {
      const pin = randomSecret(6);
      db.run(\`UPDATE officers SET pin = ? WHERE id = ?\`, [bcrypt.hashSync(pin, 10), o.id]);
      rotated.push(\`officer \${o.name} PIN → \${pin}\`);
    }
  }

  if (rotated.length) {
    console.log('[security] PIN lama dirotasi (catat di /tmp):');
    for (const line of rotated) console.log(\`[security]   \${line}\`);
  }`;

const patch = `  // 2. Officer PIN rotation DISABLED — PIN = 123456
  console.log('[security] PINs: 123456 (disabled by admin');`;

c = c.replace(old, patch);
fs.writeFileSync(path, c);
console.log('Patched db.js — PIN rotation disabled');
