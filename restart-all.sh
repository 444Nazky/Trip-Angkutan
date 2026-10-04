#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Trip Angkutan — RESTART semua layanan (layout folder terpisah pasca-split)
#
#   Backend API 3000 + Mobile 5173 : /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic
#                                     (repo utama, branch main — mobile)
#   Admin dashboard 8000           : /home/nazky/RPL/Intern/admin-dashboard
#                                     (clone terpisah, branch admin)
#
# Beda dengan start-all.sh: langkah admin juga sinkron build ulang
# (www → admin-ci) supaya perubahan kode admin ikut ter-serve.
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
# pemanggil (terminal/agent) menutup.
echo "🟢 Starting Backend API (3000)..."
cd "$MOBILE_ROOT/backend" || exit 1
setsid nohup npm start > backend.log 2>&1 &
sleep 3

echo "🟢 Starting Mobile (5173)..."
cd "$MOBILE_ROOT" || exit 1
setsid nohup npm start > mobile.log 2>&1 &
sleep 4

echo "🟢 Sync build admin (www → admin-ci)..."
cd "$ADMIN_ROOT" || exit 1
npm run sync:admin || npm run build:admin
cd "$ADMIN_ROOT/admin-ci" || exit 1
setsid nohup php -S localhost:8000 > admin.log 2>&1 &
sleep 2

echo "Verification..."
curl -s http://localhost:3000/api/health | grep -q "ok" && echo "API: OK" || echo "API: FAIL"
curl -s http://localhost:5173 | grep -q "Trip Angkutan" && echo "Mobile: OK" || echo "Mobile: FAIL"
curl -s http://localhost:8000 | grep -q "Trip Angkutan" && echo "Admin: OK" || echo "Admin: FAIL"

echo "Logs: tail -f $MOBILE_ROOT/backend/backend.log $MOBILE_ROOT/mobile.log $ADMIN_ROOT/admin-ci/admin.log"
