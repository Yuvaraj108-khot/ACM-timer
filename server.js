const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

// ── Admin credentials (change here) ──────────────────────────────────────────
const ADMIN_EMAIL    = 'admin@hack.com';
const ADMIN_PASSWORD = 'admin123';

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'hackathon-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 } // 8 hours
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────
function readData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { name: 'Hackathon', durationMs: 0, endTime: null, started: false };
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// ── Page routes ───────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ── API: admin auth ───────────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  if (email === ADMIN_EMAIL && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth-check', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

// ── API: hackathon state ──────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json(readData());
});

// Save name + duration (admin only, only allowed before timer starts)
app.post('/api/settings', requireAuth, (req, res) => {
  const data = readData();
  if (data.started) {
    return res.status(400).json({ error: 'Timer already started; cannot change duration.' });
  }
  const { name, hours, minutes } = req.body;
  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Name is required.' });
  }
  const h = parseInt(hours, 10)   || 0;
  const m = parseInt(minutes, 10) || 0;
  if (h === 0 && m === 0) {
    return res.status(400).json({ error: 'Duration must be at least 1 minute.' });
  }
  data.name       = name.trim();
  data.durationMs = (h * 60 + m) * 60 * 1000;
  data.endTime    = null;
  data.started    = false;
  writeData(data);
  res.json({ ok: true, data });
});

// Start the timer (idempotent - only first press counts)
app.post('/api/start', (req, res) => {
  const data = readData();
  if (data.started) {
    return res.json({ ok: true, alreadyStarted: true, data });
  }
  if (!data.durationMs || data.durationMs <= 0) {
    return res.status(400).json({ error: 'No valid duration set.' });
  }
  data.started = true;
  data.endTime = Date.now() + data.durationMs;
  writeData(data);
  res.json({ ok: true, data });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
  console.log('Admin -> http://localhost:' + PORT + '/admin');
});
