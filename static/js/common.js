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
        const json = await res.json();
        if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
            window.app.updateHeaderHistoryState();
        }
        return json;
    },
    async put(endpoint, data) {
        const res = await fetch(endpoint, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
            window.app.updateHeaderHistoryState();
        }
        return json;
    },
    async del(endpoint) {
        const res = await fetch(endpoint, { method: 'DELETE' });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (window.app && typeof window.app.updateHeaderHistoryState === 'function') {
            window.app.updateHeaderHistoryState();
        }
        return json;
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
        const msgContent = resolveText(messageKey);
        // Support HTML content (e.g. maintenance preview with radio buttons)
        if (msgContent.includes('<') && msgContent.includes('>')) {
            messageEl.innerHTML = msgContent;
        } else {
            messageEl.textContent = msgContent;
        }

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
        const msgContent = resolveText(messageText);
        if (msgContent.includes('<') && msgContent.includes('>')) {
            messageEl.innerHTML = msgContent;
        } else {
            messageEl.textContent = msgContent;
        }
        
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
        display: flex; align-items: center; gap: 10px;
        padding: 14px 20px; border-radius: 10px;
        background: ${c.bg}; border: 1px solid ${c.border};
        color: ${c.text}; font-size: 13px; font-weight: 600;
        box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        backdrop-filter: blur(12px);
        transform: translateX(120%); transition: transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1), bottom 0.3s ease;
        pointer-events: auto; cursor: pointer;
    `;
    toast.innerHTML = `<span style="font-size:16px;">${c.icon}</span> ${message}`;
    toast.onclick = () => dismiss();

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
