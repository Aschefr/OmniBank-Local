// static/js/views/budgets/budgets_autopilot.js
// Recommandations & Automatismes des Enveloppes Budgétaires

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    autopilotSuggestions: [],
    _reviewFilter: 'all',

    async loadAutopilotSuggestions() {
        try {
            const [data, cfg, autoStatus] = await Promise.all([
                API.get('/api/budgets/autopilot/suggestions'),
                API.get('/api/config/').catch(() => ({})),
                API.get('/api/budgets/autopilot/status').catch(() => ({}))
            ]);
            this.autopilotSuggestions = Array.isArray(data) ? data : [];
            this.autopilotConfig = cfg || {};
            this.autopilotStatus = autoStatus || {};
            return this.autopilotSuggestions;
        } catch (err) {
            console.error('[Budgets Recommendations] Erreur chargement suggestions:', err);
            this.autopilotSuggestions = [];
            return [];
        }
    },

    _formatRelativeTime(isoDateStr) {
        if (!isoDateStr) return null;
        try {
            const d = new Date(isoDateStr);
            if (isNaN(d.getTime())) return null;
            const now = new Date();
            const diffSec = Math.floor((now - d) / 1000);
            if (diffSec < 45) return window.i18n.t('budget_auto_time_just_now') || "à l'instant";
            if (diffSec < 3600) {
                const mins = Math.max(1, Math.floor(diffSec / 60));
                return `il y a ${mins} min`;
            }
            if (diffSec < 86400) {
                const hours = Math.floor(diffSec / 3600);
                return `il y a ${hours}h`;
            }
            const days = Math.floor(diffSec / 86400);
            if (days === 1) return 'hier';
            if (days < 7) return `il y a ${days} jours`;
            return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
        } catch {
            return null;
        }
    },

    async approveAutopilotSuggestion(decisionId, onComplete, customAmount = null) {
        try {
            const payload = (customAmount !== null && customAmount !== undefined && !isNaN(customAmount) && Number(customAmount) > 0)
                ? { custom_amount: Number(customAmount) }
                : null;
            const res = await API.post(`/api/budgets/autopilot/suggestions/${decisionId}/approve`, payload);
            const name = res.name || 'Enveloppe';
            const amount = res.amount || res.new_amount || 0;
            
            let toastMsg;
            if (res.type === 'creation') {
                const template = window.i18n.t('autopilot_budget_created_toast') || "Enveloppe '{name}' créée avec succès ({amount} €)";
                toastMsg = template.replace('{name}', name).replace('{amount}', amount);
            } else if (res.type === 'enrichment') {
                const template = window.i18n.t('autopilot_budget_enriched_toast') || "Enveloppe « {name} » enrichie avec « {category} » ({amount} €)";
                toastMsg = template.replace('{name}', name).replace('{category}', res.new_category || '').replace('{amount}', amount);
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

    async dismissAllAutopilotSuggestionsWithConfirm(selectedIds = null) {
        const confirmMsg = window.i18n.t('budget_auto_confirm_dismiss_all') ||
            "Écarter toutes les recommandations pour ce mois-ci ?\n\nCes propositions ne seront plus suggérées ce mois-ci, mais restent réactivables à tout moment dans l'Historique / Suggestions écartées.";
        if (!confirm(confirmMsg)) {
            return;
        }
        await this.dismissAllAutopilotSuggestions(selectedIds);
    },

    // ─── Bandeau Compact 1-Ligne (Option A) ──────────────────────────────────
    renderAutopilotSuggestionsBanner() {
        const isEnableCreation = (this.autopilotConfig?.enable_budget_creation_suggestions ?? 'true') === 'true';
        const isEnableRecalib = (this.autopilotConfig?.enable_budget_recalibration_suggestions ?? 'true') === 'true';
        const isMonitoringActive = isEnableCreation || isEnableRecalib;

        // Si une analyse automatique / IA est en cours d'exécution
        if (this._isAiAnalyzing) {
            const isDet = (this._analyzingEngine === 'deterministic');
            const defaultStep = isDet
                ? (window.i18n.t('budget_auto_det_step_grouping') || 'Calcul des montants et des propositions...')
                : (window.i18n.t('budget_auto_ai_analyzing_step') || 'Recherche et regroupement thématique des catégories...');
            const stepDesc = this._aiAnalyzingStep || defaultStep;
            const titleIcon = isDet ? '⚡' : '🤖';
            const titleText = isDet
                ? (window.i18n.t('budget_auto_det_analyzing_title') || 'Analyse des dépenses en cours...')
                : (window.i18n.t('budget_auto_ai_analyzing_title') || 'Analyse IA en cours...');

            return `
                <div class="budget-suggestions-strip budget-strip-analyzing" role="region" aria-label="Analyse en cours">
                    <div class="budget-strip-left">
                        <span class="budget-monitoring-pulse-dot" style="background: var(--accent); box-shadow: 0 0 8px var(--accent);" title="Analyse en cours"></span>
                        <div class="budget-strip-info">
                            <span class="budget-strip-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <strong style="color: var(--accent);">${titleIcon} ${titleText}</strong>
                                <span style="font-size: 12px; color: var(--text-muted);">${stepDesc}</span>
                            </span>
                        </div>
                    </div>
                    <div class="budget-strip-right" style="display: flex; align-items: center; gap: 12px;">
                        <div class="budget-ai-progress-bar-wrap" style="width: 130px; height: 7px; background: var(--border-color); border-radius: 4px; overflow: hidden; position: relative;">
                            <div id="budgetAiBannerProgressBar" style="width: ${this._aiAnalyzingPct || 40}%; height: 100%; background: var(--accent); border-radius: 4px; transition: width 0.3s ease;"></div>
                        </div>
                        <span style="font-size: 11px; font-weight: 700; color: var(--text-muted); min-width: 32px;">${this._aiAnalyzingPct || 40}%</span>
                    </div>
                </div>
            `;
        }

        if (!this.autopilotSuggestions || this.autopilotSuggestions.length === 0) {
            if (!isMonitoringActive) {
                return '';
            }

            // S'il n'y a aucune enveloppe active créée, masquer le bandeau de surveillance "enveloppes équilibrées"
            const activeBudgetsCount = Array.isArray(this.budgets) && this.budgets.length > 0
                ? this.budgets.filter(b => !b.is_closed).length
                : (Array.isArray(this.statusData?.budgets) ? this.statusData.budgets.filter(b => !b.is_closed).length : 0);
            if (activeBudgetsCount === 0) {
                return '';
            }

            const activeMonitoringTitle = window.i18n.t('budget_auto_active_monitoring_title') || 'Surveillance active :';
            let activeMonitoringDesc;
            if (isEnableRecalib && isEnableCreation) {
                activeMonitoringDesc = window.i18n.t('budget_auto_active_monitoring_desc') || 'Toutes vos enveloppes sont équilibrées pour ce mois.';
            } else if (!isEnableRecalib && isEnableCreation) {
                activeMonitoringDesc = window.i18n.t('budget_auto_active_monitoring_creation_only') || 'Veille sur les nouvelles catégories régulières (ajustements d\'enveloppes désactivés).';
            } else {
                activeMonitoringDesc = window.i18n.t('budget_auto_active_monitoring_recalib_only') || 'Vos enveloppes existantes sont équilibrées (création de nouvelles enveloppes désactivée).';
            }

            const lastRunIso = this.autopilotStatus?.last_run_at;
            const relativeLastRun = lastRunIso ? this._formatRelativeTime(lastRunIso) : null;
            const lastRunText = relativeLastRun ? ` • ${window.i18n.t('budget_auto_last_analyzed') || 'Dernière analyse'} ${relativeLastRun}` : '';

            const historyLabel = window.i18n.t('budget_auto_btn_history_dismissed') || 'Historique / Écartées';
            const refreshLabel = window.i18n.t('budget_auto_btn_refresh_tt') || 'Actualiser les recommandations';
            const isCollapsed = window.ProfileStorage && window.ProfileStorage.get('budget_monitoring_strip_collapsed') === 'true';

            if (isCollapsed) {
                return `
                    <div class="budget-suggestions-strip budget-strip-active-monitoring budget-strip-monitoring-collapsed" role="region" aria-label="Surveillance active (réduite)">
                        <div class="budget-strip-left" onclick="window.BudgetsView.toggleMonitoringStrip()" style="cursor: pointer;" title="${window.i18n.t('budget_auto_strip_expand_tt') || 'Déplier le bandeau de surveillance'}">
                            <span class="budget-monitoring-pulse-dot" title="Surveillance active"></span>
                            <span class="budget-monitoring-title-text" style="font-size: 12px; color: var(--text-muted);">${activeMonitoringTitle} ${activeMonitoringDesc}${lastRunText}</span>
                        </div>
                        <div class="budget-strip-right">
                            <button type="button" class="btn btn-secondary budget-strip-btn-toggle" 
                                    onclick="window.BudgetsView.toggleMonitoringStrip()" 
                                    title="${window.i18n.t('budget_auto_strip_expand_tt') || 'Déplier le bandeau de surveillance'}">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                            </button>
                        </div>
                    </div>
                `;
            }

            return `
                <div class="budget-suggestions-strip budget-strip-active-monitoring" role="region" aria-label="Surveillance active">
                    <div class="budget-strip-left">
                        <span class="budget-monitoring-pulse-dot" title="Surveillance active"></span>
                        <div class="budget-strip-info">
                            <span class="budget-strip-title" style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <strong class="budget-monitoring-title-text">${activeMonitoringTitle}</strong>
                                <span class="budget-monitoring-desc-text">${activeMonitoringDesc}${lastRunText}</span>
                            </span>
                        </div>
                    </div>
                    <div class="budget-strip-right">
                        <button type="button" class="btn btn-secondary budget-strip-btn-history" 
                                onclick="window.BudgetsView.openDismissedSuggestionsModal()" 
                                title="${historyLabel}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M3.05 11a9 9 0 0 1 .5-2m1.8-3.4A9 9 0 0 1 11 3.05"/></svg>
                            <span class="btn-text">${historyLabel}</span>
                        </button>
                        <button type="button" class="btn btn-secondary budget-strip-btn-refresh" 
                                onclick="window.BudgetsView.triggerAutopilotAnalysis()" 
                                title="${refreshLabel}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                        </button>
                        <button type="button" class="btn btn-secondary budget-strip-btn-toggle" 
                                onclick="window.BudgetsView.toggleMonitoringStrip()" 
                                title="${window.i18n.t('budget_auto_strip_collapse_tt') || 'Réduire le bandeau'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>
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

        const lastRunIso = this.autopilotStatus?.last_run_at;
        const relativeLastRun = lastRunIso ? this._formatRelativeTime(lastRunIso) : null;
        const lastRunText = relativeLastRun ? ` • ${window.i18n.t('budget_auto_last_analyzed') || 'Dernière analyse'} ${relativeLastRun}` : '';

        const reviewLabel = window.i18n.t('budget_suggestions_review_btn') || 'Examiner';
        const dismissAllLabel = window.i18n.t('budget_auto_btn_dismiss_all_month') || 'Écarter ce mois-ci';
        const historyLabel = window.i18n.t('budget_auto_btn_history_dismissed') || 'Historique / Écartées';

        return `
            <div class="budget-suggestions-strip" role="region" aria-label="Recommandations budgétaires">
                <div class="budget-strip-left">
                    <span class="budget-strip-icon">💡</span>
                    <div class="budget-strip-info">
                        <span class="budget-strip-title">
                            <strong>${count} suggestion${count > 1 ? 's' : ''} budgétaire${count > 1 ? 's' : ''}</strong>
                            <span class="budget-strip-sub">${breakdownStr}${lastRunText}</span>
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
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/><path d="M3.05 11a9 9 0 0 1 .5-2m1.8-3.4A9 9 0 0 1 11 3.05"/></svg>
                        <span class="btn-text">${historyLabel}</span>
                    </button>
                    <button type="button" class="btn btn-secondary budget-strip-btn-dismiss" 
                            onclick="window.BudgetsView.dismissAllAutopilotSuggestionsWithConfirm()" 
                            title="${dismissAllLabel}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        <span class="btn-text">${dismissAllLabel}</span>
                    </button>
                    ${creationsCount > 0 ? `
                        <button type="button" class="btn btn-primary budget-strip-btn-review" 
                                onclick="window.BudgetsView.openSuggestionsInAiView(true)" 
                                title="${window.i18n.t('budget_suggestions_btn_wizard') || 'Examiner dans l\'assistant'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                            <span class="btn-text">${reviewLabel} (${count})</span>
                        </button>
                        <button type="button" class="btn btn-secondary budget-strip-btn-quick" 
                                onclick="window.BudgetsView.openSuggestionsReviewModal()" 
                                title="${window.i18n.t('budget_suggestions_btn_table') || 'Vue tabulaire'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                        </button>
                    ` : `
                        <button type="button" class="btn btn-primary budget-strip-btn-review" 
                                onclick="window.BudgetsView.openSuggestionsReviewModal()" 
                                title="${reviewLabel}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/></svg>
                            <span class="btn-text">${reviewLabel} (${count})</span>
                        </button>
                    `}
                </div>
            </div>
        `;
    },

    // ─── Passerelle Vers la Présentation Visuelle Riche & Wizard ──────────────
    async openSuggestionsInAiView(openWizard = false) {
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
        if (typeof this.removeProfileSessionItem === 'function') {
            this.removeProfileSessionItem('budget_ai_panel_closed');
            this.removeProfileSessionItem('budget_ai_panel_hidden');
        } else if (window.ProfileSessionStorage) {
            window.ProfileSessionStorage.removeItem('budget_ai_panel_closed');
            window.ProfileSessionStorage.removeItem('budget_ai_panel_hidden');
        } else {
            sessionStorage.removeItem('budget_ai_panel_closed');
            sessionStorage.removeItem('budget_ai_panel_hidden');
        }

        // S'assurer de la disponibilité des données de capacité si non encore chargées
        if (!this.capacityData && window.API) {
            try {
                this.capacityData = await window.API.get('/api/budgets/capacity');
            } catch (e) {}
        }

        const refSalary = (typeof this.getEffectiveReferenceSalary === 'function')
            ? this.getEffectiveReferenceSalary()
            : ((this.capacityData && this.capacityData.monthly) ? (this.capacityData.monthly.average_income || this.capacityData.monthly.income_ref || 0) : 0);

        if (refSalary > 0 && (this.customSalaryOverride === undefined || this.customSalaryOverride === null)) {
            this.customSalaryOverride = refSalary;
        }

        // Initialisation des métadonnées requises par le simulateur d'impact
        this.aiSuggestMeta = {
            window_months: 3,
            effective_window_months: 3,
            is_fallback: false,
            engine: creations[0]?.engine || 'deterministic',
            lang: (window.i18n && window.i18n.currentLang) || 'fr',
            proposals: this.aiProposals,
            unclassified_categories: [],
            regular_salary: refSalary,
            monthly_income_reference: refSalary
        };
        this.unclassifiedCategories = [];

        const salaryInputMain = document.getElementById('aiSimSalaryInput') || document.getElementById('aiRefSalaryInput');
        if (salaryInputMain && refSalary > 0) {
            salaryInputMain.value = refSalary.toFixed(2);
        }

        // Rendu dans le panneau riche interactif et persistance en session
        this.renderAiProposalsList();
        if (typeof this.saveAiStateToSession === 'function') {
            this.saveAiStateToSession();
        }

        // Rendre visible le panneau
        if (this.showAiPanel) {
            this.showAiPanel();
        } else {
            const panel = document.getElementById('budgetAiPanel');
            if (panel) {
                panel.style.display = 'block';
            }
        }

        // Lancer l'assistant wizard
        if (openWizard) {
            this.startAiWizard();
        }
    },

    closeSuggestionsReviewModal() {
        const modal = document.getElementById('budgetSuggestionsReviewModal');
        if (modal) modal.remove();
        this.renderStatus();
    },

    toggleMonitoringStrip() {
        const key = 'budget_monitoring_strip_collapsed';
        const current = window.ProfileStorage ? window.ProfileStorage.get(key) === 'true' : false;
        if (window.ProfileStorage) {
            window.ProfileStorage.set(key, (!current).toString());
        }
        const strip = document.querySelector('.budget-strip-active-monitoring');
        if (strip) {
            const newHtml = this.renderAutopilotSuggestionsBanner();
            if (newHtml) strip.outerHTML = newHtml;
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

        modal.onclick = (e) => {
            if (e.target === modal) {
                window.BudgetsView.closeSuggestionsReviewModal();
            }
        };

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                window.BudgetsView.closeSuggestionsReviewModal();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        this._reviewFilter = 'all';
        this._selectedSuggestions = new Set();

        const creations = (this.autopilotSuggestions || []).filter(s => s.type === 'creation');

        modal.innerHTML = `
            <div class="modal budget-review-modal" style="width: 96%; max-width: 920px; max-height: 90vh; display: flex; flex-direction: column; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: var(--shadow-md); padding: 0; overflow: hidden; animation: modalFadeIn 0.25s ease;">
                <!-- Header -->
                <div class="budget-review-modal-header">
                    <div class="budget-review-header-content">
                        <h3 class="budget-review-modal-title">
                            <span>💡</span> <span>${window.i18n.t('budget_suggestions_modal_title') || 'Recommandations Budgétaires'}</span>
                            <span class="budget-review-modal-badge" id="modalReviewCountBadge">${this.autopilotSuggestions.length}</span>
                        </h3>
                        <div class="budget-review-modal-desc">${window.i18n.t('budget_suggestions_modal_subtitle') || 'Examinez et arbitrez les suggestions d\'ajustement et de création d\'enveloppes.'}</div>
                        ${creations.length > 0 ? `
                            <div class="budget-review-header-extra">
                                <button type="button" class="btn btn-primary budget-review-btn-ai-view" onclick="window.BudgetsView.openSuggestionsInAiView(true)" title="Ouvrir dans l'assistant interactif et le simulateur d'impact">
                                    <span>🪄</span> <span>${window.i18n.t('budget_suggestions_btn_open_ai_view') || 'Vue interactive & Simulateur'}</span>
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    <button type="button" class="budget-review-close-btn" onclick="window.BudgetsView.closeSuggestionsReviewModal()" aria-label="${window.i18n.t('btn_close') || 'Fermer'}" title="${window.i18n.t('btn_close') || 'Fermer'}">✕</button>
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
                            📊 ${window.i18n.t('budget_suggestions_tab_recalibrations') || 'Ajustements'} (<span id="tabCountRecalib">${this.autopilotSuggestions.filter(s => s.type !== 'creation' && s.type !== 'enrichment').length}</span>)
                        </button>
                        <button type="button" class="budget-review-tab" data-filter="enrichment" onclick="window.BudgetsView._setReviewFilter('enrichment')">
                            🔗 ${window.i18n.t('budget_suggestions_tab_enrichments') || 'Enrichissements'} (<span id="tabCountEnrich">${this.autopilotSuggestions.filter(s => s.type === 'enrichment').length}</span>)
                        </button>
                        <button type="button" class="budget-review-tab" data-filter="creation" onclick="window.BudgetsView._setReviewFilter('creation')">
                            ✨ ${window.i18n.t('budget_suggestions_tab_creations') || 'Nouvelles enveloppes'} (<span id="tabCountCreate">${this.autopilotSuggestions.filter(s => s.type === 'creation').length}</span>)
                        </button>
                    </div>
                    <div class="budget-review-bulk-actions">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.BudgetsView._bulkAction('dismiss')" title="${window.i18n.t('budget_auto_btn_dismiss_all_month') || 'Écarter ce mois-ci'}">
                            <span>🗑️</span> <span>${window.i18n.t('budget_auto_btn_dismiss_all_month') || 'Écarter ce mois-ci'}</span>
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
        const enrichments = this.autopilotSuggestions.filter(s => s.type === 'enrichment');
        const recalibs = this.autopilotSuggestions.filter(s => s.type !== 'creation' && s.type !== 'enrichment');
        const creationsTotal = creations.reduce((acc, s) => acc + (s.suggested_amount || 0), 0);
        const enrichTotal = enrichments.reduce((acc, s) => acc + (s.additional_amount || (s.suggested_amount - s.current_amount) || 0), 0);
        const recalibOldTotal = recalibs.reduce((acc, s) => acc + (s.current_amount || 0), 0);
        const recalibNewTotal = recalibs.reduce((acc, s) => acc + (s.suggested_amount || 0), 0);
        const recalibDelta = recalibNewTotal - recalibOldTotal;
        const netTotalImpact = creationsTotal + enrichTotal + recalibDelta;

        return `
            <div class="review-kpi-item">
                <span class="review-kpi-label">📊 Ajustements :</span>
                <span class="review-kpi-val">${recalibs.length} enveloppes (${recalibDelta >= 0 ? '+' : ''}${formatCurrency(recalibDelta)})</span>
            </div>
            ${enrichments.length > 0 ? `
                <div class="review-kpi-item">
                    <span class="review-kpi-label">🔗 Enrichissements :</span>
                    <span class="review-kpi-val">${enrichments.length} enveloppes (+${formatCurrency(enrichTotal)})</span>
                </div>
            ` : ''}
            <div class="review-kpi-item">
                <span class="review-kpi-label">✨ Nouvelles :</span>
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
        } else if (this._reviewFilter === 'enrichment') {
            list = list.filter(s => s.type === 'enrichment');
        } else if (this._reviewFilter === 'recalibration') {
            list = list.filter(s => s.type !== 'creation' && s.type !== 'enrichment');
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
            const isEnrichment = s.type === 'enrichment';
            const title = isEnrichment ? (s.target_budget_name || s.name || 'Enveloppe') : (isCreation ? (s.name || s.category) : (s.budget_name || 'Enveloppe'));
            const badgeClass = isEnrichment ? 'autopilot-badge-enrichment' : (isCreation ? 'autopilot-badge-creation' : 'autopilot-badge-recalibration');
            const badgeText = isEnrichment
                ? (window.i18n.t('autopilot_budget_enrichment_badge') || '🔗 Enrichissement suggéré')
                : (isCreation
                    ? (window.i18n.t('autopilot_budget_creation_badge') || '✨ Création suggérée')
                    : `${window.i18n.t('autopilot_budget_recalibration_badge') || '📊 Recalibrage'} (${s.delta_pct > 0 ? '+' : ''}${s.delta_pct}%)`);

            let engineBadgeHtml = '';
            if ((isCreation || isEnrichment) && s.engine) {
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
            const groupedCats = isEnrichment
                ? [s.new_category || s.category]
                : (Array.isArray(s.categories) ? s.categories : (s.category ? [s.category] : []));

            let popoverHtml = '';
            if (!isCreation && !isEnrichment && catCount > 0) {
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
            } else if (s.monthly_values && s.monthly_values.length > 0) {
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

            const rowClass = isEnrichment ? 'review-row-enrichment' : (isCreation ? 'review-row-creation' : 'review-row-recalib');

            return `
                <div class="budget-review-row ${rowClass}" id="reviewRow_${s.decision_id}">
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
                        ${groupedCats && groupedCats.length > 0 ? `
                            <div class="review-row-categories-chips" style="display: flex; gap: 4px; flex-wrap: wrap; margin-top: 4px; margin-bottom: 4px;">
                                ${isEnrichment
                                    ? `<span style="font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 4px; background: rgba(99, 102, 241, 0.12); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);">+ 🏷️ ${escapeHtml(groupedCats[0])} (Rattachement proposé)</span>`
                                    : groupedCats.map(c => `<span style="font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 4px; background: rgba(var(--accent-rgb), 0.08); color: var(--accent); border: 1px solid rgba(var(--accent-rgb), 0.2);">🏷️ ${escapeHtml(c)}</span>`).join('')}
                            </div>
                        ` : ''}
                        <div class="review-row-details">
                            ${isEnrichment ? `
                                <span class="review-detail-label">Plafond actuel :</span>
                                <span class="review-detail-old" style="text-decoration: line-through; opacity: 0.65;">${formatCurrency(s.current_amount || 0)}</span>
                                <span class="review-arrow">→</span>
                                <div class="review-inplace-amount-wrapper" onclick="event.stopPropagation()">
                                    <input type="number" step="0.01" min="0.01" class="review-inplace-input" id="customAmountInput_${s.decision_id}" value="${(s.suggested_amount || 0).toFixed(2)}" title="Ajuster le montant proposé avant validation" />
                                    <span class="review-inplace-unit">€/m</span>
                                </div>
                                <span class="review-detail-sep">|</span>
                                <span class="review-detail-label">Impact :</span>
                                <span class="review-detail-val" style="color: #818cf8; font-weight: 600;">+${formatCurrency(s.additional_amount || (s.suggested_amount - s.current_amount) || 0)}/mois</span>
                                ${s.justification ? `
                                    <div style="font-size: 11.5px; color: var(--text-muted); font-style: italic; margin-top: 4px; width: 100%;">
                                        💬 ${escapeHtml(s.justification)}
                                    </div>
                                ` : ''}
                            ` : (isCreation ? `
                                <span class="review-detail-label">Moyenne constatée :</span>
                                <span class="review-detail-val">${formatCurrency(s.avg_monthly || 0)}/mois</span>
                                <span class="review-detail-sep">|</span>
                                <span class="review-detail-label">Montant proposé :</span>
                                <div class="review-inplace-amount-wrapper" onclick="event.stopPropagation()">
                                    <input type="number" step="0.01" min="0.01" class="review-inplace-input" id="customAmountInput_${s.decision_id}" value="${(s.suggested_amount || 0).toFixed(2)}" title="Ajuster le montant proposé avant validation" />
                                    <span class="review-inplace-unit">€/m</span>
                                </div>
                                ${s.justification ? `
                                    <div style="font-size: 11.5px; color: var(--text-muted); font-style: italic; margin-top: 4px; width: 100%;">
                                        💬 ${escapeHtml(s.justification)}
                                    </div>
                                ` : ''}
                            ` : `
                                <span class="review-detail-label">Évolution :</span>
                                <span class="review-detail-old" style="text-decoration: line-through; opacity: 0.65;">${formatCurrency(s.current_amount || 0)}</span>
                                <span class="review-arrow">→</span>
                                <div class="review-inplace-amount-wrapper" onclick="event.stopPropagation()">
                                    <input type="number" step="0.01" min="0.01" class="review-inplace-input" id="customAmountInput_${s.decision_id}" value="${(s.suggested_amount || 0).toFixed(2)}" title="Ajuster le montant proposé avant validation" />
                                    <span class="review-inplace-unit">€/m</span>
                                </div>
                                <span class="review-detail-sep">|</span>
                                <span class="review-detail-label">Moyenne :</span>
                                <span class="review-detail-val">${formatCurrency(s.avg_spending || 0)}/mois</span>
                            `)}
                        </div>
                    </div>
                    <div class="review-row-actions">
                        <button type="button" class="btn btn-secondary btn-sm review-action-btn" 
                                onclick="window.BudgetsView._handleRowAction('dismiss', ${s.decision_id}, this)" 
                                title="${dismissLabel}">
                            <span>✕</span> <span>${dismissLabel}</span>
                        </button>
                        <button type="button" class="btn btn-primary btn-sm review-action-btn" 
                                onclick="window.BudgetsView._handleRowAction('approve', ${s.decision_id}, this)" 
                                title="${approveLabel}">
                            <span>✓</span> <span>${approveLabel}</span>
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    },

    async _handleRowAction(action, decisionId, triggerBtn) {
        if (triggerBtn) {
            triggerBtn.classList.add('is-loading');
        }
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
            if (tabRecalib) tabRecalib.textContent = this.autopilotSuggestions.filter(s => s.type !== 'creation' && s.type !== 'enrichment').length;
            const tabEnrich = document.getElementById('tabCountEnrich');
            if (tabEnrich) tabEnrich.textContent = this.autopilotSuggestions.filter(s => s.type === 'enrichment').length;
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

            // Rafraîchir les cartes d'enveloppes en arrière-plan (masque le badge et actualise le montant)
            if (action === 'approve') {
                await Promise.all([
                    this.loadBudgets(),
                    this.loadAllStatuses()
                ]);
            }
            this.renderStatus();
        };

        let customAmount = null;
        if (action === 'approve') {
            const input = document.getElementById(`customAmountInput_${decisionId}`);
            const targetSuggestion = (this.autopilotSuggestions || []).find(s => s.decision_id === decisionId);
            if (input && input.value) {
                const val = parseFloat(input.value);
                const original = targetSuggestion ? (targetSuggestion.suggested_amount || 0) : 0;
                if (!isNaN(val) && val > 0 && Math.abs(val - original) > 0.005) {
                    customAmount = Math.round(val * 100) / 100;
                }
            }
        }

        if (action === 'approve') {
            await this.approveAutopilotSuggestion(decisionId, onRowProcessed, customAmount);
        } else {
            await this.dismissAutopilotSuggestion(decisionId, onRowProcessed);
        }
    },

    openReviewModalForBudget(budgetId) {
        this.openSuggestionsReviewModal();
        this._setReviewFilter('recalibration');
        setTimeout(() => {
            const target = (this.autopilotSuggestions || []).find(s => s.type !== 'creation' && s.budget_id === budgetId);
            if (target) {
                const row = document.getElementById(`reviewRow_${target.decision_id}`);
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    row.style.transition = 'box-shadow 0.3s ease, transform 0.3s ease';
                    row.style.boxShadow = '0 0 0 3px var(--accent)';
                    row.style.transform = 'scale(1.02)';
                    setTimeout(() => {
                        row.style.boxShadow = '';
                        row.style.transform = '';
                    }, 1800);
                }
            }
        }, 150);
    },

    async _bulkAction(action) {
        let targets = this.autopilotSuggestions;
        if (this._reviewFilter === 'creation') {
            targets = targets.filter(s => s.type === 'creation');
        } else if (this._reviewFilter === 'enrichment') {
            targets = targets.filter(s => s.type === 'enrichment');
        } else if (this._reviewFilter === 'recalibration') {
            targets = targets.filter(s => s.type !== 'creation' && s.type !== 'enrichment');
        }

        const ids = targets.map(s => s.decision_id);
        if (ids.length === 0) return;

        if (action === 'approve') {
            await this.approveAllAutopilotSuggestions(ids);
        } else {
            await this.dismissAllAutopilotSuggestionsWithConfirm(ids);
        }
    },

    // ─── Modale des Automatismes ⚙️ ──────────────────────────────────────────
    async openBudgetAutomationsModal() {
        const existing = document.getElementById('budgetAutomationsModal');
        if (existing) existing.remove();

        let cfg = {};
        let autoStatus = {};
        try {
            [cfg, autoStatus] = await Promise.all([
                API.get('/api/config/'),
                API.get('/api/budgets/autopilot/status').catch(() => ({}))
            ]);
            this.autopilotStatus = autoStatus || {};
        } catch (err) {
            console.error('[Budgets] Erreur chargement config/statut automatismes:', err);
        }

        const isAiEnabled = (cfg.enable_ai === 'true' || cfg.enable_ai === true) || (window.BudgetsView?.aiEnabled === true);
        const isEnableCreation = (cfg.enable_budget_creation_suggestions ?? 'true') === 'true';
        const isAutoCreate = (cfg.auto_create_budget_envelopes ?? 'false') === 'true';
        const isEnableRecalib = (cfg.enable_budget_recalibration_suggestions ?? 'true') === 'true';
        const isAutoApply = (cfg.auto_apply_budget_suggestions ?? 'false') === 'true';
        const currentEngine = isAiEnabled ? (cfg.budget_suggestion_engine || 'deterministic') : 'deterministic';

        const lastRunIso = autoStatus?.last_run_at;
        const relativeLastRun = lastRunIso ? this._formatRelativeTime(lastRunIso) : null;
        const fullDateLastRun = lastRunIso ? new Date(lastRunIso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : null;
        const isColdStart = autoStatus?.is_cold_start ?? false;
        const activeEnvelopes = autoStatus?.active_envelopes_count ?? 0;

        const modal = document.createElement('div');
        modal.id = 'budgetAutomationsModal';
        modal.className = 'modal-overlay';
        modal.style.cssText = 'position: fixed; inset: 0; z-index: 10000; background: rgba(15, 23, 42, 0.85); backdrop-filter: blur(6px); display: flex; align-items: center; justify-content: center; overflow-y: auto; padding: clamp(12px, 3vh, 24px) clamp(8px, 2vw, 16px); box-sizing: border-box;';

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        const title = window.i18n.t('budget_automations_title') || 'Automatismes des enveloppes budgétaires';
        const desc = window.i18n.t('budget_automations_desc') || 'Configurez les suggestions autonomes de création et de recalibrage de vos enveloppes.';

        modal.innerHTML = `
            <div class="modal budget-automations-modal" style="width: 96%; max-width: 640px; min-width: 0; max-height: min(90vh, 90dvh); display: flex; flex-direction: column; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: var(--shadow-md); padding: 0; overflow: hidden; animation: modalFadeIn 0.3s ease;">
                
                <!-- Pinned Header -->
                <div class="budget-automations-modal-header" style="flex-shrink: 0; padding: clamp(14px, 3vw, 18px) clamp(16px, 3.5vw, 24px); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; background: var(--bg-surface);">
                    <div style="flex: 1; min-width: 0; padding-right: 12px;">
                        <h3 style="margin: 0; font-size: clamp(16px, 3vw, 18px); font-weight: 700; display: flex; align-items: center; gap: 8px;">⚙️ ${title}</h3>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">${desc}</div>
                    </div>
                    <button type="button" class="budget-review-close-btn" onclick="document.getElementById('budgetAutomationsModal')?.remove()" aria-label="${window.i18n.t('btn_close') || 'Fermer'}" title="${window.i18n.t('btn_close') || 'Fermer'}">✕</button>
                </div>

                <!-- Form wrapping scrollable body + pinned footer -->
                <form id="budgetAutomationsForm" onsubmit="event.preventDefault(); window.BudgetsView.saveBudgetAutomationsConfig();" style="display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; overflow: hidden; margin: 0;">
                    
                    <!-- Scrollable Body -->
                    <div class="budget-automations-body" style="flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: clamp(14px, 3vw, 20px) clamp(16px, 3.5vw, 24px); display: flex; flex-direction: column; gap: 14px; scrollbar-width: thin;">
                        
                        <!-- Bloc Statut Temporel & Cadence -->
                        <div class="budget-automations-status-card" style="padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border-color); background: rgba(var(--accent-rgb, 59, 130, 246), 0.05); display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
                                <span style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                    <span>⏱️</span> <span>${window.i18n.t('budget_auto_schedule_title') || 'Planification & Cadence d\'exécution'}</span>
                                </span>
                                <span style="font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 12px; background: rgba(16, 185, 129, 0.15); color: #10b981; display: inline-flex; align-items: center; gap: 5px;">
                                    <span style="width: 6px; height: 6px; border-radius: 50%; background: #10b981; display: inline-block;"></span>
                                    ${lastRunIso ? (window.i18n.t('budget_auto_badge_up_to_date') || 'À jour') : 'En attente d\'analyse'}
                                </span>
                            </div>

                            <div style="font-size: 12px; color: var(--text-main); display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">
                                <strong style="color: var(--text-muted);">${window.i18n.t('budget_auto_last_run_label') || 'Dernière analyse exécutée'} :</strong>
                                <span>${lastRunIso ? `<strong>${relativeLastRun}</strong> (${fullDateLastRun})` : (window.i18n.t('budget_auto_last_run_never') || 'Aucune analyse récente enregistrée')}</span>
                            </div>

                            <div style="font-size: 12px; color: ${isColdStart ? 'var(--accent)' : 'var(--text-muted)'}; background: var(--bg-surface); padding: 8px 10px; border-radius: 6px; border: 1px solid var(--border-color); line-height: 1.4;">
                                ${isColdStart 
                                    ? `🚀 <strong>Mode Cold-Start actif (${activeEnvelopes} enveloppe${activeEnvelopes > 1 ? 's' : ''})</strong> : Vos dépenses sont analysées pour vous proposer votre première structure budgétaire dès le prochain import ou analyse manuelle.`
                                    : `🛡️ <strong>Mode Surveillance active (${activeEnvelopes} enveloppes)</strong> : Veille sur les nouvelles catégories régulières et ajustement mensuel lissé.`
                                }
                            </div>

                            <div style="font-size: 11px; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px; border-top: 1px dashed var(--border-color); padding-top: 8px;">
                                <div style="font-weight: 700; color: var(--text-main); margin-bottom: 2px;">${window.i18n.t('budget_auto_triggers_title') || 'Quand s\'exécutent les automatisations ?'}</div>
                                <div>${window.i18n.t('budget_auto_trigger_import') || '📥 <strong>À chaque import / sync bancaire</strong> : analyse réactive dès réception de nouvelles opérations.'}</div>
                                <div>${window.i18n.t('budget_auto_trigger_month') || '📅 <strong>Au 1er de chaque mois</strong> : recalibrage mensuel lissé (EMA) des enveloppes existantes.'}</div>
                                <div>${window.i18n.t('budget_auto_trigger_startup') || '💻 <strong>Au lancement de l\'application</strong> : rattrapage automatique si un cycle a été manqué.'}</div>
                                <div>${window.i18n.t('budget_auto_trigger_manual') || '🚀 <strong>À la demande</strong> : immédiat en cliquant sur « Lancer une analyse maintenant ».'}</div>
                            </div>
                        </div>

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
                                            ${!isAiEnabled 
                                                ? (window.i18n.t('budget_auto_engine_ai_disabled') || '⚪ IA désactivée') 
                                                : (cfg.ollama_url ? '⏳ Connexion à l\'IA...' : (window.i18n.t('budget_auto_engine_ai_unconfigured') || 'IA non configurée'))}
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

                                        <label id="engine_lbl_ai" style="display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; border-radius: 6px; border: 1.5px solid ${currentEngine === 'ai' ? 'var(--accent)' : 'var(--border-color)'}; background: ${currentEngine === 'ai' ? 'rgba(var(--accent-rgb), 0.08)' : 'transparent'}; cursor: ${isAiEnabled ? 'pointer' : 'not-allowed'}; opacity: ${isAiEnabled ? '1' : '0.45'}; transition: all 0.2s ease;" ${!isAiEnabled ? `title="${window.i18n.t('budget_auto_engine_ai_disabled_hint') || 'Activable dans Configuration > IA'}"` : ''}>
                                            <input type="radio" name="budget_suggestion_engine" value="ai" ${currentEngine === 'ai' ? 'checked' : ''} ${!isAiEnabled ? 'disabled' : ''} onchange="window.BudgetsView._selectEngineInModal('ai')" style="margin-top: 2px; accent-color: var(--accent); cursor: ${isAiEnabled ? 'pointer' : 'not-allowed'};">
                                            <div style="flex: 1; min-width: 0;">
                                                <div style="font-size: 12px; font-weight: 700; color: var(--text-main);">🤖 ${window.i18n.t('budget_auto_engine_ai') || 'Assisté par IA'}</div>
                                                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px; line-height: 1.3;">${window.i18n.t('budget_auto_engine_ai_desc') || 'Regroupement sémantique multi-catégories via votre modèle d\'IA local.'}</div>
                                                ${!isAiEnabled ? `<div style="font-size: 10px; color: var(--text-muted); margin-top: 3px; font-style: italic;">⚪ ${window.i18n.t('budget_auto_engine_ai_disabled_hint') || 'Activable dans Configuration > IA'}</div>` : ''}
                                            </div>
                                        </label>
                                    </div>

                                    <div style="display: flex; justify-content: flex-end; margin-top: 8px;">
                                        <button type="button" class="btn btn-secondary" onclick="window.BudgetsView.triggerAutopilotAnalysis(); document.getElementById('budgetAutomationsModal')?.remove();" style="display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; padding: 5px 12px; border-radius: 6px;" title="Lancer immédiatement une recherche et un calcul de suggestions">
                                            <span>🚀</span> <span>${window.i18n.t('budget_auto_btn_run_analysis_now') || 'Lancer une analyse maintenant'}</span>
                                        </button>
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

                        <!-- Section 3 : Seuil plancher minimum -->
                        <div style="padding: 13px 14px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-base); display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;">
                            <div style="flex: 1; min-width: 220px;">
                                <div style="font-size: 13px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                    <span>🎯</span> <span>${window.i18n.t('budget_min_threshold_title') || 'Seuil plancher minimal (€)'}</span>
                                </div>
                                <div style="font-size: 12px; color: var(--text-muted); margin-top: 3px; line-height: 1.4;">
                                    ${window.i18n.t('budget_min_threshold_desc') || 'Montant plancher minimal pour une enveloppe (défaut : 1 €). Empêche les enveloppes à 0 € sans gonfler artificiellement vos petits montants.'}
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <input type="number" id="cfg_budget_minimum_threshold" class="inline-input" value="${cfg.budget_minimum_threshold ?? '1.0'}" min="1" step="1" style="width: 80px; text-align: right; padding: 4px 8px; font-size: 13px; font-weight: 600; border-radius: 6px;">
                                <span style="font-size: 13px; color: var(--text-muted); font-weight: 600;">€</span>
                            </div>
                        </div>

                        <!-- Bloc Historique des Actions Automatiques Récentes (Discret / Dépliable en bas) -->
                        <div id="boxRecentAutomationsContainer" class="budget-automations-recent-box" style="padding: 10px 12px; border-radius: 8px; border: 1px solid var(--border-color); background: var(--bg-base); display: flex; flex-direction: column; gap: 6px; transition: all 0.2s ease;">
                            <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer; user-select: none; gap: 8px;" onclick="window.BudgetsView.toggleRecentAutomationsList()" title="${window.i18n.t('budget_auto_recent_actions_desc') || 'Actions appliquées automatiquement par vos réglages d\'automatismes.'}">
                                <span style="font-size: 12px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 6px; min-width: 0;">
                                    <span>📜</span> <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${window.i18n.t('budget_auto_recent_actions_title') || 'Dernières actions automatiques'}</span>
                                    <span id="recentAutomationsCountBadge" style="font-size: 10px; font-weight: 600; padding: 1px 6px; border-radius: 10px; background: rgba(var(--accent-rgb, 59, 130, 246), 0.12); color: var(--accent); display: none;">0</span>
                                </span>
                                <span id="recentAutomationsToggleIcon" style="font-size: 11px; color: var(--text-muted); transition: transform 0.2s ease; flex-shrink: 0;">►</span>
                            </div>
                            <div id="recentAutomationsList" style="display: none; flex-direction: column; gap: 6px; margin-top: 4px; max-height: 240px; overflow-y: auto; padding-right: 2px; scrollbar-width: thin;">
                                <div style="font-size: 11.5px; color: var(--text-muted); text-align: center; padding: 10px;">
                                    <span>⏳ Chargement...</span>
                                </div>
                            </div>
                        </div>

                    </div>

                    <!-- Pinned Footer -->
                    <div class="budget-automations-modal-footer" style="flex-shrink: 0; display: flex; justify-content: flex-end; gap: 10px; padding: 12px clamp(16px, 3.5vw, 24px); border-top: 1px solid var(--border-color); background: var(--bg-surface); border-bottom-left-radius: 14px; border-bottom-right-radius: 14px; z-index: 2;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('budgetAutomationsModal')?.remove()">
                            ${window.i18n.t('btn_cancel') || 'Annuler'}
                        </button>
                        <button type="submit" class="btn btn-primary" style="font-weight: 600;">
                            ${window.i18n.t('btn_save') || 'Enregistrer'}
                        </button>
                    </div>

            </div>
        `;

        document.body.appendChild(modal);
        this.updateBudgetAutomationsDependencies();
        this._loadRecentAutomationsInModal();

        // Sondage asynchrone du statut Ollama pour l'indicateur visuel (uniquement si l'IA est activée)
        if (isAiEnabled && cfg.ollama_url) {
            fetch('/api/config/ollama/models', { signal: AbortSignal.timeout ? AbortSignal.timeout(2500) : undefined })
                .then(r => {
                    const badge = document.getElementById('ollama_status_badge');
                    if (!badge) return;
                    if (r.ok) {
                        badge.style.background = 'rgba(16, 185, 129, 0.15)';
                        badge.style.color = '#10b981';
                        badge.textContent = '🟢 ' + (window.i18n.t('budget_auto_engine_ai_online') || 'IA connectée');
                    } else {
                        badge.style.background = 'rgba(245, 158, 11, 0.15)';
                        badge.style.color = '#f59e0b';
                        badge.textContent = '🟠 ' + (window.i18n.t('budget_auto_engine_ai_offline') || 'IA indisponible');
                    }
                })
                .catch(() => {
                    const badge = document.getElementById('ollama_status_badge');
                    if (badge) {
                        badge.style.background = 'rgba(245, 158, 11, 0.15)';
                        badge.style.color = '#f59e0b';
                        badge.textContent = '🟠 ' + (window.i18n.t('budget_auto_engine_ai_offline') || 'IA indisponible');
                    }
                });
        }
    },

    async _loadRecentAutomationsInModal() {
        const listEl = document.getElementById('recentAutomationsList');
        const badgeEl = document.getElementById('recentAutomationsCountBadge');
        if (!listEl) return;

        try {
            const history = await API.get('/api/budgets/autopilot/history?limit=10');
            if (badgeEl && history && history.length > 0) {
                badgeEl.textContent = history.length;
                badgeEl.style.display = 'inline-block';
            }

            if (!history || history.length === 0) {
                listEl.innerHTML = `
                    <div style="font-size: 11.5px; color: var(--text-muted); text-align: center; padding: 8px;">
                        ${window.i18n.t('budget_auto_no_recent_actions') || 'Aucune action automatique enregistrée récemment.'}
                    </div>
                `;
                return;
            }

            const t = (k, fb) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fb;
            listEl.innerHTML = history.slice(0, 7).map(item => {
                const dateStr = item.created_at ? this._formatRelativeTime(item.created_at) : '';
                let badgeText = t('budget_auto_action_creation', 'Auto-création');
                let badgeStyle = 'background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);';
                let icon = '✨';

                if (item.type === 'recalibration') {
                    badgeText = t('budget_auto_action_recalibration', 'Auto-ajustement');
                    badgeStyle = 'background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);';
                    icon = '📊';
                } else if (item.type === 'enrichment') {
                    badgeText = t('budget_auto_action_enrichment', 'Auto-enrichissement');
                    badgeStyle = 'background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);';
                    icon = '🔗';
                }

                if (!item.is_autonomous) {
                    badgeText = t('budget_auto_action_manual_applied', 'Approbation');
                }

                const engineBadge = (item.engine === 'ai') 
                    ? '<span style="font-size: 10px; color: var(--text-muted); opacity: 0.85;">🤖 IA</span>' 
                    : '<span style="font-size: 10px; color: var(--text-muted); opacity: 0.85;">⚡ Déterministe</span>';

                return `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 7px 10px; border-radius: 6px; background: var(--bg-surface); border: 1px solid var(--border-color); font-size: 12px; gap: 8px; flex-wrap: wrap;">
                        <div style="display: flex; align-items: center; gap: 8px; min-width: 0; flex: 1 1 180px;">
                            <span style="${badgeStyle} font-size: 10.5px; font-weight: 600; padding: 2px 6px; border-radius: 4px; white-space: nowrap; flex-shrink: 0;">
                                ${icon} ${badgeText}
                            </span>
                            <strong style="color: var(--text-main); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 180px;" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</strong>
                            <span style="color: var(--accent); font-weight: 700; white-space: nowrap; margin-left: auto;">${Number(item.amount || 0).toFixed(2)} €</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--text-muted); flex-shrink: 0;">
                            ${engineBadge}
                            <span>•</span>
                            <span title="${item.created_at}">${dateStr}</span>
                        </div>
                    </div>
                `;
            }).join('');

            if (history.length > 7) {
                listEl.innerHTML += `
                    <div style="text-align: center; margin-top: 2px;">
                        <button type="button" class="btn btn-secondary btn-xs" style="font-size: 11px; padding: 3px 10px;" onclick="document.getElementById('budgetAutomationsModal')?.remove(); window.BudgetsView.openDismissedSuggestionsModal('executed');">
                            ${t('budget_auto_action_view_all', 'Voir l\'historique complet')} →
                        </button>
                    </div>
                `;
            }
        } catch (e) {
            console.error('[Budgets Automations] Error loading recent automations history:', e);
            listEl.innerHTML = `
                <div style="font-size: 11.5px; color: var(--text-muted); text-align: center; padding: 8px;">
                    ${window.i18n.t('budget_auto_no_recent_actions') || 'Aucune action automatique enregistrée récemment.'}
                </div>
            `;
        }
    },

    toggleRecentAutomationsList() {
        const listEl = document.getElementById('recentAutomationsList');
        const iconEl = document.getElementById('recentAutomationsToggleIcon');
        const boxEl = document.getElementById('boxRecentAutomationsContainer');
        if (!listEl) return;
        const isHidden = listEl.style.display === 'none';
        listEl.style.display = isHidden ? 'flex' : 'none';
        if (iconEl) iconEl.textContent = isHidden ? '▼' : '►';
        if (isHidden && boxEl) {
            setTimeout(() => {
                boxEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }, 50);
        }
    },

    _selectEngineInModal(engine) {
        const isAiEnabled = (window.app?.config?.enable_ai === 'true' || window.app?.config?.enable_ai === true) || (window.BudgetsView?.aiEnabled === true);
        if (engine === 'ai' && !isAiEnabled) {
            const radioDet = document.querySelector('input[name="budget_suggestion_engine"][value="deterministic"]');
            if (radioDet) radioDet.checked = true;
            if (typeof showToast === 'function') {
                showToast(window.i18n.t('budget_modal_engine_ai_desc_disabled') || 'L\'IA locale est désactivée dans vos paramètres. Activez-la dans Configuration > IA pour utiliser ce moteur.', 'warning');
            }
            return;
        }

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
        const isAiEnabled = (window.app?.config?.enable_ai === 'true' || window.app?.config?.enable_ai === true) || (window.BudgetsView?.aiEnabled === true);
        const enableCreateChk = document.getElementById('cfg_enable_budget_creation_suggestions');
        const autoCreateChk = document.getElementById('cfg_auto_create_budget_envelopes');
        const enableRecalibChk = document.getElementById('cfg_enable_budget_recalibration_suggestions');
        const autoApplyChk = document.getElementById('cfg_auto_apply_budget_suggestions');
        const selectedEngineRadio = document.querySelector('input[name="budget_suggestion_engine"]:checked');
        let engine = selectedEngineRadio ? selectedEngineRadio.value : 'deterministic';
        if (!isAiEnabled) {
            engine = 'deterministic';
        }

        const isCreateEnabled = !!(enableCreateChk && enableCreateChk.checked);
        const isRecalibEnabled = !!(enableRecalibChk && enableRecalibChk.checked);

        const minThresholdInput = document.getElementById('cfg_budget_minimum_threshold');
        const minThresholdVal = minThresholdInput ? (parseFloat(minThresholdInput.value) || 1.0) : 1.0;

        const payload = {
            enable_budget_creation_suggestions: isCreateEnabled ? 'true' : 'false',
            auto_create_budget_envelopes: (isCreateEnabled && autoCreateChk && autoCreateChk.checked) ? 'true' : 'false',
            enable_budget_recalibration_suggestions: isRecalibEnabled ? 'true' : 'false',
            auto_apply_budget_suggestions: (isRecalibEnabled && autoApplyChk && autoApplyChk.checked) ? 'true' : 'false',
            budget_suggestion_engine: engine,
            budget_minimum_threshold: String(minThresholdVal),
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

    async triggerAutopilotAnalysis(engine = null) {
        const isAiEnabled = (this.autopilotConfig?.enable_ai === 'true' || this.autopilotConfig?.enable_ai === true) || (window.app?.config?.enable_ai === 'true' || window.app?.config?.enable_ai === true) || (window.BudgetsView?.aiEnabled === true);
        let chosenEngine = engine || (this.autopilotConfig?.budget_suggestion_engine || 'deterministic');
        if (!isAiEnabled) {
            chosenEngine = 'deterministic';
        }
        const isDet = (chosenEngine === 'deterministic');

        this._isAiAnalyzing = true;
        this._analyzingEngine = chosenEngine;
        this._aiAnalyzingPct = 25;
        this._aiAnalyzingStep = isDet
            ? (window.i18n.t('budget_auto_det_step_collecting') || 'Collecte et analyse de l\'historique des dépenses...')
            : (window.i18n.t('budget_auto_ai_step_collecting') || 'Collecte et analyse de l\'historique des dépenses...');
        
        const strip = document.querySelector('.budget-suggestions-strip');
        if (strip) {
            strip.outerHTML = this.renderAutopilotSuggestionsBanner();
        } else {
            this.renderStatus();
        }

        const timer1 = setTimeout(() => {
            if (this._isAiAnalyzing) {
                this._aiAnalyzingPct = 65;
                this._aiAnalyzingStep = isDet
                    ? (window.i18n.t('budget_auto_det_step_grouping') || 'Calcul des montants et des propositions...')
                    : (window.i18n.t('budget_auto_ai_step_grouping') || 'Regroupement sémantique et calcul des montants...');
                const pBar = document.getElementById('budgetAiBannerProgressBar');
                if (pBar) pBar.style.width = '65%';
            }
        }, 1200);

        try {
            const res = await API.post(`/api/budgets/autopilot/recalibrate?engine=${encodeURIComponent(chosenEngine)}`);
            
            clearTimeout(timer1);
            this._aiAnalyzingPct = 100;
            this._aiAnalyzingStep = window.i18n.t('budget_auto_ai_step_complete') || 'Analyse terminée !';
            const pBar = document.getElementById('budgetAiBannerProgressBar');
            if (pBar) pBar.style.width = '100%';

            await new Promise(r => setTimeout(r, 450));
            this._isAiAnalyzing = false;

            const total = (res.new_envelopes?.length || 0) + (res.recalibrations?.length || 0);
            if (total > 0) {
                showToast((window.i18n.t('budget_auto_ai_toast_found') || '{count} recommandation(s) budgétaire(s) identifiée(s)').replace('{count}', total), 'success');
            } else {
                showToast(window.i18n.t('budget_auto_ai_toast_none') || 'Aucun ajustement ni nouvelle enveloppe nécessaire pour le moment.', 'info');
            }

            await Promise.all([
                this.loadBudgets(),
                this.loadAllStatuses(),
                this.loadAutopilotSuggestions()
            ]);
            this.renderStatus();
        } catch (err) {
            clearTimeout(timer1);
            console.error('[Budgets] Erreur analyse automatique:', err);
            this._isAiAnalyzing = false;
            showToast(err.message || 'Erreur lors de l\'analyse des budgets', 'error');
            await this.loadAutopilotSuggestions();
            this.renderStatus();
        }
    },

    // ─── Modale d'Historique des Automatisations (Actions Exécutées & Écartées) 📋 ─────────────────────
    async openDismissedSuggestionsModal(defaultTab = 'executed') {
        const existing = document.getElementById('budgetDismissedSuggestionsModal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'budgetDismissedSuggestionsModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1010';

        modal.onclick = (e) => {
            if (e.target === modal) modal.remove();
        };

        const escHandler = (e) => {
            if (e.key === 'Escape') {
                modal.remove();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);

        const title = window.i18n.t('budget_auto_modal_history_title') || 'Historique des automatisations';
        const subtitle = window.i18n.t('budget_auto_modal_history_subtitle') || 'Retrouvez ici les actions appliquées automatiquement ainsi que les suggestions écartées.';

        modal.innerHTML = `
            <div class="modal budget-history-modal" style="width: 96%; max-width: 780px; max-height: 85vh; display: flex; flex-direction: column; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: var(--shadow-md); padding: 0; overflow: hidden; animation: modalFadeIn 0.25s ease;">
                <!-- Header -->
                <div class="budget-history-modal-header" style="position: relative; display: flex; justify-content: space-between; align-items: flex-start; padding: clamp(14px, 3vw, 20px); border-bottom: 1px solid var(--border-color); background: var(--bg-base); gap: 12px;">
                    <div style="flex: 1; min-width: 0; padding-right: 12px;">
                        <h3 style="margin: 0; font-size: 17px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
                            <span>📋</span> <span>${title}</span>
                        </h3>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px; line-height: 1.4;">${subtitle}</div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
                        <button type="button" id="btnClearDismissedHistory" class="btn btn-secondary btn-sm" 
                                onclick="window.BudgetsView.clearDismissedSuggestionsHistory()" 
                                style="font-size: 11.5px; padding: 5px 10px; display: none; align-items: center; gap: 5px; color: var(--danger-color, #ef4444); border-color: rgba(239, 68, 68, 0.3);"
                                title="${window.i18n.t('budget_auto_btn_clear_history') || 'Vider l\'historique'}">
                            <span>🗑️</span> <span>${window.i18n.t('budget_auto_btn_clear_history') || 'Vider l\'historique'}</span>
                        </button>
                        <button type="button" class="budget-review-close-btn" onclick="document.getElementById('budgetDismissedSuggestionsModal').remove()" aria-label="${window.i18n.t('btn_close') || 'Fermer'}" title="${window.i18n.t('btn_close') || 'Fermer'}">✕</button>
                    </div>
                </div>

                <!-- Tabs Navigation -->
                <div style="display: flex; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--border-color); background: var(--bg-surface);">
                    <button type="button" id="tabBtn_executed" class="btn btn-sm" onclick="window.BudgetsView.switchHistoryModalTab('executed')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px; ${defaultTab === 'executed' ? 'background: var(--accent); color: #fff; border: 1px solid var(--accent);' : 'background: transparent; color: var(--text-muted); border: 1px solid var(--border-color);'}">
                        ⚡ ${window.i18n.t('budget_auto_history_tab_executed') || 'Actions exécutées'} <span id="tabCount_executed" style="opacity: 0.85; font-size: 11px;"></span>
                    </button>
                    <button type="button" id="tabBtn_dismissed" class="btn btn-sm" onclick="window.BudgetsView.switchHistoryModalTab('dismissed')" style="font-size: 12px; font-weight: 600; padding: 6px 14px; border-radius: 6px; ${defaultTab === 'dismissed' ? 'background: var(--accent); color: #fff; border: 1px solid var(--accent);' : 'background: transparent; color: var(--text-muted); border: 1px solid var(--border-color);'}">
                        🗑️ ${window.i18n.t('budget_auto_history_tab_dismissed') || 'Suggestions écartées'} <span id="tabCount_dismissed" style="opacity: 0.85; font-size: 11px;"></span>
                    </button>
                </div>

                <!-- Body / List Containers -->
                <div id="executedListContainer" style="display: ${defaultTab === 'executed' ? 'flex' : 'none'}; padding: 16px; overflow-y: auto; flex: 1; flex-direction: column; gap: 10px;">
                    <div style="text-align: center; padding: 30px; color: var(--text-muted);">
                        <span>⏳ Chargement des actions exécutées...</span>
                    </div>
                </div>

                <div id="dismissedListContainer" style="display: ${defaultTab === 'dismissed' ? 'flex' : 'none'}; padding: 16px; overflow-y: auto; flex: 1; flex-direction: column; gap: 10px;">
                    <div style="text-align: center; padding: 30px; color: var(--text-muted);">
                        <span>⏳ Chargement des suggestions écartées...</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        this._currentHistoryTab = defaultTab;
        await Promise.all([
            this._loadAndRenderExecutedList(),
            this._loadAndRenderDismissedList()
        ]);
        this.switchHistoryModalTab(defaultTab);
    },

    switchHistoryModalTab(tab) {
        this._currentHistoryTab = tab;
        const btnExec = document.getElementById('tabBtn_executed');
        const btnDism = document.getElementById('tabBtn_dismissed');
        const listExec = document.getElementById('executedListContainer');
        const listDism = document.getElementById('dismissedListContainer');
        const clearBtn = document.getElementById('btnClearDismissedHistory');

        if (btnExec && btnDism && listExec && listDism) {
            if (tab === 'executed') {
                btnExec.style.background = 'var(--accent)';
                btnExec.style.color = '#fff';
                btnExec.style.borderColor = 'var(--accent)';
                btnDism.style.background = 'transparent';
                btnDism.style.color = 'var(--text-muted)';
                btnDism.style.borderColor = 'var(--border-color)';
                listExec.style.display = 'flex';
                listDism.style.display = 'none';
                if (clearBtn) clearBtn.style.display = 'none';
            } else {
                btnDism.style.background = 'var(--accent)';
                btnDism.style.color = '#fff';
                btnDism.style.borderColor = 'var(--accent)';
                btnExec.style.background = 'transparent';
                btnExec.style.color = 'var(--text-muted)';
                btnExec.style.borderColor = 'var(--border-color)';
                listDism.style.display = 'flex';
                listExec.style.display = 'none';
                if (clearBtn && this._dismissedItemsCount > 0) {
                    clearBtn.style.display = 'inline-flex';
                }
            }
        }
    },

    async _loadAndRenderExecutedList() {
        const container = document.getElementById('executedListContainer');
        const tabCount = document.getElementById('tabCount_executed');
        if (!container) return;

        try {
            const items = await API.get('/api/budgets/autopilot/history?limit=50');
            if (tabCount) {
                tabCount.textContent = `(${items ? items.length : 0})`;
            }

            if (!items || items.length === 0) {
                container.innerHTML = `
                    <div style="text-align: center; padding: 45px 20px; color: var(--text-muted);">
                        <span style="font-size: 38px; display: block; margin-bottom: 12px;">🌱</span>
                        <div style="font-size: 14px; font-weight: 600; color: var(--text-main); margin-bottom: 4px;">
                            ${window.i18n.t('budget_auto_no_recent_actions') || 'Aucune action automatique enregistrée récemment.'}
                        </div>
                        <div style="font-size: 12px;">Vos réglages d'automatismes n'ont pas encore effectué de modifications.</div>
                    </div>
                `;
                return;
            }

            const t = (k, fb) => (window.i18n && window.i18n.t) ? window.i18n.t(k) : fb;
            container.innerHTML = items.map(item => {
                const dateStr = item.created_at ? new Date(item.created_at).toLocaleString() : '';
                let badgeText = t('budget_auto_action_creation', 'Auto-création');
                let badgeStyle = 'background: rgba(16, 185, 129, 0.15); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3);';
                let icon = '✨';

                if (item.type === 'recalibration') {
                    badgeText = t('budget_auto_action_recalibration', 'Auto-ajustement');
                    badgeStyle = 'background: rgba(99, 102, 241, 0.15); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.3);';
                    icon = '📊';
                } else if (item.type === 'enrichment') {
                    badgeText = t('budget_auto_action_enrichment', 'Auto-enrichissement');
                    badgeStyle = 'background: rgba(59, 130, 246, 0.15); color: #3b82f6; border: 1px solid rgba(59, 130, 246, 0.3);';
                    icon = '🔗';
                }

                if (!item.is_autonomous) {
                    badgeText = t('budget_auto_action_manual_applied', 'Approbation');
                }

                const engineBadge = (item.engine === 'ai') 
                    ? '<span style="font-size: 10.5px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">🤖 IA</span>' 
                    : '<span style="font-size: 10.5px; color: var(--text-muted); background: var(--bg-surface); padding: 2px 6px; border-radius: 4px; border: 1px solid var(--border-color);">⚡ Déterministe</span>';

                return `
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-radius: 10px; border: 1px solid var(--border-color); background: var(--bg-base); gap: 14px; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 240px;">
                            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <strong style="font-size: 14px; color: var(--text-main);">${escapeHtml(item.name)}</strong>
                                <span style="${badgeStyle} font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 6px;">
                                    ${icon} ${badgeText}
                                </span>
                                ${engineBadge}
                                <span style="font-size: 11px; color: var(--text-muted); margin-left: auto;">
                                    ${dateStr}
                                </span>
                            </div>
                            <div style="font-size: 12px; color: var(--text-muted); margin-top: 5px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span>Montant : <strong style="color: var(--accent);">${formatCurrency(item.amount || 0)}/mois</strong></span>
                                ${item.current_amount ? `<span style="opacity: 0.7;">(Précédent : ${formatCurrency(item.current_amount)})</span>` : ''}
                                ${item.categories && item.categories.length > 1 ? `<span style="opacity: 0.7;">(${item.categories.length} catégories)</span>` : ''}
                            </div>
                            ${item.justification ? `
                                <div style="font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 4px;">
                                    💬 ${escapeHtml(item.justification)}
                                </div>
                            ` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } catch (err) {
            console.error('[Budgets Automations] Erreur chargement actions exécutées:', err);
            container.innerHTML = `
                <div style="text-align: center; padding: 30px; color: var(--danger-color, #ef4444);">
                    Erreur lors du chargement des actions exécutées.
                </div>
            `;
        }
    },

    async _loadAndRenderDismissedList() {
        const container = document.getElementById('dismissedListContainer');
        const tabCount = document.getElementById('tabCount_dismissed');
        if (!container) return;

        try {
            const items = await API.get('/api/budgets/autopilot/suggestions/dismissed');
            this._dismissedItemsCount = items ? items.length : 0;
            if (tabCount) {
                tabCount.textContent = `(${this._dismissedItemsCount})`;
            }
            const clearBtn = document.getElementById('btnClearDismissedHistory');
            if (clearBtn && this._currentHistoryTab === 'dismissed') {
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

