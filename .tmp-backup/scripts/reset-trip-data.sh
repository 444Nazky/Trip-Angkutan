#!/usr/bin/env bash
# =============================================================================
#  reset-trip-data.sh
#
#  Kosongkan data trip supaya Laporan Trip di admin dashboard bersih.
#  Yang dihapus:
#    - semua baris `trips` (+ `vehicles` & `trip_vehicles` lewat ON DELETE CASCADE)
#    - `vehicles` yatim (trip_id NULL, sisa unggahan yang gagal)
#    - semua file di bucket Storage `trip-photos` (foto kosong, muatan, selfie)
#  Yang TIDAK disentuh: region, dermaga, rute, tarif, petugas, master plat,
#  `plate_scans`, `vehicle_plates`, akun admin.
#
#  Cara pakai:
#      ./scripts/reset-trip-data.sh            # lihat jumlah data (dry run)
#      ./scripts/reset-trip-data.sh --force    # hapus permanen
#
#  Env:
#      HOST     - host server kantor (default 192.168.100.2)
#      DB_CTR   - nama container database (default trip-db)
#      API_CTR  - nama container API, pemilik /data/storage (default trip-api)
# =============================================================================
set -euo pipefail

HOST="${HOST:-192.168.1.123}"
DB_CTR="${DB_CTR:-trip-db}"
API_CTR="${API_CTR:-trip-api}"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1

psql_() {
  ssh "$HOST" "docker exec -i $DB_CTR psql -v ON_ERROR_STOP=1 -U trip -d trip -At"
}

echo "== Data trip saat ini =="
psql_ <<'SQL'
SELECT 'trips=' || count(*) FROM trips;
SELECT 'vehicles=' || count(*) FROM vehicles;
SELECT 'vehicles_tanpa_trip=' || count(*) FROM vehicles WHERE trip_id IS NULL;
SQL
echo "== Foto di bucket trip-photos =="
ssh "$HOST" "docker exec $API_CTR sh -c 'ls -1 /data/storage/trip-photos 2>/dev/null | wc -l'"

if [ "$FORCE" -ne 1 ]; then
  echo
  echo "Dry run. Jalankan ulang dengan --force untuk menghapus permanen."
  exit 0
fi

echo "== Menghapus baris database =="
psql_ <<'SQL'
TRUNCATE trips CASCADE;
DELETE FROM vehicles WHERE trip_id IS NULL;
SQL

echo "== Menghapus file foto =="
ssh "$HOST" "docker exec $API_CTR sh -c 'rm -rf /data/storage/trip-photos/*'"

echo "== Sesudah =="
psql_ <<'SQL'
SELECT 'trips=' || count(*) FROM trips;
SELECT 'vehicles=' || count(*) FROM vehicles;
SQL
ssh "$HOST" "docker exec $API_CTR sh -c 'ls -1 /data/storage/trip-photos 2>/dev/null | wc -l'"
echo "Selesai. Muat ulang halaman Laporan Trip di admin dashboard."
