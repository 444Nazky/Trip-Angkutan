#!/bin/bash
# =============================================================================
#  rebuild.sh
#  Bangun ulang image Docker Trip Angkutan (web + API intranet) dari sumber
#  terbaru, lalu jalankan restart-all-ubuntu.sh.
#
#  Dipisah dari restart-all-ubuntu.sh karena build memakan waktu lama:
#    - Perubahan kode       -> ./rebuild.sh
#    - Cuma restart layanan -> ./restart-all-ubuntu.sh
#
#  Kalau build gagal, container lama dibiarkan berjalan (tidak ada `down`).
# =============================================================================

set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"

# ── Deteksi docker (sama dengan restart-all-ubuntu.sh) ───────────────────────

if [ "$(id -u)" -eq 0 ]; then
    DOCKER="docker"
elif docker info > /dev/null 2>&1; then
    DOCKER="docker"
elif sudo -n true 2>/dev/null; then
    DOCKER="sudo -n docker"
else
    DOCKER="sudo docker"
    if [ ! -t 0 ]; then
        echo "[!] Menjalankan tanpa TTY dan sudo butuh password - perintah docker bisa gagal."
    fi
fi

if ! $DOCKER info > /dev/null 2>&1; then
    echo "[X] Docker tidak bisa diakses. Pastikan Docker terinstall dan daemon berjalan."
    echo "    ($DOCKER info)"
    exit 1
fi

FAILURES=0

echo "[*] Build image web (admin + mobile)..."
if $DOCKER build -t trip-angkutan "$BASE"; then
    echo "    OK"
else
    echo "    GAGAL: build image web gagal - cek log di atas."
    FAILURES=$((FAILURES + 1))
fi

echo "[*] Build image API intranet..."
if $DOCKER build -f "$BASE/Dockerfile.backend" -t trip-angkutan-api "$BASE"; then
    echo "    OK"
else
    echo "    GAGAL: build image API intranet gagal - cek log di atas."
    FAILURES=$((FAILURES + 1))
fi

if [ "$FAILURES" -gt 0 ]; then
    echo "[X] Build gagal - container lama dibiarkan berjalan."
    exit 1
fi

echo "[*] Build selesai. Menjalankan restart..."
exec "$BASE/restart-all-ubuntu.sh"
