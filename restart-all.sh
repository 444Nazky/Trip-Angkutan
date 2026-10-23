#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "[-] Membangun & menjalankan aplikasi via Docker..."
BASE="$(cd "$(dirname "$0")" && pwd)"

echo "[-] Tarik kode terbaru dari repo..."
if git -C "$BASE" pull --ff-only; then
    echo "    OK"
else
    echo "    DILEWATI: ada perubahan lokal / tidak bisa akses repo (kode tetap dipakai dari sumber saat ini)"
fi
git -C "$BASE" log --oneline -1

sudo docker build -t trip-angkutan "$BASE"
sudo docker build -f "$BASE/Dockerfile.backend" -t trip-angkutan-api "$BASE"
sudo docker compose -f "$BASE/docker-compose.yml" up -d

sleep 2
echo "[*] Verifikasi layanan..."

ADMIN_STATUS=1
curl -sf http://localhost:8000 | grep -q "Admin Trip Angkutan" && ADMIN_STATUS=0

MOBILE_STATUS=1
curl -sf http://localhost:5173 | grep -q "Trip Angkutan" && MOBILE_STATUS=0

API_STATUS=1
curl -sf http://localhost:3000/api/health > /dev/null && API_STATUS=0

if [ $ADMIN_STATUS -eq 0 ]; then
    echo "  - Admin Service  : SUCCESS (Running smoothly)"
else
    echo "  - Admin Service  : FAILED (sudo docker logs trip-web)"
fi

if [ $MOBILE_STATUS -eq 0 ]; then
    echo "  - Mobile Service : SUCCESS (Running smoothly)"
else
    echo "  - Mobile Service : FAILED (sudo docker logs trip-web)"
fi

if [ $API_STATUS -eq 0 ]; then
    echo "  - API Intranet   : SUCCESS (port 3000)"
else
    echo "  - API Intranet   : FAILED (port 3000) - cek 'sudo docker logs trip-api'"
fi

LAN_IP=$(ip -4 addr show scope global 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
LAN_IP=${LAN_IP:-not detected}
echo ""
echo "=========================================="
echo "           ACCESS URL DIRECTORY           "
echo "=========================================="
echo " Admin  (Local)   : http://localhost:8000"
echo " Admin  (LAN)     : http://${LAN_IP}:8000"
echo " Mobile (Local)   : http://localhost:5173"
echo " Mobile (LAN)     : http://${LAN_IP}:5173"
echo " API    (Local)   : http://localhost:3000/api"
echo " API    (LAN)     : http://${LAN_IP}:3000/api"
echo "=========================================="
echo "Stop  : sudo docker compose -f $BASE/docker-compose.yml down"
echo "Cek  ADMIN UI (LAN): link above"
echo "Membersihkan kode lama otomatis: Docker membangun ulang dari sumber terbaru setiap eksekusi."
