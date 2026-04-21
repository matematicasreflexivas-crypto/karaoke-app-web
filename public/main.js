const API_BASE = '';

let manualMaxSongsPerTable = 1;
let loggedUser = null;
window.currentUserName  = null;
window.currentUserTable = null;
let hasSuggestedWhileInQueue = false;

window.currentSingerName = null;
window.__showColorDots = true;

// Estado de visibilidad de secciones (para mantenerlas ocultas si el usuario las oculta)
let queueCardHidden = false;
let searchCardHidden = false;
let manualCardHidden = false;
let manualQueueCardHidden = false;
let mixedQueueCardHidden = false;
let suggestCardHidden = false;

// Banderas para rastrear estado inicial
let initialFeaturesApplied = false;
let lastScrollPosition = 0;

// intervalos de refresco
let queueInterval       = null;
let manualQueueInterval = null;
let mixedQueueInterval  = null;

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

// Crea un recuadro de color visual para items de cola
function createColorDot(color) {
  if (!window.__showColorDots) {
    const empty = document.createElement('span');
    return empty;
  }
  const dot = document.createElement('span');
  dot.style.cssText =
    'display:inline-block;width:12px;height:12px;border-radius:3px;flex-shrink:0;' +
    'background:' + (color === 'orange' ? '#f97316' : '#22c55e') + ';' +
    'margin-right:5px;vertical-align:middle;';
  return dot;
}

// Retorna el color efectivo de un item de cola
function getItemColor(item, defaultSource) {
  if (item.highlightColor) return item.highlightColor;
  const src = item.source || defaultSource;
  return src === 'manual' ? 'orange' : 'green';
}

function ensureResultsVisible() {
  const resultsCard = document.getElementById('search-results-card');
  const searchCard = document.getElementById('search-card');
  const target = resultsCard && resultsCard.style.display !== 'none' ? resultsCard : searchCard;
  if (!target) return;
  setTimeout(() => {
    target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, 100);
}

// Preserva la posición de scroll del contenedor principal durante recargas de colas
async function preserveScrollAndReload(loadFn) {
  const scrollContainer = document.getElementById('user-content');
  const savedTop = scrollContainer ? scrollContainer.scrollTop : 0;
  try {
    await loadFn();
  } catch (err) {
    console.error('Error en recarga de cola', err);
  }
  // Restaurar después de que el DOM se actualice
  requestAnimationFrame(() => {
    if (scrollContainer) {
      scrollContainer.scrollTop = savedTop;
    }
  });
}

// Refresco suave de un contenedor de cola (evita el latigazo visual)
function smoothRefreshContainer(div, renderFn) {
  if (!div) return;
  const prevScrollTop = div.scrollTop;
  const prevOverflowY = div.style.overflowY;
  div.style.overflowY = 'hidden';
  renderFn();
  div.scrollTop = prevScrollTop;
  div.style.overflowY = prevOverflowY || 'auto';
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
        h3.textContent.includes('selección por catálogo')
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
    if (h1) h1.textContent = title;

    if (
      typeof data.manualMaxSongsPerTable === 'number' &&
      data.manualMaxSongsPerTable > 0
    ) {
      manualMaxSongsPerTable = data.manualMaxSongsPerTable;
    } else {
      manualMaxSongsPerTable = 1;
    }

    window.__showColorDots = data.showColorDots !== false;

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
    btnToggleSearchCard.textContent = 'Ocultar catálogo de canciones';
  }
  if (btnSearch) btnSearch.style.display = 'none';

  const resultsCard = getResultsCard();
  if (resultsCard) resultsCard.style.display = 'none';

  const queueCard = getQueueCard();
  if (queueCard) queueCard.style.display = 'none';

  if (queueDiv) queueDiv.style.maxHeight = '';

  if (btnToggleQueueCard) {
    btnToggleQueueCard.style.display = 'block';
    btnToggleQueueCard.textContent = 'Mostrar cola de participantes (catálogo)';
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
  // Las colas inician ocultas; el usuario las despliega con el botón "Mostrar"
  queueCardHidden = true;
  searchCardHidden = false;
  manualCardHidden = false;
  manualQueueCardHidden = true;
  mixedQueueCardHidden = true;
  suggestCardHidden = false;

  if (window.__lastUserFeatures) {
    applyUserFeatures(window.__lastUserFeatures);
  }

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

    let touchFired = false;
    btn.addEventListener('touchend', (e) => {
      e.preventDefault();
      touchFired = true;
      chooseSong(label);
    });
    btn.addEventListener('click', () => {
      if (touchFired) { touchFired = false; return; }
      chooseSong(label);
    });

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
      btnToggleSearchCard2.textContent = 'Mostrar catálogo de canciones';
      setTimeout(() => {
        if (topButtonsContainer) {
          topButtonsContainer.classList.add('expanded');
        }
      }, 100);
    } else {
      searchCard.style.display = 'block';
      searchCardHidden = false;
      btnToggleSearchCard2.textContent = 'Ocultar catálogo de canciones';
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
      btnToggleQueueCard2.textContent = 'Mostrar cola de participantes (catálogo)';
    } else {
      queueCard.style.display = 'block';
      queueCardHidden = false;
      btnToggleQueueCard2.textContent = 'Ocultar cola de participantes (catálogo)';
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
      btnToggleManualCard2.textContent = 'Mostrar registro manual de canciones';
    } else {
      manualCard.style.display = 'block';
      manualCardHidden = false;
      btnToggleManualCard2.textContent = 'Ocultar registro manual de canciones';
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
      btnToggleManualQueueCard2.textContent = 'Mostrar cola de participantes (registro manual)';
    } else {
      manualQueueCard.style.display = 'block';
      manualQueueCardHidden = false;
      btnToggleManualQueueCard2.textContent = 'Ocultar cola de participantes (registro manual)';
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
      btnToggleMixedQueueCard2.textContent = 'Mostrar cola de participantes (catálogo + manual)';
    } else {
      mixedQueueCard.style.display = 'block';
      mixedQueueCardHidden = false;
      btnToggleMixedQueueCard2.textContent = 'Ocultar cola de participantes (catálogo + manual)';
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

// ================== CERRAR SESIÓN (USUARIO) ==================

const btnLogout = document.getElementById('btn-logout');
if (btnLogout) {
  btnLogout.onclick = () => {
    const confirmLogout = confirm('¿Seguro que quieres cerrar sesión?');
    if (!confirmLogout) return;

    // Detener intervalos de refresco
    if (queueInterval) { clearInterval(queueInterval); queueInterval = null; }
    if (manualQueueInterval) { clearInterval(manualQueueInterval); manualQueueInterval = null; }
    if (mixedQueueInterval) { clearInterval(mixedQueueInterval); mixedQueueInterval = null; }

    // Limpiar estado
    loggedUser = null;
    window.currentUserName = null;
    window.currentUserTable = null;
    window.currentSingerName = null;
    hasSuggestedWhileInQueue = false;
    initialFeaturesApplied = false;

    // Resetear banderas
    queueCardHidden = false;
    searchCardHidden = false;
    manualCardHidden = false;
    manualQueueCardHidden = false;
    mixedQueueCardHidden = false;
    suggestCardHidden = false;

    // Ocultar contenido de usuario
    const userContent = document.getElementById('user-content');
    if (userContent) userContent.style.display = 'none';

    // Mostrar login card
    const loginCard = document.getElementById('login-card');
    if (loginCard) loginCard.style.display = 'block';

    // Ocultar botón de toggle login
    const toggleLoginBtn = document.getElementById('btn-toggle-login-card');
    if (toggleLoginBtn) toggleLoginBtn.style.display = 'none';

    // Limpiar inputs
    const nameInput = document.getElementById('name');
    const tableInput = document.getElementById('table');
    const passInput = document.getElementById('pass');
    if (nameInput) nameInput.value = '';
    if (tableInput) tableInput.value = '';
    if (passInput) passInput.value = '';

    // Limpiar resultados y colas
    const songsDiv = document.getElementById('songs');
    if (songsDiv) songsDiv.innerHTML = '';
    const queueDiv = document.getElementById('queue');
    if (queueDiv) queueDiv.innerHTML = '';
    const manualQueueDiv = document.getElementById('manual-queue');
    if (manualQueueDiv) manualQueueDiv.innerHTML = '';
    const mixedQueueDiv = document.getElementById('mixed-queue-list');
    if (mixedQueueDiv) mixedQueueDiv.innerHTML = '';

    const resultsCard = document.getElementById('search-results-card');
    if (resultsCard) resultsCard.style.display = 'none';
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
  artistInput2.addEventListener('focus', () => {
    setTimeout(() => {
      const searchCard = document.getElementById('search-card');
      if (searchCard) searchCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  });
}

if (titleInput2) {
  titleInput2.addEventListener('input', () => {
    if (!loggedUser) return;
    debouncedSearch();
  });
  titleInput2.addEventListener('focus', () => {
    setTimeout(() => {
      const searchCard = document.getElementById('search-card');
      if (searchCard) searchCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
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
      btnToggle.textContent = 'Ocultar catálogo de canciones';
      btnToggle.style.display = 'block';
    }

    return;
  }

  // Limpiar el nombre extra manual para evitar conflicto en siguientes registros manuales
  window.__extraManualSingerName = null;

  const resultsCard = getResultsCard();
  if (resultsCard) resultsCard.style.display = 'none';

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

  if (!data.ok) {
    div.textContent = 'Error cargando cola';
    return;
  }

  const currentName  = removeAccents(
    (window.currentUserName || '').trim()
  ).toLowerCase();
  const currentTable = (window.currentUserTable || '').trim().toLowerCase();

  let isUserInQueue = false;

  smoothRefreshContainer(div, () => {
    div.innerHTML = '';

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

    // Recuadro de color (catálogo = verde)
    p.appendChild(createColorDot(getItemColor(item, 'catalog')));

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
  }); // end smoothRefreshContainer

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

  if (!data.ok) {
    div.textContent = 'Error cargando cola manual';
    return;
  }

  const currentName  = removeAccents(
    (window.currentUserName || '').trim()
  ).toLowerCase();
  const currentTable = (window.currentUserTable || '').trim().toLowerCase();

  smoothRefreshContainer(div, () => {
    div.innerHTML = '';

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

    // Recuadro de color (manual = naranja)
    p.appendChild(createColorDot(getItemColor(item, 'manual')));

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
  }); // end smoothRefreshContainer
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

  const currentName  = removeAccents(
    (window.currentUserName || '').trim()
  ).toLowerCase();
  const currentTable = (window.currentUserTable || '').trim().toLowerCase();

  smoothRefreshContainer(container, () => {
    if (!mixed.length) {
      container.textContent = 'No hay canciones en la cola mixta.';
      return;
    }

    container.innerHTML = '';

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

    if (item.source === 'catalog') {
      row.classList.add('mixed-from-catalog');
    } else if (item.source === 'manual') {
      row.classList.add('mixed-from-manual');
    }

    // Recuadro de color (respeta highlightColor o usa fuente como default)
    row.appendChild(createColorDot(getItemColor(item, item.source || 'catalog')));

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
      ? `${titleText} _ ${artistText}`
      : `${titleText}`;
    row.appendChild(songSpan);

    container.appendChild(row);
  });
  }); // end smoothRefreshContainer

  const card = document.getElementById('mixed-queue-card');
  if (card && !mixedQueueCardHidden) {
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
        `Actualmente tiene ${countForTable} canción(es) registradas.\n\n` +
        `¿Quieres registrar OTRA canción para OTRA persona de esta misma mesa?\n` +
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
        `Mesa ${loggedUser.table} - ${extraSingerName}`
    );

    window.currentSingerName = extraSingerName;

    const searchCard = document.getElementById('search-card');
    const btnToggle  = document.getElementById('btn-toggle-search-card');

    if (searchCard) searchCard.style.display = 'block';
    if (btnToggle) {
      btnToggle.textContent = 'Ocultar catálogo de canciones';
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
        `Actualmente tiene ${countForTable} canción(es) registradas.\n\n` +
        `¿Quieres registrar OTRA canción para OTRA persona de esta misma mesa?\n` +
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
      `Perfecto, ahora registra la siguiente canción para:\n` +
        `Mesa ${loggedUser.table} - ${extraSingerName}`
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

  if (!loggedUser) return;

  // Cola catálogo
  if (features.queue !== false) {
    queueInterval = setInterval(() => {
      preserveScrollAndReload(() => loadQueue());
    }, 8000);
  }

  // Cola manual
  if (features.manualQueue) {
    manualQueueInterval = setInterval(() => {
      preserveScrollAndReload(() => loadManualQueue());
    }, 8000);
  }

  // Cola mixta
  if (features.mixedQueue) {
    mixedQueueInterval = setInterval(() => {
      preserveScrollAndReload(() => loadMixedQueue());
    }, 10000);
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
        ? 'Mostrar catálogo de canciones'
        : 'Ocultar catálogo de canciones';
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
        ? 'Mostrar cola de participantes (catálogo)'
        : 'Ocultar cola de participantes (catálogo)';
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
      btnToggleManualCard.textContent = 'Ocultar registro manual de canciones';
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
        ? 'Mostrar cola de participantes (registro manual)'
        : 'Ocultar cola de participantes (registro manual)';
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
        ? 'Mostrar cola de participantes (catálogo + manual)'
        : 'Ocultar cola de participantes (catálogo + manual)';
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

    window.__showColorDots = data.showColorDots !== false;

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