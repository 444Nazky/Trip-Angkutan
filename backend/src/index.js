/**
 * Backend Entry Point - Supabase Version
 *
 * Migrated from sql.js to @supabase/supabase-js
 * Railway configurations removed
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('./lib/supabase');

// Import routes
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
const masterRoutes = require('./routes/master');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Trust proxy for proper IP detection behind load balancers
app.set('trust proxy', 1);

// ============================================
// CORS CONFIGURATION
// ============================================

// Default allowed origins
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

const allowedOrigins = [...new Set([...envOrigins, ...DEV_ORIGINS])];
const allowAnyOrigin = allowedOrigins.includes('*');

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // curl, server-to-server
    if (allowAnyOrigin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);

    // Allow localhost and private LAN IPs
    const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
    const NATIVE_SHELL_ORIGIN = /^(capacitor|ionic):\/\/localhost$/;
    const PRIVATE_LAN_ORIGIN = /^https?:\/\/(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(:\d+)?$/;

    if (
      LOCALHOST_ORIGIN.test(origin) ||
      PRIVATE_LAN_ORIGIN.test(origin) ||
      NATIVE_SHELL_ORIGIN.test(origin)
    ) {
      return callback(null, true);
    }

    return callback(null, false);
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 'Authorization', 'Accept', 'Origin',
    'X-Requested-With', 'X-Admin-Token',
  ],
  exposedHeaders: ['Content-Length'],
  credentials: false,
  optionsSuccessStatus: 204,
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ============================================
// BODY PARSERS
// ============================================

const jsonDefault = express.json({ limit: '10kb' });
const jsonPublishUpload = express.json({ limit: '64mb' });
const PUBLISH_PATHS = ['/api/v1/publish-version', '/api/v1/publish-ota'];

app.use((req, res, next) => {
  const parse = req.method === 'POST' && PUBLISH_PATHS.includes(req.path)
    ? jsonPublishUpload
    : jsonDefault;
  return parse(req, res, next);
});

// ============================================
// STATIC FILES
// ============================================

const { UPLOADS_DIR } = require('./uploads-dir');
app.use('/uploads', express.static(UPLOADS_DIR));

const releasesDir = path.join(__dirname, '..', 'public', 'releases');
app.use('/releases', express.static(releasesDir));

const { OTA_DIR } = require('./ota-dir');
app.use('/ota', express.static(OTA_DIR, { maxAge: '1h', fallthrough: true }));

// ============================================
// ATTACH SUPABASE CLIENT TO REQUEST
// ============================================

app.use((req, _res, next) => {
  req.db = supabase.db;
  req.supabase = supabase.supabase;
  req.helpers = supabase.helpers;
  next();
});

// ============================================
// API ROUTES
// ============================================

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
app.use('/api/master', masterRoutes);

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', async (req, res) => {
  try {
    // Test Supabase connection
    const { error } = await supabase.supabase.from('regions').select('id').limit(1);
    const dbStatus = error ? 'error' : 'ok';

    res.json({
      status: 'ok',
      database: dbStatus,
      timestamp: new Date().toISOString(),
      version: '2.0.0-supabase',
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      database: 'unavailable',
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ============================================
// START SERVER
// ============================================

async function start() {
  try {
    // Test Supabase connection
    console.log('[supabase] Connecting to:', process.env.SUPABASE_URL);
    const { error } = await supabase.supabase.from('regions').select('id').limit(1);

    if (error) {
      console.warn('[supabase] Connection warning:', error.message);
      console.warn('[supabase] Server will start, but database operations may fail');
    } else {
      console.log('[supabase] Connected successfully');
    }

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server listening on 0.0.0.0:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

start();

module.exports = app;
