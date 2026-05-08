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
