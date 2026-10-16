const path = require('path');



// Lokasi bundel modul web (OTA). Bisa dipindah lewat env saat deploy.
const OTA_DIR = process.env.OTA_DIR || path.join(__dirname, '..', 'public', 'ota');



module.exports = { OTA_DIR };
