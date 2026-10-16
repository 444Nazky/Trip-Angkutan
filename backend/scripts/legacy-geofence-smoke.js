/**
 * legacy-geofence-smoke.js — regresi untuk insiden 2026-10-15.
 *
 * Latar: DB produksi (volume Railway) dibuat SEBELUM kolom `dermaga_id` ada di
 * tabel `geofences`. `CREATE TABLE IF NOT EXISTS` tidak menambahkan kolom ke tabel
 * yang sudah ada, dan migrasi lama hanya *memeriksa* (lalu "skip"), tidak pernah
 * `ALTER TABLE`. Akibatnya `GET /api/geofences?dermagaId=<uuid>` melempar
 * "no such column: dermaga_id" → 500 → perangkat petugas menerima 0 titik dan
 * menampilkan "Belum ada titik geofence tersimpan" — input trip utama terkunci.
 *
 * Skrip ini membangun DB dengan skema LAMA (tanpa dermaga_id/allowed_directions/
 * description), menjalankan server seperti produksi, lalu memastikan:
 *   A. migrasi benar-benar MENAMBAHKAN kolom yang hilang,
 *   B. GET ?dermagaId tidak 500 dan mengembalikan titik "berlaku umum" (NULL),
 *   C. titik baru dari admin dashboard tersimpan DENGAN dermagaId (dulu dibuang),
 *   D. payload memuat field dermagaId (dashboard & petugas memakainya).
 *
 * Jalankan: node scripts/legacy-geofence-smoke.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-legacy-geo-'));
const PORT = 45824;
const JWT_SECRET = 'legacy-' + crypto.randomBytes(8).toString('hex');
const ADMIN_PASS = 'legacy-admin-' + crypto.randomBytes(6).toString('hex');

let failures = 0;

function check(name, cond, extra = '') {
  console.log((cond ? '  ok ' : '  FAIL ') + name + (cond ? '' : `  << ${extra}`));
  if (!cond) failures++;
}

async function main() {
  const dbPath = path.join(TMP, 'trip.db');

  // ── 1. DB dengan skema geofences LAMA (tanpa dermaga_id & kawan-kawan) ──────
  const seedScript = path.join(TMP, 'seed.js');
  fs.writeFileSync(seedScript, `
    process.env.DB_PATH = ${JSON.stringify(dbPath)};
    const dbModule = require(${JSON.stringify(path.join(BACKEND, 'src/db.js'))});
    dbModule.loadDb().then(() => {
      const { db } = dbModule;
      const { randomUUID } = require('crypto');
      const rid = randomUUID(), did = randomUUID();
      db.prepare('INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)').run(rid, 'Region Legacy', 'LEG', 'pw');
      db.prepare('INSERT INTO dermagas (id, region_id, name, code) VALUES (?, ?, ?, ?)').run(did, rid, 'Dermaga Legacy', 'LEG-D1');
      // Tabel geofences skema lama — TANPA dermaga_id/location_name/description.
      db.prepare('DROP TABLE IF EXISTS geofences').run();
      db.prepare(\`CREATE TABLE geofences (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        radius_meters INTEGER DEFAULT 100,
        allowed_routes TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )\`).run();
      db.prepare('INSERT INTO geofences (id, name, latitude, longitude, radius_meters, allowed_routes, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('legacy-1', 'Titik Umum Legacy', -6.19, 106.84, 100, '', 1);
      db.prepare('INSERT INTO geofences (id, name, latitude, longitude, radius_meters, allowed_routes, enabled) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('legacy-2', 'Titik Legacy Nonaktif', -6.2, 106.85, 100, '', 0);
      console.log('SEEDED ' + rid + ' ' + did);
    }).catch(e => { console.error(e); process.exit(1); });
  `);
  const seed = spawnSync(process.execPath, [seedScript], { encoding: 'utf8', timeout: 30000 });
  const seeded = (String(seed.stdout || '').split('SEEDED ')[1] || '').trim().split('\n')[0].split(' ');
  const [regionId, dermagaId] = seeded;
  if (!regionId || !dermagaId) {
    console.error('SEED GAGAL:\n' + seed.stdout + seed.stderr);
    process.exit(1);
  }
  console.log('Seed OK — skema geofences LAMA (tanpa dermaga_id)\n');

  // ── 2. Boot server seperti produksi (migrasi berjalan saat boot) ───────────
  const child = spawn(process.execPath, [path.join(BACKEND, 'src/index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET,
      ADMIN_PASSWORD: ADMIN_PASS,
      DB_PATH: dbPath,
      UPLOADS_DIR: path.join(TMP, 'uploads'),
      METADATA_DIR: path.join(TMP, 'metadata'),
      APK_DIR: path.join(TMP, 'apks'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  child.stdout.on('data', d => logs.push(String(d)));
  child.stderr.on('data', d => logs.push(String(d)));

  const base = `http://127.0.0.1:${PORT}`;
  let up = false;
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) { up = true; break; } } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  if (!up) {
    console.error('SERVER GAGAL BOOT:\n' + logs.join(''));
    child.kill();
    process.exit(1);
  }

  const jwtSign = (payload) => require(path.join(BACKEND, 'node_modules/jsonwebtoken')).sign(payload, JWT_SECRET, { expiresIn: '1h' });
  const officer = { Authorization: `Bearer ${jwtSign({ officerId: crypto.randomUUID(), regionId, role: 'officer' })}` };
  const admin = { Authorization: `Bearer ${jwtSign({ role: 'admin', username: 'admin' })}` };

  // ── B. GET ?dermagaId pada skema lama: TIDAK boleh 500 ────────────────────
  console.log('[A] GET /api/geofences?dermagaId=… pada DB skema lama');
  const res = await fetch(`${base}/api/geofences?dermagaId=${dermagaId}`, { headers: officer });
  const rows = await res.json().catch(() => null);
  check('A1 tidak 500 (dulu "no such column: dermaga_id" → 500)', res.status === 200, `status=${res.status} body=${JSON.stringify(rows).slice(0, 200)}`);
  check('A2 titik "berlaku umum" sampai ke petugas (count > 0)', Array.isArray(rows) && rows.length > 0, `rows=${Array.isArray(rows) ? rows.length : rows}`);
  check('A3 payload memuat field dermagaId (dashboard memakainya)', Array.isArray(rows) && rows.every(r => Object.prototype.hasOwnProperty.call(r, 'dermagaId')), JSON.stringify(rows && rows[0]));

  // ── C. Titik baru dari admin tersimpan DENGAN dermagaId ──────────────────
  console.log('\n[B] POST titik baru (admin dashboard mengirim dermagaId)');
  const created = await fetch(`${base}/api/geofences`, {
    method: 'POST',
    headers: { ...admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ locationName: 'Titik Dermaga Legacy', latitude: -6.18, longitude: 106.83, radiusMeters: 150, dermagaId, allowedRouteCodes: ['SJRE-SBDZ'] }),
  });
  const createdBody = await created.json().catch(() => ({}));
  check('B1 POST 201', created.status === 201, `status=${created.status} ${JSON.stringify(createdBody)}`);

  const again = await fetch(`${base}/api/geofences?dermagaId=${dermagaId}`, { headers: officer });
  const againRows = await again.json().catch(() => null);
  const mine = Array.isArray(againRows) ? againRows.find(r => r.locationName === 'Titik Dermaga Legacy') : null;
  check('B2 titik baru terkirim ke petugas dermaga tsb', Boolean(mine), JSON.stringify(againRows && againRows.map(r => r.locationName)));
  check('B3 dermagaId titik baru ikut tersimpan (dulu dibuang → NULL)', mine && mine.dermagaId === dermagaId, `dermagaId=${mine && mine.dermagaId}`);
  check('B4 radius dari dashboard dihormati (150, bukan default 100)', mine && mine.radiusMeters === 150, `radius=${mine && mine.radiusMeters}`);

  console.log('\n' + (failures === 0 ? 'LEGACY GEOFENCE SMOKE LULUS' : `${failures} CHECK GAGAL`));
  child.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH:', e); process.exit(1); });
