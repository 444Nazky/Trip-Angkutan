#!/bin/bash
echo "🔴 Killing all services..."
pkill -f "node src/index.js" 2>/dev/null
pkill -f "php -S" 2>/dev/null
pkill -f "ng serve" 2>/dev/null
pkill -f "vite" 2>/dev/null
sleep 2

echo "🟢 Starting Backend API (3000)..."
cd /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic/backend
npm start > backend.log 2>&1 &
sleep 3

echo "🟢 Starting Mobile (5173)..."
cd /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic
npm start > mobile.log 2>&1 &
sleep 4

echo "🟢 Starting Admin (8000)..."
cd /home/nazky/RPL/Intern/Aplikasi-Trip-Ionic/admin-ci
php -S localhost:8000 > admin.log 2>&1 &
sleep 2

echo "✅ Verification..."
curl -s http://localhost:3000/api/health | grep -q "ok" && echo "API: OK" || echo "API: FAIL"
curl -s http://localhost:5173 | grep -q "Trip Angkutan" && echo "Mobile: OK" || echo "Mobile: FAIL"
curl -s http://localhost:8000 | grep -q "Trip Angkutan" && echo "Admin: OK" || echo "Admin: FAIL"

echo "📋 Logs: tail -f backend.log mobile.log admin.log"
