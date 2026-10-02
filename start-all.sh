#!/bin/bash

echo "🔴 Killing all services..."
pkill -f "node src/index.js" 2>/dev/null
pkill -f "php -S" 2>/dev/null
pkill -f "ng serve" 2>/dev/null
pkill -f "vite" 2>/dev/null

sleep 2

echo "🟢 Starting Backend API (3000)..."
cd /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic/backend
nohup npm start > backend.log 2>&1 &
disown

echo "🟢 Starting Mobile (5173)..."
cd /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic
nohup npm start > mobile.log 2>&1 &
disown

echo "🟢 Starting Admin (8000)..."
cd /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic/admin-ci
cp /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic/archive/admin-ci/index.php /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic/admin-ci/ 2>/dev/null
nohup php -S localhost:8000 > admin.log 2>&1 &
disown

echo ""
echo "⏳ Waiting for services to be ready..."
for i in {1..10}; do
  API_RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health 2>/dev/null)
  MOBILE_RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173 2>/dev/null)
  ADMIN_RESP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000 2>/dev/null)

  ALL_OK=true
  [ "$API_RESP" = "200" ] || ALL_OK=false
  [ "$MOBILE_RESP" = "200" ] || ALL_OK=false
  [ "$ADMIN_RESP" = "200" ] || ALL_OK=false

  [ "$ALL_OK" = "true" ] && break
  sleep 1
done

echo ""
echo "═══════════════════════════════"
echo "  Status Services"
echo "═══════════════════════════════"
echo "  API (3000):   $( [ "$API_RESP" = "200" ] && echo "✅ OK (HTTP $API_RESP)" || echo "❌ FAIL (HTTP $API_RESP)"
echo "  Mobile (5173): $( [ "$MOBILE_RESP" = "200" ] && echo "✅ OK (HTTP $MOBILE_RESP)" || echo "❌ FAIL (HTTP $MOBILE_RESP)"
echo "  Admin (8000): $( [ "$ADMIN_RESP" = "200" ] && echo "✅ OK (HTTP $ADMIN_RESP)" || echo "❌ FAIL (HTTP $ADMIN_RESP)"
echo "═══════════════════════════════"
echo ""
echo "📝 Logs: tail -f backend.log mobile.log admin.log"