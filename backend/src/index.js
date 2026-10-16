const express = require('express');
const cors = require('cors');
const dbModule = require('./db');
const authRoutes = require('./routes/auth');
const tripRoutes = require('./routes/trips');
const tariffRoutes = require('./routes/tariffs');
const regionTariffRoutes = require('./routes/region-tariffs');
const plateRoutes = require('./routes/plates');
const officerRoutes = require('./routes/officers');
const regionRoutes = require('./routes/regions');
const dermagaRoutes = require('./routes/dermagas');
const routeRoutes = require('./routes/routes');
const reportRoutes = require('./routes/reports');
const geofenceRoutes = require('./routes/geofences');
const appVersionRoutes = require('./routes/appVersion');
const appDownloadRoutes = require('./routes/appDownload');
const otaBundleRoutes = require('./routes/otaBundle');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);

// Origin dev lokal (web dev-server + shell native Capacitor/Ionic) yang harus
// selalu diizinkan agar aplikasi bisa diuji dari mesin pengembang tanpa
// menyentuh konfigurasi Railway.
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'ionic://localhost',
];

const envOrigins = (process.env.CORS_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Gabungan: origin dari env (mis. domain dashboard di produksi) + origin dev.
// '*' pada env berarti "izinkan semua" (dipakai hanya bila memang diinginkan).
const allowedOrigins = [...new Set([...envOrigins, ...DEV_ORIGINS])];
const allowAnyOrigin = allowedOrigins.includes('*');

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const NATIVE_SHELL_ORIGIN = /^(capacitor|ionic):\/\/localhost$/;

const corsOptions = {
  origin(origin, callback) {
    // Request tanpa Origin (curl, health-check Railway, server-to-server): loloskan.
    if (!origin) return callback(null, true);
    if (allowAnyOrigin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Port dev-server dapat berubah → izinkan localhost/127.0.0.1 di port apa pun.
    if (LOCALHOST_ORIGIN.test(origin) || NATIVE_SHELL_ORIGIN.test(origin)) {
      return callback(null, true);
    }
    // Origin tak dikenal: jangan kirim header CORS (browser memblokir),
    // tetapi jangan melempar error agar tidak menimbulkan 500.
    return callback(null, false);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'Accept',
    'Origin',
    'X-Requested-With',
    'X-Admin-Token',
  ],
  exposedHeaders: ['Content-Length'],
  // Autentikasi memakai header Authorization (Bearer), bukan cookie.
  credentials: false,
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(cors(corsOptions));

// Tangani preflight OPTIONS untuk semua route (Express 4).
app.options('*', cors(corsOptions));



// Batas 10kb cukup untuk hampir semua API, kecuali endpoint publikasi: APK dan
// bundel modul dikirim base64 dan berukuran besar. Tanpa parser longgar khusus,
// keduanya ditolak 413 sebelum menyentuh route-nya.
const jsonDefault = express.json({ limit: '10kb' });
const jsonPublishUpload = express.json({ limit: '64mb' });
const PUBLISH_PATHS = ['/api/v1/publish-version', '/api/v1/publish-ota'];

app.use((req, res, next) => {
  const parse = req.method === 'POST' && PUBLISH_PATHS.includes(req.path) ? jsonPublishUpload : jsonDefault;
  return parse(req, res, next);
});

const { UPLOADS_DIR } = require('./uploads-dir');



app.use('/uploads', express.static(UPLOADS_DIR));

const path = require('path');
const releasesDir = path.join(__dirname, '..', 'public', 'releases');



app.use('/releases', express.static(releasesDir));



// Bundel modul (OTA) disajikan apa adanya: /ota/<versi>/<berkas>.
const { OTA_DIR } = require('./ota-dir');



app.use('/ota', express.static(OTA_DIR, { maxAge: '1h', fallthrough: true }));



app.use((req, _res, next) => {
  req.db = dbModule.db;
  next();
});



app.use('/api/auth', authRoutes);



app.use('/api/trips', tripRoutes);



app.use('/api/tariffs', tariffRoutes);



app.use('/api/region-tariffs', regionTariffRoutes);



app.use('/api/plates', plateRoutes);



app.use('/api/officers', officerRoutes);



app.use('/api/regions', regionRoutes);



app.use('/api/dermagas', dermagaRoutes);



app.use('/api/routes', routeRoutes);



app.use('/api/reports', reportRoutes);



app.use('/api/geofences', geofenceRoutes);



app.use('/api/v1', appVersionRoutes);



app.use('/api/v1', appDownloadRoutes);
app.use('/api/v1', otaBundleRoutes);



app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});



app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

async function start() {
  try {
    await dbModule.loadDb();
    console.log('Database loaded');

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server listening on 0.0.0.0:${PORT}`);
      console.log(`Health check: /api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();



module.exports = app;
