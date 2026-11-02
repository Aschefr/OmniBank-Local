// static/js/views/budgets/budgets_render.js
// Enveloppes Budgétaires v2 — HTML Rendering & Visual Cards UI

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const isAiEnabled = (cfg.enable_ai === 'true' || cfg.enable_ai === true) || (this.aiEnabled === true);
        const isEngineDet = !isAiEnabled || (cfg.budget_suggestion_engine ?? 'deterministic') === 'deterministic';
        const aiDisp = '';
        const hasProposals = (this.aiProposals && this.aiProposals.length > 0) || (this.unclassifiedCategories && this.unclassifiedCategories.length > 0);
        const isHidden = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('budget_ai_panel_hidden') : sessionStorage.getItem('budget_ai_panel_hidden')) === 'true';
        const isClosed = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('budget_ai_panel_closed') : sessionStorage.getItem('budget_ai_panel_closed')) === 'true';
        const isMinimizedHidden = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('budget_ai_minimized_hidden') : sessionStorage.getItem('budget_ai_minimized_hidden')) === 'true';
        let btnSuggestionsText = '';
        let btnSuggestionsTitle = '';
        let btnExtraClass = '';
        // Le bouton d'en-tête ne bascule sur "Afficher les suggestions" que si le bandeau a été fermé par l'utilisateur ([✕])
        if (hasProposals && isHidden && !isClosed && isMinimizedHidden) {
            const rawLabel = (window.i18n && window.i18n.t) ? window.i18n.t('budget_ai_btn_show_existing') : 'Afficher les suggestions';
            const cleanLabel = (rawLabel || 'Afficher les suggestions').replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]+/u, '').trim();
            btnSuggestionsText = `👁️ ${cleanLabel} (${(this.aiProposals || []).length})`;
            btnSuggestionsTitle = 'Ré-ouvrir le panneau de suggestions avec vos réglages en mémoire';
            btnExtraClass = ' btn-suggestions-pending';
        } else if (isAiEnabled) {
            btnSuggestionsText = (window.i18n && window.i18n.t) 
                ? (window.i18n.t('budget_btn_suggestions') || '💡 Suggérer des enveloppes') 
                : '💡 Suggérer des enveloppes';
            btnSuggestionsTitle = (window.i18n && window.i18n.t) ? (window.i18n.t('budget_btn_suggestions_tt') || 'Générer manuellement des propositions d\'enveloppes') : 'Générer manuellement des propositions d\'enveloppes';
        } else {
            btnSuggestionsText = (window.i18n && window.i18n.t) 
                ? (window.i18n.t('budget_btn_suggestions_det') || '⚡ Suggérer des enveloppes') 
                : '⚡ Suggérer des enveloppes';
            btnSuggestionsTitle = (window.i18n && window.i18n.t) ? (window.i18n.t('budget_btn_suggestions_det_tt') || 'Calculer des propositions d\'enveloppes (Mode déterministe hors-ligne)') : 'Calculer des propositions d\'enveloppes (Mode déterministe hors-ligne)';
        }
        const resetBtnLabel = isEngineDet
            ? (window.i18n.t('budget_strategy_reset_det') || '💡 Aligner avec suggestions initiales')
            : (window.i18n.t('ai_budget_strategy_recommended_clean') || '🤖 Aligner avec suggestions IA');
        const resetBtnI18nKey = isEngineDet ? 'budget_strategy_reset_det' : 'ai_budget_strategy_recommended_clean';

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
                            <button type="button" role="menuitem" id="budgetAiBtn" class="${btnExtraClass.trim()}" onclick="window.BudgetsView.handleHeaderSuggestionsBtnClick()" title="${btnSuggestionsTitle}">
                                ${this._bvIcon('bulb')}<span>${this._stripEmoji(btnSuggestionsText)}</span>
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

            <!-- Modal Sélection préalable du moteur et de la période d'analyse -->
            <div id="aiWindowSelectionModal" class="bv-modal-overlay">
                <div class="bv-modal-panel" style="max-width: 720px; width: min(720px, 95vw);">
                    <div class="bv-modal-header">
                        <h3>
                            <span data-i18n="budget_modal_suggest_title">${window.i18n.t('budget_modal_suggest_title') || "💡 Suggestions d'enveloppes"}</span>
                        </h3>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.closeAiWindowModal()" style="padding:4px 10px;font-size:12px;">✕</button>
                    </div>

                    <p class="bv-modal-subtitle" data-i18n="budget_modal_suggest_subtitle" style="margin-bottom:6px;">
                        ${window.i18n.t('budget_modal_suggest_subtitle') || "Choisissez le moteur de calcul et la période d'historique bancaire à analyser :"}
                    </p>

                    <!-- SECTION 1 : Moteur de calcul -->
                    <div style="margin-bottom:8px;">
                        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;" data-i18n="budget_modal_engine_section_title">
                            ${window.i18n.t('budget_modal_engine_section_title') || "Moteur de calcul"}
                        </div>
                        <div class="bv-engine-options">
                            <label id="modalEngineCard_det" class="bv-engine-card bv-modal-option--selected" onclick="window.BudgetsView.selectModalSuggestEngine('deterministic', this)">
                                <div class="bv-engine-card-header">
                                    <div class="bv-engine-card-title">
                                        <input type="radio" name="modalSuggestEngine" value="deterministic" checked style="accent-color:var(--accent);">
                                        <span data-i18n="budget_modal_engine_det_title">${window.i18n.t('budget_modal_engine_det_title') || 'Déterministe'}</span>
                                    </div>
                                    <span class="bv-engine-tag bv-engine-tag--det" data-i18n="budget_modal_engine_det_tag">${window.i18n.t('budget_modal_engine_det_tag') || '⚡ Instantané'}</span>
                                </div>
                                <span class="bv-engine-card-desc" data-i18n="budget_modal_engine_det_desc">
                                    ${window.i18n.t('budget_modal_engine_det_desc') || 'Calcul statistique Winsorisé 100% hors-ligne. Zéro dépendance, immédiat et fiable.'}
                                </span>
                            </label>

                            <label id="modalEngineCard_ai" class="bv-engine-card" onclick="window.BudgetsView.selectModalSuggestEngine('ai', this)">
                                <div class="bv-engine-card-header">
                                    <div class="bv-engine-card-title">
                                        <input type="radio" name="modalSuggestEngine" value="ai" style="accent-color:var(--accent);">
                                        <span data-i18n="budget_modal_engine_ai_title">${window.i18n.t('budget_modal_engine_ai_title') || 'IA locale'}</span>
                                    </div>
                                    <span id="modalAiStatusBadge" class="bv-engine-tag bv-engine-tag--ai">🤖 Sémantique</span>
                                </div>
                                <span class="bv-engine-card-desc" data-i18n="budget_modal_engine_ai_desc">
                                    ${window.i18n.t('budget_modal_engine_ai_desc') || 'Regroupement sémantique par intelligence artificielle locale sous des thèmes cohérents.'}
                                </span>
                            </label>
                        </div>
                    </div>

                    <!-- SECTION 2 : Période d'historique -->
                    <div style="margin-bottom:8px;">
                        <div style="font-size:12px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;" data-i18n="budget_modal_period_section_title">
                            ${window.i18n.t('budget_modal_period_section_title') || "Période d'historique"}
                        </div>
                        <div class="bv-modal-options">
                            <label class="bv-modal-option bv-modal-option--selected" onclick="window.BudgetsView.selectModalAiWindow(3, this)">
                                <input type="radio" name="modalAiWindowOption" value="3" checked>
                                <div class="bv-modal-option-info">
                                    <strong data-i18n="ai_modal_win_3m_title">${window.i18n.t('ai_modal_win_3m_title') || '3 Mois (Recommandé)'}</strong>
                                    <span data-i18n="ai_modal_win_3m_desc">${window.i18n.t('ai_modal_win_3m_desc') || 'Idéal pour s\'adapter à vos habitudes de dépense récentes.'}</span>
                                </div>
                            </label>

                            <label class="bv-modal-option" onclick="window.BudgetsView.selectModalAiWindow(6, this)">
                                <input type="radio" name="modalAiWindowOption" value="6">
                                <div class="bv-modal-option-info">
                                    <strong data-i18n="ai_modal_win_6m_title">${window.i18n.t('ai_modal_win_6m_title') || '6 Mois (Lissage moyen)'}</strong>
                                    <span data-i18n="ai_modal_win_6m_desc">${window.i18n.t('ai_modal_win_6m_desc') || 'Parfait pour lisser les dépenses saisonnières et semi-annuelles.'}</span>
                                </div>
                            </label>

                            <label class="bv-modal-option" onclick="window.BudgetsView.selectModalAiWindow(12, this)">
                                <input type="radio" name="modalAiWindowOption" value="12">
                                <div class="bv-modal-option-info">
                                    <strong data-i18n="ai_modal_win_12m_title">${window.i18n.t('ai_modal_win_12m_title') || '12 Mois (Vue annuelle complète)'}</strong>
                                    <span data-i18n="ai_modal_win_12m_desc">${window.i18n.t('ai_modal_win_12m_desc') || 'Capturer l\'ensemble des charges annuelles, abonnements et impôts.'}</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- Switch Toggle Wizard -->
                    <div class="bv-toggle-row">
                        <div class="bv-toggle-row-info">
                            <strong data-i18n="ai_wizard_toggle_label">${window.i18n.t('ai_wizard_toggle_label') || '🪄 Lancer le wizard de configuration'}</strong>
                            <span data-i18n="ai_wizard_toggle_desc">${window.i18n.t('ai_wizard_toggle_desc') || 'Guide pas à pas pour affiner et passer en revue vos enveloppes'}</span>
                        </div>
                        <label class="switch" style="position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;">
                            <input type="checkbox" id="aiWizardToggleCheck" ${ProfileStorage.get('budget_ai_wizard_enabled') !== 'false' ? 'checked' : ''} onchange="ProfileStorage.set('budget_ai_wizard_enabled', this.checked)">
                            <span class="slider round"></span>
                        </label>
                    </div>

                    <div class="bv-modal-footer">
                        <button class="btn btn-secondary" onclick="window.BudgetsView.closeAiWindowModal()">${window.i18n.t('budget_bulk_delete_cancel') || 'Annuler'}</button>
                        <button id="btnConfirmSuggestModal" class="btn btn-primary" onclick="window.BudgetsView.confirmAiWindowSelection()" data-i18n="budget_modal_btn_start_det">
                            ${window.i18n.t('budget_modal_btn_start_det') || '⚡ Calculer les suggestions'}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Modal Assistant / Wizard de configuration des enveloppes IA -->
            <div id="aiBudgetWizardModal" class="bv-wizard-overlay">
                <div class="bv-wizard-panel">
                    
                    <!-- Header Wizard -->
                    <div class="bv-wizard-header">
                        <h3 id="aiWizardTitle">
                            <span data-i18n="ai_wizard_step1_title">${window.i18n.t('ai_wizard_step1_title')}</span>
                        </h3>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.skipWizard()" style="padding:4px 10px;font-size:12px;" data-i18n="ai_wizard_skip">${window.i18n.t('ai_wizard_skip') || 'Ignorer l\'assistant'}</button>
                    </div>

                    <!-- Content Container Dynamic per step -->
                    <div id="aiWizardContent" class="bv-wizard-content">
                        <!-- Dynamically filled by JS -->
                    </div>

                    <!-- Footer Controls -->
                    <div id="aiWizardFooter" class="bv-wizard-footer">
                        <!-- Dynamically filled by JS -->
                    </div>
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
            ${(() => {
                const hasProposals = (this.aiProposals && this.aiProposals.length > 0) || (this.unclassifiedCategories && this.unclassifiedCategories.length > 0);
                const isClosed = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('budget_ai_panel_closed') : sessionStorage.getItem('budget_ai_panel_closed')) === 'true';
                const isHidden = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('budget_ai_panel_hidden') : sessionStorage.getItem('budget_ai_panel_hidden')) === 'true';
                const isMinimizedHidden = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('budget_ai_minimized_hidden') : sessionStorage.getItem('budget_ai_minimized_hidden')) === 'true';
                const showStrip = hasProposals && !isClosed && isHidden && !isMinimizedHidden;
                const count = (this.aiProposals || []).length;
                return `
                <div id="budgetAiMinimizedStrip" class="budget-ai-minimized-strip" style="${showStrip ? 'display:flex;' : 'display:none;'}">
                    <div class="budget-minimized-strip-left">
                        <span class="budget-minimized-strip-icon">💡</span>
                        <div class="budget-minimized-strip-info">
                            <strong><span id="minimizedAiCount">${count}</span> <span data-i18n="budget_ai_minimized_title">${window.i18n.t('budget_ai_minimized_title') || 'suggestions budgétaires en attente'}</span></strong>
                            <span class="budget-minimized-strip-desc" data-i18n="budget_ai_minimized_desc">${window.i18n.t('budget_ai_minimized_desc') || 'Vos réglages et propositions sont conservés en mémoire.'}</span>
                        </div>
                    </div>
                    <div class="budget-minimized-strip-right">
                        <button type="button" class="btn btn-secondary budget-minimized-btn-show" onclick="window.BudgetsView.showAiPanel()" title="${window.i18n.t('budget_ai_btn_show_existing') || 'Afficher les suggestions'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                            <span class="btn-text" data-i18n="budget_ai_btn_show_existing">${window.i18n.t('budget_ai_btn_show_existing') || 'Afficher les suggestions'}</span>
                        </button>
                        <button type="button" class="btn btn-secondary budget-minimized-btn-purge" onclick="window.BudgetsView.purgeAiSuggestions()" title="${window.i18n.t('budget_ai_btn_purge') || 'Purger'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                            <span class="btn-text" data-i18n="budget_ai_btn_purge">${window.i18n.t('budget_ai_btn_purge') || 'Purger'}</span>
                        </button>
                        <button type="button" class="btn btn-secondary budget-minimized-btn-close" onclick="window.BudgetsView.hideMinimizedAiStrip()" title="${window.i18n.t('btn_close') || 'Fermer'}">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        </button>
                    </div>
                </div>
                `;
            })()}

            <!-- AI Suggestions panel -->
            ${(() => {
                const hasProposals = (this.aiProposals && this.aiProposals.length > 0) || (this.unclassifiedCategories && this.unclassifiedCategories.length > 0);
                const isClosed = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('budget_ai_panel_closed') : sessionStorage.getItem('budget_ai_panel_closed')) === 'true';
                const isHidden = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('budget_ai_panel_hidden') : sessionStorage.getItem('budget_ai_panel_hidden')) === 'true';
                const showPanel = hasProposals && !isClosed && !isHidden;
                return `<div id="budgetAiPanel" class="budget-ai-panel" style="${showPanel ? 'display:block;' : 'display:none;'}">
                    ${this.renderAiPanelHtml()}
                </div>`;
            })()}

            <!-- Status this month -->
            <div id="budgetStatusContainer" style="margin-bottom:30px;"></div>

            <!-- Unified Modal (Details + Add/Edit Form) -->
            <div id="budgetUnifiedModal" class="modal-overlay" style="display:none;z-index:10000;align-items:flex-start;padding-top:5vh;padding-bottom:5vh;overflow-y:auto;" onclick="if(event.target===this) window.BudgetsView.closeUnifiedModal()">
                <div class="modal budget-unified-panel" style="width: min(1100px, calc(100vw - 24px)); max-width: 95vw; border-radius: 16px; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); padding: 24px; background: var(--bg-surface); border: 1px solid var(--accent); height: max-content;">
                    
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;border-bottom:1px solid var(--border-color);padding-bottom:12px;">
                        <h4 id="budgetUnifiedTitle" style="margin:0;font-size:16px;" data-i18n="budget_modal_title">${window.i18n.t('budget_modal_title')}</h4>
                        <div style="display:flex;gap:8px;">
                            <button id="budgetUnifiedEditBtn" class="btn btn-secondary" style="display:none;padding:4px 8px;font-size:12px;" onclick="window.BudgetsView.showEditSection()" data-i18n="budget_btn_edit">${window.i18n.t('budget_btn_edit')}</button>
                            <button class="btn btn-secondary" onclick="window.BudgetsView.closeUnifiedModal()" style="padding:4px 8px;font-size:12px;">✕</button>
                        </div>
                    </div>

                    <!-- DETAIL SECTION -->
                    <div id="budgetDetailSection" style="display:none;margin-bottom:24px;">
                        <div id="budgetDetailGraph" style="margin-bottom:16px;"></div>
                        <div id="budgetDetailList" style="display:flex;flex-direction:column;gap:6px;"></div>
                    </div>

                    <!-- FORM SECTION -->
                    <div id="budgetFormSection" style="display:none;">
                        <input type="hidden" id="budgetEditId">

                        <div style="display:flex;flex-direction:column;gap:14px;">
                            <!-- Name -->
                            <div>
                                <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_label_name">${window.i18n.t('budget_label_name')}</label>
                                <input type="text" id="newBudgetName" class="inline-input" placeholder="Ex: Courses, Vacances St Malo..." style="width:100%;margin-top:4px;">
                            </div>

                            <!-- Type toggle -->
                            <div class="budget-type-row" style="display:flex;align-items:center;gap:12px;width:100%;flex-wrap:wrap;">
                                <label style="font-size:12px;color:var(--text-muted);white-space:nowrap;" data-i18n="budget_type_label">${window.i18n.t('budget_type_label')}</label>
                                <div class="budget-type-toggle-group" style="display:flex; flex:1; min-width: 240px; background:var(--bg-base); padding:4px; border-radius:8px; border:1px solid var(--border-color); flex-wrap: wrap; gap: 4px;">
                                    <label id="tabLabelCat" style="flex:1; min-width: 70px; text-align:center; cursor:pointer; padding:8px 8px; font-size:12.5px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="category" id="budgetTypeCategory" checked onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        <span data-i18n="budget_type_category">${window.i18n.t('budget_type_category')}</span>
                                    </label>
                                    <label id="tabLabelProj" style="flex:1; min-width: 70px; text-align:center; cursor:pointer; padding:8px 8px; font-size:12.5px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="project" id="budgetTypeProject" onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        <span data-i18n="budget_type_project">${window.i18n.t('budget_type_project')}</span>
                                    </label>
                                    <label id="tabLabelSavings" style="flex:1; min-width: 70px; text-align:center; cursor:pointer; padding:8px 8px; font-size:12.5px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="savings" id="budgetTypeSavings" onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        <span data-i18n="budget_type_savings">${window.i18n.t('budget_type_savings')}</span>
                                    </label>
                                </div>
                            </div>

                            <!-- Improvement_04: Account Selector (Org Mode only) -->
                            <div id="budgetAccountSection" style="${(window.app?.config?.enable_org_mode === 'true') ? '' : 'display:none;'}">
                                <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_account_filter">${window.i18n.t('budget_account_filter') || 'Account scope'}</label>
                                <div id="budgetAccountCheckboxes" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:6px;margin-top:6px;max-height:150px;overflow-y:auto;padding:10px;background:var(--bg-base);border-radius:8px;border:1px solid var(--border-color);">
                                    <!-- Filled dynamically -->
                                </div>
                            </div>

                            <!-- Category selector (hidden for project type) -->
                            <div id="budgetCatSection">
                                <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_cat_included">${window.i18n.t('budget_cat_included')}</label>
                                <input type="text" id="budgetCatSearch" class="inline-input" 
                                    data-i18n-placeholder="budget_cat_search_placeholder"
                                    placeholder="${window.i18n.t('budget_cat_search_placeholder') || 'Search category...'}"
                                    style="width:100%;margin-top:6px;margin-bottom:4px;font-size:12px;padding:6px 10px;border-radius:6px;"
                                    oninput="window.BudgetsView.renderCatCheckboxes(window.BudgetsView.selectedCategories)">
                                <div id="budgetCatCheckboxes" style="display:block;margin-top:8px;max-height:450px;overflow-y:auto;padding:12px;background:var(--bg-base);border-radius:8px;border:1px solid var(--border-color);">
                                    <!-- Filled dynamically -->
                                </div>
                            </div>

                            <!-- Amount + period -->
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                                <div>
                                    <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_target_amount">${window.i18n.t('budget_target_amount')}</label>
                                    <input type="number" id="newBudgetAmount" class="inline-input" placeholder="0.00" style="width:100%;margin-top:4px;" min="0" step="0.01">
                                </div>
                                <div>
                                    <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_label_period">${window.i18n.t('budget_label_period')}</label>
                                    <select id="newBudgetPeriod" class="inline-input" style="width:100%;margin-top:4px;" onchange="window.BudgetsView.onPeriodChange()">
                                        <option value="monthly" data-i18n="budget_opt_monthly">${window.i18n.t('budget_opt_monthly')}</option>
                                        <option value="yearly" data-i18n="budget_opt_yearly">${window.i18n.t('budget_opt_yearly')}</option>
                                        <option value="indefinite" data-i18n="budget_opt_indefinite">${window.i18n.t('budget_opt_indefinite')}</option>
                                        ${(window.app?.config?.enable_org_mode === 'true') ? `<option value="custom" data-i18n="budget_opt_custom">${window.i18n.t('budget_opt_custom') || 'Time-bound'}</option>` : ''}
                                    </select>
                                </div>
                            </div>

                            <!-- Custom period date pickers (hidden by default) -->
                            <div id="budgetCustomDates" style="display:none;">
                                <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_custom_dates_label">${window.i18n.t('budget_custom_dates_label') || 'Custom period'}</label>
                                <div style="display:flex;gap:10px;align-items:center;margin-top:4px;">
                                    <input type="date" id="newBudgetStartDate" class="inline-input" style="flex:1;">
                                    <span style="color:var(--text-muted);">→</span>
                                    <input type="date" id="newBudgetEndDate" class="inline-input" style="flex:1;">
                                </div>
                            </div>

                            <!-- Lock toggle (is_locked) -->
                            <div id="budgetLockSection" style="padding:10px 12px;background:var(--bg-base);border-radius:8px;border:1px solid var(--border-color);">
                                <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;margin:0;">
                                    <input type="checkbox" id="budgetIsLocked" style="margin-top:2px;cursor:pointer;width:16px;height:16px;accent-color:var(--accent);">
                                    <div>
                                        <span style="font-size:13px;font-weight:600;display:flex;align-items:center;gap:6px;" data-i18n="budget_is_locked_label">
                                            🔒 ${window.i18n.t('budget_is_locked_label') || 'Verrouiller cette enveloppe'}
                                        </span>
                                        <small style="color:var(--text-muted);display:block;font-size:12px;margin-top:2px;" data-i18n="budget_is_locked_sublabel">
                                            ${window.i18n.t('budget_is_locked_sublabel') || 'Exclut cette enveloppe du recalcul et des ajustements automatiques.'}
                                        </small>
                                    </div>
                                </label>
                            </div>

                            <!-- Archive/Close secondary button (edit mode only) -->
                            <div id="budgetArchiveSection" style="display:none;margin-top:2px;">
                                <button type="button" id="budgetToggleCloseBtn" class="btn btn-secondary" style="font-size:12px;width:100%;display:flex;align-items:center;justify-content:center;gap:6px;padding:6px 12px;" onclick="window.BudgetsView.toggleCloseFromModal()">
                                    <span id="budgetToggleCloseIcon">📦</span> <span id="budgetToggleCloseText">${window.i18n.t('budget_close_action')}</span>
                                </button>
                            </div>

                            <!-- Buttons -->
                            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">
                                <button id="budgetSaveBtn" class="btn btn-primary" style="flex:1;" onclick="window.BudgetsView.saveForm(this)" data-i18n="budget_btn_save">${window.i18n.t('budget_btn_save')}</button>
                                <button class="btn btn-secondary" style="flex:1;" onclick="window.BudgetsView.hideEditSection()" data-i18n="budget_btn_cancel">${window.i18n.t('budget_btn_cancel')}</button>
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
        };
        return `<svg class="bv-ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || ''}</svg>`;
    },

    _stripEmoji(label) {
        return (label || '').replace(/^[\s\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+/u, '').trim();
    },

    // Préférences d'affichage (propres au profil, enregistrées côté serveur)
    _budgetPrefs() {
        const cfg = window.app?.config || {};
        let pinned = [];
        try { pinned = JSON.parse(cfg.budget_pinned_ids || '[]').map(Number).filter(Boolean); } catch (e) { pinned = []; }
        return {
            pinned,
            sidebarTotals: cfg.budget_sidebar_totals !== 'false',
            excludeFixed: cfg.budget_totals_exclude_fixed !== 'false',
        };
    },

    async saveBudgetPrefs(patch) {
        try {
            await API.post('/api/config/', patch);
            if (window.app) window.app.config = { ...(window.app.config || {}), ...patch };
            this.renderStatus();
            window.app?.refreshSidebar();
        } catch (e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
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
        const watched = [...groups.cycle, ...groups.yearly, ...groups.dated.filter(b => !isEnded(b)),
                         ...groups.fixed, ...groups.projects];
        const count = (s) => watched.filter(b => b.status === s).length;
        const nOver = count('over'), nNear = count('near'), nAhead = count('ahead');
        const plural = (n, one, many) => (n > 1 ? many : one).split('{count}').join(n);
        const attnParts = [];
        if (nOver) attnParts.push(`<span class="bv-attn-item bv-tone-over">${plural(nOver, t('bv_attn_over_one', '{count} enveloppe dépassée'), t('bv_attn_over_many', '{count} enveloppes dépassées'))}</span>`);
        if (nNear) attnParts.push(`<span class="bv-attn-item bv-tone-near">${plural(nNear, t('bv_attn_near_one', '{count} proche de la limite'), t('bv_attn_near_many', '{count} proches de la limite'))}</span>`);
        if (nAhead) attnParts.push(`<span class="bv-attn-item bv-tone-ahead">${plural(nAhead, t('bv_attn_ahead_one', '{count} en avance sur le rythme'), t('bv_attn_ahead_many', '{count} en avance sur le rythme'))}</span>`);
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
        const renderTotal = ({ period: p, key, list, withoutFixed }) => {
            const limit = list.reduce((s, b) => s + (b.budget_amount || 0), 0);
            const spent = list.reduce((s, b) => s + (b.spent_to_date ?? b.spent ?? 0), 0);
            const planned = list.reduce((s, b) => s + (b.planned || 0), 0);
            const pct = limit > 0 ? (spent / limit) * 100 : 0;
            const plannedPct = limit > 0 ? (planned / limit) * 100 : 0;
            const tone = pct > 100 ? 'over' : pct >= 90 ? 'near' : 'ok';
            let label = totalLabel(p);
            if (key !== '__global__') {
                const names = key.split(',').map(id => this.accounts?.find(a => a.id === parseInt(id))).filter(Boolean)
                    .map(a => `<span class="bv-env-account" style="--acc:${a.color || 'var(--accent)'}">${a.name}</span>`);
                label = `${names.length ? names.join(' ') : (list[0]?.account_names || []).join(' + ')}<span class="bv-total-period">${label}</span>`;
            }
            if (withoutFixed) label += `<span class="bv-total-period">${t('bv_total_without_fixed', 'hors charges prévues')}</span>`;
            let status = spent > limit
                ? tp('bv_status_over', { amount: formatCurrency(spent - limit) }, 'Dépassée de {amount}')
                : tp('bv_status_left', { amount: formatCurrency(limit - spent) }, 'Reste {amount}');
            if (planned > 0.005) status += ` · ${tp('bv_planned', { amount: formatCurrency(planned) }, '{amount} prévus')}`;
            const countText = (list.length > 1 ? t('bv_total_count_many', '{count} enveloppes') : t('bv_total_count_one', '{count} enveloppe')).split('{count}').join(list.length);
            return `
            <div class="bv-total bv-tone-${tone}" data-budget-period-sub="${p}-${key}">
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
                    <span class="bv-env-meta">${countText}</span>
                </div>
            </div>`;
        };
        const totalsHtml = totalGroups.length
            ? `<section class="bv-totals" aria-label="${t('bv_totals_label', 'Totaux des enveloppes')}">${totalGroups.map(renderTotal).join('')}</section>`
            : '';

        // ── Ligne d'enveloppe ──
        const renderRow = (b) => {
            const limit = b.budget_amount || 0;
            const spent = b.spent_to_date ?? b.spent ?? 0;
            const planned = b.planned || 0;
            const pct = limit > 0 ? (spent / limit) * 100 : 0;
            const plannedPct = limit > 0 ? (planned / limit) * 100 : 0;
            const status = b.status || 'ok';
            const fixed = isFixed(b);
            const ended = isEnded(b);
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

            const cats = b.categories || [];
            const catText = cats.length > 3 ? `${cats.slice(0, 3).join(', ')} +${cats.length - 3}` : cats.join(', ');
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
            const y = period ? parseInt(period.start.slice(0, 4)) : new Date().getFullYear();
            const m = period ? parseInt(period.start.slice(5, 7)) : new Date().getMonth() + 1;
            const barLabel = tp('bv_bar_label', { pct: Math.round(pct) }, '{pct} % utilisés');
            return `
            <article class="bv-env bv-tone-${tone}${b.is_closed ? ' bv-env--closed' : ''}" data-budget-id="${b.id}" tabindex="0"
                     onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})"
                     onkeydown="if(event.key==='Enter'&&event.target===this){window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})}">
                <div class="bv-env-head">
                    <div class="bv-env-name">
                        <strong>${b.name}</strong>
                        ${b.is_locked ? `<span class="bv-env-lock" title="${t('bv_locked', "Verrouillée : pas d'ajustement automatique")}">${this._bvIcon('lock', 13)}</span>` : ''}
                        ${prefs.pinned.includes(b.id) ? `<span class="bv-env-lock" title="${t('bv_pinned', 'Épinglée dans la barre latérale')}">${this._bvIcon('pin', 13)}</span>` : ''}
                    </div>
                    <div class="bv-env-figures privacy-blur"><strong>${formatCurrency(spent)}</strong><span> / ${formatCurrency(limit)}</span></div>
                    <div class="bv-env-actions" onclick="event.stopPropagation()">
                        <button type="button" class="bv-icon-btn" onclick="window.BudgetsView.editBudget(${b.id})" aria-label="${t('tooltip_edit', 'Modifier')} ${safeName}" title="${t('tooltip_edit', 'Modifier')}">${this._bvIcon('pencil')}</button>
                        <button type="button" class="bv-icon-btn bv-icon-btn--danger" onclick="window.BudgetsView.deleteBudget(${b.id})" aria-label="${t('tooltip_delete', 'Supprimer')} ${safeName}" title="${t('tooltip_delete', 'Supprimer')}">${this._bvIcon('trash')}</button>
                    </div>
                </div>
                <div class="bv-env-bar" role="img" aria-label="${barLabel}">
                    <span class="bv-env-fill" style="width:${Math.min(pct, 100)}%"></span>
                    ${plannedPct > 0.5 && pct < 100 ? `<span class="bv-env-planned" style="left:${Math.min(pct, 100)}%;width:${Math.min(plannedPct, 100 - Math.min(pct, 100))}%"></span>` : ''}
                    ${showPace ? `<span class="bv-env-pace" style="left:${Math.min(b.expected_percent, 100)}%" title="${tp('bv_pace_marker', { pct: Math.round(b.expected_percent) }, "Rythme attendu aujourd'hui : {pct} %")}"></span>` : ''}
                </div>
                <div class="bv-env-foot">
                    <span class="bv-env-meta">${meta}</span>
                    <span class="bv-env-status privacy-blur">${statusText}</span>
                </div>
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
        const totalsSets = totalGroups.filter(g => g.key === '__global__').map(g => g.list);
        const repeatsTotals = (list) => totalsSets.some(l => l.length === list.length && list.every(b => l.includes(b)));
        const renderSection = (key, title, list, extra = '') => {
            if (!list.length) return '';
            return `
            <section class="bv-section" data-budget-period="${key}">
                <header class="bv-section-head"><h3>${title}</h3>${key === 'org' || repeatsTotals(list) ? '' : sectionTotals(list)}</header>
                ${extra}
                <div class="bv-env-list">${list.map(renderRow).join('')}</div>
            </section>`;
        };

        let html = periodHtml + totalsHtml + attnHtml;

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
                html += `<div data-budget-period-sub="org-${key}">${renderSection('org', title, list)}</div>`;
            }
        } else {
            const cycleTitle = period?.kind === 'cycle' ? t('bv_section_cycle', 'Dépenses du cycle') : t('bv_section_month', 'Dépenses du mois');
            html += renderSection('monthly', cycleTitle, groups.cycle);
            html += renderSection('yearly', t('bv_section_yearly', 'Enveloppes annuelles'), groups.yearly);
            html += renderSection('custom', t('bv_section_dated', 'Enveloppes datées'), groups.dated);
        }

        const bannerHtml = this.renderAutopilotSuggestionsBanner ? this.renderAutopilotSuggestionsBanner() : '';
        if (bannerHtml) html += `<div class="bv-sugg-zone">${bannerHtml}</div>`;

        if (groups.fixed.length) {
            const fixedOver = groups.fixed.filter(b => b.status === 'over').length;
            const open = fixedOver > 0 || ProfileStorage.get('budget_fixed_open') === 'true';
            html += `
            <details class="bv-section bv-fold" data-budget-period="fixed" ${open ? 'open' : ''}
                     ontoggle="ProfileStorage.set('budget_fixed_open', this.open ? 'true' : 'false')">
                <summary class="bv-section-head">
                    <h3>${t('bv_section_fixed', 'Charges prévues')} <span class="bv-fold-count">${groups.fixed.length}</span></h3>
                    ${sectionTotals(groups.fixed)}
                    <span class="bv-fold-chevron">${this._bvIcon('chevronDown', 18)}</span>
                </summary>
                <p class="bv-section-hint">${t('bv_section_fixed_hint', 'Suivies par les récurrences : seul un dépassement est signalé.')}</p>
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

        html += this._renderCapacityPanel(isOrg);

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

        if (this.aiProposals && this.aiProposals.length > 0) {
            setTimeout(() => this.renderAiProposalsList(), 50);
        }
    },

    // Panneau « Couverture du budget » : replié par défaut, en fin de page (outil d'analyse, pas de suivi)
    _renderCapacityPanel(isOrg) {
        const t = (key, fallback) => (window.i18n && window.i18n.t(key)) || fallback;
        const open = ProfileStorage.get('show_budget_capacity_panel') === 'true';
        let body = '';
        if (open && this.capacityData) {
            const incomeLabel = isOrg ? t('budget_capacity_receipts', 'Recettes') : t('budget_capacity_income', 'Revenus');
            const tone = (r) => r > 100 ? 'over' : r >= 85 ? 'near' : 'ok';
            const lng = window.i18n?.currentLang || window.i18n?.lang || 'fr';
            const meter = (titleKey, titleFb, data) => {
                const ratio = data.engagement_ratio;
                const labelKey = data.is_fallback ? 'budget_capacity_expenses' : 'budget_capacity_budgeted';
                const details = (lng === 'en' ? data.details_en : data.details_fr) || '';
                return `
                <div class="bv-meter bv-tone-${tone(ratio)}">
                    <div class="bv-meter-head"><span>${t(titleKey, titleFb)}</span><strong>${ratio} %</strong></div>
                    <div class="bv-env-bar"><span class="bv-env-fill" style="width:${Math.min(ratio, 100)}%"></span></div>
                    <div class="bv-meter-foot">
                        <span>${t(labelKey, 'Budgétisé')} : <strong class="privacy-blur">${formatCurrency(data.budgeted)}</strong></span>
                        <span title="${details}">${incomeLabel} : <strong class="privacy-blur">${formatCurrency(data.average_income)}</strong></span>
                    </div>
                </div>`;
            };
            const accounts = (this.capacityData.accounts || []).map(acc => `
                <div class="bv-account-card">
                    <div class="bv-account-card-name"><span class="bv-env-account" style="--acc:${acc.color || 'var(--accent)'}">${acc.name}</span></div>
                    <div class="bv-account-card-row"><span>${t('budget_real_balance', 'Solde réel')}</span><span class="privacy-blur">${formatCurrency(acc.real_balance)}</span></div>
                    ${acc.savings_allocated > 0 ? `<div class="bv-account-card-row"><span>${t('budget_savings_reserved', 'Épargne réservée')}</span><span class="privacy-blur">- ${formatCurrency(acc.savings_allocated)}</span></div>` : ''}
                    <div class="bv-account-card-total"><span>${t('budget_available_balance', 'Disponible virtuel')}</span><span class="privacy-blur">${formatCurrency(acc.available_balance)}</span></div>
                </div>`).join('');
            // Mode organisation : pas d'engagement mensuel (recettes annuelles ou ponctuelles)
            body = `
                <div class="bv-capacity-body">
                    <div class="bv-capacity-grid">
                        ${isOrg ? '' : meter('budget_capacity_monthly', 'Engagement mensuel', this.capacityData.monthly)}
                        ${meter('budget_capacity_yearly', "Projection d'engagement annuel", this.capacityData.yearly)}
                    </div>
                    ${accounts ? `<div class="bv-accounts-section"><strong class="bv-accounts-section-label">${t('budget_accounts_impact', 'Impact sur les comptes & livrets')}</strong><div class="bv-accounts-grid">${accounts}</div></div>` : ''}
                </div>`;
        }
        return `
            <section class="bv-section bv-capacity">
                <button type="button" class="bv-capacity-toggle-btn" aria-expanded="${open}" onclick="window.BudgetsView.toggleCapacityPanel(${!open})">
                    <span>${t('budget_capacity_panel_title', 'Couverture du budget & Solde disponible')}</span>
                    <span class="bv-fold-chevron${open ? ' is-open' : ''}">${this._bvIcon('chevronDown', 18)}</span>
                </button>
                ${body}
            </section>`;
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
    },

    renderAiPanelHtml() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const isAiEnabled = (cfg.enable_ai === 'true' || cfg.enable_ai === true) || (window.BudgetsView?.aiEnabled === true);
        const currentEngine = (window.BudgetsView?.currentSuggestionEngine || (window.BudgetsView?.aiSuggestMeta && window.BudgetsView.aiSuggestMeta.engine) || cfg.budget_suggestion_engine || 'deterministic').toLowerCase();
        const isEngineDet = !isAiEnabled || currentEngine === 'deterministic';
        const badgeClass = isEngineDet ? 'bv-engine-tag bv-engine-tag--det' : 'bv-engine-tag bv-engine-tag--ai';
        const badgeText = isEngineDet
            ? ('⚡ ' + (window.i18n ? window.i18n.t('budget_engine_det_short') || 'Déterministe' : 'Déterministe'))
            : ('🤖 ' + (window.i18n ? window.i18n.t('budget_engine_ai_short') || 'IA locale' : 'IA locale'));
        const resetBtnLabel = isEngineDet
            ? (window.i18n.t('budget_strategy_reset_det') || '💡 Aligner avec suggestions initiales')
            : (window.i18n.t('ai_budget_strategy_recommended_clean') || '🤖 Aligner avec suggestions IA');
        const resetBtnI18nKey = isEngineDet ? 'budget_strategy_reset_det' : 'ai_budget_strategy_recommended_clean';

        return `
                <div class="budget-ai-panel-header">
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <span id="aiPanelEngineBadge" class="${badgeClass}" style="font-size:12px;font-weight:700;">${badgeText}</span>
                        <span style="font-weight:700;font-size:13px;color:var(--text-main);" data-i18n="ai_budget_window">${window.i18n.t('ai_budget_window') || 'Historique d\'analyse :'}</span>
                        <span title="${window.i18n.t('ai_sim_tt_history_help') || 'La fenêtre détermine la profondeur de l\'historique analysée par l\'IA pour lisser vos moyennes mensuelles/annuelles, détecter les récurrences et couvrir l\'ensemble de vos catégories de dépenses.'}" style="cursor:help;margin-right:4px;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:12px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                        <button id="aiWinBtn3" class="btn btn-secondary" style="padding:3px 8px;font-size:12px;" onclick="window.BudgetsView.requestAiSuggestions(3, null, window.BudgetsView.getCurrentEngine())" data-i18n="ai_budget_window_3m">3 mois</button>
                        <button id="aiWinBtn6" class="btn btn-secondary" style="padding:3px 8px;font-size:12px;" onclick="window.BudgetsView.requestAiSuggestions(6, null, window.BudgetsView.getCurrentEngine())" data-i18n="ai_budget_window_6m">6 mois</button>
                        <button id="aiWinBtn12" class="btn btn-secondary" style="padding:3px 8px;font-size:12px;" onclick="window.BudgetsView.requestAiSuggestions(12, null, window.BudgetsView.getCurrentEngine())" data-i18n="ai_budget_window_12m">12 mois</button>

                        <div style="height:16px;width:1px;background:var(--border-color);margin:0 4px;"></div>

                        <div class="budget-ai-outlier-box" title="${window.i18n ? window.i18n.t('ai_outlier_slider_tooltip') : 'Sensibilité aux dépenses exceptionnelles et imprévus historiques'}">
                            <span style="font-size:12px;color:var(--text-muted);font-weight:600;" data-i18n="ai_outlier_slider_label">Filtre d'écrêtage :</span>
                            <input id="aiOutlierSensitivitySlider" class="omni-smooth-slider" type="range" min="1" max="5" value="${window.BudgetsView?.currentOutlierSensitivity || 2}" step="0.01" style="width:80px;cursor:pointer;background:linear-gradient(to right, var(--accent) 0%, var(--accent) ${((((window.BudgetsView?.currentOutlierSensitivity || 2) - 1) / 4) * 100).toFixed(1)}%, rgba(255,255,255,0.12) ${((((window.BudgetsView?.currentOutlierSensitivity || 2) - 1) / 4) * 100).toFixed(1)}%, rgba(255,255,255,0.12) 100%);" oninput="window.BudgetsView.updateOutlierSensitivity(this.value, false)" onchange="window.BudgetsView.updateOutlierSensitivity(this.value, true)">
                            <span id="aiOutlierSensitivityLabel" style="font-size:12px;font-weight:700;color:var(--accent);min-width:110px;">${window.BudgetsView?.getOutlierSensitivityLabel ? window.BudgetsView.getOutlierSensitivityLabel(window.BudgetsView?.currentOutlierSensitivity || 2) : (window.i18n ? window.i18n.t('ai_outlier_level_2') : 'Prudent (Équilibre)')}</span>
                        </div>
                    </div>

                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;font-weight:600;color:var(--accent);border-color:var(--accent);background:rgba(var(--accent-rgb),0.08);" onclick="window.BudgetsView.startAiWizard()" data-i18n="ai_budget_btn_open_wizard">${window.i18n.t('ai_budget_btn_open_wizard') || '🪄 Assistant Wizard'}</button>
                        <div style="height:16px;width:1px;background:var(--border-color);margin:0 2px;"></div>
                        <span style="font-size:12px;color:var(--text-muted);font-weight:600;" data-i18n="ai_budget_select_label">${window.i18n.t('ai_budget_select_label') || 'Sélection :'}</span>
                        <button class="btn btn-secondary" style="padding:3px 8px;font-size:12px;" onclick="window.BudgetsView.toggleAllAiProposals(true)" data-i18n="ai_budget_select_all">${window.i18n.t('ai_budget_select_all') || 'Tout cocher'}</button>
                        <button class="btn btn-secondary" style="padding:3px 8px;font-size:12px;" onclick="window.BudgetsView.toggleAllAiProposals(false)" data-i18n="ai_budget_deselect_all">${window.i18n.t('ai_budget_deselect_all') || 'Tout décocher'}</button>
                        <div style="height:16px;width:1px;background:var(--border-color);margin:0 4px;"></div>
                        <button type="button" class="btn btn-secondary" style="padding:4px 9px;font-size:12px;display:inline-flex;align-items:center;gap:4px;" onclick="window.BudgetsView.hideAiPanel()" title="Masquer temporairement sans perdre vos réglages">
                            <span>👁️</span> <span class="btn-text" data-i18n="budget_ai_btn_hide">${window.i18n.t('budget_ai_btn_hide') || 'Masquer'}</span>
                        </button>
                        <button type="button" class="btn btn-secondary" style="padding:4px 9px;font-size:12px;color:#ef4444;border-color:rgba(239,68,68,0.3);display:inline-flex;align-items:center;gap:4px;" onclick="window.BudgetsView.purgeAiSuggestions()" title="Purger et réinitialiser les suggestions">
                            <span>🗑️</span> <span class="btn-text" data-i18n="budget_ai_btn_purge">${window.i18n.t('budget_ai_btn_purge') || 'Purger'}</span>
                        </button>
                    </div>
                </div>

                <!-- Simulator Container with 3 Cards & Unified Gauge Specs -->
                <div id="aiBudgetSimulator" class="budget-ai-simulator" style="display:none;">
                    <div class="budget-ai-sim-header">
                        <strong style="color:var(--accent);font-size:14px;display:flex;align-items:center;gap:6px;">
                            <span>⚡</span> <span data-i18n="ai_budget_sim_monthly_title">${window.i18n.t('ai_budget_sim_monthly_title') || 'Impact mensuel prévisionnel'}</span>
                        </strong>
                        
                        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                            <span id="aiSimSalaryBadge" style="font-size:12px;background:var(--bg-surface);padding:3px 10px;border-radius:6px;border:1px solid var(--border-color);color:var(--text-muted);display:flex;align-items:center;gap:6px;">
                                <span data-i18n="ai_sim_salary_input_label">${window.i18n.t('ai_sim_salary_input_label') || '💼 Revenus repère :'}</span> 
                                <input id="aiSimSalaryInput" type="number" step="10" style="width:80px;text-align:right;font-size:12px;font-weight:700;padding:2px 4px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-base);color:var(--accent);" oninput="window.BudgetsView.updateCustomSalary(this.value)"> €
                            </span>
                            <span id="aiSimSelectedCount" style="font-size:12px;color:var(--text-muted);font-weight:600;">0 / 0 sélectionnées</span>
                        </div>
                    </div>

                    <!-- Légende visuelle -->
                    <div class="budget-ai-sim-legend">
                        <span style="font-weight:700;color:var(--text-main);" data-i18n="ai_sim_legend_title">${window.i18n.t('ai_sim_legend_title') || 'Légende :'}</span>
                        <div style="display:flex;align-items:center;gap:5px;">
                            <span style="display:inline-block;width:12px;height:8px;background:var(--accent-gradient);border-radius:2px;"></span>
                            <span data-i18n="ai_sim_legend_envelopes">${window.i18n.t('ai_sim_legend_envelopes') || 'Montant des enveloppes'}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:5px;">
                            <span style="display:inline-block;width:3px;height:10px;background:#c084fc;border-radius:1px;"></span>
                            <span style="color:#c084fc;font-weight:600;" data-i18n="ai_sim_legend_salary">${window.i18n.t('ai_sim_legend_salary') || 'Revenus / Salaire repère'}</span>
                        </div>
                        <div style="display:flex;align-items:center;gap:5px;">
                            <span style="display:inline-block;width:3px;height:10px;background:#eab308;border-radius:1px;"></span>
                            <span style="color:#eab308;font-weight:600;" data-i18n="ai_sim_legend_estimated">${window.i18n.t('ai_sim_legend_estimated') || 'Dépenses estimées (historique)'}</span>
                        </div>
                    </div>

                    <!-- CARD 1 : Montant total des enveloppes mensuelles + annuelles lissées -->
                    <div class="budget-sim-gauge-card">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                            <span style="font-weight:700;font-size:13px;color:var(--text-main);" data-i18n="ai_sim_card1_title">${window.i18n.t('ai_sim_card1_title') || 'Montant total des enveloppes mensuelles + annuelles lissées'}</span>
                            <span id="aiSimCard1Badge" style="font-size:12px;font-weight:700;color:var(--accent);">0 €/m</span>
                        </div>
                        <div id="aiSimGaugeCard1"></div>
                    </div>

                    <!-- CARD 2 : Montant total des enveloppes mensuel -->
                    <div class="budget-sim-gauge-card">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                            <span style="font-weight:700;font-size:13px;color:#60a5fa;" data-i18n="ai_sim_card2_title">${window.i18n.t('ai_sim_card2_title') || 'Montant total des enveloppes mensuel'}</span>
                            <span id="aiSimCard2Badge" style="font-size:12px;font-weight:700;color:#60a5fa;">0 €/m</span>
                        </div>
                        <div id="aiSimGaugeCard2"></div>
                    </div>

                    <!-- CARD 3 : Montant total des enveloppes annuel -->
                    <div class="budget-sim-gauge-card">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                            <span style="font-weight:700;font-size:13px;color:#c084fc;" data-i18n="ai_sim_card3_title">${window.i18n.t('ai_sim_card3_title') || 'Montant total des enveloppes annuel'}</span>
                            <span id="aiSimCard3Badge" style="font-size:12px;font-weight:700;color:#c084fc;">0 €/an</span>
                        </div>
                        <div id="aiSimGaugeCard3"></div>
                    </div>

                    <!-- BOUTONS D'AJUSTEMENT RAPIDE DES MONTANTS -->
                    <div class="budget-sim-adjust-bar">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:12px;font-weight:700;color:var(--text-main);" data-i18n="ai_sim_lbl_adjust_proposals_title">${window.i18n.t('ai_sim_lbl_adjust_proposals_title') || '⚡ Modifier le montant des enveloppes pour les :'}</span>
                            <span title="${window.i18n.t('ai_sim_tt_adjust_help') || 'Permet d\'ajuster en un clic l\'ensemble des propositions d\'enveloppes'}" style="cursor:help;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:12px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;font-weight:600;" onclick="window.BudgetsView.adjustAiProposals(0.90)" data-i18n="ai_budget_strategy_frugal_clean">✂️ Réduire de 10%</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;font-weight:600;" onclick="window.BudgetsView.adjustAiProposals(1.10)" data-i18n="ai_budget_strategy_prudent_clean">🛡️ Augmenter de 10%</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;font-weight:600;" onclick="window.BudgetsView.alignAiProposalsToIncome()" data-i18n="ai_budget_strategy_income_clean">⚖️ Aligner sur les revenus</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;font-weight:600;color:#60a5fa;border-color:rgba(96,165,250,0.4);" onclick="window.BudgetsView.alignAiProposalsToCurrentMonth()" data-i18n="ai_budget_strategy_month_clean">📅 Aligner sur le mois</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;font-weight:600;color:#36b37e;border-color:rgba(54,179,126,0.4);" onclick="window.BudgetsView.alignAiProposalsToRealSpending()" data-i18n="ai_budget_strategy_avg_clean">📊 Aligner sur la moyenne</button>
                            <button id="btnResetProposals" class="btn btn-secondary" style="padding:4px 10px;font-size:12px;font-weight:600;color:var(--accent);border-color:var(--accent-border);" onclick="window.BudgetsView.resetAiProposalsToOriginal()" data-i18n="${resetBtnI18nKey}">${resetBtnLabel}</button>
                        </div>
                    </div>
                </div>

                <!-- Historical Comparison Warning Alert -->
                <div id="aiSimHistoricalComparisonAlert" class="budget-ai-alert-banner" style="display:none;"></div>

                <!-- Proposal Table & Loading Overlay Container -->
                <div>
                    <div id="aiLoadingOverlay" style="display:none;min-height:180px;width:100%;background:var(--bg-base);border:1px solid var(--border-color);border-radius:10px;flex-direction:column;align-items:center;justify-content:center;gap:14px;color:var(--text-main);padding:24px;margin-bottom:14px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <svg class="animate-spin" style="width:26px;height:26px;color:#c084fc;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <strong id="aiLoadingText" style="font-size:14px;color:var(--text-main);" data-i18n="ai_status_preparing">${window.i18n.t('ai_status_preparing') || 'Préparation des données bancaires...'}</strong>
                        </div>

                        <div id="aiTimerBadge" style="font-size:12px;background:rgba(139,92,246,0.15);color:#c084fc;padding:4px 14px;border-radius:12px;border:1px solid rgba(139,92,246,0.3);font-weight:700;">
                            0s / 300s max
                        </div>

                        <div id="aiStepperContainer" style="display:flex;gap:8px;font-size:12px;color:var(--text-muted);margin-top:6px;flex-wrap:wrap;justify-content:center;">
                            <span id="aiStep_PREPARING" data-i18n="ai_step_preparing" style="padding:4px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-color);transition:all 0.3s ease;">${window.i18n.t('ai_step_preparing') || '1. Données'}</span>
                            <span id="aiStep_SENDING" data-i18n="ai_step_sending" style="padding:4px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-color);transition:all 0.3s ease;">${window.i18n.t('ai_step_sending') || '2. Envoi IA'}</span>
                            <span id="aiStep_THINKING" data-i18n="ai_step_thinking" style="padding:4px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-color);transition:all 0.3s ease;">${window.i18n.t('ai_step_thinking') || '3. Réflexion'}</span>
                            <span id="aiStep_PARSING" data-i18n="ai_step_parsing" style="padding:4px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-color);transition:all 0.3s ease;">${window.i18n.t('ai_step_parsing') || '4. Structuration'}</span>
                        </div>

                        <div id="aiParsingProgressBarContainer" style="display:none;width:100%;max-width:320px;height:4px;background:var(--border-color);border-radius:2px;overflow:hidden;margin-top:6px;">
                            <div id="aiParsingProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #8b5cf6, #3b82f6);transition:width 2s cubic-bezier(0.4, 0, 0.2, 1);border-radius:2px;"></div>
                        </div>

                        <button type="button" id="btnOverlayStopAi" onclick="event.stopPropagation(); window.BudgetsView.cancelAiSuggestions()" class="btn btn-secondary" style="margin-top:8px;padding:4px 14px;font-size:12px;color:#ef4444;border-color:rgba(239,68,68,0.4);" data-i18n="ai_btn_stop">
                            ${window.i18n.t('ai_btn_stop') || "Arrêter l'analyse"}
                        </button>
                    </div>
                    <div id="budgetAiProposals" style="display:flex;flex-direction:column;gap:6px;"></div>

                    <div id="aiStickyBar" class="budget-ai-sticky-bar" style="display:none;">
                        <span id="aiStickyCount" style="font-size:13px;color:var(--text-main);font-weight:700;"></span>
                        <button id="budgetAiAcceptSelectedBtn" class="btn btn-primary" onclick="window.BudgetsView.acceptSelectedProposals()" data-i18n="ai_budget_accept_selected">
                            ✨ ${window.i18n.t('ai_budget_accept_selected') || 'Créer les enveloppes sélectionnées'}
                        </button>
                    </div>
                </div>
        `;
    }
});
