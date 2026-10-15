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




const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.set('trust proxy', 1);// Origin dev lokal (web dev-server + shell native Capacitor/Ionic). Tanpa ini,
// NODE_ENV=production + CORS_ORIGIN (mis. hanya domain dashboard) membuat
// dev-server di localhost:5173 tidak menerima Access-Control-Allow-Origin →
// semua request diblokir browser dan muncul "Server tidak merespon".
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

// Gabungan: origin dari env (domain dashboard produksi) + origin dev.
// '*' pada env berarti "izinkan semua".
const allowedOrigins = [...new Set([...envOrigins, ...DEV_ORIGINS])];
const allowAnyOrigin = allowedOrigins.includes('*');

const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const NATIVE_SHELL_ORIGIN = /^(capacitor|ionic):\/\/localhost$/;

const corsOptions = {
  origin(origin, callback) {
    // Tanpa Origin (curl, health-check Railway, server-to-server): loloskan.
    if (!origin) return callback(null, true);
    if (allowAnyOrigin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Port dev-server bisa berubah → izinkan localhost/127.0.0.1 port apa pun.
    if (LOCALHOST_ORIGIN.test(origin) || NATIVE_SHELL_ORIGIN.test(origin)) {
      return callback(null, true);
    }
    // Origin tak dikenal: jangan kirim header CORS (browser memblokir),
    // tetapi jangan melempar error agar tidak menimbulkan 500.
    return callback(null, false);
  },
};
app.use(cors(corsOptions));




app.use(express.json({ limit: '10kb' }));

const { UPLOADS_DIR } = require('./uploads-dir');




app.use('/uploads', express.static(UPLOADS_DIR));

const path = require('path');
const releasesDir = path.join(__dirname, '..', 'public', 'releases');




app.use('/releases', express.static(releasesDir));




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
