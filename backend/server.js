// server.js — Farm Automation Backend Entry Point

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const bcrypt   = require('bcryptjs');

const { db, initDatabase } = require('./database');
const { startMqttBridge }  = require('./mqtt-bridge');

// ─── Routes ──────────────────────────────────────────────────────────────────
const authRoutes          = require('./routes/auth');
const farmRoutes          = require('./routes/farms');
const deviceRoutes        = require('./routes/devices');
const motorRoutes         = require('./routes/motors');
const pinRoutes           = require('./routes/pins');
const scheduleRoutes      = require('./routes/schedules');
const notificationRoutes  = require('./routes/notifications');

// ─── Init ─────────────────────────────────────────────────────────────────────
initDatabase();
createDefaultAdmin();

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || '*',
  methods: ['GET','POST','PUT','DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',                            authRoutes);
app.use('/api/farms',                           farmRoutes);
app.use('/api/farms/:farmId/devices',           deviceRoutes);
app.use('/api/farms/:farmId/motors',            motorRoutes);
app.use('/api/farms/:farmId',                   scheduleRoutes);
app.use('/api/farms/:farmId',                   notificationRoutes);
app.use('/api/farms/:farmId/devices',           pinRoutes);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  const mqttClient = app.get('mqttClient');
  res.json({
    status: 'ok',
    mqtt: mqttClient?.connected ? 'connected' : 'disconnected',
    time: new Date().toISOString(),
  });
});

// ─── Catch-all: serve frontend SPA ────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'index.html'));
});

// ─── Start MQTT bridge ────────────────────────────────────────────────────────
startMqttBridge(app);

// ─── Start server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Farm Automation Server running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
});

// ─── Create default admin on first run ───────────────────────────────────────
function createDefaultAdmin() {
  const email    = process.env.ADMIN_EMAIL    || 'admin@farm.local';
  const password = process.env.ADMIN_PASSWORD || 'Admin@123456';
  const name     = 'System Admin';

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (existing) return;

  const hash = bcrypt.hashSync(password, 12);
  db.prepare(`INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, 'admin')`)
    .run(email, hash, name);

  console.log(`✅ Default admin created: ${email}`);
  console.log(`   ⚠️  Change the admin password immediately after first login!`);
}
