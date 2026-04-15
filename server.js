const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');


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
    tableNumber TEXT NOT NULL UNIQUE
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
// ===== FIN SQLITE =====

const app = express();
const PORT = process.env.PORT || 3000;

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

// ========== CONFIG ADMIN / USUARIO ==========
const adminConfigPath = path.join(__dirname, 'adminConfig.json');

let adminConfig = {
  adminPassword: '1234',
  userPassword: '1234',
  qrImageFile: 'qr-dia.png',
  appTitle: 'Karaoke', // título por defecto (nombre del bar)
  isQueueOpen: true    // NUEVO: controla si se pueden registrar canciones
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
} catch (e) {}

function saveAdminConfig() {
  fs.writeFileSync(
    adminConfigPath,
    JSON.stringify(adminConfig, null, 2),
    'utf8'
  );
}

// Info pública del día: contraseña de usuario, QR y título
app.get('/api/public-info', (req, res) => {
  res.json({
    ok: true,
    userPassword: adminConfig.userPassword,
    qrImageFile: adminConfig.qrImageFile || null,
    appTitle: adminConfig.appTitle || 'Karaoke',
    isQueueOpen: adminConfig.isQueueOpen // NUEVO: para que el front pueda saberlo
  });
});

// Cambiar nombre de archivo de QR público (aún disponible si lo usas)
app.post('/api/admin/set-qr-file', (req, res) => {
  const { adminPassword, qrImageFile } = req.body;
  if (!adminPassword || !qrImageFile) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }
  if (adminPassword !== adminConfig.adminPassword) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña de administrador incorrecta' });
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

// ===== NUEVO: subida directa de imagen de QR desde admin =====

// carpeta donde guardamos el QR: public/qr/qr.png
const qrFolder = path.join(__dirname, 'public', 'qr');
if (!fs.existsSync(qrFolder)) {
  fs.mkdirSync(qrFolder, { recursive: true });
}

// storage de multer: siempre escribe qr.png
const qrStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, qrFolder);
  },
  filename: (req, file, cb) => {
    cb(null, 'qr.png');
  }
});

const uploadQr = multer({ storage: qrStorage });

// endpoint protegido lógicamente por el frontend (usa adminLogged en el cliente)
app.post('/api/admin/upload-qr', uploadQr.single('qr'), (req, res) => {
  try {
    // actualizamos la config para que /api/public-info sepa que el archivo es qr.png
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
    SELECT id, tableNumber
    FROM tables
    ORDER BY id ASC
  `);
  return stmt.all();
}

function insertTable(tableNumber) {
  const stmt = db.prepare(`
    INSERT INTO tables (tableNumber)
    VALUES (?)
  `);
  const info = stmt.run(tableNumber);
  return info.lastInsertRowid;
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

app.post('/api/tables', (req, res) => {
  const { tableNumber } = req.body;
  if (!tableNumber) {
    return res
      .status(400)
      .json({ ok: false, message: 'Falta el número de mesa' });
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

  const id = insertTable(mesaOriginal);
  res.json({ ok: true, id });
});

app.delete('/api/tables/:id', (req, res) => {
  const id = Number(req.params.id);
  deleteTable(id);
  res.json({ ok: true });
});

app.delete('/api/tables', (req, res) => {
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

// ========== ADMIN ==========
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password === adminConfig.adminPassword) {
    return res.json({ ok: true });
  }
  return res
    .status(401)
    .json({ ok: false, message: 'Contraseña incorrecta' });
});

app.post('/api/admin/change-password', (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }
  if (oldPassword !== adminConfig.adminPassword) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña actual incorrecta' });
  }

  adminConfig.adminPassword = newPassword;

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

app.post('/api/admin/change-user-password', (req, res) => {
  const { adminPassword, newUserPassword } = req.body;

  if (!adminPassword || !newUserPassword) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  if (adminPassword !== adminConfig.adminPassword) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña de administrador incorrecta' });
  }

  adminConfig.userPassword = newUserPassword;

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

// NUEVO: cambiar título de la aplicación (nombre del bar)
app.post('/api/admin/change-app-title', (req, res) => {
  const { adminPassword, newTitle } = req.body;

  if (!adminPassword || !newTitle) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  if (adminPassword !== adminConfig.adminPassword) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña de administrador incorrecta' });
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

// NUEVO: abrir/cerrar el registro de canciones
app.post('/api/admin/set-queue-open', (req, res) => {
  const { adminPassword, isQueueOpen } = req.body || {};

  if (!adminPassword || typeof isQueueOpen !== 'boolean') {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  if (adminPassword !== adminConfig.adminPassword) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña de administrador incorrecta' });
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

// ========== LOGIN USUARIO ==========
app.post('/api/user/login', (req, res) => {
  const { name, table, password } = req.body;

  if (!name || !table || !password) {
    return res
      .status(400)
      .json({ ok: false, message: 'Faltan datos para iniciar sesión' });
  }

  if (password !== adminConfig.userPassword) {
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

    const matchArtist =
      !termArtist || songArtistNorm.includes(termArtist);
    const matchTitle  =
      !termTitle  || songTitleNorm.includes(termTitle);

    return matchArtist && matchTitle;
  });

  res.json({ ok: true, songs: filtered });
});

const upload = multer({ dest: 'uploads/' });

app.post('/api/songs/upload', upload.single('excel'), (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ ok: false, message: 'No se envió archivo' });
  }

  try {
    const workbook  = xlsx.readFile(req.file.path);
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

      const title  = (colB || '').toString();
      const artist = (colA || '').toString();

      insertSong(title, artist);
      count++;
    }

    fs.unlinkSync(req.file.path);

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
    SELECT id, userName, tableNumber, songTitle, createdAt
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

// mover de cola a historial, guardando posición y total en cola
function moveQueueItemToHistory(id) {
  const queue = readQueueFromDb();
  const index = queue.findIndex(q => q.id === id);
  if (index === -1) {
    return null;
  }
  const item = queue[index];

  const queuePosition = index + 1;
  const queueTotal    = queue.length;

  const playedAt = new Date().toISOString();

  const insertHistory = db.prepare(`
    INSERT INTO history (userName, tableNumber, songTitle, createdAt, playedAt, queuePosition, queueTotal)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  insertHistory.run(
    item.userName,
    item.tableNumber,
    item.songTitle,
    item.createdAt,
    playedAt,
    queuePosition,
    queueTotal
  );

  deleteQueueItem(id);

  return { ...item, playedAt, queuePosition, queueTotal };
}

// API cola
app.get('/api/queue', (req, res) => {
  const q = readQueueFromDb();
  res.json({ ok: true, queue: q });
});

app.post('/api/queue', (req, res) => {
  // NUEVO: bloquear registros si el admin cerró el horario
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

  if (!isTableAllowed(tableNumber)) {
    return res.status(400).json({
      ok: false,
      message: `La mesa ${tableNumber} no está registrada. Pide al administrador que la dé de alta.`
    });
  }

  const mesaStr = String(tableNumber).trim();

  const currentQueue = readQueueFromDb();
  const existeMesa = currentQueue.some(
    item =>
      normalizeText(String(item.tableNumber).trim()) ===
      normalizeText(mesaStr)
  );
  console.log('Intento mesa:', mesaStr, 'Existe ya:', existeMesa);

  if (existeMesa) {
    return res.status(400).json({
      ok: false,
      message: `La mesa ${mesaStr} ya está registrada en la cola. En tu mesa se podrá pedir una nueva canción hasta después de que pase su turno.`
    });
  }

  const id = insertQueueItem(userName, mesaStr, songTitle);
  res.json({ ok: true, id });
});

app.put('/api/queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const { songTitle } = req.body;

  if (!songTitle) {
    return res
      .status(400)
      .json({ ok: false, message: 'Falta el título de la canción' });
  }

  const currentQueue = readQueueFromDb();
  const item = currentQueue.find(q => q.id === id);

  if (!item) {
    return res
      .status(404)
      .json({ ok: false, message: 'Registro no encontrado en la cola' });
  }

  updateQueueSong(id, songTitle);

  return res.json({
    ok: true,
    item: { ...item, songTitle }
  });
});

app.delete('/api/queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const moved = moveQueueItemToHistory(id);

  if (!moved) {
    return res
      .status(404)
      .json({ ok: false, message: 'Registro no encontrado en la cola' });
  }

  res.json({ ok: true, historyItem: moved });
});

app.delete('/api/queue', (req, res) => {
  clearQueue();
  res.json({ ok: true });
});

// ========== HISTORIAL: LISTAR / EXPORTAR / LIMPIAR ==========
app.get('/api/history', (req, res) => {
  const { table } = req.query;

  let stmt;
  let rows;

  if (table) {
    const mesaNorm = normalizeText(String(table).trim());
    stmt = db.prepare(`
      SELECT id, userName, tableNumber, songTitle, createdAt, playedAt, queuePosition, queueTotal
      FROM history
    `);
    const all = stmt.all();
    rows = all.filter(h => normalizeText(h.tableNumber) === mesaNorm);
  } else {
    stmt = db.prepare(`
      SELECT id, userName, tableNumber, songTitle, createdAt, playedAt, queuePosition, queueTotal
      FROM history
      ORDER BY datetime(playedAt) DESC
    `);
    rows = stmt.all();
  }

  res.json({ ok: true, history: rows });
});

app.get('/api/history/export', (req, res) => {
  const stmt = db.prepare(`
    SELECT userName, tableNumber, songTitle, createdAt, playedAt, queuePosition, queueTotal
    FROM history
    ORDER BY datetime(playedAt) DESC
  `);
  const rows = stmt.all();

  let csv =
    'userName,tableNumber,songTitle,createdAt,playedAt,queuePosition,queueTotal\n';
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
    const pos    = r.queuePosition != null ? r.queuePosition : '';
    const total  = r.queueTotal    != null ? r.queueTotal    : '';

    csv += `${user},${table},${song},${created},${played},${pos},${total}\n`;
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    'attachment; filename="historial_karaoke.csv"'
  );
  res.send(csv);
});

// Borrar todo el historial
app.delete('/api/history', (req, res) => {
  const stmt = db.prepare(`DELETE FROM history`);
  stmt.run();
  res.json({ ok: true });
});

// ========== SUGERENCIAS DE CANCIONES ==========

// helper para insertar sugerencia
function insertSongSuggestion(title, artist, userName, tableNumber) {
  const stmt = db.prepare(`
    INSERT INTO song_suggestions (title, artist, userName, tableNumber, createdAt)
    VALUES (?, ?, ?, ?, datetime('now', 'localtime'))
  `);
  const info = stmt.run(title, artist, userName, tableNumber);
  return info.lastInsertRowid;
}

// helper para leer sugerencias
function readSongSuggestions() {
  const stmt = db.prepare(`
    SELECT id, title, artist, userName, tableNumber, createdAt
    FROM song_suggestions
    ORDER BY datetime(createdAt) DESC
  `);
  return stmt.all();
}

// helper para borrar sugerencia
function deleteSongSuggestion(id) {
  const stmt = db.prepare(`
    DELETE FROM song_suggestions
    WHERE id = ?
  `);
  return stmt.run(id);
}

// endpoint que usa el frontend de usuario
app.post('/api/song-suggestions', (req, res) => {
  try {
    const { title, artist, userName, tableNumber } = req.body;

    if (!title || !artist) {
      return res
        .status(400)
        .json({ ok: false, message: 'Faltan título o intérprete' });
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

// Lista de sugerencias para el panel admin
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

// Eliminar una sugerencia individual
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

// Eliminar TODAS las sugerencias (para el botón "Eliminar todas" en admin)
app.delete('/api/song-suggestions', (req, res) => {
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

// Exportar sugerencias a CSV
app.get('/api/song-suggestions/export', (req, res) => {
  try {
    const rows = readSongSuggestions();

    let csv = 'id,title,artist,userName,tableNumber,createdAt\n';

    for (const r of rows) {
      const id       = r.id != null ? r.id : '';
      const title    = (r.title       || '').replace(/"/g, '""');
      const artist   = (r.artist      || '').replace(/"/g, '""');
      const userName = (r.userName    || '').replace(/"/g, '""');
      const tableNum = (r.tableNumber || '').replace(/"/g, '""');
      const createdAt= (r.createdAt   || '').replace(/"/g, '""');

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