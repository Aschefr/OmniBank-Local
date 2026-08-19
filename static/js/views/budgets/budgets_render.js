// static/js/views/budgets/budgets_render.js
// Enveloppes Budgétaires v2 — HTML Rendering & Visual Cards UI

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const aiDisp = cfg.enable_ai === 'true' ? '' : 'display: none !important;';

        return `
        <div>
            <div class="bv-header view-header">
                <h2 data-i18n="budget_title">${window.i18n.t('budget_title')}</h2>
                <div class="bv-header-actions">
                    <button id="budgetAiBtn" class="btn btn-secondary" style="${aiDisp}" onclick="window.BudgetsView.openAiWindowModal()" data-i18n="budget_btn_suggestions">${window.i18n.t('budget_btn_suggestions')}</button>
                    <button class="btn btn-secondary bv-btn-delete" onclick="window.BudgetsView.showBulkDeleteModal()" data-i18n="budget_btn_bulk_delete">${window.i18n.t('budget_btn_bulk_delete') || '🗑️ Nettoyer'}</button>
                    <button class="btn btn-primary" onclick="window.BudgetsView.showAddForm()" data-i18n="budget_btn_new">${window.i18n.t('budget_btn_new')}</button>
                </div>
            </div>

            <!-- Modal Sélection préalable de la période d'analyse IA -->
            <div id="aiWindowSelectionModal" class="bv-modal-overlay">
                <div class="bv-modal-panel">
                    <div class="bv-modal-header">
                        <h3>
                            <span>🔮</span> <span data-i18n="ai_modal_window_title">${window.i18n.t('ai_modal_window_title') || '🔮 Suggestions Budgétaires par l\'IA'}</span>
                        </h3>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.closeAiWindowModal()" style="padding:4px 10px;font-size:12px;">✕</button>
                    </div>

                    <p class="bv-modal-subtitle" data-i18n="ai_modal_window_subtitle">
                        ${window.i18n.t('ai_modal_window_subtitle') || 'Choisissez la période d\'historique bancaire à analyser pour calculer vos enveloppes :'}
                    </p>

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
                        <button class="btn btn-primary" onclick="window.BudgetsView.confirmAiWindowSelection()" data-i18n="ai_modal_btn_start">${window.i18n.t('ai_modal_btn_start') || '🚀 Lancer l\'analyse IA'}</button>
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
                    <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;" onclick="window.BudgetsView.closeBulkDeleteModal()">✕</button>
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

            <!-- AI Suggestions panel -->
            ${(() => {
                const hasProposals = (this.aiProposals && this.aiProposals.length > 0) || (this.unclassifiedCategories && this.unclassifiedCategories.length > 0);
                const isClosed = sessionStorage.getItem('budget_ai_panel_closed') === 'true';
                const showPanel = hasProposals && !isClosed;
                return `<div id="budgetAiPanel" style="${showPanel ? 'display:block;' : 'display:none;'}background:var(--bg-surface);border:1px solid var(--border-color);border-radius:12px;padding:16px 20px;margin-bottom:24px;box-shadow:var(--shadow-md);">`;
            })()}
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--border-color);flex-wrap:wrap;gap:10px;">
                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <span style="font-weight:700;font-size:13px;color:var(--text-main);" data-i18n="ai_budget_window">${window.i18n.t('ai_budget_window') || 'Historique d\'analyse :'}</span>
                        <span title="${window.i18n.t('ai_sim_tt_history_help') || 'La fenêtre détermine la profondeur de l\'historique analysée par l\'IA pour lisser vos moyennes mensuelles/annuelles, détecter les récurrences et couvrir l\'ensemble de vos catégories de dépenses.'}" style="cursor:help;margin-right:4px;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                        <button id="aiWinBtn3" class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.BudgetsView.requestAiSuggestions(3)" data-i18n="ai_budget_window_3m">3 mois</button>
                        <button id="aiWinBtn6" class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.BudgetsView.requestAiSuggestions(6)" data-i18n="ai_budget_window_6m">6 mois</button>
                        <button id="aiWinBtn12" class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.BudgetsView.requestAiSuggestions(12)" data-i18n="ai_budget_window_12m">12 mois</button>

                        <div style="height:16px;width:1px;background:var(--border-color);margin:0 4px;"></div>

                        <div style="display:flex;align-items:center;gap:6px;background:var(--bg-surface);padding:2px 8px;border-radius:6px;border:1px solid var(--border-color);" title="${window.i18n ? window.i18n.t('ai_outlier_slider_tooltip') : 'Sensibilité aux dépenses exceptionnelles et imprévus historiques'}">
                            <span style="font-size:11px;color:var(--text-muted);font-weight:600;" data-i18n="ai_outlier_slider_label">Filtre d'écrêtage :</span>
                            <input id="aiOutlierSensitivitySlider" type="range" min="1" max="5" value="2" step="1" style="width:70px;cursor:pointer;accent-color:var(--accent);" oninput="window.BudgetsView.updateOutlierSensitivity(this.value)">
                            <span id="aiOutlierSensitivityLabel" style="font-size:11px;font-weight:700;color:var(--accent);min-width:110px;">${window.BudgetsView?.getOutlierSensitivityLabel ? window.BudgetsView.getOutlierSensitivityLabel(2) : (window.i18n ? window.i18n.t('ai_outlier_level_2') : 'Prudent (Équilibre)')}</span>
                        </div>
                    </div>

                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;color:var(--accent);border-color:var(--accent);background:rgba(32,101,209,0.08);" onclick="window.BudgetsView.startAiWizard()" data-i18n="ai_budget_btn_open_wizard">${window.i18n.t('ai_budget_btn_open_wizard') || '🪄 Assistant Wizard'}</button>
                        <div style="height:16px;width:1px;background:var(--border-color);margin:0 2px;"></div>
                        <span style="font-size:11px;color:var(--text-muted);font-weight:600;" data-i18n="ai_budget_select_label">${window.i18n.t('ai_budget_select_label') || 'Sélection :'}</span>
                        <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.BudgetsView.toggleAllAiProposals(true)" data-i18n="ai_budget_select_all">${window.i18n.t('ai_budget_select_all') || 'Tout cocher'}</button>
                        <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.BudgetsView.toggleAllAiProposals(false)" data-i18n="ai_budget_deselect_all">${window.i18n.t('ai_budget_deselect_all') || 'Tout décocher'}</button>
                        <div style="height:16px;width:1px;background:var(--border-color);margin:0 4px;"></div>
                        <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="window.BudgetsView.closeAiPanel()" data-i18n="budget_ai_close">✕ Fermer</button>
                    </div>
                </div>

                <!-- Simulator Container with 3 Cards & Unified Gauge Specs -->
                <div id="aiBudgetSimulator" style="display:none;background:var(--bg-base);border:1px solid var(--border-color);border-radius:10px;padding:16px;margin-bottom:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px;">
                        <strong style="color:var(--accent);font-size:14px;display:flex;align-items:center;gap:6px;">
                            <span>⚡</span> <span data-i18n="ai_budget_sim_monthly_title">${window.i18n.t('ai_budget_sim_monthly_title') || 'Impact mensuel prévisionnel'}</span>
                        </strong>
                        
                        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;">
                            <span id="aiSimSalaryBadge" style="font-size:11px;background:var(--bg-surface);padding:3px 10px;border-radius:6px;border:1px solid var(--border-color);color:var(--text-muted);display:flex;align-items:center;gap:6px;">
                                <span data-i18n="ai_sim_salary_input_label">${window.i18n.t('ai_sim_salary_input_label') || '💼 Revenus repère :'}</span> 
                                <input id="aiSimSalaryInput" type="number" step="10" style="width:80px;text-align:right;font-size:12px;font-weight:700;padding:2px 4px;border-radius:4px;border:1px solid var(--border-color);background:var(--bg-base);color:var(--accent);" oninput="window.BudgetsView.updateCustomSalary(this.value)"> €
                            </span>
                            <span id="aiSimSelectedCount" style="font-size:12px;color:var(--text-muted);font-weight:600;">0 / 0 sélectionnées</span>
                        </div>
                    </div>

                    <!-- Légende visuelle -->
                    <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px;padding:6px 12px;background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;font-size:11px;color:var(--text-muted);flex-wrap:wrap;">
                        <span style="font-weight:700;color:var(--text-main);" data-i18n="ai_sim_legend_title">${window.i18n.t('ai_sim_legend_title') || 'Légende :'}</span>
                        <div style="display:flex;align-items:center;gap:5px;">
                            <span style="display:inline-block;width:12px;height:8px;background:linear-gradient(90deg, #3b82f6, #6366f1);border-radius:2px;"></span>
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
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:14px;margin-bottom:14px;display:flex;flex-direction:column;gap:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                            <span style="font-weight:700;font-size:13px;color:var(--text-main);" data-i18n="ai_sim_card1_title">${window.i18n.t('ai_sim_card1_title') || 'Montant total des enveloppes mensuelles + annuelles lissées'}</span>
                            <span id="aiSimCard1Badge" style="font-size:12px;font-weight:700;color:var(--accent);">0 €/m</span>
                        </div>
                        <div id="aiSimGaugeCard1"></div>
                    </div>

                    <!-- CARD 2 : Montant total des enveloppes mensuel -->
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:14px;margin-bottom:14px;display:flex;flex-direction:column;gap:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                            <span style="font-weight:700;font-size:13px;color:#60a5fa;" data-i18n="ai_sim_card2_title">${window.i18n.t('ai_sim_card2_title') || 'Montant total des enveloppes mensuel'}</span>
                            <span id="aiSimCard2Badge" style="font-size:12px;font-weight:700;color:#60a5fa;">0 €/m</span>
                        </div>
                        <div id="aiSimGaugeCard2"></div>
                    </div>

                    <!-- CARD 3 : Montant total des enveloppes annuel -->
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:14px;margin-bottom:14px;display:flex;flex-direction:column;gap:10px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;">
                            <span style="font-weight:700;font-size:13px;color:#c084fc;" data-i18n="ai_sim_card3_title">${window.i18n.t('ai_sim_card3_title') || 'Montant total des enveloppes annuel'}</span>
                            <span id="aiSimCard3Badge" style="font-size:12px;font-weight:700;color:#c084fc;">0 €/an</span>
                        </div>
                        <div id="aiSimGaugeCard3"></div>
                    </div>

                    <!-- BOUTONS D'AJUSTEMENT RAPIDE DES MONTANTS -->
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:12px;font-weight:700;color:var(--text-main);" data-i18n="ai_sim_lbl_adjust_proposals_title">${window.i18n.t('ai_sim_lbl_adjust_proposals_title') || '⚡ Modifier le montant des enveloppes pour les :'}</span>
                            <span title="${window.i18n.t('ai_sim_tt_adjust_help') || 'Permet d\'ajuster en un clic l\'ensemble des propositions d\'enveloppes'}" style="cursor:help;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;" onclick="window.BudgetsView.adjustAiProposals(0.90)" data-i18n="ai_budget_strategy_frugal_clean">✂️ Réduire de 10%</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;" onclick="window.BudgetsView.adjustAiProposals(1.10)" data-i18n="ai_budget_strategy_prudent_clean">🛡️ Augmenter de 10%</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;" onclick="window.BudgetsView.alignAiProposalsToIncome()" data-i18n="ai_budget_strategy_income_clean">⚖️ Aligner sur les revenus</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;color:#60a5fa;border-color:rgba(96,165,250,0.4);" onclick="window.BudgetsView.alignAiProposalsToCurrentMonth()" data-i18n="ai_budget_strategy_month_clean">📅 Aligner sur le mois</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;color:#36b37e;border-color:rgba(54,179,126,0.4);" onclick="window.BudgetsView.alignAiProposalsToRealSpending()" data-i18n="ai_budget_strategy_avg_clean">📊 Aligner sur la moyenne</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;color:#c084fc;border-color:rgba(192,132,252,0.4);" onclick="window.BudgetsView.resetAiProposalsToOriginal()" data-i18n="ai_budget_strategy_recommended_clean">🤖 Aligner avec suggestions IA</button>
                        </div>
                    </div>
                </div>

                <!-- Historical Comparison Warning Alert -->
                <div id="aiSimHistoricalComparisonAlert" style="display:none;background:rgba(239, 68, 68, 0.12);border:1px solid rgba(239, 68, 68, 0.35);border-radius:8px;padding:10px 14px;margin-bottom:14px;font-size:12px;color:#f87171;align-items:center;gap:10px;"></div>

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

                        <div id="aiStepperContainer" style="display:flex;gap:8px;font-size:11px;color:var(--text-muted);margin-top:6px;flex-wrap:wrap;justify-content:center;">
                            <span id="aiStep_PREPARING" data-i18n="ai_step_preparing" style="padding:4px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-color);transition:all 0.3s ease;">${window.i18n.t('ai_step_preparing') || '1. Données'}</span>
                            <span id="aiStep_SENDING" data-i18n="ai_step_sending" style="padding:4px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-color);transition:all 0.3s ease;">${window.i18n.t('ai_step_sending') || '2. Envoi LLM'}</span>
                            <span id="aiStep_THINKING" data-i18n="ai_step_thinking" style="padding:4px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-color);transition:all 0.3s ease;">${window.i18n.t('ai_step_thinking') || '3. Réflexion'}</span>
                            <span id="aiStep_PARSING" data-i18n="ai_step_parsing" style="padding:4px 10px;border-radius:6px;background:var(--bg-surface);border:1px solid var(--border-color);transition:all 0.3s ease;">${window.i18n.t('ai_step_parsing') || '4. Structuration'}</span>
                        </div>

                        <div id="aiParsingProgressBarContainer" style="display:none;width:100%;max-width:320px;height:4px;background:var(--border-color);border-radius:2px;overflow:hidden;margin-top:6px;">
                            <div id="aiParsingProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #8b5cf6, #3b82f6);transition:width 2s cubic-bezier(0.4, 0, 0.2, 1);border-radius:2px;"></div>
                        </div>

                        <button onclick="window.BudgetsView.cancelAiSuggestions()" class="btn btn-secondary" style="margin-top:8px;padding:4px 14px;font-size:12px;color:#ef4444;border-color:rgba(239,68,68,0.4);" data-i18n="ai_btn_stop">
                            ${window.i18n.t('ai_btn_stop') || "Arrêter l'analyse"}
                        </button>
                    </div>
                    <div id="budgetAiProposals" style="display:flex;flex-direction:column;gap:6px;"></div>

                    <div id="aiStickyBar" style="display:none;position:sticky;bottom:12px;z-index:10;background:var(--bg-surface);border:1px solid var(--accent);border-radius:12px;padding:12px 18px;margin-top:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;box-shadow:0 8px 24px rgba(0,0,0,0.35), 0 0 12px rgba(59,130,246,0.2);backdrop-filter:blur(10px);">
                        <span id="aiStickyCount" style="font-size:13px;color:var(--text-main);font-weight:700;"></span>
                        <button id="budgetAiAcceptSelectedBtn" class="btn btn-primary" style="padding:8px 22px;font-size:13px;font-weight:700;box-shadow:0 4px 12px rgba(59,130,246,0.3);" onclick="window.BudgetsView.acceptSelectedProposals()" data-i18n="ai_budget_accept_selected">
                            ✨ ${window.i18n.t('ai_budget_accept_selected') || 'Créer les enveloppes sélectionnées'}
                        </button>
                    </div>
                </div>
            </div>

            <!-- Status this month -->
            <div id="budgetStatusContainer" style="margin-bottom:30px;"></div>

            <!-- Unified Modal (Details + Add/Edit Form) -->
            <div id="budgetUnifiedModal" class="modal-overlay" style="display:none;z-index:1000;align-items:flex-start;padding-top:8vh;padding-bottom:8vh;overflow-y:auto;">
                <div class="modal" style="width:95vw;max-width:1100px;border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);padding:30px;background:var(--bg-surface);border:1px solid var(--accent);height:max-content;">
                    
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
                            <div style="display:flex;align-items:center;gap:12px;width:100%;">
                                <label style="font-size:12px;color:var(--text-muted);white-space:nowrap;" data-i18n="budget_type_label">${window.i18n.t('budget_type_label')}</label>
                                <div style="display:flex; flex:1; background:var(--bg-base); padding:4px; border-radius:8px; border:1px solid var(--border-color);">
                                    <label id="tabLabelCat" style="flex:1; text-align:center; cursor:pointer; padding:8px 12px; font-size:13px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="category" id="budgetTypeCategory" checked onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        <span data-i18n="budget_type_category">${window.i18n.t('budget_type_category')}</span>
                                    </label>
                                    <label id="tabLabelProj" style="flex:1; text-align:center; cursor:pointer; padding:8px 12px; font-size:13px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="project" id="budgetTypeProject" onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        <span data-i18n="budget_type_project">${window.i18n.t('budget_type_project')}</span>
                                    </label>
                                    <label id="tabLabelSavings" style="flex:1; text-align:center; cursor:pointer; padding:8px 12px; font-size:13px; border-radius:6px; transition:all 0.2s;">
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

                            <!-- Buttons -->
                            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">
                                <button class="btn btn-primary" style="flex:1;" onclick="window.BudgetsView.saveForm()" data-i18n="budget_btn_save">${window.i18n.t('budget_btn_save')}</button>
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

    renderStatus() {
        const container = document.getElementById('budgetStatusContainer');
        const hasBudgets = this.statusData && this.statusData.budgets && this.statusData.budgets.length > 0;

        const showCapacity = ProfileStorage.get('show_budget_capacity_panel') !== 'false';
        const panelHelpText = window.i18n.t('budget_capacity_tooltip') || "À quoi sert ce panneau ?\nLa capacité budgétaire compare l'ensemble de vos enveloppes à vos recettes/revenus. C'est un outil prédictif basé sur le passé à titre indicatif.";

        const toggleHeaderHtml = `
            <div class="bv-capacity-toggle">
                <label>
                    <span class="toggle-switch" style="flex-shrink:0;">
                        <input type="checkbox" id="toggleCapacityPanel" ${showCapacity ? 'checked' : ''} onchange="window.BudgetsView.toggleCapacityPanel(this.checked)">
                        <span class="slider"></span>
                    </span>
                    <strong>${window.i18n.t('budget_capacity_panel_title') || 'Couverture du budget & Solde disponible'}</strong>
                </label>
                <span title="${panelHelpText}" class="bv-info-icon bv-info-icon--lg">i</span>
            </div>
        `;

        let capacityHtml = '';
        if (showCapacity && this.capacityData) {
            const isOrg = window.app?.config?.enable_org_mode === 'true';
            const incomeLabel = isOrg ? (window.i18n.t('budget_capacity_receipts') || 'Recettes') : (window.i18n.t('budget_capacity_income') || 'Revenus');
            
            const monthlyRatio = this.capacityData.monthly.engagement_ratio;
            const monthlyColor = monthlyRatio > 100 ? '#ff5630' : monthlyRatio >= 85 ? '#f59e0b' : '#10b981';
            
            const yearlyRatio = this.capacityData.yearly.engagement_ratio;
            const yearlyColor = yearlyRatio > 100 ? '#ff5630' : yearlyRatio >= 85 ? '#f59e0b' : '#10b981';
            
            let accountsHtml = '';
            if (this.capacityData.accounts && this.capacityData.accounts.length > 0) {
                accountsHtml = `
                    <div class="bv-accounts-section">
                        <strong class="bv-accounts-section-label">${window.i18n.t('budget_accounts_impact') || 'Impact sur les comptes & livrets'}</strong>
                        <div class="bv-accounts-grid">
                            ${this.capacityData.accounts.map(acc => {
                                const accColor = acc.color || 'var(--accent)';
                                const hasSavings = acc.savings_allocated > 0;
                                return `
                                    <div class="bv-account-card">
                                        <div class="bv-account-card-name">
                                            <span style="width:8px;height:8px;border-radius:50%;background:${accColor};"></span>
                                            <span>${acc.name}</span>
                                        </div>
                                        <div class="bv-account-card-row">
                                            <span style="color:var(--text-muted);">${window.i18n.t('budget_real_balance') || 'Solde réel'}</span>
                                            <span class="privacy-blur" style="font-weight:600;">${formatCurrency(acc.real_balance)}</span>
                                        </div>
                                        ${hasSavings ? `
                                        <div class="bv-account-card-row" style="color:#f59e0b;">
                                            <span>${window.i18n.t('budget_savings_reserved') || 'Épargne réservée'}</span>
                                            <span class="privacy-blur">- ${formatCurrency(acc.savings_allocated)}</span>
                                        </div>
                                        ` : ''}
                                        <div class="bv-account-card-total">
                                            <span>${window.i18n.t('budget_available_balance') || 'Disponible virtuel'}</span>
                                            <span class="privacy-blur" style="color:${hasSavings ? 'var(--accent)' : 'inherit'};">${formatCurrency(acc.available_balance)}</span>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }

            const monthlyLabelKey = this.capacityData.monthly.is_fallback ? 'budget_capacity_expenses' : 'budget_capacity_budgeted';
            const yearlyLabelKey = this.capacityData.yearly.is_fallback ? 'budget_capacity_expenses' : 'budget_capacity_budgeted';

            const monthlyLabel = window.i18n.t(monthlyLabelKey) || (this.capacityData.monthly.is_fallback ? 'Dépenses moyennes' : 'Budgétisé');
            const yearlyLabel = window.i18n.t(yearlyLabelKey) || (this.capacityData.yearly.is_fallback ? 'Dépenses moyennes' : 'Budgétisé');

            const lang = window.i18n?.currentLang || window.i18n?.lang || 'fr';
            const monthlyDetails = (lang === 'en' ? this.capacityData.monthly.details_en : this.capacityData.monthly.details_fr) || '';
            const yearlyDetails = (lang === 'en' ? this.capacityData.yearly.details_en : this.capacityData.yearly.details_fr) || '';

            const monthlyBudgetedDetails = (lang === 'en' ? this.capacityData.monthly.budgeted_details_en : this.capacityData.monthly.budgeted_details_fr) || '';
            const yearlyBudgetedDetails = (lang === 'en' ? this.capacityData.yearly.budgeted_details_en : this.capacityData.yearly.budgeted_details_fr) || '';

            const monthlyInfoIcon = monthlyDetails ? `<span title="${monthlyDetails}" class="bv-info-icon">i</span>` : '';
            const yearlyInfoIcon = yearlyDetails ? `<span title="${yearlyDetails}" class="bv-info-icon">i</span>` : '';

            const monthlyBudgetedInfoIcon = monthlyBudgetedDetails ? `<span title="${monthlyBudgetedDetails}" class="bv-info-icon">i</span>` : '';
            const yearlyBudgetedInfoIcon = yearlyBudgetedDetails ? `<span title="${yearlyBudgetedDetails}" class="bv-info-icon">i</span>` : '';

            capacityHtml = `
                <div class="bv-capacity-panel">
                    <div class="bv-capacity-grid">
                        <!-- Monthly capacity -->
                        <div>
                            <div class="bv-capacity-meter-header">
                                <span>${window.i18n.t('budget_capacity_monthly') || 'Engagement mensuel'}</span>
                                <span style="color:${monthlyColor};">${monthlyRatio}%</span>
                            </div>
                            <div class="bv-progress-track bv-progress-track--sm" style="margin-bottom:6px;">
                                <div class="bv-progress-bar" style="width:${Math.min(monthlyRatio, 100)}%;background:${monthlyColor};"></div>
                            </div>
                            <div class="bv-capacity-meter-footer">
                                <span>${monthlyLabel} : <span class="privacy-blur" style="font-weight:600;color:var(--text-base);">${formatCurrency(this.capacityData.monthly.budgeted)}</span>${monthlyBudgetedInfoIcon}</span>
                                <span>${incomeLabel} : <span class="privacy-blur" style="font-weight:600;color:var(--text-base);">${formatCurrency(this.capacityData.monthly.average_income)}</span>${monthlyInfoIcon}</span>
                            </div>
                        </div>
                        
                        <!-- Yearly capacity -->
                        <div>
                            <div class="bv-capacity-meter-header">
                                <span>${window.i18n.t('budget_capacity_yearly') || "Projection d'engagement annuel"}</span>
                                <span style="color:${yearlyColor};">${yearlyRatio}%</span>
                            </div>
                            <div class="bv-progress-track bv-progress-track--sm" style="margin-bottom:6px;">
                                <div class="bv-progress-bar" style="width:${Math.min(yearlyRatio, 100)}%;background:${yearlyColor};"></div>
                            </div>
                            <div class="bv-capacity-meter-footer">
                                <span>${yearlyLabel} : <span class="privacy-blur" style="font-weight:600;color:var(--text-base);">${formatCurrency(this.capacityData.yearly.budgeted)}</span>${yearlyBudgetedInfoIcon}</span>
                                <span>${incomeLabel} : <span class="privacy-blur" style="font-weight:600;color:var(--text-base);">${formatCurrency(this.capacityData.yearly.average_income)}</span>${yearlyInfoIcon}</span>
                            </div>
                        </div>
                    </div>
                    ${accountsHtml}
                </div>
            `;
        }

        const [my, mm] = this.monthlyMonth.split('-').map(Number);
        const monthLabel = new Date(my, mm-1, 1).toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', {month:'long', year:'numeric'});
        const yearLabel = String(this.yearlyYear);

        const groups = {
            'monthly': { title: window.i18n.t('period_monthly'), budgets: [], label: monthLabel, y: my, m: mm },
            'yearly': { title: window.i18n.t('period_yearly'), budgets: [], label: yearLabel, y: this.yearlyYear, m: 1 },
            'indefinite': { title: window.i18n.t('budget_period_indefinite'), budgets: [], label: '', y: my, m: mm },
            'custom': { title: window.i18n.t('budget_period_custom') || 'Time-bound', budgets: [], label: '', y: my, m: mm }
        };

        for (const b of (this.statusData?.budgets || [])) {
            if (groups[b.period]) {
                groups[b.period].budgets.push(b);
            } else {
                groups['monthly'].budgets.push(b);
            }
        }

        let fullHtml = toggleHeaderHtml + capacityHtml;

        const activeFilter = this.currentGridFilter || 'all';
        const filterBarHtml = `
            <div class="bv-filter-bar">
                <span class="bv-filter-bar-label">Filtrer :</span>
                <button class="btn btn-secondary bv-filter-btn ${activeFilter === 'all' ? 'bv-filter-btn--active' : ''}" onclick="window.BudgetsView.setGridFilter('all')" data-i18n="budget_filter_all">${window.i18n.t('budget_filter_all') || 'Toutes'}</button>
                <button class="btn btn-secondary bv-filter-btn ${activeFilter === 'spending' ? 'bv-filter-btn--active' : ''}" onclick="window.BudgetsView.setGridFilter('spending')" data-i18n="budget_filter_spending">${window.i18n.t('budget_filter_spending') || 'Mensuelles'}</button>
                <button class="btn btn-secondary bv-filter-btn ${activeFilter === 'yearly' ? 'bv-filter-btn--active' : ''}" onclick="window.BudgetsView.setGridFilter('yearly')" data-i18n="budget_filter_yearly">${window.i18n.t('budget_filter_yearly') || 'Annuelles'}</button>
                <button class="btn btn-secondary bv-filter-btn ${activeFilter === 'project' ? 'bv-filter-btn--active' : ''}" onclick="window.BudgetsView.setGridFilter('project')" data-i18n="budget_filter_project">${window.i18n.t('budget_filter_project') || 'Projets'}</button>
                <button class="btn btn-secondary bv-filter-btn ${activeFilter === 'savings' ? 'bv-filter-btn--active' : ''}" onclick="window.BudgetsView.setGridFilter('savings')" data-i18n="budget_filter_savings">${window.i18n.t('budget_filter_savings') || 'Épargne'}</button>
                <button class="btn btn-secondary bv-filter-btn bv-filter-btn--overspent ${activeFilter === 'overspent' ? 'bv-filter-btn--active' : ''}" onclick="window.BudgetsView.setGridFilter('overspent')" data-i18n="budget_filter_overspent">${window.i18n.t('budget_filter_overspent') || '⚠️ En dépassement'}</button>
            </div>
        `;
        fullHtml += filterBarHtml;

        const matchesFilter = (b) => {
            if (activeFilter === 'all') return true;
            if (activeFilter === 'spending') return !b.is_project && (b.envelope_type || 'spending') === 'spending' && (b.period === 'monthly' || !b.period);
            if (activeFilter === 'yearly') return !b.is_project && (b.envelope_type || 'spending') === 'spending' && b.period === 'yearly';
            if (activeFilter === 'project') return !!b.is_project;
            if (activeFilter === 'savings') return (b.envelope_type || 'spending') === 'savings';
            if (activeFilter === 'overspent') return (b.remaining || 0) < 0 || (b.is_overspent === true);
            return true;
        };

        const renderDateControls = (period) => {
            if (period === 'monthly') {
                const customEnabled = this.customPeriod.enabled;
                const monthOpacity = customEnabled ? 'opacity:0.4;pointer-events:none;' : '';
                const customDisp = customEnabled ? 'display:flex;' : 'display:none;';
                return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:0;${monthOpacity}">
                        <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:6px 0 0 6px;border-right:none;" onclick="window.BudgetsView.stepMonthly(-1)">◀</button>
                        <input type="month" id="budgetMonthInput" class="inline-input" style="min-width:130px;border-radius:0;font-size:12px;padding:4px 6px;" value="${this.monthlyMonth}" onchange="window.BudgetsView.monthlyMonth=this.value;ProfileStorage.set('budget_monthly_month',this.value);window.BudgetsView.loadStatusForType('monthly')">
                        <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:0 6px 6px 0;border-left:none;" onclick="window.BudgetsView.stepMonthly(1)">▶</button>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;">
                            <div style="position:relative;width:32px;height:18px;">
                                <input type="checkbox" id="budgetCustomPeriodToggle" class="global-toggle" style="opacity:0;width:0;height:0;position:absolute;" ${customEnabled ? 'checked' : ''} onchange="window.BudgetsView.onCustomPeriodToggle(this.checked)">
                                <span class="slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:var(--border-color);transition:.4s;border-radius:34px;"></span>
                                <span class="slider-knob" style="position:absolute;height:12px;width:12px;left:3px;bottom:3px;background-color:white;transition:.4s;border-radius:50%;"></span>
                            </div>
                            <span>${window.i18n.t('budget_custom_period') || 'Period'}</span>
                        </label>
                        <div id="budgetCustomPeriodInputs" style="${customDisp}align-items:center;gap:4px;">
                            <input type="date" id="budgetCustomStart" class="inline-input" style="width:130px;font-size:11px;" value="${this.customPeriod.start || ''}" onchange="window.BudgetsView.onCustomPeriodChange()">
                            <span style="color:var(--text-muted);font-size:10px;">→</span>
                            <input type="date" id="budgetCustomEnd" class="inline-input" style="width:130px;font-size:11px;" value="${this.customPeriod.end || ''}" onchange="window.BudgetsView.onCustomPeriodChange()">
                        </div>
                    </div>
                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="window.BudgetsView.goTodayMonthly()">${window.i18n.t('btn_today')}</button>
                </div>`;
            } else if (period === 'yearly') {
                return `<div style="display:flex;align-items:center;gap:0;">
                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:6px 0 0 6px;border-right:none;" onclick="window.BudgetsView.stepYearly(-1)">◀</button>
                    <span class="inline-input" style="min-width:60px;text-align:center;border-radius:0;font-size:12px;padding:4px 10px;display:inline-block;">${this.yearlyYear}</span>
                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:0 6px 6px 0;border-left:none;" onclick="window.BudgetsView.stepYearly(1)">▶</button>
                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;margin-left:8px;" onclick="window.BudgetsView.goTodayYearly()">${window.i18n.t('btn_today')}</button>
                </div>`;
            }
            return '';
        };

        const renderSummaryBar = (titleText, subtitleText, budgetsList, accentColor) => {
            let totalTarget = 0, totalExpenses = 0, totalRecExpenses = 0, totalIncome = 0;
            for (const b of budgetsList) {
                totalTarget += b.budget_amount;
                totalExpenses += b.expenses || 0;
                totalRecExpenses += b.reconciled_expenses || 0;
                totalIncome += b.income || 0;
            }
            const effectiveTarget = totalTarget + totalIncome;
            const totalPct = effectiveTarget > 0 ? Math.min((totalExpenses / effectiveTarget) * 100, 100) : 0;
            const recPct = effectiveTarget > 0 ? Math.min((totalRecExpenses / effectiveTarget) * 100, 100) : 0;
            const totalBarColor = (effectiveTarget > 0 && (totalRecExpenses / effectiveTarget) * 100 > 100) ? '#ff5630' : recPct >= 80 ? '#f59e0b' : '#10b981';
            const netSpent = totalExpenses - totalIncome;
            const globalOver = netSpent > totalTarget;
            const globalRemaining = totalTarget - netSpent;
            const borderStyle = accentColor ? `border-left:3px solid ${accentColor};` : '';
            const incomeHtml = totalIncome > 0 ? `<span class="privacy-blur" style="color:#10b981;font-size:12px;align-self:flex-end;">↑ ${formatCurrency(totalIncome)} ${window.i18n.t('budget_received')}</span>` : '';

            return `<div class="bv-summary-bar" style="${borderStyle}">
                <div class="bv-summary-header">
                    <div>
                        <h4>${titleText}</h4>
                        <span class="subtitle">${subtitleText}</span>
                    </div>
                    <div style="text-align:right;">
                        <strong class="privacy-blur bv-summary-amount">${formatCurrency(totalTarget)}</strong><span class="bv-summary-amount-label"> ${window.i18n.t('budget_budgeted')}</span>
                    </div>
                </div>
                <div class="bv-progress-track bv-progress-track--lg">
                    <div class="bv-progress-bar bv-progress-bar--bg" style="width:${totalPct}%;"></div>
                    <div class="bv-progress-bar" style="width:${recPct}%;background:${totalBarColor};"></div>
                </div>
                <div class="bv-summary-footer">
                    <div class="bv-summary-footer-left">
                        <span class="privacy-blur" style="color:${totalBarColor};font-weight:600;">${formatCurrency(totalRecExpenses)} ${window.i18n.t('budget_reconciled')}</span>
                        <span class="privacy-blur" style="color:var(--text-muted);font-size:12px;align-self:flex-end;">(${formatCurrency(totalExpenses)} ${window.i18n.t('budget_committed')})</span>
                        ${incomeHtml}
                    </div>
                    <span style="color:${globalOver ? '#ff5630' : 'var(--text-muted)'};font-weight:600;">${globalOver ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(globalRemaining))}</span> ${globalOver ? window.i18n.t('budget_global_exceeded') : window.i18n.t('budget_global_remaining')}</span>
                </div>
            </div>`;
        };

        const renderBudgetCard = (b, y, m) => {
            const effectiveBudget = b.budget_amount + (b.income || 0);
            const expensesPct = effectiveBudget > 0 ? Math.min(((b.expenses || 0) / effectiveBudget) * 100 || 0, 100) : 0;
            const recExpPct = effectiveBudget > 0 ? Math.min(((b.reconciled_expenses || 0) / effectiveBudget) * 100 || 0, 100) : 0;
            const barColor = (effectiveBudget > 0 && ((b.reconciled_expenses || 0) / effectiveBudget) * 100 > 100) ? '#ff5630' : recExpPct >= 80 ? '#f59e0b' : '#10b981';
            const overBudget = b.remaining < 0;
            const typeTag = b.is_project
                ? `<span class="bv-tag bv-tag--project">${window.i18n.t('budget_project_tag')}</span>`
                : '';
            const catTags = (b.categories || []).map(c =>
                `<span class="bv-tag bv-tag--cat">${c}</span>`
            ).join(' ');

            const incomeHtml = b.income > 0
                ? `<div style="font-size:11px;color:#10b981;margin-top:3px;">↑ <span class="privacy-blur">${formatCurrency(b.income)}</span> ${window.i18n.t('budget_received')}</div>`
                : '';

            const safeName = b.name.replace(/'/g, "\\'");
            const periodLabel = b.period === 'monthly' ? window.i18n.t('period_monthly') : b.period === 'yearly' ? window.i18n.t('period_yearly') : b.period === 'custom' ? `${window.i18n.t('budget_period_custom') || 'Time-bound'} (${b.start_date || '?'} → ${b.end_date || '?'})` : window.i18n.t('period_undefined');
            const closedStyle = b.is_closed ? 'opacity:0.6;' : '';
            const closedTag = b.is_closed
                ? `<span class="bv-tag bv-tag--closed">${window.i18n.t('budget_closed_tag')}</span>`
                : '';

            let accountBadges = '';
            if (b.account_ids && b.account_ids.length > 0 && window.app?.config?.enable_org_mode === 'true') {
                accountBadges = b.account_ids.map(aid => {
                    const acc = this.accounts?.find(a => a.id === aid);
                    if (!acc) return '';
                    const color = acc.color || 'var(--accent)';
                    return `<span class="bv-tag bv-tag--account" style="background:${color}1a; color:${color}; border:1px solid ${color}33;">● ${acc.name}</span>`;
                }).join(' ');
            }

            const showSyncBtn = (b.expenses !== undefined && b.expenses > 0 && Math.abs(b.expenses - b.budget_amount) > 0.009);
            const syncTitle = showSyncBtn ? (window.i18n.t('budget_sync_to_committed_tt') || 'Ajuster le montant du budget sur le montant engagé ({amount})').replace('{amount}', formatCurrency(b.expenses)) : '';

            const syncBtnHtml = showSyncBtn ? `
                <button type="button" class="btn btn-secondary bv-sync-btn" 
                        onclick="window.BudgetsView.updateAmount(${b.id}, ${b.expenses})" 
                        title="${syncTitle}">
                    ${window.i18n.t('budget_btn_sync_committed') || '⚡ Aligner'}
                </button>
            ` : '';

            return `<div data-budget-id="${b.id}" onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})" class="budget-envelope-card ${overBudget ? 'over-budget' : ''}" style="${closedStyle}">
                    <div class="bv-card-header">
                        <div class="bv-card-name-area">
                            <div class="bv-card-name-row">
                                <strong>${b.name}</strong>
                                ${closedTag}
                                ${accountBadges}
                            </div>
                            <div class="bv-card-tags">${typeTag}${catTags}</div>
                        </div>
                        <div class="bv-card-actions" onclick="event.stopPropagation()">
                            <button class="btn btn-secondary" onclick="window.BudgetsView.editBudget(${b.id})" title="${window.i18n.t('tooltip_edit')}">✏️</button>
                            <button class="btn btn-secondary" onclick="window.BudgetsView.toggleClose(${b.id})" title="${b.is_closed ? window.i18n.t('budget_reopen_action') : window.i18n.t('budget_close_action')}">${b.is_closed ? '🔓' : '🔒'}</button>
                            <button class="btn btn-danger" onclick="window.BudgetsView.deleteBudget(${b.id})" title="${window.i18n.t('tooltip_delete')}">✕</button>
                        </div>
                    </div>

                    <div class="bv-card-amount-row">
                        <span>${periodLabel}</span>
                        <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;">
                            ${syncBtnHtml}
                            <input type="number" class="inline-input" style="width:80px;text-align:right;padding:2px 6px;font-size:12px;border-radius:4px;" value="${b.budget_amount}" min="0" step="0.01" onchange="window.BudgetsView.updateAmount(${b.id}, this.value)"> €
                        </div>
                    </div>

                    <div class="bv-progress-track bv-progress-track--sm">
                        <div class="bv-progress-bar bv-progress-bar--bg" style="width:${expensesPct}%;"></div>
                        <div class="bv-progress-bar" style="width:${recExpPct}%;background:${barColor};"></div>
                    </div>
                    <div class="bv-card-footer">
                        <div class="bv-card-footer-left" onclick="event.stopPropagation()">
                            <span class="privacy-blur" style="color:${barColor};font-weight:600;">${formatCurrency(b.reconciled_expenses || 0)} ${window.i18n.t('budget_reconciled')}</span>
                            <span class="privacy-blur" style="color:var(--text-muted);font-size:11px;align-self:flex-end;${showSyncBtn ? 'cursor:pointer;text-decoration:underline;text-decoration-style:dotted;' : ''}" ${showSyncBtn ? `onclick="window.BudgetsView.updateAmount(${b.id}, ${b.expenses})" title="${syncTitle}"` : ''}>(${formatCurrency(b.expenses || 0)} ${window.i18n.t('budget_committed')})</span>
                            ${incomeHtml}
                        </div>
                        <span style="color:${overBudget ? '#ff5630' : 'var(--text-muted)'}">${overBudget ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(b.remaining))}</span> ${overBudget ? window.i18n.t('budget_exceeded_label') : window.i18n.t('budget_remaining_label')}</span>
                    </div>
                </div>`;
        };

        const renderSavingsCard = (b, y, m) => {
            const balance = b.balance || 0;
            const goal = b.budget_amount || 0;
            const funded = b.funded || 0;
            const withdrawn = b.withdrawn || 0;

            const overflow = this.savingsOverflow;
            let tempWithdrawn = 0;
            if (overflow && overflow.total_savings > 0 && !b.is_closed) {
                const proportion = balance / overflow.total_savings;
                tempWithdrawn = Math.min(balance, overflow.overflow_amount * proportion);
            }

            const effectiveBalance = balance - tempWithdrawn;
            const pct = goal > 0 ? Math.min((effectiveBalance / goal) * 100, 100) : 0;
            const theoreticalPct = goal > 0 ? Math.min((balance / goal) * 100, 100) : 0;
            const goalReached = balance >= goal && goal > 0;
            const barColor = goalReached ? '#f59e0b' : '#10b981';

            const safeName = b.name.replace(/'/g, "\\'");
            const closedStyle = b.is_closed ? 'opacity:0.6;' : '';
            const closedTag = b.is_closed
                ? `<span class="bv-tag bv-tag--closed">${window.i18n.t('budget_closed_tag')}</span>`
                : '';
            const typeTag = `<span class="bv-tag bv-tag--savings">${window.i18n.t('budget_savings_tag')}</span>`;

            let accountBadges = '';
            if (b.account_ids && b.account_ids.length > 0 && window.app?.config?.enable_org_mode === 'true') {
                accountBadges = b.account_ids.map(aid => {
                    const acc = this.accounts?.find(a => a.id === aid);
                    if (!acc) return '';
                    const color = acc.color || 'var(--accent)';
                    return `<span class="bv-tag bv-tag--account" style="background:${color}1a; color:${color}; border:1px solid ${color}33;">● ${acc.name}</span>`;
                }).join(' ');
            }

            const withdrawnHtml = withdrawn > 0
                ? `<span class="privacy-blur" style="color:#ff5630;font-size:11px;">↓ ${formatCurrency(withdrawn)} ${window.i18n.t('budget_savings_withdrawn')}</span>`
                : '';

            const tempWithdrawnBadge = tempWithdrawn > 0
                ? `<span class="bv-temp-withdrawn-badge" style="color:#ef4444;" title="${window.i18n.t('savings_temp_withdrawn') || 'Temporarily withdrawn'}">⚠ -${formatCurrency(tempWithdrawn)}</span>`
                : '';

            return `<div data-budget-id="${b.id}" onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})" class="budget-envelope-card savings ${goalReached ? 'goal-reached' : ''}" style="${closedStyle}">
                    <div class="bv-card-header">
                        <div class="bv-card-name-area">
                            <div class="bv-card-name-row">
                                <strong>${b.name}</strong>
                                ${closedTag}
                                ${accountBadges}
                                ${tempWithdrawnBadge}
                            </div>
                            <div class="bv-card-tags">${typeTag}</div>
                        </div>
                        <div class="bv-card-actions" onclick="event.stopPropagation()">
                            ${!b.is_closed ? `<button class="btn btn-secondary" onclick="window.BudgetsView.showAllocationForm(${b.id})" title="${window.i18n.t('budget_savings_add_funds')}">➕</button>` : ''}
                            <button class="btn btn-secondary" onclick="window.BudgetsView.editBudget(${b.id})" title="${window.i18n.t('tooltip_edit')}">✏️</button>
                            <button class="btn btn-secondary" onclick="window.BudgetsView.${b.is_closed ? 'toggleClose' : 'breakPiggyBank'}(${b.id})" title="${b.is_closed ? window.i18n.t('budget_reopen_action') : window.i18n.t('budget_savings_break_action')}">${b.is_closed ? '🔓' : '🔨'}</button>
                            <button class="btn btn-danger" onclick="window.BudgetsView.deleteBudget(${b.id})" title="${window.i18n.t('tooltip_delete')}">✕</button>
                        </div>
                    </div>

                    <div class="bv-card-amount-row">
                        <span>${window.i18n.t('budget_savings_goal')}</span>
                        <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;">
                            <input type="number" class="inline-input" style="width:80px;text-align:right;padding:2px 6px;font-size:12px;border-radius:4px;" value="${b.budget_amount}" min="0" step="0.01" onchange="window.BudgetsView.updateAmount(${b.id}, this.value)"> €
                        </div>
                    </div>

                    <div class="bv-progress-track bv-progress-track--sm">
                        ${tempWithdrawn > 0 ? `<div class="bv-progress-bar" style="width:${theoreticalPct}%;background:${barColor};opacity:0.25;"></div>` : ''}
                        <div class="bv-progress-bar" style="width:${pct}%;background:${barColor};transition:width 0.5s ease;"></div>
                    </div>
                    <div class="bv-card-footer">
                        <div class="bv-card-footer-left">
                            <span class="privacy-blur" style="color:${barColor};font-weight:600;">↑ ${formatCurrency(funded)} ${window.i18n.t('budget_savings_funded')}</span>
                            ${withdrawnHtml}
                        </div>
                        <span style="color:${goalReached ? '#f59e0b' : 'var(--text-muted)'};font-weight:600;">${goalReached ? '🎯 ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(b.remaining || 0))}</span> ${goalReached ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                    </div>
                </div>`;
        };

        const isOrgMode = window.app?.config?.enable_org_mode === 'true';

        const savingsBudgets = [];
        for (const period of ['monthly', 'yearly', 'indefinite', 'custom']) {
            const group = groups[period];
            if (group.budgets.length === 0) continue;
            const y = group.y;
            const m = group.m;
            const label = group.label;

            let spendingBudgets = group.budgets.filter(b => (b.envelope_type || 'spending') !== 'savings');
            let groupSavings = group.budgets.filter(b => (b.envelope_type || 'spending') === 'savings');

            spendingBudgets = spendingBudgets.filter(matchesFilter);
            groupSavings = groupSavings.filter(matchesFilter);
            savingsBudgets.push(...groupSavings.map(b => ({ ...b, _y: y, _m: m })));

            if (spendingBudgets.length === 0) continue;

            const periodColors = {
                'monthly': '#3b82f6',
                'yearly': '#8b5cf6',
                'indefinite': '#14b8a6',
                'custom': '#ec4899'
            };
            const pColor = periodColors[period] || '#3b82f6';

            let html = `<div data-budget-period="${period}" class="bv-period-section">
                <div class="bv-period-header" style="border-bottom:2px solid ${pColor}80;">
                    <h3>${window.i18n.t('budget_envelopes_title')} — ${group.title}</h3>
                    ${renderDateControls(period)}
                </div>`;

            const hasAnyAccountScope = isOrgMode && spendingBudgets.some(b => b.account_ids && b.account_ids.length > 0);

            if (hasAnyAccountScope) {
                const subGroups = {};
                for (const b of spendingBudgets) {
                    const key = (b.account_ids && b.account_ids.length > 0) ? [...b.account_ids].sort((a2,b2) => a2 - b2).join(',') : '__global__';
                    if (!subGroups[key]) subGroups[key] = [];
                    subGroups[key].push(b);
                }

                for (const [key, budgets] of Object.entries(subGroups)) {
                    let subTitle, accentColor;
                    if (key === '__global__') {
                        subTitle = `${window.i18n.t('budget_summary_global')} — ${group.title}`;
                        accentColor = null;
                    } else {
                        const accIds = key.split(',').map(id => parseInt(id));
                        const accObjs = accIds.map(id => this.accounts?.find(a => a.id === id)).filter(Boolean);
                        if (accObjs.length > 0) {
                            subTitle = accObjs.map(a => {
                                const c = a.color || 'var(--accent)';
                                return `<span style="color:${c};font-weight:600;">● ${a.name}</span>`;
                            }).join(' <span style="color:var(--text-muted);">+</span> ');
                        } else {
                            const firstBudget = budgets[0];
                            if (firstBudget?.account_names?.length > 0) {
                                subTitle = firstBudget.account_names.join(' + ');
                            } else {
                                subTitle = accIds.map(id => `#${id}`).join(' + ');
                            }
                        }
                        const firstAcc = accObjs[0];
                        accentColor = firstAcc?.color || 'var(--accent)';
                    }

                    html += `<div data-budget-period-sub="${period}-${key}">`;
                    html += renderSummaryBar(subTitle, label, budgets, accentColor);
                    html += `<div class="bv-card-grid">`;
                    for (const b of budgets) html += renderBudgetCard(b, y, m);
                    html += '</div></div>';
                }
            } else {
                html += `<div data-budget-period-sub="${period}-__global__">`;
                html += renderSummaryBar(`${window.i18n.t('budget_summary_global')} — ${group.title}`, label, spendingBudgets, null);
                html += `<div class="bv-card-grid">`;
                for (const b of spendingBudgets) html += renderBudgetCard(b, y, m);
                html += '</div></div>';
            }

            html += '</div>';
            fullHtml += html;
        }

        if (savingsBudgets.length > 0) {
            let savingsHtml = `<div data-budget-period="savings" class="bv-period-section">
                <div class="bv-savings-header">
                    <h3>🏦 ${window.i18n.t('budget_savings_section')}</h3>
                </div>`;

            const totalGoal = savingsBudgets.reduce((s, b) => s + (b.budget_amount || 0), 0);
            const totalBalance = savingsBudgets.reduce((s, b) => s + (b.balance || 0), 0);
            const overflow = this.savingsOverflow;
            const totalTempWithdrawn = overflow ? overflow.overflow_amount : 0;
            const effectiveTotalBalance = totalBalance - totalTempWithdrawn;
            const savingsPct = totalGoal > 0 ? Math.min(Math.max(effectiveTotalBalance / totalGoal, 0) * 100, 100) : 0;
            const theoreticalSavingsPct = totalGoal > 0 ? Math.min((totalBalance / totalGoal) * 100, 100) : 0;
            const savingsBarColor = theoreticalSavingsPct >= 100 ? '#f59e0b' : '#10b981';

            const overflowBadgeHtml = overflow
                ? `<span class="bv-overflow-badge" style="color:${overflow.fully_consumed ? '#ef4444' : '#f59e0b'}; background:${overflow.fully_consumed ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)'};">⚠ -${formatCurrency(totalTempWithdrawn)} ${window.i18n.t('savings_temp_withdrawn') || 'temporarily withdrawn'}</span>`
                : '';

            savingsHtml += `<div class="bv-summary-bar" style="border-left:3px solid ${overflow ? (overflow.fully_consumed ? '#ef4444' : '#f59e0b') : '#f59e0b'};">
                <div class="bv-summary-header">
                    <div>
                        <h4>🏦 ${window.i18n.t('budget_savings_summary')}</h4>
                        <div class="bv-savings-summary-counts">
                            <span style="font-size:12px;color:var(--text-muted);">${savingsBudgets.length} ${window.i18n.t('budget_savings_tag').toLowerCase()}${savingsBudgets.length > 1 ? 's' : ''}</span>
                            ${overflowBadgeHtml}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <strong class="privacy-blur bv-summary-amount">${formatCurrency(effectiveTotalBalance)}</strong><span class="bv-summary-amount-label"> / ${formatCurrency(totalGoal)}</span>
                    </div>
                </div>
                <div class="bv-progress-track bv-progress-track--lg">
                    ${totalTempWithdrawn > 0 ? `<div class="bv-progress-bar" style="width:${theoreticalSavingsPct}%;background:${savingsBarColor};opacity:0.25;"></div>` : ''}
                    <div class="bv-progress-bar" style="width:${savingsPct}%;background:${savingsBarColor};"></div>
                </div>
                <div class="bv-summary-footer">
                    <span class="privacy-blur" style="color:${savingsBarColor};font-weight:600;">${formatCurrency(effectiveTotalBalance)} ${window.i18n.t('budget_savings_funded')}</span>
                    <span style="color:var(--text-muted);font-weight:600;"><span class="privacy-blur">${formatCurrency(Math.abs(totalGoal - totalBalance))}</span> ${totalBalance >= totalGoal ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                </div>
            </div>`;

            savingsHtml += `<div class="bv-card-grid">`;
            for (const b of savingsBudgets) savingsHtml += renderSavingsCard(b, b._y, b._m);
            savingsHtml += '</div></div>';
            fullHtml += savingsHtml;
        }

        let html = fullHtml;
        if (!hasBudgets) {
            html += `<p class="bv-empty">${window.i18n.t('budget_no_active') || 'Aucune enveloppe budgétaire active.'}</p>`;
        }

        container.innerHTML = html;

        if (this._pendingHighlightName) {
            const name = this._pendingHighlightName;
            this._pendingHighlightName = null;
            setTimeout(() => this._highlightByName(name), 100);
        }

        if (this.aiProposals && this.aiProposals.length > 0) {
            setTimeout(() => {
                this.renderAiProposalsList();
            }, 50);
        }
    },

    _highlightByName(budgetName) {
        const cards = document.querySelectorAll('[data-budget-id]');
        for (const card of cards) {
            const nameEl = card.querySelector('strong');
            if (nameEl && nameEl.textContent.trim().startsWith(budgetName)) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.transition = 'box-shadow 0.4s ease, border-color 0.4s ease, transform 0.4s ease';
                card.style.boxShadow = '0 0 0 2px var(--accent), 0 0 24px rgba(99,102,241,0.5)';
                card.style.borderColor = 'var(--accent)';
                card.style.transform = 'scale(1.02)';
                setTimeout(() => {
                    card.style.boxShadow = '';
                    card.style.borderColor = '';
                    card.style.transform = '';
                    setTimeout(() => { card.style.transition = ''; }, 500);
                }, 4000);
                break;
            }
        }
    },

    setGridFilter(filter) {
        this.currentGridFilter = filter;
        this.renderStatus();
    }
});
