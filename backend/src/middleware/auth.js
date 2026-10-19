/**
 * Auth Middleware - Supabase Compatible
 */

const jwt = require('jsonwebtoken');

if (!process.env.JWT_SECRET) {
  console.error('[auth] CRITICAL: JWT_SECRET environment variable is required');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET;

// Enable admin access without token (for LAN/intranet only)
const ADMIN_AUTH_DISABLED = process.env.ADMIN_AUTH_DISABLED === '1';

function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      if (!ADMIN_AUTH_DISABLED) {
        return res.status(401).json({ error: 'No token provided' });
      }
      // Intranet mode: open admin access
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
