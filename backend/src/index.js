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

app.set('trust proxy', 1);

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const corsOptions = process.env.NODE_ENV === 'production' && allowedOrigins.length
  ? { origin: allowedOrigins }
  : {};



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
