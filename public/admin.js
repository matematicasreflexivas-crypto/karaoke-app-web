// ===== CONFIGURACIÓN API =====
const API_BASE = '';

let adminLogged = false;
let minutesPerTurn = 5;

// Flags de visibilidad de secciones
let queueAdminHidden       = false;
let manualQueueAdminHidden = false;
let mixedQueueAdminHidden  = false;
let historyHidden          = true;
let suggestionsHidden      = true;
let tablesHidden           = false;
let inicioHidden           = false;
let activeUsersHidden      = true;
let loginHistoryHidden     = true;

// Intervalos de refresco
let queueAdminInterval       = null;
let manualQueueAdminInterval = null;
let mixedQueueAdminInterval  = null;
let historyInterval          = null;
let suggestionsInterval      = null;
let activeUsersInterval      = null;
let loginHistoryInterval     = null;

// Utilidad: quitar acentos y convertir a mayúsculas
function toUpperNoAccents(text) {
  if (!text) return '';
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

// Mostrar tiempo en cola: "Hace X min / horas"
function formatTiempoEnCola(createdAt) {
  if (!createdAt) return '';

  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return '';

  const now     = new Date();
  const diffMs  = now - created;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMin / 60);

  if (diffMin < 1)  return 'Hace menos de 1 min';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffHrs === 1) return 'Hace 1 hora';
  return `Hace ${diffHrs} horas`;
}

// Helper para refresco suave de contenedores con scroll
function smoothRefreshContainer(div, renderFn) {
  if (!div) return;

  // Save scroll positions before any DOM mutation
  const prevScrollTop   = div.scrollTop;
  const prevPageScrollY = window.scrollY;

  // Lock the container height so it doesn't collapse to 0 when innerHTML is cleared,
  // which would otherwise cause the whole page to jump
  const prevMinHeight = div.style.minHeight;
  div.style.minHeight  = div.offsetHeight + 'px';

  renderFn();

  // Restore container scroll position
  div.scrollTop       = prevScrollTop;
  // Unset the height lock
  div.style.minHeight = prevMinHeight;

  // Restore page-level scroll position in case the layout shift moved it
  if (window.scrollY !== prevPageScrollY) {
    window.scrollTo({ top: prevPageScrollY, behavior: 'instant' });
  }
}

// Retorna el color efectivo de un item de cola
function getItemColor(item, defaultSource) {
  if (item.highlightColor) return item.highlightColor;
  const src = item.source || defaultSource;
  return src === 'manual' ? 'orange' : 'green';
}

// Crea un recuadro de color visual para el item
function createColorDot(color) {
  const dot = document.createElement('span');
  dot.title = color === 'orange' ? 'Manual' : 'Catálogo';
  dot.style.cssText =
    'display:inline-block;width:13px;height:13px;border-radius:3px;flex-shrink:0;' +
    'background:' + (color === 'orange' ? '#f97316' : '#22c55e') + ';' +
    'margin-right:6px;vertical-align:middle;';
  return dot;
}

// Formatea el tiempo estimado de espera en la cola (solo admin)
function formatWaitTime(idx) {
  if (idx === 0) return '✓ En turno';
  const mins = idx * minutesPerTurn;
  return `~${mins} min`;
}

// ================== LOGIN ADMIN ==================

document.getElementById('btn-admin-login').onclick = async () => {
  const pass = document.getElementById('admin-pass').value.trim();
  if (!pass) {
    await customAlert('Escribe la contraseña');
    return;
  }

  let res, data;
  try {
    res = await fetch(`${API_BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pass })
    });
    data = await res.json();
  } catch (e) {
    console.error(e);
    await customAlert('No se pudo conectar para iniciar sesión');
    return;
  }

  if (!res.ok || !data.ok) {
    await customAlert(data.message || 'Contraseña incorrecta');
    return;
  }

  adminLogged = true;
  document.getElementById('admin-panel').style.display = 'block';

  // Reiniciar el contador de pulsaciones (puede haber quedado de una sesión anterior)
  _adminBackPressCount = 0;
  clearTimeout(_adminBackPressTimer);
  _adminBackPressTimer = null;
  _adminBackDebounce = null;

  // Empujar varias entradas al historial para que el botón atrás del
  // dispositivo siempre encuentre entradas que consumir y dispare 'popstate'
  // en lugar de navegar fuera de la página.
  for (let _i = 0; _i < 8; _i++) {
    history.pushState({ karaokeAdmin: true }, '', location.href);
  }
  // Colas
  await loadQueueAdmin();
  await loadManualQueueAdmin();
  await loadMixedQueueAdmin();

  loadTablesAdmin();
  setupToggleButtons();
  setupHistoryButtons();
  setupSuggestionsSection();
  setupQueueOpenButtons();
  refreshQueueOpenStatus();

  // Opciones de pantalla de usuario
  loadUserFeaturesAdmin();
  setupUserFeaturesControls();

  // Ajustes cola manual + pantalla pública
  loadManualQueueSettingsAdmin();
  setupManualQueueSettingsControls();

  // Control de cola para pantalla pública
  loadPublicQueueDisplayPreference();
  setupPublicQueueDisplayButton();

  // Botones limpiar colas
  setupClearMixedQueueButton();
  setupClearManualQueueButton();

  // Minutos por turno
  await loadMinutesPerTurn();
  setupMinutesPerTurnControl();

  startAutoRefreshAdmin();

  // Parche: forzar máximo de canciones manuales por mesa a 1000 (opcional)
  try {
    await fetch(`${API_BASE}/api/admin/change-manual-max-songs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminPassword: pass,
        manualMaxSongsPerTable: 1000
      })
    });
  } catch (e) {
    console.error('No se pudo aplicar manualMaxSongsPerTable=1000', e);
  }

  // Inicializar botón de cerrar sesión admin (HTML: btn-admin-logout)
  const btnAdminLogout = document.getElementById('btn-admin-logout');
  if (btnAdminLogout) {
    btnAdminLogout.onclick = async () => {
      if (!adminLogged) return;
      const ok = await customConfirm('¿Seguro que quieres cerrar sesión de administrador?');
      if (!ok) return;
      _doAdminLogout();
    };
  }
};

// ========== LÓGICA DE CIERRE DE SESIÓN (usada por botón Y por botón atrás) ==========

function _doAdminLogout() {
  adminLogged = false;
  clearAllIntervals();

  const adminPanel     = document.getElementById('admin-panel');
  const adminLoginCard = document.getElementById('admin-login-card') || document.getElementById('admin-login');
  if (adminPanel)     adminPanel.style.display = 'none';
  if (adminLoginCard) adminLoginCard.style.display = 'block';

  const passInputIds = ['admin-pass', 'old-admin-pass', 'new-admin-pass', 'admin-pass-user-change', 'admin-pass-app-title'];
  passInputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

// Bloquear el botón "atrás" del dispositivo mientras la sesión admin esté activa.
// Se necesitan 6 pulsaciones consecutivas para salir.
let _adminBackPressCount = 0;
let _adminBackPressTimer = null;
// Debounce para que múltiples eventos popstate disparados por una sola
// pulsación del botón atrás de Android cuenten como UN SOLO intento.
let _adminBackDebounce = null;

function _showAdminBackToast(msg) {
  const toast = document.getElementById('admin-back-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.style.display = 'block';
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => { toast.style.display = 'none'; }, 2500);
}

window.addEventListener('popstate', () => {
  if (!adminLogged) return;

  // Re-empujar una entrada para mantener siempre buffer suficiente.
  history.pushState({ karaokeAdmin: true }, '', location.href);

  // Debounce: en Android el botón atrás puede disparar popstate varias veces
  // por una sola pulsación física. Solo contamos la primera dentro de 350 ms.
  if (_adminBackDebounce) return;
  _adminBackDebounce = setTimeout(() => { _adminBackDebounce = null; }, 350);

  _adminBackPressCount += 1;

  // Reiniciar contador si el usuario tarda más de 4 s entre pulsaciones
  clearTimeout(_adminBackPressTimer);
  _adminBackPressTimer = setTimeout(() => { _adminBackPressCount = 0; }, 4000);

  const remaining = 6 - _adminBackPressCount;
  if (remaining <= 0) {
    // 6ª pulsación: cerrar sesión directamente (sin confirm para no bloquear
    // el evento de navegación en Android).
    _adminBackPressCount = 0;
    clearTimeout(_adminBackPressTimer);
    _doAdminLogout();
  }
});

// Limpiar toda la cola normal (catálogo)
document.getElementById('btn-clear-all').onclick = async () => {
  if (!adminLogged) return;
  const ok = await customConfirm('¿Seguro que quieres eliminar todos los registros de la cola catálogo?');
  if (!ok) return;

  try {
    await fetch(`${API_BASE}/api/queue`, { method: 'DELETE' });
  } catch (e) {
    console.error(e);
    await customAlert('No se pudo limpiar la cola catálogo');
    return;
  }
  loadQueueAdmin();
  loadMixedQueueAdmin();
};

// Subir Excel
document.getElementById('form-upload').onsubmit = async (e) => {
  e.preventDefault();
  if (!adminLogged) {
    await customAlert('Primero inicia sesión como admin');
    return;
  }

  const fileInput = document.getElementById('excel-file');
  if (!fileInput.files.length) {
    await customAlert('Selecciona un archivo Excel');
    return;
  }

  const formData = new FormData();
  formData.append('excel', fileInput.files[0]);

  let res;
  try {
    res = await fetch(`${API_BASE}/api/songs/upload`, {
      method: 'POST',
      body: formData
    });
  } catch (e) {
    console.error(e);
    await customAlert('No se pudo subir el Excel');
    return;
  }

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e2) {
    await customAlert('El servidor no respondió JSON. Respuesta: ' + text);
    return;
  }

  if (!res.ok || !data.ok) {
    await customAlert(data.message || 'Error al subir Excel');
    return;
  }

  await customAlert('Excel cargado (' + data.count + ' canciones).');
};

// ========== COLA ADMIN: CATÁLOGO ==========

async function loadQueueAdmin() {
  const div = document.getElementById('queue-admin');
  if (!div) return;

  let res, data;
  try {
    res  = await fetch(`${API_BASE}/api/queue`, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error(e);
    div.textContent = 'No se pudo conectar para cargar la cola';
    return;
  }

  if (!res.ok || !data.ok) {
    div.textContent = data?.message || 'Error cargando cola';
    return;
  }

  const queue = data.queue || [];

  const countBadge = document.getElementById('queue-admin-count');
  if (countBadge) {
    countBadge.textContent = `${queue.length} participante${queue.length !== 1 ? 's' : ''}`;
  }
  const waitBadge = document.getElementById('queue-admin-wait');
  if (waitBadge) {
    if (queue.length > 0) {
      waitBadge.textContent = `⏱ ${formatWaitTime(queue.length - 1)}`;
      waitBadge.style.display = '';
    } else {
      waitBadge.style.display = 'none';
    }
  }

  smoothRefreshContainer(div, () => {
    div.innerHTML = '';

    if (!queue.length) {
      div.textContent = 'No hay participantes en la cola.';
      return;
    }

    queue.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'queue-admin-item-line';
      if (idx === 0) {
        row.style.background = '#bbf7d0';
        row.style.color = '#111827';
      }

      const content = document.createElement('div');
      content.className = 'queue-admin-item-content';

      // Recuadro de color
      const colorDot = createColorDot(getItemColor(item, 'catalog'));
      content.appendChild(colorDot);

      const textSpan = document.createElement('span');
      textSpan.className = 'queue-admin-item-text';

      const userNameUpper  = toUpperNoAccents(item.userName || '');
      const songTitleUpper = toUpperNoAccents(item.songTitle || '');
      const artistUpper    = toUpperNoAccents(item.artist || '');
      const tiempoEnCola   = formatTiempoEnCola(item.createdAt);
      const waitTime       = formatWaitTime(idx);

      let linea = `${idx + 1}. Mesa ${item.tableNumber} - ${userNameUpper} - ${songTitleUpper}`;
      if (artistUpper) {
        linea += ` _ ${artistUpper}`;
      }
      if (tiempoEnCola) {
        linea += ` | ${tiempoEnCola}`;
      }
      linea += ` | ⏱ ${waitTime}`;

      textSpan.textContent = linea;
      content.appendChild(textSpan);

      const actions = document.createElement('div');
      actions.className = 'queue-admin-item-actions';

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Eliminar';
      btnDel.className   = 'btn-danger btn-queue-admin';
      btnDel.onclick = async () => {
        const ok = await customConfirm('¿Marcar esta canción como atendida y quitarla de la cola?');
        if (!ok) return;

        let resDel, dataDel;
        try {
          resDel  = await fetch(`${API_BASE}/api/queue/${item.id}`, { method: 'DELETE' });
          dataDel = await resDel.json();
        } catch (e) {
          await customAlert('No se pudo conectar para eliminar de la cola');
          return;
        }

        if (!resDel.ok || !dataDel.ok) {
          await customAlert(dataDel.message || 'No se pudo eliminar la canción');
          return;
        }

        const fromInput   = document.getElementById('history-from');
        const toInput     = document.getElementById('history-to');
        const fromDateStr = fromInput ? fromInput.value : '';
        const toDateStr   = toInput   ? toInput.value   : '';

        await loadQueueAdmin();
        loadHistoryAdmin(fromDateStr, toDateStr);
        loadMixedQueueAdmin();
      };
      actions.appendChild(btnDel);

      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Editar';
      btnEdit.className   = 'btn-secondary btn-queue-admin';
      btnEdit.onclick = async () => {
        const nuevoTitulo = await customPrompt(
          'Escribe el nuevo título de la canción:',
          item.songTitle
        );
        if (nuevoTitulo === null) return;

        const limpio = nuevoTitulo.trim();
        if (!limpio) {
          await customAlert('El título no puede quedar vacío');
          return;
        }

        let resEdit, dataEdit;
        try {
          resEdit = await fetch(`${API_BASE}/api/queue/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ songTitle: limpio })
          });
          dataEdit = await resEdit.json();
        } catch (e) {
          await customAlert('No se pudo conectar para editar la canción');
          return;
        }

        if (!resEdit.ok || !dataEdit.ok) {
          await customAlert(dataEdit.message || 'No se pudo actualizar la canción');
          return;
        }

        await loadQueueAdmin();
        loadMixedQueueAdmin();
      };
      actions.appendChild(btnEdit);

      content.appendChild(actions);
      row.appendChild(content);
      div.appendChild(row);
    });
  });
}

// ========== COLA ADMIN (MANUAL) ==========

async function loadManualQueueAdmin() {
  const div = document.getElementById('manual-queue-admin');
  if (!div) return;

  let res, data;
  try {
    res  = await fetch(`${API_BASE}/api/manual-queue`, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error(e);
    div.textContent = 'No se pudo conectar para cargar la cola manual';
    return;
  }

  if (!res.ok || !data.ok) {
    div.textContent = data.message || 'Error cargando cola manual';
    return;
  }

  const queue = data.queue || [];

  const manualCountBadge = document.getElementById('manual-queue-admin-count');
  if (manualCountBadge) {
    manualCountBadge.textContent = `${queue.length} participante${queue.length !== 1 ? 's' : ''}`;
  }
  const manualWaitBadge = document.getElementById('manual-queue-admin-wait');
  if (manualWaitBadge) {
    if (queue.length > 0) {
      manualWaitBadge.textContent = `⏱ ${formatWaitTime(queue.length - 1)}`;
      manualWaitBadge.style.display = '';
    } else {
      manualWaitBadge.style.display = 'none';
    }
  }

  smoothRefreshContainer(div, () => {
    div.innerHTML = '';

    if (!queue.length) {
      div.textContent = 'No hay participantes en la cola manual.';
      return;
    }

    queue.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'queue-admin-item-line';
      if (idx === 0) {
        row.style.background = '#bbf7d0';
        row.style.color = '#111827';
      }

      const content = document.createElement('div');
      content.className = 'queue-admin-item-content';

      // Recuadro de color (manual = naranja por defecto)
      const colorDot = createColorDot(getItemColor(item, 'manual'));
      content.appendChild(colorDot);

      const textSpan = document.createElement('span');
      textSpan.className = 'queue-admin-item-text';

      const userNameUpper  = toUpperNoAccents(item.userName || '');
      const songTitleUpper = toUpperNoAccents(item.manualSongTitle || item.songTitle || '');
      const artistUpper    = toUpperNoAccents(item.manualSongArtist || item.artist || '');
      const tiempoEnCola   = formatTiempoEnCola(item.createdAt);
      const waitTime       = formatWaitTime(idx);

      let linea = `${idx + 1}. Mesa ${item.tableNumber} - ${userNameUpper} - ${songTitleUpper}`;
      if (artistUpper) {
        linea += ` _ ${artistUpper}`;
      }
      if (tiempoEnCola) {
        linea += ` | ${tiempoEnCola}`;
      }
      linea += ` | ⏱ ${waitTime}`;

      textSpan.textContent = linea;
      content.appendChild(textSpan);

      const actions = document.createElement('div');
      actions.className = 'queue-admin-item-actions';

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Eliminar';
      btnDel.className   = 'btn-danger btn-queue-admin';
      btnDel.onclick = async () => {
        const ok = await customConfirm('¿Quitar este registro de la cola manual?');
        if (!ok) return;

        let resDel, dataDel;
        try {
          resDel  = await fetch(`${API_BASE}/api/manual-queue/${item.id}`, { method: 'DELETE' });
          dataDel = await resDel.json();
        } catch (e) {
          await customAlert('Error al eliminar de la cola manual');
          return;
        }

        if (!resDel.ok || !dataDel.ok) {
          await customAlert(dataDel.message || 'No se pudo eliminar de la cola manual');
          return;
        }

        const fromInput   = document.getElementById('history-from');
        const toInput     = document.getElementById('history-to');
        const fromDateStr = fromInput ? fromInput.value : '';
        const toDateStr   = toInput   ? toInput.value   : '';

        await loadManualQueueAdmin();
        loadHistoryAdmin(fromDateStr, toDateStr);
        loadMixedQueueAdmin();
      };
      actions.appendChild(btnDel);

      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Editar';
      btnEdit.className   = 'btn-secondary btn-queue-admin';
      btnEdit.onclick = async () => {
        const nuevoTitulo = await customPrompt(
          'Escribe el nuevo título de la canción (manual):',
          item.manualSongTitle || item.songTitle || ''
        );
        if (nuevoTitulo === null) return;

        const limpioTitulo = nuevoTitulo.trim();
        if (!limpioTitulo) {
          await customAlert('El título no puede quedar vacío');
          return;
        }

        const nuevoArtista = await customPrompt(
          'Escribe el nuevo intérprete (manual):',
          item.manualSongArtist || item.artist || ''
        );
        if (nuevoArtista === null) return;

        const limpioArtista = nuevoArtista.trim();
        if (!limpioArtista) {
          await customAlert('El intérprete no puede quedar vacío');
          return;
        }

        let resEdit, dataEdit;
        try {
          resEdit = await fetch(`${API_BASE}/api/manual-queue/${item.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              manualSongTitle:  limpioTitulo,
              manualSongArtist: limpioArtista
            })
          });
          dataEdit = await resEdit.json();
        } catch (e) {
          await customAlert('Error al editar la cola manual');
          return;
        }

        if (!resEdit.ok || !dataEdit.ok) {
          await customAlert(dataEdit.message || 'No se pudo actualizar la cola manual');
          return;
        }

        await loadManualQueueAdmin();
        loadMixedQueueAdmin();
      };
      actions.appendChild(btnEdit);

      content.appendChild(actions);
      row.appendChild(content);
      div.appendChild(row);
    });
  });
}

// ========== COLA ADMIN (MIXTA) ==========

async function loadMixedQueueAdmin() {
  const div = document.getElementById('mixed-queue-admin');
  if (!div) return;

  let res, data;
  try {
    res  = await fetch(`${API_BASE}/api/mixed-queue`, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error(e);
    div.textContent = 'No se pudo conectar para cargar la cola mixta';
    return;
  }

  if (!res.ok || !data.ok) {
    div.textContent = data.message || 'La cola mixta aún no está disponible.';
    return;
  }

  const queue = Array.isArray(data.mixedQueue) ? data.mixedQueue : (data.queue || []);

  const mixedCountBadge = document.getElementById('mixed-queue-admin-count');
  if (mixedCountBadge) {
    mixedCountBadge.textContent = `${queue.length} participante${queue.length !== 1 ? 's' : ''}`;
  }
  const mixedWaitBadge = document.getElementById('mixed-queue-admin-wait');
  if (mixedWaitBadge) {
    if (queue.length > 0) {
      mixedWaitBadge.textContent = `⏱ ${formatWaitTime(queue.length - 1)}`;
      mixedWaitBadge.style.display = '';
    } else {
      mixedWaitBadge.style.display = 'none';
    }
  }

  smoothRefreshContainer(div, () => {
    div.innerHTML = '';

    if (!queue.length) {
      div.textContent = 'No hay participantes en la cola mixta.';
      return;
    }

    queue.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'queue-admin-item-line';
      if (idx === 0) {
        row.style.background = '#bbf7d0';
        row.style.color = '#111827';
      }

      // Borde de color según fuente
      if (item.source === 'catalog') {
        row.classList.add('mixed-from-catalog');
      } else if (item.source === 'manual') {
        row.classList.add('mixed-from-manual');
      }

      const content = document.createElement('div');
      content.className = 'queue-admin-item-content';

      // Recuadro de color (puede estar sobreescrito con highlightColor)
      const effectiveColor = getItemColor(item, item.source || 'catalog');
      const colorDot = createColorDot(effectiveColor);
      content.appendChild(colorDot);

      const textSpan = document.createElement('span');
      textSpan.className = 'queue-admin-item-text';

      const userNameUpper  = toUpperNoAccents(item.userName || '');
      const songTitleUpper = toUpperNoAccents(item.displaySongTitle || item.songTitle || '');
      const artistUpper    = toUpperNoAccents(item.displaySongArtist || item.artist || '');
      const tiempoEnCola   = formatTiempoEnCola(item.createdAt);
      const waitTime       = formatWaitTime(idx);

      // Etiqueta visible de origen
      const sourceLabelSpan = document.createElement('span');
      if (item.source === 'manual') {
        sourceLabelSpan.textContent = '[MANUAL]';
        sourceLabelSpan.style.color = '#f97316';
        sourceLabelSpan.style.fontWeight = '700';
      } else {
        sourceLabelSpan.textContent = '[CATÁLOGO]';
        sourceLabelSpan.style.color = '#22c55e';
        sourceLabelSpan.style.fontWeight = '700';
      }

      let lineaResto = ` Mesa ${item.tableNumber} - ${userNameUpper} - ${songTitleUpper}`;
      if (artistUpper) {
        lineaResto += ` _ ${artistUpper}`;
      }
      if (tiempoEnCola) {
        lineaResto += ` | ${tiempoEnCola}`;
      }
      lineaResto += ` | ⏱ ${waitTime}`;

      const indexSpan = document.createElement('span');
      indexSpan.textContent = `${idx + 1}. `;
      textSpan.appendChild(indexSpan);
      textSpan.appendChild(sourceLabelSpan);
      const restoSpan = document.createElement('span');
      restoSpan.textContent = lineaResto;
      textSpan.appendChild(restoSpan);
      content.appendChild(textSpan);

      const actions = document.createElement('div');
      actions.className = 'queue-admin-item-actions';

      // Botón para cambiar color (verde ↔ naranja)
      const btnToggleColor = document.createElement('button');
      const newColor = effectiveColor === 'orange' ? 'green' : 'orange';
      btnToggleColor.textContent = effectiveColor === 'orange' ? '🟢' : '🟠';
      btnToggleColor.title = effectiveColor === 'orange' ? 'Cambiar a verde' : 'Cambiar a naranja';
      btnToggleColor.className = 'btn-queue-admin';
      btnToggleColor.style.background = effectiveColor === 'orange' ? '#22c55e' : '#f97316';
      btnToggleColor.style.color = '#fff';
      btnToggleColor.style.minWidth = '36px';
      btnToggleColor.onclick = async () => {
        const endpoint = item.source === 'manual'
          ? `${API_BASE}/api/manual-queue/${item.id}/highlight-color`
          : `${API_BASE}/api/queue/${item.id}/highlight-color`;
        try {
          const resColor = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ color: newColor })
          });
          const dataColor = await resColor.json();
          if (!resColor.ok || !dataColor.ok) {
            await customAlert(dataColor.message || 'No se pudo cambiar el color');
            return;
          }
          loadMixedQueueAdmin();
          loadQueueAdmin();
          loadManualQueueAdmin();
        } catch (e) {
          console.error(e);
          await customAlert('Error al cambiar el color');
        }
      };
      actions.appendChild(btnToggleColor);

      const btnDel = document.createElement('button');
      btnDel.textContent = 'Eliminar';
      btnDel.className   = 'btn-danger btn-queue-admin';
      btnDel.onclick = async () => {
        const ok = await customConfirm('¿Quitar este registro de la cola mixta?');
        if (!ok) return;

        const isManual = item.source === 'manual';
        const endpoint = isManual
          ? `${API_BASE}/api/manual-queue/${item.id}`
          : `${API_BASE}/api/queue/${item.id}`;

        try {
          const resDel = await fetch(endpoint, { method: 'DELETE' });
          let dataDel;
          try {
            dataDel = await resDel.json();
          } catch (e) {
            await customAlert('Respuesta inválida del servidor al eliminar de la cola mixta');
            return;
          }

          if (!resDel.ok || !dataDel.ok) {
            await customAlert(dataDel.message || 'No se pudo eliminar de la cola mixta');
            return;
          }

          await loadMixedQueueAdmin();
          loadQueueAdmin();
          loadManualQueueAdmin();
        } catch (e) {
          console.error(e);
          await customAlert('Error al eliminar de la cola mixta');
        }
      };
      actions.appendChild(btnDel);

      const btnEdit = document.createElement('button');
      btnEdit.textContent = 'Editar';
      btnEdit.className   = 'btn-secondary btn-queue-admin';
      btnEdit.onclick = async () => {
        const isManual = item.source === 'manual';

        if (isManual) {
          const nuevoTitulo = await customPrompt(
            'Escribe el nuevo título de la canción:',
            item.displaySongTitle || item.songTitle || ''
          );
          if (nuevoTitulo === null) return;

          const limpioTitulo = nuevoTitulo.trim();
          if (!limpioTitulo) {
            await customAlert('El título no puede quedar vacío');
            return;
          }

          const nuevoArtista = await customPrompt(
            'Escribe el nuevo intérprete:',
            item.displaySongArtist || item.artist || ''
          );
          if (nuevoArtista === null) return;

          const limpioArtista = nuevoArtista.trim();
          if (!limpioArtista) {
            await customAlert('El intérprete no puede quedar vacío');
            return;
          }

          let resEdit, dataEdit;
          try {
            resEdit = await fetch(`${API_BASE}/api/manual-queue/${item.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                manualSongTitle:  limpioTitulo,
                manualSongArtist: limpioArtista
              })
            });
            dataEdit = await resEdit.json();
          } catch (e) {
            await customAlert('Error al editar la canción manual');
            return;
          }

          if (!resEdit.ok || !dataEdit.ok) {
            await customAlert(dataEdit.message || 'No se pudo actualizar la canción manual');
            return;
          }
        } else {
          const nuevoTitulo = await customPrompt(
            'Escribe el nuevo título de la canción:',
            item.displaySongTitle || item.songTitle || ''
          );
          if (nuevoTitulo === null) return;

          const limpio = nuevoTitulo.trim();
          if (!limpio) {
            await customAlert('El título no puede quedar vacío');
            return;
          }

          let resEdit, dataEdit;
          try {
            resEdit = await fetch(`${API_BASE}/api/queue/${item.id}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ songTitle: limpio })
            });
            dataEdit = await resEdit.json();
          } catch (e) {
            await customAlert('Error al editar la canción');
            return;
          }

          if (!resEdit.ok || !dataEdit.ok) {
            await customAlert(dataEdit.message || 'No se pudo actualizar la canción');
            return;
          }
        }

        await loadMixedQueueAdmin();
        loadQueueAdmin();
        loadManualQueueAdmin();
      };
      actions.appendChild(btnEdit);

      content.appendChild(actions);
      row.appendChild(content);
      div.appendChild(row);
    });
  });
}

// Botón para limpiar TODA la cola mixta (catálogo + manual)
function setupClearMixedQueueButton() {
  const btnClearMixed = document.getElementById('btn-clear-mixed-queue');
  if (!btnClearMixed) return;

  btnClearMixed.onclick = async () => {
    if (!adminLogged) {
      await customAlert('Primero inicia sesión como admin');
      return;
    }

    const ok = await customConfirm('¿Seguro que quieres eliminar TODOS los registros de la cola mixta (catálogo + manual)?');
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/api/mixed-queue`, {
        method: 'DELETE'
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        await customAlert('Respuesta inválida del servidor al limpiar cola mixta');
        return;
      }

      if (!res.ok || !data.ok) {
        await customAlert(data.message || 'No se pudo limpiar la cola mixta');
        return;
      }

      loadMixedQueueAdmin();
      loadQueueAdmin();
      loadManualQueueAdmin();
    } catch (e) {
      console.error(e);
      await customAlert('No se pudo conectar para limpiar la cola mixta');
    }
  };
}

// ========= HISTORIAL EN PANEL ADMIN =========

async function loadHistoryAdmin(fromDateStr, toDateStr) {
  const div = document.getElementById('history-admin');
  if (!div) return;

  // Save scroll positions BEFORE the async fetch so the page never jumps
  const prevScrollTop   = div.scrollTop;
  const prevPageScrollY = window.scrollY;

  let res, data;
  try {
    res  = await fetch(`${API_BASE}/api/history`, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error(e);
    smoothRefreshContainer(div, () => { div.textContent = 'No se pudo conectar para cargar historial'; });
    return;
  }

  if (!res.ok || !data.ok) {
    smoothRefreshContainer(div, () => { div.textContent = data.message || 'Error cargando historial'; });
    return;
  }

  let items = data.history || [];

  if (fromDateStr || toDateStr) {
    let fromTime = null;
    let toTime   = null;

    if (fromDateStr) {
      fromTime = new Date(fromDateStr + 'T00:00:00').getTime();
    }
    if (toDateStr) {
      toTime = new Date(toDateStr + 'T23:59:59').getTime();
    }

    items = items.filter(h => {
      if (!h.playedAt) return false;
      const t = new Date(h.playedAt).getTime();
      if (Number.isNaN(t)) return false;

      if (fromTime != null && t < fromTime) return false;
      if (toTime   != null && t > toTime)   return false;

      return true;
    });
  }

  // Lock height to prevent container collapse, then rebuild
  const prevMinHeight = div.style.minHeight;
  div.style.minHeight = div.offsetHeight + 'px';

  div.innerHTML = '';

  if (!items.length) {
    div.textContent = 'Aún no hay historial.';
    div.style.minHeight = prevMinHeight;
    div.scrollTop = prevScrollTop;
    if (window.scrollY !== prevPageScrollY) {
      window.scrollTo({ top: prevPageScrollY, behavior: 'instant' });
    }
    return;
  }

  items.forEach((h, idx) => {
    const row = document.createElement('div');
    row.className = 'queue-admin-item-line';

    const content = document.createElement('div');
    content.className = 'queue-admin-item-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'queue-admin-item-text';

    const fechaRegistro = h.createdAt ? new Date(h.createdAt).toLocaleString('es-MX') : '';
    const fechaAtendida = h.playedAt ? new Date(h.playedAt).toLocaleString('es-MX') : '';

    // Posiciones en las 3 colas (registros nuevos)
    const lugarCatalogo = (h.catalogPosition != null && h.catalogTotal != null)
      ? ` | Lugar en cola catálogo: ${h.catalogPosition}/${h.catalogTotal}`
      : '';
    const lugarManual = (h.manualPosition != null && h.manualTotal != null)
      ? ` | Lugar en cola manual: ${h.manualPosition}/${h.manualTotal}`
      : '';
    const lugarMixta = (h.mixedPosition != null && h.mixedTotal != null)
      ? ` | Lugar en cola mixta: ${h.mixedPosition}/${h.mixedTotal}`
      : '';
    // Compatibilidad con registros anteriores que solo tienen queuePosition
    const lugarColaLegacy = (!lugarCatalogo && !lugarManual && h.queuePosition != null && h.queueTotal != null)
      ? ` | Lugar en cola: ${h.queuePosition}/${h.queueTotal}`
      : '';

    const userNameUpper  = toUpperNoAccents(h.userName || '');
    const songTitleUpper = toUpperNoAccents(h.songTitle || '');

    let texto = `${idx + 1}. Mesa ${h.tableNumber} - ${userNameUpper} - ${songTitleUpper}`;
    if (fechaRegistro) {
      texto += ` | Registrado: ${fechaRegistro}`;
    }
    if (fechaAtendida) {
      texto += ` | Atendido: ${fechaAtendida}`;
    }
    texto += lugarCatalogo;
    texto += lugarManual;
    texto += lugarMixta;
    texto += lugarColaLegacy;

    textSpan.textContent = texto;

    content.appendChild(textSpan);
    row.appendChild(content);
    div.appendChild(row);
  });

  // Restore container scroll and release height lock
  div.scrollTop       = prevScrollTop;
  div.style.minHeight = prevMinHeight;

  // Restore page-level scroll if the layout shift moved it
  if (window.scrollY !== prevPageScrollY) {
    window.scrollTo({ top: prevPageScrollY, behavior: 'instant' });
  }
}

// Descargar CSV de historial
async function exportHistoryCsv() {
  if (!adminLogged) {
    await customAlert('Primero inicia sesión como admin');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/history/export`);
    if (!res.ok) {
      const text = await res.text();
      await customAlert('No se pudo exportar el historial: ' + text);
      return;
    }

    const blob = await res.blob();
    const url  = window.URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    const fecha = new Date().toISOString().slice(0, 10);
    a.download = `historial_karaoke_${fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    await customAlert('Error al descargar el CSV de historial');
  }
}

// Botones de historial
function setupHistoryButtons() {
  const btnShowHistory    = document.getElementById('btn-show-history');
  const btnExportHistory  = document.getElementById('btn-export-history');
  const btnClearHistory   = document.getElementById('btn-clear-history');
  const historyContainer  = document.getElementById('history-admin');

  const inputFrom      = document.getElementById('history-from');
  const inputTo        = document.getElementById('history-to');
  const btnApplyFilter = document.getElementById('btn-apply-history-filter');

  if (btnShowHistory && historyContainer) {
    historyContainer.style.display = 'none';
    historyHidden = true;

    btnShowHistory.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }

      const isHidden = historyHidden;

      if (isHidden) {
        const fromDateStr = inputFrom ? inputFrom.value : '';
        const toDateStr   = inputTo   ? inputTo.value   : '';
        await loadHistoryAdmin(fromDateStr, toDateStr);
        historyContainer.style.display = 'block';
        btnShowHistory.textContent     = 'Ocultar historial';
        historyHidden = false;
      } else {
        historyContainer.style.display = 'none';
        btnShowHistory.textContent     = 'Ver historial';
        historyHidden = true;
      }

      startAutoRefreshAdmin();
    };
  }

  if (btnApplyFilter && historyContainer) {
    btnApplyFilter.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const fromDateStr = inputFrom ? inputFrom.value : '';
      const toDateStr   = inputTo   ? inputTo.value   : '';
      await loadHistoryAdmin(fromDateStr, toDateStr);
      historyContainer.style.display = 'block';
      const btnShowHistory2 = document.getElementById('btn-show-history');
      if (btnShowHistory2) {
        btnShowHistory2.textContent = 'Ocultar historial';
      }
      historyHidden = false;
      startAutoRefreshAdmin();
    };
  }

  if (btnExportHistory) {
    btnExportHistory.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      exportHistoryCsv();
    };
  }

  if (btnClearHistory && historyContainer) {
    btnClearHistory.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }

      const ok = await customConfirm('¿Seguro que quieres eliminar TODO el historial de canciones?');
      if (!ok) return;

      try {
        const res = await fetch(`${API_BASE}/api/history`, {
          method: 'DELETE'
        });

        let data;
        try {
          data = await res.json();
        } catch (e) {
          await customAlert('Respuesta inválida del servidor al limpiar historial');
          return;
        }

        if (!res.ok || !data.ok) {
          await customAlert(data.message || 'No se pudo limpiar el historial');
          return;
        }

        historyContainer.innerHTML = 'Aún no hay historial.';
      } catch (e) {
        console.error(e);
        await customAlert('No se pudo conectar para limpiar el historial');
      }
    };
  }
}

// ========= SUGERENCIAS DE CANCIONES (ADMIN) =========

async function loadSongSuggestions() {
  const container = document.getElementById('suggestions-list');
  if (!container) return;

  const prevScrollTop = container.scrollTop;

  container.innerHTML = 'Cargando sugerencias...';

  let res, data;
  try {
    res  = await fetch(`${API_BASE}/api/song-suggestions`, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error(e);
    container.textContent = 'No se pudo cargar la lista de sugerencias.';
    return;
  }

  if (!res.ok || !data.ok) {
    container.textContent = data.message || 'Error al cargar sugerencias.';
    return;
  }

  const suggestions = data.suggestions || [];
  if (!suggestions.length) {
    container.textContent = 'No hay sugerencias registradas.';
    return;
  }

  container.innerHTML = '';

  suggestions.forEach(s => {
    const card = document.createElement('div');
    card.className = 'queue-admin-item-line';

    const content = document.createElement('div');
    content.className = 'queue-admin-item-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'queue-admin-item-text';

    const titleText  = toUpperNoAccents(s.title  || '');
    const artistText = toUpperNoAccents(s.artist || '');
    const mesaTxt    = s.tableNumber ? `Mesa: ${s.tableNumber}` : 'Mesa: (no especificada)';
    const userTxt    = s.userName    ? `Nombre: ${s.userName}`  : 'Nombre: (no especificado)';
    const fecha      = s.createdAt   ? `Registrada: ${s.createdAt}` : '';

    let linea = `Canción: ${titleText} - ${artistText} | ${mesaTxt} | ${userTxt}`;
    if (fecha) {
      linea += ` | ${fecha}`;
    }
    textSpan.textContent = linea;

    content.appendChild(textSpan);

    const actions = document.createElement('div');
    actions.className = 'queue-admin-item-actions';

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Eliminar sugerencia';
    btnDelete.className   = 'btn-danger btn-queue-admin';
    btnDelete.onclick = async () => {
      const ok = await customConfirm('¿Seguro que deseas eliminar esta sugerencia?');
      if (!ok) return;

      try {
        const resDel  = await fetch(`${API_BASE}/api/song-suggestions/${s.id}`, {
          method: 'DELETE'
        });
        const dataDel = await resDel.json();
        if (!resDel.ok || !dataDel.ok) {
          await customAlert(dataDel.message || 'No se pudo eliminar la sugerencia.');
          return;
        }
        await loadSongSuggestions();
      } catch (e) {
        console.error(e);
        await customAlert('Error eliminando la sugerencia.');
      }
    };

    actions.appendChild(btnDelete);
    content.appendChild(actions);

    card.appendChild(content);
    container.appendChild(card);
  });

  container.scrollTop = prevScrollTop;
}

function setupSuggestionsSection() {
  const btnToggleSuggestionsCard = document.getElementById('btn-toggle-suggestions-card');
  const suggestionsList          = document.getElementById('suggestions-list');
  const btnExportSuggestions     = document.getElementById('btn-export-suggestions');
  const btnClearSuggestions      = document.getElementById('btn-clear-suggestions');

  if (suggestionsList) {
    suggestionsList.style.display = 'none';
    suggestionsHidden = true;
  }

  if (btnToggleSuggestionsCard && suggestionsList) {
    btnToggleSuggestionsCard.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const isHidden = suggestionsHidden;
      if (isHidden) {
        suggestionsList.style.display = 'block';
        suggestionsHidden = false;
        loadSongSuggestions();
      } else {
        suggestionsList.style.display = 'none';
        suggestionsHidden = true;
      }
      startAutoRefreshAdmin();
    };
  }

  if (btnExportSuggestions) {
    btnExportSuggestions.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      try {
        const res = await fetch(`${API_BASE}/api/song-suggestions/export`);
        if (!res.ok) {
          const text = await res.text();
          await customAlert('No se pudo exportar sugerencias: ' + text);
          return;
        }
        const blob = await res.blob();
        const url  = window.URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        const fecha = new Date().toISOString().slice(0, 10);
        a.download = `sugerencias_karaoke_${fecha}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(url);
      } catch (e) {
        console.error(e);
        await customAlert('Error al exportar sugerencias');
      }
    };
  }

  if (btnClearSuggestions && suggestionsList) {
    btnClearSuggestions.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const ok = await customConfirm('¿Seguro que quieres eliminar TODAS las sugerencias?');
      if (!ok) return;

      try {
        const res = await fetch(`${API_BASE}/api/song-suggestions`, {
          method: 'DELETE'
        });
        let data;
        try {
          data = await res.json();
        } catch (e) {
          await customAlert('Respuesta inválida del servidor al limpiar sugerencias');
          return;
        }
        if (!res.ok || !data.ok) {
          await customAlert(data.message || 'No se pudieron eliminar las sugerencias');
          return;
        }
        suggestionsList.innerHTML = 'No hay sugerencias registradas.';
      } catch (e) {
        console.error(e);
        await customAlert('No se pudo conectar para limpiar las sugerencias');
      }
    };
  }
}

// ========= CONTROL DE HORARIO / REGISTROS ABIERTOS-CERRADOS =========
async function refreshQueueOpenStatus() {
  const pStatus  = document.getElementById('queue-open-status');
  const btnClose = document.getElementById('btn-close-queue');
  const btnOpen  = document.getElementById('btn-open-queue');
  if (!pStatus || !btnClose || !btnOpen) return;

  try {
    const res  = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    if (data.isQueueOpen) {
      pStatus.textContent = 'Estado: se pueden registrar canciones';
      btnClose.disabled = false;
      btnOpen.disabled  = true;
    } else {
      pStatus.textContent = 'Estado: horario concluido (no se aceptan canciones nuevas)';
      btnClose.disabled = true;
      btnOpen.disabled  = false;
    }
  } catch (e) {
    console.error('Error leyendo estado de la cola', e);
  }
}

function setupQueueOpenButtons() {
  const btnClose = document.getElementById('btn-close-queue');
  const btnOpen  = document.getElementById('btn-open-queue');
  if (!btnClose && !btnOpen) return;

  if (btnClose) {
    btnClose.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }

      const pass = await customPrompt('Confirma la contraseña de administrador para cerrar registros:');
      if (!pass) return;

      let res, data;
      try {
        res = await fetch(`${API_BASE}/api/admin/set-queue-open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminPassword: pass, isQueueOpen: false })
        });
        data = await res.json();
      } catch (e) {
        console.error(e);
        await customAlert('No se pudo conectar para cambiar el estado de registros');
        return;
      }

      if (!res.ok || !data.ok) {
        await customAlert(data.message || 'No se pudo cerrar los registros');
        return;
      }

      await customAlert('Se ha cerrado el registro de canciones.');
      refreshQueueOpenStatus();
    };
  }

  if (btnOpen) {
    btnOpen.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }

      const pass = await customPrompt('Confirma la contraseña de administrador para abrir registros:');
      if (!pass) return;

      let res, data;
      try {
        res = await fetch(`${API_BASE}/api/admin/set-queue-open`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ adminPassword: pass, isQueueOpen: true })
        });
        data = await res.json();
      } catch (e) {
        console.error(e);
        await customAlert('No se pudo conectar para cambiar el estado de registros');
        return;
      }

      if (!res.ok || !data.ok) {
        await customAlert(data.message || 'No se pudo abrir los registros');
        return;
      }

      await customAlert('Se ha abierto el registro de canciones.');
      refreshQueueOpenStatus();
    };
  }
}

// ========= GESTIÓN DE MESAS EN PANEL ADMIN =========
async function loadTablesAdmin() {
  const div = document.getElementById('tables-admin');
  if (!div) return;

  const prevScrollTop = div.scrollTop;

  div.innerHTML = 'Cargando mesas...';

  let res, data;
  try {
    res  = await fetch(`${API_BASE}/api/tables`);
    data = await res.json();
  } catch (e) {
    console.error(e);
    div.textContent = 'No se pudo conectar para cargar mesas';
    return;
  }

  if (!res.ok || !data.ok) {
    div.textContent = data.message || 'Error cargando mesas';
    return;
  }

  const tables = data.tables || [];
  div.innerHTML = '';

  if (!tables.length) {
    div.textContent = 'No hay mesas registradas aún.';
    return;
  }

  tables.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'table-item';

    const span = document.createElement('span');
    const maxSongs = t.maxSongs != null ? t.maxSongs : 1;
    const maxSongsPerUser = t.maxSongsPerUser != null ? t.maxSongsPerUser : 1;
    span.innerHTML = `Mesa: <span style="background-color: white; color: black; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-right: 4px;">${t.tableNumber}</span> (máx: ${maxSongs} mesa, ${maxSongsPerUser} persona)`;
    row.appendChild(span);

    const inputMax = document.createElement('input');
    inputMax.type  = 'number';
    inputMax.min   = '1';
    inputMax.step  = '1';
    inputMax.value = maxSongs;
    inputMax.style.width      = '70px';
    inputMax.style.marginLeft = '8px';
    row.appendChild(inputMax);

    const inputMaxUser = document.createElement('input');
    inputMaxUser.type  = 'number';
    inputMaxUser.min   = '1';
    inputMaxUser.step  = '1';
    inputMaxUser.value = maxSongsPerUser;
    inputMaxUser.style.width      = '70px';
    inputMaxUser.style.marginLeft = '8px';
    row.appendChild(inputMaxUser);

    const btnSaveMax = document.createElement('button');
    btnSaveMax.textContent = 'Guardar límites';
    btnSaveMax.className   = 'btn-secondary btn-queue-admin';
    btnSaveMax.style.marginLeft = '6px';
    btnSaveMax.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const val = parseInt(inputMax.value, 10);
      if (Number.isNaN(val) || val < 1) {
        await customAlert('El número mínimo de canciones por mesa es 1');
        return;
      }
      const valUser = parseInt(inputMaxUser.value, 10);
      if (Number.isNaN(valUser) || valUser < 1) {
        await customAlert('El número mínimo de canciones por persona es 1');
        return;
      }
      try {
        const resPut = await fetch(`${API_BASE}/api/tables/${t.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxSongs: val, maxSongsPerUser: valUser })
        });
        const dataPut = await resPut.json();
        if (!resPut.ok || !dataPut.ok) {
          await customAlert(dataPut.message || 'No se pudo actualizar el límite de canciones');
          return;
        }
        await customAlert('Límites actualizados para la mesa ' + t.tableNumber);
        loadTablesAdmin();
      } catch (e) {
        console.error(e);
        await customAlert('No se pudo conectar para actualizar los límites');
      }
    };
    row.appendChild(btnSaveMax);

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Eliminar';
    btnDelete.className   = 'btn-danger btn-queue-admin';
    btnDelete.style.marginLeft = '6px';
    btnDelete.onclick = async () => {
      const ok = await customConfirm(`¿Seguro que quieres eliminar la mesa ${t.tableNumber}?`);
      if (!ok) return;

      const resDel = await fetch(`${API_BASE}/api/tables/${t.id}`, {
        method: 'DELETE'
      });

      let dataDel;
      try {
        dataDel = await resDel.json();
      } catch (e) {
        await customAlert('Respuesta inválida del servidor al eliminar mesa');
        return;
      }

      if (!resDel.ok || !dataDel.ok) {
        await customAlert(dataDel.message || 'No se pudo eliminar la mesa');
        return;
      }

      loadTablesAdmin();
    };

    row.appendChild(btnDelete);
    div.appendChild(row);
  });

  div.scrollTop = prevScrollTop;
}

// Alta de nueva mesa
function setupAddTableButton() {
  const btnAddTable = document.getElementById('btn-add-table');
  if (!btnAddTable) return;

  btnAddTable.onclick = async () => {
    if (!adminLogged) {
      await customAlert('Primero inicia sesión como admin');
      return;
    }

    const input = document.getElementById('new-table-number');
    if (!input) return;

    const value = input.value.trim();
    if (!value) {
      await customAlert('Escribe el número de mesa');
      return;
    }

    const inputMax  = document.getElementById('new-table-max-songs');
    let maxSongsVal = 1;
    if (inputMax) {
      const parsed = parseInt(inputMax.value, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        maxSongsVal = parsed;
      }
    }

    const inputMaxUser = document.getElementById('new-table-max-songs-user');
    let maxSongsPerUserVal = 1;
    if (inputMaxUser) {
      const parsedUser = parseInt(inputMaxUser.value, 10);
      if (!Number.isNaN(parsedUser) && parsedUser > 0) {
        maxSongsPerUserVal = parsedUser;
      }
    }

    let res, data;
    try {
      res = await fetch(`${API_BASE}/api/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          tableNumber: value, 
          maxSongs: maxSongsVal, 
          maxSongsPerUser: maxSongsPerUserVal 
        })
      });
      data = await res.json();
    } catch (e) {
      console.error(e);
      await customAlert('No se pudo conectar para agregar mesa');
      return;
    }

    if (!res.ok || !data.ok) {
      await customAlert(data.message || 'No se pudo agregar la mesa');
      return;
    }

    input.value = '';
    if (inputMax) inputMax.value = '';
    if (inputMaxUser) inputMaxUser.value = '';
    loadTablesAdmin();
  };
}

// Botón para limpiar TODAS las mesas
function setupClearTablesButton() {
  const btnClearTables = document.getElementById('btn-clear-tables');
  if (!btnClearTables) return;

  btnClearTables.onclick = async () => {
    if (!adminLogged) {
      await customAlert('Primero inicia sesión como admin');
      return;
    }

    const ok = await customConfirm('¿Seguro que quieres eliminar TODAS las mesas?');
    if (!ok) return;

    let res, data;
    try {
      res = await fetch(`${API_BASE}/api/tables`, {
        method: 'DELETE'
      });
      data = await res.json();
    } catch (e) {
      console.error(e);
      await customAlert('No se pudo conectar para limpiar las mesas');
      return;
    }

    if (!res.ok || !data.ok) {
      await customAlert(data.message || 'No se pudieron eliminar las mesas');
      return;
    }

    loadTablesAdmin();
  };
}

// Botón para limpiar TODA la cola manual (versión nueva)
function setupClearManualQueueButton() {
  const btnClearManual = document.getElementById('btn-clear-manual-queue');
  if (!btnClearManual) return;

  btnClearManual.onclick = async () => {
    if (!adminLogged) {
      await customAlert('Primero inicia sesión como admin');
      return;
    }

    const ok = await customConfirm('¿Seguro que quieres eliminar TODOS los registros de la cola manual?');
    if (!ok) return;

    try {
      const res = await fetch(`${API_BASE}/api/manual-queue`, {
        method: 'DELETE'
      });

      let data;
      try {
        data = await res.json();
      } catch (e) {
        await customAlert('Respuesta inválida del servidor al limpiar cola manual');
        return;
      }

      if (!res.ok || !data.ok) {
        await customAlert(data.message || 'No se pudo limpiar la cola manual');
        return;
      }

      loadManualQueueAdmin();
      loadMixedQueueAdmin();
    } catch (e) {
      console.error(e);
      await customAlert('No se pudo conectar para limpiar la cola manual');
    }
  };
}

// ========= TOGGLES DE SECCIONES PRINCIPALES =========

function setupToggleButtons() {
  // Inicio (cambio de contraseñas / título)
  const btnToggleInicio = document.getElementById('btn-toggle-inicio');
  const inicioSection   = document.getElementById('inicio-admin-section');
  if (btnToggleInicio && inicioSection) {
    inicioHidden = true;
    inicioSection.style.display = 'none';
    btnToggleInicio.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const visible = !inicioHidden;
      if (visible) {
        inicioSection.style.display = 'none';
        inicioHidden = true;
      } else {
        inicioSection.style.display = 'block';
        inicioHidden = false;
      }
    };
  }

  // Cola catálogo
  const btnToggleQueue = document.getElementById('btn-toggle-queue');
  const queueDiv       = document.getElementById('queue-admin');
  if (btnToggleQueue && queueDiv) {
    queueAdminHidden = true;
    queueDiv.style.display = 'none';
    btnToggleQueue.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const visible = !queueAdminHidden;
      if (visible) {
        queueDiv.style.display = 'none';
        queueAdminHidden = true;
        btnToggleQueue.textContent = 'Mostrar cola por catálogo';
      } else {
        queueDiv.style.display = 'block';
        queueAdminHidden = false;
        btnToggleQueue.textContent = 'Ocultar cola por catálogo';
        loadQueueAdmin();
      }
      startAutoRefreshAdmin();
    };
    btnToggleQueue.textContent = 'Mostrar cola por catálogo';
  }

  // Cola manual
  const btnToggleManualQueue = document.getElementById('btn-toggle-manual-queue');
  const manualQueueDiv       = document.getElementById('manual-queue-admin');
  if (btnToggleManualQueue && manualQueueDiv) {
    manualQueueAdminHidden = true;
    manualQueueDiv.style.display = 'none';
    btnToggleManualQueue.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const visible = !manualQueueAdminHidden;
      if (visible) {
        manualQueueDiv.style.display = 'none';
        manualQueueAdminHidden = true;
        btnToggleManualQueue.textContent = 'Mostrar cola manual';
      } else {
        manualQueueDiv.style.display = 'block';
        manualQueueAdminHidden = false;
        btnToggleManualQueue.textContent = 'Ocultar cola manual';
        loadManualQueueAdmin();
      }
      startAutoRefreshAdmin();
    };
    btnToggleManualQueue.textContent = 'Mostrar cola manual';
  }

  // Cola mixta
  const btnToggleMixedQueue = document.getElementById('btn-toggle-mixed-queue');
  const mixedQueueDiv       = document.getElementById('mixed-queue-admin');
  if (btnToggleMixedQueue && mixedQueueDiv) {
    mixedQueueAdminHidden = true;
    mixedQueueDiv.style.display = 'none';
    btnToggleMixedQueue.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const visible = !mixedQueueAdminHidden;
      if (visible) {
        mixedQueueDiv.style.display = 'none';
        mixedQueueAdminHidden = true;
        btnToggleMixedQueue.textContent = 'Mostrar cola mixta';
      } else {
        mixedQueueDiv.style.display = 'block';
        mixedQueueAdminHidden = false;
        btnToggleMixedQueue.textContent = 'Ocultar cola mixta';
        loadMixedQueueAdmin();
      }
      startAutoRefreshAdmin();
    };
    btnToggleMixedQueue.textContent = 'Mostrar cola mixta';
  }

  // Listado de mesas
  const btnToggleTables = document.getElementById('btn-toggle-tables');
  const tablesDiv       = document.getElementById('tables-admin');
  if (btnToggleTables && tablesDiv) {
    tablesHidden = true;
    tablesDiv.style.display = 'none';
    btnToggleTables.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const visible = !tablesHidden;
      if (visible) {
        tablesDiv.style.display = 'none';
        tablesHidden = true;
        btnToggleTables.textContent = 'Mostrar mesas';
      } else {
        tablesDiv.style.display = 'block';
        tablesHidden = false;
        btnToggleTables.textContent = 'Ocultar mesas';
        loadTablesAdmin();
      }
    };
    btnToggleTables.textContent = 'Mostrar mesas';
  }
}

// ========= AUTO-REFRESCO SECCIONES =========

function clearAllIntervals() {
  if (queueAdminInterval) {
    clearInterval(queueAdminInterval);
    queueAdminInterval = null;
  }
  if (manualQueueAdminInterval) {
    clearInterval(manualQueueAdminInterval);
    manualQueueAdminInterval = null;
  }
  if (mixedQueueAdminInterval) {
    clearInterval(mixedQueueAdminInterval);
    mixedQueueAdminInterval = null;
  }
  if (historyInterval) {
    clearInterval(historyInterval);
    historyInterval = null;
  }
  if (suggestionsInterval) {
    clearInterval(suggestionsInterval);
    suggestionsInterval = null;
  }
  if (activeUsersInterval) {
    clearInterval(activeUsersInterval);
    activeUsersInterval = null;
  }
  if (loginHistoryInterval) {
    clearInterval(loginHistoryInterval);
    loginHistoryInterval = null;
  }
}

function startAutoRefreshAdmin() {
  clearAllIntervals();
  if (!adminLogged) return;

  // Actualizar siempre los datos y conteos en segundo plano, sin importar si están ocultos
  loadQueueAdmin();
  queueAdminInterval = setInterval(loadQueueAdmin, 5000);

  loadManualQueueAdmin();
  manualQueueAdminInterval = setInterval(loadManualQueueAdmin, 5000);

  loadMixedQueueAdmin();
  mixedQueueAdminInterval = setInterval(loadMixedQueueAdmin, 5000);

  const fromInput   = document.getElementById('history-from');
  const toInput     = document.getElementById('history-to');
  loadHistoryAdmin(fromInput ? fromInput.value : '', toInput ? toInput.value : '');
  historyInterval = setInterval(() => {
    const fInp = document.getElementById('history-from');
    const tInp = document.getElementById('history-to');
    loadHistoryAdmin(fInp ? fInp.value : '', tInp ? tInp.value : '');
  }, 15000);

  loadActiveUsers();
  activeUsersInterval = setInterval(loadActiveUsers, 8000);

  loadLoginHistory();
  loginHistoryInterval = setInterval(() => {
    loadLoginHistory();
  }, 15000);

  if (!suggestionsHidden) {
    loadSongSuggestions();
    suggestionsInterval = setInterval(loadSongSuggestions, 15000);
  }
}

// ========= LEER Y GUARDAR BANDERAS DE PANTALLA DE USUARIO =========
async function loadUserFeaturesAdmin() {
  const cbSearch         = document.getElementById('feature-user-search');
  const cbQueue          = document.getElementById('feature-user-queue');
  const cbSuggestion     = document.getElementById('feature-user-suggestion');
  const cbManualQueue    = document.getElementById('feature-user-manual-queue');
  const cbManualRegister = document.getElementById('feature-user-manual-register');
  const cbMixedQueue     = document.getElementById('feature-user-mixed-queue');
  const cbColorDots      = document.getElementById('feature-show-color-dots');

  if (!cbSearch || !cbQueue || !cbSuggestion || !cbManualQueue || !cbManualRegister || !cbMixedQueue) {
    return;
  }

  try {
    const res  = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const features = data.userFeatures || {};

    const searchEnabled         = features.search         !== false;
    const queueEnabled          = features.queue          !== false;
    const suggestionEnabled     = features.suggestion     !== false;
    const manualQueueEnabled    = features.manualQueue    === true;
    const manualRegisterEnabled = features.manualRegister === true;
    const mixedQueueEnabled     = features.mixedQueue     === true;

    cbSearch.checked         = searchEnabled;
    cbQueue.checked          = queueEnabled;
    cbSuggestion.checked     = suggestionEnabled;
    cbManualQueue.checked    = manualQueueEnabled;
    cbManualRegister.checked = manualRegisterEnabled;
    cbMixedQueue.checked     = mixedQueueEnabled;

    if (cbColorDots) {
      cbColorDots.checked = data.showColorDots !== false;
    }
  } catch (e) {
    console.error('Error leyendo userFeatures en admin', e);
  }
}

function setupUserFeaturesControls() {
  const btnSave          = document.getElementById('btn-save-user-features');
  const cbSearch         = document.getElementById('feature-user-search');
  const cbQueue          = document.getElementById('feature-user-queue');
  const cbSuggestion     = document.getElementById('feature-user-suggestion');
  const cbManualQueue    = document.getElementById('feature-user-manual-queue');
  const cbManualRegister = document.getElementById('feature-user-manual-register');
  const cbMixedQueue     = document.getElementById('feature-user-mixed-queue');
  const cbColorDots      = document.getElementById('feature-show-color-dots');

  if (!btnSave || !cbSearch || !cbQueue || !cbSuggestion || !cbManualQueue || !cbManualRegister || !cbMixedQueue) {
    return;
  }

  btnSave.onclick = async () => {
    if (!adminLogged) {
      await customAlert('Primero inicia sesión como admin');
      return;
    }

    const body = {
      userFeatures: {
        search:         cbSearch.checked,
        queue:          cbQueue.checked,
        suggestion:     cbSuggestion.checked,
        manualQueue:    cbManualQueue.checked,
        manualRegister: cbManualRegister.checked,
        mixedQueue:     cbMixedQueue.checked
      }
    };

    try {
      const res  = await fetch(`${API_BASE}/api/admin/change-user-features`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        await customAlert(data.message || 'No se pudieron guardar las opciones de pantalla de usuario');
        return;
      }
    } catch (e) {
      console.error(e);
      await customAlert('No se pudo conectar para guardar las opciones de pantalla de usuario');
      return;
    }

    // Guardar preferencia de recuadros de color
    if (cbColorDots) {
      try {
        const res2  = await fetch(`${API_BASE}/api/admin/set-show-color-dots`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ showColorDots: cbColorDots.checked })
        });
        const data2 = await res2.json();
        if (!res2.ok || !data2.ok) {
          await customAlert(data2.message || 'No se pudo guardar la preferencia de recuadros de color');
          return;
        }
      } catch (e) {
        console.error(e);
        await customAlert('No se pudo conectar para guardar la preferencia de recuadros de color');
        return;
      }
    }

    await customAlert('Opciones de pantalla de usuario guardadas.\nLos cambios se aplicarán al recargar la pantalla de usuario.');
  };
}

// ========= AJUSTES DE COLA MANUAL Y PANTALLA PÚBLICA =========
async function loadManualQueueSettingsAdmin() {
  const inputManualMax = document.getElementById('manual-max-songs');
  const selectMode     = document.getElementById('public-queue-mode');
  if (!inputManualMax || !selectMode) return;

  try {
    const res  = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const manualMax = typeof data.manualMaxSongsPerTable === 'number'
      ? data.manualMaxSongsPerTable
      : 1;
    const mode = data.publicQueueMode === 'manual' ? 'manual' : 'catalog';

    inputManualMax.value = manualMax;
    selectMode.value     = mode;
  } catch (e) {
    console.error('Error leyendo configuración de cola manual/pantalla pública', e);
  }
}

function setupManualQueueSettingsControls() {
  const btnSaveSettings = document.getElementById('btn-save-manual-queue-settings');
  const inputManualMax  = document.getElementById('manual-max-songs');
  const selectMode      = document.getElementById('public-queue-mode');
  if (!btnSaveSettings || !inputManualMax || !selectMode) return;

  btnSaveSettings.onclick = async () => {
    if (!adminLogged) {
      await customAlert('Primero inicia sesión como admin');
      return;
    }

    const rawMax = inputManualMax.value.trim();
    let manualMax = parseInt(rawMax, 10);
    if (Number.isNaN(manualMax) || manualMax < 1) {
      manualMax = 1;
    }

    const mode = selectMode.value === 'manual' ? 'manual' : 'catalog';

    const pass = await customPrompt('Confirma la contraseña de administrador para guardar estos cambios:');
    if (!pass) return;

    try {
      const resMax = await fetch(`${API_BASE}/api/admin/change-manual-max-songs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: pass,
          manualMaxSongsPerTable: manualMax
        })
      });
      const dataMax = await resMax.json();
      if (!resMax.ok || !dataMax.ok) {
        await customAlert(dataMax.message || 'No se pudo guardar el límite de canciones manuales por mesa');
        return;
      }

      const resMode = await fetch(`${API_BASE}/api/admin/change-public-queue-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: pass,
          publicQueueMode: mode
        })
      });
      const dataMode = await resMode.json();
      if (!resMode.ok || !dataMode.ok) {
        await customAlert(dataMode.message || 'No se pudo guardar el modo de cola para la pantalla pública');
        return;
      }

      await customAlert('Configuración de cola manual y pantalla pública guardada correctamente.');
      loadManualQueueSettingsAdmin();
    } catch (e) {
      console.error(e);
      await customAlert('No se pudo conectar para guardar la configuración de cola manual y pantalla pública');
    }
  };
}

// ========= CONTROL DE COLA PARA PANTALLA PÚBLICA =========
async function loadPublicQueueDisplayPreference() {
  const select = document.getElementById('public-queue-display');
  if (!select) return;

  try {
    const res  = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const preference = data.publicQueueDisplay || 'catalog';
    select.value = preference;
  } catch (e) {
    console.error('Error leyendo preferencia de cola pública', e);
  }
}

function setupPublicQueueDisplayButton() {
  const btnSave = document.getElementById('btn-save-public-queue-display');
  const select  = document.getElementById('public-queue-display');
  if (!btnSave || !select) return;

  btnSave.onclick = async () => {
    if (!adminLogged) {
      await customAlert('Primero inicia sesión como admin');
      return;
    }

    const preference = select.value;

    try {
      const res = await fetch(`${API_BASE}/api/admin/set-public-queue-display`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminPassword: document.getElementById('admin-pass').value.trim(),
          publicQueueDisplay: preference
        })
      });

      const data = await res.json();
      if (!res.ok || !data.ok) {
        await customAlert(data.message || 'No se pudo guardar la preferencia');
        return;
      }

      await customAlert(`Pantalla pública configurada para mostrar: ${
        preference === 'catalog' ? 'Cola de catálogo' :
        preference === 'manual' ? 'Cola manual' :
        'Cola mixta'
      }`);
    } catch (e) {
      console.error(e);
      await customAlert('No se pudo conectar para guardar la preferencia');
    }
  };
}

// ========= CAMBIO DE CONTRASEÑAS Y TÍTULO =========

// Cambiar contraseña de administrador
document.getElementById('btn-change-admin-pass').onclick = async () => {
  if (!adminLogged) {
    await customAlert('Primero inicia sesión como admin');
    return;
  }

  const oldPass = document.getElementById('old-admin-pass').value.trim();
  const newPass = document.getElementById('new-admin-pass').value.trim();

  if (!oldPass || !newPass) {
    await customAlert('Escribe la contraseña actual y la nueva');
    return;
  }

  const res  = await fetch(`${API_BASE}/api/admin/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    await customAlert(data.message || 'No se pudo cambiar la contraseña');
    return;
  }

  await customAlert('Contraseña de administrador cambiada correctamente');
  document.getElementById('old-admin-pass').value = '';
  document.getElementById('new-admin-pass').value = '';
};

// Cambiar contraseña de usuario
document.getElementById('btn-change-user-pass').onclick = async () => {
  if (!adminLogged) {
    await customAlert('Primero inicia sesión como admin');
    return;
  }

  const adminPassForChange = document
    .getElementById('admin-pass-user-change')
    .value.trim();
  const newUserPass = document.getElementById('new-user-pass').value.trim();

  if (!adminPassForChange || !newUserPass) {
    await customAlert('Escribe la contraseña de administrador y la nueva contraseña de usuario');
    return;
  }

  const res  = await fetch(`${API_BASE}/api/admin/change-user-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adminPassword: adminPassForChange,
      newUserPassword: newUserPass
    })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    await customAlert(data.message || 'No se pudo cambiar la contraseña de usuario');
    return;
  }

  await customAlert('Contraseña de usuario cambiada correctamente');

  document.getElementById('admin-pass-user-change').value = '';
  document.getElementById('new-user-pass').value = '';
};

// Cambiar título de la aplicación (nombre del bar)
document.getElementById('btn-change-app-title').onclick = async () => {
  if (!adminLogged) {
    await customAlert('Primero inicia sesión como admin');
    return;
  }

  const adminPass = document.getElementById('admin-pass-app-title').value.trim();
  const newTitle  = document.getElementById('new-app-title').value.trim();

  if (!adminPass || !newTitle) {
    await customAlert('Escribe la contraseña de administrador y el nuevo título');
    return;
  }

  let res, data;
  try {
    res = await fetch(`${API_BASE}/api/admin/change-app-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminPassword: adminPass,
        newTitle
      })
    });
    data = await res.json();
  } catch (e) {
    console.error(e);
    await customAlert('No se pudo conectar para cambiar el título');
    return;
  }

  if (!res.ok || !data.ok) {
    await customAlert(data.message || 'No se pudo cambiar el título');
    return;
  }

  await customAlert('Título actualizado correctamente');

  document.getElementById('admin-pass-app-title').value = '';
};

// Cambiar mensaje al público (pantalla pública)
document.getElementById('btn-change-public-message').onclick = async () => {
  if (!adminLogged) {
    await customAlert('Primero inicia sesión como admin');
    return;
  }

  const adminPass = document.getElementById('admin-pass-public-message').value.trim();
  const newMessage = document.getElementById('new-public-message').value;

  if (!adminPass) {
    await customAlert('Escribe la contraseña de administrador');
    return;
  }

  let res, data;
  try {
    res = await fetch(`${API_BASE}/api/admin/change-public-message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: adminPass, newMessage })
    });
    data = await res.json();
  } catch (e) {
    console.error(e);
    await customAlert('No se pudo conectar para cambiar el mensaje');
    return;
  }

  if (!res.ok || !data.ok) {
    await customAlert(data.message || 'No se pudo cambiar el mensaje');
    return;
  }

  await customAlert(newMessage.trim() ? 'Mensaje actualizado correctamente' : 'Mensaje eliminado (no se mostrará)');
  document.getElementById('admin-pass-public-message').value = '';
};

// ========= MINUTOS POR TURNO =========

async function loadMinutesPerTurn() {
  try {
    const res  = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;
    if (typeof data.minutesPerTurn === 'number' && data.minutesPerTurn > 0) {
      minutesPerTurn = data.minutesPerTurn;
    }
    const input = document.getElementById('minutes-per-turn');
    if (input) input.value = minutesPerTurn;
  } catch (e) {
    console.error('Error leyendo minutesPerTurn', e);
  }
}

function setupMinutesPerTurnControl() {
  const btnSave = document.getElementById('btn-save-minutes-per-turn');
  const input   = document.getElementById('minutes-per-turn');
  if (!btnSave || !input) return;

  btnSave.onclick = async () => {
    if (!adminLogged) {
      await customAlert('Primero inicia sesión como admin');
      return;
    }
    const val = parseInt(input.value, 10);
    if (Number.isNaN(val) || val < 1) {
      await customAlert('El número mínimo de minutos por turno es 1');
      return;
    }
    try {
      const res  = await fetch(`${API_BASE}/api/admin/set-minutes-per-turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ minutesPerTurn: val })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        await customAlert(data.message || 'No se pudo guardar');
        return;
      }
      minutesPerTurn = val;
      await customAlert('Minutos por turno guardados correctamente.');
    } catch (e) {
      console.error(e);
      await customAlert('No se pudo conectar para guardar los minutos por turno');
    }
  };
}

// ========= USUARIOS CONECTADOS =========
async function loadActiveUsers() {
  const container = document.getElementById('active-users-list');
  const countBadge = document.getElementById('active-users-count');
  if (!container || !countBadge) return;

  const prevScrollTop = container.scrollTop;

  let res, data;
  try {
    res = await fetch(`${API_BASE}/api/admin/active-users`, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error(e);
    container.textContent = 'No se pudo cargar la lista de usuarios activos.';
    return;
  }

  if (!res.ok || !data.ok) {
    container.textContent = data.message || 'Error al cargar usuarios activos.';
    return;
  }

  const users = data.activeUsers || [];
  countBadge.textContent = users.length;

  if (!users.length) {
    container.textContent = 'No hay usuarios conectados actualmente.';
    return;
  }

  container.innerHTML = '';
  users.forEach(u => {
    const card = document.createElement('div');
    card.className = 'queue-admin-item-line';

    const content = document.createElement('div');
    content.className = 'queue-admin-item-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'queue-admin-item-text';

    const loginTime = u.loginAt ? new Date(u.loginAt).toLocaleString('es-MX', { hour: 'numeric', minute: 'numeric', hour12: true }) : '';
    const now = new Date();
    const loginDate = u.loginAt ? new Date(u.loginAt) : new Date();
    const diffMin = Math.floor((now - loginDate) / 60000);
    const tiempoConexion = isNaN(diffMin) ? '' : (diffMin < 60 ? `${diffMin} min` : `${Math.floor(diffMin / 60)}h ${diffMin % 60}m`);
    const cancionesStr = u.songsRequested != null ? ` | Canciones registradas: ${u.songsRequested}` : '';

    textSpan.textContent = `Mesa: ${u.tableNumber} | Usuario: ${toUpperNoAccents(u.userName)} | Ingreso: ${loginTime} | T. conectado: ${tiempoConexion}${cancionesStr}`;

    content.appendChild(textSpan);
    card.appendChild(content);
    container.appendChild(card);
  });

  container.scrollTop = prevScrollTop;
}

function setupActiveUsersButtons() {
  const btnToggle = document.getElementById('btn-toggle-active-users');
  const listContainer = document.getElementById('active-users-list');
  const hint = document.getElementById('active-users-hint');

  if (btnToggle && listContainer) {
    btnToggle.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      activeUsersHidden = !activeUsersHidden;
      if (!activeUsersHidden) {
        listContainer.style.display = 'block';
        if (hint) hint.style.display = 'block';
        btnToggle.textContent = 'Ocultar usuarios conectados';
        loadActiveUsers();
      } else {
        listContainer.style.display = 'none';
        if (hint) hint.style.display = 'none';
        btnToggle.textContent = 'Ver usuarios conectados';
      }
      startAutoRefreshAdmin();
    };
  }
}

// ========= HISTORIAL DE REGISTROS =========
async function loadLoginHistory() {
  const container = document.getElementById('login-history-list');
  const countBadge = document.getElementById('login-history-count');
  if (!container || !countBadge) return;

  const prevScrollTop = container.scrollTop;

  const fromDateStr = document.getElementById('login-history-from').value;
  const toDateStr = document.getElementById('login-history-to').value;

  let res, data;
  try {
    let url = `${API_BASE}/api/admin/login-history`;
    const params = new URLSearchParams();
    if (fromDateStr) params.append('from', fromDateStr);
    if (toDateStr) params.append('to', toDateStr);
    if (params.toString()) url += `?${params.toString()}`;

    res = await fetch(url, { cache: 'no-store' });
    data = await res.json();
  } catch (e) {
    console.error(e);
    container.textContent = 'No se pudo cargar el historial de registros.';
    return;
  }

  if (!res.ok || !data.ok) {
    container.textContent = data.message || 'Error al cargar historial de registros.';
    return;
  }

  const history = data.history || data.loginHistory || [];
  countBadge.textContent = history.length;

  if (!history.length) {
    container.textContent = 'No hay registros en las fechas seleccionadas.';
    return;
  }

  container.innerHTML = '';
  history.forEach(h => {
    const card = document.createElement('div');
    card.className = 'queue-admin-item-line';

    const content = document.createElement('div');
    content.className = 'queue-admin-item-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'queue-admin-item-text';

    const fechaStr = h.loginAt ? new Date(h.loginAt).toLocaleString('es-MX') : '';
    const cancionesStr = h.songsRequested != null ? ` | Canciones registradas: ${h.songsRequested}` : '';
    textSpan.textContent = `Mesa: ${h.tableNumber} | Usuario: ${toUpperNoAccents(h.userName)} | Fecha y hora: ${fechaStr}${cancionesStr}`;

    content.appendChild(textSpan);
    card.appendChild(content);
    container.appendChild(card);
  });

  container.scrollTop = prevScrollTop;
}

async function exportLoginHistoryCsv() {
  if (!adminLogged) {
    await customAlert('Primero inicia sesión como admin');
    return;
  }

  const fromDateStr = document.getElementById('login-history-from').value;
  const toDateStr = document.getElementById('login-history-to').value;

  try {
    let url = `${API_BASE}/api/admin/login-history`;
    const params = new URLSearchParams();
    if (fromDateStr) params.append('from', fromDateStr);
    if (toDateStr) params.append('to', toDateStr);
    if (params.toString()) url += `?${params.toString()}`;

    const res = await fetch(url, { cache: 'no-store' });
    const data = await res.json();

    if (!res.ok || !data.ok) {
      await customAlert(data.message || 'No se pudo cargar el historial para exportar.');
      return;
    }

    const history = data.history || data.loginHistory || [];
    if (!history.length) {
      await customAlert('No hay registros para exportar.');
      return;
    }

    // Generate CSV content
    const headers = ['Mesa', 'Usuario', 'Fecha y hora de inicio de sesion', 'Canciones registradas'];
    const rows = history.map(h => {
      const fechaStr = h.loginAt ? new Date(h.loginAt).toLocaleString('es-MX') : '';
      return [
        h.tableNumber,
        toUpperNoAccents(h.userName),
        fechaStr,
        h.songsRequested || 0
      ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(',');
    });

    const csvContent = "\uFEFF" + headers.join(',') + "\n" + rows.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    const fecha = new Date().toISOString().slice(0, 10);
    a.download = `historial_registros_${fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(blobUrl);

  } catch (e) {
    console.error(e);
    await customAlert('Error al descargar el CSV de registros');
  }
}

function setupLoginHistoryButtons() {
  const btnToggle = document.getElementById('btn-toggle-login-history');
  const listContainer = document.getElementById('login-history-list');
  const filters = document.getElementById('login-history-filters');
  const hint = document.getElementById('login-history-hint');
  const btnFilter = document.getElementById('btn-filter-login-history');
  const btnExport = document.getElementById('btn-export-login-history');
  const btnClear = document.getElementById('btn-clear-login-history');

  if (btnToggle && listContainer) {
    btnToggle.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      loginHistoryHidden = !loginHistoryHidden;
      if (!loginHistoryHidden) {
        listContainer.style.display = 'block';
        if (hint) hint.style.display = 'block';
        btnToggle.textContent = 'Ocultar historial de registros';
        loadLoginHistory();
      } else {
        listContainer.style.display = 'none';
        if (hint) hint.style.display = 'none';
        btnToggle.textContent = 'Ver historial de registros';
      }
      startAutoRefreshAdmin();
    };
  }

  if (btnFilter) {
    btnFilter.onclick = async () => {
      if (!adminLogged) return;
      loadLoginHistory();
      startAutoRefreshAdmin();
    };
  }

  if (btnExport) {
    btnExport.onclick = exportLoginHistoryCsv;
  }

  if (btnClear) {
    btnClear.onclick = async () => {
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }

      const ok = await customConfirm('¿Seguro que quieres eliminar TODO el historial de registros de usuarios?');
      if (!ok) return;

      try {
        const res = await fetch(`${API_BASE}/api/admin/clear-login-history`, {
          method: 'DELETE'
        });

        let data;
        try {
          data = await res.json();
        } catch (e) {
          await customAlert('Respuesta inválida del servidor al limpiar historial de registros');
          return;
        }

        if (!res.ok || !data.ok) {
          await customAlert(data.message || 'No se pudo limpiar el historial');
          return;
        }

        document.getElementById('login-history-list').innerHTML = 'Aún no hay historial.';
        document.getElementById('login-history-count').textContent = '0';
      } catch (e) {
        console.error(e);
        await customAlert('No se pudo conectar para limpiar el historial de registros');
      }
    };
  }
}

// ========= INICIALIZACIÓN =========
document.addEventListener('DOMContentLoaded', () => {
  setupAddTableButton();
  setupClearTablesButton();
  setupClearManualQueueButton();
  setupClearMixedQueueButton();
  setupHistoryButtons();
  setupSuggestionsSection();
  setupPublicQueueDisplayButton();
  setupActiveUsersButtons();
  setupLoginHistoryButtons();

  const logoForm = document.getElementById('form-upload-logo');
  if (logoForm) {
    logoForm.onsubmit = async (e) => {
      e.preventDefault();
      if (!adminLogged) {
        await customAlert('Primero inicia sesión como admin');
        return;
      }
      const fileInput = document.getElementById('logo-file');
      if (!fileInput.files.length) {
        await customAlert('Selecciona una imagen para el logo');
        return;
      }
      const formData = new FormData();
      formData.append('logo', fileInput.files[0]);

      try {
        const res = await fetch(`${API_BASE}/api/admin/upload-logo`, {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (!res.ok || !data.ok) {
          await customAlert(data.message || 'Error al subir el Logo');
          return;
        }
        await customAlert('Logo actualizado correctamente.');
        const img = document.getElementById('current-logo-image');
        if (img) {
          img.src = '/logo/logo.png?t=' + Date.now();
          img.style.display = 'block';
        }
      } catch (err) {
        console.error(err);
        await customAlert('Error al subir el logo');
      }
    };
  }
});