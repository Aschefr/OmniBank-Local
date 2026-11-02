// static/js/views/budgets/budgets_suggest.js
// Suggestions d'enveloppes : un seul panneau latéral pour décider. Le moteur intégré répond tout de suite,
// l'IA peut affiner ensuite ; chaque proposition se crée, complète une enveloppe existante ou s'écarte.

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    sg: null,

    _sgT(key, fallback, params) {
        let s = (window.i18n && window.i18n.t(key)) || fallback;
        for (const [k, v] of Object.entries(params || {})) s = s.split(`{${k}}`).join(v);
        return s;
    },

    _sgEsc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    },

    _sgAiEnabled() {
        const cfg = window.app?.config || {};
        return cfg.enable_ai === 'true' || cfg.enable_ai === true || this.aiEnabled === true;
    },

    _sgMonthly(p) {
        const amount = parseFloat(p.amount) || 0;
        return p.period === 'yearly' ? amount / 12 : amount;
    },

    // Proposition du serveur → état local (le brut est gardé pour le recalcul des montants)
    _sgNormalize(raw) {
        return {
            raw,
            name: raw.name || (raw.categories || [])[0] || '',
            targetId: raw.target_budget_id || null,
            targetName: raw.target_budget_name || null,
            currentAmount: raw.current_amount || 0,
            categories: [...(raw.categories || [])],
            catAmounts: { ...(raw.cat_amounts || {}) },
            catDetails: raw.cat_details || {},
            amount: Math.round((raw.suggested_amount || 0) * 100) / 100,
            original: Math.round((raw.suggested_amount || 0) * 100) / 100,
            period: raw.suggested_period || raw.period || 'monthly',
            exceptional: !!raw.is_exceptional,
            reason: raw.justification || '',
            decisionId: raw.decision_id || null,
            selected: true,
            edited: false,
        };
    },

    // ── Ouverture et fermeture ──

    async openSuggestions(preset = null) {
        const menu = document.getElementById('bvToolsMenu');
        if (menu) menu.setAttribute('hidden', '');
        this._sgOpener = document.activeElement;
        this._sgMount();
        if (preset) {
            this.sg = { source: 'autopilot', windowMonths: 3, sensitivity: 2, proposals: preset, unclassified: [], meta: null, engine: 'deterministic' };
            this._sgRender();
            return;
        }
        // Un résultat de l'IA déjà obtenu est conservé : il a coûté plusieurs secondes
        if (this.sg && this.sg.source === 'analysis' && this.sg.engine === 'ai' && this.sg.proposals.length) {
            this._sgRender();
            return;
        }
        this.sg = { source: 'analysis', windowMonths: 3, sensitivity: 2, proposals: [], unclassified: [], meta: null, engine: 'deterministic' };
        await this._sgRun('deterministic');
    },

    _sgMount() {
        if (document.getElementById('sgPanel')) return;
        const t = (k, fb) => this._sgT(k, fb);
        const overlay = document.createElement('div');
        overlay.id = 'sgOverlay';
        overlay.className = 'sg-overlay';
        overlay.addEventListener('click', () => this.closeSuggestions());
        const panel = document.createElement('aside');
        panel.id = 'sgPanel';
        panel.className = 'sg-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-modal', 'true');
        panel.setAttribute('aria-labelledby', 'sgTitle');
        panel.innerHTML = `
            <header class="sg-head">
                <div class="sg-head-text">
                    <h3 id="sgTitle">${t('sg_title', "Suggestions d'enveloppes")}</h3>
                    <div class="sg-sub" id="sgSub"></div>
                </div>
                <button type="button" class="bv-icon-btn" data-sg-close aria-label="${t('btn_close', 'Fermer')}">${this._bvIcon('close', 18)}</button>
            </header>
            <div class="sg-body" id="sgBody"></div>
            <footer class="sg-foot" id="sgFoot"></footer>`;
        panel.addEventListener('click', (e) => { if (e.target.closest('[data-sg-close]')) this.closeSuggestions(); });
        this._sgKey = (e) => { if (e.key === 'Escape') this.closeSuggestions(); };
        document.addEventListener('keydown', this._sgKey);
        document.body.append(overlay, panel);
        requestAnimationFrame(() => {
            overlay.classList.add('is-open');
            panel.classList.add('is-open');
            panel.querySelector('[data-sg-close]')?.focus();
        });
    },

    closeSuggestions() {
        this._sgCancelAi(true);
        document.getElementById('sgOverlay')?.remove();
        document.getElementById('sgPanel')?.remove();
        if (this._sgKey) document.removeEventListener('keydown', this._sgKey);
        this._sgKey = null;
        if (this._sgOpener && document.contains(this._sgOpener)) this._sgOpener.focus();
        else document.getElementById('bvToolsBtn')?.focus();
    },

    // Changement de profil : rien ne doit survivre d'un profil à l'autre
    resetAiState() {
        this.closeSuggestions();
        this.sg = null;
    },

    // ── Calcul des propositions ──

    async _sgRun(engine) {
        const sg = this.sg;
        if (!sg) return;
        sg.loading = engine;
        sg.error = null;
        sg.notice = null;
        sg.aiStart = Date.now();
        this._sgRender();
        if (engine === 'ai') {
            this._sgTimer = setInterval(() => {
                const el = document.getElementById('sgElapsed');
                if (el) el.textContent = this._sgT('sg_ai_elapsed', '{s} s', { s: Math.round((Date.now() - sg.aiStart) / 1000) });
            }, 1000);
        }
        this._sgAbort = new AbortController();
        const lang = (window.i18n?.currentLang || window.i18n?.lang || 'fr') === 'en' ? 'en' : 'fr';
        try {
            const res = await API.post('/api/budgets/ai_suggest', {
                window_months: sg.windowMonths, lang, outlier_sensitivity: sg.sensitivity, engine,
            }, { signal: this._sgAbort.signal });
            if (this.sg !== sg) return;
            sg.meta = res;
            sg.engine = res.engine || engine;
            sg.windowMonths = res.effective_window_months || sg.windowMonths;
            sg.proposals = (res.proposals || []).map(p => this._sgNormalize(p));
            sg.unclassified = res.unclassified_categories || [];
            if (engine === 'ai' && res.is_fallback) {
                sg.engine = 'deterministic';
                sg.notice = this._sgT('sg_ai_fallback', "L'IA n'a pas répondu de façon exploitable : les propositions viennent du moteur intégré.");
            }
        } catch (e) {
            if (this.sg !== sg || e.name === 'AbortError') return;
            const msg = (typeof e.detail === 'string' && e.detail) || e.message || '';
            if (/déjà suivies|already tracked|déjà couvertes/i.test(msg)) {
                sg.proposals = [];
                sg.unclassified = [];
                sg.empty = msg;
            } else {
                sg.error = msg || this._sgT('sg_error', 'Le calcul des propositions a échoué.');
            }
        } finally {
            if (this._sgTimer) clearInterval(this._sgTimer);
            this._sgTimer = null;
            this._sgAbort = null;
            if (this.sg === sg) {
                sg.loading = null;
                this._sgRender();
            }
        }
    },

    refineSuggestionsWithAi() {
        if (this.sg && !this.sg.loading) this._sgRun('ai');
    },

    _sgCancelAi(silent = false) {
        if (!this.sg || this.sg.loading !== 'ai') return;
        try { this._sgAbort?.abort(); } catch (e) {}
        API.post('/api/budgets/ai_suggest/cancel').catch(() => {});
        if (this._sgTimer) clearInterval(this._sgTimer);
        this._sgTimer = null;
        this.sg.loading = null;
        if (!silent) this._sgRender();
    },

    cancelSuggestionsAi() {
        this._sgCancelAi(false);
    },

    setSuggestionWindow(months) {
        if (!this.sg || this.sg.loading) return;
        this.sg.windowMonths = parseInt(months, 10) || 3;
        this._sgRun(this.sg.engine === 'ai' ? 'ai' : 'deterministic');
    },

    // Marge des montants : même calcul côté serveur, sur les propositions telles qu'elles sont
    async setSuggestionMargin(level) {
        const sg = this.sg;
        if (!sg || sg.loading || !sg.proposals.length) return;
        sg.sensitivity = level;
        sg.loading = 'amounts';
        this._sgRender();
        try {
            const res = await API.post('/api/budgets/ai_suggest/recalculate', {
                window_months: sg.windowMonths,
                outlier_sensitivity: level,
                existing_proposals: sg.proposals.map(p => ({ ...p.raw, categories: p.categories, cat_amounts: p.catAmounts, suggested_period: p.period })),
                unclassified_categories: sg.unclassified,
            });
            (res.proposals || []).forEach((raw, i) => {
                const p = sg.proposals[i];
                if (!p) return;
                p.raw = { ...p.raw, ...raw };
                p.catAmounts = { ...(raw.cat_amounts || p.catAmounts) };
                p.original = Math.round((raw.suggested_amount || 0) * 100) / 100;
                if (!p.edited) p.amount = p.original;
            });
        } catch (e) {
            sg.error = (typeof e.detail === 'string' && e.detail) || e.message || this._sgT('sg_error', 'Le calcul des propositions a échoué.');
        } finally {
            sg.loading = null;
            this._sgRender();
        }
    },

    resetSuggestionAmounts() {
        if (!this.sg) return;
        this.sg.proposals.forEach(p => { p.amount = p.original; p.edited = false; });
        this._sgRender();
    },

    // ── Modifications d'une proposition ──

    toggleSuggestion(i, on) {
        const p = this.sg?.proposals[i];
        if (!p) return;
        p.selected = !!on;
        this._sgRender();
    },

    renameSuggestion(i, value) {
        const p = this.sg?.proposals[i];
        if (p && value.trim()) p.name = value.trim();
    },

    setSuggestionAmount(i, value) {
        const p = this.sg?.proposals[i];
        if (!p) return;
        const v = Math.max(0, parseFloat(String(value).replace(',', '.')) || 0);
        p.amount = Math.round(v * 100) / 100;
        p.edited = p.amount !== p.original;
        this._sgRender();
    },

    removeSuggestionCategory(i, cat) {
        const sg = this.sg;
        const p = sg?.proposals[i];
        if (!p) return;
        const share = parseFloat(p.catAmounts[cat]) || 0;
        p.categories = p.categories.filter(c => c !== cat);
        p.amount = Math.max(0, Math.round((p.amount - share) * 100) / 100);
        p.original = Math.max(0, Math.round((p.original - share) * 100) / 100);
        delete p.catAmounts[cat];
        const d = p.catDetails[cat] || {};
        sg.unclassified.push({
            name: cat,
            avg: p.period === 'yearly' ? share / 12 : share,
            total_year: p.period === 'yearly' ? share : share * 12,
            suggested_period: p.period,
            top_descs: d.top_descs || [],
        });
        if (!p.categories.length) sg.proposals.splice(i, 1);
        this._sgRender();
    },

    assignSuggestionCategory(cat, i) {
        const sg = this.sg;
        const p = sg?.proposals[parseInt(i, 10)];
        const idx = sg?.unclassified.findIndex(u => (u.name || u) === cat);
        if (!p || idx < 0) return;
        const u = sg.unclassified[idx];
        const yearly = (u.total_year || 0) || (u.avg || 0) * 12;
        const monthly = u.suggested_period === 'yearly' ? yearly / 12 : (u.avg || 0);
        const share = Math.round((p.period === 'yearly' ? yearly : monthly) * 100) / 100;
        p.categories.push(cat);
        p.catAmounts[cat] = share;
        p.catDetails[cat] = { top_descs: u.top_descs || [] };
        p.amount = Math.round((p.amount + share) * 100) / 100;
        p.original = Math.round((p.original + share) * 100) / 100;
        sg.unclassified.splice(idx, 1);
        this._sgRender();
    },

    // ── Rendu ──

    _sgRender() {
        const sg = this.sg;
        const body = document.getElementById('sgBody');
        const foot = document.getElementById('sgFoot');
        const sub = document.getElementById('sgSub');
        if (!sg || !body || !foot) return;
        const t = (k, fb, params) => this._sgT(k, fb, params);
        const isOrg = window.app?.config?.enable_org_mode === 'true';
        const busy = !!sg.loading;

        // Sous-titre : période d'analyse (le moteur répond selon l'historique choisi)
        if (sub) {
            sub.innerHTML = sg.source === 'autopilot'
                ? t('sg_sub_autopilot', "Proposées par l'Auto-Pilote d'après vos dernières dépenses")
                : `<label class="sg-window">${t('sg_sub_window', "D'après vos dépenses des")}
                    <select onchange="window.BudgetsView.setSuggestionWindow(this.value)" ${busy ? 'disabled' : ''}>
                        ${[3, 6, 12].map(m => `<option value="${m}" ${sg.windowMonths === m ? 'selected' : ''}>${t('sg_months', '{n} derniers mois', { n: m })}</option>`).join('')}
                    </select></label>`;
        }

        let html = '';

        // État : calcul, IA en cours, repli, erreur
        if (sg.loading === 'deterministic' || sg.loading === 'amounts') {
            html += `<p class="sg-status" role="status"><span class="sg-spinner" aria-hidden="true"></span>${t('sg_loading', 'Calcul des propositions…')}</p>`;
        } else if (sg.loading === 'ai') {
            html += `<div class="sg-status sg-status--ai" role="status">
                <span class="sg-spinner" aria-hidden="true"></span>
                <span>${t('sg_ai_running', "L'IA regroupe vos catégories…")} <span id="sgElapsed" class="sg-elapsed">${t('sg_ai_elapsed', '{s} s', { s: Math.round((Date.now() - sg.aiStart) / 1000) })}</span></span>
                <button type="button" class="btn btn-secondary bv-btn-compact" onclick="window.BudgetsView.cancelSuggestionsAi()">${t('btn_cancel', 'Annuler')}</button>
            </div>`;
        }
        if (sg.notice) html += `<p class="sg-note sg-note--warn" role="status">${this._sgEsc(sg.notice)}</p>`;
        if (sg.error) html += `<p class="sg-note sg-note--error" role="alert">${this._sgEsc(sg.error)}</p>`;

        const props = sg.proposals;
        const selected = props.filter(p => p.selected && p.categories.length);

        if (!busy && !props.length && !sg.unclassified.length) {
            html += `<div class="sg-empty">
                <p>${this._sgEsc(sg.empty || (sg.error ? '' : t('sg_empty', 'Toutes vos dépenses libres sont déjà suivies par vos enveloppes.')))}</p>
                ${sg.error ? `<button type="button" class="btn btn-secondary bv-btn-compact" onclick="window.BudgetsView.setSuggestionWindow(${sg.windowMonths})">${t('sg_retry', 'Réessayer')}</button>` : ''}
            </div>`;
        }

        if (props.length) {
            // Synthèse en une ligne : ce que coûtent les propositions retenues, ce qu'il reste
            const monthly = selected.reduce((s, p) => s + this._sgMonthly(p), 0);
            const ref = sg.meta?.regular_salary || 0;
            const engaged = sg.meta?.already_engaged_monthly || 0;
            let rest = '';
            if (ref > 0) {
                const left = ref - engaged - monthly;
                rest = left >= 0
                    ? t(isOrg ? 'sg_left_org' : 'sg_left', isOrg ? 'il reste {amount} sur vos recettes' : 'il reste {amount} sur votre paie', { amount: formatCurrency(left) })
                    : t(isOrg ? 'sg_over_org' : 'sg_over', isOrg ? 'dépasse vos recettes de {amount}' : 'dépasse votre paie de {amount}', { amount: formatCurrency(-left) });
                rest = `<span class="privacy-blur${left >= 0 ? '' : ' sg-over'}">${rest}</span>`;
            }
            const count = selected.length > 1 ? t('sg_count_many', '{n} propositions retenues', { n: selected.length }) : t('sg_count_one', '{n} proposition retenue', { n: selected.length });
            html += `<p class="sg-summary"><strong>${count}</strong> · <span class="privacy-blur">${t('sg_per_month', '{amount} par mois', { amount: formatCurrency(monthly) })}</span>${rest ? ` · ${rest}` : ''}</p>`;

            // Actions secondaires : l'IA en option, la marge des montants repliée
            const marginLevels = [[1, t('sg_margin_tight', 'Au plus juste')], [2, t('sg_margin_usual', 'Habituel')], [4, t('sg_margin_wide', 'Avec marge')]];
            const edited = props.some(p => p.edited);
            html += `<div class="sg-tools">
                ${this._sgAiEnabled() && sg.source === 'analysis' && sg.engine !== 'ai' ? `<button type="button" class="btn btn-secondary bv-btn-compact" onclick="window.BudgetsView.refineSuggestionsWithAi()" ${busy ? 'disabled' : ''}>${this._bvIcon('bulb', 14)}<span>${t('sg_refine_ai', 'Affiner avec l\'IA')}</span></button>` : ''}
                ${sg.source === 'analysis' ? `<details class="sg-margin" ${this._sgMarginOpen ? 'open' : ''} ontoggle="window.BudgetsView._sgMarginOpen = this.open">
                    <summary>${t('sg_adjust', 'Ajuster les montants')}${this._bvIcon('chevronDown', 14)}</summary>
                    <div class="sg-margin-body">
                        <div class="sg-seg" role="radiogroup" aria-label="${t('sg_adjust', 'Ajuster les montants')}">
                            ${marginLevels.map(([lvl, label]) => `<button type="button" role="radio" aria-checked="${sg.sensitivity === lvl}" class="${sg.sensitivity === lvl ? 'is-on' : ''}" onclick="window.BudgetsView.setSuggestionMargin(${lvl})" ${busy ? 'disabled' : ''}>${label}</button>`).join('')}
                        </div>
                        <p class="sg-hint">${t('sg_margin_hint', 'Au plus juste : la moyenne de vos dépenses. Avec marge : de quoi absorber les mois plus chargés.')}</p>
                        ${edited ? `<button type="button" class="sg-link" onclick="window.BudgetsView.resetSuggestionAmounts()">${t('sg_reset_amounts', 'Revenir aux montants proposés')}</button>` : ''}
                    </div>
                </details>` : ''}
            </div>`;

            const row = (p, i) => {
                const unit = p.period === 'yearly' ? t('sg_unit_year', '€/an') : t('sg_unit_month', '€/mois');
                const cats = p.categories.map(c => {
                    const share = parseFloat(p.catAmounts[c]) || 0;
                    return `<li class="sg-cat"><span>${this._sgEsc(c)}</span><span class="sg-cat-amt privacy-blur">${formatCurrency(share)}</span>
                        <button type="button" class="sg-cat-x" aria-label="${this._sgEsc(t('sg_remove_cat', 'Retirer {cat}', { cat: c }))}" onclick="window.BudgetsView.removeSuggestionCategory(${i}, ${this._sgEsc(JSON.stringify(c))})">${this._bvIcon('close', 12)}</button></li>`;
                }).join('');
                const examples = [...new Set(p.categories.flatMap(c => (p.catDetails[c]?.top_descs || [])))].slice(0, 3);
                const aiReason = p.reason && !/^(Basé sur|Based on|Même type|Same kind|Dépense ponctuelle|One-off)/.test(p.reason) ? p.reason : '';
                const hint = aiReason || (examples.length ? t('sg_examples', 'Ex. : {list}', { list: examples.join(', ') }) : '');
                let meta;
                if (p.targetId) {
                    meta = t('sg_meta_addition', 'Enveloppe existante · plafond {from} → {to}', {
                        from: formatCurrency(p.currentAmount), to: formatCurrency(p.currentAmount + (parseFloat(p.amount) || 0)) });
                } else {
                    meta = p.period === 'yearly'
                        ? t('sg_meta_yearly', 'Enveloppe annuelle · environ {amount} par mois', { amount: formatCurrency(this._sgMonthly(p)) })
                        : t('sg_meta_monthly', 'Enveloppe mensuelle');
                }
                if (p.exceptional) meta += ` · ${t('sg_meta_oneoff', 'dépenses ponctuelles')}`;
                const label = p.targetId ? this._sgEsc(p.targetName || p.name) : this._sgEsc(p.name);
                return `
                <li class="sg-item ${p.selected ? '' : 'is-off'}">
                    <input type="checkbox" class="sg-check" ${p.selected ? 'checked' : ''} aria-label="${this._sgEsc(t('sg_keep', 'Retenir {name}', { name: p.targetName || p.name }))}"
                           onchange="window.BudgetsView.toggleSuggestion(${i}, this.checked)">
                    <div class="sg-main">
                        <div class="sg-line">
                            ${p.targetId
                                ? `<span class="sg-name">${label}</span>`
                                : `<input type="text" class="sg-name-input" value="${label}" maxlength="60" aria-label="${t('sg_name', "Nom de l'enveloppe")}" onchange="window.BudgetsView.renameSuggestion(${i}, this.value)">`}
                            <label class="sg-amount privacy-blur">
                                <span class="sr-only">${p.targetId ? t('sg_amount_added', 'Montant ajouté') : t('sg_amount', 'Plafond')}</span>
                                ${p.targetId ? '<span aria-hidden="true">+</span>' : ''}
                                <input type="number" inputmode="decimal" min="0" step="1" value="${p.amount}" onchange="window.BudgetsView.setSuggestionAmount(${i}, this.value)">
                                <span class="sg-unit">${unit}</span>
                            </label>
                        </div>
                        <div class="sg-meta privacy-blur">${meta}</div>
                        <ul class="sg-cats">${cats}</ul>
                        ${hint ? `<p class="sg-hint">${this._sgEsc(hint)}</p>` : ''}
                    </div>
                </li>`;
            };
            const indexed = props.map((p, i) => [p, i]);
            const additions = indexed.filter(([p]) => p.targetId);
            const creations = indexed.filter(([p]) => !p.targetId);
            if (additions.length) {
                html += `<section class="sg-group"><h4>${t('sg_group_additions', 'À ajouter à vos enveloppes')}</h4>
                    <ul class="sg-list">${additions.map(([p, i]) => row(p, i)).join('')}</ul></section>`;
            }
            if (creations.length) {
                html += `<section class="sg-group"><h4>${t('sg_group_creations', 'Nouvelles enveloppes')}</h4>
                    <ul class="sg-list">${creations.map(([p, i]) => row(p, i)).join('')}</ul></section>`;
            }
        }

        // Catégories sans proposition : on peut les rattacher à une proposition
        if (sg.unclassified.length) {
            const options = props.map((p, i) => `<option value="${i}">${this._sgEsc(p.targetName || p.name)}</option>`).join('');
            html += `<section class="sg-group"><h4>${t('sg_group_unclassified', 'Sans proposition')}</h4>
                <p class="sg-hint">${t('sg_unclassified_hint', 'Catégories sans enveloppe proposée, souvent des dépenses ponctuelles. Vous pouvez les rattacher à une proposition.')}</p>
                <ul class="sg-loose">${sg.unclassified.map(u => {
                    const name = u.name || u;
                    return `<li><span>${this._sgEsc(name)}</span>${props.length ? `<select aria-label="${this._sgEsc(t('sg_assign', 'Rattacher {cat} à', { cat: name }))}" onchange="if(this.value!==''){window.BudgetsView.assignSuggestionCategory(${this._sgEsc(JSON.stringify(name))}, this.value)}">
                        <option value="">${t('sg_assign_to', 'Rattacher à…')}</option>${options}</select>` : ''}</li>`;
                }).join('')}</ul></section>`;
        }

        const fixed = sg.meta?.fixed_categories || [];
        if (fixed.length) {
            const names = fixed.slice(0, 4).map(c => c.name).join(', ') + (fixed.length > 4 ? t('sg_and_more', ' et {n} autres', { n: fixed.length - 4 }) : '');
            html += `<p class="sg-footnote">${this._sgEsc(t('sg_fixed_note', 'Charges prévues sans enveloppe, déjà suivies par vos récurrences : {names}.', { names }))}</p>`;
        }

        body.innerHTML = html;

        // Pied : une seule action principale, nommée par ce qu'elle fait
        const nCreate = selected.filter(p => !p.targetId).length;
        const nAdd = selected.filter(p => p.targetId).length;
        let primary;
        if (nCreate && nAdd) primary = t('sg_apply_both', 'Créer {c} et compléter {a}', { c: nCreate, a: nAdd });
        else if (nAdd) primary = nAdd > 1 ? t('sg_apply_add_many', 'Compléter {n} enveloppes', { n: nAdd }) : t('sg_apply_add_one', "Compléter l'enveloppe");
        else primary = nCreate > 1 ? t('sg_apply_create_many', 'Créer {n} enveloppes', { n: nCreate }) : t('sg_apply_create_one', "Créer l'enveloppe");
        foot.innerHTML = `
            <button type="button" class="btn btn-secondary" data-sg-close>${t('btn_cancel', 'Annuler')}</button>
            <button type="button" class="btn btn-primary" id="sgApply" onclick="window.BudgetsView.applySuggestions()" ${busy || !selected.length ? 'disabled' : ''}>${primary}</button>`;
    },

    // ── Application ──

    async applySuggestions() {
        const sg = this.sg;
        if (!sg || sg.loading) return;
        const chosen = sg.proposals.filter(p => p.selected && p.categories.length);
        if (!chosen.length) return;
        const btn = document.getElementById('sgApply');
        if (btn) btn.disabled = true;
        let created = 0, completed = 0;
        const failed = [];
        for (const p of chosen) {
            try {
                if (p.targetId) {
                    const b = (this.budgets || []).find(x => x.id === p.targetId);
                    if (!b) throw new Error(this._sgT('bv_ai_target_missing', "L'enveloppe visée n'existe plus."));
                    const categories = [...new Set([...(b.categories || []), ...p.categories])];
                    const amount = Math.round(((b.monthly_amount || 0) + (parseFloat(p.amount) || 0)) * 100) / 100;
                    await API.put(`/api/budgets/${b.id}`, { categories, monthly_amount: amount });
                    completed++;
                } else if (p.decisionId && !p.edited && p.categories.join('|') === (p.raw.categories || []).join('|') && p.name === p.raw.name) {
                    await API.post(`/api/budgets/autopilot/suggestions/${p.decisionId}/approve`);
                    created++;
                } else {
                    await API.post('/api/budgets/', {
                        name: p.name, monthly_amount: parseFloat(p.amount) || 0, period: p.period,
                        is_project: false, categories: p.categories,
                    });
                    if (p.decisionId) API.post(`/api/budgets/autopilot/suggestions/${p.decisionId}/dismiss`).catch(() => {});
                    created++;
                }
                p.applied = true;
            } catch (e) {
                failed.push(`${p.targetName || p.name} : ${(typeof e.detail === 'string' && e.detail) || e.message || ''}`);
            }
        }
        sg.proposals = sg.proposals.filter(p => !p.applied);
        await this.loadBudgets();
        if (this.loadAutopilotSuggestions) await this.loadAutopilotSuggestions();
        await this.loadStatus();
        window.app?.refreshSidebar();

        const parts = [];
        if (created) parts.push(created > 1 ? this._sgT('sg_done_created_many', '{n} enveloppes créées', { n: created }) : this._sgT('sg_done_created_one', '1 enveloppe créée'));
        if (completed) parts.push(completed > 1 ? this._sgT('sg_done_completed_many', '{n} enveloppes complétées', { n: completed }) : this._sgT('sg_done_completed_one', '1 enveloppe complétée'));
        if (failed.length) {
            sg.error = this._sgT('sg_apply_failed', 'Certaines propositions n\'ont pas pu être appliquées : {list}', { list: failed.join(' ; ') });
            this._sgRender();
            if (parts.length) showToast(parts.join(', '), 'success');
            return;
        }
        if (parts.length) showToast(parts.join(', '), 'success');
        this.sg = null;
        this.closeSuggestions();
    },
});
