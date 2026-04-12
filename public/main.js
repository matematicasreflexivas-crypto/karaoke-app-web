// ===== CONFIGURACIÓN API =====
// Para trabajar LOCALMENTE (usando tu backend local en http://localhost:3000),
// deja API_BASE vacío: ''  → los fetch irán a /api/... en el mismo origen.
// Cuando vayas a PRODUCCIÓN (Netlify + Render), cambia esta línea a:
// const API_BASE = 'https://karaoke-backend-84e3.onrender.com';
// ===== CONFIGURACIÓN API =====
// ===== CONFIGURACIÓN API =====
const API_BASE = '';

let loggedUser = null;

// ========== LOGIN DE USUARIO ==========

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
    res = await fetch(`${API_BASE}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, table, password: pass })
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

  loggedUser = { name, table, pass };
  alert('Ingresaste como ' + name);

  const loginCard           = document.getElementById('login-card');
  const userContent         = document.getElementById('user-content');
  const toggleLoginBtn      = document.getElementById('btn-toggle-login-card');
  const searchCard          = document.getElementById('search-card');
  const btnToggleSearchCard = document.getElementById('btn-toggle-search-card');
  const btnSearch           = document.getElementById('btn-search');
  const queueDiv            = document.getElementById('queue');
  const btnToggleQueueCard  = document.getElementById('btn-toggle-queue-card');

  if (loginCard) loginCard.style.display = 'none';
  if (userContent) userContent.style.display = 'block';

  if (toggleLoginBtn) {
    toggleLoginBtn.style.display = 'block';
    toggleLoginBtn.textContent = 'Mostrar datos de registro';
  }

  if (searchCard) {
    searchCard.style.display = 'block';
  }

  if (btnToggleSearchCard) {
    btnToggleSearchCard.style.display = 'block';
    btnToggleSearchCard.textContent = 'Ocultar "Buscar canción"';
  }

  if (btnSearch) {
    btnSearch.style.display = 'none';
  }

  const resultsCard = getResultsCard();
  if (resultsCard) {
    resultsCard.style.display = 'none';
  }

  const queueCard = getQueueCard();
  if (queueCard) {
    queueCard.style.display = 'block';
  }
  if (queueDiv) {
    queueDiv.style.maxHeight = '46vh';
  }

  if (btnToggleQueueCard) {
    btnToggleQueueCard.style.display = 'block';
    btnToggleQueueCard.textContent = 'Ocultar cola de participantes';
  }

  loadQueue();
};

// ========== TOGGLE DE FICHA DE REGISTRO ==========

const toggleLoginBtn = document.getElementById('btn-toggle-login-card');
if (toggleLoginBtn) {
  toggleLoginBtn.onclick = () => {
    const loginCard = document.getElementById('login-card');
    if (!loginCard) return;

    const visible = loginCard.style.display !== 'none';
    if (visible) {
      loginCard.style.display = 'none';
      toggleLoginBtn.textContent = 'Mostrar datos de registro';
    } else {
      loginCard.style.display = 'block';
      toggleLoginBtn.textContent = 'Ocultar datos de registro';
    }
  };
}

// ========== HELPER: DEBOUNCE ==========

function debounce(fn, delay = 400) {
  let timerId = null;
  return (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn(...args), delay);
  };
}

// ========== HELPER: SCROLL BÚSQUEDA ARRIBA ==========

function ensureResultsVisible() {
  const searchCard = document.getElementById('search-card');
  if (!searchCard) return;

  setTimeout(() => {
    const rect = searchCard.getBoundingClientRect();
    const offsetTop = window.scrollY + rect.top;

    window.scrollTo({
      top: offsetTop,
      behavior: 'smooth'
    });
  }, 100);
}

// ========== BÚSQUEDA ==========

async function performSearch() {
  if (!loggedUser) return;

  const artistInput = document.getElementById('artist');
  const titleInput  = document.getElementById('title');
  const div         = document.getElementById('songs');
  const resultsCard = getResultsCard();

  if (!artistInput || !titleInput || !div) return;

  const artist = artistInput.value.trim();
  const title  = titleInput.value.trim();

  const hayTextoBusqueda = !!(artist || title);

  if (hayTextoBusqueda) {
    div.style.maxHeight = '60vh';
  } else {
    div.style.maxHeight = '22vh';
  }

  if (!hayTextoBusqueda) {
    div.innerHTML = '';
    if (resultsCard) resultsCard.style.display = 'none';
    return;
  }

  const params = new URLSearchParams();
  if (artist) params.append('artist', artist);
  if (title)  params.append('title', title);

  const url = `${API_BASE}/api/songs` + (params.toString() ? '?' + params.toString() : '');

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    console.error('Error de red al buscar canciones', err);
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (err) {
    console.error('Error parseando JSON de /api/songs', err);
    return;
  }

  if (!res.ok || !data.ok) {
    div.innerHTML = '';
    if (resultsCard) resultsCard.style.display = 'none';
    return;
  }

  const songs = data.songs || [];
  div.innerHTML = '';

  if (resultsCard) {
    resultsCard.style.display = songs.length ? 'block' : 'none';
  }

  if (!songs.length) {
    div.textContent = 'No se encontraron canciones';
    return;
  }

  songs.forEach(song => {
    const titleText  = (song.title  || '').toString();
    const artistText = (song.artist || '').toString();

    const label = `${titleText.toUpperCase()}_${artistText.toUpperCase()}`;

    const btn = document.createElement('button');
    btn.className = 'song-result';
    btn.textContent = label;
    btn.onclick = () => chooseSong(label);

    div.appendChild(btn);
  });

  ensureResultsVisible();
}

const debouncedSearch = debounce(performSearch, 400);

// ========== BOTÓN BUSCAR ==========

const btnSearch = document.getElementById('btn-search');
if (btnSearch) {
  btnSearch.style.display = 'none';
  btnSearch.onclick = async () => {
    if (!loggedUser) {
      alert('Primero inicia sesión');
      return;
    }
    performSearch();
  };
}

// ========== TOGGLE "BUSCAR CANCIÓN" ==========

const btnToggleSearchCard = document.getElementById('btn-toggle-search-card');
if (btnToggleSearchCard) {
  btnToggleSearchCard.onclick = () => {
    const searchCard = document.getElementById('search-card');
    const queueDiv   = document.getElementById('queue');
    if (!searchCard) return;

    const visible = searchCard.style.display !== 'none';

    if (visible) {
      searchCard.style.display = 'none';
      btnToggleSearchCard.textContent = 'Mostrar "Buscar canción"';
      if (queueDiv) queueDiv.style.maxHeight = '70vh';
    } else {
      searchCard.style.display = 'block';
      btnToggleSearchCard.textContent = 'Ocultar "Buscar canción"';
      if (queueDiv) queueDiv.style.maxHeight = '46vh';
    }
  };
}

// ========== TOGGLE "COLA DE PARTICIPANTES" ==========

const btnToggleQueueCard = document.getElementById('btn-toggle-queue-card');
if (btnToggleQueueCard) {
  btnToggleQueueCard.onclick = () => {
    const queueCard = getQueueCard();
    const queueDiv  = document.getElementById('queue');
    if (!queueCard || !queueDiv) return;

    const visible = queueCard.style.display !== 'none';

    if (visible) {
      queueCard.style.display = 'none';
      btnToggleQueueCard.textContent = 'Mostrar cola de participantes';
    } else {
      queueCard.style.display = 'block';
      btnToggleQueueCard.textContent = 'Ocultar cola de participantes';

      const searchCard = document.getElementById('search-card');
      const searchVisible = searchCard && searchCard.style.display !== 'none';
      queueDiv.style.maxHeight = searchVisible ? '46vh' : '70vh';
    }
  };
}

// ========== BÚSQUEDA EN VIVO ==========

const artistInput = document.getElementById('artist');
const titleInput  = document.getElementById('title');

if (artistInput) {
  artistInput.addEventListener('input', () => {
    if (!loggedUser) return;
    debouncedSearch();
  });
}

if (titleInput) {
  titleInput.addEventListener('input', () => {
    if (!loggedUser) return;
    debouncedSearch();
  });
}

// ========== ELECCIÓN DE CANCIÓN ==========

async function chooseSong(songLabel) {
  if (!loggedUser) {
    alert('Primero inicia sesión');
    return;
  }

  const confirmar = confirm(
    `¿Confirmas que quieres registrar esta canción?\n\n${songLabel}`
  );
  if (!confirmar) return;

  let res;
  try {
    res = await fetch(`${API_BASE}/api/queue`, {
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

  const artistInput = document.getElementById('artist');
  const titleInput  = document.getElementById('title');
  const songsDiv    = document.getElementById('songs');

  if (artistInput) artistInput.value = '';
  if (titleInput)  titleInput.value  = '';
  if (songsDiv)    songsDiv.innerHTML = '';

  if (!res.ok || !data.ok) {
    alert(data.message || 'No se pudo registrar');

    const resultsCard = getResultsCard();
    if (resultsCard) {
      resultsCard.style.display = 'none';
    }

    const searchCard = document.getElementById('search-card');
    if (searchCard) {
      searchCard.style.display = 'block';
    }

    const btnToggle = document.getElementById('btn-toggle-search-card');
    if (btnToggle) {
      btnToggle.textContent = 'Ocultar "Buscar canción"';
      btnToggle.style.display = 'block';
    }

    const queueDiv = document.getElementById('queue');
    if (queueDiv && searchCard) {
      queueDiv.style.maxHeight = '46vh';
    }

    return;
  }

  const resultsCard = getResultsCard();
  if (resultsCard) {
    resultsCard.style.display = 'none';
  }

  const searchCard = document.getElementById('search-card');
  const queueDiv   = document.getElementById('queue');
  if (searchCard) {
    searchCard.style.display = 'none';
  }

  const btnToggle = document.getElementById('btn-toggle-search-card');
  if (btnToggle) {
    btnToggle.textContent = 'Mostrar "Buscar canción"';
    btnToggle.style.display = 'block';
  }

  if (queueDiv) {
    queueDiv.style.maxHeight = '70vh';
  }

  if (songsDiv) {
    songsDiv.style.maxHeight = '22vh';
  }

  loadQueue();
}

// ========== COLA DE PARTICIPANTES ==========

async function loadQueue() {
  if (!loggedUser) return;

  let res;
  try {
    res = await fetch(`${API_BASE}/api/queue`);
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
  if (!div) return;

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

// Helpers

function getResultsCard() {
  return Array.from(document.querySelectorAll('.card'))
    .find(card => {
      const h3 = card.querySelector('h3');
      return h3 && h3.textContent.includes('Resultados de búsqueda');
    }) || null;
}

function getQueueCard() {
  return Array.from(document.querySelectorAll('.card'))
    .find(card => {
      const h3 = card.querySelector('h3');
      return h3 && h3.textContent.includes('Cola de participantes');
    }) || null;
}

// Auto‑refresco de la cola
setInterval(loadQueue, 5000);