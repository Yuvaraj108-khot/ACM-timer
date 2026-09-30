const express = require('express');
const fs = require('fs');
const path = require('path');
const session = require('express-session');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.set('trust proxy', 1);

// ── Admin credentials (change here) ──────────────────────────────────────────
const ADMIN_EMAIL    = 'yuvarajkhot2005@gmail.com';
const ADMIN_PASSWORD = 'YRk@2005';

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'hackathon-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 8 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto'
  }
}));

// Disable caching for real-time timer state & pages
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── Helpers ───────────────────────────────────────────────────────────────────
let inMemoryData = null;

function readData() {
  if (inMemoryData) return inMemoryData;
  try {
    if (fs.existsSync(DATA_FILE)) {
      inMemoryData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return inMemoryData;
    }
  } catch (err) {
    console.error('Error reading data file, using memory fallback:', err.message);
  }
  inMemoryData = { name: 'Hackathon', durationMs: 0, endTime: null, started: false };
  return inMemoryData;
}

function writeData(data) {
  inMemoryData = data;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('Warning: Could not write data to disk (saved in memory):', err.message);
  }
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
  const { email, password } = req.body || {};
  const cleanEmail = (email || '').trim().toLowerCase();
  const cleanPass  = (password || '').trim();

  const isPrimary  = cleanEmail === 'yuvarajkhot2005@gmail.com' && cleanPass === 'YRk@2005';
  const isFallback = cleanEmail === 'admin@hack.com' && cleanPass === 'admin123';
  const isEnv      = !!(process.env.ADMIN_EMAIL && cleanEmail === process.env.ADMIN_EMAIL.trim().toLowerCase() && cleanPass === (process.env.ADMIN_PASSWORD || '').trim());

  if (isPrimary || isFallback || isEnv) {
    req.session.authenticated = true;
    req.session.save((err) => {
      if (err) return res.status(500).json({ error: 'Session save error' });
      res.json({ ok: true });
    });
  } else {
    res.status(401).json({ error: 'Invalid email or password.' });
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
  const data = readData();
  const now = Date.now();
  const isRunning = !!(data.started && data.endTime && now < data.endTime);
  const isEnded = !!(data.started && data.endTime && now >= data.endTime);
  const remainingMs = data.endTime ? Math.max(0, data.endTime - now) : (data.durationMs || 0);

  res.json({
    ...data,
    status: isRunning ? 'running' : (isEnded ? 'ended' : 'idle'),
    isRunning,
    isEnded,
    remainingMs
  });
});

// Save name + duration (admin only, allowed when idle or ended)
app.post('/api/settings', requireAuth, (req, res) => {
  const data = readData();
  const now = Date.now();
  const isRunning = !!(data.started && data.endTime && now < data.endTime);
  if (isRunning) {
    return res.status(400).json({ error: 'Timer is currently running; reset before changing duration.' });
  }
  const { name, hours, minutes } = req.body || {};
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

// Start the timer (idempotent if already actively running)
app.post('/api/start', (req, res) => {
  const data = readData();
  const now = Date.now();
  const isRunning = !!(data.started && data.endTime && now < data.endTime);
  if (isRunning) {
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

// Reset the timer (admin only)
app.post('/api/reset', requireAuth, (req, res) => {
  const data = readData();
  data.started = false;
  data.endTime = null;
  writeData(data);
  res.json({ ok: true, data });
});

// ── Error handling ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(`[Error ${req.method} ${req.url}]:`, err);
  res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('Server running at http://localhost:' + PORT);
  console.log('Admin -> http://localhost:' + PORT + '/admin');
});
