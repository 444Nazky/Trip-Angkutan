// Smoke test E2E LOKAL — boot backend endpoint-trip dengan DB/uploads SEKALI PAKAI.
// Tidak menyentuh data produksi (DB_PATH & UPLOADS_DIR diarahkan ke folder temp).
// Alur yang diuji:
//   A. Admin-login password salah → 401 (no fallback literal)
//   B. Officer login → GET /api/officers/my-region: roster self-region, tanpa bocor region lain
//   C. POST /api/trips/complete (multipart) ×2 dengan clientTripId sama → upsert (no_trip sama)
//   D. POST /api/geofences: clamp radius 45000→100, 0→100, 250→250; placeholder koordinat → 400
//   E. GET /api/geofences/resolve-link: host internal/cloud-metadata → 400 (SSRF allowlist)

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-e2e-'));
const PORT = 45791;
const JWT_SECRET = 'e2e-secret-' + crypto.randomBytes(8).toString('hex');
const ADMIN_PASS = 'e2e-admin-' + crypto.randomBytes(6).toString('hex');

let failures = 0;
function check(name, cond, extra = '') {
  console.log((cond ? '  ok ' : '  FAIL ') + name + (cond ? '' : `  << ${extra}`));
  if (!cond) failures++;
}



async function main() {
  // ── Seed DB dulu (child proses terpisah, DB_PATH di temp) ──────────────────
  const seedScript = path.join(TMP, 'seed.js');
  fs.writeFileSync(seedScript, `
    process.env.DB_PATH = ${JSON.stringify(path.join(TMP, 'trip.db'))};
    const dbModule = require(${JSON.stringify(path.join(BACKEND, 'src/db.js'))});
    dbModule.loadDb().then(() => {
      const { db } = dbModule;
      const { randomUUID } = require('crypto');
      const rid = randomUUID(), rid2 = randomUUID(), did = randomUUID(), oid = randomUUID();
      const st = sql => db.prepare(sql);
      st('INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)').run(rid, 'Region E2E', 'E2E', 'pw');
      st('INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)').run(rid2, 'Region Lain', 'OTH', 'pw');
      st('INSERT INTO dermagas (id, region_id, name, code) VALUES (?, ?, ?, ?)').run(did, rid, 'Dermaga E2E', 'E2E-D1');
      st('INSERT INTO officers (id, name, pin, region_id, is_active) VALUES (?, ?, ?, ?, 1)').run(oid, 'Petugas E2E', '123456', rid);
      st('INSERT OR IGNORE INTO officer_regions (officer_id, region_id) VALUES (?, ?)').run(oid, rid);
      st('INSERT OR IGNORE INTO officer_dermagas (officer_id, dermaga_id) VALUES (?, ?)').run(oid, did);
      // Petugas region LAIN — tidak boleh muncul di roster my-region
      st('INSERT INTO officers (id, name, pin, region_id, is_active) VALUES (?, ?, ?, ?, 1)').run(randomUUID(), 'Petugas Lain', '654321', rid2);
      console.log(out(rid + ' ' + oid));
    });
    function out(x) { return 'SEEDED ' + x; }
  `);
  const seed = spawnSync(process.execPath, [seedScript], { encoding: 'utf8', timeout: 30000 });
  const seedRaw = String(seed.stdout || '').split('SEEDED ')[1] || '';
  const [seededRegionId, seededOfficerId] = seedRaw.trim().split('\n')[0].split(' ');
  if (!seededOfficerId || !seededRegionId) {
    console.error('SEED GAGAL:\n' + seed.stdout + seed.stderr);
    process.exit(1);
  }
  console.log('Seed OK — officerId:', seededOfficerId, '| regionId:', seededRegionId);

  // ── Boot server (env terisolasi, uploads & DB di temp) ────────────────────
  const child = spawn(process.execPath, [path.join(BACKEND, 'src/index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET,
      ADMIN_PASSWORD: ADMIN_PASS,
      DB_PATH: path.join(TMP, 'trip.db'),
      UPLOADS_DIR: path.join(TMP, 'uploads'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const bootLogs = [];
  child.stdout.on('data', d => bootLogs.push(String(d)));
  child.stderr.on('data', d => bootLogs.push(String(d)));

  const base = `http://127.0.0.1:${PORT}`;
  let up = false;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) { up = true; break; }
    } catch { /* belum hidup */ }
    await new Promise(r => setTimeout(r, 500));
  }
  if (!up) {
    console.error('SERVER GAGAL BOOT:\n' + bootLogs.join(''));
    child.kill();
    process.exit(1);
  }
  console.log('Server boot OK (port ' + PORT + ', DB sementara)\n');

  function jwtSign(payload) {
    const lib = require(path.join(BACKEND, 'node_modules/jsonwebtoken'));
    return lib.sign(payload, JWT_SECRET, { expiresIn: '1h' });
  }
  const headers = {
    officer: { Authorization: `Bearer ${jwtSign({ officerId: seededOfficerId, regionId: seededRegionId, role: 'officer' })}` },
    admin: { Authorization: `Bearer ${jwtSign({ role: 'admin', username: 'admin' })}` },
  };
  const adminToken = headers.admin.Authorization;

  // ── A: admin-login password salah → 401 ───────────────────────────────────
  const badAdmin = await fetch(`${base}/api/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password-salah' }),
  });
  console.log('[A] admin-login password salah →', badAdmin.status);
  check('A1 password salah → 401 (bukan fallback admin123)', badAdmin.status === 401, 'status=' + badAdmin.status);

  // ── B: my-region ──────────────────────────────────────────────────────────
  const mr = await fetch(`${base}/api/officers/my-region`, { headers: headers.officer });
  const mrb = await mr.json().catch(() => ({}));
  console.log('\n[B] GET /api/officers/my-region →', mr.status);
  const roster = Array.isArray(mrb.officers) ? mrb.officers : Array.isArray(mrb) ? mrb : mrb.roster || [];
  check('B1 my-region sukses dengan token petugas', mr.ok, JSON.stringify(mrb).slice(0, 300));
  if (mr.ok) {
    const names = roster.map(o => o.name);
    check('B2 roster berisi Petugas E2E (self-include)', names.includes('Petugas E2E'), JSON.stringify(names));
    check('B3 roster TIDAK berisi Petugas Lain (privacy fix)', !names.includes('Petugas Lain'), JSON.stringify(names));
  }

  // ── C: trips upsert (multipart × 2) ───────────────────────────────────────
  const mkForm = () => {
    const f = new FormData();
    f.append('payload', JSON.stringify({
      clientTripId: 'e2e-trip-upsert-1',
      statusMuatan: 'kosong',
      routeFrom: 'E2E',
      routeTo: 'E2E',
      tripPhotoIndex: 0,
      vehicles: [{ noPolisi: 'E2E 123', vehicleType: 'Motor', golongan: 'I', hasLoad: false, photoIndex: 1, tariffAmount: 8000, latitude: -6.19, longitude: 106.84 }],
    }));
    const blob = () => new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: 'image/jpeg' });
    f.append('photos', blob(), 'trip.jpg');
    f.append('photos', blob(), 'vehicle.jpg');
    return f;
  };
  const t1 = await fetch(`${base}/api/trips/complete`, { method: 'POST', headers: headers.officer, body: mkForm() });
  const t1b = await t1.json().catch(() => ({}));
  const t2 = await fetch(`${base}/api/trips/complete`, { method: 'POST', headers: headers.officer, body: mkForm() });
  const t2b = await t2.json().catch(() => ({}));
  if (t1.status >= 500) console.log('--- server logs (500) ---\n' + bootLogs.join('').split('Initializing').pop());
  console.log('\n[C] POST /api/trips/complete #1 →', t1.status, '| #2 →', t2.status);
  check('C1 submit trip pertama sukses (201)', t1.status === 201, JSON.stringify(t1b).slice(0, 300));
  check('C2 retry (upsert) sukses (200)', t2.status === 200, JSON.stringify(t2b).slice(0, 300));
  check('C3 no_trip sama di kedua submit (bukan duplikat)', t1b.noTrip && t1b.noTrip === t2b.noTrip, `${t1b.noTrip} vs ${t2b.noTrip}`);

  // ── D: clamp radius geofence ──────────────────────────────────────────────
  const postGeo = async (body) => fetch(`${base}/api/geofences`, {
    method: 'POST',
    headers: { ...headers.admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowedRouteCodes: ['A-B'], ...body }),
  });
  console.log('\n[D] clamp radius geofence');
  check('D1 radius 45000 → 201+', (await postGeo({ locationName: 'E2E r45000', latitude: -6.19, longitude: 106.84, radiusMeters: 45000 })).status === 201);
  check('D2 radius 0 → 201', (await postGeo({ locationName: 'E2E r0', latitude: -6.19, longitude: 106.84, radiusMeters: 0 })).status === 201);
  check('D3 radius 250 → 201', (await postGeo({ locationName: 'E2E r250', latitude: -6.19, longitude: 106.84, radiusMeters: 250 })).status === 201);
  const rows = await (await fetch(`${base}/api/geofences`, { headers: headers.admin })).json();
  const got = n => (rows.find(g => g.locationName === 'E2E r' + n) || {}).radiusMeters;
  check('D4 clamp 45000 → 100', got('45000') === 100, 'got=' + got('45000'));
  check('D5 clamp 0 → 100', got('0') === 100, 'got=' + got('0'));
  check('D6 radius 250 tetap 250', got('250') === 250, 'got=' + got('250'));
  check('D7 payload koordinat number, bukan string placeholder', rows.every(g => typeof g.latitude === 'number' && typeof g.longitude === 'number'));
  const bad = await postGeo({ locationName: 'E2E placeholder', latitude: 'Otomatis dari Link Maps', longitude: 106.84 });
  check('D8 latitude placeholder string → 400', bad.status === 400, 'status=' + bad.status);

  // ── E: resolve-link SSRF guard ────────────────────────────────────────────
  console.log('\n[E] resolve-link SSRF allowlist');
  const e1 = await fetch(`${base}/api/geofences/resolve-link?url=${encodeURIComponent('http://127.0.0.1:22/')}`, { headers: headers.admin });
  check('E1 host internal 127.0.0.1 → 400', e1.status === 400, 'status=' + e1.status);
  const e2 = await fetch(`${base}/api/geofences/resolve-link?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`, { headers: headers.admin });
  check('E2 metadata cloud 169.254.169.254 → 400', e2.status === 400, 'status=' + e2.status);

  console.log('\n' + (failures === 0 ? 'SMOKETEST LULUS SEMUA' : `${failures} CHECK GAGAL`));
  child.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* temp */ }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH:', e); process.exit(1); });
