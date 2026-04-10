const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const xlsx = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3000;

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

// ========== ENDPOINTS ADMIN ==========

// Login admin (usa adminPassword)
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

// Cambiar contraseña de usuario (desde el panel admin)
app.post('/api/admin/change-user-password', (req, res) => {
  const { adminPassword, newUserPassword } = req.body;

  // 1) Validar que vengan los datos
  if (!adminPassword || !newUserPassword) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  // 2) Verificar que la contraseña de admin sea correcta
  if (adminPassword !== adminConfig.adminPassword) {
    return res.status(401).json({ ok: false, message: 'Contraseña de administrador incorrecta' });
  }

  // 3) Actualizar la contraseña de usuario
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
// Valida la contraseña de usuario contra adminConfig.userPassword
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

  // Si la contraseña es correcta, devolvemos ok
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

    // Leemos el Excel como matriz de filas, sin usar encabezados.
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1 });

    // La fila 0 tiene los encabezados: A, B
    // Las filas siguientes tienen datos: [titulo, interprete]
    const songs = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const colA = row[0]; // columna A: AGUSTIN LARA (compositor)
      const colB = row[1]; // columna B: AVENTURERA (canción)

      if (!colA && !colB) continue; // fila vacía

      songs.push({
        // title = canción (B), artist = compositor (A)
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

// Agregar a cola (no permitir misma mesa repetida)
app.post('/api/queue', (req, res) => {
  const { userName, tableNumber, songTitle } = req.body;
  if (!userName || !tableNumber || !songTitle) {
    return res.status(400).json({ ok: false, message: 'Faltan datos' });
  }

  const q = readQueue();

  // Normalizamos a string para evitar problemas de tipo
  const mesaStr = String(tableNumber).trim();

  // Ver si ya existe esa mesa en la cola
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

// Editar SOLO la canción de un registro de la cola (no mueve su lugar)
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

  // Actualizamos solo el título de la canción
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