/**
 * App Version Routes - Supabase Version
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { absoluteBase } = require('../absolute-url');
const { supabase, supabaseAdmin, helpers } = require('../lib/supabase');
const { authenticate, requireAdmin } = require('../middleware/auth');

const APK_DIR = process.env.APK_DIR || path.join(__dirname, '..', '..', 'apks');
const METADATA_DIR = process.env.METADATA_DIR || path.join(__dirname, '..', '..', 'metadata');

const APK_CDN_BASE = process.env.APK_CDN_URL || '';

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

const apkInfoCache = new Map();

function localApkInfo(version) {
  const file = path.join(APK_DIR, `app-${version}.apk`);
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  const key = `${stat.size}:${stat.mtimeMs}`;
  const cached = apkInfoCache.get(version);
  if (cached && cached.key === key) return cached;
  let sha256 = '';
  try { sha256 = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); } catch {}
  const info = { key, file, size: stat.size, sha256 };
  apkInfoCache.set(version, info);
  return info;
}

function envDownloadUrl(version) {
  const envKey = `APK_DOWNLOAD_URL_${version.replace(/\./g, '_')}`;
  return isAbsoluteUrl(process.env[envKey]) ? String(process.env[envKey]).trim() : '';
}

function cdnDownloadUrl(version) {
  const cdnBase = absoluteBase(APK_CDN_BASE);
  if (cdnBase) return `${cdnBase}/app-${version}.apk`;
  return '';
}

function isSelfDownloadUrl(url) {
  return /\/api\/v1\/app-download\//i.test(String(url ?? ''));
}

function requestBase(req) {
  const forwardedProto = String(req?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim();
  const proto = forwardedProto || req?.protocol || 'https';
  const forwardedHost = String(req?.headers?.['x-forwarded-host'] ?? '').split(',')[0].trim();
  const host = forwardedHost || req?.get?.('host') || '';
  if (!host) return absoluteBase(process.env.PUBLIC_BASE_URL || '');
  return `${proto}://${host}`;
}

const headCache = new Map();

async function remoteUrlIsAlive(url) {
  const hit = headCache.get(url);
  if (hit && Date.now() - hit.at < 60_000) return hit.alive;
  let alive = false;
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(4000) });
    alive = res.ok;
  } catch { alive = false; }
  headCache.set(url, { at: Date.now(), alive });
  return alive;
}

function declaredVersionMatches(version, release) {
  const declared = String(release?.apkVersionName ?? '').trim();
  if (!declared) return true;
  return declared === String(version).trim();
}

async function resolvePackage(version, release, baseUrl = '') {
  if (!declaredVersionMatches(version, release)) {
    return { available: false, source: 'version-mismatch', size: null, sha256: null, url: null };
  }

  const local = localApkInfo(version);
  if (local) {
    return {
      available: true,
      source: 'local',
      size: local.size,
      sha256: local.sha256 || release?.apkHash || null,
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

// GET APP VERSION
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

// GET RELEASE NOTES
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

// GET APK LIST
router.get('/apk-list', (req, res) => {
  try {
    ensureDirs();
    const files = fs.readdirSync(APK_DIR)
      .filter(f => f.startsWith('app-') && f.endsWith('.apk'))
      .map(f => ({ version: f.replace('app-', '').replace('.apk', ''), filename: f }))
      .sort((a, b) => compareVersions(a.version, b.version));
    res.json({ count: files.length, apks: files });
  } catch {
    res.json({ count: 0, apks: [] });
  }
});

// PUBLISH VERSION
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
          return res.status(400).json({ error: 'APK_TOO_SMALL', message: `Data APK terlalu kecil (${apkBuffer.length} byte)` });
        }
        const apkPath = path.join(APK_DIR, `app-${version}.apk`);
        fs.writeFileSync(apkPath, apkBuffer);
        console.log(`APK saved: ${apkBuffer.length} bytes`);
      } catch {
        return res.status(500).json({ error: 'APK_SAVE_FAILED', message: 'Gagal menyimpan APK' });
      }
    }

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

// REPORT DEVICE VERSION
router.post('/report-version', async (req, res) => {
  try {
    const body = req.body || {};
    const deviceId = String(body.deviceId ?? '').trim();
    const version = String(body.version ?? '').trim();
    const platform = String(body.platform ?? '').trim() || 'unknown';

    if (!deviceId || !version) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'deviceId & version wajib diisi' });
    }
    if (deviceId.length > 128 || version.length > 32 || platform.length > 32) {
      return res.status(400).json({ error: 'INVALID_PAYLOAD', message: 'deviceId/version/platform terlalu panjang' });
    }

    const client = supabaseAdmin || supabase;
    await client.from('device_versions').upsert({
      device_id: deviceId,
      version,
      platform,
      last_seen: new Date().toISOString(),
    }, { onConflict: 'device_id' });

    res.json({ success: true, version, platform });
  } catch (error) {
    console.error('Report version error:', error?.message);
    res.status(500).json({ error: 'REPORT_VERSION_FAILED', message: 'Gagal menyimpan versi perangkat' });
  }
});

// GET DEVICE VERSIONS
router.get('/device-versions', authenticate, requireAdmin, async (req, res) => {
  try {
    const client = supabaseAdmin || supabase;
    const { data, error } = await client
      .from('device_versions')
      .select('version, platform');

    if (error) throw error;

    // Group by version and platform
    const groups = {};
    for (const dv of (data || [])) {
      const key = `${dv.version}|${dv.platform}`;
      if (!groups[key]) groups[key] = { version: dv.version, platform: dv.platform, devices: 0 };
      groups[key].devices++;
    }

    const versions = Object.values(groups).sort((a, b) => b.version.localeCompare(a.version));

    res.json({
      totalDevices: (data || []).length,
      versions,
    });
  } catch (error) {
    console.error('Device versions error:', error?.message);
    res.status(500).json({ error: 'DEVICE_VERSIONS_FAILED' });
  }
});

module.exports = router;
