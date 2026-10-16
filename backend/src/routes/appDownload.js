const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const APK_DIR = path.join(__dirname, '..', '..', 'apks');
const METADATA_DIR = path.join(__dirname, '..', '..', 'metadata');



function loadVersionMetadata() {
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



router.get('/app-download/:version', (req, res) => {
  try {
    const { version } = req.params;

    const semverRegex = /^\d+\.\d+\.\d+$/;
    if (!semverRegex.test(version)) {
      return res.status(400).json({
        error: 'INVALID_VERSION',
        message: 'Format versi tidak valid'
      });
    }

    const apkPath = path.join(APK_DIR, `app-${version}.apk`);

    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({
        error: 'APK_NOT_FOUND',
        message: `File APK versi ${version} tidak ditemukan`
      });
    }

    const stats = fs.statSync(apkPath);

    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="trip-angkut-${version}.apk"`);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const fileStream = fs.createReadStream(apkPath);

    fileStream.on('error', (error) => {
      console.error('Error streaming APK:', error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'DOWNLOAD_FAILED',
          message: 'Gagal mengunduh file APK'
        });
      }
    });

    fileStream.pipe(res);
  } catch (error) {
    console.error('Error downloading APK:', error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'DOWNLOAD_ERROR',
        message: 'Terjadi kesalahan saat mengunduh APK'
      });
    }
  }
});



router.get('/apk-info/:version', (req, res) => {
  try {
    const { version } = req.params;
    const apkPath = path.join(APK_DIR, `app-${version}.apk`);

    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({
        error: 'APK_NOT_FOUND',
        message: `File APK versi ${version} tidak ditemukan`
      });
    }

    const stats = fs.statSync(apkPath);
    const fileBuffer = fs.readFileSync(apkPath);
    const hashSum = crypto.createHash('sha256');
    hashSum.update(fileBuffer);

    res.json({
      version,
      filename: `trip-angkut-${version}.apk`,
      size: stats.size,
      sizeFormatted: formatBytes(stats.size),
      sha256: hashSum.digest('hex'),
      uploadedAt: stats.birthtime.toISOString(),
      modifiedAt: stats.mtime.toISOString()
    });
  } catch (error) {
    console.error('Error getting APK info:', error);
    res.status(500).json({
      error: 'INFO_FETCH_FAILED',
      message: 'Gagal mengambil informasi APK'
    });
  }
});



function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}



router.get('/apk-list', (req, res) => {
  try {
    ensureDir(APK_DIR);

    const files = fs.readdirSync(APK_DIR)
      .filter(f => f.startsWith('app-') && f.endsWith('.apk'))
      .map(f => {
        const version = f.replace('app-', '').replace('.apk', '');
        const filePath = path.join(APK_DIR, f);
        const stats = fs.statSync(filePath);
        return {
          version,
          filename: f,
          size: stats.size,
          sizeFormatted: formatBytes(stats.size),
          uploadedAt: stats.birthtime.toISOString()
        };
      })
      .sort((a, b) => {
        const [a1, a2, a3] = a.version.split('.').map(Number);
        const [b1, b2, b3] = b.version.split('.').map(Number);
        if (b1 !== a1) return b1 - a1;
        if (b2 !== a2) return b2 - a2;
        return b3 - a3;
      });

    res.json({
      count: files.length,
      apks: files
    });
  } catch (error) {
    console.error('Error listing APKs:', error);
    res.status(500).json({
      error: 'LIST_FAILED',
      message: 'Gagal mendapatkan daftar APK'
    });
  }
});



function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}



module.exports = router;
