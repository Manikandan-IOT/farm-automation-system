// routes/auth.js — Login, register, profile, user management

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db } = require('../database');
const { authenticate, requireRole } = require('../middleware/auth');

function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

// ─── POST /api/auth/login ────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare(
    `SELECT * FROM users WHERE email = ? AND is_active = 1`
  ).get(email.toLowerCase().trim());

  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = generateToken(user);
  res.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role }
  });
});

// ─── POST /api/auth/register (admin only — creates team/customer accounts) ───
router.post('/register', authenticate, requireRole('admin'), (req, res) => {
  const { email, password, name, role } = req.body;
  if (!email || !password || !name || !role)
    return res.status(400).json({ error: 'email, password, name, role required' });

  if (!['admin', 'team', 'customer'].includes(role))
    return res.status(400).json({ error: 'Invalid role' });

  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare(`SELECT id FROM users WHERE email = ?`)
    .get(email.toLowerCase().trim());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = bcrypt.hashSync(password, 12);
  const result = db.prepare(
    `INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)`
  ).run(email.toLowerCase().trim(), hash, name.trim(), role);

  res.status(201).json({
    message: 'User created',
    user: { id: result.lastInsertRowid, email, name, role }
  });
});

// ─── GET /api/auth/me ────────────────────────────────────────────────────────
router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

// ─── PUT /api/auth/password ───────────────────────────────────────────────────
router.put('/password', authenticate, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'current_password and new_password required' });

  if (new_password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters' });

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password))
    return res.status(401).json({ error: 'Current password is incorrect' });

  const hash = bcrypt.hashSync(new_password, 12);
  db.prepare(`UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(hash, req.user.id);

  res.json({ message: 'Password updated successfully' });
});

// ─── GET /api/auth/users (admin only) ────────────────────────────────────────
router.get('/users', authenticate, requireRole('admin'), (req, res) => {
  const users = db.prepare(
    `SELECT id, email, name, role, is_active, created_at FROM users ORDER BY created_at DESC`
  ).all();
  res.json({ users });
});

// ─── PUT /api/auth/users/:id (admin only) ─────────────────────────────────────
router.put('/users/:id', authenticate, requireRole('admin'), (req, res) => {
  const { name, role, is_active } = req.body;
  const userId = parseInt(req.params.id);

  if (userId === req.user.id)
    return res.status(400).json({ error: 'Cannot modify your own account here' });

  const updates = [];
  const params = [];
  if (name)       { updates.push(`name = ?`);      params.push(name.trim()); }
  if (role)       { updates.push(`role = ?`);      params.push(role); }
  if (is_active !== undefined) {
                    updates.push(`is_active = ?`); params.push(is_active ? 1 : 0); }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

  updates.push(`updated_at = datetime('now')`);
  params.push(userId);

  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  res.json({ message: 'User updated' });
});

// ─── DELETE /api/auth/users/:id (admin only) ──────────────────────────────────
router.delete('/users/:id', authenticate, requireRole('admin'), (req, res) => {
  const userId = parseInt(req.params.id);
  if (userId === req.user.id)
    return res.status(400).json({ error: 'Cannot delete your own account' });

  db.prepare(`UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ?`)
    .run(userId);
  res.json({ message: 'User deactivated' });
});

module.exports = router;
