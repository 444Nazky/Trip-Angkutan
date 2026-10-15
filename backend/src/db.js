const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');




const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/trip.db');




const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db = null;




const dbWrapper = {
  prepare(sql) {
    return {
      run(...params) {
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
    initialize();
  } else {
    db = new SQL.Database();
    initialize();
  }

  migrate();
  return dbWrapper;
}




function migrate() {
  try {
    db.run(`ALTER TABLE tariffs ADD COLUMN description TEXT DEFAULT ''`);
  } catch (e) {
  }

  initialize();

  try {
    db.run(`ALTER TABLE officers ADD COLUMN username TEXT`);
    console.log('Migrated: officers.username column added');
  } catch (e) {
  }
  for (const t of ['dermagas', 'routes']) {
    try { db.run(`ALTER TABLE ${t} ADD COLUMN username TEXT`); } catch (e) { /* sudah ada */ }
  }
  try {
    db.run(`
      UPDATE officers
         SET username = LOWER(REPLACE(name, ' ', ''))
       WHERE username IS NULL OR username = ''
    `);
  } catch (e) { /* tidak fatal */ }

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

  db.run(`
    CREATE TABLE IF NOT EXISTS officer_regions (
      officer_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      PRIMARY KEY (officer_id, region_id),
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

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

  relaxTripsDermagaNotNull();
  for (const [table, column, definition] of [
    ['trips', 'foto_captured_at', 'TEXT'],
    ['trips', 'foto_latitude', 'REAL'],
    ['trips', 'foto_longitude', 'REAL'],
    ['trips', 'started_at', 'TEXT'],
    ['trips', 'completed_at', 'TEXT'],
    ['vehicles', 'foto_captured_at', 'TEXT'],
    ['trips', 'client_trip_id', 'TEXT'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch (e) { /* already exists */ }
  }
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_trips_client_trip_id ON trips(client_trip_id)`);
  } catch (e) { /* index sudah ada */ }
  ensureSpecRegions();
  seedSpecTables();
  saveDb();
}




function relaxTripsDermagaNotNull() {
  try {
    const col = dbWrapper.prepare(`PRAGMA table_info(trips)`).all()
      .find((c) => c.name === 'dermaga_id');
    if (!col || col.notnull !== 1) return;

    db.run(`
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
    db.run(`
      INSERT INTO trips_relaxed
        (id, no_trip, officer_id, region_id, dermaga_id, route_id, status_muatan,
         route_from, route_to, keterangan, foto_kosong_path, is_synced, created_at)
      SELECT id, no_trip, officer_id, region_id, dermaga_id, route_id, status_muatan,
             route_from, route_to, keterangan, foto_kosong_path, is_synced, created_at
        FROM trips
    `);
    db.run(`DROP TABLE trips`);
    db.run(`ALTER TABLE trips_relaxed RENAME TO trips`);
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




function q1(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const row = stmt.step() ? stmt.getAsObject() : null;
  stmt.free();
  return row;
}




function qAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}




function ensureSpecRegions() {
  try {
    db.run(`ALTER TABLE regions ADD COLUMN password TEXT`);
  } catch (e) { /* kolom sudah ada */ }

  const hashedPin = bcrypt.hashSync('123456', 10);

  for (const w of SPEC_WILAYAH) {
    let region = q1(`SELECT * FROM regions WHERE code = ?`, [w.code]);
    if (!region) {
      db.run(
        `INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)`,
        [randomUUID(), w.name, w.code, bcrypt.hashSync(regionDefaultPassword(w.code), 10)]
      );
      region = q1(`SELECT * FROM regions WHERE code = ?`, [w.code]);
    }
    if (!region) continue;

    if (!region.password) {
      db.run(`UPDATE regions SET password = ? WHERE id = ?`,
        [bcrypt.hashSync(regionDefaultPassword(w.code), 10), region.id]);
    }

    for (const [dc, dname] of [['D1', 'Dermaga 1'], ['D2', 'Dermaga 2']]) {
      let dm = q1(`SELECT * FROM dermagas WHERE region_id = ? AND code = ?`, [region.id, dc]);
      if (!dm) {
        db.run(`INSERT INTO dermagas (id, region_id, name, code) VALUES (?, ?, ?, ?)`,
          [randomUUID(), region.id, dname, dc]);
        dm = q1(`SELECT * FROM dermagas WHERE region_id = ? AND code = ?`, [region.id, dc]);
      }
      if (!dm) continue;

      const specRoutes = w.routes.filter(r => r.d === dc);

      {
        const olds = qAll(`SELECT id, route_from, route_to FROM routes WHERE dermaga_id = ?`, [dm.id]);
        const wanted = specRoutes.map(r => `${r.from}|${r.to}`);
        for (const old of olds) {
          if (wanted.includes(`${old.route_from}|${old.route_to}`)) continue;
          const used = q1(`SELECT 1 as x FROM trips WHERE route_id = ?`, [old.id]);
          if (used) continue;
          db.run(`DELETE FROM routes WHERE id = ?`, [old.id]);
        }
      }

      for (const r of specRoutes) {
        const exists = q1(
          `SELECT 1 as x FROM routes WHERE dermaga_id = ? AND route_from = ? AND route_to = ?`,
          [dm.id, r.from, r.to]
        );
        if (!exists) {
          db.run(
            `INSERT INTO routes (id, dermaga_id, name, route_from, route_to, distance, duration) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [randomUUID(), dm.id, r.name, r.from, r.to, r.distance, r.duration]
          );
        }
      }
    }

    const noAccess = qAll(`
      SELECT o.id FROM officers o
      WHERE o.region_id = ?
        AND NOT EXISTS (SELECT 1 FROM officer_dermagas od WHERE od.officer_id = o.id)
    `, [region.id]);
    if (noAccess.length) {
      const dm1 = q1(`SELECT id FROM dermagas WHERE region_id = ? AND code = 'D1'`, [region.id]);
      if (dm1) {
        for (const o of noAccess) {
          db.run(`INSERT OR IGNORE INTO officer_dermagas (officer_id, dermaga_id) VALUES (?, ?)`,
            [o.id, dm1.id]);
        }
      }
    }
  }

  for (const demo of DEMO_OFFICERS) {
    const region = q1(`SELECT id FROM regions WHERE code = ?`, [demo.region]);
    if (!region) continue;
    let officer = q1(`SELECT id FROM officers WHERE name = ?`, [demo.name]);
    if (!officer) {
      const id = randomUUID();
      db.run(`INSERT INTO officers (id, name, pin, region_id, is_active) VALUES (?, ?, ?, ?, 1)`,
        [id, demo.name, hashedPin, region.id]);
      officer = { id };
    } else {
      db.run(`UPDATE officers SET region_id = ? WHERE id = ?`, [region.id, officer.id]);
    }

    db.run(`DELETE FROM officer_dermagas WHERE officer_id = ?`, [officer.id]);
    db.run(`DELETE FROM officer_regions WHERE officer_id = ?`, [officer.id]);
    db.run(`INSERT OR IGNORE INTO officer_regions (officer_id, region_id) VALUES (?, ?)`, [officer.id, region.id]);
    for (const dockCode of demo.docks) {
      const dock = q1(`SELECT id FROM dermagas WHERE region_id = ? AND code = ?`, [region.id, dockCode]);
      if (dock) {
        db.run(`INSERT OR IGNORE INTO officer_dermagas (officer_id, dermaga_id) VALUES (?, ?)`, [officer.id, dock.id]);
      }
    }
  }

  const noPw = qAll(`SELECT id, code FROM regions WHERE password IS NULL OR password = ''`);
  for (const r of noPw) {
    db.run(`UPDATE regions SET password = ? WHERE id = ?`,
      [bcrypt.hashSync(regionDefaultPassword(r.code), 10), r.id]);
  }
}




function seedSpecTables() {
  db.run(`INSERT OR IGNORE INTO officer_regions (officer_id, region_id) SELECT id, region_id FROM officers`);

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
  db.run(`
    CREATE TABLE IF NOT EXISTS regions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
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

  db.run(`
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

  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS officer_dermagas (
      officer_id TEXT NOT NULL,
      dermaga_id TEXT NOT NULL,
      PRIMARY KEY (officer_id, dermaga_id),
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (dermaga_id) REFERENCES dermagas(id)
    )
  `);

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
      foto_captured_at TEXT,
      latitude REAL,
      longitude REAL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (trip_id) REFERENCES trips(id),
      FOREIGN KEY (tariff_id) REFERENCES tariffs(id)
    )
  `);

  db.run(`
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

  db.run(`
    CREATE TABLE IF NOT EXISTS officer_regions (
      officer_id TEXT NOT NULL,
      region_id TEXT NOT NULL,
      PRIMARY KEY (officer_id, region_id),
      FOREIGN KEY (officer_id) REFERENCES officers(id),
      FOREIGN KEY (region_id) REFERENCES regions(id)
    )
  `);

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

  db.run(`
    CREATE TABLE IF NOT EXISTS geofences (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dermaga_id TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters INTEGER DEFAULT 100,
      allowed_routes TEXT NOT NULL DEFAULT '[]',
      enabled INTEGER DEFAULT 1,
      strict_enforce_outside INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  seedData();

  // Migration 1: add columns that might not exist yet
  // name is NOT NULL in schema, so we need to add it with a default value
  try { db.run(`ALTER TABLE geofences ADD COLUMN name TEXT DEFAULT ''`); } catch (e) { /* already exists */ }
  try { db.run(`ALTER TABLE geofences ADD COLUMN location_name TEXT`); } catch (e) { /* already exists */ }
  try { db.run(`ALTER TABLE geofences ADD COLUMN allowed_route_codes TEXT`); } catch (e) { /* already exists */ }

  // Migration 2: fix geofence data that was stored in wrong columns
  // Copy data from location_name -> name and allowed_route_codes -> allowed_routes
  // Only run if both source and target columns exist
  try {
    const geofenceCols = qAll(`PRAGMA table_info(geofences)`).map(c => c.name);
    if (geofenceCols.includes('location_name') && geofenceCols.includes('name')) {
      db.run(`UPDATE geofences SET name = location_name WHERE (name IS NULL OR name = '') AND location_name IS NOT NULL AND location_name != ''`);
    }
    if (geofenceCols.includes('allowed_route_codes') && geofenceCols.includes('allowed_routes')) {
      db.run(`UPDATE geofences SET allowed_routes = allowed_route_codes WHERE (allowed_routes IS NULL OR allowed_routes = '' OR allowed_routes = '[]') AND allowed_route_codes IS NOT NULL AND allowed_route_codes != ''`);
    }
    console.log('[geofence] Migration: copied data from legacy columns');
  } catch (e) {
    console.warn('[geofence] Migration data copy failed:', e.message);
  }

  // Migration 3: fix geofence dermaga_id to use actual UUIDs
  // Only run if dermaga_id column exists
  try {
    const geofenceCols = qAll(`PRAGMA table_info(geofences)`).map(c => c.name);
    if (!geofenceCols.includes('dermaga_id')) {
      console.log('[geofence] Migration: dermaga_id column not found, skipping');
    } else {
      const badau = q1(`SELECT id FROM regions WHERE code = 'BADAU'`);
      if (badau) {
        const d1 = q1(`SELECT id FROM dermagas WHERE region_id = ? AND code = 'D1'`, [badau.id]);
        const d2 = q1(`SELECT id FROM dermagas WHERE region_id = ? AND code = 'D2'`, [badau.id]);

        if (d1 && d2) {
          db.run(`UPDATE geofences SET dermaga_id = ? WHERE id = 'badau-d1' AND (dermaga_id = 'BADAU-D1' OR dermaga_id IS NULL)`, [d1.id]);
          db.run(`UPDATE geofences SET dermaga_id = ? WHERE id = 'badau-d2' AND (dermaga_id = 'BADAU-D2' OR dermaga_id IS NULL)`, [d2.id]);
          console.log('[geofence] Migration: fixed dermaga_id for default geofences');
        }
      }
    }
  } catch (e) {
    console.warn('[geofence] Migration failed:', e.message);
  }

  try {
    db.run(`ALTER TABLE geofences ADD COLUMN strict_enforce_outside INTEGER DEFAULT 1`);
  } catch (e) { /* kolom sudah ada */ }

  // Migration 4: Repair existing geofence records with missing name column
  try {
    const cols = qAll(`PRAGMA table_info(geofences)`).map(c => c.name);
    if (cols.includes('name') && cols.includes('location_name')) {
      // Set name from location_name if name is empty/null
      db.run(`UPDATE geofences SET name = location_name WHERE (name IS NULL OR name = '') AND location_name IS NOT NULL AND location_name != ''`);
      // Set location_name from name if location_name is empty/null
      db.run(`UPDATE geofences SET location_name = name WHERE (location_name IS NULL OR location_name = '') AND name IS NOT NULL AND name != ''`);
      console.log('[geofence] Migration 4: repaired name/location_name columns');
    }
    // Set allowed_route_codes from allowed_routes if missing
    if (cols.includes('allowed_route_codes') && cols.includes('allowed_routes')) {
      db.run(`UPDATE geofences SET allowed_route_codes = allowed_routes WHERE (allowed_route_codes IS NULL OR allowed_route_codes = '') AND allowed_routes IS NOT NULL AND allowed_routes != '' AND allowed_routes != '[]'`);
    }
    // Set enabled = 1 if missing (NULL)
    if (cols.includes('enabled')) {
      db.run(`UPDATE geofences SET enabled = 1 WHERE enabled IS NULL`);
    }
    console.log('[geofence] Migration 4: completed');
  } catch (e) {
    console.warn('[geofence] Migration 4 failed:', e.message);
  }

  seedDefaultGeofences();
  saveDb();
}




function seedDefaultGeofences() {
  // Get actual dermaga IDs from database
  const badau = q1(`SELECT id FROM regions WHERE code = 'BADAU'`);
  if (!badau) return;

  const d1 = q1(`SELECT id FROM dermagas WHERE region_id = ? AND code = 'D1'`, [badau.id]);
  const d2 = q1(`SELECT id FROM dermagas WHERE region_id = ? AND code = 'D2'`, [badau.id]);

  if (!d1 || !d2) return;

  // Check which columns exist in geofences table
  const cols = qAll(`PRAGMA table_info(geofences)`).map(c => c.name);
  const hasName = cols.includes('name');
  const hasLocationName = cols.includes('location_name');
  const hasAllowedRouteCodes = cols.includes('allowed_route_codes');
  const hasEnabled = cols.includes('enabled');

  if (!hasName && !hasLocationName) {
    console.warn('[geofence] Seed: neither name nor location_name column exists, skipping seed');
    return;
  }

  const defaults = [
    {
      id: 'badau-d1',
      name: 'Badau Dermaga 1',
      latitude: -6.1891005,
      longitude: 106.8371641,
      radius_meters: 100,
      allowed_routes: 'SJRE-SBDZ',
    },
    {
      id: 'badau-d2',
      name: 'Badau Dermaga 2',
      latitude: -6.2389899548617285,
      longitude: 106.97475839406252,
      radius_meters: 100,
      allowed_routes: 'SBDZ-SJRE',
    },
  ];

  // Check if geofences table has data already
  const check = db.prepare('SELECT id FROM geofences WHERE id = ?');

  // Build INSERT statement based on available columns
  let colNames = ['id'];
  let placeholders = ['?'];
  let values = [];

  // location_name is the primary name column (used by mobile)
  if (hasLocationName) {
    colNames.push('location_name');
    placeholders.push('?');
  }
  if (hasName) {
    colNames.push('name');
    placeholders.push('?');
  }

  colNames.push('latitude', 'longitude', 'radius_meters');
  placeholders.push('?', '?', '?');

  if (hasAllowedRouteCodes) {
    colNames.push('allowed_route_codes');
    placeholders.push('?');
  }

  if (hasEnabled) {
    colNames.push('enabled');
    placeholders.push('?');
  }

  const ins = db.prepare(`
    INSERT OR IGNORE INTO geofences (${colNames.join(', ')})
    VALUES (${placeholders.join(', ')})
  `);

  for (const g of defaults) {
    check.bind([g.id]);
    const exists = check.step();
    check.reset();
    if (!exists) {
      try {
        values = [g.id];
        if (hasLocationName) values.push(g.name);
        if (hasName) values.push(g.name);
        values.push(g.latitude, g.longitude, g.radius_meters);
        if (hasAllowedRouteCodes) values.push(g.allowed_routes);
        if (hasEnabled) values.push(1);
        ins.run(values);
      } catch (e2) {
        console.warn('[geofence] Seed insert failed:', e2.message);
      }
    }
  }
  ins.free();
  check.free();
  console.log('[geofence] Seed default: Badau Dermaga 1 & 2');
}




function seedData() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM regions');
  stmt.step();
  const result = stmt.getAsObject();
  stmt.free();
  if (result.count > 0) return;

  try { db.run('ALTER TABLE regions ADD COLUMN password TEXT'); } catch (e) { /* sudah ada */ }

  const insertRegion = db.prepare('INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)');
  for (const w of SPEC_WILAYAH) {
    insertRegion.bind([randomUUID(), w.name, w.code, bcrypt.hashSync(regionDefaultPassword(w.code), 10)]);
    insertRegion.step();
    insertRegion.reset();
  }
  insertRegion.free();

  ensureSpecRegions();

  const tariffs = [
    { id: randomUUID(), golongan: 'I', vehicle_type: 'Motor', loaded_tariff: 15000, empty_tariff: 8000 },
    { id: randomUUID(), golongan: 'II', vehicle_type: 'Mobil', loaded_tariff: 45000, empty_tariff: 20000 },
    { id: randomUUID(), golongan: 'III', vehicle_type: 'Truck Kecil', loaded_tariff: 120000, empty_tariff: 55000 },
    { id: randomUUID(), golongan: 'IV', vehicle_type: 'Truck Sedang', loaded_tariff: 280000, empty_tariff: 130000 },
    { id: randomUUID(), golongan: 'V', vehicle_type: 'Truck Besar', loaded_tariff: 450000, empty_tariff: 200000 },
  ];

  const insertTariff = db.prepare('INSERT INTO tariffs (id, golongan, vehicle_type, loaded_tariff, empty_tariff) VALUES (?, ?, ?, ?, ?)');
  tariffs.forEach(t => {
    insertTariff.bind([t.id, t.golongan, t.vehicle_type, t.loaded_tariff, t.empty_tariff]);
    insertTariff.step();
    insertTariff.reset();
  });
  insertTariff.free();

  console.log('Database seeded: 3 wilayah, dermaga, rute, petugas, dan tarif');
}




module.exports = {
  loadDb,
  db: dbWrapper,
  initialize,
  seedData
};
