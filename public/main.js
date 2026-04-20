const API_BASE = '';

let manualMaxSongsPerTable = 1; // valor maestro leído de public-info
let loggedUser = null;
window.currentUserName  = null;
window.currentUserTable = null;
let hasSuggestedWhileInQueue = false;

// Nombre del participante actual con el que se registra la canción.
window.currentSingerName = null;

// intervalos de refresco
let queueInterval       = null;
let manualQueueInterval = null;
let mixedQueueInterval  = null;

// Banderas de visibilidad de secciones.
// true = la sección está oculta (por defecto o porque el usuario la cerró con el toggle).
// suggestCardHidden comienza en true porque la sección de sugerencias está cerrada por defecto.
let searchCardHidden      = false;
let queueCardHidden       = false;
let suggestCardHidden     = true;
let manualCardHidden      = false;
let manualQueueCardHidden = false;
let mixedQueueCardHidden  = false;

// ================== Helpers generales ==================

function toUpperNoAccents(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function removeAccents(str) {
  return str
    ? str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    : '';
}

function debounce(fn, delay = 400) {
  let timerId = null;
  return (...args) => {
    clearTimeout(timerId);
    timerId = setTimeout(() => fn(...args), delay);
  };
}

function ensureResultsVisible() {
  const searchCard = document.getElementById('search-card');
  if (!searchCard) return;
  setTimeout(() => {
    searchCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

function getResultsCard() {
  return (
    Array.from(document.querySelectorAll('.card')).find(card => {
      const h3 = card.querySelector('h3');
      return h3 && h3.textContent.includes('Resultados de búsqueda');
    }) || null
  );
}

function getQueueCard() {
  return (
    Array.from(document.querySelectorAll('.card')).find(card => {
      const h3 = card.querySelector('h3');
      return (
        h3 &&
        h3.textContent.includes('Cola de participantes') &&
        !h3.textContent.includes('carga manual') &&
        !h3.textContent.includes('mixta')
      );
    }) || null
  );
}

// ================== Cargar info pública ==================

async function loadPublicInfo() {
  console.log('loadPublicInfo() llamada');
  try {
    const res = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const title = data.appTitle || 'Karaoke';
    document.title = `${title} - Usuario`;
    const h1 = document.querySelector('h1');
    if (h1) h1.textContent = `${title}  `;

    if (
      typeof data.manualMaxSongsPerTable === 'number' &&
      data.manualMaxSongsPerTable > 0
    ) {
      manualMaxSongsPerTable = data.manualMaxSongsPerTable;
    } else {
      manualMaxSongsPerTable = 1;
    }

    const features = data.userFeatures || {};
    window.__lastUserFeatures = features;
    applyUserFeatures(features);
  } catch (e) {
    console.error('Error cargando info pública', e);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadPublicInfo();
});

// ================== LOGIN DE USUARIO ==================

document.getElementById('btn-login').onclick = async () => {
  let name  = document.getElementById('name').value.trim();
  const table = document.getElementById('table').value.trim();
  const pass  = document.getElementById('pass').value.trim();

  if (!name || !table || !pass) {
    alert('Llena nombre, mesa y contraseña');
    return;
  }

  name = toUpperNoAccents(name);

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
  window.currentUserName   = name.trim();
  window.currentUserTable  = table.trim();
  window.currentSingerName = name.trim();

  alert('Ingresaste como ' + name);

  const loginCard      = document.getElementById('login-card');
  const userContent    = document.getElementById('user-content');
  const toggleLoginBtn = document.getElementById('btn-toggle-login-card');
  const btnSearch      = document.getElementById('btn-search');
  const resultsCard    = getResultsCard();

  if (loginCard) loginCard.style.display = 'none';
  if (userContent) userContent.style.display = 'block';

  if (toggleLoginBtn) {
    toggleLoginBtn.style.display = 'block';
    toggleLoginBtn.textContent = 'Mostrar datos de registro';
  }

  if (btnSearch) btnSearch.style.display = 'none';
  if (resultsCard) resultsCard.style.display = 'none';

  // Resetear banderas de visibilidad: todo visible al entrar
  searchCardHidden      = false;
  queueCardHidden       = false;
  suggestCardHidden     = true;
  manualCardHidden      = false;
  manualQueueCardHidden = false;
  mixedQueueCardHidden  = false;

  // Aplicar visibilidad según las features habilitadas por el admin
  applyUserFeatures(window.__lastUserFeatures || {});

  await loadQueue();
  await loadManualQueue();
  await loadMixedQueue();

  startAutoRefreshQueues(window.__lastUserFeatures || {});
};

// ================== TOGGLE DE FICHA DE REGISTRO ==================

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

// ================== Búsqueda ==================

const debouncedSearch = debounce(performSearch, 400);

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
    const label = `${toUpperNoAccents(titleText)}_${toUpperNoAccents(artistText)}`;

    const btn = document.createElement('button');
    btn.className = 'song-result';
    btn.textContent = label;
    btn.onclick = () => chooseSong(label);

    div.appendChild(btn);
  });

  ensureResultsVisible();
}

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

// toggle buscar
const btnToggleSearchCard2 = document.getElementById('btn-toggle-search-card');
if (btnToggleSearchCard2) {
  btnToggleSearchCard2.onclick = () => {
    if (btnToggleSearchCard2.dataset.disabled === 'true') return;

    const searchCard = document.getElementById('search-card');
    if (!searchCard) return;

    searchCardHidden = !searchCardHidden;
    searchCard.style.display = searchCardHidden ? 'none' : 'block';
    btnToggleSearchCard2.textContent = searchCardHidden
      ? 'Mostrar "Buscar canción"'
      : 'Ocultar "Buscar canción"';
  };
}

// toggle cola catálogo
const btnToggleQueueCard2 = document.getElementById('btn-toggle-queue-card');
if (btnToggleQueueCard2) {
  btnToggleQueueCard2.onclick = () => {
    if (btnToggleQueueCard2.dataset.disabled === 'true') return;

    const queueCard = getQueueCard();
    if (!queueCard) return;

    queueCardHidden = !queueCardHidden;
    queueCard.style.display = queueCardHidden ? 'none' : 'block';
    btnToggleQueueCard2.textContent = queueCardHidden
      ? 'Mostrar cola de participantes'
      : 'Ocultar cola de participantes';
  };
}

// toggle sugerencias
const btnToggleSuggestCard2 = document.getElementById('btn-toggle-suggest-card');
if (btnToggleSuggestCard2) {
  btnToggleSuggestCard2.onclick = () => {
    if (btnToggleSuggestCard2.dataset.disabled === 'true') return;

    const suggestCard = document.getElementById('suggest-card');
    if (!suggestCard) return;

    suggestCardHidden = !suggestCardHidden;
    suggestCard.style.display = suggestCardHidden ? 'none' : 'block';
    btnToggleSuggestCard2.textContent = suggestCardHidden
      ? 'Mostrar sugerencia de canción'
      : 'Ocultar sugerencia de canción';
  };
}

// toggle registro manual
const btnToggleManualCard2 = document.getElementById('btn-toggle-manual-card');
if (btnToggleManualCard2) {
  btnToggleManualCard2.onclick = () => {
    if (btnToggleManualCard2.dataset.disabled === 'true') return;

    const manualCard = document.getElementById('manual-card');
    if (!manualCard) return;

    manualCardHidden = !manualCardHidden;
    manualCard.style.display = manualCardHidden ? 'none' : 'block';
    btnToggleManualCard2.textContent = manualCardHidden
      ? 'Mostrar "Registro manual"'
      : 'Ocultar "Registro manual"';
  };
}

// toggle cola manual
const btnToggleManualQueueCard2 = document.getElementById('btn-toggle-manual-queue-card');
if (btnToggleManualQueueCard2) {
  btnToggleManualQueueCard2.onclick = () => {
    if (btnToggleManualQueueCard2.dataset.disabled === 'true') return;

    const manualQueueCard = document.getElementById('manual-queue-card');
    if (!manualQueueCard) return;

    manualQueueCardHidden = !manualQueueCardHidden;
    manualQueueCard.style.display = manualQueueCardHidden ? 'none' : 'block';
    btnToggleManualQueueCard2.textContent = manualQueueCardHidden
      ? 'Mostrar cola de participantes (carga manual)'
      : 'Ocultar cola de participantes (carga manual)';
  };
}

// toggle cola mixta
const btnToggleMixedQueueCard2 = document.getElementById('btn-toggle-mixed-queue-card');
if (btnToggleMixedQueueCard2) {
  btnToggleMixedQueueCard2.onclick = () => {
    if (btnToggleMixedQueueCard2.dataset.disabled === 'true') return;

    const mixedCard = document.getElementById('mixed-queue-card');
    if (!mixedCard) return;

    mixedQueueCardHidden = !mixedQueueCardHidden;
    mixedCard.style.display = mixedQueueCardHidden ? 'none' : 'block';
    btnToggleMixedQueueCard2.textContent = mixedQueueCardHidden
      ? 'Mostrar cola mixta de participantes'
      : 'Ocultar cola mixta de participantes';
  };
}

// búsqueda en vivo
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

// inputs manuales en vivo
const manualTitleInput  = document.getElementById('manual-title');
const manualArtistInput = document.getElementById('manual-artist');

if (manualTitleInput) {
  manualTitleInput.addEventListener('input', () => {
    const pos = manualTitleInput.selectionStart;
    manualTitleInput.value = toUpperNoAccents(manualTitleInput.value);
    manualTitleInput.setSelectionRange(pos, pos);
  });
}

if (manualArtistInput) {
  manualArtistInput.addEventListener('input', () => {
    const pos = manualArtistInput.selectionStart;
    manualArtistInput.value = toUpperNoAccents(manualArtistInput.value);
    manualArtistInput.setSelectionRange(pos, pos);
  });
}

// ================== ELECCIÓN DE CANCIÓN (CATÁLOGO) ==================

async function chooseSong(songLabel) {
  if (!loggedUser) {
    alert('Primero inicia sesión');
    return;
  }

  const singerName = window.currentSingerName || loggedUser.name;

  const confirmar = confirm(
    `¿Confirmas que quieres registrar esta canción para:\n\nMesa ${loggedUser.table} - ${singerName}\n\n${songLabel}`
  );
  if (!confirmar) return;

  let res;
  try {
    res = await fetch(`${API_BASE}/api/queue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userName: singerName,
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
    if (resultsCard) resultsCard.style.display = 'none';

    const searchCard = document.getElementById('search-card');
    if (searchCard) searchCard.style.display = 'block';
    searchCardHidden = false;

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

  const resultsCard = getResultsCard();
  if (resultsCard) resultsCard.style.display = 'none';

  const searchCard = document.getElementById('search-card');
  const queueDiv   = document.getElementById('queue');
  if (searchCard) searchCard.style.display = 'none';
  searchCardHidden = true;

  const btnToggle = document.getElementById('btn-toggle-search-card');
  if (btnToggle) {
    btnToggle.textContent = 'Mostrar "Buscar canción"';
    btnToggle.style.display = 'block';
  }

  if (queueDiv) queueDiv.style.maxHeight = '';

  if (songsDiv) songsDiv.style.maxHeight = '22vh';

  await loadQueue();
  await loadMixedQueue();

  if (data.message) {
    alert(data.message);
  }

  if (
    typeof data.maxSongs === 'number' &&
    typeof data.totalAfterInsert === 'number'
  ) {
    const restantes = data.maxSongs - data.totalAfterInsert;
    if (restantes > 0) {
      await preguntarOtraPersonaParaMesa(data.maxSongs);
    }
  }

  await loadQueue();
  await loadMixedQueue();
}

// ================== COLA CATÁLOGO ==================

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

  const savedScroll = div.scrollTop;
  div.innerHTML = '';

  if (!data.ok) {
    div.textContent = 'Error cargando cola';
    return;
  }

  const currentName  = removeAccents(
    (window.currentUserName || '').trim()
  ).toLowerCase();
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
    if (isCurrentUser) mesaLabelSpan.classList.add('queue-user-name-highlight');
    p.appendChild(mesaLabelSpan);

    const tableSpan = document.createElement('span');
    tableSpan.textContent = item.tableNumber;
    if (isCurrentUser) tableSpan.classList.add('queue-user-name-highlight');
    p.appendChild(tableSpan);

    const sep1 = document.createElement('span');
    sep1.textContent = ' - ';
    p.appendChild(sep1);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = toUpperNoAccents(itemNameRaw);
    if (isCurrentUser) nameSpan.classList.add('queue-user-name-highlight');
    p.appendChild(nameSpan);

    const spanRight = document.createElement('span');
    spanRight.textContent = ` - ${item.songTitle}`;
    p.appendChild(spanRight);

    div.appendChild(p);
  });

  div.scrollTop = savedScroll;

  if (!isUserInQueue) {
    hasSuggestedWhileInQueue = false;
  }
}

// ================== COLA MANUAL ==================

async function loadManualQueue() {
  if (!loggedUser) return;

  let res;
  try {
    res = await fetch(`${API_BASE}/api/manual-queue`, { cache: 'no-store' });
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

  const div = document.getElementById('manual-queue');
  if (!div) return;

  div.style.maxHeight = '60vh';
  div.style.overflowY = 'auto';

  const savedScroll = div.scrollTop;
  div.innerHTML = '';

  if (!data.ok) {
    div.textContent = 'Error cargando cola manual';
    return;
  }

  const currentName  = removeAccents(
    (window.currentUserName || '').trim()
  ).toLowerCase();
  const currentTable = (window.currentUserTable || '').trim().toLowerCase();

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

    const spanIndex = document.createElement('span');
    spanIndex.textContent = `${idx + 1}. `;
    p.appendChild(spanIndex);

    const mesaLabelSpan = document.createElement('span');
    mesaLabelSpan.textContent = 'Mesa ';
    if (isCurrentUser) mesaLabelSpan.classList.add('queue-user-name-highlight');
    p.appendChild(mesaLabelSpan);

    const tableSpan = document.createElement('span');
    tableSpan.textContent = item.tableNumber;
    if (isCurrentUser) tableSpan.classList.add('queue-user-name-highlight');
    p.appendChild(tableSpan);

    const sep1 = document.createElement('span');
    sep1.textContent = ' - ';
    p.appendChild(sep1);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = toUpperNoAccents(itemNameRaw);
    if (isCurrentUser) nameSpan.classList.add('queue-user-name-highlight');
    p.appendChild(nameSpan);

    const sep2 = document.createElement('span');
    sep2.textContent = ' - ';
    p.appendChild(sep2);

    const songSpan = document.createElement('span');

    const titleText = toUpperNoAccents(
      (item.manualSongTitle || item.songTitle || '').toString()
    );
    const artistText = toUpperNoAccents(
      (item.manualSongArtist || item.songArtist || '').toString()
    );

    songSpan.textContent = artistText
      ? `${titleText} _ ${artistText}`
      : `${titleText}`;

    p.appendChild(songSpan);

    div.appendChild(p);
  });

  div.scrollTop = savedScroll;
}

// ================== COLA MIXTA ==================

async function loadMixedQueue() {
  if (!loggedUser) return;

  const container = document.getElementById('mixed-queue-list');
  if (!container) return;

  const features = window.__lastUserFeatures || {};
  if (!features.mixedQueue) {
    container.innerHTML = '';
    const card = document.getElementById('mixed-queue-card');
    if (card) card.style.display = 'none';
    return;
  }

  // Preserve scroll position only when the container already has content.
  const hasContent = container.hasChildNodes();
  const savedScroll = hasContent ? container.scrollTop : 0;
  if (!hasContent) {
    container.textContent = 'Cargando cola mixta...';
  }

  let res, data;
  try {
    res  = await fetch(`${API_BASE}/api/mixed-queue`, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error('Error leyendo /api/mixed-queue', e);
    container.textContent = 'No se pudo cargar la cola mixta.';
    return;
  }

  if (!res.ok || !data.ok) {
    container.textContent = data.message || 'Error al cargar la cola mixta.';
    return;
  }

  const mixed = data.queue || data.mixedQueue || [];
  if (!mixed.length) {
    container.textContent = 'No hay canciones en la cola mixta.';
    return;
  }

  container.innerHTML = '';

  const currentName  = removeAccents(
    (window.currentUserName || '').trim()
  ).toLowerCase();
  const currentTable = (window.currentUserTable || '').trim().toLowerCase();

  mixed.forEach((item, idx) => {
    const row = document.createElement('p');
    row.className = 'queue-item-line';

    if (idx === 0) {
      row.classList.add('queue-item-is-current');
    }

    const itemTable   = (item.tableNumber || '').toString().trim().toLowerCase();
    const itemNameRaw = (item.userName || '').toString().trim();
    const itemNameNorm = removeAccents(itemNameRaw).toLowerCase();

    const isCurrentUser =
      currentName &&
      currentTable &&
      currentName === itemNameNorm &&
      currentTable === itemTable;

    let sourceLabel = '';
    if (item.source === 'catalog') {
      sourceLabel = ' [CATÁLOGO]';
      row.classList.add('mixed-from-catalog');
    } else if (item.source === 'manual') {
      sourceLabel = ' [MANUAL]';
      row.classList.add('mixed-from-manual');
    }

    const spanIndex = document.createElement('span');
    spanIndex.textContent = `${idx + 1}. `;
    row.appendChild(spanIndex);

    const mesaLabelSpan = document.createElement('span');
    mesaLabelSpan.textContent = 'Mesa ';
    if (isCurrentUser) mesaLabelSpan.classList.add('queue-user-name-highlight');
    row.appendChild(mesaLabelSpan);

    const tableSpan = document.createElement('span');
    tableSpan.textContent = item.tableNumber;
    if (isCurrentUser) tableSpan.classList.add('queue-user-name-highlight');
    row.appendChild(tableSpan);

    const sep1 = document.createElement('span');
    sep1.textContent = ' - ';
    row.appendChild(sep1);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = toUpperNoAccents(itemNameRaw);
    if (isCurrentUser) nameSpan.classList.add('queue-user-name-highlight');
    row.appendChild(nameSpan);

    const sep2 = document.createElement('span');
    sep2.textContent = ' - ';
    row.appendChild(sep2);

    const songSpan = document.createElement('span');
    const titleText  = toUpperNoAccents(
      (item.displaySongTitle || item.songTitle || '').toString()
    );
    const artistText = toUpperNoAccents(
      (item.displaySongArtist || item.artist || '').toString()
    );
    songSpan.textContent = artistText
      ? `${titleText} _ ${artistText}${sourceLabel}`
      : `${titleText}${sourceLabel}`;
    row.appendChild(songSpan);

    container.appendChild(row);
  });

  container.scrollTop = savedScroll;

  const card = document.getElementById('mixed-queue-card');
  if (card && !mixedQueueCardHidden) card.style.display = 'block';
}

// ================== SUGERENCIAS ==================

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

    const currentName  = (window.currentUserName || '').trim().toLowerCase();
    const currentTable = (window.currentUserTable || '').trim().toLowerCase();

    const isUserInQueueNow = dataQueue.queue.some(item => {
      const itemTable = (item.tableNumber || '').trim().toLowerCase();
      const itemName  = (item.userName || '')
        .toString()
        .trim()
        .toLowerCase();
      return (
        currentName &&
        currentTable &&
        currentName === itemName &&
        currentTable === itemTable
      );
    });

    if (!isUserInQueueNow) {
      if (titleInput) titleInput.value = '';
      if (artistInput) artistInput.value = '';
      alert(
        'Solo puedes hacer una sugerencia cuando estás en la cola de participantes.'
      );
      return;
    }

    if (hasSuggestedWhileInQueue) {
      if (titleInput) titleInput.value = '';
      if (artistInput) artistInput.value = '';
      alert(
        'Ya hiciste una sugerencia mientras estás en esta cola. Espera a que termine tu turno para sugerir de manera opcional otra.'
      );
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
          artist
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

// ================== REGISTRO DE CANCIÓN MANUAL ==================

const btnSendManual = document.getElementById('btn-send-manual');
if (btnSendManual) {
  btnSendManual.onclick = async () => {
    if (!loggedUser) {
      alert('Primero inicia sesión');
      return;
    }

    const titleInput  = document.getElementById('manual-title');
    const artistInput = document.getElementById('manual-artist');

    let title  = titleInput ? titleInput.value.trim() : '';
    let artist = artistInput ? artistInput.value.trim() : '';

    if (!title || !artist) {
      alert('Escribe título e intérprete para registrar la canción');
      return;
    }

    title  = toUpperNoAccents(title);
    artist = toUpperNoAccents(artist);

    const singerName = window.__extraManualSingerName
      ? window.__extraManualSingerName
      : (window.currentSingerName || loggedUser.name);

    let res;
    let data;
    try {
      res = await fetch(`${API_BASE}/api/manual-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userName: toUpperNoAccents(singerName),
          tableNumber: loggedUser.table,
          songTitle: title,
          manualSongTitle:  title,
          manualSongArtist: artist
        })
      });

      data = await res.json();
      console.log('Respuesta /api/manual-queue:', data);

      if (!res.ok || !data.ok) {
        alert(data.message || 'No se pudo registrar la canción manual');
        return;
      }
    } catch (e) {
      console.error(e);
      alert('No se pudo conectar para registrar la canción manual');
      return;
    }

    if (titleInput)  titleInput.value  = '';
    if (artistInput) artistInput.value = '';
    await loadManualQueue();
    await loadMixedQueue();

    if (data.message) {
      alert(data.message);
    } else {
      alert('Canción manual registrada correctamente.');
    }

    if (window.__extraManualSingerName) {
      window.__extraManualSingerName = null;
    }

    if (
      typeof data.maxSongs === 'number' &&
      typeof data.totalAfterInsert === 'number'
    ) {
      const restantes = data.maxSongs - data.totalAfterInsert;
      if (restantes > 0) {
        await preguntarOtraPersonaParaMesaManual(data.maxSongs);
      }
    }
  };
}

// ================== Flujos multi‑persona ==================

async function preguntarOtraPersonaParaMesa(maxSongs) {
  try {
    const resQueue = await fetch(`${API_BASE}/api/mixed-queue`, {
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
      `La mesa ${loggedUser.table} puede registrar hasta ${maxSongs} canción(es).\n` +
        `Actualmente tiene ${countForTable} canción(es) registradas (sumando selección y manual).\n\n` +
        `¿Quieres registrar OTRA canción para OTRA persona de esta misma mesa (por selección o registro manual)?\n` +
        `Quedan ${remaining} lugar(es)\n\n` +
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
      alert(
        'No se ingresó nombre. El registro se mantiene con las canciones actuales.'
      );
      return;
    }

    let newName = removeAccents(newNameRaw.toString().trim()).toUpperCase();
    if (!newName) {
      alert('El nombre no puede quedar vacío.');
      return;
    }

    const nameExists = fromThisTable.some(
      item =>
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
      `Perfecto, ahora registra otra canción para:\n` +
        `Mesa ${loggedUser.table} - ${extraSingerName}\n\n` +
        'Puedes hacerlo buscando una canción del catálogo o usando el registro manual.'
    );

    window.currentSingerName = extraSingerName;

    const searchCard = document.getElementById('search-card');
    const btnToggle  = document.getElementById('btn-toggle-search-card');
    const queueDiv   = document.getElementById('queue');

    if (searchCard) searchCard.style.display = 'block';
    searchCardHidden = false;
    if (btnToggle) {
      btnToggle.textContent = 'Ocultar "Buscar canción"';
      btnToggle.style.display = 'block';
    }
    if (queueDiv) queueDiv.style.maxHeight = '';

  } catch (e) {
    console.error('Error en preguntarOtraPersonaParaMesa', e);
  }
}

async function preguntarOtraPersonaParaMesaManual(maxSongs) {
  try {
    const resQueue = await fetch(`${API_BASE}/api/mixed-queue`, {
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
      `La mesa ${loggedUser.table} puede registrar hasta ${maxSongs} canción(es).\n` +
        `Actualmente tiene ${countForTable} canción(es) registradas (sumando selección y manual).\n\n` +
        `¿Quieres registrar OTRA canción para OTRA persona de esta misma mesa (ya sea por selección o registro manual)?\n` +
        `Quedan ${remaining} lugar(es)\n\n` +
        `Pulsa "Aceptar" para SÍ.\n` +
        `Pulsa "Cancelar" para NO.`
    );
    if (!wantAnother) {
      return;
    }

    const newNameRaw = prompt(
      'Escribe el nombre de la otra persona de esta mesa que cantará (puede registrar por selección o manual):'
    );
    if (!newNameRaw) {
      alert(
        'No se ingresó nombre. El registro se mantiene con las canciones actuales.'
      );
      return;
    }

    let newName = removeAccents(newNameRaw.toString().trim()).toUpperCase();
    if (!newName) {
      alert('El nombre no puede quedar vacío.');
      return;
    }

    const nameExists = fromThisTable.some(
      item =>
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
      `Perfecto, ahora registra la siguiente canción para:\n` +
        `Mesa ${loggedUser.table} - ${extraSingerName}\n\n` +
        'Puedes hacerlo buscando una canción del catálogo o usando el registro manual.'
    );

    window.__extraManualSingerName = extraSingerName;
    window.currentSingerName       = extraSingerName;
  } catch (e) {
    console.error('Error en preguntarOtraPersonaParaMesaManual', e);
  }
}

// ================== APLICAR BANDERAS DE USUARIO ==================

function applyUserFeatures(features) {
  window.__lastUserFeatures = features;

  const searchEnabled         = features.search !== false;
  const queueEnabled          = features.queue !== false;
  const suggestionEnabled     = features.suggestion !== false;
  const manualQueueEnabled    = features.manualQueue === true;
  const manualRegisterEnabled = features.manualRegister === true;
  const mixedQueueEnabled     = features.mixedQueue === true;

  const searchCard          = document.getElementById('search-card');
  const btnToggleSearchCard = document.getElementById('btn-toggle-search-card');
  const resultsCard         = getResultsCard();

  const queueCard      = getQueueCard();
  const btnToggleQueue = document.getElementById('btn-toggle-queue-card');
  const queueDiv       = document.getElementById('queue');

  const suggestCard      = document.getElementById('suggest-card');
  const btnToggleSuggest = document.getElementById('btn-toggle-suggest-card');

  const manualCard         = document.getElementById('manual-card');
  const btnToggleManualCard = document.getElementById('btn-toggle-manual-card');

  const manualQueueCard          = document.getElementById('manual-queue-card');
  const btnToggleManualQueueCard = document.getElementById('btn-toggle-manual-queue-card');

  const mixedCard               = document.getElementById('mixed-queue-card');
  const mixedList               = document.getElementById('mixed-queue-list');
  const btnToggleMixedQueueCard = document.getElementById('btn-toggle-mixed-queue-card');

  // Buscar canción
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
      if (loggedUser) {
        btnToggleSearchCard.style.display = 'block';
        if (searchCard) searchCard.style.display = searchCardHidden ? 'none' : 'block';
        btnToggleSearchCard.textContent = searchCardHidden
          ? 'Mostrar "Buscar canción"'
          : 'Ocultar "Buscar canción"';
      } else {
        btnToggleSearchCard.style.display = 'none';
      }
    }
  }

  // Cola catálogo
  if (!queueEnabled) {
    if (queueCard) queueCard.style.display = 'none';
    if (queueDiv) queueDiv.innerHTML = '';
    if (btnToggleQueue) {
      btnToggleQueue.style.display = 'none';
      btnToggleQueue.dataset.disabled = 'true';
    }
  } else {
    if (btnToggleQueue) {
      btnToggleQueue.dataset.disabled = 'false';
      if (loggedUser) {
        btnToggleQueue.style.display = 'block';
        if (queueCard) queueCard.style.display = queueCardHidden ? 'none' : 'block';
        btnToggleQueue.textContent = queueCardHidden
          ? 'Mostrar cola de participantes'
          : 'Ocultar cola de participantes';
      } else {
        btnToggleQueue.style.display = 'none';
      }
    }
  }

  // Sugerencias
  if (!suggestionEnabled) {
    if (suggestCard) suggestCard.style.display = 'none';
    if (btnToggleSuggest) {
      btnToggleSuggest.style.display = 'none';
      btnToggleSuggest.dataset.disabled = 'true';
    }
  } else {
    if (btnToggleSuggest) {
      btnToggleSuggest.dataset.disabled = 'false';
      if (loggedUser) {
        btnToggleSuggest.style.display = 'block';
        if (suggestCard) suggestCard.style.display = suggestCardHidden ? 'none' : 'block';
        btnToggleSuggest.textContent = suggestCardHidden
          ? 'Mostrar sugerencia de canción'
          : 'Ocultar sugerencia de canción';
      } else {
        btnToggleSuggest.style.display = 'none';
      }
    }
  }

  // Registro manual (formulario)
  if (!manualRegisterEnabled) {
    if (manualCard) manualCard.style.display = 'none';
    if (btnToggleManualCard) {
      btnToggleManualCard.style.display = 'none';
      btnToggleManualCard.dataset.disabled = 'true';
    }
  } else {
    if (btnToggleManualCard) {
      btnToggleManualCard.dataset.disabled = 'false';
      if (loggedUser) {
        btnToggleManualCard.style.display = 'block';
        if (manualCard) manualCard.style.display = manualCardHidden ? 'none' : 'block';
        btnToggleManualCard.textContent = manualCardHidden
          ? 'Mostrar "Registro manual"'
          : 'Ocultar "Registro manual"';
      } else {
        btnToggleManualCard.style.display = 'none';
        if (manualCard) manualCard.style.display = 'none';
      }
    } else {
      if (manualCard) manualCard.style.display = loggedUser ? 'block' : 'none';
    }
  }

  // Cola manual (lista)
  if (!manualQueueEnabled) {
    if (manualQueueCard) manualQueueCard.style.display = 'none';
    if (btnToggleManualQueueCard) {
      btnToggleManualQueueCard.style.display = 'none';
      btnToggleManualQueueCard.dataset.disabled = 'true';
    }
  } else {
    if (btnToggleManualQueueCard) {
      btnToggleManualQueueCard.dataset.disabled = 'false';
      if (loggedUser) {
        btnToggleManualQueueCard.style.display = 'block';
        if (manualQueueCard) manualQueueCard.style.display = manualQueueCardHidden ? 'none' : 'block';
        btnToggleManualQueueCard.textContent = manualQueueCardHidden
          ? 'Mostrar cola de participantes (carga manual)'
          : 'Ocultar cola de participantes (carga manual)';
      } else {
        btnToggleManualQueueCard.style.display = 'none';
        if (manualQueueCard) manualQueueCard.style.display = 'none';
      }
    }
  }

  // Cola mixta
  if (!mixedQueueEnabled) {
    if (mixedCard) mixedCard.style.display = 'none';
    if (mixedList) mixedList.innerHTML = '';
    if (btnToggleMixedQueueCard) {
      btnToggleMixedQueueCard.style.display = 'none';
      btnToggleMixedQueueCard.dataset.disabled = 'true';
    }
  } else {
    if (btnToggleMixedQueueCard) {
      btnToggleMixedQueueCard.dataset.disabled = 'false';
      if (loggedUser) {
        btnToggleMixedQueueCard.style.display = 'block';
        if (mixedCard) mixedCard.style.display = mixedQueueCardHidden ? 'none' : 'block';
        btnToggleMixedQueueCard.textContent = mixedQueueCardHidden
          ? 'Mostrar cola mixta de participantes'
          : 'Ocultar cola mixta de participantes';
      } else {
        btnToggleMixedQueueCard.style.display = 'none';
        if (mixedCard) mixedCard.style.display = 'none';
      }
    }
  }

  startAutoRefreshQueues(features);
}

// ================== AUTO-REFRESCO ==================

function startAutoRefreshQueues(features) {
  if (queueInterval) {
    clearInterval(queueInterval);
    queueInterval = null;
  }
  if (manualQueueInterval) {
    clearInterval(manualQueueInterval);
    manualQueueInterval = null;
  }
  if (mixedQueueInterval) {
    clearInterval(mixedQueueInterval);
    mixedQueueInterval = null;
  }

  if (!loggedUser) return;

  if (features.queue) {
    loadQueue();
    queueInterval = setInterval(loadQueue, 5000);
  }

  if (features.manualQueue) {
    loadManualQueue();
    manualQueueInterval = setInterval(loadManualQueue, 5000);
  }

  if (features.mixedQueue) {
    loadMixedQueue();
    mixedQueueInterval = setInterval(loadMixedQueue, 5000);
  }
}

// ================== Refresco en vivo de userFeatures ==================

function areFeaturesDifferent(a, b) {
  if (!a && !b) return false;
  if (!a || !b) return true;
  return (
    a.search         !== b.search ||
    a.queue          !== b.queue ||
    a.suggestion     !== b.suggestion ||
    a.manualQueue    !== b.manualQueue ||
    a.manualRegister !== b.manualRegister ||
    a.mixedQueue     !== b.mixedQueue
  );
}

setInterval(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/public-info`, {
      cache: 'no-store'
    });
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