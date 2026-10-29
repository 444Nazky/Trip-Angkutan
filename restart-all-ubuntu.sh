#!/bin/bash
# =============================================================================
#  restart-all-ubuntu.sh
#  Restart seluruh layanan Docker Trip Angkutan di PC kantor (Ubuntu).
#
#  Layanan:
#    - 8000  Admin Dashboard   (nginx, build www/admin)
#    - 5173  Mobile App        (nginx, build www)
#    - 3000  API INTRANET      (Deno)
#    - 3001  PostgREST          (internal, hanya dipakai server API)
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
ENV_LOCAL="$BASE/server/api/.env.local"
ENV_EXAMPLE="$BASE/server/api/.env.example"
SECRETS_FILE="$BASE/server/api/.env.secrets"

FAILURES=0
WARNINGS=0

ok()   { echo "    OK"; }
warn() { echo "    PERHATIAN: $*"; WARNINGS=$((WARNINGS + 1)); }
bad()  { echo "    GAGAL: $*"; FAILURES=$((FAILURES + 1)); }

# ── Deteksi docker (dengan atau tanpa sudo) ───────────────────────────────────
#
# Urutan penting: coba `docker` polos DULU. Kalau user sudah masuk group
# `docker` (umum di PC kantor), script bisa jalan tanpa prompt password sama
# sekali - itu yang membuat restart bisa dipanggil otomatis dari cron/CI.
# `sudo` hanya jadi cadangan kalau user memang tidak punya akses docker.

if [ "$(id -u)" -eq 0 ]; then
    DOCKER="docker"
elif docker info > /dev/null 2>&1; then
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

# Secret hanya boleh ada di `server/api/` (sudah masuk .gitignore).

if [ ! -f "$ENV_LOCAL" ]; then
    if [ -f "$ENV_EXAMPLE" ]; then
        cp "$ENV_EXAMPLE" "$ENV_LOCAL"
        warn "server/api/.env.local belum ada - dibuat dari .env.example (nilainya masih kosong)."
        warn "JWT_SECRET wajib diisi agar server intranet bisa start."
    else
        mkdir -p "$(dirname "$ENV_LOCAL")"
        : > "$ENV_LOCAL"
        warn "server/api/.env.local dibuat kosong - server intranet akan menolak start tanpa JWT_SECRET."
    fi
fi
# env_file wajib ada agar `docker compose up` tidak gagal dengan error cryptic.

# ── Resolusi secret API intranet ─────────────────────────────────────────────
#
# Urutan sumber untuk JWT_SECRET:
#   1. Sudah ada (non-kosong) di .env.local            -> pakai apa adanya
#   2. Environment variable saat script dipanggil       -> simpan ke .env.local
#      contoh: JWT_SECRET=... ./restart-all-ubuntu.sh
#   3. File .env.secrets di folder yang sama            -> gabung ke .env.local
#   4. Terminal interaktif                               -> tanya (read -s)
#   5. Tidak ada sumber sama sekali                      -> hanya warning
#
# Dengan 1-3, restart berjalan TANPA input manual sama sekali - penting
# supaya script bisa dipanggil otomatis dari cron/CI.
#
# Semua sumber sudah masuk .gitignore dan file hasilnya selalu chmod 600.

# Tulis (atau ganti) satu key di file env.
set_env_value() {
    local file="$1" key="$2" value="$3" tmp
    [ -n "$value" ] || return 0
    if grep -qE "^${key}=" "$file" 2>/dev/null; then
        tmp="$(mktemp)"
        awk -v k="$key" -v v="$value" '
            $0 ~ "^"k"=" { print k"="v; next }
            { print }
        ' "$file" > "$tmp" && mv "$tmp" "$file"
    else
        printf '%s=%s\n' "$key" "$value" >> "$file"
    fi
    chmod 600 "$file"
}

# Nilai non-kosong untuk sebuah key di file env.
env_value() {
    local file="$1" key="$2" v=""
    [ -f "$file" ] || return 0
    v="$(awk -v k="$key" '$0 ~ "^"k"=" { sub(/^[^=]*=/, "", $0); print $0; exit }' "$file" 2>/dev/null)"
    printf '%s' "$v"
}

resolve_secret() {
    local key="$1" label="$2" from_env="" from_file="" value=""

    # 1. Sudah ada di .env.local?
    [ -n "$(env_value "$ENV_LOCAL" "$key")" ] && return 0

    # 2. Environment variable?
    from_env="${!key:-}"
    if [ -n "$from_env" ]; then
        set_env_value "$ENV_LOCAL" "$key" "$from_env"
        ok "$key diambil dari environment variable"
        return 0
    fi

    # 3. File .env.secrets?
    if [ -f "$SECRETS_FILE" ]; then
        from_file="$(env_value "$SECRETS_FILE" "$key")"
        if [ -n "$from_file" ]; then
            set_env_value "$ENV_LOCAL" "$key" "$from_file"
            ok "$key diambil dari $(basename "$SECRETS_FILE")"
            return 0
        fi
    fi

    # 4. Terminal interaktif -> tanya.
    if [ -t 0 ]; then
        echo
        echo "    $label belum diisi di .env.local."
        echo "    Buat nilai acak dengan: openssl rand -hex 32"
        echo "    (input tidak ditampilkan; tekan Enter untuk lewati)"
        printf "    %s: " "$key"
        IFS= read -r -s value || value=""
        echo
        if [ -n "$value" ]; then
            set_env_value "$ENV_LOCAL" "$key" "$value"
            ok "$key tersimpan di .env.local"
            return 0
        fi
    fi

    # 5. Tidak ada sumber -> biarkan kosong, container akan menolak start
    #    dengan pesan yang jelas (lihat blok verifikasi di bawah).
    return 1
}

resolve_secret "JWT_SECRET" "JWT secret"

if ! grep -qE '^JWT_SECRET=.+' "$ENV_LOCAL" 2>/dev/null; then
    warn "JWT_SECRET kosong di .env.local - container API intranet akan exit saat start."
    warn "  Cara mengisinya tanpa edit manual: taruh di server/api/.env.secrets,"
    warn "  atau jalankan: JWT_SECRET=... ./restart-all-ubuntu.sh"
fi

# ── Kredensial admin dashboard ───────────────────────────────────────────────
#
# Dashboard admin pada server intranet dibuka TANPA password (mode
# ADMIN_AUTH_DISABLED=1). Server ini hanya melayani jaringan lokal kantor,
# jadi dashboard langsung terbuka begitu dibuka - tidak ada layar login yang
# bisa tersangkut karena kredensial belum dikonfigurasi.
#
# Password hanya relevan kalau operator sengaja mengaktifkan mode proteksi
# (ADMIN_AUTH_DISABLED=0). Pada mode itu, password dibuat acak di sini bila
# belum ada, lalu dicetak di ringkasan akhir.

if ! grep -qE '^ADMIN_AUTH_DISABLED=' "$ENV_LOCAL" 2>/dev/null; then
    set_env_value "$ENV_LOCAL" "ADMIN_AUTH_DISABLED" "1"
    ok "ADMIN_AUTH_DISABLED=1 - dashboard admin tanpa password"
fi

ADMIN_BOOTSTRAP_PASSWORD=""
if [ "$(env_value "$ENV_LOCAL" "ADMIN_AUTH_DISABLED")" != "1" ] && ! grep -qE '^ADMIN_PASSWORD=.+' "$ENV_LOCAL" 2>/dev/null; then
    if command -v openssl > /dev/null 2>&1; then
        ADMIN_BOOTSTRAP_PASSWORD="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
    else
        ADMIN_BOOTSTRAP_PASSWORD="$(head -c 18 /dev/urandom | od -An -tx1 | tr -dc '0-9a-f' | cut -c1-16)"
    fi
    if [ -n "$ADMIN_BOOTSTRAP_PASSWORD" ]; then
        set_env_value "$ENV_LOCAL" "ADMIN_PASSWORD" "$ADMIN_BOOTSTRAP_PASSWORD"
        ok "ADMIN_PASSWORD dibuat acak dan disimpan di .env.local"
    else
        warn "Gagal membuat ADMIN_PASSWORD acak - isi manual di .env.local."
    fi
fi

# ── Ambil kode terbaru ───────────────────────────────────────────────────────

echo "[*] Menarik kode terbaru dari repo..."
if git -C "$BASE" pull --ff-only 2>/dev/null; then
    ok
else
    warn "git pull dilewati (perubahan lokal / repo tidak bisa diakses). Kode dipakai dari sumber saat ini."
fi
git -C "$BASE" log --oneline -1 2>/dev/null || true

# ── Validasi compose ─────────────────────────────────────────────────────────
#
# WAJIB sebelum container lama dibuang. Kalau docker-compose.yml tidak valid
# (mis. `volumes:` kosong), `compose up` gagal SETELAH langkah "down" - artinya
# seluruh layanan ikut mati hanya karena satu typo. Validasi dulu di sini,
# maka file rusak tidak pernah menyentuh stack yang sedang berjalan.

echo "[*] Memvalidasi docker-compose.yml..."
if $DOCKER compose -f "$COMPOSE_FILE" config -q; then
    ok
else
    bad "docker-compose.yml tidak valid - container yang sedang berjalan TIDAK dihentikan."
    echo "    Perbaiki file di atas, lalu jalankan script ini lagi."
    exit 1
fi

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

# ── Direktori penyimpanan berkas ──────────────────────────────────────────────
#
# Berkas (foto trip, APK, bundel OTA) disimpan di ./data/storage yang di-mount
# ke container API lewat bind-mount.
#
# Container API berjalan sebagai user non-root `deno` (uid 1000 di dalam
# image). Kalau direktori di host dibuat oleh `docker` sebagai root dengan
# mode 755, user `deno` TIDAK boleh menulis di dalamnya. Akibatnya SEMUA
# unggahan berkas gagal dengan "Permission denied (os error 13)" - termasuk
# foto trip dari aplikasi petugas, yang muncul sebagai HTTP 500 dari
# /trips/complete.
#
# Jadi direktori dibuat lebih dulu di host, lalu dimiliki uid 1000 supaya
# cocok dengan user `deno` di dalam container. `chown` diulang setiap restart
# supaya tetap berlaku walaupun volumenya pernah diganti.

echo "[*] Menyiapkan direktori penyimpanan berkas..."
STORAGE_DIR="$BASE/data/storage"
mkdir -p "$STORAGE_DIR" 2>/dev/null
# `--user root` wajib: image berjalan sebagai user `deno`, dan user `deno`
# tidak punya hak untuk mengganti kepemilikan berkas.
if $DOCKER run --rm --user root -v "$STORAGE_DIR:/probe" --entrypoint sh trip-angkut-api -c \
        "chown -R deno:deno /probe" > /dev/null 2>&1; then
    ok
else
    warn "Gagal menyiapkan kepemilikan $STORAGE_DIR - unggahan berkas bisa gagal."
    warn "  Perbaikan manual: sudo chown -R 1000:1000 $STORAGE_DIR"
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

# ── Migrasi skema database ───────────────────────────────────────────────────
#
# Skema utama (server/db/schema.sql) hanya dimuat saat volume database masih
# kosong. Untuk database yang sudah terisi, perubahan skema dijalankan lewat
# berkas di server/db/migrations/ - semuanya idempoten (ADD COLUMN IF NOT
# EXISTS, CREATE INDEX IF NOT EXISTS), jadi aman dijalankan berulang kali.
#
# Folder migrasi sudah dimount ke dalam container db, jadi perintahnya cukup
# `psql -f` tanpa perlu menyalin berkas ke host.
echo "[*] Menerapkan migrasi skema database..."
MIGRATIONS_DIR="$BASE/server/db/migrations"
if [ -d "$MIGRATIONS_DIR" ]; then
    for migration in "$MIGRATIONS_DIR"/*.sql; do
        [ -f "$migration" ] || continue
        name="$(basename "$migration")"
        if $DOCKER compose -f "$COMPOSE_FILE" exec -T db \
            psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-trip}" -d "${POSTGRES_DB:-trip}" \
            -f "/docker-entrypoint-initdb.d/20-migrations/$name" > /dev/null 2>&1; then
            ok "$name"
        else
            warn "Migrasi '$name' gagal atau container db belum siap. Jalankan ulang script ini."
        fi
    done
fi

# ── Backfill snapshot harga tarif (sekali jalan, idempoten) ──────────────────
#
# ATURAN: perubahan tarif di admin hanya berlaku untuk trip SELANJUTNYA. Trip
# yang sudah terkirim memakai harga yang tercatat saat dikirim
# (vehicles.tariff_amount + vehicles.tarif_source).
#
# Baris kendaraan yang dibuat SEBELUM kolom tarif_source ada belum punya
# penanda harga, jadi nilainya dibekukan satu kali di sini:
#   - yang sudah punya harga  -> ditandai "snapshot" (tidak pernah dihitung
#     ulang dengan tarif yang lebih baru),
#   - yang masih Rp 0          -> diisi harga yang berlaku sekarang, lalu
#     ditandai (tanpa ini baris ini ikut berubah setiap kali tarif diedit).
#
# Script-nya ada di server/api/scripts/backfill_tariff_snapshot.ts (ikut COPY
# ke dalam image API, jadi tidak perlu disalin ke host). Sifatnya idempoten,
# jadi aman dijalankan setiap restart - tidak ada yang berubah kalau datanya
# sudah rapi.

echo "[*] Membekukan harga tarif trip lama (backfill snapshot)..."
BACKFILL_OUT="$($DOCKER compose -f "$COMPOSE_FILE" exec -T api-intranet \
    deno run --allow-env --allow-net --node-modules-dir=none \
    api/scripts/backfill_tariff_snapshot.ts 2>&1)"
BACKFILL_STATUS=$?
if [ $BACKFILL_STATUS -eq 0 ]; then
    ok "backfill snapshot tarif selesai"
    printf '%s\n' "$BACKFILL_OUT" | grep -E "Selesai" | sed 's/^/    /' || true
else
    warn "Backfill snapshot tarif gagal - cek log di atas."
    printf '%s\n' "$BACKFILL_OUT" | tail -5 | sed 's/^/    /'
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
        echo "                     Penyebab: JWT_SECRET belum diisi di"
        echo "                     server/api/.env.local. Isi dulu, lalu jalankan script lagi."
    else
        echo "                     (server menolak start kalau JWT_SECRET kosong;"
        echo "                      cek juga status container db dan rest)"
        echo "                     $DOCKER compose -f $COMPOSE_FILE logs db rest"
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
echo " Endpoint mobile : Intranet (LAN di atas) - satu-satunya endpoint"
echo "                  - atur di 'Pengaturan Server' bila IP kantor berubah"
echo " Dashboard admin : tanpa password - langsung terbuka di http://${LAN_IP}:8000"
if [ -n "$ADMIN_BOOTSTRAP_PASSWORD" ]; then
    echo "=========================================="
    echo " Login dashboard : admin / ${ADMIN_BOOTSTRAP_PASSWORD}"
    echo "                   (password ini dibuat otomatis; ganti dengan:"
    echo "                    node scripts/reset-admin-password.mjs)"
fi
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
