#!/bin/bash
# =============================================================================
#  restart-all-ubuntu.sh
#  Restart seluruh layanan Docker Trip Angkutan di PC kantor (Ubuntu).
#
#  Layanan:
#    - 8000  Admin Dashboard   (nginx, build www/admin)
#    - 5173  Mobile App        (nginx, build www)
#    - 3000  API INTRANET      (Deno, Edge Function yang sama dengan produksi)
#
#  Semua bind ke 0.0.0.0 supaya bisa diakses dari router Linksys lewat
#  port forwarding (8000 / 5173 / 3000).
#
#  Catatan: script ini SENGAJA memakai `set -uo pipefail` (bukan `-e`).
#  Satu langkah yang gagal tidak boleh menghentikan langkah berikutnya -
#  kalau build admin gagal, mobile & API intranet tetap harus hidup.
# =============================================================================

set -uo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$BASE/docker-compose.yml"
ENV_LOCAL="$BASE/supabase/functions/api/.env.local"
ENV_EXAMPLE="$BASE/supabase/functions/api/.env.example"

FAILURES=0
WARNINGS=0

ok()   { echo "    OK"; }
warn() { echo "    PERHATIAN: $*"; WARNINGS=$((WARNINGS + 1)); }
bad()  { echo "    GAGAL: $*"; FAILURES=$((FAILURES + 1)); }

# ── Deteksi docker (dengan atau tanpa sudo) ───────────────────────────────────

if [ "$(id -u)" -eq 0 ]; then
    DOCKER="docker"
elif sudo -n true 2>/dev/null; then
    DOCKER="sudo -n docker"
else
    DOCKER="sudo docker"
    if [ ! -t 0 ]; then
        echo "[!] Menjalankan tanpa TTY dan sudo butuh password - perintah docker bisa gagal."
    fi
fi

if ! $DOCKER info > /dev/null 2>&1; then
    echo "[X] Docker tidak bisa diakses. Pastikan Docker terinstall dan daemon berjalan."
    echo "    ($DOCKER info)"
    exit 1
fi

# ── Persiapan env server API intranet ─────────────────────────────────────────

echo "[*] Menyiapkan konfigurasi API intranet..."
if [ ! -f "$ENV_LOCAL" ]; then
    if [ -f "$ENV_EXAMPLE" ]; then
        cp "$ENV_EXAMPLE" "$ENV_LOCAL"
        warn "supabase/functions/api/.env.local belum ada - dibuat dari .env.example (nilainya masih kosong)."
        warn "SUPABASE_SERVICE_ROLE_KEY wajib diisi agar server intranet bisa melayani request."
    else
        mkdir -p "$(dirname "$ENV_LOCAL")"
        : > "$ENV_LOCAL"
        warn "supabase/functions/api/.env.local dibuat kosong - server intranet akan menolak start."
    fi
fi
# env_file wajib ada agar `docker compose up` tidak gagal dengan error cryptic.

if ! grep -qE '^SUPABASE_SERVICE_ROLE_KEY=.+' "$ENV_LOCAL" 2>/dev/null; then
    warn "SUPABASE_SERVICE_ROLE_KEY kosong di .env.local - container API intranet akan exit saat start."
fi
if ! grep -qE '^JWT_SECRET=.+' "$ENV_LOCAL" 2>/dev/null; then
    warn "JWT_SECRET kosong di .env.local - login intranet tetap jalan, tetapi token cloud/intranet tidak kompatibel (harus login ulang saat pindah endpoint)."
fi

# ── Ambil kode terbaru ───────────────────────────────────────────────────────

echo "[*] Menarik kode terbaru dari repo..."
if git -C "$BASE" pull --ff-only 2>/dev/null; then
    ok
else
    warn "git pull dilewati (perubahan lokal / repo tidak bisa diakses). Kode dipakai dari sumber saat ini."
fi
git -C "$BASE" log --oneline -1 2>/dev/null || true

# ── Build image ───────────────────────────────────────────────────────────────

echo "[*] Build image web (admin + mobile)..."
if $DOCKER build -t trip-angkutan "$BASE"; then
    ok
else
    bad "build image web gagal - cek log di atas."
fi

echo "[*] Build image API intranet..."
if $DOCKER build -f "$BASE/Dockerfile.backend" -t trip-angkutan-api "$BASE"; then
    ok
else
    bad "build image API intranet gagal - cek log di atas."
fi

# ── Jalankan / restart container ──────────────────────────────────────────────

echo "[*] Membersihkan container lama..."
# Container dengan nama trip-web / trip-api milik project LAIN (mis. checkout
# lama dengan nama folder berbeda) akan membuat `docker compose up` gagal
# dengan "container name is already in use" - restart jadi tidak idempotent.
# Buang dulu supaya eksekusi berikutnya selalu berhasil.
$DOCKER compose -f "$COMPOSE_FILE" down --remove-orphans > /dev/null 2>&1
for name in trip-web trip-api; do
    if $DOCKER ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "$name"; then
        if $DOCKER rm -f "$name" > /dev/null 2>&1; then
            echo "    - $name dibuang (container lama)"
        fi
    fi
done

echo "[*] Menyalakan container..."
if $DOCKER compose -f "$COMPOSE_FILE" up -d --remove-orphans; then
    ok
else
    bad "docker compose up gagal - cek log di atas."
fi

# ── Verifikasi ────────────────────────────────────────────────────────────────

echo "[*] Menunggu layanan merespons (maks 60 detik)..."

# Tunggu sampai URL merespons HTTP (atau timeout).
wait_http() {
    local url="$1" tries="${2:-30}" i=1
    while [ "$i" -le "$tries" ]; do
        if curl -sSf -o /dev/null --max-time 3 "$url" 2>/dev/null; then
            return 0
        fi
        sleep 2
        i=$((i + 1))
    done
    return 1
}

ADMIN_STATUS=1
MOBILE_STATUS=1
API_STATUS=1

if wait_http "http://localhost:8000/" 15; then ADMIN_STATUS=0; fi
if wait_http "http://localhost:5173/" 15; then MOBILE_STATUS=0; fi
# API intranet expose prefix /api -> health ada di /api/health
if wait_http "http://localhost:3000/api/health" 30; then API_STATUS=0; fi

echo ""
if [ $ADMIN_STATUS -eq 0 ]; then
    echo "  - Admin Service   : SUCCESS (port 8000)"
else
    echo "  - Admin Service   : FAILED (port 8000) - cek '$DOCKER compose -f $COMPOSE_FILE logs web'"
    FAILURES=$((FAILURES + 1))
fi

if [ $MOBILE_STATUS -eq 0 ]; then
    echo "  - Mobile Service  : SUCCESS (port 5173)"
else
    echo "  - Mobile Service  : FAILED (port 5173) - cek '$DOCKER compose -f $COMPOSE_FILE logs web'"
    FAILURES=$((FAILURES + 1))
fi

if [ $API_STATUS -eq 0 ]; then
    echo "  - API Intranet    : SUCCESS (port 3000)"
else
    echo "  - API Intranet    : FAILED (port 3000) - cek '$DOCKER compose -f $COMPOSE_FILE logs api-intranet'"
    # Pesan paling sering: secret belum diisi -> container langsung exit.
    if $DOCKER logs trip-api 2>&1 | tail -5 | grep -q "GAGAL START"; then
        echo "                     Penyebab: SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET belum diisi di"
        echo "                     supabase/functions/api/.env.local. Isi dulu, lalu jalankan script lagi."
    else
        echo "                     (server menolak start kalau SUPABASE_SERVICE_ROLE_KEY / JWT_SECRET belum diisi)"
    fi
    FAILURES=$((FAILURES + 1))
fi

# ── Deteksi IP LAN ───────────────────────────────────────────────────────────

# Prioritas: interface eno1 (kabel LAN ke router Linksys) -> IP default route
# -> IP global lain. Jangan hanya andalkan eno1: di beberapa PC namanya beda.
detect_lan_ip() {
    local ip=""
    ip=$(ip -4 addr show dev eno1 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
    if [ -z "$ip" ]; then
        ip=$(ip route get 1.1.1.1 2>/dev/null | grep -oE 'src [0-9.]+' | awk '{print $2}' | head -1)
    fi
    if [ -z "$ip" ]; then
        ip=$(ip -4 addr show scope global 2>/dev/null | grep -oE 'inet [0-9.]+' | awk '{print $2}' | head -1)
    fi
    echo "${ip:-not detected}"
}

LAN_IP=$(detect_lan_ip)

echo ""
echo "=========================================="
echo "           ACCESS URL DIRECTORY           "
echo "=========================================="
echo " Admin   (Local) : http://localhost:8000"
echo " Admin   (LAN)   : http://${LAN_IP}:8000"
echo " Mobile  (Local) : http://localhost:5173"
echo " Mobile  (LAN)   : http://${LAN_IP}:5173"
echo " API     (Local) : http://localhost:3000/api"
echo " API     (LAN)   : http://${LAN_IP}:3000/api"
echo "=========================================="
echo " Endpoint mobile : Supabase (cloud) ATAU Intranet (LAN di atas)"
echo "                  - pilih lewat 'Pengaturan Server' di aplikasi mobile"
echo "=========================================="
echo " Stop  : $DOCKER compose -f $COMPOSE_FILE down"
echo " Log   : $DOCKER compose -f $COMPOSE_FILE logs -f"

echo ""
if [ $FAILURES -gt 0 ]; then
    echo "[X] Selesai dengan $FAILURES kegagalan, $WARNINGS peringatan."
    exit 1
fi
if [ $WARNINGS -gt 0 ]; then
    echo "[!] Selesai dengan $WARNINGS peringatan (semua layanan jalan)."
    exit 0
fi
echo "[OK] Semua layanan berjalan."
exit 0
