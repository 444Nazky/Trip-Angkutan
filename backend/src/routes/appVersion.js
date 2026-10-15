const express = require('express')
const router = express.Router()
const path = require('path')
const fs = require('fs')

const APK_DIR = path.join(__dirname, '..', '..', 'apks')
const METADATA_DIR = path.join(__dirname, '..', '..', 'metadata')

const APK_CDN_BASE = process.env.APK_CDN_URL || ''
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL || ''



function ensureDirs() {
  if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true })
  if (!fs.existsSync(METADATA_DIR)) fs.mkdirSync(METADATA_DIR, { recursive: true })
}



function loadVersionMetadata() {
  ensureDirs()
  const metadataPath = path.join(METADATA_DIR, 'versions.json')
  if (fs.existsSync(metadataPath)) {
    try {
      return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
    } catch { return null }
  }
  return null
}



function saveVersionMetadata(metadata) {
  ensureDirs()
  const metadataPath = path.join(METADATA_DIR, 'versions.json')
  fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2))
}



function compareVersions(current, latest) {
  const parse = (v) => v.split('.').map(Number)
  const [c1, c2, c3] = parse(current)
  const [l1, l2, l3] = parse(latest)
  if (l1 > c1) return 1
  if (l1 === c1 && l2 > c2) return 1
  if (l1 === c1 && l2 === c2 && l3 > c3) return 1
  return 0
}



function getDownloadUrl(version) {
  const metadata = loadVersionMetadata()

  const envKey = `APK_DOWNLOAD_URL_${version.replace(/\./g, '_')}`
  if (process.env[envKey]) return process.env[envKey]

  if (process.env.APK_DOWNLOAD_URL_LATEST && metadata?.latest?.version === version) {
    return process.env.APK_DOWNLOAD_URL_LATEST
  }

  if (metadata?.releases?.[version]?.downloadUrl) return metadata.releases[version].downloadUrl
  if (metadata?.latest?.version === version && metadata?.latest?.downloadUrl) return metadata.latest.downloadUrl

  if (APK_CDN_BASE) return `${APK_CDN_BASE}/app-${version}.apk`
  if (RAILWAY_STATIC_URL) return `${RAILWAY_STATIC_URL}/releases/app-${version}.apk`

  const HARDCODED_URLS = {
    '1.0.1': 'https://files.catbox.moe/dfvc89.apk',
    '1.0.0': 'https://files.catbox.moe/f67x5q.apk',
  }
  if (HARDCODED_URLS[version]) return HARDCODED_URLS[version]

  const apkPath = path.join(APK_DIR, `app-${version}.apk`)
  return fs.existsSync(apkPath) ? `/api/v1/app-download/${version}` : null
}



router.get('/app-version', (req, res) => {
  try {
    const { current = '0.0.0' } = req.query
    const metadata = loadVersionMetadata()

    if (!metadata || !metadata.latest) {
      return res.json({
        latestVersion: current,
        updateAvailable: false,
        downloadUrl: null,
        releaseNotes: null,
      })
    }

    const latestVersion = metadata.latest.version
    const updateAvailable = compareVersions(current, latestVersion) > 0

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
    })
  } catch (error) {
    console.error('Error checking app version:', error)
    res.status(500).json({ error: 'VERSION_CHECK_FAILED', message: 'Gagal memeriksa versi' })
  }
})



router.get('/apk-list', (req, res) => {
  try {
    const files = fs.readdirSync(APK_DIR)
      .filter(f => f.startsWith('app-') && f.endsWith('.apk'))
      .map(f => ({ version: f.replace('app-', '').replace('.apk', ''), filename: f }))
      .sort((a, b) => compareVersions(a.version, b.version))
    res.json({ count: files.length, apks: files })
  } catch {
    res.json({ count: 0, apks: [] })
  }
})



router.post('/publish-version', (req, res) => {
  try {
    const secret = req.headers['x-publish-secret']
    const expectedSecret = process.env.PUBLISH_SECRET || 'trip-angkut-secret'
    if (secret !== expectedSecret) {
      return res.status(401).json({ error: 'UNAUTHORIZED', message: 'Unauthorized' })
    }

    const { version, downloadUrl, apkBase64, releaseNotes, isForceUpdate, minVersion } = req.body

    if (!version) return res.status(400).json({ error: 'MISSING_VERSION', message: 'Versi harus diisi' })

    const semverRegex = /^\d+\.\d+\.\d+$/
    if (!semverRegex.test(version)) {
      return res.status(400).json({ error: 'INVALID_VERSION', message: 'Format versi tidak valid' })
    }

    if (!downloadUrl && !apkBase64) {
      return res.status(400).json({ error: 'MISSING_SOURCE', message: 'Harus ada downloadUrl atau apkBase64' })
    }

    ensureDirs()

    if (apkBase64 && !downloadUrl) {
      try {
        const apkBuffer = Buffer.from(apkBase64, 'base64')
        const apkPath = path.join(APK_DIR, `app-${version}.apk`)
        fs.writeFileSync(apkPath, apkBuffer)
        console.log(`APK saved: ${apkBuffer.length} bytes`)
      } catch {
        return res.status(500).json({ error: 'APK_SAVE_FAILED', message: 'Gagal menyimpan APK' })
      }
    }

    const metadata = loadVersionMetadata() || { latest: null, releases: {} }
    const releaseData = {
      version,
      downloadUrl: downloadUrl || null,
      releaseDate: new Date().toISOString(),
      releaseNotes: releaseNotes || '',
      isForceUpdate: isForceUpdate || false,
      minVersion: minVersion || null,
    }

    if (!metadata.latest || compareVersions(metadata.latest.version, version) < 0) {
      metadata.latest = releaseData
    }
    metadata.releases[version] = releaseData
    saveVersionMetadata(metadata)

    res.json({ success: true, version, message: `Versi ${version} dipublish` })
  } catch (error) {
    console.error('Error publishing:', error)
    res.status(500).json({ error: 'PUBLISH_FAILED', message: 'Gagal publish' })
  }
})



// =============================================================================
// LAPORAN VERSI MOBILE → SERVER
// Mobile Wajib melaporkan versinya setiap kali berhasil update OTA atau startup
// agar server bisa lacak versi berapa yang benar-benar terinstall di client
// =============================================================================
const DEVICE_VERSIONS_FILE = path.join(METADATA_DIR, 'device_versions.json')

function loadDeviceVersions() {
  ensureDirs()
  const filePath = DEVICE_VERSIONS_FILE
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    } catch { return {} }
  }
  return {}
}

function saveDeviceVersions(data) {
  ensureDirs()
  fs.writeFileSync(DEVICE_VERSIONS_FILE, JSON.stringify(data, null, 2))
}

/**
 * POST /api/v1/report-version
 * Body: { deviceId: string, version: string, platform?: string }
 *
 * Mobile HARUS memanggil endpoint ini setiap:
 * 1. Setelah OTA update BERHASIL diinstall
 * 2. Saat startup aplikasi
 *
 * Ini memastikan server selalu tahu versi sebenarnya yang terinstall di mobile
 */
router.post('/report-version', (req, res) => {
  try {
    const { deviceId, version, platform } = req.body

    if (!deviceId || !version) {
      return res.status(400).json({ error: 'MISSING_FIELDS', message: 'deviceId dan version wajib diisi' })
    }

    const semverRegex = /^\d+\.\d+\.\d+/
    if (!semverRegex.test(version)) {
      return res.status(400).json({ error: 'INVALID_VERSION', message: 'Format versi tidak valid' })
    }

    const deviceVersions = loadDeviceVersions()
    const now = new Date().toISOString()

    // Update data perangkat
    deviceVersions[deviceId] = {
      version,
      platform: platform || 'android',
      lastReported: now,
      firstSeen: deviceVersions[deviceId]?.firstSeen || now,
    }

    saveDeviceVersions(deviceVersions)
    console.log(`[Version] Device ${deviceId} melaporkan versi: ${version}`)

    res.json({ success: true, message: `Versi ${version} tercatat` })
  } catch (error) {
    console.error('Error reporting version:', error)
    res.status(500).json({ error: 'REPORT_FAILED', message: 'Gagal mencatat versi' })
  }
})

/**
 * GET /api/v1/device-versions
 * Query: deviceId (optional)
 *
 * Admin bisa lihat versi yang terinstall di semua/perangkat tertentu
 */
router.get('/device-versions', (req, res) => {
  try {
    const { deviceId } = req.query
    const deviceVersions = loadDeviceVersions()

    if (deviceId) {
      const data = deviceVersions[deviceId]
      if (!data) {
        return res.status(404).json({ error: 'NOT_FOUND', message: 'Device tidak ditemukan' })
      }
      return res.json({ deviceId, ...data })
    }

    // Tampilkan semua perangkat
    const summary = Object.entries(deviceVersions).map(([id, data]) => ({
      deviceId: id,
      ...data,
    })).sort((a, b) => new Date(b.lastReported) - new Date(a.lastReported))

    // Hitung statistik versi
    const versionStats = {}
    for (const device of summary) {
      versionStats[device.version] = (versionStats[device.version] || 0) + 1
    }

    res.json({
      totalDevices: summary.length,
      versionStats,
      devices: summary,
    })
  } catch (error) {
    console.error('Error getting device versions:', error)
    res.status(500).json({ error: 'FETCH_FAILED', message: 'Gagal mengambil data' })
  }
})

module.exports = router
