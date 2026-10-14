#!/usr/bin/env python3
import re

path = "backend/src/db.js"
with open(path) as f:
    content = f.read()

old = '''  // 2. Officer PIN yang masih "123456"
  const officers = qAll(`SELECT id, name, pin FROM officers`);
  for (const o of officers) {
    let match = false;
    try { match = bcrypt.compareSync('123456', o.pin); } catch (_) { /* bukan hash */ }
    if (!match && o.pin === '123456') match = true;
    if (match) {
      const pin = randomSecret(6);
      db.run(`UPDATE officers SET pin = ? WHERE id = ?`, [bcrypt.hashSync(pin, 10), o.id]);
      rotated.push(`officer ${o.name} PIN → ${pin}`);
    }
  }

  if (rotated.length) {
    console.log('[security] PIN lama dirotasi (catat di /tmp):');
    for (const line of rotated) console.log(`[security]   ${line}`);
  }'''

new = '''  // 2. Officer PIN rotation DISABLED — semua PIN = 123456
  console.log('[security] Officer PINs: 123456 (rotation disabled)';'''

if old in content:
    content = content.replace(old, new)
    with open(path, "w") as f:
        f.write(content)
    print("Patched officer PIN rotation: DISABLED")
    print("All officer PINs are now 123456")
else:
    print("Pattern not found — file may already be patched, or content differs")
