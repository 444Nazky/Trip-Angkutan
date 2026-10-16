const fs = require('fs');
const path = require('path');



const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');

fs.mkdirSync(UPLOADS_DIR, { recursive: true });



module.exports = { UPLOADS_DIR };
