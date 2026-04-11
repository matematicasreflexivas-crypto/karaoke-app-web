const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CORS PARA NETLIFY Y LOCAL =====
const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5500',
  'https://inquisitive-kleicha-9811a1.netlify.app'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));

app.options('*', cors());

// ===== MIDDLEWARES BÁSICOS =====
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ========== CONFIG ADMIN / USUARIO ==========

/**
 * Estructura esperada de adminConfig.json:
 * {
 *   "adminPassword": "1234",
 *   "userPassword": "1234"
 * }
 */
const adminConfigPath = path.join(__dirname, 'adminConfig.json');

// Valores por defecto en memoria, por si no existe el archivo
let adminConfig = {
  adminPassword: '1234',
  userPassword: '1234'
};

try {
  const cfg = fs.readFileSync(adminConfigPath, 'utf8');
  const parsed = JSON.parse(cfg);

  // Aseguramos que existan ambos campos con fallback a '1234'
  adminConfig.adminPassword = parsed.adminPassword || '1234';
  adminConfig.userPassword  = parsed.userPassword  || '1234';
} catch (e) {
  // Si no existe o está mal formado, usamos los valores por defecto
}

// Helper para guardar adminConfig en disco
function saveAdminConfig() {
  fs.writeFileSync(
    adminConfigPath,
    JSON.stringify(adminConfig, null, 2),
    'utf8'
  );
}

// ========== SISTEMA DE MESAS PERMITIDAS ==========

const tablesPath = path.join(__dirname, 'tables.json');

function readTables() {
  try {
    const raw = fs.readFileSync(tablesPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    // Si no existe, arrancamos con arreglo vacío
    return [];
  }
}

function writeTables(tables) {
  fs.writeFileSync(tablesPath, JSON.stringify(tables, null, 2), 'utf8');
}

// Listar mesas permitidas
app.get('/api/tables', (req, res) => {
  const tables = readTables();
  res.json({ ok: true, tables });
});

// Agregar mesa permitida
app.post('/api/tables', (req, res) => {
  const { tableNumber } = req.body;
  if (!tableNumber) {
    return res.status(400).json({ ok: false, message: 'Falta el número de mesa' });
  }

  const tables = readTables();
  const mesaStr = String(tableNumber).trim();

  // Ver si ya existe esa mesa
  const exists = tables.some(t => String(t.tableNumber).trim() === mesaStr);
  if (exists) {
    return res
      .status(400)
      .json({ ok: false, message: `La mesa ${mesaStr} ya está registrada` });
  }

  const id = tables.length ? tables[tables.length - 1].id + 1 : 1;
  tables.push({ id, tableNumber: mesaStr });
  writeTables(tables);

  res.json({ ok: true, id });
});

// Eliminar mesa permitida (una sola)
app.delete('/api/tables/:id', (req, res) => {
  const id = Number(req.params.id);
  const tables = readTables();
  const newTables = tables.filter(t => t.id !== id);
  writeTables(newTables);
  res.json({ ok: true });
});

// Eliminar TODAS las mesas
app.delete('/api/tables', (req, res) => {
  writeTables([]);
  res.json({ ok: true });
});

// Helper: verificar si una mesa está permitida
function isTableAllowed(tableNumber) {
  const tables = readTables();
  const mesaStr = String(tableNumber).trim();
  return tables.some(t => String(t.tableNumber).trim() === mesaStr);
}

// ========== ENDPOINTS ADMIN ==========

// Login admin
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  console.log(
    'Password admin enviada:',
    password,
    'Password admin guardada:',
    adminConfig.adminPassword
  );

  if (password === adminConfig.adminPassword) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, message: 'Contraseña incorrecta' });
});

// Cambiar contraseña admin
app.post('/api/admin/change-password', (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }
  if (oldPassword !== adminConfig.adminPassword) {
    return res.status(401).json({ ok: false, message: 'Contraseña actual incorrecta' });
  }

  adminConfig.adminPassword = newPassword;

  try {
    saveAdminConfig();
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando nueva contraseña de admin', e);
    return res.status(500).json({ ok: false, message: 'No se pudo guardar la nueva contraseña' });
  }
});

// Cambiar contraseña de usuario
app.post('/api/admin/change-user-password', (req, res) => {
  const { adminPassword, newUserPassword } = req.body;

  if (!adminPassword || !newUserPassword) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  if (adminPassword !== adminConfig.adminPassword) {
    return res.status(401).json({ ok: false, message: 'Contraseña de administrador incorrecta' });
  }

  adminConfig.userPassword = newUserPassword;

  try {
    saveAdminConfig();
    return res.json({ ok: true });
  } catch (e) {
    console.error('Error guardando nueva contraseña de usuario', e);
    return res.status(500).json({ ok: false, message: 'No se pudo guardar la nueva contraseña de usuario' });
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

  // Validar contraseña de usuario
  if (password !== adminConfig.userPassword) {
    return res
      .status(401)
      .json({ ok: false, message: 'Contraseña de usuario incorrecta' });
  }

  // Validar que la mesa exista en la lista de mesas permitidas
  if (!isTableAllowed(table)) {
    return res
      .status(400)
      .json({
        ok: false,
        message: `La mesa ${table} no está registrada. Pide al administrador que la dé de alta.`
      });
  }

  return res.json({ ok: true });
});

// ========== CANCIONES ==========
const songsPath = path.join(__dirname, 'songs.json');

function readSongs() {
  try {
    const raw = fs.readFileSync(songsPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

// Buscar canciones
app.get('/api/songs', (req, res) => {
  const { artist = '', title = '' } = req.query;
  const all = readSongs();

  const termArtist = artist.toLowerCase();
  const termTitle  = title.toLowerCase();

  const filtered = all.filter(s =>
    (!termArtist || (s.artist && s.artist.toLowerCase().includes(termArtist))) &&
    (!termTitle  || (s.title  && s.title.toLowerCase().includes(termTitle)))
  );

  res.json({ ok: true, songs: filtered });
});

// Cargar canciones desde Excel
const upload = multer({ dest: 'uploads/' });

app.post('/api/songs/upload', upload.single('excel'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ ok: false, message: 'No se envió archivo' });
  }

  try {
    const workbook  = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet     = workbook.Sheets[sheetName];

    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    const songs = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const colA = row[0]; // compositor
      const colB = row[1]; // canción

      if (!colA && !colB) continue;

      songs.push({
        title:  (colB || '').toString(),
        artist: (colA || '').toString()
      });
    }

    fs.writeFileSync(songsPath, JSON.stringify(songs, null, 2), 'utf8');
    fs.unlinkSync(req.file.path);

    console.log('Canciones cargadas desde Excel:', songs.length);
    res.json({ ok: true, count: songs.length });
  } catch (e) {
    console.error('Error procesando Excel', e);
    res.status(500).json({ ok: false, message: 'Error procesando Excel' });
  }
});

// ========== COLA ==========
const queuePath = path.join(__dirname, 'queue.json');

function readQueue() {
  try {
    const raw = fs.readFileSync(queuePath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function writeQueue(q) {
  fs.writeFileSync(queuePath, JSON.stringify(q, null, 2), 'utf8');
}

// Obtener cola
app.get('/api/queue', (req, res) => {
  const q = readQueue();
  res.json({ ok: true, queue: q });
});

// Agregar a cola
app.post('/api/queue', (req, res) => {
  const { userName, tableNumber, songTitle } = req.body;
  if (!userName || !tableNumber || !songTitle) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  // Validar que la mesa exista
  if (!isTableAllowed(tableNumber)) {
    return res
      .status(400)
      .json({
        ok: false,
        message: `La mesa ${tableNumber} no está registrada. Pide al administrador que la dé de alta.`
      });
  }

  const q = readQueue();

  const mesaStr = String(tableNumber).trim();

  const existeMesa = q.some(item => String(item.tableNumber).trim() === mesaStr);
  console.log('Intento mesa:', mesaStr, 'Existe ya:', existeMesa);

  if (existeMesa) {
    return res.status(400).json({
      ok: false,
      message: `La mesa ${mesaStr} ya está registrada en la cola. En tu mesa se podrá pedir una nueva canción hasta después de que pase su turno.`
    });
  }

  const id = q.length ? q[q.length - 1].id + 1 : 1;

  q.push({ id, userName, tableNumber: mesaStr, songTitle });
  writeQueue(q);
  res.json({ ok: true, id });
});

// Editar SOLO la canción de un registro de la cola
app.put('/api/queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const { songTitle } = req.body;

  if (!songTitle) {
    return res
      .status(400)
      .json({ ok: false, message: 'Falta el título de la canción' });
  }

  const q = readQueue();
  const index = q.findIndex(item => item.id === id);

  if (index === -1) {
    return res
      .status(404)
      .json({ ok: false, message: 'Registro no encontrado en la cola' });
  }

  q[index].songTitle = songTitle;
  writeQueue(q);

  return res.json({ ok: true, item: q[index] });
});

// Borrar uno
app.delete('/api/queue/:id', (req, res) => {
  const id = Number(req.params.id);
  const q = readQueue();
  const newQ = q.filter(item => item.id !== id);
  writeQueue(newQ);
  res.json({ ok: true });
});

// Borrar todos
app.delete('/api/queue', (req, res) => {
  writeQueue([]);
  res.json({ ok: true });
});

// ========== ARRANQUE ==========
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});