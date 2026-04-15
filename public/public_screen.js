const API_BASE = '';

// ---------------------- COLA ----------------------

async function fetchQueue() {
  try {
    const res = await fetch(`${API_BASE}/api/queue`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Error cola');
    return data.queue || [];
  } catch (e) {
    console.error('Error cargando cola pública', e);
    return null;
  }
}

// ---------------------- INFO PÚBLICA ----------------------

async function fetchPublicInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/public-info`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Error info pública');
    return {
      userPassword: data.userPassword || ''
      // ya no necesitamos qrImageFile aquí
    };
  } catch (e) {
    console.error('Error cargando info pública', e);
    return null;
  }
}

// ---------------------- RENDER COLA ----------------------

function renderQueue(queue) {
  const list = document.getElementById('queue-list');
  const label = document.getElementById('queue-count-label');
  if (!list || !label) return;

  list.innerHTML = '';

  if (!queue || !queue.length) {
    label.textContent = '0 en espera';
    list.innerHTML = `
      <div style="font-size:1rem; color:#9ca3af;">
        Aún no hay participantes en la cola.
      </div>
    `;
    return;
  }

  label.textContent = `${queue.length} en espera`;

  queue.forEach((item, idx) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'queue-item';
    if (idx === 0) {
      wrapper.classList.add('current');
    }

    const position = document.createElement('div');
    position.className = 'queue-item-position';
    position.textContent = idx + 1;

    const main = document.createElement('div');
    main.className = 'queue-item-main';

    const mesa = item.tableNumber ? `Mesa ${item.tableNumber}` : 'Mesa N/D';
    const name = item.userName ? item.userName.toString().toUpperCase() : 'SIN NOMBRE';
    const song = item.songTitle || 'Canción desconocida';
    const artist = item.artist || '';

    const line = document.createElement('div');
    line.className = 'queue-item-line';

    const leftSpan = document.createElement('span');
    leftSpan.className = 'queue-item-left';
    leftSpan.textContent = `${mesa} - ${name}`;

    const middleDot = document.createElement('span');
    middleDot.textContent = ' · ';

    const rightSpan = document.createElement('span');
    rightSpan.className = 'queue-item-right';
    rightSpan.textContent = artist ? `${song} - ${artist}` : song;

    line.appendChild(leftSpan);
    line.appendChild(middleDot);
    line.appendChild(rightSpan);

    main.appendChild(line);

    wrapper.appendChild(position);
    wrapper.appendChild(main);

    list.appendChild(wrapper);
  });
}

// ---------------------- RENDER INFO PÚBLICA + QR ----------------------

function renderPublicInfo(info) {
  const passEl = document.getElementById('public-password');
  const qrEl = document.getElementById('public-qr');
  if (!passEl || !qrEl) return;

  if (!info) {
    passEl.textContent = '••••';
    qrEl.innerHTML = `
      <div class="footer-qr-placeholder">
        No se pudo cargar la información pública.
      </div>
    `;
    return;
  }

  // contraseña
  passEl.textContent = info.userPassword || '••••';

  // QR: siempre el mismo archivo fijo
  qrEl.innerHTML = '';

  const img = document.createElement('img');
  // Evitar caché del navegador con timestamp
  img.src = `/qr/qr.png?ts=${Date.now()}`;
  img.alt = 'QR para conectarse';

  img.onerror = () => {
    qrEl.innerHTML = `
      <div class="footer-qr-placeholder">
        No se encontró la imagen QR en /qr/qr.png
      </div>
    `;
  };

  qrEl.appendChild(img);
}

// ---------------------- REFRESH ----------------------

async function refreshPublicScreen() {
  const [queue, info] = await Promise.all([
    fetchQueue(),
    fetchPublicInfo()
  ]);

  if (queue !== null) renderQueue(queue);
  if (info !== null) renderPublicInfo(info);
}

document.addEventListener('DOMContentLoaded', () => {
  refreshPublicScreen();
  setInterval(refreshPublicScreen, 5000);
});