set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_PATH="$SCRIPT_DIR/backend/data/trip.db"
BACKUP_DIR="$SCRIPT_DIR/data/backups"

FORCE=0
[[ "${1:-}" == "--force" ]] && FORCE=1

echo ""
echo "Clear Trip History"
echo "================================"

# Cek database ada
if [[ ! -f "$DB_PATH" ]]; then
    echo "Database tidak ditemukan: $DB_PATH"
    echo "Pastikan backend sudah berjalan minimal sekali untuk buat database."
    exit 1
fi

# Info sebelum hapus
echo ""
echo "Database: $DB_PATH"
echo ""
echo " DATA YANG AKAN DIHAPUS:"
echo "   • Semua trip_vehicles (kendaraan per trip)"
echo "   • Semua vehicles (kendaraan individual)"
echo "   • Semua trips (trip record)"
echo ""
echo ""

if [[ $FORCE -eq 0 ]]; then
    echo -n "Continue? y/n"
    read -r confirm
    [[ "$confirm" == "y" ]] || { echo "n"; exit 0; }
fi

# Buat backup dulu
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/trip_backup_$TIMESTAMP.db"
cp "$DB_PATH" "$BACKUP_FILE"
echo "Backup disimpan: $BACKUP_FILE"

# Hapus data trip
echo "Menghapus data..."
cd "$SCRIPT_DIR/backend"

node -e "
const initSqlJs = require('sql.js');
const fs = require('fs');

async function clear() {
    const SQL = await initSqlJs();
    const buf = fs.readFileSync('$DB_PATH');
    const db = new SQL.Database(buf);

    // Hitung sebelum hapus
    const trips = db.exec('SELECT COUNT(*) FROM trips')[0]?.values[0][0] || 0;
    const vehicles = db.exec('SELECT COUNT(*) FROM vehicles')[0]?.values[0][0] || 0;
    const tripVehicles = db.exec('SELECT COUNT(*) FROM trip_vehicles')[0]?.values[0][0] || 0;

    console.log('   Trip: ' + trips + ' records');
    console.log('   Vehicles: ' + vehicles + ' records');
    console.log('   Trip_Vehicles: ' + tripVehicles + ' records');

    // Hapus (order penting: child tables dulu)
    db.run('DELETE FROM trip_vehicles');
    db.run('DELETE FROM vehicles');
    db.run('DELETE FROM trips');

    // Simpan
    const out = Buffer.from(db.export());
    fs.writeFileSync('$DB_PATH', out);
    console.log('Data trip dihapus dari database.');
}

clear().catch(e => { console.error('Error:', e.message); process.exit(1); });
"

echo ""
echo ""
echo "   • localStorage browser TIDAK ikut dibersihkan"
echo "   • Untuk clear localStorage, buka DevTools Console browser"
echo "     dan jalankan script dari Debugging/clear-trip-history.md"
echo ""
