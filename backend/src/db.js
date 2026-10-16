const path = require('path');
const initSqlJs = require('sql.js').default;
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const fs = require('fs');



const SQL_WASM = path.resolve(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');

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
  const SQL = await initSqlJs({
    locateFile: (file) => {
      if (file.endsWith('.wasm')) return SQL_WASM;
      return file;
    }
  });

  const fresh = !fs.existsSync(DB_PATH);
  if (fresh) {
    db = new SQL.Database();
  } else {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  }

  initialize();

  migrate();
  if (fresh) {
    seedData();
  }
  saveDb();
  return dbWrapper;
}



function migrate() {
  try {
    db.run(`ALTER TABLE tariffs ADD COLUMN description TEXT DEFAULT ''`);
  } catch (e) {
  }

  // Samakan skema geofence lama dengan dialek mobile.
  // DB produksi (volume Railway) dibuat sebelum sebagian kolom ini ada, dan
  // `CREATE TABLE IF NOT EXISTS` tidak menambahkan kolom ke tabel yang sudah ada.
  // Dulu hanya dermaga_id/enabled yang ditambal, sehingga SELECT/INSERT lain
  // (allowed_directions, description, name) melempar 500 di DB lama.
  for (const [table, definition] of [
    ['geofences', 'dermaga_id TEXT'],
    ['geofences', 'enabled INTEGER NOT NULL DEFAULT 1'],
    ['geofences', 'name TEXT DEFAULT \'\''],
    ['geofences', 'location_name TEXT'],
    ['geofences', 'allowed_route_codes TEXT'],
    ['geofences', 'allowed_directions TEXT'],
    ['geofences', 'description TEXT DEFAULT \'\''],
    ['geofences', 'radius_meters INTEGER DEFAULT 100'],
    ['geofences', 'strict_enforce_outside INTEGER DEFAULT 1'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`); } catch (e) { /* sudah ada */ }
  }

  try {
    db.run(`ALTER TABLE officers ADD COLUMN username TEXT`);
    console.log('Migrated: officers.username column added');
  } catch (e) {
  }
  for (const t of ['dermagas', 'routes']) {
    try { db.run(`ALTER TABLE ${t} ADD COLUMN username TEXT`); } catch (e) {}
  }
  try {
    db.run(`
      UPDATE officers
         SET username = LOWER(REPLACE(name, ' ', ''))
       WHERE username IS NULL OR username = ''
    `);
  } catch (e) {}

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
    ['trips', 'client_trip_id', 'TEXT'],
    ['vehicles', 'foto_captured_at', 'TEXT'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch (e) {}
  }
  ensureSpecRegions();
  seedSpecTables();
  rotateDefaultCredentials();
  seedDefaultGeofences();
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



function randomSecret(len = 16) {
  return require('crypto').randomBytes(len).toString('base64url').slice(0, len);
}



function seedCredential(label, value) {
  console.log(`[seed] ${label}: ${value}`);
}



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
  } catch (e) {}

  for (const w of SPEC_WILAYAH) {
    let region = q1(`SELECT * FROM regions WHERE code = ?`, [w.code]);
    if (!region) {
      const pw = randomSecret();
      seedCredential(`region ${w.code} password`, pw);
      db.run(
        `INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)`,
        [randomUUID(), w.name, w.code, bcrypt.hashSync(pw, 10)]
      );
      region = q1(`SELECT * FROM regions WHERE code = ?`, [w.code]);
    }
    if (!region) continue;

    if (!region.password) {
      const pw = randomSecret();
      seedCredential(`region ${w.code} password (backfill)`, pw);
      db.run(`UPDATE regions SET password = ? WHERE id = ?`,
        [bcrypt.hashSync(pw, 10), region.id]);
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

  // ponytail: test default, ganti sebelum launch
  for (const demo of DEMO_OFFICERS) {
    const region = q1(`SELECT id FROM regions WHERE code = ?`, [demo.region]);
    if (!region) continue;
    let officer = q1(`SELECT id FROM officers WHERE name = ?`, [demo.name]);
    if (!officer) {
      const id = randomUUID();
      const pin = '123456';
      db.run(`INSERT INTO officers (id, name, pin, region_id, is_active) VALUES (?, ?, ?, ?, 1)`,
        [id, demo.name, bcrypt.hashSync(pin, 10), region.id]);
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
    const pw = randomSecret();
    seedCredential(`region ${r.code} password (legacy backfill)`, pw);
    db.run(`UPDATE regions SET password = ? WHERE id = ?`,
      [bcrypt.hashSync(pw, 10), r.id]);
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
      password TEXT,
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
    CREATE TABLE IF NOT EXISTS geofences (
      id TEXT PRIMARY KEY,
      location_name TEXT NOT NULL,
      dermaga_id TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      radius_meters INTEGER NOT NULL DEFAULT 100,
      allowed_route_codes TEXT NOT NULL DEFAULT '',
      allowed_directions TEXT NOT NULL DEFAULT '',
      description TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Telemetri versi perangkat (POST /api/v1/report-version).
  //
  // Klien mobile melaporkan versi yang aktif setiap selesai OTA. Endpoint-nya
  // dulu TIDAK PERNAH ada di backend, jadi semua laporan berakhir 404 dan tidak
  // ada satu pun versi perangkat yang tercatat — tidak ada cara memastikan
  // perangkat benar-benar sudah memakai build terbaru.
  db.run(`
    CREATE TABLE IF NOT EXISTS device_versions (
      device_id TEXT PRIMARY KEY,
      version TEXT NOT NULL,
      platform TEXT DEFAULT 'unknown',
      report_count INTEGER DEFAULT 1,
      first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

}



function seedData() {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM regions');
  stmt.step();
  const result = stmt.getAsObject();
  stmt.free();
  if (result.count > 0) return;

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



function seedDefaultGeofences() {
  // dermaga_id WAJIB UUID asli dari tabel dermagas. Dulu di-hardcode 'BADAU-D1'/
  // 'BADAU-D2' yang TIDAK PERNAH cocok dengan dermaga_id petugas, sehingga titik
  // default tidak pernah tersinkron ke aplikasi mobile (mobile selalu kosong).
  const badau = q1(`SELECT id FROM regions WHERE code = 'BADAU'`);
  if (!badau) return;
  const d1 = q1(`SELECT id FROM dermagas WHERE region_id = ? AND code = 'D1'`, [badau.id]);
  const d2 = q1(`SELECT id FROM dermagas WHERE region_id = ? AND code = 'D2'`, [badau.id]);
  if (!d1 || !d2) {
    console.warn('[geofence] Dermaga BADAU D1/D2 belum ada — seed default dilewati');
    return;
  }

  // Perbaiki titik lama yang masih memakai kode karangan (DB produksi).
  try {
    db.run(`UPDATE geofences SET dermaga_id = ? WHERE id = 'badau-d1' AND (dermaga_id = 'BADAU-D1' OR dermaga_id IS NULL OR TRIM(dermaga_id) = '')`, [d1.id]);
    db.run(`UPDATE geofences SET dermaga_id = ? WHERE id = 'badau-d2' AND (dermaga_id = 'BADAU-D2' OR dermaga_id IS NULL OR TRIM(dermaga_id) = '')`, [d2.id]);
  } catch (e) {
    console.warn('[geofence] Gagal memperbaiki dermaga_id default:', e && e.message);
  }

  const defaults = [
    {
      id: 'badau-d1',
      location_name: 'Badau Dermaga 1',
      dermaga_id: d1.id,
      latitude: -0.8506,
      longitude: 108.8338,
      radius_meters: 100,
      allowed_route_codes: 'SJRE,SBDZ',
    },
    {
      id: 'badau-d2',
      location_name: 'Badau Dermaga 2',
      dermaga_id: d2.id,
      latitude: -0.8412,
      longitude: 108.8551,
      radius_meters: 100,
      allowed_route_codes: 'SBDZ,SJRE',
    },
  ];
  const check = db.prepare('SELECT id FROM geofences LIMIT 1');
  const hasAny = check.step();
  check.free();
  if (hasAny) return;
  const ins = db.prepare(`
    INSERT INTO geofences (id, location_name, dermaga_id, latitude, longitude, radius_meters, allowed_route_codes, enabled)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);
  for (const g of defaults) {
    ins.run([g.id, g.location_name, g.dermaga_id, g.latitude, g.longitude, g.radius_meters, g.allowed_route_codes]);
  }
  ins.free();
  console.log('[geofence] Seed default: Badau Dermaga 1 & 2 (dermaga_id = UUID asli)');
}



function rotateDefaultCredentials() {
  const rotated = [];

  const regions = qAll(`SELECT id, code, password FROM regions WHERE password IS NOT NULL AND password != ''`);
  for (const r of regions) {
    const guess = `${String(r.code).toLowerCase()}123`;
    let match = false;
    try { match = bcrypt.compareSync(guess, r.password); } catch (_) {}
    if (!match && r.password === guess) match = true;
    if (match) {
      const pw = randomSecret();
      db.run(`UPDATE regions SET password = ? WHERE id = ?`, [bcrypt.hashSync(pw, 10), r.id]);
      rotated.push(`region ${r.code} password → ${pw}`);
    }
  }

  // ponytail: pin test, putar sebelum launch
  if (rotated.length) {
    console.log('══════════════════════════════════════════════════════════════');
    console.log('[security] CREDENTIAL DEFAULT LAMA DIROTASI (catat sekarang):');
    for (const line of rotated) console.log(`[security]   ${line}`);
    console.log('══════════════════════════════════════════════════════════════');
  }
}



module.exports = {
  loadDb,
  db: dbWrapper,
};
