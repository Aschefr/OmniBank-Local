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

    renderCatCheckboxes(selected = []) {
        const container = document.getElementById('budgetCatCheckboxes');
        if (!container) return;
        const t = (k, fb) => (window.i18n && window.i18n.t(k)) || fb;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const period = document.getElementById('newBudgetPeriod')?.value || 'monthly';
        const currentEditId = parseInt(document.getElementById('budgetEditId')?.value || 0);

        // Autres enveloppes ouvertes qui suivent déjà la catégorie : ses dépenses y seraient comptées deux fois
        const catToBudget = {};
        for (const b of (this.budgets || [])) {
            if (b.id === currentEditId || b.is_closed) continue;
            for (const c of (b.categories || [])) (catToBudget[c] = catToBudget[c] || []).push(b.name);
        }

        // Dépenses d'abord ; revenus, neutres et autres repliés tant qu'on ne les cherche pas
        const order = ['expense_var', 'expense_fixed', 'income', 'neutral', 'other'];
        const isSpendType = (type) => type === 'expense_var' || type === 'expense_fixed';
        const groups = {};
        for (const c of (this.categories || [])) {
            const key = order.includes(c.type) ? c.type : 'other';
            (groups[key] = groups[key] || []).push(c);
        }
        const term = document.getElementById('budgetCatSearch')?.value || '';
        const showOthers = this._showOtherCatTypes || !!term
            || selected.some(n => { const c = (this.categories || []).find(x => x.name === n); return c && !isSpendType(c.type); });
        const avgFor = (name) => {
            const a = this.catAverages?.[name]?.yearly_average || 0;
            return period === 'yearly' ? a * 12 : a;
        };
        const unit = period === 'yearly' ? t('bv_form_per_year', '/an') : t('bv_form_per_month', '/mois');

        let html = '';
        let hidden = 0;
        for (const key of order) {
            const cats = (groups[key] || []).filter(c => !term || window.permissiveMatch(c.name, term));
            if (!cats.length) continue;
            if (!isSpendType(key) && !showOthers) { hidden += cats.length; continue; }
            const title = key === 'other' ? t('budget_cat_other', 'Autres') : window.app.getTypeLabel(key);
            html += `
                <div class="bv-cat-group">
                    <div class="bv-cat-group-title">${esc(title)}</div>
                    <div class="bv-cat-grid">${cats.map(c => {
                        const on = selected.includes(c.name);
                        const avg = avgFor(c.name);
                        const elsewhere = catToBudget[c.name];
                        return `
                        <label class="bv-cat-opt${on ? ' is-checked' : ''}">
                            <input type="checkbox" name="budgetCat" value="${esc(c.name)}" ${on ? 'checked' : ''} onchange="window.BudgetsView.toggleCategorySelection(this)">
                            <span class="bv-cat-text">
                                <span class="bv-cat-name">${esc(c.name)}</span>
                                ${elsewhere ? `<span class="bv-cat-elsewhere" title="${esc(t('bv_form_cat_elsewhere_hint', 'Ses dépenses seront comptées dans les deux enveloppes'))}">${esc(t('bv_form_cat_elsewhere', 'aussi dans {names}').split('{names}').join(elsewhere.join(', ')))}</span>` : ''}
                            </span>
                            ${avg > 0 ? `<span class="bv-cat-avg privacy-blur">~${formatCurrency(avg)}${unit}</span>` : ''}
                        </label>`;
                    }).join('')}</div>
                </div>`;
        }
        if (hidden) {
            html += `<button type="button" class="bv-link-btn" onclick="window.BudgetsView._showOtherCatTypes = true; window.BudgetsView.renderCatCheckboxes(window.BudgetsView.selectedCategories)">${t('bv_form_cat_more', 'Afficher les revenus et autres catégories ({count})').split('{count}').join(hidden)}</button>`;
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
        if (!sel.length) {
            box.innerHTML = `<p class="bv-field-hint">${t('bv_form_cat_required', "Choisissez au moins une catégorie : sans catégorie, l'enveloppe ne suit aucune dépense.")}</p>`;
            return;
        }
        const period = document.getElementById('newBudgetPeriod')?.value || 'monthly';
        const monthly = sel.reduce((s, n) => s + (this.catAverages?.[n]?.yearly_average || 0), 0);
        const avg = period === 'yearly' ? monthly * 12 : monthly;
        const canUse = avg > 0 && (period === 'monthly' || period === 'yearly');
        const avgText = t(period === 'yearly' ? 'bv_form_cat_avg_year' : 'bv_form_cat_avg_month',
            period === 'yearly' ? 'Dépense habituelle : ~{amount} par an' : 'Dépense habituelle : ~{amount} par mois').split('{amount}').join(formatCurrency(avg));
        box.innerHTML = `
            <div class="bv-cat-chips">${sel.map(n => `
                <button type="button" class="bv-cat-chip" data-cat="${esc(n)}" onclick="window.BudgetsView.removeSelectedCat(this.dataset.cat)"
                        aria-label="${esc(t('bv_form_cat_remove', 'Retirer {name}').split('{name}').join(n))}">${esc(n)}${this._bvIcon('close', 12)}</button>`).join('')}
            </div>
            ${avg > 0 ? `<p class="bv-cat-sum"><span class="privacy-blur" title="${esc(t('bv_form_cat_avg_hint', 'Moyenne sur les 12 derniers mois'))}">${avgText}</span>${canUse
                ? `<button type="button" class="bv-link-btn" onclick="window.BudgetsView.useCatAverage(${Math.round(avg * 100) / 100})">${t('bv_form_use_avg', 'Reprendre comme plafond')}</button>` : ''}</p>` : ''}`;
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
        if (isSavings) document.getElementById('newBudgetPeriod').value = 'indefinite';
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

        // Rechargement sur place (après un réglage) : on garde le contenu affiché jusqu'à la nouvelle version
        const isRefresh = modal.style.display === 'flex' && graph.dataset.budgetId === String(budgetId);
        if (!isRefresh) {
            graph.innerHTML = `<p class="bv-detail-loading">${t('budget_loading', 'Chargement…')}</p>`;
            list.innerHTML = '';
        }
        graph.dataset.budgetId = String(budgetId);
        modal.style.display = 'flex';
        this._bindUnifiedKeys();

        const lang = (window.i18n?.currentLang || window.i18n?.lang || 'fr') === 'en' ? 'en-US' : 'fr-FR';
        const thisYear = new Date().getFullYear();
        const todayIso = new Date().toISOString().slice(0, 10);
        const fmtOpDate = (iso) => {
            const d = new Date(iso + 'T00:00:00');
            return d.toLocaleDateString(lang, d.getFullYear() === thisYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
        };
        const fmtDay = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short' }) : '';
        const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '?';

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

            const opRow = (it) => {
                const planned = it.date > todayIso;
                return `
                <li class="bv-op${planned ? ' bv-op--planned' : ''}">
                    <span class="bv-op-date">${fmtOpDate(it.date)}</span>
                    <span class="bv-op-desc">
                        <span class="bv-op-label">${it.label}</span>
                        ${planned ? `<span class="bv-op-tag">${t('bv_op_planned', 'prévue')}</span>` : ''}
                    </span>
                    ${it.category ? `<span class="bv-op-cat">${esc(it.category)}</span>` : '<span></span>'}
                    <span class="bv-op-amount privacy-blur${it.isIncome ? ' bv-op-amount--in' : ''}">${it.isIncome ? '+' : (it.sign || '')}${formatCurrency(Math.abs(it.amount))}</span>
                    ${it.action || ''}
                </li>`;
            };
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
            let periodLabel = '';
            if (budget?.is_project) {
                periodLabel = t('bv_form_type_project', 'Projet');
            } else if (period === 'monthly') {
                const p = this.periodInfo;
                periodLabel = this.customPeriod?.enabled
                    ? tp('bv_dated_range', { start: fmtDate(this.customPeriod.start), end: fmtDate(this.customPeriod.end) }, 'Du {start} au {end}')
                    : p?.kind === 'cycle'
                        ? tp('bv_period_cycle', { start: fmtDay(p.start), end: fmtDay(p.end) }, 'Cycle du {start} au {end}')
                        : p ? new Date(p.start + 'T00:00:00').toLocaleDateString(lang, { month: 'long', year: 'numeric' }) : '';
            } else if (period === 'yearly') {
                periodLabel = tp('bv_detail_year', { year }, 'Année {year}');
            } else if (period === 'custom') {
                periodLabel = tp('bv_dated_range', { start: fmtDate(budget.start_date), end: fmtDate(budget.end_date) }, 'Du {start} au {end}');
            } else {
                periodLabel = t('bv_detail_all_time', 'Toutes périodes');
            }
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
        document.getElementById('newBudgetAmount').value = b.monthly_amount;
        document.getElementById('newBudgetPeriod').value = b.period;
        document.getElementById('newBudgetStartDate').value = b.start_date || '';
        document.getElementById('newBudgetEndDate').value = b.end_date || '';
        document.getElementById('budgetCustomDates').style.display = b.period === 'custom' ? '' : 'none';
        if (b.is_project) document.getElementById('budgetTypeProject').checked = true;
        else if ((b.envelope_type || 'spending') === 'savings') document.getElementById('budgetTypeSavings').checked = true;
        else document.getElementById('budgetTypeCategory').checked = true;
        document.getElementById('budgetTypeRow').style.display = 'none';
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
        this.toggleType();
        this.renderAccountCheckboxes([]);
        document.getElementById('budgetCatSearch').value = '';
        this._showOtherCatTypes = false;
        this.selectedCategories = [];
        this.renderCatCheckboxes(this.selectedCategories);
        document.getElementById('budgetIsLocked').checked = false;
        document.getElementById('budgetArchiveSection').style.display = 'none';

        document.getElementById('budgetFormSection').style.display = 'block';
        const modal = document.getElementById('budgetUnifiedModal');
        modal.style.display = 'flex';
        modal.scrollTop = 0;
        this._bindUnifiedKeys();
        document.getElementById('newBudgetName').focus();
    },

    closeUnifiedModal() {
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

    showBulkDeleteModal() {
        const panel = document.getElementById('budgetBulkDeletePanel');
        if (panel) {
            const isHidden = panel.style.display === 'none' || !panel.style.display;
            panel.style.display = isHidden ? 'block' : 'none';
        }
    },

    closeBulkDeleteModal() {
        const panel = document.getElementById('budgetBulkDeletePanel');
        if (panel) panel.style.display = 'none';
    },

    async confirmBulkDelete() {
        const selected = document.querySelector('input[name="bulkDeleteType"]:checked')?.value || 'spending';
        const btn = document.getElementById('btnConfirmBulkDelete');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('budget_bulk_delete_confirm') || 'En cours...'}`;
        }

        try {
            const res = await API.post('/api/budgets/bulk_delete', { target_type: selected });
            this.closeBulkDeleteModal();
            await this.loadBudgets();
            if (typeof this.loadAutopilotSuggestions === 'function') {
                await this.loadAutopilotSuggestions();
            }
            await this.loadStatus();
            window.app.refreshSidebar();
            showInlineMessage(window.i18n.t('title_info'), `${res.deleted_count} enveloppe(s) supprimée(s).`);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message || 'Erreur lors de la suppression.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = window.i18n.t('budget_bulk_delete_confirm') || 'Confirmer la suppression';
            }
        }
    }
});
