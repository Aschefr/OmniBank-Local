// static/js/views/autopilot_view.js — Centre de Contrôle Auto-Pilote (Étape 6)
// Dashboard temps-réel, Decision Feed avec rollback sémantique, curseur de tolérance et atelier de règles.

window.AutopilotView = {
    _status: null,
    _kpis: null,
    _decisions: [],
    _totalDecisions: 0,
    _currentPage: 0,
    _pageSize: 25,
    _filterType: '',
    _filterBatch: '',
    _showUndone: true,
    _learnedRules: [],
    _autoRefreshTimer: null,

    render() {
        return `
            <div class="autopilot-container" style="max-width: 1200px; margin: 0 auto; padding-bottom: 40px;">
                <!-- Header / Cockpit Bar -->
                <div class="view-header-bar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 20px;">
                    <div class="view-header-title-group" style="display: flex; align-items: center; gap: 12px;">
                        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;"><circle cx="12" cy="12" r="9.5"></circle><circle cx="12" cy="12" r="3"></circle><line x1="12" y1="15" x2="12" y2="21.5"></line><line x1="2.5" y1="12" x2="9" y2="12"></line><line x1="15" y1="12" x2="21.5" y2="12"></line></svg>
                        <div>
                            <h2 class="view-header-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                                <span data-i18n="autopilot_control_center_title">${window.i18n.t('autopilot_control_center_title') || 'Centre de Contrôle Auto-Pilote'}</span>
                                <span id="apStatusBadge" class="badge" style="font-size: 11px; padding: 3px 10px; border-radius: 12px; vertical-align: middle;"></span>
                            </h2>
                            <p style="margin: 3px 0 0 0; color: var(--text-muted); font-size: 13px;" data-i18n="autopilot_control_center_desc">
                                ${window.i18n.t('autopilot_control_center_desc') || 'Supervisez l\'autonomie de vos flux bancaires, ajustez le seuil de tolérance et annulez des décisions en un clic.'}
                            </p>
                        </div>
                    </div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <button class="btn btn-secondary" onclick="window.AutopilotView.refresh()" title="Actualiser" style="display: flex; align-items: center; gap: 6px;">
                            <span>🔄</span> <span data-i18n="btn_refresh">${window.i18n.t('btn_refresh') || window.i18n.t('common.refresh') || 'Actualiser'}</span>
                        </button>
                        <div class="autopilot-master-switch-wrapper" style="display: flex; align-items: center; gap: 10px; background: var(--bg-surface); padding: 6px 14px; border-radius: 20px; border: 1px solid var(--border-color);">
                            <span style="font-size: 12.5px; font-weight: 600;" data-i18n="autopilot_master_toggle">${window.i18n.t('autopilot_master_toggle') || 'Mode Auto-Pilote'}</span>
                            <label class="switch" style="margin: 0;">
                                <input type="checkbox" id="apMasterSwitch" onchange="window.AutopilotView.toggleMasterSwitch(this.checked)">
                                <span class="slider round"></span>
                            </label>
                        </div>
                    </div>
                </div>

                <!-- Active Sync Banner if syncing -->
                <div id="apSyncingBanner" style="display: none; background: rgba(99,102,241,0.12); border: 1px solid var(--accent); padding: 12px 18px; border-radius: 10px; margin-bottom: 20px; align-items: center; gap: 12px;">
                    <span class="ap-pulse-dot" style="width: 10px; height: 10px; background: var(--accent); border-radius: 50%; display: inline-block;"></span>
                    <span style="font-size: 13px; font-weight: 500; color: var(--text-main);" data-i18n="autopilot_sync_in_progress">
                        ${window.i18n.t('autopilot_sync_in_progress') || 'Un cycle de synchronisation et d\'arbitrage autonome est actuellement en cours...'}
                    </span>
                </div>

                <!-- Section 1 : Indicateurs & Performance (KPIs) - Rétractable -->
                <div id="apKpiSection" class="ap-collapsible-card">
                    <div class="ap-collapsible-header" onclick="window.AutopilotView.toggleSection('kpis')">
                        <div class="ap-collapsible-title-group">
                            <span class="ap-collapsible-icon">📊</span>
                            <div>
                                <h3 class="ap-collapsible-title">Indicateurs & Performance</h3>
                                <p class="ap-collapsible-subtitle">Taux de précision, temps épargné et volume des actions automatisées</p>
                            </div>
                        </div>
                        <div class="ap-collapsible-actions">
                            <span id="apKpiSummaryPill" class="ap-summary-pill">--% Précision • --h Épargnées</span>
                            <span id="apKpiChevron" class="ap-chevron">▾</span>
                        </div>
                    </div>
                    <div id="apKpiContent" class="ap-collapsible-content">
                        <div class="autopilot-kpi-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px;">
                            <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_accuracy">${window.i18n.t('autopilot_kpi_accuracy') || 'Taux de Précision'}</div>
                                <div id="kpiAccuracy" style="font-size: 26px; font-weight: 800; color: #10b981; margin: 8px 0 2px;">--%</div>
                                <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_accuracy_sub">${window.i18n.t('autopilot_kpi_accuracy_sub') || 'décisions sans rejet'}</div>
                            </div>
                            <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_hours_saved">${window.i18n.t('autopilot_kpi_hours_saved') || 'Temps Épargné'}</div>
                                <div id="kpiHoursSaved" style="font-size: 26px; font-weight: 800; color: var(--accent); margin: 8px 0 2px;">-- h</div>
                                <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_hours_saved_sub">${window.i18n.t('autopilot_kpi_hours_saved_sub') || 'de saisie évitée'}</div>
                            </div>
                            <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_reconciled">${window.i18n.t('autopilot_kpi_reconciled') || 'Rapprochements'}</div>
                                <div id="kpiReconciled" style="font-size: 26px; font-weight: 800; color: var(--text-main); margin: 8px 0 2px;">0</div>
                                <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_reconciled_sub">${window.i18n.t('autopilot_kpi_reconciled_sub') || 'pointages validés'}</div>
                            </div>
                            <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_committed">${window.i18n.t('autopilot_kpi_committed') || 'Nouvelles Écritures'}</div>
                                <div id="kpiCommitted" style="font-size: 26px; font-weight: 800; color: var(--text-main); margin: 8px 0 2px;">0</div>
                                <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_committed_sub">${window.i18n.t('autopilot_kpi_committed_sub') || 'insérées automatiquement'}</div>
                            </div>
                            <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_recurrences">${window.i18n.t('autopilot_kpi_recurrences') || 'Récurrences Promues'}</div>
                                <div id="kpiRecurrences" style="font-size: 26px; font-weight: 800; color: var(--text-main); margin: 8px 0 2px;">0</div>
                                <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_recurrences_sub">${window.i18n.t('autopilot_kpi_recurrences_sub') || 'abonnements détectés'}</div>
                            </div>
                            <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; text-align: center;">
                                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_budgets">${window.i18n.t('autopilot_kpi_budgets') || 'Mutations Budgets'}</div>
                                <div id="kpiBudgets" style="font-size: 26px; font-weight: 800; color: var(--text-main); margin: 8px 0 2px;">0</div>
                                <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_budgets_sub">${window.i18n.t('autopilot_kpi_budgets_sub') || 'enveloppes synchronisées'}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section 2 : Configuration & Briques Autonomes - Rétractable -->
                <div id="apConfigSection" class="ap-collapsible-card">
                    <div class="ap-collapsible-header" onclick="window.AutopilotView.toggleSection('config')">
                        <div class="ap-collapsible-title-group">
                            <span class="ap-collapsible-icon">⚙️</span>
                            <div>
                                <h3 class="ap-collapsible-title">Configuration & Briques d'Autonomie</h3>
                                <p class="ap-collapsible-subtitle">Ajustement du seuil de tolérance algorithmique et contrôle des modules actifs</p>
                            </div>
                        </div>
                        <div class="ap-collapsible-actions">
                            <span id="apConfigSummaryPill" class="ap-summary-pill">Seuil: 85% • 8 modules actifs</span>
                            <span id="apConfigChevron" class="ap-chevron">▾</span>
                        </div>
                    </div>
                    <div id="apConfigContent" class="ap-collapsible-content">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
                            <!-- Tolerance Threshold Card -->
                            <div style="background: var(--bg-card, var(--bg-surface)); border: 1px solid var(--border-color); border-radius: 10px; padding: 18px;">
                                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                    <div>
                                        <h4 style="font-size: 14px; margin: 0 0 4px 0; font-weight: 700;" data-i18n="autopilot_threshold_title">
                                            🎯 ${window.i18n.t('autopilot_threshold_title') || 'Seuil de Tolérance & Confiance'}
                                        </h4>
                                        <p style="font-size: 11.5px; color: var(--text-muted); margin: 0;" data-i18n="autopilot_threshold_desc">
                                            ${window.i18n.t('autopilot_threshold_desc') || 'Score minimal requis pour exécuter un rapprochement ou une écriture en toute autonomie.'}
                                        </p>
                                    </div>
                                    <span id="thresholdValBadge" class="badge" style="font-size: 14px; font-weight: 800; padding: 5px 12px; border-radius: 8px; background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid var(--accent);">85%</span>
                                </div>
                                <div style="margin: 16px 0 8px;">
                                    <input type="range" id="thresholdSlider" min="70" max="99" step="1" value="85" style="width: 100%; cursor: pointer;" oninput="window.AutopilotView.onThresholdSliderChange(this.value)" onchange="window.AutopilotView.saveThreshold(this.value)">
                                    <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 6px;">
                                        <span>70% (${window.i18n.t('autopilot_threshold_permissive') || 'Permissif'})</span>
                                        <span>85% (${window.i18n.t('autopilot_threshold_balanced') || 'Équilibré'})</span>
                                        <span>99% (${window.i18n.t('autopilot_threshold_strict') || 'Strict'})</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Autopilot Sub-Toggles Summary Card -->
                            <div style="background: var(--bg-card, var(--bg-surface)); border: 1px solid var(--border-color); border-radius: 10px; padding: 18px;">
                                <h4 style="font-size: 14px; margin: 0 0 12px 0; font-weight: 700;" data-i18n="autopilot_subtoggles_title">
                                    ⚙️ ${window.i18n.t('autopilot_subtoggles_title') || 'Briques Autonomes Actives'}
                                </h4>
                                <div id="apSubtogglesList" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
                                    <!-- Injected dynamically -->
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section 3 : Decision Feed Section (Main Volet) -->
                <div class="ap-collapsible-card" style="margin-bottom: 20px;">
                    <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
                        <div>
                            <h3 style="font-size: 16px; margin: 0 0 4px 0; font-weight: 700; color: var(--text-main);" data-i18n="autopilot_feed_title">
                                📋 ${window.i18n.t('autopilot_feed_title') || 'Journal d\'Audit & Flux des Décisions'}
                            </h3>
                            <p style="font-size: 12px; color: var(--text-muted); margin: 0;" data-i18n="autopilot_feed_desc">
                                ${window.i18n.t('autopilot_feed_desc') || 'Historique complet des arbitrages pris automatiquement avec traçabilité et réversibilité.'}
                            </p>
                        </div>
                        <!-- Filters & Batch Toggle Bar -->
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <select id="feedFilterType" class="form-control" style="font-size: 12px; padding: 4px 10px; border-radius: 6px;" onchange="window.AutopilotView.onFilterChange()">
                                <option value="" data-i18n="autopilot_filter_all">${window.i18n.t('autopilot_filter_all') || 'Toutes les décisions'}</option>
                                <option value="reconciliation" data-i18n="autopilot_filter_reconciliation">${window.i18n.t('autopilot_filter_reconciliation') || 'Rapprochements'}</option>
                                <option value="new_entry" data-i18n="autopilot_filter_new_entry">${window.i18n.t('autopilot_filter_new_entry') || 'Nouvelles Écritures'}</option>
                                <option value="recurrence_promotion" data-i18n="autopilot_filter_recurrence">${window.i18n.t('autopilot_filter_recurrence') || 'Récurrences'}</option>
                                <option value="budget_suggestion" data-i18n="autopilot_filter_budget">${window.i18n.t('autopilot_filter_budget') || 'Budgets'}</option>
                            </select>
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-muted); cursor: pointer;">
                                <input type="checkbox" id="feedShowUndone" checked onchange="window.AutopilotView.onFilterChange()">
                                <span data-i18n="autopilot_show_undone">${window.i18n.t('autopilot_show_undone') || 'Inclure annulées'}</span>
                            </label>
                            <button id="apToggleAllBatchesBtn" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.toggleAllBatches()" style="font-size: 11.5px; padding: 4px 10px;">
                                Replier les lots
                            </button>
                        </div>
                    </div>

                    <div style="padding: 18px 20px;">
                        <!-- Decision Items Container -->
                        <div id="apDecisionsFeed" style="min-height: 200px;">
                            <div style="text-align: center; padding: 40px; color: var(--text-muted);" data-i18n="label_loading">
                                Chargement du journal d'audit...
                            </div>
                        </div>

                        <!-- Pagination -->
                        <div id="apPaginationBar" style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color); font-size: 12px; color: var(--text-muted);">
                            <span id="apPaginationInfo"></span>
                            <div style="display: flex; gap: 8px;">
                                <button id="apPrevPageBtn" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.prevPage()" disabled>◀ Précédent</button>
                                <button id="apNextPageBtn" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.nextPage()" disabled>Suivant ▶</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section 4 : Atelier des Règles & Apprentissages - Rétractable -->
                <div id="apWorkshopSection" class="ap-collapsible-card">
                    <div class="ap-collapsible-header" onclick="window.AutopilotView.toggleSection('workshop')">
                        <div class="ap-collapsible-title-group">
                            <span class="ap-collapsible-icon">🧠</span>
                            <div>
                                <h3 class="ap-collapsible-title">Atelier des Règles & Apprentissages</h3>
                                <p class="ap-collapsible-subtitle">Correspondances marchands et motifs appris automatiquement au fil de vos opérations</p>
                            </div>
                        </div>
                        <div class="ap-collapsible-actions">
                            <span id="apWorkshopSummaryPill" class="ap-summary-pill">0 règle active</span>
                            <span id="apWorkshopChevron" class="ap-chevron">▾</span>
                        </div>
                    </div>
                    <div id="apWorkshopContent" class="ap-collapsible-content">
                        <div id="apLearnedRulesList" style="max-height: 320px; overflow-y: auto;">
                            <!-- Injected dynamically -->
                        </div>
                    </div>
                </div>
            </div>

            <!-- Override Modal -->
            <div id="apOverrideModal" class="modal-overlay ap-override-overlay" style="display: none;" onclick="if(event.target === this) window.AutopilotView.closeOverrideModal()">
                <div class="modal modal-content ap-override-modal">
                    <!-- En-tête -->
                    <div class="ap-override-header">
                        <div class="ap-override-title-group">
                            <div class="ap-override-icon-badge">✏️</div>
                            <div>
                                <h3 class="ap-override-title" data-i18n="autopilot_override_modal_title">
                                    ${window.i18n ? window.i18n.t('autopilot_override_modal_title') : 'Corriger la décision Auto-Pilote'}
                                </h3>
                                <p class="ap-override-subtitle" data-i18n="autopilot_override_modal_subtitle">
                                    ${window.i18n ? window.i18n.t('autopilot_override_modal_subtitle') : 'Ajustez le libellé, la catégorie ou le montant retenus par le moteur'}
                                </p>
                            </div>
                        </div>
                        <button type="button" class="ap-override-close-btn" onclick="window.AutopilotView.closeOverrideModal()" title="${window.i18n ? (window.i18n.t('btn_close') || 'Fermer') : 'Fermer'}">&times;</button>
                    </div>

                    <!-- Corps de formulaire -->
                    <div class="ap-override-body">
                        <input type="hidden" id="overrideDecisionId">

                        <!-- Champ Libellé -->
                        <div class="ap-override-field">
                            <div class="ap-override-label-row">
                                <label for="overrideDescription" class="ap-override-label" data-i18n="autopilot_override_field_label">
                                    ${window.i18n ? window.i18n.t('autopilot_override_field_label') : 'Libellé'}
                                </label>
                                <span class="ap-override-label-hint" data-i18n="autopilot_override_label_hint">
                                    ${window.i18n ? window.i18n.t('autopilot_override_label_hint') : 'Texte de l\'opération'}
                                </span>
                            </div>
                            <div class="ap-override-input-wrap">
                                <input type="text" id="overrideDescription" class="input-styled" autocomplete="off" onkeydown="if(event.key==='Enter') window.AutopilotView.submitOverride()">
                            </div>
                        </div>

                        <!-- Champ Catégorie -->
                        <div class="ap-override-field">
                            <div class="ap-override-label-row">
                                <label for="overrideCategory" class="ap-override-label" data-i18n="autopilot_override_field_category">
                                    ${window.i18n ? window.i18n.t('autopilot_override_field_category') : 'Catégorie'}
                                </label>
                                <span class="ap-override-label-hint" data-i18n="autopilot_override_cat_hint">
                                    ${window.i18n ? window.i18n.t('autopilot_override_cat_hint') : 'Classification budgétaire'}
                                </span>
                            </div>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <div id="overrideCategoryContainer" style="flex: 1;">
                                    ${window.CategoryPicker ? window.CategoryPicker.renderTriggerHtml({
                                        id: 'overrideCategory',
                                        value: '',
                                        allowedTypes: ['expense_var', 'expense_fixed'],
                                        direction: 'debit',
                                        inputClass: 'input-styled',
                                        placeholder: window.i18n ? (window.i18n.t('cat_picker_select') || '-- Catégorie --') : '-- Catégorie --'
                                    }) : '<input type="text" id="overrideCategory" class="input-styled" placeholder="Catégorie">'}
                                </div>
                                <button type="button" 
                                        id="btnOverrideAiClassify" 
                                        class="ap-override-ai-btn" 
                                        onclick="window.AutopilotView.classifyOverrideWithAI(this)" 
                                        title="${window.i18n ? (window.i18n.t('smart_label_ai_classify_tooltip') || 'Nommer et classifier avec l\'IA') : 'Nommer et classifier avec l\'IA'}">
                                    ✨
                                </button>
                            </div>
                        </div>

                        <!-- Champ Montant -->
                        <div class="ap-override-field">
                            <div class="ap-override-label-row">
                                <label for="overrideAmount" class="ap-override-label" data-i18n="autopilot_override_field_amount">
                                    ${window.i18n ? window.i18n.t('autopilot_override_field_amount') : 'Montant (€)'}
                                </label>
                                <span class="ap-override-label-hint" data-i18n="autopilot_override_amount_hint">
                                    ${window.i18n ? window.i18n.t('autopilot_override_amount_hint') : 'Montant absolu'}
                                </span>
                            </div>
                            <div class="ap-override-input-wrap">
                                <input type="number" id="overrideAmount" step="0.01" class="input-styled" style="padding-right: 32px; font-weight: 600;" onkeydown="if(event.key==='Enter') window.AutopilotView.submitOverride()">
                                <span class="ap-override-input-icon" style="font-weight: 700;">€</span>
                            </div>
                        </div>

                        <!-- Carte Option Mémorisation Règle -->
                        <label class="ap-override-rule-card" for="overrideLearnRule">
                            <input type="checkbox" id="overrideLearnRule" checked>
                            <div>
                                <span class="ap-override-rule-title" data-i18n="autopilot_override_learn_rule">
                                    ${window.i18n ? window.i18n.t('autopilot_override_learn_rule') : 'Mémoriser cette règle pour les futures opérations similaires'}
                                </span>
                                <span class="ap-override-rule-desc" data-i18n="autopilot_override_learn_rule_desc">
                                    ${window.i18n ? window.i18n.t('autopilot_override_learn_rule_desc') : 'Enregistre automatiquement cette correspondance dans l\'Atelier pour les prochains relevés bancaires.'}
                                </span>
                            </div>
                        </label>
                    </div>

                    <!-- Pied de page / Actions -->
                    <div class="ap-override-footer">
                        <button type="button" class="btn btn-secondary" onclick="window.AutopilotView.closeOverrideModal()" data-i18n="btn_cancel">
                            ${window.i18n ? window.i18n.t('btn_cancel') : 'Annuler'}
                        </button>
                        <button type="button" id="btnSubmitOverride" class="btn btn-primary" onclick="window.AutopilotView.submitOverride()" style="gap: 6px;">
                            <span>💾</span>
                            <span data-i18n="btn_save">${window.i18n ? window.i18n.t('btn_save') : 'Enregistrer'}</span>
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    async init() {
        // Mark visited on load to clear notification badge
        try {
            await API.post('/api/autopilot/mark-visited', {});
            if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
                window.app.updateAutopilotBadge();
            }
        } catch (e) {}

        this.initCollapsibleSections();
        await this.refresh();

        // Listen to reactive custom events
        this._bindEvents();
    },

    _bindEvents() {
        const handleRefresh = () => {
            if (window.app && window.app.currentView === 'autopilot') {
                this.refresh();
            }
        };
        window.removeEventListener('autopilot_updated', handleRefresh);
        window.addEventListener('autopilot_updated', handleRefresh);

        window.removeEventListener('bank_sync_completed', handleRefresh);
        window.addEventListener('bank_sync_completed', handleRefresh);
    },

    async refresh() {
        await Promise.all([
            this.loadStatus(),
            this.loadKPIs(),
            this.loadDecisions(),
            this.loadLearnedRules()
        ]);
    },

    async loadStatus() {
        try {
            const status = await API.get('/api/autopilot/status');
            this._status = status;
            this.renderStatus(status);
        } catch (e) {
            console.warn('[AutopilotView] Erreur chargement statut:', e);
        }
    },

    renderStatus(status) {
        const masterSwitch = document.getElementById('apMasterSwitch');
        if (masterSwitch) {
            masterSwitch.checked = !!status.is_enabled;
        }

        const badge = document.getElementById('apStatusBadge');
        if (badge) {
            if (status.is_enabled) {
                badge.textContent = window.i18n.t('autopilot_status_active') || 'ACTIF';
                badge.style.background = 'rgba(16,185,129,0.15)';
                badge.style.color = '#10b981';
                badge.style.border = '1px solid #10b981';
            } else {
                badge.textContent = window.i18n.t('autopilot_status_inactive') || 'INACTIF';
                badge.style.background = 'rgba(107,114,128,0.15)';
                badge.style.color = '#9ca3af';
                badge.style.border = '1px solid #6b7280';
            }
        }

        const syncBanner = document.getElementById('apSyncingBanner');
        if (syncBanner) {
            syncBanner.style.display = status.is_syncing ? 'flex' : 'none';
        }

        const slider = document.getElementById('thresholdSlider');
        const valBadge = document.getElementById('thresholdValBadge');
        if (slider && status.threshold) {
            slider.value = status.threshold;
        }
        if (valBadge && status.threshold) {
            valBadge.textContent = `${status.threshold}%`;
        }

        const subList = document.getElementById('apSubtogglesList');
        if (subList && status.managed_subtoggles) {
            const labels = {
                auto_reconcile_transactions: 'Auto-Rapprochement',
                auto_commit_incoming_transactions: 'Auto-Commit Écritures',
                auto_create_missing_categories: 'Création Catégories',
                auto_learn_merchant_rules: 'Apprentissage Marchands',
                auto_create_budget_envelopes: 'Création Enveloppes',
                auto_apply_budget_suggestions: 'Recalibrage Budgets',
                auto_propagate_recurrence_hikes: 'Propagation Hausses (N=3)',
                auto_skip_unreconciled_recurrences: 'Saut d\'échéance auto',
            };
            subList.innerHTML = Object.entries(labels).map(([k, lbl]) => {
                const active = !!status.managed_subtoggles[k];
                return `
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span style="color: ${active ? '#10b981' : '#6b7280'}; font-size: 14px;">${active ? '●' : '○'}</span>
                        <span style="color: ${active ? 'var(--text-main)' : 'var(--text-muted)'};">${lbl}</span>
                    </div>
                `;
            }).join('');
        }
        this.updateSummaryPills();
    },

    async loadKPIs() {
        try {
            const kpis = await API.get('/api/autopilot/kpis');
            this._kpis = kpis;
            this.renderKPIs(kpis);
        } catch (e) {
            console.warn('[AutopilotView] Erreur chargement KPIs:', e);
        }
    },

    renderKPIs(kpis) {
        const elAcc = document.getElementById('kpiAccuracy');
        if (elAcc) elAcc.textContent = `${kpis.accuracy_rate}%`;

        const elHours = document.getElementById('kpiHoursSaved');
        if (elHours) elHours.textContent = `${kpis.hours_saved_estimate} h`;

        const elRec = document.getElementById('kpiReconciled');
        if (elRec) elRec.textContent = kpis.auto_reconciled;

        const elCom = document.getElementById('kpiCommitted');
        if (elCom) elCom.textContent = kpis.auto_committed;

        const elPromo = document.getElementById('kpiRecurrences');
        if (elPromo) elPromo.textContent = kpis.promoted_recurrences;

        const elBudg = document.getElementById('kpiBudgets');
        if (elBudg) elBudg.textContent = kpis.budget_mutations;

        this.updateSummaryPills();
    },

    onThresholdSliderChange(val) {
        const valBadge = document.getElementById('thresholdValBadge');
        if (valBadge) valBadge.textContent = `${val}%`;
    },

    async saveThreshold(val) {
        try {
            const num = parseFloat(val);
            await API.put('/api/autopilot/threshold', { threshold: num });
            showToast(`Seuil de tolérance fixé à ${num}%`, 'success');
            await this.loadStatus();
        } catch (e) {
            showToast('Erreur mise à jour seuil', 'error');
        }
    },

    async toggleMasterSwitch(enabled) {
        try {
            const status = await API.post('/api/autopilot/toggle', { enabled });
            this._status = status;
            this.renderStatus(status);
            showToast(enabled ? 'Mode Auto-Pilote activé' : 'Mode Auto-Pilote désactivé', 'info');
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
        } catch (e) {
            showToast('Erreur lors du basculement Auto-Pilote', 'error');
            await this.loadStatus();
        }
    },

    async loadDecisions() {
        const feed = document.getElementById('apDecisionsFeed');
        if (!feed) return;

        try {
            const params = new URLSearchParams({
                limit: this._pageSize,
                offset: this._currentPage * this._pageSize,
                show_undone: this._showUndone ? 'true' : 'false'
            });
            if (this._filterType) params.append('decision_type', this._filterType);
            if (this._filterBatch) params.append('batch_id', this._filterBatch);

            const res = await API.get(`/api/autopilot/decisions?${params.toString()}`);
            this._decisions = res.items || [];
            this._totalDecisions = res.total || 0;
            this.renderDecisions();
            this.updatePagination();
        } catch (e) {
            feed.innerHTML = `<div style="text-align:center; padding:30px; color:#ef4444;">Erreur de chargement du flux de décisions.</div>`;
        }
    },

    renderDecisions() {
        const feed = document.getElementById('apDecisionsFeed');
        if (!feed) return;

        if (this._decisions.length === 0) {
            feed.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <span style="font-size: 32px; display: block; margin-bottom: 8px;">✨</span>
                    <div style="font-weight: 600;" data-i18n="autopilot_no_decisions">${window.i18n.t('autopilot_no_decisions') || 'Aucune décision enregistrée dans ce filtre.'}</div>
                    <div style="font-size: 12px; margin-top: 4px;">Les futures opérations traitées automatiquement apparaîtront ici.</div>
                </div>
            `;
            return;
        }

        // Group decisions by batch_id
        const batches = {};
        for (const d of this._decisions) {
            const bid = d.batch_id || 'unbatched';
            if (!batches[bid]) batches[bid] = [];
            batches[bid].push(d);
        }

        let html = '';
        for (const [batchId, items] of Object.entries(batches)) {
            const first = items[0];
            const batchDate = first.created_at ? new Date(first.created_at).toLocaleString() : '';
            const isAllUndone = items.every(x => x.is_undone);

            html += `
                <div class="ap-batch-card" id="apBatch_${escapeHtml(batchId)}" data-batch-id="${escapeHtml(batchId)}" style="opacity: ${isAllUndone ? '0.6' : '1'};">
                    <div class="ap-batch-header" onclick="window.AutopilotView.toggleBatch('${escapeHtml(batchId)}')">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span class="ap-batch-chevron">▾</span>
                            <span style="font-size: 14px;">📦</span>
                            <span style="font-weight: 700; font-size: 12.5px; font-family: monospace;">Lot ${batchId.substring(0, 8)}...</span>
                            <span style="font-size: 11.5px; color: var(--text-muted);">${batchDate}</span>
                            <span class="badge" style="font-size: 10px; padding: 2px 8px; border-radius: 10px; background: rgba(99,102,241,0.1); color: var(--accent);">${items.length} action(s)</span>
                        </div>
                        <div onclick="event.stopPropagation()">
                            ${!isAllUndone && batchId !== 'unbatched' ? `
                                <button class="btn btn-danger btn-sm" style="font-size: 11px; padding: 3px 8px;" data-batch-id="${escapeHtml(batchId)}" onclick="window.AutopilotView.onRollbackCycleClick(this)">
                                    ↺ Annuler tout le lot
                                </button>
                            ` : (isAllUndone ? `<span style="font-size: 11px; color: #ef4444; font-style: italic;">Lot annulé</span>` : '')}
                        </div>
                    </div>
                    <div class="ap-batch-body" style="padding: 10px 16px;">
                        ${items.map(d => this._renderDecisionItem(d)).join('')}
                    </div>
                </div>
            `;
        }

        feed.innerHTML = html;
        window.i18n.translateDOM(feed);
    },

    _renderDecisionItem(d) {
        const score = d.confidence_score !== null ? Math.round(d.confidence_score) : null;
        let scoreBadge = '';
        if (score !== null) {
            const color = score >= 90 ? '#10b981' : (score >= 80 ? 'var(--accent)' : '#f59e0b');
            scoreBadge = `<span style="font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 6px; background: ${color}22; color: ${color}; border: 1px solid ${color}44;">${score}%</span>`;
        }

        const typeLabels = {
            reconciliation: '🔗 Rapprochement',
            new_entry: '✍️ Écriture créée',
            recurrence_promotion: '🔄 Récurrence promue',
            recurrence_hike: '📈 Hausse tarifaire',
            budget_suggestion: '🎯 Recalibrage Budget',
            budget_creation_suggestion: '✨ Création Enveloppe',
            budget_recurrence_sync: '🔄 Sync Budget-Récurrence',
        };
        const typeLabel = typeLabels[d.decision_type] || d.decision_type;

        const isUndone = d.is_undone;
        
        // Customized display for amounts depending on decision type
        let amtDisplay = `${d.amount >= 0 ? '+' : ''}${d.amount.toFixed(2)} €`;
        let amtColor = d.amount < 0 ? 'var(--text-main)' : '#10b981';

        if (d.decision_type === 'budget_suggestion' && d.details && d.details.suggested_amount !== undefined) {
            const cur = d.details.current_amount !== undefined ? Number(d.details.current_amount).toFixed(2) : null;
            const sug = Number(d.details.suggested_amount).toFixed(2);
            const deltaPct = d.details.delta_pct !== undefined ? d.details.delta_pct : null;
            amtColor = deltaPct !== null && deltaPct > 0 ? '#10b981' : (deltaPct !== null && deltaPct < 0 ? '#f59e0b' : 'var(--text-main)');
            amtDisplay = cur !== null
                ? `<span style="font-size: 11px; opacity: 0.7; font-weight: normal;">${cur} € ➔</span> ${sug} €`
                : `${sug} €`;
            if (deltaPct !== null) {
                amtDisplay += ` <span style="font-size: 10px; opacity: 0.85;">(${deltaPct > 0 ? '+' : ''}${deltaPct}%)</span>`;
            }
        } else if (d.decision_type === 'recurrence_hike' && d.details && d.details.new_amount !== undefined) {
            const oldAmt = d.details.old_amount !== undefined ? Number(d.details.old_amount).toFixed(2) : null;
            const newAmt = Number(d.details.new_amount).toFixed(2);
            amtDisplay = oldAmt !== null
                ? `<span style="font-size: 11px; opacity: 0.7; font-weight: normal;">${oldAmt} € ➔</span> ${newAmt} €`
                : `${newAmt} €`;
            amtColor = '#10b981';
        }

        return `
            <div class="ap-decision-row" style="display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--border-color); gap: 12px; opacity: ${isUndone ? '0.5' : '1'};">
                <div style="display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0;">
                    <span style="font-size: 11.5px; font-weight: 600; color: var(--text-muted); min-width: 130px;">${typeLabel}</span>
                    <div style="flex: 1; min-width: 0;">
                        <div style="font-size: 13px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                            ${escapeHtml(d.label || 'Sans libellé')}
                            ${d.raw_label && d.raw_label !== d.label ? `<span style="font-size: 11px; color: var(--text-muted); font-weight: normal; margin-left: 6px;">(${escapeHtml(d.raw_label)})</span>` : ''}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; margin-top: 2px;">
                            <span>🏷️ ${escapeHtml(d.category || '—')}</span>
                            ${d.account_name ? `<span>🏦 ${escapeHtml(d.account_name)}</span>` : ''}
                            ${d.reason ? `<span class="ap-reason-badge">Raison: ${escapeHtml(d.reason)}</span>` : ''}
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 13.5px; font-weight: 700; color: ${amtColor}; min-width: 80px; text-align: right;">${amtDisplay}</span>
                    ${scoreBadge}
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 7px;" onclick="window.AutopilotView.inspectDecisionEntity(${d.id})" title="${window.i18n.t('autopilot_inspect_item') || 'Localiser l\'élément concerné'}">
                            🔍
                        </button>
                        ${isUndone ? `
                            <span class="badge" style="font-size: 10px; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid #ef4444;">Annulé</span>
                        ` : `
                            <div style="display: flex; gap: 6px;">
                                ${d.entity_type === 'transaction' && d.decision_type === 'reconciliation' ? `
                                    <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 7px;" onclick="window.AutopilotView.unpointDecision(${d.id}, this)" title="Dépointer la transaction">
                                        🔓 Dépointer
                                    </button>
                                ` : `
                                    <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 7px;" onclick="window.AutopilotView.rollbackDecision(${d.id}, this)" title="Annuler cette décision">
                                        ↺ Annuler
                                    </button>
                                `}
                                ${d.entity_type === 'transaction' ? `
                                    <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 7px;" data-decision-id="${d.id}" data-label="${escapeHtml(d.label || '')}" data-category="${escapeHtml(d.category || '')}" data-amount="${d.amount}" onclick="window.AutopilotView.onOverrideClick(this)" title="Modifier et apprendre">
                                        ✏️
                                    </button>
                                ` : ''}
                            </div>
                        `}
                    </div>
                </div>
            </div>
        `;
    },

    inspectDecisionEntity(decisionId) {
        const d = this._decisions.find(x => x.id === decisionId);
        if (!d) return;

        const snap = d.details || {};
        const entityType = d.entity_type;
        const decisionType = d.decision_type;

        if (entityType === 'transaction' || decisionType === 'reconciliation' || decisionType === 'new_entry') {
            const txId = d.entity_id || snap.created_tx_id || snap.matched_db_id || (snap.bank_tx && snap.bank_tx.matched_db_id);
            if (!txId) {
                showToast(window.i18n.t('autopilot_inspect_tx_not_found') || 'Identifiant de transaction introuvable.', 'warning');
                return;
            }
            if (window.AllOperationsView) window.AllOperationsView._pendingHighlightTxId = txId;
            if (window.TimelineView) window.TimelineView._pendingHighlightTxId = txId;
            if (window.OverviewView) window.OverviewView._pendingHighlightTxId = txId;
            if (window.app && typeof window.app.loadView === 'function') {
                window.app.loadView('all_operations');
            }
        } else if (entityType === 'budget' || (decisionType && decisionType.startsWith('budget_'))) {
            const budgetId = d.entity_id || snap.budget_id;
            const budgetName = snap.budget_name || d.label;
            if (window.BudgetsView) {
                window.BudgetsView._pendingHighlightId = budgetId;
                window.BudgetsView._pendingHighlightName = budgetName;
            }
            if (window.app && typeof window.app.loadView === 'function') {
                window.app.loadView('budgets');
            }
        } else if (entityType === 'recurrence' || (decisionType && decisionType.startsWith('recurrence_'))) {
            const templateId = d.entity_id || snap.template_id;
            if (window.RecurrenceView) {
                window.RecurrenceView._pendingHighlightTemplateId = templateId;
            }
            if (window.app && typeof window.app.loadView === 'function') {
                window.app.loadView('recurrences');
                setTimeout(() => {
                    if (window.RecurrenceView && typeof window.RecurrenceView.scrollToAndHighlightTemplate === 'function') {
                        window.RecurrenceView.scrollToAndHighlightTemplate(templateId);
                    }
                }, 250);
            }
        } else {
            showToast(window.i18n.t('autopilot_inspect_unknown') || 'Type d\'élément non navigable directement.', 'info');
        }
    },

    updatePagination() {
        const info = document.getElementById('apPaginationInfo');
        const prevBtn = document.getElementById('apPrevPageBtn');
        const nextBtn = document.getElementById('apNextPageBtn');

        const totalPages = Math.ceil(this._totalDecisions / this._pageSize) || 1;
        if (info) {
            info.textContent = `Page ${this._currentPage + 1} sur ${totalPages} (${this._totalDecisions} décision(s))`;
        }
        if (prevBtn) prevBtn.disabled = (this._currentPage <= 0);
        if (nextBtn) nextBtn.disabled = (this._currentPage >= totalPages - 1);
    },

    prevPage() {
        if (this._currentPage > 0) {
            this._currentPage--;
            this.loadDecisions();
        }
    },

    nextPage() {
        const totalPages = Math.ceil(this._totalDecisions / this._pageSize) || 1;
        if (this._currentPage < totalPages - 1) {
            this._currentPage++;
            this.loadDecisions();
        }
    },

    onFilterChange() {
        const typeSelect = document.getElementById('feedFilterType');
        const undoneCheckbox = document.getElementById('feedShowUndone');
        this._filterType = typeSelect ? typeSelect.value : '';
        this._showUndone = undoneCheckbox ? undoneCheckbox.checked : true;
        this._currentPage = 0;
        this.loadDecisions();
    },

    async rollbackDecision(decisionId, btn) {
        showInlineConfirm(btn, 'Confirmer l\'annulation de cette décision ?', async () => {
            try {
                const res = await API.post(`/api/autopilot/decisions/${decisionId}/rollback`, {});
                showToast(res.message || 'Décision annulée', 'success');
                await this.refresh();
                window.dispatchEvent(new CustomEvent('autopilot_updated'));
            } catch (e) {
                showToast('Échec de l\'annulation', 'error');
            }
        });
    },

    async unpointDecision(decisionId, btn) {
        showInlineConfirm(btn, 'Dépointer cette transaction et rétablir la prévision ?', async () => {
            try {
                const res = await API.post(`/api/autopilot/decisions/${decisionId}/unpoint`, {});
                showToast(res.message || 'Transaction dépointée', 'success');
                await this.refresh();
                window.dispatchEvent(new CustomEvent('autopilot_updated'));
            } catch (e) {
                showToast('Échec du dépointage', 'error');
            }
        });
    },

    async rollbackCycle(batchId, btn) {
        showInlineConfirm(btn, `Annuler l'intégralité du lot ${batchId.substring(0, 8)} et le renvoyer dans le Sas d'attente ?`, async () => {
            try {
                const res = await API.post(`/api/autopilot/rollback-cycle/${batchId}`, {});
                showToast(res.message || 'Lot annulé et renvoyé dans le Sas', 'success');
                await this.refresh();
                window.dispatchEvent(new CustomEvent('autopilot_updated'));
            } catch (e) {
                showToast('Échec du rollback de lot', 'error');
            }
        });
    },

    onRollbackCycleClick(btn) {
        const batchId = btn.dataset.batchId;
        if (batchId) {
            this.rollbackCycle(batchId, btn);
        }
    },

    onOverrideClick(btn) {
        const decisionId = parseInt(btn.dataset.decisionId);
        const label = btn.dataset.label || '';
        const category = btn.dataset.category || '';
        const amount = parseFloat(btn.dataset.amount) || 0;
        this.openOverrideModal(decisionId, label, category, amount);
    },

    async openOverrideModal(decisionId, label, category, amount) {
        const modal = document.getElementById('apOverrideModal');
        if (!modal) return;
        document.getElementById('overrideDecisionId').value = decisionId;
        document.getElementById('overrideDescription').value = label || '';
        document.getElementById('overrideAmount').value = Math.abs(amount || 0);
        
        const checkEl = document.getElementById('overrideLearnRule');
        if (checkEl) checkEl.checked = true;

        // Ensure categories list is loaded for CategoryPicker
        if (!window.app?.categoriesList || window.app.categoriesList.length === 0) {
            try {
                window.app = window.app || {};
                window.app.categoriesList = await API.get('/api/categories/');
            } catch (e) {
                window.app.categoriesList = [];
            }
        }

        // Determine direction and allowed types
        let isDebit = (amount < 0);
        if (window.CategoryPicker && typeof window.CategoryPicker._findCategory === 'function') {
            const catObj = window.CategoryPicker._findCategory(category);
            if (catObj) {
                if (catObj.type === 'expense_var' || catObj.type === 'expense_fixed') isDebit = true;
                else if (catObj.type === 'income') isDebit = false;
            }
        }
        const allowedTypes = isDebit ? ['expense_var', 'expense_fixed'] : ['income'];
        const direction = isDebit ? 'debit' : 'credit';

        // Render CategoryPicker trigger into container
        const catContainer = document.getElementById('overrideCategoryContainer');
        if (catContainer && window.CategoryPicker) {
            catContainer.innerHTML = window.CategoryPicker.renderTriggerHtml({
                id: 'overrideCategory',
                value: category || '',
                allowedTypes: allowedTypes,
                direction: direction,
                inputClass: 'input-styled',
                placeholder: window.i18n ? (window.i18n.t('cat_picker_select') || '-- Catégorie --') : '-- Catégorie --'
            });
            window.CategoryPicker.setValue('overrideCategory', category || '', false);
        } else if (catContainer) {
            catContainer.innerHTML = `
                <input type="text" id="overrideCategory" class="input-styled" value="${escapeHtml(category || '')}" placeholder="Catégorie">
            `;
        }

        modal.style.display = 'flex';

        // Keyboard handler (Escape to close)
        if (this._overrideEscHandler) {
            window.removeEventListener('keydown', this._overrideEscHandler);
        }
        this._overrideEscHandler = (e) => {
            const catPop = document.getElementById('categoryPickerPopover');
            if (catPop && catPop.style.display !== 'none') {
                return;
            }
            if (e.key === 'Escape') {
                this.closeOverrideModal();
            }
        };
        window.addEventListener('keydown', this._overrideEscHandler);

        // Autofocus and select description
        setTimeout(() => {
            const input = document.getElementById('overrideDescription');
            if (input) {
                input.focus();
                input.select();
            }
        }, 50);
    },

    closeOverrideModal() {
        const modal = document.getElementById('apOverrideModal');
        if (modal) modal.style.display = 'none';
        if (window.CategoryPicker) {
            window.CategoryPicker.close();
        }
        if (this._overrideEscHandler) {
            window.removeEventListener('keydown', this._overrideEscHandler);
            this._overrideEscHandler = null;
        }
    },

    async classifyOverrideWithAI(btnEl) {
        const descInput = document.getElementById('overrideDescription');
        const rawLabel = descInput ? descInput.value.trim() : '';
        if (!rawLabel) {
            showToast(window.i18n ? (window.i18n.t('smart_label_enter_name_first') || 'Veuillez saisir un libellé à classifier') : 'Veuillez saisir un libellé à classifier', 'warning');
            return;
        }

        const origHtml = btnEl ? btnEl.innerHTML : '✨';
        if (btnEl) {
            btnEl.innerHTML = '⏳';
            btnEl.disabled = true;
        }

        try {
            const res = await API.post('/api/smart-labels/simulate', {
                raw_label: rawLabel,
                use_ai_fallback: true
            });

            if (res) {
                if (res.description && descInput) {
                    descInput.value = res.description;
                }
                if (res.category && window.CategoryPicker) {
                    window.CategoryPicker.setValue('overrideCategory', res.category, true);
                }
                showToast(window.i18n ? (window.i18n.t('smart_label_ai_suggested') || 'Classification IA appliquée') : 'Classification IA appliquée', 'success');
            }
        } catch (e) {
            showToast('Erreur lors de la suggestion IA', 'error');
        } finally {
            if (btnEl) {
                btnEl.innerHTML = origHtml;
                btnEl.disabled = false;
            }
        }
    },

    async submitOverride() {
        const decisionId = document.getElementById('overrideDecisionId').value;
        const newDescription = document.getElementById('overrideDescription').value.trim();
        const newCategory = document.getElementById('overrideCategory').value.trim();
        const newAmount = parseFloat(document.getElementById('overrideAmount').value);
        const learnRule = document.getElementById('overrideLearnRule')?.checked ?? true;
        const submitBtn = document.getElementById('btnSubmitOverride');

        if (!decisionId) return;

        try {
            if (submitBtn) {
                submitBtn.disabled = true;
                submitBtn.classList.add('is-loading');
            }
            const res = await API.post(`/api/autopilot/decisions/${decisionId}/override`, {
                new_description: newDescription || null,
                new_category: newCategory || null,
                new_amount: isNaN(newAmount) ? null : newAmount,
                learn_rule: learnRule
            });
            showToast(res.message || (window.i18n ? window.i18n.t('autopilot_override_success') : 'Opération mise à jour et règle apprise'), 'success');
            this.closeOverrideModal();
            await this.refresh();
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
            window.dispatchEvent(new CustomEvent('transactions_updated'));
        } catch (e) {
            showToast('Erreur lors de la modification', 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.classList.remove('is-loading');
            }
        }
    },

    async loadLearnedRules() {
        const list = document.getElementById('apLearnedRulesList');
        if (!list) return;

        try {
            const rules = await API.get('/api/smart-labels/mappings');
            this._learnedRules = rules || [];
            this.renderLearnedRules();
        } catch (e) {
            list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);">Aucune règle apprise pour l'instant.</div>`;
        }
    },

    renderLearnedRules() {
        const list = document.getElementById('apLearnedRulesList');
        if (!list) return;

        if (this._learnedRules.length === 0) {
            list.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12.5px;">
                    Aucune règle de correspondance enregistrée. Les règles s'apprennent automatiquement dès que vous validez ou modifiez des opérations.
                </div>
            `;
            return;
        }

        list.innerHTML = `
            <table class="table" style="width: 100%; font-size: 12px; margin-top: 6px;">
                <thead>
                    <tr style="text-align: left; color: var(--text-muted); border-bottom: 1px solid var(--border-color);">
                        <th style="padding: 6px 8px;">Motif Brut Détecté</th>
                        <th style="padding: 6px 8px;">Libellé Propre</th>
                        <th style="padding: 6px 8px;">Catégorie</th>
                        <th style="padding: 6px 8px; text-align: right;">Origine</th>
                    </tr>
                </thead>
                <tbody>
                    ${this._learnedRules.slice(0, 15).map(r => `
                        <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                            <td style="padding: 6px 8px; font-family: monospace; color: var(--text-muted);">${escapeHtml(r.raw_pattern || '')}</td>
                            <td style="padding: 6px 8px; font-weight: 600;">${escapeHtml(r.clean_label || r.clean_description || '—')}</td>
                            <td style="padding: 6px 8px;"><span class="badge" style="font-size: 10.5px;">${escapeHtml(r.category || '—')}</span></td>
                            <td style="padding: 6px 8px; text-align: right; color: var(--text-muted);">${r.is_manual ? 'Manuel' : 'Auto-Appris'}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        this.updateSummaryPills();
    },

    toggleSection(key) {
        const sectionMap = {
            kpis: 'apKpiSection',
            config: 'apConfigSection',
            workshop: 'apWorkshopSection',
        };
        const elId = sectionMap[key];
        const el = document.getElementById(elId);
        if (!el) return;
        const isCollapsed = el.classList.toggle('collapsed');
        try {
            localStorage.setItem('autopilot_collapse_' + key, isCollapsed ? '1' : '0');
        } catch (e) {}
    },

    initCollapsibleSections() {
        const sections = ['kpis', 'config', 'workshop'];
        sections.forEach(key => {
            const sectionMap = {
                kpis: 'apKpiSection',
                config: 'apConfigSection',
                workshop: 'apWorkshopSection',
            };
            const el = document.getElementById(sectionMap[key]);
            if (!el) return;
            const saved = localStorage.getItem('autopilot_collapse_' + key);
            // Default: workshop is collapsed by default, kpis & config are open by default
            const shouldCollapse = (saved !== null) ? (saved === '1') : (key === 'workshop');
            el.classList.toggle('collapsed', shouldCollapse);
        });
        this.updateSummaryPills();
    },

    updateSummaryPills() {
        // KPI pill
        const kpiPill = document.getElementById('apKpiSummaryPill');
        if (kpiPill && this._kpis) {
            kpiPill.textContent = `🎯 ${this._kpis.accuracy_rate}% Précision • ⏱️ ${this._kpis.hours_saved_estimate}h Épargnées`;
        }
        // Config pill
        const cfgPill = document.getElementById('apConfigSummaryPill');
        if (cfgPill && this._status) {
            let activeCount = 0;
            let totalCount = 0;
            if (this._status.managed_subtoggles) {
                const vals = Object.values(this._status.managed_subtoggles);
                totalCount = vals.length;
                activeCount = vals.filter(Boolean).length;
            }
            cfgPill.textContent = `🎯 Seuil : ${this._status.threshold || 85}% • ${activeCount}/${totalCount} briques actives`;
        }
        // Workshop pill
        const wPill = document.getElementById('apWorkshopSummaryPill');
        if (wPill) {
            const count = (this._learnedRules || []).length;
            wPill.textContent = `${count} règle${count > 1 ? 's' : ''} active${count > 1 ? 's' : ''}`;
        }
    },

    _allBatchesCollapsed: false,
    toggleAllBatches() {
        this._allBatchesCollapsed = !this._allBatchesCollapsed;
        const cards = document.querySelectorAll('.ap-batch-card');
        cards.forEach(card => card.classList.toggle('collapsed', this._allBatchesCollapsed));
        const btn = document.getElementById('apToggleAllBatchesBtn');
        if (btn) {
            btn.textContent = this._allBatchesCollapsed ? 'Déplier les lots' : 'Replier les lots';
        }
    },

    toggleBatch(batchId) {
        const card = document.getElementById(`apBatch_${batchId}`);
        if (card) {
            card.classList.toggle('collapsed');
        }
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
