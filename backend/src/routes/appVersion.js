// ─── App Version API ─────────────────────────────────────────────────────────
// GET /api/v1/app-version?current=:version

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Path to APK storage and metadata
const APK_DIR = path.join(__dirname, '..', '..', 'apks');
const METADATA_DIR = path.join(__dirname, '..', '..', 'metadata');

// CDN/Static URL for APK downloads
const APK_CDN_BASE = process.env.APK_CDN_URL || '';
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL || '';

// Ensure directories exist
function ensureDirs() {
  if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });
  if (!fs.existsSync(METADATA_DIR)) fs.mkdirSync(METADATA_DIR, { recursive: true });
}

// Load version metadata
function loadVersionMetadata() {
  ensureDirs();
  const metadataPath = path.join(METADATA_DIR, 'versions.json');
  if (fs.existsSync(metadataPath)) {
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch { return null; }
  }
  return null;
}

// Save version metadata
function saveVersionMetadata(metadata) {
  ensureDirs();
  const metadataPath = path.join(METADATA_DIR, 'versions.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}

// Compare semantic versions
function compareVersions(current, latest) {
  const parse = (v) => v.split('.').map(Number);
  const [c1, c2, c3] = parse(current);
  const [l1, l2, l3] = parse(latest);
  if (l1 > c1) return 1;
  if (l1 === c1 && l2 > c2) return 1;
  if (l1 === c1 && l2 === c2 && l3 > c3) return 1;
  return 0;
}

// Get download URL for a version
// Priority: env var > metadata > CDN > Railway Static > local
function getDownloadUrl(version) {
  const metadata = loadVersionMetadata();

  // 1. Check env var APK_DOWNLOAD_URL_v1_0_0
  const envKey = `APK_DOWNLOAD_URL_${version.replace(/\./g, '_')}`;
  if (process.env[envKey]) return process.env[envKey];

  // 2. Check env var APK_DOWNLOAD_URL_LATEST
  if (process.env.APK_DOWNLOAD_URL_LATEST && metadata?.latest?.version === version) {
    return process.env.APK_DOWNLOAD_URL_LATEST;
  }

  // 3. Check metadata for explicit downloadUrl
  if (metadata?.releases?.[version]?.downloadUrl) return metadata.releases[version].downloadUrl;
  if (metadata?.latest?.version === version && metadata?.latest?.downloadUrl) return metadata.latest.downloadUrl;

  // 4. Try external CDN
  if (APK_CDN_BASE) return `${APK_CDN_BASE}/app-${version}.apk`;

  // 5. Try Railway static URL
  if (RAILWAY_STATIC_URL) return `${RAILWAY_STATIC_URL}/releases/app-${version}.apk`;

  // 6. Hardcoded fallback for production (update URL when new release)
  const HARDCODED_URLS = {
    '1.0.3': 'https://files.catbox.moe/bmkh1o.apk',
    '1.0.2': 'https://files.catbox.moe/dfvc89.apk',
    '1.0.1': 'https://files.catbox.moe/dfvc89.apk',
    '1.0.0': 'https://files.catbox.moe/f67x5q.apk',
  };
  if (HARDCODED_URLS[version]) return HARDCODED_URLS[version];

  // 7. Fallback to local path
  const apkPath = path.join(APK_DIR, `app-${version}.apk`);
  return fs.existsSync(apkPath) ? `/api/v1/app-download/${version}` : null;
}

// GET /api/v1/app-version
router.get('/app-version', (req, res) => {
  try {
    const { current = '0.0.0' } = req.query;
    const metadata = loadVersionMetadata();

    if (!metadata || !metadata.latest) {
      return res.json({
        latestVersion: current,
        updateAvailable: false,
        downloadUrl: null,
        releaseNotes: null,
      });
    }

    const latestVersion = metadata.latest.version;
    const updateAvailable = compareVersions(current, latestVersion) > 0;

    res.json({
      latestVersion,
      updateAvailable,
      isForceUpdate: metadata.latest.isForceUpdate || false,
      downloadUrl: getDownloadUrl(latestVersion),
      releaseNotes: metadata.latest.releaseNotes || 'Update tersedia',
      apkSize: null,
      apkHash: null,
      minVersion: metadata.latest.minVersion || null,
      releaseDate: metadata.latest.releaseDate || null
    });
  } catch (error) {
    console.error('Error checking app version:', error);
    res.status(500).json({ error: 'VERSION_CHECK_FAILED', message: 'Gagal memeriksa versi' });
  }
});

// GET /api/v1/apk-list
router.get('/apk-list', (req, res) => {
  try {
    const files = fs.readdirSync(APK_DIR)
      .filter(f => f.startsWith('app-') && f.endsWith('.apk'))
      .map(f => ({ version: f.replace('app-', '').replace('.apk', ''), filename: f }))
      .sort((a, b) => compareVersions(a.version, b.version));
    res.json({ count: files.length, apks: files });
  } catch {
    res.json({ count: 0, apks: [] });
  }
});

// POST /api/v1/publish-version
router.post('/publish-version', (req, res) => {
  try {
    const secret = req.headers['x-publish-secret'];
    const expectedSecret = process.env.PUBLISH_SECRET || 'trip-angkut-secret';
    if (secret !== expectedSecret) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Unauthorized' });
    }

    const { version, downloadUrl, apkBase64, releaseNotes, isForceUpdate, minVersion } = req.body;

    if (!version) return res.status(400).json({ error: 'MISSING_VERSION', message: 'Versi harus diisi' });

    const semverRegex = /^\d+\.\d+\.\d+$/;
    if (!semverRegex.test(version)) {
      return res.status(400).json({ error: 'INVALID_VERSION', message: 'Format versi tidak valid' });
    }

    if (!downloadUrl && !apkBase64) {
      return res.status(400).json({ error: 'MISSING_SOURCE', message: 'Harus ada downloadUrl atau apkBase64' });
    }

    ensureDirs();

    if (apkBase64 && !downloadUrl) {
      try {
        const apkBuffer = Buffer.from(apkBase64, 'base64');
        const apkPath = path.join(APK_DIR, `app-${version}.apk`);
        fs.writeFileSync(apkPath, apkBuffer);
        console.log(`APK saved: ${apkBuffer.length} bytes`);
      } catch {
        return res.status(500).json({ error: 'APK_SAVE_FAILED', message: 'Gagal menyimpan APK' });
      }
    }

    const metadata = loadVersionMetadata() || { latest: null, releases: {} };
    const releaseData = {
      version,
      downloadUrl: downloadUrl || null,
      releaseDate: new Date().toISOString(),
      releaseNotes: releaseNotes || '',
      isForceUpdate: isForceUpdate || false,
      minVersion: minVersion || null,
    };

    if (!metadata.latest || compareVersions(metadata.latest.version, version) < 0) {
      metadata.latest = releaseData;
    }
    metadata.releases[version] = releaseData;
    saveVersionMetadata(metadata);

    res.json({ success: true, version, message: `Versi ${version} dipublish` });
  } catch (error) {
    console.error('Error publishing:', error);
    res.status(500).json({ error: 'PUBLISH_FAILED', message: 'Gagal publish' });
  }
});

module.exports = router;
