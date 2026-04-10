let adminLogged = false;

// Login de administrador
document.getElementById('btn-admin-login').onclick = async () => {
  const pass = document.getElementById('admin-pass').value.trim();
  if (!pass) {
    alert('Escribe la contraseña');
    return;
  }

  const res = await fetch('/api/admin/login', {
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
  loadTablesAdmin();      // cargar mesas al entrar

  // Iniciar auto‑refresco de la cola cuando el admin entra
  startAutoRefreshAdmin();
};

// Limpiar toda la cola
document.getElementById('btn-clear-all').onclick = async () => {
  if (!adminLogged) return;
  const ok = confirm('¿Seguro que quieres eliminar todos los registros?');
  if (!ok) return;

  await fetch('/api/queue', { method: 'DELETE' });
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

  const res = await fetch('/api/songs/upload', {
    method: 'POST',
    body: formData
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    alert('El servidor no respondió JSON. Respuesta: ' + text);
    return;
  }

  if (!res.ok || !data.ok) {
    alert(data.message || 'Error al subir Excel');
    return;
  }

  alert('Excel cargado y songs.json actualizado (' + data.count + ' canciones).');
};

// Cargar cola en panel admin
async function loadQueueAdmin() {
  const res = await fetch('/api/queue');
  const data = await res.json();
  const div = document.getElementById('queue-admin');
  div.innerHTML = '';

  if (!data.ok) {
    div.textContent = 'Error cargando cola';
    return;
  }

  data.queue.forEach((item, idx) => {
    const row = document.createElement('div');
    row.textContent = `${idx + 1}. Mesa ${item.tableNumber} - ${item.userName} - ${item.songTitle} `;

    // Botón Eliminar
    const btnDel = document.createElement('button');
    btnDel.textContent = 'Eliminar';
    btnDel.onclick = async () => {
      await fetch(`/api/queue/${item.id}`, { method: 'DELETE' });
      loadQueueAdmin();
    };
    row.appendChild(btnDel);

    // Botón Editar canción
    const btnEdit = document.createElement('button');
    btnEdit.textContent = 'Editar';
    btnEdit.style.marginLeft = '8px';
    btnEdit.onclick = async () => {
      const nuevoTitulo = prompt(
        'Escribe el nuevo título de la canción:',
        item.songTitle
      );
      if (nuevoTitulo === null) {
        return;
      }
      const limpio = nuevoTitulo.trim();
      if (!limpio) {
        alert('El título no puede quedar vacío');
        return;
      }

      const resEdit = await fetch(`/api/queue/${item.id}`, {
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
    row.appendChild(btnEdit);

    div.appendChild(row);
  });
}

// ========= GESTIÓN DE MESAS EN PANEL ADMIN =========

// Cargar listado de mesas permitidas
async function loadTablesAdmin() {
  const div = document.getElementById('tables-admin');
  if (!div) return;

  div.innerHTML = 'Cargando mesas...';

  let res;
  try {
    res = await fetch('/api/tables');
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

  tables.forEach(t => {
    const row = document.createElement('div');
    row.className = 'table-item';

    const span = document.createElement('span');
    span.textContent = `Mesa: ${t.tableNumber}`;
    row.appendChild(span);

    const btnDelete = document.createElement('button');
    btnDelete.textContent = 'Eliminar';
    btnDelete.onclick = async () => {
      const ok = confirm(`¿Seguro que quieres eliminar la mesa ${t.tableNumber}?`);
      if (!ok) return;

      const resDel = await fetch(`/api/tables/${t.id}`, {
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

// Alta de nueva mesa (enganchada al cargar el DOM)
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

    let res;
    try {
      res = await fetch('/api/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableNumber: value })
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
      res = await fetch('/api/tables', {
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

document.addEventListener('DOMContentLoaded', () => {
  setupAddTableButton();
  setupClearTablesButton();
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

  const res = await fetch('/api/admin/change-password', {
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

  const res = await fetch('/api/admin/change-user-password', {
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