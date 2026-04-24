// routes/motors.js — Motors + Valves per farm
// CHANGED: Valve creation no longer needs motor_id
// Motor is now selected in the irrigation schedule

const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../database');
const { authenticate, requireRole, requireFarmAccess } = require('../middleware/auth');

// ══════════════════════════════════════════════════════════
// MOTORS
// ══════════════════════════════════════════════════════════

router.get('/', authenticate, requireFarmAccess, (req, res) => {
    const motors = db.prepare(`
        SELECT m.*,
        (SELECT COUNT(*) FROM valves WHERE farm_id = m.farm_id) as valve_count
        FROM motors m WHERE m.farm_id = ? ORDER BY m.name
    `).all(req.farmId);
    res.json({ motors });
});

router.post('/', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
    const { name, type, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Motor name required' });
    const result = db.prepare(
        `INSERT INTO motors (farm_id, name, type, notes) VALUES (?, ?, ?, ?)`
    ).run(req.farmId, name.trim(), type || 'pump', notes || null);
    res.status(201).json({ message: 'Motor added', motor: { id: result.lastInsertRowid, name, type: type || 'pump' } });
});

router.put('/:motorId', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
    const motorId = parseInt(req.params.motorId);
    const { name, type, notes } = req.body;
    const updates = []; const params = [];
    if (name)  { updates.push(`name = ?`);  params.push(name.trim()); }
    if (type)  { updates.push(`type = ?`);  params.push(type); }
    if (notes !== undefined) { updates.push(`notes = ?`); params.push(notes); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(motorId);
    db.prepare(`UPDATE motors SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: 'Motor updated' });
});

router.delete('/:motorId', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
    db.prepare(`DELETE FROM motors WHERE id = ? AND farm_id = ?`).run(parseInt(req.params.motorId), req.farmId);
    res.json({ message: 'Motor deleted' });
});

// ══════════════════════════════════════════════════════════
// VALVES — no motor_id needed anymore
// ══════════════════════════════════════════════════════════

router.get('/valves/all', authenticate, requireFarmAccess, (req, res) => {
    // CHANGED: removed motor join since valve has no motor now
    const valves = db.prepare(`
        SELECT v.* FROM valves v
        WHERE v.farm_id = ? ORDER BY v.name
    `).all(req.farmId);
    res.json({ valves });
});

router.post('/valves', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
    // CHANGED: motor_id removed from valve creation
    const { name, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'Valve name required' });
    const result = db.prepare(
        `INSERT INTO valves (farm_id, name, notes) VALUES (?, ?, ?)`
    ).run(req.farmId, name.trim(), notes || null);
    res.status(201).json({ message: 'Valve added', valve: { id: result.lastInsertRowid, name } });
});

router.put('/valves/:valveId', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
    const valveId = parseInt(req.params.valveId);
    const { name, notes } = req.body;
    const updates = []; const params = [];
    if (name)  { updates.push(`name = ?`);  params.push(name.trim()); }
    if (notes !== undefined) { updates.push(`notes = ?`); params.push(notes); }
    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    params.push(valveId);
    db.prepare(`UPDATE valves SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    res.json({ message: 'Valve updated' });
});

router.delete('/valves/:valveId', authenticate, requireRole('admin', 'team'), requireFarmAccess, (req, res) => {
    db.prepare(`DELETE FROM valves WHERE id = ? AND farm_id = ?`).run(parseInt(req.params.valveId), req.farmId);
    res.json({ message: 'Valve deleted' });
});

// ══════════════════════════════════════════════════════════
// MANUAL CONTROL — send ON/OFF commands to ESP32
// ══════════════════════════════════════════════════════════

// POST /api/farms/:farmId/motors/manual
// body: { device_uid, component_type, component_id, state }
router.post('/manual', authenticate, requireFarmAccess, (req, res) => {
    const { device_uid, component_type, component_id, state } = req.body;
    if (!device_uid || !component_type || !component_id || state === undefined) {
        return res.status(400).json({ error: 'device_uid, component_type, component_id, state required' });
    }

    // Verify device belongs to this farm
    const device = db.prepare(
        `SELECT * FROM devices WHERE device_uid = ? AND farm_id = ?`
    ).get(device_uid, req.farmId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const mqttClient = req.app.get('mqttClient');
    if (!mqttClient || !mqttClient.connected) {
        return res.status(503).json({ error: 'MQTT broker not connected' });
    }

    // Build command: VALVE:ON:1 or MOTOR:OFF:2
    const cmd  = component_type.toUpperCase();
    const st   = state ? 'ON' : 'OFF';
    const msg  = `${cmd}:${st}:${component_id}`;
    const topic = `farm/${device_uid}/cmd`;

    mqttClient.publish(topic, msg, { qos: 1 });
    console.log(`🎛️  Manual: ${msg} → ${device_uid}`);

    res.json({ message: `Command sent: ${msg}`, command: msg });
});

// GET /api/farms/:farmId/motors/status/:device_uid
// Request ESP32 to send back all current states
router.get('/status/:device_uid', authenticate, requireFarmAccess, (req, res) => {
    const device_uid = req.params.device_uid;
    const device = db.prepare(
        `SELECT * FROM devices WHERE device_uid = ? AND farm_id = ?`
    ).get(device_uid, req.farmId);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    const mqttClient = req.app.get('mqttClient');
    if (!mqttClient || !mqttClient.connected) {
        return res.status(503).json({ error: 'MQTT not connected' });
    }

    // Ask ESP32 to report all current states
    mqttClient.publish(`farm/${device_uid}/cmd`, 'GET_STATUS', { qos: 1 });
    res.json({ message: 'Status request sent' });
});

module.exports = router;
