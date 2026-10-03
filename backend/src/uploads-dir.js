const fs = require('fs');
const path = require('path');

/**
 * Satu-satunya lokasi penyimpanan foto dokumentasi trip.
 *
 * Penting: semua modul (static server di index.js + multer di routes/trips.js
 * dan routes/upload.js) HARUS memakai konstanta ini. Sebelumnya tiap file
 * menghitung path sendiri sehingga multer menulis ke `backend/src/uploads`
 * sedangkan server menyajikan `backend/uploads` → semua foto 404 di dashboard.
 */
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

module.exports = { UPLOADS_DIR };
