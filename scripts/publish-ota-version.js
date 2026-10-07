#!/usr/bin/env node
/**
 * scripts/publish-ota-version.js
 *
 * Reads GITHUB_TOKEN from env, collects built assets from www/, fetches the current
 * branch HEAD, then upserts version.json to GitHub raw content API so Capacitor apps
 * can fetch it as a version manifest.
 *
 * Usage:
 *   GITHUB_TOKEN=ghs_... node scripts/publish-ota-version.js
 *   node scripts/publish-ota-version.js --token=ghs_...
 *
 * Run AFTER `npm run build`.
 */

"use strict"

const fs = require("fs")
const path = require("path")
const https = require("https")

const OWNER = "444Nazky"
const REPO = "Aplikasi-Trip-Ionic"
const BRANCH = "mobile"
const MANIFEST_PATH = "version.json"
const WEB_DIR = path.resolve(__dirname, "..", "www")

const token = process.argv
  .find((a) => a.startsWith("--token="))
  ?.split("=")[1]
  ?? process.env.GITHUB_TOKEN
  ?? process.env.GITHUB_TOKEN
if (!token) {
  console.error("❌  GITHUB_TOKEN required (env or --token=)")
  process.exit(1)
}

const api = (method, urlPath, body) =>
  new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : undefined
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-2010-10-07": token,
      "User-Agent": "trip-ota-publisher/1.0",
    }
    if (bodyStr) {
      headers["Content-Length"] = Buffer.byteLength(bodyStr)
    }
    const req = https.request(
      { hostname: "api.github.com", path: urlPath, method, headers },
      (res) => {
        let data = ""
        res.on("data", (c) => (data += c))
        res.on("end", () => {
          try { resolve(JSON.parse(data)) }
          catch { resolve({ _raw: data, statusCode: res.statusCode }) }
        })
      }
    )
    req.on("error", reject)
    if (bodyStr) req.write(bodyStr)
    req.end()
  })

function collectAssets(dir, base) {
  base = base || dir
  const results = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) results.push(...collectAssets(full, base))
    else if (entry.isFile()) results.push(path.relative(base, full))
  }
  return results
}

async function main() {
  // 1. Resolve branch HEAD SHA
  const refResp = await api("GET", `/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`)
  const headSha = refResp?.object?.sha
  if (!headSha) {
    console.error("❌  Could not resolve branch ref:", refResp)
    process.exit(1)
  }

  // 2. Collect assets
  const assets = collectAssets(WEB_DIR)
  console.log(`Found ${assets.length} built assets in ${WEB_DIR}`)

  // 3. Fetch existing version.json blob SHA if any
  let existingBlob = null
  try {
    existingBlob = await api("GET", `/repos/${OWNER}/${REPO}/contents/${MANIFEST_PATH}?ref=${BRANCH}`)
  } catch { /* first push is fine */ }

  // 4. Build manifest content
  const manifest = JSON.stringify({ version: headSha.slice(0, 7), assets }, null, 2)
  const contentB64 = Buffer.from(manifest).toString("base64")

  // 5. Upsert to GitHub
  const commitMsg = existingBlob
    ? `chore(ota): bump version to ${headSha.slice(0, 7)}`
    : `chore(ota): add ${MANIFEST_PATH}`
  const payload = {
    message: commitMsg,
    content: contentB64,
    branch: BRANCH,
  }
  if (existingBlob?.sha) payload.sha = existingBlob.sha

  // Upload every built asset so raw.githubusercontent can serve it
  for (const asset of assets) {
    const filePath = path.join(WEB_DIR, asset)
    const b64 = fs.readFileSync(filePath).toString('base64')
    let existing = null
    try {
      existing = await api("GET", `/repos/${OWNER}/${REPO}/contents/${asset}?ref=${BRANCH}`)
    } catch { /* new file */ }
    const assetPayload = {
      message: `chore(ota): asset ${asset}`,
      content: b64,
      branch: BRANCH,
    }
    if (existing?.sha) assetPayload.sha = existing.sha
    const r = await api("PUT", `/repos/${OWNER}/${REPO}/contents/${asset}`, assetPayload)
    if (!r.content) console.error(`❌ asset failed: ${asset}`, JSON.stringify(r).slice(0, 120))
  }
  console.log(`✅ ${assets.length} assets pushed`)

  const resp = await api("PUT", `/repos/${OWNER}/${REPO}/contents/${MANIFEST_PATH}`, payload)

  if (resp.content?.download_url) {
    console.log("✅  version.json pushed")
    console.log("   version:", headSha.slice(0, 7))
    console.log("   assets: ", assets.length, "files")
    console.log("   url:    ", resp.content.download_url)
    console.log("   raw:    ", `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${MANIFEST_PATH}`)
  } else {
    console.error("❌  GitHub push failed:", JSON.stringify(resp).slice(0, 200))
    process.exit(1)
  }
}

main().catch((e) => { console.error(e) })
