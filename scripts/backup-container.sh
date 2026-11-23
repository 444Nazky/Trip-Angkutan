#!/bin/sh
# Loop backup harian untuk service `db-backup` (postgres:16-alpine).
#
# Berjalan DI DALAM container; pg_dump diarahkan ke service `db` lewat
# PGHOST. Backup langsung dibuat sekali saat container start, lalu setiap
# pukul 02:00 waktu server.
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

mkdir -p "$BACKUP_DIR"

run_backup() {
  stamp="$(date +%Y%m%d-%H%M%S)"
  out="$BACKUP_DIR/trip-$stamp.sql.gz"

  echo "[db-backup] mulai dump -> $out"
  if ! pg_dump --no-owner --clean --if-exists | gzip -9 > "$out"; then
    echo "[db-backup] GAGAL dump" >&2
    rm -f "$out"
    return 1
  fi
  if [ ! -s "$out" ] || ! gzip -t "$out"; then
    echo "[db-backup] GAGAL: berkas backup kosong/rusak" >&2
    rm -f "$out"
    return 1
  fi

  echo "[db-backup] selesai: $out ($(du -h "$out" | cut -f1))"
  find "$BACKUP_DIR" -maxdepth 1 -name 'trip-*.sql.gz' -type f -mtime "+$KEEP_DAYS" -print -delete \
    | sed 's/^/[db-backup] hapus lama: /'
  echo "[db-backup] total backup: $(find "$BACKUP_DIR" -maxdepth 1 -name 'trip-*.sql.gz' -type f | wc -l)"
}

while true; do
  run_backup || echo "[db-backup] percobaan berikutnya pukul 02:00" >&2

  # Tunggu sampai 02:00 berikutnya (portabel, tanpa `date -d`).
  h="$(date +%H)"; m="$(date +%M)"; s="$(date +%S)"
  cur=$((10#$h * 3600 + 10#$m * 60 + 10#$s))
  tgt=7200
  if [ "$cur" -lt "$tgt" ]; then
    wait_s=$((tgt - cur))
  else
    wait_s=$((86400 - cur + tgt))
  fi
  echo "[db-backup] tidur ${wait_s}s sampai backup berikutnya"
  sleep "$wait_s"
done
