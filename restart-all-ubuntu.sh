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
sudo docker compose -f "$BASE/docker-compose.yml" up -d

sleep 3
echo "[*] Verifikasi layanan..."

# Cek port 8000 dan 5173 merespons HTTP (tanpa grep string ketat yang gampang meleset)
ADMIN_STATUS=1
curl -sSf http://localhost:8000 > /dev/null && ADMIN_STATUS=0

MOBILE_STATUS=1
curl -sSf http://localhost:5173 > /dev/null && MOBILE_STATUS=0

if [ $ADMIN_STATUS -eq 0 ]; then
    echo "  - Admin Service  : SUCCESS (Running smoothly)"
else
    echo "  - Admin Service  : FAILED (Cek 'sudo docker compose logs')"
fi

if [ $MOBILE_STATUS -eq 0 ]; then
    echo "  - Mobile Service : SUCCESS (Running smoothly)"
else
    echo "  - Mobile Service : FAILED (Cek 'sudo docker compose logs')"
fi

# Ambil IP khusus dari interface eno1 (kabel LAN yang terhubung ke router Linksys)
LAN_IP=$(ip -4 addr show dev eno1 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}')
LAN_IP=${LAN_IP:-not detected}

echo ""
echo "=========================================="
echo "           ACCESS URL DIRECTORY           "
echo "=========================================="
echo " Admin  (Local)   : http://localhost:8000"
echo " Admin  (LAN)     : http://${LAN_IP}:8000"
echo " Mobile (Local)   : http://localhost:5173"
echo " Mobile (LAN)     : http://${LAN_IP}:5173"
echo "=========================================="
echo "Stop  : sudo docker compose -f $BASE/docker-compose.yml down"
echo "Cek  ADMIN UI (LAN): link above"
echo "Membersihkan kode lama otomatis: Docker membangun ulang dari sumber terbaru setiap eksekusi."