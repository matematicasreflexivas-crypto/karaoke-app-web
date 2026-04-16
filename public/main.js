const API_BASE = '';


// ========== CARGAR TÍTULO PÚBLICO (appTitle) + BANDERAS ==========
async function loadPublicInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const title = data.appTitle || 'Karaoke';
    document.title = `${title} - Usuario`;
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = `${title}  `;

    // NUEVO: aplicar banderas de funciones
    const features = data.userFeatures || {};
    applyUserFeatures(features);
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

  loggedUser = { name, table, pass };   // usuario del CEL
  window.currentUserName  = name.trim();
  window.currentUserTable = table.trim();

  alert('Ingresaste como ' + name);

  const loginCard             = document.getElementById('login-card');
  const userContent           = document.getElementById('user-content');
  const toggleLoginBtn        = document.getElementById('btn-toggle-login-card');
  const searchCard            = document.getElementById('search-card');
  const btnToggleSearchCard   = document.getElementById('btn-toggle-search-card');
  const btnSearch             = document.getElementById('btn-search');
  const queueDiv              = document.getElementById('queue');
  const btnToggleQueueCard    = document.getElementById('btn-toggle-queue-card');
  const btnToggleSuggestCard  = document.getElementById('btn-toggle-suggest-card');
  const suggestCard           = document.getElementById('suggest-card');

  if (loginCard) loginCard.style.display = 'none';
  if (userContent) userContent.style.display = 'block';

  if (toggleLoginBtn) {
    toggleLoginBtn.style.display = 'block';
    toggleLoginBtn.textContent = 'Mostrar datos de registro';
  }

  // OJO: la visibilidad real de estas secciones también la controla applyUserFeatures()
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

  if (queueDiv) queueDiv.style.maxHeight = '';

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

  // Volvemos a aplicar banderas por si el login se hizo después de cargar /api/public-info
  if (window.__lastUserFeatures) {
    applyUserFeatures(window.__lastUserFeatures);
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
  const middle = document.getElementById('middle-section');
  const searchCard = document.getElementById('search-card');
  if (!middle || !searchCard) return;

  setTimeout(() => {
    searchCard.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
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
    // si el admin desactivó esta función, este botón no debería mostrarse
    if (btnToggleSearchCard2.dataset.disabled === 'true') return;

    const searchCard = document.getElementById('search-card');
    const queueDiv   = document.getElementById('queue');
    if (!searchCard) return;

    const visible = searchCard.style.display !== 'none';

    if (visible) {
      searchCard.style.display = 'none';
      btnToggleSearchCard2.textContent = 'Mostrar "Buscar canción"';
      if (queueDiv) queueDiv.style.maxHeight = '';
    } else {
      searchCard.style.display = 'block';
      btnToggleSearchCard2.textContent = 'Ocultar "Buscar canción"';
      if (queueDiv) queueDiv.style.maxHeight = '';
    }
  };
}


// ========== TOGGLE "COLA DE PARTICIPANTES" ==========
const btnToggleQueueCard2 = document.getElementById('btn-toggle-queue-card');
if (btnToggleQueueCard2) {
  btnToggleQueueCard2.onclick = () => {
    if (btnToggleQueueCard2.dataset.disabled === 'true') return;

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
      queueDiv.style.maxHeight = '';
    }
  };
}


// ========== TOGGLE "SUGERENCIA DE CANCIÓN" ==========
const btnToggleSuggestCard2 = document.getElementById('btn-toggle-suggest-card');
if (btnToggleSuggestCard2) {
  btnToggleSuggestCard2.onclick = () => {
    if (btnToggleSuggestCard2.dataset.disabled === 'true') return;

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

  const mesaActual = (loggedUser.table || '').trim();
  const mesaNorm = mesaActual.toLowerCase();

  let maxSongs = 1;

  try {
    const resTables = await fetch(`${API_BASE}/api/tables`);
    const dataTables = await resTables.json();

    if (!resTables.ok || !dataTables.ok || !Array.isArray(dataTables.tables)) {
      // dejamos validación al backend
    } else {
      const mesaConfig = dataTables.tables.find(t => {
        const tNorm = (t.tableNumber || '').toString().trim().toLowerCase();
        return tNorm === mesaNorm;
      });

      maxSongs = mesaConfig && mesaConfig.maxSongs ? mesaConfig.maxSongs : 1;

      const resQueue = await fetch(`${API_BASE}/api/queue`, {
        cache: 'no-store'
      });
      const dataQueue = await resQueue.json();

      if (resQueue.ok && dataQueue.ok && Array.isArray(dataQueue.queue)) {
        const fromThisTable = dataQueue.queue.filter(
          q => (q.tableNumber || '').toString().trim().toLowerCase() === mesaNorm
        );

        const participantesDeEsaMesa = fromThisTable.length;

        if (participantesDeEsaMesa >= maxSongs) {
          alert(
            `Aún no puedes registrar otra canción.\n\n` +
            `Tu mesa (${mesaActual}) ya tiene ${participantesDeEsaMesa} participante(s) en la cola.\n` +
            `El máximo permitido para tu mesa es de ${maxSongs} participante(s) simultáneos.\n\n` +
            'Primero deben cantar todas las personas de tu mesa que ya están en la cola '
          );
          return;
        }
      }
    }
  } catch (err) {
    console.error('Error verificando cola/mesas antes de registrar', err);
  }

  const confirmar = confirm(
    `¿Confirmas que quieres registrar esta canción para:\n\nMesa ${loggedUser.table} - ${loggedUser.name}\n\n${songLabel}`
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
      queueDiv.style.maxHeight = '';
    }

    return;
  }

  if (data.maxSongs != null) {
    maxSongs = data.maxSongs;
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
    queueDiv.style.maxHeight = '';
  }

  if (songsDiv) {
    songsDiv.style.maxHeight = '22vh';
  }

  await loadQueue();

  if (maxSongs && maxSongs > 1) {
    await preguntarOtraPersonaParaMesa(maxSongs);
  }

  loadQueue();
}


// ========== COLA DE PARTICIPANTES ==========
async function loadQueue() {
  if (!loggedUser) return;

  let res;
  try {
    res = await fetch(`${API_BASE}/api/queue`, {
      cache: 'no-store'
    });
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

  const currentName  = removeAccents((window.currentUserName  || '').trim()).toLowerCase();
  const currentTable = (window.currentUserTable || '').trim().toLowerCase();

  let isUserInQueue = false;

  data.queue.forEach((item, idx) => {
    const p = document.createElement('p');
    p.className = 'queue-item-line';

    if (idx === 0) {
      p.classList.add('queue-item-is-current');
    }

    const itemTable     = (item.tableNumber || '').trim().toLowerCase();
    const itemNameRaw   = (item.userName || '').toString().trim();
    const itemNameLower = removeAccents(itemNameRaw).toLowerCase();

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

    let resQueue;
    try {
      resQueue = await fetch(`${API_BASE}/api/queue`, {
        cache: 'no-store'
      });
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


// ========= Helpers =========
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

function removeAccents(str) {
  return str
    ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : '';
}


// ========== NUEVO: flujo reutilizable para agregar más personas de la mesa ==========
async function preguntarOtraPersonaParaMesa(maxSongs) {
  try {
    const resQueue = await fetch(`${API_BASE}/api/queue`, {
      cache: 'no-store'
    });
    const dataQueue = await resQueue.json();
    if (!resQueue.ok || !dataQueue.ok || !Array.isArray(dataQueue.queue)) {
      return;
    }

    const mesaNorm = (loggedUser.table || '').trim().toLowerCase();
    const fromThisTable = dataQueue.queue.filter(
      q => (q.tableNumber || '').toString().trim().toLowerCase() === mesaNorm
    );
    const countForTable = fromThisTable.length;

    if (countForTable >= maxSongs) {
      return;
    }

    const remaining = maxSongs - countForTable;

    const wantAnother = confirm(
      `La mesa ${loggedUser.table} puede registrar hasta ${maxSongs} canciones.\n` +
      `Actualmente tiene ${countForTable} cancion(es) registradas.\n\n` +
      `¿Quieres buscar otra canción para OTRA persona de esta misma mesa?\n` +
      `Quedan ${remaining} lugar(es) \n\n` +
      `Pulsa "Aceptar" para SÍ.\n` +
      `Pulsa "Cancelar" para NO.`
    );
    if (!wantAnother) {
      return;
    }

    const newNameRaw = prompt(
      'Escribe el nombre de la otra persona de esta mesa que cantará:'
    );
    if (!newNameRaw) {
      alert('No se ingresó nombre. El registro se mantiene con las canciones actuales.');
      return;
    }

    let newName = removeAccents(newNameRaw.toString().trim()).toUpperCase();
    if (!newName) {
      alert('El nombre no puede quedar vacío.');
      return;
    }

    const nameExists = fromThisTable.some(item =>
      removeAccents((item.userName || '').toString().trim()).toLowerCase() ===
      removeAccents(newName).toLowerCase()
    );
    if (nameExists) {
      alert(
        `En la mesa ${loggedUser.table}, la persona "${newName}" ya tiene una canción registrada. ` +
        'Debe ser otra persona distinta de esa mesa.'
      );
      return;
    }

    const extraSingerName = newName;

    alert(
      `Perfecto, ahora puedes buscar otra canción para:\n` +
      `Mesa ${loggedUser.table} - ${extraSingerName}\n\n` +
      'Cuando selecciones la canción se completará el registr.'
    );

    const searchCard = document.getElementById('search-card');
    const btnToggle  = document.getElementById('btn-toggle-search-card');
    const queueDiv   = document.getElementById('queue');

    if (searchCard) {
      searchCard.style.display = 'block';
    }
    if (btnToggle) {
      btnToggle.textContent = 'Ocultar "Buscar canción"';
      btnToggle.style.display = 'block';
    }
    if (queueDiv) {
      queueDiv.style.maxHeight = '';
    }

    const originalChooseSong = chooseSong;
    window.chooseSong = async function (label) {
      const confirmar2 = confirm(
        `¿Confirmas que quieres registrar esta canción para:\n\nMesa ${loggedUser.table} - ${extraSingerName}\n\n${label}`
      );
      if (!confirmar2) return;

      let res2;
      try {
        res2 = await fetch(`${API_BASE}/api/queue`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userName: extraSingerName,
            tableNumber: loggedUser.table,
            songTitle: label
          })
        });
      } catch (err) {
        console.error(err);
        alert('No se pudo conectar para registrar la canción');
        return;
      }

      let data2;
      try {
        data2 = await res2.json();
      } catch (err) {
        console.error(err);
        alert('Respuesta inválida del servidor al registrar');
        return;
      }

      if (!res2.ok || !data2.ok) {
        alert(data2.message || 'No se pudo registrar');
        return;
      }

      const artistInput = document.getElementById('artist');
      const titleInput  = document.getElementById('title');
      const songsDiv    = document.getElementById('songs');

      if (artistInput) artistInput.value = '';
      if (titleInput)  titleInput.value  = '';
      if (songsDiv)    songsDiv.innerHTML = '';

      const resultsCard2 = getResultsCard();
      const searchCard2  = document.getElementById('search-card');
      const btnToggle2   = document.getElementById('btn-toggle-search-card');
      const queueDiv2    = document.getElementById('queue');

      if (resultsCard2) resultsCard2.style.display = 'none';
      if (searchCard2)  searchCard2.style.display  = 'none';
      if (btnToggle2) {
        btnToggle2.textContent = 'Mostrar "Buscar canción"';
        btnToggle2.style.display = 'block';
      }
      if (queueDiv2) queueDiv2.style.maxHeight = '';

      await loadQueue();

      window.chooseSong = originalChooseSong;

      if (maxSongs && maxSongs > 1) {
        await preguntarOtraPersonaParaMesa(maxSongs);
      }
    };
  } catch (e) {
    console.error('Error en preguntarOtraPersonaParaMesa', e);
  }
}


// Auto‑refresco de la cola
setInterval(loadQueue, 5000);


// ========== NUEVO: aplicar banderas de funciones del admin ==========
function applyUserFeatures(features) {
  // Guardamos la última config por si el usuario se loguea después
  window.__lastUserFeatures = features;

  const searchEnabled     = features.search !== false;     // por defecto true
  const queueEnabled      = features.queue !== false;
  const suggestionEnabled = features.suggestion !== false;

  const searchCard           = document.getElementById('search-card');
  const btnToggleSearchCard  = document.getElementById('btn-toggle-search-card');
  const resultsCard          = getResultsCard();

  const queueCard            = getQueueCard();
  const btnToggleQueueCard   = document.getElementById('btn-toggle-queue-card');
  const queueDiv             = document.getElementById('queue');

  const suggestCard          = document.getElementById('suggest-card');
  const btnToggleSuggestCard = document.getElementById('btn-toggle-suggest-card');

  // Búsqueda
  if (!searchEnabled) {
    if (searchCard) searchCard.style.display = 'none';
    if (resultsCard) resultsCard.style.display = 'none';
    if (btnToggleSearchCard) {
      btnToggleSearchCard.style.display = 'none';
      btnToggleSearchCard.dataset.disabled = 'true';
    }
  } else {
    if (btnToggleSearchCard) {
      btnToggleSearchCard.dataset.disabled = 'false';
      // la visibilidad concreta se controla con tu lógica de login/toggle
      btnToggleSearchCard.style.display = loggedUser ? 'block' : 'none';
    }
    // no forzamos mostrar la card: respetamos lo que esté por login/toggles
  }

  // Cola de participantes
  if (!queueEnabled) {
    if (queueCard) queueCard.style.display = 'none';
    if (queueDiv) queueDiv.innerHTML = '';
    if (btnToggleQueueCard) {
      btnToggleQueueCard.style.display = 'none';
      btnToggleQueueCard.dataset.disabled = 'true';
    }
  } else {
    if (btnToggleQueueCard) {
      btnToggleQueueCard.dataset.disabled = 'false';
      btnToggleQueueCard.style.display = loggedUser ? 'block' : 'none';
    }
  }

  // Sugerencia de canción
  if (!suggestionEnabled) {
    if (suggestCard) suggestCard.style.display = 'none';
    if (btnToggleSuggestCard) {
      btnToggleSuggestCard.style.display = 'none';
      btnToggleSuggestCard.dataset.disabled = 'true';
    }
  } else {
    if (btnToggleSuggestCard) {
      btnToggleSuggestCard.dataset.disabled = 'false';
      btnToggleSuggestCard.style.display = loggedUser ? 'block' : 'none';
    }
  }
}


// ========== NUEVO: polling en vivo de userFeatures ==========
function areFeaturesDifferent(a, b) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return (
    (a.search !== b.search) ||
    (a.queue !== b.queue) ||
    (a.suggestion !== b.suggestion)
  );
}

// Polling suave cada 8 segundos para refrescar banderas en vivo
setInterval(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/public-info`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const newFeatures = data.userFeatures || {};
    const last = window.__lastUserFeatures || {};

    if (areFeaturesDifferent(last, newFeatures)) {
      applyUserFeatures(newFeatures);
    }
  } catch (e) {
    console.error('Error refrescando userFeatures en vivo', e);
  }
}, 8000);