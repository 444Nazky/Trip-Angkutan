#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════
#  Bersihkan RIWAYAT TRIP — database (server) + localStorage (aplikasi mobile)
# ═══════════════════════════════════════════════════════════════════════════
#  Usage:
#    ./clear-trip-history.sh                 # konfirmasi dulu, lalu bersihkan
#    ./clear-trip-history.sh --force         # tanpa konfirmasi
#    ./clear-trip-history.sh --no-db         # hanya localStorage mobile
#    ./clear-trip-history.sh --no-mobile     # hanya database
#    ./clear-trip-history.sh --no-restart    # jangan restart backend
#    ./clear-trip-history.sh --all-keys      # hapus SEMUA key trip.* (termasuk sesi)
#    ./clear-trip-history.sh --help
#
#  Catatan:
#  · Database SELALU di-backup dulu ke data/backups/ (aman dipulihkan).
#  · Backend (sql.js) menyimpan DB di memori — tanpa restart, hasil hapus bisa
#    tertimpa lagi saat backend menulis. Karena itu backend ikut direstart
#    (matikan dengan --no-restart bila tidak mau).
#  · Pembersihan localStorage memakai Chrome DevTools Protocol (port 9222).
#    Kalau tidak ada browser debug, script mencetak snippet untuk DevTools /
#    chrome://inspect (perangkat fisik).
# ═══════════════════════════════════════════════════════════════════════════
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_PATH="$SCRIPT_DIR/data/trip.db"
BACKUP_DIR="$SCRIPT_DIR/data/backups"

FORCE=0
DO_DB=1
DO_MOBILE=1
RESTART=1
ALL_KEYS=0

for arg in "$@"; do
  case "$arg" in
    --force|-f)      FORCE=1 ;;
    --no-db)         DO_DB=0 ;;
    --no-mobile)     DO_MOBILE=0 ;;
    --no-restart)    RESTART=0 ;;
    --all-keys)      ALL_KEYS=1 ;;
    -h|--help)
      sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "❌ Opsi tidak dikenal: $arg (lihat --help)"; exit 1 ;;
  esac
done

echo ""
echo "🧹 Clear Trip History — server + mobile"
echo "========================================"

# ─── 1. DATABASE (riwayat trip di server) ────────────────────────────────────
if [[ $DO_DB -eq 1 ]]; then
  if [[ ! -f "$DB_PATH" ]]; then
    echo "❌ Database tidak ditemukan: $DB_PATH"
    echo "   Jalankan backend dulu agar database dibuat."
    exit 1
  fi
  echo "📊 Database: $DB_PATH"

  if [[ $FORCE -eq 0 ]]; then
    echo ""
    echo "⚠️  AKAN DIHAPUS (server):"
    echo "   trips · vehicles · trip_vehicles · plate_scans"
    echo ""
    echo "⚠️  AKAN DIHAPUS (mobile localStorage):"
    if [[ $ALL_KEYS -eq 1 ]]; then
      echo "   SEMUA key trip.* — sesi login ikut hilang (perlu login ulang)"
    else
      echo "   trip.trips.v1 · trip.trips.v2 · trip.pendingSync · trip.syncQueue.v1"
      echo "   (riwayat + antrean sinkronisasi offline — sesi/login tetap aman)"
    fi
    echo ""
    echo "🔒 TETAP ADA:"
    echo "   regions · dermagas · routes · officers · tariffs · vehicle_plates"
    echo ""
    read -r -p "❓ Konfirmasi [ketik yes]: "
    [[ "$REPLY" == "yes" ]] || { echo "Batal."; exit 0; }
  fi

  mkdir -p "$BACKUP_DIR"
  TS=$(date +%Y%m%d_%H%M%S)
  cp "$DB_PATH" "$BACKUP_DIR/trip_backup_$TS.db"
  echo "📦 Backup: data/backups/trip_backup_$TS.db"

  # Hapus lewat sql.js (ada di node_modules backend)
  cd "$SCRIPT_DIR/backend"
  DB_PATH="$DB_PATH" node <<'NODE_SQL'
const { readFileSync, writeFileSync, existsSync } = require('fs')
const initSqlJs = require('sql.js')
const DB_PATH = process.env.DB_PATH

async function clear() {
  if (!existsSync(DB_PATH)) { console.error('❌ DB tidak ada:', DB_PATH); process.exit(1) }
  const SQL = await initSqlJs()
  const db = new SQL.Database(readFileSync(DB_PATH))
  const hitung = (t) => {
    try { return db.exec(`SELECT COUNT(*) FROM ${t}`)[0]?.values[0]?.[0] ?? 0 } catch { return '-' }
  }
  const tables = ['trip_vehicles', 'vehicles', 'trips', 'plate_scans']
  console.log('   Sebelum:')
  for (const t of tables) console.log(`     ${t.padEnd(14)}: ${hitung(t)}`)
  for (const t of tables) { try { db.run(`DELETE FROM ${t}`) } catch (e) { console.log(`     (lewati ${t}: ${e.message})`) } }
  writeFileSync(DB_PATH, Buffer.from(db.export()))
  console.log('   Sesudah:')
  for (const t of tables) console.log(`     ${t.padEnd(14)}: ${hitung(t)}`)
  console.log('✅ Data trip dihapus dari database.')
}
clear().catch(e => { console.error('Error:', e.message); process.exit(1) })
NODE_SQL
  cd "$SCRIPT_DIR"
fi

# ─── 2. RESTART BACKEND (supaya hasil hapus tidak tertimpa cache memori) ────
if [[ $DO_DB -eq 1 && $RESTART -eq 1 ]]; then
  BACK_PID=$(ss -ltnp 2>/dev/null | grep ':3000' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)
  if [[ -n "${BACK_PID:-}" ]]; then
    echo "🔁 Restart backend (pid $BACK_PID)…"
    kill "$BACK_PID" 2>/dev/null || true
    sleep 2
    ( cd "$SCRIPT_DIR/backend" && setsid nohup npm start > backend.log 2>&1 & )
    sleep 5
    if curl -s -m 5 http://localhost:3000/api/health | grep -q ok; then
      echo "   ✅ backend hidup lagi (:3000)"
    else
      echo "   ⚠️  backend belum menjawab — cek backend/backend.log"
    fi
  else
    echo "ℹ️  Backend tidak berjalan — hasil hapus langsung berlaku."
  fi
fi

# ─── 3. LOCALSTORAGE MOBILE (riwayat di aplikasi) ───────────────────────────
if [[ $DO_MOBILE -eq 1 ]]; then
  echo ""
  echo "📱 Lokal storage aplikasi mobile…"
  if curl -s -m 3 http://127.0.0.1:9222/json/version > /dev/null 2>&1; then
    ALL_KEYS="$ALL_KEYS" node <<'NODE_CDP'
;(async () => {
  const ALL = process.env.ALL_KEYS === '1'
  const reHapus = ALL ? /^trip\./ : /^trip\.(trips\.v\d+|pendingSync|syncQueue\.v\d+)$/
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json()
  const pages = list.filter(t => t.type === 'page' && /^https?:/.test(t.url))
  if (!pages.length) { console.log('   ⚠️  tidak ada tab browser terbuka'); return }

  const evalIn = (ws, expression) => new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1e9)
    const timer = setTimeout(() => reject(new Error('timeout')), 5000)
    const onMsg = (e) => {
      const m = JSON.parse(e.data)
      if (m.id !== id) return
      clearTimeout(timer); ws.removeEventListener('message', onMsg)
      m.error ? reject(new Error(m.error.message)) : resolve(m.result.result.value)
    }
    ws.addEventListener('message', onMsg)
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })

  for (const page of pages) {
    try {
      const ws = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej) })
      const out = await evalIn(ws, `(() => {
        const re = ${reHapus.toString()}
        const keys = Object.keys(localStorage).filter(k => re.test(k))
        keys.forEach(k => localStorage.removeItem(k))
        return JSON.stringify({ origin: location.origin, href: location.href, dihapus: keys, sisa: Object.keys(localStorage) })
      })()`)
      ws.close()
      const r = JSON.parse(out)
      const tag = r.dihapus.length ? `✅ ${r.dihapus.length} key dihapus` : '— tidak ada key riwayat'
      console.log(`   ${r.origin.padEnd(24)} ${tag}`)
      if (r.dihapus.length) console.log(`     ${r.dihapus.join(', ')}`)
      if (r.sisa.length) console.log(`     tersisa: ${r.sisa.join(', ')}`)
    } catch (e) {
      console.log(`   ⚠️  ${page.url} → ${e.message}`)
    }
  }
  console.log('✅ localStorage mobile dibersihkan (refresh tab untuk melihatnya).')
})().catch(e => { console.error('CDP error:', e.message); process.exit(1) })
NODE_CDP
  else
    echo "   ℹ️  Chrome DevTools (port 9222) tidak aktif — pakai snippet ini:"
    echo ""
    echo "   ▸ DevTools browser (F12 → Console, buka http://localhost:5173):"
    cat <<'SNIPPET'
     Object.keys(localStorage)
       .filter(k => /^trip\.(trips\.v\d+|pendingSync|syncQueue\.v\d+)$/.test(k))
       .forEach(k => localStorage.removeItem(k));
     location.reload();
SNIPPET
    echo "   ▸ Perangkat fisik: chrome://inspect → pilih perangkat → Console → tempel snippet yang sama."
  fi
fi

# ─── 4. VERIFIKASI ──────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "✅ Selesai!"
if [[ $DO_DB -eq 1 ]]; then
  echo "   Server  : trips/vehicles/trip_vehicles/plate_scans = 0"
  echo "   Backup  : data/backups/trip_backup_$TS.db"
fi
if [[ $DO_MOBILE -eq 1 ]]; then
  echo "   Mobile  : key riwayat dihapus — refresh aplikasi (atau buka ulang tab)"
fi
echo "   Pulihkan data: cp data/backups/trip_backup_*.db data/trip.db && ./restart-all.sh"
echo "========================================"
