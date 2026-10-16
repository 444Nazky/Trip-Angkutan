const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const APK_DIR = path.join(__dirname, '..', '..', 'apks');
const METADATA_DIR = path.join(__dirname, '..', '..', 'metadata');



function ensureDirs() {
  if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });
  if (!fs.existsSync(METADATA_DIR)) fs.mkdirSync(METADATA_DIR, { recursive: true });
}



function loadVersionMetadata() {
  ensureDirs();
  const metadataPath = path.join(METADATA_DIR, 'versions.json');

  if (fs.existsSync(metadataPath)) {
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}



function saveVersionMetadata(metadata) {
  ensureDirs();
  const metadataPath = path.join(METADATA_DIR, 'versions.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}



function compareVersions(current, latest) {
  const parse = (v) => v.split('.').map(Number);
  const [c1, c2, c3] = parse(current);
  const [l1, l2, l3] = parse(latest);

  if (l1 > c1) return 1;
  if (l1 === c1 && l2 > c2) return 1;
  if (l1 === c1 && l2 === c2 && l3 > c3) return 1;
  return 0;
}



router.get('/app-version', (req, res) => {
  try {
    const { current = '0.0.0' } = req.query;
    const metadata = loadVersionMetadata();

    if (!metadata || !metadata.latest) {
      return res.json({
        latestVersion: current,
        updateAvailable: false,
        isForceUpdate: false,
        downloadUrl: null,
        releaseNotes: null,
        apkSize: null,
        apkHash: null,
        minVersion: null,
        releaseDate: null
      });
    }

    const latestVersion = metadata.latest.version;
    const updateAvailable = compareVersions(current, latestVersion) > 0;
    const apkPath = path.join(APK_DIR, `app-${latestVersion}.apk`);
    const apkExists = fs.existsSync(apkPath);

    let apkSize = null;
    let apkHash = null;

    if (apkExists) {
      const stats = fs.statSync(apkPath);
      apkSize = stats.size;

      const fileBuffer = fs.readFileSync(apkPath);
      const hashSum = crypto.createHash('sha256');
      hashSum.update(fileBuffer);
      apkHash = `sha256:${hashSum.digest('hex')}`;
    }

    res.json({
      latestVersion,
      updateAvailable,
      isForceUpdate: metadata.latest.isForceUpdate || false,
      downloadUrl: apkExists ? `/api/v1/app-download/${latestVersion}` : null,
      releaseNotes: metadata.latest.releaseNotes || 'Perbaikan dan peningkatan performa',
      apkSize,
      apkHash,
      minVersion: metadata.latest.minVersion || null,
      releaseDate: metadata.latest.releaseDate || null
    });
  } catch (error) {
    console.error('Error checking app version:', error);
    res.status(500).json({
      error: 'VERSION_CHECK_FAILED',
      message: 'Gagal memeriksa versi aplikasi'
    });
  }
});



router.get('/release-notes/:version', (req, res) => {
  try {
    const { version } = req.params;
    const metadata = loadVersionMetadata();

    if (!metadata || !metadata.releases || !metadata.releases[version]) {
      if (metadata?.latest?.version === version) {
        return res.json({
          version,
          releaseDate: metadata.latest.releaseDate || null,
          notes: metadata.latest.notes || [
            { type: 'feature', title: 'Peningkatan sistem', description: 'Berbagai perbaikan dan peningkatan' }
          ]
        });
      }

      return res.status(404).json({
        error: 'VERSION_NOT_FOUND',
        message: `Catatan rilis untuk versi ${version} tidak ditemukan`
      });
    }

    const release = metadata.releases[version];
    res.json({
      version,
      releaseDate: release.releaseDate || null,
      notes: release.notes || []
    });
  } catch (error) {
    console.error('Error fetching release notes:', error);
    res.status(500).json({
      error: 'RELEASE_NOTES_FAILED',
      message: 'Gagal mengambil catatan rilis'
    });
  }
});



router.post('/publish-version', (req, res) => {
  try {
    const secret = req.headers['x-publish-secret'];
    const expectedSecret = process.env.PUBLISH_SECRET || 'trip-angkut-secret';

    if (secret !== expectedSecret) {
      return res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Tidak memiliki izin untuk mempublish versi'
      });
    }

    const { version, apkBase64, releaseNotes, isForceUpdate, minVersion, notes } = req.body;

    if (!version) {
      return res.status(400).json({
        error: 'MISSING_VERSION',
        message: 'Versi harus diisi'
      });
    }

    const semverRegex = /^\d+\.\d+\.\d+$/;
    if (!semverRegex.test(version)) {
      return res.status(400).json({
        error: 'INVALID_VERSION',
        message: 'Format versi harus semantic versioning (contoh: 1.0.0)'
      });
    }

    ensureDirs();

    if (apkBase64) {
      try {
        const apkBuffer = Buffer.from(apkBase64, 'base64');
        const apkPath = path.join(APK_DIR, `app-${version}.apk`);
        fs.writeFileSync(apkPath, apkBuffer);
        console.log(`APK saved: ${apkPath} (${apkBuffer.length} bytes)`);
      } catch (err) {
        return res.status(500).json({
          error: 'APK_SAVE_FAILED',
          message: 'Gagal menyimpan file APK'
        });
      }
    }

    const metadata = loadVersionMetadata() || { latest: null, releases: {} };

    const releaseData = {
      version,
      releaseDate: new Date().toISOString(),
      releaseNotes: releaseNotes || '',
      notes: notes || [],
      isForceUpdate: isForceUpdate || false,
      minVersion: minVersion || null
    };

    if (!metadata.latest || compareVersions(metadata.latest.version, version) < 0) {
      metadata.latest = releaseData;
    }

    metadata.releases[version] = releaseData;

    saveVersionMetadata(metadata);

    res.json({
      success: true,
      version,
      message: `Versi ${version} berhasil dipublish`
    });
  } catch (error) {
    console.error('Error publishing version:', error);
    res.status(500).json({
      error: 'PUBLISH_FAILED',
      message: 'Gagal mempublish versi'
    });
  }
});



module.exports = router;
