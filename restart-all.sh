#!/bin/bash

# Directory Configuration
MOBILE_DIR="/home/nazky/RPL/Intern/mobile-trip Mobile Branch"
ADMIN_DIR="/home/nazky/RPL/Intern/Aplikasi-Trip-Main Branch"

echo "[-] Stopping existing services..."
pkill -f "php -S" 2>/dev/null
pkill -f "vite" 2>/dev/null
pkill -f "npm start" 2>/dev/null

sleep 2

echo "[+] Starting Mobile (Port 5173)..."
if [ -d "$MOBILE_DIR" ]; then
    cd "$MOBILE_DIR" || exit 1
    nohup npm start > mobile.log 2>&1 &
    disown
else
    echo "[x] Error: Mobile directory not found!"
    exit 1
fi

sleep 3

echo "[+] Starting Admin Dashboard (Port 8000)..."
if [ -d "$ADMIN_DIR" ]; then
    cd "$ADMIN_DIR" || exit 1
    nohup php -S 0.0.0.0:8000 -t admin-www > admin.log 2>&1 &
    disown
else
    echo "[x] Error: Admin directory not found!"
    exit 1
fi

sleep 2

echo "[*] Verifying services..."

# Check Mobile Service
curl -s http://localhost:5173 | grep -q "Trip Angkutan"
MOBILE_STATUS=$?

# Check Admin Service
curl -s http://localhost:8000 | grep -q "Expert\|Trip\|Angkutan\|Admin"
ADMIN_STATUS=$?

if [ $MOBILE_STATUS -eq 0 ]; then
    echo "  - Mobile Service : SUCCESS (Running smoothly)"
else
    echo "  - Mobile Service : FAILED (Check mobile.log)"
fi

if [ $ADMIN_STATUS -eq 0 ]; then
    echo "  - Admin Service  : SUCCESS (Running smoothly)"
else
    echo "  - Admin Service  : FAILED (Check admin.log)"
fi

# Get LAN IP
LAN_IP=$(ip -4 addr show scope global 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
LAN_IP=${LAN_IP:-not detected}

echo ""
echo "=========================================="
echo "           ACCESS URL DIRECTORY           "
echo "=========================================="
echo " Mobile (Local)   : http://localhost:5173"
echo " Mobile (LAN)     : http://${LAN_IP}:5173"
echo " Admin  (Local)   : http://localhost:8000"
echo " Admin  (LAN)     : http://${LAN_IP}:8000"
echo "=========================================="
echo "Logs: tail -f mobile.log admin.log"