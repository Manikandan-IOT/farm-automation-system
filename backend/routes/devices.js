// routes/devices.js — ESP32 / device management per farm

const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../database');
const { authenticate, requireRole, requireFarmAccess } = require('../middleware/auth');

// ─── GET /api/farms/:farmId/devices ──────────────────────────────────────────
router.get('/', authenticate, requireFarmAccess, (req, res) => {
  const devices = db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM pin_configs WHERE device_id = d.id) as pin_count
    FROM devices d
    WHERE d.farm_id = ?
    ORDER BY d.name
  `).all(req.farmId);
  res.json({ devices });
});

// ─── GET /api/farms/:farmId/devices/:deviceId ─────────────────────────────────
router.get('/:deviceId', authenticate, requireFarmAccess, (req, res) => {
  const device = db.prepare(`SELECT * FROM devices WHERE id = ? AND farm_id = ?`)
    .get(parseInt(req.params.deviceId), req.farmId);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const pins = db.prepare(`
    SELECT pc.*, cp.pin_label, cp.pin_type, cp.notes as pin_notes
    FROM pin_configs pc
    LEFT JOIN controller_pins cp
      ON cp.controller_type = ? AND cp.pin_number = pc.pin_number
    WHERE pc.device_id = ?
    ORDER BY pc.pin_number
  `).all(device.controller_type, device.id);

  res.json({ device, pins });
});

// ─── POST /api/farms/:farmId/devices — add device (admin/team) ───────────────
router.post('/', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
  const { name, device_uid, controller_type, firmware_ver } = req.body;
  if (!name || !device_uid)
    return res.status(400).json({ error: 'name and device_uid required' });

  const type = controller_type || 'esp32';

  // Check device_uid not already used
  const existing = db.prepare(`SELECT id FROM devices WHERE device_uid = ?`).get(device_uid.trim());
  if (existing) return res.status(409).json({ error: 'Device UID already registered' });

  const result = db.prepare(`
    INSERT INTO devices (farm_id, name, device_uid, controller_type, firmware_ver)
    VALUES (?, ?, ?, ?, ?)
  `).run(req.farmId, name.trim(), device_uid.trim(), type, firmware_ver || null);

  res.status(201).json({
    message: 'Device added',
    device: { id: result.lastInsertRowid, name, device_uid, controller_type: type }
  });
});

// ─── PUT /api/farms/:farmId/devices/:deviceId ────────────────────────────────
router.put('/:deviceId', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
  const deviceId = parseInt(req.params.deviceId);
  const device = db.prepare(`SELECT id FROM devices WHERE id = ? AND farm_id = ?`)
    .get(deviceId, req.farmId);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const { name, controller_type, firmware_ver } = req.body;
  const updates = [];
  const params = [];

  if (name)            { updates.push(`name = ?`);            params.push(name.trim()); }
  if (controller_type) { updates.push(`controller_type = ?`); params.push(controller_type); }
  if (firmware_ver)    { updates.push(`firmware_ver = ?`);    params.push(firmware_ver); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(deviceId);

  db.prepare(`UPDATE devices SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ message: 'Device updated' });
});

// ─── DELETE /api/farms/:farmId/devices/:deviceId ─────────────────────────────
router.delete('/:deviceId', authenticate, requireRole('admin'), requireFarmAccess, (req, res) => {
  const deviceId = parseInt(req.params.deviceId);
  db.prepare(`DELETE FROM devices WHERE id = ? AND farm_id = ?`).run(deviceId, req.farmId);
  res.json({ message: 'Device removed' });
});

// ─── GET /api/farms/:farmId/devices/:deviceId/available-pins ─────────────────
// Returns pins available for the device's controller type, marking used ones
router.get('/:deviceId/available-pins', authenticate, requireFarmAccess, (req, res) => {
  const deviceId = parseInt(req.params.deviceId);
  const device = db.prepare(`SELECT * FROM devices WHERE id = ? AND farm_id = ?`)
    .get(deviceId, req.farmId);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  const allPins = db.prepare(`
    SELECT cp.*,
      pc.id       as config_id,
      pc.component_id,
      pc.component_type,
      pc.pin_mode
    FROM controller_pins cp
    LEFT JOIN pin_configs pc ON pc.pin_number = cp.pin_number AND pc.device_id = ?
    WHERE cp.controller_type = ?
    ORDER BY cp.pin_number
  `).all(deviceId, device.controller_type);

  res.json({ controller_type: device.controller_type, pins: allPins });
});

module.exports = router;
