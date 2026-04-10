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

    // NUEVO: Botón Editar canción
    const btnEdit = document.createElement('button');
    btnEdit.textContent = 'Editar';
    btnEdit.style.marginLeft = '8px';
    btnEdit.onclick = async () => {
      const nuevoTitulo = prompt(
        'Escribe el nuevo título de la canción:',
        item.songTitle
      );
      if (nuevoTitulo === null) {
        // Canceló el prompt
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

      // Recargar la cola para ver el cambio
      loadQueueAdmin();
    };
    row.appendChild(btnEdit);

    div.appendChild(row);
  });
}

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

  // Limpiamos los campos
  document.getElementById('admin-pass-user-change').value = '';
  document.getElementById('new-user-pass').value = '';
};

// Intervalo para auto‑refrescar solo cuando el admin está logueado
let adminIntervalId = null;

function startAutoRefreshAdmin() {
  if (adminIntervalId) return; // ya está corriendo
  adminIntervalId = setInterval(() => {
    if (adminLogged) {
      loadQueueAdmin();
    }
  }, 5000);
}