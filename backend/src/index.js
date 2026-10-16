const express = require('express');
const cors = require('cors');
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
const { UPLOADS_DIR } = require('./uploads-dir');
const { db } = require('./db');



const app = express();
const PORT = Number(process.env.PORT) || 3000;



app.use(cors());



app.use(express.json());



app.use('/uploads', express.static(UPLOADS_DIR));



app.use((req, _res, next) => {
  req.db = db;
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on 0.0.0.0:${PORT}`);
  console.log(`Health check: /api/health`);
});
