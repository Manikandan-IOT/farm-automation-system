// db-migrate.js — Run this ONCE to update existing database
// Adds motor_id column to irrigation and fertigation schedule tables
// Run: node db-migrate.js

require('dotenv').config();
const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || './farm_automation.db';
const db = new Database(path.resolve(DB_PATH));
db.pragma('foreign_keys = ON');

console.log('Running database migration...');

// Add motor_id to irrigation_schedules if not exists
try {
    db.prepare(`ALTER TABLE irrigation_schedules ADD COLUMN motor_id INTEGER REFERENCES motors(id)`).run();
    console.log('✅ Added motor_id to irrigation_schedules');
} catch (e) {
    if (e.message.includes('duplicate column')) {
        console.log('ℹ️  motor_id already exists in irrigation_schedules');
    } else {
        console.error('❌', e.message);
    }
}

// Add motor_id to fertigation_schedules if not exists
try {
    db.prepare(`ALTER TABLE fertigation_schedules ADD COLUMN motor_id INTEGER REFERENCES motors(id)`).run();
    console.log('✅ Added motor_id to fertigation_schedules');
} catch (e) {
    if (e.message.includes('duplicate column')) {
        console.log('ℹ️  motor_id already exists in fertigation_schedules');
    } else {
        console.error('❌', e.message);
    }
}

// Remove motor_id from valves if exists (cleanup)
// SQLite doesn't support DROP COLUMN in older versions
// We just leave it null — new valves won't use it
console.log('✅ Migration complete');
console.log('Now restart your server: nodemon server.js');
db.close();
