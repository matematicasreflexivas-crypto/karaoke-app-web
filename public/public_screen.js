const API_BASE = '';

// ---------------------- COLA ----------------------

async function fetchQueue(queueType = 'catalog') {
  try {
    let endpoint = `${API_BASE}/api/queue`;
    
    if (queueType === 'manual') {
      endpoint = `${API_BASE}/api/manual-queue`;
    } else if (queueType === 'mixed') {
      endpoint = `${API_BASE}/api/mixed-queue`;
    }

    const res = await fetch(endpoint);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.message || 'Error cola');
    
    // Normalizar respuesta según tipo de cola
    if (queueType === 'manual') {
      return data.queue || [];
    } else if (queueType === 'mixed') {
      return data.queue || data.mixedQueue || [];
    }
    
    return data.queue || [];
  } catch (e) {
    console.error(`Error cargando cola pública (${queueType})`, e);
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
      userPassword: data.userPassword || '',
      appTitle: data.appTitle || 'Karaoke',
      logoImageFile: data.logoImageFile || '',
      qrImageFile: data.qrImageFile || 'qr.png',
      publicQueueDisplay: data.publicQueueDisplay || 'catalog',
      publicMessage: data.publicMessage || '',
      showColorDots: data.showColorDots !== false
    };
  } catch (e) {
    console.error('Error cargando info pública', e);
    return null;
  }
}


// ---------------------- RENDER COLA ----------------------

function renderQueue(queue, queueType, showColorDots) {
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
    
    // Para cola manual y mixta, usar displaySongTitle y displaySongArtist
    // Para cola catálogo, usar songTitle y artist
    let song = '';
    let artist = '';

    if (item.displaySongTitle) {
      // Es una cola manual o mixta
      song = item.displaySongTitle || 'Canción desconocida';
      artist = item.displaySongArtist || '';
    } else {
      // Es cola catálogo
      song = item.songTitle || 'Canción desconocida';
      artist = item.artist || '';
    }

    // Determinar color del recuadro
    let itemColor = item.highlightColor;
    if (!itemColor) {
      if (item.source === 'manual') {
        itemColor = 'orange';
      } else if (item.source === 'catalog') {
        itemColor = 'green';
      } else if (queueType === 'manual') {
        itemColor = 'orange';
      } else {
        itemColor = 'green';
      }
    }

    const colorDot = document.createElement('span');
    if (showColorDots !== false) {
      colorDot.style.cssText =
        'display:inline-block;width:13px;height:13px;border-radius:3px;flex-shrink:0;' +
        'background:' + (itemColor === 'orange' ? '#f97316' : '#22c55e') + ';' +
        'margin-right:6px;vertical-align:middle;';
    }

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

    line.appendChild(colorDot);
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
  const headerTitle = document.querySelector('header h1');
  const msgBar = document.getElementById('public-message-bar');
  const msgText = document.getElementById('public-message-text');
  if (!passEl || !qrEl || !headerTitle) return;

  if (!info) {
    headerTitle.textContent = 'Turnos para el Karaoke';
    passEl.textContent = '••••';
    if (msgBar) msgBar.style.display = 'none';
    qrEl.innerHTML = `
      <div class="footer-qr-placeholder">
        No se pudo cargar la información pública.
      </div>
    `;
    return;
  }

  // título dinámico (nombre del bar)
  headerTitle.textContent = `TURNOS ${info.appTitle}`;
  document.title = `Pantalla ${info.appTitle}`;

  // logo
  const logoContainer = document.getElementById('public-logo-container');
  const logoImg = document.getElementById('public-logo-img');
  if (logoContainer && logoImg) {
    if (info.logoImageFile) {
      logoImg.src = `/logo/${info.logoImageFile}?ts=${Date.now()}`;
      logoContainer.style.display = 'flex';
    } else {
      logoContainer.style.display = 'none';
    }
  }

  // mensaje al público
  if (msgBar && msgText) {
    if (info.publicMessage) {
      msgText.textContent = info.publicMessage;
      msgBar.style.display = 'flex';
    } else {
      msgBar.style.display = 'none';
    }
  }

  // contraseña
  passEl.textContent = info.userPassword || '••••';

  // QR usando el nombre de archivo que envía el backend
  qrEl.innerHTML = '';

  const img = document.createElement('img');
  const file = info.qrImageFile || 'qr.png';
  img.src = `/qr/${file}?ts=${Date.now()}`;
  img.alt = 'QR para conectarse';

  img.onerror = () => {
    qrEl.innerHTML = `
      <div class="footer-qr-placeholder">
        No se encontró la imagen QR en /qr/${file}
      </div>
    `;
  };

  qrEl.appendChild(img);
}


// ---------------------- REFRESH ----------------------

async function refreshPublicScreen() {
  const info = await fetchPublicInfo();
  
  // Obtener el tipo de cola que debe mostrar
  const queueType = info?.publicQueueDisplay || 'catalog';
  const showColorDots = info?.showColorDots !== false;
  
  console.log('Cargando cola de tipo:', queueType);
  
  const queue = await fetchQueue(queueType);

  if (queue !== null) renderQueue(queue, queueType, showColorDots);
  renderPublicInfo(info);
}

document.addEventListener('DOMContentLoaded', () => {
  refreshPublicScreen();
  setInterval(refreshPublicScreen, 5000);
});