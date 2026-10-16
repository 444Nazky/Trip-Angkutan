const jwt = require('jsonwebtoken');

const JWT_SECRET = (() => {
  const s = process.env.JWT_SECRET;
  if (!s) {
    console.error('[auth] JWT_SECRET environment variable is required — server cannot start without it');
    process.exit(1);
  }
  return s;
})();



function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No token provided' });
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
