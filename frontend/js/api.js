// js/api.js — Centralized API client
// All HTTP calls to the backend go through here

const API_BASE = '/api';

// ─── Token helpers ────────────────────────────────────────────────────────────
const Auth = {
  getToken()  { return localStorage.getItem('farm_token'); },
  getUser()   { const u = localStorage.getItem('farm_user'); return u ? JSON.parse(u) : null; },
  setSession(token, user) {
    localStorage.setItem('farm_token', token);
    localStorage.setItem('farm_user', JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem('farm_token');
    localStorage.removeItem('farm_user');
  },
  isLoggedIn() { return !!this.getToken(); },
  role()       { return this.getUser()?.role; },
  isAdmin()    { return this.role() === 'admin'; },
  isTeam()     { return ['admin','team'].includes(this.role()); },
};

// ─── Core fetch wrapper ───────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API_BASE + path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // Auto logout on 401
  if (res.status === 401) {
    Auth.clear();
    window.location.href = '/index.html';
    return;
  }

  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

const api = {
  get:    (path)         => apiFetch(path, { method: 'GET' }),
  post:   (path, body)   => apiFetch(path, { method: 'POST',   body }),
  put:    (path, body)   => apiFetch(path, { method: 'PUT',    body }),
  delete: (path)         => apiFetch(path, { method: 'DELETE' }),
};

// ─── Auth ─────────────────────────────────────────────────────────────────────
const AuthAPI = {
  async login(email, password) {
    const data = await api.post('/auth/login', { email, password });
    Auth.setSession(data.token, data.user);
    return data;
  },
  logout() {
    Auth.clear();
    window.location.href = '/index.html';
  },
  me()                    { return api.get('/auth/me'); },
  getUsers()              { return api.get('/auth/users'); },
  createUser(body)        { return api.post('/auth/register', body); },
  updateUser(id, body)    { return api.put(`/auth/users/${id}`, body); },
  deleteUser(id)          { return api.delete(`/auth/users/${id}`); },
  changePassword(body)    { return api.put('/auth/password', body); },
};

// ─── Farms ────────────────────────────────────────────────────────────────────
const FarmsAPI = {
  list()              { return api.get('/farms'); },
  get(farmId)         { return api.get(`/farms/${farmId}`); },
  create(body)        { return api.post('/farms', body); },
  update(farmId, body){ return api.put(`/farms/${farmId}`, body); },
  delete(farmId)      { return api.delete(`/farms/${farmId}`); },
  assignUser(farmId, userId)   { return api.post(`/farms/${farmId}/assign`, { user_id: userId }); },
  unassignUser(farmId, userId) { return api.delete(`/farms/${farmId}/assign/${userId}`); },
};

// ─── Devices ──────────────────────────────────────────────────────────────────
const DevicesAPI = {
  list(farmId)            { return api.get(`/farms/${farmId}/devices`); },
  get(farmId, deviceId)   { return api.get(`/farms/${farmId}/devices/${deviceId}`); },
  create(farmId, body)    { return api.post(`/farms/${farmId}/devices`, body); },
  update(farmId, id, body){ return api.put(`/farms/${farmId}/devices/${id}`, body); },
  delete(farmId, id)      { return api.delete(`/farms/${farmId}/devices/${id}`); },
  availablePins(farmId, deviceId) {
    return api.get(`/farms/${farmId}/devices/${deviceId}/available-pins`);
  },
};

// ─── Motors + Valves ──────────────────────────────────────────────────────────
const MotorsAPI = {
  list(farmId)            { return api.get(`/farms/${farmId}/motors`); },
  create(farmId, body)    { return api.post(`/farms/${farmId}/motors`, body); },
  update(farmId, id, body){ return api.put(`/farms/${farmId}/motors/${id}`, body); },
  delete(farmId, id)      { return api.delete(`/farms/${farmId}/motors/${id}`); },
};

const ValvesAPI = {
  list(farmId)            { return api.get(`/farms/${farmId}/motors/valves/all`); },
  create(farmId, body)    { return api.post(`/farms/${farmId}/motors/valves`, body); },
  update(farmId, id, body){ return api.put(`/farms/${farmId}/motors/valves/${id}`, body); },
  delete(farmId, id)      { return api.delete(`/farms/${farmId}/motors/valves/${id}`); },
};

// ─── Pin Configuration ────────────────────────────────────────────────────────
const PinsAPI = {
  get(farmId, deviceId)       { return api.get(`/farms/${farmId}/devices/${deviceId}/pins`); },
  save(farmId, deviceId, pins){ return api.post(`/farms/${farmId}/devices/${deviceId}/pins`, { pins }); },
  clear(farmId, deviceId)     { return api.delete(`/farms/${farmId}/devices/${deviceId}/pins`); },
};

// ─── Schedules ────────────────────────────────────────────────────────────────
const IrrigationAPI = {
  list(farmId)            { return api.get(`/farms/${farmId}/irrigation`); },
  create(farmId, body)    { return api.post(`/farms/${farmId}/irrigation`, body); },
  update(farmId, id, body){ return api.put(`/farms/${farmId}/irrigation/${id}`, body); },
  delete(farmId, id)      { return api.delete(`/farms/${farmId}/irrigation/${id}`); },
};

const FertigationAPI = {
  list(farmId)            { return api.get(`/farms/${farmId}/fertigation`); },
  create(farmId, body)    { return api.post(`/farms/${farmId}/fertigation`, body); },
  update(farmId, id, body){ return api.put(`/farms/${farmId}/fertigation/${id}`, body); },
  delete(farmId, id)      { return api.delete(`/farms/${farmId}/fertigation/${id}`); },
};

// ─── Notifications + Sensors ──────────────────────────────────────────────────
const NotificationsAPI = {
  list(farmId, params = {}) {
    const q = new URLSearchParams(params).toString();
    return api.get(`/farms/${farmId}/notifications${q ? '?' + q : ''}`);
  },
  readAll(farmId) { return api.put(`/farms/${farmId}/notifications/read-all`); },
  read(farmId, id){ return api.put(`/farms/${farmId}/notifications/${id}/read`); },
};

const SensorsAPI = {
  latest(farmId, params = {}) {
    const q = new URLSearchParams(params).toString();
    return api.get(`/farms/${farmId}/sensors${q ? '?' + q : ''}`);
  },
};

// ─── Guard: redirect if not logged in ────────────────────────────────────────
function requireAuth() {
  if (!Auth.isLoggedIn()) {
    window.location.href = '/index.html';
    return false;
  }
  return true;
}

// ─── Guard: redirect if logged in (for login page) ───────────────────────────
function redirectIfLoggedIn() {
  if (Auth.isLoggedIn()) {
    window.location.href = '/dashboard.html';
  }
}

// ─── Get farmId from URL ──────────────────────────────────────────────────────
function getFarmIdFromUrl() {
  return new URLSearchParams(window.location.search).get('farm');
}
