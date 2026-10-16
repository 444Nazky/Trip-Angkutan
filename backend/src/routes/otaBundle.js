const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { OTA_DIR } = require('../ota-dir');



// Satu sumber bundel modul web: public/ota/<versi>/** + manifest.json di root-nya.
const MANIFEST_FILE = path.join(OTA_DIR, 'manifest.json');
const KEEP_VERSIONS = Math.max(1, Number(process.env.OTA_KEEP_VERSIONS) || 3);
const MAX_FILES = 120;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:\+\d+)?$/;



function ensureOtaDir() {
  if (!fs.existsSync(OTA_DIR)) fs.mkdirSync(OTA_DIR, { recursive: true });
}



function loadManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf-8'));
  } catch {
    return null;
  }
}



function saveManifest(manifest) {
  ensureOtaDir();
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}



// Semver sama + timestamp berbeda harus tetap punya urutan pasti; tanpa itu
// versi dengan timestamp lebih baru bisa terhapus sebagai "paling lama".
function compareVersions(a, b) {
  const parse = (v) => String(v ?? '0').split('+')[0].split('.').map(n => Number(n) || 0);
  const stamp = (v) => Number(String(v ?? '').split('+')[1] ?? 0) || 0;
  const [a1, a2, a3] = parse(a);
  const [b1, b2, b3] = parse(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  if (a3 !== b3) return a3 - b3;
  const sa = stamp(a);
  const sb = stamp(b);
  if (sa !== sb) return sa - sb;
  return String(a).localeCompare(String(b));
}



function listVersions() {
  try {
    return fs.readdirSync(OTA_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && VERSION_PATTERN.test(entry.name))
      .map(entry => entry.name);
  } catch {
    return [];
  }
}



// Simpan hanya beberapa versi terakhir — tanpa ini disk server tumbuh terus
// sementara perangkat hanya pernah butuh versi yang sedang aktif.
function pruneOldVersions(keepVersion) {
  const dropped = [];
  const others = listVersions()
    .filter(version => version !== keepVersion)
    .sort((a, b) => compareVersions(b, a));

  for (const version of others.slice(KEEP_VERSIONS - 1)) {
    try {
      fs.rmSync(path.join(OTA_DIR, version), { recursive: true, force: true });
      dropped.push(version);
    } catch (error) {
      console.warn(`[ota] gagal hapus bundel ${version}:`, error && error.message);
    }
  }
  return dropped;
}



function normalizeAssetPath(raw) {
  const clean = String(raw ?? '').replace(/\\/g, '/').trim();
  if (!clean || clean.startsWith('/') || clean.includes('..')) return null;
  return clean;
}



// Manifest publik untuk tombol "Cek & Perbarui Aplikasi" di perangkat.
router.get('/ota-manifest', (req, res) => {
  try {
    const manifest = loadManifest();
    if (!manifest || !manifest.version) {
      return res.status(404).json({ error: 'OTA_NOT_PUBLISHED', message: 'Belum ada bundel modul yang dipublikasikan' });
    }
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.json({
      version: manifest.version,
      assets: manifest.assets,
      integrity: manifest.integrity || {},
      minVersion: manifest.minVersion || null,
      isForceUpdate: Boolean(manifest.isForceUpdate),
      releaseNotes: manifest.releaseNotes || '',
      publishedAt: manifest.publishedAt || null,
    });
  } catch (error) {
    console.error('Error reading ota manifest:', error && error.message);
    res.status(500).json({ error: 'OTA_MANIFEST_FAILED', message: 'Gagal membaca manifest modul' });
  }
});



// Daftar bundel yang masih tersimpan di server (untuk admin/operasional).
router.get('/ota-versions', (req, res) => {
  try {
    const manifest = loadManifest();
    const versions = listVersions().sort(compareVersions).reverse();
    res.json({ activeVersion: manifest?.version || null, versions });
  } catch {
    res.json({ activeVersion: null, versions: [] });
  }
});



// Publikasi bundel dari mesin rilis: berkas dikirim base64 dalam satu payload.
router.post('/publish-ota', (req, res) => {
  try {
    const secret = req.headers['x-publish-secret'];
    const expectedSecret = process.env.PUBLISH_SECRET || 'trip-angkut-secret';
    if (secret !== expectedSecret) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Unauthorized' });
    }

    const { version, files, releaseNotes, minVersion, isForceUpdate } = req.body || {};

    if (!version || !VERSION_PATTERN.test(String(version))) {
      return res.status(400).json({ error: 'INVALID_VERSION', message: 'Versi modul tidak valid (contoh: 1.0.26+1792118276850)' });
    }
    if (!files || typeof files !== 'object') {
      return res.status(400).json({ error: 'MISSING_FILES', message: 'Payload files (base64 per berkas) wajib diisi' });
    }

    const entries = Object.entries(files);
    if (!entries.length || entries.length > MAX_FILES) {
      return res.status(400).json({ error: 'INVALID_FILES', message: `Jumlah berkas harus 1..${MAX_FILES}` });
    }

    const cleaned = [];
    for (const [rawPath, rawBase64] of entries) {
      const assetPath = normalizeAssetPath(rawPath);
      if (!assetPath) {
        return res.status(400).json({ error: 'INVALID_ASSET_PATH', message: `Nama berkas tidak sah: ${rawPath}` });
      }
      const buffer = Buffer.from(String(rawBase64 ?? ''), 'base64');
      if (!buffer.length) {
        return res.status(400).json({ error: 'EMPTY_ASSET', message: `Berkas kosong: ${assetPath}` });
      }
      // Bundel parsial bikin perangkat menarik versi baru lalu diam — tolak lebih awal.
      if (buffer.length > MAX_FILE_BYTES) {
        return res.status(400).json({ error: 'ASSET_TOO_LARGE', message: `Berkas terlalu besar: ${assetPath}` });
      }
      cleaned.push({ assetPath, buffer, sha256: crypto.createHash('sha256').update(buffer).digest('hex') });
    }

    if (!cleaned.some(item => item.assetPath === 'index.html')) {
      return res.status(400).json({ error: 'MISSING_ENTRY', message: 'Bundel harus memuat index.html' });
    }

    ensureOtaDir();
    const targetDir = path.join(OTA_DIR, String(version));
    fs.rmSync(targetDir, { recursive: true, force: true });

    const integrity = {};
    for (const item of cleaned) {
      const fullPath = path.join(targetDir, item.assetPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, item.buffer);
      integrity[item.assetPath] = item.sha256;
    }

    const manifest = {
      version: String(version),
      assets: cleaned.map(item => item.assetPath),
      integrity,
      minVersion: minVersion || null,
      isForceUpdate: Boolean(isForceUpdate),
      releaseNotes: releaseNotes || '',
      publishedAt: new Date().toISOString(),
    };
    saveManifest(manifest);
    const pruned = pruneOldVersions(manifest.version);

    console.log(`[ota] bundel ${manifest.version} dipublikasikan (${manifest.assets.length} berkas)`);
    res.json({
      success: true,
      version: manifest.version,
      files: manifest.assets.length,
      pruned,
      message: `Modul ${manifest.version} dipublikasikan`,
    });
  } catch (error) {
    console.error('Error publishing ota bundle:', error && error.message);
    res.status(500).json({ error: 'OTA_PUBLISH_FAILED', message: 'Gagal mempublikasikan bundel modul' });
  }
});



module.exports = router;
