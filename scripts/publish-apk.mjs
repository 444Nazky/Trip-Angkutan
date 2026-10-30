#!/usr/bin/env node
// ─── Publish APK Script ──────────────────────────────────────────────────────
// Unggah APK ke server intranet dan daftarkan sebagai versi terbaru.
// Pemakaian: node publish-apk.mjs --apk=/path/ke/app.apk --version=1.0.0 [opsi]

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import { execFileSync } from 'child_process';
import { URL } from 'url';

const ARGUMENTS = {
  '--apk': { required: true, description: 'Lokasi berkas APK' },
  '--version': { required: true, description: 'Versi (format semantik, contoh: 1.0.0)' },
  '--server': { default: process.env.TRIP_API_URL || 'http://192.168.1.123:3000/api', description: 'Alamat endpoint API intranet' },
  '--secret': { default: process.env.PUBLISH_SECRET || 'trip-angkut-secret', description: 'Secret publikasi' },
  '--force': { flag: true, description: 'Terbitkan ulang walau versinya sudah ada' },
  '--notes': { description: 'Catatan rilis (opsional)' },
  '--force-update': { flag: true, description: 'Tandai sebagai pembaruan wajib' },
  '--min-version': { description: 'Versi minimum yang didukung' },
  '--apk-version-name': { description: 'versionName di dalam APK (deteksi otomatis lewat aapt2 bila kosong)' },
  '--apk-version-code': { description: 'versionCode di dalam APK (deteksi otomatis lewat aapt2 bila kosong)' },
};

// ─── CLI Parser ─────────────────────────────────────────────────────────────

function parseArgs(args) {
  const result = {};
  let i = 2; // Skip node and script name

  while (i < args.length) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    if (arg.startsWith('--')) {
      // Bentuk `--key=nilai` harus jalan: inilah yang tertulis di help, tetapi
      // sebelumnya tidak pernah dikenali sehingga setiap pemakaian gagal.
      const eq = arg.indexOf('=');
      if (eq > 2) {
        result[arg.slice(2, eq)] = arg.slice(eq + 1);
        i++;
        continue;
      }

      const key = arg.replace(/^--/, '');

      // Check if it's a flag
      if (ARGUMENTS[`--${key}`]?.flag) {
        result[key] = true;
        i++;
        continue;
      }

      // It's a value argument
      const nextArg = args[i + 1];
      if (!nextArg || nextArg.startsWith('--')) {
        console.error(`Error: ${arg} requires a value`);
        process.exit(1);
      }

      result[key] = nextArg;
      i += 2;
    } else {
      console.error(`Error: Unknown argument: ${arg}`);
      printHelp();
      process.exit(1);
    }
  }

  // Validate required arguments + isi default yang belum diberikan.
  // Tanpa loop default ini, --server / --secret selalu undefined (header
  // X-Publish-Secret: undefined) sehingga publish selalu gagal di tangan pemakai.
  for (const [key, config] of Object.entries(ARGUMENTS)) {
    const prop = key.replace(/^--/, '');
    if (config.required && !result[prop]) {
      console.error(`Error: --${prop} is required`);
      process.exit(1);
    }
    if (result[prop] === undefined && config.default !== undefined) {
      result[prop] = config.default;
    }
  }

  return result;
}

function printHelp() {
  console.log(`
APK Publisher - Custom Self-Hosted Update System

Pemakaian:
  node publish-apk.mjs --apk=/path/ke/app.apk --version=1.0.0 [opsi]

Argumen:
${Object.entries(ARGUMENTS).map(([key, config]) => {
    const required = config.required ? '(wajib)' : config.flag ? '(flag)' : `(bawaan: ${config.default})`;
    return `  ${key.padEnd(20)} ${required} ${config.description}`;
  }).join('\n')}

Environment Variables:
  PUBLISH_SECRET     Secret untuk autentikasi ke server (bawaan: trip-angkut-secret)
  TRIP_API_URL       Alamat endpoint API intranet (bawaan: http://192.168.1.123:3000/api)

Contoh:
  node publish-apk.mjs --apk=./app-release.apk --version=1.0.0
  node publish-apk.mjs --apk=./app.apk --version=1.0.1 --force-update --notes="Perbaikan"
  node publish-apk.mjs --apk=./app.apk --version=2.0.0 --server=http://192.168.1.123:3000/api

Catatan:
  - Versi wajib memakai format semantik (X.Y.Z).
  - Isi APK dibaca lalu dikirim sebagai base64 ke server.
  - Server wajib menyediakan endpoint /publish-version.
  - Server yang dipakai adalah server intranet. APK disimpan di penyimpanan
    lokal server, sehingga perangkat tanpa akses internet tetap bisa
    mengunduh pembaruan.
`);
}

// ─── HTTP Client ────────────────────────────────────────────────────────────

function httpRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      timeout: 60000, // 60 second timeout for large files
    };

    const req = client.request(requestOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, data: json });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

// ─── File Utilities ─────────────────────────────────────────────────────────

function readFileAsBase64(filePath) {
  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, buffer) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(buffer.toString('base64'));
    });
  });
}

function getFileSize(filePath) {
  const stats = fs.statSync(filePath);
  return stats.size;
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function validateApkPath(apkPath) {
  if (!fs.existsSync(apkPath)) {
    return { valid: false, error: `APK file not found: ${apkPath}` };
  }

  const ext = path.extname(apkPath).toLowerCase();
  if (ext !== '.apk') {
    return { valid: false, error: `File must be an APK (.apk), got: ${ext}` };
  }

  return { valid: true };
}

function validateVersion(version) {
  const semverRegex = /^\d+\.\d+\.\d+$/;
  if (!semverRegex.test(version)) {
    return {
      valid: false,
      error: `Invalid version format. Expected semver (e.g., 1.0.0), got: ${version}`
    };
  }
  return { valid: true };
}



// aapt2 dari Android SDK (pola sama dengan verify-apks.mjs).
function findAapt2() {
  const candidates = [];
  if (process.env.AAPT2) candidates.push(process.env.AAPT2);
  const sdkRoots = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, path.join(os.homedir(), 'Android', 'Sdk')];
  for (const root of sdkRoots) {
    if (!root) continue;
    const buildTools = path.join(root, 'build-tools');
    if (fs.existsSync(buildTools)) {
      for (const v of fs.readdirSync(buildTools).sort().reverse()) {
        candidates.push(path.join(buildTools, v, 'aapt2'));
      }
    }
  }
  return candidates.find(c => {
    try { fs.accessSync(c, fs.constants.X_OK); return true } catch { return false }
  }) ?? null;
}



// Versi NYATA di dalam APK — nama berkas tidak boleh dipercaya (lihat verify-apks.mjs).
function detectApkBadging(apkPath) {
  const aapt2 = findAapt2();
  if (!aapt2) return { versionName: null, versionCode: null, aapt2: null };
  try {
    const out = execFileSync(aapt2, ['dump', 'badging', apkPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const line = out.split('\n').find(l => l.startsWith('package:')) ?? '';
    return {
      versionName: /versionName='([^']*)'/.exec(line)?.[1] ?? null,
      versionCode: Number(/versionCode='([0-9]+)'/.exec(line)?.[1]) || null,
      aapt2,
    };
  } catch {
    return { versionName: null, versionCode: null, aapt2 };
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv);

  console.log('\nAPK Publisher - Custom Self-Hosted Update System\n');
  console.log('─'.repeat(50));

  // Validate inputs
  const apkValidation = validateApkPath(args.apk);
  if (!apkValidation.valid) {
    console.error('Validasi gagal:', apkValidation.error);
    process.exit(1);
  }

  const versionValidation = validateVersion(args.version);
  if (!versionValidation.valid) {
    console.error('Validasi gagal:', versionValidation.error);
    process.exit(1);
  }

  const fileSize = getFileSize(args.apk);
  console.log(`Berkas APK : ${args.apk}`);
  console.log(`Ukuran     : ${formatBytes(fileSize)}`);
  console.log(`Versi      : ${args.version}`);
  console.log(`Server     : ${args.server}`);

  // Penanda versi asli: server memakainya untuk MENOLAK paket salah label.
  const badging = detectApkBadging(args.apk);
  // CATATAN: nama opsi CLI memakai strip (`--apk-version-name`), sedangkan
  // parser menyimpan apa adanya -> `args['apk-version-name']`. Kode lama
  // hanya membaca `args.apkVersionName` (camelCase) yang SELALU undefined,
  // jadi opsi ini diam-diam diabaikan dan kolom apk_version_name/
  // apk_version_code tersimpan null/0 di server. Bacalah kedua bentuk.
  const apkVersionName = (args.apkVersionName ?? args['apk-version-name']) || badging.versionName;
  const apkVersionCode = Number(args.apkVersionCode ?? args['apk-version-code']) || badging.versionCode;
  console.log(`Isi APK    : versionName=${apkVersionName ?? '?(aapt2 tidak ada)'} versionCode=${apkVersionCode ?? '?'}`);

  if (!badging.aapt2) {
    console.log('PERHATIAN: aapt2 tidak ditemukan - versi APK tidak bisa diverifikasi dari sini.');
  }
  if (apkVersionName && apkVersionName !== args.version) {
    console.error(`APK berisi '${apkVersionName}', bukan '${args.version}'.`);
    console.error('   Menerbitkannya membuat versi di HP tidak pernah naik. Pakai --force bila memang sadar.');
    if (!args.force) process.exit(1);
  }

  if (args.forceUpdate) {
    console.log('Force update : ya (wajib)');
  }

  if (args.force) {
    console.log('Force        : ya (timpa versi yang ada)');
  }

  console.log('─'.repeat(50));

  // Check server connectivity
  console.log('\nMemeriksa koneksi server...');
  try {
    const healthCheck = await httpRequest(`${args.server}/health`);
    if (healthCheck.status !== 200) {
      throw new Error(`Server returned status ${healthCheck.status}`);
    }
    console.log('Server dapat dihubungi.\n');
  } catch (error) {
    console.error('Tidak dapat menghubungi server:', error.message);
    console.error('   Pastikan server API intranet berjalan di alamat:', args.server);
    process.exit(1);
  }

  // Read APK file
  console.log('Membaca berkas APK...');
  let apkBase64;
  try {
    apkBase64 = await readFileAsBase64(args.apk);
    console.log('Berkas APK dimuat.');
  } catch (error) {
    console.error('Gagal membaca APK:', error.message);
    process.exit(1);
  }

  // Publish to server
  console.log('\nMenerbitkan ke server...');
  try {
    const payload = {
      version: args.version,
      apkBase64,
      releaseNotes: args.notes || `Update ke versi ${args.version}`,
      isForceUpdate: args.forceUpdate || false,
      minVersion: args.minVersion || null,
      apkVersionName,
      apkVersionCode,
    };

    const response = await httpRequest(`${args.server}/publish-version`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Publish-Secret': args.secret,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 200 || response.status === 201) {
      console.log('Publikasi berhasil.');
      console.log('\nRespons server:');
      console.log(JSON.stringify(response.data, null, 2));

      console.log('\nAPK berhasil diterbitkan.');
      console.log(`   Version: ${args.version}`);
      console.log(`   Download URL: ${args.server}/app-download/${args.version}`);
      console.log(`   Version check: ${args.server}/app-version?current=${args.version}`);
    } else if (response.status === 401) {
      console.error('Autentikasi gagal.');
      console.error('   Periksa nilai --secret yang dipakai.');
      process.exit(1);
    } else if (response.status === 400) {
      console.error('Publikasi ditolak server:', response.data.message);
      process.exit(1);
    } else {
      throw new Error(`Server returned ${response.status}: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.error('Publikasi gagal:', error.message);
    process.exit(1);
  }

  console.log('\n');
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('\nTerjadi kesalahan tak terduga:', error);
  process.exit(1);
});
