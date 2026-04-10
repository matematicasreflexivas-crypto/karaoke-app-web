let loggedUser = null;

// Login de usuario
document.getElementById('btn-login').onclick = async () => {
  const name  = document.getElementById('name').value.trim();
  const table = document.getElementById('table').value.trim();
  const pass  = document.getElementById('pass').value.trim();

  if (!name || !table || !pass) {
    alert('Llena nombre, mesa y contraseña');
    return;
  }

  loggedUser = { name, table, pass };
  alert('Ingresaste como ' + name);
  loadQueue();
};

// Buscar canciones
document.getElementById('btn-search').onclick = async () => {
  const artist = document.getElementById('artist').value.trim();
  const title  = document.getElementById('title').value.trim();

  const params = new URLSearchParams();
  if (artist) params.append('artist', artist);
  if (title)  params.append('title', title);

  const url = '/api/songs' + (params.toString() ? '?' + params.toString() : '');

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error(err);
    alert('No se pudo conectar con el servidor');
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(err);
    alert('Respuesta inválida del servidor al buscar canciones');
    return;
  }

  if (!res.ok || !data.ok) {
    alert(data.message || 'Error buscando canciones');
    return;
  }

  const songs = data.songs || [];
  const div = document.getElementById('songs');

  div.innerHTML = '';

  if (!songs.length) {
    div.textContent = 'No se encontraron canciones';
    return;
  }

  const list = document.createElement('div');
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '4px';

  songs.forEach(song => {
    const titleText  = (song.title  || '').toString();
    const artistText = (song.artist || '').toString();

    const label = `${titleText.toUpperCase()}_${artistText.toUpperCase()}`;
    const btn = document.createElement('button');
    btn.style.display = 'block';
    btn.style.width = '100%';
    btn.textContent = label;
    btn.onclick = () => chooseSong(label);
    list.appendChild(btn);
  });

  div.appendChild(list);
};

async function chooseSong(songLabel) {
  if (!loggedUser) {
    alert('Primero inicia sesión');
    return;
  }

  let res;
  try {
    res = await fetch('/api/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: loggedUser.name,
        tableNumber: loggedUser.table,
        songTitle: songLabel
      })
    });
  } catch (err) {
    console.error(err);
    alert('No se pudo conectar para registrar la canción');
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(err);
    alert('Respuesta inválida del servidor al registrar');
    return;
  }

  if (!res.ok || !data.ok) {
    // Si hubo error (por ejemplo mesa repetida), limpiamos los resultados de búsqueda
    document.getElementById('songs').innerHTML = '';
    alert(data.message || 'No se pudo registrar');
    return;
  }

  alert('Registro creado correctamente');
  document.getElementById('songs').innerHTML = '';
  loadQueue();
}

async function loadQueue() {
  let res;
  try {
    res = await fetch('/api/queue');
  } catch (err) {
    console.error(err);
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(err);
    return;
  }

  const div = document.getElementById('queue');
  div.innerHTML = '';

  if (!data.ok) {
    div.textContent = 'Error cargando cola';
    return;
  }

  data.queue.forEach((item, idx) => {
    const p = document.createElement('p');
    p.textContent = `${idx + 1}. Mesa ${item.tableNumber} - ${item.userName} - ${item.songTitle}`;
    div.appendChild(p);
  });
}

// Auto‑refresco de la cola cada 5 segundos
setInterval(loadQueue, 5000);