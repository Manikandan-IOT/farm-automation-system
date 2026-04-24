// routes/farms.js — Farm CRUD + user assignment

const express = require('express');
const router = express.Router();
const { db } = require('../database');
const { authenticate, requireRole, requireFarmAccess } = require('../middleware/auth');

// ─── GET /api/farms — list farms accessible to current user ──────────────────
router.get('/', authenticate, (req, res) => {
  const { role, id: userId } = req.user;
  let farms;

  if (role === 'admin' || role === 'team') {
    farms = db.prepare(`
      SELECT f.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM devices WHERE farm_id = f.id) as device_count
      FROM farms f
      LEFT JOIN users u ON u.id = f.created_by
      WHERE f.is_active = 1
      ORDER BY f.created_at DESC
    `).all();
  } else {
    // customer — only assigned farms
    farms = db.prepare(`
      SELECT f.*, u.name as created_by_name,
        (SELECT COUNT(*) FROM devices WHERE farm_id = f.id) as device_count
      FROM farms f
      JOIN farm_users fu ON fu.farm_id = f.id AND fu.user_id = ?
      LEFT JOIN users u ON u.id = f.created_by
      WHERE f.is_active = 1
      ORDER BY f.created_at DESC
    `).all(userId);
  }
  res.json({ farms });
});

// ─── GET /api/farms/:farmId ───────────────────────────────────────────────────
router.get('/:farmId', authenticate, requireFarmAccess, (req, res) => {
  const farm = db.prepare(`
    SELECT f.*, u.name as created_by_name
    FROM farms f
    LEFT JOIN users u ON u.id = f.created_by
    WHERE f.id = ?
  `).get(req.farmId);

  const devices = db.prepare(
    `SELECT * FROM devices WHERE farm_id = ? ORDER BY name`
  ).all(req.farmId);

  const assignedUsers = db.prepare(`
    SELECT u.id, u.name, u.email, u.role
    FROM users u
    JOIN farm_users fu ON fu.user_id = u.id
    WHERE fu.farm_id = ?
  `).all(req.farmId);

  res.json({ farm, devices, assigned_users: assignedUsers });
});

// ─── POST /api/farms — create farm (admin only) ───────────────────────────────
router.post('/', authenticate, requireRole('admin'), (req, res) => {
  const { name, location, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Farm name required' });

  const result = db.prepare(`
    INSERT INTO farms (name, location, description, created_by)
    VALUES (?, ?, ?, ?)
  `).run(name.trim(), location || null, description || null, req.user.id);

  res.status(201).json({
    message: 'Farm created',
    farm: { id: result.lastInsertRowid, name, location, description }
  });
});

// ─── PUT /api/farms/:farmId — update farm (admin only) ───────────────────────
router.put('/:farmId', authenticate, requireRole('admin'), requireFarmAccess, (req, res) => {
  const { name, location, description } = req.body;
  const updates = [];
  const params = [];

  if (name)        { updates.push(`name = ?`);        params.push(name.trim()); }
  if (location)    { updates.push(`location = ?`);    params.push(location); }
  if (description) { updates.push(`description = ?`); params.push(description); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  updates.push(`updated_at = datetime('now')`);
  params.push(req.farmId);

  db.prepare(`UPDATE farms SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ message: 'Farm updated' });
});

// ─── DELETE /api/farms/:farmId (admin only) ───────────────────────────────────
router.delete('/:farmId', authenticate, requireRole('admin'), requireFarmAccess, (req, res) => {
  db.prepare(`UPDATE farms SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(req.farmId);
  res.json({ message: 'Farm deactivated' });
});

// ─── POST /api/farms/:farmId/assign — assign customer to farm ────────────────
router.post('/:farmId/assign', authenticate, requireRole('admin'), requireFarmAccess, (req, res) => {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const user = db.prepare(`SELECT id, role FROM users WHERE id = ? AND is_active = 1`).get(user_id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    db.prepare(`INSERT OR IGNORE INTO farm_users (farm_id, user_id) VALUES (?, ?)`).run(req.farmId, user_id);
    res.json({ message: 'User assigned to farm' });
  } catch (e) {
    res.status(400).json({ error: 'Assignment failed' });
  }
});

// ─── DELETE /api/farms/:farmId/assign/:userId — remove user from farm ────────
router.delete('/:farmId/assign/:userId', authenticate, requireRole('admin'), requireFarmAccess, (req, res) => {
  db.prepare(`DELETE FROM farm_users WHERE farm_id = ? AND user_id = ?`)
    .run(req.farmId, parseInt(req.params.userId));
  res.json({ message: 'User removed from farm' });
});

module.exports = router;
