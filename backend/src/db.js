const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../data/trip.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;

// sql.js wrapper that mimics better-sqlite3 API
const dbWrapper = {
  prepare(sql) {
    return {
      run(...params) {
        // sql.js requires null instead of undefined
        const safeParams = params.map(p => p === undefined ? null : p);
        db.run(sql, safeParams);
        saveDb();
      },
      get(...params) {
        const safeParams = params.map(p => p === undefined ? null : p);
        const stmt = db.prepare(sql);
        stmt.bind(safeParams);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const safeParams = params.map(p => p === undefined ? null : p);
        const results = [];
        const stmt = db.prepare(sql);
        stmt.bind(safeParams);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      }
    };
  },
  exec(sql) {
    db.run(sql);
  },
  get db() { return db; }
};

function saveDb() {
  if (db) {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }
}

async function loadDb() {
  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
    initialize();
  }

  migrate();
  return dbWrapper;
}

// Schema migrations for databases created before the column existed.
// Runs on every boot; swallows the "duplicate column" error when present.
function migrate() {
  try {
    db.run(`ALTER TABLE tariffs ADD COLUMN description TEXT DEFAULT ''`);
  } catch (e) {
    // column already exists — nothing to do
  }

  // ── Registrasi & penarifan nomor plat ──────────────────────────────────────
  // Semua CREATE bersifat idempotent agar DB lama ikut termigrasi.
  db.run(`
    CREATE TABLE IF NOT EXISTS vehicle_plates (
      id TEXT PRIMARY KEY,
      plate TEXT NOT NULL,
      owner TEXT DEFAULT '',
      origin_region_id TEXT,
      status TEXT NOT NULL DEFAULT 'internal',
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (origin_region_id) REFERENCES regions(id)
    )
  `);

  // Konfigurasi tarif terpusat per region: (region_id, jenis_tarif) → nominal.
  // jenis_tarif: 'lokal' (saat ini 0 / cadangan kebijakan) | 'eksternal'
  db.run(`
    CREATE TABLE IF NOT EXISTS region_tariffs (
      id TEXT PRIMARY KEY,
      region_id TEXT NOT NULL,
      tariff_type TEXT NOT NULL,
      nominal_tariff INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      UNIQUE(region_id, tariff_type),
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

  // Many-to-many petugas ↔ region.
  db.run(`
    CREATE TABLE IF NOT EXISTS officer_regions (
      officer_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      PRIMARY KEY (officer_id, region_id),
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

  // Log transaksi scan plat (jejak penarifan).
  db.run(`
    CREATE TABLE IF NOT EXISTS plate_scans (
      id TEXT PRIMARY KEY,
      plate TEXT NOT NULL,
      status TEXT NOT NULL,
      origin_region_id TEXT,
      checkpoint_region_id TEXT,
      tariff_amount INTEGER DEFAULT 0,
      officer_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  seedSpecTables();
  saveDb();
}

// Seed relasi petugas-region (backfill dari kolom lama) + tarif region default.
function seedSpecTables() {
  // Backfill many-to-many dari officers.region_id (INSERT OR IGNORE = idempotent)
  db.run(`INSERT OR IGNORE INTO officer_regions (officer_id, region_id) SELECT id, region_id FROM officers`);

  // Setiap region dapat pasangan tarif lokal + eksternal (default 0, aktif).
  // Catatan: di dalam modul ini `db` = Database sql.js mentah (bukan dbWrapper),
  // jadi pakai API statement sql.js (step/getAsObject/free), bukan .all().
  const stmt = db.prepare(`SELECT id FROM regions`);
  const regionIds = [];
  while (stmt.step()) {
    regionIds.push(stmt.getAsObject());
  }
  stmt.free();

  for (const r of regionIds) {
    for (const jenis of ['lokal', 'eksternal']) {
      db.run(
        `INSERT OR IGNORE INTO region_tariffs (id, region_id, tariff_type, nominal_tariff, is_active) VALUES (?, ?, ?, 0, 1)`,
        [`${r.id}:${jenis}`, r.id, jenis]
      );
    }
  }
}

function initialize() {
  // Regions table
  db.run(`
    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Dermagas table (pier/wharf within a region)
  db.run(`
    CREATE TABLE IF NOT EXISTS dermagas (
      id TEXT PRIMARY KEY,
      region_id TEXT NOT NULL,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

  // Routes table (linked to dermaga)
  db.run(`
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      dermaga_id TEXT NOT NULL,
      name TEXT NOT NULL,
      route_from TEXT NOT NULL,
      route_to TEXT NOT NULL,
      distance TEXT,
      duration TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (dermaga_id) REFERENCES dermagas(id)
    )
  `);

  // Officers table
  db.run(`
    CREATE TABLE IF NOT EXISTS officers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      region_id TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

  // Officer-Dermaga access (many-to-many)
  db.run(`
    CREATE TABLE IF NOT EXISTS officer_dermagas (
      officer_id TEXT NOT NULL,
      dermaga_id TEXT NOT NULL,
      PRIMARY KEY (officer_id, dermaga_id),
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (dermaga_id) REFERENCES dermagas(id)
    )
  `);

  // Tariffs table
  db.run(`
    CREATE TABLE IF NOT EXISTS tariffs (
      id TEXT PRIMARY KEY,
      golongan TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      loaded_tariff INTEGER DEFAULT 0,
      empty_tariff INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Vehicles table
  db.run(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      no_polisi TEXT NOT NULL,
      vehicle_type TEXT NOT NULL,
      golongan TEXT NOT NULL,
      trip_id TEXT,
      has_load INTEGER DEFAULT 0,
      tariff_id TEXT,
      tariff_amount INTEGER DEFAULT 0,
      foto_path TEXT,
      latitude REAL,
      longitude REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (tariff_id) REFERENCES tariffs(id)
    )
  `);

  // Trips table
  db.run(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      no_trip TEXT NOT NULL UNIQUE,
      officer_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      dermaga_id TEXT NOT NULL,
      route_id TEXT,
      status_muatan TEXT NOT NULL,
      route_from TEXT,
      route_to TEXT,
      keterangan TEXT,
      foto_kosong_path TEXT,
      is_synced INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (region_id) REFERENCES regions(id),
      FOREIGN KEY (dermaga_id) REFERENCES dermagas(id),
      FOREIGN KEY (route_id) REFERENCES routes(id)
    )
  `);

  // Trip_vehicles junction table
  db.run(`
    CREATE TABLE IF NOT EXISTS trip_vehicles (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )
  `);

  seedData();
  saveDb();
}

function seedData() {
  // Check if data exists
  const stmt = db.prepare('SELECT COUNT(*) as count FROM regions');
  stmt.step();
  const result = stmt.getAsObject();
  stmt.free();
  if (result.count > 0) return;

  // Seed regions (simple numbering)
  const regions = [
    { id: uuidv4(), name: 'Region 1', code: 'R1' },
    { id: uuidv4(), name: 'Region 2', code: 'R2' },
    { id: uuidv4(), name: 'Region 3', code: 'R3' },
    { id: uuidv4(), name: 'Region 4', code: 'R4' },
  ];

  const insertRegion = db.prepare('INSERT INTO regions (id, name, code) VALUES (?, ?, ?)');
  regions.forEach(r => {
    insertRegion.bind([r.id, r.name, r.code]);
    insertRegion.step();
    insertRegion.reset();
  });
  insertRegion.free();

  // Seed dermagas (2 per region)
  const dermagas = [
    // Region 1
    { id: uuidv4(), region_id: regions[0].id, name: 'Dermaga 1', code: 'D1' },
    { id: uuidv4(), region_id: regions[0].id, name: 'Dermaga 2', code: 'D2' },
    // Region 2
    { id: uuidv4(), region_id: regions[1].id, name: 'Dermaga 1', code: 'D1' },
    // Region 3
    { id: uuidv4(), region_id: regions[2].id, name: 'Dermaga 1', code: 'D1' },
    // Region 4
    { id: uuidv4(), region_id: regions[3].id, name: 'Dermaga 1', code: 'D1' },
  ];

  const insertDermaga = db.prepare('INSERT INTO dermagas (id, region_id, name, code) VALUES (?, ?, ?, ?)');
  dermagas.forEach(d => {
    insertDermaga.bind([d.id, d.region_id, d.name, d.code]);
    insertDermaga.step();
    insertDermaga.reset();
  });
  insertDermaga.free();

  // Seed routes (2 per dermaga for Region 1 dermagas)
  const routes = [
    // Region 1, Dermaga 1 routes
    { id: uuidv4(), dermaga_id: dermagas[0].id, name: 'Rute 1', route_from: 'A', route_to: 'B', distance: '5 km', duration: '15m' },
    { id: uuidv4(), dermaga_id: dermagas[0].id, name: 'Rute 2', route_from: 'C', route_to: 'D', distance: '8 km', duration: '20m' },
    // Region 1, Dermaga 2 routes
    { id: uuidv4(), dermaga_id: dermagas[1].id, name: 'Rute 3', route_from: 'E', route_to: 'F', distance: '6 km', duration: '18m' },
    { id: uuidv4(), dermaga_id: dermagas[1].id, name: 'Rute 4', route_from: 'G', route_to: 'H', distance: '10 km', duration: '25m' },
    // Region 2 Dermaga 1
    { id: uuidv4(), dermaga_id: dermagas[2].id, name: 'Rute 1', route_from: 'A', route_to: 'B', distance: '3 km', duration: '10m' },
    // Region 3 Dermaga 1
    { id: uuidv4(), dermaga_id: dermagas[3].id, name: 'Rute 1', route_from: 'A', route_to: 'B', distance: '3 km', duration: '10m' },
    // Region 4 Dermaga 1
    { id: uuidv4(), dermaga_id: dermagas[4].id, name: 'Rute 1', route_from: 'A', route_to: 'B', distance: '3 km', duration: '10m' },
  ];

  const insertRoute = db.prepare('INSERT INTO routes (id, dermaga_id, name, route_from, route_to, distance, duration) VALUES (?, ?, ?, ?, ?, ?, ?)');
  routes.forEach(r => {
    insertRoute.bind([r.id, r.dermaga_id, r.name, r.route_from, r.route_to, r.distance, r.duration]);
    insertRoute.step();
    insertRoute.reset();
  });
  insertRoute.free();

  // Seed officers with hashed PIN
  const hashedPin = bcrypt.hashSync('123456', 10);
  const officers = [
    { id: uuidv4(), name: 'Budi Santoso', pin: hashedPin, region_id: regions[0].id },
    { id: uuidv4(), name: 'Andi Pratama', pin: hashedPin, region_id: regions[0].id },
    { id: uuidv4(), name: 'Siti Rahayu', pin: hashedPin, region_id: regions[0].id },
    { id: uuidv4(), name: 'Rizky Maulana', pin: hashedPin, region_id: regions[3].id },
    { id: uuidv4(), name: 'Dewi Kusuma', pin: hashedPin, region_id: regions[0].id }, // Dual access: BADAU dermaga 1 & 2
  ];

  const insertOfficer = db.prepare('INSERT INTO officers (id, name, pin, region_id) VALUES (?, ?, ?, ?)');
  officers.forEach(o => {
    insertOfficer.bind([o.id, o.name, o.pin, o.region_id]);
    insertOfficer.step();
    insertOfficer.reset();
  });
  insertOfficer.free();

  // Seed officer-dermaga access
  const insertOfficerDermaga = db.prepare('INSERT INTO officer_dermagas (officer_id, dermaga_id) VALUES (?, ?)');

  // Budi: BADAU Dermaga 1 only
  insertOfficerDermaga.bind([officers[0].id, dermagas[0].id]);
  insertOfficerDermaga.step();
  insertOfficerDermaga.reset();

  // Andi: BADAU Dermaga 2 only
  insertOfficerDermaga.bind([officers[1].id, dermagas[1].id]);
  insertOfficerDermaga.step();
  insertOfficerDermaga.reset();

  // Siti: BADAU Dermaga 1 only (inactive in original)
  insertOfficerDermaga.bind([officers[2].id, dermagas[0].id]);
  insertOfficerDermaga.step();
  insertOfficerDermaga.reset();

  // Rizky: Entikong only
  insertOfficerDermaga.bind([officers[3].id, dermagas[4].id]);
  insertOfficerDermaga.step();
  insertOfficerDermaga.reset();

  // Dewi: BADAU Dermaga 1 AND Dermaga 2 (dual access!)
  insertOfficerDermaga.bind([officers[4].id, dermagas[0].id]);
  insertOfficerDermaga.step();
  insertOfficerDermaga.reset();
  insertOfficerDermaga.bind([officers[4].id, dermagas[1].id]);
  insertOfficerDermaga.step();
  insertOfficerDermaga.reset();

  insertOfficerDermaga.free();

  // Seed tariffs
  const tariffs = [
    { id: uuidv4(), golongan: 'I', vehicle_type: 'Motor', loaded_tariff: 15000, empty_tariff: 8000 },
    { id: uuidv4(), golongan: 'II', vehicle_type: 'Mobil', loaded_tariff: 45000, empty_tariff: 20000 },
    { id: uuidv4(), golongan: 'III', vehicle_type: 'Truck Kecil', loaded_tariff: 120000, empty_tariff: 55000 },
    { id: uuidv4(), golongan: 'IV', vehicle_type: 'Truck Sedang', loaded_tariff: 280000, empty_tariff: 130000 },
    { id: uuidv4(), golongan: 'V', vehicle_type: 'Truck Besar', loaded_tariff: 450000, empty_tariff: 200000 },
  ];

  const insertTariff = db.prepare('INSERT INTO tariffs (id, golongan, vehicle_type, loaded_tariff, empty_tariff) VALUES (?, ?, ?, ?, ?)');
  tariffs.forEach(t => {
    insertTariff.bind([t.id, t.golongan, t.vehicle_type, t.loaded_tariff, t.empty_tariff]);
    insertTariff.step();
    insertTariff.reset();
  });
  insertTariff.free();

  console.log('Database seeded with dermagas, routes, and access control');
}

// Export async initialization
module.exports = {
  loadDb,
  db: dbWrapper,
  initialize,
  seedData
};
