// static/js/views/budgets/budgets_autopilot.js
// Recommandations & Automatismes des Enveloppes Budgétaires

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    autopilotSuggestions: [],
    _reviewFilter: 'all',

    async loadAutopilotSuggestions() {
        try {
            const [data, cfg] = await Promise.all([
                API.get('/api/budgets/autopilot/suggestions'),
                API.get('/api/config/').catch(() => ({}))
            ]);
            this.autopilotSuggestions = Array.isArray(data) ? data : [];
            this.autopilotConfig = cfg || {};
            return this.autopilotSuggestions;
        } catch (err) {
            console.error('[Budgets Recommendations] Erreur chargement suggestions:', err);
            this.autopilotSuggestions = [];
            return [];
        }
    },

    async approveAutopilotSuggestion(decisionId, onComplete) {
        try {
            const res = await API.post(`/api/budgets/autopilot/suggestions/${decisionId}/approve`);
            const name = res.name || 'Enveloppe';
            const amount = res.amount || res.new_amount || 0;
            
            let toastMsg;
            if (res.type === 'creation') {
                const template = window.i18n.t('autopilot_budget_created_toast') || "Enveloppe '{name}' créée avec succès ({amount} €)";
                toastMsg = template.replace('{name}', name).replace('{amount}', amount);
            } else {
                const template = window.i18n.t('autopilot_budget_recalibrated_toast') || "Enveloppe '{name}' actualisée à {amount} €";
                toastMsg = template.replace('{name}', name).replace('{amount}', amount);
            }

            if (typeof showUndoToast === 'function' && res.action_id) {
                showUndoToast(toastMsg, res.action_id, async () => {
                    await Promise.all([
                        this.loadBudgets(),
                        this.loadAllStatuses(),
                        this.loadAutopilotSuggestions()
                    ]);
                    this.renderStatus();
                });
            } else {
                showToast(toastMsg, 'success');
            }

            if (typeof onComplete === 'function') {
                await onComplete();
            } else {
                await Promise.all([
                    this.loadBudgets(),
                    this.loadAllStatuses(),
                    this.loadAutopilotSuggestions()
                ]);
                this.renderStatus();
            }
        } catch (err) {
            console.error('[Budgets Recommendations] Erreur approbation suggestion:', err);
            showToast(err.message || 'Erreur lors de l\'approbation', 'error');
        }
    },

    async dismissAutopilotSuggestion(decisionId, onComplete) {
        try {
            const res = await API.post(`/api/budgets/autopilot/suggestions/${decisionId}/dismiss`);
            const target = this.autopilotSuggestions.find(s => s.decision_id === decisionId);
            const name = target ? (target.category || target.budget_name || target.name || 'Enveloppe') : 'Enveloppe';
            
            const template = window.i18n.t('autopilot_budget_dismissed_toast') || "Suggestion pour '{name}' écartée ce mois-ci";
            const toastMsg = template.replace('{name}', name);

            if (typeof showUndoToast === 'function' && res.action_id) {
                showUndoToast(toastMsg, res.action_id, async () => {
                    await this.loadAutopilotSuggestions();
                    this.renderStatus();
                });
            } else {
                showToast(toastMsg, 'info');
            }

            if (typeof onComplete === 'function') {
                await onComplete();
            } else {
                await this.loadAutopilotSuggestions();
                this.renderStatus();
            }
        } catch (err) {
            console.error('[Budgets Recommendations] Erreur rejet suggestion:', err);
            showToast(err.message || 'Erreur lors du rejet', 'error');
        }
    },

    async approveAllAutopilotSuggestions(selectedIds = null) {
        try {
            const payload = selectedIds ? { decision_ids: selectedIds } : null;
            const res = await API.post('/api/budgets/autopilot/suggestions/approve-all', payload);
            const count = res.count || (selectedIds ? selectedIds.length : this.autopilotSuggestions.length);
            
            const template = window.i18n.t('budget_suggestions_all_approved_toast') || "{count} recommandation(s) approuvée(s) avec succès";
            showToast(template.replace('{count}', count), 'success');

            const modal = document.getElementById('budgetSuggestionsReviewModal');
            if (modal) modal.remove();

            await Promise.all([
                this.loadBudgets(),
                this.loadAllStatuses(),
                this.loadAutopilotSuggestions()
            ]);
            this.renderStatus();
        } catch (err) {
            console.error('[Budgets Recommendations] Erreur approbation groupée:', err);
            showToast(err.message || 'Erreur lors de l\'approbation groupée', 'error');
        }
    },

    async dismissAllAutopilotSuggestions(selectedIds = null) {
        try {
            const payload = selectedIds ? { decision_ids: selectedIds } : null;
            const res = await API.post('/api/budgets/autopilot/suggestions/dismiss-all', payload);
            const count = res.count || (selectedIds ? selectedIds.length : this.autopilotSuggestions.length);

            const template = window.i18n.t('budget_suggestions_all_dismissed_toast') || "{count} recommandation(s) écartée(s) ce mois-ci";
            showToast(template.replace('{count}', count), 'info');

            const modal = document.getElementById('budgetSuggestionsReviewModal');
            if (modal) modal.remove();

            await this.loadAutopilotSuggestions();
            this.renderStatus();
        } catch (err) {
            console.error('[Budgets Recommendations] Erreur rejet groupé:', err);
            showToast(err.message || 'Erreur lors du rejet groupé', 'error');
        }
    },

    // ─── Bandeau Compact 1-Ligne (Option A) ──────────────────────────────────
    renderAutopilotSuggestionsBanner() {
        const isEnableCreation = (this.autopilotConfig?.enable_budget_creation_suggestions ?? 'true') === 'true';
        const isEnableRecalib = (this.autopilotConfig?.enable_budget_recalibration_suggestions ?? 'true') === 'true';
        const isMonitoringActive = isEnableCreation || isEnableRecalib;

        if (!this.autopilotSuggestions || this.autopilotSuggestions.length === 0) {
            if (!isMonitoringActive) {
                return '';
            }

            const activeMonitoringTitle = window.i18n.t('budget_auto_active_monitoring_title') || 'Surveillance active :';
            const activeMonitoringDesc = window.i18n.t('budget_auto_active_monitoring_desc') || 'Toutes vos enveloppes sont équilibrées pour ce mois.';
            const historyLabel = window.i18n.t('budget_auto_btn_history_dismissed') || 'Historique / Écartées';
            const settingsLabel = window.i18n.t('budget_automations_btn') || 'Automatismes';

            return `
                <div class="budget-suggestions-strip budget-strip-active-monitoring" role="region" aria-label="Surveillance active">
                    <div class="budget-strip-left">
                        <span class="budget-monitoring-pulse-dot" title="Surveillance active"></span>
                        <div class="budget-strip-info">
                            <span class="budget-strip-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <strong class="budget-monitoring-title-text">${activeMonitoringTitle}</strong>
                                <span class="budget-monitoring-desc-text">${activeMonitoringDesc}</span>
                            </span>
                        </div>
                    </div>
                    <div class="budget-strip-right">
                        <button type="button" class="btn btn-secondary budget-strip-btn-history" 
                                onclick="window.BudgetsView.openDismissedSuggestionsModal()" 
                                title="${historyLabel}">
                            <span>📋</span> <span class="btn-text">${historyLabel}</span>
                        </button>
                        <button type="button" class="btn btn-secondary budget-strip-btn-settings" 
                                onclick="window.BudgetsView.openBudgetAutomationsModal()" 
                                title="${settingsLabel}">
                            <span>⚙️</span>
                        </button>
                    </div>
                </div>
            `;
        }

        const count = this.autopilotSuggestions.length;
        const creations = this.autopilotSuggestions.filter(s => s.type === 'creation');
        const recalibs = this.autopilotSuggestions.filter(s => s.type !== 'creation');
        const creationsTotal = creations.reduce((acc, s) => acc + (s.suggested_amount || 0), 0);
        const recalibOldTotal = recalibs.reduce((acc, s) => acc + (s.current_amount || 0), 0);
        const recalibNewTotal = recalibs.reduce((acc, s) => acc + (s.suggested_amount || 0), 0);
        const recalibDelta = recalibNewTotal - recalibOldTotal;
        const netTotalImpact = creationsTotal + recalibDelta;

        const creationsCount = creations.length;
        const recalibsCount = recalibs.length;

        let breakdownParts = [];
        if (recalibsCount > 0) {
            breakdownParts.push(`${recalibsCount} ajustement${recalibsCount > 1 ? 's' : ''}`);
        }
        if (creationsCount > 0) {
            breakdownParts.push(`${creationsCount} nouvelle${creationsCount > 1 ? 's' : ''} enveloppe${creationsCount > 1 ? 's' : ''}`);
        }
        const breakdownStr = breakdownParts.length > 0 ? `(${breakdownParts.join(', ')})` : '';

        const reviewLabel = window.i18n.t('budget_suggestions_review_btn') || 'Examiner';
        const dismissAllLabel = window.i18n.t('budget_auto_btn_dismiss_all_month') || 'Tout écarter';
        const historyLabel = window.i18n.t('budget_auto_btn_history_dismissed') || 'Historique / Écartées';

        return `
            <div class="budget-suggestions-strip" role="region" aria-label="Recommandations budgétaires">
                <div class="budget-strip-left">
                    <span class="budget-strip-icon">💡</span>
                    <div class="budget-strip-info">
                        <span class="budget-strip-title">
                            <strong>${count} suggestion${count > 1 ? 's' : ''} budgétaire${count > 1 ? 's' : ''}</strong>
                            <span class="budget-strip-sub">${breakdownStr}</span>
                        </span>
                        
                        <div class="autopilot-tooltip-wrapper budget-strip-tooltip-wrapper">
                            <span class="budget-strip-impact-pill ${netTotalImpact >= 0 ? 'net-plus' : 'net-minus'}" tabindex="0" role="button" aria-label="Détail impact net">
                                <span>Impact net : ${netTotalImpact >= 0 ? '+' : ''}${formatCurrency(netTotalImpact)}/mois</span>
                                <span class="autopilot-info-icon">ℹ️</span>
                            </span>
                            <div class="autopilot-tooltip-popover autopilot-summary-popover">
                                <div class="autopilot-tooltip-title">
                                    <span>📊 ${window.i18n.t('autopilot_budget_summary_title') || 'Synthèse budgétaire'}</span>
                                </div>
                                <div class="autopilot-tooltip-content">
                                    ${creationsCount > 0 ? `
                                        <div class="autopilot-tooltip-summary-row">
                                            <span class="autopilot-tooltip-cat-name">✨ ${creationsCount} nouvelle${creationsCount > 1 ? 's' : ''} enveloppe${creationsCount > 1 ? 's' : ''}</span>
                                            <span class="autopilot-tooltip-cat-sum"><strong>+${formatCurrency(creationsTotal)}/mois</strong></span>
                                        </div>
                                    ` : ''}
                                    ${recalibsCount > 0 ? `
                                        <div class="autopilot-tooltip-summary-row">
                                            <span class="autopilot-tooltip-cat-name">📊 ${recalibsCount} ajustement${recalibsCount > 1 ? 's' : ''}</span>
                                            <span class="autopilot-tooltip-cat-sum">
                                                <span style="text-decoration: line-through; opacity: 0.7;">${formatCurrency(recalibOldTotal)}</span>
                                                → <strong>${formatCurrency(recalibNewTotal)}</strong>
                                                <span class="${recalibDelta >= 0 ? 'net-plus' : 'net-minus'}" style="font-size: 11px; margin-left: 4px;">(${recalibDelta >= 0 ? '+' : ''}${formatCurrency(recalibDelta)})</span>
                                            </span>
                                        </div>
                                    ` : ''}
                                    <div class="autopilot-tooltip-summary-divider"></div>
                                    <div class="autopilot-tooltip-summary-row" style="font-weight: 700; color: var(--text-main); padding-top: 2px;">
                                        <span>${window.i18n.t('autopilot_budget_summary_total_impact') || 'Impact mensuel net'} :</span>
                                        <span class="${netTotalImpact >= 0 ? 'net-plus' : 'net-minus'}">${netTotalImpact >= 0 ? '+' : ''}${formatCurrency(netTotalImpact)}/mois</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="budget-strip-right">
                    <button type="button" class="btn btn-secondary budget-strip-btn-history" 
                            onclick="window.BudgetsView.openDismissedSuggestionsModal()" 
                            title="${historyLabel}">
                        <span>📋</span> <span class="btn-text">${historyLabel}</span>
                    </button>
                    <button type="button" class="btn btn-secondary budget-strip-btn-dismiss" 
                            onclick="window.BudgetsView.dismissAllAutopilotSuggestions()" 
                            title="${dismissAllLabel}">
                        <span>✕</span> <span class="btn-text">${dismissAllLabel}</span>
                    </button>
                    ${creationsCount > 0 ? `
                        <button type="button" class="btn btn-primary budget-strip-btn-review" 
                                onclick="window.BudgetsView.openSuggestionsInAiView(true)" 
                                title="${window.i18n.t('budget_suggestions_btn_wizard') || 'Examiner dans l\'assistant'}">
                            <span>🪄</span> <span class="btn-text">${reviewLabel} (${count})</span>
                        </button>
                        <button type="button" class="btn btn-secondary budget-strip-btn-quick" 
                                onclick="window.BudgetsView.openSuggestionsReviewModal()" 
                                title="${window.i18n.t('budget_suggestions_btn_table') || 'Vue tabulaire'}" 
                                style="padding: 5px 10px; font-size: 11px;">
                            <span>📋</span>
                        </button>
                    ` : `
                        <button type="button" class="btn btn-primary budget-strip-btn-review" 
                                onclick="window.BudgetsView.openSuggestionsReviewModal()" 
                                title="${reviewLabel}">
                            <span>📋</span> <span class="btn-text">${reviewLabel} (${count})</span>
                        </button>
                    `}
                </div>
            </div>
        `;
    },

    // ─── Passerelle Vers la Présentation Visuelle Riche & Wizard ──────────────
    openSuggestionsInAiView(openWizard = false) {
        if (!this.autopilotSuggestions || !this.autopilotSuggestions.length) return;

        const creations = this.autopilotSuggestions.filter(s => s.type === 'creation');
        if (!creations.length) {
            this.openSuggestionsReviewModal();
            return;
        }

        // Fermer la modale tabulaire si déjà ouverte
        const existing = document.getElementById('budgetSuggestionsReviewModal');
        if (existing) existing.remove();

        // Conversion des suggestions déterministes / IA vers le format aiProposals
        this.aiProposals = creations.map(s => {
            const cats = (s.categories && s.categories.length > 0) ? [...s.categories] : (s.category ? [s.category] : []);
            const cat_amounts = s.cat_amounts ? { ...s.cat_amounts } : {};
            if (Object.keys(cat_amounts).length === 0 && cats.length > 0) {
                if (cats.length === 1) {
                    cat_amounts[cats[0]] = s.suggested_amount;
                } else {
                    const splitVal = Math.round((s.suggested_amount / cats.length) * 100) / 100;
                    cats.forEach(c => { cat_amounts[c] = splitVal; });
                }
            }
            const nameVal = (s.name || s.category || (cats && cats[0]) || 'Enveloppe').trim();
            return {
                name: nameVal,
                category: s.category || nameVal,
                categories: cats,
                cat_amounts: cat_amounts,
                original_cat_amounts: { ...cat_amounts },
                cat_details: s.cat_details || {},
                suggested_amount: s.suggested_amount,
                original_amount: s.suggested_amount,
                historical_actual_amount: s.historical_actual_amount !== undefined ? s.historical_actual_amount : (s.avg_monthly || s.suggested_amount),
                avg_monthly: s.avg_monthly || s.suggested_amount,
                suggested_period: s.suggested_period || 'monthly',
                period: s.suggested_period || 'monthly',
                is_fixed: s.is_fixed || false,
                justification: s.justification || (s.engine === 'deterministic' ? `Moyenne constatée sur ${s.observed_months || 3} mois` : 'Suggestion automatique'),
                selected: true,
                decision_id: s.decision_id,
                engine: s.engine || 'deterministic'
            };
        });

        // Débloquer l'affichage du panneau
        if (window.ProfileSessionStorage) {
            window.ProfileSessionStorage.removeItem('budget_ai_panel_closed');
            window.ProfileSessionStorage.removeItem('budget_ai_panel_hidden');
        } else {
            sessionStorage.removeItem('budget_ai_panel_closed');
            sessionStorage.removeItem('budget_ai_panel_hidden');
        }

        // Initialisation des métadonnées requises par le simulateur d'impact
        this.aiSuggestMeta = {
            window_months: 3,
            effective_window_months: 3,
            is_fallback: false,
            engine: creations[0]?.engine || 'deterministic',
            lang: (window.i18n && window.i18n.currentLang) || 'fr',
            proposals: this.aiProposals,
            unclassified_categories: []
        };
        this.unclassifiedCategories = [];

        // Rendu dans le panneau riche interactif
        this.renderAiProposalsList();

        // Rendre visible et faire défiler vers le panneau
        if (this.showAiPanel) {
            this.showAiPanel();
        } else {
            const panel = document.getElementById('budgetAiPanel');
            if (panel) {
                panel.style.display = 'block';
                panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }

        // Lancer l'assistant wizard
        if (openWizard) {
            this.startAiWizard();
        }
    },

    // ─── Modale Dédiée de Revue & Décision (Option A) ──────────────────────────
    openSuggestionsReviewModal() {
        const existing = document.getElementById('budgetSuggestionsReviewModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'budgetSuggestionsReviewModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1000';

        this._reviewFilter = 'all';
        this._selectedSuggestions = new Set();

        const creations = (this.autopilotSuggestions || []).filter(s => s.type === 'creation');

        modal.innerHTML = `
            <div class="modal budget-review-modal" style="width: 96%; max-width: 920px; max-height: 90vh; display: flex; flex-direction: column; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: var(--shadow-md); padding: 0; overflow: hidden; animation: modalFadeIn 0.25s ease;">
                <!-- Header -->
                <div class="budget-review-modal-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h3 class="budget-review-modal-title">
                            <span>💡</span> <span>${window.i18n.t('budget_suggestions_modal_title') || 'Recommandations Budgétaires'}</span>
                            <span class="budget-review-modal-badge" id="modalReviewCountBadge">${this.autopilotSuggestions.length}</span>
                        </h3>
                        <div class="budget-review-modal-desc">${window.i18n.t('budget_suggestions_modal_subtitle') || 'Examinez et arbitrez les suggestions d\'ajustement et de création d\'enveloppes.'}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        ${creations.length > 0 ? `
                            <button type="button" class="btn btn-primary" onclick="window.BudgetsView.openSuggestionsInAiView(true)" style="display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 6px 14px; background: var(--accent); border: none; border-radius: 8px; box-shadow: 0 2px 8px rgba(var(--accent-rgb),0.35); cursor: pointer;" title="Ouvrir dans l'assistant interactif et le simulateur d'impact">
                                <span>🪄</span> <span>${window.i18n.t('budget_suggestions_btn_open_ai_view') || 'Vue interactive & Simulateur'}</span>
                            </button>
                        ` : ''}
                        <button type="button" class="budget-review-close-btn" onclick="document.getElementById('budgetSuggestionsReviewModal').remove()">×</button>
                    </div>
                </div>

                <!-- KPI Strip inside modal -->
                <div class="budget-review-kpi-bar" id="modalReviewKpiBar">
                    ${this._renderReviewModalKpis()}
                </div>

                <!-- Tabs & Bulk Actions Bar -->
                <div class="budget-review-toolbar">
                    <div class="budget-review-tabs">
                        <button type="button" class="budget-review-tab active" data-filter="all" onclick="window.BudgetsView._setReviewFilter('all')">
                            ${window.i18n.t('budget_suggestions_tab_all') || 'Toutes'} (<span id="tabCountAll">${this.autopilotSuggestions.length}</span>)
                        </button>
                        <button type="button" class="budget-review-tab" data-filter="recalibration" onclick="window.BudgetsView._setReviewFilter('recalibration')">
                            📊 ${window.i18n.t('budget_suggestions_tab_recalibrations') || 'Ajustements'} (<span id="tabCountRecalib">${this.autopilotSuggestions.filter(s => s.type !== 'creation').length}</span>)
                        </button>
                        <button type="button" class="budget-review-tab" data-filter="creation" onclick="window.BudgetsView._setReviewFilter('creation')">
                            ✨ ${window.i18n.t('budget_suggestions_tab_creations') || 'Nouvelles enveloppes'} (<span id="tabCountCreate">${this.autopilotSuggestions.filter(s => s.type === 'creation').length}</span>)
                        </button>
                    </div>
                    <div class="budget-review-bulk-actions">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.BudgetsView._bulkAction('dismiss')" title="${window.i18n.t('budget_auto_btn_dismiss_all_month') || 'Tout écarter'}">
                            <span>✕</span> <span>${window.i18n.t('budget_auto_btn_dismiss_all_month') || 'Tout écarter'}</span>
                        </button>
                        <button type="button" class="btn btn-primary btn-sm" onclick="window.BudgetsView._bulkAction('approve')" title="${window.i18n.t('budget_suggestions_approve_all') || 'Tout approuver'}">
                            <span>✓</span> <span id="btnBulkApproveLabel">${window.i18n.t('budget_suggestions_approve_all') || 'Tout approuver'}</span>
                        </button>
                    </div>
                </div>

                <!-- Suggestions List Container -->
                <div class="budget-review-list-container" id="modalReviewListContainer">
                    ${this._renderReviewListHtml()}
                </div>
            </div>
        `;

        document.body.appendChild(modal);
    },

    _renderReviewModalKpis() {
        const creations = this.autopilotSuggestions.filter(s => s.type === 'creation');
        const recalibs = this.autopilotSuggestions.filter(s => s.type !== 'creation');
        const creationsTotal = creations.reduce((acc, s) => acc + (s.suggested_amount || 0), 0);
        const recalibOldTotal = recalibs.reduce((acc, s) => acc + (s.current_amount || 0), 0);
        const recalibNewTotal = recalibs.reduce((acc, s) => acc + (s.suggested_amount || 0), 0);
        const recalibDelta = recalibNewTotal - recalibOldTotal;
        const netTotalImpact = creationsTotal + recalibDelta;

        return `
            <div class="review-kpi-item">
                <span class="review-kpi-label">📊 Ajustements proposés :</span>
                <span class="review-kpi-val">${recalibs.length} enveloppes (${recalibDelta >= 0 ? '+' : ''}${formatCurrency(recalibDelta)})</span>
            </div>
            <div class="review-kpi-item">
                <span class="review-kpi-label">✨ Nouvelles enveloppes :</span>
                <span class="review-kpi-val">${creations.length} catégories (+${formatCurrency(creationsTotal)})</span>
            </div>
            <div class="review-kpi-item review-kpi-highlight ${netTotalImpact >= 0 ? 'net-plus' : 'net-minus'}">
                <span class="review-kpi-label">Impact mensuel global :</span>
                <span class="review-kpi-val"><strong>${netTotalImpact >= 0 ? '+' : ''}${formatCurrency(netTotalImpact)}/mois</strong></span>
            </div>
        `;
    },

    _setReviewFilter(filter) {
        this._reviewFilter = filter;
        const tabs = document.querySelectorAll('.budget-review-tab');
        tabs.forEach(t => {
            if (t.getAttribute('data-filter') === filter) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });
        const container = document.getElementById('modalReviewListContainer');
        if (container) {
            container.innerHTML = this._renderReviewListHtml();
        }
    },

    _renderReviewListHtml() {
        const escapeHtml = window.escapeHtml || (str => String(str || '').replace(/[&<>'"]/g, tag => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[tag] || tag)));

        let list = this.autopilotSuggestions;
        if (this._reviewFilter === 'creation') {
            list = list.filter(s => s.type === 'creation');
        } else if (this._reviewFilter === 'recalibration') {
            list = list.filter(s => s.type !== 'creation');
        }

        if (list.length === 0) {
            return `
                <div class="budget-review-empty">
                    <span style="font-size: 32px;">🎉</span>
                    <p>${window.i18n.t('budget_suggestions_empty') || 'Aucune recommandation en attente dans cet onglet.'}</p>
                </div>
            `;
        }

        const approveLabel = window.i18n.t('autopilot_budget_approve') || 'Approuver';
        const dismissLabel = window.i18n.t('budget_auto_btn_dismiss_month') || 'Écarter ce mois-ci';

        return list.map(s => {
            const isCreation = s.type === 'creation';
            const title = isCreation ? (s.name || s.category) : (s.budget_name || 'Enveloppe');
            const badgeClass = isCreation ? 'autopilot-badge-creation' : 'autopilot-badge-recalibration';
            const badgeText = isCreation
                ? (window.i18n.t('autopilot_budget_creation_badge') || '✨ Création suggérée')
                : `${window.i18n.t('autopilot_budget_recalibration_badge') || '📊 Recalibrage'} (${s.delta_pct > 0 ? '+' : ''}${s.delta_pct}%)`;

            let engineBadgeHtml = '';
            if (isCreation && s.engine) {
                if (s.engine === 'ai') {
                    engineBadgeHtml = `<span class="autopilot-badge" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; border: 1px solid rgba(99, 102, 241, 0.3);">🤖 ${window.i18n.t('budget_suggestions_engine_ai_badge') || 'IA'}</span>`;
                } else if (s.engine === 'deterministic_fallback') {
                    engineBadgeHtml = `<span class="autopilot-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);" title="${window.i18n.t('budget_auto_engine_ai_offline') || 'Repli déterministe'}">⚙️ ${window.i18n.t('budget_suggestions_engine_fallback_badge') || 'Repli déterministe'}</span>`;
                } else {
                    engineBadgeHtml = `<span class="autopilot-badge" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);">⚙️ ${window.i18n.t('budget_suggestions_engine_det_badge') || 'Déterministe'}</span>`;
                }
            }

            const categoryBreakdown = Array.isArray(s.category_breakdown) ? s.category_breakdown : [];
            const catCount = categoryBreakdown.length;
            const groupedCats = Array.isArray(s.categories) ? s.categories : (s.category ? [s.category] : []);

            let popoverHtml = '';
            if (!isCreation && catCount > 0) {
                popoverHtml = `
                    <div class="autopilot-tooltip-wrapper">
                        <span class="autopilot-cats-pill" tabindex="0" role="button" aria-label="Détail catégories">
                            <span>📂</span> <span class="autopilot-pill-text">${catCount} cat.</span> <span class="autopilot-info-icon">ℹ️</span>
                        </span>
                        <div class="autopilot-tooltip-popover autopilot-cats-popover">
                            <div class="autopilot-tooltip-title"><span>📂 ${catCount} catégories rattachées</span></div>
                            <div class="autopilot-tooltip-content">
                                ${categoryBreakdown.map(c => `
                                    <div class="autopilot-tooltip-cat-item">
                                        <span class="autopilot-tooltip-cat-name">${escapeHtml(c.category)}</span>
                                        <span class="autopilot-tooltip-cat-sum">
                                            <strong>${formatCurrency(c.avg_monthly || 0)}/mois</strong>
                                            <span class="autopilot-tooltip-cat-sub">(${formatCurrency(c.total_spending || 0)} total)</span>
                                        </span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `;
            } else if (isCreation && groupedCats.length > 1) {
                popoverHtml = `
                    <div class="autopilot-tooltip-wrapper">
                        <span class="autopilot-cats-pill" tabindex="0" role="button" aria-label="Détail catégories groupées">
                            <span>📂</span> <span class="autopilot-pill-text">${groupedCats.length} cat.</span> <span class="autopilot-info-icon">ℹ️</span>
                        </span>
                        <div class="autopilot-tooltip-popover autopilot-cats-popover">
                            <div class="autopilot-tooltip-title"><span>📂 ${groupedCats.length} catégories regroupées</span></div>
                            <div class="autopilot-tooltip-content">
                                ${groupedCats.map(c => `
                                    <div class="autopilot-tooltip-cat-item">
                                        <span class="autopilot-tooltip-cat-name">${escapeHtml(c)}</span>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                `;
            } else if (isCreation && s.monthly_values && s.monthly_values.length > 0) {
                popoverHtml = `
                    <div class="autopilot-tooltip-wrapper">
                        <span class="autopilot-cats-pill" tabindex="0" role="button" aria-label="Historique mensuel">
                            <span>🕒</span> <span class="autopilot-pill-text">${s.observed_months || 1} mois</span> <span class="autopilot-info-icon">ℹ️</span>
                        </span>
                        <div class="autopilot-tooltip-popover autopilot-cats-popover">
                            <div class="autopilot-tooltip-title"><span>🕒 Historique mensuel analysé</span></div>
                            <div class="autopilot-tooltip-content">
                                <div class="autopilot-tooltip-history-chips">
                                    ${s.monthly_values.map(v => `<span class="autopilot-history-chip">${formatCurrency(v)}</span>`).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="budget-review-row ${isCreation ? 'review-row-creation' : 'review-row-recalib'}" id="reviewRow_${s.decision_id}">
                    <div class="review-row-left">
                        <div class="review-row-title-line">
                            <strong class="review-row-title">${escapeHtml(title)}</strong>
                            <span class="autopilot-badge ${badgeClass}">${badgeText}</span>
                            ${engineBadgeHtml}
                            ${popoverHtml}
                            ${s.drift_limit_reached ? `
                                <span class="autopilot-badge autopilot-badge-drift" title="Borne annuelle ±25%">⚠️ Plafond annuel</span>
                            ` : ''}
                        </div>
                        <div class="review-row-details">
                            ${isCreation ? `
                                <span class="review-detail-label">Moyenne constatée :</span>
                                <span class="review-detail-val">${formatCurrency(s.avg_monthly || 0)}/mois</span>
                                <span class="review-detail-sep">|</span>
                                <span class="review-detail-label">Montant proposé :</span>
                                <strong class="review-detail-amount">${formatCurrency(s.suggested_amount || 0)}/mois</strong>
                                ${s.justification ? `
                                    <div style="font-size: 11.5px; color: var(--text-muted); font-style: italic; margin-top: 4px; width: 100%;">
                                        💬 ${escapeHtml(s.justification)}
                                    </div>
                                ` : ''}
                            ` : `
                                <span class="review-detail-label">Évolution :</span>
                                <span class="review-detail-old" style="text-decoration: line-through; opacity: 0.65;">${formatCurrency(s.current_amount || 0)}</span>
                                <span class="review-arrow">→</span>
                                <strong class="review-detail-amount">${formatCurrency(s.suggested_amount || 0)}/mois</strong>
                                <span class="review-detail-sep">|</span>
                                <span class="review-detail-label">Moyenne :</span>
                                <span class="review-detail-val">${formatCurrency(s.avg_spending || 0)}/mois</span>
                            `}
                        </div>
                    </div>
                    <div class="review-row-actions">
                        <button type="button" class="btn btn-secondary btn-sm review-action-btn" 
                                onclick="window.BudgetsView._handleRowAction('dismiss', ${s.decision_id})" 
                                title="${dismissLabel}">
                            <span>✕</span> <span>${dismissLabel}</span>
                        </button>
                        <button type="button" class="btn btn-primary btn-sm review-action-btn" 
                                onclick="window.BudgetsView._handleRowAction('approve', ${s.decision_id})" 
                                title="${approveLabel}">
                            <span>✓</span> <span>${approveLabel}</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    async _handleRowAction(action, decisionId) {
        const row = document.getElementById(`reviewRow_${decisionId}`);
        if (row) {
            row.style.opacity = '0.5';
            row.style.pointerEvents = 'none';
        }

        const onRowProcessed = async () => {
            // Retirer localement la suggestion
            this.autopilotSuggestions = this.autopilotSuggestions.filter(s => s.decision_id !== decisionId);
            
            // Si plus de suggestions, fermer la modale
            if (this.autopilotSuggestions.length === 0) {
                const modal = document.getElementById('budgetSuggestionsReviewModal');
                if (modal) modal.remove();
                await Promise.all([
                    this.loadBudgets(),
                    this.loadAllStatuses(),
                    this.loadAutopilotSuggestions()
                ]);
                this.renderStatus();
                return;
            }

            // Mettre à jour les compteurs dans la modale
            const badge = document.getElementById('modalReviewCountBadge');
            if (badge) badge.textContent = this.autopilotSuggestions.length;
            const tabAll = document.getElementById('tabCountAll');
            if (tabAll) tabAll.textContent = this.autopilotSuggestions.length;
            const tabRecalib = document.getElementById('tabCountRecalib');
            if (tabRecalib) tabRecalib.textContent = this.autopilotSuggestions.filter(s => s.type !== 'creation').length;
            const tabCreate = document.getElementById('tabCountCreate');
            if (tabCreate) tabCreate.textContent = this.autopilotSuggestions.filter(s => s.type === 'creation').length;

            const kpiBar = document.getElementById('modalReviewKpiBar');
            if (kpiBar) kpiBar.innerHTML = this._renderReviewModalKpis();

            if (row) {
                row.remove();
            }

            // Rafraîchir le bandeau d'arrière-plan sans recharger toute la modale
            const strip = document.querySelector('.budget-suggestions-strip');
            if (strip) {
                const newStripHtml = this.renderAutopilotSuggestionsBanner();
                if (newStripHtml) {
                    strip.outerHTML = newStripHtml;
                } else {
                    strip.remove();
                }
            }
        };

        if (action === 'approve') {
            await this.approveAutopilotSuggestion(decisionId, onRowProcessed);
        } else {
            await this.dismissAutopilotSuggestion(decisionId, onRowProcessed);
        }
    },

    async _bulkAction(action) {
        let targets = this.autopilotSuggestions;
        if (this._reviewFilter === 'creation') {
            targets = targets.filter(s => s.type === 'creation');
        } else if (this._reviewFilter === 'recalibration') {
            targets = targets.filter(s => s.type !== 'creation');
        }

        const ids = targets.map(s => s.decision_id);
        if (ids.length === 0) return;

        if (action === 'approve') {
            await this.approveAllAutopilotSuggestions(ids);
        } else {
            await this.dismissAllAutopilotSuggestions(ids);
        }
    },

    // ─── Modale des Automatismes ⚙️ ──────────────────────────────────────────
    async openBudgetAutomationsModal() {
        const existing = document.getElementById('budgetAutomationsModal');
        if (existing) existing.remove();

        let cfg = {};
        try {
            cfg = await API.get('/api/config/');
        } catch (err) {
            console.error('[Budgets] Erreur chargement config automatismes:', err);
        }

        const isEnableCreation = (cfg.enable_budget_creation_suggestions ?? 'true') === 'true';
        const isAutoCreate = (cfg.auto_create_budget_envelopes ?? 'false') === 'true';
        const isEnableRecalib = (cfg.enable_budget_recalibration_suggestions ?? 'true') === 'true';
        const isAutoApply = (cfg.auto_apply_budget_suggestions ?? 'false') === 'true';
        const currentEngine = cfg.budget_suggestion_engine || 'deterministic';

        const modal = document.createElement('div');
        modal.id = 'budgetAutomationsModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1000';

        const title = window.i18n.t('budget_automations_title') || 'Automatismes des enveloppes budgétaires';
        const desc = window.i18n.t('budget_automations_desc') || 'Configurez les suggestions autonomes de création et de recalibrage de vos enveloppes.';

        modal.innerHTML = `
            <div class="modal" style="width: 94%; max-width: 620px; min-width: 0; max-height: 90vh; overflow-y: auto; box-sizing: border-box; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: var(--shadow-md); padding: clamp(14px, 3.5vw, 24px); display: flex; flex-direction: column; gap: 16px; animation: modalFadeIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; gap: 10px;">
                    <div>
                        <h3 style="margin: 0; font-size: clamp(16px, 3vw, 18px); font-weight: 700; display: flex; align-items: center; gap: 8px;">⚙️ ${title}</h3>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">${desc}</div>
                    </div>
                    <button type="button" style="background: transparent; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted); line-height: 1; padding: 2px 6px;" onclick="document.getElementById('budgetAutomationsModal').remove()">×</button>
                </div>
                
                <form id="budgetAutomationsForm" style="display: flex; flex-direction: column; gap: 14px;" onsubmit="event.preventDefault(); window.BudgetsView.saveBudgetAutomationsConfig();">
                    
                    <!-- Section 1 : Suggestions de création d'enveloppes (Volet A) -->
                    <div style="padding: 13px 14px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-base); display: flex; flex-direction: column; gap: 12px;">
                        <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="cfg_enable_budget_creation_suggestions" ${isEnableCreation ? 'checked' : ''} onchange="window.BudgetsView.updateBudgetAutomationsDependencies()" style="margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                    <span>✨</span> <span>${window.i18n.t('budget_auto_enable_creation_title') || "Suggestions de création d'enveloppes"}</span>
                                </div>
                                <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px; line-height: 1.4;">
                                    ${window.i18n.t('budget_auto_enable_creation_desc') || "Détecte les dépenses régulières orphelines (au moins 2 mois d'historique) et suggère de nouvelles enveloppes."}
                                </div>
                            </div>
                        </label>

                        <!-- Branche dépendante : Moteur de suggestion + Auto-création -->
                        <div id="branch_auto_create" style="margin-left: clamp(8px, 2vw, 16px); border-left: 2px solid var(--accent); padding-left: clamp(8px, 2vw, 14px); display: flex; flex-direction: column; gap: 10px; transition: opacity 0.2s ease, border-color 0.2s ease;">
                            
                            <!-- Sélecteur de moteur : Déterministe vs IA -->
                            <div id="box_engine_budget_suggestions" style="padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: opacity 0.2s ease;">
                                <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
                                    <span style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                        <span>🧠</span> <span>${window.i18n.t('budget_auto_engine_title') || 'Moteur de découverte des enveloppes'}</span>
                                    </span>
                                    <span id="ollama_status_badge" style="font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: rgba(148, 163, 184, 0.15); color: var(--text-muted); white-space: nowrap;">
                                        ${cfg.ollama_url ? '⏳ Vérification Ollama...' : (window.i18n.t('budget_auto_engine_ai_unconfigured') || 'Ollama non configuré')}
                                    </span>
                                </div>
                                <div style="font-size: 12px; color: var(--text-muted); margin-bottom: 8px; line-height: 1.4;">
                                    ${window.i18n.t('budget_auto_engine_desc') || 'Choisissez comment les dépenses orphelines sont analysées et regroupées.'}
                                </div>

                                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px;">
                                    <label id="engine_lbl_deterministic" style="display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border-radius: 6px; border: 1.5px solid ${currentEngine === 'deterministic' ? 'var(--accent)' : 'var(--border-color)'}; background: ${currentEngine === 'deterministic' ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent'}; cursor: pointer; transition: all 0.2s ease;">
                                        <input type="radio" name="budget_suggestion_engine" value="deterministic" ${currentEngine === 'deterministic' ? 'checked' : ''} onchange="window.BudgetsView._selectEngineInModal('deterministic')" style="margin-top: 2px; accent-color: var(--accent); cursor: pointer;">
                                        <div style="flex: 1; min-width: 0;">
                                            <div style="font-size: 12px; font-weight: 700; color: var(--text-main);">⚙️ ${window.i18n.t('budget_auto_engine_deterministic') || 'Déterministe (Sans IA)'}</div>
                                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.3;">${window.i18n.t('budget_auto_engine_deterministic_desc') || '100% hors-ligne, calculé directement sur vos dépenses réelles.'}</div>
                                        </div>
                                    </label>

                                    <label id="engine_lbl_ai" style="display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border-radius: 6px; border: 1.5px solid ${currentEngine === 'ai' ? 'var(--accent)' : 'var(--border-color)'}; background: ${currentEngine === 'ai' ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent'}; cursor: pointer; transition: all 0.2s ease;">
                                        <input type="radio" name="budget_suggestion_engine" value="ai" ${currentEngine === 'ai' ? 'checked' : ''} onchange="window.BudgetsView._selectEngineInModal('ai')" style="margin-top: 2px; accent-color: var(--accent); cursor: pointer;">
                                        <div style="flex: 1; min-width: 0;">
                                            <div style="font-size: 12px; font-weight: 700; color: var(--text-main);">🤖 ${window.i18n.t('budget_auto_engine_ai') || 'Assisté par IA (Ollama)'}</div>
                                            <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.3;">${window.i18n.t('budget_auto_engine_ai_desc') || 'Regroupement sémantique multi-catégories via votre LLM local.'}</div>
                                        </div>
                                    </label>
                                </div>
                            </div>

                            <!-- Auto-création -->
                            <div id="box_auto_create_budget_envelopes" style="padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: opacity 0.2s ease;">
                                <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin: 0;">
                                    <input type="checkbox" id="cfg_auto_create_budget_envelopes" ${isAutoCreate ? 'checked' : ''} style="margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                                            <span>${window.i18n.t('budget_auto_create_title') || 'Auto-création sans validation'}</span>
                                            <span style="font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; white-space: nowrap;">${window.i18n.t('budget_auto_badge_autonomous') || 'Option autonome'}</span>
                                        </div>
                                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px; line-height: 1.4;">
                                            ${window.i18n.t('budget_auto_create_desc') || 'Crée automatiquement les enveloppes pour les nouvelles catégories régulières détectées, sans confirmation préalable.'}
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- Section 2 : Suggestions de recalibrage mensuel (Volet B) -->
                    <div style="padding: 13px 14px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-base); display: flex; flex-direction: column; gap: 12px;">
                        <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="cfg_enable_budget_recalibration_suggestions" ${isEnableRecalib ? 'checked' : ''} onchange="window.BudgetsView.updateBudgetAutomationsDependencies()" style="margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                    <span>📊</span> <span>${window.i18n.t('budget_auto_enable_recalib_title') || 'Suggestions de recalibrage mensuel'}</span>
                                </div>
                                <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px; line-height: 1.4;">
                                    ${window.i18n.t('budget_auto_enable_recalib_desc') || 'Analyse vos dépenses réelles chaque mois et propose des ajustements budgétaires lissés (EMA).'}
                                </div>
                            </div>
                        </label>

                        <!-- Branche dépendante : Auto-application -->
                        <div id="branch_auto_apply" style="margin-left: clamp(8px, 2vw, 16px); border-left: 2px solid var(--accent); padding-left: clamp(8px, 2vw, 14px); display: flex; flex-direction: column; gap: 8px; transition: opacity 0.2s ease, border-color 0.2s ease;">
                            <div id="box_auto_apply_budget_suggestions" style="padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: opacity 0.2s ease;">
                                <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin: 0;">
                                    <input type="checkbox" id="cfg_auto_apply_budget_suggestions" ${isAutoApply ? 'checked' : ''} style="margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--accent); cursor: pointer;">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                                            <span>${window.i18n.t('budget_auto_apply_title') || 'Auto-application sans validation'}</span>
                                            <span style="font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: rgba(245, 158, 11, 0.15); color: #f59e0b; white-space: nowrap;">${window.i18n.t('budget_auto_badge_autonomous') || 'Option autonome'}</span>
                                        </div>
                                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px; line-height: 1.4;">
                                            ${window.i18n.t('budget_auto_apply_desc') || 'Applique automatiquement les ajustements EMA mensuels lissés (bornes de sécurité : ±10%/mois et ±25%/an).'}
                                        </div>
                                        <div style="font-size: 11px; color: #f59e0b; margin-top: 4px; font-style: italic;">
                                            ${window.i18n.t('budget_auto_apply_warning') || '⚠️ Requiert le Centre de Contrôle (Étape 6) pour une visibilité optimale'}
                                        </div>
                                    </div>
                                </label>
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; flex-wrap: wrap;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('budgetAutomationsModal').remove()">
                            ${window.i18n.t('btn_cancel') || 'Annuler'}
                        </button>
                        <button type="submit" class="btn btn-primary" style="font-weight: 600;">
                            ${window.i18n.t('btn_save') || 'Enregistrer'}
                        </button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
        this.updateBudgetAutomationsDependencies();

        // Sondage asynchrone du statut Ollama pour l'indicateur visuel
        if (cfg.ollama_url) {
            fetch('/api/config/ollama/models', { signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined })
                .then(r => {
                    const badge = document.getElementById('ollama_status_badge');
                    if (!badge) return;
                    if (r.ok) {
                        badge.style.background = 'rgba(16, 185, 129, 0.15)';
                        badge.style.color = '#10b981';
                        badge.textContent = '🟢 ' + (window.i18n.t('budget_auto_engine_ai_online') || 'Ollama connecté');
                    } else {
                        badge.style.background = 'rgba(245, 158, 11, 0.15)';
                        badge.style.color = '#f59e0b';
                        badge.textContent = '🟠 ' + (window.i18n.t('budget_auto_engine_ai_offline') || 'Ollama indisponible');
                    }
                })
                .catch(() => {
                    const badge = document.getElementById('ollama_status_badge');
                    if (badge) {
                        badge.style.background = 'rgba(245, 158, 11, 0.15)';
                        badge.style.color = '#f59e0b';
                        badge.textContent = '🟠 ' + (window.i18n.t('budget_auto_engine_ai_offline') || 'Ollama indisponible');
                    }
                });
        }
    },

    _selectEngineInModal(engine) {
        const lblDet = document.getElementById('engine_lbl_deterministic');
        const lblAi = document.getElementById('engine_lbl_ai');
        if (lblDet) {
            lblDet.style.borderColor = engine === 'deterministic' ? 'var(--accent)' : 'var(--border-color)';
            lblDet.style.background = engine === 'deterministic' ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent';
        }
        if (lblAi) {
            lblAi.style.borderColor = engine === 'ai' ? 'var(--accent)' : 'var(--border-color)';
            lblAi.style.background = engine === 'ai' ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent';
        }
    },

    updateBudgetAutomationsDependencies() {
        const enableCreateChk = document.getElementById('cfg_enable_budget_creation_suggestions');
        const autoCreateChk = document.getElementById('cfg_auto_create_budget_envelopes');
        const branchCreate = document.getElementById('branch_auto_create');
        const boxEngine = document.getElementById('box_engine_budget_suggestions');
        const boxAutoCreate = document.getElementById('box_auto_create_budget_envelopes');

        const isCreateEnabled = !!(enableCreateChk && enableCreateChk.checked);
        if (branchCreate) {
            branchCreate.style.borderColor = isCreateEnabled ? 'var(--accent)' : 'var(--border-color)';
        }
        if (boxEngine) {
            boxEngine.style.opacity = isCreateEnabled ? '1' : '0.45';
            boxEngine.style.pointerEvents = isCreateEnabled ? 'auto' : 'none';
        }
        if (autoCreateChk && boxAutoCreate) {
            autoCreateChk.disabled = !isCreateEnabled;
            boxAutoCreate.style.opacity = isCreateEnabled ? '1' : '0.45';
            boxAutoCreate.style.pointerEvents = isCreateEnabled ? 'auto' : 'none';
        }

        const enableRecalibChk = document.getElementById('cfg_enable_budget_recalibration_suggestions');
        const autoApplyChk = document.getElementById('cfg_auto_apply_budget_suggestions');
        const branchRecalib = document.getElementById('branch_auto_apply');
        const boxAutoApply = document.getElementById('box_auto_apply_budget_suggestions');

        const isRecalibEnabled = !!(enableRecalibChk && enableRecalibChk.checked);
        if (branchRecalib) {
            branchRecalib.style.borderColor = isRecalibEnabled ? 'var(--accent)' : 'var(--border-color)';
        }
        if (autoApplyChk && boxAutoApply) {
            autoApplyChk.disabled = !isRecalibEnabled;
            boxAutoApply.style.opacity = isRecalibEnabled ? '1' : '0.45';
            boxAutoApply.style.pointerEvents = isRecalibEnabled ? 'auto' : 'none';
        }
    },

    async saveBudgetAutomationsConfig() {
        const enableCreateChk = document.getElementById('cfg_enable_budget_creation_suggestions');
        const autoCreateChk = document.getElementById('cfg_auto_create_budget_envelopes');
        const enableRecalibChk = document.getElementById('cfg_enable_budget_recalibration_suggestions');
        const autoApplyChk = document.getElementById('cfg_auto_apply_budget_suggestions');
        const selectedEngineRadio = document.querySelector('input[name="budget_suggestion_engine"]:checked');
        const engine = selectedEngineRadio ? selectedEngineRadio.value : 'deterministic';

        const isCreateEnabled = !!(enableCreateChk && enableCreateChk.checked);
        const isRecalibEnabled = !!(enableRecalibChk && enableRecalibChk.checked);

        const payload = {
            enable_budget_creation_suggestions: isCreateEnabled ? 'true' : 'false',
            auto_create_budget_envelopes: (isCreateEnabled && autoCreateChk && autoCreateChk.checked) ? 'true' : 'false',
            enable_budget_recalibration_suggestions: isRecalibEnabled ? 'true' : 'false',
            auto_apply_budget_suggestions: (isRecalibEnabled && autoApplyChk && autoApplyChk.checked) ? 'true' : 'false',
            budget_suggestion_engine: engine,
        };

        try {
            await API.post('/api/config/', payload);
            showToast(window.i18n.t('budget_toast_automations_saved') || 'Paramètres des automatismes budgétaires enregistrés', 'success');
            const modal = document.getElementById('budgetAutomationsModal');
            if (modal) modal.remove();

            // Recharger immédiatement les suggestions pour mettre à jour le bandeau et la liste
            if (window.BudgetsView && typeof window.BudgetsView.loadAutopilotSuggestions === 'function') {
                await window.BudgetsView.loadAutopilotSuggestions();
                this.renderStatus();
            }
        } catch (err) {
            console.error('[Budgets] Erreur sauvegarde config automatismes:', err);
            showToast(window.i18n.t('budget_toast_automations_error') || 'Erreur de sauvegarde des automatismes', 'error');
        }
    },

    // ─── Modale d'Historique des Suggestions Écartées 📋 ─────────────────────
    async openDismissedSuggestionsModal() {
        const existing = document.getElementById('budgetDismissedSuggestionsModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'budgetDismissedSuggestionsModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1010';

        const title = window.i18n.t('budget_auto_modal_history_title') || 'Historique des suggestions écartées';
        const subtitle = window.i18n.t('budget_auto_modal_history_subtitle') || 'Retrouvez ici les propositions d\'enveloppes et de recalibrage écartées. Vous pouvez les réactiver à tout moment.';

        modal.innerHTML = `
            <div class="modal" style="width: 96%; max-width: 780px; max-height: 85vh; display: flex; flex-direction: column; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: var(--shadow-md); padding: 0; overflow: hidden; animation: modalFadeIn 0.25s ease;">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: clamp(14px, 3vw, 20px); border-bottom: 1px solid var(--border-color); background: var(--bg-base); gap: 12px;">
                    <div>
                        <h3 style="margin: 0; font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <span>📋</span> <span>${title}</span>
                        </h3>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">${subtitle}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button type="button" id="btnClearDismissedHistory" class="btn btn-secondary btn-sm" 
                                onclick="window.BudgetsView.clearDismissedSuggestionsHistory()" 
                                style="font-size: 11.5px; padding: 5px 10px; display: none; align-items: center; gap: 5px; color: var(--danger-color, #ef4444); border-color: rgba(239, 68, 68, 0.3);"
                                title="${window.i18n.t('budget_auto_btn_clear_history') || 'Vider l\'historique'}">
                            <span>🗑️</span> <span>${window.i18n.t('budget_auto_btn_clear_history') || 'Vider l\'historique'}</span>
                        </button>
                        <button type="button" style="background: transparent; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted); line-height: 1; padding: 2px 6px;" onclick="document.getElementById('budgetDismissedSuggestionsModal').remove()">×</button>
                    </div>
                </div>

                <!-- Body / List -->
                <div id="dismissedListContainer" style="padding: 16px; overflow-y: auto; flex: 1; display: flex; flex-direction: column; gap: 10px;">
                    <div style="text-align: center; padding: 30px; color: var(--text-muted);">
                        <span>⏳ Chargement de l'historique...</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        await this._loadAndRenderDismissedList();
    },

    async _loadAndRenderDismissedList() {
        const container = document.getElementById('dismissedListContainer');
        if (!container) return;

        try {
            const items = await API.get('/api/budgets/autopilot/suggestions/dismissed');
            const clearBtn = document.getElementById('btnClearDismissedHistory');
            if (clearBtn) {
                clearBtn.style.display = (!items || items.length === 0) ? 'none' : 'inline-flex';
            }

            if (!items || items.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 45px 20px; color: var(--text-muted);">
                        <span style="font-size: 38px; display: block; margin-bottom: 12px;">🌱</span>
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">
                            ${window.i18n.t('budget_auto_empty_dismissed') || 'Aucune suggestion écartée pour le moment.'}
                        </div>
                        <div style="font-size: 12px;">Toutes vos propositions sont actives ou ont déjà été validées.</div>
                    </div>
                `;
                return;
            }

            container.innerHTML = items.map(item => {
                const isCreation = item.type === 'creation';
                const typeBadge = isCreation 
                    ? `<span class="autopilot-badge badge-creation" style="background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;">✨ ${window.i18n.t('budget_auto_history_type_creation') || 'Nouvelle enveloppe'}</span>`
                    : `<span class="autopilot-badge badge-recalib" style="background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3); padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600;">📊 ${window.i18n.t('budget_auto_history_type_recalibration') || 'Recalibrage'}</span>`;
                
                const dateStr = item.dismissed_at ? new Date(item.dismissed_at).toLocaleDateString() : '';

                return `
                    <div class="dismissed-suggestion-row" id="dismissedRow_${item.decision_id}" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-base); gap: 14px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 240px;">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <strong style="font-size: 14px; color: var(--text-main);">${escapeHtml(item.name)}</strong>
                                ${typeBadge}
                                <span style="font-size: 11px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: 4px;">
                                    ${window.i18n.t('budget_auto_dismissed_badge') || 'Écartée'}${dateStr ? ` le ${dateStr}` : ''}
                                </span>
                            </div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-top: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                ${isCreation ? `
                                    <span>Montant proposé : <strong style="color: var(--text-main);">${formatCurrency(item.suggested_amount || 0)}/mois</strong></span>
                                    ${item.categories && item.categories.length > 1 ? `<span style="opacity: 0.7;">(${item.categories.length} catégories)</span>` : ''}
                                ` : `
                                    <span>Actuel : <span style="text-decoration: line-through;">${formatCurrency(item.current_amount || 0)}</span></span>
                                    <span>→</span>
                                    <span>Proposé : <strong style="color: var(--text-main);">${formatCurrency(item.suggested_amount || 0)}/mois</strong></span>
                                `}
                            </div>
                            ${item.justification ? `
                                <div style="font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 4px;">
                                    💬 ${escapeHtml(item.justification)}
                                </div>
                            ` : ''}
                        </div>
                        <div>
                            <button type="button" class="btn btn-secondary btn-sm btn-reactivate-action" 
                                    onclick="window.BudgetsView.reactivateDismissedSuggestion(${item.decision_id})" 
                                    style="display: flex; align-items: center; gap: 6px; font-weight: 600; padding: 6px 12px; border-radius: 6px;"
                                    title="${window.i18n.t('budget_auto_btn_reactivate') || 'Réactiver cette suggestion'}">
                                <span>↩️</span> <span>${window.i18n.t('budget_auto_btn_reactivate') || 'Réactiver'}</span>
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('[Budgets] Erreur chargement suggestions écartées:', err);
            container.innerHTML = `
                <div style="text-align: center; padding: 30px; color: var(--danger-color, #ef4444);">
                    Erreur lors du chargement des suggestions écartées.
                </div>
            `;
        }
    },

    async reactivateDismissedSuggestion(decisionId) {
        const row = document.getElementById(`dismissedRow_${decisionId}`);
        if (row) {
            row.style.opacity = '0.5';
            row.style.pointerEvents = 'none';
        }

        try {
            await API.post(`/api/budgets/autopilot/suggestions/${decisionId}/reactivate`);
            showToast(window.i18n.t('budget_auto_toast_reactivated') || 'Suggestion réactivée avec succès', 'success');

            // Recharger la liste des suggestions actives et l'historique
            await Promise.all([
                this.loadAutopilotSuggestions(),
                this._loadAndRenderDismissedList()
            ]);

            // Mettre à jour l'affichage de la vue budgets
            this.renderStatus();
        } catch (err) {
            console.error('[Budgets] Erreur réactivation suggestion:', err);
            showToast(err.message || 'Erreur lors de la réactivation', 'error');
            if (row) {
                row.style.opacity = '1';
                row.style.pointerEvents = 'auto';
            }
        }
    },

    async clearDismissedSuggestionsHistory() {
        const btn = document.getElementById('btnClearDismissedHistory');
        if (!this._confirmingClearHistory) {
            this._confirmingClearHistory = true;
            if (btn) {
                btn.innerHTML = `<span>⚠️</span> <span>Confirmer la purge ?</span>`;
                btn.style.borderColor = 'rgba(239, 68, 68, 0.8)';
                btn.style.background = 'rgba(239, 68, 68, 0.15)';
            }
            if (this._clearHistoryTimeout) clearTimeout(this._clearHistoryTimeout);
            this._clearHistoryTimeout = setTimeout(() => {
                this._confirmingClearHistory = false;
                if (btn) {
                    btn.innerHTML = `<span>🗑️</span> <span>${window.i18n.t('budget_auto_btn_clear_history') || 'Vider l\'historique'}</span>`;
                    btn.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                    btn.style.background = 'transparent';
                }
            }, 4000);
            return;
        }

        // Deuxième clic : exécution immédiate
        this._confirmingClearHistory = false;
        if (this._clearHistoryTimeout) clearTimeout(this._clearHistoryTimeout);

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span>⏳</span> <span>Purge...</span>`;
        }

        try {
            await API.delete('/api/budgets/autopilot/suggestions/dismissed');
            showToast(window.i18n.t('budget_auto_toast_history_cleared') || 'Historique des suggestions écartées vidé avec succès', 'info');
            await Promise.all([
                this.loadAutopilotSuggestions(),
                this._loadAndRenderDismissedList()
            ]);
            this.renderStatus();
        } catch (err) {
            console.error('[Budgets] Erreur vidage historique suggestions écartées:', err);
            showToast(err.message || 'Erreur lors du vidage de l\'historique', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>🗑️</span> <span>${window.i18n.t('budget_auto_btn_clear_history') || 'Vider l\'historique'}</span>`;
            }
        }
    }
});

