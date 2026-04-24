// routes/schedules.js — Irrigation + Fertigation schedules
// CHANGED: irrigation schedule now includes motor_id
// New IRR command format: IRR:id:valve:motor:time:dur:days

const express = require('express');
const router = express.Router({ mergeParams: true });
const { db } = require('../database');
const { authenticate, requireFarmAccess } = require('../middleware/auth');

// ─── Build and publish schedule commands ──────────────────
function publishSchedulesToFarm(app, farmId, scheduleType) {
    const mqttClient = app.get('mqttClient');
    if (!mqttClient || !mqttClient.connected) return;

    const devices = db.prepare(
        `SELECT device_uid FROM devices WHERE farm_id = ?`
    ).all(farmId);

    const allDays = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    if (scheduleType === 'irrigation') {
        const schedules = db.prepare(`
            SELECT * FROM irrigation_schedules
            WHERE farm_id = ? AND status = 'active'
        `).all(farmId);

        for (const device of devices) {
            for (const s of schedules) {
                const days = JSON.parse(s.days);
                const daysStr = allDays.map(d => days.includes(d) ? '1' : '0').join('');
                const time    = s.start_time.replace(':', '');
                const dur     = String(s.duration_min).padStart(3, '0');
                // NEW FORMAT: IRR:id:valve_id:motor_id:time:dur:days
                const motor_id = s.motor_id || 0;
                const msg = `IRR:${s.id}:${s.valve_id}:${motor_id}:${time}:${dur}:${daysStr}`;
                mqttClient.publish(`farm/${device.device_uid}/cmd`, msg, { qos: 1 });
                console.log(`💧 IRR sent: ${msg}`);
            }
        }
    } else {
        const schedules = db.prepare(`
            SELECT * FROM fertigation_schedules
            WHERE farm_id = ? AND status = 'active'
        `).all(farmId);

        for (const device of devices) {
            for (const s of schedules) {
                const days = JSON.parse(s.days);
                const daysStr = allDays.map(d => days.includes(d) ? '1' : '0').join('');
                const time    = s.start_time.replace(':', '');
                const dur     = String(s.duration_min).padStart(3, '0');
                const motor_id = s.motor_id || 0;
                // NEW FORMAT: FERT:id:valve:motor:time:dur:fert:dose:days
                const msg = `FERT:${s.id}:${s.valve_id}:${motor_id}:${time}:${dur}:${s.fertilizer}:${s.dose_ml || 0}:${daysStr}`;
                mqttClient.publish(`farm/${device.device_uid}/cmd`, msg, { qos: 1 });
                console.log(`🧪 FERT sent: ${msg}`);
            }
        }
    }
}

// ══════════════════════════════════════════════════════════
// IRRIGATION SCHEDULES
// ══════════════════════════════════════════════════════════

router.get('/irrigation', authenticate, requireFarmAccess, (req, res) => {
    // CHANGED: added motor join
    const schedules = db.prepare(`
        SELECT s.*, v.name as valve_name, m.name as motor_name
        FROM irrigation_schedules s
        LEFT JOIN valves  v ON v.id = s.valve_id
        LEFT JOIN motors  m ON m.id = s.motor_id
        WHERE s.farm_id = ? AND s.status != 'deleted'
        ORDER BY s.start_time
    `).all(req.farmId);
    res.json({ schedules: schedules.map(s => ({ ...s, days: JSON.parse(s.days) })) });
});

router.post('/irrigation', authenticate, requireFarmAccess, (req, res) => {
    // CHANGED: motor_id now included
    const { name, valve_id, motor_id, start_time, duration_min, days } = req.body;
    if (!name || !valve_id || !start_time || !duration_min || !Array.isArray(days))
        return res.status(400).json({ error: 'name, valve_id, start_time, duration_min, days required' });

    const valve = db.prepare(`SELECT id FROM valves WHERE id = ? AND farm_id = ?`)
        .get(valve_id, req.farmId);
    if (!valve) return res.status(400).json({ error: 'Valve not found in this farm' });

    // motor_id is optional but recommended
    if (motor_id) {
        const motor = db.prepare(`SELECT id FROM motors WHERE id = ? AND farm_id = ?`)
            .get(motor_id, req.farmId);
        if (!motor) return res.status(400).json({ error: 'Motor not found in this farm' });
    }

    const result = db.prepare(`
        INSERT INTO irrigation_schedules
            (farm_id, valve_id, motor_id, name, start_time, duration_min, days, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.farmId, valve_id, motor_id || null, name.trim(),
           start_time, parseInt(duration_min), JSON.stringify(days), req.user.id);

    publishSchedulesToFarm(req.app, req.farmId, 'irrigation');
    res.status(201).json({ message: 'Schedule created and sent to device', id: result.lastInsertRowid });
});

router.put('/irrigation/:id', authenticate, requireFarmAccess, (req, res) => {
    const schedId = parseInt(req.params.id);
    const sched = db.prepare(`SELECT id FROM irrigation_schedules WHERE id = ? AND farm_id = ?`)
        .get(schedId, req.farmId);
    if (!sched) return res.status(404).json({ error: 'Schedule not found' });

    const { name, valve_id, motor_id, start_time, duration_min, days, status } = req.body;
    const updates = []; const params = [];
    if (name)         { updates.push(`name = ?`);         params.push(name.trim()); }
    if (valve_id)     { updates.push(`valve_id = ?`);     params.push(valve_id); }
    if (motor_id !== undefined) { updates.push(`motor_id = ?`); params.push(motor_id); }
    if (start_time)   { updates.push(`start_time = ?`);   params.push(start_time); }
    if (duration_min) { updates.push(`duration_min = ?`); params.push(parseInt(duration_min)); }
    if (days)         { updates.push(`days = ?`);         params.push(JSON.stringify(days)); }
    if (status)       { updates.push(`status = ?`);       params.push(status); }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    updates.push(`updated_at = datetime('now')`);
    params.push(schedId);
    db.prepare(`UPDATE irrigation_schedules SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    publishSchedulesToFarm(req.app, req.farmId, 'irrigation');
    res.json({ message: 'Schedule updated and sent to device' });
});

router.delete('/irrigation/:id', authenticate, requireFarmAccess, (req, res) => {
    db.prepare(`UPDATE irrigation_schedules SET status = 'deleted', updated_at = datetime('now') WHERE id = ? AND farm_id = ?`)
        .run(parseInt(req.params.id), req.farmId);
    publishSchedulesToFarm(req.app, req.farmId, 'irrigation');
    res.json({ message: 'Schedule deleted' });
});

// ══════════════════════════════════════════════════════════
// FERTIGATION SCHEDULES
// ══════════════════════════════════════════════════════════

router.get('/fertigation', authenticate, requireFarmAccess, (req, res) => {
    const schedules = db.prepare(`
        SELECT s.*, v.name as valve_name, m.name as motor_name
        FROM fertigation_schedules s
        LEFT JOIN valves  v ON v.id = s.valve_id
        LEFT JOIN motors  m ON m.id = s.motor_id
        WHERE s.farm_id = ? AND s.status != 'deleted'
        ORDER BY s.start_time
    `).all(req.farmId);
    res.json({ schedules: schedules.map(s => ({ ...s, days: JSON.parse(s.days) })) });
});

router.post('/fertigation', authenticate, requireFarmAccess, (req, res) => {
    const { name, valve_id, motor_id, start_time, duration_min, fertilizer, dose_ml, days } = req.body;
    if (!name || !valve_id || !start_time || !duration_min || !fertilizer || !Array.isArray(days))
        return res.status(400).json({ error: 'name, valve_id, start_time, duration_min, fertilizer, days required' });

    const valve = db.prepare(`SELECT id FROM valves WHERE id = ? AND farm_id = ?`).get(valve_id, req.farmId);
    if (!valve) return res.status(400).json({ error: 'Valve not found in this farm' });

    const result = db.prepare(`
        INSERT INTO fertigation_schedules
            (farm_id, valve_id, motor_id, name, start_time, duration_min, fertilizer, dose_ml, days, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(req.farmId, valve_id, motor_id || null, name.trim(),
           start_time, parseInt(duration_min), fertilizer.trim(),
           dose_ml || null, JSON.stringify(days), req.user.id);

    publishSchedulesToFarm(req.app, req.farmId, 'fertigation');
    res.status(201).json({ message: 'Schedule created and sent to device', id: result.lastInsertRowid });
});

router.put('/fertigation/:id', authenticate, requireFarmAccess, (req, res) => {
    const schedId = parseInt(req.params.id);
    const sched = db.prepare(`SELECT id FROM fertigation_schedules WHERE id = ? AND farm_id = ?`)
        .get(schedId, req.farmId);
    if (!sched) return res.status(404).json({ error: 'Schedule not found' });

    const { name, valve_id, motor_id, start_time, duration_min, fertilizer, dose_ml, days, status } = req.body;
    const updates = []; const params = [];
    if (name)         { updates.push(`name = ?`);         params.push(name.trim()); }
    if (valve_id)     { updates.push(`valve_id = ?`);     params.push(valve_id); }
    if (motor_id !== undefined) { updates.push(`motor_id = ?`); params.push(motor_id); }
    if (start_time)   { updates.push(`start_time = ?`);   params.push(start_time); }
    if (duration_min) { updates.push(`duration_min = ?`); params.push(parseInt(duration_min)); }
    if (fertilizer)   { updates.push(`fertilizer = ?`);   params.push(fertilizer.trim()); }
    if (dose_ml !== undefined) { updates.push(`dose_ml = ?`); params.push(dose_ml); }
    if (days)         { updates.push(`days = ?`);         params.push(JSON.stringify(days)); }
    if (status)       { updates.push(`status = ?`);       params.push(status); }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
    updates.push(`updated_at = datetime('now')`);
    params.push(schedId);
    db.prepare(`UPDATE fertigation_schedules SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    publishSchedulesToFarm(req.app, req.farmId, 'fertigation');
    res.json({ message: 'Schedule updated and sent to device' });
});

router.delete('/fertigation/:id', authenticate, requireFarmAccess, (req, res) => {
    db.prepare(`UPDATE fertigation_schedules SET status = 'deleted', updated_at = datetime('now') WHERE id = ? AND farm_id = ?`)
        .run(parseInt(req.params.id), req.farmId);
    publishSchedulesToFarm(req.app, req.farmId, 'fertigation');
    res.json({ message: 'Schedule deleted' });
});

module.exports = router;
