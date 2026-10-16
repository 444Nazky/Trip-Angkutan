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


if [[ ! -f package.json || ! -d android || ! -d backend ]]; then
  echo "Jalankan dari ROOT branch mobile-trip (ada package.json, android/, backend/)."
  exit 1
fi


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

# ── Verifikasi versi DI DALAM APK ─────────────────────────────────────────────
# Ini penjaga kegagalan update paling mahal yang pernah terjadi di repo ini:
# berkas app-1.0.8.apk ternyata berisi 1.0.6 dan app-1.0.12.apk berisi 1.0.9.
# Server mengiklankan versi X, petugas memasang berkas yang isinya versi lama,
# versi aplikasi tak pernah berubah → popup update muncul selamanya dan mobile
# selalu "mismatch" saat mendeteksi versi dari server.
echo "[1b/4] Verifikasi versionName/versionCode di dalam APK..."
AAPT="$(ls -d "$HOME"/Android/Sdk/build-tools/*/aapt2 2>/dev/null | tail -1 || true)"
if [[ -z "${AAPT:-}" ]]; then AAPT="$(command -v aapt2 || true)"; fi
if [[ -z "${AAPT:-}" || ! -x "$AAPT" ]]; then
  echo "GAGAL: aapt2 tidak ditemukan — tidak bisa memastikan versi APK."
  echo " Set ANDROID_HOME ke Android SDK (build-tools/*/aapt2) lalu ulangi."
  exit 1
fi
BADGING=$("$AAPT" dump badging "$APK" 2>/dev/null | head -1 || true)
APK_VER=$(printf '%s' "$BADGING" | sed -E "s/.*versionName='([^']+)'.*/\1/")
APK_CODE=$(printf '%s' "$BADGING" | sed -E "s/.*versionCode='([0-9]+)'.*/\1/")
if [[ "$APK_VER" != "$VERSION" ]]; then
  echo "GAGAL: APK berisi versionName '$APK_VER', bukan '$VERSION'."
  echo " Android akan memasang berkas ini sebagai versi $APK_VER → versi tak pernah naik."
  echo " Perbaiki android/app/build.gradle (versionName/versionCode) lalu rebuild."
  exit 1
fi
PREV_CODE=$(node -e "try{const m=require('./backend/metadata/versions.json');const c=Object.values(m.releases||{}).map(r=>Number(r.apkVersionCode)||0);console.log(Math.max(0,...c))}catch{console.log(0)}" 2>/dev/null || echo 0)
if [[ -n "$APK_CODE" && "$APK_CODE" -le "$PREV_CODE" ]]; then
  echo "GAGAL: versionCode $APK_CODE <= rilis terakhir ($PREV_CODE) — Android menolak downgrade."
  echo " Naikkan versionCode di android/app/build.gradle."
  exit 1
fi
echo " ✓ APK berisi versi $APK_VER (versionCode $APK_CODE)"
mkdir -p backend/apks
cp -f "$APK" "backend/apks/app-$VERSION.apk"
echo " Salinan lokal: backend/apks/app-$VERSION.apk"

# Salinan ke backend endpoint (Railway) supaya /api/v1/app-download/<versi> juga
# dilayani langsung dari server, bukan hanya CDN. Sesi 2026-10-15: metadata pernah
# menunjuk versi tanpa berkas di server → update di HP selalu gagal.
SIB_APK_DIR="../endpoint-trip Endpoint Branch/backend/apks"
if [[ -d "$SIB_APK_DIR" ]]; then
  cp -f "$APK" "$SIB_APK_DIR/app-$VERSION.apk"
  echo " Salinan mirror endpoint: $SIB_APK_DIR/app-$VERSION.apk"
  echo "   (commit di repo endpoint: git -C '../endpoint-trip Endpoint Branch' add -f backend/apks/app-$VERSION.apk)"
fi

echo "[2/4] Uploading..."
URL=$(curl -sS -m 180 --retry 2 -F "reqtype=fileupload" -F "fileToUpload=@$APK" https://catbox.moe/user/api.php)
echo " URL: $URL"
if ! [[ "$URL" =~ ^http ]]; then echo "Upload failed"; exit 1; fi

echo "[3/4] Updating backend..."
# Idempoten: ganti entri versi-bila-ada, jangan prepend duplikat.
# Menulis backend/metadata/versions.json (sumber update API) + HARDCODED_URLS
# sebagai fallback. Mirror ke backend endpoint bila layout monorepo ada.
NOTES="$NOTES" APK_VER="$APK_VER" APK_CODE="$APK_CODE" node -e "
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const cmp = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1; }
  return 0;
};
const targets = ['backend/metadata/versions.json'];
const sib = '../endpoint-trip Endpoint Branch/backend/metadata/versions.json';
if (fs.existsSync(sib)) targets.push(sib);
// Ukuran + SHA-256 dari berkas lokal yang baru disalin: dipakai klien untuk
// verifikasi integritas, dan tetap benar walau unduhan memakai jalur CDN.
let apkSize = null, apkHash = null;
try {
  const buf = fs.readFileSync('backend/apks/app-$VERSION.apk');
  apkSize = buf.length;
  apkHash = crypto.createHash('sha256').update(buf).digest('hex');
} catch (e) { console.warn(' (hash lokal dilewati: ' + e.message + ')'); }
const entry = { version: '$VERSION', downloadUrl: '$URL', releaseDate: new Date().toISOString(), releaseNotes: process.env.NOTES || '', isForceUpdate: false, minVersion: '1.0.0', apkVersionName: process.env.APK_VER || '$VERSION', apkVersionCode: Number(process.env.APK_CODE) || null, apkSize, apkHash };
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
