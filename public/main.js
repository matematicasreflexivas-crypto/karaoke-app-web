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

  let res;
  try {
    res = await fetch('/api/user/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        table,
        password: pass
      })
    });
  } catch (err) {
    console.error(err);
    alert('No se pudo conectar con el servidor para iniciar sesión');
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error(err);
    alert('Respuesta inválida del servidor al iniciar sesión');
    return;
  }

  if (!res.ok || !data.ok) {
    alert(data.message || 'No se pudo iniciar sesión');
    return;
  }

  // Si todo bien, guardamos al usuario en memoria
  loggedUser = { name, table, pass };
  alert('Ingresaste como ' + name);

  const loginCard = document.getElementById('login-card');
  const userContent = document.getElementById('user-content');
  const toggleLoginBtn = document.getElementById('btn-toggle-login-card');

  // Ocultar ficha de login para dar espacio a la cola
  if (loginCard) loginCard.style.display = 'none';

  // Mostrar secciones de usuario (buscar / resultados / cola)
  if (userContent) userContent.style.display = 'block';

  // Mostrar botón para volver a ver/ocultar la ficha de registro
  if (toggleLoginBtn) {
    toggleLoginBtn.style.display = 'block';
    toggleLoginBtn.textContent = 'Ver datos de registro';
  }

  // Asegurarnos de que la tarjeta de "Resultados de búsqueda" esté OCULTA al entrar
  const resultsCard = getResultsCard();
  if (resultsCard) {
    resultsCard.style.display = 'none';
  }

  // Cargar la cola inicial
  loadQueue();
};

// Toggle de ficha de registro
const toggleLoginBtn = document.getElementById('btn-toggle-login-card');
if (toggleLoginBtn) {
  toggleLoginBtn.onclick = () => {
    const loginCard = document.getElementById('login-card');
    if (!loginCard) return;

    const visible = loginCard.style.display !== 'none';
    if (visible) {
      loginCard.style.display = 'none';
      toggleLoginBtn.textContent = 'Ver datos de registro';
    } else {
      loginCard.style.display = 'block';
      toggleLoginBtn.textContent = 'Ocultar datos de registro';
    }
  };
}

// Buscar canciones
document.getElementById('btn-search').onclick = async () => {
  if (!loggedUser) {
    alert('Primero inicia sesión');
    return;
  }

  const artistInput = document.getElementById('artist');
  const titleInput  = document.getElementById('title');

  const artist = artistInput.value.trim();
  const title  = titleInput.value.trim();

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
    // limpiar campos aunque haya error en la búsqueda
    artistInput.value = '';
    titleInput.value  = '';
    return;
  }

  const songs = data.songs || [];
  const div = document.getElementById('songs');

  div.innerHTML = '';

  const resultsCard = getResultsCard();
  if (resultsCard) {
    resultsCard.style.display = 'block';
  }

  if (!songs.length) {
    div.textContent = 'No se encontraron canciones';
    // limpiar campos aunque no haya resultados
    artistInput.value = '';
    titleInput.value  = '';
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

  // Al finalizar la búsqueda (con resultados) limpiamos los campos
  artistInput.value = '';
  titleInput.value  = '';
};

async function chooseSong(songLabel) {
  if (!loggedUser) {
    alert('Primero inicia sesión');
    return;
  }

  const confirmar = confirm(
    `¿Confirmas que quieres registrar esta canción?\n\n${songLabel}`
  );
  if (!confirmar) {
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
    document.getElementById('songs').innerHTML = '';
    alert(data.message || 'No se pudo registrar');
    return;
  }

  document.getElementById('songs').innerHTML = '';

  const resultsCard = getResultsCard();
  if (resultsCard) {
    resultsCard.style.display = 'none';
  }

  loadQueue();
}

async function loadQueue() {
  if (!loggedUser) {
    return;
  }

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
    p.className = 'queue-item-line';
    p.textContent = `${idx + 1}. Mesa ${item.tableNumber} - ${item.userName} - ${item.songTitle}`;
    div.appendChild(p);
  });
}

// Helper para localizar la tarjeta de "Resultados de búsqueda"
function getResultsCard() {
  return Array.from(document.querySelectorAll('.card'))
    .find(card => {
      const h3 = card.querySelector('h3');
      return h3 && h3.textContent.includes('Resultados de búsqueda');
    }) || null;
}

// Auto‑refresco de la cola cada 5 segundos (solo si hay usuario logueado)
setInterval(loadQueue, 5000);