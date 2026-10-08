const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/trip.db');

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

  // Kolom login petugas. DB lama (dibuat sebelum revisi login per-username)
  // tidak punya kolom ini → query /auth/member-login gagal dengan
  // "no such column: username". Ditambahkan otomatis lalu di-backfill dari
  // nama petugas (huruf kecil, tanpa spasi) agar login langsung bisa dipakai.
  try {
    db.run(`ALTER TABLE officers ADD COLUMN username TEXT`);
    console.log('Migrated: officers.username column added');
  } catch (e) {
    // kolom sudah ada — lanjut backfill baris yang masih kosong
  }
  // Kolom username di master dermaga & rute (nullable) — agar skema DB lama
  // selaras dengan initialize() tanpa memecahkan INSERT yang tidak mengisinya.
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

  relaxTripsDermagaNotNull();
  for (const [table, column, definition] of [
    ['trips', 'foto_captured_at', 'TEXT'],
    ['trips', 'foto_latitude', 'REAL'],
    ['trips', 'foto_longitude', 'REAL'],
    ['trips', 'started_at', 'TEXT'],
    ['trips', 'completed_at', 'TEXT'],
    ['vehicles', 'foto_captured_at', 'TEXT'],
    // ID trip di sisi klien — dipakai sinkronisasi offline-first untuk
    // MENCEGAH DUPLIKAT saat antrean dikirim ulang setelah timeout/jaringan
    // putus di tengah jalan (klien tidak tahu apakah server sudah menerima).
    ['trips', 'client_trip_id', 'TEXT'],
  ]) {
    try { db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`); } catch (e) { /* already exists */ }
  }
  try {
    db.run(`CREATE INDEX IF NOT EXISTS idx_trips_client_trip_id ON trips(client_trip_id)`);
  } catch (e) { /* index sudah ada */ }
  // Urutan penting: wilayah spec dibuat dulu, baru seedSpecTables memberi
  // tarif region (lokal/eksternal) untuk region yang baru saja ditambahkan.
  ensureSpecRegions();
  seedSpecTables();
  saveDb();
}

// trips.dermaga_id dibuat NOT NULL oleh revisi akses, tetapi klien mobile tidak
// pernah mengirim dermaga — akibatnya setiap POST /trips gagal 500
// ("NOT NULL constraint failed: trips.dermaga_id") dan tidak ada trip yang
// tersinkron. SQLite tidak mendukung ALTER COLUMN, jadi tabel dibangun ulang
// dengan kolom nullable. FK tidak di-enforce (PRAGMA foreign_keys = 0) dan
// dermaga_id tidak dipakai di query laporan mana pun, jadi aman.
function relaxTripsDermagaNotNull() {
  try {
    const col = dbWrapper.prepare(`PRAGMA table_info(trips)`).all()
      .find((c) => c.name === 'dermaga_id');
    if (!col || col.notnull !== 1) return; // sudah nullable / belum ada

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
    // Migrasi gagal tidak boleh menggagalkan boot — INSERT trips punya fallback.
    console.warn('Skip trips.dermaga_id migration:', e.message);
  }
}

// ── Revisi #3 & #4: Master Rute Wilayah Operasional + login region ───────────────
// 3 wilayah × 2 dermaga × 2 rute (dua arah), petugas contoh per wilayah,
// dan password wilayah default "<kode>123" (mis. BADAU → badau123).
// Idempotent: jalan tiap boot dan melengkapi DB lama tanpa menimpa data sedia.
const SPEC_WILAYAH = [
  {
    code: 'ENTIKONG', name: 'Entikong',
    // Wilayah Entikong sudah punya petugas (Rizky Maulana) — tanpa seed petugas.
    officers: [],
    routes: [
      // Dermaga 1
      { d: 'D1', from: 'A4A4', to: 'B8B8', name: 'A4A4 → B8B8', distance: null, duration: null },
      { d: 'D1', from: 'B8B8', to: 'A4A4', name: 'B8B8 → A4A4', distance: null, duration: null },
      // Dermaga 2
      { d: 'D2', from: 'C3C3', to: 'D6D6', name: 'C3C3 → D6D6', distance: null, duration: null },
      { d: 'D2', from: 'D6D6', to: 'C3C3', name: 'D6D6 → C3C3', distance: null, duration: null },
    ],
  },
  {
    code: 'BADAU', name: 'Badau',
    officers: [],
    routes: [
      // Dermaga 1 — rute utama (dipertahankan dari data lama)
      { d: 'D1', from: 'SJRE', to: 'SBDZ', name: 'Sijangkung → Sabadi', distance: '42 km', duration: '1j 10m' },
      { d: 'D1', from: 'SBDZ', to: 'SJRE', name: 'Sabadi → Sijangkung', distance: '42 km', duration: '1j 10m' },
      // Dermaga 2
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

// Helper query — modul ini memakai objek sql.js mentah (bukan dbWrapper),
// jadi SELECT memakai API statement: bind/step/getAsObject/free.
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

// Penuhi spesifikasi wilayah operasional (idempotent, aman untuk DB lama).
function ensureSpecRegions() {
  // 1. Kolom password region (idempotent)
  try {
    db.run(`ALTER TABLE regions ADD COLUMN password TEXT`);
  } catch (e) { /* kolom sudah ada */ }

  const hashedPin = bcrypt.hashSync('123456', 10);

  for (const w of SPEC_WILAYAH) {
    // 2. Region
    let region = q1(`SELECT * FROM regions WHERE code = ?`, [w.code]);
    if (!region) {
      db.run(
        `INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)`,
        [uuidv4(), w.name, w.code, bcrypt.hashSync(regionDefaultPassword(w.code), 10)]
      );
      region = q1(`SELECT * FROM regions WHERE code = ?`, [w.code]);
    }
    if (!region) continue;

    // 3. Password default bila belum diatur admin
    if (!region.password) {
      db.run(`UPDATE regions SET password = ? WHERE id = ?`,
        [bcrypt.hashSync(regionDefaultPassword(w.code), 10), region.id]);
    }

    // 4. Dua dermaga: D1 & D2
    for (const [dc, dname] of [['D1', 'Dermaga 1'], ['D2', 'Dermaga 2']]) {
      let dm = q1(`SELECT * FROM dermagas WHERE region_id = ? AND code = ?`, [region.id, dc]);
      if (!dm) {
        db.run(`INSERT INTO dermagas (id, region_id, name, code) VALUES (?, ?, ?, ?)`,
          [uuidv4(), region.id, dname, dc]);
        dm = q1(`SELECT * FROM dermagas WHERE region_id = ? AND code = ?`, [region.id, dc]);
      }
      if (!dm) continue;

      const specRoutes = w.routes.filter(r => r.d === dc);

      // Samakan isi dermaga dengan Master Rute (spesifikasi #3): rute yang
      // tidak ada di spesifikasi (mis. sisa placeholder A→B, C→D dari seed
      // lama) dihapus — kecuali masih direferensikan trip, supaya laporan
      // lama tidak kehilangan route_id.
      {
        const olds = qAll(`SELECT id, route_from, route_to FROM routes WHERE dermaga_id = ?`, [dm.id]);
        const wanted = specRoutes.map(r => `${r.from}|${r.to}`);
        for (const old of olds) {
          if (wanted.includes(`${old.route_from}|${old.route_to}`)) continue;
          const used = q1(`SELECT 1 as x FROM trips WHERE route_id = ?`, [old.id]);
          if (used) continue; // masih dipakai trip lama — biarkan
          db.run(`DELETE FROM routes WHERE id = ?`, [old.id]);
        }
      }

      // 5. Rute dua arah sesuai spesifikasi
      for (const r of specRoutes) {
        const exists = q1(
          `SELECT 1 as x FROM routes WHERE dermaga_id = ? AND route_from = ? AND route_to = ?`,
          [dm.id, r.from, r.to]
        );
        if (!exists) {
          db.run(
            `INSERT INTO routes (id, dermaga_id, name, route_from, route_to, distance, duration) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), dm.id, r.name, r.from, r.to, r.distance, r.duration]
          );
        }
      }
    }

    // 6. Backfill legacy officers without dock access to D1.
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

  // 7. Keep the published demo accounts aligned with their documented region
  // and dock access, including existing databases created with older seeds.
  for (const demo of DEMO_OFFICERS) {
    const region = q1(`SELECT id FROM regions WHERE code = ?`, [demo.region]);
    if (!region) continue;
    let officer = q1(`SELECT id FROM officers WHERE name = ?`, [demo.name]);
    if (!officer) {
      const id = uuidv4();
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

  // 8. Region lain (DB lama: SJRE/SBDZ/ENTIKONG) juga mendapat password default
  const noPw = qAll(`SELECT id, code FROM regions WHERE password IS NULL OR password = ''`);
  for (const r of noPw) {
    db.run(`UPDATE regions SET password = ? WHERE id = ?`,
      [bcrypt.hashSync(regionDefaultPassword(r.code), 10), r.id]);
  }
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
      username TEXT,
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
      username TEXT,
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
      username TEXT,
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
      foto_captured_at TEXT,
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

  // Seed 3 wilayah operasional (Revisi #3). Dermaga, rute dua arah, petugas
  // contoh, dan password wilayah dibuat oleh ensureSpecRegions() — satu sumber
  // kebenaran yang juga melengkapi DB lama saat boot.
  const insertRegion = db.prepare('INSERT INTO regions (id, name, code, password) VALUES (?, ?, ?, ?)');
  for (const w of SPEC_WILAYAH) {
    insertRegion.bind([uuidv4(), w.name, w.code, bcrypt.hashSync(regionDefaultPassword(w.code), 10)]);
    insertRegion.step();
    insertRegion.reset();
  }
  insertRegion.free();

  ensureSpecRegions();

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

  console.log('Database seeded: 3 wilayah, dermaga, rute, petugas, dan tarif');
}

// Export async initialization
module.exports = {
  loadDb,
  db: dbWrapper,
  initialize,
  seedData
};
