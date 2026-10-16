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
  const seedScript = path.join(TMP, 'seed.js');
  fs.writeFileSync(seedScript, `
    process.env.DB_PATH = ${JSON.stringify(path.join(TMP, 'trip.db'))};
    const dbModule = require(${JSON.stringify(path.join(BACKEND, 'src/db.js'))});
    dbModule.loadDb().then(() => {
      const { db } = dbModule;
      const { randomUUID } = require('crypto');
      const bcrypt = require(${JSON.stringify(path.join(BACKEND, 'node_modules/bcryptjs'))});
      const rid = randomUUID(), rid2 = randomUUID(), did = randomUUID(), oid = randomUUID();
      const st = sql => db.prepare(sql);
      st('INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)').run(rid, 'Region E2E', 'E2E', 'pw');
      st('INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)').run(rid2, 'Region Lain', 'OTH', 'pw');
      st('INSERT INTO dermagas (id, region_id, name, code) VALUES (?, ?, ?, ?)').run(did, rid, 'Dermaga E2E', 'E2E-D1');
      st('INSERT INTO officers (id, name, pin, region_id, is_active) VALUES (?, ?, ?, ?, 1)').run(oid, 'Petugas E2E', bcrypt.hashSync('123456', 10), rid);
      st('INSERT OR IGNORE INTO officer_regions (officer_id, region_id) VALUES (?, ?)').run(oid, rid);
      st('INSERT OR IGNORE INTO officer_dermagas (officer_id, dermaga_id) VALUES (?, ?)').run(oid, did);
      st('INSERT INTO officers (id, name, pin, region_id, is_active) VALUES (?, ?, ?, ?, 1)').run(randomUUID(), 'Petugas Lain', bcrypt.hashSync('654321', 10), rid2);
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

  const child = spawn(process.execPath, [path.join(BACKEND, 'src/index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET,
      ADMIN_PASSWORD: ADMIN_PASS,
      DB_PATH: path.join(TMP, 'trip.db'),
      UPLOADS_DIR: path.join(TMP, 'uploads'),
      // Metadata/APK diarahkan ke temp: uji update TIDAK boleh mengubah berkas
      // metadata/APK repo (dulu bisa "mem-publish" versi palsu ke repo).
      METADATA_DIR: path.join(TMP, 'metadata'),
      APK_DIR: path.join(TMP, 'apks'),
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
    } catch {}
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

  const badAdmin = await fetch(`${base}/api/auth/admin-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'password-salah' }),
  });
  console.log('[A] admin-login password salah →', badAdmin.status);
  check('A1 password salah → 401 (bukan fallback admin123)', badAdmin.status === 401, 'status=' + badAdmin.status);

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

  console.log('\n[E] resolve-link SSRF allowlist');
  const e1 = await fetch(`${base}/api/geofences/resolve-link?url=${encodeURIComponent('http://127.0.0.1:22/')}`, { headers: headers.admin });
  check('E1 host internal 127.0.0.1 → 400', e1.status === 400, 'status=' + e1.status);
  const e2 = await fetch(`${base}/api/geofences/resolve-link?url=${encodeURIComponent('http://169.254.169.254/latest/meta-data/')}`, { headers: headers.admin });
  check('E2 metadata cloud 169.254.169.254 → 400', e2.status === 400, 'status=' + e2.status);

  // [G] Titik geofence yang dibuat admin dashboard TIDAK mengirim dermagaId →
  // tersimpan dermaga_id NULL. Dulu GET ?dermagaId=<uuid> hanya mencari
  // `dermaga_id = ?` sehingga titik itu tak pernah sampai ke HP petugas
  // ("Belum ada titik geofence tersimpan") dan input trip terkunci.
  console.log('\n[G] sinkron geofence petugas (titik berlaku umum harus ikut terkirim)');
  const anyDermaga = crypto.randomUUID();
  const gRes = await fetch(`${base}/api/geofences?dermagaId=${anyDermaga}`, { headers: headers.officer });
  const gRows = await gRes.json().catch(() => null);
  check('G1 petugas (bukan admin) boleh membaca master geofence', gRes.ok, 'status=' + gRes.status);
  check('G2 titik tanpa dermaga (NULL) ikut terkirim ke petugas',
    Array.isArray(gRows) && gRows.some(g => g.locationName === 'E2E r250'),
    JSON.stringify(Array.isArray(gRows) ? gRows.map(g => g.locationName) : gRows).slice(0, 200));
  check('G3 payload memuat allowedRouteCodes (dipakai scoping mobile)',
    Array.isArray(gRows) && gRows.every(g => Array.isArray(g.allowedRouteCodes)),
    JSON.stringify(gRows && gRows[0]));
  const gAll = await (await fetch(`${base}/api/geofences`, { headers: headers.admin })).json();
  check('G4 tanpa filter → master lengkap (dashboard)', Array.isArray(gAll) && gAll.length >= (Array.isArray(gRows) ? gRows.length : 0),
    `all=${Array.isArray(gAll) ? gAll.length : 'n/a'} filtered=${Array.isArray(gRows) ? gRows.length : 'n/a'}`);

  // [F] CORS — origin dev/native harus selalu dapat Access-Control-Allow-Origin,
  // supaya dev-server (localhost:5173) dan shell Capacitor tidak diblokir browser
  // walau NODE_ENV=production + CORS_ORIGIN whitelist di Railway.
  console.log('\n[F] CORS origin dev & preflight');
  const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:49812', 'capacitor://localhost'];
  for (const origin of devOrigins) {
    const res = await fetch(`${base}/api/health`, { headers: { Origin: origin } });
    const acao = res.headers.get('access-control-allow-origin');
    check(`F ACAO untuk ${origin}`, res.ok && acao === origin, `status=${res.status} acao=${acao}`);
  }

  const pre = await fetch(`${base}/api/v1/app-version`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:5173',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  const preAcao = pre.headers.get('access-control-allow-origin');
  const preHeaders = String(pre.headers.get('access-control-allow-headers') || '').toLowerCase();
  check('F preflight dev origin → 204 + ACAO', pre.status === 204 && preAcao === 'http://localhost:5173', `status=${pre.status} acao=${preAcao}`);
  check('F preflight mengizinkan header authorization', preHeaders.includes('authorization'), 'allow-headers=' + preHeaders);

  if (String(process.env.CORS_ORIGIN || '').trim() === '*') {
    console.log('  (lewati kontrol negatif: CORS_ORIGIN=* mengizinkan semua origin)');
  } else {
    const evil = await fetch(`${base}/api/health`, { headers: { Origin: 'https://not-allowed.example.net' } });
    const evilAcao = evil.headers.get('access-control-allow-origin');
    check('F origin tak dikenal tetap TANPA ACAO', evil.ok && !evilAcao, `status=${evil.status} acao=${evilAcao}`);
    const whitelist = String(process.env.CORS_ORIGIN || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const origin of whitelist) {
      if (origin === '*') continue;
      const res = await fetch(`${base}/api/health`, { headers: { Origin: origin } });
      check(`F ACAO untuk whitelist ${origin}`, res.headers.get('access-control-allow-origin') === origin, 'acao=' + res.headers.get('access-control-allow-origin'));
    }
  }

  // [H] API update TIDAK BOLEH mengiklankan paket yang tak bisa diunduh, dan
  // hash/ukuran harus nyata supaya klien bisa verifikasi integritas. Ini akar
  // kegagalan update produksi: versions.json menunjuk 1.0.12 tanpa berkas →
  // server bilang "ada update", aplikasi mengunduh → 404 → update selalu gagal.
  console.log('\n[H] API update (hanya iklankan paket nyata + hash asli)');
  const metadataDir = path.join(TMP, 'metadata');
  const apkDir = path.join(TMP, 'apks');
  fs.mkdirSync(metadataDir, { recursive: true });
  fs.mkdirSync(apkDir, { recursive: true });
  const fakeApk = crypto.randomBytes(1_100_000);
  fs.writeFileSync(path.join(apkDir, 'app-9.9.9.apk'), fakeApk);
  const fakeHash = crypto.createHash('sha256').update(fakeApk).digest('hex');
  fs.writeFileSync(path.join(metadataDir, 'versions.json'), JSON.stringify({
    latest: { version: '9.9.9', downloadUrl: '/api/v1/app-download/9.9.9', releaseNotes: 'E2E: perbaikan bug sinkronisasi', minVersion: '1.0.0', apkHash: fakeHash },
    releases: {
      '9.9.9': { version: '9.9.9', downloadUrl: '/api/v1/app-download/9.9.9', releaseNotes: 'E2E: perbaikan bug sinkronisasi', minVersion: '1.0.0' },
    },
  }, null, 2));

  const av = await (await fetch(`${base}/api/v1/app-version?current=1.0.0`)).json();
  check('H1 ada paket → updateAvailable true + downloadUrl', av.updateAvailable === true && Boolean(av.downloadUrl), JSON.stringify(av));
  // URL unduhan WAJIB absolut: klien versi lama menggabungkan path relatif terhadap
  // base URL-nya sendiri (`.../api` + `/api/v1/...`) → 404 JSON → "dokumen error"
  // dan update tak pernah berhasil di perangkat petugas.
  check('H1b downloadUrl ABSOLUT (bukan path relatif)', /^https?:\/\//i.test(String(av.downloadUrl)), 'url=' + av.downloadUrl);
  check('H2 apkHash NYATA (sha256 file, bukan null)', av.apkHash === fakeHash, `got=${av.apkHash}`);
  check('H3 apkSize NYATA', av.apkSize === fakeApk.length, `got=${av.apkSize} want=${fakeApk.length}`);
  const dl = await fetch(`${base}${String(av.downloadUrl).replace(/^https?:\/\/[^/]+/i, '')}`, { method: 'GET' });
  const dlBytes = Buffer.from(await dl.arrayBuffer());
  check('H4 berkas bisa diunduh + byte identik', dl.ok && dlBytes.length === fakeApk.length && crypto.createHash('sha256').update(dlBytes).digest('hex') === fakeHash, `status=${dl.status} size=${dlBytes.length}`);
  const rn = await fetch(`${base}/api/v1/release-notes/9.9.9`);
  const rnb = await rn.json().catch(() => ({}));
  check('H5 release-notes ada (mobile memanggilnya)', rn.ok && Array.isArray(rnb.notes) && rnb.notes.length > 0, `status=${rn.status} ${JSON.stringify(rnb).slice(0, 120)}`);
  const pubRel = await fetch(`${base}/api/v1/publish-version`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publish-secret': process.env.PUBLISH_SECRET || 'trip-angkut-secret' },
    body: JSON.stringify({ version: '9.9.10', downloadUrl: '/api/v1/app-download/9.9.10' }),
  });
  check('H6 publish dengan downloadUrl relatif ditolak (400)', pubRel.status === 400, 'status=' + pubRel.status);
  const pubOk = await fetch(`${base}/api/v1/publish-version`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-publish-secret': process.env.PUBLISH_SECRET || 'trip-angkut-secret' },
    body: JSON.stringify({ version: '9.9.11', downloadUrl: 'https://cdn.invalid.example/app-9.9.11.apk', releaseNotes: 'E2E' }),
  });
  check('H7 publish versi tanpa berkas lokal tetap 200 (metadata lengkap)', pubOk.status === 200, 'status=' + pubOk.status);

  // Metadata menunjuk versi tanpa berkas (persis bug produksi) → TIDAK diiklankan.
  fs.writeFileSync(path.join(metadataDir, 'versions.json'), JSON.stringify({
    latest: { version: '9.9.11', downloadUrl: '/api/v1/app-download/9.9.11', releaseNotes: 'E2E tanpa berkas', minVersion: '1.0.0' },
    releases: { '9.9.11': { version: '9.9.11', downloadUrl: '/api/v1/app-download/9.9.11', releaseNotes: 'E2E tanpa berkas', minVersion: '1.0.0' } },
  }, null, 2));
  const av2 = await (await fetch(`${base}/api/v1/app-version?current=1.0.0`)).json();
  check('H8 versi tanpa paket → updateAvailable false (tidak memicu update gagal)', av2.updateAvailable === false && av2.downloadUrl === null, JSON.stringify(av2));

  // Metadata yang mengaku 9.9.12 padahal berkasnya isi versi lain → JANGAN diiklankan.
  // Ini bug produksi nyata: app-1.0.8.apk berisi 1.0.6 → update "berhasil" tapi
  // versi aplikasi tak pernah berubah (popup update muncul terus).
  const fakeMismatch = crypto.randomBytes(1_100_000);
  fs.writeFileSync(path.join(apkDir, 'app-9.9.12.apk'), fakeMismatch);
  fs.writeFileSync(path.join(metadataDir, 'versions.json'), JSON.stringify({
    latest: { version: '9.9.12', downloadUrl: '/api/v1/app-download/9.9.12', releaseNotes: 'E2E salah label', minVersion: '1.0.0', apkVersionName: '9.9.9' },
    releases: { '9.9.12': { version: '9.9.12', downloadUrl: '/api/v1/app-download/9.9.12', releaseNotes: 'E2E salah label', minVersion: '1.0.0', apkVersionName: '9.9.9' } },
  }, null, 2));
  const av3 = await (await fetch(`${base}/api/v1/app-version?current=1.0.0`)).json();
  check('H9 paket salah label (apkVersionName ≠ versi) → tidak diiklankan',
    av3.updateAvailable === false && av3.downloadUrl === null, JSON.stringify(av3));

  // [I] Master tarif untuk petugas. Dulu SATU-SATUNYA endpoint tarif
  // (`/api/tariffs`) memakai requireAdmin, jadi HP petugas tak punya cara
  // membaca tarif resmi dan diam-diam memakai angka contoh di data.ts —
  // nominal yang tersimpan di trip tidak pernah sama dengan master admin.
  console.log('\n[I] master tarif untuk petugas (GET /api/master/tariffs)');
  const mkTariff = (body) => fetch(`${base}/api/tariffs`, {
    method: 'POST',
    headers: { ...headers.admin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ golongan: 'I', vehicleType: 'Motor', loadedTariff: 15000, emptyTariff: 8000, description: 'E2E', ...body }),
  });
  check('I1 admin bisa menambah tarif (master tetap bisa ditulis)', (await mkTariff({})).status === 201);
  check('I2 admin bisa menambah tarif kedua', (await mkTariff({ vehicleType: 'Truck Besar', golongan: 'V', loadedTariff: 275000, emptyTariff: 190000 })).status === 201);

  const noTok = await fetch(`${base}/api/master/tariffs`);
  check('I3 tanpa token → 401 (wajib login petugas)', noTok.status === 401, 'status=' + noTok.status);

  const offRes = await fetch(`${base}/api/master/tariffs`, { headers: headers.officer });
  const offRows = await offRes.json().catch(() => null);
  check('I4 token petugas boleh membaca tarif', offRes.ok, `status=${offRes.status} ${JSON.stringify(offRows).slice(0, 200)}`);
  check('I5 payload memuat field yang dipakai HP (vehicle_type/loaded_tariff/empty_tariff)',
    Array.isArray(offRows) && offRows.length > 0 && offRows.every(t => typeof t.vehicle_type === 'string' && typeof t.loaded_tariff === 'number' && typeof t.empty_tariff === 'number'),
    JSON.stringify(offRows).slice(0, 200));
  check('I6 tarif yang baru dibuat ikut terkirim ke petugas',
    Array.isArray(offRows) && offRows.some(t => t.vehicle_type === 'Truck Besar' && t.loaded_tariff === 275000 && t.empty_tariff === 190000),
    JSON.stringify(Array.isArray(offRows) ? offRows.map(t => `${t.vehicle_type}:${t.loaded_tariff}`) : offRows).slice(0, 200));
  const adminOnly = await fetch(`${base}/api/tariffs`, { headers: headers.officer });
  check('I7 /api/tariffs tetap khusus admin → 403 untuk petugas', adminOnly.status === 403, 'status=' + adminOnly.status);

  console.log('\n' + (failures === 0 ? 'SMOKETEST LULUS SEMUA' : `${failures} CHECK GAGAL`));
  child.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH:', e); process.exit(1); });
