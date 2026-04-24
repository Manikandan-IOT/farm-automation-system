// database.js — SQLite database setup
// All tables are created automatically on first run

const Database = require('better-sqlite3');
const path = require('path');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || './farm_automation.db';
const db = new Database(path.resolve(DB_PATH));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`

    -- ─────────────────────────────────────────
    -- USERS
    -- roles: admin | team | customer
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS users (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      email       TEXT    NOT NULL UNIQUE,
      password    TEXT    NOT NULL,
      name        TEXT    NOT NULL,
      role        TEXT    NOT NULL CHECK(role IN ('admin','team','customer')),
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- FARMS
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS farms (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      location    TEXT,
      description TEXT,
      created_by  INTEGER NOT NULL REFERENCES users(id),
      is_active   INTEGER NOT NULL DEFAULT 1,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- FARM ↔ USER (customer assignment)
    -- links a customer to one or more farms
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS farm_users (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      farm_id  INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(farm_id, user_id)
    );

    -- ─────────────────────────────────────────
    -- DEVICES (ESP32 or custom PCB per farm)
    -- device_uid = unique hardware ID (used as MQTT topic prefix)
    -- controller_type: esp32 | custom_pcb
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS devices (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      farm_id         INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      name            TEXT    NOT NULL,
      device_uid      TEXT    NOT NULL UNIQUE,
      controller_type TEXT    NOT NULL DEFAULT 'esp32',
      firmware_ver    TEXT,
      is_online       INTEGER NOT NULL DEFAULT 0,
      last_seen       TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- CONTROLLER PIN DEFINITIONS
    -- defines available GPIO pins per controller type
    -- populated on setup; can be extended for custom PCBs
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS controller_pins (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      controller_type TEXT    NOT NULL,
      pin_number      INTEGER NOT NULL,
      pin_label       TEXT    NOT NULL,
      pin_type        TEXT    NOT NULL DEFAULT 'digital',
      notes           TEXT,
      UNIQUE(controller_type, pin_number)
    );

    -- ─────────────────────────────────────────
    -- MOTORS (per farm)
    -- type: pump | motor
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS motors (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      farm_id    INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      type       TEXT    NOT NULL DEFAULT 'pump',
      notes      TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- VALVES (per farm, linked to motor)
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS valves (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      farm_id    INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      motor_id   INTEGER REFERENCES motors(id) ON DELETE SET NULL,
      name       TEXT    NOT NULL,
      notes      TEXT,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- PIN CONFIGURATIONS
    -- maps a motor or valve to a GPIO pin on a device
    -- component_type: motor | valve | sensor
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS pin_configs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id      INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
      component_id   INTEGER NOT NULL,
      component_type TEXT    NOT NULL CHECK(component_type IN ('motor','valve','sensor')),
      pin_number     INTEGER NOT NULL,
      pin_mode       TEXT    NOT NULL DEFAULT 'output',
      created_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(device_id, pin_number)
    );

    -- ─────────────────────────────────────────
    -- IRRIGATION SCHEDULES
    -- days stored as JSON array e.g. ["Mon","Wed","Fri"]
    -- status: active | paused | deleted
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS irrigation_schedules (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      farm_id     INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      valve_id    INTEGER NOT NULL REFERENCES valves(id) ON DELETE CASCADE,
      name        TEXT    NOT NULL,
      start_time  TEXT    NOT NULL,
      duration_min INTEGER NOT NULL,
      days        TEXT    NOT NULL DEFAULT '[]',
      status      TEXT    NOT NULL DEFAULT 'active',
      created_by  INTEGER REFERENCES users(id),
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- FERTIGATION SCHEDULES
    -- fertilizer: name/type of fertilizer used
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS fertigation_schedules (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      farm_id       INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      valve_id      INTEGER NOT NULL REFERENCES valves(id) ON DELETE CASCADE,
      name          TEXT    NOT NULL,
      start_time    TEXT    NOT NULL,
      duration_min  INTEGER NOT NULL,
      fertilizer    TEXT    NOT NULL,
      dose_ml       REAL,
      days          TEXT    NOT NULL DEFAULT '[]',
      status        TEXT    NOT NULL DEFAULT 'active',
      created_by    INTEGER REFERENCES users(id),
      created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- NOTIFICATIONS (from ESP32)
    -- type: irrigation_start | irrigation_end |
    --       fertigation_start | fertigation_end |
    --       alert | info
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS notifications (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      farm_id    INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      device_id  INTEGER REFERENCES devices(id) ON DELETE SET NULL,
      type       TEXT    NOT NULL,
      message    TEXT    NOT NULL,
      payload    TEXT,
      is_read    INTEGER NOT NULL DEFAULT 0,
      created_at TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- SENSOR LOGS (from ESP32)
    -- sensor_type: temperature | humidity | soil_moisture |
    --              flow_rate | pressure | ph | ec
    -- ─────────────────────────────────────────
    CREATE TABLE IF NOT EXISTS sensor_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      farm_id     INTEGER NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
      device_id   INTEGER REFERENCES devices(id) ON DELETE SET NULL,
      sensor_type TEXT    NOT NULL,
      value       REAL    NOT NULL,
      unit        TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    -- ─────────────────────────────────────────
    -- INDEXES for performance
    -- ─────────────────────────────────────────
    CREATE INDEX IF NOT EXISTS idx_farm_users_farm   ON farm_users(farm_id);
    CREATE INDEX IF NOT EXISTS idx_farm_users_user   ON farm_users(user_id);
    CREATE INDEX IF NOT EXISTS idx_devices_farm      ON devices(farm_id);
    CREATE INDEX IF NOT EXISTS idx_devices_uid       ON devices(device_uid);
    CREATE INDEX IF NOT EXISTS idx_motors_farm       ON motors(farm_id);
    CREATE INDEX IF NOT EXISTS idx_valves_farm       ON valves(farm_id);
    CREATE INDEX IF NOT EXISTS idx_pin_configs_dev   ON pin_configs(device_id);
    CREATE INDEX IF NOT EXISTS idx_irr_sched_farm    ON irrigation_schedules(farm_id);
    CREATE INDEX IF NOT EXISTS idx_fert_sched_farm   ON fertigation_schedules(farm_id);
    CREATE INDEX IF NOT EXISTS idx_notifications     ON notifications(farm_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_sensor_logs       ON sensor_logs(farm_id, sensor_type, created_at);

  `);

  // Seed ESP32 default pins
  seedControllerPins();
  console.log('✅ Database initialized');
}

function seedControllerPins() {
  const existing = db.prepare(
    `SELECT COUNT(*) as cnt FROM controller_pins WHERE controller_type = 'esp32'`
  ).get();
  if (existing.cnt > 0) return;

  // ESP32 usable GPIO pins (output-safe, avoiding strapping/boot pins)
  const esp32Pins = [
    { pin: 2,  label: 'GPIO2',  type: 'digital', notes: 'Built-in LED' },
    { pin: 4,  label: 'GPIO4',  type: 'digital', notes: 'General purpose' },
    { pin: 5,  label: 'GPIO5',  type: 'digital', notes: 'General purpose' },
    { pin: 12, label: 'GPIO12', type: 'digital', notes: 'General purpose' },
    { pin: 13, label: 'GPIO13', type: 'digital', notes: 'General purpose' },
    { pin: 14, label: 'GPIO14', type: 'digital', notes: 'General purpose' },
    { pin: 16, label: 'GPIO16', type: 'digital', notes: 'General purpose' },
    { pin: 17, label: 'GPIO17', type: 'digital', notes: 'General purpose' },
    { pin: 18, label: 'GPIO18', type: 'digital', notes: 'SPI CLK / General' },
    { pin: 19, label: 'GPIO19', type: 'digital', notes: 'SPI MISO / General' },
    { pin: 21, label: 'GPIO21', type: 'digital', notes: 'I2C SDA / General' },
    { pin: 22, label: 'GPIO22', type: 'digital', notes: 'I2C SCL / General' },
    { pin: 23, label: 'GPIO23', type: 'digital', notes: 'SPI MOSI / General' },
    { pin: 25, label: 'GPIO25', type: 'digital_analog', notes: 'DAC1 capable' },
    { pin: 26, label: 'GPIO26', type: 'digital_analog', notes: 'DAC2 capable' },
    { pin: 27, label: 'GPIO27', type: 'digital', notes: 'General purpose' },
    { pin: 32, label: 'GPIO32', type: 'digital_analog', notes: 'ADC1 CH4' },
    { pin: 33, label: 'GPIO33', type: 'digital_analog', notes: 'ADC1 CH5' },
    { pin: 34, label: 'GPIO34', type: 'analog_input', notes: 'Input only, ADC1 CH6' },
    { pin: 35, label: 'GPIO35', type: 'analog_input', notes: 'Input only, ADC1 CH7' },
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO controller_pins
      (controller_type, pin_number, pin_label, pin_type, notes)
    VALUES ('esp32', ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((pins) => {
    for (const p of pins) insert.run(p.pin, p.label, p.type, p.notes);
  });
  insertMany(esp32Pins);
  console.log('✅ ESP32 pins seeded');
}

module.exports = { db, initDatabase };
