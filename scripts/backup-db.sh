#!/usr/bin/env bash
# ─── Backup database Trip Angkutan ───────────────────────────────────────────
# Membuat dump gzip dari container `trip-db` ke ./data/backups lalu menghapus
# backup lama di luar masa retensi.
#
# Pemakaian:
#   ./scripts/backup-db.sh              # backup manual
#   BACKUP_KEEP_DAYS=14 ./scripts/backup-db.sh
#
# Dijalankan otomatis oleh service `db-backup` di docker-compose.yml.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/data/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"
DB_CONTAINER="${DB_CONTAINER:-trip-db}"
DB_USER="${POSTGRES_USER:-trip}"
DB_NAME="${POSTGRES_DB:-trip}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/trip-$STAMP.sql.gz"

echo "[backup] dump $DB_NAME dari $DB_CONTAINER -> $OUT"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --clean --if-exists \
  | gzip -9 > "$OUT"

# Verifikasi dump tidak kosong dan gzip-nya utuh.
if [ ! -s "$OUT" ]; then
  echo "[backup] GAGAL: berkas backup kosong" >&2
  rm -f "$OUT"
  exit 1
fi
if ! gzip -t "$OUT"; then
  echo "[backup] GAGAL: berkas backup rusak" >&2
  exit 1
fi

SIZE="$(du -h "$OUT" | cut -f1)"
echo "[backup] selesai: $OUT ($SIZE)"

# Retensi: hapus dump lebih tua dari KEEP_DAYS hari.
find "$BACKUP_DIR" -maxdepth 1 -name 'trip-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -print -delete \
  | sed 's/^/[backup] hapus lama: /'

echo "[backup] total backup tersimpan: $(find "$BACKUP_DIR" -maxdepth 1 -name 'trip-*.sql.gz' -type f | wc -l)"
