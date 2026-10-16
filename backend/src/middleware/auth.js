const jwt = require('jsonwebtoken');



if (!process.env.JWT_SECRET) {
  console.error('[auth] CRITICAL: JWT_SECRET environment variable is required');
  console.error('[auth] Server cannot start without JWT_SECRET');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;



// ponytail: saklar intranet. Dashboard admin dibuka dari LAN tanpa login, jadi
// permintaan TANPA token diperlakukan sebagai admin. Opt-in lewat env, dan hanya
// start-services.sh (lokal) yang menyalakannya — deployment Railway tidak
// menyetel variabel ini, sehingga produksi tetap menuntut token admin asli.
//
// Token yang benar-benar dikirim TETAP diverifikasi seperti biasa: alur petugas
// (officerId/regionId) tidak boleh ikut naik jadi admin hanya karena saklar ini.
const ADMIN_AUTH_DISABLED = process.env.ADMIN_AUTH_DISABLED === '1';



function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      if (!ADMIN_AUTH_DISABLED) {
        return res.status(401).json({ error: 'No token provided' });
      }
      // officerId kosong membuat endpoint khusus petugas tetap menolak (mereka
      // memeriksa officerId sendiri), sementara endpoint admin terbuka.
      const ctx = { officerId: null, regionId: null, role: 'admin', username: 'intranet' };
      req.user = ctx;
      req.officer = ctx;
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const ctx = {
      officerId: decoded.officerId,
      regionId: decoded.regionId,
      role: decoded.role || 'officer',
    };

    req.user = ctx;
    req.officer = ctx;

    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
}



function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}



module.exports = { authenticate, requireAdmin, JWT_SECRET };
