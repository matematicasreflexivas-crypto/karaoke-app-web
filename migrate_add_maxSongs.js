const path = require('path');
const Database = require('better-sqlite3');

const dbPath = path.join(__dirname, 'karaoke.db');
console.log('Usando base de datos en:', dbPath);
const db = new Database(dbPath);

// Intentar agregar la columna maxSongs si no existe
try {
  db.exec(`ALTER TABLE tables ADD COLUMN maxSongs INTEGER DEFAULT 1;`);
  console.log('Columna maxSongs agregada con éxito.');
} catch (e) {
  console.error('Error al agregar maxSongs (posiblemente ya existe):', e.message);
}

db.close();