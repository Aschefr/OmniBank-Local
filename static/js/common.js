// common.js

const API = {
    async get(endpoint) {
        // Prevent browser caching by appending a timestamp
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `${endpoint}${separator}_t=${Date.now()}`;
        
        const res = await fetch(url);
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    async post(endpoint, data) {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    async put(endpoint, data) {
        const res = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    },
    async del(endpoint) {
        const res = await fetch(endpoint, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        return res.json();
    }
};

function showInlineConfirm(titleKey, messageKey) {
    return new Promise((resolve) => {
        const modal = document.getElementById('inlineConfirm');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const btnOk = document.getElementById('confirmOk');
        const btnCancel = document.getElementById('confirmCancel');

        // i18n.t returns the key itself if not found — fall back to raw text
        const resolveText = (keyOrText) => {
            const translated = window.i18n.t(keyOrText);
            return translated === keyOrText ? keyOrText : translated;
        };
        titleEl.textContent = resolveText(titleKey);
        messageEl.textContent = resolveText(messageKey);

        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            btnOk.onclick = null;
            btnCancel.onclick = null;
        };

        btnOk.onclick = () => { cleanup(); resolve(true); };
        btnCancel.onclick = () => { cleanup(); resolve(false); };
    });
}

function showInlineMessage(titleText, messageText) {
    return new Promise((resolve) => {
        const modal = document.getElementById('inlineConfirm');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const btnOk = document.getElementById('confirmOk');
        const btnCancel = document.getElementById('confirmCancel');

        const resolveText = (keyOrText) => {
            const translated = window.i18n.t(keyOrText);
            return translated === keyOrText ? keyOrText : translated;
        };
        titleEl.textContent = resolveText(titleText);
        messageEl.textContent = resolveText(messageText);
        
        btnCancel.style.display = 'none';

        modal.style.display = 'flex';

        const cleanup = () => {
            modal.style.display = 'none';
            btnCancel.style.display = 'inline-block';
            btnOk.onclick = null;
        };

        btnOk.onclick = () => { cleanup(); resolve(); };
    });
}

function showInlinePrompt(titleText, defaultValue = '') {
    return new Promise((resolve) => {
        const modal = document.getElementById('inlinePrompt');
        const titleEl = document.getElementById('promptTitle');
        const inputEl = document.getElementById('promptInput');
        const btnOk = document.getElementById('promptOk');
        const btnCancel = document.getElementById('promptCancel');

        titleEl.textContent = titleText;
        inputEl.value = defaultValue;

        modal.style.display = 'flex';
        inputEl.focus();

        const cleanup = () => {
            modal.style.display = 'none';
            btnOk.onclick = null;
            btnCancel.onclick = null;
        };

        btnOk.onclick = () => { cleanup(); resolve(inputEl.value); };
        btnCancel.onclick = () => { cleanup(); resolve(null); };
        
        // Handle Enter key
        inputEl.onkeydown = (e) => {
            if (e.key === 'Enter') {
                cleanup();
                resolve(inputEl.value);
            }
        };
    });
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function formatDate(dateString) {
    if (!dateString) return "";
    const d = new Date(dateString);
    return d.toLocaleDateString('fr-FR');
}

/**
 * Non-blocking toast notification — auto-disappears after `duration` ms.
 * @param {string} message - Text to display
 * @param {'success'|'error'|'info'} type - Visual style
 * @param {number} duration - Auto-dismiss in ms (default 3000)
 */
function showToast(message, type = 'success', duration = 3000) {
    const colors = {
        success: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981', icon: '✅' },
        error:   { bg: 'rgba(255,86,48,0.15)',   border: '#ff5630', text: '#ff5630', icon: '❌' },
        info:    { bg: 'rgba(99,102,241,0.15)',   border: '#6366f1', text: '#6366f1', icon: 'ℹ️' },
    };
    const c = colors[type] || colors.info;

    const toast = document.createElement('div');
    toast.style.cssText = `
        position: fixed; top: 20px; right: 20px; z-index: 10000;
        display: flex; align-items: center; gap: 10px;
        padding: 14px 20px; border-radius: 10px;
        background: ${c.bg}; border: 1px solid ${c.border};
        color: ${c.text}; font-size: 13px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        backdrop-filter: blur(12px);
        transform: translateX(120%); transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
        pointer-events: auto; cursor: pointer;
    `;
    toast.innerHTML = `<span style="font-size:16px;">${c.icon}</span> ${message}`;
    toast.onclick = () => dismiss();

    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });

    const dismiss = () => {
        toast.style.transform = 'translateX(120%)';
        setTimeout(() => toast.remove(), 350);
    };
    setTimeout(dismiss, duration);
}
