const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { absoluteBase } = require('../absolute-url');
const { db } = require('../db');
const { authenticate, requireAdmin } = require('../middleware/auth');



const APK_DIR = process.env.APK_DIR || path.join(__dirname, '..', '..', 'apks');
const METADATA_DIR = process.env.METADATA_DIR || path.join(__dirname, '..', '..', 'metadata');



const APK_CDN_BASE = process.env.APK_CDN_URL || '';
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL || '';



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
    } catch { return null; }
  }
  return null;
}



function saveVersionMetadata(metadata) {
  ensureDirs();
  const metadataPath = path.join(METADATA_DIR, 'versions.json');
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
}



function compareVersions(current, latest) {
  const parse = (v) => String(v ?? '0').split('.').map(n => Number(n) || 0);
  const [c1, c2, c3] = parse(current);
  const [l1, l2, l3] = parse(latest);
  if (l1 > c1) return 1;
  if (l1 === c1 && l2 > c2) return 1;
  if (l1 === c1 && l2 === c2 && l3 > c3) return 1;
  return 0;
}



function isAbsoluteUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}



// Info berkas APK lokal (ukuran + SHA-256) — di-cache per versi+mtime supaya
// hash 16 MB tidak dihitung ulang tiap kali aplikasi mobile cek versi.
const apkInfoCache = new Map();

function localApkInfo(version) {
  const file = path.join(APK_DIR, `app-${version}.apk`);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${stat.size}:${stat.mtimeMs}`;
  const cached = apkInfoCache.get(version);
  if (cached && cached.key === key) return cached;

  let sha256 = '';
  try {
    sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    sha256 = '';
  }
  const info = { key, file, size: stat.size, sha256 };
  apkInfoCache.set(version, info);
  return info;
}



// URL unduhan ENV untuk satu versi (mis. APK_DOWNLOAD_URL_1_0_9)
function envDownloadUrl(version) {
  const envKey = `APK_DOWNLOAD_URL_${version.replace(/\./g, '_')}`;
  return isAbsoluteUrl(process.env[envKey]) ? String(process.env[envKey]).trim() : '';
}



// URL CDN/static bila env-nya diisi (hanya dipakai untuk versi yang memang punya berkas)
function cdnDownloadUrl(version) {
  const cdnBase = absoluteBase(APK_CDN_BASE);
  if (cdnBase) return `${cdnBase}/app-${version}.apk`;
  const staticBase = absoluteBase(RAILWAY_STATIC_URL);
  if (staticBase) return `${staticBase}/releases/app-${version}.apk`;
  return '';
}



// URL berkas milik API ini sendiri → hanya sah kalau APK-nya benar-benar ada.
function isSelfDownloadUrl(url) {
  return /\/api\/v1\/app-download\//i.test(String(url ?? ''));
}



/**
 * Basis URL absolut untuk request ini (mis. https://aplikasi-trip-api-production.up.railway.app).
 *
 * Dipakai untuk menyusun URL unduhan APK lokal supaya SELALU absolut. Klien yang
 * lebih tua menggabungkan path relatif terhadap base URL-nya sendiri sehingga
 * `/api/v1/app-download/1.0.6` menjadi `.../api/api/v1/app-download/1.0.6` → 404
 * JSON → berkas "dokumen" kecil tersimpan, verifikasi hash gagal, dan petugas
 * melihat update yang selalu gagal.
 */
function requestBase(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || req?.protocol || 'https';
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] ?? '').split(',')[0].trim();
  const host = forwardedHost || req?.get?.('host') || '';
  if (!host) return absoluteBase(process.env.PUBLIC_BASE_URL || '');
  return `${proto}://${host}`;
}



const headCache = new Map();

/**
 * Cek cepat (HEAD) apakah URL eksternal benar-benar menyajikan berkas.
 * Di-cache 60 detik agar /app-version tetap ringan.
 */
async function remoteUrlIsAlive(url) {
  const hit = headCache.get(url);
  if (hit && Date.now() - hit.at < 60_000) return hit.alive;
  let alive = false;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) });
    alive = res.ok;
  } catch {
    alive = false;
  }
  headCache.set(url, { at: Date.now(), alive });
  return alive;
}



/**
 * Tentukan PAKET mana yang benar-benar bisa diunduh untuk sebuah versi.
 *
 * Ini akar kegagalan update: `versions.json` pernah menunjuk 1.0.12 padahal
 * berkasnya tidak ada, sehingga server menyatakan "ada update", aplikasi
 * mengunduh ke /app-download/1.0.12, menerima 404 JSON, lalu update selalu gagal.
 * Sekarang versi tanpa paket nyata tidak pernah diiklankan.
 */
/**
 * Apakah paket versi ini benar-benar berisi versi tersebut?
 *
 * Metadata menyimpan `apkVersionName` hasil pembacaan APK nyata (aapt2) saat
 * rilis. Ini penting: pernah di produksi berkas yang dilabeli app-1.0.8.apk
 * sebenarnya berisi 1.0.6 dan app-1.0.12.apk berisi 1.0.9. Server lalu
 * mengiklankan update, aplikasi memasang "versi baru" yang isinya versi lama →
 * versi tak pernah berubah dan popup update muncul selamanya.
 */
function declaredVersionMatches(version, release) {
  const declared = String(release?.apkVersionName ?? '').trim();
  if (!declared) return true; // metadata lama tanpa penanda → jangan blokir
  return declared === String(version).trim();
}




async function resolvePackage(version, release, baseUrl = '') {
  if (!declaredVersionMatches(version, release)) {
    console.warn(`[update] v${version} dilewati: metadata menyatakan APK berisi ${release?.apkVersionName}`);
    return { available: false, source: 'version-mismatch', size: null, sha256: null, url: null };
  }

  const local = localApkInfo(version);
  if (local) {
    return {
      available: true,
      source: 'local',
      size: local.size,
      sha256: local.sha256 || release?.apkHash || null,
      // URL ABSOLUT (bukan path relatif) — lihat catatan di requestBase().
      url: `${baseUrl}/api/v1/app-download/${version}`,
    };
  }

  const candidates = [envDownloadUrl(version), release?.downloadUrl, cdnDownloadUrl(version)]
    .map(v => String(v ?? '').trim())
    .filter(Boolean);
  const external = candidates.find(u => isAbsoluteUrl(u) && !isSelfDownloadUrl(u));
  if (external && await remoteUrlIsAlive(external)) {
    return { available: true, source: 'remote', size: release?.apkSize ?? null, sha256: release?.apkHash ?? null, url: external };
  }

  return { available: false, source: 'none', size: null, sha256: null, url: null };
}



// Kandidat rilis: gabungan latest + releases, diurutkan versi terbaru dulu.
function releaseCandidates(metadata) {
  const map = new Map();
  if (metadata?.latest?.version) map.set(String(metadata.latest.version), metadata.latest);
  for (const [version, release] of Object.entries(metadata?.releases || {})) {
    if (!map.has(version)) map.set(version, release);
  }
  return [...map.entries()]
    .map(([version, release]) => ({ version, release }))
    .sort((a, b) => compareVersions(b.version, a.version))
    .filter(({ version }) => /^\d+\.\d+\.\d+$/.test(version));
}



/** Rilis terbaru yang PAKET-nya benar-benar bisa diunduh. */
async function latestDeliverableRelease(metadata, baseUrl = '') {
  for (const candidate of releaseCandidates(metadata)) {
    const pkg = await resolvePackage(candidate.version, candidate.release, baseUrl);
    if (pkg.available) return { ...candidate, pkg };
  }
  return null;
}



function parseReleaseNotes(text) {
  return String(text ?? '')
    .split(/[\n;]+/)
    .map(line => line.replace(/^[-*•]\s*/, '').trim())
    .filter(Boolean)
    .map(line => ({
      type: /fix|perbaikan|bug/i.test(line) ? 'bugfix'
        : /security|keamanan/i.test(line) ? 'security'
          : /improve|peningkat|optim/i.test(line) ? 'improvement'
            : 'feature',
      title: line,
      description: '',
    }));
}



router.get('/app-version', async (req, res) => {
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

    const deliverable = await latestDeliverableRelease(metadata, requestBase(req));
    if (!deliverable) {
      // Tidak ada paket yang bisa diunduh (mis. metadata menunjuk versi tanpa APK).
      // Jangan berbohong: kirim "tidak ada update" + alasan, biar tidak memicu
      // unduhan yang pasti gagal di perangkat.
      return res.json({
        latestVersion: current,
        updateAvailable: false,
        isForceUpdate: false,
        downloadUrl: null,
        releaseNotes: null,
        apkSize: null,
        apkHash: null,
        minVersion: metadata.latest.minVersion || null,
        releaseDate: null,
        apkAvailable: false,
        reason: 'NO_DELIVERABLE_PACKAGE',
      });
    }

    const { version, release, pkg } = deliverable;
    const updateAvailable = compareVersions(current, version) > 0;

    res.json({
      latestVersion: version,
      updateAvailable,
      isForceUpdate: Boolean(release?.isForceUpdate),
      downloadUrl: pkg.url,
      releaseNotes: release?.releaseNotes || 'Update tersedia',
      apkSize: pkg.size,
      apkHash: pkg.sha256,
      minVersion: release?.minVersion || null,
      releaseDate: release?.releaseDate || null,
      apkAvailable: true,
    });
  } catch (error) {
    console.error('Error checking app version:', error);
    res.status(500).json({ error: 'VERSION_CHECK_FAILED', message: 'Gagal memeriksa versi' });
  }
});



router.get('/release-notes/:version', (req, res) => {
  try {
    const version = String(req.params.version || '').trim();
    const metadata = loadVersionMetadata();
    const release = metadata?.releases?.[version]
      || (metadata?.latest?.version === version ? metadata.latest : null);
    if (!release) {
      return res.status(404).json({ error: 'RELEASE_NOT_FOUND', message: `Catatan rilis ${version} tidak ditemukan` });
    }
    res.json({
      version,
      releaseDate: release.releaseDate || null,
      notes: parseReleaseNotes(release.releaseNotes),
    });
  } catch (error) {
    console.error('Error reading release notes:', error);
    res.status(500).json({ error: 'RELEASE_NOTES_FAILED', message: 'Gagal membaca catatan rilis' });
  }
});



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



router.post('/publish-version', (req, res) => {
  try {
    const secret = req.headers['x-publish-secret'];
    const expectedSecret = process.env.PUBLISH_SECRET || 'trip-angkut-secret';
    if (secret !== expectedSecret) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Unauthorized' });
    }

    const { version, downloadUrl, apkBase64, releaseNotes, isForceUpdate, minVersion, apkVersionName, apkVersionCode } = req.body;

    if (!version) return res.status(400).json({ error: 'MISSING_VERSION', message: 'Versi harus diisi' });

    const semverRegex = /^\d+\.\d+\.\d+$/;
    if (!semverRegex.test(version)) {
      return res.status(400).json({ error: 'INVALID_VERSION', message: 'Format versi tidak valid' });
    }

    if (!downloadUrl && !apkBase64) {
      return res.status(400).json({ error: 'MISSING_SOURCE', message: 'Harus ada downloadUrl atau apkBase64' });
    }

    // URL relatif tidak berguna: klien mobile memperlakukannya terhadap base URL-nya
    // sendiri dan berakhir 404. Tolak lebih awal dengan pesan yang jelas.
    if (downloadUrl && !isAbsoluteUrl(downloadUrl)) {
      return res.status(400).json({
        error: 'INVALID_DOWNLOAD_URL',
        message: 'downloadUrl harus absolut (http/https). Untuk berkas lokal, pakai apkBase64.',
      });
    }

    ensureDirs();

    if (apkBase64 && !downloadUrl) {
      try {
        const apkBuffer = Buffer.from(apkBase64, 'base64');
        if (apkBuffer.length < 1_000_000) {
          return res.status(400).json({ error: 'APK_TOO_SMALL', message: `Data APK terlalu kecil (${apkBuffer.length} byte) — kemungkinan bukan berkas APK.` });
        }
        const apkPath = path.join(APK_DIR, `app-${version}.apk`);
        fs.writeFileSync(apkPath, apkBuffer);
        console.log(`APK saved: ${apkBuffer.length} bytes`);
      } catch {
        return res.status(500).json({ error: 'APK_SAVE_FAILED', message: 'Gagal menyimpan APK' });
      }
    }

    // Hash & ukuran nyata dari berkas lokal (bila ada) supaya klien bisa verifikasi.
    const local = localApkInfo(version);
    const metadata = loadVersionMetadata() || { latest: null, releases: {} };
    const releaseData = {
      version,
      downloadUrl: downloadUrl || null,
      releaseDate: new Date().toISOString(),
      releaseNotes: releaseNotes || '',
      isForceUpdate: isForceUpdate || false,
      minVersion: minVersion || null,
      apkSize: local ? local.size : null,
      apkHash: local ? local.sha256 : null,
      // Versi yang BENAR-BENAR ada di dalam APK (hasil `aapt2 dump badging` saat
      // rilis). Dipakai /app-version untuk menolak paket yang salah label.
      apkVersionName: apkVersionName ? String(apkVersionName).trim() : null,
      apkVersionCode: Number.isFinite(Number(apkVersionCode)) ? Number(apkVersionCode) : null,
    };

    if (!metadata.latest || compareVersions(metadata.latest.version, version) < 0) {
      metadata.latest = releaseData;
    }
    metadata.releases[version] = releaseData;
    saveVersionMetadata(metadata);

    const deliverable = local ? true : Boolean(downloadUrl);
    res.json({
      success: true,
      version,
      apkAvailable: deliverable,
      apkHash: releaseData.apkHash,
      apkSize: releaseData.apkSize,
      message: `Versi ${version} dipublish`,
    });
  } catch (error) {
    console.error('Error publishing:', error);
    res.status(500).json({ error: 'PUBLISH_FAILED', message: 'Gagal publish' });
  }
});



// ─── Telemetri versi perangkat ───────────────────────────────────────────────
//
// Aplikasi mobile memanggil POST /api/v1/report-version SETIAP selesai OTA
// (lihat src/services/ota.ts → reportOtaVersion) dan hanya menganggap status 200
// sebagai berhasil. Route ini dulu tidak pernah ada di backend sehingga tiap
// laporan berakhir 404 (Cannot POST) dan versi perangkat tak pernah tercatat.
//
// Tanpa token: permintaan dikirim langsung dari perangkat (CapacitorHttp) yang
// belum tentu punya sesi login. Karena itu payload divalidasi ketat dan hanya
// boleh memperbarui barisnya sendiri (device_id = PRIMARY KEY).
const REPORT_VERSION_MAX = { deviceId: 128, version: 32, platform: 32 };

router.post('/report-version', (req, res) => {
  try {
    const body = req.body || {};
    const deviceId = String(body.deviceId ?? '').trim();
    const version = String(body.version ?? '').trim();
    const platform = String(body.platform ?? '').trim() || 'unknown';

    if (!deviceId || !version) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'deviceId & version wajib diisi' });
    }
    if (deviceId.length > REPORT_VERSION_MAX.deviceId
      || version.length > REPORT_VERSION_MAX.version
      || platform.length > REPORT_VERSION_MAX.platform) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'deviceId/version/platform terlalu panjang' });
    }

    // Upsert: satu baris per perangkat. Versi terakhir menang, jumlah laporan naik
    // (dipakai untuk membedakan perangkat yang benar-benar aktif dari yang sekali
    // lapor). Report ulang versi yang sama tidak boleh menggandakan baris.
    db.prepare(`
      INSERT INTO device_versions (device_id, version, platform, report_count, first_seen, last_seen)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(device_id) DO UPDATE SET
        version = excluded.version,
        platform = excluded.platform,
        report_count = device_versions.report_count + 1,
        last_seen = CURRENT_TIMESTAMP
    `).run(deviceId, version, platform);

    // Status 200 (bukan 201): klien hanya menganggap 200 sebagai sukses.
    res.json({ success: true, version, platform });
  } catch (error) {
    console.error('Report version error:', error && error.message);
    res.status(500).json({ error: 'REPORT_VERSION_FAILED', message: 'Gagal menyimpan versi perangkat' });
  }
});




// Sebaran versi perangkat — supaya laporan di atas bisa dibaca (tanpa ini data
// telemetri hanya menumpuk tanpa cara memeriksanya).
router.get('/device-versions', authenticate, requireAdmin, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT version, platform, COUNT(*) AS devices, MAX(last_seen) AS last_seen
        FROM device_versions
       GROUP BY version, platform
       ORDER BY version DESC
    `).all();
    const total = db.prepare(`SELECT COUNT(*) AS n FROM device_versions`).get();
    res.json({
      totalDevices: Number(total && total.n) || 0,
      versions: (rows || []).map(r => ({
        version: r.version,
        platform: r.platform,
        devices: Number(r.devices) || 0,
        lastSeen: r.last_seen || null,
      })),
    });
  } catch (error) {
    console.error('Device versions error:', error && error.message);
    res.status(500).json({ error: 'DEVICE_VERSIONS_FAILED' });
  }
});



module.exports = router;
