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
    _drawerEscHandler: null,
    _subtogglesDef: [
        {
            category: 'Opérations & Ingestion',
            icon: '📥',
            items: [
                {
                    key: 'auto_reconcile_transactions',
                    label: 'Auto-Rapprochement haute certitude',
                    desc: 'Pointe et réconcilie automatiquement les écritures bancaires avec vos prévisions lorsque le score de confiance atteint le seuil.'
                },
                {
                    key: 'auto_commit_incoming_transactions',
                    label: 'Enregistrement direct des écritures',
                    desc: 'Intègre immédiatement les opérations confirmées en base pour garantir l\'alignement strict du solde bancaire.'
                },
                {
                    key: 'auto_assign_chameleon_fallback',
                    label: 'Catégorisation repli / caméléon',
                    desc: 'Assigne une catégorie de repli temporaire sécurisée pour les marchands inconnus afin de ne bloquer aucun flux.'
                },
                {
                    key: 'auto_close_empty_import_sas',
                    label: 'Fermeture automatique du Sas d\'attente',
                    desc: 'Clôture automatiquement le sas d\'import dès que l\'ensemble des écritures du lot ont été traitées.'
                },
                {
                    key: 'bank_auto_sync_enabled',
                    label: 'Synchronisation bancaire en arrière-plan',
                    desc: 'Effectue le relevé bancaire périodique autonome (12h/24h/48h) lorsque le coffre-fort est déverrouillé.'
                }
            ]
        },
        {
            category: 'Marchands & Catégories',
            icon: '🏷️',
            items: [
                {
                    key: 'auto_learn_merchant_rules',
                    label: 'Apprentissage autonome des marchands',
                    desc: 'Mémorise automatiquement vos arbitrages dans les règles marchands pour classifier sans faille les prochains relevés.'
                },
                {
                    key: 'auto_create_missing_categories',
                    label: 'Création autonome des catégories',
                    desc: 'Crée automatiquement les catégories détectées lors de l\'enrichissement des flux bancaires.'
                }
            ]
        },
        {
            category: 'Récurrences & Abonnements',
            icon: '🔄',
            items: [
                {
                    key: 'auto_link_deviant_recurrences',
                    label: 'Rapprochement déviant tolérant',
                    desc: 'Rapproche les prélèvements récurrents dont le montant fluctue dans une fourchette tolérée de ±15%.'
                },
                {
                    key: 'auto_propagate_recurrence_hikes',
                    label: 'Propagation automatique des hausses',
                    desc: 'Ajuste le montant prévisionnel d\'un abonnement lorsqu\'une hausse tarifaire est constatée sur 3 échéances consécutives.'
                },
                {
                    key: 'auto_skip_unreconciled_recurrences',
                    label: 'Saut d\'échéance automatique',
                    desc: 'Marque comme passée toute échéance récurrente non constatée à la fin du mois sans altérer le template.'
                },
                {
                    key: 'auto_close_unreconciled_recurrences',
                    label: 'Clôture après échéances manquées',
                    desc: 'Désactive automatiquement un abonnement récurrent après N échéances consécutives jamais prélevées.'
                }
            ]
        },
        {
            category: 'Budgets & Enveloppes',
            icon: '📊',
            items: [
                {
                    key: 'enable_budget_creation_suggestions',
                    label: 'Suggestions de nouvelles enveloppes',
                    desc: 'Analyse vos dépenses réelles pour proposer la création d\'enveloppes sur vos postes récurrents.'
                },
                {
                    key: 'enable_budget_recalibration_suggestions',
                    label: 'Suggestions de recalibrage mensuel',
                    desc: 'Calcule des propositions d\'ajustement lissé (filtre EMA 3-6 mois) pour vos budgets sous ou sur-consommés.'
                },
                {
                    key: 'auto_create_budget_envelopes',
                    label: 'Création 100% autonome des enveloppes',
                    desc: 'Valide et crée immédiatement les enveloppes suggérées sans attendre votre approbation manuelle.'
                },
                {
                    key: 'auto_apply_budget_suggestions',
                    label: 'Application 100% autonome des recalibrages',
                    desc: 'Applique automatiquement les nouveaux plafonds budgétaires calculés au 1er de chaque mois.'
                }
            ]
        }
    ],

    render() {
        return `
            <div class="autopilot-container" style="max-width: 1440px; width: 100%; margin: 0 auto; padding-bottom: 40px;">
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
                    <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                        <button class="btn btn-secondary" onclick="window.AutopilotView.openSettingsDrawer()" title="Configurer les 15 briques et le seuil" style="display: flex; align-items: center; gap: 6px; font-weight: 600; font-size: 12.5px;">
                            <span>⚙️</span> <span>Réglages & Briques</span> <span id="apActiveBriquesBadge" class="badge" style="font-size: 10.5px; background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid var(--accent); padding: 1px 6px; border-radius: 8px;">--/15</span>
                        </button>
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

                <!-- Split Cockpit Layout : 2 Colonnes -->
                <div class="ap-cockpit-layout" style="display: grid; grid-template-columns: 280px 1fr; gap: 20px; align-items: start;">
                    <!-- COLONNE GAUCHE (280px) : KPIs Hero Verticaux -->
                    <div class="ap-left-column" style="display: flex; flex-direction: column; gap: 14px;">
                        <div style="background: var(--bg-card, var(--bg-surface)); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                                <span style="font-size: 16px;">📊</span>
                                <h3 style="font-size: 12.5px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; margin: 0; color: var(--text-main);">
                                    Indicateurs & Performance
                                </h3>
                            </div>
                            <p style="font-size: 11px; color: var(--text-muted); margin: 0 0 16px 0; line-height: 1.4;">
                                Taux de précision, temps épargné et volume des actions automatisées
                            </p>

                            <div style="display: flex; flex-direction: column; gap: 10px;">
                                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; text-align: center;">
                                    <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_accuracy">${window.i18n.t('autopilot_kpi_accuracy') || 'Taux de Précision'}</div>
                                    <div id="kpiAccuracy" style="font-size: 26px; font-weight: 800; color: #10b981; margin: 6px 0 2px;">--%</div>
                                    <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_accuracy_sub">${window.i18n.t('autopilot_kpi_accuracy_sub') || 'décisions sans rejet'}</div>
                                </div>
                                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; text-align: center;">
                                    <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_hours_saved">${window.i18n.t('autopilot_kpi_hours_saved') || 'Temps Épargné'}</div>
                                    <div id="kpiHoursSaved" style="font-size: 26px; font-weight: 800; color: var(--accent); margin: 6px 0 2px;">-- h</div>
                                    <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_hours_saved_sub">${window.i18n.t('autopilot_kpi_hours_saved_sub') || 'de saisie évitée'}</div>
                                </div>
                                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; text-align: center;">
                                    <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_reconciled">${window.i18n.t('autopilot_kpi_reconciled') || 'Rapprochements'}</div>
                                    <div id="kpiReconciled" style="font-size: 26px; font-weight: 800; color: var(--text-main); margin: 6px 0 2px;">0</div>
                                    <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_reconciled_sub">${window.i18n.t('autopilot_kpi_reconciled_sub') || 'pointages validés'}</div>
                                </div>
                                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; text-align: center;">
                                    <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_committed">${window.i18n.t('autopilot_kpi_committed') || 'Nouvelles Écritures'}</div>
                                    <div id="kpiCommitted" style="font-size: 26px; font-weight: 800; color: var(--text-main); margin: 6px 0 2px;">0</div>
                                    <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_committed_sub">${window.i18n.t('autopilot_kpi_committed_sub') || 'insérées automatiquement'}</div>
                                </div>
                                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; text-align: center;">
                                    <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_recurrences">${window.i18n.t('autopilot_kpi_recurrences') || 'Récurrences Promues'}</div>
                                    <div id="kpiRecurrences" style="font-size: 26px; font-weight: 800; color: var(--text-main); margin: 6px 0 2px;">0</div>
                                    <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_recurrences_sub">${window.i18n.t('autopilot_kpi_recurrences_sub') || 'abonnements détectés'}</div>
                                </div>
                                <div class="kpi-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; text-align: center;">
                                    <div style="font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="autopilot_kpi_budgets">${window.i18n.t('autopilot_kpi_budgets') || 'Mutations Budgets'}</div>
                                    <div id="kpiBudgets" style="font-size: 26px; font-weight: 800; color: var(--text-main); margin: 6px 0 2px;">0</div>
                                    <div style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_kpi_budgets_sub">${window.i18n.t('autopilot_kpi_budgets_sub') || 'enveloppes synchronisées'}</div>
                                </div>
                            </div>

                            <div style="margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border-color); font-size: 11.5px; color: var(--text-muted); line-height: 1.5;">
                                <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                                    <span>Dernier cycle :</span>
                                    <strong id="apLastExecTime" style="color: var(--text-main);">--</strong>
                                </div>
                                <div style="display: flex; justify-content: space-between;">
                                    <span>Prochain relevé :</span>
                                    <strong id="apNextExecTime" style="color: var(--text-main);">--</strong>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- COLONNE DROITE (1fr) : Tables et Données -->
                    <div class="ap-right-column" style="display: flex; flex-direction: column; gap: 20px; min-width: 0;">
                        <!-- Section 2.5 : Opérations à vérifier (Revue manuelle) -->
                        <div id="apReviewSection" class="ap-collapsible-card" style="border: 1px solid rgba(245, 158, 11, 0.35); background: var(--bg-card, var(--bg-surface));">
                            <div class="ap-collapsible-header" onclick="window.AutopilotView.toggleSection('review')">
                                <div class="ap-collapsible-title-group">
                                    <span class="ap-collapsible-icon">🔍</span>
                                    <div>
                                        <h3 class="ap-collapsible-title" data-i18n="autopilot_review_title">
                                            ${window.i18n.t('autopilot_review_title') || 'Opérations à vérifier (Revue manuelle)'}
                                        </h3>
                                        <p class="ap-collapsible-subtitle" data-i18n="autopilot_review_subtitle">
                                            ${window.i18n.t('autopilot_review_subtitle') || 'Ces écritures ont été intégrées pour synchroniser vos soldes, mais nécessitent votre confirmation (confiance < seuil ou motif caméléon).'}
                                        </p>
                                    </div>
                                </div>
                                <div class="ap-collapsible-actions">
                                    <span id="apReviewSummaryPill" class="ap-summary-pill" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">0 à vérifier</span>
                                    <span id="apReviewChevron" class="ap-chevron">▾</span>
                                </div>
                            </div>
                            <div id="apReviewContent" class="ap-collapsible-content">
                                <div id="apReviewListContainer" style="padding: 18px 20px;">
                                    <!-- Injected dynamically -->
                                </div>
                            </div>
                        </div>

                        <!-- Section 3 : Decision Feed Section (Main Volet) -->
                        <div class="ap-collapsible-card">
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
                </div>
            </div>

            <!-- Settings Drawer (Option B) -->
            <div id="apSettingsDrawer" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(4px); z-index: 99998; justify-content: flex-end;" onclick="if(event.target === this) window.AutopilotView.closeSettingsDrawer()">
                <div style="background: var(--bg-surface); width: 620px; max-width: 95vw; height: 100%; display: flex; flex-direction: column; box-shadow: -10px 0 30px rgba(0,0,0,0.35); border-left: 1px solid var(--border-color); color: var(--text-main); animation: apDrawerSlideIn 0.22s ease-out;">
                    <!-- Drawer Header -->
                    <div style="padding: 18px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                        <div>
                            <h3 style="margin: 0 0 3px 0; font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
                                <span>⚙️</span> <span>Réglages d'Autonomie & Briques Élémentaires</span>
                            </h3>
                            <p style="margin: 0; font-size: 12px; color: var(--text-muted);">
                                Seuil de tolérance et contrôle individuel des 15 automatismes
                            </p>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.closeSettingsDrawer()" style="padding: 4px 9px; font-size: 15px; border-radius: 8px; line-height: 1;">✕</button>
                    </div>

                    <!-- Drawer Body (Scrollable) -->
                    <div style="flex: 1; overflow-y: auto; padding: 22px 24px; display: flex; flex-direction: column; gap: 20px;">
                        <!-- Block 1 : Seuil de tolérance -->
                        <div style="background: var(--bg-card, var(--bg-surface)); border: 1px solid var(--border-color); border-radius: 12px; padding: 18px;">
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                                <div>
                                    <h4 style="font-size: 13.5px; margin: 0 0 4px 0; font-weight: 700;" data-i18n="autopilot_threshold_title">
                                        🎯 ${window.i18n.t('autopilot_threshold_title') || 'Seuil de Tolérance & Confiance'}
                                    </h4>
                                    <p style="font-size: 11.5px; color: var(--text-muted); margin: 0;" data-i18n="autopilot_threshold_desc">
                                        ${window.i18n.t('autopilot_threshold_desc') || 'Score minimal requis pour exécuter un rapprochement ou une écriture en toute autonomie.'}
                                    </p>
                                </div>
                                <span id="thresholdValBadge" class="badge" style="font-size: 13.5px; font-weight: 800; padding: 4px 10px; border-radius: 8px; background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid var(--accent);">85%</span>
                            </div>
                            <div style="margin: 14px 0 6px;">
                                <input type="range" id="thresholdSlider" min="70" max="99" step="1" value="85" style="width: 100%; cursor: pointer;" oninput="window.AutopilotView.onThresholdSliderChange(this.value)" onchange="window.AutopilotView.saveThreshold(this.value)">
                                <div style="display: flex; justify-content: space-between; font-size: 11px; color: var(--text-muted); margin-top: 6px;">
                                    <span>70% (${window.i18n.t('autopilot_threshold_permissive') || 'Permissif'})</span>
                                    <span>85% (${window.i18n.t('autopilot_threshold_balanced') || 'Équilibré'})</span>
                                    <span>99% (${window.i18n.t('autopilot_threshold_strict') || 'Strict'})</span>
                                </div>
                            </div>
                            <div id="thresholdLiveImpact" style="margin-top: 12px; padding: 10px 14px; background: rgba(99, 102, 241, 0.08); border: 1px dashed rgba(99, 102, 241, 0.3); border-radius: 8px; font-size: 11.5px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
                                <div id="thresholdLiveImpactText" style="color: var(--text-main);">
                                    📊 <span>${window.i18n.t('autopilot_threshold_preview_help') || 'Impact estimé'} : <strong id="previewStatsText">Déplacez le curseur pour simuler</strong></span>
                                </div>
                                <button id="btnApplyThresholdToExisting" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 10px; white-space: nowrap; display: none;" onclick="window.AutopilotView.applyThresholdToExisting()">
                                    ${window.i18n.t('autopilot_threshold_apply_button') || 'Appliquer aux écritures existantes'}
                                </button>
                            </div>
                        </div>

                        <!-- Block 2 : 15 Briques Élémentaires Container -->
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <h4 style="font-size: 13.5px; margin: 0; font-weight: 700;">
                                    🧩 Les 15 Briques d'Autonomie Modulaires
                                </h4>
                                <span style="font-size: 11px; color: var(--text-muted);">Contrôle fin à la carte</span>
                            </div>
                            <div id="apSubtogglesDrawerList">
                                <!-- Injected dynamically by renderSubtogglesInDrawer() -->
                            </div>
                        </div>
                    </div>

                    <!-- Drawer Footer -->
                    <div style="padding: 14px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-base); flex-shrink: 0;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.resetToDefaultSubtoggles()">
                            🔄 Rétablir la sélection recommandée
                        </button>
                        <button type="button" class="btn btn-primary btn-sm" onclick="window.AutopilotView.closeSettingsDrawer()">
                            Fermer
                        </button>
                    </div>
                </div>
            </div>

            <style>
            @media (max-width: 1024px) {
                .ap-cockpit-layout {
                    grid-template-columns: 1fr !important;
                }
            }
            .ap-review-desktop-table {
                display: table;
                width: 100%;
            }
            .ap-review-mobile-cards {
                display: none;
            }
            @media (max-width: 960px) {
                .ap-review-desktop-table {
                    display: none !important;
                }
                .ap-review-mobile-cards {
                    display: flex !important;
                    flex-direction: column;
                    gap: 12px;
                }
            }
            @keyframes apDrawerSlideIn {
                from { transform: translateX(100%); }
                to { transform: translateX(0); }
            }
            </style>

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
                        <input type="hidden" id="overrideMode" value="decision">
                        <input type="hidden" id="overrideDecisionId">
                        <input type="hidden" id="overrideTxId">
                        <input type="hidden" id="overrideTargetForecastId">

                        <!-- Candidats prévisions détectés (mode review) -->
                        <div id="overrideCandidateForecastsContainer" style="display: none; margin-bottom: 16px;"></div>

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

        // If navigating to review a specific transaction
        if (this._pendingReviewTxId) {
            const txIdToOpen = this._pendingReviewTxId;
            this._pendingReviewTxId = null;
            setTimeout(() => {
                const revSec = document.getElementById('apReviewSection');
                if (revSec && revSec.classList.contains('collapsed')) {
                    revSec.classList.remove('collapsed');
                }
                if (revSec) {
                    revSec.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                this.openReviewModal(txIdToOpen);
            }, 300);
        }

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

        window.removeEventListener('transactions_updated', handleRefresh);
        window.addEventListener('transactions_updated', handleRefresh);

        window.removeEventListener('transactions_changed', handleRefresh);
        window.addEventListener('transactions_changed', handleRefresh);
    },

    async refresh() {
        await Promise.all([
            this.loadStatus(),
            this.loadKPIs(),
            this.loadReviewQueue(),
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
                badge.textContent = window.i18n ? (window.i18n.t('autopilot_status_active') || 'ACTIF') : 'ACTIF';
                badge.style.background = 'rgba(16,185,129,0.15)';
                badge.style.color = '#10b981';
                badge.style.border = '1px solid #10b981';
            } else {
                badge.textContent = window.i18n ? (window.i18n.t('autopilot_status_inactive') || 'INACTIF') : 'INACTIF';
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

        const lastExecEl = document.getElementById('apLastExecTime');
        if (lastExecEl) {
            lastExecEl.textContent = status.last_execution ? new Date(status.last_execution).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Récemment';
        }
        const nextExecEl = document.getElementById('apNextExecTime');
        if (nextExecEl) {
            nextExecEl.textContent = status.next_execution ? new Date(status.next_execution).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'À l\'import de relevé';
        }

        this.renderSubtogglesInDrawer();
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

    _thresholdDebounceTimer: null,
    onThresholdSliderChange(val) {
        const valBadge = document.getElementById('thresholdValBadge');
        if (valBadge) valBadge.textContent = `${val}%`;

        clearTimeout(this._thresholdDebounceTimer);
        this._thresholdDebounceTimer = setTimeout(async () => {
            try {
                const res = await API.get(`/api/autopilot/threshold-preview?threshold=${val}`);
                const previewText = document.getElementById('previewStatsText');
                const btnApply = document.getElementById('btnApplyThresholdToExisting');
                if (previewText && res) {
                    const rel = res.becoming_reliable_count || 0;
                    const rev = res.becoming_review_count || 0;
                    previewText.innerHTML = `<strong>${rel}</strong> deviendront fiable(s), <strong>${rev}</strong> nécessiteront une vérification.`;
                }
                if (btnApply) {
                    btnApply.style.display = 'inline-block';
                }
            } catch (e) {
                console.warn('[AutopilotView] Erreur simulation seuil:', e);
            }
        }, 150);
    },

    async applyThresholdToExisting() {
        const slider = document.getElementById('thresholdSlider');
        if (!slider) return;
        const val = parseFloat(slider.value);
        const btn = document.getElementById('btnApplyThresholdToExisting');
        try {
            if (btn) btn.disabled = true;
            const res = await API.put('/api/autopilot/threshold', {
                threshold: val,
                apply_to_existing: true
            });
            const applied = res.applied_count || 0;
            showToast(`Seuil fixé à ${val}%. ${applied} écriture(s) mise(s) à jour.`, 'success');
            await this.refresh();
            if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
                window.app.updateAutopilotBadge();
            }
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
            window.dispatchEvent(new CustomEvent('transactions_updated'));
        } catch (e) {
            showToast('Erreur application seuil aux écritures', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
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

    openSettingsDrawer() {
        const drawer = document.getElementById('apSettingsDrawer');
        if (!drawer) return;
        drawer.style.display = 'flex';
        if (!this._drawerEscHandler) {
            this._drawerEscHandler = (e) => {
                if (e.key === 'Escape') this.closeSettingsDrawer();
            };
            window.addEventListener('keydown', this._drawerEscHandler);
        }
        this.renderSubtogglesInDrawer();
    },

    closeSettingsDrawer() {
        const drawer = document.getElementById('apSettingsDrawer');
        if (drawer) drawer.style.display = 'none';
        if (this._drawerEscHandler) {
            window.removeEventListener('keydown', this._drawerEscHandler);
            this._drawerEscHandler = null;
        }
    },

    renderSubtogglesInDrawer() {
        const container = document.getElementById('apSubtogglesDrawerList');
        if (!container) return;

        const subtoggles = this._status?.managed_subtoggles || {};

        container.innerHTML = (this._subtogglesDef || []).map(group => {
            const groupActiveCount = group.items.filter(it => !!subtoggles[it.key]).length;
            return `
                <div style="background: var(--bg-card, var(--bg-surface)); border: 1px solid var(--border-color); border-radius: 12px; margin-bottom: 16px; overflow: hidden;">
                    <div style="padding: 12px 16px; background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="font-size: 16px;">${group.icon}</span>
                            <span style="font-weight: 700; font-size: 13px; color: var(--text-main);">${group.category}</span>
                        </div>
                        <span class="badge" style="font-size: 10.5px; background: rgba(99,102,241,0.12); color: var(--accent);">
                            ${groupActiveCount}/${group.items.length} actives
                        </span>
                    </div>
                    <div style="padding: 10px 16px; display: flex; flex-direction: column; gap: 10px;">
                        ${group.items.map(item => {
                            const isChecked = !!subtoggles[item.key];
                            return `
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 12.5px; font-weight: 600; color: ${isChecked ? 'var(--text-main)' : 'var(--text-muted)'}; margin-bottom: 2px;">
                                            ${item.label}
                                        </div>
                                        <div style="font-size: 11px; color: var(--text-muted); line-height: 1.35;">
                                            ${item.desc}
                                        </div>
                                    </div>
                                    <label class="switch" style="margin: 0; flex-shrink: 0;">
                                        <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.AutopilotView.toggleSubtoggle('${item.key}', this.checked)">
                                        <span class="slider round"></span>
                                    </label>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }).join('');
    },

    async toggleSubtoggle(key, enabled) {
        try {
            await API.post('/api/autopilot/subtoggle', { key, enabled });
            if (this._status) {
                if (!this._status.managed_subtoggles) this._status.managed_subtoggles = {};
                this._status.managed_subtoggles[key] = enabled;
            }
            this.renderSubtogglesInDrawer();
            this.updateSummaryPills();
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
        } catch (e) {
            console.error('[AutopilotView] Erreur mise à jour subtoggle:', e);
            showToast('Erreur lors de la mise à jour de l\'automatisme', 'error');
            this.renderSubtogglesInDrawer();
        }
    },

    async resetToDefaultSubtoggles() {
        try {
            const allKeys = [];
            (this._subtogglesDef || []).forEach(cat => {
                (cat.items || []).forEach(it => allKeys.push(it.key));
            });
            await Promise.all(allKeys.map(k => API.post('/api/autopilot/subtoggle', { key: k, enabled: true })));
            showToast('Toutes les 15 briques d\'autonomie sont activées', 'success');
            await this.loadStatus();
        } catch (e) {
            showToast('Erreur réinitialisation des briques', 'error');
        }
    },

    async loadReviewQueue() {
        const container = document.getElementById('apReviewListContainer');
        if (!container) return;

        try {
            const res = await API.get('/api/autopilot/review-queue');
            this._reviewQueue = Array.isArray(res) ? res : (res && res.items ? res.items : []);
            this.renderReviewQueue();
        } catch (e) {
            console.warn('[AutopilotView] Erreur chargement file de revue:', e);
            container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">Erreur lors du chargement des opérations à vérifier.</div>`;
        }
    },

    renderReviewQueue() {
        const container = document.getElementById('apReviewListContainer');
        const pill = document.getElementById('apReviewSummaryPill');
        if (!container) return;

        const count = (this._reviewQueue || []).length;
        if (pill) {
            pill.textContent = `${count} à vérifier`;
            pill.style.background = count > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.12)';
            pill.style.color = count > 0 ? '#f59e0b' : '#10b981';
            pill.style.borderColor = count > 0 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)';
        }

        if (count === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
                    ✅ <span>${window.i18n ? (window.i18n.t('autopilot_review_queue_empty') || 'Aucune opération en attente de vérification. Toutes vos opérations intégrées sont fiables.') : 'Aucune opération en attente de vérification.'}</span>
                </div>
            `;
            return;
        }

        container.innerHTML = `
            <div style="overflow-x: auto; width: 100%;">
                <!-- Desktop Table View -->
                <table class="table ap-review-desktop-table" style="width: 100%; min-width: 780px; font-size: 12.5px; border-collapse: separate; border-spacing: 0 6px;">
                    <thead>
                        <tr style="text-align: left; color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; border-bottom: 1px solid var(--border-color);">
                            <th style="padding: 8px 12px; width: 95px;">Date</th>
                            <th style="padding: 8px 12px; width: 140px;">Compte</th>
                            <th style="padding: 8px 12px; min-width: 260px;">Libellé Brut & Identifié</th>
                            <th style="padding: 8px 12px; width: 130px;">Catégorie</th>
                            <th style="padding: 8px 12px; width: 110px; text-align: right;">Montant</th>
                            <th style="padding: 8px 12px; width: 90px; text-align: center;">Confiance</th>
                            <th style="padding: 8px 12px; text-align: right; width: 180px;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${this._reviewQueue.map(item => {
                            const dateStr = typeof formatDate === 'function' ? formatDate(item.date_operation) : (item.date_operation || '');
                            const amtStr = typeof formatCurrency === 'function' ? formatCurrency(item.amount) : `${Number(item.amount || 0).toFixed(2)} €`;
                            const amtColor = item.type === 'income' ? 'var(--color-income, #10b981)' : 'var(--color-expense, #ef4444)';
                            const conf = Math.round(item.confidence_score || 0);
                            const bestCandidate = (item.candidate_forecasts && item.candidate_forecasts.length > 0) ? item.candidate_forecasts[0] : null;

                            return `
                            <tr style="background: var(--bg-surface); border-radius: 8px; transition: background 0.15s ease;">
                                <td style="padding: 12px; white-space: nowrap; font-weight: 500; vertical-align: middle;">
                                    ${dateStr}
                                </td>
                                <td style="padding: 12px; white-space: nowrap; vertical-align: middle;">
                                    <span class="account-badge" style="background:${item.account_color || '#6366f1'}18; color:${item.account_color || '#6366f1'}; border-color:${item.account_color || '#6366f1'}40;">
                                        <span class="acc-badge-dot" style="background:${item.account_color || '#6366f1'};"></span>
                                        ${escapeHtml(item.account_name || 'Compte')}
                                    </span>
                                </td>
                                <td style="padding: 12px; vertical-align: middle;">
                                    <div style="font-weight: 600; font-size: 13px; color: var(--text-main); line-height: 1.3;">${escapeHtml(item.description || item.raw_description || '')}</div>
                                    ${item.raw_description && item.raw_description !== item.description ? `<div style="font-size: 11px; color: var(--text-muted); font-family: monospace; margin-top: 2px;">${escapeHtml(item.raw_description)}</div>` : ''}
                                    ${bestCandidate ? `
                                        <div style="margin-top: 6px; font-size: 11.5px; color: var(--accent); background: rgba(99,102,241,0.08); padding: 4px 10px; border-radius: 6px; border: 1px dashed rgba(99,102,241,0.3); display: inline-flex; align-items: center; gap: 6px; line-height: 1.3;">
                                            <span>💡 Prévision : <strong>${escapeHtml(bestCandidate.description)}</strong> (${Number(bestCandidate.amount).toFixed(2)} €)</span>
                                        </div>
                                    ` : ''}
                                </td>
                                <td style="padding: 12px; white-space: nowrap; vertical-align: middle;">
                                    <span class="badge" style="font-size: 11px; font-weight: 600;">${escapeHtml(item.category || '—')}</span>
                                </td>
                                <td style="padding: 12px; text-align: right; white-space: nowrap; font-weight: 700; font-size: 13.5px; color: ${amtColor}; vertical-align: middle;">
                                    ${amtStr}
                                </td>
                                <td style="padding: 12px; text-align: center; white-space: nowrap; vertical-align: middle;">
                                    <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700; font-size: 11px; padding: 3px 8px; border-radius: 6px;">
                                        ⚠️ ${conf}%
                                    </span>
                                </td>
                                <td style="padding: 12px; text-align: right; white-space: nowrap; vertical-align: middle;">
                                    <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
                                        ${bestCandidate ? `
                                            <div class="candidate-forecast-action" style="display: inline-flex; align-items: center;">
                                                <button class="btn btn-sm" style="background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid var(--accent); padding: 5px 10px; font-size: 11.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;" onclick="window.AutopilotView.promptInlineLinkConfirm(this, ${item.id}, ${bestCandidate.id})" title="Lier à la prévision '${escapeHtml(bestCandidate.description)}' sans créer de doublon">
                                                    <span>🔗 Lier</span>
                                                </button>
                                            </div>
                                        ` : `
                                            <button class="btn btn-secondary btn-sm" style="padding: 5px 10px; font-size: 11.5px; color: #10b981; border-color: rgba(16, 185, 129, 0.3);" onclick="window.AutopilotView.validateReviewItem(${item.id}, this)" title="${window.i18n ? (window.i18n.t('autopilot_review_btn_validate') || 'Valider sans modifier') : 'Valider sans modifier'}">
                                                ✓ ${window.i18n ? (window.i18n.t('autopilot_review_btn_validate') || 'Valider') : 'Valider'}
                                            </button>
                                        `}
                                        <button class="btn btn-primary btn-sm" style="padding: 5px 10px; font-size: 11.5px;" onclick="window.AutopilotView.openReviewModal(${item.id})" title="${window.i18n ? (window.i18n.t('autopilot_review_btn_edit') || 'Corriger libellé / catégorie') : 'Corriger libellé / catégorie'}">
                                            ✏️ ${window.i18n ? (window.i18n.t('autopilot_review_btn_edit') || 'Éditer') : 'Éditer'}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>

                <!-- Mobile Cards View -->
                <div class="ap-review-mobile-cards">
                    ${this._reviewQueue.map(item => {
                        const dateStr = typeof formatDate === 'function' ? formatDate(item.date_operation) : (item.date_operation || '');
                        const amtStr = typeof formatCurrency === 'function' ? formatCurrency(item.amount) : `${Number(item.amount || 0).toFixed(2)} €`;
                        const amtColor = item.type === 'income' ? 'var(--color-income, #10b981)' : 'var(--color-expense, #ef4444)';
                        const conf = Math.round(item.confidence_score || 0);
                        const bestCandidate = (item.candidate_forecasts && item.candidate_forecasts.length > 0) ? item.candidate_forecasts[0] : null;

                        return `
                        <div class="ap-review-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="account-badge" style="background:${item.account_color || '#6366f1'}18; color:${item.account_color || '#6366f1'}; border-color:${item.account_color || '#6366f1'}40; font-size: 11px;">
                                        <span class="acc-badge-dot" style="background:${item.account_color || '#6366f1'};"></span>
                                        ${escapeHtml(item.account_name || 'Compte')}
                                    </span>
                                    <span style="font-size: 11.5px; color: var(--text-muted);">${dateStr}</span>
                                </div>
                                <div style="font-size: 15px; font-weight: 800; color: ${amtColor};">
                                    ${amtStr}
                                </div>
                            </div>

                            <div>
                                <div style="font-weight: 700; font-size: 13.5px; color: var(--text-main);">${escapeHtml(item.description || item.raw_description || '')}</div>
                                ${item.raw_description && item.raw_description !== item.description ? `<div style="font-size: 11px; color: var(--text-muted); font-family: monospace; margin-top: 2px;">${escapeHtml(item.raw_description)}</div>` : ''}
                            </div>

                            ${bestCandidate ? `
                                <div style="background: rgba(99,102,241,0.08); border: 1px dashed rgba(99,102,241,0.3); border-radius: 8px; padding: 8px 10px; font-size: 12px; color: var(--text-main);">
                                    <div style="font-weight: 600; color: var(--accent); margin-bottom: 2px;">💡 Prévision suggérée :</div>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span>${escapeHtml(bestCandidate.description)}</span>
                                        <span style="font-weight: 700; color: var(--accent);">${Number(bestCandidate.amount).toFixed(2)} €</span>
                                    </div>
                                </div>
                            ` : ''}

                            <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid var(--border-color); margin-top: 2px; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span class="badge" style="font-size: 11px; font-weight: 600;">${escapeHtml(item.category || '—')}</span>
                                    <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700; font-size: 10.5px;">
                                        ⚠️ ${conf}%
                                    </span>
                                </div>
                                <div style="display: flex; gap: 6px;">
                                    ${bestCandidate ? `
                                        <div class="candidate-forecast-action" style="display: inline-flex; align-items: center;">
                                            <button class="btn btn-sm" style="background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid var(--accent); padding: 5px 12px; font-size: 12px; font-weight: 600;" onclick="window.AutopilotView.promptInlineLinkConfirm(this, ${item.id}, ${bestCandidate.id})">
                                                🔗 Lier
                                            </button>
                                        </div>
                                    ` : `
                                        <button class="btn btn-secondary btn-sm" style="padding: 5px 12px; font-size: 12px; color: #10b981; border-color: rgba(16, 185, 129, 0.3);" onclick="window.AutopilotView.validateReviewItem(${item.id}, this)">
                                            ✓ Valider
                                        </button>
                                    `}
                                    <button class="btn btn-primary btn-sm" style="padding: 5px 12px; font-size: 12px;" onclick="window.AutopilotView.openReviewModal(${item.id})">
                                        ✏️ Éditer
                                    </button>
                                </div>
                            </div>
                        </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    },

    async validateReviewItem(txId, btn) {
        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳';
            }
            await API.post(`/api/autopilot/review/${txId}/validate`, {});
            showToast(window.i18n ? (window.i18n.t('autopilot_review_validated') || 'Opération confirmée avec succès') : 'Opération confirmée avec succès', 'success');
            await this.refresh();
            if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
                window.app.updateAutopilotBadge();
            }
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
            window.dispatchEvent(new CustomEvent('transactions_updated'));
        } catch (e) {
            showToast('Erreur lors de la validation', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '✓ Valider';
            }
        }
    },

    promptInlineLinkConfirm(btn, txId, forecastId) {
        const parent = btn.parentElement;
        if (!parent) return;
        if (!parent._origHtml) {
            parent._origHtml = parent.innerHTML;
        }
        parent.innerHTML = `
            <div style="display: inline-flex; align-items: center; gap: 4px; background: rgba(16, 185, 129, 0.12); padding: 2px 6px; border-radius: 6px; border: 1px solid rgba(16, 185, 129, 0.3);" onclick="event.stopPropagation();">
                <span style="font-size: 11px; font-weight: 600; color: #10b981; white-space: nowrap;">Lier ?</span>
                <button type="button" class="btn btn-success btn-sm" style="font-size: 11px; font-weight: 700; padding: 2px 8px; background: #10b981; color: white; border: none; border-radius: 4px; cursor: pointer; line-height: 1.2;" onclick="event.stopPropagation(); window.AutopilotView.linkReviewItem(${txId}, ${forecastId}, this)">✓ Oui</button>
                <button type="button" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 6px; border-radius: 4px; cursor: pointer; line-height: 1.2;" onclick="event.stopPropagation(); window.AutopilotView.cancelInlineLinkConfirm(this)">✕</button>
            </div>
        `;
    },

    cancelInlineLinkConfirm(btn) {
        const container = btn.closest('.candidate-forecast-action') || btn.parentElement?.parentElement;
        if (container && container._origHtml) {
            container.innerHTML = container._origHtml;
            delete container._origHtml;
        }
    },

    async linkReviewItem(txId, targetForecastId, btn) {
        try {
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳';
            }
            const res = await API.post(`/api/autopilot/review/${txId}/link`, {
                target_forecast_id: targetForecastId,
                learn_rule: true
            });
            this.closeOverrideModal();
            showToast(res.message || 'Opération liée à la prévision avec succès', 'success');
            await this.refresh();
            if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
                window.app.updateAutopilotBadge();
            }
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
            window.dispatchEvent(new CustomEvent('transactions_updated'));
        } catch (e) {
            showToast('Erreur lors de la liaison avec la prévision', 'error');
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔗 Lier';
            }
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

    formatReasonBadge(reason) {
        if (!reason) return '';
        const map = {
            'linked_forecast': '🔗 Liaison prévision',
            'manual_link_review': '🔗 Liaison prévision',
            'reviewed_by_user': '✏️ Revue manuelle',
            'rule': 'Règle',
            'history': 'Historique',
            'fallback_catchall': 'Catégorie par défaut',
            'chameleon_default': 'Caméléon défaut',
            'chameleon_ai': 'Caméléon IA',
            'ai_existing': 'IA (existante)',
            'ai_new_category': 'IA (nouvelle cat.)',
            'provisional_auto_commit': 'Écriture prévisionnelle'
        };
        const label = map[reason] || reason;
        return `<span class="ap-reason-badge" title="Raison de la décision : ${escapeHtml(reason)}">${escapeHtml(label)}</span>`;
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
                            ${this.formatReasonBadge(d.reason)}
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

        const modeInput = document.getElementById('overrideMode');
        const txIdInput = document.getElementById('overrideTxId');
        const decIdInput = document.getElementById('overrideDecisionId');
        const tfInput = document.getElementById('overrideTargetForecastId');
        if (modeInput) modeInput.value = 'decision';
        if (decIdInput) decIdInput.value = decisionId;
        if (txIdInput) txIdInput.value = '';
        if (tfInput) tfInput.value = '';

        const candContainer = document.getElementById('overrideCandidateForecastsContainer');
        if (candContainer) {
            candContainer.style.display = 'none';
            candContainer.innerHTML = '';
        }

        const titleEl = modal.querySelector('.ap-override-title');
        const subTitleEl = modal.querySelector('.ap-override-subtitle');
        if (titleEl) titleEl.textContent = window.i18n ? (window.i18n.t('autopilot_override_modal_title') || 'Corriger la décision Auto-Pilote') : 'Corriger la décision Auto-Pilote';
        if (subTitleEl) subTitleEl.textContent = window.i18n ? (window.i18n.t('autopilot_override_modal_subtitle') || 'Ajustez le libellé, la catégorie ou le montant retenus par le moteur') : 'Ajustez le libellé, la catégorie ou le montant retenus par le moteur';

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

    onCandidateCardClick(cardEl) {
        if (!cardEl) return;
        const forecastId = parseInt(cardEl.dataset.forecastId, 10);
        const desc = cardEl.dataset.desc || '';
        const cat = cardEl.dataset.cat || '';
        const amount = parseFloat(cardEl.dataset.amount) || 0;
        this.selectCandidateForecastForOverride(forecastId, desc, cat, amount, cardEl);
    },

    selectCandidateForecastForOverride(forecastId, desc, cat, amount, cardEl) {
        const tfInput = document.getElementById('overrideTargetForecastId');
        if (tfInput) tfInput.value = forecastId;
        const descInput = document.getElementById('overrideDescription');
        if (descInput) descInput.value = desc;
        if (cat && window.CategoryPicker) {
            window.CategoryPicker.setValue('overrideCategory', cat, true);
        }

        const allCards = document.querySelectorAll('.candidate-forecast-card');
        allCards.forEach(c => {
            c.style.borderColor = 'var(--border-color)';
            c.style.background = 'var(--bg-surface)';
        });
        if (cardEl) {
            cardEl.style.borderColor = 'var(--accent)';
            cardEl.style.background = 'rgba(99, 102, 241, 0.08)';
        }

        showToast(`Prévision '${desc}' sélectionnée pour fusion (cliquez sur "🔗 Lier" ou "Enregistrer")`, 'info');
    },

    async openReviewModal(txId, label, category, amount) {
        if (!this._reviewQueue || this._reviewQueue.length === 0) {
            try {
                this._reviewQueue = await API.get('/api/autopilot/review-queue') || [];
            } catch (e) {
                // ignore
            }
        }
        let item = (this._reviewQueue || []).find(x => x.id === txId);
        if (!item && (!label || category === undefined || amount === undefined)) {
            try {
                const res = await API.get(`/api/transactions/${txId}`);
                if (res) {
                    item = {
                        id: res.id,
                        description: res.description,
                        category: res.category,
                        amount: res.amount,
                        type: res.type
                    };
                }
            } catch (e) {
                console.warn('[AutopilotView] Impossible de charger transaction:', e);
            }
        }

        const modal = document.getElementById('apOverrideModal');
        if (!modal) return;

        const modeInput = document.getElementById('overrideMode');
        const txIdInput = document.getElementById('overrideTxId');
        const decIdInput = document.getElementById('overrideDecisionId');
        const tfInput = document.getElementById('overrideTargetForecastId');
        if (modeInput) modeInput.value = 'review';
        if (txIdInput) txIdInput.value = txId;
        if (decIdInput) decIdInput.value = '';
        if (tfInput) tfInput.value = '';

        // Render candidate forecasts if available
        const candContainer = document.getElementById('overrideCandidateForecastsContainer');
        if (candContainer) {
            if (item && item.candidate_forecasts && item.candidate_forecasts.length > 0) {
                candContainer.style.display = 'block';
                candContainer.innerHTML = `
                    <div style="background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.25); border-radius: 10px; padding: 12px 14px; margin-bottom: 14px;">
                        <div style="font-size: 11.5px; font-weight: 700; color: var(--accent); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                            <span>💡</span> <span>Prévision(s) récurrente(s) suggérée(s) pour fusion :</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${item.candidate_forecasts.map(cf => `
                                <div class="candidate-forecast-card" data-forecast-id="${cf.id}" data-desc="${escapeHtml(cf.description)}" data-cat="${escapeHtml(cf.category || '')}" data-amount="${cf.amount}" style="padding: 10px 14px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: all 0.15s ease; gap: 14px;" onclick="window.AutopilotView.onCandidateCardClick(this)" title="Sélectionner pour fusionner avec cette prévision">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-weight: 600; font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(cf.description)}</div>
                                        <div style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">Prévu le ${cf.date_operation} • Catégorie : <span style="color: var(--text-main); font-weight: 500;">${escapeHtml(cf.category || '—')}</span></div>
                                    </div>
                                    <div class="candidate-forecast-action" style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                                        <span style="font-weight: 700; font-size: 13px; color: var(--accent); white-space: nowrap;">${Number(cf.amount).toFixed(2)} €</span>
                                        <button type="button" class="btn btn-primary btn-sm" style="font-size: 11.5px; font-weight: 700; padding: 5px 12px; display: inline-flex; align-items: center; gap: 4px; background: var(--accent); color: white; border: none; border-radius: 6px; cursor: pointer;" onclick="event.stopPropagation(); window.AutopilotView.promptInlineLinkConfirm(this, ${txId}, ${cf.id})"><span>🔗 Lier</span></button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                candContainer.style.display = 'none';
                candContainer.innerHTML = '';
            }
        }

        const finalLabel = label || (item ? item.description : '');
        const finalCategory = category !== undefined ? category : (item ? item.category : '');
        const finalAmount = amount !== undefined ? amount : (item ? item.amount : 0);

        document.getElementById('overrideDescription').value = finalLabel || '';
        document.getElementById('overrideAmount').value = Math.abs(finalAmount || 0);

        const checkEl = document.getElementById('overrideLearnRule');
        if (checkEl) checkEl.checked = true;

        // Update modal title for review
        const titleEl = modal.querySelector('.ap-override-title');
        const subTitleEl = modal.querySelector('.ap-override-subtitle');
        if (titleEl) titleEl.textContent = window.i18n ? (window.i18n.t('autopilot_review_modal_title') || 'Vérifier / Corriger l\'opération') : 'Vérifier / Corriger l\'opération';
        if (subTitleEl) subTitleEl.textContent = window.i18n ? (window.i18n.t('autopilot_review_modal_subtitle') || 'Ajustez le libellé et la catégorie avant de valider l\'intégration.') : 'Ajustez le libellé et la catégorie avant de valider.';

        // Ensure categories list is loaded for CategoryPicker
        if (!window.app?.categoriesList || window.app.categoriesList.length === 0) {
            try {
                window.app = window.app || {};
                window.app.categoriesList = await API.get('/api/categories/');
            } catch (e) {
                window.app.categoriesList = [];
            }
        }

        let isDebit = (item && item.type) ? (item.type !== 'income') : true;
        const allowedTypes = isDebit ? ['expense_var', 'expense_fixed'] : ['income'];
        const direction = isDebit ? 'debit' : 'credit';

        const catContainer = document.getElementById('overrideCategoryContainer');
        if (catContainer && window.CategoryPicker) {
            catContainer.innerHTML = window.CategoryPicker.renderTriggerHtml({
                id: 'overrideCategory',
                value: finalCategory || '',
                allowedTypes: allowedTypes,
                direction: direction,
                inputClass: 'input-styled',
                placeholder: window.i18n ? (window.i18n.t('cat_picker_select') || '-- Catégorie --') : '-- Catégorie --'
            });
            window.CategoryPicker.setValue('overrideCategory', finalCategory || '', false);
        } else if (catContainer) {
            catContainer.innerHTML = `
                <input type="text" id="overrideCategory" class="input-styled" value="${escapeHtml(finalCategory || '')}" placeholder="Catégorie">
            `;
        }

        modal.style.display = 'flex';

        if (this._overrideEscHandler) {
            window.removeEventListener('keydown', this._overrideEscHandler);
        }
        this._overrideEscHandler = (e) => {
            const catPop = document.getElementById('categoryPickerPopover');
            if (catPop && catPop.style.display !== 'none') return;
            if (e.key === 'Escape') this.closeOverrideModal();
        };
        window.addEventListener('keydown', this._overrideEscHandler);

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
        const mode = document.getElementById('overrideMode')?.value || 'decision';
        const decisionId = document.getElementById('overrideDecisionId')?.value;
        const txId = document.getElementById('overrideTxId')?.value;
        const newDescription = document.getElementById('overrideDescription').value.trim();
        const newCategory = document.getElementById('overrideCategory').value.trim();
        const newAmount = parseFloat(document.getElementById('overrideAmount').value);
        const learnRule = document.getElementById('overrideLearnRule')?.checked ?? true;
        const submitBtn = document.getElementById('btnSubmitOverride');

        if (mode === 'review') {
            if (!txId) return;
            const targetForecastId = document.getElementById('overrideTargetForecastId')?.value ? parseInt(document.getElementById('overrideTargetForecastId').value, 10) : null;
            try {
                if (submitBtn) {
                    submitBtn.disabled = true;
                    submitBtn.classList.add('is-loading');
                }
                const res = await API.post(`/api/autopilot/review/${txId}/update`, {
                    description: newDescription || null,
                    category: newCategory || null,
                    amount: isNaN(newAmount) ? null : newAmount,
                    target_forecast_id: targetForecastId,
                    learn_rule: learnRule
                });
                showToast(res.message || (window.i18n ? (window.i18n.t('autopilot_review_updated') || 'Opération corrigée avec succès') : 'Opération corrigée avec succès'), 'success');
                this.closeOverrideModal();
                await this.refresh();
                if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
                    window.app.updateAutopilotBadge();
                }
                window.dispatchEvent(new CustomEvent('autopilot_updated'));
                window.dispatchEvent(new CustomEvent('transactions_updated'));
            } catch (e) {
                showToast('Erreur lors de la mise à jour de l\'opération', 'error');
            } finally {
                if (submitBtn) {
                    submitBtn.disabled = false;
                    submitBtn.classList.remove('is-loading');
                }
            }
            return;
        }

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
            if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
                window.app.updateAutopilotBadge();
            }
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
            review: 'apReviewSection',
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
        const sections = ['review', 'workshop'];
        sections.forEach(key => {
            const sectionMap = {
                review: 'apReviewSection',
                workshop: 'apWorkshopSection',
            };
            const el = document.getElementById(sectionMap[key]);
            if (!el) return;
            const saved = localStorage.getItem('autopilot_collapse_' + key);
            // Default: workshop is collapsed by default, review is open by default
            const shouldCollapse = (saved !== null) ? (saved === '1') : (key === 'workshop');
            el.classList.toggle('collapsed', shouldCollapse);
        });
        this.updateSummaryPills();
    },

    updateSummaryPills() {
        // Header Briques Badge
        const briquesBadge = document.getElementById('apActiveBriquesBadge');
        if (briquesBadge && this._status) {
            const subtoggles = this._status.managed_subtoggles || {};
            const vals = Object.values(subtoggles);
            const active = vals.filter(Boolean).length;
            const total = this._subtogglesDef ? this._subtogglesDef.reduce((acc, cat) => acc + (cat.items?.length || 0), 0) : 15;
            briquesBadge.textContent = `${active}/${total}`;
            briquesBadge.title = `${active} sur ${total} automatismes actifs`;
        }

        // Review pill
        const revPill = document.getElementById('apReviewSummaryPill');
        if (revPill) {
            const count = (this._reviewQueue || []).length;
            revPill.textContent = `${count} à vérifier`;
            revPill.style.background = count > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.12)';
            revPill.style.color = count > 0 ? '#f59e0b' : '#10b981';
            revPill.style.borderColor = count > 0 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)';
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
