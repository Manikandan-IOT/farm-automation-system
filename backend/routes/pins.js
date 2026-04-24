// routes/pins.js — Pin configuration for devices
// After saving, sends updated config to ESP32 via MQTT

const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../database');
const { authenticate, requireRole, requireFarmAccess } = require('../middleware/auth');

// ─── GET /api/farms/:farmId/devices/:deviceId/pins ────────────────────────────
router.get('/:deviceId/pins', authenticate, requireFarmAccess, (req, res) => {
  const deviceId = parseInt(req.params.deviceId);
  const device = db.prepare(`SELECT * FROM devices WHERE id = ? AND farm_id = ?`)
    .get(deviceId, req.farmId);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  // All pins with assignment info
  const allPins = db.prepare(`
    SELECT
      cp.pin_number, cp.pin_label, cp.pin_type, cp.notes as pin_notes,
      pc.id as config_id, pc.component_id, pc.component_type, pc.pin_mode
    FROM controller_pins cp
    LEFT JOIN pin_configs pc
      ON pc.pin_number = cp.pin_number AND pc.device_id = ?
    WHERE cp.controller_type = ?
    ORDER BY cp.pin_number
  `).all(deviceId, device.controller_type);

  // Enrich with component name
  const enriched = allPins.map(p => {
    let component_name = null;
    if (p.component_type === 'motor') {
      const m = db.prepare(`SELECT name FROM motors WHERE id = ?`).get(p.component_id);
      component_name = m?.name;
    } else if (p.component_type === 'valve') {
      const v = db.prepare(`SELECT name FROM valves WHERE id = ?`).get(p.component_id);
      component_name = v?.name;
    }
    return { ...p, component_name };
  });

  res.json({ device, pins: enriched });
});

// ─── POST /api/farms/:farmId/devices/:deviceId/pins — save pin config ─────────
router.post('/:deviceId/pins', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
  const deviceId = parseInt(req.params.deviceId);
  const device = db.prepare(`SELECT * FROM devices WHERE id = ? AND farm_id = ?`)
    .get(deviceId, req.farmId);
  if (!device) return res.status(404).json({ error: 'Device not found' });

  // Expect: { pins: [ { pin_number, component_id, component_type, pin_mode }, ... ] }
  const { pins } = req.body;
  if (!Array.isArray(pins)) return res.status(400).json({ error: 'pins array required' });

  // Validate no duplicate pin numbers in payload
  const pinNums = pins.map(p => p.pin_number);
  if (new Set(pinNums).size !== pinNums.length)
    return res.status(400).json({ error: 'Duplicate pin numbers in request' });

  const savePins = db.transaction(() => {
    // Clear existing config for this device
    db.prepare(`DELETE FROM pin_configs WHERE device_id = ?`).run(deviceId);

    const insert = db.prepare(`
      INSERT INTO pin_configs (device_id, component_id, component_type, pin_number, pin_mode)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const p of pins) {
      if (!p.pin_number || !p.component_id || !p.component_type) continue;
      insert.run(deviceId, p.component_id, p.component_type, p.pin_number, p.pin_mode || 'output');
    }
  });

  savePins();

  // Build full config payload for MQTT
  const savedPins = db.prepare(`SELECT * FROM pin_configs WHERE device_id = ?`).all(deviceId);

  // Enrich each pin with component name
  const mqttPayload = savedPins.map(p => {
    let name = null;
    if (p.component_type === 'motor') {
      name = db.prepare(`SELECT name FROM motors WHERE id = ?`).get(p.component_id)?.name;
    } else if (p.component_type === 'valve') {
      name = db.prepare(`SELECT name FROM valves WHERE id = ?`).get(p.component_id)?.name;
    }
    return {
      pin: p.pin_number,
      mode: p.pin_mode,
      type: p.component_type,
      id: p.component_id,
      name
    };
  });

  // Publish to MQTT (via global mqttClient attached to app)
  // Publish pin config as simple commands
const mqttClient = req.app.get('mqttClient');
if (mqttClient && mqttClient.connected) {
    for (const p of mqttPayload) {
        const msg = `PIN:${p.pin}:${p.type}:${p.id}:${p.mode}`;
        const topic = `farm/${device.device_uid}/pin`;
        mqttClient.publish(topic, msg, { qos: 1, retain: true });
        console.log(`📌 PIN config sent: ${msg}`);
    }
}

  res.json({ message: 'Pin configuration saved and sent to device', pins: mqttPayload });
});

// ─── DELETE /api/farms/:farmId/devices/:deviceId/pins — clear all pins ────────
router.delete('/:deviceId/pins', authenticate, requireRole('admin'), requireFarmAccess, (req, res) => {
  const deviceId = parseInt(req.params.deviceId);
  db.prepare(`DELETE FROM pin_configs WHERE device_id = ?`).run(deviceId);
  res.json({ message: 'Pin configuration cleared' });
});

module.exports = router;
