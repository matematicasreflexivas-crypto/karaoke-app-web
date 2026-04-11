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

  // Guardamos al usuario en memoria
  loggedUser = { name, table, pass };
  alert('Ingresaste como ' + name);

  const loginCard      = document.getElementById('login-card');
  const userContent    = document.getElementById('user-content');
  const toggleLoginBtn = document.getElementById('btn-toggle-login-card');
  const searchCard     = document.getElementById('search-card');
  const btnToggleSearchCard = document.getElementById('btn-toggle-search-card');
  const btnSearch      = document.getElementById('btn-search');
  const queueDiv       = document.getElementById('queue');
  const btnToggleQueueCard = document.getElementById('btn-toggle-queue-card');

  // Ocultar ficha de login
  if (loginCard) loginCard.style.display = 'none';

  // Mostrar contenido de usuario
  if (userContent) userContent.style.display = 'block';

  // Mostrar botón para ver/ocultar ficha de registro
  if (toggleLoginBtn) {
    toggleLoginBtn.style.display = 'block';
    toggleLoginBtn.textContent = 'Mostrar datos de registro';
  }

  // Al entrar, tarjeta de búsqueda visible
  if (searchCard) {
    searchCard.style.display = 'block';
  }

  // Botón Mostrar/Ocultar buscar canción visible
  if (btnToggleSearchCard) {
    btnToggleSearchCard.style.display = 'block';
    btnToggleSearchCard.textContent = 'Ocultar "Buscar canción"';
  }

  // Ocultar visualmente el botón Buscar
  if (btnSearch) {
    btnSearch.style.display = 'none';
  }

  // Ocultar tarjeta de resultados inicialmente
  const resultsCard = getResultsCard();
  if (resultsCard) {
    resultsCard.style.display = 'none';
  }

  // Mostrar tarjeta de cola por defecto
  const queueCard = getQueueCard();
  if (queueCard) {
    queueCard.style.display = 'block';
  }
  if (queueDiv) {
    queueDiv.style.maxHeight = '46vh'; // valor por defecto de tu CSS
  }

  // Mostrar botón Mostrar/Ocultar cola con texto completo
  if (btnToggleQueueCard) {
    btnToggleQueueCard.style.display = 'block';
    btnToggleQueueCard.textContent = 'Ocultar cola de canciones';
  }

  // Cargar cola inicial
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


// ========== HELPER: DEBOUNCE PARA BÚSQUEDA EN VIVO ==========

function debounce(fn, delay = 400) {
  let timerId = null;
  return (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn(...args), delay);
  };
}


// ========== LÓGICA CENTRAL DE BÚSQUEDA ==========

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

  // Ajustar altura de resultados
  if (hayTextoBusqueda) {
    div.style.maxHeight = '60vh';
  } else {
    div.style.maxHeight = '22vh';
  }

  // Si no hay texto, limpiar resultados y ocultar card
  if (!hayTextoBusqueda) {
    div.innerHTML = '';
    if (resultsCard) resultsCard.style.display = 'none';
    return;
  }

  const params = new URLSearchParams();
  if (artist) params.append('artist', artist);
  if (title)  params.append('title', title);

  const url = '/api/songs' + (params.toString() ? '?' + params.toString() : '');

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
}

const debouncedSearch = debounce(performSearch, 400);


// ========== BOTÓN BUSCAR (OCULTO PERO FUNCIONAL) ==========

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


// ========== BOTÓN MOSTRAR/OCULTAR "BUSCAR CANCIÓN" ==========

const btnToggleSearchCard = document.getElementById('btn-toggle-search-card');
if (btnToggleSearchCard) {
  btnToggleSearchCard.onclick = () => {
    const searchCard = document.getElementById('search-card');
    const queueDiv  = document.getElementById('queue');
    if (!searchCard) return;

    const visible = searchCard.style.display !== 'none';

    if (visible) {
      // Ocultar tarjeta de búsqueda
      searchCard.style.display = 'none';
      btnToggleSearchCard.textContent = 'Mostrar "Buscar canción"';
      // Aumentar espacio para la cola (solo altura)
      if (queueDiv) queueDiv.style.maxHeight = '70vh';
    } else {
      // Mostrar tarjeta de búsqueda
      searchCard.style.display = 'block';
      btnToggleSearchCard.textContent = 'Ocultar "Buscar canción"';
      // Volver a altura normal de la cola
      if (queueDiv) queueDiv.style.maxHeight = '46vh';
    }
  };
}


// ========== BOTÓN MOSTRAR/OCULTAR "COLA DE CANCIONES" ==========

const btnToggleQueueCard = document.getElementById('btn-toggle-queue-card');
if (btnToggleQueueCard) {
  btnToggleQueueCard.onclick = () => {
    const queueCard = getQueueCard();
    const queueDiv  = document.getElementById('queue');
    if (!queueCard || !queueDiv) return;

    const visible = queueCard.style.display !== 'none';

    if (visible) {
      // Ocultar tarjeta de cola
      queueCard.style.display = 'none';
      btnToggleQueueCard.textContent = 'Mostrar cola de canciones';
    } else {
      // Mostrar tarjeta de cola
      queueCard.style.display = 'block';
      btnToggleQueueCard.textContent = 'Ocultar cola de canciones';

      // Ajustar maxHeight según si la búsqueda está visible o no
      const searchCard = document.getElementById('search-card');
      const searchVisible = searchCard && searchCard.style.display !== 'none';
      queueDiv.style.maxHeight = searchVisible ? '46vh' : '70vh';
    }
  };
}


// ========== BÚSQUEDA EN VIVO AL ESCRIBIR ==========

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

  // Referencias a inputs/resultados para limpiar SIEMPRE
  const artistInput = document.getElementById('artist');
  const titleInput  = document.getElementById('title');
  const songsDiv    = document.getElementById('songs');

  // Siempre limpiar campos y resultados después de la respuesta (éxito o error)
  if (artistInput) artistInput.value = '';
  if (titleInput)  titleInput.value  = '';
  if (songsDiv)    songsDiv.innerHTML = '';

  if (!res.ok || !data.ok) {
    // Caso: no se pudo registrar (incluye "ya tienes turno")
    alert(data.message || 'No se pudo registrar');

    // Ocultar tarjeta de resultados si estaba visible
    const resultsCard = getResultsCard();
    if (resultsCard) {
      resultsCard.style.display = 'none';
    }

    // Mantener la tarjeta de búsqueda visible para que pueda intentar otra canción
    const searchCard = document.getElementById('search-card');
    if (searchCard) {
      searchCard.style.display = 'block';
    }

    // Ajustar texto del botón de búsqueda (por si acaso)
    const btnToggle = document.getElementById('btn-toggle-search-card');
    if (btnToggle) {
      btnToggle.textContent = 'Ocultar "Buscar canción"';
      btnToggle.style.display = 'block';
    }

    // NO tocar visibilidad de la cola ni el texto del botón de cola
    const queueDiv = document.getElementById('queue');
    if (queueDiv && searchCard) {
      // si la búsqueda está visible, altura "normal"
      queueDiv.style.maxHeight = '46vh';
    }

    return;
  }

  // Si SÍ se registró correctamente:

  const resultsCard = getResultsCard();
  if (resultsCard) {
    resultsCard.style.display = 'none';
  }

  // Ocultar tarjeta de búsqueda tras seleccionar canción
  const searchCard = document.getElementById('search-card');
  const queueDiv   = document.getElementById('queue');
  if (searchCard) {
    searchCard.style.display = 'none';
  }

  // Ajustar texto del botón toggle de búsqueda
  const btnToggle = document.getElementById('btn-toggle-search-card');
  if (btnToggle) {
    btnToggle.textContent = 'Mostrar "Buscar canción"';
    btnToggle.style.display = 'block';
  }

  // NO tocar visibilidad de la cola ni el texto de btn-toggle-queue-card:
  // solo ajustar altura para aprovechar el espacio si la cola está visible.
  if (queueDiv) {
    queueDiv.style.maxHeight = '70vh';
  }

  // Restablecer altura normal de resultados
  if (songsDiv) {
    songsDiv.style.maxHeight = '22vh';
  }

  loadQueue();
}


// ========== COLA DE CANCIONES ==========

async function loadQueue() {
  if (!loggedUser) return;

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
      return h3 && h3.textContent.includes('Cola de canciones');
    }) || null;
}


// Auto‑refresco de la cola
setInterval(loadQueue, 5000);