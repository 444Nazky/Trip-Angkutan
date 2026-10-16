#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Trip Angkutan — start SEMUA layanan dengan binding LAN (0.0.0.0)
#
# Layout nyata repo ini (empat checkout terpisah, bukan satu folder
# "Aplikasi-Trip-Ionic"):
#   Backend API 3000 : <repo>/backend            (Express, listen 0.0.0.0)
#   Mobile      5173 : <repo>                    (Angular CLI `ng serve`, --host 0.0.0.0)
#   Admin       8000 : <repo>/admin-ci           (php -S 0.0.0.0:8000 + index.php)
#
#   <repo> = direktori script ini berada = "Aplikasi-Trip-Main Branch"
#
# Semua service listen di 0.0.0.0 supaya bisa dibuka dari HP/LAN tanpa
# Cloudflare Tunnel. Path absolut → script bisa dijalankan dari folder mana pun.
#
# Override opsional: API_PORT, MOBILE_PORT, ADMIN_PORT, JWT_SECRET.
# ─────────────────────────────────────────────────────────────────────────────
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$PROJECT_DIR/backend"
ADMIN_DIR="$PROJECT_DIR/admin-ci"
ADMIN_SHIM="$PROJECT_DIR/archive/admin-ci/index.php"

# Backend fail-fast: tanpa JWT_SECRET proses langsung exit(1). Default dev di
# bawah sama dengan nilai yang dipakai README/Railway agar token lokal cocok.
# Di produksi WAJIB di-override lewat environment.
export JWT_SECRET="${JWT_SECRET:-trip-angkut-secret-key}"
API_PORT="${API_PORT:-3000}"
MOBILE_PORT="${MOBILE_PORT:-5173}"
ADMIN_PORT="${ADMIN_PORT:-8000}"

echo "🔴 Killing all services..."
pkill -f "node src/index.js" 2>/dev/null
pkill -f "php -S" 2>/dev/null
pkill -f "ng serve" 2>/dev/null
pkill -f "vite" 2>/dev/null

sleep 2

MY_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{print $7}')
if [ -z "${MY_IP:-}" ]; then
  MY_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
echo "🌐 PC LAN IP Detected: ${MY_IP:-unknown}"

echo "🟢 Starting Backend API ($API_PORT)..."
cd "$BACKEND_DIR" || exit 1
setsid nohup npm start > backend.log 2>&1 &
disown

sleep 3

echo "🟢 Starting Mobile ($MOBILE_PORT)..."
cd "$PROJECT_DIR" || exit 1
setsid nohup npm start -- --host 0.0.0.0 --port "$MOBILE_PORT" > mobile.log 2>&1 &
disown

sleep 4

echo "🟢 Starting Admin ($ADMIN_PORT)..."
cd "$ADMIN_DIR" || exit 1
# index.php cadangan (shim CodeIgniter-style) disalin bila build belum punya.
[ -f "$ADMIN_SHIM" ] && cp "$ADMIN_SHIM" ./index.php 2>/dev/null
setsid nohup php -S "0.0.0.0:$ADMIN_PORT" > admin.log 2>&1 &
disown

sleep 2

echo ""
echo "⏳ Waiting for services to be ready..."
API_OK=0; MOBILE_OK=0; ADMIN_OK=0
for _ in $(seq 1 45); do
  if [ "$API_OK" = 0 ] && curl -s "http://localhost:$API_PORT/api/health" | grep -q '"status":"ok"'; then API_OK=1; fi
  if [ "$MOBILE_OK" = 0 ] && curl -s "http://localhost:$MOBILE_PORT" | grep -q "Trip Angkutan"; then MOBILE_OK=1; fi
  if [ "$ADMIN_OK" = 0 ] && curl -s "http://localhost:$ADMIN_PORT" | grep -q "Trip Angkutan"; then ADMIN_OK=1; fi
  if [ "$API_OK" = 1 ] && [ "$MOBILE_OK" = 1 ] && [ "$ADMIN_OK" = 1 ]; then break; fi
  # ng serve kompilasi pertama bisa 30-60 detik
  sleep 2
done

echo ""
echo "Verification..."
if [ "$API_OK" = 1 ]; then echo "API: OK (Akses LAN: http://$MY_IP:$API_PORT)"; else echo "API: FAIL"; fi
if [ "$MOBILE_OK" = 1 ]; then echo "Mobile: OK (Akses LAN: http://$MY_IP:$MOBILE_PORT)"; else echo "Mobile: FAIL"; fi
if [ "$ADMIN_OK" = 1 ]; then echo "Admin: OK (Akses LAN: http://$MY_IP:$ADMIN_PORT)"; else echo "Admin: FAIL"; fi
echo ""
echo "📝 Logs: tail -f $BACKEND_DIR/backend.log $PROJECT_DIR/mobile.log $ADMIN_DIR/admin.log"
