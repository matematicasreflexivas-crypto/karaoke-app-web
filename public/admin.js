// ===== CONFIGURACIÓN API =====
const API_BASE = '';

let adminLogged = false;

// Mostrar tiempo en cola: "Hace X min / horas"
function formatTiempoEnCola(createdAt) {
  if (!createdAt) return '';

  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return '';

  const now = new Date();
  const diffMs = now - created;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHrs = Math.floor(diffMin / 60);

  if (diffMin < 1) return 'Hace menos de 1 min';
  if (diffMin < 60) return `Hace ${diffMin} min`;
  if (diffHrs === 1) return 'Hace 1 hora';
  return `Hace ${diffHrs} horas`;
}

// Login de administrador
document.getElementById('btn-admin-login').onclick = async () => {
  const pass = document.getElementById('admin-pass').value.trim();
  if (!pass) {
    alert('Escribe la contraseña');
    return;
  }

  const res = await fetch(`${API_BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pass })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    alert(data.message || 'Contraseña incorrecta');
    return;
  }

  adminLogged = true;
  document.getElementById('admin-panel').style.display = 'block';
  loadQueueAdmin();
  loadTablesAdmin();
  startAutoRefreshAdmin();
  setupHistoryButtons();
  setupSuggestionsSection();
  setupQueueOpenButtons();    // NUEVO
  refreshQueueOpenStatus();   // NUEVO

  // NUEVO: cargar banderas de funciones del usuario y configurar controles
  loadUserFeaturesAdmin();
  setupUserFeaturesControls();
};

// Limpiar toda la cola
document.getElementById('btn-clear-all').onclick = async () => {
  if (!adminLogged) return;
  const ok = confirm('¿Seguro que quieres eliminar todos los registros?');
  if (!ok) return;

  await fetch(`${API_BASE}/api/queue`, { method: 'DELETE' });
  loadQueueAdmin();
};

// Subir Excel
document.getElementById('form-upload').onsubmit = async (e) => {
  e.preventDefault();
  if (!adminLogged) {
    alert('Primero inicia sesión como admin');
    return;
  }

  const fileInput = document.getElementById('excel-file');
  if (!fileInput.files.length) {
    alert('Selecciona un archivo Excel');
    return;
  }

  const formData = new FormData();
  formData.append('excel', fileInput.files[0]);

  const res = await fetch(`${API_BASE}/api/songs/upload`, {
    method: 'POST',
    body: formData
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e2) {
    alert('El servidor no respondió JSON. Respuesta: ' + text);
    return;
  }

  if (!res.ok || !data.ok) {
    alert(data.message || 'Error al subir Excel');
    return;
  }

  alert('Excel cargado (' + data.count + ' canciones).');
};

// ========== COLA ADMIN: UNA LÍNEA POR REGISTRO ==========
async function loadQueueAdmin() {
  const res = await fetch(`${API_BASE}/api/queue`);
  const data = await res.json();
  const div = document.getElementById('queue-admin');
  div.innerHTML = '';

  if (!data.ok) {
    div.textContent = 'Error cargando cola';
    return;
  }

  data.queue.forEach((item, idx) => {
    const row = document.createElement('div');
    row.className = 'queue-admin-item-line';

    const content = document.createElement('div');
    content.className = 'queue-admin-item-content';

    const textSpan = document.createElement('span');
    textSpan.className = 'queue-admin-item-text';

    const userNameUpper = (item.userName || '').toString().toUpperCase();
    const tiempoEnCola = formatTiempoEnCola(item.createdAt);

    let linea = `${idx + 1}. Mesa ${item.tableNumber} - ${userNameUpper} - ${item.songTitle}`;
    if (tiempoEnCola) {
      linea += ` | ${tiempoEnCola}`;
    }

    textSpan.textContent = linea;
    content.appendChild(textSpan);

    const actions = document.createElement('div');
    actions.className = 'queue-admin-item-actions';

    const btnDel = document.createElement('button');
    btnDel.textContent = 'Eliminar';
    btnDel.className = 'btn-danger btn-queue-admin';
    btnDel.onclick = async () => {
      const ok = confirm('¿Marcar esta canción como atendida y quitarla de la cola?');
      if (!ok) return;

      const resDel = await fetch(`${API_BASE}/api/queue/${item.id}`, { method: 'DELETE' });
      let dataDel;
      try {
        dataDel = await resDel.json();
      } catch (e) {
        alert('Respuesta inválida del servidor al eliminar de la cola');
        return;
      }
      if (!resDel.ok || !dataDel.ok) {
        alert(dataDel.message || 'No se pudo eliminar la canción');
        return;
      }

      loadQueueAdmin();
      const fromInput = document.getElementById('history-from');
      const toInput   = document.getElementById('history-to');
      const fromDateStr = fromInput ? fromInput.value : '';
      const toDateStr   = toInput   ? toInput.value   : '';
      loadHistoryAdmin(fromDateStr, toDateStr);
    };
    actions.appendChild(btnDel);

    const btnEdit = document.createElement('button');
    btnEdit.textContent = 'Editar';
    btnEdit.className = 'btn-secondary btn-queue-admin';
    btnEdit.onclick = async () => {
      const nuevoTitulo = prompt(
        'Escribe el nuevo título de la canción:',
        item.songTitle
      );
      if (nuevoTitulo === null) return;

      const limpio = nuevoTitulo.trim();
      if (!limpio) {
        alert('El título no puede quedar vacío');
        return;
      }

      const resEdit = await fetch(`${API_BASE}/api/queue/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songTitle: limpio })
      });

      let dataEdit;
      try {
        dataEdit = await resEdit.json();
      } catch (e) {
        alert('Respuesta inválida del servidor al editar la canción');
        return;
      }

      if (!resEdit.ok || !dataEdit.ok) {
        alert(dataEdit.message || 'No se pudo actualizar la canción');
        return;
      }

      loadQueueAdmin();
    };
    actions.appendChild(btnEdit);

    content.appendChild(actions);
    row.appendChild(content);
    div.appendChild(row);
  });
}

// ========= HISTORIAL EN PANEL ADMIN =========
async function loadHistoryAdmin(fromDateStr, toDateStr) {
  const div = document.getElementById('history-admin');
  if (!div) return;

  div.innerHTML = 'Cargando historial...';

  let res;
  try {
    res = await fetch(`${API_BASE}/api/history`);
  } catch (e) {
    console.error(e);
    div.textContent = 'No se pudo conectar para cargar historial';
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.error(e);
    div.textContent = 'Respuesta inválida al cargar historial';
    return;
  }

  if (!res.ok || !data.ok) {
    div.textContent = data.message || 'Error cargando historial';
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

  div.innerHTML = '';

  if (!items.length) {
    div.textContent = 'Aún no hay historial.';
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
    const lugarCola     = (h.queuePosition != null && h.queueTotal != null)
      ? ` | Lugar en cola: ${h.queuePosition}/${h.queueTotal}`
      : '';

    const userNameUpper = (h.userName || '').toString().toUpperCase();
    let texto = `${idx + 1}. Mesa ${h.tableNumber} - ${userNameUpper} - ${h.songTitle}`;
    if (fechaRegistro) {
      texto += ` | Registrado: ${fechaRegistro}`;
    }
    if (fechaAtendida) {
      texto += ` | Atendido: ${fechaAtendida}`;
    }
    texto += lugarCola;

    textSpan.textContent = texto;

    content.appendChild(textSpan);
    row.appendChild(content);
    div.appendChild(row);
  });
}

// Descargar CSV de historial
async function exportHistoryCsv() {
  if (!adminLogged) {
    alert('Primero inicia sesión como admin');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/history/export`);
    if (!res.ok) {
      const text = await res.text();
      alert('No se pudo exportar el historial: ' + text);
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const fecha = new Date().toISOString().slice(0, 10);
    a.download = `historial_karaoke_${fecha}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch (e) {
    console.error(e);
    alert('Error al descargar el CSV de historial');
  }
}

// ========= GESTIÓN DE MESAS EN PANEL ADMIN =========
async function loadTablesAdmin() {
  const div = document.getElementById('tables-admin');
  if (!div) return;

  div.innerHTML = 'Cargando mesas...';

  let res;
  try {
    res = await fetch(`${API_BASE}/api/tables`);
  } catch (e) {
    console.error(e);
    div.textContent = 'No se pudo conectar para cargar mesas';
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.error(e);
    div.textContent = 'Respuesta inválida al cargar mesas';
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
    span.textContent = `Mesa: ${t.tableNumber} (máx: ${maxSongs} canciones)`;
    row.appendChild(span);

    const inputMax = document.createElement('input');
    inputMax.type = 'number';
    inputMax.min = '1';
    inputMax.step = '1';
    inputMax.value = maxSongs;
    inputMax.style.width = '70px';
    inputMax.style.marginLeft = '8px';
    row.appendChild(inputMax);

    const btnSaveMax = document.createElement('button');
    btnSaveMax.textContent = 'Guardar límite';
    btnSaveMax.className = 'btn-secondary btn-queue-admin';
    btnSaveMax.style.marginLeft = '6px';
    btnSaveMax.onclick = async () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
        return;
      }
      const val = parseInt(inputMax.value, 10);
      if (Number.isNaN(val) || val < 1) {
        alert('El número mínimo de canciones por mesa es 1');
        return;
      }
      try {
        const resPut = await fetch(`${API_BASE}/api/tables/${t.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxSongs: val })
        });
        const dataPut = await resPut.json();
        if (!resPut.ok || !dataPut.ok) {
          alert(dataPut.message || 'No se pudo actualizar el límite de canciones');
          return;
        }
        alert('Límite actualizado para la mesa ' + t.tableNumber);
        loadTablesAdmin();
      } catch (e) {
        console.error(e);
        alert('No se pudo conectar para actualizar el límite');
      }
    };
    row.appendChild(btnSaveMax);

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Eliminar';
    btnDelete.className = 'btn-danger btn-queue-admin';
    btnDelete.style.marginLeft = '6px';
    btnDelete.onclick = async () => {
      const ok = confirm(`¿Seguro que quieres eliminar la mesa ${t.tableNumber}?`);
      if (!ok) return;

      const resDel = await fetch(`${API_BASE}/api/tables/${t.id}`, {
        method: 'DELETE'
      });

      let dataDel;
      try {
        dataDel = await resDel.json();
      } catch (e) {
        alert('Respuesta inválida del servidor al eliminar mesa');
        return;
      }

      if (!resDel.ok || !dataDel.ok) {
        alert(dataDel.message || 'No se pudo eliminar la mesa');
        return;
      }

      loadTablesAdmin();
    };

    row.appendChild(btnDelete);
    div.appendChild(row);
  });
}

// Alta de nueva mesa
function setupAddTableButton() {
  const btnAddTable = document.getElementById('btn-add-table');
  if (!btnAddTable) return;

  btnAddTable.onclick = async () => {
    if (!adminLogged) {
      alert('Primero inicia sesión como admin');
      return;
    }

    const input = document.getElementById('new-table-number');
    if (!input) return;

    const value = input.value.trim();
    if (!value) {
      alert('Escribe el número de mesa');
      return;
    }

    const inputMax = document.getElementById('new-table-max-songs');
    let maxSongsVal = 1;
    if (inputMax) {
      const parsed = parseInt(inputMax.value, 10);
      if (!Number.isNaN(parsed) && parsed > 0) {
        maxSongsVal = parsed;
      }
    }

    let res;
    try {
      res = await fetch(`${API_BASE}/api/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNumber: value, maxSongs: maxSongsVal })
      });
    } catch (e) {
      console.error(e);
      alert('No se pudo conectar para agregar mesa');
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      console.error(e);
      alert('Respuesta inválida del servidor al agregar mesa');
      return;
    }

    if (!res.ok || !data.ok) {
      alert(data.message || 'No se pudo agregar la mesa');
      return;
    }

    input.value = '';
    if (inputMax) inputMax.value = '';
    loadTablesAdmin();
  };
}

// Botón para limpiar TODAS las mesas
function setupClearTablesButton() {
  const btnClearTables = document.getElementById('btn-clear-tables');
  if (!btnClearTables) return;

  btnClearTables.onclick = async () => {
    if (!adminLogged) {
      alert('Primero inicia sesión como admin');
      return;
    }

    const ok = confirm('¿Seguro que quieres eliminar TODAS las mesas?');
    if (!ok) return;

    let res;
    try {
      res = await fetch(`${API_BASE}/api/tables`, {
        method: 'DELETE'
      });
    } catch (e) {
      console.error(e);
      alert('No se pudo conectar para limpiar las mesas');
      return;
    }

    let data;
    try {
      data = await res.json();
    } catch (e) {
      console.error(e);
      alert('Respuesta inválida del servidor al limpiar mesas');
      return;
    }

    if (!res.ok || !data.ok) {
      alert(data.message || 'No se pudieron eliminar las mesas');
      return;
    }

    loadTablesAdmin();
  };
}

// Mostrar/ocultar LISTADOS e INICIO
function setupToggleSections() {
  const tablesContainer = document.getElementById('tables-admin');
  const queueContainer  = document.getElementById('queue-admin');
  const inicioSection   = document.getElementById('inicio-admin-section');
  const loginCard       = document.getElementById('admin-login');

  const btnToggleTables = document.getElementById('btn-toggle-tables');
  const btnToggleQueue  = document.getElementById('btn-toggle-queue');
  const btnToggleInicio = document.getElementById('btn-toggle-inicio');

  if (btnToggleTables && tablesContainer) {
    btnToggleTables.onclick = () => {
      const isHidden = tablesContainer.style.display === 'none';
      tablesContainer.style.display = isHidden ? 'block' : 'none';
    };
  }

  if (btnToggleQueue && queueContainer) {
    btnToggleQueue.onclick = () => {
      const isHidden = queueContainer.style.display === 'none';
      queueContainer.style.display = isHidden ? 'block' : 'none';
    };
  }

  if (btnToggleInicio && inicioSection && loginCard) {
    btnToggleInicio.onclick = () => {
      const isHidden = inicioSection.style.display === 'none';
      const newDisplay = isHidden ? 'block' : 'none';
      inicioSection.style.display = newDisplay;
      loginCard.style.display = newDisplay;
    };
  }
}

// Botones de historial
function setupHistoryButtons() {
  const btnShowHistory   = document.getElementById('btn-show-history');
  const btnExportHistory = document.getElementById('btn-export-history');
  const btnClearHistory  = document.getElementById('btn-clear-history');
  const historyContainer = document.getElementById('history-admin');

  const inputFrom = document.getElementById('history-from');
  const inputTo   = document.getElementById('history-to');
  const btnApplyFilter = document.getElementById('btn-apply-history-filter');

  if (btnShowHistory && historyContainer) {
    btnShowHistory.onclick = async () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
        return;
      }

      const isHidden = historyContainer.style.display === 'none';

      if (isHidden) {
        const fromDateStr = inputFrom ? inputFrom.value : '';
        const toDateStr   = inputTo   ? inputTo.value   : '';
        await loadHistoryAdmin(fromDateStr, toDateStr);
        historyContainer.style.display = 'block';
        btnShowHistory.textContent = 'Ocultar historial';
      } else {
        historyContainer.style.display = 'none';
        btnShowHistory.textContent = 'Ver historial';
      }
    };
  }

  if (btnApplyFilter && historyContainer) {
    btnApplyFilter.onclick = async () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
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
    };
  }

  if (btnExportHistory) {
    btnExportHistory.onclick = () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
        return;
      }
      exportHistoryCsv();
    };
  }

  if (btnClearHistory && historyContainer) {
    btnClearHistory.onclick = async () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
        return;
      }

      const ok = confirm('¿Seguro que quieres eliminar TODO el historial de canciones?');
      if (!ok) return;

      try {
        const res = await fetch(`${API_BASE}/api/history`, {
          method: 'DELETE'
        });

        let data;
        try {
          data = await res.json();
        } catch (e) {
          alert('Respuesta inválida del servidor al limpiar historial');
          return;
        }

        if (!res.ok || !data.ok) {
          alert(data.message || 'No se pudo limpiar el historial');
          return;
        }

        historyContainer.innerHTML = 'Aún no hay historial.';
      } catch (e) {
        console.error(e);
        alert('No se pudo conectar para limpiar el historial');
      }
    };
  }
}

// ========= SUGERENCIAS DE CANCIONES (ADMIN) =========
async function loadSongSuggestions() {
  const container = document.getElementById('suggestions-list');
  if (!container) return;

  container.innerHTML = 'Cargando sugerencias...';

  let res;
  try {
    res = await fetch(`${API_BASE}/api/song-suggestions`);
  } catch (e) {
    console.error(e);
    container.textContent = 'No se pudo cargar la lista de sugerencias.';
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    console.error(e);
    container.textContent = 'Respuesta inválida del servidor.';
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

    const titleText  = (s.title  || '').toString().toUpperCase();
    const artistText = (s.artist || '').toString().toUpperCase();
    const mesaTxt = s.tableNumber ? `Mesa: ${s.tableNumber}` : 'Mesa: (no especificada)';
    const userTxt = s.userName    ? `Nombre: ${s.userName}`   : 'Nombre: (no especificado)';
    const fecha   = s.createdAt   ? `Registrada: ${s.createdAt}` : '';

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
    btnDelete.className = 'btn-danger btn-queue-admin';
    btnDelete.onclick = async () => {
      const ok = confirm('¿Seguro que deseas eliminar esta sugerencia?');
      if (!ok) return;

      try {
        const resDel = await fetch(`${API_BASE}/api/song-suggestions/${s.id}`, {
          method: 'DELETE'
        });
        const dataDel = await resDel.json();
        if (!resDel.ok || !dataDel.ok) {
          alert(dataDel.message || 'No se pudo eliminar la sugerencia.');
          return;
        }
        loadSongSuggestions();
      } catch (e) {
        console.error(e);
        alert('Error eliminando la sugerencia.');
      }
    };

    actions.appendChild(btnDelete);
    content.appendChild(actions);

    card.appendChild(content);
    container.appendChild(card);
  });
}

function setupSuggestionsSection() {
  const btnToggleSuggestionsCard = document.getElementById('btn-toggle-suggestions-card');
  const suggestionsList          = document.getElementById('suggestions-list');
  const btnExportSuggestions     = document.getElementById('btn-export-suggestions');
  const btnClearSuggestions      = document.getElementById('btn-clear-suggestions');

  if (btnToggleSuggestionsCard && suggestionsList) {
    btnToggleSuggestionsCard.onclick = () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
        return;
      }
      const isHidden = suggestionsList.style.display === 'none';
      if (isHidden) {
        suggestionsList.style.display = 'block';
        loadSongSuggestions();
      } else {
        suggestionsList.style.display = 'none';
      }
    };
  }

  if (btnExportSuggestions) {
    btnExportSuggestions.onclick = () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
        return;
      }
      window.location.href = `${API_BASE}/api/song-suggestions/export`;
    };
  }

  if (btnClearSuggestions && suggestionsList) {
    btnClearSuggestions.onclick = async () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
        return;
      }
      const ok = confirm('¿Seguro que quieres eliminar TODAS las sugerencias?');
      if (!ok) return;

      try {
        const res = await fetch(`${API_BASE}/api/song-suggestions`, {
          method: 'DELETE'
        });
        let data;
        try {
          data = await res.json();
        } catch (e) {
          alert('Respuesta inválida del servidor al limpiar sugerencias');
          return;
        }
        if (!res.ok || !data.ok) {
          alert(data.message || 'No se pudieron eliminar las sugerencias');
          return;
        }
        loadSongSuggestions();
      } catch (e) {
        console.error(e);
        alert('No se pudo conectar para limpiar las sugerencias');
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
    const res = await fetch(`${API_BASE}/api/public-info`);
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
        alert('Primero inicia sesión como admin');
        return;
      }

      const pass = prompt('Confirma la contraseña de administrador para cerrar registros:');
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
        alert('No se pudo conectar para cambiar el estado de registros');
        return;
      }

      if (!res.ok || !data.ok) {
        alert(data.message || 'No se pudo cerrar los registros');
        return;
      }

      alert('Se ha cerrado el registro de canciones.');
      refreshQueueOpenStatus();
    };
  }

  if (btnOpen) {
    btnOpen.onclick = async () => {
      if (!adminLogged) {
        alert('Primero inicia sesión como admin');
        return;
      }

      const pass = prompt('Confirma la contraseña de administrador para abrir registros:');
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
        alert('No se pudo conectar para cambiar el estado de registros');
        return;
      }

      if (!res.ok || !data.ok) {
        alert(data.message || 'No se pudo abrir los registros');
        return;
      }

      alert('Se ha abierto el registro de canciones.');
      refreshQueueOpenStatus();
    };
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupAddTableButton();
  setupClearTablesButton();
  setupToggleSections();
  setupHistoryButtons();
  setupSuggestionsSection();
});

// Cambiar contraseña de administrador
document.getElementById('btn-change-admin-pass').onclick = async () => {
  if (!adminLogged) {
    alert('Primero inicia sesión como admin');
    return;
  }

  const oldPass = document.getElementById('old-admin-pass').value.trim();
  const newPass = document.getElementById('new-admin-pass').value.trim();

  if (!oldPass || !newPass) {
    alert('Escribe la contraseña actual y la nueva');
    return;
  }

  const res = await fetch(`${API_BASE}/api/admin/change-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword: oldPass, newPassword: newPass })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    alert(data.message || 'No se pudo cambiar la contraseña');
    return;
  }

  alert('Contraseña de administrador cambiada correctamente');
  document.getElementById('old-admin-pass').value = '';
  document.getElementById('new-admin-pass').value = '';
};

// Cambiar contraseña de usuario
document.getElementById('btn-change-user-pass').onclick = async () => {
  if (!adminLogged) {
    alert('Primero inicia sesión como admin');
    return;
  }

  const adminPassForChange = document
    .getElementById('admin-pass-user-change')
    .value.trim();
  const newUserPass = document.getElementById('new-user-pass').value.trim();

  if (!adminPassForChange || !newUserPass) {
    alert('Escribe la contraseña de administrador y la nueva contraseña de usuario');
    return;
  }

  const res = await fetch(`${API_BASE}/api/admin/change-user-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      adminPassword: adminPassForChange,
      newUserPassword: newUserPass
    })
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    alert(data.message || 'No se pudo cambiar la contraseña de usuario');
    return;
  }

  alert('Contraseña de usuario cambiada correctamente');

  document.getElementById('admin-pass-user-change').value = '';
  document.getElementById('new-user-pass').value = '';
};

// Cambiar título de la aplicación (nombre del bar)
document.getElementById('btn-change-app-title').onclick = async () => {
  if (!adminLogged) {
    alert('Primero inicia sesión como admin');
    return;
  }

  const adminPass = document.getElementById('admin-pass-app-title').value.trim();
  const newTitle  = document.getElementById('new-app-title').value.trim();

  if (!adminPass || !newTitle) {
    alert('Escribe la contraseña de administrador y el nuevo título');
    return;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/api/admin/change-app-title`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminPassword: adminPass,
        newTitle
      })
    });
  } catch (e) {
    console.error(e);
    alert('No se pudo conectar para cambiar el título');
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (e) {
    alert('Respuesta inválida del servidor al cambiar el título');
    return;
  }

  if (!res.ok || !data.ok) {
    alert(data.message || 'No se pudo cambiar el título');
    return;
  }

  alert('Título actualizado correctamente');

  document.getElementById('admin-pass-app-title').value = '';
};

// Intervalo para auto‑refrescar solo cuando el admin está logueado
let adminIntervalId = null;

function startAutoRefreshAdmin() {
  if (adminIntervalId) return;
  adminIntervalId = setInterval(() => {
    if (adminLogged) {
      loadQueueAdmin();
    }
  }, 5000);
}

// ========= SUBIR / ACTUALIZAR QR =========
document.getElementById('form-upload-qr').onsubmit = async (e) => {
  e.preventDefault();
  if (!adminLogged) {
    alert('Primero inicia sesión como admin');
    return;
  }

  const fileInput = document.getElementById('qr-file');
  if (!fileInput.files.length) {
    alert('Selecciona una imagen de QR');
    return;
  }

  const formData = new FormData();
  formData.append('qr', fileInput.files[0]);

  let res;
  try {
    res = await fetch(`${API_BASE}/api/admin/upload-qr`, {
      method: 'POST',
      body: formData
    });
  } catch (e2) {
    console.error(e2);
    alert('No se pudo conectar para subir el QR');
    return;
  }

  let data;
  try {
    data = await res.json();
  } catch (e2) {
    alert('Respuesta inválida del servidor al subir QR');
    return;
  }

  if (!res.ok || !data.ok) {
    alert(data.message || 'Error al subir QR');
    return;
  }

  alert('QR actualizado correctamente');

  const img = document.getElementById('current-qr-image');
  if (img) {
    const ts = Date.now();
    img.style.display = 'block';
    img.src = `/qr/qr.png?ts=${ts}`;
  }

  fileInput.value = '';
};

// ========= NUEVO: LEER Y GUARDAR BANDERAS DE PANTALLA DE USUARIO =========

// Leer banderas actuales desde /api/public-info y reflejarlas en los checkboxes
async function loadUserFeaturesAdmin() {
  const cbSearch     = document.getElementById('feature-user-search');
  const cbQueue      = document.getElementById('feature-user-queue');
  const cbSuggestion = document.getElementById('feature-user-suggestion');
  if (!cbSearch || !cbQueue || !cbSuggestion) return;

  try {
    const res = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) return;

    const features = data.userFeatures || {};
    const searchEnabled     = features.search !== false;
    const queueEnabled      = features.queue !== false;
    const suggestionEnabled = features.suggestion !== false;

    cbSearch.checked     = searchEnabled;
    cbQueue.checked      = queueEnabled;
    cbSuggestion.checked = suggestionEnabled;
  } catch (e) {
    console.error('Error leyendo userFeatures en admin', e);
  }
}

// Configurar botón "guardar"
function setupUserFeaturesControls() {
  const btnSave = document.getElementById('btn-save-user-features');
  const cbSearch     = document.getElementById('feature-user-search');
  const cbQueue      = document.getElementById('feature-user-queue');
  const cbSuggestion = document.getElementById('feature-user-suggestion');
  if (!btnSave || !cbSearch || !cbQueue || !cbSuggestion) return;

  btnSave.onclick = async () => {
    if (!adminLogged) {
      alert('Primero inicia sesión como admin');
      return;
    }

    // Aquí NO pedimos password, asumiendo que ya se validó al entrar
    const body = {
      // si en tu backend guardas más cosas en public-info, inclúyelas aquí;
      // por ahora enviamos sólo userFeatures
      userFeatures: {
        search: cbSearch.checked,
        queue: cbQueue.checked,
        suggestion: cbSuggestion.checked
      }
    };

    try {
      const res = await fetch(`${API_BASE}/api/admin/change-user-features`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.message || 'No se pudieron guardar las opciones de pantalla de usuario');
        return;
      }

      alert('Opciones de pantalla de usuario guardadas.\nLos cambios se aplicarán al recargar la pantalla de usuario.');
    } catch (e) {
      console.error(e);
      alert('No se pudo conectar para guardar las opciones de pantalla de usuario');
    }
  };
}