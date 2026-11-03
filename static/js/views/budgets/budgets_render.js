// static/js/views/budgets/budgets_render.js
// Enveloppes Budgétaires v2 — HTML Rendering & Visual Cards UI

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    render() {
        return `
        <div>
            <div class="bv-header view-header">
                <div class="view-header-title-group" style="display:flex; align-items:center; gap:10px;">
                    <h2 data-i18n="budget_title">${window.i18n.t('budget_title')}</h2>
                    <button id="btnBudgetsBackToSource" class="btn btn-secondary toolbar-btn${this.backToView ? ' visible' : ''}" style="${this.backToView ? 'display:inline-flex;' : 'display:none;'} align-items:center; gap:6px; font-size:12.5px; height:34px; border-radius:8px; padding:0 12px; font-weight:600; cursor:pointer;" onclick="const v = window.BudgetsView.backToView || 'chat'; window.BudgetsView.backToView = null; window.app.loadView(v)" title="${window.i18n ? (window.i18n.t('btn_back') || 'Retour') : 'Retour'}">
                        <span>⬅️</span> <span data-i18n="btn_back">${window.i18n ? (window.i18n.t('btn_back') || 'Retour') : 'Retour'}</span>
                    </button>
                </div>
                <div class="bv-header-actions">
                    <div class="bv-tools">
                        <button type="button" id="bvToolsBtn" class="btn btn-secondary bv-tools-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="bvToolsMenu" onclick="window.BudgetsView.toggleToolsMenu(event)">
                            ${this._bvIcon('sliders')}<span>${window.i18n.t('bv_tools') || 'Outils'}</span>${this._bvIcon('chevronDown', 14)}
                        </button>
                        <div id="bvToolsMenu" class="bv-tools-menu" role="menu" hidden>
                            <button type="button" role="menuitem" onclick="window.BudgetsView.openBudgetAutomationsModal()">
                                ${this._bvIcon('sliders')}<span>${this._stripEmoji(window.i18n.t('budget_automations_btn') || 'Automatismes')}</span>
                            </button>
                            <button type="button" role="menuitem" id="budgetAiBtn" onclick="window.BudgetsView.openSuggestions()">
                                ${this._bvIcon('bulb')}<span>${window.i18n.t('sg_menu') || "Suggestions d'enveloppes"}</span>
                            </button>
                            <button type="button" role="menuitem" onclick="window.BudgetsView.openDisplayPrefs()">
                                ${this._bvIcon('pin')}<span>${window.i18n.t('bv_prefs_menu') || "Personnaliser l'affichage"}</span>
                            </button>
                            <button type="button" role="menuitem" class="bv-tools-danger" onclick="window.BudgetsView.showBulkDeleteModal()">
                                ${this._bvIcon('trash')}<span>${this._stripEmoji(window.i18n.t('budget_btn_bulk_delete') || 'Nettoyer')}</span>
                            </button>
                        </div>
                    </div>
                    <button type="button" class="btn btn-primary bv-btn-new" onclick="window.BudgetsView.showAddForm()">
                        ${this._bvIcon('plus')}<span>${this._stripEmoji((window.i18n.t('budget_btn_new') || 'Nouvelle enveloppe').replace(/^\+\s*/, ''))}</span>
                    </button>
                </div>
            </div>

            <!-- Inline Bulk Delete Panel -->
            <div id="budgetBulkDeletePanel" style="display:none;margin-bottom:24px;background:var(--bg-surface);border:1px solid #ef4444;border-radius:12px;padding:20px;box-shadow:0 4px 12px rgba(239,68,68,0.15);">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <strong style="color:#ef4444;font-size:15px;" data-i18n="budget_bulk_delete_title">${window.i18n.t('budget_bulk_delete_title') || 'Suppression groupée d\'enveloppes'}</strong>
                    <button class="btn btn-secondary" style="padding:3px 10px;font-size:12px;" onclick="window.BudgetsView.closeBulkDeleteModal()">✕</button>
                </div>
                <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;" data-i18n="budget_bulk_delete_prompt">${window.i18n.t('budget_bulk_delete_prompt') || 'Choisissez la catégorie d\'enveloppes à supprimer :'}</p>
                <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;background:var(--bg-base);padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);">
                        <input type="radio" name="bulkDeleteType" value="monthly" checked>
                        <span data-i18n="budget_bulk_delete_type_monthly">${window.i18n.t('budget_bulk_delete_type_monthly') || 'Enveloppes mensuelles'}</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;background:var(--bg-base);padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);">
                        <input type="radio" name="bulkDeleteType" value="yearly">
                        <span data-i18n="budget_bulk_delete_type_yearly">${window.i18n.t('budget_bulk_delete_type_yearly') || 'Enveloppes annuelles'}</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;background:var(--bg-base);padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);">
                        <input type="radio" name="bulkDeleteType" value="project">
                        <span data-i18n="budget_bulk_delete_type_project">${window.i18n.t('budget_bulk_delete_type_project') || 'Projets'}</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;background:var(--bg-base);padding:8px 12px;border-radius:8px;border:1px solid var(--border-color);">
                        <input type="radio" name="bulkDeleteType" value="savings">
                        <span data-i18n="budget_bulk_delete_type_savings">${window.i18n.t('budget_bulk_delete_type_savings') || 'Tirelires d\'épargne'}</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:13px;background:var(--bg-base);padding:8px 12px;border-radius:8px;border:1px solid #ef4444;color:#ef4444;font-weight:600;">
                        <input type="radio" name="bulkDeleteType" value="all">
                        <span data-i18n="budget_bulk_delete_type_all">${window.i18n.t('budget_bulk_delete_type_all') || '⚠️ TOUTES LES ENVELOPPES'}</span>
                    </label>
                </div>
                <div style="display:flex;gap:10px;">
                    <button id="btnConfirmBulkDelete" class="btn" style="background:#ef4444;color:white;border:none;padding:8px 16px;font-size:13px;font-weight:600;" onclick="window.BudgetsView.confirmBulkDelete()" data-i18n="budget_bulk_delete_confirm">${window.i18n.t('budget_bulk_delete_confirm') || 'Confirmer la suppression'}</button>
                    <button class="btn btn-secondary" onclick="window.BudgetsView.closeBulkDeleteModal()" data-i18n="budget_bulk_delete_cancel">${window.i18n.t('budget_bulk_delete_cancel') || 'Annuler'}</button>
                </div>
            </div>

            <!-- Compact Minimized Strip for AI Suggestions (when temporarily hidden) -->
            <!-- Status this month -->
            <div id="budgetStatusContainer" style="margin-bottom:30px;"></div>

            <!-- Unified Modal (Details + Add/Edit Form) -->
            <div id="budgetUnifiedModal" class="modal-overlay" style="display:none;" onclick="if(event.target===this) window.BudgetsView.closeUnifiedModal()">
                <div class="modal budget-unified-panel" role="dialog" aria-modal="true" aria-labelledby="budgetUnifiedTitle">
                    
                    <div class="bv-unified-head">
                        <h3 id="budgetUnifiedTitle">${window.i18n.t('budget_modal_title')}</h3>
                        <div class="bv-unified-head-actions">
                            <button type="button" id="budgetUnifiedEditBtn" class="btn btn-secondary bv-btn-compact" hidden onclick="window.BudgetsView.showEditSection()">
                                ${this._bvIcon('pencil', 14)}<span>${window.i18n.t('tooltip_edit') || 'Modifier'}</span>
                            </button>
                            <button type="button" class="bv-icon-btn" onclick="window.BudgetsView.closeUnifiedModal()" aria-label="${window.i18n.t('btn_close') || 'Fermer'}" title="${window.i18n.t('btn_close') || 'Fermer'}">${this._bvIcon('close', 18)}</button>
                        </div>
                    </div>

                    <!-- DETAIL SECTION -->
                    <div id="budgetDetailSection" style="display:none;">
                        <div id="budgetDetailGraph"></div>
                        <div id="budgetDetailList"></div>
                    </div>

                    <!-- FORM SECTION : création et modification (remplace le détail, Annuler y revient) -->
                    <div id="budgetFormSection" class="bv-form" style="display:none;">
                      <div class="bv-form-body">
                       <div class="bv-form-main">
                        <input type="hidden" id="budgetEditId">

                        <div id="budgetTypeRow" class="bv-field">
                            <span class="bv-field-label">${window.i18n.t('bv_form_type') || "Type d'enveloppe"}</span>
                            <div class="bv-seg">
                                <label class="bv-seg-opt"><input type="radio" name="budgetType" value="category" id="budgetTypeCategory" checked onchange="window.BudgetsView.toggleType()"><span>${window.i18n.t('bv_form_type_cat') || 'Dépenses par catégories'}</span></label>
                                <label class="bv-seg-opt"><input type="radio" name="budgetType" value="project" id="budgetTypeProject" onchange="window.BudgetsView.toggleType()"><span>${window.i18n.t('bv_form_type_project') || 'Projet'}</span></label>
                                <label class="bv-seg-opt"><input type="radio" name="budgetType" value="savings" id="budgetTypeSavings" onchange="window.BudgetsView.toggleType()"><span>${window.i18n.t('bv_form_type_savings') || 'Tirelire'}</span></label>
                            </div>
                            <p id="budgetTypeHint" class="bv-field-hint"></p>
                        </div>

                        <label class="bv-field">
                            <span class="bv-field-label">${window.i18n.t('budget_label_name') || "Nom de l'enveloppe"}</span>
                            <input type="text" id="newBudgetName" class="inline-input" maxlength="80" placeholder="${window.i18n.t('bv_form_name_ph') || 'Ex. : Courses, Vacances à Saint-Malo…'}">
                        </label>

                        <div class="bv-field-row">
                            <label class="bv-field">
                                <span class="bv-field-label" id="budgetAmountLabel">${window.i18n.t('bv_detail_limit') || 'Plafond'}</span>
                                <span class="bv-input-suffix">
                                    <input type="number" id="newBudgetAmount" class="inline-input" placeholder="0,00" min="0" step="0.01" inputmode="decimal">
                                    <span aria-hidden="true">€</span>
                                </span>
                            </label>
                            <label class="bv-field" id="budgetPeriodField">
                                <span class="bv-field-label">${window.i18n.t('budget_label_period') || 'Période'}</span>
                                <select id="newBudgetPeriod" class="inline-input" onchange="window.BudgetsView.onPeriodChange()">
                                    <option value="monthly">${window.i18n.t('budget_opt_monthly') || 'Mensuel'}</option>
                                    <option value="yearly">${window.i18n.t('budget_opt_yearly') || 'Annuel'}</option>
                                    <option value="indefinite">${window.i18n.t('bv_form_period_long') || 'Long terme, sans échéance'}</option>
                                    ${(window.app?.config?.enable_org_mode === 'true') ? `<option value="custom">${window.i18n.t('budget_opt_custom') || 'Défini dans le temps'}</option>` : ''}
                                </select>
                            </label>
                        </div>

                        <div id="budgetCustomDates" class="bv-field" style="display:none;">
                            <span class="bv-field-label">${window.i18n.t('bv_form_dates') || 'Dates'}</span>
                            <div class="bv-date-range">
                                <input type="date" id="newBudgetStartDate" class="inline-input" onchange="window.BudgetsView.onPeriodChange()" aria-label="${window.i18n.t('bv_custom_start') || 'Début'}">
                                <span aria-hidden="true">→</span>
                                <input type="date" id="newBudgetEndDate" class="inline-input" onchange="window.BudgetsView.onPeriodChange()" aria-label="${window.i18n.t('bv_custom_end') || 'Fin'}">
                            </div>
                        </div>

                        <div id="budgetAccountSection" class="bv-field" style="${(window.app?.config?.enable_org_mode === 'true') ? '' : 'display:none;'}">
                            <span class="bv-field-label">${window.i18n.t('budget_account_filter') || 'Périmètre comptes'}</span>
                            <div id="budgetAccountCheckboxes" class="bv-acc-picks"></div>
                        </div>

                        <div id="budgetCatSection" class="bv-field">
                            <span class="bv-field-label">${window.i18n.t('bv_form_cats') || 'Catégories suivies'}</span>
                            <div id="budgetCatSelected" class="bv-cat-selected"></div>
                            <input type="search" id="budgetCatSearch" class="inline-input" placeholder="${window.i18n.t('bv_form_cat_search') || 'Ajouter une catégorie…'}"
                                   oninput="window.BudgetsView.renderCatCheckboxes(window.BudgetsView.selectedCategories)">
                            <div id="budgetCatCheckboxes" class="bv-cat-list"></div>
                        </div>

                        <label id="budgetLockSection" class="bv-switch bv-form-lock">
                            <input type="checkbox" id="budgetIsLocked">
                            <span>${window.i18n.t('bv_detail_lock') || 'Verrouiller'}<span class="bv-field-hint"> · ${window.i18n.t('bv_form_lock_hint') || "l'Auto-Pilote ne propose plus d'ajuster le plafond"}</span></span>
                        </label>

                       </div>
                       <aside id="budgetFormPreview" class="bv-form-preview" aria-live="polite" hidden></aside>
                      </div>

                        <div class="bv-form-foot">
                            <div id="budgetArchiveSection" style="display:none;">
                                <button type="button" id="budgetToggleCloseBtn" class="btn btn-secondary bv-btn-compact" onclick="window.BudgetsView.toggleCloseFromModal()"><span id="budgetToggleCloseText"></span></button>
                            </div>
                            <div class="bv-form-actions">
                                <button type="button" class="btn btn-secondary" onclick="window.BudgetsView.hideEditSection()">${window.i18n.t('budget_btn_cancel') || 'Annuler'}</button>
                                <button type="button" id="budgetSaveBtn" class="btn btn-primary" onclick="window.BudgetsView.saveForm(this)">${window.i18n.t('budget_btn_save') || 'Enregistrer'}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    },

    _buildAccountSelect(selectId, hostedPerAccount) {
        const activeAccounts = this.accounts ? this.accounts.filter(a => !a.is_closed) : [];
        const mainAccount = activeAccounts.find(a => a.type === 'Compte courant' || a.is_main) || (activeAccounts.length > 0 ? activeAccounts[0] : null);
        const secondaryAccounts = mainAccount ? activeAccounts.filter(a => a.id !== mainAccount.id) : activeAccounts;

        let mainHosted = (hostedPerAccount['main'] || 0.0);
        if (mainAccount && hostedPerAccount[mainAccount.id]) {
            mainHosted += hostedPerAccount[mainAccount.id];
        }

        const mainAccTitle = mainAccount ? `${mainAccount.name} (${window.i18n.t('budget_main_account_tag') || 'Compte principal'})` : (window.i18n.t('budget_alloc_default_account') || 'Compte courant principal');
        const suffix = window.i18n.t('budget_hosted_suffix') || 'dans la tirelire';
        const tooltip = window.i18n.t('budget_alloc_select_tooltip') || 'Compte bancaire source (Dépôt) ou destination (Retrait)';

        const mainOptionLabel = `🏦 ${mainAccTitle} · ${formatCurrency(mainHosted)} ${suffix}`;

        const optionsHtml = secondaryAccounts.map(a => {
            const h = hostedPerAccount[a.id] || 0.0;
            return `<option value="${a.id}">🏦 ${a.name} · ${formatCurrency(h)} ${suffix}</option>`;
        }).join('');

        return `
            <select id="${selectId}" class="inline-input" title="${tooltip}" style="font-size:12px;padding:6px 10px;border-radius:6px;min-width:200px;max-width:260px;">
                <option value="">${mainOptionLabel}</option>
                ${optionsHtml}
            </select>
        `;
    },

    // Icônes au trait (même famille que le reste de l'interface), héritent de currentColor
    _bvIcon(name, size = 16) {
        const paths = {
            pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
            trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
            lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
            chevronLeft: '<path d="m15 18-6-6 6-6"/>',
            chevronRight: '<path d="m9 18 6-6-6-6"/>',
            chevronDown: '<path d="m6 9 6 6 6-6"/>',
            sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
            bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2Z"/>',
            plus: '<path d="M12 5v14M5 12h14"/>',
            pin: '<path d="M12 17v5"/><path d="M9 10.76V4h6v6.76a2 2 0 0 0 1.11 1.79l1.78.9A2 2 0 0 1 19 15.24V17H5v-1.76a2 2 0 0 1 1.11-1.79l1.78-.9A2 2 0 0 0 9 10.76Z"/>',
            close: '<path d="M18 6 6 18M6 6l12 12"/>',
            alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
        };
        return `<svg class="bv-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
    },

    // État d'une enveloppe de dépenses : mêmes chiffres et mêmes mots sur la carte et dans sa fenêtre
    _envGauge(b) {
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const tp = (key, params, fallback) => {
            let s = t(key, fallback);
            for (const [k, v] of Object.entries(params || {})) s = s.split(`{${k}}`).join(v);
            return s;
        };
        const isOrg = window.app?.config?.enable_org_mode === 'true';
        const isCurrentPeriod = b.period === 'yearly'
            ? this.yearlyYear === new Date().getFullYear()
            : !this.customPeriod?.enabled && (this.cycleOffset || 0) === 0;
        const todayIso = new Date().toISOString().slice(0, 10);
        const limit = b.budget_amount || 0;
        const spent = b.spent_to_date ?? b.spent ?? 0;
        const planned = b.planned || 0;
        const pct = limit > 0 ? (spent / limit) * 100 : 0;
        const plannedPct = limit > 0 ? (planned / limit) * 100 : 0;
        const status = b.status || 'ok';
        const fixed = !isOrg && b.is_fixed_charges;
        const ended = b.period === 'custom' && b.end_date && b.end_date < todayIso;
        const tone = (fixed && status === 'ok') || (ended && status !== 'over') ? 'fixed' : status;
        const remaining = limit - spent;
        // Même règle que le serveur : pas de repère de rythme avant 15 % de la période
        const showPace = b.expected_percent !== null && b.expected_percent !== undefined && b.expected_percent >= 15 && !fixed && isCurrentPeriod;

        let statusText;
        if (status === 'over') {
            statusText = tp('bv_status_over', { amount: formatCurrency(spent - limit) }, 'Dépassée de {amount}');
        } else if (status === 'near' && remaining <= 0.5) {
            statusText = t('bv_status_empty', 'Épuisée');
        } else {
            statusText = tp('bv_status_left', { amount: formatCurrency(Math.max(remaining, 0)) }, 'Reste {amount}');
            if (status === 'ahead') statusText = `${t('bv_status_ahead', 'En avance sur le rythme')} · ${statusText}`;
        }
        if (planned > 0.005) {
            statusText += ` · ${tp('bv_planned', { amount: formatCurrency(planned) }, '{amount} prévus')}`;
        }
        if (ended && status !== 'over') statusText = t('bv_status_ended', 'Terminée');
        return { limit, spent, planned, pct, plannedPct, tone, showPace, statusText, expected: b.expected_percent };
    },

    // Enveloppe héritée d'une version précédente : sans catégorie, ou catégorie suivie aussi ailleurs
    _envIssue(b) {
        if (b.is_closed || b.is_project || (b.envelope_type || 'spending') !== 'spending') return null;
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const cats = b.categories || [];
        if (!cats.length) return t('bv_env_no_cats', 'Aucune catégorie : cette enveloppe ne suit aucune dépense.');
        const owners = this._conflictsFor({ id: b.id, period: b.period || 'monthly', start: b.start_date, end: b.end_date, accounts: b.account_ids || [] });
        const shared = cats.filter(c => owners[c]);
        if (!shared.length) return null;
        if (shared.length > 1) return t('bv_env_shared_many', '{count} catégories sont aussi suivies ailleurs : leurs dépenses comptent deux fois.').split('{count}').join(shared.length);
        return t('bv_env_shared_one', '« {category} » est aussi suivie par {names} : ses dépenses comptent deux fois.')
            .split('{category}').join(esc(shared[0])).split('{names}').join(esc(owners[shared[0]].join(', ')));
    },

    // Une seule fois, pour les profils qui avaient déjà des enveloppes avant la nouvelle page
    _updateNoticeHtml(isOrg) {
        if (window.app?.config?.budget_update_notice !== 'true') return '';
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const items = [
            isOrg ? '' : t('bv_notice_cycle', "Vos enveloppes mensuelles suivent votre cycle de paie, et non plus le mois calendaire : leurs montants peuvent différer de ce que vous aviez l'habitude de voir."),
            t('bv_notice_bars', "Les barres montrent le dépensé à ce jour et, en hachuré, ce qui est prévu d'ici la fin de la période (elles montraient les dépenses rapprochées)."),
            isOrg ? '' : t('bv_notice_fixed', "Les enveloppes de charges fixes sont regroupées dans « Charges prévues » et ne comptent plus dans les totaux. Vous pouvez les réintégrer dans Outils > Personnaliser l'affichage."),
            t('bv_notice_issues', 'Une enveloppe sans catégorie, ou dont une catégorie est aussi suivie ailleurs, est signalée sur sa carte.'),
        ].filter(Boolean);
        return `
            <section class="bv-notice" role="status">
                <div class="bv-notice-body">
                    <h3>${t('bv_notice_title', 'La page Budgets a évolué')}</h3>
                    <ul>${items.map(i => `<li>${i}</li>`).join('')}</ul>
                </div>
                <button type="button" class="btn btn-secondary bv-btn-compact" onclick="window.BudgetsView.saveBudgetPrefs({ budget_update_notice: 'false' })">${t('bv_notice_ok', 'Compris')}</button>
            </section>`;
    },

    _envBarHtml(g) {
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const fill = Math.min(g.pct, 100);
        return `
                <div class="bv-env-bar" role="img" aria-label="${t('bv_bar_label', '{pct} % utilisés').split('{pct}').join(Math.round(g.pct))}">
                    <span class="bv-env-fill" style="width:${fill}%"></span>
                    ${g.plannedPct > 0.5 && g.pct < 100 ? `<span class="bv-env-planned" style="left:${fill}%;width:${Math.min(g.plannedPct, 100 - fill)}%"></span>` : ''}
                    ${g.showPace ? `<span class="bv-env-pace" style="left:${Math.min(g.expected, 100)}%" title="${t('bv_pace_marker', "Rythme attendu aujourd'hui : {pct} %").split('{pct}').join(Math.round(g.expected))}"></span>` : ''}
                </div>`;
    },

    _stripEmoji(label) {
        return (label || '').replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+/u, '').trim();
    },

    // Préférences d'affichage (propres au profil, enregistrées côté serveur)
    _budgetPrefs() {
        const cfg = window.app?.config || {};
        let pinned = [];
        try { pinned = JSON.parse(cfg.budget_pinned_ids || '[]').map(Number).filter(Boolean); } catch (e) { pinned = []; }
        let labels = {};
        try { labels = JSON.parse(cfg.budget_sidebar_labels || '{}') || {}; } catch (e) { labels = {}; }
        return {
            pinned,
            labels,
            sidebarTotals: cfg.budget_sidebar_totals !== 'false',
            excludeFixed: cfg.budget_totals_exclude_fixed !== 'false',
        };
    },

    async saveBudgetPrefs(patch, { keepNames = false } = {}) {
        try {
            await API.post('/api/config/', patch);
            if (window.app) window.app.config = { ...(window.app.config || {}), ...patch };
            this.renderStatus();
            await window.app?.refreshSidebar();
            // La liste des noms suit ce que montre la barre latérale (épinglage, totaux affichés ou non)
            const names = document.getElementById('bvPrefsNames');
            if (names && !keepNames) names.innerHTML = this._prefsNamesHtml();
        } catch (e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async setSidebarLabel(key, value) {
        const labels = { ...this._budgetPrefs().labels };
        const v = (value || '').trim();
        if (v) labels[key] = v; else delete labels[key];
        await this.saveBudgetPrefs({ budget_sidebar_labels: JSON.stringify(labels) }, { keepNames: true });
    },

    // Noms affichés dans la barre latérale : une ligne par élément visible, dans le même ordre
    _prefsNamesHtml() {
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
        const items = window.app?.sidebarBudgetItems || [];
        const labels = this._budgetPrefs().labels;
        const rows = items.map(it => `
            <label class="bv-pref-name">
                <span class="bv-pref-name-default">${esc(it.label)}</span>
                <input type="text" class="inline-input" maxlength="40" value="${esc(labels[it.key] || '')}" placeholder="${esc(it.label)}"
                       aria-label="${esc(t('bv_prefs_name_for', 'Nom affiché pour {name}').split('{name}').join(it.label))}"
                       data-label-key="${esc(it.key)}" onchange="window.BudgetsView.setSidebarLabel(this.dataset.labelKey, this.value)">
            </label>`).join('');
        return `
            <h4>${t('bv_prefs_names', 'Noms dans la barre latérale')}</h4>
            ${items.length
                ? `<p class="bv-pref-hint">${t('bv_prefs_names_hint', "Un nom plus court ou plus parlant, visible uniquement dans la barre latérale. Laissez vide pour garder le nom d'origine.")}</p>
                   <div class="bv-pref-names">${rows}</div>`
                : `<p class="bv-pref-hint">${t('bv_prefs_names_empty', "Rien n'est affiché dans la barre latérale pour l'instant.")}</p>`}`;
    },

    isPinned(id) {
        return this._budgetPrefs().pinned.includes(id);
    },

    async togglePin(id) {
        const pinned = this._budgetPrefs().pinned;
        const next = pinned.includes(id) ? pinned.filter(x => x !== id) : [...pinned, id];
        await this.saveBudgetPrefs({ budget_pinned_ids: JSON.stringify(next) });
    },

    openDisplayPrefs() {
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const isOrg = window.app?.config?.enable_org_mode === 'true';
        const prefs = this._budgetPrefs();
        const periodName = { monthly: t('period_monthly', 'Mensuel'), yearly: t('period_yearly', 'Annuel'),
            custom: t('budget_period_custom', 'Datée'), indefinite: t('period_undefined', 'Indéfini') };
        const envs = (this.statusData?.budgets || [])
            .filter(b => (b.envelope_type || 'spending') !== 'savings' && !b.is_closed)
            .sort((a, b) => {
                const pa = prefs.pinned.indexOf(a.id), pb = prefs.pinned.indexOf(b.id);
                if (pa !== -1 || pb !== -1) return (pa === -1 ? 1e9 : pa) - (pb === -1 ? 1e9 : pb);
                return a.name.localeCompare(b.name);
            });
        const envList = envs.length ? envs.map(b => `
            <label class="bv-pref-env">
                <input type="checkbox" ${prefs.pinned.includes(b.id) ? 'checked' : ''} onchange="window.BudgetsView.togglePin(${b.id})">
                <span class="bv-pref-env-name">${b.name}</span>
                <span class="bv-pref-env-period">${periodName[b.period || 'monthly'] || ''}</span>
            </label>`).join('') : `<p class="bv-pref-hint">${t('bv_prefs_no_env', 'Aucune enveloppe de dépenses.')}</p>`;

        document.getElementById('bvPrefsModal')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'bvPrefsModal';
        overlay.className = 'bv-modal-overlay';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="bv-modal-panel bv-prefs" role="dialog" aria-modal="true" aria-labelledby="bvPrefsTitle">
                <div class="bv-modal-header">
                    <h3 id="bvPrefsTitle">${t('bv_prefs_title', "Personnaliser l'affichage")}</h3>
                    <button type="button" class="bv-icon-btn" data-close aria-label="${t('btn_close', 'Fermer')}">${this._bvIcon('close', 18)}</button>
                </div>
                <section class="bv-pref-group">
                    <h4>${t('bv_prefs_sidebar', 'Barre latérale')}</h4>
                    <p class="bv-pref-hint">${t('bv_prefs_pin_hint', "Épinglez les enveloppes à garder sous les yeux : elles s'affichent en tête de la barre latérale.")}</p>
                    <div class="bv-pref-envs">${envList}</div>
                    <label class="bv-switch bv-pref-switch">
                        <input type="checkbox" ${prefs.sidebarTotals ? 'checked' : ''} onchange="window.BudgetsView.saveBudgetPrefs({ budget_sidebar_totals: this.checked ? 'true' : 'false' })">
                        <span>${t('bv_prefs_show_totals', 'Afficher aussi les totaux par période')}</span>
                    </label>
                </section>
                <section class="bv-pref-group" id="bvPrefsNames">${this._prefsNamesHtml()}</section>
                ${isOrg ? '' : `
                <section class="bv-pref-group">
                    <h4>${t('bv_prefs_totals', 'Totaux')}</h4>
                    <label class="bv-switch bv-pref-switch">
                        <input type="checkbox" ${prefs.excludeFixed ? 'checked' : ''} onchange="window.BudgetsView.saveBudgetPrefs({ budget_totals_exclude_fixed: this.checked ? 'true' : 'false' })">
                        <span>${t('bv_prefs_exclude_fixed', 'Exclure les charges prévues des totaux')}</span>
                    </label>
                    <p class="bv-pref-hint">${t('bv_prefs_exclude_fixed_hint', 'Les totaux ne comptent alors que les dépenses libres ; les charges prévues restent suivies dans leur propre groupe.')}</p>
                </section>`}
                <div class="bv-modal-footer">
                    <button type="button" class="btn btn-secondary" data-close>${t('btn_close', 'Fermer')}</button>
                </div>
            </div>`;
        const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (e) => { if (e.key === 'Escape') close(); };
        overlay.addEventListener('click', (e) => { if (e.target === overlay || e.target.closest('[data-close]')) close(); });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);
        overlay.querySelector('[data-close]')?.focus();
    },

    toggleToolsMenu(event) {
        if (event) event.stopPropagation();
        const menu = document.getElementById('bvToolsMenu');
        const btn = document.getElementById('bvToolsBtn');
        if (!menu || !btn) return;
        const open = menu.hasAttribute('hidden');
        menu.toggleAttribute('hidden', !open);
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) {
            const close = (e) => {
                if (e.type === 'keydown' && e.key !== 'Escape') return;
                if (e.type === 'click' && menu.contains(e.target)) return;
                menu.setAttribute('hidden', '');
                btn.setAttribute('aria-expanded', 'false');
                document.removeEventListener('click', close);
                document.removeEventListener('keydown', close);
            };
            setTimeout(() => {
                document.addEventListener('click', close);
                document.addEventListener('keydown', close);
            }, 0);
        }
    },

    renderStatus() {
        const container = document.getElementById('budgetStatusContainer');
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const tp = (key, params, fallback) => {
            let s = t(key, fallback);
            for (const [k, v] of Object.entries(params || {})) s = s.split(`{${k}}`).join(v);
            return s;
        };
        const lang = (window.i18n?.currentLang || window.i18n?.lang || 'fr') === 'en' ? 'en-US' : 'fr-FR';
        const fmtDay = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short' }) : '';
        const fmtDate = (iso) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString(lang, { day: '2-digit', month: '2-digit', year: 'numeric' }) : '?';
        const isOrg = window.app?.config?.enable_org_mode === 'true';
        const all = this.statusData?.budgets || [];
        const period = this.periodInfo || null;
        const isCurrentPeriod = !this.customPeriod.enabled && (this.cycleOffset || 0) === 0;
        const isMonthly = (b) => !b.period || b.period === 'monthly';

        // ── Tri par urgence : dépassées, proches de la limite, en avance sur le rythme, puis le reste ──
        const rank = { over: 0, near: 1, ahead: 2, ok: 3 };
        const todayIso = new Date().toISOString().slice(0, 10);
        const isEnded = (b) => b.period === 'custom' && b.end_date && b.end_date < todayIso;
        const byUrgency = (a, b) => (isEnded(a) - isEnded(b))
            || (rank[a.status] ?? 3) - (rank[b.status] ?? 3)
            || (b.percent_to_date ?? b.percent ?? 0) - (a.percent_to_date ?? a.percent ?? 0);
        const spending = all.filter(b => (b.envelope_type || 'spending') !== 'savings');
        const savingsBudgets = all.filter(b => (b.envelope_type || 'spending') === 'savings');
        const isFixed = (b) => !isOrg && b.is_fixed_charges;
        const groups = {
            cycle: spending.filter(b => !b.is_project && isMonthly(b) && !isFixed(b)).sort(byUrgency),
            yearly: spending.filter(b => !b.is_project && b.period === 'yearly' && !isFixed(b)).sort(byUrgency),
            dated: spending.filter(b => !b.is_project && b.period === 'custom').sort(byUrgency),
            fixed: spending.filter(b => !b.is_project && isFixed(b) && (isMonthly(b) || b.period === 'yearly')).sort(byUrgency),
            long: spending.filter(b => !b.is_project && b.period === 'indefinite').sort(byUrgency),
            projects: spending.filter(b => b.is_project).sort(byUrgency),
        };

        // ── Barre de période (enveloppes mensuelles : cycle de paie ou mois) ──
        const hasMonthly = groups.cycle.length > 0 || groups.fixed.some(isMonthly);
        let periodHtml = '';
        if (hasMonthly && period) {
            const isCycle = period.kind === 'cycle';
            const title = this.customPeriod.enabled
                ? tp('bv_dated_range', { start: fmtDate(this.customPeriod.start), end: fmtDate(this.customPeriod.end) }, 'Du {start} au {end}')
                : isCycle
                    ? tp('bv_period_cycle', { start: fmtDay(period.start), end: fmtDay(period.end) }, 'Cycle du {start} au {end}')
                    : new Date(period.start + 'T00:00:00').toLocaleDateString(lang, { month: 'long', year: 'numeric' });
            let sub = '';
            if (!this.customPeriod.enabled && isCurrentPeriod) {
                sub = tp('bv_period_day', { day: period.days_elapsed, total: period.days_total }, 'Jour {day} sur {total}') + ' · '
                    + tp(isCycle ? 'bv_period_days_to_pay' : 'bv_period_days_to_end', { days: period.days_left },
                         isCycle ? '{days} j avant la paie' : '{days} j avant la fin du mois');
            } else if (!this.customPeriod.enabled) {
                sub = t('bv_period_past', 'Période terminée');
            }
            const customEnabled = this.customPeriod.enabled;
            periodHtml = `
            <section class="bv-period" aria-label="${t('bv_period_label', 'Période des enveloppes')}">
                <div class="bv-period-nav">
                    <button type="button" class="bv-icon-btn" onclick="window.BudgetsView.stepMonthly(-1)" ${customEnabled ? 'disabled' : ''} aria-label="${t('bv_period_prev', 'Période précédente')}">${this._bvIcon('chevronLeft', 18)}</button>
                    <div class="bv-period-label">
                        <strong>${title}</strong>
                        ${sub ? `<span>${sub}</span>` : ''}
                    </div>
                    <button type="button" class="bv-icon-btn" onclick="window.BudgetsView.stepMonthly(1)" ${(customEnabled || isCurrentPeriod) ? 'disabled' : ''} aria-label="${t('bv_period_next', 'Période suivante')}">${this._bvIcon('chevronRight', 18)}</button>
                </div>
                <div class="bv-period-extra">
                    ${(!isCurrentPeriod || customEnabled) ? `<button type="button" class="btn btn-secondary bv-btn-compact" onclick="window.BudgetsView.goTodayMonthly()">${t('btn_today', "Aujourd'hui")}</button>` : ''}
                    <label class="bv-switch">
                        <input type="checkbox" id="budgetCustomPeriodToggle" ${customEnabled ? 'checked' : ''} onchange="window.BudgetsView.onCustomPeriodToggle(this.checked)">
                        <span>${t('budget_custom_period', 'Période personnalisée')}</span>
                    </label>
                    <div id="budgetCustomPeriodInputs" class="bv-custom-dates" ${customEnabled ? '' : 'hidden'}>
                        <input type="date" id="budgetCustomStart" class="inline-input" value="${this.customPeriod.start || ''}" onchange="window.BudgetsView.onCustomPeriodChange()" aria-label="${t('bv_custom_start', 'Début')}">
                        <span aria-hidden="true">→</span>
                        <input type="date" id="budgetCustomEnd" class="inline-input" value="${this.customPeriod.end || ''}" onchange="window.BudgetsView.onCustomPeriodChange()" aria-label="${t('bv_custom_end', 'Fin')}">
                    </div>
                </div>
            </section>`;
        }

        // ── Synthèse des points d'attention ──
        const isThisYear = this.yearlyYear === new Date().getFullYear();
        const watched = [...groups.cycle, ...groups.yearly, ...groups.dated.filter(b => !isEnded(b)),
                         ...groups.fixed, ...groups.projects].filter(b => b.period !== 'yearly' || isThisYear);
        const count = (s) => watched.filter(b => b.status === s).length;
        const nOver = count('over'), nNear = count('near'), nAhead = count('ahead');
        const plural = (n, one, many) => (n > 1 ? many : one).split('{count}').join(n);
        const attnParts = [];
        if (nOver) attnParts.push(`<span class="bv-attn-item bv-tone-over">${plural(nOver, t('bv_attn_over_one', '{count} enveloppe dépassée'), t('bv_attn_over_many', '{count} enveloppes dépassées'))}</span>`);
        if (nNear) attnParts.push(`<span class="bv-attn-item bv-tone-near">${plural(nNear, t('bv_attn_near_one', '{count} proche de la limite'), t('bv_attn_near_many', '{count} proches de la limite'))}</span>`);
        if (nAhead) attnParts.push(`<span class="bv-attn-item bv-tone-ahead">${plural(nAhead, t('bv_attn_ahead_one', '{count} en avance sur le rythme'), t('bv_attn_ahead_many', '{count} en avance sur le rythme'))}</span>`);
        const nIssues = spending.filter(b => this._envIssue(b)).length;
        if (nIssues) attnParts.push(`<span class="bv-attn-item bv-tone-near">${plural(nIssues, t('bv_attn_check_one', '{count} enveloppe à vérifier'), t('bv_attn_check_many', '{count} enveloppes à vérifier'))}</span>`);
        const attnHtml = all.length === 0 ? '' : `<p class="bv-attn" role="status">${attnParts.length
            ? attnParts.join('<span class="bv-attn-sep" aria-hidden="true">·</span>')
            : `<span class="bv-attn-item bv-tone-ok">${t('bv_attn_ok', 'Toutes les enveloppes sont dans les clous')}</span>`}</p>`;

        // ── Totaux par période : mêmes regroupements et mêmes chiffres que la barre latérale ──
        const prefs = this._budgetPrefs();
        const excludeFixed = prefs.excludeFixed && !isOrg;
        const totalGroups = [];
        for (const p of ['monthly', 'yearly', 'indefinite', 'custom']) {
            const inPeriod = spending.filter(b => (b.period || 'monthly') === p);
            const list = excludeFixed ? inPeriod.filter(b => !(groups.fixed.includes(b))) : inPeriod;
            if (!list.length) continue;
            const withoutFixed = list.length < inPeriod.length;
            const byAcc = {};
            for (const b of list) {
                const key = (b.account_ids && b.account_ids.length) ? [...b.account_ids].sort((a, c) => a - c).join(',') : '__global__';
                (byAcc[key] = byAcc[key] || []).push(b);
            }
            for (const [key, sub] of Object.entries(byAcc)) totalGroups.push({ period: p, key, list: sub, withoutFixed });
        }
        const totalLabel = (p) => p === 'monthly'
            ? (period?.kind === 'cycle' ? t('bv_total_cycle', 'Total du cycle') : t('bv_total_month', 'Total du mois'))
            : p === 'yearly' ? t('bv_total_yearly', 'Total annuel')
            : p === 'custom' ? t('bv_total_dated', 'Enveloppes datées')
            : t('bv_total_long', 'Long terme');
        // title : le total sert d'en-tête à sa section ; withAccounts : false quand la section porte déjà le nom du compte
        const renderTotal = ({ period: p, key, list, withoutFixed }, { title = null, withAccounts = true } = {}) => {
            const limit = list.reduce((s, b) => s + (b.budget_amount || 0), 0);
            const spent = list.reduce((s, b) => s + (b.spent_to_date ?? b.spent ?? 0), 0);
            const planned = list.reduce((s, b) => s + (b.planned || 0), 0);
            const pct = limit > 0 ? (spent / limit) * 100 : 0;
            const plannedPct = limit > 0 ? (planned / limit) * 100 : 0;
            const tone = pct > 100 ? 'over' : pct >= 90 ? 'near' : 'ok';
            let label = title ? `<h3>${title}</h3>` : totalLabel(p);
            if (key !== '__global__' && withAccounts) {
                const names = key.split(',').map(id => this.accounts?.find(a => a.id === parseInt(id))).filter(Boolean)
                    .map(a => `<span class="bv-env-account" style="--acc:${a.color || 'var(--accent)'}">${a.name}</span>`);
                const accHtml = names.length ? names.join(' ') : (list[0]?.account_names || []).join(' + ');
                label = title ? `${label}${accHtml}` : `${accHtml}<span class="bv-total-period">${label}</span>`;
            } else if (title && isOrg) {
                label += `<span class="bv-total-period">${totalLabel(p)}</span>`;
            }
            if (withoutFixed) label += `<span class="bv-total-period">${t('bv_total_without_fixed', 'hors charges prévues')}</span>`;
            else if (title && list.some(b => groups.fixed.includes(b))) label += `<span class="bv-total-period">${t('bv_total_with_fixed', 'charges prévues comprises')}</span>`;
            let status = spent > limit
                ? tp('bv_status_over', { amount: formatCurrency(spent - limit) }, 'Dépassée de {amount}')
                : tp('bv_status_left', { amount: formatCurrency(limit - spent) }, 'Reste {amount}');
            if (planned > 0.005) status += ` · ${tp('bv_planned', { amount: formatCurrency(planned) }, '{amount} prévus')}`;
            const countText = (list.length > 1 ? t('bv_total_count_many', '{count} enveloppes') : t('bv_total_count_one', '{count} enveloppe')).split('{count}').join(list.length);
            return `
            <${title ? 'header' : 'div'} class="bv-total${title ? ' bv-total--head' : ''} bv-tone-${tone}" data-budget-period-sub="${p}-${key}">
                <div class="bv-total-head">
                    <span class="bv-total-label">${label}</span>
                    <span class="bv-total-figures privacy-blur"><strong>${formatCurrency(spent)}</strong><span> / ${formatCurrency(limit)}</span></span>
                </div>
                <div class="bv-env-bar" role="img" aria-label="${tp('bv_bar_label', { pct: Math.round(pct) }, '{pct} % utilisés')}">
                    <span class="bv-env-fill" style="width:${Math.min(pct, 100)}%"></span>
                    ${plannedPct > 0.5 && pct < 100 ? `<span class="bv-env-planned" style="left:${Math.min(pct, 100)}%;width:${Math.min(plannedPct, 100 - Math.min(pct, 100))}%"></span>` : ''}
                </div>
                <div class="bv-env-foot">
                    <span class="bv-env-status privacy-blur">${status}</span>
                    ${title ? '' : `<span class="bv-env-meta">${countText}</span>`}
                </div>
            </${title ? 'header' : 'div'}>`;
        };
        // Chaque total s'affiche en tête de la section qu'il résume (par compte en mode organisation)
        const totalSection = (g) => (isOrg && g.period !== 'indefinite') ? `org-${g.key}` : g.period;
        const placedTotals = new Set();

        // ── Ligne d'enveloppe ──
        const renderRow = (b) => {
            const gauge = this._envGauge(b);
            const { limit, spent, tone, statusText } = gauge;

            const cats = b.categories || [];
            // Changement tout juste appliqué depuis les suggestions : catégories ajoutées en tête et marquées
            const change = this.recentChange ? this.recentChange(b.id) : null;
            const added = change?.added || [];
            const ordered = [...cats.filter(c => added.includes(c)), ...cats.filter(c => !added.includes(c))];
            const shown = ordered.slice(0, 3).map(c => added.includes(c) ? `<mark class="bv-changed-cat">${c}</mark>` : c);
            const catText = ordered.length > 3 ? `${shown.join(', ')} +${ordered.length - 3}` : shown.join(', ');
            const meta = b.period === 'custom'
                ? tp('bv_dated_range', { start: fmtDate(b.start_date), end: fmtDate(b.end_date) }, 'Du {start} au {end}')
                : catText;

            const autoSugg = (this.autopilotSuggestions || []).find(s => s.type !== 'creation' && s.budget_id === b.id);
            const suggHtml = autoSugg ? `
                <button type="button" class="bv-env-sugg" onclick="event.stopPropagation(); window.BudgetsView.openReviewModalForBudget(${b.id})">
                    ${this._bvIcon('bulb', 14)}
                    <span>${tp('bv_sugg', { amount: formatCurrency(autoSugg.suggested_amount) }, 'Plafond proposé : {amount}')}</span>
                </button>` : '';

            const safeName = b.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
            const y = b.period === 'yearly' ? this.yearlyYear : (period ? parseInt(period.start.slice(0, 4)) : new Date().getFullYear());
            const issue = this._envIssue(b);
            const m = period ? parseInt(period.start.slice(5, 7)) : new Date().getMonth() + 1;
            return `
            <article class="bv-env bv-tone-${tone}${b.is_closed ? ' bv-env--closed' : ''}${change ? ' bv-env--changed' : ''}" data-budget-id="${b.id}" tabindex="0"
                     onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})"
                     onkeydown="if(event.key==='Enter'&&event.target===this){window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})}">
                <div class="bv-env-head">
                    <div class="bv-env-name">
                        <strong>${b.name}</strong>
                        ${b.is_locked ? `<span class="bv-env-lock" title="${t('bv_locked', "Verrouillée : pas d'ajustement automatique")}">${this._bvIcon('lock', 13)}</span>` : ''}
                        ${prefs.pinned.includes(b.id) ? `<span class="bv-env-lock" title="${t('bv_pinned', 'Épinglée dans la barre latérale')}">${this._bvIcon('pin', 13)}</span>` : ''}
                    </div>
                    <div class="bv-env-figures privacy-blur"><strong>${formatCurrency(spent)}</strong><span${change ? ' class="bv-changed-value"' : ''}> / ${formatCurrency(limit)}</span></div>
                    <div class="bv-env-actions" onclick="event.stopPropagation()">
                        <button type="button" class="bv-icon-btn" onclick="window.BudgetsView.editBudget(${b.id})" aria-label="${t('tooltip_edit', 'Modifier')} ${safeName}" title="${t('tooltip_edit', 'Modifier')}">${this._bvIcon('pencil')}</button>
                        <button type="button" class="bv-icon-btn bv-icon-btn--danger" onclick="window.BudgetsView.deleteBudget(${b.id})" aria-label="${t('tooltip_delete', 'Supprimer')} ${safeName}" title="${t('tooltip_delete', 'Supprimer')}">${this._bvIcon('trash')}</button>
                    </div>
                </div>
                ${this._envBarHtml(gauge)}
                <div class="bv-env-foot">
                    <span class="bv-env-meta">${meta}</span>
                    <span class="bv-env-status privacy-blur">${statusText}</span>
                </div>
                ${change ? `<p class="bv-env-change privacy-blur">${change.kind === 'created'
                    ? t('bv_change_created', 'Nouvelle enveloppe')
                    : change.kind === 'adjusted'
                        ? tp('bv_change_adjusted', { from: formatCurrency(change.from), to: formatCurrency(change.to) }, 'Plafond ajusté : {from} → {to}')
                        : tp('bv_change_completed', { from: formatCurrency(change.from), to: formatCurrency(change.to) }, 'Complétée : plafond {from} → {to}')}</p>` : ''}
                ${issue ? `<button type="button" class="bv-env-sugg bv-env-issue" onclick="event.stopPropagation(); window.BudgetsView.editBudget(${b.id})">${this._bvIcon('alert', 14)}<span>${issue}</span></button>` : ''}
                ${suggHtml}
            </article>`;
        };

        const sectionTotals = (list) => {
            // Un total n'a de sens que pour des enveloppes de même période (pas mensuel + annuel)
            if (new Set(list.map(b => b.period || 'monthly')).size > 1) return '';
            const spent = list.reduce((s, b) => s + (b.spent_to_date ?? b.spent ?? 0), 0);
            const limit = list.reduce((s, b) => s + (b.budget_amount || 0), 0);
            return `<span class="bv-section-total privacy-blur">${tp('bv_total_spent', { spent: formatCurrency(spent), limit: formatCurrency(limit) }, '{spent} sur {limit}')}</span>`;
        };
        const renderSection = (key, title, list, sectionId = key) => {
            if (!list.length) return '';
            const mine = totalGroups.filter(g => totalSection(g) === sectionId);
            mine.forEach(g => placedTotals.add(g));
            let head;
            if (mine.length === 1) {
                head = renderTotal(mine[0], { title, withAccounts: !isOrg });
            } else if (mine.length) {
                head = `<header class="bv-section-head"><h3>${title}</h3></header>
                <div class="bv-totals">${mine.map(g => renderTotal(g, { withAccounts: !isOrg })).join('')}</div>`;
            } else {
                head = `<header class="bv-section-head"><h3>${title}</h3>${key === 'org' ? '' : sectionTotals(list)}</header>`;
            }
            return `
            <section class="bv-section" data-budget-period="${key}">
                ${head}
                <div class="bv-env-list">${list.map(renderRow).join('')}</div>
            </section>`;
        };

        let html = '';
        const yearNav = `
            <span class="bv-year-nav" onclick="event.preventDefault(); event.stopPropagation();">
                <button type="button" class="bv-icon-btn" onclick="window.BudgetsView.stepYearly(-1)" aria-label="${t('bv_year_prev', 'Année précédente')}">${this._bvIcon('chevronLeft', 14)}</button>
                <span class="bv-year-label">${this.yearlyYear}</span>
                <button type="button" class="bv-icon-btn" onclick="window.BudgetsView.stepYearly(1)" ${isThisYear ? 'disabled' : ''} aria-label="${t('bv_year_next', 'Année suivante')}">${this._bvIcon('chevronRight', 14)}</button>
            </span>`;

        if (isOrg) {
            // Mode organisation : pas de cycle de paie ; enveloppes regroupées par compte
            const orgList = [...groups.cycle, ...groups.yearly, ...groups.dated].sort(byUrgency);
            const byAccount = {};
            for (const b of orgList) {
                const key = (b.account_ids && b.account_ids.length) ? [...b.account_ids].sort((a, c) => a - c).join(',') : '__global__';
                (byAccount[key] = byAccount[key] || []).push(b);
            }
            for (const [key, list] of Object.entries(byAccount)) {
                let title = t('budget_summary_global', 'Toutes les enveloppes');
                if (key !== '__global__') {
                    const names = key.split(',').map(id => this.accounts?.find(a => a.id === parseInt(id))).filter(Boolean)
                        .map(a => `<span class="bv-env-account" style="--acc:${a.color || 'var(--accent)'}">${a.name}</span>`);
                    title = names.length ? names.join(' ') : (list[0]?.account_names || []).join(' + ');
                }
                html += renderSection('org', title, list, `org-${key}`);
            }
        } else {
            const cycleTitle = period?.kind === 'cycle' ? t('bv_section_cycle', 'Dépenses du cycle') : t('bv_section_month', 'Dépenses du mois');
            html += renderSection('monthly', cycleTitle, groups.cycle);
            html += renderSection('yearly', `${t('bv_section_yearly', 'Enveloppes annuelles')}${yearNav}`, groups.yearly);
            html += renderSection('custom', t('bv_section_dated', 'Enveloppes datées'), groups.dated);
        }

        if (groups.fixed.length) {
            const fixedOver = groups.fixed.filter(b => b.status === 'over').length;
            const open = fixedOver > 0 || ProfileStorage.get('budget_fixed_open') === 'true';
            // Barre de progression par période (un plafond annuel ne s'additionne pas à un mensuel),
            // visible même groupe replié ; ton neutre tant qu'aucune charge ne dépasse
            const fixedBars = ['monthly', 'yearly'].map(p => {
                const list = groups.fixed.filter(b => (b.period || 'monthly') === p);
                if (!list.length) return null;
                const limit = list.reduce((sum, b) => sum + (b.budget_amount || 0), 0);
                const spent = list.reduce((sum, b) => sum + (b.spent_to_date ?? b.spent ?? 0), 0);
                const planned = list.reduce((sum, b) => sum + (b.planned || 0), 0);
                let status = spent > limit
                    ? tp('bv_status_over', { amount: formatCurrency(spent - limit) }, 'Dépassée de {amount}')
                    : tp('bv_status_left', { amount: formatCurrency(limit - spent) }, 'Reste {amount}');
                if (planned > 0.005) status += ` · ${tp('bv_planned', { amount: formatCurrency(planned) }, '{amount} prévus')}`;
                return {
                    label: p === 'yearly' ? t('bv_fixed_yearly', 'Annuelles') : t('bv_fixed_monthly', 'Mensuelles'),
                    nav: p === 'yearly' && !groups.yearly.length ? yearNav : '',
                    gauge: { pct: limit > 0 ? (spent / limit) * 100 : 0, plannedPct: limit > 0 ? (planned / limit) * 100 : 0, showPace: false },
                    tone: spent > limit + 0.005 ? 'over' : 'fixed', limit, spent, status,
                };
            }).filter(Boolean);
            const figures = (f) => `<span class="bv-total-figures privacy-blur"><strong>${formatCurrency(f.spent)}</strong><span> / ${formatCurrency(f.limit)}</span></span>`;
            const barBlock = (f) => `${this._envBarHtml(f.gauge)}
                    <div class="bv-env-foot"><span class="bv-env-status privacy-blur">${f.status}</span></div>`;
            const single = fixedBars.length === 1 ? fixedBars[0] : null;
            const foldTone = fixedBars.some(f => f.tone === 'over') ? 'over' : 'fixed';
            html += `
            <details class="bv-section bv-fold" data-budget-period="fixed" ${open ? 'open' : ''}
                     ontoggle="ProfileStorage.set('budget_fixed_open', this.open ? 'true' : 'false')">
                <summary class="bv-total bv-total--head bv-fold-sum bv-tone-${foldTone}">
                    <div class="bv-total-head">
                        <span class="bv-total-label"><h3>${t('bv_section_fixed', 'Charges prévues')} <span class="bv-fold-count">${groups.fixed.length}</span></h3><span class="bv-total-period">${t('bv_section_fixed_sub', 'liées à vos récurrences')}</span>${single ? single.nav : ''}</span>
                        <span class="bv-fold-right">${single ? figures(single) : ''}<span class="bv-fold-chevron">${this._bvIcon('chevronDown', 18)}</span></span>
                    </div>
                    ${single ? barBlock(single) : fixedBars.map(f => `
                    <div class="bv-fold-period bv-tone-${f.tone}">
                        <div class="bv-total-head"><span class="bv-total-label"><span class="bv-total-period">${f.label}</span>${f.nav}</span>${figures(f)}</div>
                        ${barBlock(f)}
                    </div>`).join('')}
                </summary>
                <p class="bv-section-hint bv-fold-hint">${t('bv_section_fixed_hint', "Rangées ici automatiquement : l'essentiel de leurs dépenses vient de vos récurrences (prêt, assurance, abonnements…). Quand une récurrence apparaît, change de montant ou s'arrête, leur plafond suit, si l'Auto-Pilote applique seul les recalibrages et que l'enveloppe n'est pas verrouillée. Seul un dépassement est signalé.")}</p>
                <div class="bv-env-list">${groups.fixed.map(renderRow).join('')}</div>
            </details>`;
        }
        html += renderSection('indefinite', t('bv_section_long', 'Suivis long terme'), groups.long);
        html += renderSection('projects', t('bv_section_projects', 'Projets'), groups.projects);

        if (savingsBudgets.length > 0) {
            html += `
            <section class="bv-section" data-budget-period="savings">
                <header class="bv-section-head"><h3>${t('budget_savings_section', 'Tirelires')}</h3></header>
                <div class="bv-card-grid">${savingsBudgets.map(b => this._renderSavingsCard(b)).join('')}</div>
            </section>`;
        }

        if (all.length === 0) {
            html += `<p class="bv-empty">${t('budget_no_active', 'Aucune enveloppe budgétaire active.')}</p>`;
        }


        // En tête : suggestions en attente, période, totaux sans section à résumer, points d'attention
        const orphans = totalGroups.filter(g => !placedTotals.has(g));
        const orphansHtml = orphans.length
            ? `<section class="bv-totals" aria-label="${t('bv_totals_label', 'Totaux des enveloppes')}">${orphans.map(g => renderTotal(g)).join('')}</section>`
            : '';
        const bannerHtml = this.renderAutopilotSuggestionsBanner ? this.renderAutopilotSuggestionsBanner() : '';
        html = (all.length ? this._updateNoticeHtml(isOrg) : '') + (bannerHtml ? `<div class="bv-sugg-zone">${bannerHtml}</div>` : '') + periodHtml + orphansHtml + attnHtml + html;

        if (container) container.innerHTML = html;

        if (this._pendingHighlightId || this._pendingHighlightName) {
            const hid = this._pendingHighlightId;
            const name = this._pendingHighlightName;
            this._pendingHighlightId = null;
            this._pendingHighlightName = null;
            requestAnimationFrame(() => this._highlightBudget(hid, name));
        } else if (this._pendingHighlightPeriod || this._pendingHighlightPeriodSub) {
            const p = this._pendingHighlightPeriod;
            const sub = this._pendingHighlightPeriodSub;
            this._pendingHighlightPeriod = null;
            this._pendingHighlightPeriodSub = null;
            requestAnimationFrame(() => this._highlightSection(p, sub));
        }

    },

    _renderSavingsCard(b) {
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const balance = b.balance || 0;
        const goal = b.budget_amount || 0;
        const funded = b.funded || 0;
        const withdrawn = b.withdrawn || 0;
        const overflow = this.savingsOverflow;
        let tempWithdrawn = 0;
        if (overflow && overflow.total_savings > 0 && !b.is_closed) {
            tempWithdrawn = Math.min(balance, overflow.overflow_amount * (balance / overflow.total_savings));
        }
        const effectiveBalance = balance - tempWithdrawn;
        const pct = goal > 0 ? Math.min((effectiveBalance / goal) * 100, 100) : 0;
        const goalReached = balance >= goal && goal > 0;
        const safeName = b.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
        const now = new Date();
        return `
            <article class="bv-env bv-env--savings${goalReached ? ' bv-tone-near' : ' bv-tone-ok'}${b.is_closed ? ' bv-env--closed' : ''}" data-budget-id="${b.id}" tabindex="0"
                     onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${now.getFullYear()}, ${now.getMonth() + 1})"
                     onkeydown="if(event.key==='Enter'&&event.target===this){window.BudgetsView.showDetail(${b.id}, '${safeName}', ${now.getFullYear()}, ${now.getMonth() + 1})}">
                <div class="bv-env-head">
                    <div class="bv-env-name"><strong>${b.name}</strong></div>
                    <div class="bv-env-figures privacy-blur"><strong>${formatCurrency(effectiveBalance)}</strong><span> / ${formatCurrency(goal)}</span></div>
                    <div class="bv-env-actions" onclick="event.stopPropagation()">
                        ${!b.is_closed ? `<button type="button" class="bv-icon-btn" onclick="window.BudgetsView.showAllocationForm(${b.id})" aria-label="${t('budget_savings_add_funds', 'Alimenter')}" title="${t('budget_savings_add_funds', 'Alimenter')}">${this._bvIcon('plus')}</button>` : ''}
                        <button type="button" class="bv-icon-btn" onclick="window.BudgetsView.editBudget(${b.id})" aria-label="${t('tooltip_edit', 'Modifier')}" title="${t('tooltip_edit', 'Modifier')}">${this._bvIcon('pencil')}</button>
                        <button type="button" class="bv-icon-btn bv-icon-btn--danger" onclick="window.BudgetsView.deleteBudget(${b.id})" aria-label="${t('tooltip_delete', 'Supprimer')}" title="${t('tooltip_delete', 'Supprimer')}">${this._bvIcon('trash')}</button>
                    </div>
                </div>
                <div class="bv-env-bar"><span class="bv-env-fill" style="width:${pct}%"></span></div>
                <div class="bv-env-foot">
                    <span class="bv-env-meta privacy-blur">${formatCurrency(funded)} ${t('budget_savings_funded', 'versés')}${withdrawn > 0 ? ` · ${formatCurrency(withdrawn)} ${t('budget_savings_withdrawn', 'retirés')}` : ''}</span>
                    <span class="bv-env-status privacy-blur">${goalReached ? t('budget_savings_goal_reached', 'Objectif atteint') : `${formatCurrency(Math.max(goal - balance, 0))} ${t('budget_savings_remaining', 'restants')}`}</span>
                </div>
            </article>`;
    },

    _highlightByName(budgetName) {
        this._highlightBudget(null, budgetName);
    },

    _highlightBudget(budgetId, budgetName) {
        const cards = document.querySelectorAll('[data-budget-id]');
        for (const card of cards) {
            const bId = card.getAttribute('data-budget-id');
            const nameEl = card.querySelector('strong');
            const matchesId = budgetId && String(bId) === String(budgetId);
            const matchesName = budgetName && nameEl && nameEl.textContent.trim().toLowerCase().startsWith(budgetName.toLowerCase());
            if (matchesId || matchesName) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.transition = 'box-shadow 0.4s ease, border-color 0.4s ease, transform 0.4s ease';
                card.style.setProperty('box-shadow', '0 0 0 2px var(--accent), 0 0 24px rgba(99,102,241,0.5)', 'important');
                card.style.setProperty('border-color', 'var(--accent)', 'important');
                card.style.setProperty('transform', 'scale(1.02)', 'important');
                setTimeout(() => {
                    card.style.removeProperty('box-shadow');
                    card.style.removeProperty('border-color');
                    card.style.removeProperty('transform');
                    setTimeout(() => { card.style.removeProperty('transition'); }, 500);
                }, 3500);
                break;
            }
        }
    },

    _highlightSection(period, subKey) {
        let target = subKey ? document.querySelector(`[data-budget-period-sub="${subKey}"]`) : null;
        if (!target && period) {
            target = document.querySelector(`[data-budget-period="${period}"]`);
        }
        if (target) {
            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
            target.style.transition = 'box-shadow 0.4s ease, border-color 0.4s ease';
            target.style.setProperty('box-shadow', '0 0 0 3px var(--accent), 0 0 25px rgba(99,102,241,0.45)', 'important');
            target.style.setProperty('border-color', 'var(--accent)', 'important');
            setTimeout(() => {
                target.style.removeProperty('box-shadow');
                target.style.removeProperty('border-color');
                setTimeout(() => { target.style.removeProperty('transition'); }, 500);
            }, 3500);
        }
    },

    setGridFilter(filter) {
        this.currentGridFilter = filter;
        this.renderStatus();
    }
});
