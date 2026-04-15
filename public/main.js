const API_BASE = '';

// ========== CARGAR TÍTULO PÚBLICO (appTitle) ==========
async function loadPublicInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const title = data.appTitle || 'Karaoke';
    document.title = `${title} - Usuario`;
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = `${title} - Pantalla de usuario`;
  } catch (e) {
    console.error('Error cargando info pública', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadPublicInfo();
});

let loggedUser = null;
window.currentUserName  = null;
window.currentUserTable = null;
let hasSuggestedWhileInQueue = false;


// ========== LOGIN DE USUARIO ==========

document.getElementById('btn-login').onclick = async () => {
  let name  = document.getElementById('name').value.trim();
  const table = document.getElementById('table').value.trim();
  const pass  = document.getElementById('pass').value.trim();

  if (!name || !table || !pass) {
    alert('Llena nombre, mesa y contraseña');
    return;
  }

  name = name.toUpperCase();

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
  window.currentUserName  = name.trim();
  window.currentUserTable = table.trim();

  alert('Ingresaste como ' + name);

  const loginCard            = document.getElementById('login-card');
  const userContent          = document.getElementById('user-content');
  const toggleLoginBtn       = document.getElementById('btn-toggle-login-card');
  const searchCard           = document.getElementById('search-card');
  const btnToggleSearchCard  = document.getElementById('btn-toggle-search-card');
  const btnSearch            = document.getElementById('btn-search');
  const queueDiv             = document.getElementById('queue');
  const btnToggleQueueCard   = document.getElementById('btn-toggle-queue-card');
  const btnToggleSuggestCard = document.getElementById('btn-toggle-suggest-card');
  const suggestCard          = document.getElementById('suggest-card');

  if (loginCard) loginCard.style.display = 'none';
  if (userContent) userContent.style.display = 'block';

  if (toggleLoginBtn) {
    toggleLoginBtn.style.display = 'block';
    toggleLoginBtn.textContent = 'Mostrar datos de registro';
  }

  if (searchCard) searchCard.style.display = 'block';
  if (btnToggleSearchCard) {
    btnToggleSearchCard.style.display = 'block';
    btnToggleSearchCard.textContent = 'Ocultar "Buscar canción"';
  }
  if (btnSearch) btnSearch.style.display = 'none';

  const resultsCard = getResultsCard();
  if (resultsCard) resultsCard.style.display = 'none';

  const queueCard = getQueueCard();
  if (queueCard) queueCard.style.display = 'block';
  if (queueDiv) queueDiv.style.maxHeight = '46vh';

  if (btnToggleQueueCard) {
    btnToggleQueueCard.style.display = 'block';
    btnToggleQueueCard.textContent = 'Ocultar cola de participantes';
  }

  if (btnToggleSuggestCard) {
    btnToggleSuggestCard.style.display = 'block';
    btnToggleSuggestCard.textContent = 'Mostrar sugerencia de canción';
  }
  if (suggestCard) {
    suggestCard.style.display = 'none';
  }

  loadQueue();
};


// ========== TOGGLE DE FICHA DE REGISTRO ==========

const toggleLoginBtn2 = document.getElementById('btn-toggle-login-card');
if (toggleLoginBtn2) {
  toggleLoginBtn2.onclick = () => {
    const loginCard = document.getElementById('login-card');
    if (!loginCard) return;

    const visible = loginCard.style.display !== 'none';
    if (visible) {
      loginCard.style.display = 'none';
      toggleLoginBtn2.textContent = 'Mostrar datos de registro';
    } else {
      loginCard.style.display = 'block';
      toggleLoginBtn2.textContent = 'Ocultar datos de registro';
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

const btnSearch2 = document.getElementById('btn-search');
if (btnSearch2) {
  btnSearch2.style.display = 'none';
  btnSearch2.onclick = async () => {
    if (!loggedUser) {
      alert('Primero inicia sesión');
      return;
    }
    performSearch();
  };
}


// ========== TOGGLE "BUSCAR CANCIÓN" ==========

const btnToggleSearchCard2 = document.getElementById('btn-toggle-search-card');
if (btnToggleSearchCard2) {
  btnToggleSearchCard2.onclick = () => {
    const searchCard = document.getElementById('search-card');
    const queueDiv   = document.getElementById('queue');
    if (!searchCard) return;

    const visible = searchCard.style.display !== 'none';

    if (visible) {
      searchCard.style.display = 'none';
      btnToggleSearchCard2.textContent = 'Mostrar "Buscar canción"';
      if (queueDiv) queueDiv.style.maxHeight = '70vh';
    } else {
      searchCard.style.display = 'block';
      btnToggleSearchCard2.textContent = 'Ocultar "Buscar canción"';
      if (queueDiv) queueDiv.style.maxHeight = '46vh';
    }
  };
}


// ========== TOGGLE "COLA DE PARTICIPANTES" ==========

const btnToggleQueueCard2 = document.getElementById('btn-toggle-queue-card');
if (btnToggleQueueCard2) {
  btnToggleQueueCard2.onclick = () => {
    const queueCard = getQueueCard();
    const queueDiv  = document.getElementById('queue');
    if (!queueCard || !queueDiv) return;

    const visible = queueCard.style.display !== 'none';

    if (visible) {
      queueCard.style.display = 'none';
      btnToggleQueueCard2.textContent = 'Mostrar cola de participantes';
    } else {
      queueCard.style.display = 'block';
      btnToggleQueueCard2.textContent = 'Ocultar cola de participantes';

      const searchCard = document.getElementById('search-card');
      const searchVisible = searchCard && searchCard.style.display !== 'none';
      queueDiv.style.maxHeight = searchVisible ? '46vh' : '70vh';
    }
  };
}


// ========== TOGGLE "SUGERENCIA DE CANCIÓN" ==========

const btnToggleSuggestCard2 = document.getElementById('btn-toggle-suggest-card');
if (btnToggleSuggestCard2) {
  btnToggleSuggestCard2.onclick = () => {
    const suggestCard = document.getElementById('suggest-card');
    if (!suggestCard) return;

    const visible = suggestCard.style.display !== 'none';
    suggestCard.style.display = visible ? 'none' : 'block';
    btnToggleSuggestCard2.textContent = visible
      ? 'Mostrar sugerencia de canción'
      : 'Ocultar sugerencia de canción';
  };
}


// ========== BÚSQUEDA EN VIVO ==========

const artistInput2 = document.getElementById('artist');
const titleInput2  = document.getElementById('title');

if (artistInput2) {
  artistInput2.addEventListener('input', () => {
    if (!loggedUser) return;
    debouncedSearch();
  });
}

if (titleInput2) {
  titleInput2.addEventListener('input', () => {
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

  const currentName  = (window.currentUserName  || '').trim().toLowerCase();
  const currentTable = (window.currentUserTable || '').trim().toLowerCase();

  let isUserInQueue = false;

  data.queue.forEach((item, idx) => {
    const p = document.createElement('p');
    p.className = 'queue-item-line';

    // NUEVO: resaltar SIEMPRE al participante en lugar 1 (índice 0)
    if (idx === 0) {
      p.classList.add('queue-item-is-current');
    }

    const itemTable    = (item.tableNumber || '').trim().toLowerCase();
    const itemNameRaw  = (item.userName || '').toString().trim();
    const itemNameLower = itemNameRaw.toLowerCase();

    const isCurrentUser =
      currentName &&
      currentTable &&
      currentName === itemNameLower &&
      currentTable === itemTable;

    if (isCurrentUser) {
      isUserInQueue = true;
    }

    const spanIndex = document.createElement('span');
    spanIndex.textContent = `${idx + 1}. `;
    p.appendChild(spanIndex);

    const mesaLabelSpan = document.createElement('span');
    mesaLabelSpan.textContent = 'Mesa ';
    if (isCurrentUser) {
      mesaLabelSpan.classList.add('queue-user-name-highlight');
    }
    p.appendChild(mesaLabelSpan);

    const tableSpan = document.createElement('span');
    tableSpan.textContent = item.tableNumber;
    if (isCurrentUser) {
      tableSpan.classList.add('queue-user-name-highlight');
    }
    p.appendChild(tableSpan);

    const sep1 = document.createElement('span');
    sep1.textContent = ' - ';
    p.appendChild(sep1);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = itemNameRaw.toUpperCase();
    if (isCurrentUser) {
      nameSpan.classList.add('queue-user-name-highlight');
    }
    p.appendChild(nameSpan);

    const spanRight = document.createElement('span');
    spanRight.textContent = ` - ${item.songTitle}`;
    p.appendChild(spanRight);

    div.appendChild(p);
  });

  if (!isUserInQueue) {
    hasSuggestedWhileInQueue = false;
  }
}


// ========== ENVÍO DE SUGERENCIA DE CANCIÓN ==========

const btnSendSuggestion = document.getElementById('btn-send-suggestion');
if (btnSendSuggestion) {
  btnSendSuggestion.onclick = async () => {
    if (!loggedUser) {
      alert('Primero inicia sesión');
      return;
    }

    const titleInput  = document.getElementById('suggest-title');
    const artistInput = document.getElementById('suggest-artist');

    // Verificar en tiempo real si el usuario está en la cola
    let resQueue;
    try {
      resQueue = await fetch(`${API_BASE}/api/queue`);
    } catch (err) {
      console.error(err);
      if (titleInput) titleInput.value = '';
      if (artistInput) artistInput.value = '';
      alert('No se pudo verificar tu estado en la cola');
      return;
    }

    let dataQueue;
    try {
      dataQueue = await resQueue.json();
    } catch (err) {
      console.error(err);
      if (titleInput) titleInput.value = '';
      if (artistInput) artistInput.value = '';
      alert('Respuesta inválida al verificar la cola');
      return;
    }

    if (!resQueue.ok || !dataQueue.ok) {
      if (titleInput) titleInput.value = '';
      if (artistInput) artistInput.value = '';
      alert('No se pudo verificar la cola actualmente');
      return;
    }

    const currentName  = (window.currentUserName  || '').trim().toLowerCase();
    const currentTable = (window.currentUserTable || '').trim().toLowerCase();

    const isUserInQueueNow = dataQueue.queue.some(item => {
      const itemTable = (item.tableNumber || '').trim().toLowerCase();
      const itemName  = (item.userName    || '').toString().trim().toLowerCase();
      return currentName && currentTable &&
             currentName === itemName &&
             currentTable === itemTable;
    });

    if (!isUserInQueueNow) {
      if (titleInput) titleInput.value = '';
      if (artistInput) artistInput.value = '';
      alert('Solo puedes hacer una sugerencia cuando estás en la cola de participantes.');
      return;
    }

    if (hasSuggestedWhileInQueue) {
      if (titleInput) titleInput.value = '';
      if (artistInput) artistInput.value = '';
      alert('Ya hiciste una sugerencia mientras estás en esta cola. Espera a que termine tu turno para sugerir de manera opcional otra.');
      return;
    }

    const title  = titleInput.value.trim();
    const artist = artistInput.value.trim();

    if (!title || !artist) {
      alert('Escribe título e intérprete para la sugerencia');
      return;
    }

    try {
      const res = await fetch(`${API_BASE}/api/song-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: loggedUser.name,
          tableNumber: loggedUser.table,
          title,
          artist,
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.message || 'No se pudo enviar la sugerencia');
        return;
      }

      titleInput.value = '';
      artistInput.value = '';
      hasSuggestedWhileInQueue = true;
      alert('¡Gracias! Tu sugerencia quedó registrada para revisión.');
    } catch (e) {
      console.error(e);
      alert('No se pudo conectar para enviar la sugerencia');
    }
  };
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