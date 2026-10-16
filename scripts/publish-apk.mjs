#!/usr/bin/env node
// ─── Publish APK Script ──────────────────────────────────────────────────────
// Upload APK to backend server and register as latest version
// Usage: node publish-apk.mjs --apk=/path/to/app.apk --version=1.0.0 [options]

import fs from 'fs';
import path from 'path';
import os from 'os';
import https from 'https';
import http from 'http';
import { execFileSync } from 'child_process';
import { URL } from 'url';

const ARGUMENTS = {
  '--apk': { required: true, description: 'Path to APK file' },
  '--version': { required: true, description: 'Version (semver format, e.g., 1.0.0)' },
  '--server': { default: 'http://localhost:3000', description: 'Backend server URL' },
  '--secret': { default: process.env.PUBLISH_SECRET || 'trip-angkut-secret', description: 'Publish secret' },
  '--force': { flag: true, description: 'Force publish even if version exists' },
  '--notes': { description: 'Release notes (optional)' },
  '--force-update': { flag: true, description: 'Mark as mandatory update' },
  '--min-version': { description: 'Minimum supported version' },
  '--apk-version-name': { description: 'versionName DI DALAM APK (auto-deteksi aapt2 bila kosong)' },
  '--apk-version-code': { description: 'versionCode DI DALAM APK (auto-deteksi aapt2 bila kosong)' },
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
📦 APK Publisher — Custom Self-Hosted Update System

Usage:
  node publish-apk.mjs --apk=/path/to/app.apk --version=1.0.0 [options]

Arguments:
${Object.entries(ARGUMENTS).map(([key, config]) => {
    const required = config.required ? '(required)' : config.flag ? '(flag)' : `(default: ${config.default})`;
    return `  ${key.padEnd(20)} ${required} ${config.description}`;
  }).join('\n')}

Environment Variables:
  PUBLISH_SECRET     Secret for authenticating with backend (default: trip-angkut-secret)

Examples:
  node publish-apk.mjs --apk=./app-release.apk --version=1.0.0
  node publish-apk.mjs --apk=./app.apk --version=1.0.1 --force-update --notes="Bug fixes"
  node publish-apk.mjs --apk=./app.apk --version=2.0.0 --server=https://api.example.com

Notes:
  - Version must be in semantic versioning format (X.Y.Z)
  - APK file will be read and sent as base64 to the backend
  - The backend must have the /api/v1/publish-version endpoint configured
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



// aapt2 dari Android SDK (pola sama dengan verify-apks.mjs / publish-release.sh).
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

  console.log('\n📦 APK Publisher — Custom Self-Hosted Update System\n');
  console.log('─'.repeat(50));

  // Validate inputs
  const apkValidation = validateApkPath(args.apk);
  if (!apkValidation.valid) {
    console.error('❌ Validation Error:', apkValidation.error);
    process.exit(1);
  }

  const versionValidation = validateVersion(args.version);
  if (!versionValidation.valid) {
    console.error('❌ Validation Error:', versionValidation.error);
    process.exit(1);
  }

  const fileSize = getFileSize(args.apk);
  console.log(`📁 APK: ${args.apk}`);
  console.log(`📏 Size: ${formatBytes(fileSize)}`);
  console.log(`🏷️  Version: ${args.version}`);
  console.log(`🌐 Server: ${args.server}`);

  // Penanda versi asli: server memakainya untuk MENOLAK paket salah label.
  const badging = detectApkBadging(args.apk);
  const apkVersionName = args.apkVersionName || badging.versionName;
  const apkVersionCode = Number(args.apkVersionCode) || badging.versionCode;
  console.log(`🔍 Di dalam APK: versionName=${apkVersionName ?? '?(aapt2 tidak ada)'} versionCode=${apkVersionCode ?? '?'}`);

  if (!badging.aapt2) {
    console.log('⚠️  aapt2 tidak ditemukan — versi APK tidak bisa diverifikasi dari sini.');
  }
  if (apkVersionName && apkVersionName !== args.version) {
    console.error(`❌ APK berisi '${apkVersionName}', bukan '${args.version}'.`);
    console.error('   Menerbitkannya membuat versi di HP tidak pernah naik. Pakai --force bila memang sadar.');
    if (!args.force) process.exit(1);
  }

  if (args.forceUpdate) {
    console.log('🔒 Force Update: Yes (mandatory)');
  }

  if (args.force) {
    console.log('⚡ Force: Yes (overwrite existing)');
  }

  console.log('─'.repeat(50));

  // Check server connectivity
  console.log('\n🔌 Checking server connection...');
  try {
    const healthCheck = await httpRequest(`${args.server}/api/health`);
    if (healthCheck.status !== 200) {
      throw new Error(`Server returned status ${healthCheck.status}`);
    }
    console.log('✅ Server is reachable\n');
  } catch (error) {
    console.error('❌ Cannot connect to server:', error.message);
    console.error('   Make sure the backend server is running at:', args.server);
    process.exit(1);
  }

  // Read APK file
  console.log('📖 Reading APK file...');
  let apkBase64;
  try {
    apkBase64 = await readFileAsBase64(args.apk);
    console.log('✅ APK file loaded');
  } catch (error) {
    console.error('❌ Failed to read APK:', error.message);
    process.exit(1);
  }

  // Publish to server
  console.log('\n🚀 Publishing to server...');
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

    const response = await httpRequest(`${args.server}/api/v1/publish-version`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Publish-Secret': args.secret,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 200 || response.status === 201) {
      console.log('✅ Publish successful!');
      console.log('\n📋 Response:');
      console.log(JSON.stringify(response.data, null, 2));

      console.log('\n🎉 APK published successfully!');
      console.log(`   Version: ${args.version}`);
      console.log(`   Download URL: ${args.server}/api/v1/app-download/${args.version}`);
      console.log(`   Version check: ${args.server}/api/v1/app-version?current=${args.version}`);
    } else if (response.status === 401) {
      console.error('❌ Authentication failed');
      console.error('   Check your --secret value');
      process.exit(1);
    } else if (response.status === 400) {
      console.error('❌ Publish rejected:', response.data.message);
      process.exit(1);
    } else {
      throw new Error(`Server returned ${response.status}: ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    console.error('❌ Publish failed:', error.message);
    process.exit(1);
  }

  console.log('\n');
}

// ─── Run ────────────────────────────────────────────────────────────────────

main().catch((error) => {
  console.error('\n❌ Unexpected error:', error);
  process.exit(1);
});
