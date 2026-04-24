// js/app.js — UPDATED: added Manual Control to sidebar nav

function buildSidebar(activePage) {
  const user = Auth.getUser();
  if (!user) return;

  const farmId = getFarmIdFromUrl();
  const farmParam = farmId ? `?farm=${farmId}` : '';

  const navItems = [
    { label: 'Dashboard',      icon: '⊞', href: `/dashboard.html${farmParam}`,   page: 'dashboard',   roles: ['admin','team','customer'] },
    { label: 'Farms',          icon: '🌿', href: `/farms.html`,                   page: 'farms',       roles: ['admin','team','customer'] },
    { label: 'Farm Setup',     icon: '⚙',  href: `/farm-setup.html${farmParam}`,  page: 'farm-setup',  roles: ['admin','team'], needsFarm: true },
    { label: 'Pin Config',     icon: '📌', href: `/pin-config.html${farmParam}`,  page: 'pin-config',  roles: ['admin','team'], needsFarm: true },
    // NEW: Manual Control page
    { label: 'Manual Control', icon: '🎛️', href: `/manual.html${farmParam}`,      page: 'manual',      roles: ['admin','team','customer'], needsFarm: true },
    { label: 'Irrigation',     icon: '💧', href: `/irrigation.html${farmParam}`,  page: 'irrigation',  roles: ['admin','team','customer'], needsFarm: true },
    { label: 'Fertigation',    icon: '🧪', href: `/fertigation.html${farmParam}`, page: 'fertigation', roles: ['admin','team','customer'], needsFarm: true },
    { label: 'Users',          icon: '👥', href: `/users.html`,                   page: 'users',       roles: ['admin'] },
  ];

  const sectionMain = navItems
    .filter(item => !item.needsFarm && item.roles.includes(user.role))
    .map(item => navItemHTML(item, activePage))
    .join('');

  const farmItems = navItems
    .filter(item => item.needsFarm && item.roles.includes(user.role))
    .map(item => navItemHTML(item, activePage))
    .join('');

  const farmSection = farmId ? `
    <div class="nav-section-label">Current Farm</div>
    ${farmItems}
  ` : '';

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-brand">
      <h1>🌾 FarmControl</h1>
      <span>Automation System</span>
    </div>
    <nav class="sidebar-nav">
      <div class="nav-section-label">Menu</div>
      ${sectionMain}
      ${farmSection}
    </nav>
    <div class="sidebar-footer">
      <div class="sidebar-user">
        <strong>${escHtml(user.name)}</strong>
        ${capitalize(user.role)}
      </div>
      <button class="btn btn-secondary btn-sm btn-full" onclick="AuthAPI.logout()">Sign Out</button>
    </div>
  `;
}

function navItemHTML(item, activePage) {
  return `
    <a href="${item.href}" class="nav-item ${item.page === activePage ? 'active' : ''}">
      <span>${item.icon}</span>
      <span>${item.label}</span>
    </a>
  `;
}

// ─── Mobile sidebar toggle ────────────────────────────────────────────────────
function initMobileMenu() {
  const toggle  = document.getElementById('menuToggle');
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!toggle) return;
  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
  });
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  });
}

// ─── Alert helpers ────────────────────────────────────────────────────────────
function showAlert(containerId, message, type = 'error') {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = `<div class="alert alert-${type}">
    <span>${type === 'error' ? '⚠' : type === 'success' ? '✓' : 'ℹ'}</span>
    <span>${escHtml(message)}</span>
  </div>`;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (type === 'success') setTimeout(() => { el.innerHTML = ''; }, 3500);
}

function clearAlert(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = '';
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
function initModalClose() {
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) overlay.classList.remove('open');
    });
  });
  document.querySelectorAll('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal-overlay')?.classList.remove('open');
    });
  });
}

// ─── Tab helpers ──────────────────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group  = btn.dataset.tabGroup || 'default';
      const target = btn.dataset.tab;
      document.querySelectorAll(`.tab-btn[data-tab-group="${group}"]`)
        .forEach(b => b.classList.remove('active'));
      document.querySelectorAll(`.tab-panel[data-tab-group="${group}"]`)
        .forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.querySelector(`.tab-panel[data-tab="${target}"][data-tab-group="${group}"]`)
        ?.classList.add('active');
    });
  });
}

// ─── Day selector ─────────────────────────────────────────────────────────────
function initDaySelector(containerId, preselected = []) {
  const days      = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = days.map(d => `
    <button type="button" class="day-btn ${preselected.includes(d) ? 'selected' : ''}" data-day="${d}">${d}</button>
  `).join('');
  container.querySelectorAll('.day-btn').forEach(btn => {
    btn.addEventListener('click', () => btn.classList.toggle('selected'));
  });
}

function getSelectedDays(containerId) {
  return [...document.querySelectorAll(`#${containerId} .day-btn.selected`)]
    .map(b => b.dataset.day);
}

// ─── MQTT Browser Client ──────────────────────────────────────────────────────
let mqttBrowserClient = null;

function connectMqttBrowser(farmDeviceUids, onMessage) {
  if (typeof mqtt === 'undefined') return;
  const host = window.location.hostname;
  // Use ws:// for local, wss:// for production
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const url  = `${protocol}://${host}:9001`;

  const opts = {
    clientId:        `webapp-${Date.now()}`,
    username:        window.MQTT_USER || '',
    password:        window.MQTT_PASS || '',
    reconnectPeriod: 5000,
  };

  mqttBrowserClient = mqtt.connect(url, opts);

  mqttBrowserClient.on('connect', () => {
    console.log('MQTT browser connected');
    for (const uid of farmDeviceUids) {
      mqttBrowserClient.subscribe(`farm/${uid}/notify`);
      mqttBrowserClient.subscribe(`farm/${uid}/sensors`);
      mqttBrowserClient.subscribe(`farm/${uid}/status`);
    }
  });

  mqttBrowserClient.on('message', (topic, buf) => {
    try {
      // Try JSON parse, fallback to raw string
      let payload;
      try { payload = JSON.parse(buf.toString()); }
      catch (e) { payload = buf.toString(); }
      onMessage(topic, payload);
    } catch (e) {}
  });

  mqttBrowserClient.on('error', err => {
    console.warn('MQTT browser error:', err.message);
  });
}

function disconnectMqttBrowser() {
  mqttBrowserClient?.end();
  mqttBrowserClient = null;
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function formatTime(timeStr) {
  if (!timeStr) return '—';
  const [h, m] = timeStr.split(':');
  const hr = parseInt(h);
  return `${hr > 12 ? hr - 12 : hr || 12}:${m} ${hr >= 12 ? 'PM' : 'AM'}`;
}

function timeAgo(dateStr) {
  const diff = (Date.now() - new Date(dateStr)) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}

function notifTypeIcon(type) {
  const icons = {
    irrigation_start: '💧', irrigation_end: '✅',
    fertigation_start: '🧪', fertigation_end: '✅',
    alert: '⚠️', info: 'ℹ️', status: '📡',
  };
  return icons[type] || 'ℹ️';
}

function notifBgClass(type) {
  if (type?.includes('alert'))  return 'background:var(--red-pale)';
  if (type?.includes('fert'))   return 'background:var(--amber-pale)';
  if (type?.includes('status')) return 'background:var(--blue-pale)';
  return 'background:var(--green-pale)';
}

// Wrapper for raw API fetch (used in manual.html)
async function apiFetch(path, options = {}) {
  const token = Auth.getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch('/api' + path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) { Auth.clear(); window.location.href = '/index.html'; return; }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
