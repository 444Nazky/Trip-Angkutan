#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Trip Angkutan — start SEMUA layanan (layout folder terpisah pasca-split)
#
#   Backend API 3000 + Mobile 5173 : /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic
#                                     (repo utama, branch main — mobile)
#   Admin dashboard 8000           : /home/nazky/RPL/Intern/admin-dashboard
#                                     (clone terpisah, branch admin)
#
# Script ini memakai path absolut, jadi bisa dijalankan dari folder mana pun.
# ─────────────────────────────────────────────────────────────────────────────
MOBILE_ROOT=/home/nazky/RPL/Intern/Aplikasi-Trip-Ionic
ADMIN_ROOT=/home/nazky/RPL/Intern/admin-dashboard

echo "🔴 Killing all services..."
pkill -f "node src/index.js" 2>/dev/null
pkill -f "php -S" 2>/dev/null
pkill -f "ng serve" 2>/dev/null
pkill -f "vite" 2>/dev/null

sleep 2

# setsid: proses lahir di sesi sendiri supaya tetap hidup setelah shell
# pemanggil (terminal/agent) menutup — nohup+disown saja masih bisa ikut
# terbunuh saat process-group dibersihkan.
echo "🟢 Starting Backend API (3000)..."
cd "$MOBILE_ROOT/backend" || exit 1
setsid nohup npm start > backend.log 2>&1 &
disown

echo "🟢 Starting Mobile (5173)..."
cd "$MOBILE_ROOT" || exit 1
setsid nohup npm start > mobile.log 2>&1 &
disown

echo "🟢 Starting Admin (8000)..."
cd "$ADMIN_ROOT/admin-ci" || exit 1
# index.php cadangan ikut disalin (handle fallback bila build belum ada)
cp "$ADMIN_ROOT/archive/admin-ci/index.php" ./index.php 2>/dev/null
setsid nohup php -S localhost:8000 > admin.log 2>&1 &
disown

echo ""
echo "⏳ Waiting for services to be ready..."
API_RESP=000; MOBILE_RESP=000; ADMIN_RESP=000
for i in {1..15}; do
  API_RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null)
  MOBILE_RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null)
  ADMIN_RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000 2>/dev/null)

  if [ "$API_RESP" = "200" ] && [ "$MOBILE_RESP" = "200" ] && [ "$ADMIN_RESP" = "200" ]; then
    break
  fi
  # ng serve butuh ±30-60 detik untuk compile pertama kali
  sleep 2
done

ok() { [ "$1" = "200" ] && echo "✅ OK (HTTP $1)" || echo "❌ FAIL (HTTP $1)"; }

echo ""
echo "═════════════════════════════════"
echo "  Status Services"
echo "═════════════════════════════════"
echo "  API (3000):    $(ok "$API_RESP")"
echo "  Mobile (5173): $(ok "$MOBILE_RESP")"
echo "  Admin (8000):  $(ok "$ADMIN_RESP")"
echo "═════════════════════════════════"
echo ""
echo "📝 Logs: tail -f $MOBILE_ROOT/backend/backend.log $MOBILE_ROOT/mobile.log $ADMIN_ROOT/admin-ci/admin.log"
