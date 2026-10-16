const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const fs = require('fs');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/trip.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}



const fresh = !fs.existsSync(DB_PATH);
const db = new Database(DB_PATH);



function migrate() {
  try {
    db.exec(`ALTER TABLE tariffs ADD COLUMN description TEXT DEFAULT ''`);
  } catch (e) {}

  try {
    db.exec(`ALTER TABLE officers ADD COLUMN username TEXT`);
    console.log('Migrated: officers.username column added');
  } catch (e) {}
  for (const t of ['dermagas', 'routes']) {
    try { db.exec(`ALTER TABLE ${t} ADD COLUMN username TEXT`); } catch (e) {}
  }
  try {
    db.exec(`
      UPDATE officers
         SET username = LOWER(REPLACE(name, ' ', ''))
       WHERE username IS NULL OR username = ''
    `);
  } catch (e) {}

  db.exec(`
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

  db.exec(`
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS officer_regions (
      officer_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      PRIMARY KEY (officer_id, region_id),
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

  db.exec(`
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS geofences (
      id TEXT PRIMARY KEY,
      location_name TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters REAL NOT NULL DEFAULT 100,
      allowed_route_codes TEXT DEFAULT '',
      allowed_directions TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  relaxTripsDermagaNotNull();
  for (const [table, column, definition] of [
    ['trips', 'foto_captured_at', 'TEXT'],
    ['trips', 'foto_latitude', 'REAL'],
    ['trips', 'foto_longitude', 'REAL'],
    ['trips', 'started_at', 'TEXT'],
    ['trips', 'completed_at', 'TEXT'],
    ['vehicles', 'foto_captured_at', 'TEXT'],
  ]) {
    try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch (e) {}
  }

  ensureSpecRegions();
  seedSpecTables();
}



function relaxTripsDermagaNotNull() {
  try {
    const col = db.prepare(`PRAGMA table_info(trips)`).all()
      .find((c) => c.name === 'dermaga_id');
    if (!col || col.notnull !== 1) return;

    db.exec(`
      CREATE TABLE trips_relaxed (
        id TEXT PRIMARY KEY,
        no_trip TEXT NOT NULL UNIQUE,
        officer_id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        dermaga_id TEXT,
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
    db.exec(`
      INSERT INTO trips_relaxed
        (id, no_trip, officer_id, region_id, dermaga_id, route_id, status_muatan,
         route_from, route_to, keterangan, foto_kosong_path, is_synced, created_at)
      SELECT id, no_trip, officer_id, region_id, dermaga_id, route_id, status_muatan,
             route_from, route_to, keterangan, foto_kosong_path, is_synced, created_at
        FROM trips
    `);
    db.exec(`DROP TABLE trips`);
    db.exec(`ALTER TABLE trips_relaxed RENAME TO trips`);
    console.log('Migrated: trips.dermaga_id is now nullable');
  } catch (e) {
    console.warn('Skip trips.dermaga_id migration:', e.message);
  }
}



const SPEC_WILAYAH = [
  {
    code: 'ENTIKONG', name: 'Entikong',
    officers: [],
    routes: [
      { d: 'D1', from: 'A4A4', to: 'B8B8', name: 'A4A4 → B8B8', distance: null, duration: null },
      { d: 'D1', from: 'B8B8', to: 'A4A4', name: 'B8B8 → A4A4', distance: null, duration: null },
      { d: 'D2', from: 'C3C3', to: 'D6D6', name: 'C3C3 → D6D6', distance: null, duration: null },
      { d: 'D2', from: 'D6D6', to: 'C3C3', name: 'D6D6 → C3C3', distance: null, duration: null },
    ],
  },
  {
    code: 'BADAU', name: 'Badau',
    officers: [],
    routes: [
      { d: 'D1', from: 'SJRE', to: 'SBDZ', name: 'Sijangkung → Sabadi', distance: '42 km', duration: '1j 10m' },
      { d: 'D1', from: 'SBDZ', to: 'SJRE', name: 'Sabadi → Sijangkung', distance: '42 km', duration: '1j 10m' },
      { d: 'D2', from: 'AAAA', to: 'BBBB', name: 'AAAA → BBBB', distance: null, duration: null },
      { d: 'D2', from: 'BBBB', to: 'AAAA', name: 'BBBB → AAAA', distance: null, duration: null },
    ],
  },
  {
    code: 'BELITUNG', name: 'Belitung',
    officers: [],
    routes: [
      { d: 'D1', from: 'CCCC', to: 'DDDD', name: 'CCCC → DDDD', distance: null, duration: null },
      { d: 'D1', from: 'DDDD', to: 'CCCC', name: 'DDDD → CCCC', distance: null, duration: null },
      { d: 'D2', from: 'EEEE', to: 'FFFF', name: 'EEEE → FFFF', distance: null, duration: null },
      { d: 'D2', from: 'FFFF', to: 'EEEE', name: 'FFFF → EEEE', distance: null, duration: null },
    ],
  },
  {
    code: 'KELAPAKAMPIT', name: 'Kelapa Kampit',
    officers: [],
    routes: [
      { d: 'D1', from: 'GGGG', to: 'HHHH', name: 'GGGG → HHHH', distance: null, duration: null },
      { d: 'D1', from: 'HHHH', to: 'GGGG', name: 'HHHH → GGGG', distance: null, duration: null },
      { d: 'D2', from: 'IIII', to: 'JJJJ', name: 'IIII → JJJJ', distance: null, duration: null },
      { d: 'D2', from: 'JJJJ', to: 'IIII', name: 'JJJJ → IIII', distance: null, duration: null },
    ],
  },
];



const DEMO_OFFICERS = [
  { name: 'Budi Santoso', region: 'BADAU', docks: ['D1'] },
  { name: 'Andi Pratama', region: 'BADAU', docks: ['D2'] },
  { name: 'Dewi Kusuma', region: 'BADAU', docks: ['D1', 'D2'] },
  { name: 'Siti Rahayu', region: 'BADAU', docks: ['D1'] },
  { name: 'Agung Suntoso', region: 'BELITUNG', docks: ['D1'] },
  { name: 'Rahmat Hidayat', region: 'BELITUNG', docks: ['D2'] },
  { name: 'Hendra Gunawan', region: 'KELAPAKAMPIT', docks: ['D1'] },
  { name: 'Maya Sari', region: 'KELAPAKAMPIT', docks: ['D2'] },
];



const regionDefaultPassword = (code) => `${String(code).toLowerCase()}123`;



function ensureSpecRegions() {
  try {
    db.exec(`ALTER TABLE regions ADD COLUMN password TEXT`);
  } catch (e) {}

  const hashedPin = bcrypt.hashSync('123456', 10);

  for (const w of SPEC_WILAYAH) {
    let region = db.prepare(`SELECT * FROM regions WHERE code = ?`).get(w.code);
    if (!region) {
      db.prepare(`INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)`)
        .run(randomUUID(), w.name, w.code, bcrypt.hashSync(regionDefaultPassword(w.code), 10));
      region = db.prepare(`SELECT * FROM regions WHERE code = ?`).get(w.code);
    }
    if (!region) continue;

    if (!region.password) {
      db.prepare(`UPDATE regions SET password = ? WHERE id = ?`)
        .run(bcrypt.hashSync(regionDefaultPassword(w.code), 10), region.id);
    }

    for (const [dc, dname] of [['D1', 'Dermaga 1'], ['D2', 'Dermaga 2']]) {
      let dm = db.prepare(`SELECT * FROM dermagas WHERE region_id = ? AND code = ?`).get(region.id, dc);
      if (!dm) {
        db.prepare(`INSERT INTO dermagas (id, region_id, name, code) VALUES (?, ?, ?, ?)`)
          .run(randomUUID(), region.id, dname, dc);
        dm = db.prepare(`SELECT * FROM dermagas WHERE region_id = ? AND code = ?`).get(region.id, dc);
      }
      if (!dm) continue;

      const specRoutes = w.routes.filter(r => r.d === dc);

      {
        const olds = db.prepare(`SELECT id, route_from, route_to FROM routes WHERE dermaga_id = ?`).all(dm.id);
        const wanted = specRoutes.map(r => `${r.from}|${r.to}`);
        for (const old of olds) {
          if (wanted.includes(`${old.route_from}|${old.route_to}`)) continue;
          const used = db.prepare(`SELECT 1 as x FROM trips WHERE route_id = ?`).get(old.id);
          if (used) continue;
          db.prepare(`DELETE FROM routes WHERE id = ?`).run(old.id);
        }
      }

      for (const r of specRoutes) {
        const exists = db.prepare(
          `SELECT 1 as x FROM routes WHERE dermaga_id = ? AND route_from = ? AND route_to = ?`
        ).get(dm.id, r.from, r.to);
        if (!exists) {
          db.prepare(
            `INSERT INTO routes (id, dermaga_id, name, route_from, route_to, distance, duration) VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(randomUUID(), dm.id, r.name, r.from, r.to, r.distance, r.duration);
        }
      }
    }

    const noAccess = db.prepare(`
      SELECT o.id FROM officers o
      WHERE o.region_id = ?
        AND NOT EXISTS (SELECT 1 FROM officer_dermagas od WHERE od.officer_id = o.id)
    `).all(region.id);
    if (noAccess.length) {
      const dm1 = db.prepare(`SELECT id FROM dermagas WHERE region_id = ? AND code = 'D1'`).get(region.id);
      if (dm1) {
        const ins = db.prepare(`INSERT OR IGNORE INTO officer_dermagas (officer_id, dermaga_id) VALUES (?, ?)`);
        for (const o of noAccess) ins.run(o.id, dm1.id);
      }
    }
  }

  for (const demo of DEMO_OFFICERS) {
    const region = db.prepare(`SELECT id FROM regions WHERE code = ?`).get(demo.region);
    if (!region) continue;
    let officer = db.prepare(`SELECT id FROM officers WHERE name = ?`).get(demo.name);
    if (!officer) {
      const id = randomUUID();
      db.prepare(`INSERT INTO officers (id, name, pin, region_id, is_active) VALUES (?, ?, ?, ?, 1)`)
        .run(id, demo.name, hashedPin, region.id);
      officer = { id };
    } else {
      db.prepare(`UPDATE officers SET region_id = ? WHERE id = ?`).run(region.id, officer.id);
    }

    db.prepare(`DELETE FROM officer_dermagas WHERE officer_id = ?`).run(officer.id);
    db.prepare(`DELETE FROM officer_regions WHERE officer_id = ?`).run(officer.id);
    db.prepare(`INSERT OR IGNORE INTO officer_regions (officer_id, region_id) VALUES (?, ?)`)
      .run(officer.id, region.id);
    for (const dockCode of demo.docks) {
      const dock = db.prepare(`SELECT id FROM dermagas WHERE region_id = ? AND code = ?`).get(region.id, dockCode);
      if (dock) {
        db.prepare(`INSERT OR IGNORE INTO officer_dermagas (officer_id, dermaga_id) VALUES (?, ?)`)
          .run(officer.id, dock.id);
      }
    }
  }

  const noPw = db.prepare(`SELECT id, code FROM regions WHERE password IS NULL OR password = ''`).all();
  for (const r of noPw) {
    db.prepare(`UPDATE regions SET password = ? WHERE id = ?`)
      .run(bcrypt.hashSync(regionDefaultPassword(r.code), 10), r.id);
  }
}



function seedSpecTables() {
  db.exec(`INSERT OR IGNORE INTO officer_regions (officer_id, region_id) SELECT id, region_id FROM officers`);

  const regionIds = db.prepare(`SELECT id FROM regions`).all();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO region_tariffs (id, region_id, tariff_type, nominal_tariff, is_active) VALUES (?, ?, ?, 0, 1)`
  );
  for (const r of regionIds) {
    for (const jenis of ['lokal', 'eksternal']) ins.run(`${r.id}:${jenis}`, r.id, jenis);
  }
}



function initialize() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS dermagas (
      id TEXT PRIMARY KEY,
      region_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT,
      code TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      id TEXT PRIMARY KEY,
      dermaga_id TEXT NOT NULL,
      name TEXT NOT NULL,
      username TEXT,
      route_from TEXT NOT NULL,
      route_to TEXT NOT NULL,
      distance TEXT,
      duration TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (dermaga_id) REFERENCES dermagas(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS officers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      pin TEXT NOT NULL,
      region_id TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS officer_dermagas (
      officer_id TEXT NOT NULL,
      dermaga_id TEXT NOT NULL,
      PRIMARY KEY (officer_id, dermaga_id),
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (dermaga_id) REFERENCES dermagas(id)
    )
  `);

  db.exec(`
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

  db.exec(`
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
      foto_captured_at TEXT,
      latitude REAL,
      longitude REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (tariff_id) REFERENCES tariffs(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trips (
      id TEXT PRIMARY KEY,
      no_trip TEXT NOT NULL UNIQUE,
      officer_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      dermaga_id TEXT,
      route_id TEXT,
      status_muatan TEXT NOT NULL,
      route_from TEXT,
      route_to TEXT,
      keterangan TEXT,
      foto_kosong_path TEXT,
      foto_captured_at TEXT,
      foto_latitude REAL,
      foto_longitude REAL,
      started_at TEXT,
      completed_at TEXT,
      is_synced INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (region_id) REFERENCES regions(id),
      FOREIGN KEY (dermaga_id) REFERENCES dermagas(id),
      FOREIGN KEY (route_id) REFERENCES routes(id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS trip_vehicles (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL,
      vehicle_id TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (vehicle_id) REFERENCES vehicles(id)
    )
  `);
}



function seedData() {
  const result = db.prepare('SELECT COUNT(*) as count FROM tariffs').get();
  if (result.count > 0) return;

  const tariffs = [
    { id: randomUUID(), golongan: 'I', vehicle_type: 'Motor', loaded_tariff: 15000, empty_tariff: 8000 },
    { id: randomUUID(), golongan: 'II', vehicle_type: 'Mobil', loaded_tariff: 45000, empty_tariff: 20000 },
    { id: randomUUID(), golongan: 'III', vehicle_type: 'Truck Kecil', loaded_tariff: 120000, empty_tariff: 55000 },
    { id: randomUUID(), golongan: 'IV', vehicle_type: 'Truck Sedang', loaded_tariff: 280000, empty_tariff: 130000 },
    { id: randomUUID(), golongan: 'V', vehicle_type: 'Truck Besar', loaded_tariff: 450000, empty_tariff: 200000 },
  ];

  const insertTariff = db.prepare('INSERT INTO tariffs (id, golongan, vehicle_type, loaded_tariff, empty_tariff) VALUES (?, ?, ?, ?, ?)');
  for (const t of tariffs) {
    insertTariff.run(t.id, t.golongan, t.vehicle_type, t.loaded_tariff, t.empty_tariff);
  }

  console.log('Database seeded: tarif default');
}

if (fresh) initialize();
migrate();
seedData();



module.exports = { db };
