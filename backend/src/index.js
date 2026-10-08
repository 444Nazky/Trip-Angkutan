const express = require('express');
const cors = require('cors');
const dbModule = require('./db');
const authRoutes = require('./routes/auth');
const tripRoutes = require('./routes/trips');
const vehicleRoutes = require('./routes/vehicles');
const tariffRoutes = require('./routes/tariffs');
const regionTariffRoutes = require('./routes/region-tariffs');
const plateRoutes = require('./routes/plates');
const officerRoutes = require('./routes/officers');
const regionRoutes = require('./routes/regions');
const dermagaRoutes = require('./routes/dermagas');
const routeRoutes = require('./routes/routes');
const reportRoutes = require('./routes/reports');
const uploadRoutes = require('./routes/upload');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve uploaded photos publicly (folder yang sama dengan tujuan multer)
const { UPLOADS_DIR } = require('./uploads-dir');
app.use('/uploads', express.static(UPLOADS_DIR));

// Attach db to all requests
app.use((req, _res, next) => {
  req.db = dbModule.db;
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/tariffs', tariffRoutes);
app.use('/api/region-tariffs', regionTariffRoutes);
app.use('/api/plates', plateRoutes);
app.use('/api/officers', officerRoutes);
app.use('/api/regions', regionRoutes);
app.use('/api/dermagas', dermagaRoutes);
app.use('/api/routes', routeRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/upload', uploadRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// OTA Version endpoint - serves current app version for mobile update checks
app.get('/api/version', (req, res) => {
  const version = process.env.APP_VERSION || '1.0.0';
  const buildNumber = process.env.BUILD_NUMBER || Date.now().toString();
  const commitHash = process.env.COMMIT_HASH || 'unknown';

  res.json({
    version: version,
    buildNumber: buildNumber,
    commitHash: commitHash,
    releaseDate: new Date().toISOString(),
    releaseNotes: process.env.RELEASE_NOTES || 'Latest build',
    downloadUrl: `${req.protocol}://${req.get('host')}`,
  });
});

// Error handling
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Initialize database and start server
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
