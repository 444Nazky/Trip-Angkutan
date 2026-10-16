#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Trip Angkutan — start SEMUA layanan, siap diakses dari jaringan LAN (0.0.0.0)
#
# Layout nyata repo ini (empat checkout terpisah; tidak ada folder
# "Aplikasi-Trip-Ionic"):
#   Backend API 3000 : <repo>/backend     (Express, listen 0.0.0.0)
#   Mobile      5173 : <repo>             (Angular CLI `ng serve`, --host 0.0.0.0)
#   Admin       8000 : <repo>/admin-ci    (php -S 0.0.0.0:8000 + shim index.php)
#
#   <repo> = direktori script ini berada = "Aplikasi-Trip-Main Branch"
#
# PENTING: semua service listen di 0.0.0.0 (BUKAN localhost/127.0.0.1) supaya
# orang lain di jaringan yang sama bisa membukanya lewat http://<IP-LAN>:PORT
# tanpa Cloudflare Tunnel. Script mencetak URL LAN-nya di akhir.
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

# IP LAN mesin ini (dipakai untuk mencetak URL yang bisa dibuka dari HP/laptop lain).
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
# Shim index.php (gaya CodeIgniter) disalin dari archive/ bila belum ada.
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
echo "Verification (localhost)..."
if [ "$API_OK" = 1 ]; then echo "API: OK"; else echo "API: FAIL"; fi
if [ "$MOBILE_OK" = 1 ]; then echo "Mobile: OK"; else echo "Mobile: FAIL"; fi
if [ "$ADMIN_OK" = 1 ]; then echo "Admin: OK"; else echo "Admin: FAIL"; fi

# Pastikan socket benar-benar terikat ke 0.0.0.0 (bukan 127.0.0.1 saja),
# itulah yang membuat perangkat lain di LAN bisa konek.
echo ""
echo "Verification (binding LAN 0.0.0.0)..."
if command -v ss >/dev/null 2>&1; then
  LISTEN=$(ss -ltn 2>/dev/null)
else
  LISTEN=$(netstat -ltn 2>/dev/null)
fi
for p in "$API_PORT" "$MOBILE_PORT" "$ADMIN_PORT"; do
  if echo "$LISTEN" | grep -qE "0\.0\.0\.0:$p\b"; then
    echo "  $p: listening on 0.0.0.0 ✓"
  else
    echo "  $p: NOT on 0.0.0.0 ✗ (klien LAN tidak akan bisa konek)"
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════"
echo "  Akses dari jaringan yang sama (HP/laptop lain):"
echo "    API     : http://${MY_IP:-<IP-LAN>}:$API_PORT"
echo "    Mobile  : http://${MY_IP:-<IP-LAN>}:$MOBILE_PORT"
echo "    Admin   : http://${MY_IP:-<IP-LAN>}:$ADMIN_PORT"
echo ""
echo "  Untuk mengarahkan aplikasi ke backend lokal ini, isi URL server di"
echo "  menu Pengaturan Server dengan: http://${MY_IP:-<IP-LAN>}:$API_PORT/api"
echo "═══════════════════════════════════════════════════════════"
echo ""
echo "📝 Logs: tail -f $BACKEND_DIR/backend.log $PROJECT_DIR/mobile.log $ADMIN_DIR/admin.log"
