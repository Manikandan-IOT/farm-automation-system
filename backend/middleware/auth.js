// middleware/auth.js — JWT verification + role-based access control

const jwt = require('jsonwebtoken');
const { db } = require('../database');

// ─── Verify JWT token ────────────────────────────────────────────────────────
function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // Attach full user from DB (so role/active status is always fresh)
    const user = db.prepare(
      `SELECT id, email, name, role, is_active FROM users WHERE id = ?`
    ).get(decoded.id);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or deactivated' });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Role check middleware factory ───────────────────────────────────────────
// Usage: requireRole('admin') or requireRole('admin','team')
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        error: `Access denied. Required role: ${roles.join(' or ')}`
      });
    }
    next();
  };
}

// ─── Farm access check ───────────────────────────────────────────────────────
// admin & team → access all farms
// customer     → only farms in farm_users table
function requireFarmAccess(req, res, next) {
  const farmId = parseInt(req.params.farmId || req.body.farm_id);
  if (!farmId) return res.status(400).json({ error: 'Farm ID required' });

  const { role, id: userId } = req.user;

  if (role === 'admin' || role === 'team') {
    // Check farm exists
    const farm = db.prepare(`SELECT id FROM farms WHERE id = ? AND is_active = 1`).get(farmId);
    if (!farm) return res.status(404).json({ error: 'Farm not found' });
    req.farmId = farmId;
    return next();
  }

  // Customer: check assignment
  const access = db.prepare(
    `SELECT 1 FROM farm_users fu
     JOIN farms f ON f.id = fu.farm_id
     WHERE fu.farm_id = ? AND fu.user_id = ? AND f.is_active = 1`
  ).get(farmId, userId);

  if (!access) {
    return res.status(403).json({ error: 'You do not have access to this farm' });
  }
  req.farmId = farmId;
  next();
}

module.exports = { authenticate, requireRole, requireFarmAccess };
