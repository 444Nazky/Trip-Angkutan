#!/bin/bash
# =============================================================================
#  cleardata.sh
#  Kosongkan data trip supaya Laporan Trip di admin dashboard bersih.
#
#  WAJIB SUDO (pengaman tambahan sebelum data dihapus permanen):
#      sudo ./cleardata.sh                 # lihat jumlah data (dry run)
#      sudo ./cleardata.sh --force         # hapus permanen (minta konfirmasi)
#      sudo ./cleardata.sh --force --yes   # hapus permanen tanpa konfirmasi
#
#  Yang dihapus:
#    - semua baris `trips` (+ `vehicles` & `trip_vehicles` lewat CASCADE)
#    - `vehicles` yatim (trip_id NULL, sisa unggahan yang gagal)
#    - semua dokumen pembatalan trip di `trip_cancellations`
#    - semua file foto di bucket Storage `trip-photos`
#  Yang TIDAK disentuh:
#    region, dermaga, rute, tarif, petugas, master plat, `plate_scans`,
#    `vehicle_plates`, akun admin.
#
#  Script dijalankan dari mesin ini. Kalau container `trip-db` ADA di mesin
#  lokal, perintah dijalankan langsung lewat docker; kalau tidak, perintah
#  dijalankan lewat SSH ke server kantor.
#
#  Env:
#      HOST     - host server kantor (default 192.168.1.123)
#      DB_CTR   - nama container database (default trip-db)
#      API_CTR  - nama container API, pemilik /data/storage (default trip-api)
#      DB_USER  - user PostgreSQL (default trip)
#      DB_NAME  - nama database (default trip)
# =============================================================================

set -uo pipefail

HOST="${HOST:-192.168.1.123}"
DB_CTR="${DB_CTR:-trip-db}"
API_CTR="${API_CTR:-trip-api}"
DB_USER="${DB_USER:-trip}"
DB_NAME="${DB_NAME:-trip}"

FORCE=0
ASSUME_YES=0
MODE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --force)   FORCE=1; shift ;;
        --yes|-y)  ASSUME_YES=1; shift ;;
        --local)   MODE=local; shift ;;
        --remote)  MODE=remote; shift ;;
        --host)    HOST="${2:-}"; shift 2 ;;
        -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
        *) echo "[X] Argumen tidak dikenal: $1"; exit 2 ;;
    esac
done

# ── Wajib sudo ───────────────────────────────────────────────────────────────

if [ "$(id -u)" -ne 0 ]; then
    echo "[X] cleardata.sh wajib dijalankan dengan sudo."
    printf '    sudo %q' "$0"
    for arg in "$@"; do printf ' %q' "$arg"; done
    printf '\n'
    exit 1
fi

# ── Tentukan target: lokal atau lewat SSH ────────────────────────────────────

if [ -z "$MODE" ]; then
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_CTR"; then
        MODE="local"
    else
        MODE="remote"
    fi
fi

# sudo mengganti HOME ke /root, jadi kunci SSH milik user pemanggil tidak
# ditemukan. Jalankan ssh sebagai SUDO_USER supaya konfigurasi & kunci SSH
# yang biasa dipakai tetap terbaca.
SSH=(ssh)
if [ "$MODE" = "remote" ] && [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    SSH=(sudo -H -u "$SUDO_USER" ssh)
fi

if [ "$MODE" = "local" ]; then
    TARGET="lokal (docker)"
else
    TARGET="ssh $HOST"
fi

psql_() {
    if [ "$MODE" = "local" ]; then
        docker exec -i "$DB_CTR" psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" -At
    else
        "${SSH[@]}" "$HOST" \
            "docker exec -i $DB_CTR psql -v ON_ERROR_STOP=1 -U $DB_USER -d $DB_NAME -At"
    fi
}

storage_() {
    local cmd="$1"
    if [ "$MODE" = "local" ]; then
        docker exec "$API_CTR" sh -c "$cmd"
    else
        "${SSH[@]}" "$HOST" "docker exec $API_CTR sh -c '$cmd'"
    fi
}

# ── Cek target bisa diakses ──────────────────────────────────────────────────

echo "[*] Target: $TARGET"

if [ "$MODE" = "local" ]; then
    if ! docker info > /dev/null 2>&1; then
        echo "[X] Docker tidak bisa diakses di mesin ini."
        exit 1
    fi
else
    if ! "${SSH[@]}" -o ConnectTimeout=10 "$HOST" "docker ps --format '{{.Names}}'" \
            > /tmp/cleardata-names.$$ 2>&1; then
        echo "[X] Tidak bisa SSH ke $HOST."
        sed 's/^/    /' /tmp/cleardata-names.$$
        rm -f /tmp/cleardata-names.$$
        exit 1
    fi
fi

NAMES=""
if [ "$MODE" = "local" ]; then
    NAMES="$(docker ps --format '{{.Names}}' 2>/dev/null)"
else
    NAMES="$(cat /tmp/cleardata-names.$$ 2>/dev/null)"
    rm -f /tmp/cleardata-names.$$
fi

for ctr in "$DB_CTR" "$API_CTR"; do
    if ! printf '%s\n' "$NAMES" | grep -qx "$ctr"; then
        echo "[X] Container '$ctr' tidak berjalan di $TARGET."
        echo "    Nyalakan layanan dulu (./restart.sh atau ./rebuild.sh)."
        exit 1
    fi
done

# ── Data saat ini ────────────────────────────────────────────────────────────

echo ""
echo "== Data trip saat ini =="
psql_ <<'SQL'
SELECT 'trips=' || count(*) FROM trips;
SELECT 'vehicles=' || count(*) FROM vehicles;
SELECT 'vehicles_tanpa_trip=' || count(*) FROM vehicles WHERE trip_id IS NULL;
SELECT 'trip_cancellations=' || count(*) FROM trip_cancellations;
SQL

echo "== Foto di bucket trip-photos =="
storage_ 'ls -1 /data/storage/trip-photos 2>/dev/null | wc -l'

if [ "$FORCE" -ne 1 ]; then
    echo ""
    echo "Dry run. Jalankan ulang dengan --force untuk menghapus permanen:"
    echo "    sudo $0 --force"
    exit 0
fi

if [ "$ASSUME_YES" -ne 1 ]; then
    if [ ! -t 0 ]; then
        echo "[X] Tidak ada TTY untuk konfirmasi. Tambahkan --yes untuk melanjutkan."
        exit 1
    fi
    printf 'Hapus SEMUA data trip di %s? Ketik "hapus" untuk lanjut: ' "$TARGET"
    read -r answer
    if [ "$answer" != "hapus" ]; then
        echo "Dibatalkan."
        exit 1
    fi
fi

# ── Hapus ────────────────────────────────────────────────────────────────────

echo "== Menghapus baris database =="
if ! psql_ <<'SQL'
TRUNCATE trips CASCADE;
DELETE FROM vehicles WHERE trip_id IS NULL;
TRUNCATE trip_cancellations;
SQL
then
    echo "[X] Gagal menghapus baris database - cek pesan di atas."
    exit 1
fi

echo "== Menghapus file foto =="
if ! storage_ 'find /data/storage/trip-photos -mindepth 1 -delete 2>/dev/null; true'; then
    echo "[X] Gagal menghapus file foto - cek pesan di atas."
    exit 1
fi

# ── Sesudah ──────────────────────────────────────────────────────────────────

echo "== Sesudah =="
psql_ <<'SQL'
SELECT 'trips=' || count(*) FROM trips;
SELECT 'vehicles=' || count(*) FROM vehicles;
SELECT 'trip_cancellations=' || count(*) FROM trip_cancellations;
SQL
echo -n 'trip-photos='
storage_ 'ls -1 /data/storage/trip-photos 2>/dev/null | wc -l'

echo ""
echo "Selesai. Muat ulang halaman Laporan Trip di admin dashboard."
echo "Dokumen pembatalan (tab Pembatalan) juga sudah dikosongkan."
