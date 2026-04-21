const API_BASE = '';

let manualMaxSongsPerTable = 1;
let loggedUser = null;
window.currentUserName  = null;
window.currentUserTable = null;
let hasSuggestedWhileInQueue = false;

window.currentSingerName = null;

// Estado de visibilidad de secciones (para mantenerlas ocultas si el usuario las oculta)
let queueCardHidden = false;
let searchCardHidden = false;
let manualCardHidden = false;
let manualQueueCardHidden = false;
let mixedQueueCardHidden = false;
let suggestCardHidden = false;
let historyCardHidden = false;

// Banderas para rastrear estado inicial
let initialFeaturesApplied = false;
let lastScrollPosition = 0;

// intervalos de refresco
let queueInterval       = null;
let manualQueueInterval = null;
let mixedQueueInterval  = null;
let historyInterval     = null;

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

    // Solo aplicar features si es la primera vez
    if (!initialFeaturesApplied && !loggedUser) {
      applyUserFeatures(features);
      initialFeaturesApplied = true;
    }
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
  const btnToggleManualCard  = document.getElementById('btn-toggle-manual-card');
  const manualCard           = document.getElementById('manual-card');

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

  if (btnToggleManualCard) {
    btnToggleManualCard.style.display = 'block';
    // El texto y la visibilidad final los decide applyUserFeatures según manualRegister
  }
  // Importante: ya NO forzamos aquí el manualCard a 'none';
  // applyUserFeatures se encargará de abrirlo si manualRegister está activado.
  // if (manualCard) {
  //   manualCard.style.display = 'none';
  // }

  // Resetear banderas de visibilidad
  queueCardHidden = false;
  searchCardHidden = false;
  manualCardHidden = false;
  manualQueueCardHidden = false;
  mixedQueueCardHidden = false;
  suggestCardHidden = false;
  historyCardHidden = false;

  if (window.__lastUserFeatures) {
    applyUserFeatures(window.__lastUserFeatures);
  }

  await loadQueue();
  await loadManualQueue();
  await loadMixedQueue();
  await loadHistory();

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

    setTimeout(() => {
      const resultsCardEl = getResultsCard();
      if (resultsCardEl) {
        resultsCardEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 300);
  } else {
    div.style.maxHeight = '22vh';
    if (resultsCard) resultsCard.style.display = 'none';
    return;
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
    const topButtonsContainer = document.getElementById('top-buttons-container');
    if (!searchCard) return;

    const visible = searchCard.style.display !== 'none';

    if (visible) {
      searchCard.style.display = 'none';
      searchCardHidden = true;
      btnToggleSearchCard2.textContent = 'Mostrar "Buscar canción"';
      setTimeout(() => {
        if (topButtonsContainer) {
          topButtonsContainer.classList.add('expanded');
        }
      }, 100);
    } else {
      searchCard.style.display = 'block';
      searchCardHidden = false;
      btnToggleSearchCard2.textContent = 'Ocultar "Buscar canción"';
    }
  };
}

// toggle cola catálogo
const btnToggleQueueCard2 = document.getElementById('btn-toggle-queue-card');
if (btnToggleQueueCard2) {
  btnToggleQueueCard2.onclick = () => {
    if (btnToggleQueueCard2.dataset.disabled === 'true') return;

    const queueCard = getQueueCard();
    if (!queueCard) return;

    const visible = queueCard.style.display !== 'none';

    if (visible) {
      queueCard.style.display = 'none';
      queueCardHidden = true;
      btnToggleQueueCard2.textContent = 'Mostrar cola de participantes';
    } else {
      queueCard.style.display = 'block';
      queueCardHidden = false;
      btnToggleQueueCard2.textContent = 'Ocultar cola de participantes';
    }
  };
}

// toggle registro manual
const btnToggleManualCard2 = document.getElementById('btn-toggle-manual-card');
if (btnToggleManualCard2) {
  btnToggleManualCard2.onclick = () => {
    if (btnToggleManualCard2.dataset.disabled === 'true') return;
    const manualCard = document.getElementById('manual-card');
    if (!manualCard) return;

    const visible = manualCard.style.display !== 'none';

    if (visible) {
      manualCard.style.display = 'none';
      manualCardHidden = true;
      btnToggleManualCard2.textContent = 'Mostrar "Registro manual"';
    } else {
      manualCard.style.display = 'block';
      manualCardHidden = false;
      btnToggleManualCard2.textContent = 'Ocultar "Registro manual"';
    }
  };
}

// toggle cola manual
const btnToggleManualQueueCard2 = document.getElementById('btn-toggle-manual-queue-card');
if (btnToggleManualQueueCard2) {
  btnToggleManualQueueCard2.onclick = () => {
    if (btnToggleManualQueueCard2.dataset.disabled === 'true') return;

    const manualQueueCard = document.getElementById('manual-queue-card');
    if (!manualQueueCard) return;

    const visible = manualQueueCard.style.display !== 'none';

    if (visible) {
      manualQueueCard.style.display = 'none';
      manualQueueCardHidden = true;
      btnToggleManualQueueCard2.textContent = 'Mostrar cola de participantes (carga manual)';
    } else {
      manualQueueCard.style.display = 'block';
      manualQueueCardHidden = false;
      btnToggleManualQueueCard2.textContent = 'Ocultar cola de participantes (carga manual)';
    }
  };
}

// toggle cola mixta
const btnToggleMixedQueueCard2 = document.getElementById('btn-toggle-mixed-queue-card');
if (btnToggleMixedQueueCard2) {
  btnToggleMixedQueueCard2.onclick = () => {
    if (btnToggleMixedQueueCard2.dataset.disabled === 'true') return;

    const mixedQueueCard = document.getElementById('mixed-queue-card');
    if (!mixedQueueCard) return;

    const visible = mixedQueueCard.style.display !== 'none';

    if (visible) {
      mixedQueueCard.style.display = 'none';
      mixedQueueCardHidden = true;
      btnToggleMixedQueueCard2.textContent = 'Mostrar cola mixta de participantes';
    } else {
      mixedQueueCard.style.display = 'block';
      mixedQueueCardHidden = false;
      btnToggleMixedQueueCard2.textContent = 'Ocultar cola mixta de participantes';
    }
  };
}

// toggle sugerencias
const btnToggleSuggestCard2 = document.getElementById('btn-toggle-suggest-card');
if (btnToggleSuggestCard2) {
  btnToggleSuggestCard2.onclick = () => {
    if (btnToggleSuggestCard2.dataset.disabled === 'true') return;

    const suggestCard = document.getElementById('suggest-card');
    if (!suggestCard) return;

    const visible = suggestCard.style.display !== 'none';
    suggestCard.style.display = visible ? 'none' : 'block';
    suggestCardHidden = visible;
    btnToggleSuggestCard2.textContent = visible
      ? 'Mostrar sugerencia de canción'
      : 'Ocultar sugerencia de canción';
  };
}

// toggle historial
const btnToggleHistoryCard = document.getElementById('btn-toggle-history-card');
if (btnToggleHistoryCard) {
  btnToggleHistoryCard.onclick = () => {
    if (btnToggleHistoryCard.dataset.disabled === 'true') return;

    const historyCard = document.getElementById('history-card');
    if (!historyCard) return;

    const visible = historyCard.style.display !== 'none';
    historyCard.style.display = visible ? 'none' : 'block';
    historyCardHidden = visible;
    btnToggleHistoryCard.textContent = visible
      ? 'Mostrar historial'
      : 'Ocultar historial';
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

    const btnToggle = document.getElementById('btn-toggle-search-card');
    if (btnToggle) {
      btnToggle.textContent = 'Ocultar "Buscar canción"';
      btnToggle.style.display = 'block';
    }

    return;
  }

  const resultsCard = getResultsCard();
  if (resultsCard) resultsCard.style.display = 'none';

  const searchCard = document.getElementById('search-card');
  if (searchCard) searchCard.style.display = 'none';

  const btnToggle = document.getElementById('btn-toggle-search-card');
  if (btnToggle) {
    btnToggle.textContent = 'Mostrar "Buscar canción"';
    btnToggle.style.display = 'block';
  }

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

  container.textContent = 'Cargando cola mixta...';

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

  const card = document.getElementById('mixed-queue-card');
  if (card && !mixedQueueCardHidden) {
    card.style.display = 'block';
  }
}

// ================== HISTORIAL ==================

async function loadHistory() {
  if (!loggedUser) return;

  const features = window.__lastUserFeatures || {};
  if (!features.history) {
    const card = document.getElementById('history-card');
    if (card) card.style.display = 'none';
    return;
  }

  const container = document.getElementById('history-user');
  if (!container) return;

  let res, data;
  try {
    res  = await fetch(`${API_BASE}/api/history`, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error('Error leyendo /api/history', e);
    container.textContent = 'No se pudo cargar el historial.';
    return;
  }

  if (!res.ok || !data.ok) {
    container.textContent = data.message || 'Error al cargar el historial.';
    return;
  }

  const items = data.history || [];

  if (!items.length) {
    container.textContent = 'Aún no hay historial.';
    const card = document.getElementById('history-card');
    if (card && !historyCardHidden) card.style.display = 'block';
    return;
  }

  const prevScrollTop = container.scrollTop;
  container.innerHTML = '';

  items.forEach((h, idx) => {
    const p = document.createElement('p');
    p.className = 'queue-item-line';

    const fechaAtendida  = h.playedAt ? new Date(h.playedAt).toLocaleString('es-MX') : '';
    const userNameUpper  = toUpperNoAccents(h.userName  || '');
    const songTitleUpper = toUpperNoAccents(h.songTitle || '');

    const spanIndex = document.createElement('span');
    spanIndex.textContent = `${idx + 1}. `;
    p.appendChild(spanIndex);

    const mesaLabelSpan = document.createElement('span');
    mesaLabelSpan.textContent = 'Mesa ';
    p.appendChild(mesaLabelSpan);

    const tableSpan = document.createElement('span');
    tableSpan.textContent = h.tableNumber;
    p.appendChild(tableSpan);

    const sep1 = document.createElement('span');
    sep1.textContent = ' - ';
    p.appendChild(sep1);

    const nameSpan = document.createElement('span');
    nameSpan.textContent = userNameUpper;
    p.appendChild(nameSpan);

    const sep2 = document.createElement('span');
    sep2.textContent = ` - ${songTitleUpper}`;
    p.appendChild(sep2);

    if (fechaAtendida) {
      const dateSpan = document.createElement('span');
      dateSpan.style.color = '#9ca3af';
      dateSpan.style.fontSize = '0.8rem';
      dateSpan.textContent = ` (${fechaAtendida})`;
      p.appendChild(dateSpan);
    }

    container.appendChild(p);
  });

  container.scrollTop = prevScrollTop;

  const card = document.getElementById('history-card');
  if (card && !historyCardHidden) {
    card.style.display = 'block';
  }
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

    if (searchCard) searchCard.style.display = 'block';
    if (btnToggle) {
      btnToggle.textContent = 'Ocultar "Buscar canción"';
      btnToggle.style.display = 'block';
    }

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

// ================== AUTO REFRESH COLAS ==================

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
  if (historyInterval) {
    clearInterval(historyInterval);
    historyInterval = null;
  }

  if (!loggedUser) return;

  // Cola catálogo
  if (features.queue !== false) {
    queueInterval = setInterval(() => {
      loadQueue().catch(err => console.error('Error auto loadQueue', err));
    }, 8000);
  }

  // Cola manual
  if (features.manualQueue) {
    manualQueueInterval = setInterval(() => {
      loadManualQueue().catch(err => console.error('Error auto loadManualQueue', err));
    }, 8000);
  }

  // Cola mixta
  if (features.mixedQueue) {
    mixedQueueInterval = setInterval(() => {
      loadMixedQueue().catch(err => console.error('Error auto loadMixedQueue', err));
    }, 10000);
  }

  // Historial
  if (features.history) {
    historyInterval = setInterval(() => {
      loadHistory().catch(err => console.error('Error auto loadHistory', err));
    }, 15000);
  }
}

// ================== APLICAR FEATURES ==================

function applyUserFeatures(features) {
  const searchEnabled         = !!features.search;
  const queueEnabled          = features.queue !== false;
  const manualRegisterEnabled = !!features.manualRegister;
  const manualQueueEnabled    = !!features.manualQueue;
  const mixedQueueEnabled     = !!features.mixedQueue;
  const suggestionEnabled     = !!features.suggestion;
  const historyEnabled        = !!features.history;

  const searchCard          = document.getElementById('search-card');
  const btnToggleSearchCard = document.getElementById('btn-toggle-search-card');

  const queueCard           = getQueueCard();
  const btnToggleQueueCard  = document.getElementById('btn-toggle-queue-card');

  const manualCard          = document.getElementById('manual-card');
  const btnToggleManualCard = document.getElementById('btn-toggle-manual-card');

  const manualQueueCard          = document.getElementById('manual-queue-card');
  const btnToggleManualQueueCard = document.getElementById('btn-toggle-manual-queue-card');

  const mixedQueueCard          = document.getElementById('mixed-queue-card');
  const btnToggleMixedQueueCard = document.getElementById('btn-toggle-mixed-queue-card');

  const suggestCard          = document.getElementById('suggest-card');
  const btnToggleSuggestCard = document.getElementById('btn-toggle-suggest-card');

  const historyCard          = document.getElementById('history-card');
  const btnToggleHistoryCard2 = document.getElementById('btn-toggle-history-card');

  // Buscar
  if (!searchEnabled) {
    if (searchCard) searchCard.style.display = 'none';
    if (btnToggleSearchCard) {
      btnToggleSearchCard.style.display = 'none';
      btnToggleSearchCard.dataset.disabled = 'true';
    }
    searchCardHidden = true;
  } else {
    if (searchCard && !searchCardHidden && loggedUser) {
      searchCard.style.display = 'block';
    }
    if (btnToggleSearchCard) {
      btnToggleSearchCard.dataset.disabled = 'false';
      btnToggleSearchCard.style.display = loggedUser ? 'block' : 'none';
      btnToggleSearchCard.textContent = searchCardHidden
        ? 'Mostrar "Buscar canción"'
        : 'Ocultar "Buscar canción"';
    }
  }

  // Cola catálogo
  if (!queueEnabled) {
    if (queueCard) queueCard.style.display = 'none';
    if (btnToggleQueueCard) {
      btnToggleQueueCard.style.display = 'none';
      btnToggleQueueCard.dataset.disabled = 'true';
    }
    queueCardHidden = true;
  } else {
    if (queueCard && !queueCardHidden && loggedUser) {
      queueCard.style.display = 'block';
    }
    if (btnToggleQueueCard) {
      btnToggleQueueCard.dataset.disabled = 'false';
      btnToggleQueueCard.style.display = loggedUser ? 'block' : 'none';
      btnToggleQueueCard.textContent = queueCardHidden
        ? 'Mostrar cola de participantes'
        : 'Ocultar cola de participantes';
    }
  }

  // Registro manual (formulario)
  if (!manualRegisterEnabled) {
    if (manualCard) manualCard.style.display = 'none';
    if (btnToggleManualCard) {
      btnToggleManualCard.style.display = 'none';
      btnToggleManualCard.dataset.disabled = 'true';
    }
    manualCardHidden = true;
  } else {
    if (manualCard && loggedUser) {
      // Siempre abierto si el feature está activo
      manualCard.style.display = 'block';
    }
    if (btnToggleManualCard) {
      btnToggleManualCard.dataset.disabled = 'false';
      btnToggleManualCard.style.display = loggedUser ? 'block' : 'none';
      btnToggleManualCard.textContent = 'Ocultar "Registro manual"';
    }
    manualCardHidden = false;
  }

  // Cola manual
  if (!manualQueueEnabled) {
    if (manualQueueCard) manualQueueCard.style.display = 'none';
    if (btnToggleManualQueueCard) {
      btnToggleManualQueueCard.style.display = 'none';
      btnToggleManualQueueCard.dataset.disabled = 'true';
    }
    manualQueueCardHidden = true;
  } else {
    if (manualQueueCard && !manualQueueCardHidden && loggedUser) {
      manualQueueCard.style.display = 'block';
    }
    if (btnToggleManualQueueCard) {
      btnToggleManualQueueCard.dataset.disabled = 'false';
      btnToggleManualQueueCard.style.display = loggedUser ? 'block' : 'none';
      btnToggleManualQueueCard.textContent = manualQueueCardHidden
        ? 'Mostrar cola de participantes (carga manual)'
        : 'Ocultar cola de participantes (carga manual)';
    }
  }

  // Cola mixta
  if (!mixedQueueEnabled) {
    if (mixedQueueCard) mixedQueueCard.style.display = 'none';
    if (btnToggleMixedQueueCard) {
      btnToggleMixedQueueCard.style.display = 'none';
      btnToggleMixedQueueCard.dataset.disabled = 'true';
    }
    mixedQueueCardHidden = true;
  } else {
    if (mixedQueueCard && !mixedQueueCardHidden && loggedUser) {
      mixedQueueCard.style.display = 'block';
    }
    if (btnToggleMixedQueueCard) {
      btnToggleMixedQueueCard.dataset.disabled = 'false';
      btnToggleMixedQueueCard.style.display = loggedUser ? 'block' : 'none';
      btnToggleMixedQueueCard.textContent = mixedQueueCardHidden
        ? 'Mostrar cola mixta de participantes'
        : 'Ocultar cola mixta de participantes';
    }
  }

  // Sugerencias
  if (!suggestionEnabled) {
    if (suggestCard) suggestCard.style.display = 'none';
    if (btnToggleSuggestCard) {
      btnToggleSuggestCard.style.display = 'none';
      btnToggleSuggestCard.dataset.disabled = 'true';
    }
    suggestCardHidden = true;
  } else {
    if (suggestCard && !suggestCardHidden && loggedUser) {
      suggestCard.style.display = 'block';
    }
    if (btnToggleSuggestCard) {
      btnToggleSuggestCard.dataset.disabled = 'false';
      btnToggleSuggestCard.style.display = loggedUser ? 'block' : 'none';
      btnToggleSuggestCard.textContent = suggestCardHidden
        ? 'Mostrar sugerencia de canción'
        : 'Ocultar sugerencia de canción';
    }
  }

  // Historial
  if (!historyEnabled) {
    if (historyCard) historyCard.style.display = 'none';
    if (btnToggleHistoryCard2) {
      btnToggleHistoryCard2.style.display = 'none';
      btnToggleHistoryCard2.dataset.disabled = 'true';
    }
    historyCardHidden = true;
  } else {
    if (historyCard && !historyCardHidden && loggedUser) {
      historyCard.style.display = 'block';
    }
    if (btnToggleHistoryCard2) {
      btnToggleHistoryCard2.dataset.disabled = 'false';
      btnToggleHistoryCard2.style.display = loggedUser ? 'block' : 'none';
      btnToggleHistoryCard2.textContent = historyCardHidden
        ? 'Mostrar historial'
        : 'Ocultar historial';
    }
  }

  startAutoRefreshQueues(features);
}

// ================== REFRESCO EN VIVO DE FEATURES ==================

function areFeaturesDifferent(a, b) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    if (a[k] !== b[k]) return true;
  }
  return false;
}

setInterval(async () => {
  try {
    const res  = await fetch(`${API_BASE}/api/public-info`, {
      cache: 'no-store'
    });
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const newFeatures = data.userFeatures || {};
    const last = window.__lastUserFeatures || {};

    if (areFeaturesDifferent(last, newFeatures)) {
      window.__lastUserFeatures = newFeatures;
      applyUserFeatures(newFeatures);
    }
  } catch (e) {
    console.error('Error refrescando userFeatures en vivo', e);
  }
}, 8000);