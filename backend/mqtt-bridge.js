// mqtt-bridge.js — Connects to Mosquitto, listens to all farm devices
// Saves incoming ESP32 data (notifications, sensors, status) to SQLite
// Attaches mqttClient to express app so routes can publish

const mqtt = require('mqtt');
const { db } = require('./database');

function startMqttBridge(app) {
  const host     = process.env.MQTT_HOST     || 'localhost';
  const port     = parseInt(process.env.MQTT_PORT) || 1883;
  const username = process.env.MQTT_USERNAME || '';
  const password = process.env.MQTT_PASSWORD || '';

  const client = mqtt.connect(`mqtt://${host}:${port}`, {
    clientId: `farm-backend-${Date.now()}`,
    username,
    password,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
    clean: true,
  });

  // Attach client to app so routes can publish
  app.set('mqttClient', client);

  client.on('connect', () => {
    console.log(`✅ MQTT bridge connected to ${host}:${port}`);

    // Subscribe to all farm topics
    client.subscribe('farm/+/notify',   { qos: 1 });
    client.subscribe('farm/+/sensors',  { qos: 0 });
    client.subscribe('farm/+/status',   { qos: 0 });
    console.log('📡 Subscribed to farm/+/notify, sensors, status');
  });

  client.on('message', (topic, messageBuffer) => {
    const message = messageBuffer.toString();
    const parts = topic.split('/');
    // topic format: farm/{device_uid}/{type}
    if (parts.length < 3 || parts[0] !== 'farm') return;

    const device_uid = parts[1];
    const msgType    = parts[2];

    // Lookup device
    const device = db.prepare(`SELECT * FROM devices WHERE device_uid = ?`).get(device_uid);
    if (!device) {
      console.warn(`⚠️  Unknown device_uid: ${device_uid} on topic ${topic}`);
      return;
    }

    try {
      const payload = JSON.parse(message);

      if (msgType === 'status') {
        handleStatus(device, payload);
      } else if (msgType === 'notify') {
        handleNotification(device, payload);
      } else if (msgType === 'sensors') {
        handleSensors(device, payload);
      }
    } catch (err) {
      console.error(`❌ Failed to parse MQTT message on ${topic}:`, err.message);
    }
  });

  client.on('error', (err) => {
    console.error('❌ MQTT error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('🔄 MQTT reconnecting...');
  });

  client.on('offline', () => {
    console.warn('⚠️  MQTT client offline');
  });

  return client;
}

// ─── Handle device online/offline status ─────────────────────────────────────
// ESP32 publishes: { "online": true, "firmware": "1.0.2" }
function handleStatus(device, payload) {
  const isOnline = payload.online === true ? 1 : 0;
  db.prepare(`
    UPDATE devices
    SET is_online = ?, last_seen = datetime('now'), firmware_ver = COALESCE(?, firmware_ver)
    WHERE id = ?
  `).run(isOnline, payload.firmware || null, device.id);

  // Log as notification if device went offline
  if (!isOnline) {
    db.prepare(`
      INSERT INTO notifications (farm_id, device_id, type, message, payload)
      VALUES (?, ?, 'alert', ?, ?)
    `).run(device.farm_id, device.id, `Device "${device.name}" went offline`, JSON.stringify(payload));
  }
  console.log(`📶 [${device.name}] status: ${isOnline ? 'online' : 'offline'}`);
}

// ─── Handle notifications from ESP32 ─────────────────────────────────────────
// ESP32 publishes: { "type": "irrigation_start", "message": "Valve 1 started", ... }
function handleNotification(device, payload) {
  const type    = payload.type    || 'info';
  const message = payload.message || JSON.stringify(payload);

  db.prepare(`
    INSERT INTO notifications (farm_id, device_id, type, message, payload)
    VALUES (?, ?, ?, ?, ?)
  `).run(device.farm_id, device.id, type, message, JSON.stringify(payload));

  console.log(`🔔 [${device.name}] ${type}: ${message}`);
}

// ─── Handle sensor readings ───────────────────────────────────────────────────
// ESP32 publishes array or object:
// { "temperature": 28.5, "humidity": 72, "soil_moisture": 45 }
// or { "readings": [{ "type": "temperature", "value": 28.5, "unit": "°C" }] }
function handleSensors(device, payload) {
  const insert = db.prepare(`
    INSERT INTO sensor_logs (farm_id, device_id, sensor_type, value, unit)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((readings) => {
    for (const r of readings) insert.run(device.farm_id, device.id, r.type, r.value, r.unit || null);
  });

  let readings = [];

  if (Array.isArray(payload.readings)) {
    // Array format
    readings = payload.readings.filter(r => r.type && r.value !== undefined);
  } else {
    // Flat object format: { temperature: 28.5, humidity: 72 }
    const unitMap = {
      temperature:   '°C',
      humidity:      '%',
      soil_moisture: '%',
      flow_rate:     'L/min',
      pressure:      'bar',
      ph:            'pH',
      ec:            'mS/cm',
    };
    for (const [key, val] of Object.entries(payload)) {
      if (typeof val === 'number') {
        readings.push({ type: key, value: val, unit: unitMap[key] || null });
      }
    }
  }

  if (readings.length) {
    insertMany(readings);
    console.log(`📊 [${device.name}] saved ${readings.length} sensor reading(s)`);
  }
}

module.exports = { startMqttBridge };
