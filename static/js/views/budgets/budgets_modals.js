// static/js/views/budgets/budgets_modals.js
// Enveloppes Budgétaires v2 — Modals, Forms & Allocation Management

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    renderAccountCheckboxes(selected = []) {
        const container = document.getElementById('budgetAccountCheckboxes');
        if (!container || !this.accounts) return;

        container.innerHTML = this.accounts.filter(a => !a.is_closed).map(a => {
            const isSelected = selected.includes(a.id);
            const accColor = a.color || 'var(--accent)';
            const borderColor = isSelected ? accColor : 'var(--border-color)';
            return `
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;background:var(--bg-surface);padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid ${borderColor};transition:all 0.2s;">
                    <input type="checkbox" name="budgetAccount" value="${a.id}" data-color="${accColor}" ${isSelected ? 'checked' : ''} onchange="window.BudgetsView.onAccountChange(this)">
                    <span style="width:10px;height:10px;border-radius:50%;background:${accColor};flex-shrink:0;"></span>
                    <div style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
                        <span style="font-weight:${isSelected ? '600' : 'normal'};color:${isSelected ? accColor : 'inherit'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${a.name}">${a.name}</span>
                    </div>
                </label>
            `;
        }).join('');
    },

    // Catégories qu'une autre enveloppe ouverte suit déjà sur une période (et des comptes) qui recoupent
    // ceux du formulaire : même règle que le serveur, qui refuserait l'enregistrement (double comptage)
    _catConflicts() {
        const isOrg = window.app?.config?.enable_org_mode === 'true';
        return this._conflictsFor({
            id: parseInt(document.getElementById('budgetEditId')?.value || 0),
            period: document.getElementById('newBudgetPeriod')?.value || 'monthly',
            start: document.getElementById('newBudgetStartDate')?.value,
            end: document.getElementById('newBudgetEndDate')?.value,
            accounts: isOrg ? this.getSelectedAccounts() : [],
        });
    },

    _conflictsFor({ id = 0, period, start, end, accounts = [] }) {
        const win = (p, s, e) => (p === 'custom' && s && e) ? [s, e] : ['0000-01-01', '9999-12-31'];
        const [s1, e1] = win(period, start, end);
        const acc1 = new Set(accounts);
        const map = {};
        for (const b of (this.budgets || [])) {
            if (b.id === id || b.is_closed || b.is_project || (b.envelope_type || 'spending') !== 'spending') continue;
            const [s2, e2] = win(b.period, b.start_date, b.end_date);
            if (s1 > e2 || s2 > e1) continue;
            const acc2 = new Set(b.account_ids || []);
            if (acc1.size && acc2.size && ![...acc1].some(a => acc2.has(a))) continue;
            for (const c of (b.categories || [])) (map[c] = map[c] || []).push(b.name);
        }
        return map;
    },

    renderCatCheckboxes(selected = []) {
        const container = document.getElementById('budgetCatCheckboxes');
        if (!container) return;
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const period = document.getElementById('newBudgetPeriod')?.value || 'monthly';
        const taken = this._catConflicts();

        // Dépenses d'abord ; revenus, neutres et autres repliés tant qu'on ne les cherche pas ;
        // les catégories déjà suivies ailleurs sont rassemblées à part, en fin de liste
        const order = ['expense_var', 'expense_fixed', 'income', 'neutral', 'other'];
        const isSpendType = (type) => type === 'expense_var' || type === 'expense_fixed';
        const term = document.getElementById('budgetCatSearch')?.value || '';
        const visible = (this.categories || []).filter(c => !term || window.permissiveMatch(c.name, term));
        const groups = {};
        const takenList = [];
        for (const c of visible) {
            if (taken[c.name]) { takenList.push(c); continue; }
            const key = order.includes(c.type) ? c.type : 'other';
            (groups[key] = groups[key] || []).push(c);
        }
        const showOthers = this._showOtherCatTypes || !!term
            || selected.some(n => { const c = (this.categories || []).find(x => x.name === n); return c && !isSpendType(c.type); });
        const avgFor = (name) => {
            const a = this.catAverages?.[name]?.yearly_average || 0;
            return period === 'yearly' ? a * 12 : a;
        };
        const unit = period === 'yearly' ? t('bv_form_per_year', '/an') : t('bv_form_per_month', '/mois');
        const row = (c) => {
            const on = selected.includes(c.name);
            const owners = taken[c.name];
            const avg = avgFor(c.name);
            // Déjà suivie ailleurs : on ne peut que la retirer (si elle est cochée), pas l'ajouter
            return `
                <label class="bv-cat-opt${on ? ' is-checked' : ''}${owners ? ' is-taken' : ''}"${owners ? ` title="${esc(t('bv_form_cat_taken_hint', "Une dépense ne compte que dans une seule enveloppe : retirez d'abord cette catégorie de l'autre enveloppe."))}"` : ''}>
                    <input type="checkbox" name="budgetCat" value="${esc(c.name)}" ${on ? 'checked' : ''} ${owners && !on ? 'disabled' : ''} onchange="window.BudgetsView.toggleCategorySelection(this)">
                    <span class="bv-cat-text">
                        <span class="bv-cat-name">${esc(c.name)}</span>
                        ${owners ? `<span class="bv-cat-elsewhere">${esc(t('bv_form_cat_in', 'dans {names}').split('{names}').join(owners.join(', ')))}</span>` : ''}
                    </span>
                    ${avg > 0 ? `<span class="bv-cat-avg privacy-blur">~${formatCurrency(avg)}${unit}</span>` : ''}
                </label>`;
        };

        let html = '';
        let hidden = 0;
        for (const key of order) {
            const cats = groups[key] || [];
            if (!cats.length) continue;
            if (!isSpendType(key) && !showOthers) { hidden += cats.length; continue; }
            const title = key === 'other' ? t('budget_cat_other', 'Autres') : window.app.getTypeLabel(key);
            html += `
                <div class="bv-cat-group">
                    <div class="bv-cat-group-title">${esc(title)}</div>
                    <div class="bv-cat-grid">${cats.map(row).join('')}</div>
                </div>`;
        }
        if (hidden) {
            html += `<button type="button" class="bv-link-btn" onclick="window.BudgetsView._showOtherCatTypes = true; window.BudgetsView.renderCatCheckboxes(window.BudgetsView.selectedCategories)">${t('bv_form_cat_more', 'Afficher les revenus et autres catégories ({count})').split('{count}').join(hidden)}</button>`;
        }
        if (takenList.length) {
            // Regroupées par enveloppe qui les suit, pour les repérer d'un coup d'œil
            takenList.sort((a, b) => taken[a.name][0].localeCompare(taken[b.name][0]) || a.name.localeCompare(b.name));
            html += `
                <div class="bv-cat-group bv-cat-group--taken">
                    <div class="bv-cat-group-title">${esc(t('bv_form_cat_taken', 'Déjà suivies par une autre enveloppe'))} <span class="bv-fold-count">${takenList.length}</span></div>
                    <div class="bv-cat-grid">${takenList.map(row).join('')}</div>
                </div>`;
        }
        container.innerHTML = html || `<p class="bv-field-hint">${t('bv_form_cat_no_match', 'Aucune catégorie ne correspond.')}</p>`;
        this.renderSelectedCats();
    },

    // Catégories choisies en tête du sélecteur, avec leur dépense habituelle pour fixer le plafond
    renderSelectedCats() {
        const box = document.getElementById('budgetCatSelected');
        if (!box) return;
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const sel = this.selectedCategories || [];
        this._schedulePreview();
        if (!sel.length) {
            box.innerHTML = `<p class="bv-field-hint">${t('bv_form_cat_required', "Choisissez au moins une catégorie : sans catégorie, l'enveloppe ne suit aucune dépense.")}</p>`;
            return;
        }
        const taken = this._catConflicts();
        const period = document.getElementById('newBudgetPeriod')?.value || 'monthly';
        // Une catégorie de recettes (remboursement, aide) vient en déduction des dépenses
        const isIncomeCat = (n) => (this.categories || []).find(c => c.name === n)?.type === 'income';
        const monthly = sel.reduce((s, n) => s + (isIncomeCat(n) ? -1 : 1) * (this.catAverages?.[n]?.yearly_average || 0), 0);
        const avg = period === 'yearly' ? monthly * 12 : monthly;
        const canUse = avg > 0 && (period === 'monthly' || period === 'yearly');
        const avgText = t(period === 'yearly' ? 'bv_form_cat_avg_year' : 'bv_form_cat_avg_month',
            period === 'yearly' ? 'Dépense habituelle : ~{amount} par an' : 'Dépense habituelle : ~{amount} par mois').split('{amount}').join(formatCurrency(avg));
        box.innerHTML = `
            <div class="bv-cat-chips">${sel.map(n => `
                <button type="button" class="bv-cat-chip${taken[n] ? ' is-taken' : ''}" data-cat="${esc(n)}" onclick="window.BudgetsView.removeSelectedCat(this.dataset.cat)"
                        title="${taken[n] ? esc(t('bv_form_cat_in', 'dans {names}').split('{names}').join(taken[n].join(', '))) : ''}"
                        aria-label="${esc(t('bv_form_cat_remove', 'Retirer {name}').split('{name}').join(n))}">${esc(n)}${this._bvIcon('close', 12)}</button>`).join('')}
            </div>
            ${avg > 0 ? `<p class="bv-cat-sum"><span class="privacy-blur" title="${esc(t('bv_form_cat_avg_hint', 'Moyenne des 12 derniers mois'))}">${avgText}</span>${canUse
                ? `<button type="button" class="bv-link-btn" onclick="window.BudgetsView.useCatAverage(${Math.round(avg * 100) / 100})">${t('bv_form_use_avg', 'Reprendre comme plafond')}</button>` : ''}</p>` : ''}`;
    },

    // Libellé de la période dont on montre les opérations (détail et aperçu du formulaire)
    _envPeriodLabel(period, { isProject = false, startDate = null, endDate = null, year = null } = {}) {
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const lang = (window.i18n?.currentLang || window.i18n?.lang || 'fr') === 'en' ? 'en-US' : 'fr-FR';
        const fmtDay = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short' }) : '';
        const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '?';
        const range = (s, e) => t('bv_dated_range', 'Du {start} au {end}').split('{start}').join(fmtDate(s)).split('{end}').join(fmtDate(e));
        if (isProject) return t('bv_form_type_project', 'Projet');
        if (!period || period === 'monthly') {
            const p = this.periodInfo;
            if (this.customPeriod?.enabled) return range(this.customPeriod.start, this.customPeriod.end);
            if (p?.kind === 'cycle') return t('bv_period_cycle', 'Cycle du {start} au {end}').split('{start}').join(fmtDay(p.start)).split('{end}').join(fmtDay(p.end));
            return p ? new Date(p.start + 'T00:00:00').toLocaleDateString(lang, { month: 'long', year: 'numeric' }) : '';
        }
        if (period === 'yearly') return t('bv_detail_year', 'Année {year}').split('{year}').join(year || new Date().getFullYear());
        if (period === 'custom') return range(startDate, endDate);
        return t('bv_detail_all_time', 'Toutes périodes');
    },

    // Ligne d'opération (détail de l'enveloppe et aperçu du formulaire)
    _opRowHtml(it) {
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const lang = (window.i18n?.currentLang || window.i18n?.lang || 'fr') === 'en' ? 'en-US' : 'fr-FR';
        const d = new Date(it.date + 'T00:00:00');
        const dateText = d.toLocaleDateString(lang, d.getFullYear() === new Date().getFullYear()
            ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
        const planned = it.date > new Date().toISOString().slice(0, 10);
        return `
                <li class="bv-op${planned ? ' bv-op--planned' : ''}${it.added ? ' bv-op--added' : ''}">
                    <span class="bv-op-date">${dateText}</span>
                    <span class="bv-op-desc">
                        <span class="bv-op-label">${it.label}</span>
                        ${planned ? `<span class="bv-op-tag">${t('bv_op_planned', 'prévue')}</span>` : ''}
                    </span>
                    ${it.category ? `<span class="bv-op-cat">${esc(it.category)}</span>` : '<span></span>'}
                    <span class="bv-op-amount privacy-blur${it.isIncome ? ' bv-op-amount--in' : ''}">${it.isIncome ? '+' : (it.sign || '')}${formatCurrency(Math.abs(it.amount))}</span>
                    ${it.action || ''}
                </li>`;
    },

    // Aperçu du formulaire : opérations que suivraient les catégories cochées, mis à jour à chaque changement
    _schedulePreview() {
        clearTimeout(this._previewTimer);
        this._previewTimer = setTimeout(() => this._renderFormPreview(), 250);
    },

    // Projet et tirelire : opérations rattachées à la main (et dépôts / retraits), ou comment les rattacher
    async _renderLinkedPreview(box) {
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const isSavings = document.getElementById('budgetTypeSavings')?.checked;
        const editId = parseInt(document.getElementById('budgetEditId')?.value || 0);
        const key = `linked:${isSavings ? 'savings' : 'project'}:${editId}`;
        if (key === this._previewKey) return;
        this._previewKey = key;
        const head = (sub) => `
            <div class="bv-preview-head">
                <h4 class="bv-ops-title">${isSavings ? t('bv_form_preview_savings_title', 'Dépôts et retraits') : t('bv_form_preview_project_title', 'Opérations rattachées')}</h4>
            </div>${sub || ''}`;
        const howTo = `<p class="bv-detail-empty">${isSavings
            ? t('bv_form_preview_savings_how', "Alimentez la tirelire par le bouton « Dépôt » de sa fiche ou par le bouton + de sa carte. Une opération du Journal peut aussi y être rattachée, par le champ « Enveloppe projet » de sa fiche.")
            : t('bv_form_preview_project_how', "Rattachez des opérations à ce projet depuis le Journal : ouvrez une opération et choisissez le projet dans le champ « Enveloppe projet ».")}</p>`;
        if (!editId) {
            box.innerHTML = head(`<p class="bv-detail-empty">${isSavings
                ? t('bv_form_preview_savings_new', 'Aucun dépôt pour l’instant.')
                : t('bv_form_preview_project_new', 'Aucune opération pour l’instant.')}</p>${howTo}`);
            return;
        }
        box.classList.add('is-loading');
        let txs = [], allocs = [];
        try {
            [txs, allocs] = await Promise.all([
                API.get(`/api/budgets/${editId}/transactions`),
                isSavings ? API.get(`/api/budgets/${editId}/allocations`).catch(() => []) : Promise.resolve([]),
            ]);
        } catch (e) {
            if (key === this._previewKey) box.innerHTML = head(`<p class="bv-detail-error">${t('title_error', 'Erreur')} : ${esc(e.message)}</p>`);
            return;
        } finally {
            if (key === this._previewKey) box.classList.remove('is-loading');
        }
        if (key !== this._previewKey) return;
        const items = txs.map(tx => ({ date: tx.date, label: esc(tx.description), amount: tx.amount, isIncome: tx.is_income, category: tx.category }));
        for (const a of allocs) {
            const note = a.note || (a.amount > 0 ? t('budget_savings_deposit', 'Dépôt') : t('budget_savings_withdrawal', 'Retrait'));
            items.push({ date: a.date, label: esc(note), amount: a.amount, isIncome: a.amount > 0, sign: '−' });
        }
        items.sort((a, b) => b.date.localeCompare(a.date));
        if (!items.length) {
            box.innerHTML = head(`<p class="bv-detail-empty">${t('bv_form_preview_none_linked', 'Aucune opération rattachée pour l’instant.')}</p>${howTo}`);
            return;
        }
        // Projet : ce qui a été dépensé ; tirelire : ce qui y est mis de côté
        const net = items.reduce((sum, it) => sum + (it.isIncome ? 1 : -1) * Math.abs(it.amount), 0);
        const total = isSavings ? net : -net;
        const count = t(items.length > 1 ? 'bv_form_preview_count_many' : 'bv_form_preview_count_one', items.length > 1 ? '{count} opérations' : '{count} opération').split('{count}').join(items.length);
        box.innerHTML = head(`<p class="bv-preview-sum"><span>${count}</span><strong class="privacy-blur">${formatCurrency(total)}</strong></p>
            <ul class="bv-ops">${items.slice(0, 150).map(it => this._opRowHtml(it)).join('')}</ul>`);
    },

    async _renderFormPreview() {
        const box = document.getElementById('budgetFormPreview');
        if (!box || box.hidden || document.getElementById('budgetFormSection')?.style.display !== 'block') return;
        if (document.getElementById('budgetTypeProject')?.checked || document.getElementById('budgetTypeSavings')?.checked) {
            return this._renderLinkedPreview(box);
        }
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const cats = [...(this.selectedCategories || [])];
        const period = document.getElementById('newBudgetPeriod')?.value || 'monthly';
        const startDate = document.getElementById('newBudgetStartDate')?.value || '';
        const endDate = document.getElementById('newBudgetEndDate')?.value || '';
        const isOrg = window.app?.config?.enable_org_mode === 'true';
        const accIds = isOrg ? this.getSelectedAccounts() : [];
        const p = this.periodInfo;
        const year = period === 'yearly' ? this.yearlyYear : (this._currentDetailYear || (p ? parseInt(p.start.slice(0, 4)) : new Date().getFullYear()));
        const month = this._currentDetailMonth || (p ? parseInt(p.start.slice(5, 7)) : new Date().getMonth() + 1);

        const params = new URLSearchParams({ period, year, month });
        cats.forEach(c => params.append('categories', c));
        accIds.forEach(a => params.append('account_ids', a));
        if (period === 'monthly') {
            const s = this.customPeriod?.enabled ? this.customPeriod.start : p?.start;
            const e = this.customPeriod?.enabled ? this.customPeriod.end : p?.end;
            if (s && e) { params.set('date_start', s); params.set('date_end', e); }
        } else if (period === 'custom' && startDate && endDate) {
            params.set('start_date', startDate); params.set('end_date', endDate);
        }
        const key = params.toString();
        if (key === this._previewKey) return;
        this._previewKey = key;

        const head = (sub) => `
            <div class="bv-preview-head">
                <h4 class="bv-ops-title">${t('bv_form_preview_title', 'Opérations suivies')}</h4>
                <span class="bv-preview-period">${esc(this._envPeriodLabel(period, { startDate, endDate, year }))}</span>
            </div>${sub || ''}`;
        if (!cats.length) {
            box.innerHTML = head(`<p class="bv-detail-empty">${t('bv_form_preview_empty', "Cochez des catégories pour voir les opérations qu'elles feraient entrer dans l'enveloppe.")}</p>`);
            return;
        }
        if (period === 'custom' && !(startDate && endDate)) {
            box.innerHTML = head(`<p class="bv-detail-empty">${t('bv_form_preview_dates', 'Indiquez les dates de l’enveloppe pour voir ses opérations.')}</p>`);
            return;
        }
        box.classList.add('is-loading');
        let txs;
        try {
            txs = await API.get(`/api/budgets/preview_transactions?${key}`);
        } catch (e) {
            if (key === this._previewKey) box.innerHTML = head(`<p class="bv-detail-error">${t('title_error', 'Erreur')} : ${esc(e.message)}</p>`);
            return;
        } finally {
            if (key === this._previewKey) box.classList.remove('is-loading');
        }
        if (key !== this._previewKey) return;

        // Opérations des catégories ajoutées depuis l'ouverture du formulaire : repérées par un liseré
        const editId = parseInt(document.getElementById('budgetEditId')?.value || 0);
        const saved = editId ? ((this.budgets || []).find(b => b.id === editId)?.categories || []) : null;
        const total = txs.reduce((s, tx) => s + (tx.is_income ? -Math.abs(tx.amount) : Math.abs(tx.amount)), 0);
        const MAX = 150;
        const items = txs.slice(0, MAX).map(tx => ({
            date: tx.date, label: esc(tx.description), amount: tx.amount, isIncome: tx.is_income, category: tx.category,
            added: !!saved && !saved.includes(tx.category),
        }));
        const count = t(txs.length > 1 ? 'bv_form_preview_count_many' : 'bv_form_preview_count_one', txs.length > 1 ? '{count} opérations' : '{count} opération').split('{count}').join(txs.length);
        const summary = txs.length
            ? `<p class="bv-preview-sum"><span>${count}</span><strong class="privacy-blur">${formatCurrency(total)}</strong></p>`
            : '';
        box.innerHTML = head(summary + (txs.length
            ? `<ul class="bv-ops">${items.map(it => this._opRowHtml(it)).join('')}</ul>
               ${txs.length > MAX ? `<p class="bv-detail-empty">${t('bv_form_preview_more', '… et {count} de plus').split('{count}').join(txs.length - MAX)}</p>` : ''}
               ${items.some(it => it.added) ? `<p class="bv-preview-legend"><span class="bv-preview-swatch" aria-hidden="true"></span>${t('bv_form_preview_added', 'Opérations apportées par les catégories ajoutées')}</p>` : ''}`
            : `<p class="bv-detail-empty">${t('bv_form_preview_none', 'Aucune opération sur cette période.')}</p>`));
    },

    removeSelectedCat(name) {
        this.selectedCategories = (this.selectedCategories || []).filter(c => c !== name);
        this.renderCatCheckboxes(this.selectedCategories);
    },

    useCatAverage(value) {
        const input = document.getElementById('newBudgetAmount');
        if (!input) return;
        input.value = value.toFixed(2);
        input.focus();
    },

    onPeriodChange() {
        const period = document.getElementById('newBudgetPeriod')?.value;
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = period === 'custom' ? '' : 'none';
        this.renderCatCheckboxes(this.selectedCategories);
    },

    toggleType() {
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const isProject = document.getElementById('budgetTypeProject')?.checked;
        const isSavings = document.getElementById('budgetTypeSavings')?.checked;
        const show = (id, visible) => { const el = document.getElementById(id); if (el) el.style.display = visible ? '' : 'none'; };
        show('budgetCatSection', !isProject && !isSavings);
        show('budgetPeriodField', !isSavings);
        show('budgetLockSection', !isSavings);
        const periodSel = document.getElementById('newBudgetPeriod');
        if (isSavings) {
            if (periodSel.value !== 'indefinite') this._periodBeforeSavings = periodSel.value;
            periodSel.value = 'indefinite';
        } else if (this._periodBeforeSavings) {
            periodSel.value = this._periodBeforeSavings;
            this._periodBeforeSavings = null;
        }
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = periodSel.value === 'custom' ? '' : 'none';
        const preview = document.getElementById('budgetFormPreview');
        if (preview) preview.hidden = false;
        document.querySelector('#budgetUnifiedModal .budget-unified-panel')?.classList.add('is-split');
        this._previewKey = null;
        this._schedulePreview();
        const amountLabel = document.getElementById('budgetAmountLabel');
        if (amountLabel) amountLabel.textContent = isSavings ? t('bv_form_goal', 'Objectif') : t('bv_detail_limit', 'Plafond');
        const hint = document.getElementById('budgetTypeHint');
        if (hint) {
            hint.textContent = isSavings
                ? t('bv_form_type_savings_hint', "Met de l'argent de côté vers un objectif, par dépôts et retraits.")
                : isProject
                    ? t('bv_form_type_project_hint', 'Suit les opérations que vous rattachez vous-même à ce projet.')
                    : t('bv_form_type_cat_hint', 'Suit automatiquement les dépenses des catégories choisies.');
        }
    },

    async showDetail(budgetId, budgetName, year, month) {
        this._currentDetailYear = year;
        this._currentDetailMonth = month;
        this._detailArgs = [budgetId, budgetName, year, month];
        const modal = document.getElementById('budgetUnifiedModal');
        const title = document.getElementById('budgetUnifiedTitle');
        const graph = document.getElementById('budgetDetailGraph');
        const list = document.getElementById('budgetDetailList');
        const editBtn = document.getElementById('budgetUnifiedEditBtn');
        const detailSec = document.getElementById('budgetDetailSection');
        const formSec = document.getElementById('budgetFormSection');

        if (!modal) return;
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const tp = (k, params, fb) => {
            let s = t(k, fb);
            for (const [key, v] of Object.entries(params || {})) s = s.split(`{${key}}`).join(v);
            return s;
        };
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

        title.textContent = budgetName;
        document.getElementById('budgetEditId').value = budgetId;
        editBtn.hidden = false;

        detailSec.style.display = 'block';
        formSec.style.display = 'none';
        modal.querySelector('.budget-unified-panel')?.classList.remove('is-split');

        // Rechargement sur place (après un réglage) : on garde le contenu affiché jusqu'à la nouvelle version
        const isRefresh = modal.style.display === 'flex' && graph.dataset.budgetId === String(budgetId);
        if (!isRefresh) {
            graph.innerHTML = `<p class="bv-detail-loading">${t('budget_loading', 'Chargement…')}</p>`;
            list.innerHTML = '';
        }
        graph.dataset.budgetId = String(budgetId);
        modal.style.display = 'flex';
        this._bindUnifiedKeys();

        try {
            const budget = this.statusData?.budgets.find(b => b.id === budgetId);
            const isSavings = (budget?.envelope_type || 'spending') === 'savings';
            // Enveloppe mensuelle : opérations de la période affichée (cycle de paie ou période personnalisée)
            let txUrl = `/api/budgets/${budgetId}/transactions?year=${year}&month=${month}`;
            const isMonthlyEnv = budget && !budget.is_project && (!budget.period || budget.period === 'monthly');
            if (isMonthlyEnv && this.customPeriod?.enabled && this.customPeriod.start && this.customPeriod.end) {
                txUrl += `&date_start=${this.customPeriod.start}&date_end=${this.customPeriod.end}`;
            } else if (isMonthlyEnv && this.periodInfo) {
                txUrl += `&date_start=${this.periodInfo.start}&date_end=${this.periodInfo.end}`;
            }
            const txs = await API.get(txUrl);

            const opRow = (it) => this._opRowHtml(it);
            const opsHtml = (items) => items.length
                ? `<h4 class="bv-ops-title">${window.i18n.tp('budget_operations_count', { count: items.length })}</h4>
                   <ul class="bv-ops">${items.map(opRow).join('')}</ul>`
                : `<p class="bv-detail-empty">${t('budget_no_operations', 'Aucune opération sur cette période.')}</p>`;

            if (isSavings) {
                let allocs = [];
                try { allocs = await API.get(`/api/budgets/${budgetId}/allocations`); } catch(e) {}

                const funded = budget?.funded || 0;
                const withdrawn = budget?.withdrawn || 0;
                const balance = budget?.balance || 0;
                const goal = budget?.budget_amount || 0;

                const overflow = this.savingsOverflow;
                let tempWithdrawn = 0;
                if (overflow && overflow.total_savings > 0 && !budget?.is_closed) {
                    const proportion = balance / overflow.total_savings;
                    tempWithdrawn = Math.min(balance, overflow.overflow_amount * proportion);
                }

                const effectiveBalance = balance - tempWithdrawn;
                const pct = goal > 0 ? Math.min((effectiveBalance / goal) * 100, 100) : 0;
                const goalReached = balance >= goal && goal > 0;
                const safeName = budgetName.replace(/'/g, "\\'");

                const hostedPerAccount = {};
                for (const a of allocs) {
                    const key = a.account_id || 'main';
                    hostedPerAccount[key] = (hostedPerAccount[key] || 0.0) + a.amount;
                }
                const accountSelectDetail = this._buildAccountSelect('detailAllocAccountId', hostedPerAccount);

                graph.innerHTML = `
                <div class="bv-detail-summary ${goalReached ? 'bv-tone-near' : 'bv-tone-ok'}">
                    <div class="bv-detail-top">
                        <span class="bv-detail-period">${(s => s.charAt(0).toUpperCase() + s.slice(1))(t('budget_savings_goal', 'Objectif'))}</span>
                        <span class="bv-env-figures privacy-blur"><strong>${formatCurrency(effectiveBalance)}</strong><span> / ${formatCurrency(goal)}</span></span>
                    </div>
                    <div class="bv-env-bar"><span class="bv-env-fill" style="width:${pct}%"></span></div>
                    <div class="bv-env-foot">
                        <span class="bv-env-meta privacy-blur">${formatCurrency(funded)} ${t('budget_savings_funded', 'versés')}${withdrawn > 0 ? ` · ${formatCurrency(withdrawn)} ${t('budget_savings_withdrawn', 'retirés')}` : ''}</span>
                        <span class="bv-env-status privacy-blur">${goalReached ? t('budget_savings_goal_reached', 'Objectif atteint') : `${formatCurrency(Math.max(goal - balance, 0))} ${t('budget_savings_remaining', 'restants')}`}</span>
                    </div>
                </div>
                <div class="bv-detail-alloc">
                    <input type="number" id="detailAllocAmount" class="inline-input" placeholder="${t('budget_savings_add_placeholder', 'Montant')}" step="0.01">
                    ${accountSelectDetail}
                    <input type="text" id="detailAllocNote" class="inline-input bv-detail-alloc-note" placeholder="${t('budget_savings_note_placeholder', 'Note')}">
                    <div class="bv-detail-alloc-actions">
                        <button type="button" class="btn btn-primary bv-btn-compact" onclick="window.BudgetsView.addAllocationFromDetail(${budgetId}, 1, '${safeName}', ${year}, ${month})">${t('budget_savings_deposit', 'Déposer')}</button>
                        <button type="button" class="btn btn-secondary bv-btn-compact" onclick="window.BudgetsView.addAllocationFromDetail(${budgetId}, -1, '${safeName}', ${year}, ${month})">${t('budget_savings_withdrawal', 'Retirer')}</button>
                    </div>
                </div>`;

                const items = txs.map(tx => ({
                    date: tx.date, label: esc(tx.description), amount: tx.amount,
                    isIncome: tx.is_income, category: tx.category,
                }));
                for (const a of allocs) {
                    const acc = this.accounts?.find(ac => ac.id === a.account_id);
                    const note = a.note || (a.amount > 0 ? t('budget_savings_deposit', 'Dépôt') : t('budget_savings_withdrawal', 'Retrait'));
                    items.push({
                        date: a.date, amount: a.amount, isIncome: a.amount > 0, sign: '−',
                        label: `${esc(note)}${acc ? ` <span class="bv-env-account" style="--acc:${acc.color || 'var(--accent)'}">${esc(acc.name)}</span>` : ''}`,
                        action: `<button type="button" class="bv-icon-btn bv-icon-btn--danger" aria-label="${t('tooltip_delete', 'Supprimer')}" title="${t('tooltip_delete', 'Supprimer')}" onclick="event.stopPropagation();window.BudgetsView.deleteAllocation(${budgetId},${a.id},'${safeName}',${year},${month})">${this._bvIcon('close', 14)}</button>`,
                    });
                }
                items.sort((a, b) => b.date.localeCompare(a.date));
                list.innerHTML = opsHtml(items);
                return;
            }

            // Résumé : la même jauge et les mêmes mots que la carte de l'enveloppe
            const gauge = budget ? this._envGauge(budget) : null;
            const period = budget?.period || 'monthly';
            const periodLabel = this._envPeriodLabel(period, { isProject: budget?.is_project, startDate: budget?.start_date, endDate: budget?.end_date, year });
            const cats = budget?.categories || [];
            const summary = gauge ? `
                <div class="bv-detail-summary bv-tone-${gauge.tone}">
                    <div class="bv-detail-top">
                        <span class="bv-detail-period">${periodLabel}</span>
                        <span class="bv-env-figures privacy-blur"><strong>${formatCurrency(gauge.spent)}</strong><span> / ${formatCurrency(gauge.limit)}</span></span>
                    </div>
                    ${this._envBarHtml(gauge)}
                    <div class="bv-env-foot">
                        <span class="bv-env-meta">${cats.length ? esc(cats.join(', ')) : t('bv_detail_no_cats', 'Aucune catégorie suivie')}</span>
                        <span class="bv-env-status privacy-blur">${gauge.statusText}</span>
                    </div>
                </div>` : '';

            // Réglages rapides : plafond, épinglage, verrouillage
            const committed = budget?.spent || 0;
            const canRaise = budget && committed - (budget.budget_amount || 0) > 0.009;
            const pinned = this.isPinned(budgetId);
            const controls = budget ? `
                <div class="bv-detail-controls">
                    <label class="bv-detail-limit">
                        <span>${t('bv_detail_limit', 'Plafond')}</span>
                        <input type="number" class="inline-input privacy-blur" value="${budget.budget_amount}" min="0" step="0.01"
                               onchange="window.BudgetsView.updateAmount(${budgetId}, this.value).then(() => window.BudgetsView.refreshDetail())">
                        <span aria-hidden="true">€</span>
                    </label>
                    ${canRaise ? `<button type="button" class="btn btn-secondary bv-btn-compact" title="${t('bv_detail_raise_hint', 'Le plafond couvre alors les dépenses de la période, prévues comprises')}" onclick="window.BudgetsView.updateAmount(${budgetId}, ${committed}).then(() => window.BudgetsView.refreshDetail())">${tp('bv_detail_raise', { amount: formatCurrency(committed) }, 'Relever à {amount}')}</button>` : ''}
                    <span class="bv-detail-toggles">
                        <button type="button" class="bv-toggle" aria-pressed="${pinned}" title="${t('bv_pin_hint', 'Afficher cette enveloppe dans la barre latérale')}"
                                onclick="window.BudgetsView.togglePin(${budgetId}).then(() => window.BudgetsView.refreshDetail())">${this._bvIcon('pin', 14)}<span>${pinned ? t('bv_pinned_short', 'Épinglée') : t('bv_pin', 'Épingler')}</span></button>
                        <button type="button" class="bv-toggle" aria-pressed="${!!budget.is_locked}" title="${t('bv_locked', "Verrouillée : pas d'ajustement automatique")}"
                                onclick="window.BudgetsView.toggleLock(${budgetId}).then(() => window.BudgetsView.refreshDetail())">${this._bvIcon('lock', 14)}<span>${budget.is_locked ? t('bv_locked_short', 'Verrouillée') : t('bv_detail_lock', 'Verrouiller')}</span></button>
                    </span>
                </div>` : '';

            graph.innerHTML = summary + controls;
            const items = [...txs]
                .sort((a, b) => b.date.localeCompare(a.date))
                .map(tx => ({ date: tx.date, label: esc(tx.description), amount: tx.amount, isIncome: tx.is_income, category: tx.category }));
            list.innerHTML = opsHtml(items);
        } catch(e) {
            graph.innerHTML = `<p class="bv-detail-error">${t('title_error', 'Erreur')} : ${esc(e.message)}</p>`;
        }
    },

    refreshDetail() {
        if (this._detailArgs && document.getElementById('budgetDetailSection')?.style.display === 'block') {
            return this.showDetail(...this._detailArgs);
        }
    },

    // Échap ferme la fenêtre (ou revient au détail depuis la modification)
    _bindUnifiedKeys() {
        if (this._unifiedKeyHandler) return;
        this._unifiedKeyHandler = (e) => {
            if (e.key !== 'Escape') return;
            const modal = document.getElementById('budgetUnifiedModal');
            if (!modal || modal.style.display !== 'flex') return;
            if (document.getElementById('inlineConfirm')?.style.display === 'flex') return;
            if (document.getElementById('budgetFormSection')?.style.display === 'block') this.hideEditSection();
            else this.closeUnifiedModal();
        };
        document.addEventListener('keydown', this._unifiedKeyHandler);
    },

    // Remplit le formulaire avec une enveloppe existante (le type ne se change plus après la création)
    _fillForm(b) {
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        document.getElementById('budgetEditId').value = b.id;
        document.getElementById('newBudgetName').value = b.name;
        document.getElementById('newBudgetAmount').value = Number(b.monthly_amount || 0).toFixed(2);
        document.getElementById('newBudgetPeriod').value = b.period;
        document.getElementById('newBudgetStartDate').value = b.start_date || '';
        document.getElementById('newBudgetEndDate').value = b.end_date || '';
        document.getElementById('budgetCustomDates').style.display = b.period === 'custom' ? '' : 'none';
        if (b.is_project) document.getElementById('budgetTypeProject').checked = true;
        else if ((b.envelope_type || 'spending') === 'savings') document.getElementById('budgetTypeSavings').checked = true;
        else document.getElementById('budgetTypeCategory').checked = true;
        document.getElementById('budgetTypeRow').style.display = 'none';
        this._periodBeforeSavings = null;
        this.toggleType();
        this.renderAccountCheckboxes(b.account_ids || []);
        document.getElementById('budgetCatSearch').value = '';
        this._showOtherCatTypes = false;
        this.selectedCategories = [...(b.categories || [])];
        this.renderCatCheckboxes(this.selectedCategories);
        document.getElementById('budgetIsLocked').checked = !!b.is_locked;
        document.getElementById('budgetArchiveSection').style.display = '';
        document.getElementById('budgetToggleCloseText').textContent = b.is_closed
            ? t('bv_form_reopen', "Rouvrir l'enveloppe")
            : t('bv_form_archive', "Archiver l'enveloppe");
    },

    showAddForm() {
        document.getElementById('budgetUnifiedTitle').textContent = window.i18n.t('budget_new') || 'Nouvelle enveloppe';
        document.getElementById('budgetUnifiedEditBtn').hidden = true;
        document.getElementById('budgetDetailSection').style.display = 'none';

        document.getElementById('budgetEditId').value = '';
        document.getElementById('newBudgetName').value = '';
        document.getElementById('newBudgetAmount').value = '';
        document.getElementById('newBudgetPeriod').value = 'monthly';
        document.getElementById('newBudgetStartDate').value = '';
        document.getElementById('newBudgetEndDate').value = '';
        document.getElementById('budgetCustomDates').style.display = 'none';
        document.getElementById('budgetTypeCategory').checked = true;
        document.getElementById('budgetTypeRow').style.display = '';
        this._periodBeforeSavings = null;
        this.toggleType();
        this.renderAccountCheckboxes([]);
        document.getElementById('budgetCatSearch').value = '';
        this._showOtherCatTypes = false;
        this.selectedCategories = [];
        this.renderCatCheckboxes(this.selectedCategories);
        document.getElementById('budgetIsLocked').checked = false;
        document.getElementById('budgetArchiveSection').style.display = 'none';

        document.getElementById('budgetFormSection').style.display = 'block';
        this._previewKey = null;
        this._schedulePreview();
        const modal = document.getElementById('budgetUnifiedModal');
        modal.style.display = 'flex';
        modal.scrollTop = 0;
        this._bindUnifiedKeys();
        document.getElementById('newBudgetName').focus();
    },

    closeUnifiedModal() {
        clearTimeout(this._previewTimer);
        this._previewKey = null;
        document.querySelector('#budgetUnifiedModal .budget-unified-panel')?.classList.remove('is-split');
        document.getElementById('budgetUnifiedModal').style.display = 'none';
        document.getElementById('budgetFormSection').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        this._directEdit = false;
    },

    // Annuler : retour au détail si on venait de lui, sinon fermeture
    hideEditSection() {
        if (!document.getElementById('budgetEditId').value || this._directEdit) {
            this.closeUnifiedModal();
        } else {
            document.getElementById('budgetFormSection').style.display = 'none';
            document.getElementById('budgetDetailSection').style.display = 'block';
            document.querySelector('#budgetUnifiedModal .budget-unified-panel')?.classList.remove('is-split');
            if (this._detailArgs) document.getElementById('budgetUnifiedTitle').textContent = this._detailArgs[1];
            document.getElementById('budgetUnifiedEditBtn').hidden = false;
        }
    },

    // Depuis le détail : le formulaire prend sa place
    showEditSection() {
        this._directEdit = false;
        const id = document.getElementById('budgetEditId').value;
        const b = this.budgets.find(x => x.id == id);
        if (!b) return;
        this._fillForm(b);
        document.getElementById('budgetUnifiedTitle').textContent = window.i18n.t('budget_edit_envelope') || "Modifier l'enveloppe";
        document.getElementById('budgetUnifiedEditBtn').hidden = true;
        document.getElementById('budgetDetailSection').style.display = 'none';
        document.getElementById('budgetFormSection').style.display = 'block';
        this._previewKey = null;
        this._schedulePreview();
        document.getElementById('budgetUnifiedModal').scrollTop = 0;
    },

    editBudget(id) {
        const b = this.budgets.find(x => x.id === id);
        if (!b) return;
        this._directEdit = true;
        this._fillForm(b);
        document.getElementById('budgetUnifiedTitle').textContent = window.i18n.t('budget_edit_envelope') || "Modifier l'enveloppe";
        document.getElementById('budgetUnifiedEditBtn').hidden = true;
        document.getElementById('budgetDetailSection').style.display = 'none';
        document.getElementById('budgetFormSection').style.display = 'block';
        this._previewKey = null;
        this._schedulePreview();
        const modal = document.getElementById('budgetUnifiedModal');
        modal.style.display = 'flex';
        modal.scrollTop = 0;
        this._bindUnifiedKeys();
    },

    async saveForm(triggerBtn) {
        const btn = triggerBtn || document.getElementById('budgetSaveBtn') || document.querySelector('#budgetFormSection button[data-i18n="budget_btn_save"]');
        return window.withButtonLoading(btn, async () => {
            const id = document.getElementById('budgetEditId').value;
            const name = document.getElementById('newBudgetName').value.trim();
            const amount = parseFloat(document.getElementById('newBudgetAmount').value);
            const period = document.getElementById('newBudgetPeriod').value;
            const isProject = document.getElementById('budgetTypeProject').checked;
            const isSavings = document.getElementById('budgetTypeSavings')?.checked;
            const categories = (isProject || isSavings) ? [] : this.selectedCategories;

            if (!name) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_name_required'));
            // Sans catégorie, une enveloppe de dépenses ne suivrait rien
            if (!isProject && !isSavings && !categories.length) {
                return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('bv_form_cat_required') || "Choisissez au moins une catégorie : sans catégorie, l'enveloppe ne suit aucune dépense.");
            }
            if (isNaN(amount) || amount < 0) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_invalid_amount'));

            const startDate = period === 'custom' ? (document.getElementById('newBudgetStartDate')?.value || null) : null;
            const endDate = period === 'custom' ? (document.getElementById('newBudgetEndDate')?.value || null) : null;
            if (period === 'custom' && (!startDate || !endDate)) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_custom_dates_required') || 'Please select start and end dates.');
            
            const envelope_type = isSavings ? 'savings' : 'spending';
            const account_ids = window.app?.config?.enable_org_mode === 'true' ? this.getSelectedAccounts() : null;
            const isLocked = document.getElementById('budgetIsLocked')?.checked || false;
            const payload = { name, monthly_amount: amount, period, is_project: isProject, categories, start_date: startDate, end_date: endDate, account_ids, envelope_type, is_locked: isLocked };

            try {
                let savedId = id;
                let actionId = null;
                if (id) {
                    const res = await API.put(`/api/budgets/${id}`, payload);
                    actionId = res.action_id;
                } else {
                    const res = await API.post('/api/budgets/', payload);
                    savedId = res.id;
                    actionId = res.action_id;
                }
                
                if (!id) this._pendingHighlightName = name;

                // Early closing : fermer la modale immédiatement dès confirmation API
                const isDirectOrNew = this._directEdit || !id;
                if (isDirectOrNew) {
                    this.closeUnifiedModal();
                } else {
                    document.getElementById('budgetFormSection').style.display = 'none';
                }

                const toastMsg = id ? window.i18n.t('msg_envelope_updated') : window.i18n.t('msg_envelope_created');
                showUndoToast(toastMsg, actionId, () => this.loadBudgets().then(() => this.loadStatus()));

                // Parallélisation des rechargements en tâche de fond (Promise.all)
                const refreshJobs = [
                    this.loadBudgets(),
                    this.loadStatus()
                ];
                if (window.app && typeof window.app.refreshSidebar === 'function') {
                    refreshJobs.push(window.app.refreshSidebar());
                }
                await Promise.all(refreshJobs);

                // Si pas directEdit / création, afficher le détail de l'enveloppe éditée
                if (!isDirectOrNew) {
                    const y = this._currentDetailYear;
                    const m = this._currentDetailMonth;
                    if (y && m) {
                        await this.showDetail(parseInt(savedId), name, y, m);
                    } else {
                        const monthVal = document.getElementById('budgetMonthInput')?.value || this.monthlyMonth;
                        if (monthVal) {
                            const [yyyy, mm] = monthVal.split('-');
                            await this.showDetail(parseInt(savedId), name, parseInt(yyyy), parseInt(mm));
                        }
                    }
                }
            } catch(e) {
                showToast(e.message || window.i18n.t('budget_ai_create_fail'), 'error', 5000);
            }
        });
    },

    async updateAmount(id, val) {
        const amount = parseFloat(val);
        if (isNaN(amount) || amount < 0) return;
        try {
            const res = await API.put(`/api/budgets/${id}`, { monthly_amount: amount });
            await this.loadStatus();
            window.app.refreshSidebar();
            if (res && res.action_id) {
                showUndoToast(window.i18n.t('msg_envelope_updated'), res.action_id, () => this.loadBudgets().then(() => this.loadStatus()));
            }
        } catch(e) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.tp('msg_update_error', {error: e.message}));
        }
    },

    async toggleClose(id) {
        const b = this.budgets.find(x => x.id === id);
        if (!b) return;
        const action = b.is_closed ? window.i18n.t('budget_reopen_action') : window.i18n.t('budget_close_action');
        if (!await showInlineConfirm(window.i18n.t('title_confirmation'), window.i18n.tp('budget_confirm_toggle', {action}))) return;
        try {
            const res = await API.put(`/api/budgets/${id}`, { is_closed: !b.is_closed });
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            showUndoToast(window.i18n.t('msg_envelope_updated'), res.action_id, () => this.loadBudgets().then(() => this.loadStatus()));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async toggleCloseFromModal() {
        const id = parseInt(document.getElementById('budgetEditId')?.value);
        if (!id) return;
        this.closeUnifiedModal();
        await this.toggleClose(id);
    },

    async toggleLock(id) {
        const b = this.budgets.find(x => x.id === id);
        if (!b) return;
        const newLocked = !b.is_locked;
        try {
            const res = await API.put(`/api/budgets/${id}`, { is_locked: newLocked });
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            const toastMsg = newLocked 
                ? (window.i18n.t('budget_locked_toast') || 'Enveloppe verrouillée (exclue du recalibrage automatique)')
                : (window.i18n.t('budget_unlocked_toast') || 'Enveloppe déverrouillée (éligible au recalibrage automatique)');
            showUndoToast(toastMsg, res.action_id, () => this.loadBudgets().then(() => this.loadStatus()));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async deleteBudget(id) {
        if (!await showInlineConfirm(window.i18n.t('title_deletion'), window.i18n.t('confirm_delete_envelope'))) return;
        try {
            const res = await API.del(`/api/budgets/${id}`);
            await this.loadBudgets();
            if (typeof this.loadAutopilotSuggestions === 'function') {
                await this.loadAutopilotSuggestions();
            }
            await this.loadStatus();
            window.app.refreshSidebar();
            showUndoToast(window.i18n.t('msg_envelope_deleted') || 'Budget supprimé', res.action_id, () => Promise.all([this.loadBudgets(), this.loadAutopilotSuggestions ? this.loadAutopilotSuggestions() : Promise.resolve()]).then(() => this.loadStatus()));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_info'), e.message);
        }
    },

    async showAllocationForm(budgetId) {
        const existing = document.getElementById('allocationInlineForm');
        if (existing) existing.remove();

        const card = document.querySelector(`[data-budget-id="${budgetId}"]`);
        if (!card) return;

        let hostedPerAccount = {};
        try {
            const allocs = await API.get(`/api/budgets/${budgetId}/allocations`);
            for (const a of allocs) {
                const key = a.account_id || 'main';
                hostedPerAccount[key] = (hostedPerAccount[key] || 0.0) + a.amount;
            }
        } catch(e) {}

        const accountSelect = this._buildAccountSelect('allocAccountId', hostedPerAccount);

        const form = document.createElement('div');
        form.id = 'allocationInlineForm';
        form.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:12px;margin-top:8px;background:var(--bg-surface);border:1px solid rgba(245,158,11,0.3);border-radius:8px;';
        form.onclick = (e) => e.stopPropagation();
        form.innerHTML = `
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <input type="number" id="allocAmount" class="inline-input" placeholder="${window.i18n.t('budget_savings_add_placeholder')}" step="0.01" style="width:110px;font-size:12px;padding:6px 10px;border-radius:6px;">
                ${accountSelect}
                <input type="text" id="allocNote" class="inline-input" placeholder="${window.i18n.t('budget_savings_note_placeholder')}" style="flex:1;min-width:140px;font-size:12px;padding:6px 10px;border-radius:6px;">
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
                <button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocation(${budgetId}, 1)">↑ ${window.i18n.t('budget_savings_deposit')}</button>
                <button class="btn btn-secondary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocation(${budgetId}, -1)">↓ ${window.i18n.t('budget_savings_withdrawal')}</button>
                <button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="document.getElementById('allocationInlineForm')?.remove()">✕</button>
            </div>
        `;
        card.appendChild(form);
        document.getElementById('allocAmount')?.focus();
    },

    async addAllocation(budgetId, sign) {
        const amountInput = document.getElementById('allocAmount');
        const noteInput = document.getElementById('allocNote');
        const accSelect = document.getElementById('allocAccountId');
        const amount = parseFloat(amountInput?.value);
        if (isNaN(amount) || amount <= 0) return;
        const account_id = accSelect && accSelect.value ? parseInt(accSelect.value) : null;

        try {
            const res = await API.post(`/api/budgets/${budgetId}/allocations`, {
                amount: amount * sign,
                note: noteInput?.value || null,
                date: new Date().toISOString().split('T')[0],
                account_id: account_id,
            });
            document.getElementById('allocationInlineForm')?.remove();
            await this.loadStatus();
            window.app.refreshSidebar();
            const toastMsg = sign > 0 ? `↑ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_deposit').toLowerCase()}` : `↓ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_withdrawal').toLowerCase()}`;
            showUndoToast(toastMsg, res.action_id, () => this.loadStatus());
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async breakPiggyBank(id) {
        if (!await showInlineConfirm('🔨 ' + window.i18n.t('budget_savings_break_action'), window.i18n.t('budget_savings_break_confirm'))) return;
        try {
            await API.put(`/api/budgets/${id}`, { is_closed: true });
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            showToast('🏦 ' + window.i18n.t('budget_savings_broken'), 'success', 4000);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async deleteAllocation(budgetId, allocId, budgetName, year, month) {
        try {
            const res = await API.del(`/api/budgets/${budgetId}/allocations/${allocId}`);
            await this.loadStatus();
            window.app.refreshSidebar();
            await this.showDetail(budgetId, budgetName, year, month);
            showUndoToast(window.i18n.t('msg_allocation_deleted') || 'Allocation supprimée', res.action_id, () => this.loadStatus().then(() => this.showDetail(budgetId, budgetName, year, month)));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async addAllocationFromDetail(budgetId, sign, budgetName, year, month) {
        const amountInput = document.getElementById('detailAllocAmount');
        const noteInput = document.getElementById('detailAllocNote');
        const accSelect = document.getElementById('detailAllocAccountId');
        const amount = parseFloat(amountInput?.value);
        if (isNaN(amount) || amount <= 0) return;
        const account_id = accSelect && accSelect.value ? parseInt(accSelect.value) : null;

        try {
            await API.post(`/api/budgets/${budgetId}/allocations`, {
                amount: amount * sign,
                note: noteInput?.value || null,
                date: new Date().toISOString().split('T')[0],
                account_id: account_id,
            });
            await this.loadStatus();
            window.app.refreshSidebar();
            showToast(sign > 0 ? `↑ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_deposit').toLowerCase()}` : `↓ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_withdrawal').toLowerCase()}`, 'success');
            await this.showDetail(budgetId, budgetName, year, month);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    // Suppression groupée : un choix par groupe de la page, rien de coché au départ, le total sur le bouton
    openBulkDelete() {
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const esc = (x) => String(x ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const g = this._envGroups || {};
        const groups = [
            ['cycle', this.periodInfo?.kind === 'cycle' ? t('bv_section_cycle', 'Dépenses du cycle') : t('bv_section_month', 'Dépenses du mois'), g.cycle],
            ['yearly', t('bv_section_yearly', 'Enveloppes annuelles'), g.yearly],
            ['fixed', t('bv_section_fixed', 'Charges prévues'), g.fixed],
            ['dated', t('bv_section_dated', 'Enveloppes datées'), g.dated],
            ['long', t('bv_section_long', 'Suivis long terme'), g.long],
            ['projects', t('bv_section_projects', 'Projets'), g.projects],
            ['savings', t('budget_savings_section', 'Tirelires'), g.savings],
        ].filter(([, , list]) => list && list.length);
        const total = groups.reduce((n, [, , list]) => n + list.length, 0);
        const names = (list) => {
            const shown = list.slice(0, 3).map(b => esc(b.name)).join(', ');
            return list.length > 3 ? `${shown} +${list.length - 3}` : shown;
        };

        document.getElementById('bvBulkModal')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'bvBulkModal';
        overlay.className = 'bv-modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="bv-modal-panel bv-bulk" role="dialog" aria-modal="true" aria-labelledby="bvBulkTitle">
                <div class="bv-modal-header">
                    <h3 id="bvBulkTitle">${t('bv_bulk_title', 'Supprimer plusieurs enveloppes')}</h3>
                    <button type="button" class="bv-icon-btn" data-close aria-label="${t('btn_close', 'Fermer')}">${this._bvIcon('close', 18)}</button>
                </div>
                ${total ? `
                <p class="bv-bulk-hint">${t('bv_bulk_hint', 'Vos opérations ne sont pas touchées : seules les enveloppes disparaissent.')}</p>
                <div class="bv-bulk-list">
                    <label class="bv-bulk-row bv-bulk-all">
                        <input type="checkbox" id="bvBulkAll">
                        <span class="bv-bulk-text"><strong>${t('bv_bulk_all', 'Toutes les enveloppes')}</strong></span>
                        <span class="bv-fold-count">${total}</span>
                    </label>
                    ${groups.map(([key, label, list]) => `
                    <label class="bv-bulk-row">
                        <input type="checkbox" data-group="${key}">
                        <span class="bv-bulk-text"><strong>${esc(label)}</strong><span>${names(list)}</span></span>
                        <span class="bv-fold-count">${list.length}</span>
                    </label>`).join('')}
                </div>
                <p id="bvBulkWarn" class="bv-bulk-warn" hidden>${this._bvIcon('alert', 14)}<span>${t('bv_bulk_savings_warn', 'Les dépôts et retraits de ces tirelires sont supprimés avec elles.')}</span></p>
                ` : `<p class="bv-bulk-hint">${t('budget_no_active', 'Aucune enveloppe budgétaire active.')}</p>`}
                <div class="bv-modal-footer">
                    <button type="button" class="btn btn-secondary" data-close>${t('budget_btn_cancel', 'Annuler')}</button>
                    ${total ? `<button type="button" id="bvBulkConfirm" class="btn btn-danger" disabled>${t('bv_bulk_btn_none', 'Supprimer')}</button>` : ''}
                </div>
            </div>`;

        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        const boxes = () => [...overlay.querySelectorAll('input[data-group]')];
        const selectedIds = () => boxes().filter(x => x.checked)
            .flatMap(x => groups.find(([key]) => key === x.dataset.group)[2].map(b => b.id));
        const refresh = () => {
            const n = selectedIds().length;
            const all = overlay.querySelector('#bvBulkAll');
            const checked = boxes().filter(x => x.checked).length;
            all.checked = checked === boxes().length;
            all.indeterminate = checked > 0 && !all.checked;
            const btn = overlay.querySelector('#bvBulkConfirm');
            btn.disabled = n === 0;
            btn.textContent = n === 0 ? t('bv_bulk_btn_none', 'Supprimer')
                : (n > 1 ? t('bv_bulk_btn_many', 'Supprimer {count} enveloppes') : t('bv_bulk_btn_one', 'Supprimer {count} enveloppe')).split('{count}').join(n);
            overlay.querySelector('#bvBulkWarn').hidden = !boxes().some(x => x.checked && x.dataset.group === 'savings');
        };
        overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
        overlay.addEventListener('change', (e) => {
            if (e.target.id === 'bvBulkAll') boxes().forEach(x => { x.checked = e.target.checked; });
            refresh();
        });
        overlay.querySelector('#bvBulkConfirm')?.addEventListener('click', (e) => window.withButtonLoading(e.currentTarget, async () => {
            try {
                const res = await API.post('/api/budgets/bulk_delete', { budget_ids: selectedIds() });
                close();
                await this._reloadAfterBulkDelete();
                const n = res.deleted_count;
                const msg = (n > 1 ? t('bv_bulk_done_many', '{count} enveloppes supprimées') : t('bv_bulk_done_one', '{count} enveloppe supprimée')).split('{count}').join(n);
                showUndoToast(msg, res.action_id, () => this._reloadAfterBulkDelete());
            } catch (err) {
                showInlineMessage(t('title_error', 'Erreur'), err.message);
            }
        }));
        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);
        overlay.querySelector('[data-close]')?.focus();
    },

    async _reloadAfterBulkDelete() {
        await this.loadBudgets();
        if (typeof this.loadAutopilotSuggestions === 'function') await this.loadAutopilotSuggestions();
        await this.loadStatus();
        window.app.refreshSidebar();
    }
});
