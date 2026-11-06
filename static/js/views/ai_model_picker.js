// static/js/views/ai_model_picker.js — Modèles recommandés (Minimum, Recommandé, Top qualité), partagé par
// l'assistant de démarrage et Configuration. Choisir un modèle enregistre aussi sa température et son contexte.
// Sur un serveur Ollama, un modèle absent se télécharge d'un clic ; ailleurs, la commande à lancer est affichée.

window.AiModelPicker = {
    _state: {},   // containerId -> { opts, catalog, timer }

    _t(key, fallback, params) {
        let v = window.i18n ? window.i18n.t(key) : null;
        if (!v || v === key) v = fallback;
        if (params) Object.entries(params).forEach(([k, val]) => { v = v.split('{' + k + '}').join(val); });
        return v;
    },

    _num(v) {
        return Number(v).toLocaleString(window.i18n && window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR');
    },

    _ensureStyles() {
        if (document.getElementById('aiModelPickerStyles')) return;
        const st = document.createElement('style');
        st.id = 'aiModelPickerStyles';
        st.textContent = `
            .amp-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:10px; margin:10px 0 4px; text-align:left; }
            .amp-card { display:flex; flex-direction:column; gap:6px; padding:12px; border:1px solid var(--border-color);
                border-radius:12px; background:var(--bg-base); min-width:0; }
            .amp-card.is-current { border-color:var(--accent); box-shadow:0 0 0 1px var(--accent) inset; }
            .amp-tier { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--text-muted); }
            .amp-card.tier-recommended .amp-tier { color:var(--accent); }
            .amp-name { font-size:13.5px; font-weight:700; color:var(--text-main); word-break:break-word; }
            .amp-facts { font-size:12px; color:var(--text-muted); line-height:1.45; margin:0; padding:0; list-style:none; }
            .amp-actions { margin-top:auto; padding-top:4px; display:flex; flex-direction:column; gap:6px; }
            .amp-btn { min-height:34px; border-radius:8px; border:1px solid var(--border-color); background:var(--bg-card);
                color:var(--text-main); font-size:12.5px; font-weight:600; cursor:pointer; padding:6px 10px; }
            .amp-btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
            .amp-btn:disabled { opacity:.6; cursor:default; }
            .amp-btn:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
            .amp-bar { height:6px; border-radius:999px; background:var(--border-color); overflow:hidden; }
            .amp-bar > span { display:block; height:100%; background:var(--accent); transition:width .4s ease; }
            .amp-note { font-size:11.5px; color:var(--text-muted); line-height:1.4; }
            .amp-note code { font-size:11.5px; }
            .amp-error { font-size:11.5px; color:var(--danger, #ff5630); line-height:1.4; }
            .amp-current { font-size:12px; font-weight:700; color:var(--accent); }
        `;
        document.head.appendChild(st);
    },

    /**
     * opts.current : modèle actuellement choisi ; opts.onPick(model) : appelé après l'enregistrement d'un choix.
     */
    // opts.url : adresse en cours de test (assistant de démarrage), pas encore enregistrée
    _catalogPath(opts) {
        return opts && opts.url ? `/api/config/ollama/catalog?url=${encodeURIComponent(opts.url)}` : '/api/config/ollama/catalog';
    },

    async render(containerId, opts = {}) {
        this._ensureStyles();
        const el = document.getElementById(containerId);
        if (!el) return;
        const st = this._state[containerId] || {};
        st.opts = opts;
        this._state[containerId] = st;
        try {
            st.catalog = await API.get(this._catalogPath(opts));
        } catch (e) {
            el.innerHTML = '';
            return;
        }
        this._paint(containerId);
        this._schedulePoll(containerId);
    },

    _paint(containerId) {
        const el = document.getElementById(containerId);
        const st = this._state[containerId];
        if (!el || !st || !st.catalog) return;
        const { downloadable, models } = st.catalog;
        if (!models || !models.length) { el.innerHTML = ''; return; }
        const tierLabel = {
            minimum: this._t('ai_models_tier_minimum', 'Minimum'),
            recommended: this._t('ai_models_tier_recommended', 'Recommandé'),
            top: this._t('ai_models_tier_top', 'Top qualité')
        };
        const cards = models.map(m => {
            const isCurrent = st.opts.current === m.name;
            const facts = [
                this._t('ai_models_vram', 'Mémoire graphique : environ {gb} Go', { gb: this._num(m.vram_gb) }),
                this._t('ai_models_speed', 'Réponse du conseiller : environ {s} s', { s: m.typical_seconds }),
                this._t('ai_models_download', 'Téléchargement : {gb} Go', { gb: this._num(m.size_gb) })
            ].map(f => `<li>${f}</li>`).join('');
            let actions;
            if (m.downloading) {
                actions = `<div class="amp-bar" role="progressbar" aria-valuenow="${m.percent}" aria-valuemin="0" aria-valuemax="100"><span style="width:${m.percent}%"></span></div>
                    <div class="amp-note">${this._t('ai_models_downloading', 'Téléchargement : {p} %', { p: m.percent })}</div>`;
            } else if (m.installed) {
                actions = isCurrent
                    ? `<div class="amp-current">✓ ${this._t('ai_models_in_use', 'En service')}</div>`
                    : `<button type="button" class="amp-btn ${m.tier === 'recommended' ? 'primary' : ''}" onclick="window.AiModelPicker.pick('${containerId}', '${m.name}')">${this._t('ai_models_use', 'Utiliser')}</button>`;
            } else if (downloadable) {
                actions = `<button type="button" class="amp-btn ${m.tier === 'recommended' ? 'primary' : ''}" onclick="window.AiModelPicker.pull('${containerId}', '${m.name}')">${this._t('ai_models_get', 'Télécharger ({gb} Go)', { gb: this._num(m.size_gb) })}</button>`;
            } else {
                actions = `<div class="amp-note">${this._t('ai_models_manual', 'À installer sur le serveur : {cmd}', { cmd: `<code>ollama pull ${m.name}</code>` })}</div>`;
            }
            const err = m.error ? `<div class="amp-error">${this._t('ai_models_pull_failed', 'Échec du téléchargement : {e}', { e: window.escapeHtml ? window.escapeHtml(m.error) : m.error })}</div>` : '';
            return `
                <div class="amp-card tier-${m.tier} ${isCurrent ? 'is-current' : ''}">
                    <div class="amp-tier">${tierLabel[m.tier] || m.tier}</div>
                    <div class="amp-name">${m.name}</div>
                    <ul class="amp-facts">${facts}</ul>
                    <div class="amp-actions">${actions}${err}</div>
                </div>`;
        }).join('');
        el.innerHTML = `<div class="amp-grid">${cards}</div>
            <div class="amp-note">${this._t('ai_models_settings_note', 'Choisir un modèle règle aussi sa température ({temp}) et son contexte ({ctx}). Mesuré sur une carte graphique de 24 Go ; sans carte graphique, comptez plusieurs fois plus long.', { temp: this._num(models[0].temperature), ctx: Math.round(models[0].num_ctx / 1024) + 'K' })}</div>`;
    },

    _schedulePoll(containerId) {
        const st = this._state[containerId];
        clearTimeout(st.timer);
        if (!st.catalog || !st.catalog.models.some(m => m.downloading)) return;
        st.timer = setTimeout(async () => {
            if (!document.getElementById(containerId)) return;
            const wasDownloading = new Set(st.catalog.models.filter(m => m.downloading).map(m => m.name));
            try { st.catalog = await API.get(this._catalogPath(st.opts)); } catch (e) { /* on réessaie */ }
            this._paint(containerId);
            const finished = st.catalog.models.find(m => wasDownloading.has(m.name) && m.installed && !m.downloading);
            if (finished && st.opts.onDownloaded) st.opts.onDownloaded(finished.name);
            this._schedulePoll(containerId);
        }, 2000);
    },

    // Le meilleur choix déjà installé : Recommandé, sinon Top qualité, sinon Minimum
    bestInstalled(containerId) {
        const models = this._state[containerId]?.catalog?.models || [];
        for (const tier of ['recommended', 'top', 'minimum']) {
            const m = models.find(x => x.tier === tier && x.installed);
            if (m) return m.name;
        }
        return null;
    },

    presetFor(containerId, model) {
        return (this._state[containerId]?.catalog?.models || []).find(m => m.name === model) || null;
    },

    markCurrent(containerId, model) {
        const st = this._state[containerId];
        if (!st) return;
        st.opts.current = model;
        this._paint(containerId);
    },

    async pull(containerId, model) {
        try {
            const url = this._state[containerId]?.opts?.url;
            await API.post('/api/config/ollama/pull', url ? { model, url } : { model });
        } catch (e) {
            showToast(e.detail || e.message || 'Error', 'error');
            return;
        }
        await this.render(containerId, this._state[containerId].opts);
    },

    async pick(containerId, model) {
        const st = this._state[containerId];
        const m = st.catalog.models.find(x => x.name === model);
        if (!m) return;
        try {
            await API.post('/api/config/', {
                ollama_model: m.name,
                ollama_temperature: String(m.temperature),
                ollama_context: String(m.num_ctx)
            });
        } catch (e) {
            showToast(e.detail || e.message || 'Error', 'error');
            return;
        }
        if (window.app && window.app.config) {
            Object.assign(window.app.config, { ollama_model: m.name, ollama_temperature: String(m.temperature), ollama_context: String(m.num_ctx) });
        }
        st.opts.current = m.name;
        this._paint(containerId);
        showToast(this._t('ai_models_picked', 'Modèle {name} en service, avec ses réglages.', { name: m.name }), 'success');
        if (st.opts.onPick) st.opts.onPick(m);
    }
};
