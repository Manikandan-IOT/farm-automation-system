// routes/notifications.js — Notifications + Sensor logs (from ESP32)

const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../database');
const { authenticate, requireFarmAccess } = require('../middleware/auth');

// ─── GET /api/farms/:farmId/notifications ────────────────────────────────────
router.get('/notifications', authenticate, requireFarmAccess, (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const unread_only = req.query.unread === 'true';

  let query = `
    SELECT n.*, d.name as device_name
    FROM notifications n
    LEFT JOIN devices d ON d.id = n.device_id
    WHERE n.farm_id = ?
  `;
  const params = [req.farmId];
  if (unread_only) { query += ` AND n.is_read = 0`; }
  query += ` ORDER BY n.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const notifications = db.prepare(query).all(...params);
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM notifications WHERE farm_id = ?`).get(req.farmId).cnt;
  const unread = db.prepare(`SELECT COUNT(*) as cnt FROM notifications WHERE farm_id = ? AND is_read = 0`).get(req.farmId).cnt;

  res.json({ notifications, total, unread });
});

// ─── PUT /api/farms/:farmId/notifications/read-all ───────────────────────────
router.put('/notifications/read-all', authenticate, requireFarmAccess, (req, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE farm_id = ?`).run(req.farmId);
  res.json({ message: 'All notifications marked as read' });
});

// ─── PUT /api/farms/:farmId/notifications/:id/read ───────────────────────────
router.put('/notifications/:id/read', authenticate, requireFarmAccess, (req, res) => {
  db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND farm_id = ?`)
    .run(parseInt(req.params.id), req.farmId);
  res.json({ message: 'Notification marked as read' });
});

// ─── GET /api/farms/:farmId/sensors ──────────────────────────────────────────
// Returns latest reading per sensor type, plus optional history
router.get('/sensors', authenticate, requireFarmAccess, (req, res) => {
  const { type, hours } = req.query;
  const hoursBack = parseInt(hours) || 24;

  // Latest per sensor type
  const latest = db.prepare(`
    SELECT sensor_type, value, unit, created_at, device_id
    FROM sensor_logs
    WHERE farm_id = ?
      AND created_at >= datetime('now', '-' || ? || ' hours')
    GROUP BY sensor_type
    ORDER BY sensor_type, created_at DESC
  `).all(req.farmId, hoursBack);

  // History (for charts)
  let history = [];
  if (type) {
    history = db.prepare(`
      SELECT sensor_type, value, unit, created_at,
             d.name as device_name
      FROM sensor_logs sl
      LEFT JOIN devices d ON d.id = sl.device_id
      WHERE sl.farm_id = ? AND sl.sensor_type = ?
        AND sl.created_at >= datetime('now', '-' || ? || ' hours')
      ORDER BY sl.created_at ASC
      LIMIT 500
    `).all(req.farmId, type, hoursBack);
  }

  res.json({ latest, history });
});

module.exports = router;
