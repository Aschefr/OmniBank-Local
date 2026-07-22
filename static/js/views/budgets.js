// budgets.js — Enveloppes v2 : multi-catégories, projets, suggestions IA
window.BudgetsView = {
    budgets: [],
    categories: [],
    statusData: null,
    capacityData: null,
    aiEnabled: false,
    _directEdit: false, // true when modal was opened directly in edit mode (not via detail)
    customPeriod: { enabled: false, start: null, end: null }, // custom period with toggle
    selectedCategories: [], // Persistent state for category selection during edits

    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const aiDisp = cfg.enable_ai === 'true' ? '' : 'display: none !important;';

        return `
        <div>
            <div class="view-header" style="position:sticky;top:-32px;z-index:10;background:var(--bg-base);padding:32px 0 15px;margin-top:-32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <h2 style="margin:0;" data-i18n="budget_title">${window.i18n.t('budget_title')}</h2>
                <div class="history-filters" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    <button id="budgetAiBtn" class="btn btn-secondary" style="white-space:nowrap; ${aiDisp}" onclick="window.BudgetsView.openAiWindowModal()" data-i18n="budget_btn_suggestions">${window.i18n.t('budget_btn_suggestions')}</button>
                    <button class="btn btn-secondary" style="white-space:nowrap;color:#ef4444;border-color:rgba(239,68,68,0.4);" onclick="window.BudgetsView.showBulkDeleteModal()" data-i18n="budget_btn_bulk_delete">${window.i18n.t('budget_btn_bulk_delete') || '🗑️ Nettoyer'}</button>
                    <button class="btn btn-primary" style="white-space:nowrap;" onclick="window.BudgetsView.showAddForm()" data-i18n="budget_btn_new">${window.i18n.t('budget_btn_new')}</button>
                </div>
            </div>

            <!-- Modal Sélection préalable de la période d'analyse IA -->
            <div id="aiWindowSelectionModal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(15,23,42,0.85);backdrop-filter:blur(6px);z-index:9999;align-items:center;justify-content:center;padding:20px;">
                <div style="background:var(--bg-surface);border:1px solid var(--accent);border-radius:16px;max-width:540px;width:100%;padding:24px;box-shadow:0 20px 40px rgba(0,0,0,0.5);display:flex;flex-direction:column;gap:18px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-color);padding-bottom:12px;">
                        <h3 style="margin:0;font-size:16px;color:var(--text-main);display:flex;align-items:center;gap:8px;">
                            <span>🔮</span> <span data-i18n="ai_modal_window_title">${window.i18n.t('ai_modal_window_title') || '🔮 Suggestions Budgétaires par l\'IA'}</span>
                        </h3>
                        <button class="btn btn-secondary" onclick="window.BudgetsView.closeAiWindowModal()" style="padding:4px 10px;font-size:12px;">✕</button>
                    </div>

                    <p style="font-size:13px;color:var(--text-muted);margin:0;" data-i18n="ai_modal_window_subtitle">
                        ${window.i18n.t('ai_modal_window_subtitle') || 'Choisissez la période d\'historique bancaire à analyser pour calculer vos enveloppes :'}
                    </p>

                    <div style="display:flex;flex-direction:column;gap:10px;">
                        <label style="display:flex;align-items:flex-start;gap:12px;background:var(--bg-base);border:2px solid var(--accent);padding:12px 16px;border-radius:10px;cursor:pointer;transition:all 0.2s ease;" onclick="window.BudgetsView.selectModalAiWindow(3, this)">
                            <input type="radio" name="modalAiWindowOption" value="3" checked style="margin-top:3px;accent-color:var(--accent);">
                            <div style="display:flex;flex-direction:column;gap:2px;">
                                <strong style="font-size:13px;color:var(--text-main);" data-i18n="ai_modal_win_3m_title">${window.i18n.t('ai_modal_win_3m_title') || '3 Mois (Recommandé)'}</strong>
                                <span style="font-size:11px;color:var(--text-muted);" data-i18n="ai_modal_win_3m_desc">${window.i18n.t('ai_modal_win_3m_desc') || 'Idéal pour s\'adapter à vos habitudes de dépense récentes.'}</span>
                            </div>
                        </label>

                        <label style="display:flex;align-items:flex-start;gap:12px;background:var(--bg-base);border:1px solid var(--border-color);padding:12px 16px;border-radius:10px;cursor:pointer;transition:all 0.2s ease;" onclick="window.BudgetsView.selectModalAiWindow(6, this)">
                            <input type="radio" name="modalAiWindowOption" value="6" style="margin-top:3px;accent-color:var(--accent);">
                            <div style="display:flex;flex-direction:column;gap:2px;">
                                <strong style="font-size:13px;color:var(--text-main);" data-i18n="ai_modal_win_6m_title">${window.i18n.t('ai_modal_win_6m_title') || '6 Mois (Lissage moyen)'}</strong>
                                <span style="font-size:11px;color:var(--text-muted);" data-i18n="ai_modal_win_6m_desc">${window.i18n.t('ai_modal_win_6m_desc') || 'Parfait pour lisser les dépenses saisonnières et semi-annuelles.'}</span>
                            </div>
                        </label>

                        <label style="display:flex;align-items:flex-start;gap:12px;background:var(--bg-base);border:1px solid var(--border-color);padding:12px 16px;border-radius:10px;cursor:pointer;transition:all 0.2s ease;" onclick="window.BudgetsView.selectModalAiWindow(12, this)">
                            <input type="radio" name="modalAiWindowOption" value="12" style="margin-top:3px;accent-color:var(--accent);">
                            <div style="display:flex;flex-direction:column;gap:2px;">
                                <strong style="font-size:13px;color:var(--text-main);" data-i18n="ai_modal_win_12m_title">${window.i18n.t('ai_modal_win_12m_title') || '12 Mois (Vue annuelle complète)'}</strong>
                                <span style="font-size:11px;color:var(--text-muted);" data-i18n="ai_modal_win_12m_desc">${window.i18n.t('ai_modal_win_12m_desc') || 'Capturer l\'ensemble des charges annuelles, abonnements et impôts.'}</span>
                            </div>
                        </label>
                    </div>

                    <div style="display:flex;justify-content:flex-end;gap:10px;padding-top:10px;border-top:1px solid var(--border-color);">
                        <button class="btn btn-secondary" onclick="window.BudgetsView.closeAiWindowModal()">${window.i18n.t('budget_bulk_delete_cancel') || 'Annuler'}</button>
                        <button class="btn btn-primary" onclick="window.BudgetsView.confirmAiWindowSelection()" style="background:var(--accent);font-weight:700;padding:8px 18px;" data-i18n="ai_modal_btn_start">${window.i18n.t('ai_modal_btn_start') || '🚀 Lancer l\'analyse IA'}</button>
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
                    </div>

                    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
                        <span style="font-size:11px;color:var(--text-muted);font-weight:600;" data-i18n="ai_budget_select_label">${window.i18n.t('ai_budget_select_label') || 'Sélection :'}</span>
                        <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.BudgetsView.toggleAllAiProposals(true)" data-i18n="ai_budget_select_all">${window.i18n.t('ai_budget_select_all') || 'Tout cocher'}</button>
                        <button class="btn btn-secondary" style="padding:3px 8px;font-size:11px;" onclick="window.BudgetsView.toggleAllAiProposals(false)" data-i18n="ai_budget_deselect_all">${window.i18n.t('ai_budget_deselect_all') || 'Tout décocher'}</button>
                        <div style="height:16px;width:1px;background:var(--border-color);margin:0 4px;"></div>
                        <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px;" onclick="window.BudgetsView.closeAiPanel()" data-i18n="budget_ai_close">✕ Fermer</button>
                    </div>
                </div>

                <!-- Impact Simulator Box (2 Distinct Separate Progress Bars) -->
                <div id="aiImpactSimulator" style="background:var(--bg-base);border:1px solid var(--border-color);border-radius:10px;padding:14px 16px;margin-bottom:14px;display:flex;flex-direction:column;gap:14px;">
                    
                    <!-- Header: Title + Salary input + Selected count -->
                    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
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

                    <!-- BARRE 1 : Capacité vs Revenu -->
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;flex-wrap:wrap;gap:6px;">
                            <span style="font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:4px;">
                                💼 <span data-i18n="ai_sim_gauge_capacity_income">${window.i18n.t('ai_sim_gauge_capacity_income') || 'Capacité vs Revenus'}</span>
                            </span>
                            <div style="display:flex;gap:12px;font-size:11px;color:var(--text-muted);align-items:center;flex-wrap:wrap;">
                                <span><span data-i18n="ai_sim_lbl_engaged">${window.i18n.t('ai_sim_lbl_engaged') || 'Actuel :'}</span> <strong id="aiSimCurrentVal" style="color:var(--text-main);">0,00 €/m</strong></span>
                                <span><span data-i18n="ai_sim_lbl_impact_val">${window.i18n.t('ai_sim_lbl_impact_val') || '+ Propositions :'}</span> <strong id="aiSimImpactVal" style="color:#3b82f6;">+0,00 €/m</strong></span>
                                <span style="background:var(--bg-base);padding:2px 8px;border-radius:6px;border:1px solid var(--border-color);display:inline-flex;align-items:center;gap:4px;">
                                    <strong id="aiSimPercentBadge" style="font-size:11px;font-weight:700;">Budget de 0,00 €/m (0%)</strong>
                                </span>
                            </div>
                        </div>
                        <div style="position:relative;margin-top:14px;margin-bottom:2px;">
                            <!-- Floating Salary Badge over marker line -->
                            <div id="aiSimSalaryMarkerBadge1" style="display:none;position:absolute;top:-18px;transform:translateX(-50%);background:#8b5cf6;color:#ffffff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;z-index:3;white-space:nowrap;box-shadow:0 2px 6px rgba(139,92,246,0.4);" title="${window.i18n.t('ai_sim_salary_marker_title') || 'Limite des revenus repère'}">
                                💼 <span id="aiSimSalaryMarkerVal1">2 400 €</span>
                            </div>
                            <div style="width:100%;height:8px;background:var(--border-color);border-radius:4px;overflow:hidden;position:relative;">
                                <div id="aiSimProgressBarCurrent" style="height:100%;background:var(--accent);width:0%;position:absolute;top:0;left:0;transition:width 0.3s ease;" title="Enveloppes mensuelles actuelles"></div>
                                <div id="aiSimProgressBarImpact" style="height:100%;background:#3b82f6;width:0%;position:absolute;top:0;left:0;opacity:0.8;transition:all 0.3s ease;" title="Nouveau budget proposé"></div>
                                <div id="aiSimSalaryMarker1" style="display:none;position:absolute;top:0;bottom:0;width:2px;background:#c084fc;z-index:2;box-shadow:0 0 4px #c084fc;" title="${window.i18n.t('ai_sim_salary_marker_title') || 'Limite des revenus repère'}"></div>
                            </div>
                        </div>
                    </div>

                    <!-- BARRE 2 : Couverture Dépenses Réelles -->
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px;flex-wrap:wrap;gap:6px;">
                            <span style="font-weight:700;color:var(--text-main);display:flex;align-items:center;gap:4px;">
                                📊 <span data-i18n="ai_sim_gauge_real_coverage">${window.i18n.t('ai_sim_gauge_real_coverage') || 'Couverture Dépenses Réelles'}</span>
                            </span>
                            <div style="display:flex;gap:12px;font-size:11px;color:var(--text-muted);align-items:center;flex-wrap:wrap;">
                                <span><span id="aiSimRealPaceLabel">${(window.i18n.t('ai_sim_lbl_real_pace') || 'Moyenne de dépenses ({months}m) :').replace('{months}', '3')}</span> <strong id="aiSimRealPaceVal" style="color:var(--text-main);">0,00 €/m</strong></span>
                                <span><span data-i18n="ai_sim_lbl_proposed">${window.i18n.t('ai_sim_lbl_proposed') || 'Budget proposé :'}</span> <strong id="aiSimProposedVal" style="color:#60a5fa;">0,00 €/m</strong></span>
                                <span style="background:var(--bg-base);padding:2px 8px;border-radius:6px;border:1px solid var(--border-color);">
                                    <strong id="aiSimGapVal" style="color:#36b37e;font-size:11px;">0,00 €/m</strong>
                                </span>
                            </div>
                        </div>
                        <div style="position:relative;margin-top:14px;margin-bottom:2px;">
                            <!-- Floating Salary Badge over marker line 2 -->
                            <div id="aiSimSalaryMarkerBadge2" style="display:none;position:absolute;top:-18px;transform:translateX(-50%);background:#8b5cf6;color:#ffffff;font-size:9px;font-weight:800;padding:1px 6px;border-radius:4px;z-index:3;white-space:nowrap;box-shadow:0 2px 6px rgba(139,92,246,0.4);" title="Limite du salaire repère">
                                💼 <span id="aiSimSalaryMarkerVal2">2 400 €</span>
                            </div>
                            <div style="width:100%;height:8px;background:var(--border-color);border-radius:4px;overflow:hidden;position:relative;">
                                <div id="aiSimProgressBarRealCovered" style="height:100%;background:#36b37e;width:0%;position:absolute;top:0;left:0;transition:all 0.3s ease;" title="Dépenses couvertes par le budget"></div>
                                <div id="aiSimProgressBarRealUncovered" style="height:100%;background:#ef4444;width:0%;position:absolute;top:0;left:0;opacity:0.9;transition:all 0.3s ease;" title="Dépenses non couvertes (dépassement)"></div>
                                <div id="aiSimSalaryMarker2" style="display:none;position:absolute;top:0;bottom:0;width:2px;background:#c084fc;z-index:2;box-shadow:0 0 4px #c084fc;" title="Limite Salaire Repère"></div>
                            </div>
                        </div>
                    </div>

                    <!-- CARDE 3 : Ajustement des montants proposée -->
                    <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:8px;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                        <div style="display:flex;align-items:center;gap:6px;">
                            <span style="font-size:12px;font-weight:700;color:var(--text-main);" data-i18n="ai_sim_lbl_adjust_proposals_title">${window.i18n.t('ai_sim_lbl_adjust_proposals_title') || '⚡ Modifier le montant des enveloppes pour les :'}</span>
                            <span title="${window.i18n.t('ai_sim_tt_adjust_help') || 'Ajustez globalement les montants des enveloppes d\'un seul clic ou calibrez-les sur vos dépenses et revenus.'}" style="cursor:help;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                        </div>
                        <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;">
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;" onclick="window.BudgetsView.adjustAiProposals(0.90)" title="${window.i18n.t('ai_sim_tt_frugal') || 'Réduit les propositions de 10% pour maximiser votre épargne mensuelle (Frugal)'}" data-i18n="ai_budget_strategy_frugal_clean">✂️ Réduire de 10%</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;" onclick="window.BudgetsView.adjustAiProposals(1.10)" title="${window.i18n.t('ai_sim_tt_prudent') || 'Ajoute 10% de marge de sécurité pour absorber les imprévus (Prudent)'}" data-i18n="ai_budget_strategy_prudent_clean">🛡️ Augmenter de 10%</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;" onclick="window.BudgetsView.alignAiProposalsToIncome()" title="${window.i18n.t('ai_sim_tt_income_aligned') || 'Ajuste les enveloppes pour que le budget total corresponde exactement à votre salaire repère'}" data-i18n="ai_budget_strategy_income_clean">⚖️ Aligner sur les revenus</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;color:#60a5fa;border-color:rgba(96,165,250,0.4);" onclick="window.BudgetsView.alignAiProposalsToCurrentMonth()" title="${window.i18n.t('ai_sim_tt_cur_month') || 'Ajuste chaque enveloppe exactement sur les dépenses constatées ce mois-ci'}" data-i18n="ai_budget_strategy_month_clean">📅 Aligner sur le mois</button>
                            <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;font-weight:600;color:#36b37e;border-color:rgba(54,179,126,0.4);" onclick="window.BudgetsView.alignAiProposalsToRealSpending()" title="${window.i18n.t('ai_sim_tt_avg_pace') || 'Ajuste chaque enveloppe sur la moyenne des dépenses constatées sur l\'historique'}" data-i18n="ai_budget_strategy_avg_clean">📊 Aligner sur la moyenne</button>
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

                        <!-- Parsing progress bar animation for step 4 -->
                        <div id="aiParsingProgressBarContainer" style="display:none;width:100%;max-width:320px;height:4px;background:var(--border-color);border-radius:2px;overflow:hidden;margin-top:6px;">
                            <div id="aiParsingProgressBar" style="width:0%;height:100%;background:linear-gradient(90deg, #8b5cf6, #3b82f6);transition:width 2s cubic-bezier(0.4, 0, 0.2, 1);border-radius:2px;"></div>
                        </div>

                        <button onclick="window.BudgetsView.cancelAiSuggestions()" class="btn btn-secondary" style="margin-top:8px;padding:4px 14px;font-size:12px;color:#ef4444;border-color:rgba(239,68,68,0.4);" data-i18n="ai_btn_stop">
                            ${window.i18n.t('ai_btn_stop') || "Arrêter l'analyse"}
                        </button>
                    </div>
                    <div id="budgetAiProposals" style="display:flex;flex-direction:column;gap:6px;"></div>

                    <!-- Sticky bottom bar: primary CTA always visible while scrolling -->
                    <div id="aiStickyBar" style="display:none;position:sticky;bottom:0;z-index:10;background:var(--bg-surface);border-top:1px solid var(--border-color);border-radius:0 0 10px 10px;padding:10px 14px;margin-top:12px;display:flex;justify-content:space-between;align-items:center;gap:10px;box-shadow:0 -4px 12px rgba(0,0,0,0.15);">
                        <span id="aiStickyCount" style="font-size:12px;color:var(--text-muted);font-weight:600;"></span>
                        <button class="btn btn-primary" style="padding:7px 20px;font-size:13px;font-weight:700;" onclick="window.BudgetsView.acceptSelectedProposals()" data-i18n="ai_budget_accept_selected">
                            ✨ ${window.i18n.t('ai_budget_accept_selected') || 'Créer les enveloppes sélectionnées'}
                        </button>
                    </div>
                </div>
                </div>
            </div>

            <!-- Status this month -->
            <div id="budgetStatusContainer" style="margin-bottom:30px;"></div>

            <!-- Budget config list (Merged into Status) -->

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

    async init() {
        const now = new Date();
        // Per-type date state from localStorage (or defaults)
        this.monthlyMonth = localStorage.getItem('budget_monthly_month') || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        this.yearlyYear = parseInt(localStorage.getItem('budget_yearly_year') || now.getFullYear());

        // Restore custom period state for monthly
        const savedEnabled = localStorage.getItem('budget_custom_enabled') === 'true';
        const savedStart = localStorage.getItem('budget_custom_start');
        const savedEnd   = localStorage.getItem('budget_custom_end');
        this.customPeriod = { enabled: savedEnabled, start: savedStart, end: savedEnd };

        // Default custom period dates if enabled but no dates saved
        if (savedEnabled && !savedStart) {
            const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0);
            const endDay = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
            this.customPeriod.start = firstDay;
            this.customPeriod.end = endDay;
        }

        // Per-type status data
        this.statusByType = { monthly: null, yearly: null, indefinite: null, custom: null };
        this.savingsOverflow = null; // Loaded from dashboard for overflow visual

        // Inject initial loading spinner while fetching all budgets/stats
        const container = document.getElementById('budgetStatusContainer');
        if (container) {
            container.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; gap:16px; color:var(--text-muted);">
                    <div style="width:40px; height:40px; border:3px solid rgba(99, 102, 241, 0.15); border-top-color:var(--accent); border-radius:50%; animation: importSpin 0.8s linear infinite;"></div>
                    <span style="font-size:14px; font-weight:600; color:var(--text-main); animation: importPulse 1.8s ease-in-out infinite;" data-i18n="budget_loading">${window.i18n.t('budget_loading') || 'Chargement des budgets...'}</span>
                </div>
            `;
        }

        await Promise.all([this.loadBudgets(), this.loadAccounts(), this.loadCategories(), this.loadAllStatuses(), this.checkAI(), this.loadSavingsOverflow()]);
        // Re-render after all data is loaded to ensure this.accounts is available for colored badges
        this.renderStatus();
        this.checkAiTaskStatusOnMount();
    },

    // ── Per-type navigation ────────────────────────────────────────────
    stepMonthly(delta) {
        const [y, m] = this.monthlyMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        this.monthlyMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        localStorage.setItem('budget_monthly_month', this.monthlyMonth);
        this.loadStatusForType('monthly');
    },

    goTodayMonthly() {
        const now = new Date();
        this.monthlyMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        localStorage.setItem('budget_monthly_month', this.monthlyMonth);
        // Reset custom period
        this.customPeriod.enabled = false;
        localStorage.setItem('budget_custom_enabled', 'false');
        this.loadStatusForType('monthly');
    },

    stepYearly(delta) {
        this.yearlyYear += delta;
        localStorage.setItem('budget_yearly_year', this.yearlyYear);
        this.loadStatusForType('yearly');
    },

    goTodayYearly() {
        this.yearlyYear = new Date().getFullYear();
        localStorage.setItem('budget_yearly_year', this.yearlyYear);
        this.loadStatusForType('yearly');
    },

    onCustomPeriodToggle(enabled) {
        this.customPeriod.enabled = enabled;
        localStorage.setItem('budget_custom_enabled', enabled);

        if (enabled && !this.customPeriod.start) {
            const now = new Date();
            const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0);
            const endDay = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
            this.customPeriod.start = firstDay;
            this.customPeriod.end = endDay;
            localStorage.setItem('budget_custom_start', firstDay);
            localStorage.setItem('budget_custom_end', endDay);
        }
        this.loadStatusForType('monthly');
    },

    onCustomPeriodChange() {
        const start = document.getElementById('budgetCustomStart')?.value || null;
        const end   = document.getElementById('budgetCustomEnd')?.value   || null;
        this.customPeriod.start = start;
        this.customPeriod.end = end;
        if (start) localStorage.setItem('budget_custom_start', start);
        if (end)   localStorage.setItem('budget_custom_end',   end);
        this.loadStatusForType('monthly');
    },


    async checkAI() {
        try {
            const config = await API.get('/api/config/');
            const aiEnabled = config.find(c => c.key === 'enable_ai')?.value;
            this.aiEnabled = aiEnabled === 'true';
            const btn = document.getElementById('budgetAiBtn');
            if (btn) btn.style.display = this.aiEnabled ? 'inline-flex' : 'none';
        } catch(e) {}
    },

    async loadBudgets() {
        this.budgets = await API.get('/api/budgets/');
        // config is now rendered inside renderStatus
    },

    async loadAccounts() {
        this.accounts = await API.get('/api/stats/accounts');
        this.renderAccountCheckboxes();
    },

    async loadCategories() {
        const accIds = this.getSelectedAccounts();
        if (accIds.length > 0 && window.app?.config?.enable_org_mode === 'true') {
            this.categories = await API.get(`/api/categories/by_accounts?account_ids=${accIds.join(',')}`);
        } else {
            this.categories = await API.get('/api/categories/');
        }
        this.catAverages = await API.get('/api/categories/averages').catch(() => ({}));
        this.renderCatCheckboxes(this.selectedCategories);
    },

    renderAccountCheckboxes(selected = []) {
        const container = document.getElementById('budgetAccountCheckboxes');
        if (!container || !this.accounts) return;

        container.innerHTML = this.accounts.filter(a => !a.is_closed).map(a => {
            const isSelected = selected.includes(a.id);
            const accColor = a.color || 'var(--accent)';
            const borderColor = isSelected ? accColor : 'var(--border-color)';
            return `
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;background:var(--bg-surface);padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid ${borderColor};transition:all 0.2s;">
                    <input type="checkbox" name="budgetAccount" value="${a.id}" data-color="${accColor}" ${isSelected ? 'checked' : ''} onchange="window.BudgetsView.onAccountChange(this)">
                    <span style="width:10px;height:10px;border-radius:50%;background:${accColor};flex-shrink:0;"></span>
                    <div style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
                        <span style="font-weight:${isSelected ? '600' : 'normal'};color:${isSelected ? accColor : 'inherit'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${a.name}">${a.name}</span>
                    </div>
                </label>
            `;
        }).join('');
    },

    getSelectedAccounts() {
        return [...document.querySelectorAll('input[name="budgetAccount"]:checked')].map(el => parseInt(el.value));
    },

    async onAccountChange(el) {
        if (el) {
            const accColor = el.dataset.color || 'var(--accent)';
            el.parentElement.style.borderColor = el.checked ? accColor : 'var(--border-color)';
            // Update label text color
            const nameSpan = el.parentElement.querySelector('div > span');
            if (nameSpan) {
                nameSpan.style.fontWeight = el.checked ? '600' : 'normal';
                nameSpan.style.color = el.checked ? accColor : 'inherit';
            }
        }
        // Refresh categories based on account selection
        await this.loadCategories();
    },

    renderCatCheckboxes(selected = []) {
        const container = document.getElementById('budgetCatCheckboxes');
        if (!container) return;

        const period = document.getElementById('newBudgetPeriod')?.value || 'monthly';
        const currentEditId = parseInt(document.getElementById('budgetEditId')?.value || 0);

        // Map categories to existing budgets to detect overlaps
        const catToBudget = {};
        if (this.budgets) {
            for (const b of this.budgets) {
                if (b.id === currentEditId) continue;
                for (const c of (b.categories || [])) {
                    if (!catToBudget[c]) catToBudget[c] = [];
                    catToBudget[c].push(b.name);
                }
            }
        }

        // Group categories by type
        const groups = {
            'expense_fixed': { title: window.app.getTypeLabel('expense_fixed'), cats: [] },
            'expense_var': { title: window.app.getTypeLabel('expense_var'), cats: [] },
            'income': { title: window.app.getTypeLabel('income'), cats: [] },
            'neutral': { title: window.app.getTypeLabel('neutral'), cats: [] },
            'other': { title: window.i18n.t('budget_cat_other'), cats: [] }
        };

        for (const c of this.categories) {
            if (groups[c.type]) groups[c.type].cats.push(c);
            else groups['other'].cats.push(c);
        }

        let html = '';
        const searchTerm = document.getElementById('budgetCatSearch')?.value || '';
        const cleanTerm = window.cleanStringForSearch(searchTerm);

        for (const key of ['expense_fixed', 'expense_var', 'income', 'neutral', 'other']) {
            const visibleCats = cleanTerm
                ? groups[key].cats.filter(c => window.cleanStringForSearch(c.name).includes(cleanTerm))
                : groups[key].cats;
            if (visibleCats.length === 0) continue;

            
            html += `<div style="margin-bottom:12px;">
                <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;border-bottom:1px solid var(--border-color);padding-bottom:4px;">
                    ${groups[key].title}
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:6px;">`;
                
            for (const c of visibleCats) {
                const isSelected = selected.includes(c.name);
                const overlap = catToBudget[c.name] ? catToBudget[c.name].join(', ') : null;
                
                let avgValue = 0;
                let avgLabel = '';
                const catAvg = this.catAverages[c.name];
                
                if (catAvg) {
                    if (period === 'monthly' || period === 'indefinite') {
                        avgValue = catAvg.yearly_average; // Use the 12-month smoothed monthly average
                        avgLabel = window.i18n.t('budget_cat_this_month');
                    } else if (period === 'yearly') {
                        avgValue = catAvg.yearly_average * 12; // Revert to total annual average
                        avgLabel = window.i18n.t('budget_cat_per_year');
                    }
                }
                
                const avgText = avgValue > 0 ? `<span style="font-size:10px;color:var(--text-muted);background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:4px;">~${formatCurrency(avgValue)} ${avgLabel}</span>` : '';
                const overlapText = overlap ? `<span style="font-size:10px;color:#f59e0b;background:rgba(245,158,11,0.15);padding:1px 4px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${window.i18n.t('budget_cat_used_in')}: ${overlap}">⚠️ ${overlap}</span>` : '';

                html += `
                    <label style="display:flex;align-items:center;gap:6px;font-size:12px;background:var(--bg-surface);padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'};transition:all 0.2s;">
                        <input type="checkbox" name="budgetCat" value="${c.name}" ${isSelected ? 'checked' : ''} onchange="window.BudgetsView.toggleCategorySelection(this)">
                        <div style="display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1;">
                            <span style="font-weight:${isSelected ? '600' : 'normal'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${c.name}">${c.name}</span>
                            <div style="display:flex;gap:4px;">
                                ${avgText}
                                ${overlapText}
                            </div>
                        </div>
                    </label>
                `;
            }
            html += `</div></div>`;
        }
        
        container.innerHTML = html;
    },

    getSelectedCats() {
        return [...document.querySelectorAll('input[name="budgetCat"]:checked')].map(el => el.value);
    },

    toggleCategorySelection(el) {
        el.parentElement.style.borderColor = el.checked ? 'var(--accent)' : 'var(--border-color)';
        const textSpan = el.parentElement.querySelector('span');
        if (textSpan) {
            textSpan.style.fontWeight = el.checked ? '600' : 'normal';
        }
        const catName = el.value;
        if (el.checked) {
            if (!this.selectedCategories.includes(catName)) {
                this.selectedCategories.push(catName);
            }
        } else {
            this.selectedCategories = this.selectedCategories.filter(c => c !== catName);
        }
    },

    onPeriodChange() {
        const period = document.getElementById('newBudgetPeriod')?.value;
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = period === 'custom' ? 'block' : 'none';
        this.renderCatCheckboxes(this.selectedCategories);
    },

    toggleType() {
        const isProject = document.getElementById('budgetTypeProject')?.checked;
        const isSavings = document.getElementById('budgetTypeSavings')?.checked;
        const catSection = document.getElementById('budgetCatSection');
        const periodRow = document.getElementById('newBudgetPeriod')?.closest('div');
        if (catSection) catSection.style.display = (isProject || isSavings) ? 'none' : 'block';
        // Hide period selector for savings (always indefinite)
        if (periodRow) periodRow.style.display = isSavings ? 'none' : '';
        if (isSavings) {
            document.getElementById('newBudgetPeriod').value = 'indefinite';
        }

        const tabCat = document.getElementById('tabLabelCat');
        const tabProj = document.getElementById('tabLabelProj');
        const tabSavings = document.getElementById('tabLabelSavings');
        const allTabs = [tabCat, tabProj, tabSavings].filter(Boolean);
        const activeTab = isSavings ? tabSavings : isProject ? tabProj : tabCat;
        for (const tab of allTabs) {
            if (tab === activeTab) {
                tab.style.background = 'var(--bg-surface)';
                tab.style.fontWeight = '700';
                tab.style.color = 'var(--accent)';
                tab.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
            } else {
                tab.style.background = 'transparent';
                tab.style.fontWeight = 'normal';
                tab.style.color = 'inherit';
                tab.style.boxShadow = 'none';
            }
        }
    },

    // ── API loading per type ────────────────────────────────────────────

    _buildStatusUrl(type) {
        let url = `/api/budgets/status?period_filter=${type}`;
        if (type === 'monthly') {
            if (this.customPeriod.enabled && this.customPeriod.start && this.customPeriod.end) {
                url += `&date_start=${this.customPeriod.start}&date_end=${this.customPeriod.end}`;
            } else {
                const [y, m] = this.monthlyMonth.split('-');
                url += `&year=${y}&month=${m}`;
            }
        } else if (type === 'yearly') {
            url += `&year=${this.yearlyYear}`;
        }
        // indefinite and custom: no date params needed
        return url;
    },

    async loadAllStatuses() {
        try {
            const [monthly, yearly, indefinite, custom, capacity] = await Promise.all([
                API.get(this._buildStatusUrl('monthly')),
                API.get(this._buildStatusUrl('yearly')),
                API.get(this._buildStatusUrl('indefinite')),
                API.get(this._buildStatusUrl('custom')),
                API.get('/api/budgets/capacity'),
            ]);
            this.statusByType = { monthly, yearly, indefinite, custom };
            this.capacityData = capacity;
            this._mergeStatusData();
            this.renderStatus();
        } catch(e) {
            document.getElementById('budgetStatusContainer').innerHTML =
                `<p style="color:#ff5630;">${window.i18n.t('title_error')} : ${e.message}</p>`;
        }
    },

    async loadStatusForType(type) {
        try {
            const [status, capacity] = await Promise.all([
                API.get(this._buildStatusUrl(type)),
                API.get('/api/budgets/capacity')
            ]);
            this.statusByType[type] = status;
            this.capacityData = capacity;
            this._mergeStatusData();
            this.renderStatus();
        } catch(e) {
            console.error(`[budget] Error loading ${type}`, e);
        }
    },

    _mergeStatusData() {
        // Merge all per-type results into a single statusData for backward compat
        const allBudgets = [];
        for (const type of ['monthly', 'yearly', 'indefinite', 'custom']) {
            const data = this.statusByType[type];
            if (data?.budgets) allBudgets.push(...data.budgets);
        }
        this.statusData = { budgets: allBudgets };
    },

    // Keep old loadStatus as alias for full reload
    async loadStatus() {
        await Promise.all([
            this.loadAllStatuses(),
            this.loadSavingsOverflow()
        ]);
    },

    async loadSavingsOverflow() {
        try {
            const dash = await API.get('/api/stats/dashboard');
            this.savingsOverflow = dash.savings_overflow || null;
        } catch(e) {
            console.warn('[budget] Could not load savings overflow data', e);
            this.savingsOverflow = null;
        }
    },

    toggleCapacityPanel(checked) {
        localStorage.setItem('show_budget_capacity_panel', checked ? 'true' : 'false');
        this.renderStatus();
    },

    _buildAccountSelect(selectId, hostedPerAccount) {
        const activeAccounts = this.accounts ? this.accounts.filter(a => !a.is_closed) : [];
        
        // Find main checking account (type == 'Compte courant' or fallback to first)
        const mainAccount = activeAccounts.find(a => a.type === 'Compte courant' || a.is_main) || (activeAccounts.length > 0 ? activeAccounts[0] : null);
        const secondaryAccounts = mainAccount ? activeAccounts.filter(a => a.id !== mainAccount.id) : activeAccounts;

        // Calculate hosted total for main account ('main' key or mainAccount.id key)
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

        const showCapacity = localStorage.getItem('show_budget_capacity_panel') !== 'false';
        const panelHelpText = window.i18n.t('budget_capacity_tooltip') || "À quoi sert ce panneau ?\nLa capacité budgétaire compare l'ensemble de vos enveloppes à vos recettes/revenus. C'est un outil prédictif basé sur le passé à titre indicatif.";

        const toggleHeaderHtml = `
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px; padding-bottom:8px; border-bottom:1px solid var(--border-color);">
                <label style="display:inline-flex; align-items:center; gap:10px; cursor:pointer; user-select:none;">
                    <span class="toggle-switch" style="flex-shrink:0;">
                        <input type="checkbox" id="toggleCapacityPanel" ${showCapacity ? 'checked' : ''} onchange="window.BudgetsView.toggleCapacityPanel(this.checked)">
                        <span class="slider"></span>
                    </span>
                    <strong style="font-size:13px; color:var(--text-main); font-weight:600;">${window.i18n.t('budget_capacity_panel_title') || 'Capacité budgétaire & Impact sur les comptes'}</strong>
                </label>
                <span title="${panelHelpText}" style="cursor:help; display:inline-flex; align-items:center; justify-content:center; width:14px; height:14px; border-radius:50%; border:1px solid var(--text-muted); color:var(--text-muted); font-size:10px; font-weight:bold; font-family:sans-serif; vertical-align:middle; line-height:1; user-select:none;">i</span>
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
            
            // Build account list HTML
            let accountsHtml = '';
            if (this.capacityData.accounts && this.capacityData.accounts.length > 0) {
                accountsHtml = `
                    <div style="margin-top:16px; border-top:1px solid var(--border-color); padding-top:12px;">
                        <strong style="font-size:11px; color:var(--text-muted); display:block; margin-bottom:8px; text-transform:uppercase; letter-spacing:0.05em;">${window.i18n.t('budget_accounts_impact') || 'Impact sur les comptes & livrets'}</strong>
                        <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(240px, 1fr)); gap:10px;">
                            ${this.capacityData.accounts.map(acc => {
                                const accColor = acc.color || 'var(--accent)';
                                const hasSavings = acc.savings_allocated > 0;
                                return `
                                    <div style="background:var(--bg-base); border:1px solid var(--border-color); border-radius:8px; padding:10px; display:flex; flex-direction:column; gap:4px;">
                                        <div style="display:flex; align-items:center; gap:6px; font-weight:600; font-size:12px;">
                                            <span style="width:8px;height:8px;border-radius:50%;background:${accColor};"></span>
                                            <span>${acc.name}</span>
                                        </div>
                                        <div style="display:flex; justify-content:space-between; font-size:11px; margin-top:2px;">
                                            <span style="color:var(--text-muted);">${window.i18n.t('budget_real_balance') || 'Solde réel'}</span>
                                            <span class="privacy-blur" style="font-weight:600;">${formatCurrency(acc.real_balance)}</span>
                                        </div>
                                        ${hasSavings ? `
                                        <div style="display:flex; justify-content:space-between; font-size:11px; color:#f59e0b;">
                                            <span>${window.i18n.t('budget_savings_reserved') || 'Épargne réservée'}</span>
                                            <span class="privacy-blur">- ${formatCurrency(acc.savings_allocated)}</span>
                                        </div>
                                        ` : ''}
                                        <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; border-top:1px dashed var(--border-color); padding-top:4px; margin-top:2px;">
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

            const lang = window.i18n.currentLang || 'fr';
            const monthlyDetails = (lang === 'en' ? this.capacityData.monthly.details_en : this.capacityData.monthly.details_fr) || '';
            const yearlyDetails = (lang === 'en' ? this.capacityData.yearly.details_en : this.capacityData.yearly.details_fr) || '';

            const monthlyBudgetedDetails = (lang === 'en' ? this.capacityData.monthly.budgeted_details_en : this.capacityData.monthly.budgeted_details_fr) || '';
            const yearlyBudgetedDetails = (lang === 'en' ? this.capacityData.yearly.budgeted_details_en : this.capacityData.yearly.budgeted_details_fr) || '';

            const monthlyInfoIcon = monthlyDetails ? `<span title="${monthlyDetails}" style="cursor:help; margin-left:4px; display:inline-flex; align-items:center; justify-content:center; width:13px; height:13px; border-radius:50%; border:1px solid var(--text-muted); color:var(--text-muted); font-size:9px; font-weight:bold; font-family:sans-serif; vertical-align:middle; line-height:1; user-select:none;">i</span>` : '';
            const yearlyInfoIcon = yearlyDetails ? `<span title="${yearlyDetails}" style="cursor:help; margin-left:4px; display:inline-flex; align-items:center; justify-content:center; width:13px; height:13px; border-radius:50%; border:1px solid var(--text-muted); color:var(--text-muted); font-size:9px; font-weight:bold; font-family:sans-serif; vertical-align:middle; line-height:1; user-select:none;">i</span>` : '';

            const monthlyBudgetedInfoIcon = monthlyBudgetedDetails ? `<span title="${monthlyBudgetedDetails}" style="cursor:help; margin-left:4px; display:inline-flex; align-items:center; justify-content:center; width:13px; height:13px; border-radius:50%; border:1px solid var(--text-muted); color:var(--text-muted); font-size:9px; font-weight:bold; font-family:sans-serif; vertical-align:middle; line-height:1; user-select:none;">i</span>` : '';
            const yearlyBudgetedInfoIcon = yearlyBudgetedDetails ? `<span title="${yearlyBudgetedDetails}" style="cursor:help; margin-left:4px; display:inline-flex; align-items:center; justify-content:center; width:13px; height:13px; border-radius:50%; border:1px solid var(--text-muted); color:var(--text-muted); font-size:9px; font-weight:bold; font-family:sans-serif; vertical-align:middle; line-height:1; user-select:none;">i</span>` : '';

            capacityHtml = `
                <div class="capacity-panel" style="background:var(--bg-surface); border:1px solid var(--border-color); border-radius:12px; padding:18px; margin-bottom:24px; box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:18px;">
                        <!-- Monthly capacity -->
                        <div>
                            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
                                <span>${window.i18n.t('budget_capacity_monthly') || 'Capacité mensuelle'}</span>
                                <span style="color:${monthlyColor};">${monthlyRatio}%</span>
                            </div>
                            <div style="background:rgba(128,128,128,0.15); border-radius:999px; height:8px; overflow:hidden; margin-bottom:6px;">
                                <div style="width:${Math.min(monthlyRatio, 100)}%; height:100%; background:${monthlyColor}; border-radius:999px;"></div>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted);">
                                <span>${monthlyLabel} : <span class="privacy-blur" style="font-weight:600;color:var(--text-base);">${formatCurrency(this.capacityData.monthly.budgeted)}</span>${monthlyBudgetedInfoIcon}</span>
                                <span>${incomeLabel} : <span class="privacy-blur" style="font-weight:600;color:var(--text-base);">${formatCurrency(this.capacityData.monthly.average_income)}</span>${monthlyInfoIcon}</span>
                            </div>
                        </div>
                        
                        <!-- Yearly capacity -->
                        <div>
                            <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:600; margin-bottom:6px;">
                                <span>${window.i18n.t('budget_capacity_yearly') || 'Capacité annuelle'}</span>
                                <span style="color:${yearlyColor};">${yearlyRatio}%</span>
                            </div>
                            <div style="background:rgba(128,128,128,0.15); border-radius:999px; height:8px; overflow:hidden; margin-bottom:6px;">
                                <div style="width:${Math.min(yearlyRatio, 100)}%; height:100%; background:${yearlyColor}; border-radius:999px;"></div>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-muted);">
                                <span>${yearlyLabel} : <span class="privacy-blur" style="font-weight:600;color:var(--text-base);">${formatCurrency(this.capacityData.yearly.budgeted)}</span>${yearlyBudgetedInfoIcon}</span>
                                <span>${incomeLabel} : <span class="privacy-blur" style="font-weight:600;color:var(--text-base);">${formatCurrency(this.capacityData.yearly.average_income)}</span>${yearlyInfoIcon}</span>
                            </div>
                        </div>
                    </div>
                    ${accountsHtml}
                </div>
            `;
        }

        // Per-type label and date params
        const [my, mm] = this.monthlyMonth.split('-').map(Number);
        const monthLabel = new Date(my, mm-1, 1).toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', {month:'long', year:'numeric'});
        const yearLabel = String(this.yearlyYear);

        // Group budgets by period
        const groups = {
            'monthly': { title: window.i18n.t('period_monthly'), budgets: [], label: monthLabel, y: my, m: mm },
            'yearly': { title: window.i18n.t('period_yearly'), budgets: [], label: yearLabel, y: this.yearlyYear, m: 1 },
            'indefinite': { title: window.i18n.t('budget_period_indefinite'), budgets: [], label: '', y: my, m: mm },
            'custom': { title: window.i18n.t('budget_period_custom') || 'Time-bound', budgets: [], label: '', y: my, m: mm }
        };

        for (const b of this.statusData.budgets) {
            if (groups[b.period]) {
                groups[b.period].budgets.push(b);
            } else {
                groups['monthly'].budgets.push(b);
            }
        }

        let fullHtml = toggleHeaderHtml + capacityHtml;

        // ── Filter Bar Pills ──────────────────────────────────────────────
        const activeFilter = this.currentGridFilter || 'all';
        const filterBarHtml = `
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:20px;flex-wrap:wrap;background:var(--bg-surface);padding:10px 14px;border-radius:10px;border:1px solid var(--border-color);">
                <span style="font-size:12px;color:var(--text-muted);font-weight:600;margin-right:4px;">Filtrer :</span>
                <button class="btn btn-secondary ${activeFilter === 'all' ? 'active' : ''}" style="padding:4px 12px;font-size:12px;${activeFilter === 'all' ? 'background:var(--accent);color:white;border-color:var(--accent);' : ''}" onclick="window.BudgetsView.setGridFilter('all')" data-i18n="budget_filter_all">${window.i18n.t('budget_filter_all') || 'Toutes'}</button>
                <button class="btn btn-secondary ${activeFilter === 'spending' ? 'active' : ''}" style="padding:4px 12px;font-size:12px;${activeFilter === 'spending' ? 'background:var(--accent);color:white;border-color:var(--accent);' : ''}" onclick="window.BudgetsView.setGridFilter('spending')" data-i18n="budget_filter_spending">${window.i18n.t('budget_filter_spending') || 'Mensuelles'}</button>
                <button class="btn btn-secondary ${activeFilter === 'yearly' ? 'active' : ''}" style="padding:4px 12px;font-size:12px;${activeFilter === 'yearly' ? 'background:var(--accent);color:white;border-color:var(--accent);' : ''}" onclick="window.BudgetsView.setGridFilter('yearly')" data-i18n="budget_filter_yearly">${window.i18n.t('budget_filter_yearly') || 'Annuelles'}</button>
                <button class="btn btn-secondary ${activeFilter === 'project' ? 'active' : ''}" style="padding:4px 12px;font-size:12px;${activeFilter === 'project' ? 'background:var(--accent);color:white;border-color:var(--accent);' : ''}" onclick="window.BudgetsView.setGridFilter('project')" data-i18n="budget_filter_project">${window.i18n.t('budget_filter_project') || 'Projets'}</button>
                <button class="btn btn-secondary ${activeFilter === 'savings' ? 'active' : ''}" style="padding:4px 12px;font-size:12px;${activeFilter === 'savings' ? 'background:var(--accent);color:white;border-color:var(--accent);' : ''}" onclick="window.BudgetsView.setGridFilter('savings')" data-i18n="budget_filter_savings">${window.i18n.t('budget_filter_savings') || 'Épargne'}</button>
                <button class="btn btn-secondary ${activeFilter === 'overspent' ? 'active' : ''}" style="padding:4px 12px;font-size:12px;${activeFilter === 'overspent' ? 'background:#ef4444;color:white;border-color:#ef4444;' : 'color:#ef4444;border-color:rgba(239,68,68,0.4);'}" onclick="window.BudgetsView.setGridFilter('overspent')" data-i18n="budget_filter_overspent">${window.i18n.t('budget_filter_overspent') || '⚠️ En dépassement'}</button>
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

        // ── Helper: per-type date controls ─────────────────────────────────
        const renderDateControls = (period) => {
            if (period === 'monthly') {
                const customEnabled = this.customPeriod.enabled;
                const monthOpacity = customEnabled ? 'opacity:0.4;pointer-events:none;' : '';
                const customDisp = customEnabled ? 'display:flex;' : 'display:none;';
                return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:0;${monthOpacity}">
                        <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:6px 0 0 6px;border-right:none;" onclick="window.BudgetsView.stepMonthly(-1)">◀</button>
                        <input type="month" id="budgetMonthInput" class="inline-input" style="min-width:130px;border-radius:0;font-size:12px;padding:4px 6px;" value="${this.monthlyMonth}" onchange="window.BudgetsView.monthlyMonth=this.value;localStorage.setItem('budget_monthly_month',this.value);window.BudgetsView.loadStatusForType('monthly')">
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
            return ''; // indefinite & custom: no controls
        };

        // ── Helper: render a summary bar ──────────────────────────────────
        const renderSummaryBar = (titleText, subtitleText, budgetsList, accentColor) => {
            let totalTarget = 0, totalExpenses = 0, totalRecExpenses = 0, totalIncome = 0, totalSpent = 0, totalRecSpent = 0;
            for (const b of budgetsList) {
                totalTarget += b.budget_amount;
                totalExpenses += b.expenses || 0;
                totalRecExpenses += b.reconciled_expenses || 0;
                totalIncome += b.income || 0;
                totalSpent += b.spent;
                totalRecSpent += b.reconciled_spent || 0;
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

            return `<div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);${borderStyle}">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                    <div>
                        <h4 style="margin:0 0 4px;font-size:14px;color:var(--text-color);">${titleText}</h4>
                        <span style="font-size:12px;color:var(--text-muted);">${subtitleText}</span>
                    </div>
                    <div style="text-align:right;">
                        <strong class="privacy-blur" style="font-size:18px;color:var(--text-color);">${formatCurrency(totalTarget)}</strong><span style="font-size:12px;color:var(--text-muted);"> ${window.i18n.t('budget_budgeted')}</span>
                    </div>
                </div>
                <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:12px;overflow:hidden;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05);">
                    <div style="position:absolute;top:0;left:0;width:${totalPct}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;transition:width 0.3s;"></div>
                    <div style="position:absolute;top:0;left:0;width:${recPct}%;height:100%;background:${totalBarColor};border-radius:999px;transition:width 0.3s;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;flex-wrap:wrap;gap:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <span class="privacy-blur" style="color:${totalBarColor};font-weight:600;">${formatCurrency(totalRecExpenses)} ${window.i18n.t('budget_reconciled')}</span>
                        <span class="privacy-blur" style="color:var(--text-muted);font-size:12px;align-self:flex-end;">(${formatCurrency(totalExpenses)} ${window.i18n.t('budget_committed')})</span>
                        ${incomeHtml}
                    </div>
                    <span style="color:${globalOver ? '#ff5630' : 'var(--text-muted)'};font-weight:600;">${globalOver ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(globalRemaining))}</span> ${globalOver ? window.i18n.t('budget_global_exceeded') : window.i18n.t('budget_global_remaining')}</span>
                </div>
            </div>`;
        };

        // ── Helper: render a single budget card ──────────────────────────
        const renderBudgetCard = (b, y, m) => {
            const effectiveBudget = b.budget_amount + (b.income || 0);
            const expensesPct = effectiveBudget > 0 ? Math.min(((b.expenses || 0) / effectiveBudget) * 100 || 0, 100) : 0;
            const recExpPct = effectiveBudget > 0 ? Math.min(((b.reconciled_expenses || 0) / effectiveBudget) * 100 || 0, 100) : 0;
            const barColor = (effectiveBudget > 0 && ((b.reconciled_expenses || 0) / effectiveBudget) * 100 > 100) ? '#ff5630' : recExpPct >= 80 ? '#f59e0b' : '#10b981';
            const overBudget = b.remaining < 0;
            const typeTag = b.is_project
                ? `<span style="background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">${window.i18n.t('budget_project_tag')}</span>`
                : '';
            const catTags = (b.categories || []).map(c =>
                `<span style="background:var(--bg-base);padding:2px 6px;border-radius:4px;font-size:10px;color:var(--text-muted);">${c}</span>`
            ).join(' ');

            const incomeHtml = b.income > 0
                ? `<div style="font-size:11px;color:#10b981;margin-top:3px;">↑ <span class="privacy-blur">${formatCurrency(b.income)}</span> ${window.i18n.t('budget_received')}</div>`
                : '';

            const safeName = b.name.replace(/'/g, "\\'");
            const periodLabel = b.period === 'monthly' ? window.i18n.t('period_monthly') : b.period === 'yearly' ? window.i18n.t('period_yearly') : b.period === 'custom' ? `${window.i18n.t('budget_period_custom') || 'Time-bound'} (${b.start_date || '?'} → ${b.end_date || '?'})` : window.i18n.t('period_undefined');
            const closedStyle = b.is_closed ? 'opacity:0.6;' : '';
            const closedTag = b.is_closed
                ? `<span style="background:rgba(239,68,68,0.15);color:#ff5630;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px;">${window.i18n.t('budget_closed_tag')}</span>`
                : '';

            // Improvement_04: Account badges
            let accountBadges = '';
            if (b.account_ids && b.account_ids.length > 0 && window.app?.config?.enable_org_mode === 'true') {
                accountBadges = b.account_ids.map(aid => {
                    const acc = this.accounts?.find(a => a.id === aid);
                    if (!acc) return '';
                    const color = acc.color || 'var(--accent)';
                    return `<span style="background:${color}1a; color:${color}; border:1px solid ${color}33; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:600;">● ${acc.name}</span>`;
                }).join(' ');
            }

            const periodColors = {
                'monthly': '#3b82f6',
                'yearly': '#8b5cf6',
                'indefinite': '#14b8a6',
                'custom': '#ec4899'
            };
            const pColor = periodColors[b.period] || '#3b82f6';
            return `<div data-budget-id="${b.id}" onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})" class="budget-envelope-card ${overBudget ? 'over-budget' : ''}" style="${closedStyle}">\
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:8px;">
                        <div style="flex:1;">
                            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
                                <strong style="font-size:13px;">${b.name}</strong>
                                ${closedTag}
                                ${accountBadges}
                            </div>
                            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${typeTag}${catTags}</div>
                        </div>
                        <div style="display:flex;gap:4px;flex-shrink:0;" onclick="event.stopPropagation()">
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.editBudget(${b.id})" title=\"${window.i18n.t('tooltip_edit')}\">✏️</button>
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.toggleClose(${b.id})" title="${b.is_closed ? window.i18n.t('budget_reopen_action') : window.i18n.t('budget_close_action')}">${b.is_closed ? '🔓' : '🔒'}</button>
                            <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.deleteBudget(${b.id})" title=\"${window.i18n.t('tooltip_delete')}\">✕</button>
                        </div>
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11px;color:var(--text-muted);">
                        <span>${periodLabel}</span>
                        <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;">
                            <input type="number" class="inline-input" style="width:80px;text-align:right;padding:2px 6px;font-size:12px;border-radius:4px;" value="${b.budget_amount}" min="0" step="0.01" onchange="window.BudgetsView.updateAmount(${b.id}, this.value)"> €
                        </div>
                    </div>

                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:8px;overflow:hidden;margin-bottom:8px;border:1px solid rgba(255,255,255,0.05);">
                        <div style="position:absolute;top:0;left:0;width:${expensesPct}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;"></div>
                        <div style="position:absolute;top:0;left:0;width:${recExpPct}%;height:100%;background:${barColor};border-radius:999px;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;flex-wrap:wrap;gap:4px;">
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            <span class="privacy-blur" style="color:${barColor};font-weight:600;">${formatCurrency(b.reconciled_expenses || 0)} ${window.i18n.t('budget_reconciled')}</span>
                            <span class="privacy-blur" style="color:var(--text-muted);font-size:11px;align-self:flex-end;">(${formatCurrency(b.expenses || 0)} ${window.i18n.t('budget_committed')})</span>
                            ${incomeHtml}
                        </div>
                        <span style="color:${overBudget ? '#ff5630' : 'var(--text-muted)'}">${overBudget ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(b.remaining))}</span> ${overBudget ? window.i18n.t('budget_exceeded_label') : window.i18n.t('budget_remaining_label')}</span>
                    </div>
                </div>`;
        };

        // ── Helper: render a single savings (tirelire) card ──────────────
        const renderSavingsCard = (b, y, m) => {
            const balance = b.balance || 0;
            const goal = b.budget_amount || 0;
            const funded = b.funded || 0;
            const withdrawn = b.withdrawn || 0;

            // Calculate temporary withdrawal from savings overflow (proportional)
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
                ? `<span style="background:rgba(239,68,68,0.15);color:#ff5630;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px;">${window.i18n.t('budget_closed_tag')}</span>`
                : '';
            const typeTag = `<span style="background:rgba(245,158,11,0.15);color:#f59e0b;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">${window.i18n.t('budget_savings_tag')}</span>`;

            // Improvement_04: Account badges
            let accountBadges = '';
            if (b.account_ids && b.account_ids.length > 0 && window.app?.config?.enable_org_mode === 'true') {
                accountBadges = b.account_ids.map(aid => {
                    const acc = this.accounts?.find(a => a.id === aid);
                    if (!acc) return '';
                    const color = acc.color || 'var(--accent)';
                    return `<span style="background:${color}1a; color:${color}; border:1px solid ${color}33; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:600;">● ${acc.name}</span>`;
                }).join(' ');
            }

            const withdrawnHtml = withdrawn > 0
                ? `<span class="privacy-blur" style="color:#ff5630;font-size:11px;">↓ ${formatCurrency(withdrawn)} ${window.i18n.t('budget_savings_withdrawn')}</span>`
                : '';

            // Temporary withdrawal badge (overflow)
            const tempWithdrawnBadge = tempWithdrawn > 0
                ? `<span style="color:#ef4444; font-size:11px; font-weight:600; background:rgba(239,68,68,0.1); padding:2px 6px; border-radius:4px;" title="${window.i18n.t('savings_temp_withdrawn') || 'Temporarily withdrawn'}">⚠ -${formatCurrency(tempWithdrawn)}</span>`
                : '';

            return `<div data-budget-id="${b.id}" onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})" class="budget-envelope-card savings ${goalReached ? 'goal-reached' : ''}" style="${closedStyle}">\
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:8px;">
                        <div style="flex:1;">
                            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
                                <strong style="font-size:13px;">${b.name}</strong>
                                ${closedTag}
                                ${accountBadges}
                                ${tempWithdrawnBadge}
                            </div>
                            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${typeTag}</div>
                        </div>
                        <div style="display:flex;gap:4px;flex-shrink:0;" onclick="event.stopPropagation()">
                            ${!b.is_closed ? `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.showAllocationForm(${b.id})" title="${window.i18n.t('budget_savings_add_funds')}">➕</button>` : ''}
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.editBudget(${b.id})" title="${window.i18n.t('tooltip_edit')}">✏️</button>
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.${b.is_closed ? 'toggleClose' : 'breakPiggyBank'}(${b.id})" title="${b.is_closed ? window.i18n.t('budget_reopen_action') : window.i18n.t('budget_savings_break_action')}">${b.is_closed ? '🔓' : '🔨'}</button>
                            <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.deleteBudget(${b.id})" title="${window.i18n.t('tooltip_delete')}">✕</button>
                        </div>
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11px;color:var(--text-muted);">
                        <span>${window.i18n.t('budget_savings_goal')}</span>
                        <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;">
                            <input type="number" class="inline-input" style="width:80px;text-align:right;padding:2px 6px;font-size:12px;border-radius:4px;" value="${b.budget_amount}" min="0" step="0.01" onchange="window.BudgetsView.updateAmount(${b.id}, this.value)"> €
                        </div>
                    </div>

                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:8px;overflow:hidden;margin-bottom:8px;border:1px solid rgba(255,255,255,0.05);">
                        ${tempWithdrawn > 0 ? `<div style="position:absolute;top:0;left:0;width:${theoreticalPct}%;height:100%;background:${barColor};opacity:0.25;border-radius:999px;"></div>` : ''}
                        <div style="position:absolute;top:0;left:0;width:${pct}%;height:100%;background:${barColor};border-radius:999px;transition:width 0.5s ease;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;flex-wrap:wrap;gap:4px;">
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            <span class="privacy-blur" style="color:${barColor};font-weight:600;">↑ ${formatCurrency(funded)} ${window.i18n.t('budget_savings_funded')}</span>
                            ${withdrawnHtml}
                        </div>
                        <span style="color:${goalReached ? '#f59e0b' : 'var(--text-muted)'};font-weight:600;">${goalReached ? '🎯 ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(b.remaining || 0))}</span> ${goalReached ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                    </div>
                </div>`;
        };

        // ── Main rendering loop ──────────────────────────────────────────
        const isOrgMode = window.app?.config?.enable_org_mode === 'true';

        // Separate savings from spending budgets
        const savingsBudgets = [];
        for (const period of ['monthly', 'yearly', 'indefinite', 'custom']) {
            const group = groups[period];
            if (group.budgets.length === 0) continue;
            const y = group.y;
            const m = group.m;
            const label = group.label;

            // Separate savings from spending in this group
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

            let html = `<div data-budget-period="${period}" style="margin-bottom:40px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;border-bottom:2px solid ${pColor}80;padding-bottom:8px;">
                    <h3 style="margin:0;font-size:16px;color:var(--text-color);">${window.i18n.t('budget_envelopes_title')} — ${group.title}</h3>
                    ${renderDateControls(period)}
                </div>`;

            // Sub-group budgets by account scope (Org Mode) or keep flat
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
                    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:24px;">`;
                    for (const b of budgets) html += renderBudgetCard(b, y, m);
                    html += '</div></div>';
                }
            } else {
                html += `<div data-budget-period-sub="${period}-__global__">`;
                html += renderSummaryBar(`${window.i18n.t('budget_summary_global')} — ${group.title}`, label, spendingBudgets, null);
                html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">`;
                for (const b of spendingBudgets) html += renderBudgetCard(b, y, m);
                html += '</div></div>';
            }

            html += '</div>';
            fullHtml += html;
        }

        // ── Savings (Tirelire) section ───────────────────────────────────
        if (savingsBudgets.length > 0) {
            let savingsHtml = `<div data-budget-period="savings" style="margin-bottom:40px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;border-bottom:2px solid rgba(245,158,11,0.3);padding-bottom:8px;">
                    <h3 style="margin:0;font-size:16px;color:#f59e0b;">🏦 ${window.i18n.t('budget_savings_section')}</h3>
                </div>`;

            // Summary bar for savings — with overflow support
            const totalGoal = savingsBudgets.reduce((s, b) => s + (b.budget_amount || 0), 0);
            const totalBalance = savingsBudgets.reduce((s, b) => s + (b.balance || 0), 0);
            const overflow = this.savingsOverflow;
            const totalTempWithdrawn = overflow ? overflow.overflow_amount : 0;
            const effectiveTotalBalance = totalBalance - totalTempWithdrawn;
            const savingsPct = totalGoal > 0 ? Math.min(Math.max(effectiveTotalBalance / totalGoal, 0) * 100, 100) : 0;
            const theoreticalSavingsPct = totalGoal > 0 ? Math.min((totalBalance / totalGoal) * 100, 100) : 0;
            const savingsBarColor = theoreticalSavingsPct >= 100 ? '#f59e0b' : '#10b981';

            // Overflow warning badge for summary
            const overflowBadgeHtml = overflow
                ? `<span style="color:${overflow.fully_consumed ? '#ef4444' : '#f59e0b'}; font-size:12px; font-weight:600; background:${overflow.fully_consumed ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)'}; padding:3px 8px; border-radius:6px;">⚠ -${formatCurrency(totalTempWithdrawn)} ${window.i18n.t('savings_temp_withdrawn') || 'temporarily withdrawn'}</span>`
                : '';

            savingsHtml += `<div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);border-left:3px solid ${overflow ? (overflow.fully_consumed ? '#ef4444' : '#f59e0b') : '#f59e0b'};">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                    <div>
                        <h4 style="margin:0 0 4px;font-size:14px;color:var(--text-color);">🏦 ${window.i18n.t('budget_savings_summary')}</h4>
                        <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
                            <span style="font-size:12px;color:var(--text-muted);">${savingsBudgets.length} ${window.i18n.t('budget_savings_tag').toLowerCase()}${savingsBudgets.length > 1 ? 's' : ''}</span>
                            ${overflowBadgeHtml}
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <strong class="privacy-blur" style="font-size:18px;color:var(--text-color);">${formatCurrency(effectiveTotalBalance)}</strong><span style="font-size:12px;color:var(--text-muted);"> / ${formatCurrency(totalGoal)}</span>
                    </div>
                </div>
                <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:12px;overflow:hidden;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05);">
                    ${totalTempWithdrawn > 0 ? `<div style="position:absolute;top:0;left:0;width:${theoreticalSavingsPct}%;height:100%;background:${savingsBarColor};opacity:0.25;border-radius:999px;"></div>` : ''}
                    <div style="position:absolute;top:0;left:0;width:${savingsPct}%;height:100%;background:${savingsBarColor};border-radius:999px;transition:width 0.3s;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;">
                    <span class="privacy-blur" style="color:${savingsBarColor};font-weight:600;">${formatCurrency(effectiveTotalBalance)} ${window.i18n.t('budget_savings_funded')}</span>
                    <span style="color:var(--text-muted);font-weight:600;"><span class="privacy-blur">${formatCurrency(Math.abs(totalGoal - totalBalance))}</span> ${totalBalance >= totalGoal ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                </div>
            </div>`;

            savingsHtml += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">`;
            for (const b of savingsBudgets) savingsHtml += renderSavingsCard(b, b._y, b._m);
            savingsHtml += '</div></div>';
            fullHtml += savingsHtml;
        }

        let html = fullHtml;
        if (!hasBudgets) {
            html += `<p style="color:var(--text-muted);padding:10px 0;">${window.i18n.t('budget_no_active') || 'Aucune enveloppe budgétaire active.'}</p>`;
        }

        container.innerHTML = html;

        // Highlight a specific budget card if requested from another view
        if (this._pendingHighlightName) {
            const name = this._pendingHighlightName;
            this._pendingHighlightName = null;
            setTimeout(() => this._highlightByName(name), 100);
        }

        // Re-render active AI suggestions panel after language change or view refresh
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
                    // Clean up transition after animation completes
                    setTimeout(() => { card.style.transition = ''; }, 500);
                }, 4000);
                break;
            }
        }
    },

    async showDetail(budgetId, budgetName, year, month) {
        this._currentDetailYear = year;
        this._currentDetailMonth = month;
        const modal = document.getElementById('budgetUnifiedModal');
        const title = document.getElementById('budgetUnifiedTitle');
        const graph = document.getElementById('budgetDetailGraph');
        const list = document.getElementById('budgetDetailList');
        const editBtn = document.getElementById('budgetUnifiedEditBtn');
        const detailSec = document.getElementById('budgetDetailSection');
        const formSec = document.getElementById('budgetFormSection');
        
        if (!modal) return;

        title.textContent = `📊 ${budgetName}`;
        document.getElementById('budgetEditId').value = budgetId; // Store for edit
        editBtn.style.display = 'block';
        
        detailSec.style.display = 'block';
        formSec.style.display = 'none';
        
        graph.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">${window.i18n.t('budget_loading')}</p>`;
        list.innerHTML = '';
        modal.style.display = 'flex';

        try {
            const budget = this.statusData?.budgets.find(b => b.id === budgetId);
            const isSavings = (budget?.envelope_type || 'spending') === 'savings';
            const txs = await API.get(`/api/budgets/${budgetId}/transactions?year=${year}&month=${month}`);

            // ── Savings (Tirelire) detail ────────────────────────────────
            if (isSavings) {
                // Load allocations
                let allocs = [];
                try { allocs = await API.get(`/api/budgets/${budgetId}/allocations`); } catch(e) {}

                const funded = budget?.funded || 0;
                const withdrawn = budget?.withdrawn || 0;
                const balance = budget?.balance || 0;
                const goal = budget?.budget_amount || 0;

                // Calculate temporary withdrawal from savings overflow (proportional)
                const overflow = this.savingsOverflow;
                let tempWithdrawn = 0;
                if (overflow && overflow.total_savings > 0 && !budget?.is_closed) {
                    const proportion = balance / overflow.total_savings;
                    tempWithdrawn = Math.min(balance, overflow.overflow_amount * proportion);
                }

                const effectiveBalance = balance - tempWithdrawn;
                const pct = goal > 0 ? Math.min((effectiveBalance / goal) * 100, 100) : 0;
                const theoreticalPct = goal > 0 ? Math.min((balance / goal) * 100, 100) : 0;
                const goalReached = balance >= goal && goal > 0;
                const barColor = goalReached ? '#f59e0b' : '#10b981';

                const safeName = budgetName.replace(/'/g, "\\'");

                const hostedPerAccount = {};
                for (const a of allocs) {
                    const key = a.account_id || 'main';
                    hostedPerAccount[key] = (hostedPerAccount[key] || 0.0) + a.amount;
                }

                const accountSelectDetail = this._buildAccountSelect('detailAllocAccountId', hostedPerAccount);

                graph.innerHTML = `<div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px;">
                        <span>${window.i18n.t('budget_expenses')} · <span class="privacy-blur" style="font-weight:600;">${formatCurrency(goal)}</span> ${window.i18n.t('budget_savings_goal')}</span>
                        <span class="privacy-blur">
                            <span style="color:#10b981;font-weight:600;">↑ ${formatCurrency(funded)}</span> ${window.i18n.t('budget_savings_funded')}
                            ${withdrawn > 0 ? ` · <span style="color:#ff5630;font-weight:600;">↓ ${formatCurrency(withdrawn)}</span> ${window.i18n.t('budget_savings_withdrawn')}` : ''}
                        </span>
                    </div>
                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">
                        ${tempWithdrawn > 0 ? `<div style="position:absolute;top:0;left:0;width:${theoreticalPct}%;height:100%;background:${barColor};opacity:0.25;border-radius:999px;"></div>` : ''}
                        <div style="position:absolute;top:0;left:0;width:${pct}%;height:100%;background:${barColor};border-radius:999px;transition:width 0.5s ease;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;">
                        <span class="privacy-blur" style="color:${barColor};font-weight:600;">${formatCurrency(effectiveBalance)} ${window.i18n.t('budget_savings_balance')}</span>
                        <span style="color:${goalReached ? '#f59e0b' : 'var(--text-muted)'};font-weight:600;">${goalReached ? '🎯 ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(goal - balance))}</span> ${goalReached ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:10px;padding:12px;background:var(--bg-surface);border:1px solid rgba(245,158,11,0.3);border-radius:8px;margin-bottom:12px;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                        <input type="number" id="detailAllocAmount" class="inline-input" placeholder="${window.i18n.t('budget_savings_add_placeholder')}" step="0.01" style="width:110px;font-size:12px;padding:6px 10px;border-radius:6px;">
                        ${accountSelectDetail}
                        <input type="text" id="detailAllocNote" class="inline-input" placeholder="${window.i18n.t('budget_savings_note_placeholder')}" style="flex:1;min-width:140px;font-size:12px;padding:6px 10px;border-radius:6px;">
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
                        <button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocationFromDetail(${budgetId}, 1, '${safeName}', ${year}, ${month})">↑ ${window.i18n.t('budget_savings_deposit')}</button>
                        <button class="btn btn-secondary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocationFromDetail(${budgetId}, -1, '${safeName}', ${year}, ${month})">↓ ${window.i18n.t('budget_savings_withdrawal')}</button>
                    </div>
                </div>`;

                // Merge txs and allocs into a single list sorted by date
                const items = [];
                for (const tx of txs) {
                    items.push({
                        type: 'tx', date: tx.date, description: tx.description, amount: tx.amount,
                        isIncome: tx.is_income, category: tx.category, isReconciled: tx.is_reconciled
                    });
                }
                for (const a of allocs) {
                    const acc = this.accounts?.find(ac => ac.id === a.account_id);
                    const accLabel = acc ? ` <span style="font-size:10px;color:var(--accent);background:var(--bg-base);padding:1px 4px;border-radius:4px;margin-left:4px;">🏦 ${acc.name}</span>` : '';
                    items.push({
                        type: 'alloc', id: a.id, date: a.date, description: (a.note || (a.amount > 0 ? window.i18n.t('budget_savings_deposit') : window.i18n.t('budget_savings_withdrawal'))) + accLabel,
                        amount: Math.abs(a.amount), isIncome: a.amount > 0
                    });
                }
                items.sort((a, b) => b.date.localeCompare(a.date));

                if (items.length === 0) {
                    list.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">${window.i18n.t('budget_no_operations')}</p>`;
                } else {
                    list.innerHTML = `<h4 style="margin:0 0 10px;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">${window.i18n.tp('budget_operations_count', {count: items.length})}</h4>` +
                        items.map(it => `
                        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);flex-wrap:wrap;${it.isReconciled ? 'opacity:0.55;' : ''}">
                            <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${it.date}</span>
                            <span style="flex:1;font-size:12px;min-width:100px;">
                                ${it.type === 'alloc' ? '💰 ' : ''}${it.description}
                                ${it.isReconciled ? `<span style="font-size:10px;color:var(--text-muted);font-style:italic;margin-left:8px;">${window.i18n.t('budget_reconciled_label')}</span>` : ''}
                            </span>
                            ${it.category ? `<span style="background:var(--bg-base);padding:1px 5px;border-radius:4px;font-size:10px;color:var(--text-muted);">${it.category}</span>` : ''}
                            <span class="privacy-blur" style="font-size:13px;font-weight:600;color:${it.isIncome ? '#10b981' : '#ff5630'};white-space:nowrap;">
                                ${it.isIncome ? '↑ +' : '↓ -'}${formatCurrency(it.amount)}
                            </span>
                            ${it.type === 'alloc' ? `<button class="btn btn-secondary" style="padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();window.BudgetsView.deleteAllocation(${budgetId},${it.id},'${budgetName}',${year},${month})">✕</button>` : ''}
                        </div>`).join('');
                }
                return;
            }

            // ── Standard spending detail ─────────────────────────────────
            if (!txs.length) {
                graph.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">${window.i18n.t('budget_no_operations')}</p>`;
                return;
            }

            // ── Bar chart (CSS-based, no lib needed) ────────────────────────
            const expenses = txs.filter(t => !t.is_income);
            const incomes  = txs.filter(t =>  t.is_income);
            const totalExp = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
            const totalRecExp = expenses.filter(t => t.is_reconciled).reduce((s, t) => s + Math.abs(t.amount), 0);
            const totalInc = incomes.reduce((s,  t) => s + Math.abs(t.amount), 0);
            const target   = budget?.budget_amount || 0;
            const maxVal   = Math.max(totalExp, totalInc, target, 1);


            const pct = target > 0 ? (totalRecExp / target) * 100 : 0;
            const recExpColor = pct > 100 ? '#ff5630' : pct >= 80 ? '#f59e0b' : '#10b981';

            // Build sublabel with income offset mention
            let expSublabel = `${formatCurrency(totalRecExp)} ${window.i18n.t('budget_reconciled')} / ${formatCurrency(totalExp)} ${window.i18n.t('budget_committed')}`;
            if (totalInc > 0) {
                expSublabel += ` · ↑ ${formatCurrency(totalInc)} ${window.i18n.t('budget_received')}`;
            }

            const expW = Math.max(0, Math.min(totalExp / maxVal * 100, 100));
            const recW = Math.max(0, Math.min(totalRecExp / maxVal * 100, 100));

            graph.innerHTML = `<div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px;">
                        <span>${window.i18n.t('budget_expenses')} · <span class="privacy-blur" style="font-weight:600;">${formatCurrency(target)}</span> ${window.i18n.t('budget_objective')}</span><span class="privacy-blur">${expSublabel}</span>
                    </div>
                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">
                        <div style="position:absolute;top:0;left:0;width:${expW}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;"></div>
                        <div style="position:absolute;top:0;left:0;width:${recW}%;height:100%;background:${recExpColor};border-radius:999px;"></div>
                    </div>
                </div>`;

            // ── Transactions list ─────────────────────────────────────────
            list.innerHTML = `<h4 style="margin:0 0 10px;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">${window.i18n.tp('budget_operations_count', {count: txs.length})}</h4>` +
                txs.map(tx => `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);flex-wrap:wrap;${tx.is_reconciled ? 'opacity:0.55;' : ''}">
                    <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${tx.date}</span>
                    <span style="flex:1;font-size:12px;min-width:100px;">
                        ${tx.description}
                        ${tx.is_reconciled ? `<span style="font-size:10px;color:var(--text-muted);font-style:italic;margin-left:8px;">${window.i18n.t('budget_reconciled_label')}</span>` : ''}
                    </span>
                    ${tx.category ? `<span style="background:var(--bg-base);padding:1px 5px;border-radius:4px;font-size:10px;color:var(--text-muted);">${tx.category}</span>` : ''}
                    <span class="privacy-blur" style="font-size:13px;font-weight:600;color:${tx.is_income ? '#10b981' : '#ff5630'};white-space:nowrap;">
                        ${tx.is_income ? '+' : ''}${formatCurrency(tx.amount)}
                    </span>
                </div>`).join('');
        } catch(e) {
            graph.innerHTML = `<p style="color:#ff5630;">${window.i18n.t('title_error')} : ${e.message}</p>`;
        }
    },

    showAddForm() {
        document.getElementById('budgetUnifiedTitle').textContent = window.i18n.t('budget_new');
        document.getElementById('budgetUnifiedEditBtn').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        
        document.getElementById('budgetEditId').value = '';
        document.getElementById('newBudgetName').value = '';
        document.getElementById('newBudgetAmount').value = '';
        document.getElementById('newBudgetPeriod').value = 'monthly';
        document.getElementById('newBudgetStartDate').value = '';
        document.getElementById('newBudgetEndDate').value = '';
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = 'none';
        document.getElementById('budgetTypeCategory').checked = true;
        this.toggleType();
        this.renderAccountCheckboxes([]);
        
        // Reset category search and state
        const catSearch = document.getElementById('budgetCatSearch');
        if (catSearch) catSearch.value = '';
        this.selectedCategories = [];
        this.renderCatCheckboxes(this.selectedCategories);
        
        document.getElementById('budgetFormSection').style.display = 'block';
        document.getElementById('budgetUnifiedModal').style.display = 'flex';
    },

    closeUnifiedModal() {
        document.getElementById('budgetUnifiedModal').style.display = 'none';
        document.getElementById('budgetFormSection').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        this._directEdit = false;
    },
    
    hideEditSection() {
        if (!document.getElementById('budgetEditId').value || this._directEdit) {
            // Adding new OR direct edit → close the whole modal
            this.closeUnifiedModal();
        } else {
            // Editing from detail view → just hide the form, show detail again
            document.getElementById('budgetFormSection').style.display = 'none';
            document.getElementById('budgetDetailSection').style.display = 'block';
        }
    },

    showEditSection() {
        this._directEdit = false; // Opened from detail view
        const id = document.getElementById('budgetEditId').value;
        const b = this.budgets.find(x => x.id == id);
        if (!b) return;

        document.getElementById('newBudgetName').value = b.name;
        document.getElementById('newBudgetAmount').value = b.monthly_amount;
        document.getElementById('newBudgetPeriod').value = b.period;
        document.getElementById('newBudgetStartDate').value = b.start_date || '';
        document.getElementById('newBudgetEndDate').value = b.end_date || '';
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = b.period === 'custom' ? 'block' : 'none';

        if (b.is_project) {
            document.getElementById('budgetTypeProject').checked = true;
        } else if ((b.envelope_type || 'spending') === 'savings') {
            document.getElementById('budgetTypeSavings').checked = true;
        } else {
            document.getElementById('budgetTypeCategory').checked = true;
        }
        this.toggleType();
        this.renderAccountCheckboxes(b.account_ids || []);
        
        // Reset category search and initialize state
        const catSearch = document.getElementById('budgetCatSearch');
        if (catSearch) catSearch.value = '';
        this.selectedCategories = b.categories || [];
        this.renderCatCheckboxes(this.selectedCategories);

        document.getElementById('budgetFormSection').style.display = 'block';
        
        // Scroll down inside the modal safely
        setTimeout(() => {
            const modalContent = document.querySelector('#budgetUnifiedModal .modal');
            if (modalContent) {
                modalContent.scrollTo({ top: modalContent.scrollHeight, behavior: 'smooth' });
            }
        }, 50);
    },

    editBudget(id) {
        const b = this.budgets.find(x => x.id === id);
        if (!b) return;

        this._directEdit = true; // Flag: opened directly, not from detail view
        document.getElementById('budgetUnifiedTitle').textContent = window.i18n.t('budget_edit_envelope');
        document.getElementById('budgetUnifiedEditBtn').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        document.getElementById('budgetEditId').value = id;
        
        document.getElementById('newBudgetName').value = b.name;
        document.getElementById('newBudgetAmount').value = b.monthly_amount;
        document.getElementById('newBudgetPeriod').value = b.period;
        document.getElementById('newBudgetStartDate').value = b.start_date || '';
        document.getElementById('newBudgetEndDate').value = b.end_date || '';
        const customDates2 = document.getElementById('budgetCustomDates');
        if (customDates2) customDates2.style.display = b.period === 'custom' ? 'block' : 'none';

        if (b.is_project) {
            document.getElementById('budgetTypeProject').checked = true;
        } else if ((b.envelope_type || 'spending') === 'savings') {
            document.getElementById('budgetTypeSavings').checked = true;
        } else {
            document.getElementById('budgetTypeCategory').checked = true;
        }
        this.toggleType();
        this.renderAccountCheckboxes(b.account_ids || []);
        
        // Reset category search and initialize state
        const catSearch = document.getElementById('budgetCatSearch');
        if (catSearch) catSearch.value = '';
        this.selectedCategories = b.categories || [];
        this.renderCatCheckboxes(this.selectedCategories);

        document.getElementById('budgetFormSection').style.display = 'block';
        document.getElementById('budgetUnifiedModal').style.display = 'flex';
    },

    async saveForm() {
        const id = document.getElementById('budgetEditId').value;
        const name = document.getElementById('newBudgetName').value.trim();
        const amount = parseFloat(document.getElementById('newBudgetAmount').value);
        const period = document.getElementById('newBudgetPeriod').value;
        const isProject = document.getElementById('budgetTypeProject').checked;
        const isSavings = document.getElementById('budgetTypeSavings')?.checked;
        const categories = (isProject || isSavings) ? [] : this.selectedCategories;

        if (!name) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_name_required'));
        if (isNaN(amount) || amount < 0) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_invalid_amount'));

        const startDate = period === 'custom' ? (document.getElementById('newBudgetStartDate')?.value || null) : null;
        const endDate = period === 'custom' ? (document.getElementById('newBudgetEndDate')?.value || null) : null;
        if (period === 'custom' && (!startDate || !endDate)) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_custom_dates_required') || 'Please select start and end dates.');
        
        const envelope_type = isSavings ? 'savings' : 'spending';
        const account_ids = window.app?.config?.enable_org_mode === 'true' ? this.getSelectedAccounts() : null;
        const payload = { name, monthly_amount: amount, period, is_project: isProject, categories, start_date: startDate, end_date: endDate, account_ids, envelope_type };

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
            
            // Highlight the new/updated envelope after re-render
            if (!id) this._pendingHighlightName = name;

            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();

            if (this._directEdit || !id) {
                // Cas 1: direct edit or new → close modal entirely
                this.closeUnifiedModal();
            } else {
                // Cas 2: edit from detail view → hide form, refresh detail
                document.getElementById('budgetFormSection').style.display = 'none';
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

            // Non-blocking toast
            const toastMsg = id ? window.i18n.t('msg_envelope_updated') : window.i18n.t('msg_envelope_created');
            showUndoToast(toastMsg, actionId, () => this.loadBudgets().then(() => this.loadStatus()));
        } catch(e) {
            showToast(e.message || window.i18n.t('budget_ai_create_fail'), 'error', 5000);
        }
    },

    async updateAmount(id, val) {
        const amount = parseFloat(val);
        if (isNaN(amount) || amount < 0) return;
        try {
            await API.put(`/api/budgets/${id}`, { monthly_amount: amount });
            await this.loadStatus();
            window.app.refreshSidebar();
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

    async deleteBudget(id) {
        if (!await showInlineConfirm(window.i18n.t('title_deletion'), window.i18n.t('confirm_delete_envelope'))) return;
        try {
            const res = await API.del(`/api/budgets/${id}`);
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            showUndoToast(window.i18n.t('msg_envelope_deleted') || 'Budget supprimé', res.action_id, () => this.loadBudgets().then(() => this.loadStatus()));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_info'), e.message);
        }
    },

    // ── Piggy Bank (Tirelire) methods ─────────────────────────────────────────

    async showAllocationForm(budgetId) {
        // Remove any existing allocation form
        const existing = document.getElementById('allocationInlineForm');
        if (existing) existing.remove();

        const card = document.querySelector(`[data-budget-id="${budgetId}"]`);
        if (!card) return;

        // Fetch current allocations for this piggy bank to calculate hosted amounts per account
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
            // Refresh detail view
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
            // Refresh detail view in place
            await this.showDetail(budgetId, budgetName, year, month);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    // ── AI Suggestions ────────────────────────────────────────────────────────

    openAiWindowModal() {
        const modal = document.getElementById('aiWindowSelectionModal');
        if (modal) {
            modal.style.display = 'flex';
        }
    },

    closeAiWindowModal() {
        const modal = document.getElementById('aiWindowSelectionModal');
        if (modal) {
            modal.style.display = 'none';
        }
    },

    selectModalAiWindow(months, element) {
        const radio = element.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;

        const labels = document.querySelectorAll('#aiWindowSelectionModal label');
        labels.forEach(lbl => {
            lbl.style.border = '1px solid var(--border-color)';
        });
        element.style.border = '2px solid var(--accent)';
    },

    confirmAiWindowSelection() {
        const selectedRadio = document.querySelector('input[name="modalAiWindowOption"]:checked');
        const months = selectedRadio ? parseInt(selectedRadio.value) : 3;
        this.closeAiWindowModal();
        this.requestAiSuggestions(months);
    },

    async requestAiSuggestions(windowMonths = 3) {
        sessionStorage.removeItem('budget_ai_panel_closed');
        const btn = document.getElementById('budgetAiBtn');
        btn.disabled = true;
        btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg> ${window.i18n.t('budget_ai_analyzing')}`;
        
        this.updateAiWindowButtonsState(windowMonths);

        // Show AI panel immediately with progress overlay & stepper animation, clear previous proposals and alert for a clean initial loading state
        const panel = document.getElementById('budgetAiPanel');
        const container = document.getElementById('budgetAiProposals');
        const overlay = document.getElementById('aiLoadingOverlay');
        const simulator = document.getElementById('aiImpactSimulator');
        const alertBanner = document.getElementById('aiSimHistoricalComparisonAlert');
        const stickyBar = document.getElementById('aiStickyBar');

        this.aiProposals = [];
        this.unclassifiedCategories = [];

        if (simulator) simulator.style.display = 'none';
        if (alertBanner) alertBanner.style.display = 'none';
        if (stickyBar) stickyBar.style.display = 'none';
        if (container) {
            container.innerHTML = '';
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }

        if (panel) {
            panel.style.display = 'block';
        }
        if (overlay) {
            overlay.style.display = 'flex';
        }
        if (container) {
            container.style.opacity = '0.3';
            container.style.pointerEvents = 'none';
        }

        if (this.currentAiSuggestAbortController) {
            try { 
                this.currentAiSuggestAbortController.abort();
                await API.post('/api/budgets/ai_suggest/cancel');
            } catch(e) {}
        }
        this.currentAiSuggestAbortController = new AbortController();

        // Start live polling of status
        if (this.aiPollTimer) clearInterval(this.aiPollTimer);
        this.aiPollTimer = setInterval(async () => {
            try {
                const status = await API.get('/api/budgets/ai_suggest/status');
                if (status && status.state) {
                    if (status.state === 'ERROR' || status.state === 'IDLE') {
                        this.resetAiBtnAndOverlay();
                    } else {
                        this.updateAiPipelineStatusUI(status);
                        if (window.app && window.app.updateAiNavBadge) {
                            window.app.updateAiNavBadge(status);
                        }
                    }
                }
            } catch (e) {}
        }, 1000);

        try {
            const currentLang = (window.i18n && window.i18n.currentLang) ? window.i18n.currentLang : 'fr';
            const result = await API.post('/api/budgets/ai_suggest', { window_months: windowMonths, lang: currentLang }, { signal: this.currentAiSuggestAbortController.signal });
            await this.playParsingAnimation();
            this.aiSuggestMeta = result;
            const effWin = result.effective_window_months || result.window_months || windowMonths;
            this.updateAiWindowButtonsState(windowMonths, effWin);
            this.renderAiProposals(result.proposals || []);
        } catch(e) {
            if (e.name === 'AbortError') {
                return;
            }
            const msg = e.message || '';
            if (panel && (!this.aiProposals || !this.aiProposals.length)) {
                panel.style.display = 'none';
            }
            if (msg.includes('non activ') || msg.includes('400')) {
                showInlineMessage(window.i18n.t('title_info'), msg || window.i18n.t('budget_ai_not_enabled'));
            } else {
                showInlineMessage(window.i18n.t('title_error'), msg || window.i18n.t('budget_ai_error'));
            }
        } finally {
            this.resetAiBtnAndOverlay();
        }
    },

    updateAiWindowButtonsState(activeWindow, effectiveWindow = null) {
        const wins = [3, 6, 12];
        const targetWin = effectiveWindow || activeWindow;

        wins.forEach(w => {
            const btn = document.getElementById(`btnAiWindow_${w}`);
            if (btn) {
                if (w === targetWin) {
                    btn.className = 'btn btn-primary';
                    btn.style.opacity = '1';
                    btn.style.pointerEvents = 'auto';
                    btn.disabled = false;
                } else if (effectiveWindow && w < effectiveWindow) {
                    // Window had no active transactions and was auto-extended
                    btn.className = 'btn btn-secondary';
                    btn.style.opacity = '0.35';
                    btn.style.cursor = 'not-allowed';
                    btn.disabled = true;
                    btn.title = window.i18n.t('ai_budget_window_auto_extended') || `Aucune dépense sur ${w} mois — analyse étendue à ${effectiveWindow} mois`;
                } else {
                    btn.className = 'btn btn-secondary';
                    btn.style.opacity = '1';
                    btn.style.pointerEvents = 'auto';
                    btn.disabled = false;
                    btn.title = '';
                }
            }
        });
    },

    async cancelAiSuggestions() {
        if (this.currentAiSuggestAbortController) {
            try { this.currentAiSuggestAbortController.abort(); } catch(e) {}
            this.currentAiSuggestAbortController = null;
        }
        try {
            await API.post('/api/budgets/ai_suggest/cancel');
        } catch(e) {}
        this.resetAiBtnAndOverlay();
    },

    resetAiBtnAndOverlay() {
        if (this.aiPollTimer) {
            clearInterval(this.aiPollTimer);
            this.aiPollTimer = null;
        }
        if (this._aiPollTimer) {
            clearInterval(this._aiPollTimer);
            this._aiPollTimer = null;
        }
        const btn = document.getElementById('budgetAiBtn');
        const overlay = document.getElementById('aiLoadingOverlay');
        const container = document.getElementById('budgetAiProposals');

        if (btn) {
            btn.disabled = false;
            btn.textContent = window.i18n.t('budget_btn_suggestions') || '✨ Suggestions IA';
        }
        if (overlay) overlay.style.display = 'none';
        if (container) {
            container.style.opacity = '1';
            container.style.pointerEvents = 'auto';
        }
        if (window.app && window.app.updateAiNavBadge) {
            window.app.updateAiNavBadge(null);
        }
    },

    async playParsingAnimation() {
        this.isPlayingParsingAnimation = true;
        const pContainer = document.getElementById('aiParsingProgressBarContainer');
        const pBar = document.getElementById('aiParsingProgressBar');
        const loadingText = document.getElementById('aiLoadingText');

        // Force steps 1-3 to completed (green) and step 4 to active (vibrant purple)
        const steps = ['PREPARING', 'SENDING', 'THINKING', 'PARSING'];
        steps.forEach((st) => {
            const el = document.getElementById(`aiStep_${st}`);
            if (el) {
                if (st === 'PARSING') {
                    el.style.background = 'rgba(139,92,246,0.35)';
                    el.style.borderColor = '#c084fc';
                    el.style.color = '#ffffff';
                    el.style.fontWeight = 'bold';
                } else {
                    el.style.background = 'rgba(34,197,94,0.15)';
                    el.style.borderColor = '#22c55e';
                    el.style.color = '#4ade80';
                    el.style.fontWeight = 'normal';
                }
            }
        });

        if (loadingText) {
            loadingText.textContent = (window.i18n && window.i18n.t) ? (window.i18n.t('ai_step_parsing') || 'Structuration des enveloppes...') : 'Structuration des enveloppes...';
        }

        if (pContainer && pBar) {
            pContainer.style.display = 'block';
            pBar.style.width = '0%';
            void pBar.offsetWidth; // Force CSS reflow
            pBar.style.width = '100%';
            await new Promise(resolve => setTimeout(resolve, 2000));
            pContainer.style.display = 'none';
            pBar.style.width = '0%';
        }
        this.isPlayingParsingAnimation = false;
    },

    updateAiPipelineStatusUI(status) {
        if (this.isPlayingParsingAnimation) return;

        if (!status || status.state === 'ERROR' || status.state === 'IDLE') {
            this.resetAiBtnAndOverlay();
            return;
        }

        const btn = document.getElementById('budgetAiBtn');
        const loadingText = document.getElementById('aiLoadingText');
        const timerBadge = document.getElementById('aiTimerBadge');

        const stepText = (window.i18n && window.i18n.t && status.step_key) ? (window.i18n.t(status.step_key) || status.step_key) : status.step_key;
        const elapsed = status.elapsed_seconds || 0;

        let activeState = status.state;
        if (activeState === 'SENDING' && elapsed >= 3) {
            activeState = 'THINKING';
        }

        if (btn && status.state && status.state !== 'IDLE' && status.state !== 'SUCCESS' && status.state !== 'ERROR') {
            btn.disabled = false;
            btn.innerHTML = `<span style="display:inline-flex;align-items:center;gap:6px;"><svg class="animate-spin" style="width:14px;height:14px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg> ${stepText} (${elapsed}s) <button onclick="event.stopPropagation(); window.BudgetsView.cancelAiSuggestions()" style="background:#ef4444;color:#fff;border:none;border-radius:4px;padding:2px 8px;font-size:10px;font-weight:bold;cursor:pointer;margin-left:4px;" title="Arrêter l'analyse IA">⛔ ${window.i18n.t('btn_stop') || 'Arrêter'}</button></span>`;
        }

        if (loadingText && status.step_key) {
            loadingText.textContent = stepText;
        }
        if (timerBadge) {
            timerBadge.textContent = `⏱️ ${elapsed}s / ${status.max_seconds || 300}s max`;
        }

        const steps = ['PREPARING', 'SENDING', 'THINKING', 'PARSING'];
        steps.forEach((st) => {
            const el = document.getElementById(`aiStep_${st}`);
            if (el) {
                if (st === activeState) {
                    el.style.background = 'rgba(139,92,246,0.35)';
                    el.style.borderColor = '#c084fc';
                    el.style.color = '#ffffff';
                    el.style.fontWeight = 'bold';
                } else if (steps.indexOf(st) < steps.indexOf(activeState)) {
                    el.style.background = 'rgba(34,197,94,0.15)';
                    el.style.borderColor = '#22c55e';
                    el.style.color = '#4ade80';
                    el.style.fontWeight = 'normal';
                } else {
                    el.style.background = 'var(--bg-surface)';
                    el.style.borderColor = 'var(--border-color)';
                    el.style.color = 'var(--text-muted)';
                    el.style.fontWeight = 'normal';
                }
            }
        });
    },

    async checkAiTaskStatusOnMount() {
        if (sessionStorage.getItem('budget_ai_panel_closed') === 'true') return;
        try {
            const status = await API.get('/api/budgets/ai_suggest/status');
            if (status && status.state) {
                if (['PREPARING', 'SENDING', 'THINKING', 'PARSING'].includes(status.state)) {
                    const panel = document.getElementById('budgetAiPanel');
                    const overlay = document.getElementById('aiLoadingOverlay');
                    const container = document.getElementById('budgetAiProposals');
                    const simulator = document.getElementById('aiImpactSimulator');
                    const alertBanner = document.getElementById('aiSimHistoricalComparisonAlert');
                    const stickyBar = document.getElementById('aiStickyBar');

                    if (panel) panel.style.display = 'block';
                    if (simulator) simulator.style.display = 'none';
                    if (alertBanner) alertBanner.style.display = 'none';
                    if (stickyBar) stickyBar.style.display = 'none';

                    if (overlay) overlay.style.display = 'flex';
                    if (container) {
                        container.style.opacity = '0.3';
                        container.style.pointerEvents = 'none';
                    }
                    this.updateAiPipelineStatusUI(status);

                    if (this._aiPollTimer) clearInterval(this._aiPollTimer);
                    this._aiPollTimer = setInterval(async () => {
                        try {
                            const curStatus = await API.get('/api/budgets/ai_suggest/status');
                            if (curStatus && curStatus.state) {
                                this.updateAiPipelineStatusUI(curStatus);
                                if (curStatus.state === 'SUCCESS' && curStatus.result) {
                                    clearInterval(this._aiPollTimer);
                                    await this.playParsingAnimation();
                                    if (overlay) overlay.style.display = 'none';
                                    if (container) {
                                        container.style.opacity = '1';
                                        container.style.pointerEvents = 'auto';
                                    }
                                    const btn = document.getElementById('budgetAiBtn');
                                    if (btn) {
                                        btn.disabled = false;
                                        btn.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('budget_btn_suggestions') : 'Suggestions IA';
                                    }
                                    this.aiSuggestMeta = curStatus.result;
                                    this.renderAiProposals(curStatus.result.proposals || []);
                                } else if (curStatus.state === 'ERROR') {
                                    clearInterval(this._aiPollTimer);
                                    if (overlay) overlay.style.display = 'none';
                                    if (container) {
                                        container.style.opacity = '1';
                                        container.style.pointerEvents = 'auto';
                                    }
                                    const btn = document.getElementById('budgetAiBtn');
                                    if (btn) {
                                        btn.disabled = false;
                                        btn.textContent = (window.i18n && window.i18n.t) ? window.i18n.t('budget_btn_suggestions') : 'Suggestions IA';
                                    }
                                }
                            }
                        } catch (e) {}
                    }, 1000);
                } else if (status.state === 'SUCCESS' && status.result && !this.aiProposals) {
                    this.aiSuggestMeta = status.result;
                    this.renderAiProposals(status.result.proposals || []);
                }
            }
        } catch (e) {}
    },

    setGridFilter(filter) {
        this.currentGridFilter = filter;
        this.renderStatus();
    },

    showBulkDeleteModal() {
        const panel = document.getElementById('budgetBulkDeletePanel');
        if (panel) {
            panel.style.display = 'block';
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
            await this.loadAllStatuses();
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
    },

    renderAiProposals(proposals) {
        this.allCatDetails = {};
        if (this.aiSuggestMeta) {
            if (this.aiSuggestMeta.cat_details) {
                Object.assign(this.allCatDetails, this.aiSuggestMeta.cat_details);
            }
            if (this.aiSuggestMeta.unclassified_details) {
                Object.assign(this.allCatDetails, this.aiSuggestMeta.unclassified_details);
            }
        }

        this.aiProposals = proposals.map(p => {
            const cat_amounts = { ...(p.cat_amounts || {}) };
            if (p.cat_details) {
                for (const [c, details] of Object.entries(p.cat_details)) {
                    if (details) {
                        this.allCatDetails[c] = details;
                        if (details.amount !== undefined) {
                            cat_amounts[c] = details.amount;
                        }
                    }
                }
            }
            return {
                ...p,
                cat_amounts,
                original_amount: p.suggested_amount,
                period: p.suggested_period || 'monthly',
                selected: true
            };
        });
        this.unclassifiedCategories = (this.aiSuggestMeta && this.aiSuggestMeta.unclassified_categories) || [];
        this.renderAiProposalsList();
    },

    toggleAiOptionsDropdown(e) {
        if (e) e.stopPropagation();
        const menu = document.getElementById('aiOptionsDropdownMenu');
        if (!menu) return;

        const isVisible = menu.style.display === 'flex';
        menu.style.display = isVisible ? 'none' : 'flex';

        if (!isVisible && !this._aiDropdownOutsideListener) {
            this._aiDropdownOutsideListener = (evt) => {
                const container = document.getElementById('btnAiOptionsDropdown');
                if (menu && !menu.contains(evt.target) && container && !container.contains(evt.target)) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', this._aiDropdownOutsideListener);
                    this._aiDropdownOutsideListener = null;
                }
            };
            setTimeout(() => {
                document.addEventListener('click', this._aiDropdownOutsideListener);
            }, 10);
        }
    },

    adjustAiProposals(multiplier, isAbsoluteReset = false) {
        if (!this.aiProposals) return;
        this.aiProposals.forEach((p, i) => {
            // 100% contractually fixed envelopes are strictly locked and never affected by strategy buttons
            if (p.is_fixed) return;

            if (isAbsoluteReset) {
                p.suggested_amount = p.original_amount;
            } else if (p.has_fixed_mix && p.fixed_sum > 0) {
                // If envelope has a mix of fixed charges and variable expenses, ONLY adjust the variable portion!
                const variablePart = Math.max(0, p.suggested_amount - p.fixed_sum);
                const adjustedVar = Math.round(variablePart * multiplier * 100) / 100;
                p.suggested_amount = Math.round((p.fixed_sum + adjustedVar) * 100) / 100;
            } else {
                p.suggested_amount = Math.max(0, Math.round(p.suggested_amount * multiplier * 100) / 100);
            }

            const input = document.getElementById(`aiProposalAmount_${i}`);
            if (input) input.value = p.suggested_amount;
        });
        this.renderAiProposalsList();
    },

    alignAiProposalsToRealSpending() {
        if (!this.aiProposals) return;
        this.aiProposals.forEach((p, i) => {
            if (p.is_fixed) return;

            let realMonthlyPace = 0;
            if (p.recent_3m_avg !== undefined) {
                realMonthlyPace = p.recent_3m_avg;
            } else if (p.historical_actual_amount !== undefined) {
                realMonthlyPace = (p.period === 'yearly' ? (p.historical_actual_amount / 12.0) : p.historical_actual_amount);
            }

            if (realMonthlyPace > 0) {
                const targetAmt = (p.period === 'yearly') ? Math.round(realMonthlyPace * 12.0 * 100) / 100 : Math.round(realMonthlyPace * 100) / 100;
                p.suggested_amount = targetAmt;
                const input = document.getElementById(`aiProposalAmount_${i}`);
                if (input) input.value = p.suggested_amount;
            }
        });
        this.renderAiProposalsList();
    },

    alignAiProposalsToCurrentMonth() {
        if (!this.aiProposals) return;
        this.aiProposals.forEach((p, i) => {
            if (p.is_fixed) return;

            let curSpent = 0;
            if (p.current_month_spent !== undefined) {
                curSpent = p.current_month_spent;
            } else if (p.categories && p.categories.length) {
                p.categories.forEach(c => {
                    if (this.catMonthSpent && this.catMonthSpent[c] !== undefined) {
                        curSpent += Math.abs(this.catMonthSpent[c]);
                    }
                });
            }

            if (curSpent > 0) {
                const targetAmt = (p.period === 'yearly') ? Math.round(curSpent * 12.0 * 100) / 100 : Math.round(curSpent * 100) / 100;
                p.suggested_amount = targetAmt;
                const input = document.getElementById(`aiProposalAmount_${i}`);
                if (input) input.value = p.suggested_amount;
            }
        });
        this.renderAiProposalsList();
    },

    alignAiProposalsToIncome() {
        if (!this.aiProposals) return;
        
        const salaryInput = document.getElementById('aiSimSalaryInput');
        let regularSalary = salaryInput ? parseFloat(salaryInput.value) : 0;
        if (isNaN(regularSalary) || regularSalary <= 0) {
            regularSalary = (this.capacityData && this.capacityData.monthly) ? (this.capacityData.monthly.income_ref || 0) : 0;
        }
        if (regularSalary <= 0) return;

        const currentMonthlyCapacity = (this.capacityData && this.capacityData.monthly) ? (this.capacityData.monthly.budgeted || 0) : 0;
        const availableForNewEnvelopes = Math.max(0, regularSalary - currentMonthlyCapacity);

        let fixedTotal = 0;
        let variableTotal = 0;

        this.aiProposals.forEach(p => {
            if (p.selected === false) return;
            const monthlyAmt = p.period === 'yearly' ? (p.suggested_amount / 12.0) : p.suggested_amount;
            if (p.is_fixed) {
                fixedTotal += monthlyAmt;
            } else {
                variableTotal += monthlyAmt;
            }
        });

        const remainingForVariables = Math.max(0, availableForNewEnvelopes - fixedTotal);
        if (variableTotal > 0) {
            const ratio = remainingForVariables / variableTotal;
            this.aiProposals.forEach(p => {
                if (p.selected !== false && (!p.is_fixed || p.unlocked)) {
                    const currentMonthly = p.period === 'yearly' ? (p.suggested_amount / 12.0) : p.suggested_amount;
                    const newMonthly = currentMonthly * ratio;
                    p.suggested_amount = p.period === 'yearly' ? Math.round(newMonthly * 12.0 * 100) / 100 : Math.round(newMonthly * 100) / 100;
                }
            });
        }
        this.renderAiProposalsList();
    },

    toggleAllAiProposals(checked) {
        if (!this.aiProposals) return;
        this.aiProposals.forEach(p => p.selected = checked);
        const checkboxes = document.querySelectorAll('.ai-proposal-checkbox');
        checkboxes.forEach(cb => cb.checked = checked);
        this.updateAiImpactSimulation();
    },

    toggleAiProposal(index, checked) {
        if (this.aiProposals && this.aiProposals[index]) {
            this.aiProposals[index].selected = checked;
            this.updateAiImpactSimulation();
        }
    },

    updateAiProposalPeriod(index, period) {
        if (this.aiProposals && this.aiProposals[index]) {
            this.aiProposals[index].period = period;
            const unitSpan = document.getElementById(`aiProposalUnit_${index}`);
            if (unitSpan) unitSpan.textContent = (period === 'yearly' ? (window.i18n.t('budget_unit_yearly') || '€/an') : (window.i18n.t('budget_unit_monthly') || '€/mois'));
            this.renderAiProposalsList();
        }
    },

    updateAiProposalAmount(index, val) {
        const num = parseFloat(val);
        if (this.aiProposals && this.aiProposals[index] && !isNaN(num) && num >= 0) {
            this.aiProposals[index].suggested_amount = num;
            this.renderAiProposalsList();
        }
    },

    setSimMode(mode) {
        this.aiSimMode = mode;
        const btnIncome = document.getElementById('btnAiSimModeIncome');
        const btnSpending = document.getElementById('btnAiSimModeSpending');
        if (btnIncome && btnSpending) {
            if (mode === 'income') {
                btnIncome.style.background = 'var(--accent)';
                btnIncome.style.color = '#fff';
                btnSpending.style.background = 'transparent';
                btnSpending.style.color = 'var(--text-muted)';
            } else {
                btnSpending.style.background = 'var(--accent)';
                btnSpending.style.color = '#fff';
                btnIncome.style.background = 'transparent';
                btnIncome.style.color = 'var(--text-muted)';
            }
        }
        this.updateAiImpactSimulation();
    },

    updateAiImpactSimulation() {
        const proposals = this.aiProposals || [];
        const selected = proposals.filter(p => p.selected);

        // Regular salary baseline from manual override or AI suggest response
        let regularSalary = this.customSalaryOverride;
        if (regularSalary === undefined || regularSalary === null) {
            regularSalary = (this.aiSuggestMeta && this.aiSuggestMeta.regular_salary > 0) 
                ? this.aiSuggestMeta.regular_salary 
                : ((this.capacityData && this.capacityData.monthly) ? (this.capacityData.monthly.income || 0) : 0);
        }

        const currentMonthlyCapacity = (this.aiSuggestMeta && this.aiSuggestMeta.already_engaged_monthly !== undefined)
            ? this.aiSuggestMeta.already_engaged_monthly
            : ((this.capacityData && this.capacityData.monthly) ? (this.capacityData.monthly.budgeted || 0) : 0);

        let impactMonthly = 0;
        let impactYearlyOnly = 0;

        selected.forEach(p => {
            if (p.period === 'yearly') {
                impactMonthly += (p.suggested_amount / 12.0);
                impactYearlyOnly += p.suggested_amount;
            } else {
                impactMonthly += p.suggested_amount;
            }
        });

        const totalProjectedMonthly = currentMonthlyCapacity + impactMonthly;
        const baselineSalaryMonthly = regularSalary > 0 ? regularSalary : 1;
        const isExceededMonthly = (regularSalary > 0 && totalProjectedMonthly > regularSalary);

        const currentPctMonthly = Math.min(100, Math.round((currentMonthlyCapacity / baselineSalaryMonthly) * 100));
        const totalPctMonthly = Math.min(100, Math.round((totalProjectedMonthly / baselineSalaryMonthly) * 100));

        // Yearly capacity calculations
        let regularYearlySalary = this.customYearlySalaryOverride;
        if (regularYearlySalary === undefined || regularYearlySalary === null) {
            regularYearlySalary = regularSalary > 0 ? (regularSalary * 12.0) : 0;
        }

        const currentYearlyCapacity = (this.capacityData && this.capacityData.yearly) ? (this.capacityData.yearly.budgeted || 0) : 0;
        const baselineSalaryYearly = regularYearlySalary > 0 ? regularYearlySalary : 1;
        const totalProjectedYearly = currentYearlyCapacity + impactYearlyOnly;
        const isExceededYearly = (regularYearlySalary > 0 && totalProjectedYearly > regularYearlySalary);

        const currentPctYearly = Math.min(100, Math.round((currentYearlyCapacity / baselineSalaryYearly) * 100));
        const totalPctYearly = Math.min(100, Math.round((totalProjectedYearly / baselineSalaryYearly) * 100));

        // Update UI elements - Monthly
        const salaryInput = document.getElementById('aiSimSalaryInput');
        if (salaryInput && document.activeElement !== salaryInput) {
            salaryInput.value = regularSalary.toFixed(2);
        }

        const countText = (window.i18n && window.i18n.t) 
            ? (window.i18n.t('ai_budget_selected_format') || '{selected} / {total} sélectionnées').replace('{selected}', selected.length).replace('{total}', proposals.length)
            : `${selected.length} / ${proposals.length} sélectionnées`;

        const countSpan = document.getElementById('aiSimSelectedCount');
        if (countSpan) countSpan.textContent = countText;

        // Sync sticky bottom bar
        const stickyBar = document.getElementById('aiStickyBar');
        const stickyCount = document.getElementById('aiStickyCount');
        if (stickyBar) stickyBar.style.display = proposals.length > 0 ? 'flex' : 'none';
        if (stickyCount) stickyCount.textContent = countText;

        // Compare total proposed budget vs recent 3-month monthly pace for selected proposals
        let totalRecent3mMonthly = 0;
        selected.forEach(p => {
            if (p.recent_3m_avg !== undefined) {
                totalRecent3mMonthly += p.recent_3m_avg;
            } else if (p.historical_actual_amount !== undefined) {
                totalRecent3mMonthly += (p.period === 'yearly' ? (p.historical_actual_amount / 12.0) : p.historical_actual_amount);
            }
        });

        // --- SHARED DYNAMIC SCALE ---
        // Scale 100% width against the maximum of (Salary, Total Projected Budget, Real Spent)
        const maxScale = Math.max(1, regularSalary, totalProjectedMonthly, totalRecent3mMonthly);

        // --- BARRE 1 : Utilisation de la Paie ---
        const barCur = document.getElementById('aiSimProgressBarCurrent');
        const barImp = document.getElementById('aiSimProgressBarImpact');

        const salaryPct = regularSalary > 0 ? (totalProjectedMonthly / regularSalary) * 100 : 0;
        let barColor = '#3b82f6';
        let badgeColor = 'var(--accent)';
        let statusBadgeText = '';

        if (regularSalary > 0 && totalProjectedMonthly > regularSalary) {
            if (salaryPct <= 115) {
                barColor = '#f59e0b'; // Amber / Orange
                badgeColor = '#f59e0b';
                statusBadgeText = window.i18n.t('ai_sim_status_savings_drawn') || '📙 Sollicite l\'épargne';
            } else {
                barColor = '#ef4444'; // Red
                badgeColor = '#ef4444';
                statusBadgeText = window.i18n.t('ai_sim_status_overbudget') || '⚠️ Budget élevé';
            }
        }

        if (barCur && barImp) {
            const currentW = (currentMonthlyCapacity / maxScale) * 100;
            const impactW = (impactMonthly / maxScale) * 100;

            barCur.style.width = `${currentW}%`;
            barCur.style.background = 'var(--accent)';

            barImp.style.left = `${currentW}%`;
            barImp.style.width = `${impactW}%`;
            barImp.style.background = barColor;
        }

        const curValEl = document.getElementById('aiSimCurrentVal');
        if (curValEl) curValEl.textContent = `${formatCurrency(currentMonthlyCapacity)}/m`;

        const impValEl = document.getElementById('aiSimImpactVal');
        if (impValEl) impValEl.textContent = `+${formatCurrency(impactMonthly)}/m`;

        const pctBadge = document.getElementById('aiSimPercentBadge');
        if (pctBadge) {
            const pctVal = regularSalary > 0 ? Math.round((totalProjectedMonthly / regularSalary) * 100) : 0;
            const totalStr = `${formatCurrency(totalProjectedMonthly)}/m`;
            let fullText = '';
            if (statusBadgeText) {
                const tpl = window.i18n.t('ai_sim_total_format_status') || 'Budget de {total} ({pct}% de vos revenus repère — {status})';
                fullText = tpl.replace('{total}', totalStr).replace('{pct}', pctVal).replace('{status}', statusBadgeText);
            } else {
                const tpl = window.i18n.t('ai_sim_total_format') || 'Budget de {total} ({pct}% de vos revenus repère)';
                fullText = tpl.replace('{total}', totalStr).replace('{pct}', pctVal);
            }
            pctBadge.textContent = fullText;
            pctBadge.style.color = badgeColor;
        }

        // --- BARRE 2 : Couverture Dépenses Réelles ---
        const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) ? this.aiSuggestMeta.window_months : 3;
        const realPaceLabelEl = document.getElementById('aiSimRealPaceLabel');
        if (realPaceLabelEl) {
            const paceTpl = window.i18n.t('ai_sim_lbl_real_pace') || 'Moyenne de dépenses ({months}m) :';
            realPaceLabelEl.textContent = paceTpl.replace('{months}', windowMonths);
        }

        const realPaceEl = document.getElementById('aiSimRealPaceVal');
        if (realPaceEl) realPaceEl.textContent = `${formatCurrency(totalRecent3mMonthly)}/m`;

        const proposedEl = document.getElementById('aiSimProposedVal');
        if (proposedEl) proposedEl.textContent = `${formatCurrency(impactMonthly)}/m`;

        const gapEl = document.getElementById('aiSimGapVal');
        const gapVal = impactMonthly - totalRecent3mMonthly;

        if (gapEl) {
            const absGapStr = `${formatCurrency(Math.abs(gapVal))}/m`;
            if (gapVal >= 0) {
                const tplLower = window.i18n.t('ai_sim_gap_lower') || 'Dépenses de {amount} inférieures à vos revenus repère';
                gapEl.textContent = tplLower.replace('{amount}', absGapStr);
                gapEl.style.color = '#36b37e';
            } else {
                const tplHigher = window.i18n.t('ai_sim_gap_higher') || 'Dépenses de {amount} supérieures à vos revenus repère';
                gapEl.textContent = tplHigher.replace('{amount}', absGapStr);
                gapEl.style.color = Math.abs(gapVal) > (regularSalary * 0.15) ? '#ef4444' : '#f59e0b';
            }
        }

        const barRealCovered = document.getElementById('aiSimProgressBarRealCovered');
        const barRealUncovered = document.getElementById('aiSimProgressBarRealUncovered');

        if (barRealCovered && barRealUncovered) {
            const coveredAmt = Math.min(totalRecent3mMonthly, impactMonthly);
            const uncoveredAmt = Math.max(0, totalRecent3mMonthly - impactMonthly);

            const coveredW = (coveredAmt / maxScale) * 100;
            const uncoveredW = (uncoveredAmt / maxScale) * 100;

            barRealCovered.style.width = `${coveredW}%`;
            barRealUncovered.style.left = `${coveredW}%`;
            barRealUncovered.style.width = `${uncoveredW}%`;
            barRealUncovered.style.background = Math.abs(gapVal) > (regularSalary * 0.15) ? '#ef4444' : '#f59e0b';
        }

        // --- SALARY REPERE VERTICAL MARKERS & FLOATING BADGES ---
        const marker1 = document.getElementById('aiSimSalaryMarker1');
        const marker2 = document.getElementById('aiSimSalaryMarker2');
        const badge1 = document.getElementById('aiSimSalaryMarkerBadge1');
        const badge2 = document.getElementById('aiSimSalaryMarkerBadge2');
        const val1 = document.getElementById('aiSimSalaryMarkerVal1');
        const val2 = document.getElementById('aiSimSalaryMarkerVal2');

        const salaryStr = formatCurrency(regularSalary);

        if (regularSalary > 0) {
            const salaryPos = Math.min(100, Math.max(0, (regularSalary / maxScale) * 100));
            if (marker1) {
                marker1.style.display = 'block';
                marker1.style.left = `${salaryPos}%`;
            }
            if (marker2) {
                marker2.style.display = 'block';
                marker2.style.left = `${salaryPos}%`;
            }
            if (badge1) {
                badge1.style.display = 'block';
                badge1.style.left = `${salaryPos}%`;
                if (val1) val1.textContent = salaryStr;
            }
            if (badge2) {
                badge2.style.display = 'block';
                badge2.style.left = `${salaryPos}%`;
                if (val2) val2.textContent = salaryStr;
            }
        } else {
            if (marker1) marker1.style.display = 'none';
            if (marker2) marker2.style.display = 'none';
            if (badge1) badge1.style.display = 'none';
            if (badge2) badge2.style.display = 'none';
        }

        // --- SMART ACTIONABLE GUIDANCE BANNER (Hierarchical & Non-Contradictory) ---
        const alertBanner = document.getElementById('aiSimHistoricalComparisonAlert');
        if (alertBanner) {
            const isSalaryExceeded = regularSalary > 0 && (totalProjectedMonthly - regularSalary) > 1.0;
            const isPaceShort = selected.length > 0 && (totalRecent3mMonthly - impactMonthly) > 10.0;

            if (isSalaryExceeded) {
                // Priority 1: Salary Overbudget — Guide user to balance to income
                const salaryDiff = totalProjectedMonthly - regularSalary;
                alertBanner.style.display = 'flex';
                alertBanner.style.alignItems = 'center';
                alertBanner.style.justifyContent = 'space-between';
                alertBanner.style.background = salaryPct > 115 ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)';
                alertBanner.style.border = `1px solid ${salaryPct > 115 ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`;
                alertBanner.style.color = salaryPct > 115 ? '#f87171' : '#fbbf24';

                const guidanceTitle = window.i18n.t('ai_sim_guidance_title') || 'Conseil d\'action :';
                const template = window.i18n.t('ai_sim_guidance_salary_exceeded') || 'Budget total ({total}) supérieur au salaire (+{diff}).';
                const msgText = `💡 <strong>${guidanceTitle}</strong> ${template.replace('{total}', formatCurrency(totalProjectedMonthly)).replace('{diff}', formatCurrency(salaryDiff))}`;
                const tooltipAutoBalance = window.i18n.t('ai_sim_tooltip_auto_balance') || 'Ajuster automatiquement les enveloppes variables pour que le budget total corresponde exactement au salaire disponible.';

                alertBanner.innerHTML = `
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;">
                        <span>${msgText}</span>
                    </div>
                    <div style="display:flex;gap:8px;align-items:center;flex-shrink:0;">
                        <button onclick="window.BudgetsView.alignAiProposalsToIncome()" style="background:#8b5cf6;color:#ffffff;border:none;border-radius:6px;padding:5px 12px;font-size:11px;font-weight:700;cursor:pointer;box-shadow:0 2px 6px rgba(139,92,246,0.3);" title="${tooltipAutoBalance}">
                            ${window.i18n.t('ai_sim_btn_auto_balance') || '⚖️ Équilibrer à 100% de la paie'}
                        </button>
                    </div>
                `;
            } else if (isPaceShort) {
                // Priority 2: Salary is respected (100%), but historical spending was higher. Inform user without breaking 100% balance.
                const diff = totalRecent3mMonthly - impactMonthly;
                const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) ? this.aiSuggestMeta.window_months : 3;

                alertBanner.style.display = 'flex';
                alertBanner.style.alignItems = 'center';
                alertBanner.style.justifyContent = 'space-between';
                alertBanner.style.background = 'rgba(59, 130, 246, 0.1)';
                alertBanner.style.border = '1px solid rgba(59, 130, 246, 0.3)';
                alertBanner.style.color = '#60a5fa';

                const guidanceTitle = window.i18n.t('ai_sim_info_title') || 'Information :';
                const template = window.i18n.t('ai_sim_info_balanced') || 'Budget équilibré sur la paie ({salary}). Vos dépenses passées sur {months}m étaient de {spending} (+{gap}). Pensez à modérer ces dépenses.';
                const formattedMsg = template
                    .replace('{salary}', formatCurrency(regularSalary))
                    .replace('{months}', windowMonths)
                    .replace('{spending}', formatCurrency(totalRecent3mMonthly) + '/m')
                    .replace('{gap}', formatCurrency(diff) + '/m');
                const msgText = `ℹ️ <strong>${guidanceTitle}</strong> ${formattedMsg}`;

                alertBanner.innerHTML = `
                    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;flex:1;">
                        <span>${msgText}</span>
                    </div>
                `;
            } else {
                alertBanner.style.display = 'none';
            }
        }

        // Update UI elements - Yearly
        const yearlySalaryInput = document.getElementById('aiSimYearlySalaryInput');
        if (yearlySalaryInput && document.activeElement !== yearlySalaryInput) {
            yearlySalaryInput.value = regularYearlySalary.toFixed(2);
        }

        const yrCurValEl = document.getElementById('aiSimYearlyCurrentVal');
        if (yrCurValEl) yrCurValEl.textContent = `${formatCurrency(currentYearlyCapacity)}/an`;

        const yrImpValEl = document.getElementById('aiSimYearlyImpactVal');
        if (yrImpValEl) yrImpValEl.textContent = `+${formatCurrency(impactYearlyOnly)}/an`;

        const yrTotValEl = document.getElementById('aiSimYearlyTotalVal');
        if (yrTotValEl) {
            yrTotValEl.textContent = `${formatCurrency(totalProjectedYearly)}/an`;
            yrTotValEl.style.color = isExceededYearly ? '#ef4444' : '#c084fc';
        }

        const yrBarCur = document.getElementById('aiSimProgressBarYearlyCurrent');
        if (yrBarCur) {
            yrBarCur.style.width = `${currentPctYearly}%`;
            yrBarCur.style.background = isExceededYearly ? '#ef4444' : '#8b5cf6';
        }

        const yrBarImp = document.getElementById('aiSimProgressBarYearlyImpact');
        if (yrBarImp) {
            yrBarImp.style.left = `${currentPctYearly}%`;
            yrBarImp.style.width = `${Math.max(0, totalPctYearly - currentPctYearly)}%`;
            yrBarImp.style.background = isExceededYearly ? '#dc2626' : '#c084fc';
        }
    },

    updateCustomSalary(val) {
        const num = parseFloat(val);
        if (!isNaN(num) && num >= 0) {
            this.customSalaryOverride = num;
            this.customYearlySalaryOverride = num * 12.0;
            if (this.aiSuggestMeta) {
                this.aiSuggestMeta.regular_salary = num;
            }
            this.updateAiImpactSimulation();
        }
    },

    updateCustomYearlySalary(val) {
        const num = parseFloat(val);
        if (!isNaN(num) && num >= 0) {
            this.customYearlySalaryOverride = num;
            this.updateAiImpactSimulation();
        }
    },

    applyBadgeAmountToAiProposal(i, val) {
        if (!this.aiProposals || !this.aiProposals[i]) return;
        const p = this.aiProposals[i];
        const num = parseFloat(val);
        if (isNaN(num) || num < 0) return;

        if (p.is_fixed && !p.unlocked) {
            p.unlocked = true;
        }

        p.suggested_amount = Math.round(num * 100) / 100;

        const input = document.getElementById(`aiProposalAmount_${i}`);
        if (input) {
            input.value = p.suggested_amount.toFixed(2);
            input.disabled = false;
            input.style.opacity = '1';
        }

        this.updateAiImpactSimulation();
        this.renderAiProposalsList();
    },

    toggleUnlockFixedProposal(i) {
        if (!this.aiProposals || !this.aiProposals[i]) return;
        this.aiProposals[i].unlocked = !this.aiProposals[i].unlocked;
        const input = document.getElementById(`aiProposalAmount_${i}`);
        if (input) {
            if (this.aiProposals[i].unlocked) {
                input.disabled = false;
                input.style.opacity = '1';
                input.style.cursor = 'text';
                input.focus();
                input.select();
            } else {
                input.disabled = true;
                input.style.opacity = '0.65';
                input.style.cursor = 'not-allowed';
            }
        }
        this.renderAiProposalsList();
    },

    removeAiProposal(proposalIndex) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex]) return;
        this.aiProposals.splice(proposalIndex, 1);
        this.renderAiProposalsList();
    },

    addCategoryToAiProposal(proposalIndex, categoryName) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex] || !categoryName) return;
        const p = this.aiProposals[proposalIndex];
        if (!p.categories) p.categories = [];
        if (p.categories.includes(categoryName)) return;

        p.categories.push(categoryName);

        // Determine value to add from cat_amounts, cat_details or catAverages
        let addedVal = 0;
        if (p.cat_amounts && p.cat_amounts[categoryName] !== undefined) {
            addedVal = p.cat_amounts[categoryName];
        } else if (p.cat_details && p.cat_details[categoryName] && p.cat_details[categoryName].amount !== undefined) {
            addedVal = p.cat_details[categoryName].amount;
        } else if (this.catAverages && this.catAverages[categoryName] !== undefined) {
            const avg = Math.abs(this.catAverages[categoryName]);
            addedVal = p.period === 'yearly' ? avg * 12.0 : avg;
        } else if (p.suggested_amount > 0 && (p.categories.length - 1) > 0) {
            addedVal = Math.round((p.suggested_amount / (p.categories.length - 1)) * 100) / 100;
        }

        if (addedVal > 0) {
            p.suggested_amount = Math.round((p.suggested_amount + addedVal) * 100) / 100;
            p.original_amount = Math.round((p.original_amount + addedVal) * 100) / 100;
            if (!p.cat_amounts) p.cat_amounts = {};
            p.cat_amounts[categoryName] = addedVal;
        }

        // Remove from unclassified categories if present
        if (this.unclassifiedCategories) {
            this.unclassifiedCategories = this.unclassifiedCategories.filter(c => c !== categoryName);
        }

        this.renderAiProposalsList();
    },

    removeCategoryFromAiProposal(proposalIndex, categoryName) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex]) return;
        const p = this.aiProposals[proposalIndex];
        
        // Remove category from array
        p.categories = (p.categories || []).filter(c => c !== categoryName);
        
        // Add to unclassified categories list if not already present
        if (!this.unclassifiedCategories) this.unclassifiedCategories = [];
        if (!this.unclassifiedCategories.includes(categoryName)) {
            this.unclassifiedCategories.push(categoryName);
        }
        
        // Recalculate amount
        let removedVal = 0;
        if (p.cat_amounts && p.cat_amounts[categoryName] !== undefined) {
            removedVal = p.cat_amounts[categoryName];
        } else if (p.cat_details && p.cat_details[categoryName] && p.cat_details[categoryName].amount !== undefined) {
            removedVal = p.cat_details[categoryName].amount;
        } else if (this.catAverages && this.catAverages[categoryName] !== undefined) {
            const avg = Math.abs(this.catAverages[categoryName]);
            removedVal = p.period === 'yearly' ? avg * 12.0 : avg;
        } else if (p.categories.length > 0) {
            const oldLen = p.categories.length + 1;
            removedVal = p.suggested_amount / oldLen;
        } else {
            removedVal = p.suggested_amount;
        }

        if (removedVal > 0) {
            p.suggested_amount = Math.max(0, Math.round((p.suggested_amount - removedVal) * 100) / 100);
            p.original_amount = Math.max(0, Math.round((p.original_amount - removedVal) * 100) / 100);
        }

        if (p.categories.length === 0) {
            p.suggested_amount = 0;
            p.selected = false;
        }

        // Re-render proposals list and update simulation
        this.renderAiProposalsList();
    },

    updateAiWindowButtonsState(activeMonths) {
        const months = activeMonths || (this.aiSuggestMeta && this.aiSuggestMeta.window_months) || 3;
        [3, 6, 12].forEach(m => {
            const b = document.getElementById(`aiWinBtn${m}`);
            if (b) {
                if (m === months) {
                    b.classList.remove('btn-secondary');
                    b.classList.add('btn-primary');
                } else {
                    b.classList.remove('btn-primary');
                    b.classList.add('btn-secondary');
                }
            }
        });
    },

    renderAiProposalsList() {
        const panel = document.getElementById('budgetAiPanel');
        const container = document.getElementById('budgetAiProposals');
        const simulator = document.getElementById('aiImpactSimulator');
        if (panel) panel.style.display = 'block';

        const proposals = this.aiProposals || [];
        const unclassified = this.unclassifiedCategories || [];

        const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) || 3;
        this.updateAiWindowButtonsState(windowMonths);

        if (simulator) {
            simulator.style.display = (proposals.length || unclassified.length) ? 'block' : 'none';
        }

        if (!proposals.length && !unclassified.length) {
            container.innerHTML = `<p style="color:var(--text-muted);padding:10px;">${window.i18n.t('budget_ai_no_proposals') || 'Aucune nouvelle proposition.'}</p>`;
            return;
        }

        // Collect categories assigned across ALL current proposals to exclude them from the dropdown dynamically
        const allUsedProposalCats = new Set();
        proposals.forEach(prop => {
            (prop.categories || []).forEach(c => allUsedProposalCats.add(c));
        });

        // Collect categories assigned to existing active budget envelopes
        const existingBudgetCats = new Set();
        (this.budgets || []).forEach(b => {
            if (!b.is_closed) {
                (b.categories || []).forEach(c => existingBudgetCats.add(c));
            }
        });

        const monthlyProposals = proposals.map((p, origIndex) => ({ ...p, origIndex })).filter(p => p.period === 'monthly');
        const yearlyProposals = proposals.map((p, origIndex) => ({ ...p, origIndex })).filter(p => p.period === 'yearly');

        const renderProposalCard = (p) => {
            const i = p.origIndex;
            const isYearly = p.period === 'yearly';
            const bgTint = isYearly ? 'background:rgba(139, 92, 246, 0.04);border:1px solid rgba(139, 92, 246, 0.25);' : 'background:var(--bg-body);border:1px solid var(--border-color);';
            const periodBadge = isYearly 
                ? `<span style="font-size:10px;background:rgba(139, 92, 246, 0.15);color:#c084fc;padding:1px 6px;border-radius:4px;border:1px solid rgba(139, 92, 246, 0.4);font-weight:600;">📅 Annuelle</span>`
                : `<span style="font-size:10px;background:rgba(59, 130, 246, 0.15);color:#60a5fa;padding:1px 6px;border-radius:4px;border:1px solid rgba(59, 130, 246, 0.4);font-weight:600;">⚡ Mensuelle</span>`;

            const categoryBadgesHtml = (p.categories || []).map(c => {
                const details = (p.cat_details && p.cat_details[c]) ? p.cat_details[c] : null;
                let tooltipText = c;
                if (details) {
                    const unitStr = p.period === 'yearly' ? '€/an' : '€/mois';
                    const merchantsLabel = window.i18n.t('ai_budget_tooltip_merchants') || "Exemples d'opérations :";
                    const merchantsStr = details.top_descs && details.top_descs.length ? `\n${merchantsLabel} ${details.top_descs.join(', ')}` : '';
                    tooltipText = `📊 ${c} : ${details.amount} ${unitStr}${merchantsStr}`;
                } else if (p.cat_amounts && p.cat_amounts[c] !== undefined) {
                    const unitStr = p.period === 'yearly' ? '€/an' : '€/mois';
                    tooltipText = `📊 ${c} : ${p.cat_amounts[c]} ${unitStr}`;
                }

                return `
                    <span class="ai-cat-badge" title="${tooltipText.replace(/"/g, '&quot;')}" style="background:var(--bg-surface);border:1px solid var(--border-color);padding:2px 7px;border-radius:4px;font-size:10px;color:var(--text-muted);display:inline-flex;align-items:center;gap:4px;cursor:help;">
                        ${c}
                        <button onclick="event.stopPropagation(); window.BudgetsView.removeCategoryFromAiProposal(${i}, '${c.replace(/'/g, "\\'")}')" aria-label="Retirer la catégorie ${c.replace(/"/g, '')}" style="cursor:pointer;color:#ef4444;font-weight:bold;margin-left:2px;font-size:10px;background:none;border:none;padding:0;line-height:1;">✕</button>
                    </span>
                `;
            }).join('');

            // Available unused expense categories (excluding receipts/transfers, existing active envelopes, and categories in any AI proposal)
            const currentCats = p.categories || [];
            const availableCats = (this.categories || []).filter(c => {
                const isExcludedType = c.type === 'income' || c.type === 'neutral';
                const isUsedInAnyProposal = allUsedProposalCats.has(c.name);
                const isUsedInActiveBudget = existingBudgetCats.has(c.name);
                const hasSpending = (this.catAverages && this.catAverages[c.name] && Math.abs(this.catAverages[c.name]) > 0.01);
                return !isExcludedType && !isUsedInAnyProposal && !isUsedInActiveBudget && !currentCats.includes(c.name) && hasSpending;
            });

            let addCatSelectHtml = '';
            if (availableCats.length > 0) {
                const addCatLabel = window.i18n.t('ai_budget_add_category') || '➕ Catégorie';
                addCatSelectHtml = `
                    <select onchange="if(this.value){ window.BudgetsView.addCategoryToAiProposal(${i}, this.value); }" 
                            style="background:var(--bg-surface);border:1px dashed var(--accent);color:var(--accent);padding:3px 8px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;outline:none;max-width:160px;text-overflow:ellipsis;"
                            title="${window.i18n.t('ai_budget_add_category') || 'Ajouter une catégorie inutilisée'}">
                        <option value="" disabled selected>${addCatLabel}</option>
                        ${availableCats.map(c => {
                            const avg = (this.catAverages && this.catAverages[c.name]) ? Math.abs(this.catAverages[c.name]) : 0;
                            const avgStr = avg > 0 ? ` (${formatCurrency(avg)})` : '';
                            return `<option value="${c.name.replace(/"/g, '&quot;')}">${c.name}${avgStr}</option>`;
                        }).join('')}
                    </select>
                `;
            }

            return `
                <div id="aiProposal_${i}" style="${bgTint}border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:6px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                        
                        <!-- Left: Checkbox + Title + Period badge -->
                        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:240px;">
                            <input type="checkbox" class="ai-proposal-checkbox" style="width:16px;height:16px;cursor:pointer;accent-color:var(--accent);" ${p.selected ? 'checked' : ''} onchange="window.BudgetsView.toggleAiProposal(${i}, this.checked)">
                            
                            <div style="display:flex;flex-direction:column;gap:2px;">
                                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                    <strong style="font-size:13px;color:var(--text-main);">${p.name}</strong>
                                    ${periodBadge}
                                    ${p.is_fixed ? `<span style="font-size:10px;background:#1e293b;color:#38bdf8;padding:1px 6px;border-radius:4px;border:1px solid #0284c7;" title="Charge fixe contractuelle non modifiable">${window.i18n.t('ai_budget_fixed_badge') || 'Fixe'}</span>` : ''}
                                    ${p.has_fixed_mix ? `<span style="font-size:10px;background:#1e293b;color:#38bdf8;padding:1px 6px;border-radius:4px;border:1px solid #0284c7;" title="Inclut ${p.fixed_sum}€/mois de charges fixes contractuelles">Inclut ${p.fixed_sum}€ fixe</span>` : ''}
                                    ${p.is_exceptional ? `<span style="font-size:10px;background:#312e81;color:#a5b4fc;padding:1px 6px;border-radius:4px;border:1px solid #4338ca;" title="Dépense ponctuelle / projet">${window.i18n.t('ai_budget_project_badge') || 'Projet'}</span>` : ''}
                                </div>
                            </div>
                        </div>

                        <!-- Right: Amount input, historical actual comparison badge, unit & delete button -->
                        <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;flex-wrap:wrap;">
                            ${(() => {
                                const envLimit = p.suggested_amount;
                                
                                let curSpentSum = p.current_month_spent;
                                if (curSpentSum === undefined || curSpentSum === null) {
                                    curSpentSum = (p.categories || []).reduce((sum, c) => {
                                        const details = (this.allCatDetails && this.allCatDetails[c]);
                                        const val = details && details.current_month_spent !== undefined ? parseFloat(details.current_month_spent) : 0;
                                        return sum + (isNaN(val) ? 0 : val);
                                    }, 0);
                                }

                                let paceAvgSum = p.recent_3m_avg;
                                if (paceAvgSum === undefined || paceAvgSum === null) {
                                    paceAvgSum = (p.categories || []).reduce((sum, c) => {
                                        const catAvg = (this.aiSuggestMeta && this.aiSuggestMeta.cat_averages && this.aiSuggestMeta.cat_averages[c] !== undefined)
                                            ? Math.abs(this.aiSuggestMeta.cat_averages[c])
                                            : ((this.catAverages && this.catAverages[c] !== undefined) ? Math.abs(this.catAverages[c]) : 0);
                                        const val = parseFloat(catAvg);
                                        return sum + (isNaN(val) ? 0 : val);
                                    }, 0);
                                }

                                const valCur = isYearly ? (curSpentSum * 12.0) : curSpentSum;
                                const valPace = isYearly ? (paceAvgSum * 12.0) : paceAvgSum;

                                const isCurrentExceeded = (valCur - envLimit) > 0.05;
                                const isPaceExceeded = (valPace - envLimit) > 0.05;

                                const labelCur = isYearly 
                                    ? (window.i18n.t('budget_spent_this_year') || 'Constaté (an) :')
                                    : (window.i18n.t('budget_spent_this_month') || 'Constaté ce mois :');

                                const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) ? this.aiSuggestMeta.window_months : 3;
                                const labelPaceKey = isYearly ? 'budget_pace_yearly' : `budget_pace_${windowMonths}m`;
                                const labelPace = isYearly
                                    ? (window.i18n.t('budget_pace_yearly') || 'Moyenne annuelle :')
                                    : (window.i18n.t(labelPaceKey) || (window.i18n.t('budget_pace_general') || `Rythme ${windowMonths}m :`));

                                const applyTitleCur = (window.i18n.t('ai_budget_badge_click_apply') || 'Cliquer pour utiliser le montant {amount} pour cette enveloppe').replace('{amount}', formatCurrency(valCur));
                                const applyTitlePace = (window.i18n.t('ai_budget_badge_click_apply') || 'Cliquer pour utiliser le montant {amount} pour cette enveloppe').replace('{amount}', formatCurrency(valPace));

                                const badgeCurrentHtml = `
                                    <span onclick="window.BudgetsView.applyBadgeAmountToAiProposal(${i}, ${valCur})" style="cursor:pointer;font-size:11px;background:var(--bg-base);padding:3px 8px;border-radius:6px;border:1px solid ${isCurrentExceeded ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-color)'};color:${isCurrentExceeded ? '#f87171' : 'var(--text-muted)'};transition:all 0.15s ease;" title="${applyTitleCur}">
                                        ${labelCur} <strong style="text-decoration:underline;text-decoration-style:dotted;">${formatCurrency(valCur)}</strong>
                                    </span>
                                `;

                                const badgePaceHtml = `
                                    <span onclick="window.BudgetsView.applyBadgeAmountToAiProposal(${i}, ${valPace})" style="cursor:pointer;font-size:11px;background:var(--bg-base);padding:3px 8px;border-radius:6px;border:1px solid ${isPaceExceeded ? 'rgba(239, 68, 68, 0.45)' : 'var(--border-color)'};color:${isPaceExceeded ? '#f87171' : 'var(--text-muted)'};transition:all 0.15s ease;" title="${applyTitlePace}">
                                        ${labelPace} <strong style="text-decoration:underline;text-decoration-style:dotted;">${formatCurrency(valPace)}</strong>
                                    </span>
                                `;

                                return badgeCurrentHtml + badgePaceHtml;
                            })()}
                            <input id="aiProposalAmount_${i}" type="number" step="0.01" value="${p.suggested_amount.toFixed(2)}" ${(p.is_fixed && !p.unlocked) ? `disabled title="${window.i18n.t('ai_budget_unlock_fixed_help') || 'Charge fixe contractuelle. Cliquez sur le crayon ✏️ pour autoriser la modification manuelle.'}"` : ''} style="width:95px;text-align:right;font-size:13px;font-weight:700;padding:4px 8px;border-radius:6px;border:1px solid var(--border-color);background:${(p.is_fixed && !p.unlocked) ? 'var(--bg-base)' : 'var(--bg-surface)'};color:${isYearly ? '#c084fc' : 'var(--accent)'}; ${(p.is_fixed && !p.unlocked) ? 'opacity:0.65;cursor:not-allowed;' : ''}" oninput="window.BudgetsView.updateAiProposalAmount(${i}, this.value)">
                            ${p.is_fixed ? `
                                <button type="button" class="btn btn-secondary" onclick="window.BudgetsView.toggleUnlockFixedProposal(${i})" style="padding:3px 6px;font-size:11px;background:transparent;border:1px solid ${p.unlocked ? 'rgba(54,179,126,0.4)' : 'rgba(56,189,248,0.4)'};color:${p.unlocked ? '#36b37e' : '#38bdf8'};cursor:pointer;margin-left:2px;" title="${p.unlocked ? 'Verrouiller le montant fixe' : (window.i18n.t('ai_budget_unlock_fixed_help') || 'Charge fixe contractuelle. Cliquez sur le crayon pour autoriser la modification manuelle.')}">
                                    ${p.unlocked ? '🔓' : '✏️'}
                                </button>
                            ` : ''}
                            <span id="aiProposalUnit_${i}" style="font-size:12px;color:${isYearly ? '#c084fc' : 'var(--text-muted)'};font-weight:600;">${isYearly ? (window.i18n.t('budget_unit_yearly') || '€/an') : (window.i18n.t('budget_unit_monthly') || '€/mois')}</span>
                            <button class="btn btn-secondary" onclick="window.BudgetsView.removeAiProposal(${i})" style="padding:3px 7px;font-size:11px;color:#ef4444;border-color:rgba(239,68,68,0.3);background:transparent;margin-left:4px;" title="${window.i18n.t('ai_budget_delete_proposal') || 'Supprimer la suggestion'}">✕</button>
                        </div>
                    </div>

                    <!-- Bottom row: Justification info & Categories badges -->
                    <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--text-muted);padding-top:4px;border-top:1px dashed var(--border-color);">
                        <div style="display:flex;align-items:flex-start;gap:4px;">
                            <span style="flex-shrink:0;margin-top:1px;">ℹ️</span> <span>${p.justification || p.reason || ''}</span>
                        </div>
                        <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:2px;">
                            ${categoryBadgesHtml}
                            ${addCatSelectHtml}
                        </div>
                    </div>
                </div>
            `;

        };

        let html = '';

        if (monthlyProposals.length > 0) {
            html += `
                <div style="margin-bottom:14px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#60a5fa;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(59, 130, 246, 0.3);">
                        <span data-i18n="ai_budget_section_monthly">${window.i18n.t('ai_budget_section_monthly') || '⚡ Enveloppes Mensuelles'}</span> <span>(${monthlyProposals.length})</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${monthlyProposals.map(renderProposalCard).join('')}
                    </div>
                </div>
            `;
        }

        if (yearlyProposals.length > 0) {
            html += `
                <div style="margin-top:16px;margin-bottom:14px;">
                    <!-- Yearly Impact Simulator Container -->
                    <div id="aiImpactSimulatorYearly" style="background:var(--bg-base);border:1px solid rgba(139, 92, 246, 0.3);border-radius:10px;padding:12px 16px;margin-bottom:12px;">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                            <strong style="color:#c084fc;font-size:13px;display:flex;align-items:center;gap:6px;">
                                <span>📅</span> <span data-i18n="ai_budget_sim_yearly_title">${window.i18n.t('ai_budget_sim_yearly_title') || '📅 Impact annuel prévisionnel'}</span>
                            </strong>
                            <div style="display:flex;gap:10px;align-items:center;">
                                <span id="aiSimYearlySalaryBadge" style="font-size:11px;background:var(--bg-surface);padding:3px 10px;border-radius:6px;border:1px solid rgba(139, 92, 246, 0.3);color:var(--text-muted);display:flex;align-items:center;gap:6px;">
                                    <span data-i18n="ai_budget_yearly_salary_ref">${window.i18n.t('ai_budget_yearly_salary_ref') || '💼 Revenu annuel repère :'}</span> 
                                    <input id="aiSimYearlySalaryInput" type="number" step="100" style="width:90px;text-align:right;font-size:12px;font-weight:700;padding:2px 4px;border-radius:4px;border:1px solid rgba(139, 92, 246, 0.4);background:var(--bg-base);color:#c084fc;" oninput="window.BudgetsView.updateCustomYearlySalary(this.value)"> €
                                </span>
                            </div>
                        </div>

                        <!-- Progress bar Annuelle -->
                        <div style="width:100%;height:8px;background:var(--border-color);border-radius:4px;overflow:hidden;position:relative;margin-bottom:8px;">
                            <div id="aiSimProgressBarYearlyCurrent" style="height:100%;background:#8b5cf6;width:0%;position:absolute;top:0;left:0;transition:width 0.3s ease;" title="Engagé annuel actuel"></div>
                            <div id="aiSimProgressBarYearlyImpact" style="height:100%;background:#c084fc;width:0%;position:absolute;top:0;left:0;opacity:0.8;transition:all 0.3s ease;" title="Nouvel impact annuel"></div>
                        </div>

                        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);flex-wrap:wrap;gap:6px;">
                            <div>
                                <span data-i18n="ai_budget_sim_yearly_engaged">${window.i18n.t('ai_budget_sim_yearly_engaged') || 'Engagé annuel :'}</span>
                                <span title="${window.i18n.t('ai_budget_sim_tt_yearly_engaged') || 'Somme des enveloppes annuelles déjà existantes.'}" style="cursor:help;margin-right:4px;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                                <strong id="aiSimYearlyCurrentVal" style="color:var(--text-main);">0,00 €/an</strong>
                            </div>
                            <div>
                                <span data-i18n="ai_budget_sim_yearly_impact">${window.i18n.t('ai_budget_sim_yearly_impact') || 'Impact sélection :'}</span>
                                <span title="${window.i18n.t('ai_budget_sim_tt_yearly_impact') || 'Somme des propositions annuelles cochées ci-dessous.'}" style="cursor:help;margin-right:4px;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                                <strong id="aiSimYearlyImpactVal" style="color:#c084fc;">+0,00 €/an</strong>
                            </div>
                            <div>
                                <span data-i18n="ai_budget_sim_yearly_total">${window.i18n.t('ai_budget_sim_yearly_total') || 'Total prévisionnel :'}</span>
                                <span title="${window.i18n.t('ai_budget_sim_tt_yearly_total') || 'Total annuel prévisionnel après création.'}" style="cursor:help;margin-right:4px;display:inline-flex;align-items:center;justify-content:center;width:13px;height:13px;border-radius:50%;border:1px solid var(--text-muted);color:var(--text-muted);font-size:9px;font-weight:bold;font-family:sans-serif;user-select:none;">i</span>
                                <strong id="aiSimYearlyTotalVal" style="color:#c084fc;">0,00 €/an</strong>
                            </div>
                        </div>
                    </div>

                    <div style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#c084fc;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid rgba(139, 92, 246, 0.3);">
                        <span data-i18n="ai_budget_section_yearly">${window.i18n.t('ai_budget_section_yearly') || '📅 Enveloppes Annuelles'}</span> <span>(${yearlyProposals.length})</span>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:6px;">
                        ${yearlyProposals.map(renderProposalCard).join('')}
                    </div>
                </div>
            `;
        }

        html += this.renderAiUnclassifiedPanelHtml();

        container.innerHTML = html;

        this.updateAiImpactSimulation();
    },

    renderAiUnclassifiedPanelHtml() {
        const unclassified = this.unclassifiedCategories || [];
        if (!unclassified.length) return '';

        const proposals = this.aiProposals || [];

        const unclassifiedBadges = unclassified.map((uItem) => {
            const name = typeof uItem === 'string' ? uItem : uItem.name;
            const avg = typeof uItem === 'object' && uItem.avg ? uItem.avg : (this.catAverages && this.catAverages[name] ? Math.abs(this.catAverages[name]) : 0);
            const avgStr = avg > 0 ? ` (${formatCurrency(avg)}/mois)` : '';

            // Build tooltip title with detailed operation examples if available
            let tooltipText = name;
            const details = (this.allCatDetails && this.allCatDetails[name])
                ? this.allCatDetails[name]
                : ((this.aiSuggestMeta && this.aiSuggestMeta.unclassified_details && this.aiSuggestMeta.unclassified_details[name]) 
                    ? this.aiSuggestMeta.unclassified_details[name] 
                    : ((this.aiSuggestMeta && this.aiSuggestMeta.cat_details && this.aiSuggestMeta.cat_details[name]) ? this.aiSuggestMeta.cat_details[name] : null));

            if (details) {
                const amountVal = (details.amount !== undefined) ? formatCurrency(details.amount) : (avg > 0 ? formatCurrency(avg) : '0,00 €');
                const merchantsLabel = window.i18n.t('ai_budget_tooltip_merchants') || "Exemples d'opérations :";
                const merchantsStr = details.top_descs && details.top_descs.length ? `\n${merchantsLabel} ${details.top_descs.join(', ')}` : '';
                tooltipText = `📊 ${name} : ${amountVal}/mois${merchantsStr}`;
            } else if (avg > 0) {
                tooltipText = `📊 ${name} : ${formatCurrency(avg)}/mois`;
            }

            let assignOptions = proposals.map((p, pIdx) => `<option value="${pIdx}">${p.name}</option>`).join('');

            return `
                <div style="background:var(--bg-surface);border:1px solid var(--border-color);padding:8px 12px;border-radius:8px;display:flex;align-items:center;gap:10px;font-size:12px;"
                     title="${tooltipText.replace(/"/g, '&quot;')}" style="cursor:help;">
                    <span style="font-weight:600;color:var(--text-main);cursor:help;" title="${tooltipText.replace(/"/g, '&quot;')}">📌 ${name}${avgStr}</span>
                    <select onchange="if(this.value!==''){ window.BudgetsView.assignUnclassifiedCategory('${name.replace(/'/g, "\\'")}', parseInt(this.value)); }" 
                            style="background:var(--bg-base);border:1px solid var(--border-color);color:var(--accent);padding:4px 10px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;outline:none;max-width:220px;"
                            title="${window.i18n.t('ai_budget_assign_to') || 'Ajouter à une enveloppe...'}">
                        <option value="" disabled selected>${window.i18n.t('ai_budget_assign_to') || 'Ajouter à une enveloppe...'}</option>
                        ${assignOptions}
                    </select>
                </div>
            `;
        }).join('');

        return `
            <div id="aiUnclassifiedPanel" style="background:var(--bg-base);border:1px dashed var(--accent);border-radius:10px;padding:14px 16px;margin-top:14px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                    <strong style="color:var(--accent);font-size:13px;">
                        ${(window.i18n.t('ai_budget_unclassified_title') || '📌 Catégories non classées')} (${unclassified.length})
                    </strong>
                    <button id="btnAiRefine" class="btn btn-secondary" onclick="window.BudgetsView.refineUnclassifiedWithAi()" style="padding:4px 12px;font-size:12px;font-weight:600;color:var(--accent);border-color:var(--accent);background:var(--bg-surface);">
                        ${window.i18n.t('ai_budget_btn_refine') || '🪄 Affiner les omises avec l\'IA'}
                    </button>
                </div>
                <p style="font-size:11px;color:var(--text-muted);margin:0 0 10px 0;">
                    ${window.i18n.t('ai_budget_unclassified_subtitle') || 'Ces catégories contiennent des dépenses réelles mais n\'ont pas été incluses dans les enveloppes proposées par l\'IA.'}
                </p>
                <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                    ${unclassifiedBadges}
                </div>
            </div>
        `;
    },

    assignUnclassifiedCategory(catName, proposalIndex) {
        if (!this.aiProposals || !this.aiProposals[proposalIndex]) return;
        this.addCategoryToAiProposal(proposalIndex, catName);
        this.unclassifiedCategories = (this.unclassifiedCategories || []).filter(u => (typeof u === 'string' ? u : u.name) !== catName);
        this.renderAiProposalsList();
    },

    async refineUnclassifiedWithAi() {
        if (!this.unclassifiedCategories || !this.unclassifiedCategories.length) return;
        const btn = document.getElementById('btnAiRefine');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:13px;height:13px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('ai_budget_refining') || 'Affinage IA en cours...'}`;
        }

        try {
            const windowMonths = (this.aiSuggestMeta && this.aiSuggestMeta.window_months) ? this.aiSuggestMeta.window_months : 3;
            const formattedUnclassified = (this.unclassifiedCategories || []).map(u => {
                if (typeof u === 'string') {
                    const name = u;
                    const avg = (this.catAverages && this.catAverages[name]) ? Math.abs(this.catAverages[name]) : 0;
                    return { name: name, avg: avg };
                }
                return { name: u.name || String(u), avg: u.avg || 0 };
            });

            const currentLang = (window.i18n && window.i18n.currentLang) ? window.i18n.currentLang : 'fr';
            const res = await API.post('/api/budgets/ai_suggest/refine', {
                window_months: windowMonths,
                lang: currentLang,
                existing_proposals: this.aiProposals || [],
                unclassified_categories: formattedUnclassified
            });

            if (res && res.proposals) {
                this.aiProposals = res.proposals.map(p => ({
                    ...p,
                    cat_amounts: p.cat_amounts || {},
                    original_amount: p.suggested_amount,
                    period: p.suggested_period || 'monthly',
                    selected: true
                }));
                this.unclassifiedCategories = res.unclassified_categories || [];
                this.renderAiProposalsList();
            }
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message || 'Erreur lors de l\'affinage IA.');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async acceptSelectedProposals() {
        const btn = document.getElementById('budgetAiAcceptSelectedBtn');
        const proposals = (this.aiProposals || []).filter(p => p.selected);

        if (!proposals.length) {
            showInlineMessage(window.i18n.t('title_info'), 'Veuillez cocher au moins une enveloppe à créer.');
            return;
        }

        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('budget_ai_accepting_all') || 'Création...'}`;
        }

        let count = 0;
        try {
            for (const p of proposals) {
                await API.post('/api/budgets/', {
                    name: p.name,
                    monthly_amount: p.suggested_amount,
                    period: p.period || 'monthly',
                    is_project: false,
                    categories: p.categories || [],
                });
                count++;
            }
            this.closeAiPanel();
            await this.loadBudgets();
            await this.loadAllStatuses();
            window.app.refreshSidebar();
            showInlineMessage(window.i18n.t('title_info'), `${count} enveloppe(s) créée(s) avec succès !`);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message || 'Erreur lors de la création des enveloppes.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = window.i18n.t('ai_budget_accept_selected') || '✨ Créer les enveloppes sélectionnées';
            }
        }
    },

    async acceptProposal(idx, proposal) {
        const btn = document.querySelector(`#aiProposal_${idx} button.btn-primary`);
        if(btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('budget_ai_creating')}`;
        }

        try {
            await API.post('/api/budgets/', {
                name: proposal.name,
                monthly_amount: proposal.suggested_amount,
                period: 'monthly',
                is_project: false,
                categories: proposal.categories || [],
            });
            
            // Highlight the newly created envelope after re-render
            this._pendingHighlightName = proposal.name;

            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            
            if(btn) {
                btn.innerHTML = window.i18n.t('msg_envelope_created_badge');
                btn.style.backgroundColor = '#10b981';
                btn.style.borderColor = '#10b981';
                btn.style.color = 'white';
            }
            
            // Disappear after 2 seconds
            setTimeout(() => {
                const card = document.getElementById(`aiProposal_${idx}`);
                if (card) {
                    card.style.transition = 'opacity 0.4s ease';
                    card.style.opacity = '0';
                    setTimeout(() => card.style.display = 'none', 400);
                }
            }, 2000);
            
        } catch(e) {
            if(btn) {
                btn.disabled = false;
                btn.innerHTML = window.i18n.t('budget_ai_create_error');
            }
            showInlineMessage(window.i18n.t('title_error'), e.message || window.i18n.t('budget_ai_create_fail'));
        }
    },

    closeAiPanel() {
        sessionStorage.setItem('budget_ai_panel_closed', 'true');
        const panel = document.getElementById('budgetAiPanel');
        if (panel) panel.style.display = 'none';
    },
};


