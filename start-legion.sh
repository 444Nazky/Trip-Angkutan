#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Trip Angkutan — Start SEMUA layanan di IP LAN lokal (auto-deteksi)
#
#   API Backend      : http://<LAN_IP>:3000
#   Mobile Client    : http://<LAN_IP>:5173
#   Admin Dashboard  : http://<LAN_IP>:8000
#
# Semua service listen di 0.0.0.0 supaya perangkat di jaringan bisa akses.
# ─────────────────────────────────────────────────────────────────────────────
set -u

LAN_IP="${LAN_IP:-$(ip -4 -o addr show scope global | awk '{split($4,a,"/"); if (a[1] ~ /^192\.168\./) print a[1]}' | head -n 1)}"
API_PORT=3000
MOBILE_PORT=5173
ADMIN_PORT=8000

# DIKEMBALIKAN KE DIREKTORI SEMULA
PROJECT_DIR="/home/nazky/RPL/Intern/Aplikasi-Trip-Main Branch"
BACKEND_DIR="$PROJECT_DIR/backend"
MOBILE_DIR="$PROJECT_DIR"
ADMIN_DIR="$PROJECT_DIR/admin-ci"

export JWT_SECRET="${JWT_SECRET:-trip-angkut-lan-dev-secret}"

echo "Killing all services..."
pkill -f "node src/index.js" 2>/dev/null
pkill -f "php -S" 2>/dev/null
pkill -f "vite" 2>/dev/null
pkill -f "ng serve" 2>/dev/null

sleep 2

echo "Local Wi-Fi IP Target: $LAN_IP"

echo "Starting Backend API ($API_PORT)..."
cd "$BACKEND_DIR" || exit 1
nohup node src/index.js > "$BACKEND_DIR/backend.log" 2>&1 &
disown

sleep 3

echo "Starting Mobile ($MOBILE_PORT)..."
cd "$MOBILE_DIR" || exit 1
nohup npm start -- --host 0.0.0.0 --port "$MOBILE_PORT" > "$MOBILE_DIR/mobile.log" 2>&1 &
disown

sleep 4

echo "Starting Admin ($ADMIN_PORT)..."
cd "$ADMIN_DIR" || exit 1
nohup php -S 0.0.0.0:"$ADMIN_PORT" > "$ADMIN_DIR/admin.log" 2>&1 &
disown

sleep 2

probe_host="$LAN_IP"
if ! ip -4 -o addr show | grep -q " $probe_host/"; then
  echo "WARNING: $probe_host belum terpasang di interface mesin ini — verifikasi lewat localhost."
  probe_host="127.0.0.1"
fi

wait_http() {
  local name=$1 url=$2 pattern=$3 tries=${4:-30}
  for _ in $(seq 1 "$tries"); do
    if curl -s -m 3 "$url" | grep -q "$pattern"; then return 0; fi
    sleep 3
  done
  return 1
}

echo "Verification..."
wait_http "API" "http://$probe_host:$API_PORT/api/health" '"status":"ok"' 10 \
  && echo "API: OK (http://$LAN_IP:$API_PORT)" || echo "API: FAIL"
wait_http "Mobile" "http://$probe_host:$MOBILE_PORT" "Trip Angkutan" 40 \
  && echo "Mobile: OK (http://$LAN_IP:$MOBILE_PORT)" || echo "Mobile: FAIL"
wait_http "Admin" "http://$probe_host:$ADMIN_PORT" "Trip Angkutan" 10 \
  && echo "Admin: OK (http://$LAN_IP:$ADMIN_PORT)" || echo "Admin: FAIL"

self_lan_ip="$(ip -4 -o addr show scope global | awk '{split($4,a,"/"); print $2, a[1]}' \
  | awk -v target="${LAN_IP%.*}" '$2 ~ ("^" target "\\.") {print $2; exit}')"
if [ -n "$self_lan_ip" ]; then
  if curl -s -m 4 -o /dev/null "http://$LAN_IP:$API_PORT/api/health"; then
    echo "Jalur petugas: OK — $LAN_IP menjawab di :$API_PORT"
  else
    echo "WARNING: $LAN_IP tidak menjawab di :$API_PORT/:$MOBILE_PORT/:$ADMIN_PORT."
    echo "    Bila alamat itu router/jembatan (bukan mesin ini), aktifkan"
    echo "    port forward TCP $API_PORT, $MOBILE_PORT, $ADMIN_PORT -> $self_lan_ip"
    echo "    atau arahkan HP langsung ke http://$self_lan_ip:$API_PORT/api"
  fi
fi

echo ""
echo "  Logs:"
echo "    tail -f $BACKEND_DIR/backend.log"
echo "    tail -f $MOBILE_DIR/mobile.log"
echo "    tail -f $ADMIN_DIR/admin.log"