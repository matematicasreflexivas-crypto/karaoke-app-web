const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// JWT secret: prefer env var (production), then a persistent file (development),
// then generate a new one (sessions lost on restart).
function loadOrCreateJwtSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const secretFile = path.join(__dirname, '.jwt_secret');
  try {
    const existing = fs.readFileSync(secretFile, 'utf8').trim();
    if (existing.length >= 32) return existing;
  } catch (_) { /* file doesn't exist yet */ }
  const newSecret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(secretFile, newSecret, { mode: 0o600 });
  } catch (e) {
    console.warn('No se pudo persistir el JWT secret:', e.message);
  }
  return newSecret;
}
const JWT_SECRET = loadOrCreateJwtSecret();
const JWT_EXPIRY = '8h';

// ===== SQLITE (NUEVO) =====
const Database = require('better-sqlite3');
const dbPath = path.join(__dirname, 'karaoke.db');
console.log('Usando base de datos en:', dbPath);
const db = new Database(dbPath);

// Crear tablas necesarias
db.exec(`
  CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userName TEXT NOT NULL,
    tableNumber TEXT NOT NULL,
    songTitle TEXT NOT NULL,
    createdAt TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS tables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tableNumber TEXT NOT NULL UNIQUE,
    maxSongs INTEGER DEFAULT 1
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userName TEXT NOT NULL,
    tableNumber TEXT NOT NULL,
    songTitle TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    playedAt TEXT NOT NULL,
    queuePosition INTEGER,
    queueTotal INTEGER
  );
`);

// NUEVA TABLA: sugerencias de canciones
db.exec(`
  CREATE TABLE IF NOT EXISTS song_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    artist TEXT NOT NULL,
    userName TEXT,
    tableNumber TEXT,
    createdAt TEXT NOT NULL
  );
`);

// NUEVA TABLA: cola manual (registro manual de canciones)
db.exec(`
  CREATE TABLE IF NOT EXISTS manual_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userName TEXT NOT NULL,
    tableNumber TEXT NOT NULL,
    songTitle TEXT NOT NULL,
    manualSongTitle TEXT,
    manualSongArtist TEXT,
    createdAt TEXT DEFAULT (datetime('now', 'localtime'))
  );
`);

// Migraciones: agregar columna highlightColor si no existe
try { db.exec(`ALTER TABLE queue ADD COLUMN highlightColor TEXT`); } catch (e) { /* ya existe */ }
try { db.exec(`ALTER TABLE manual_queue ADD COLUMN highlightColor TEXT`); } catch (e) { /* ya existe */ }

// Migraciones: agregar columnas de posición en las 3 colas
try { db.exec(`ALTER TABLE history ADD COLUMN catalogPosition INTEGER`); } catch (e) { /* ya existe */ }
try { db.exec(`ALTER TABLE history ADD COLUMN catalogTotal INTEGER`); } catch (e) { /* ya existe */ }
try { db.exec(`ALTER TABLE history ADD COLUMN manualPosition INTEGER`); } catch (e) { /* ya existe */ }
try { db.exec(`ALTER TABLE history ADD COLUMN manualTotal INTEGER`); } catch (e) { /* ya existe */ }
try { db.exec(`ALTER TABLE history ADD COLUMN mixedPosition INTEGER`); } catch (e) { /* ya existe */ }
try { db.exec(`ALTER TABLE history ADD COLUMN mixedTotal INTEGER`); } catch (e) { /* ya existe */ }

// ===== FIN SQLITE =====

const app = express();
const PORT = process.env.PORT || 3000;

// ===== SEGURIDAD: cabeceras HTTP =====
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", "'unsafe-inline'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      frameAncestors: ["'none'"]
    }
  }
}));

// ===== SEGURIDAD: límite de peticiones en login =====
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiados intentos. Espera 15 minutos.' }
});

// ===== SEGURIDAD: límite de peticiones para subidas de archivos =====
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas subidas. Espera 15 minutos.' }
});

// ===== SEGURIDAD: límite de peticiones para rutas de admin autenticadas =====
const adminApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, message: 'Demasiadas peticiones de administrador. Espera un momento.' }
});

// ===== CORS =====
app.use((req, res, next) => {
  const allowedOrigins = [
    'https://karaoke-app-web2.netlify.app',
    'http://localhost:3000',
    'http://localhost:5500'
  ];

  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }

  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ===== MIDDLEWARES =====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== ADMIN TOKEN MIDDLEWARE =====
// Verifies a JWT issued at login. Protected routes use this instead of
// comparing raw passwords on every request.
// Token is accepted only from Authorization header or request body (never query params,
// to avoid leaking into server logs and browser history).
function requireAdminToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token =
    (authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null) ||
    (req.body && req.body.adminToken);

  if (!token) {
    return res
      .status(401)
      .json({ ok: false, message: 'Token de administrador requerido' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') {
      return res.status(403).json({ ok: false, message: 'Permiso insuficiente' });
    }
    next();
  } catch (_) {
    return res
      .status(401)
      .json({ ok: false, message: 'Sesión de administrador inválida o expirada. Vuelve a iniciar sesión.' });
  }
}

// Normalizar texto
function normalizeText(str) {
  return str
    ? str
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
    : '';
}

// Validar longitud máxima de un campo de texto
function exceedsMaxLength(value, max) {
  return typeof value === 'string' && value.length > max;
}

// ========== CONFIG ADMIN / USUARIO ==========
const adminConfigPath = path.join(__dirname, 'adminConfig.json');
console.log('adminConfigPath:', adminConfigPath);

let adminConfig = {
  adminPassword: '1234',
  userPassword: '1234',
  qrImageFile: 'qr-dia.png',
  appTitle: 'Karaoke',
  isQueueOpen: true,
  userFeatures: {
    search: true,
    queue: true,
    suggestion: true,
    manualQueue: false,
    manualRegister: false,
    mixedQueue: false
  },
  manualMaxSongsPerTable: 1,
  publicQueueMode: 'catalog',
  publicQueueDisplay: 'catalog',
  minutesPerTurn: 5,
  publicMessage: '',
  showColorDots: true
};

try {
  const cfg = fs.readFileSync(adminConfigPath, 'utf8');
  const parsed = JSON.parse(cfg);
  adminConfig.adminPassword = parsed.adminPassword || '1234';
  adminConfig.userPassword  = parsed.userPassword  || '1234';
  adminConfig.qrImageFile   = parsed.qrImageFile   || 'qr-dia.png';
  adminConfig.appTitle      = parsed.appTitle      || 'Karaoke';
  adminConfig.isQueueOpen =
    typeof parsed.isQueueOpen === 'boolean' ? parsed.isQueueOpen : true;

  if (parsed.userFeatures && typeof parsed.userFeatures === 'object') {
    adminConfig.userFeatures = {
      search:         parsed.userFeatures.search         !== false,
      queue:          parsed.userFeatures.queue          !== false,
      suggestion:     parsed.userFeatures.suggestion     !== false,
      manualQueue:    parsed.userFeatures.manualQueue    === true,
      manualRegister: parsed.userFeatures.manualRegister === true,
      mixedQueue:     parsed.userFeatures.mixedQueue     === true
    };
  }

  if (typeof parsed.manualMaxSongsPerTable === 'number') {
    adminConfig.manualMaxSongsPerTable = parsed.manualMaxSongsPerTable;
  }

  if (parsed.publicQueueMode === 'manual' || parsed.publicQueueMode === 'catalog') {
    adminConfig.publicQueueMode = parsed.publicQueueMode;
  }

  if (parsed.publicQueueDisplay === 'catalog' || parsed.publicQueueDisplay === 'manual' || parsed.publicQueueDisplay === 'mixed') {
    adminConfig.publicQueueDisplay = parsed.publicQueueDisplay;
  }

  if (typeof parsed.minutesPerTurn === 'number' && parsed.minutesPerTurn > 0) {
    adminConfig.minutesPerTurn = parsed.minutesPerTurn;
  }

  if (typeof parsed.publicMessage === 'string') {
    adminConfig.publicMessage = parsed.publicMessage;
  }

  if (typeof parsed.showColorDots === 'boolean') {
    adminConfig.showColorDots = parsed.showColorDots;
  }
} catch (e) {
  // si no existe adminConfig.json, usamos los valores por defecto
}

function saveAdminConfig() {
  fs.writeFileSync(
    adminConfigPath,
    JSON.stringify(adminConfig, null, 2),
    'utf8'
  );
}

// ===== MIGRAR CONTRASEÑAS A BCRYPT si aún están en texto plano =====
// bcrypt hashes always start with "$2" – plain-text ones never do.
(function migratePasswords() {
  let changed = false;
  if (!adminConfig.adminPassword.startsWith('$2')) {
    adminConfig.adminPassword = bcrypt.hashSync(adminConfig.adminPassword, 12);
    changed = true;
  }
  if (!adminConfig.userPassword.startsWith('$2')) {
    adminConfig.userPassword = bcrypt.hashSync(adminConfig.userPassword, 12);
    changed = true;
  }
  if (changed) {
    try {
      saveAdminConfig();
      console.log('Contraseñas migradas a bcrypt y guardadas en adminConfig.json');
    } catch (e) {
      console.error('No se pudieron guardar las contraseñas hasheadas:', e);
    }
  }
})();

// Info pública del día (NO expone userPassword)
app.get('/api/public-info', (req, res) => {
  res.json({
    ok: true,
    qrImageFile: adminConfig.qrImageFile || null,
    appTitle: adminConfig.appTitle || 'Karaoke',
    isQueueOpen: adminConfig.isQueueOpen,
    userFeatures: {
      search:         adminConfig.userFeatures.search         !== false,
      queue:          adminConfig.userFeatures.queue          !== false,
      suggestion:     adminConfig.userFeatures.suggestion     !== false,
      manualQueue:    adminConfig.userFeatures.manualQueue    === true,
      manualRegister: adminConfig.userFeatures.manualRegister === true,
      mixedQueue:     adminConfig.userFeatures.mixedQueue     === true
    },
    manualMaxSongsPerTable:
      typeof adminConfig.manualMaxSongsPerTable === 'number'
        ? adminConfig.manualMaxSongsPerTable
        : 1,
    publicQueueMode: adminConfig.publicQueueMode || 'catalog',
    publicQueueDisplay: adminConfig.publicQueueDisplay || 'catalog',
    minutesPerTurn: typeof adminConfig.minutesPerTurn === 'number' ? adminConfig.minutesPerTurn : 5,
    publicMessage: adminConfig.publicMessage || '',
    showColorDots: adminConfig.showColorDots !== false
  });
});

// Cambiar nombre de archivo de QR público
app.post('/api/admin/set-qr-file', adminApiLimiter, requireAdminToken, (req, res) => {
  const { qrImageFile } = req.body;
  if (!qrImageFile) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }
  adminConfig.qrImageFile = qrImageFile;

  try {
    saveAdminConfig();
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando nombre de QR', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo guardar el QR' });
  }
});

// ===== subida directa de imagen de QR =====
const qrFolder = path.join(__dirname, 'public', 'qr');
if (!fs.existsSync(qrFolder)) {
  fs.mkdirSync(qrFolder, { recursive: true });
}

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const QR_MAX_SIZE_MB = 2;

const qrStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, qrFolder);
  },
  filename: (req, file, cb) => {
    cb(null, 'qr.png');
  }
});

const uploadQr = multer({
  storage: qrStorage,
  limits: { fileSize: QR_MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes (JPEG, PNG, GIF, WEBP)'));
    }
  }
});

app.post('/api/admin/upload-qr', uploadLimiter, requireAdminToken, uploadQr.single('qr'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: 'No se recibió ningún archivo' });
  }

  try {
    adminConfig.qrImageFile = 'qr.png';
    saveAdminConfig();

    return res.json({ ok: true, message: 'QR actualizado correctamente' });
  } catch (e) {
    console.error('Error actualizando QR', e);
    return res
      .status(500)
      .json({ ok: false, message: 'Error actualizando el QR' });
  }
});

// ========== MESAS (SQLite) ==========
function readTablesFromDb() {
  const stmt = db.prepare(`
    SELECT id, tableNumber, maxSongs
    FROM tables
    ORDER BY id ASC
  `);
  return stmt.all();
}

function insertTable(tableNumber, maxSongs) {
  const stmt = db.prepare(`
    INSERT INTO tables (tableNumber, maxSongs)
    VALUES (?, ?)
  `);
  const info = stmt.run(tableNumber, maxSongs);
  return info.lastInsertRowid;
}

function updateTableMaxSongs(id, maxSongs) {
  const stmt = db.prepare(`
    UPDATE tables
    SET maxSongs = ?
    WHERE id = ?
  `);
  return stmt.run(maxSongs, id);
}

function deleteTable(id) {
  const stmt = db.prepare(`
    DELETE FROM tables
    WHERE id = ?
  `);
  return stmt.run(id);
}

function clearTables() {
  const stmt = db.prepare(`DELETE FROM tables`);
  return stmt.run();
}

app.get('/api/tables', (req, res) => {
  const tables = readTablesFromDb();
  res.json({ ok: true, tables });
});

app.post('/api/tables', adminApiLimiter, requireAdminToken, (req, res) => {
  const { tableNumber, maxSongs } = req.body;
  if (!tableNumber) {
    return res
      .status(400)
      .json({ ok: false, message: 'Falta el número de mesa' });
  }

  if (exceedsMaxLength(String(tableNumber), 50)) {
    return res.status(400).json({ ok: false, message: 'Número de mesa demasiado largo' });
  }

  const mesaOriginal = String(tableNumber).trim();
  const mesaNorm = normalizeText(mesaOriginal);

  const tables = readTablesFromDb();
  const exists = tables.some(t => {
    const tNorm = normalizeText(String(t.tableNumber).trim());
    return tNorm === mesaNorm;
  });

  if (exists) {
    return res
      .status(400)
      .json({ ok: false, message: `La mesa ${mesaOriginal} ya está registrada` });
  }

  let maxSongsInt = parseInt(maxSongs, 10);
  if (Number.isNaN(maxSongsInt) || maxSongsInt < 1) {
    maxSongsInt = 1;
  }

  const id = insertTable(mesaOriginal, maxSongsInt);
  res.json({ ok: true, id });
});

// actualizar solo el maxSongs de una mesa
app.put('/api/tables/:id', adminApiLimiter, requireAdminToken, (req, res) => {
  const id = Number(req.params.id);
  const { maxSongs } = req.body;


  if (!maxSongs && maxSongs !== 0) {
    return res
      .status(400)
      .json({ ok: false, message: 'Falta maxSongs' });
  }

  let maxSongsInt = parseInt(maxSongs, 10);
  if (Number.isNaN(maxSongsInt) || maxSongsInt < 1) {
    maxSongsInt = 1;
  }

  updateTableMaxSongs(id, maxSongsInt);
  res.json({ ok: true });
});

app.delete('/api/tables/:id', adminApiLimiter, requireAdminToken, (req, res) => {
  const id = Number(req.params.id);
  deleteTable(id);
  res.json({ ok: true });
});

app.delete('/api/tables', adminApiLimiter, requireAdminToken, (req, res) => {
  clearTables();
  res.json({ ok: true });
});

function isTableAllowed(tableNumber) {
  const tables = readTablesFromDb();
  const mesaNorm = normalizeText(String(tableNumber).trim());
  return tables.some(t => {
    const tNorm = normalizeText(String(t.tableNumber).trim());
    return tNorm === mesaNorm;
  });
}

// helper: obtener registro de mesa
function getTableConfig(tableNumber) {
  const tables = readTablesFromDb();
  const mesaNorm = normalizeText(String(tableNumber).trim());
  return (
    tables.find(t => {
      const tNorm = normalizeText(String(t.tableNumber).trim());
      return tNorm === mesaNorm;
    }) || null
  );
}

// ========== ADMIN ==========
app.post('/api/admin/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ ok: false, message: 'Falta la contraseña' });
  }
  if (!bcrypt.compareSync(password, adminConfig.adminPassword)) {
    return res.status(401).json({ ok: false, message: 'Contraseña incorrecta' });
  }
  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
  return res.json({ ok: true, token });
});

app.post('/api/admin/change-password', adminApiLimiter, requireAdminToken, (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }
  if (!bcrypt.compareSync(oldPassword, adminConfig.adminPassword)) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña actual incorrecta' });
  }

  adminConfig.adminPassword = bcrypt.hashSync(newPassword, 12);

  try {
    saveAdminConfig();
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando nueva contraseña de admin', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo guardar la nueva contraseña' });
  }
});

app.post('/api/admin/change-user-password', adminApiLimiter, requireAdminToken, (req, res) => {
  const { newUserPassword } = req.body;

  if (!newUserPassword) {
    return res.status(400).json({ ok: false, message: 'Falta la nueva contraseña' });
  }

  adminConfig.userPassword = bcrypt.hashSync(newUserPassword, 12);

  try {
    saveAdminConfig();
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando nueva contraseña de usuario', e);
    return res.status(500).json({
      ok: false,
      message: 'No se pudo guardar la nueva contraseña de usuario'
    });
  }
});

// cambiar título de la aplicación
app.post('/api/admin/change-app-title', adminApiLimiter, requireAdminToken, (req, res) => {
  const { newTitle } = req.body;

  if (!newTitle) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }


  adminConfig.appTitle = String(newTitle).trim();

  try {
    saveAdminConfig();
    return res.json({ ok: true, appTitle: adminConfig.appTitle });
  } catch (e) {
    console.error('Error guardando título de la app', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo guardar el título' });
  }
});

// abrir/cerrar el registro de canciones
app.post('/api/admin/set-queue-open', adminApiLimiter, requireAdminToken, (req, res) => {
  const { isQueueOpen } = req.body || {};

  if (typeof isQueueOpen !== 'boolean') {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }


  adminConfig.isQueueOpen = isQueueOpen;

  try {
    saveAdminConfig();
    return res.json({ ok: true, isQueueOpen });
  } catch (e) {
    console.error('Error guardando estado de la cola', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo guardar el estado de la cola' });
  }
});

// cambiar banderas de secciones visibles en pantalla de usuario
app.post('/api/admin/change-user-features', adminApiLimiter, requireAdminToken, (req, res) => {
  const { userFeatures } = req.body || {};

  if (!userFeatures || typeof userFeatures !== 'object') {
    return res.status(400).json({ ok: false, message: 'Faltan datos de userFeatures o contraseña' });
  }


  adminConfig.userFeatures = {
    search:         userFeatures.search         !== false,
    queue:          userFeatures.queue          !== false,
    suggestion:     userFeatures.suggestion     !== false,
    manualQueue:    userFeatures.manualQueue    === true,
    manualRegister: userFeatures.manualRegister === true,
    mixedQueue:     userFeatures.mixedQueue     === true
  };

  try {
    saveAdminConfig();
    return res.json({ ok: true, userFeatures: adminConfig.userFeatures });
  } catch (e) {
    console.error('Error guardando userFeatures', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudieron guardar las opciones de usuario' });
  }
});

// mostrar/ocultar recuadros de color en colas de usuario y pantalla pública
app.post('/api/admin/set-show-color-dots', adminApiLimiter, requireAdminToken, (req, res) => {
  const { showColorDots } = req.body || {};

  if (typeof showColorDots !== 'boolean') {
    return res.status(400).json({ ok: false, message: 'Falta contraseña o valor showColorDots (boolean)' });
  }


  adminConfig.showColorDots = showColorDots;

  try {
    saveAdminConfig();
    return res.json({ ok: true, showColorDots });
  } catch (e) {
    console.error('Error guardando showColorDots', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo guardar la preferencia de recuadros de color' });
  }
});

// cambiar límite global de canciones manuales por mesa (se mantiene como info)
app.post('/api/admin/change-manual-max-songs', adminApiLimiter, requireAdminToken, (req, res) => {
  const { manualMaxSongsPerTable } = req.body || {};

  if (manualMaxSongsPerTable == null) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }


  let val = parseInt(manualMaxSongsPerTable, 10);
  if (Number.isNaN(val) || val < 1) val = 1;

  adminConfig.manualMaxSongsPerTable = val;

  try {
    saveAdminConfig();
    return res.json({ ok: true, manualMaxSongsPerTable: val });
  } catch (e) {
    console.error('Error guardando manualMaxSongsPerTable', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo guardar el límite manual por mesa' });
  }
});

// aplicar un maxSongs global a todas las mesas
app.post('/api/admin/apply-max-songs-all-tables', adminApiLimiter, requireAdminToken, (req, res) => {
  const { maxSongs } = req.body || {};

  if (maxSongs == null) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }


  let val = parseInt(maxSongs, 10);
  if (Number.isNaN(val) || val < 1) val = 1;

  const stmt = db.prepare(`UPDATE tables SET maxSongs = ?`);
  stmt.run(val);

  return res.json({ ok: true, maxSongs: val });
});

// cambiar qué cola muestra la pantalla pública (ANTIGUO - mantener por compatibilidad)
app.post('/api/admin/change-public-queue-mode', adminApiLimiter, requireAdminToken, (req, res) => {
  const { publicQueueMode } = req.body || {};

  if (!publicQueueMode) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }


  const mode = publicQueueMode === 'manual' ? 'manual' : 'catalog';
  adminConfig.publicQueueMode = mode;

  try {
    saveAdminConfig();
    return res.json({ ok: true, publicQueueMode: mode });
  } catch (e) {
    console.error('Error guardando publicQueueMode', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo guardar el modo de cola pública' });
  }
});

// ========== NUEVO: Controlar qué cola mostrar en pantalla pública ==========
app.post('/api/admin/set-public-queue-display', adminApiLimiter, requireAdminToken, (req, res) => {
  const { publicQueueDisplay } = req.body || {};

  if (!publicQueueDisplay) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }


  // Validar que sea una opción válida
  if (!['catalog', 'manual', 'mixed'].includes(publicQueueDisplay)) {
    return res.status(400).json({ ok: false, message: 'Opción de cola inválida' });
  }

  adminConfig.publicQueueDisplay = publicQueueDisplay;

  try {
    saveAdminConfig();
    return res.json({
      ok: true,
      message: 'Preferencia de cola pública guardada',
      publicQueueDisplay: publicQueueDisplay
    });
  } catch (e) {
    console.error('Error guardando publicQueueDisplay', e);
    return res
      .status(500)
      .json({ ok: false, message: 'No se pudo guardar la preferencia de cola pública' });
  }
});

// ========== MINUTOS POR TURNO ==========
app.post('/api/admin/set-minutes-per-turn', adminApiLimiter, requireAdminToken, (req, res) => {
  const { minutesPerTurn } = req.body || {};

  let val = parseInt(minutesPerTurn, 10);
  if (Number.isNaN(val) || val < 1) val = 5;
  adminConfig.minutesPerTurn = val;
  try {
    saveAdminConfig();
    return res.json({ ok: true, minutesPerTurn: val });
  } catch (e) {
    console.error('Error guardando minutesPerTurn', e);
    return res.status(500).json({ ok: false, message: 'No se pudo guardar' });
  }
});

// ========== MENSAJE AL PÚBLICO ==========
app.post('/api/admin/change-public-message', adminApiLimiter, requireAdminToken, (req, res) => {
  const { newMessage } = req.body || {};

  adminConfig.publicMessage = typeof newMessage === 'string' ? newMessage.trim() : '';

  try {
    saveAdminConfig();
    return res.json({ ok: true, publicMessage: adminConfig.publicMessage });
  } catch (e) {
    console.error('Error guardando mensaje público', e);
    return res.status(500).json({ ok: false, message: 'No se pudo guardar el mensaje' });
  }
});

// ========== LOGIN USUARIO ==========
app.post('/api/user/login', loginLimiter, (req, res) => {
  const { name, table, password } = req.body;

  if (!name || !table || !password) {
    return res
      .status(400)
      .json({ ok: false, message: 'Faltan datos para iniciar sesión' });
  }

  if (exceedsMaxLength(name, 100) || exceedsMaxLength(table, 50)) {
    return res.status(400).json({ ok: false, message: 'Datos demasiado largos' });
  }

  if (!bcrypt.compareSync(password, adminConfig.userPassword)) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña de usuario incorrecta' });
  }

  if (!isTableAllowed(table)) {
    return res.status(400).json({
      ok: false,
      message: `La mesa ${table} no está registrada. Pide al administrador que la dé de alta.`
    });
  }

  return res.json({ ok: true });
});

// ========== CANCIONES (SQLite) ==========
function readSongsFromDb() {
  const stmt = db.prepare(`
    SELECT id, title, artist
    FROM songs
    ORDER BY artist ASC, title ASC
  `);
  return stmt.all();
}

function clearSongs() {
  const stmt = db.prepare(`DELETE FROM songs`);
  return stmt.run();
}

function insertSong(title, artist) {
  const stmt = db.prepare(`
    INSERT INTO songs (title, artist)
    VALUES (?, ?)
  `);
  return stmt.run(title, artist);
}

app.get('/api/songs', (req, res) => {
  const { artist = '', title = '' } = req.query;

  const termArtist = normalizeText(artist);
  const termTitle  = normalizeText(title);

  const all = readSongsFromDb();

  const filtered = all.filter(s => {
    const songArtistNorm = normalizeText(s.artist);
    const songTitleNorm  = normalizeText(s.title);

    const matchArtist = !termArtist || songArtistNorm.includes(termArtist);
    const matchTitle  = !termTitle  || songTitleNorm.includes(termTitle);

    return matchArtist && matchTitle;
  });

  res.json({ ok: true, songs: filtered });
});

const ALLOWED_EXCEL_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/octet-stream' // algunos navegadores envían este tipo para .xlsx
];
const EXCEL_MAX_SIZE_MB = 10;

const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: EXCEL_MAX_SIZE_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ALLOWED_EXCEL_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten archivos Excel (.xlsx, .xls)'));
    }
  }
});

const UPLOADS_DIR = path.resolve(path.join(__dirname, 'uploads'));

app.post('/api/songs/upload', uploadLimiter, requireAdminToken, upload.single('excel'), (req, res) => {
  // Construir la ruta segura usando path.basename para prevenir path traversal
  // (path.basename es reconocido por CodeQL como sanitizador de path injection)
  const safeFilePath = req.file
    ? path.join(UPLOADS_DIR, path.basename(req.file.path))
    : null;

  if (!req.file || !safeFilePath) {
    return res
      .status(400)
      .json({ ok: false, message: 'No se envió archivo' });
  }

  try {
    const workbook  = xlsx.readFile(safeFilePath);
    const sheetName = workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];

    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    clearSongs();

    let count = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const colA = row[0];
      const colB = row[1];

      if (!colA && !colB) continue;

      const title  = (colB || '').toString().slice(0, 200);
      const artist = (colA || '').toString().slice(0, 200);

      insertSong(title, artist);
      count++;
    }

    fs.unlinkSync(safeFilePath);

    console.log('Canciones cargadas desde Excel a SQLite:', count);
    res.json({ ok: true, count });
  } catch (e) {
    console.error('Error procesando Excel', e);
    res
      .status(500)
      .json({ ok: false, message: 'Error procesando Excel' });
  }
});

// ========== COLA / HISTORIAL (SQLite) ==========
function readQueueFromDb() {
  const stmt = db.prepare(`
    SELECT id, userName, tableNumber, songTitle, createdAt, highlightColor
    FROM queue
    ORDER BY id ASC
  `);
  return stmt.all();
}

function insertQueueItem(userName, tableNumber, songTitle) {
  const stmt = db.prepare(`
    INSERT INTO queue (userName, tableNumber, songTitle)
    VALUES (?, ?, ?)
  `);
  const info = stmt.run(userName, tableNumber, songTitle);
  return info.lastInsertRowid;
}

function updateQueueSong(id, songTitle) {
  const stmt = db.prepare(`
    UPDATE queue
    SET songTitle = ?
    WHERE id = ?
  `);
  return stmt.run(songTitle, id);
}

function deleteQueueItem(id) {
  const stmt = db.prepare(`
    DELETE FROM queue
    WHERE id = ?
  `);
  return stmt.run(id);
}

function clearQueue() {
  const stmt = db.prepare(`DELETE FROM queue`);
  return stmt.run();
}

function moveQueueItemToHistory(id) {
  const queue = readQueueFromDb();
  const index = queue.findIndex(q => q.id === id);
  if (index === -1) {
    return null;
  }
  const item = queue[index];

  const catalogPosition = index + 1;
  const catalogTotal    = queue.length;
  const queuePosition   = catalogPosition;
  const queueTotal      = catalogTotal;

  // Calcular posición en cola mixta (catálogo + manual ordenados por createdAt)
  const manualQueue = readManualQueueFromDb();
  const mixedAll = [
    ...queue.map(q => ({ ...q, _source: 'catalog' })),
    ...manualQueue.map(q => ({ ...q, _source: 'manual' }))
  ].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
  const mixedIndex    = mixedAll.findIndex(q => q._source === 'catalog' && q.id === item.id);
  const mixedPosition = mixedIndex >= 0 ? mixedIndex + 1 : null;
  const mixedTotal    = mixedAll.length;

  const playedAt = new Date().toISOString();

  const insertHistory = db.prepare(`
    INSERT INTO history (userName, tableNumber, songTitle, createdAt, playedAt,
      queuePosition, queueTotal,
      catalogPosition, catalogTotal,
      manualPosition, manualTotal,
      mixedPosition, mixedTotal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertHistory.run(
    item.userName,
    item.tableNumber,
    item.songTitle,
    item.createdAt,
    playedAt,
    queuePosition,
    queueTotal,
    catalogPosition,
    catalogTotal,
    null,
    null,
    mixedPosition,
    mixedTotal
  );

  deleteQueueItem(id);

  return { ...item, playedAt, queuePosition, queueTotal, catalogPosition, catalogTotal, manualPosition: null, manualTotal: null, mixedPosition, mixedTotal };
}

// ========== COLA MANUAL (helpers) ==========
function readManualQueueFromDb() {
  const stmt = db.prepare(`
    SELECT
      id,
      userName,
      tableNumber,
      songTitle,
      manualSongTitle,
      manualSongArtist,
      createdAt,
      highlightColor
    FROM manual_queue
    ORDER BY id ASC
  `);
  return stmt.all();
}

function insertManualQueueItem(
  userName,
  tableNumber,
  songTitle,
  manualSongTitle,
  manualSongArtist
) {
  const stmt = db.prepare(`
    INSERT INTO manual_queue (
      userName,
      tableNumber,
      songTitle,
      manualSongTitle,
      manualSongArtist
    )
    VALUES (?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    userName,
    tableNumber,
    songTitle,
    manualSongTitle || null,
    manualSongArtist || null
  );
  return info.lastInsertRowid;
}

function updateManualQueueItem(id, manualSongTitle, manualSongArtist) {
  const stmt = db.prepare(`
    UPDATE manual_queue
    SET
      manualSongTitle  = ?,
      manualSongArtist = ?
    WHERE id = ?
  `);
  return stmt.run(
    manualSongTitle || null,
    manualSongArtist || null,
    id
  );
}

function deleteManualQueueItem(id) {
  const stmt = db.prepare(`
    DELETE FROM manual_queue
    WHERE id = ?
  `);
  return stmt.run(id);
}

function clearManualQueue() {
  const stmt = db.prepare(`DELETE FROM manual_queue`);
  return stmt.run();
}

function updateQueueHighlightColor(id, color) {
  const stmt = db.prepare(`UPDATE queue SET highlightColor = ? WHERE id = ?`);
  return stmt.run(color || null, id);
}

function updateManualQueueHighlightColor(id, color) {
  const stmt = db.prepare(`UPDATE manual_queue SET highlightColor = ? WHERE id = ?`);
  return stmt.run(color || null, id);
}

// ======= NUEVOS HELPERS: total combinado y unicidad de persona =======

// total combinado por mesa (queue + manual_queue)
function getTotalActiveForTable(tableNumber) {
  const mesaNorm = normalizeText(String(tableNumber).trim());

  const q1 = readQueueFromDb().filter(
    item => normalizeText(String(item.tableNumber).trim()) === mesaNorm
  );
  const q2 = readManualQueueFromDb().filter(
    item => normalizeText(String(item.tableNumber).trim()) === mesaNorm
  );

  return q1.length + q2.length;
}

// verificar si un userName ya existe en cualquiera de las dos colas para esa mesa
function userExistsInAnyQueue(tableNumber, userName) {
  const mesaNorm = normalizeText(String(tableNumber).trim());
  const nameNorm = normalizeText(String(userName).trim());

  const q1 = readQueueFromDb().some(
    item =>
      normalizeText(String(item.tableNumber).trim()) === mesaNorm &&
      normalizeText(String(item.userName).trim()) === nameNorm
  );

  if (q1) return true;

  const q2 = readManualQueueFromDb().some(
    item =>
      normalizeText(String(item.tableNumber).trim()) === mesaNorm &&
      normalizeText(String(item.userName).trim()) === nameNorm
  );

  return q2;
}

// ====== ENDPOINTS DELETE PARA COLA CATÁLOGO ======
app.delete('/api/queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = moveQueueItemToHistory(id);
  if (!result) {
    // Item no encontrado, intentar borrar directamente por si acaso
    deleteQueueItem(id);
  }
  return res.json({ ok: true });
});

app.delete('/api/queue', adminApiLimiter, requireAdminToken, (req, res) => {
  clearQueue();
  return res.json({ ok: true });
});

function moveManualQueueItemToHistory(id) {
  const queue = readManualQueueFromDb();
  const index = queue.findIndex(q => q.id === id);
  if (index === -1) {
    return null;
  }
  const item = queue[index];

  const manualPosition = index + 1;
  const manualTotal    = queue.length;
  const queuePosition  = manualPosition;
  const queueTotal     = manualTotal;

  // Calcular posición en cola mixta (catálogo + manual ordenados por createdAt)
  const catalogQueue = readQueueFromDb();
  const mixedAll = [
    ...catalogQueue.map(q => ({ ...q, _source: 'catalog' })),
    ...queue.map(q => ({ ...q, _source: 'manual' }))
  ].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return ta - tb;
  });
  const mixedIndex    = mixedAll.findIndex(q => q._source === 'manual' && q.id === item.id);
  const mixedPosition = mixedIndex >= 0 ? mixedIndex + 1 : null;
  const mixedTotal    = mixedAll.length;

  const playedAt = new Date().toISOString();

  // Usar manualSongTitle como título en historial cuando esté disponible
  const songTitleForHistory = item.manualSongTitle || item.songTitle || '';

  const insertHistory = db.prepare(`
    INSERT INTO history (userName, tableNumber, songTitle, createdAt, playedAt,
      queuePosition, queueTotal,
      catalogPosition, catalogTotal,
      manualPosition, manualTotal,
      mixedPosition, mixedTotal)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  insertHistory.run(
    item.userName,
    item.tableNumber,
    songTitleForHistory,
    item.createdAt || new Date().toISOString(),
    playedAt,
    queuePosition,
    queueTotal,
    null,
    null,
    manualPosition,
    manualTotal,
    mixedPosition,
    mixedTotal
  );

  deleteManualQueueItem(id);

  return { ...item, playedAt, queuePosition, queueTotal, catalogPosition: null, catalogTotal: null, manualPosition, manualTotal, mixedPosition, mixedTotal };
}

// ====== ENDPOINTS DELETE PARA COLA MANUAL ======
app.delete('/api/manual-queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const result = moveManualQueueItemToHistory(id);
  if (!result) {
    // Item no encontrado, intentar borrar directamente por si acaso
    deleteManualQueueItem(id);
  }
  return res.json({ ok: true });
});

app.delete('/api/manual-queue', adminApiLimiter, requireAdminToken, (req, res) => {
  clearManualQueue();
  return res.json({ ok: true });
});

// ====== ENDPOINT HIGHLIGHT COLOR (COLA CATÁLOGO) ======
app.put('/api/queue/:id/highlight-color', (req, res) => {
  const id = Number(req.params.id);
  const rawColor = (req.body || {}).color;
  const color = rawColor === 'green' || rawColor === 'orange' ? rawColor : null;
  updateQueueHighlightColor(id, color);
  return res.json({ ok: true });
});

// ====== ENDPOINT HIGHLIGHT COLOR (COLA MANUAL) ======
app.put('/api/manual-queue/:id/highlight-color', (req, res) => {
  const id = Number(req.params.id);
  const rawColor = (req.body || {}).color;
  const color = rawColor === 'green' || rawColor === 'orange' ? rawColor : null;
  updateManualQueueHighlightColor(id, color);
  return res.json({ ok: true });
});

// ========== API COLA PRINCIPAL (CATÁLOGO) ==========
app.get('/api/queue', (req, res) => {
  const q = readQueueFromDb();
  res.json({ ok: true, queue: q });
});

app.post('/api/queue', (req, res) => {
  if (!adminConfig.isQueueOpen) {
    return res.status(403).json({
      ok: false,
      message: 'El horario para ingresar canciones ha concluido'
    });
  }

  const { userName, tableNumber, songTitle } = req.body;
  if (!userName || !tableNumber || !songTitle) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  if (exceedsMaxLength(userName, 100) || exceedsMaxLength(String(tableNumber), 50) || exceedsMaxLength(songTitle, 200)) {
    return res.status(400).json({ ok: false, message: 'Datos demasiado largos' });
  }

  if (!isTableAllowed(tableNumber)) {
    return res.status(400).json({
      ok: false,
      message: `La mesa ${tableNumber} no está registrada. Pide al administrador que la dé de alta.`
    });
  }

  const mesaStr     = String(tableNumber).trim();
  const userNameStr = String(userName).trim();

  const mesaConfig = getTableConfig(mesaStr);
  const maxSongs = mesaConfig && mesaConfig.maxSongs ? mesaConfig.maxSongs : 1;

  // total combinado catálogo + manual (antes de insertar)
  const totalForTable = getTotalActiveForTable(mesaStr);

  if (totalForTable >= maxSongs) {
    return res.status(400).json({
      ok: false,
      message:
        `Tu mesa (${mesaStr}) ya tiene ${maxSongs} participante(s) registrados (sumando registro por selección y registro manual).\n\n` +
        'Primero deben cantar todas las personas de tu mesa que ya están en la cola ' +
        'y el administrador debe eliminarlas de la lista antes de poder registrar nuevas canciones.'
    });
  }

  // unicidad de persona por mesa en ambas colas
  if (userExistsInAnyQueue(mesaStr, userNameStr)) {
    return res.status(400).json({
      ok: false,
      message:
        `En la mesa ${mesaStr}, la persona "${userNameStr}" ya tiene una canción registrada ` +
        '(ya sea por selección o registro manual). Debe ser otra persona distinta de esa mesa.'
    });
  }

  const id = insertQueueItem(userNameStr, mesaStr, songTitle);

  // recalc total para mensaje amigable
  const totalAfterInsert = getTotalActiveForTable(mesaStr);
  const restantes = Math.max(maxSongs - totalAfterInsert, 0);

  return res.json({
    ok: true,
    id,
    maxSongs,
    totalAfterInsert, // <- IMPORTANTE para el front
    message:
      restantes > 0
        ? `Registro exitoso. Tu mesa (${mesaStr}) puede registrar todavía ${restantes} participante(s) más.`
        : `Registro exitoso. Tu mesa (${mesaStr}) ha alcanzado el máximo de ${maxSongs} participante(s) en la cola.`
  });
});

app.put('/api/queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const { songTitle } = req.body || {};

  if (!songTitle) {
    return res.status(400).json({ ok: false, message: 'Falta songTitle' });
  }

  const queue = readQueueFromDb();
  const item = queue.find(q => q.id === id);

  if (!item) {
    return res.status(404).json({ ok: false, message: 'Canción no encontrada' });
  }

  updateQueueSong(id, songTitle.trim());

  return res.json({
    ok: true,
    item: {
      ...item,
      songTitle: songTitle.trim()
    }
  });
});

// ========== COLA MANUAL ==========
app.get('/api/manual-queue', (req, res) => {
  const q = readManualQueueFromDb();
  res.json({ ok: true, queue: q });
});

app.post('/api/manual-queue', (req, res) => {
  const {
    userName,
    tableNumber,
    songTitle,
    manualSongTitle,
    manualSongArtist
  } = req.body;

  if (!userName || !tableNumber || !songTitle) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  if (
    exceedsMaxLength(userName, 100) ||
    exceedsMaxLength(String(tableNumber), 50) ||
    exceedsMaxLength(songTitle, 200) ||
    exceedsMaxLength(manualSongTitle, 200) ||
    exceedsMaxLength(manualSongArtist, 200)
  ) {
    return res.status(400).json({ ok: false, message: 'Datos demasiado largos' });
  }

  if (!isTableAllowed(tableNumber)) {
    return res.status(400).json({
      ok: false,
      message: `La mesa ${tableNumber} no está registrada. Pide al administrador que la dé de alta.`
    });
  }

  const mesaStr     = String(tableNumber).trim();
  const userNameStr = String(userName).trim();
  const mesaNorm    = normalizeText(mesaStr);

  const mesaConfig = getTableConfig(mesaStr);
  const maxSongs = mesaConfig && mesaConfig.maxSongs ? mesaConfig.maxSongs : 1;

  // total combinado catálogo + manual (antes de insertar)
  const totalForTable = getTotalActiveForTable(mesaStr);

  if (totalForTable >= maxSongs) {
    return res.status(400).json({
      ok: false,
      message:
        `Tu mesa (${mesaStr}) ya tiene ${maxSongs} participante(s) registrados (sumando registro por selección y registro manual).\n\n` +
        'Primero deben cantar todas las personas de tu mesa que ya están en la cola ' +
        'y el administrador debe eliminarlas de la lista antes de poder registrar nuevas canciones.'
    });
  }

  // unicidad de persona por mesa en ambas colas
  if (userExistsInAnyQueue(mesaStr, userNameStr)) {
    return res.status(400).json({
      ok: false,
      message:
        `En la mesa ${mesaStr}, la persona "${userNameStr}" ya tiene una canción registrada ` +
        '(ya sea por selección o registro manual). Debe ser otra persona distinta de esa mesa.'
    });
  }

  const currentQueue = readManualQueueFromDb();

  const sameTableItems = currentQueue.filter(
    item =>
      normalizeText(String(item.tableNumber).trim()) === mesaNorm
  );

  // (esta parte ya está cubierta por userExistsInAnyQueue, pero la dejo por compatibilidad)
  const sameNameInTable = sameTableItems.some(item =>
    normalizeText(String(item.userName).trim()) ===
    normalizeText(userNameStr)
  );

  if (sameNameInTable) {
    return res.status(400).json({
      ok: false,
      message: `En la mesa ${mesaStr}, la persona "${userNameStr}" ya registró una canción manual. Debe ser otra persona de esa mesa.`
    });
  }

  const songTitleStr    = String(songTitle).trim();
  const manualTitleStr  = manualSongTitle  ? String(manualSongTitle).trim()  : null;
  const manualArtistStr = manualSongArtist ? String(manualSongArtist).trim() : null;

  const id = insertManualQueueItem(
    userNameStr,
    mesaStr,
    songTitleStr,
    manualTitleStr,
    manualArtistStr
  );

  // recalc total para mensaje amigable
  const totalAfterInsert = getTotalActiveForTable(mesaStr);
  const restantes = Math.max(maxSongs - totalAfterInsert, 0);

  return res.json({
    ok: true,
    id,
    maxSongs,
    totalAfterInsert, // <- IMPORTANTE para el front
    message:
      restantes > 0
        ? `Registro exitoso. Tu mesa (${mesaStr}) puede registrar todavía ${restantes} participante(s) más.`
        : `Registro exitoso. Tu mesa (${mesaStr}) ha alcanzado el máximo de ${maxSongs} participante(s) en la cola.`
  });
});

app.put('/api/manual-queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const { manualSongTitle, manualSongArtist } = req.body || {};

  if (!manualSongTitle || !manualSongArtist) {
    return res
      .status(400)
      .json({ ok: false, message: 'Faltan título o intérprete manual' });
  }

  const currentQueue = readManualQueueFromDb();
  const item = currentQueue.find(q => q.id === id);

  if (!item) {
    return res
      .status(404)
      .json({ ok: false, message: 'Registro no encontrado en la cola manual' });
  }

  updateManualQueueItem(id, manualSongTitle.trim(), manualSongArtist.trim());

  return res.json({
    ok: true,
    item: {
      ...item,
      manualSongTitle: manualSongTitle.trim(),
      manualSongArtist: manualSongArtist.trim()
    }
  });
});

// ========== COLA MIXTA (CATÁLOGO + MANUAL) ==========
app.get('/api/mixed-queue', (req, res) => {
  try {
    const catalogQueue = readQueueFromDb();
    const manualQueue  = readManualQueueFromDb();

    const catalogItems = (catalogQueue || []).map(item => ({
      id: item.id,
      tableNumber: item.tableNumber,
      userName: item.userName,
      displaySongTitle:  item.songTitle,
      displaySongArtist: '',
      source: 'catalog',
      highlightColor: item.highlightColor || null,
      createdAt: item.createdAt || new Date().toISOString()
    }));

    const manualItems = (manualQueue || []).map(item => ({
      id: item.id,
      tableNumber: item.tableNumber,
      userName: item.userName,
      displaySongTitle:  item.manualSongTitle  || item.songTitle || '',
      displaySongArtist: item.manualSongArtist || '',
      source: 'manual',
      highlightColor: item.highlightColor || null,
      createdAt: item.createdAt || new Date().toISOString()
    }));

    const mixed = [...catalogItems, ...manualItems].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return (ta || 0) - (tb || 0);
    });

    return res.json({ ok: true, queue: mixed });
  } catch (e) {
    console.error('Error construyendo cola mixta:', e);
    return res.status(500).json({
      ok: false,
      message: 'Error al construir la cola mixta'
    });
  }
});

// BORRAR TODA LA COLA MIXTA (queue + manual_queue)
app.delete('/api/mixed-queue', adminApiLimiter, requireAdminToken, (req, res) => {
  try {
    clearQueue();
    clearManualQueue();
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error limpiando cola mixta', e);
    return res
      .status(500)
      .json({ ok: false, message: 'Error al limpiar la cola mixta' });
  }
});

// ========== HISTORIAL ==========
app.get('/api/history', (req, res) => {
  const { table } = req.query;

  let stmt;
  let rows;

  if (table) {
    const mesaNorm = normalizeText(String(table).trim());
    stmt = db.prepare(`
      SELECT id, userName, tableNumber, songTitle, createdAt, playedAt,
        queuePosition, queueTotal,
        catalogPosition, catalogTotal,
        manualPosition, manualTotal,
        mixedPosition, mixedTotal
      FROM history
    `);
    const all = stmt.all();
    rows = all.filter(h => normalizeText(h.tableNumber) === mesaNorm);
  } else {
    stmt = db.prepare(`
      SELECT id, userName, tableNumber, songTitle, createdAt, playedAt,
        queuePosition, queueTotal,
        catalogPosition, catalogTotal,
        manualPosition, manualTotal,
        mixedPosition, mixedTotal
      FROM history
      ORDER BY datetime(playedAt) DESC
    `);
    rows = stmt.all();
  }

  res.json({ ok: true, history: rows });
});

app.get('/api/history/export', (req, res) => {
  const stmt = db.prepare(`
    SELECT userName, tableNumber, songTitle, createdAt, playedAt,
      queuePosition, queueTotal,
      catalogPosition, catalogTotal,
      manualPosition, manualTotal,
      mixedPosition, mixedTotal
    FROM history
    ORDER BY datetime(playedAt) DESC
  `);
  const rows = stmt.all();

  let csv =
    'userName,tableNumber,songTitle,createdAt,playedAt,queuePosition,queueTotal,catalogPosition,catalogTotal,manualPosition,manualTotal,mixedPosition,mixedTotal\n';
  for (const r of rows) {
    const createdDate = r.createdAt ? new Date(r.createdAt) : null;
    const playedDate  = r.playedAt  ? new Date(r.playedAt)  : null;

    const createdStr = createdDate
      ? createdDate.toLocaleString('es-MX', { hour12: false })
      : '';
    const playedStr = playedDate
      ? playedDate.toLocaleString('es-MX', { hour12: false })
      : '';

    const user   = `"${(r.userName || '').replace(/"/g, '""')}"`;
    const table  = `"${(r.tableNumber || '').replace(/"/g, '""')}"`;
    const song   = `"${(r.songTitle || '').replace(/"/g, '""')}"`;
    const created = `"${createdStr.replace(/"/g, '""')}"`;
    const played  = `"${playedStr.replace(/"/g, '""')}"`;
    const pos           = r.queuePosition    != null ? r.queuePosition    : '';
    const total         = r.queueTotal       != null ? r.queueTotal       : '';
    const catalogPos    = r.catalogPosition  != null ? r.catalogPosition  : '';
    const catalogTot    = r.catalogTotal     != null ? r.catalogTotal     : '';
    const manualPos     = r.manualPosition   != null ? r.manualPosition   : '';
    const manualTot     = r.manualTotal      != null ? r.manualTotal      : '';
    const mixedPos      = r.mixedPosition    != null ? r.mixedPosition    : '';
    const mixedTot      = r.mixedTotal       != null ? r.mixedTotal       : '';

    csv += `${user},${table},${song},${created},${played},${pos},${total},${catalogPos},${catalogTot},${manualPos},${manualTot},${mixedPos},${mixedTot}\n`;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="historial_karaoke.csv"'
  );
  res.send(csv);
});

// Borrar todo el historial
app.delete('/api/history', adminApiLimiter, requireAdminToken, (req, res) => {
  const stmt = db.prepare(`DELETE FROM history`);
  stmt.run();
  res.json({ ok: true });
});

// ========== SUGERENCIAS DE CANCIONES ==========
function insertSongSuggestion(title, artist, userName, tableNumber) {
  const stmt = db.prepare(`
    INSERT INTO song_suggestions (title, artist, userName, tableNumber, createdAt)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
  `);
  const info = stmt.run(title, artist, userName, tableNumber);
  return info.lastInsertRowid;
}

function readSongSuggestions() {
  const stmt = db.prepare(`
    SELECT id, title, artist, userName, tableNumber, createdAt
    FROM song_suggestions
    ORDER BY datetime(createdAt) DESC
  `);
  return stmt.all();
}

function deleteSongSuggestion(id) {
  const stmt = db.prepare(`
    DELETE FROM song_suggestions
    WHERE id = ?
  `);
  return stmt.run(id);
}

app.post('/api/song-suggestions', (req, res) => {
  try {
    const { title, artist, userName, tableNumber } = req.body;

    if (!title || !artist) {
      return res
        .status(400)
        .json({ ok: false, message: 'Faltan título o intérprete' });
    }

    if (
      exceedsMaxLength(title, 200) ||
      exceedsMaxLength(artist, 200) ||
      exceedsMaxLength(userName, 100) ||
      exceedsMaxLength(tableNumber, 50)
    ) {
      return res.status(400).json({ ok: false, message: 'Datos demasiado largos' });
    }

    const id = insertSongSuggestion(
      title,
      artist,
      userName || null,
      tableNumber || null
    );

    console.log('Nueva sugerencia registrada:', {
      id,
      title,
      artist,
      userName,
      tableNumber
    });

    return res.json({ ok: true, id });
  } catch (e) {
    console.error('Error al guardar sugerencia', e);
    return res
      .status(500)
      .json({ ok: false, message: 'Error al guardar la sugerencia' });
  }
});

app.get('/api/song-suggestions', (req, res) => {
  try {
    const suggestions = readSongSuggestions();
    return res.json({ ok: true, suggestions });
  } catch (e) {
    console.error('Error leyendo sugerencias', e);
    return res
      .status(500)
      .json({ ok: false, message: 'Error al leer sugerencias' });
  }
});

app.delete('/api/song-suggestions/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    deleteSongSuggestion(id);
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error eliminando sugerencia', e);
    return res
      .status(500)
      .json({ ok: false, message: 'Error al eliminar sugerencia' });
  }
});

app.delete('/api/song-suggestions', adminApiLimiter, requireAdminToken, (req, res) => {
  try {
    const stmt = db.prepare(`DELETE FROM song_suggestions`);
    stmt.run();
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error limpiando sugerencias', e);
    return res
      .status(500)
      .json({ ok: false, message: 'Error al limpiar sugerencias' });
  }
});

app.get('/api/song-suggestions/export', (req, res) => {
  try {
    const rows = readSongSuggestions();

    let csv = 'id,title,artist,userName,tableNumber,createdAt\n';

    for (const r of rows) {
      const id        = r.id != null ? r.id : '';
      const title     = (r.title       || '').replace(/"/g, '""');
      const artist    = (r.artist      || '').replace(/"/g, '""');
      const userName  = (r.userName    || '').replace(/"/g, '""');
      const tableNum  = (r.tableNumber || '').replace(/"/g, '""');
      const createdAt = (r.createdAt   || '').replace(/"/g, '""');

      csv += `${id},"${title}","${artist}","${userName}","${tableNum}","${createdAt}"\n`;
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="sugerencias_canciones.csv"'
    );
    res.send(csv);
  } catch (e) {
    console.error('Error exportando sugerencias', e);
    res
      .status(500)
      .json({ ok: false, message: 'Error al exportar sugerencias' });
  }
});

// ========== ARRANQUE ==========
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});