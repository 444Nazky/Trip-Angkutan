#!/usr/bin/env bash
# Publish rilis APK: build → upload CDN → catat metadata → (opsional) git push.
# Jalankan dari ROOT branch mobile-trip: ./scripts/publish-release.sh 1.0.3
set -euo pipefail

VERSION=""
NOTES="Update release"

for arg in "$@"; do
  case $arg in
    --notes=*) NOTES="${arg#*=}";;
    --help|-h) echo "Usage: $0 <version> [--notes='Release notes']"; exit 0;;
    --*) echo "Unknown: $arg"; exit 1;;
    *) VERSION="$arg";;
  esac
done

if [[ -z "$VERSION" ]]; then echo "Usage: $0 <version>"; exit 1; fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "Invalid version format: $VERSION"; exit 1; fi

# ── Guard: harus dari root branch ──────────────────────────────────────────
if [[ ! -f package.json || ! -d android || ! -d backend ]]; then
  echo "Jalankan dari ROOT branch mobile-trip (ada package.json, android/, backend/)."
  exit 1
fi

# ── Guard: VERSION arg wajib = android versionName (anti-mismatch) ─────────
NATIVE_VER=$(grep -m1 'versionName' android/app/build.gradle | sed -E 's/.*"([^"]+)".*/\1/')
if [[ "$VERSION" != "$NATIVE_VER" ]]; then
  echo "MISMATCH: arg $VERSION != android versionName $NATIVE_VER."
  echo " samakan dulu (android/app/build.gradle) baru publish."
  exit 1
fi
PKG_VER=$(node -p "require('./package.json').version" 2>/dev/null || echo "?")
if [[ "$PKG_VER" != "$VERSION" ]]; then
  echo "PERINGATAN: package.json $PKG_VER != $VERSION (lanjut, tapi selaraskan).";
fi

echo "════════════════════════════════════"
echo " Publish v$VERSION"
echo "════════════════════════════════════"

echo "[1/4] Building..."
LOG=$(mktemp)
if ! npm run build >"$LOG" 2>&1; then echo "BUILD GAGAL:"; tail -20 "$LOG"; exit 1; fi
if ! npx cap sync android >"$LOG" 2>&1; then echo "CAP SYNC GAGAL:"; tail -20 "$LOG"; exit 1; fi
if ! (cd android && ./gradlew assembleRelease >"$LOG" 2>&1); then echo "GRADLE GAGAL:"; tail -20 "$LOG"; exit 1; fi
# APK TERBARU berdasar mtime — bukan head -1 sembarang (bisa nyomot build lama).
APK=$(find android/app/build/outputs/apk/release -name "*.apk" -printf "%T@ %p\n" 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
if [[ -z "${APK:-}" || ! -f "$APK" ]]; then echo "APK tidak ketemu setelah build."; exit 1; fi
echo " APK: $APK ($(du -h "$APK" | cut -f1))"

echo "[2/4] Uploading..."
URL=$(curl -sS -m 180 --retry 2 -F "reqtype=fileupload" -F "fileToUpload=@$APK" https://catbox.moe/user/api.php)
echo " URL: $URL"
if ! [[ "$URL" =~ ^http ]]; then echo "Upload failed"; exit 1; fi

echo "[3/4] Updating backend..."
# Idempoten: ganti entri versi-bila-ada, jangan prepend duplikat.
# Menulis backend/metadata/versions.json (sumber update API) + HARDCODED_URLS
# sebagai fallback. Mirror ke backend endpoint bila layout monorepo ada.
NOTES="$NOTES" node -e "
const fs = require('fs'), path = require('path');
const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1; }
  return 0;
};
const targets = ['backend/metadata/versions.json'];
const sib = '../endpoint-trip Endpoint Branch/backend/metadata/versions.json';
if (fs.existsSync(sib)) targets.push(sib);
const entry = { version: '$VERSION', downloadUrl: '$URL', releaseDate: new Date().toISOString(), releaseNotes: process.env.NOTES || '', isForceUpdate: false, minVersion: '1.0.0' };
for (const t of targets) {
  let m = { latest: null, releases: {} };
  try { m = JSON.parse(fs.readFileSync(t, 'utf8')); } catch {}
  m.releases = m.releases || {};
  m.releases['$VERSION'] = entry;
  if (!m.latest || cmp('$VERSION', m.latest.version) >= 0) m.latest = entry;
  fs.mkdirSync(path.dirname(t), { recursive: true });
  fs.writeFileSync(t, JSON.stringify(m, null, 2));
  console.log(' wrote ' + t);
}
// HARDCODED_URLS: replace-per-version (anti duplikat key).
for (const f of ['backend/src/routes/appVersion.js']) {
  if (!fs.existsSync(f)) continue;
  let c = fs.readFileSync(f, 'utf8');
  const line = \"    '$VERSION': '$URL',\";
  if (c.includes(\"'$VERSION':\")) c = c.replace(new RegExp(\"    '$VERSION': '[^']*',?\\n?\"), line + '\n');
  else c = c.replace('const HARDCODED_URLS = {', 'const HARDCODED_URLS = {\n' + line);
  fs.writeFileSync(f, c);
  console.log(' patched ' + f);
}
"

echo "[4/4] Pushing..."
cp -f "$APK" "Aplikasi-Trip-v${VERSION}-release.apk"
echo " Root copy: Aplikasi-Trip-v${VERSION}-release.apk"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git add -- "backend/metadata/versions.json" "backend/src/routes/appVersion.js" "Aplikasi-Trip-v${VERSION}-release.apk" 2>/dev/null || true
  git commit -m "release: v$VERSION

Notes: $NOTES
APK: $URL" 2>/dev/null || echo " Nothing to commit"
  git push origin HEAD 2>&1 | tail -3
else
  echo " (bukan git work tree — lewati push; sinkronkan folder backend ke deploy manual)"
fi

echo ""
echo "════════════════════════════════════"
echo " Done! v$VERSION published"
echo " URL: $URL"
echo " Railway auto-deploying..."
echo " Check: https://railway.app/project/aplikasi-trip"
