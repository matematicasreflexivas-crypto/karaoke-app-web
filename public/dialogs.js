window.isDialogOpen = false;

function injectDialogStyles() {
    if (document.getElementById('custom-dialog-styles')) return;
    const style = document.createElement('style');
    style.id = 'custom-dialog-styles';
    style.innerHTML = `
        .custom-dialog-overlay {
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(0, 0, 0, 0.7); z-index: 10000;
            display: flex; justify-content: center; align-items: center;
            opacity: 0; transition: opacity 0.2s ease;
            backdrop-filter: blur(3px);
            -webkit-backdrop-filter: blur(3px);
        }
        .custom-dialog-overlay.show { opacity: 1; }
        .custom-dialog-box {
            background: #111827; border: 1px solid #374151; border-radius: 12px;
            padding: 20px; min-width: 300px; max-width: 90%;
            box-shadow: 0 10px 25px rgba(0,0,0,0.5);
            transform: scale(0.95); transition: transform 0.2s ease;
            color: #f9fafb; font-family: system-ui, sans-serif;
        }
        .custom-dialog-overlay.show .custom-dialog-box { transform: scale(1); }
        .custom-dialog-text { font-size: 1rem; margin-bottom: 20px; line-height: 1.5; white-space: pre-wrap; }
        .custom-dialog-input {
            width: 100%; padding: 10px; margin-bottom: 20px;
            background: #020617; border: 1px solid #4b5563; border-radius: 8px;
            color: #f9fafb; font-size: 1rem; box-sizing: border-box;
        }
        .custom-dialog-buttons { display: flex; justify-content: flex-end; gap: 10px; }
        .custom-dialog-btn {
            padding: 8px 16px; border: none; border-radius: 6px;
            font-size: 0.95rem; font-weight: 600; cursor: pointer;
            outline: none;
        }
        .custom-dialog-btn-cancel { background: #374151; color: #f9fafb; }
        .custom-dialog-btn-confirm { background: #4f46e5; color: #ffffff; }
        .custom-dialog-btn:hover { filter: brightness(1.1); }
    `;
    document.head.appendChild(style);
}

function createDialogBase(message, type, defaultValue = '') {
    injectDialogStyles();
    
    const overlay = document.createElement('div');
    overlay.className = 'custom-dialog-overlay';
    
    const box = document.createElement('div');
    box.className = 'custom-dialog-box';
    
    const text = document.createElement('div');
    text.className = 'custom-dialog-text';
    text.textContent = message;
    box.appendChild(text);
    
    let input = null;
    if (type === 'prompt') {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'custom-dialog-input';
        input.value = defaultValue;
        box.appendChild(input);
    }
    
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'custom-dialog-buttons';
    
    let btnCancel = null;
    if (type === 'confirm' || type === 'prompt') {
        btnCancel = document.createElement('button');
        btnCancel.className = 'custom-dialog-btn custom-dialog-btn-cancel';
        btnCancel.textContent = type === 'confirm' ? 'No' : 'Cancelar';
        buttonsContainer.appendChild(btnCancel);
    }
    
    const btnConfirm = document.createElement('button');
    btnConfirm.className = 'custom-dialog-btn custom-dialog-btn-confirm';
    btnConfirm.textContent = type === 'confirm' ? 'Sí' : 'Aceptar';
    buttonsContainer.appendChild(btnConfirm);
    
    box.appendChild(buttonsContainer);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    
    // Trigger animation
    requestAnimationFrame(() => {
        overlay.classList.add('show');
    });
    
    if (input) {
        input.focus();
    } else {
        btnConfirm.focus();
    }
    
    return { overlay, btnConfirm, btnCancel, input };
}

window.customAlert = function(message) {
    if (window.isDialogOpen) return Promise.resolve(); // Evitar dobles diálogos
    window.isDialogOpen = true;
    
    return new Promise(resolve => {
        const { overlay, btnConfirm } = createDialogBase(message, 'alert');
        
        function close() {
            overlay.classList.remove('show');
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                window.isDialogOpen = false;
                resolve();
            }, 200);
        }
        
        btnConfirm.onclick = close;
    });
};

window.customConfirm = function(message) {
    if (window.isDialogOpen) return Promise.resolve(false);
    window.isDialogOpen = true;
    
    return new Promise(resolve => {
        const { overlay, btnConfirm, btnCancel } = createDialogBase(message, 'confirm');
        
        function close(result) {
            overlay.classList.remove('show');
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                window.isDialogOpen = false;
                resolve(result);
            }, 200);
        }
        
        btnConfirm.onclick = () => close(true);
        btnCancel.onclick = () => close(false);
    });
};

window.customPrompt = function(message, defaultValue = '') {
    if (window.isDialogOpen) return Promise.resolve(null);
    window.isDialogOpen = true;
    
    return new Promise(resolve => {
        const { overlay, btnConfirm, btnCancel, input } = createDialogBase(message, 'prompt', defaultValue);
        
        function close(result) {
            overlay.classList.remove('show');
            setTimeout(() => {
                if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
                window.isDialogOpen = false;
                resolve(result);
            }, 200);
        }
        
        btnConfirm.onclick = () => close(input.value);
        btnCancel.onclick = () => close(null);
    });
};
