#!/usr/bin/env node
// ─── Publish APK (mode terbit ulang / republish) ─────────────────────────────
//
// Kenapa script ini ada?
//
// `publish-apk.mjs` memakai endpoint POST /publish-version, yang memakai
// INSERT. Kalau versi sudah ada di tabel `app_versions` (kolom `version`
// bertipe UNIQUE), publish kedua gagal dengan 500 - padahal berkas APK-nya
// SUDAH tersimpan di server (upload ke disk terjadi sebelum insert). Akibatnya
// berkas di server versi baru, tapi hash di database masih hash versi lama.
// Aplikasi mobile memverifikasi hash sebelum memasang -> "Hash APK tidak
// cocok" dan tombol update tidak pernah berhasil.
//
// Script ini memakai endpoint POST /admin/import dengan mode "replace" khusus
// tabel `app_versions`: metadata versi lama dipertahankan (dikumpulkan dari
// endpoint baca yang tersedia), baris versi target ditulis ulang dengan hash
// & ukuran berkas yang benar, dan berkas APK dikirim ulang ke bucket `apks`.
//
// Pemakaian:
//   node scripts/publish-apk-republish.mjs --apk=./app.apk --version=1.0.3 \
//        [--notes="..."] [--min-version=1.0.2] [--force-update] \
//        [--server=http://192.168.1.123:3000/api] [--token=...]

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { URL } from 'node:url';

const ARGUMENTS = {
  '--apk': { required: true, description: 'Lokasi berkas APK' },
  '--version': { required: true, description: 'Versi (X.Y.Z)' },
  '--server': { default: process.env.TRIP_API_URL || 'http://192.168.1.123:3000/api', description: 'Alamat endpoint API' },
  '--notes': { description: 'Catatan rilis (opsional)' },
  '--min-version': { description: 'Versi minimum yang didukung' },
  '--force-update': { flag: true, description: 'Tandai sebagai pembaruan wajib' },
  '--token': { default: process.env.ADMIN_TOKEN || '', description: 'Token admin (opsional bila server intranet memakai ADMIN_AUTH_DISABLED=1)' },
  '--dry-run': { flag: true, description: 'Tampilkan rencana tanpa menulis ke server' },
};

function parseArgs(args) {
  const result = {};
  let i = 2;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 2) {
        result[arg.slice(2, eq)] = arg.slice(eq + 1);
        i++;
        continue;
      }
      const key = arg.replace(/^--/, '');
      if (ARGUMENTS[`--${key}`]?.flag) {
        result[key] = true;
        i++;
        continue;
      }
      const next = args[i + 1];
      if (!next || next.startsWith('--')) {
        console.error(`Error: ${arg} requires a value`);
        process.exit(1);
      }
      result[key] = next;
      i += 2;
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }
  for (const [key, config] of Object.entries(ARGUMENTS)) {
    const prop = key.replace(/^--/, '');
    if (config.required && !result[prop]) {
      console.error(`Error: --${prop} is required`);
      process.exit(1);
    }
    if (result[prop] === undefined && config.default !== undefined) result[prop] = config.default;
  }
  return result;
}

function printHelp() {
  console.log(`
Publish APK (terbit ulang) - Custom Self-Hosted Update System

Pemakaian:
  node scripts/publish-apk-republish.mjs --apk=/path/ke/app.apk --version=1.0.3 [opsi]

Argumen:
${Object.entries(ARGUMENTS).map(([key, config]) => {
  const wajib = config.required ? '(wajib)' : config.flag ? '(flag)' : `(bawaan: ${config.default})`;
  return `  ${key.padEnd(20)} ${wajib} ${config.description}`;
}).join('\n')}

Catatan:
  - Dipakai kalau versi SUDAH ada di server (publish kedua selalu ditolak
    karena kolom version bertipe UNIQUE).
  - Metadata versi lain di tabel app_versions dipertahankan.
  - Hash & ukuran APK dihitung ulang dari berkas yang dikirim.
  - Endpoint /admin/import butuh hak admin. Server intranet biasanya
    memakai ADMIN_AUTH_DISABLED=1 sehingga tanpa token pun diterima.
`);
}

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: 120000,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          if (options.binary) {
            resolve({ status: res.statusCode, buffer: raw });
            return;
          }
          const text = raw.toString('utf8');
          try { resolve({ status: res.statusCode, data: JSON.parse(text) }); }
          catch { resolve({ status: res.statusCode, data: text }); }
        });
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    if (options.body) req.write(options.body);
    req.end();
  });
}

function findAapt2() {
  const roots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Android', 'Sdk')];
  const candidates = [];
  for (const root of roots) {
    if (!root) continue;
    const dir = path.join(root, 'build-tools');
    if (!fs.existsSync(dir)) continue;
    for (const v of fs.readdirSync(dir).sort().reverse()) candidates.push(path.join(dir, v, 'aapt2'));
  }
  return candidates.find((c) => { try { fs.accessSync(c, fs.constants.X_OK); return true; } catch { return false; } }) ?? null;
}

function detectApkBadging(apkPath) {
  const aapt2 = findAapt2();
  if (!aapt2) return { versionName: null, versionCode: null };
  try {
    const out = execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const line = out.split('\n').find((l) => l.startsWith('package:')) ?? '';
    return {
      versionName: /versionName='([^']*)'/.exec(line)?.[1] ?? null,
      versionCode: Number(/versionCode='([0-9]+)'/.exec(line)?.[1]) || null,
    };
  } catch {
    return { versionName: null, versionCode: null };
  }
}

const compareVersions = (a, b) => {
  const pa = String(a).split('.').map((n) => Number(n) || 0);
  const pb = String(b).split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
};

async function main() {
  const args = parseArgs(process.argv);
  const server = String(args.server).replace(/\/$/, '');
  const authHeaders = args.token ? { Authorization: `Bearer ${args.token}` } : {};

  if (!fs.existsSync(args.apk)) {
    console.error(`Berkas APK tidak ditemukan: ${args.apk}`);
    process.exit(1);
  }
  if (!/^\d+\.\d+\.\d+$/.test(args.version)) {
    console.error(`Format versi tidak sah: ${args.version}`);
    process.exit(1);
  }

  const bytes = fs.readFileSync(args.apk);
  const apkHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const apkSize = bytes.length;
  const badging = detectApkBadging(args.apk);

  console.log('\nPublish ulang APK - Custom Self-Hosted Update System\n');
  console.log('─'.repeat(56));
  console.log(`Berkas APK : ${args.apk}`);
  console.log(`Ukuran     : ${apkSize} byte`);
  console.log(`SHA-256    : ${apkHash}`);
  console.log(`Isi APK    : versionName=${badging.versionName ?? '?'} versionCode=${badging.versionCode ?? '?'}`);
  console.log(`Versi      : ${args.version}`);
  console.log(`Server     : ${server}`);

  if (badging.versionName && badging.versionName !== args.version) {
    console.error(`\nAPK berisi versionName '${badging.versionName}', bukan '${args.version}'.`);
    console.error('Setelah dipasang, versi di HP tidak akan naik - update akan dianggap belum selesai.');
    process.exit(1);
  }

  // ── Kumpulkan metadata versi yang sudah ada di server ─────────────────────
  const origin = server.replace(/\/api$/, '');
  const listRes = await httpRequest(`${server}/apk-list`);
  const existing = (listRes.data?.apks ?? []).map((a) => a.version);

  const latestRes = await httpRequest(`${server}/app-version?current=0.0.0`);
  const latest = latestRes.data ?? {};

  // APK milik versi lain diunduh dari server supaya hash/ukuran/versionName
  // dihitung ulang dari berkas yang benar-benar tersimpan di disk server -
  // bukan sekadar nilai yang tercatat di DB (yang bisa saja basi).
  async function inspectRemoteApk(version) {
    try {
      const res = await httpRequest(`${origin}/files/apks/app-${version}.apk`, { binary: true });
      if (res.status !== 200 || !res.buffer || res.buffer.length < 1_000_000) return null;
      const tmp = path.join(os.tmpdir(), `inspect-${version}-${Date.now()}.apk`);
      fs.writeFileSync(tmp, res.buffer);
      const info = detectApkBadging(tmp);
      fs.unlinkSync(tmp);
      return {
        hash: crypto.createHash('sha256').update(res.buffer).digest('hex'),
        size: res.buffer.length,
        versionName: info.versionName,
        versionCode: info.versionCode,
      };
    } catch {
      return null;
    }
  }

  const rows = [];
  for (const version of existing) {
    if (version === args.version) continue; // ditulis ulang di bawah
    const notesRes = await httpRequest(`${server}/release-notes/${encodeURIComponent(version)}`);
    const items = notesRes.data?.notes ?? [];
    const isLatest = version === latest.latestVersion;
    const remote = isLatest ? null : await inspectRemoteApk(version);
    rows.push({
      version,
      download_url: `/files/apks/app-${version}.apk`,
      release_date: notesRes.data?.releaseDate ?? latest.releaseDate ?? new Date().toISOString(),
      release_notes: items.map((n) => n.title).join('\n'),
      is_force_update: isLatest ? Boolean(latest.isForceUpdate) : false,
      min_version: isLatest ? (latest.minVersion ?? null) : null,
      apk_size: remote?.size ?? (isLatest ? (latest.apkSize ?? null) : null),
      apk_hash: remote?.hash ?? (isLatest ? (latest.apkHash ?? null) : null),
      apk_version_name: remote?.versionName ?? (isLatest ? (badging.versionName ?? null) : null),
      apk_version_code: remote?.versionCode ?? (isLatest ? (badging.versionCode ?? null) : null),
      created_at: notesRes.data?.releaseDate ?? new Date().toISOString(),
    });
  }

  const sameAsLatest = latest.latestVersion === args.version;
  rows.push({
    version: args.version,
    download_url: `/files/apks/app-${args.version}.apk`,
    release_date: new Date().toISOString(),
    release_notes: args.notes || `Update ke versi ${args.version}`,
    is_force_update: args.forceUpdate ?? (sameAsLatest ? Boolean(latest.isForceUpdate) : false),
    min_version: args.minVersion ?? (sameAsLatest ? (latest.minVersion ?? null) : null),
    apk_size: apkSize,
    apk_hash: apkHash,
    apk_version_name: badging.versionName ?? null,
    apk_version_code: badging.versionCode ?? null,
    created_at: new Date().toISOString(),
  });

  rows.sort((a, b) => compareVersions(a.version, b.version));

  console.log('─'.repeat(56));
  console.log('Baris app_versions yang akan ditulis:');
  for (const r of rows) {
    console.log(`  ${r.version.padEnd(8)} hash=${(r.apk_hash ?? '?').slice(0, 12).padEnd(14)} ukuran=${r.apk_size ?? '-'}`);
  }

  if (args['dry-run']) {
    console.log('\n[dry-run] Tidak ada yang ditulis ke server.');
    return;
  }

  const payload = {
    mode: 'replace',
    tables: { app_versions: rows },
    files: { apks: { [`app-${args.version}.apk`]: bytes.toString('base64') } },
  };

  console.log('\nMengirim ke /admin/import ...');
  const res = await httpRequest(`${server}/admin/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(payload),
  });

  if (res.status !== 200) {
    console.error('Publish gagal:', res.status, JSON.stringify(res.data));
    process.exit(1);
  }
  console.log('Respons server:', JSON.stringify(res.data));

  // ── Verifikasi ────────────────────────────────────────────────────────────
  const check = await httpRequest(`${server}/app-version?current=0.0.0`);
  const now = check.data ?? {};
  const dl = await httpRequest(`${origin}/files/apks/app-${args.version}.apk`, { binary: true });
  const dlHash = dl.status === 200 && dl.buffer
    ? crypto.createHash('sha256').update(dl.buffer).digest('hex')
    : '(gagal unduh)';

  console.log('─'.repeat(56));
  console.log(`latestVersion : ${now.latestVersion}`);
  console.log(`apkHash (db) : ${now.apkHash}`);
  console.log(`apkHash (file): ${dlHash}`);
  console.log(`downloadUrl   : ${now.downloadUrl}`);

  if (now.apkHash !== apkHash) {
    console.error('\nPERINGATAN: hash di database tidak sama dengan berkas yang dikirim.');
    process.exit(1);
  }
  if (dlHash !== apkHash) {
    console.error('\nPERINGATAN: berkas yang bisa diunduh server berbeda dari berkas yang dikirim.');
    process.exit(1);
  }
  console.log('\nOK - versi ' + args.version + ' terbit dan bisa diunduh perangkat.');
}

main().catch((error) => {
  console.error('\nTerjadi kesalahan tak terduga:', error);
  process.exit(1);
});
