// static/js/views/ai_model_picker.js — Modèles recommandés (Minimum, Recommandé, Top qualité), partagé par
// l'assistant de démarrage et Configuration. Choisir un modèle enregistre aussi sa température et son contexte.
// Sur un serveur Ollama, un modèle absent se télécharge d'un clic ; ailleurs, la commande à lancer est affichée.

// Le tableau « Comment ces modèles ont été choisis » (mesures et règles) vient de ai_model_study.js ;
// mêmes chiffres dans docs/*/pages/06_* (modèles recommandés).

window.AiModelPicker = {
    _state: {},   // containerId -> { opts, catalog, timer }

    _t(key, fallback, params) {
        let v = window.i18n ? window.i18n.t(key) : null;
        if (!v || v === key) v = fallback;
        if (params) Object.entries(params).forEach(([k, val]) => { v = v.split('{' + k + '}').join(val); });
        return v;
    },

    _num(v, digits) {
        const fixed = digits == null ? {} : { minimumFractionDigits: digits, maximumFractionDigits: digits };
        return Number(v).toLocaleString(window.i18n && window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', fixed);
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
            .amp-study { margin-top:12px; }
            .amp-study-body { display:flex; flex-direction:column; gap:8px; padding-bottom:4px; }
            .amp-study-scroll { overflow-x:auto; -webkit-overflow-scrolling:touch; }
            .amp-study table { width:max-content; min-width:100%; border-collapse:separate; border-spacing:0; font-size:12px; font-variant-numeric:tabular-nums; }
            /* Modèle et Note restent à gauche quand le tableau défile (téléphone) */
            .amp-study .amp-col-model, .amp-study .amp-col-score { position:sticky; z-index:1; background:var(--amp-sticky-bg, var(--bg-card)); }
            .amp-study .amp-col-model { left:0; width:176px; min-width:176px; max-width:176px; white-space:normal; overflow-wrap:anywhere; }
            .amp-study .amp-col-score { left:176px; box-shadow:inset -1px 0 0 var(--border-color); }
            .amp-study td.amp-col-score { font-weight:700; color:var(--text-main); }
            .amp-study th, .amp-study td { padding:5px 8px; border-bottom:1px solid var(--border-color); text-align:right; white-space:nowrap; }
            .amp-study th:first-child, .amp-study td:first-child { text-align:left; }
            .amp-study th { font-size:11px; font-weight:600; color:var(--text-muted); vertical-align:bottom; }
            .amp-study th small, .amp-study td small { display:block; font-size:10.5px; font-weight:500; color:var(--text-muted); }
            .amp-study td code { font-size:12px; color:var(--text-main); }
            .amp-study tr.is-tier td small { color:var(--accent); font-weight:600; }
            .amp-study tr.is-rejected td, .amp-study tr.is-rejected td code, .amp-study tr.is-rejected td.amp-col-score { color:var(--text-muted); font-weight:500; }
            .amp-study tr.is-rejected td.is-bad { color:var(--danger, #ff5630); font-weight:700; }
            .amp-study tr.is-rejected td small { color:var(--danger, #ff5630); }
            .amp-study table.amp-cards { width:auto; min-width:0; }
            .amp-study table.amp-cards td, .amp-study table.amp-cards th { text-align:left; }
            .amp-study ul { margin:0; padding-left:18px; }
            .amp-study li { font-size:11.5px; color:var(--text-muted); line-height:1.45; }
            .amp-study li + li { margin-top:3px; }
            .amp-study-sub { font-size:12px; font-weight:600; color:var(--text-main); margin-top:4px; }
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
                const s = isCurrent && st.opts.settings ? st.opts.settings() : null;
                const drifted = s && !isNaN(s.temperature) && !isNaN(s.num_ctx)
                    && (Math.abs(s.temperature - m.temperature) > 1e-6 || s.num_ctx !== m.num_ctx);
                const reapply = drifted
                    ? `<button type="button" class="amp-btn" onclick="window.AiModelPicker.pick('${containerId}', '${m.name}')">${this._t('ai_models_reapply', 'Remettre ses réglages ({temp} · {ctx})', { temp: this._num(m.temperature), ctx: Math.round(m.num_ctx / 1024) + 'K' })}</button>`
                    : '';
                actions = isCurrent
                    ? `<div class="amp-current">✓ ${this._t('ai_models_in_use', 'En service')}</div>${reapply}`
                    :`<button type="button" class="amp-btn ${m.tier === 'recommended' ? 'primary' : ''}" onclick="window.AiModelPicker.pick('${containerId}', '${m.name}')">${this._t('ai_models_use', 'Utiliser')}</button>`;
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
            <div class="amp-note">${this._t('ai_models_settings_note', 'Choisir un modèle règle aussi sa température ({temp}) et son contexte ({ctx}). Mesuré sur une carte graphique de 24 Go ; sans carte graphique, comptez plusieurs fois plus long.', { temp: this._num(models[0].temperature), ctx: Math.round(models[0].num_ctx / 1024) + 'K' })}</div>
            ${st.opts.showStudy ? this._studyHtml(containerId, tierLabel) : ''}`;
    },

    // « Comment ces modèles ont été choisis » : note, étiquette et carte minimale de chaque modèle testé (ai_model_study.js)
    _studyHtml(containerId, tierLabel) {
        const st = this._state[containerId];
        const study = window.AiModelStudy;
        if (!study) return '';
        const { rows, perCard, precision } = study.rank();
        const labels = Object.assign({
            alternative: this._t('ai_models_tier_alternative', 'Alternative'),
            rejected: this._t('ai_models_tier_rejected', 'Non retenu')
        }, tierLabel);
        const dash = '—';
        const lastCard = study.RULES.cards[study.RULES.cards.length - 1];
        const card = c => c == null ? dash
            : c === lastCard ? this._t('ai_models_study_card_max', '24 Go et plus')
            : this._t('ai_models_study_gb', '{gb} Go', { gb: c });
        const vram = m => m.vram == null ? dash : m.quant
            ? this._t('ai_models_study_gb_quant', '{gb} Go · {q}', { gb: this._num(m.vram, 1), q: m.quant })
            : this._t('ai_models_study_gb', '{gb} Go', { gb: this._num(m.vram, 1) });
        const sub = m => {
            if (m.excluded) {
                const why = this._t(`ai_models_study_why_${m.excluded}`, `${m.excluded} {n}`, { n: study.worst(m[m.excluded]) });
                return `${labels.rejected} · ${why}`;
            }
            if (m.tier) return labels[m.tier] || m.tier;
            return m.seconds >= study.RULES.maxSeconds ? this._t('ai_models_study_too_slow', 'trop lent') : '';
        };
        // Détail des tâches, dans l'ordre de leur poids : la note résume, elle ne cache pas ce qui la compose
        const tasks = Object.keys(study.WEIGHTS).sort((a, b) => study.WEIGHTS[b] - study.WEIGHTS[a]);
        const taskName = { chat: ['ai_models_study_col_chat', 'Conseiller'], real: ['ai_models_study_col_real', 'Vrai relevé'],
            labels: ['ai_models_study_col_labels', 'Libellés'], grouping: ['ai_models_study_col_grouping', 'Enveloppes'] };
        // Passages : le pire et le meilleur, ou un seul chiffre quand ils sont tous égaux
        const range = passes => {
            const a = Math.min(...passes), b = Math.max(...passes);
            return a === b ? this._num(a) : `${this._num(a)}–${this._num(b)}`;
        };
        const taskHead = tasks.map(k => `<th scope="col">${this._t(...taskName[k])}<small>${this._t('ai_models_study_weight', '/{max} · {w} %', { max: study.TOTALS[k], w: Math.round(study.WEIGHTS[k] * 100) })}</small></th>`).join('');
        const tableRows = rows.map(m => {
            const note = sub(m);
            return `
            <tr class="${m.excluded ? 'is-rejected' : m.tier ? 'is-tier' : ''}">
                <td class="amp-col-model"><code>${m.name}</code>${note ? `<small>${note}</small>` : ''}</td>
                <td class="amp-col-score">${this._num(m.note, 1)}</td>
                ${tasks.map(k => `<td class="${m.excluded === k ? 'is-bad' : ''}">${range(m[k])}</td>`).join('')}
                <td>${card(m.card)}</td>
                <td>${vram(m)}</td>
                <td>${this._t('ai_models_study_seconds', '{s} s', { s: this._num(m.seconds) })}</td>
            </tr>`;
        }).join('');
        const cardRows = perCard.map(p => `
            <tr><td>${card(p.card)}</td><td>${p.model ? `<code>${p.model}</code>` : dash}</td></tr>`).join('');
        const preset = (st.catalog.models || [])[0] || {};
        const settingVals = { temp: this._num(preset.temperature ?? 0.2), ctx: Math.round((preset.num_ctx || 32768) / 1024) + 'K',
            question: this._num(precision.question), margin: this._num(precision.note, 1), questions: study.RULES.tieQuestions };
        const items = keys => keys.map(k => `<li>${this._t(k, '', settingVals)}</li>`).filter(li => li !== '<li></li>').join('');
        const rules = items(['ai_models_study_rule_excluded', 'ai_models_study_rule_tiers', 'ai_models_study_rule_tie', 'ai_models_study_legend']);
        const settings = items(['ai_models_study_set_ctx', 'ai_models_study_set_temp', 'ai_models_study_set_think']);
        return `
            <details class="config-collapse amp-study" ${st.studyOpen ? 'open' : ''} ontoggle="window.AiModelPicker._state['${containerId}'].studyOpen = this.open">
                <summary>${this._t('ai_models_study_title', 'Comment ces modèles ont été choisis')}</summary>
                <div class="amp-study-body">
                    <div class="amp-note">${this._t('ai_models_study_method', '')}</div>
                    <div class="amp-study-scroll">
                        <table>
                            <thead><tr>
                                <th scope="col" class="amp-col-model">${this._t('ai_models_study_col_model', 'Modèle')}</th>
                                <th scope="col" class="amp-col-score">${this._t('ai_models_study_col_note', 'Note')}<small>/10</small></th>
                                ${taskHead}
                                <th scope="col">${this._t('ai_models_study_col_card', 'Carte minimale')}</th>
                                <th scope="col">${this._t('ai_models_study_col_vram', 'Mémoire')}</th>
                                <th scope="col">${this._t('ai_models_study_col_time', 'Réponse')}</th>
                            </tr></thead>
                            <tbody>${tableRows}</tbody>
                        </table>
                    </div>
                    <div class="amp-note">${this._t('ai_models_study_precision', '', settingVals)}</div>
                    <ul>${rules}</ul>
                    <div class="amp-study-sub">${this._t('ai_models_study_cards_title', 'Votre carte graphique → modèle conseillé')}</div>
                    <table class="amp-cards">
                        <thead><tr>
                            <th scope="col">${this._t('ai_models_study_cards_col_card', 'Carte graphique')}</th>
                            <th scope="col">${this._t('ai_models_study_cards_col_model', 'Modèle conseillé')}</th>
                        </tr></thead>
                        <tbody>${cardRows}</tbody>
                    </table>
                    <div class="amp-note">${this._t('ai_models_study_cards_note', '')}</div>
                    <div class="amp-study-sub">${this._t('ai_models_study_settings_title', 'Et les réglages conseillés')}</div>
                    <ul>${settings}</ul>
                </div>
            </details>`;
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
        if (st.opts.onPick) st.opts.onPick(m);  // avant de redessiner : les vignettes lisent les réglages affichés
        this._paint(containerId);
        showToast(this._t('ai_models_picked', 'Modèle {name} en service, avec ses réglages.', { name: m.name }), 'success');
    }
};
