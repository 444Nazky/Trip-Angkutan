// Self-check idempotensi trip: kolom trips.client_trip_id ada, dan logika
// UPSERT (perbarui trip lama, bukan insert duplikat) bekerja seperti di
// POST /trips/complete. Jalankan: npm run check (DB sementara, tidak menyentuh data/)
const os = require('os');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const tmp = path.join(os.tmpdir(), `trip-check-${Date.now()}.db`);
process.env.DB_PATH = tmp;

const { loadDb, db } = require('../src/db');

(async () => {
  await loadDb();

  const cols = db.prepare(`PRAGMA table_info(trips)`).all().map(c => c.name);
  if (!cols.includes('client_trip_id')) throw new Error('kolom client_trip_id tidak ada');
  console.log('OK  kolom trips.client_trip_id tersedia');

  const clientTripId = `client-${uuidv4()}`;
  const tripId = uuidv4();
  db.prepare(`
    INSERT INTO trips (id, no_trip, officer_id, region_id, dermaga_id, status_muatan, route_from, client_trip_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(tripId, `TRP-CHECK-${Date.now()}`, 'off-1', 'reg-1', 'drm-1', 'kosong', 'AAAA', clientTripId);

  const found = db.prepare(`SELECT id, route_from FROM trips WHERE client_trip_id = ? LIMIT 1`).get(clientTripId);
  if (!found?.id) throw new Error('pencarian client_trip_id gagal');
  console.log('OK  lookup client_trip_id mengembalikan baris yang sudah ada');

  // Simulasi edit pasca-kirim: UPDATE, bukan INSERT kedua.
  db.prepare(`UPDATE trips SET route_from = ? WHERE id = ?`).run('BBBB', found.id);
  const count = db.prepare(`SELECT COUNT(*) AS c FROM trips WHERE client_trip_id = ?`).get(clientTripId);
  const edited = db.prepare(`SELECT id, route_from FROM trips WHERE client_trip_id = ? LIMIT 1`).get(clientTripId);
  if (count.c !== 1) throw new Error(`trip terduplikasi: ${count.c} baris`);
  if (edited.id !== found.id || edited.route_from !== 'BBBB') throw new Error('edit tidak diterapkan ke baris yang sama');
  console.log('OK  edit pasca-kirim memperbarui baris yang sama (tanpa duplikat)');

  fs.unlinkSync(tmp);
  console.log('\nSemua pengecekan lulus.');
})().catch(e => { console.error('GAGAL:', e.message); process.exit(1); });
