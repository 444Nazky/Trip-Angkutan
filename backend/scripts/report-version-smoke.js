/**
 * report-version-smoke.js — regresi untuk endpoint telemetri versi perangkat.
 *
 * Latar: `src/services/ota.ts` (reportOtaVersion) memanggil
 * `POST /api/v1/report-version` setiap selesai OTA dan hanya menganggap HTTP 200
 * sebagai berhasil. Route itu dulu tidak pernah ada di backend, jadi setiap
 * laporan berakhir 404 ("Cannot POST /api/v1/report-version") dan tidak ada satu
 * pun versi perangkat yang tercatat.
 *
 * Skrip ini menjalankan server seperti produksi di DB kosong, lalu memastikan:
 *   A. laporan perangkat diterima (200, tanpa token — seperti CapacitorHttp),
 *   B. laporan ulang TIDAK menggandakan baris (upsert, versi terakhir menang),
 *   C. dua perangkat terhitung terpisah pada versi yang sama,
 *   D. payload tidak valid ditolak 400 (deviceId/version kosong, terlalu panjang),
 *   E. daftar sebaran versi hanya bisa dibaca admin (401 tanpa token),
 *   F. baris benar-benar tersimpan di berkas DB (volume /data produksi).
 *
 * Jalankan: node scripts/report-version-smoke.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const BACKEND = path.resolve(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'trip-report-version-'));
const PORT = 45826;
const JWT_SECRET = 'report-' + crypto.randomBytes(8).toString('hex');
const ADMIN_PASS = 'report-admin-' + crypto.randomBytes(6).toString('hex');

let failures = 0;

function check(name, cond, extra = '') {
  console.log((cond ? '  ok ' : '  FAIL ') + name + (cond ? '' : `  << ${extra}`));
  if (!cond) failures++;
}

const post = (base, body, headers = {}) => fetch(`${base}/api/v1/report-version`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
  body: JSON.stringify(body),
});

async function main() {
  const dbPath = path.join(TMP, 'trip.db');

  // ── 1. Boot server seperti produksi (migrasi + CREATE TABLE berjalan) ──────
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

  const jwtSign = payload => require(path.join(BACKEND, 'node_modules/jsonwebtoken'))
    .sign(payload, JWT_SECRET, { expiresIn: '1h' });
  const admin = { Authorization: `Bearer ${jwtSign({ role: 'admin', username: 'admin' })}` };

  // ── A. Laporan perangkat (tanpa token, seperti CapacitorHttp) ─────────────
  console.log('[A] POST /api/v1/report-version (klien OTA, tanpa token)');
  const devA = await post(base, { deviceId: 'device-A', version: '1.0.17', platform: 'android' });
  const devABody = await devA.json().catch(() => ({}));
  check('A1 tidak 404 (dulu "Cannot POST /api/v1/report-version")', devA.status !== 404, `status=${devA.status}`);
  check('A2 status 200 (klien hanya menerima 200)', devA.status === 200, `status=${devA.status} ${JSON.stringify(devABody)}`);
  check('A3 body sukses', devABody.success === true, JSON.stringify(devABody));

  // ── B. Laporan ulang: versi terakhir menang, baris tidak bertambah ─────────
  console.log('\n[B] Laporan ulang setelah OTA berikutnya (upsert)');
  const devA2 = await post(base, { deviceId: 'device-A', version: '1.0.18', platform: 'android' });
  check('B1 status 200', devA2.status === 200, `status=${devA2.status}`);
  const sum1 = await (await fetch(`${base}/api/v1/device-versions`, { headers: admin })).json().catch(() => null);
  check('B2 perangkat dicatat satu kali saja (bukan dua baris)', sum1 && sum1.totalDevices === 1, JSON.stringify(sum1));
  const aRow = (sum1?.versions || []).find(v => v.version === '1.0.18');
  check('B3 versi terakhir yang tercatat (1.0.18)', Boolean(aRow), JSON.stringify(sum1?.versions));
  check('B4 versi lama tidak tertinggal sebagai baris terpisah',
    !(sum1?.versions || []).some(v => v.version === '1.0.17' && v.devices === 1),
    JSON.stringify(sum1?.versions));

  // ── C. Dua perangkat pada versi yang sama ────────────────────────────────
  console.log('\n[C] Perangkat kedua pada versi yang sama');
  await post(base, { deviceId: 'device-B', version: '1.0.18', platform: 'android' });
  const sum2 = await (await fetch(`${base}/api/v1/device-versions`, { headers: admin })).json().catch(() => null);
  const row18 = (sum2?.versions || []).find(v => v.version === '1.0.18');
  check('C1 totalDevices = 2', sum2 && sum2.totalDevices === 2, JSON.stringify(sum2));
  check('C2 versi 1.0.18 terpakai 2 perangkat', row18 && row18.devices === 2, JSON.stringify(row18));

  // ── D. Payload tidak valid ───────────────────────────────────────────────
  console.log('\n[D] Validasi payload');
  const noVersion = await post(base, { deviceId: 'device-C' });
  check('D1 tanpa version → 400', noVersion.status === 400, `status=${noVersion.status}`);
  const noDevice = await post(base, { version: '1.0.18' });
  check('D2 tanpa deviceId → 400', noDevice.status === 400, `status=${noDevice.status}`);
  const tooLong = await post(base, { deviceId: 'x'.repeat(129), version: '1.0.18' });
  check('D3 deviceId > 128 karakter → 400', tooLong.status === 400, `status=${tooLong.status}`);
  const badVersion = await post(base, { deviceId: 'device-C', version: 'v'.repeat(33) });
  check('D4 version > 32 karakter → 400', badVersion.status === 400, `status=${badVersion.status}`);

  // ── E. Sebaran versi hanya untuk admin ───────────────────────────────────
  console.log('\n[E] Akses daftar sebaran versi');
  const noAuth = await fetch(`${base}/api/v1/device-versions`);
  check('E1 tanpa token → 401', noAuth.status === 401, `status=${noAuth.status}`);

  // ── F. Data benar-benar tersimpan di berkas DB (volume /data) ────────────
  console.log('\n[F] Persistensi ke berkas DB');
  const persisted = await new Promise(resolve => {
    const probe = `
      const initSqlJs = require(${JSON.stringify(path.join(BACKEND, 'node_modules/sql.js'))});
      const fs = require('fs');
      initSqlJs().then(SQL => {
        const db = new SQL.Database(fs.readFileSync(${JSON.stringify(dbPath)}));
        const stmt = db.prepare('SELECT device_id, version, report_count FROM device_versions ORDER BY device_id');
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        console.log('ROWS ' + JSON.stringify(rows));
      }).catch(e => { console.error(e); process.exit(1); });
    `;
    const probeFile = path.join(TMP, 'probe.js');
    fs.writeFileSync(probeFile, probe);
    const p = require('child_process').spawnSync(process.execPath, [probeFile], { encoding: 'utf8', timeout: 30000 });
    const m = String(p.stdout || '').match(/ROWS (.*)/);
    resolve(m ? JSON.parse(m[1]) : null);
  });
  check('F1 baris tersimpan di berkas DB (bukan hanya di memori)', Array.isArray(persisted) && persisted.length === 2, JSON.stringify(persisted));
  const persistedA = (persisted || []).find(r => r.device_id === 'device-A');
  check('F2 report_count device-A = 2 (dua laporan)', persistedA && Number(persistedA.report_count) === 2, JSON.stringify(persistedA));

  console.log('\n' + (failures === 0 ? 'REPORT VERSION SMOKE LULUS' : `${failures} CHECK GAGAL`));
  child.kill();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(e => { console.error('CRASH:', e); process.exit(1); });
