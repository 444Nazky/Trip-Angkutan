#!/bin/bash
set -e
VERSION=""
NOTES="Update release"

# Parse args
for arg in "$@"; do
  case $arg in
    --notes=*) NOTES="${arg#*=}";;
    --help|-h) echo "Usage: $0 <version> [--notes='Release notes']"; exit 0;;
    --*) echo "Unknown: $arg"; exit 1;;
    *) VERSION="$arg";;
  esac
done

if [[ -z "$VERSION" ]]; then echo "Usage: $0 <version>"; exit 1; fi
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then echo "Invalid version format"; exit 1; fi

echo "════════════════════════════════════"
echo " Publish v$VERSION"
echo "════════════════════════════════════"

# Build APK
echo "[1/4] Building..."
npm run build >/dev/null 2>&1
npx cap sync android >/dev/null 2>&1
cd android && ./gradlew assembleRelease >/dev/null 2>&1 && cd ..
APK=$(find . -name "*.apk" -path "*/release/*" | head -1 || find . -name "*.apk" | head -1)
echo " APK: $APK"

# Upload
echo "[2/4] Uploading..."
URL=$(curl -s -F "reqtype=fileupload" -F "fileToUpload=@$APK" https://catbox.moe/user/api.php)
echo " URL: $URL"
if ! [[ "$URL" =~ ^http ]]; then echo "Upload failed"; exit 1; fi

# Update backend
echo "[3/4] Updating backend..."
FILE="backend/src/routes/appVersion.js"
# Add entry to HARDCODED_URLS
sed -i "s|const HARDCODED_URLS = {|const HARDCODED_URLS = {\n    '$VERSION': '$URL',|g" "$FILE" 2>/dev/null || true
echo " Updated $FILE"

# Git
echo "[4/4] Pushing..."
git add -A 2>/dev/null || true
git commit -m "release: v$VERSION

Notes: $NOTES
APK: $URL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" 2>/dev/null || echo " Nothing to commit"
git push origin HEAD 2>&1 | tail -3

echo ""
echo "════════════════════════════════════"
echo " Done! v$VERSION published"
echo " URL: $URL"
echo " Railway auto-deploying..."
echo " Check: https://railway.app/project/aplikasi-trip"
