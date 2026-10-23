#!/usr/bin/env bash
# =============================================================================
#  deploy-to-office-server.sh
#
#  Sinkronkan repo workspace (repo coord / repo development) ke folder DEPLOY
#  server kantor, lalu jalankan restart-all-ubuntu.sh di sana.
#
#  Kenapa script ini ada:
#    Repo yang dipakai untuk build di PC kantor bisa BERBEDA dari repo tempat
#    kita develops. Contoh nyata (2026-10-23):
#      - Repo workspace : /home/nazky/.coord/repos/<id>/Trip-Angkutan
#      - Folder deploy   : /home/nazky/Trip-Angkutan
#    Keduanya clone dari GitHub yang sama, tapi kalau repo workspace belum
#    di-push, `restart-all-ubuntu.sh` di folder deploy akan membangun KODE
#    LAMA (belum ada dual-endpoint / API intranet :3000 / perbaikan .dockerignore).
#
#  Cara pakai:
#      ./scripts/deploy-to-office-server.sh              # sync + restart
#      ./scripts/deploy-to-office-server.sh --dry-run    # lihat apa saja yang berubah
#      ./scripts/deploy-to-office-server.sh --no-restart # sync saja
#
#  Env:
#      SRC_DIR  - repo sumber (default: lokasi script ini)
#      DST_DIR  - folder deploy (default: /home/nazky/Trip-Angkutan)
# =============================================================================
set -uo pipefail

SRC_DIR="${SRC_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
DST_DIR="${DST_DIR:-/home/nazky/Trip-Angkutan}"

DRY=0
RESTART=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)   DRY=1; shift ;;
    --no-restart) RESTART=0; shift ;;
    --src) SRC_DIR="$2"; shift 2 ;;
    --dst) DST_DIR="$2"; shift 2 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) echo "Argumen tidak dikenal: $1"; exit 2 ;;
  esac
done

[ -d "$SRC_DIR" ]  || { echo "[X] SRC_DIR tidak ada: $SRC_DIR"; exit 1; }
[ -d "$DST_DIR/.git" ] || { echo "[X] DST_DIR bukan clone git: $DST_DIR"; exit 1; }

echo "== Source : $SRC_DIR"
echo "== Deploy : $DST_DIR"
echo

# ── 1. Catat status sebelum sync ─────────────────────────────────────────────
echo "[1/4] Status repo deploy SEBELUM sync"
git -C "$DST_DIR" log --oneline -1 | sed 's/^/    /'
git -C "$DST_DIR" status --short | head -20 | sed 's/^/    /'
if [ -n "$(git -C "$DST_DIR" status --porcelain)" ]; then
  echo
  echo "    [!] Repo deploy punya perubahan lokal. Sync di bawah AKAN menimpanya."
  echo "        Lanjutkan? (y/N)"
  read -r ans
  [ "$ans" = "y" ] || { echo "    Batal."; exit 1; }
fi

# ── 2. Backup repo deploy ────────────────────────────────────────────────────
BACKUP="$DST_DIR.bak.$(date +%Y%m%d-%H%M%S)"
echo
echo "[2/4] Backup repo deploy -> $BACKUP"
if [ "$DRY" -eq 1 ]; then
  echo "    (dry-run: backup dilewati)"
else
  cp -a "$DST_DIR" "$BACKUP" || { echo "[X] Backup gagal."; exit 1; }
  echo "    OK"
fi

# ── 3. Sync file (tanpa .git, node_modules, dan file secret) ─────────────────
echo
echo "[3/4] Sync file dari source ke deploy"
RSYNC_ARGS=(-a --delete
  --exclude '.git/'
  --exclude 'node_modules/'
  --exclude '.angular/'
  --exclude 'graphify-out/'
  --exclude '.env.local'
  --exclude 'supabase/functions/api/.env.local'
  --exclude '*.apk'
)
if [ "$DRY" -eq 1 ]; then
  RSYNC_ARGS+=(--dry-run --itemize-changes)
fi
rsync "${RSYNC_ARGS[@]}" "$SRC_DIR/" "$DST_DIR/"
echo "    OK"

# ── 4. Pastikan secret untuk API intranet ada ────────────────────────────────
ENV_LOCAL="$DST_DIR/supabase/functions/api/.env.local"
ENV_EXAMPLE="$DST_DIR/supabase/functions/api/.env.example"
echo
echo "[4/4] Cek env API intranet"
if [ -f "$ENV_LOCAL" ]; then
  if grep -qE '^SUPABASE_SERVICE_ROLE_KEY=.+' "$ENV_LOCAL"; then
    echo "    OK  $ENV_LOCAL sudah terisi service role key."
  else
    echo "    [!] $ENV_LOCAL ADA tapi SUPABASE_SERVICE_ROLE_KEY masih kosong."
    echo "        Isi SUPABASE_SERVICE_ROLE_KEY + JWT_SECRET (HARUS sama dengan Supabase),"
    echo "        kalau tidak container API intranet akan exit dengan:"
    echo "        [api-intranet] GAGAL START: env wajib belum diisi"
  fi
else
  mkdir -p "$(dirname "$ENV_LOCAL")"
  if [ -f "$ENV_EXAMPLE" ]; then cp "$ENV_EXAMPLE" "$ENV_LOCAL"; chmod 600 "$ENV_LOCAL"; fi
  echo "    [!] $ENV_LOCAL dibuat dari .env.example (NILAI KOSONG)."
  echo "        Isi SUPABASE_SERVICE_ROLE_KEY + JWT_SECRET sebelum service :3000 bisa jalan."
fi

if [ "$DRY" -eq 1 ]; then
  echo
  echo "== DRY RUN selesai (tidak ada perubahan, restart tidak dijalankan)."
  exit 0
fi

# ── 5. Restart layanan di folder deploy ─────────────────────────────────────
if [ "$RESTART" -eq 1 ]; then
  echo
  echo "== Restart layanan di $DST_DIR"
  cd "$DST_DIR" || exit 1
  ./restart-all-ubuntu.sh
else
  echo
  echo "== Sync selesai (restart dilewati)."
fi

echo
echo "== Verifikasi akhir"
for p in 8000 5173 3000; do
  code=$(curl -s -o /dev/null -m 4 -w '%{http_code}' "http://192.168.1.123:$p/" 2>/dev/null)
  printf "  http://192.168.1.123:%s -> %s\n" "$p" "${code:-000}"
done
echo
echo "  (000 = belum listen. Untuk :3000 itu normal kalau secret belum diisi.)"
