// static/js/views/budgets/budgets_autopilot.js
// Enveloppes Budgétaires — Auto-Pilote (Suggestions déterministes & Automatismes)

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    autopilotSuggestions: [],

    async loadAutopilotSuggestions() {
        try {
            const data = await API.get('/api/budgets/autopilot/suggestions');
            this.autopilotSuggestions = Array.isArray(data) ? data : [];
            return this.autopilotSuggestions;
        } catch (err) {
            console.error('[AutoPilot Budgets] Erreur chargement suggestions:', err);
            this.autopilotSuggestions = [];
            return [];
        }
    },

    async approveAutopilotSuggestion(decisionId) {
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

            await Promise.all([
                this.loadBudgets(),
                this.loadAllStatuses(),
                this.loadAutopilotSuggestions()
            ]);
            this.renderStatus();
        } catch (err) {
            console.error('[AutoPilot Budgets] Erreur approbation suggestion:', err);
            showToast(err.message || 'Erreur lors de l\'approbation', 'error');
        }
    },

    async dismissAutopilotSuggestion(decisionId) {
        try {
            const res = await API.post(`/api/budgets/autopilot/suggestions/${decisionId}/dismiss`);
            const target = this.autopilotSuggestions.find(s => s.decision_id === decisionId);
            const name = target ? (target.category || target.budget_name || 'Enveloppe') : 'Enveloppe';
            
            const template = window.i18n.t('autopilot_budget_dismissed_toast') || "Suggestion pour '{name}' ignorée";
            const toastMsg = template.replace('{name}', name);

            if (typeof showUndoToast === 'function' && res.action_id) {
                showUndoToast(toastMsg, res.action_id, async () => {
                    await this.loadAutopilotSuggestions();
                    this.renderStatus();
                });
            } else {
                showToast(toastMsg, 'info');
            }

            await this.loadAutopilotSuggestions();
            this.renderStatus();
        } catch (err) {
            console.error('[AutoPilot Budgets] Erreur rejet suggestion:', err);
            showToast(err.message || 'Erreur lors du rejet', 'error');
        }
    },

    renderAutopilotSuggestionsBanner() {
        if (!this.autopilotSuggestions || this.autopilotSuggestions.length === 0) {
            return '';
        }

        const escapeHtml = window.escapeHtml || (str => String(str || '').replace(/[&<>'"]/g, tag => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            "'": '&#39;',
            '"': '&quot;'
        }[tag] || tag)));

        const count = this.autopilotSuggestions.length;
        const bannerTitle = window.i18n.t('autopilot_budget_banner_title') || '🤖 Suggestions Budgétaires Auto-Pilote';
        const bannerSubtitle = window.i18n.t('autopilot_budget_banner_subtitle') || 'Suggestions calculées de manière déterministe. Aucune enveloppe n\'est créée ni modifiée sans votre accord.';
        const approveLabel = window.i18n.t('autopilot_budget_approve') || 'Approuver';
        const dismissLabel = window.i18n.t('autopilot_budget_dismiss') || 'Ignorer';

        // Synthèse macro pour l'info-bulle globale
        const creations = this.autopilotSuggestions.filter(s => s.type === 'creation');
        const recalibs = this.autopilotSuggestions.filter(s => s.type !== 'creation');
        const creationsTotal = creations.reduce((acc, s) => acc + (s.suggested_amount || 0), 0);
        const recalibOldTotal = recalibs.reduce((acc, s) => acc + (s.current_amount || 0), 0);
        const recalibNewTotal = recalibs.reduce((acc, s) => acc + (s.suggested_amount || 0), 0);
        const recalibDelta = recalibNewTotal - recalibOldTotal;
        const netTotalImpact = creationsTotal + recalibDelta;

        const summaryHtml = `
            <div class="autopilot-banner-summary-pill-group">
                <div class="autopilot-tooltip-wrapper">
                    <span class="autopilot-summary-pill" tabindex="0" role="button" aria-label="${window.i18n.t('autopilot_budget_summary_label') || 'Détails des sommes'}">
                        <span>📊</span>
                        <span>${window.i18n.t('autopilot_budget_summary_label') || 'Détails des sommes'}</span>
                        <span class="autopilot-summary-net-tag ${netTotalImpact >= 0 ? 'net-plus' : 'net-minus'}">
                            ${netTotalImpact >= 0 ? '+' : ''}${formatCurrency(netTotalImpact)}/mois
                        </span>
                        <span class="autopilot-info-icon">ℹ️</span>
                    </span>
                    <div class="autopilot-tooltip-popover autopilot-summary-popover">
                        <div class="autopilot-tooltip-title">
                            <span>📊 ${window.i18n.t('autopilot_budget_summary_title') || 'Synthèse budgétaire des suggestions'}</span>
                        </div>
                        <div class="autopilot-tooltip-content">
                            ${creations.length > 0 ? `
                                <div class="autopilot-tooltip-summary-row">
                                    <span class="autopilot-tooltip-cat-name">✨ ${creations.length} nouvelle${creations.length > 1 ? 's' : ''} enveloppe${creations.length > 1 ? 's' : ''}</span>
                                    <span class="autopilot-tooltip-cat-sum"><strong>+${formatCurrency(creationsTotal)}/mois</strong></span>
                                </div>
                            ` : ''}
                            ${recalibs.length > 0 ? `
                                <div class="autopilot-tooltip-summary-row">
                                    <span class="autopilot-tooltip-cat-name">📊 ${recalibs.length} recalibrage${recalibs.length > 1 ? 's' : ''}</span>
                                    <span class="autopilot-tooltip-cat-sum">
                                        <span style="text-decoration: line-through; opacity: 0.7;">${formatCurrency(recalibOldTotal)}</span>
                                        → <strong>${formatCurrency(recalibNewTotal)}</strong>
                                        <span class="${recalibDelta >= 0 ? 'net-plus' : 'net-minus'}" style="font-size: 11px; margin-left: 4px;">(${recalibDelta >= 0 ? '+' : ''}${formatCurrency(recalibDelta)})</span>
                                    </span>
                                </div>
                            ` : ''}
                            <div class="autopilot-tooltip-summary-divider"></div>
                            <div class="autopilot-tooltip-summary-row" style="font-weight: 700; color: var(--text-main); padding-top: 4px;">
                                <span>${window.i18n.t('autopilot_budget_summary_total_impact') || 'Impact mensuel net global'} :</span>
                                <span class="${netTotalImpact >= 0 ? 'net-plus' : 'net-minus'}">${netTotalImpact >= 0 ? '+' : ''}${formatCurrency(netTotalImpact)}/mois</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        const cardsHtml = this.autopilotSuggestions.map(s => {
            const isCreation = s.type === 'creation';
            const badgeClass = isCreation ? 'autopilot-badge-creation' : 'autopilot-badge-recalibration';
            const badgeText = isCreation
                ? (window.i18n.t('autopilot_budget_creation_badge') || '✨ Création suggérée')
                : `${window.i18n.t('autopilot_budget_recalibration_badge') || '📊 Recalibrage'} (${s.delta_pct > 0 ? '+' : ''}${s.delta_pct}%)`;

            const title = isCreation ? s.category : (s.budget_name || 'Enveloppe');
            const avgLabel = window.i18n.t('autopilot_budget_avg_observed') || 'Moyenne observée';
            const suggestedLabel = window.i18n.t('autopilot_budget_suggested_amount') || 'Montant suggéré';
            const isOneOff = !!s.is_one_off;

            let bodyHtml = '';
            if (isCreation) {
                const catLabel = window.i18n.t('label_category') || 'Catégorie';
                bodyHtml = `
                    <div class="autopilot-card-body">
                        <!-- Info-bulle Catégorie détaillée & Historique -->
                        <div class="autopilot-card-row autopilot-cats-row">
                            <span class="autopilot-card-label">${catLabel} :</span>
                            <div class="autopilot-tooltip-wrapper">
                                <span class="autopilot-cats-pill" tabindex="0" role="button" aria-label="Détail catégorie">
                                    <span>🏷️</span>
                                    <span class="autopilot-pill-text">${escapeHtml(s.category)}</span>
                                    <span class="autopilot-info-icon">ℹ️</span>
                                </span>
                                <div class="autopilot-tooltip-popover autopilot-cats-popover">
                                    <div class="autopilot-tooltip-title">
                                        <span>🏷️ ${escapeHtml(s.category)}</span>
                                    </div>
                                    <div class="autopilot-tooltip-content">
                                        <div class="autopilot-tooltip-cat-item">
                                            <span class="autopilot-tooltip-cat-name">${avgLabel} :</span>
                                            <span class="autopilot-tooltip-cat-sum"><strong>${formatCurrency(s.avg_monthly || 0)}/mois</strong></span>
                                        </div>
                                        ${s.monthly_values && s.monthly_values.length > 0 ? `
                                            <div class="autopilot-tooltip-history-title">${window.i18n.t('autopilot_budget_monthly_history_label') || 'Historique mensuel analysé'} :</div>
                                            <div class="autopilot-tooltip-history-chips">
                                                ${s.monthly_values.map(v => `<span class="autopilot-history-chip">${formatCurrency(v)}</span>`).join('')}
                                            </div>
                                        ` : ''}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="autopilot-card-row">
                            <span class="autopilot-card-label">${avgLabel} :</span>
                            <span class="autopilot-card-val">${formatCurrency(s.avg_monthly || 0)}/mois</span>
                        </div>
                        <div class="autopilot-card-row">
                            <span class="autopilot-card-label">${suggestedLabel} :</span>
                            <strong class="autopilot-card-amount">${formatCurrency(s.suggested_amount || 0)}/mois</strong>
                        </div>
                        ${s.observed_months ? `<div class="autopilot-card-hint">${s.observed_months} mois d'historique analysés</div>` : ''}
                    </div>
                `;
            } else {
                const currentLabel = 'Actuel';
                const driftWarning = s.drift_limit_reached ? `
                    <div class="autopilot-drift-warning">
                        ⚠️ ${window.i18n.t('autopilot_budget_drift_limit_reached') || 'Plafond annuel de dérive atteint (±25%)'}
                    </div>
                ` : '';

                const categoryBreakdown = Array.isArray(s.category_breakdown) ? s.category_breakdown : [];
                const catCount = categoryBreakdown.length;
                const breakdownTitleTemplate = window.i18n.t('autopilot_budget_cats_breakdown_title') || 'Catégories concernées ({count})';
                const breakdownTitle = breakdownTitleTemplate.replace('{count}', catCount);
                const catsLabel = window.i18n.t('autopilot_budget_categories_covered') || 'Catégories';

                const categoriesTooltipHtml = catCount > 0 ? `
                    <div class="autopilot-card-row autopilot-cats-row">
                        <span class="autopilot-card-label">${catsLabel} :</span>
                        <div class="autopilot-tooltip-wrapper">
                            <span class="autopilot-cats-pill" tabindex="0" role="button" aria-label="Catégories rattachées">
                                <span>📂</span>
                                <span class="autopilot-pill-text">${catCount} catégorie${catCount > 1 ? 's' : ''}</span>
                                <span class="autopilot-info-icon">ℹ️</span>
                            </span>
                            <div class="autopilot-tooltip-popover autopilot-cats-popover">
                                <div class="autopilot-tooltip-title">
                                    <span>📂 ${breakdownTitle}</span>
                                </div>
                                <div class="autopilot-tooltip-content">
                                    ${categoryBreakdown.map(c => `
                                        <div class="autopilot-tooltip-cat-item">
                                            <span class="autopilot-tooltip-cat-name">${escapeHtml(c.category)}</span>
                                            <span class="autopilot-tooltip-cat-sum">
                                                <strong>${formatCurrency(c.avg_monthly || 0)}/mois</strong>
                                                <span class="autopilot-tooltip-cat-sub">(${formatCurrency(c.total_spending || 0)} ${window.i18n.t('autopilot_budget_total_spent') || 'total'})</span>
                                            </span>
                                        </div>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                    </div>
                ` : '';

                bodyHtml = `
                    <div class="autopilot-card-body">
                        ${categoriesTooltipHtml}
                        <div class="autopilot-card-row">
                            <span class="autopilot-card-label">${currentLabel} → ${suggestedLabel} :</span>
                            <span class="autopilot-card-val">
                                <span style="text-decoration: line-through; opacity: 0.7;">${formatCurrency(s.current_amount || 0)}</span>
                                → <strong class="autopilot-card-amount">${formatCurrency(s.suggested_amount || 0)}</strong>
                            </span>
                        </div>
                        <div class="autopilot-card-row">
                            <span class="autopilot-card-label">${avgLabel} :</span>
                            <span class="autopilot-card-val">${formatCurrency(s.avg_spending || 0)}/mois</span>
                        </div>
                        ${driftWarning}
                    </div>
                `;
            }

            return `
                <div class="autopilot-suggestion-card ${isCreation ? 'autopilot-card-create' : 'autopilot-card-recalib'}">
                    <div class="autopilot-card-header">
                        <div style="min-width:0; flex:1;">
                            <div class="autopilot-card-title">${escapeHtml(title)}</div>
                            <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 3px;">
                                <span class="autopilot-badge ${badgeClass}">${badgeText}</span>
                                ${isOneOff ? `
                                    <span class="autopilot-badge autopilot-badge-one-off" title="${window.i18n.t('autopilot_budget_one_off_tooltip') || 'Dépense observée sur un seul mois.'}">
                                        ${window.i18n.t('autopilot_budget_one_off_badge') || '⚠️ Ponctuelle (1 mois obs.)'}
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                    ${bodyHtml}
                    <div class="autopilot-card-actions">
                        <button type="button" class="btn btn-secondary autopilot-action-btn autopilot-btn-dismiss" 
                                onclick="window.BudgetsView.dismissAutopilotSuggestion(${s.decision_id})" 
                                title="${dismissLabel}">
                            <span>✕</span> <span>${dismissLabel}</span>
                        </button>
                        <button type="button" class="btn btn-primary autopilot-action-btn autopilot-btn-approve" 
                                onclick="window.BudgetsView.approveAutopilotSuggestion(${s.decision_id})" 
                                title="${approveLabel}">
                            <span>✓</span> <span>${approveLabel}</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');

        return `
            <div class="autopilot-suggestion-banner">
                <div class="autopilot-banner-header">
                    <div class="autopilot-banner-title-group">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <h4 class="autopilot-banner-title">${bannerTitle}</h4>
                            <span class="autopilot-banner-count">${count}</span>
                        </div>
                        ${summaryHtml}
                    </div>
                    <div class="autopilot-banner-subtitle">${bannerSubtitle}</div>
                </div>
                <div class="autopilot-cards-grid">
                    ${cardsHtml}
                </div>
            </div>
        `;
    },

    async openBudgetAutomationsModal() {
        const existing = document.getElementById('budgetAutomationsModal');
        if (existing) existing.remove();

        let cfg = {};
        try {
            cfg = await API.get('/api/config/');
        } catch (err) {
            console.error('[AutoPilot Budgets] Erreur chargement config automatismes:', err);
        }

        const isAutoCreate = (cfg.auto_create_budget_envelopes ?? 'false') === 'true';
        const isAutoApply = (cfg.auto_apply_budget_suggestions ?? 'false') === 'true';

        const modal = document.createElement('div');
        modal.id = 'budgetAutomationsModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1000';

        const title = window.i18n.t('budget_automations_title') || 'Automatismes des enveloppes budgétaires';
        const desc = window.i18n.t('budget_automations_desc') || 'Configurez les comportements autonomes de création et de recalibrage des enveloppes.';

        modal.innerHTML = `
            <div class="modal" style="width: 94%; max-width: 620px; min-width: 0; max-height: 90vh; overflow-y: auto; box-sizing: border-box; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); padding: clamp(14px, 3.5vw, 24px); display: flex; flex-direction: column; gap: 16px; animation: modalFadeIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid var(--border-color); padding-bottom: 12px; gap: 10px;">
                    <div>
                        <h3 style="margin: 0; font-size: clamp(16px, 3vw, 18px); font-weight: 700; display: flex; align-items: center; gap: 8px;">⚙️ ${title}</h3>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">${desc}</div>
                    </div>
                    <button type="button" style="background: transparent; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted); line-height: 1; padding: 2px 6px;" onclick="document.getElementById('budgetAutomationsModal').remove()">×</button>
                </div>
                
                <form id="budgetAutomationsForm" style="display: flex; flex-direction: column; gap: 14px;" onsubmit="event.preventDefault(); window.BudgetsView.saveBudgetAutomationsConfig();">
                    <!-- Option Racine : Auto-création des enveloppes pour catégories orphelines -->
                    <div style="padding: 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-base);">
                        <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin: 0;">
                            <input type="checkbox" id="cfg_auto_create_budget_envelopes" ${isAutoCreate ? 'checked' : ''} onchange="window.BudgetsView.updateBudgetAutomationsDependencies()" style="margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--primary-color, #6366f1); cursor: pointer;">
                            <div style="flex: 1; min-width: 0;">
                                <div style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px;">
                                    <span style="display: flex; align-items: center; gap: 6px;"><span>✨</span> <span>${window.i18n.t('budget_auto_create_title') || 'Auto-création des enveloppes orphelines'}</span></span>
                                    <span style="font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 4px; background: rgba(99, 102, 241, 0.15); color: #6366f1; white-space: nowrap;">${window.i18n.t('budget_auto_create_badge') || 'Option principale'}</span>
                                </div>
                                <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px; line-height: 1.4;">
                                    ${window.i18n.t('budget_auto_create_desc') || 'Crée automatiquement les enveloppes budgétaires pour les nouvelles catégories de dépenses détectées, sans demander de validation.'}
                                </div>
                            </div>
                        </label>
                    </div>

                    <!-- Branche Hiérarchique Conditionnée : Auto-application des recalibrages mensuels -->
                    <div id="subBudgetAutomationsBranch" style="margin-left: clamp(10px, 2.5vw, 20px); border-left: 2px solid var(--primary-color, #6366f1); padding-left: clamp(8px, 2vw, 14px); display: flex; flex-direction: column; gap: 12px; transition: opacity 0.2s ease, border-color 0.2s ease;">
                        <div id="box_auto_apply_budget_suggestions" style="padding: 11px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-base); transition: opacity 0.2s ease;">
                            <label style="display: flex; align-items: flex-start; gap: 12px; cursor: pointer; margin: 0;">
                                <input type="checkbox" id="cfg_auto_apply_budget_suggestions" ${isAutoApply ? 'checked' : ''} style="margin-top: 3px; width: 18px; height: 18px; flex-shrink: 0; accent-color: var(--primary-color, #6366f1); cursor: pointer;">
                                <div style="flex: 1; min-width: 0;">
                                    <div style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                        <span>📊</span> <span>${window.i18n.t('budget_auto_apply_title') || 'Auto-application des recalibrages mensuels'}</span>
                                    </div>
                                    <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px; line-height: 1.4;">
                                        ${window.i18n.t('budget_auto_apply_desc') || 'Applique automatiquement les ajustements EMA mensuels lissés. Double plafond : ±10%/mois et ±25%/an.'}
                                    </div>
                                    <div style="font-size: 11px; color: #f59e0b; margin-top: 4px; font-style: italic;">
                                        ${window.i18n.t('budget_auto_apply_warning') || '⚠️ Requiert le Centre de Contrôle (Étape 6) pour une visibilité optimale'}
                                    </div>
                                </div>
                            </label>
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
    },

    updateBudgetAutomationsDependencies() {
        const createChk = document.getElementById('cfg_auto_create_budget_envelopes');
        const applyChk = document.getElementById('cfg_auto_apply_budget_suggestions');
        const branch = document.getElementById('subBudgetAutomationsBranch');
        const applyBox = document.getElementById('box_auto_apply_budget_suggestions');

        const isCreateActive = !!(createChk && createChk.checked);

        if (branch) {
            branch.style.borderColor = isCreateActive ? 'var(--primary-color, #6366f1)' : 'var(--border-color)';
        }
        if (applyChk && applyBox) {
            applyChk.disabled = !isCreateActive;
            applyBox.style.opacity = isCreateActive ? '1' : '0.45';
            applyBox.style.pointerEvents = isCreateActive ? 'auto' : 'none';
        }
    },

    async saveBudgetAutomationsConfig() {
        const createChk = document.getElementById('cfg_auto_create_budget_envelopes');
        const applyChk = document.getElementById('cfg_auto_apply_budget_suggestions');

        const payload = {
            auto_create_budget_envelopes: (createChk && createChk.checked) ? 'true' : 'false',
            auto_apply_budget_suggestions: (applyChk && applyChk.checked && createChk && createChk.checked) ? 'true' : 'false',
        };

        try {
            await API.post('/api/config/', payload);
            showToast(window.i18n.t('budget_toast_automations_saved') || 'Paramètres des automatismes budgétaires enregistrés', 'success');
            const modal = document.getElementById('budgetAutomationsModal');
            if (modal) modal.remove();
        } catch (err) {
            console.error('[AutoPilot Budgets] Erreur sauvegarde config automatismes:', err);
            showToast(window.i18n.t('budget_toast_automations_error') || 'Erreur de sauvegarde des automatismes', 'error');
        }
    }
});
