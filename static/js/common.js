// common.js

const ProfileStorage = {
    _prefix: 'default',
    init(profileId) {
        if (profileId) this._prefix = profileId;
    },
    getActiveProfileId() {
        return this._prefix || (window.app && window.app.activeProfileId) || 'default';
    },
    get(key) {
        const val = localStorage.getItem(`${this._prefix}_${key}`);
        if (val !== null) return val;
        if (this._prefix === 'default') {
            return localStorage.getItem(key);
        }
        return null;
    },
    set(key, val) {
        localStorage.setItem(`${this._prefix}_${key}`, val);
    },
    remove(key) {
        localStorage.removeItem(`${this._prefix}_${key}`);
        if (this._prefix === 'default') {
            localStorage.removeItem(key);
        }
    }
};
window.ProfileStorage = ProfileStorage;

const ProfileSessionStorage = {
    _getPrefix() {
        if (window.ProfileStorage && typeof window.ProfileStorage.getActiveProfileId === 'function') {
            return window.ProfileStorage.getActiveProfileId();
        }
        return (window.app && window.app.activeProfileId) || 'default';
    },
    getItem(key) {
        try {
            return sessionStorage.getItem(`${this._getPrefix()}_${key}`);
        } catch (_) {
            return null;
        }
    },
    setItem(key, val) {
        try {
            sessionStorage.setItem(`${this._getPrefix()}_${key}`, val);
        } catch (_) {}
    },
    removeItem(key) {
        try {
            sessionStorage.removeItem(`${this._getPrefix()}_${key}`);
        } catch (_) {}
    },
    get(key) { return this.getItem(key); },
    set(key, val) { this.setItem(key, val); },
    remove(key) { this.removeItem(key); }
};
window.ProfileSessionStorage = ProfileSessionStorage;

window.escapeHtml = function(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
};

/**
 * EventBus réactif et universel pour la synchronisation automatique des vues et de la sidebar.
 */
const EventBus = {
    _listeners: {},
    on(event, callback) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(callback);
        return () => this.off(event, callback);
    },
    off(event, callback) {
        if (!this._listeners[event]) return;
        this._listeners[event] = this._listeners[event].filter(cb => cb !== callback);
    },
    emit(event, data) {
        if (this._listeners[event]) {
            this._listeners[event].forEach(cb => {
                try {
                    cb(data);
                } catch (err) {
                    console.error(`[EventBus] Erreur dans le handler '${event}':`, err);
                }
            });
        }
        try {
            window.dispatchEvent(new CustomEvent(`omnibank:${event}`, { detail: data }));
        } catch (e) {}
    }
};
window.EventBus = EventBus;

async function _handleApiError(res) {
    const text = await res.text();
    let errMsg = text;
    try {
        const json = JSON.parse(text);
        if (json && json.detail) {
            errMsg = typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail);
        }
    } catch(e) {}
    
    if (window.ErrorReporter && typeof window.ErrorReporter.recordApiError === 'function') {
        window.ErrorReporter.recordApiError(res.url || 'API', res.status, errMsg);
    }
    
    const err = new Error(errMsg);
    err.status = res.status;
    err.detail = errMsg;
    throw err;
}

const API = {
    _inflight: {},
    getBaseUrl() {
        return localStorage.getItem('omnibank_server_url') || '';
    },
    setBaseUrl(url) {
        if (url) {
            let clean = url.trim().replace(/\/+$/, '');
            if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
                clean = 'http://' + clean;
            }
            localStorage.setItem('omnibank_server_url', clean);
        } else {
            localStorage.removeItem('omnibank_server_url');
        }
    },
    fullUrl(endpoint) {
        const base = this.getBaseUrl();
        if (!base) return endpoint;
        const cleanBase = base.replace(/\/+$/, '');
        const cleanEp = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
        return cleanBase + cleanEp;
    },
    /**
     * Invalidate the inflight GET cache.
     * Called automatically after any POST/PUT/DELETE mutation.
     */
    _invalidateInflight() {
        this._inflight = {};
    },
    _getCommonHeaders() {
        const headers = {};
        if (window.app && window.app.currentUser) {
            headers['X-User-Name'] = encodeURIComponent(window.app.currentUser);
        }
        if (window.i18n && window.i18n.currentLang) {
            headers['Accept-Language'] = window.i18n.currentLang;
        }
        return headers;
    },
    async get(endpoint, extraOptions = {}) {
        // PERF: Déduplication — si un GET identique est déjà en cours, réutiliser la même Promise
        const cacheKey = endpoint;
        if (this._inflight[cacheKey]) {
            return this._inflight[cacheKey];
        }

        const targetUrl = this.fullUrl(endpoint);
        const separator = targetUrl.includes('?') ? '&' : '?';
        const url = `${targetUrl}${separator}_t=${Date.now()}`;
        
        const fetchOptions = {
            ...extraOptions,
            headers: Object.assign(this._getCommonHeaders(), extraOptions.headers || {})
        };

        const promise = fetch(url, fetchOptions).then(async res => {
            if (!res.ok) await _handleApiError(res);
            return res.json();
        });

        this._inflight[cacheKey] = promise;
        // Auto-expire après 500ms pour éviter les données stale
        promise.finally(() => {
            setTimeout(() => { delete this._inflight[cacheKey]; }, 500);
        });

        return promise;
    },
    async post(endpoint, data, extraOptions = {}) {
        this._invalidateInflight();
        const { skipMutateEvent, silent, ...restOptions } = extraOptions;
        const targetUrl = this.fullUrl(endpoint);
        const headers = Object.assign({ 'Content-Type': 'application/json' }, this._getCommonHeaders(), restOptions.headers || {});
        const fetchOptions = {
            method: 'POST',
            headers,
            ...restOptions
        };
        if (data !== undefined) {
            fetchOptions.body = JSON.stringify(data);
        }
        const res = await fetch(targetUrl, fetchOptions);
        if (!res.ok) await _handleApiError(res);
        const json = await res.json();
        if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
            window.app.updateHeaderHistoryState();
        }
        if (window.EventBus && !skipMutateEvent && !silent) {
            window.EventBus.emit('data:mutated', { endpoint, method: 'POST', data: json });
        }
        return json;
    },
    async put(endpoint, data, extraOptions = {}) {
        this._invalidateInflight();
        const { skipMutateEvent, silent, ...restOptions } = extraOptions;
        const targetUrl = this.fullUrl(endpoint);
        const headers = Object.assign({ 'Content-Type': 'application/json' }, this._getCommonHeaders(), restOptions.headers || {});
        const fetchOptions = {
            method: 'PUT',
            headers,
            ...restOptions
        };
        if (data !== undefined) {
            fetchOptions.body = JSON.stringify(data);
        }
        const res = await fetch(targetUrl, fetchOptions);
        if (!res.ok) await _handleApiError(res);
        const json = await res.json();
        if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
            window.app.updateHeaderHistoryState();
        }
        if (window.EventBus && !skipMutateEvent && !silent) {
            window.EventBus.emit('data:mutated', { endpoint, method: 'PUT', data: json });
        }
        return json;
    },
    async del(endpoint, data = null, customHeaders = null, extraOptions = {}) {
        this._invalidateInflight();
        const { skipMutateEvent, silent, ...restOptions } = extraOptions;
        const targetUrl = this.fullUrl(endpoint);
        const options = { 
            method: 'DELETE', 
            headers: Object.assign(this._getCommonHeaders(), customHeaders || {}, restOptions.headers || {}),
            ...restOptions
        };
        if (data !== null && data !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(data);
        }
        const res = await fetch(targetUrl, options);
        if (!res.ok) await _handleApiError(res);
        if (res.status === 204) {
            if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
                window.app.updateHeaderHistoryState();
            }
            if (window.EventBus && !skipMutateEvent && !silent) {
                window.EventBus.emit('data:mutated', { endpoint, method: 'DELETE', data: null });
            }
            return { ok: true };
        }
        const json = await res.json();
        if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
            window.app.updateHeaderHistoryState();
        }
        if (window.EventBus && !skipMutateEvent && !silent) {
            window.EventBus.emit('data:mutated', { endpoint, method: 'DELETE', data: json });
        }
        return json;
    },
    async delete(endpoint, data = null) {
        return this.del(endpoint, data);
    },
    async patch(endpoint, data) {
        this._invalidateInflight();
        const targetUrl = this.fullUrl(endpoint);
        const res = await fetch(targetUrl, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) await _handleApiError(res);
        if (res.status === 204) {
            if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
                window.app.updateHeaderHistoryState();
            }
            if (window.EventBus) {
                window.EventBus.emit('data:mutated', { endpoint, method: 'PATCH', data: null });
            }
            return { ok: true };
        }
        const json = await res.json();
        if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
            window.app.updateHeaderHistoryState();
        }
        if (window.EventBus) {
            window.EventBus.emit('data:mutated', { endpoint, method: 'PATCH', data: json });
        }
        return json;
    }
};
window.API = API;

// ─── Global Top Progress Bar Manager (Responsive & Mobile-safe) ───
const GlobalProgress = {
    _element: null,
    _activeCount: 0,
    _startTimer: null,
    _doneTimer: null,
    _resetTimer: null,
    _progress: 0,
    _progressInterval: null,

    _isAppInitLoaderVisible() {
        const loader = document.getElementById('appInitLoader');
        return loader && loader.style.display !== 'none' && loader.style.opacity !== '0';
    },

    _getOrCreateElement() {
        if (!this._element || !document.body.contains(this._element)) {
            this._element = document.getElementById('globalProgressBar');
            if (!this._element) {
                this._element = document.createElement('div');
                this._element.id = 'globalProgressBar';
                this._element.className = 'global-progress-bar';
                document.body.appendChild(this._element);
            }
        }
        return this._element;
    },

    start() {
        this._activeCount++;
        clearTimeout(this._doneTimer);
        clearTimeout(this._resetTimer);

        // Ne pas afficher la micro-barre si l'écran de chargement initial plein écran est actif
        if (this._isAppInitLoaderVisible()) return;

        if (this._activeCount === 1) {
            clearTimeout(this._startTimer);
            // Seuil de 120ms : évite les micro-flashs sur les requêtes locales instantanées
            this._startTimer = setTimeout(() => {
                if (this._activeCount > 0 && !this._isAppInitLoaderVisible()) {
                    const el = this._getOrCreateElement();
                    el.classList.remove('is-done');
                    el.classList.add('is-active');
                    if (this._progress < 15) {
                        this._progress = 18;
                    }
                    el.style.width = `${this._progress}%`;

                    clearInterval(this._progressInterval);
                    this._progressInterval = setInterval(() => {
                        if (this._progress < 85) {
                            const step = (85 - this._progress) * 0.12;
                            this._progress += Math.max(step, 0.3);
                            el.style.width = `${Math.min(this._progress, 88)}%`;
                        }
                    }, 180);
                }
            }, 120);
        }
    },

    done() {
        this._activeCount = Math.max(0, this._activeCount - 1);
        if (this._activeCount === 0) {
            clearTimeout(this._startTimer);
            clearInterval(this._progressInterval);

            // Fenêtre d'hystérésis (180ms) : évite le clignotement / retour à zéro si une autre requête s'enchaîne
            clearTimeout(this._doneTimer);
            this._doneTimer = setTimeout(() => {
                if (this._activeCount > 0) return;

                const el = this._element || document.getElementById('globalProgressBar');
                if (el && el.classList.contains('is-active')) {
                    this._progress = 100;
                    el.style.width = '100%';

                    this._resetTimer = setTimeout(() => {
                        if (this._activeCount > 0) return;
                        el.classList.add('is-done');
                        el.classList.remove('is-active');

                        setTimeout(() => {
                            if (this._activeCount === 0) {
                                this._progress = 0;
                                el.style.width = '0%';
                                el.classList.remove('is-done');
                            }
                        }, 400);
                    }, 180);
                }
            }, 180);
        }
    }
};
window.GlobalProgress = GlobalProgress;

/**
 * Helper universel pour sécuriser les clics de boutons :
 * - Fige la largeur actuelle (évite le saut de mise en page)
 * - Applique la classe .is-loading (micro-spinner CSS)
 * - Désactive le bouton (anti double-clic)
 * - Rétablit l'état initial en bloc finally
 *
 * @param {HTMLElement|string} buttonOrSelector 
 * @param {Function} asyncFn 
 * @returns {Promise<*>}
 */
window.withButtonLoading = async function(buttonOrSelector, asyncFn) {
    const btn = typeof buttonOrSelector === 'string'
        ? document.querySelector(buttonOrSelector)
        : buttonOrSelector;

    if (!btn || !(btn instanceof HTMLElement)) {
        return (typeof asyncFn === 'function') ? await asyncFn() : undefined;
    }

    if (btn.disabled || btn.classList.contains('is-loading')) {
        return;
    }

    const rect = btn.getBoundingClientRect();
    const prevMinWidth = btn.style.minWidth;
    const prevPointerEvents = btn.style.pointerEvents;
    const wasDisabled = btn.disabled;

    if (rect.width > 0) {
        btn.style.minWidth = `${rect.width}px`;
    }

    btn.classList.add('is-loading');
    btn.disabled = true;

    try {
        return (typeof asyncFn === 'function') ? await asyncFn() : undefined;
    } finally {
        btn.classList.remove('is-loading');
        btn.disabled = wasDisabled;
        btn.style.minWidth = prevMinWidth;
        btn.style.pointerEvents = prevPointerEvents;
    }
};

// Global fetch interceptor for remote server URL support & global progress tracking
if (typeof window._originalFetch === 'undefined') {
    window._originalFetch = window.fetch;
    window.fetch = function(resource, config) {
        const urlStr = typeof resource === 'string'
            ? resource
            : (resource instanceof Request ? resource.url : '');

        const isApi = urlStr.includes('/api/');
        const isSilent = (config && config.silent === true) || (config && config.headers && (config.headers['X-Silent'] === 'true' || config.headers.silent === true));

        if (isApi && !isSilent && window.GlobalProgress) {
            window.GlobalProgress.start();
        }

        if (typeof resource === 'string' && resource.startsWith('/')) {
            const baseUrl = API.getBaseUrl();
            if (baseUrl) {
                resource = baseUrl.replace(/\/+$/, '') + resource;
            }
        } else if (resource instanceof Request && typeof resource.url === 'string' && resource.url.startsWith('/')) {
            const baseUrl = API.getBaseUrl();
            if (baseUrl) {
                const target = baseUrl.replace(/\/+$/, '') + resource.url;
                resource = new Request(target, resource);
            }
        }

        try {
            const p = window._originalFetch.call(this, resource, config);
            if (isApi && !isSilent && window.GlobalProgress) {
                return Promise.resolve(p).finally(() => {
                    window.GlobalProgress.done();
                });
            }
            return p;
        } catch (err) {
            if (isApi && !isSilent && window.GlobalProgress) {
                window.GlobalProgress.done();
            }
            throw err;
        }
    };
}

function showInlineConfirm(titleKey, messageKey) {
    return new Promise((resolve) => {
        const modal = document.getElementById('inlineConfirm');
        const titleEl = document.getElementById('confirmTitle');
        const messageEl = document.getElementById('confirmMessage');
        const btnOk = document.getElementById('confirmOk');
        const btnCancel = document.getElementById('confirmCancel');

        // Set button labels
        btnOk.textContent = window.i18n.t('btn_confirm') || 'Confirmer';
        btnCancel.textContent = window.i18n.t('btn_cancel') || 'Annuler';
        btnCancel.style.display = 'inline-block';

        // i18n.t returns the key itself if not found — fall back to raw text
        const resolveText = (keyOrText) => {
            const translated = window.i18n.t(keyOrText);
            return translated === keyOrText ? keyOrText : translated;
        };
        titleEl.textContent = resolveText(titleKey);
        const msgContent = resolveText(messageKey);
        // Support HTML content (e.g. maintenance preview with radio buttons)
        if (msgContent.includes('<') && msgContent.includes('>')) {
            messageEl.innerHTML = msgContent;
        } else {
            messageEl.textContent = msgContent;
        }

        modal.style.zIndex = '10100';
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

        // Set button labels
        btnOk.textContent = window.i18n.t('btn_ok') || 'Compris';
        btnCancel.style.display = 'none';

        const resolveText = (keyOrText) => {
            const translated = window.i18n.t(keyOrText);
            return translated === keyOrText ? keyOrText : translated;
        };
        titleEl.textContent = resolveText(titleText);
        const msgContent = resolveText(messageText);
        if (msgContent.includes('<') && msgContent.includes('>')) {
            messageEl.innerHTML = msgContent;
        } else {
            messageEl.textContent = msgContent;
        }

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

window.appBaseCurrency = 'EUR';
window.appDateFormat = 'DD/MM/YYYY';

function formatCurrency(amount, currencyCode) {
    let profileCurr = null;
    if (window.app && window.app.profiles && window.app.activeProfileId) {
        const activeProf = window.app.profiles.find(p => p.id === window.app.activeProfileId);
        if (activeProf && activeProf.currency) profileCurr = activeProf.currency;
    }
    const code = (currencyCode || profileCurr || window.appBaseCurrency || 'EUR').toUpperCase();
    const num = (amount === null || amount === undefined || isNaN(amount)) ? 0 : Number(amount);
    try {
        const lang = (window.i18n && window.i18n.currentLang === 'en') ? 'en-US' : 'fr-FR';
        let formatted = new Intl.NumberFormat(lang, { style: 'currency', currency: code }).format(num);
        if (code === 'USD') {
            formatted = formatted.replace(/\s*\$US|US\$\s*/g, ' $');
        }
        return formatted;
    } catch (e) {
        return `${num.toFixed(2)} ${code}`;
    }
}

window.isPastUnreconciled = function(tx) {
    if (!tx || tx.reconciliation_date || tx.is_skipped) return false;
    if (!tx.date_operation) return false;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const opDateStr = String(tx.date_operation).substring(0, 10);
    return opDateStr < todayStr;
};

window.renderDateWithStatus = function(tx, overrideFormat) {
    const formatted = formatDate(tx ? tx.date_operation : null, overrideFormat);
    if (tx && window.isPastUnreconciled(tx)) {
        return `<span class="date-past-unreconciled" title="Opération passée non rapprochée">${formatted}</span>`;
    }
    return formatted;
};

function formatDate(dateString, overrideFormat) {
    if (!dateString) return "";
    let profileFmt = null;
    if (window.app && window.app.profiles && window.app.activeProfileId) {
        const activeProf = window.app.profiles.find(p => p.id === window.app.activeProfileId);
        if (activeProf && activeProf.date_format) profileFmt = activeProf.date_format;
    }
    const fmt = overrideFormat || profileFmt || window.appDateFormat || 'DD/MM/YYYY';

    let y, m, d;
    if (typeof dateString === 'string' && dateString.length >= 10) {
        const parts = dateString.substring(0, 10).split('-');
        if (parts.length === 3) {
            y = parts[0];
            m = parts[1];
            d = parts[2];
        }
    }
    if (!y || !m || !d) {
        const dateObj = new Date(dateString);
        if (isNaN(dateObj.getTime())) return String(dateString);
        y = String(dateObj.getFullYear());
        m = String(dateObj.getMonth() + 1).padStart(2, '0');
        d = String(dateObj.getDate()).padStart(2, '0');
    }

    if (fmt === 'YYYY-MM-DD') return `${y}-${m}-${d}`;
    if (fmt === 'MM/DD/YYYY') return `${m}/${d}/${y}`;
    return `${d}/${m}/${y}`;
}

/**
 * Non-blocking toast notification — auto-disappears after `duration` ms.
 * @param {string} message - Text to display
 * @param {'success'|'error'|'info'} type - Visual style
 * @param {number} duration - Auto-dismiss in ms (default 3000)
 */
function showToast(message, type = 'success', duration = 3000, options = null) {
    const colors = {
        success: { bg: 'rgba(16,185,129,0.15)', border: '#10b981', text: '#10b981', icon: '✅' },
        error:   { bg: 'rgba(255,86,48,0.15)',   border: '#ff5630', text: '#ff5630', icon: '❌' },
        info:    { bg: 'rgba(99,102,241,0.15)',   border: '#6366f1', text: '#6366f1', icon: 'ℹ️' },
    };
    const c = colors[type] || colors.info;

    // Shift existing toasts up
    const existingToasts = document.querySelectorAll('.app-toast');
    existingToasts.forEach(t => {
        const currentBottom = parseInt(t.style.bottom) || 20;
        t.style.bottom = (currentBottom + 65) + 'px';
    });

    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 30000;
        display: flex; align-items: center; gap: 10px;
        padding: 14px 20px; border-radius: 10px;
        background: ${c.bg}; border: 1px solid ${c.border};
        color: ${c.text}; font-size: 13px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        backdrop-filter: blur(12px);
        transform: translateX(120%); transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), bottom 0.3s ease;
        pointer-events: auto; cursor: pointer;
    `;
    const msgSpan = document.createElement('span');
    msgSpan.innerHTML = `<span style="font-size:16px;">${c.icon}</span> ${message}`;
    toast.appendChild(msgSpan);

    if (options && options.action) {
        const actionBtn = document.createElement('button');
        actionBtn.style.cssText = `
            margin-left: auto;
            background: rgba(255, 255, 255, 0.18);
            border: 1px solid currentColor;
            color: inherit;
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: background 0.15s ease, transform 0.1s ease;
        `;
        actionBtn.textContent = options.action.text || '↩️ Annuler';
        actionBtn.onmouseover = () => { actionBtn.style.background = 'rgba(255, 255, 255, 0.3)'; };
        actionBtn.onmouseout = () => { actionBtn.style.background = 'rgba(255, 255, 255, 0.18)'; };
        actionBtn.onclick = (e) => {
            e.stopPropagation();
            dismiss();
            if (typeof options.action.callback === 'function') {
                options.action.callback();
            }
        };
        toast.appendChild(actionBtn);
    }

    if (type === 'error') {
        const reportBtn = document.createElement('button');
        reportBtn.style.cssText = `
            margin-left: auto;
            background: rgba(255, 86, 48, 0.2);
            border: 1px solid rgba(255, 86, 48, 0.5);
            color: #ff5630;
            padding: 4px 8px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
            display: inline-flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s ease;
        `;
        reportBtn.textContent = window.i18n?.t('diag_toast_copy_report') || '📋 Rapport';
        reportBtn.title = window.i18n?.t('diag_toast_copy_report_tooltip') || 'Copier un rapport de bug anonymisé pour GitHub';
        reportBtn.onmouseover = () => { reportBtn.style.background = 'rgba(255, 86, 48, 0.35)'; };
        reportBtn.onmouseout = () => { reportBtn.style.background = 'rgba(255, 86, 48, 0.2)'; };
        reportBtn.onclick = (e) => {
            e.stopPropagation();
            if (window.ErrorReporter && typeof window.ErrorReporter.copyReportToClipboard === 'function') {
                window.ErrorReporter.copyReportToClipboard(message);
            }
        };
        toast.appendChild(reportBtn);
    }

    toast.onclick = (e) => {
        if (e.target.tagName !== 'BUTTON') {
            dismiss();
        }
    };

    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });

    const dismiss = () => {
        toast.style.transform = 'translateX(120%)';
        setTimeout(() => {
            toast.remove();
            // Smoothly shift remaining toasts down if needed
            const remainingToasts = document.querySelectorAll('.app-toast');
            let offset = 20;
            // Iterate in reverse (newest to oldest) to reposition them
            Array.from(remainingToasts).reverse().forEach(t => {
                t.style.bottom = offset + 'px';
                offset += 65;
            });
        }, 350);
    };
    setTimeout(dismiss, duration);
}
window.showToast = showToast;

/**
 * Toast with an Undo button.
 * @param {string} message 
 * @param {number} actionId 
 * @param {function} onUndoSuccess - callback to run after undo success
 */
function showUndoToast(message, actionId, onUndoSuccess = null) {
    if (!actionId) {
        showToast(message, 'success');
        return;
    }
    if (window.app && window.app.updateHeaderHistoryState) {
        window.app.updateHeaderHistoryState();
    }
    const undoText = window.i18n.t('history_undo_toast') || '↩ Undo';
    const successMsg = window.i18n.t('history_undo_success') || 'Action successfully undone.';
    
    // Shift existing toasts up
    const existingToasts = document.querySelectorAll('.app-toast');
    existingToasts.forEach(t => {
        const currentBottom = parseInt(t.style.bottom) || 20;
        t.style.bottom = (currentBottom + 65) + 'px';
    });

    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 10010;
        display: flex; align-items: center; justify-content: space-between; gap: 15px;
        padding: 14px 20px; border-radius: 10px;
        background: rgba(16,185,129,0.15); border: 1px solid #10b981;
        color: #10b981; font-size: 13px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        backdrop-filter: blur(12px);
        transform: translateX(120%); transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), bottom 0.3s ease;
        pointer-events: auto;
    `;
    
    const textSpan = document.createElement('span');
    textSpan.innerHTML = `<span style="font-size:16px;">✅</span> ${message}`;
    
    const undoBtn = document.createElement('button');
    undoBtn.textContent = undoText;
    undoBtn.style.cssText = `
        background: rgba(245,158,11,0.2); border: 1px solid #f59e0b;
        color: #f59e0b; padding: 4px 10px; border-radius: 6px;
        font-size: 11px; font-weight: 700; cursor: pointer;
        transition: background 0.2s;
    `;
    undoBtn.onmouseover = () => { undoBtn.style.background = 'rgba(245,158,11,0.35)'; };
    undoBtn.onmouseout = () => { undoBtn.style.background = 'rgba(245,158,11,0.2)'; };
    
    undoBtn.onclick = async (e) => {
        e.stopPropagation();
        undoBtn.disabled = true;
        undoBtn.textContent = '...';
        try {
            const res = await API.post(`/api/history/${actionId}/undo`);
            if (res.ok) {
                showToast(successMsg, 'success');
                dismiss();
                if (window.app && window.app.updateHeaderHistoryState) {
                    window.app.updateHeaderHistoryState();
                }
                if (res.warning) {
                    const warningMsg = window.i18n.t(`history_undo_warning_cascade`) || 'Warning: cascade entities modified.';
                    setTimeout(() => showToast(warningMsg, 'info', 6000), 1000);
                }
                if (window.app && window.app.refreshSidebar) {
                    window.app.refreshSidebar();
                }
                if (onUndoSuccess) {
                    onUndoSuccess();
                } else {
                    // Default fallback: reload current view
                    if (window.app && window.app.currentView) {
                        window.app.loadView(window.app.currentView);
                    }
                }
            } else {
                const failMsg = (window.i18n.t('history_undo_fail') || 'Failed to undo').replace('{error}', res.detail || '');
                showToast(failMsg, 'error');
                undoBtn.disabled = false;
                undoBtn.textContent = undoText;
            }
        } catch (err) {
            console.error("Undo failed", err);
            showToast("Undo failed", 'error');
            undoBtn.disabled = false;
            undoBtn.textContent = undoText;
        }
    };
    
    toast.appendChild(textSpan);
    toast.appendChild(undoBtn);
    
    // Close button on clicking outside the undo button
    toast.onclick = (e) => {
        if (e.target !== undoBtn) {
            dismiss();
        }
    };

    document.body.appendChild(toast);
    requestAnimationFrame(() => { toast.style.transform = 'translateX(0)'; });

    const dismiss = () => {
        toast.style.transform = 'translateX(120%)';
        setTimeout(() => {
            toast.remove();
            const remainingToasts = document.querySelectorAll('.app-toast');
            let offset = 20;
            Array.from(remainingToasts).reverse().forEach(t => {
                t.style.bottom = offset + 'px';
                offset += 65;
            });
        }, 350);
    };

    setTimeout(() => {
        if (document.body.contains(toast)) {
            dismiss();
        }
    }, 8000);
}

window.formatHistoryLabel = function (data) {
    if (!data || !data.entity_type || !data.action_type) return '';

    const actionText = window.i18n.t('history_action_' + data.action_type.toLowerCase());
    const entityPrepKey = 'history_entity_prep_' + data.entity_type;
    const entityPrepForm = window.i18n.t(entityPrepKey);
    const hasPrep = entityPrepForm && entityPrepForm !== entityPrepKey;
    const actionEntity = hasPrep
        ? actionText + ' ' + entityPrepForm
        : actionText + ' ' + (window.i18n.t('history_entity_' + data.entity_type) || data.entity_type);

    if (data.name && data.amount != null) {
        return window.i18n.tp('history_action_compose', {
            action: actionEntity,
            name: data.name,
            amount: String(data.amount).replace('.', ',')
        });
    }
    if (data.name) {
        return window.i18n.tp('history_action_compose_name', {
            action: actionEntity,
            name: data.name
        });
    }
    if (data.amount != null) {
        return actionEntity + ' (' + String(data.amount).replace('.', ',') + ' €)';
    }
    return actionEntity;
};

window.cleanStringForSearch = function(str) {
    if (str == null) return '';
    return str.toString()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
};

/**
 * Permissive search matcher:
 * - Accent-insensitive (e.g. "é" matches "e", "ç" matches "c", "ô" matches "o")
 * - Case-insensitive
 * - Multi-word / token permissive: all space-separated terms must be found in any order across the searchable text
 * - Amount normalization: matches numbers formatted with dot or comma (e.g. "45,50" matches "45.50")
 *
 * @param {string|string[]} haystack - Single string or array of strings to search in
 * @param {string} query - User search input
 * @returns {boolean} true if query matches haystack
 */
window.permissiveMatch = function(haystack, query) {
    if (!query) return true;
    const cleanQuery = window.cleanStringForSearch(query);
    if (!cleanQuery) return true;

    let target = '';
    if (Array.isArray(haystack)) {
        target = haystack.filter(h => h != null).map(h => window.cleanStringForSearch(h)).join(' ');
    } else {
        target = window.cleanStringForSearch(haystack);
    }
    if (!target) return false;

    const tokens = cleanQuery.split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;

    return tokens.every(token => {
        if (target.includes(token)) return true;
        // Also check comma <-> dot variant for numbers (e.g. "45,50" <-> "45.50")
        if (token.includes(',')) {
            const dotToken = token.replace(/,/g, '.');
            if (target.includes(dotToken)) return true;
        } else if (token.includes('.')) {
            const commaToken = token.replace(/\./g, ',');
            if (target.includes(commaToken)) return true;
        }
        return false;
    });
};


