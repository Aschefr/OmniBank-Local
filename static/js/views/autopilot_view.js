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

    _icons: {
        steeringWheel: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent); flex-shrink: 0;"><circle cx="12" cy="12" r="9.5"></circle><circle cx="12" cy="12" r="3"></circle><line x1="12" y1="15" x2="12" y2="21.5"></line><line x1="2.5" y1="12" x2="9" y2="12"></line><line x1="15" y1="12" x2="21.5" y2="12"></line></svg>`,
        steeringWheelMini: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><circle cx="12" cy="12" r="3"></circle><line x1="12" y1="15" x2="12" y2="21.5"></line><line x1="2.5" y1="12" x2="9" y2="12"></line><line x1="15" y1="12" x2="21.5" y2="12"></line></svg>`,
        gauge: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 14 4-4"></path><path d="M3.34 19a10 10 0 1 1 17.32 0"></path></svg>`,
        shield: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>`,
        settings: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
        alertCircle: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`,
        list: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
        brain: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 4.44-2.54z"></path><path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-4.44-2.54z"></path></svg>`,
        inbox: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"></polyline><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"></path></svg>`,
        tag: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>`,
        repeat: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>`,
        chart: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>`,
        package: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7.5 4.27 9 5.15"></path><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"></path><path d="m3.3 7 8.7 5 8.7-5"></path><path d="M12 22V12"></path></svg>`,
        link: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>`,
        check: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
        edit: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>`,
        undo: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"></path></svg>`,
        unpoint: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>`,
        search: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`,
        target: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle></svg>`,
        sparkles: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path></svg>`,
        save: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>`,
        power: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"></path><line x1="12" y1="2" x2="12" y2="12"></line></svg>`
    },

    _subtogglesDef: [
        {
            categoryKey: 'autopilot_cat_operations',
            category: 'Opérations & Ingestion',
            iconKey: 'inbox',
            items: [
                {
                    key: 'auto_reconcile_transactions',
                    labelKey: 'autopilot_subtoggle_auto_reconcile_transactions',
                    label: 'Auto-Rapprochement haute certitude',
                    descKey: 'autopilot_subtoggle_auto_reconcile_transactions_desc',
                    desc: 'Pointe et réconcilie automatiquement les écritures bancaires avec vos prévisions lorsque le score de confiance atteint le seuil.'
                },
                {
                    key: 'auto_commit_incoming_transactions',
                    labelKey: 'autopilot_subtoggle_auto_commit_incoming_transactions',
                    label: 'Enregistrement direct des écritures',
                    descKey: 'autopilot_subtoggle_auto_commit_incoming_transactions_desc',
                    desc: 'Intègre immédiatement les opérations confirmées en base pour garantir l\'alignement strict du solde bancaire.'
                },
                {
                    key: 'auto_assign_chameleon_fallback',
                    labelKey: 'autopilot_subtoggle_auto_assign_chameleon_fallback',
                    label: 'Catégorisation repli / caméléon',
                    descKey: 'autopilot_subtoggle_auto_assign_chameleon_fallback_desc',
                    desc: 'Assigne une catégorie de repli temporaire sécurisée pour les marchands inconnus afin de ne bloquer aucun flux.'
                },
                {
                    key: 'auto_close_empty_import_sas',
                    labelKey: 'autopilot_subtoggle_auto_close_empty_import_sas',
                    label: 'Fermeture automatique du Sas d\'attente',
                    descKey: 'autopilot_subtoggle_auto_close_empty_import_sas_desc',
                    desc: 'Clôture automatiquement le sas d\'import dès que l\'ensemble des écritures du lot ont été traitées.'
                },
                {
                    key: 'bank_auto_sync_enabled',
                    labelKey: 'autopilot_subtoggle_bank_auto_sync_enabled',
                    label: 'Synchronisation bancaire en arrière-plan',
                    descKey: 'autopilot_subtoggle_bank_auto_sync_enabled_desc',
                    desc: 'Effectue le relevé bancaire périodique autonome (3h à 48h) lorsque le coffre-fort est déverrouillé.'
                }
            ]
        },
        {
            categoryKey: 'autopilot_cat_merchants',
            category: 'Marchands & Catégories',
            iconKey: 'tag',
            items: [
                {
                    key: 'auto_learn_merchant_rules',
                    labelKey: 'autopilot_subtoggle_auto_learn_merchant_rules',
                    label: 'Apprentissage autonome des marchands',
                    descKey: 'autopilot_subtoggle_auto_learn_merchant_rules_desc',
                    desc: 'Mémorise automatiquement vos arbitrages dans les règles marchands pour classifier sans faille les prochains relevés.'
                },
                {
                    key: 'auto_create_missing_categories',
                    labelKey: 'autopilot_subtoggle_auto_create_missing_categories',
                    label: 'Création autonome des catégories',
                    descKey: 'autopilot_subtoggle_auto_create_missing_categories_desc',
                    desc: 'Crée automatiquement les catégories détectées lors de l\'enrichissement des flux bancaires.'
                }
            ]
        },
        {
            categoryKey: 'autopilot_cat_recurrences',
            category: 'Récurrences & Abonnements',
            iconKey: 'repeat',
            items: [
                {
                    key: 'auto_link_deviant_recurrences',
                    labelKey: 'autopilot_subtoggle_auto_link_deviant_recurrences',
                    label: 'Rapprochement déviant tolérant',
                    descKey: 'autopilot_subtoggle_auto_link_deviant_recurrences_desc',
                    desc: 'Rapproche les prélèvements récurrents dont le montant fluctue dans une fourchette tolérée de ±15%.'
                },
                {
                    key: 'auto_propagate_recurrence_hikes',
                    labelKey: 'autopilot_subtoggle_auto_propagate_recurrence_hikes',
                    label: 'Propagation automatique des hausses',
                    descKey: 'autopilot_subtoggle_auto_propagate_recurrence_hikes_desc',
                    desc: 'Ajuste le montant prévisionnel d\'un abonnement lorsqu\'une hausse tarifaire est constatée sur 3 échéances consécutives.'
                },
                {
                    key: 'auto_skip_unreconciled_recurrences',
                    labelKey: 'autopilot_subtoggle_auto_skip_unreconciled_recurrences',
                    label: 'Saut d\'échéance automatique',
                    descKey: 'autopilot_subtoggle_auto_skip_unreconciled_recurrences_desc',
                    desc: 'Marque comme passée toute échéance récurrente non constatée à la fin du mois sans altérer le template.'
                },
                {
                    key: 'auto_close_unreconciled_recurrences',
                    labelKey: 'autopilot_subtoggle_auto_close_unreconciled_recurrences',
                    label: 'Clôture après échéances manquées',
                    descKey: 'autopilot_subtoggle_auto_close_unreconciled_recurrences_desc',
                    desc: 'Désactive automatiquement un abonnement récurrent après N échéances consécutives jamais prélevées.'
                }
            ]
        },
        {
            categoryKey: 'autopilot_cat_budgets',
            category: 'Budgets & Enveloppes',
            iconKey: 'chart',
            items: [
                {
                    key: 'enable_budget_creation_suggestions',
                    labelKey: 'autopilot_subtoggle_enable_budget_creation_suggestions',
                    label: 'Suggestions de nouvelles enveloppes',
                    descKey: 'autopilot_subtoggle_enable_budget_creation_suggestions_desc',
                    desc: 'Analyse vos dépenses réelles pour proposer la création d\'enveloppes sur vos postes récurrents.'
                },
                {
                    key: 'enable_budget_recalibration_suggestions',
                    labelKey: 'autopilot_subtoggle_enable_budget_recalibration_suggestions',
                    label: 'Suggestions de recalibrage mensuel',
                    descKey: 'autopilot_subtoggle_enable_budget_recalibration_suggestions_desc',
                    desc: 'Calcule des propositions d\'ajustement lissé (filtre EMA 3-6 mois) pour vos budgets sous ou sur-consommés.'
                },
                {
                    key: 'auto_create_budget_envelopes',
                    labelKey: 'autopilot_subtoggle_auto_create_budget_envelopes',
                    label: 'Création 100% autonome des enveloppes',
                    descKey: 'autopilot_subtoggle_auto_create_budget_envelopes_desc',
                    desc: 'Valide et crée immédiatement les enveloppes suggérées sans attendre votre approbation manuelle.'
                },
                {
                    key: 'auto_apply_budget_suggestions',
                    labelKey: 'autopilot_subtoggle_auto_apply_budget_suggestions',
                    label: 'Application 100% autonome des recalibrages',
                    descKey: 'autopilot_subtoggle_auto_apply_budget_suggestions_desc',
                    desc: 'Applique automatiquement les nouveaux plafonds budgétaires calculés au 1er de chaque mois.'
                }
            ]
        }
    ],

    render() {
        return `
            <div class="autopilot-container" style="max-width: 1440px; width: 100%; margin: 0 auto; padding-bottom: 40px; position: relative;">
                <!-- Cockpit Take Control / Engagement HUD Overlay -->
                <div id="apEngagementHud" class="ap-engagement-hud" style="display: none;" onclick="window.AutopilotView.dismissEngagementHud(event)">
                    <div class="ap-hud-backdrop-glow"></div>
                    <div class="ap-hud-scan-beam"></div>
                    <div class="ap-hud-banner" onclick="event.stopPropagation()" onmouseenter="window.AutopilotView.pauseHudTimer()" onmouseleave="window.AutopilotView.resumeHudTimer()">
                        <div class="ap-hud-gyro-wrap">
                            <div class="ap-hud-gyro-ring ring-1"></div>
                            <div class="ap-hud-gyro-ring ring-2"></div>
                            <div class="ap-hud-gyro-icon">${this._icons.steeringWheel}</div>
                        </div>
                        <div class="ap-hud-info">
                            <div class="ap-hud-tag-row">
                                <span class="ap-hud-status-badge" data-i18n="autopilot_hud_status_engaged">${window.i18n ? window.i18n.t('autopilot_hud_status_engaged') : 'AUTO-PILOTE ENGAGÉ'}</span>
                                <span class="ap-hud-live-indicator"><span class="ap-hud-live-dot"></span> <span data-i18n="autopilot_hud_status_mission">${window.i18n ? window.i18n.t('autopilot_hud_status_mission') : 'EN MISSION'}</span></span>
                            </div>
                            <h3 class="ap-hud-title" data-i18n="autopilot_hud_title">${window.i18n ? window.i18n.t('autopilot_hud_title') : 'OmniBank prend les commandes'}</h3>
                            <p class="ap-hud-desc" data-i18n="autopilot_hud_desc">${window.i18n ? window.i18n.t('autopilot_hud_desc') : 'Installez-vous confortablement : vos soldes, catégorisations et prévisions sont gérés et surveillés en toute autonomie.'}</p>
                            <div class="ap-hud-pills-row">
                                <span class="ap-hud-pill" data-i18n="autopilot_hud_pill_sync"><span>✓</span> ${window.i18n ? window.i18n.t('autopilot_hud_pill_sync') : 'Relevés Périodiques'}</span>
                                <span class="ap-hud-pill" data-i18n="autopilot_hud_pill_reconcile"><span>✓</span> ${window.i18n ? window.i18n.t('autopilot_hud_pill_reconcile') : 'Pointage Auto Haute Confiance'}</span>
                                <span class="ap-hud-pill" data-i18n="autopilot_hud_pill_briques"><span>✓</span> ${window.i18n ? window.i18n.t('autopilot_hud_pill_briques') : '15 Briques Armées'}</span>
                            </div>
                        </div>
                        <button type="button" class="ap-hud-close-btn" onclick="window.AutopilotView.dismissEngagementHud(event)" title="${window.i18n ? window.i18n.t('autopilot_hud_close_title') : 'Fermer'}">✕</button>
                        <div class="ap-hud-progress-track">
                            <div id="apHudProgressBar" class="ap-hud-progress-bar"></div>
                        </div>
                    </div>
                </div>

                <!-- Header / Cockpit Bar -->
                <div class="view-header-bar" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 16px; margin-bottom: 20px;">
                    <div class="view-header-title-group" style="display: flex; align-items: center; gap: 12px;">
                        <span style="cursor: pointer; display: inline-flex;" onclick="window.AutopilotView.showEngagementHud()" title="${window.i18n ? window.i18n.t('autopilot_hud_tooltip') : 'Afficher le résumé de mission Auto-Pilote'}">
                            ${this._icons.steeringWheel}
                        </span>
                        <div>
                            <h2 class="view-header-title" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                                <span data-i18n="autopilot_control_center_title">${window.i18n.t('autopilot_control_center_title') || 'Centre de Contrôle Auto-Pilote'}</span>
                                <span id="apStatusBadge" class="badge" onclick="window.AutopilotView.showEngagementHud()" title="${window.i18n ? window.i18n.t('autopilot_status_badge_tooltip') : 'Cliquez pour afficher le résumé de mission Auto-Pilote'}" style="font-size: 11px; padding: 3px 10px; border-radius: 12px; vertical-align: middle; cursor: pointer; transition: transform 0.15s ease;"></span>
                            </h2>
                            <p style="margin: 3px 0 0 0; color: var(--text-muted); font-size: 13px;" data-i18n="autopilot_control_center_desc">
                                ${window.i18n.t('autopilot_control_center_desc') || 'Supervisez l\'autonomie de vos flux bancaires, ajustez le seuil de tolérance et annulez des décisions en un clic.'}
                            </p>
                        </div>
                    </div>
                    <div class="autopilot-header-toolbar">
                        <!-- Encadré 1 : Relevé Bancaire Automatique -->
                        <div id="apBankSyncGroup" class="autopilot-toolbar-group" style="display: none;">
                            <div id="apAutoSyncCompact" class="bank-sync-auto-sync-widget-slot"></div>
                        </div>

                        <!-- Encadré 2 : Pilotage & Briques Modulaires -->
                        <div class="autopilot-toolbar-group" style="gap: 10px;">
                            <button type="button" class="btn ap-header-btn" onclick="window.AutopilotView.openSettingsDrawer()" title="${window.i18n ? window.i18n.t('autopilot_settings_btn_title') : 'Configurer les 15 briques et le seuil'}" style="display: inline-flex; align-items: center; gap: 6px;">
                                ${this._icons.settings} <span data-i18n="autopilot_settings_and_bricks">${window.i18n ? window.i18n.t('autopilot_settings_and_bricks') : 'Réglages & Briques'}</span> <span id="apActiveBriquesBadge" class="badge" style="font-size: 10.5px; background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid var(--accent); padding: 1px 6px; border-radius: 6px;">--/15</span>
                            </button>

                            <!-- Hero Master Cockpit Switch (Bouton d'activation Grand Format & Tactile) -->
                            <div id="apHeroMasterSwitch" class="ap-hero-master-switch is-inactive" onclick="window.AutopilotView.onHeroSwitchClick(event)" title="${window.i18n ? window.i18n.t('autopilot_master_toggle_title') : 'Activer / Mettre en veille le mode Auto-Pilote'}">
                                <div class="ap-hero-switch-knob">
                                    <span class="ap-hero-switch-icon-inactive">${this._icons.power}</span>
                                    <span class="ap-hero-switch-icon-active">${this._icons.steeringWheelMini}</span>
                                </div>
                                <div class="ap-hero-switch-content">
                                    <div class="ap-hero-switch-header">
                                        <span class="ap-hero-switch-title" data-i18n="autopilot_master_toggle">${window.i18n.t('autopilot_master_toggle') || 'Auto-Pilote'}</span>
                                        <span class="ap-hero-switch-dot"></span>
                                    </div>
                                    <div id="apHeroSwitchStateText" class="ap-hero-switch-state" data-i18n="autopilot_state_standby">${window.i18n ? window.i18n.t('autopilot_state_standby') : 'En veille'}</div>
                                </div>

                                <!-- Slot Compte à Rebours Cylon Scanner (Battlestar Galactica) -->
                                <div id="apHeroCylonScanner" class="ap-cylon-scanner-slot" style="display: none;">
                                    <div class="ap-cylon-track">
                                        <div class="ap-cylon-eye"></div>
                                    </div>
                                    <div class="ap-cylon-content">
                                        <span class="ap-cylon-label" data-i18n="autopilot_next_sync_label">${window.i18n ? window.i18n.t('autopilot_next_sync_label') : 'PROCHAIN RELEVÉ'}</span>
                                        <span id="apHeroCountdownTime" class="ap-cylon-time">--</span>
                                    </div>
                                </div>

                                <input type="checkbox" id="apMasterSwitch" style="display: none;" onchange="window.AutopilotView.toggleMasterSwitch(this.checked)">
                            </div>
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

                <!-- Split Cockpit Layout : 2 Colonnes (Grisé quand inactif) -->
                <div id="apCockpitLayout" class="ap-cockpit-layout" style="display: grid; grid-template-columns: 290px 1fr; gap: 24px; align-items: start;">
                    <!-- COLONNE GAUCHE (290px) : KPIs & Performance Épurés -->
                    <div class="ap-left-column">
                        <div class="ap-kpi-panel">
                            <div class="ap-kpi-panel-header">
                                <span class="ap-kpi-panel-icon">${this._icons.gauge}</span>
                                <div>
                                    <h3 class="ap-kpi-panel-title" data-i18n="autopilot_kpi_panel_title">${window.i18n ? window.i18n.t('autopilot_kpi_panel_title') : 'Performance'}</h3>
                                    <p class="ap-kpi-panel-subtitle" data-i18n="autopilot_kpi_panel_subtitle">${window.i18n ? window.i18n.t('autopilot_kpi_panel_subtitle') : 'Gains & précision de l\'auto-pilote'}</p>
                                </div>
                            </div>

                            <!-- Hero KPIs: Précision & Temps épargné -->
                            <div class="ap-hero-kpi-grid">
                                <div class="ap-hero-kpi-card ap-hero-kpi-emerald">
                                    <span class="ap-kpi-label" data-i18n="autopilot_kpi_accuracy">${window.i18n.t('autopilot_kpi_accuracy') || 'Précision'}</span>
                                    <div id="kpiAccuracy" class="ap-hero-kpi-val">--%</div>
                                    <span class="ap-kpi-sub" data-i18n="autopilot_kpi_accuracy_sub">${window.i18n.t('autopilot_kpi_accuracy_sub') || 'sans rejet'}</span>
                                </div>
                                <div class="ap-hero-kpi-card ap-hero-kpi-accent">
                                    <span class="ap-kpi-label" data-i18n="autopilot_kpi_hours_saved">${window.i18n.t('autopilot_kpi_hours_saved') || 'Temps Épargné'}</span>
                                    <div id="kpiHoursSaved" class="ap-hero-kpi-val">-- h</div>
                                    <span class="ap-kpi-sub" data-i18n="autopilot_kpi_hours_saved_sub">${window.i18n.t('autopilot_kpi_hours_saved_sub') || 'de saisie évitée'}</span>
                                </div>
                            </div>

                            <!-- 2x2 Secondary Counters Grid -->
                            <div class="ap-sec-kpi-grid">
                                <div class="ap-sec-kpi-item">
                                    <span class="ap-sec-kpi-label" data-i18n="autopilot_kpi_reconciled">${window.i18n.t('autopilot_kpi_reconciled') || 'Rapprochements'}</span>
                                    <span id="kpiReconciled" class="ap-sec-kpi-val">0</span>
                                </div>
                                <div class="ap-sec-kpi-item">
                                    <span class="ap-sec-kpi-label" data-i18n="autopilot_kpi_committed">${window.i18n.t('autopilot_kpi_committed') || 'Écritures'}</span>
                                    <span id="kpiCommitted" class="ap-sec-kpi-val">0</span>
                                </div>
                                <div class="ap-sec-kpi-item">
                                    <span class="ap-sec-kpi-label" data-i18n="autopilot_kpi_recurrences">${window.i18n.t('autopilot_kpi_recurrences') || 'Récurrences'}</span>
                                    <span id="kpiRecurrences" class="ap-sec-kpi-val">0</span>
                                </div>
                                <div class="ap-sec-kpi-item">
                                    <span class="ap-sec-kpi-label" data-i18n="autopilot_kpi_budgets">${window.i18n.t('autopilot_kpi_budgets') || 'Budgets'}</span>
                                    <span id="kpiBudgets" class="ap-sec-kpi-val">0</span>
                                </div>
                            </div>

                            <!-- System & Sync Info Footer -->
                            <div class="ap-kpi-status-list">
                                <div class="ap-kpi-status-row">
                                    <span class="ap-kpi-status-label" data-i18n="autopilot_kpi_vault_label">${window.i18n ? window.i18n.t('autopilot_kpi_vault_label') : 'Coffre-fort :'}</span>
                                    <span id="apVaultStatusInline" class="ap-kpi-status-val">--</span>
                                </div>
                                <div class="ap-kpi-status-row">
                                    <span class="ap-kpi-status-label" data-i18n="autopilot_kpi_last_sync_label">${window.i18n ? window.i18n.t('autopilot_kpi_last_sync_label') : 'Dernier relevé :'}</span>
                                    <span id="apLastExecTime" class="ap-kpi-status-val">--</span>
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
                                    <span class="ap-collapsible-icon" style="color: #f59e0b;">${this._icons.alertCircle}</span>
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
                                    <span id="apReviewSummaryPill" class="ap-summary-pill" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);" data-i18n="autopilot_review_pill_initial">${window.i18n ? window.i18n.t('autopilot_review_pill_initial') : '0 à vérifier'}</span>
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
                                <div style="display: flex; align-items: center; gap: 10px;">
                                    <span style="color: var(--accent); display: inline-flex;">${this._icons.list}</span>
                                    <div>
                                        <h3 style="font-size: 15px; margin: 0 0 2px 0; font-weight: 700; color: var(--text-main);" data-i18n="autopilot_feed_title">
                                            ${window.i18n.t('autopilot_feed_title') || 'Journal d\'Audit & Flux des Décisions'}
                                        </h3>
                                        <p style="font-size: 12px; color: var(--text-muted); margin: 0;" data-i18n="autopilot_feed_desc">
                                            ${window.i18n.t('autopilot_feed_desc') || 'Historique complet des arbitrages pris automatiquement avec traçabilité et réversibilité.'}
                                        </p>
                                    </div>
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
                                    <button id="apToggleAllBatchesBtn" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.toggleAllBatches()" style="font-size: 11.5px; padding: 4px 10px;" data-i18n="autopilot_feed_collapse_batches">
                                        ${window.i18n ? window.i18n.t('autopilot_feed_collapse_batches') : 'Replier les lots'}
                                    </button>
                                </div>
                            </div>

                            <div style="padding: 18px 20px;">
                                <!-- Decision Items Container -->
                                <div id="apDecisionsFeed" style="min-height: 200px;">
                                    <div style="text-align: center; padding: 40px; color: var(--text-muted);" data-i18n="autopilot_feed_loading">
                                        ${window.i18n ? window.i18n.t('autopilot_feed_loading') : 'Chargement du journal d\'audit...'}
                                    </div>
                                </div>

                                <!-- Pagination -->
                                <div id="apPaginationBar" style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--border-color); font-size: 12px; color: var(--text-muted);">
                                    <span id="apPaginationInfo"></span>
                                    <div style="display: flex; gap: 8px;">
                                        <button id="apPrevPageBtn" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.prevPage()" disabled data-i18n="autopilot_feed_pagination_prev">${window.i18n ? window.i18n.t('autopilot_feed_pagination_prev') : '◀ Précédent'}</button>
                                        <button id="apNextPageBtn" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.nextPage()" disabled data-i18n="autopilot_feed_pagination_next">${window.i18n ? window.i18n.t('autopilot_feed_pagination_next') : 'Suivant ▶'}</button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Section 4 : Atelier des Règles & Apprentissages - Rétractable -->
                        <div id="apWorkshopSection" class="ap-collapsible-card">
                            <div class="ap-collapsible-header" onclick="window.AutopilotView.toggleSection('workshop')">
                                <div class="ap-collapsible-title-group">
                                    <span class="ap-collapsible-icon" style="color: var(--accent);">${this._icons.brain}</span>
                                    <div>
                                        <h3 class="ap-collapsible-title" data-i18n="autopilot_workshop_title">${window.i18n ? window.i18n.t('autopilot_workshop_title') : 'Atelier des Règles & Apprentissages'}</h3>
                                        <p class="ap-collapsible-subtitle" data-i18n="autopilot_workshop_subtitle">${window.i18n ? window.i18n.t('autopilot_workshop_subtitle') : 'Correspondances marchands et motifs appris automatiquement au fil de vos opérations'}</p>
                                    </div>
                                </div>
                                <div class="ap-collapsible-actions">
                                    <span id="apWorkshopSummaryPill" class="ap-summary-pill" data-i18n="autopilot_workshop_pill_initial">${window.i18n ? window.i18n.t('autopilot_workshop_pill_initial') : '0 règle active'}</span>
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
                </div>
            </div>

            <!-- Settings Drawer (Option B) -->
            <div id="apSettingsDrawer" class="modal-overlay" style="display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(4px); z-index: 99998; justify-content: flex-end;" onclick="if(event.target === this) window.AutopilotView.closeSettingsDrawer()">
                <div style="background: var(--bg-surface); width: 620px; max-width: 95vw; height: 100%; display: flex; flex-direction: column; box-shadow: -10px 0 30px rgba(0,0,0,0.35); border-left: 1px solid var(--border-color); color: var(--text-main); animation: apDrawerSlideIn 0.22s ease-out;">
                    <!-- Drawer Header -->
                    <div style="padding: 18px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                        <div>
                            <h3 style="margin: 0 0 3px 0; font-size: 16px; font-weight: 800; display: flex; align-items: center; gap: 8px;">
                                <span style="display: inline-flex; align-items: center; color: var(--accent);">${this._icons.settings}</span> <span data-i18n="autopilot_drawer_title">${window.i18n ? window.i18n.t('autopilot_drawer_title') : 'Réglages d\'Autonomie & Briques Élémentaires'}</span>
                            </h3>
                            <p style="margin: 0; font-size: 12px; color: var(--text-muted);" data-i18n="autopilot_drawer_subtitle">
                                ${window.i18n ? window.i18n.t('autopilot_drawer_subtitle') : 'Seuil de tolérance et contrôle individuel des 15 automatismes'}
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
                                    <h4 style="font-size: 13.5px; margin: 0 0 4px 0; font-weight: 700; display: flex; align-items: center; gap: 6px;" data-i18n="autopilot_threshold_title">
                                        <span style="color: var(--accent); display: inline-flex;">${this._icons.target}</span> <span>${window.i18n.t('autopilot_threshold_title') || 'Seuil de Tolérance & Confiance'}</span>
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
                                <div id="thresholdLiveImpactText" style="color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                    <span style="color: var(--accent); display: inline-flex;">${this._icons.chart}</span> <span>${window.i18n.t('autopilot_threshold_preview_help') || 'Impact estimé'} : <strong id="previewStatsText">Déplacez le curseur pour simuler</strong></span>
                                </div>
                                <button id="btnApplyThresholdToExisting" class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 4px 10px; white-space: nowrap; display: none;" onclick="window.AutopilotView.applyThresholdToExisting()">
                                    ${window.i18n.t('autopilot_threshold_apply_button') || 'Appliquer aux écritures existantes'}
                                </button>
                            </div>
                        </div>

                        <!-- Block 2 : 15 Briques Élémentaires Container -->
                        <div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                                <h4 style="font-size: 13.5px; margin: 0; font-weight: 700; display: flex; align-items: center; gap: 6px;">
                                    <span style="color: var(--accent); display: inline-flex;">${this._icons.package}</span> <span data-i18n="autopilot_drawer_briques_title">${window.i18n ? window.i18n.t('autopilot_drawer_briques_title') : 'Les 15 Briques d\'Autonomie Modulaires'}</span>
                                </h4>
                                <span style="font-size: 11px; color: var(--text-muted);" data-i18n="autopilot_drawer_briques_subtitle">${window.i18n ? window.i18n.t('autopilot_drawer_briques_subtitle') : 'Contrôle fin à la carte'}</span>
                            </div>
                            <div id="apSubtogglesDrawerList">
                                <!-- Injected dynamically by renderSubtogglesInDrawer() -->
                            </div>
                        </div>
                    </div>

                    <!-- Drawer Footer -->
                    <div style="padding: 14px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-base); flex-shrink: 0;">
                        <button type="button" class="btn btn-secondary btn-sm" onclick="window.AutopilotView.resetToDefaultSubtoggles()" style="display: inline-flex; align-items: center; gap: 6px;">
                            ${this._icons.repeat} <span data-i18n="autopilot_drawer_reset_recommended">${window.i18n ? window.i18n.t('autopilot_drawer_reset_recommended') : 'Rétablir la sélection recommandée'}</span>
                        </button>
                        <button type="button" class="btn btn-primary btn-sm" onclick="window.AutopilotView.closeSettingsDrawer()" data-i18n="autopilot_drawer_close">
                            ${window.i18n ? window.i18n.t('autopilot_drawer_close') : 'Fermer'}
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
                            <div class="ap-override-icon-badge">${this._icons.edit}</div>
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
                                    }) : `<input type="text" id="overrideCategory" class="input-styled" placeholder="${window.i18n ? window.i18n.t('autopilot_override_category_placeholder') : 'Catégorie'}">`}
                                </div>
                                <button type="button" 
                                        id="btnOverrideAiClassify" 
                                        class="ap-override-ai-btn" 
                                        onclick="window.AutopilotView.classifyOverrideWithAI(this)" 
                                        title="${window.i18n ? (window.i18n.t('smart_label_ai_classify_tooltip') || 'Nommer et classifier avec l\'IA') : 'Nommer et classifier avec l\'IA'}">
                                    ${this._icons.sparkles}
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
                                <input type="number" id="overrideAmount" step="0.01" class="input-styled privacy-blur" style="padding-right: 32px; font-weight: 600;" onkeydown="if(event.key==='Enter') window.AutopilotView.submitOverride()">
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
                        <button type="button" id="btnSubmitOverride" class="btn btn-primary" onclick="window.AutopilotView.submitOverride()" style="display: inline-flex; align-items: center; gap: 6px;">
                            ${this._icons.save}
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

    _nextExecTimer: null,
    _targetNextExecEnd: null,

    async refresh() {
        const tasks = [
            this.loadStatus(),
            this.loadKPIs(),
            this.loadReviewQueue(),
            this.loadDecisions(),
            this.loadLearnedRules()
        ];
        if (window.BankSyncView) {
            if (typeof window.BankSyncView.loadConnections === 'function') {
                tasks.push(window.BankSyncView.loadConnections().catch(() => {}));
            }
            if (typeof window.BankSyncView.loadVaultStatus === 'function') {
                tasks.push(window.BankSyncView.loadVaultStatus().catch(() => {}));
            }
            if (typeof window.BankSyncView.loadAutoSyncSettings === 'function') {
                tasks.push(window.BankSyncView.loadAutoSyncSettings().catch(() => {}));
            }
        }
        await Promise.all(tasks);
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

    startNextExecCountdown(status) {
        if (this._nextExecTimer) {
            clearInterval(this._nextExecTimer);
            this._nextExecTimer = null;
        }

        const scannerEl = document.getElementById('apHeroCylonScanner');
        const countdownTimeEl = document.getElementById('apHeroCountdownTime');
        if (!scannerEl || !countdownTimeEl) return;

        const isEnabled = !!status?.is_enabled;
        const isAutoSyncEnabled = !!status?.bank_auto_sync_enabled;
        const isVaultUnlocked = !!status?.vault_unlocked;
        const nextIso = status?.next_execution_at;
        const remSecFromStatus = status?.next_execution_countdown_seconds;

        // Point 5 : Masquer le compte à rebours en mode désactivé ou sans auto-sync
        if (!isEnabled || !isAutoSyncEnabled) {
            scannerEl.style.display = 'none';
            return;
        }

        // Visible en mode actif
        scannerEl.style.display = 'flex';

        if (!isVaultUnlocked) {
            countdownTimeEl.innerHTML = `<span style="color: #f59e0b; font-size: 11px; cursor: pointer;" onclick="event.stopPropagation(); window.BankSyncView && window.BankSyncView.unlockVaultManually()" title="${window.i18n ? window.i18n.t('autopilot_vault_locked_title') : 'Déverrouiller le coffre pour reprendre les relevés'}">${window.i18n ? window.i18n.t('autopilot_vault_locked') : 'Coffre verrouillé'}</span>`;
            return;
        }

        let targetEnd = null;
        if (nextIso) {
            const parsed = new Date(nextIso).getTime();
            if (!isNaN(parsed)) targetEnd = parsed;
        } else if (remSecFromStatus !== null && remSecFromStatus !== undefined) {
            targetEnd = Date.now() + remSecFromStatus * 1000;
        }

        if (!targetEnd) {
            countdownTimeEl.textContent = window.i18n ? window.i18n.t('autopilot_sync_on_import') : 'À l\'import';
            return;
        }

        this._targetNextExecEnd = targetEnd;

        const formatRem = (seconds) => {
            if (seconds <= 0) return window.i18n ? window.i18n.t('autopilot_sync_running') : 'Relevé en cours...';
            const hrs = Math.floor(seconds / 3600);
            const mins = Math.floor((seconds % 3600) / 60);
            const secs = Math.floor(seconds % 60);
            if (hrs > 0) {
                return `${hrs}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
            }
            if (mins > 0) {
                return `${mins}m ${secs.toString().padStart(2, '0')}s`;
            }
            return `${secs}s`;
        };

        const updateTick = () => {
            const timeEl = document.getElementById('apHeroCountdownTime');
            if (!timeEl) {
                if (this._nextExecTimer) {
                    clearInterval(this._nextExecTimer);
                    this._nextExecTimer = null;
                }
                return;
            }
            const diffMs = this._targetNextExecEnd - Date.now();
            const remSec = Math.max(0, Math.floor(diffMs / 1000));
            timeEl.textContent = formatRem(remSec);
            if (targetEnd) {
                timeEl.title = window.i18n ? window.i18n.t('autopilot_sync_next_scheduled').replace('{datetime}', new Date(targetEnd).toLocaleString()) : `Prochain relevé prévu le ${new Date(targetEnd).toLocaleString()}`;
            }

            if (remSec <= 0) {
                if (this._nextExecTimer) {
                    clearInterval(this._nextExecTimer);
                    this._nextExecTimer = null;
                }
                setTimeout(() => {
                    if (window.app && window.app.currentView === 'autopilot') {
                        this.refresh();
                    }
                }, 5000);
            }
        };

        updateTick();
        this._nextExecTimer = setInterval(updateTick, 1000);
    },

    renderStatus(status) {
        const isEnabled = !!status.is_enabled;

        const masterSwitch = document.getElementById('apMasterSwitch');
        if (masterSwitch) {
            masterSwitch.checked = isEnabled;
        }

        const heroSwitch = document.getElementById('apHeroMasterSwitch');
        const heroStateText = document.getElementById('apHeroSwitchStateText');
        if (heroSwitch) {
            heroSwitch.classList.toggle('is-active', isEnabled);
            heroSwitch.classList.toggle('is-inactive', !isEnabled);
        }
        if (heroStateText) {
            heroStateText.textContent = isEnabled ? (window.i18n ? window.i18n.t('autopilot_state_active') : 'En mission (Actif)') : (window.i18n ? window.i18n.t('autopilot_state_standby') : 'En veille');
        }

        // Point 2 : Griser / Dégriser la page en mode désactivé
        const cockpit = document.getElementById('apCockpitLayout');
        if (cockpit) {
            cockpit.classList.toggle('is-ap-inactive', !isEnabled);
            cockpit.classList.toggle('is-ap-active', isEnabled);
        }

        const badge = document.getElementById('apStatusBadge');
        if (badge) {
            badge.style.cursor = 'pointer';
            if (isEnabled) {
                badge.textContent = window.i18n ? (window.i18n.t('autopilot_status_active') || 'ACTIF') : 'ACTIF';
                badge.style.background = 'rgba(16,185,129,0.15)';
                badge.style.color = '#10b981';
                badge.style.border = '1px solid #10b981';
                badge.title = window.i18n ? window.i18n.t('autopilot_status_active_tooltip') : 'Auto-Pilote actif — Cliquez pour revoir le résumé de mission';
            } else {
                badge.textContent = window.i18n ? (window.i18n.t('autopilot_status_inactive') || 'INACTIF') : 'INACTIF';
                badge.style.background = 'rgba(107,114,128,0.15)';
                badge.style.color = '#9ca3af';
                badge.style.border = '1px solid #6b7280';
                badge.title = window.i18n ? window.i18n.t('autopilot_status_badge_tooltip') : 'Auto-Pilote en veille — Cliquez pour afficher le briefing';
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

        // Format du dernier relevé / cycle
        const lastExecEl = document.getElementById('apLastExecTime');
        if (lastExecEl) {
            const lastIso = status.last_execution_at || status.last_execution || status.last_run_at;
            if (lastIso) {
                try {
                    const dt = new Date(lastIso);
                    const now = new Date();
                    const isToday = dt.toDateString() === now.toDateString();
                    const yesterday = new Date(now);
                    yesterday.setDate(yesterday.getDate() - 1);
                    const isYesterday = dt.toDateString() === yesterday.toDateString();

                    const timeStr = dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    if (isToday) {
                        lastExecEl.textContent = window.i18n ? window.i18n.t('autopilot_kpi_today_at').replace('{time}', timeStr) : `Aujourd'hui à ${timeStr}`;
                    } else if (isYesterday) {
                        lastExecEl.textContent = window.i18n ? window.i18n.t('autopilot_kpi_yesterday_at').replace('{time}', timeStr) : `Hier à ${timeStr}`;
                    } else {
                        const dateStr = dt.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
                        lastExecEl.textContent = window.i18n ? window.i18n.t('autopilot_kpi_date_at').replace('{date}', dateStr).replace('{time}', timeStr) : `${dateStr} à ${timeStr}`;
                    }
                    lastExecEl.title = dt.toLocaleString();
                } catch (e) {
                    lastExecEl.textContent = window.i18n ? window.i18n.t('autopilot_kpi_recently') : 'Récemment';
                }
            } else {
                lastExecEl.textContent = window.i18n ? window.i18n.t('autopilot_kpi_no_sync') : 'Aucun relevé';
            }
        }

        // Lancement du compte à rebours dynamique live
        this.startNextExecCountdown(status);

        if (window.BankSyncView && typeof window.BankSyncView.renderVaultStatusBar === 'function') {
            window.BankSyncView.renderVaultStatusBar();
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
                    previewText.innerHTML = window.i18n ? window.i18n.t('autopilot_threshold_preview_result').replace('{rel}', rel).replace('{rev}', rev) : `<strong>${rel}</strong> deviendront fiable(s), <strong>${rev}</strong> nécessiteront une vérification.`;
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
            showToast(window.i18n ? window.i18n.t('autopilot_toast_threshold_applied').replace('{val}', val).replace('{applied}', applied) : `Seuil fixé à ${val}%. ${applied} écriture(s) mise(s) à jour.`, 'success');
            await this.refresh();
            if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
                window.app.updateAutopilotBadge();
            }
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
            window.dispatchEvent(new CustomEvent('transactions_updated'));
        } catch (e) {
            showToast(window.i18n ? window.i18n.t('autopilot_toast_threshold_apply_error') : 'Erreur application seuil aux écritures', 'error');
        } finally {
            if (btn) btn.disabled = false;
        }
    },

    async saveThreshold(val) {
        try {
            const num = parseFloat(val);
            await API.put('/api/autopilot/threshold', { threshold: num });
            showToast(window.i18n ? window.i18n.t('autopilot_toast_threshold_saved').replace('{num}', num) : `Seuil de tolérance fixé à ${num}%`, 'success');
            await this.loadStatus();
        } catch (e) {
            showToast(window.i18n ? window.i18n.t('autopilot_toast_threshold_error') : 'Erreur mise à jour seuil', 'error');
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
            const groupIcon = this._icons[group.iconKey] || '';
            const catTitle = window.i18n ? (window.i18n.t(group.categoryKey) || group.category) : group.category;
            return `
                <div style="background: var(--bg-card, var(--bg-surface)); border: 1px solid var(--border-color); border-radius: 12px; margin-bottom: 16px; overflow: hidden;">
                    <div style="padding: 12px 16px; background: rgba(255,255,255,0.02); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                        <div style="display: flex; align-items: center; gap: 8px;">
                            <span style="display: inline-flex; align-items: center; color: var(--accent);">${groupIcon}</span>
                            <span style="font-weight: 700; font-size: 13px; color: var(--text-main);">${escapeHtml(catTitle)}</span>
                        </div>
                        <span class="badge" style="font-size: 10.5px; background: rgba(99,102,241,0.12); color: var(--accent);">
                            ${groupActiveCount}/${group.items.length}
                        </span>
                    </div>
                    <div style="padding: 10px 16px; display: flex; flex-direction: column; gap: 10px;">
                        ${group.items.map(item => {
                            const isChecked = !!subtoggles[item.key];
                            const itemLabel = window.i18n ? (window.i18n.t(item.labelKey) || item.label) : item.label;
                            const itemDesc = window.i18n ? (window.i18n.t(item.descKey) || item.desc) : item.desc;
                            return `
                                <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-size: 12.5px; font-weight: 600; color: ${isChecked ? 'var(--text-main)' : 'var(--text-muted)'}; margin-bottom: 2px;">
                                            ${escapeHtml(itemLabel)}
                                        </div>
                                        <div style="font-size: 11px; color: var(--text-muted); line-height: 1.35;">
                                            ${escapeHtml(itemDesc)}
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
            showToast(window.i18n ? window.i18n.t('autopilot_toast_subtoggle_error') : 'Erreur lors de la mise à jour de l\'automatisme', 'error');
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
            showToast(window.i18n ? window.i18n.t('autopilot_toast_briques_reset') : 'Toutes les 15 briques d\'autonomie sont activées', 'success');
            await this.loadStatus();
        } catch (e) {
            showToast(window.i18n ? window.i18n.t('autopilot_toast_briques_reset_error') : 'Erreur réinitialisation des briques', 'error');
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
            container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);" data-i18n="autopilot_review_error">${window.i18n ? window.i18n.t('autopilot_review_error') : 'Erreur lors du chargement des opérations à vérifier.'}</div>`;
        }
    },

    renderReviewQueue() {
        const container = document.getElementById('apReviewListContainer');
        const pill = document.getElementById('apReviewSummaryPill');
        if (!container) return;

        const count = (this._reviewQueue || []).length;
        if (pill) {
            pill.textContent = window.i18n ? window.i18n.t('autopilot_review_count_badge').replace('{count}', count) : `${count} à vérifier`;
            pill.style.background = count > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.12)';
            pill.style.color = count > 0 ? '#f59e0b' : '#10b981';
            pill.style.borderColor = count > 0 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)';
        }

        if (count === 0) {
            container.innerHTML = `
                <div style="text-align: center; padding: 24px; color: var(--text-muted); font-size: 13px;">
                    <div style="display: inline-flex; align-items: center; gap: 8px; color: #10b981; font-weight: 600;">
                        ${this._icons.check}
                        <span data-i18n="autopilot_review_empty">${window.i18n ? (window.i18n.t('autopilot_review_empty') || 'Aucune opération en attente de vérification. Vos relevés sont parfaitement synchronisés !') : 'Aucune opération en attente de vérification.'}</span>
                    </div>
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
                            <th style="padding: 8px 12px; width: 95px;" data-i18n="autopilot_review_th_date">${window.i18n ? window.i18n.t('autopilot_review_th_date') : 'Date'}</th>
                            <th style="padding: 8px 12px; width: 140px;" data-i18n="label_account">${window.i18n ? window.i18n.t('label_account') : 'Compte'}</th>
                            <th style="padding: 8px 12px; min-width: 260px;" data-i18n="autopilot_review_th_desc">${window.i18n ? window.i18n.t('autopilot_review_th_desc') : 'Libellé Brut & Identifié'}</th>
                            <th style="padding: 8px 12px; width: 130px;" data-i18n="autopilot_review_th_category">${window.i18n ? window.i18n.t('autopilot_review_th_category') : 'Catégorie'}</th>
                            <th style="padding: 8px 12px; width: 110px; text-align: right;" data-i18n="autopilot_review_th_amount">${window.i18n ? window.i18n.t('autopilot_review_th_amount') : 'Montant'}</th>
                            <th style="padding: 8px 12px; width: 90px; text-align: center;" data-i18n="autopilot_review_col_confidence">${window.i18n ? window.i18n.t('autopilot_review_col_confidence') : 'Confiance'}</th>
                            <th style="padding: 8px 12px; text-align: right; width: 180px;" data-i18n="autopilot_review_th_actions">${window.i18n ? window.i18n.t('autopilot_review_th_actions') : 'Actions'}</th>
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
                                            <span style="display: inline-flex; align-items: center; gap: 5px;">${this._icons.link} <span><span data-i18n="autopilot_review_forecast_detected">${window.i18n ? window.i18n.t('autopilot_review_forecast_detected') : 'Prévision :'}</span> <strong>${escapeHtml(bestCandidate.description)}</strong> (<span class="privacy-blur">${Number(bestCandidate.amount).toFixed(2)} €</span>)</span></span>
                                        </div>
                                    ` : ''}
                                </td>
                                <td style="padding: 12px; white-space: nowrap; vertical-align: middle;">
                                    <span class="badge" style="font-size: 11px; font-weight: 600;">${escapeHtml(item.category || '—')}</span>
                                </td>
                                <td style="padding: 12px; text-align: right; white-space: nowrap; font-weight: 700; font-size: 13.5px; color: ${amtColor}; vertical-align: middle;">
                                    <span class="privacy-blur">${amtStr}</span>
                                </td>
                                <td style="padding: 12px; text-align: center; white-space: nowrap; vertical-align: middle;">
                                    <span class="badge" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 700; font-size: 11px; padding: 3px 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px;">
                                        ${this._icons.alertCircle} ${conf}%
                                    </span>
                                </td>
                                <td style="padding: 12px; text-align: right; white-space: nowrap; vertical-align: middle;">
                                    <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
                                        ${bestCandidate ? `
                                            <div class="candidate-forecast-action" style="display: inline-flex; align-items: center;">
                                                <button class="btn btn-sm" style="background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid var(--accent); padding: 5px 10px; font-size: 11.5px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;" onclick="window.AutopilotView.promptInlineLinkConfirm(this, ${item.id}, ${bestCandidate.id})" title="${window.i18n ? window.i18n.t('autopilot_review_btn_link_title').replace('{desc}', escapeHtml(bestCandidate.description)) : `Lier à la prévision '${escapeHtml(bestCandidate.description)}' sans créer de doublon`}">
                                                    ${this._icons.link} <span data-i18n="autopilot_review_btn_link">${window.i18n ? window.i18n.t('autopilot_review_btn_link') : 'Lier'}</span>
                                                </button>
                                            </div>
                                        ` : `
                                            <button class="btn btn-secondary btn-sm" style="padding: 5px 10px; font-size: 11.5px; color: #10b981; border-color: rgba(16, 185, 129, 0.3); display: inline-flex; align-items: center; gap: 5px;" onclick="window.AutopilotView.validateReviewItem(${item.id}, this)" title="${window.i18n ? (window.i18n.t('autopilot_review_btn_validate') || 'Valider sans modifier') : 'Valider sans modifier'}">
                                                ${this._icons.check} <span>${window.i18n ? (window.i18n.t('autopilot_review_btn_validate') || 'Valider') : 'Valider'}</span>
                                            </button>
                                        `}
                                        <button class="btn btn-primary btn-sm" style="padding: 5px 10px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 5px;" onclick="window.AutopilotView.openReviewModal(${item.id})" title="${window.i18n ? (window.i18n.t('autopilot_review_btn_edit') || 'Corriger libellé / catégorie') : 'Corriger libellé / catégorie'}">
                                            ${this._icons.edit} <span>${window.i18n ? (window.i18n.t('autopilot_review_btn_edit') || 'Éditer') : 'Éditer'}</span>
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
                                <div class="privacy-blur" style="font-size: 15px; font-weight: 800; color: ${amtColor};">
                                    ${amtStr}
                                </div>
                            </div>

                            <div>
                                <div style="font-weight: 700; font-size: 13.5px; color: var(--text-main);">${escapeHtml(item.description || item.raw_description || '')}</div>
                                ${item.raw_description && item.raw_description !== item.description ? `<div style="font-size: 11px; color: var(--text-muted); font-family: monospace; margin-top: 2px;">${escapeHtml(item.raw_description)}</div>` : ''}
                            </div>

                            ${bestCandidate ? `
                                <div style="background: rgba(99,102,241,0.08); border: 1px dashed rgba(99,102,241,0.3); border-radius: 8px; padding: 8px 10px; font-size: 12px; color: var(--text-main);">
                                    <div style="font-weight: 600; color: var(--accent); margin-bottom: 2px; display: inline-flex; align-items: center; gap: 4px;">${this._icons.link} <span data-i18n="autopilot_review_suggested_forecast">${window.i18n ? window.i18n.t('autopilot_review_suggested_forecast') : 'Prévision suggérée :'}</span></div>
                                    <div style="display: flex; justify-content: space-between; align-items: center;">
                                        <span>${escapeHtml(bestCandidate.description)}</span>
                                        <span class="privacy-blur" style="font-weight: 700; color: var(--accent);">${Number(bestCandidate.amount).toFixed(2)} €</span>
                                    </div>
                                </div>
                            ` : ''}

                            <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 8px; border-top: 1px solid var(--border-color); margin-top: 2px; flex-wrap: wrap; gap: 8px;">
                                <div style="display: flex; align-items: center; gap: 6px;">
                                    <span class="badge" style="font-size: 11px; font-weight: 600;">${escapeHtml(item.category || '—')}</span>
                                    <span class="badge" style="background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 700; font-size: 10.5px; display: inline-flex; align-items: center; gap: 4px;">
                                        ${this._icons.alertCircle} ${conf}%
                                    </span>
                                </div>
                                <div style="display: flex; gap: 6px;">
                                    ${bestCandidate ? `
                                        <div class="candidate-forecast-action" style="display: inline-flex; align-items: center;">
                                            <button class="btn btn-sm" style="background: rgba(99,102,241,0.15); color: var(--accent); border: 1px solid var(--accent); padding: 5px 12px; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 5px;" onclick="window.AutopilotView.promptInlineLinkConfirm(this, ${item.id}, ${bestCandidate.id})">
                                                ${this._icons.link} <span>Lier</span>
                                            </button>
                                        </div>
                                    ` : `
                                        <button class="btn btn-secondary btn-sm" style="padding: 5px 12px; font-size: 12px; color: #10b981; border-color: rgba(16, 185, 129, 0.3); display: inline-flex; align-items: center; gap: 5px;" onclick="window.AutopilotView.validateReviewItem(${item.id}, this)">
                                            ${this._icons.check} <span>Valider</span>
                                        </button>
                                    `}
                                    <button class="btn btn-primary btn-sm" style="padding: 5px 12px; font-size: 12px; display: inline-flex; align-items: center; gap: 5px;" onclick="window.AutopilotView.openReviewModal(${item.id})">
                                        ${this._icons.edit} <span data-i18n="autopilot_review_btn_edit">${window.i18n ? window.i18n.t('autopilot_review_btn_edit') : 'Éditer'}</span>
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
                btn.innerHTML = '...';
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
            showToast(window.i18n ? window.i18n.t('autopilot_toast_validate_error') : 'Erreur lors de la validation', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `${this._icons.check} <span>Valider</span>`;
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
                btn.innerHTML = '...';
            }
            const res = await API.post(`/api/autopilot/review/${txId}/link`, {
                target_forecast_id: targetForecastId,
                learn_rule: true
            });
            this.closeOverrideModal();
            showToast(res.message || (window.i18n ? window.i18n.t('autopilot_toast_link_success') : 'Opération liée à la prévision avec succès'), 'success');
            await this.refresh();
            if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
                window.app.updateAutopilotBadge();
            }
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
            window.dispatchEvent(new CustomEvent('transactions_updated'));
        } catch (e) {
            showToast(window.i18n ? window.i18n.t('autopilot_toast_link_error') : 'Erreur lors de la liaison avec la prévision', 'error');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `${this._icons.link} <span>Lier</span>`;
            }
        }
    },

    onHeroSwitchClick(event) {
        if (event) event.preventDefault();
        const checkbox = document.getElementById('apMasterSwitch');
        const nextState = !this._status?.is_enabled;
        if (checkbox) checkbox.checked = nextState;
        this.toggleMasterSwitch(nextState);
    },

    _hudDismissTimer: null,
    _hudProgressInterval: null,
    _hudRemainingMs: 3000,
    _hudTotalMs: 3000,
    _hudStartTime: 0,
    _hudIsPaused: false,

    showEngagementHud() {
        this.triggerEngagementExperience();
    },

    triggerEngagementExperience() {
        const hud = document.getElementById('apEngagementHud');
        if (!hud) return;

        if (this._hudDismissTimer) {
            clearTimeout(this._hudDismissTimer);
            this._hudDismissTimer = null;
        }
        if (this._hudProgressInterval) {
            clearInterval(this._hudProgressInterval);
            this._hudProgressInterval = null;
        }

        hud.classList.remove('ap-hud-leaving');
        hud.style.display = 'flex';

        // Trigger pulse on left performance panel
        const kpiPanel = document.querySelector('.ap-kpi-panel');
        if (kpiPanel) {
            kpiPanel.classList.remove('ap-panel-engaged');
            void kpiPanel.offsetWidth; // force DOM reflow
            kpiPanel.classList.add('ap-panel-engaged');
        }

        this._hudTotalMs = 3000;
        this._hudRemainingMs = 3000;
        this._hudStartTime = Date.now();
        this._hudIsPaused = false;

        const progressBar = document.getElementById('apHudProgressBar');
        if (progressBar) {
            progressBar.style.width = '100%';
        }

        this._startHudCountdown();
    },

    _startHudCountdown() {
        if (this._hudProgressInterval) clearInterval(this._hudProgressInterval);

        this._hudStartTime = Date.now();

        const progressBar = document.getElementById('apHudProgressBar');

        this._hudProgressInterval = setInterval(() => {
            if (this._hudIsPaused) return;
            const elapsed = Date.now() - this._hudStartTime;
            const remaining = Math.max(0, this._hudRemainingMs - elapsed);
            const percent = (remaining / this._hudTotalMs) * 100;
            if (progressBar) {
                progressBar.style.width = `${percent}%`;
            }
            if (remaining <= 0) {
                clearInterval(this._hudProgressInterval);
                this._hudProgressInterval = null;
                this.dismissEngagementHud();
            }
        }, 40);
    },

    pauseHudTimer() {
        if (this._hudIsPaused) return;
        this._hudIsPaused = true;
        const elapsed = Date.now() - this._hudStartTime;
        this._hudRemainingMs = Math.max(300, this._hudRemainingMs - elapsed);
    },

    resumeHudTimer() {
        if (!this._hudIsPaused) return;
        this._hudIsPaused = false;
        this._hudStartTime = Date.now();
        // Keep at least 1.5s after hover to leave smoothly
        if (this._hudRemainingMs < 1500) {
            this._hudRemainingMs = 1500;
            this._hudTotalMs = Math.max(this._hudTotalMs, 1500);
        }
    },

    dismissEngagementHud(event) {
        if (event) event.stopPropagation();
        const hud = document.getElementById('apEngagementHud');
        if (!hud) return;

        if (this._hudDismissTimer) {
            clearTimeout(this._hudDismissTimer);
            this._hudDismissTimer = null;
        }
        if (this._hudProgressInterval) {
            clearInterval(this._hudProgressInterval);
            this._hudProgressInterval = null;
        }

        hud.classList.add('ap-hud-leaving');
        setTimeout(() => {
            hud.style.display = 'none';
            hud.classList.remove('ap-hud-leaving');
        }, 320);
    },

    async toggleMasterSwitch(enabled) {
        try {
            const status = await API.post('/api/autopilot/toggle', { enabled });
            this._status = status;
            this.renderStatus(status);
            if (enabled) {
                this.triggerEngagementExperience();
            } else {
                showToast(window.i18n ? window.i18n.t('autopilot_toast_manual_mode') : 'Mode Manuel repris — Auto-Pilote en veille', 'info');
            }
            window.dispatchEvent(new CustomEvent('autopilot_updated'));
        } catch (e) {
            showToast(window.i18n ? window.i18n.t('autopilot_toast_toggle_error') : 'Erreur lors du basculement Auto-Pilote', 'error');
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
            feed.innerHTML = `<div style="text-align:center; padding:30px; color:#ef4444;" data-i18n="autopilot_feed_error">${window.i18n ? window.i18n.t('autopilot_feed_error') : 'Erreur de chargement du flux de décisions.'}</div>`;
        }
    },

    renderDecisions() {
        const feed = document.getElementById('apDecisionsFeed');
        if (!feed) return;

        if (this._decisions.length === 0) {
            feed.innerHTML = `
                <div style="text-align: center; padding: 40px; color: var(--text-muted);">
                    <div style="display: flex; justify-content: center; margin-bottom: 8px; color: var(--accent);">${this._icons.steeringWheel}</div>
                    <div style="font-weight: 600;" data-i18n="autopilot_feed_empty">${window.i18n ? window.i18n.t('autopilot_feed_empty') : 'Aucune décision enregistrée.'}</div>
                    <div style="font-size: 12px; margin-top: 4px;" data-i18n="autopilot_feed_empty_sub">${window.i18n ? window.i18n.t('autopilot_feed_empty_sub') : 'Les futures opérations traitées automatiquement apparaîtront ici.'}</div>
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
            const isUnbatched = batchId === 'unbatched';
            const batchTitle = isUnbatched 
                ? (window.i18n ? window.i18n.t('autopilot_feed_unbatched_title') : 'Actions individuelles (hors lot)')
                : (window.i18n ? window.i18n.t('autopilot_feed_batch_id_title').replace('{batchId}', batchId) : `Identifiant du lot : ${batchId}`);
            const batchLabel = isUnbatched
                ? (window.i18n ? window.i18n.t('autopilot_feed_unbatched_label') : 'Hors lot')
                : (window.i18n ? window.i18n.t('autopilot_feed_batch_label') : 'Lot');
            const batchShortDisplay = isUnbatched 
                ? (window.i18n ? window.i18n.t('autopilot_feed_unbatched_short') : 'Hors lot')
                : `#${batchId.substring(0, 8)}`;
            const actionsCountLabel = window.i18n ? window.i18n.t('autopilot_feed_actions_count').replace('{count}', items.length) : `${items.length} action(s)`;

            html += `
                <div class="ap-batch-card" id="apBatch_${escapeHtml(batchId)}" data-batch-id="${escapeHtml(batchId)}" style="opacity: ${isAllUndone ? '0.6' : '1'};">
                    <div class="ap-batch-header" onclick="window.AutopilotView.toggleBatch('${escapeHtml(batchId)}')">
                        <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                            <span class="ap-batch-chevron">▾</span>
                            <span style="display: inline-flex; align-items: center; color: var(--accent);">${this._icons.package}</span>
                            <span class="ap-batch-label-group" title="${escapeHtml(batchTitle)}">
                                <span style="font-weight: 700; font-size: 12.5px;">${escapeHtml(batchLabel)}</span>
                                ${!isUnbatched ? `<code class="ap-batch-code">${escapeHtml(batchShortDisplay)}</code>` : ''}
                            </span>
                            <span style="font-size: 11.5px; color: var(--text-muted);">${batchDate}</span>
                            <span class="badge" style="font-size: 10px; padding: 2px 8px; border-radius: 10px; background: rgba(99,102,241,0.1); color: var(--accent);">${escapeHtml(actionsCountLabel)}</span>
                        </div>
                        <div onclick="event.stopPropagation()">
                            ${!isAllUndone && !isUnbatched ? `
                                <button class="btn btn-danger btn-sm" style="font-size: 11px; padding: 3px 8px; display: inline-flex; align-items: center; gap: 4px;" data-batch-id="${escapeHtml(batchId)}" onclick="window.AutopilotView.onRollbackCycleClick(this)">
                                    ${this._icons.undo} <span data-i18n="autopilot_feed_batch_rollback">${window.i18n ? window.i18n.t('autopilot_feed_batch_rollback') : 'Annuler le lot'}</span>
                                </button>
                            ` : (isAllUndone ? `<span style="font-size: 11px; color: #ef4444; font-style: italic;" data-i18n="autopilot_feed_batch_undone">${window.i18n ? window.i18n.t('autopilot_feed_batch_undone') : 'Lot annulé'}</span>` : '')}
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
        const key = 'autopilot_reason_' + reason;
        const translated = window.i18n ? window.i18n.t(key) : null;
        const label = (translated && translated !== key) ? translated : reason;
        const tooltip = window.i18n ? window.i18n.t('autopilot_feed_reason_title').replace('{reason}', escapeHtml(reason)) : `Raison de la décision : ${escapeHtml(reason)}`;
        return `<span class="ap-reason-badge" title="${tooltip}">${escapeHtml(label)}</span>`;
    },

    _renderDecisionItem(d) {
        const score = d.confidence_score !== null ? Math.round(d.confidence_score) : null;
        let scoreBadge = '';
        if (score !== null) {
            const color = score >= 90 ? '#10b981' : (score >= 80 ? 'var(--accent)' : '#f59e0b');
            scoreBadge = `<span style="font-size: 10.5px; font-weight: 700; padding: 2px 6px; border-radius: 6px; background: ${color}22; color: ${color}; border: 1px solid ${color}44;">${score}%</span>`;
        }

        const typeKey = 'autopilot_type_' + d.decision_type;
        const translatedType = window.i18n ? window.i18n.t(typeKey) : null;
        const typeLabel = (translatedType && translatedType !== typeKey) ? translatedType : (d.decision_type || '');

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
                            ${escapeHtml(d.label || (window.i18n ? window.i18n.t('autopilot_feed_no_label') : 'Sans libellé'))}
                            ${d.raw_label && d.raw_label !== d.label ? `<span style="font-size: 11px; color: var(--text-muted); font-weight: normal; margin-left: 6px;">(${escapeHtml(d.raw_label)})</span>` : ''}
                        </div>
                        <div style="font-size: 11px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; margin-top: 2px;">
                            <span style="display: inline-flex; align-items: center; gap: 4px;">${this._icons.tag} ${escapeHtml(d.category || '—')}</span>
                            ${d.account_name ? `<span style="display: inline-flex; align-items: center; gap: 4px;">${this._icons.shield} ${escapeHtml(d.account_name)}</span>` : ''}
                            ${this.formatReasonBadge(d.reason)}
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="privacy-blur" style="font-size: 13.5px; font-weight: 700; color: ${amtColor}; min-width: 80px; text-align: right;">${amtDisplay}</span>
                    ${scoreBadge}
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 7px; display: inline-flex; align-items: center;" onclick="window.AutopilotView.inspectDecisionEntity(${d.id})" title="${window.i18n.t('autopilot_inspect_item') || 'Localiser l\'élément concerné'}">
                            ${this._icons.search}
                        </button>
                        ${isUndone ? `
                            <span class="badge" style="font-size: 10px; background: rgba(239,68,68,0.15); color: #ef4444; border: 1px solid #ef4444;" data-i18n="autopilot_feed_badge_undone">${window.i18n ? window.i18n.t('autopilot_feed_badge_undone') : 'Annulé'}</span>
                        ` : `
                            <div style="display: flex; gap: 6px;">
                                ${d.entity_type === 'transaction' && d.decision_type === 'reconciliation' ? `
                                    <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 7px; display: inline-flex; align-items: center; gap: 4px;" onclick="window.AutopilotView.unpointDecision(${d.id}, this)" title="${window.i18n ? window.i18n.t('autopilot_feed_btn_unpoint_title') : 'Dépointer la transaction'}">
                                        ${this._icons.unpoint} <span data-i18n="autopilot_feed_btn_unpoint">${window.i18n ? window.i18n.t('autopilot_feed_btn_unpoint') : 'Dépointer'}</span>
                                    </button>
                                ` : `
                                    <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 7px; display: inline-flex; align-items: center; gap: 4px;" onclick="window.AutopilotView.rollbackDecision(${d.id}, this)" title="${window.i18n ? window.i18n.t('autopilot_feed_btn_rollback_title') : 'Annuler cette décision'}">
                                        ${this._icons.undo} <span data-i18n="autopilot_feed_btn_rollback">${window.i18n ? window.i18n.t('autopilot_feed_btn_rollback') : 'Annuler'}</span>
                                    </button>
                                `}
                                ${d.entity_type === 'transaction' ? `
                                    <button class="btn btn-secondary btn-sm" style="font-size: 11px; padding: 2px 7px; display: inline-flex; align-items: center;" data-decision-id="${d.id}" data-label="${escapeHtml(d.label || '')}" data-category="${escapeHtml(d.category || '')}" data-amount="${d.amount}" onclick="window.AutopilotView.onOverrideClick(this)" title="${window.i18n ? window.i18n.t('autopilot_feed_btn_override_title') : 'Modifier et apprendre'}">
                                        ${this._icons.edit}
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
            info.textContent = window.i18n ? window.i18n.t('autopilot_feed_pagination_info').replace('{page}', this._currentPage + 1).replace('{totalPages}', totalPages).replace('{total}', this._totalDecisions) : `Page ${this._currentPage + 1} sur ${totalPages} (${this._totalDecisions} décision(s))`;
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
        showInlineConfirm(btn, window.i18n ? window.i18n.t('autopilot_confirm_rollback_decision') : 'Confirmer l\'annulation de cette décision ?', async () => {
            try {
                const res = await API.post(`/api/autopilot/decisions/${decisionId}/rollback`, {});
                showToast(res.message || (window.i18n ? window.i18n.t('autopilot_toast_decision_undone') : 'Décision annulée'), 'success');
                await this.refresh();
                window.dispatchEvent(new CustomEvent('autopilot_updated'));
            } catch (e) {
                showToast(window.i18n ? window.i18n.t('autopilot_toast_rollback_error') : 'Échec de l\'annulation', 'error');
            }
        });
    },

    async unpointDecision(decisionId, btn) {
        showInlineConfirm(btn, window.i18n ? window.i18n.t('autopilot_confirm_unpoint') : 'Dépointer cette transaction et rétablir la prévision ?', async () => {
            try {
                const res = await API.post(`/api/autopilot/decisions/${decisionId}/unpoint`, {});
                showToast(res.message || (window.i18n ? window.i18n.t('autopilot_toast_unpoint_success') : 'Transaction dépointée'), 'success');
                await this.refresh();
                window.dispatchEvent(new CustomEvent('autopilot_updated'));
            } catch (e) {
                showToast(window.i18n ? window.i18n.t('autopilot_toast_unpoint_error') : 'Échec du dépointage', 'error');
            }
        });
    },

    async rollbackCycle(batchId, btn) {
        showInlineConfirm(btn, window.i18n ? window.i18n.t('autopilot_confirm_rollback_batch').replace('{batchId}', batchId.substring(0, 8)) : `Annuler l'intégralité du lot ${batchId.substring(0, 8)} et le renvoyer dans le Sas d'attente ?`, async () => {
            try {
                const res = await API.post(`/api/autopilot/rollback-cycle/${batchId}`, {});
                showToast(res.message || (window.i18n ? window.i18n.t('autopilot_toast_batch_rollback_success') : 'Lot annulé et renvoyé dans le Sas'), 'success');
                await this.refresh();
                window.dispatchEvent(new CustomEvent('autopilot_updated'));
            } catch (e) {
                showToast(window.i18n ? window.i18n.t('autopilot_toast_batch_rollback_error') : 'Échec du rollback de lot', 'error');
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
                <input type="text" id="overrideCategory" class="input-styled" value="${escapeHtml(category || '')}" placeholder="${window.i18n ? window.i18n.t('autopilot_override_category_placeholder') : 'Catégorie'}">
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

        showToast(window.i18n ? window.i18n.t('autopilot_toast_forecast_selected').replace('{desc}', desc) : `Prévision '${desc}' sélectionnée pour fusion (cliquez sur "🔗 Lier" ou "Enregistrer")`, 'info');
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
                            <span style="display: inline-flex; align-items: center; color: var(--accent);">${this._icons.link}</span> <span data-i18n="autopilot_override_forecast_candidates_title">${window.i18n ? window.i18n.t('autopilot_override_forecast_candidates_title') : 'Prévision(s) récurrente(s) suggérée(s) pour fusion :'}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 8px;">
                            ${item.candidate_forecasts.map(cf => `
                                <div class="candidate-forecast-card" data-forecast-id="${cf.id}" data-desc="${escapeHtml(cf.description)}" data-cat="${escapeHtml(cf.category || '')}" data-amount="${cf.amount}" style="padding: 10px 14px; background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 8px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: all 0.15s ease; gap: 14px;" onclick="window.AutopilotView.onCandidateCardClick(this)" title="${window.i18n ? window.i18n.t('autopilot_override_forecast_select_title') : 'Sélectionner pour fusionner avec cette prévision'}">
                                    <div style="flex: 1; min-width: 0;">
                                        <div style="font-weight: 600; font-size: 13px; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHtml(cf.description)}</div>
                                        <div style="font-size: 11.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px;">${window.i18n ? window.i18n.t('autopilot_override_forecast_candidate_due').replace('{date}', cf.date_operation).replace('{category}', escapeHtml(cf.category || '—')) : `Prévu le ${cf.date_operation} • Catégorie : ${escapeHtml(cf.category || '—')}`}</div>
                                    </div>
                                    <div class="candidate-forecast-action" style="display: flex; align-items: center; gap: 10px; flex-shrink: 0;">
                                        <span class="privacy-blur" style="font-weight: 700; font-size: 13px; color: var(--accent); white-space: nowrap;">${Number(cf.amount).toFixed(2)} €</span>
                                        <button type="button" class="btn btn-primary btn-sm" style="font-size: 11.5px; font-weight: 700; padding: 5px 12px; display: inline-flex; align-items: center; gap: 4px; background: var(--accent); color: white; border: none; border-radius: 6px; cursor: pointer;" onclick="event.stopPropagation(); window.AutopilotView.promptInlineLinkConfirm(this, ${txId}, ${cf.id})">
                                            ${this._icons.link} <span>Lier</span>
                                        </button>
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
                <input type="text" id="overrideCategory" class="input-styled" value="${escapeHtml(finalCategory || '')}" placeholder="${window.i18n ? window.i18n.t('autopilot_override_category_placeholder') : 'Catégorie'}">
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
            showToast(window.i18n ? window.i18n.t('autopilot_toast_ai_error') : 'Erreur lors de la suggestion IA', 'error');
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
                showToast(window.i18n ? window.i18n.t('autopilot_toast_update_error') : 'Erreur lors de la mise à jour de l\'opération', 'error');
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
            showToast(window.i18n ? window.i18n.t('autopilot_toast_override_error') : 'Erreur lors de la modification', 'error');
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
            list.innerHTML = `<div style="text-align:center; padding:20px; color:var(--text-muted);" data-i18n="autopilot_workshop_empty">${window.i18n ? window.i18n.t('autopilot_workshop_empty') : 'Aucune règle apprise pour l\'instant.'}</div>`;
        }
    },

    renderLearnedRules() {
        const list = document.getElementById('apLearnedRulesList');
        if (!list) return;

        if (this._learnedRules.length === 0) {
            list.innerHTML = `
                <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12.5px;" data-i18n="autopilot_workshop_empty_sub">
                    ${window.i18n ? window.i18n.t('autopilot_workshop_empty_sub') : 'Aucune règle de correspondance enregistrée. Les règles s\'apprennent automatiquement dès que vous validez ou modifiez des opérations.'}
                </div>
            `;
            return;
        }

        list.innerHTML = `
            <table class="table" style="width: 100%; font-size: 12px; margin-top: 6px;">
                <thead>
                    <tr style="text-align: left; color: var(--text-muted); border-bottom: 1px solid var(--border-color);">
                        <th style="padding: 6px 8px;" data-i18n="autopilot_workshop_th_raw">${window.i18n ? window.i18n.t('autopilot_workshop_th_raw') : 'Motif Brut Détecté'}</th>
                        <th style="padding: 6px 8px;" data-i18n="autopilot_workshop_th_clean">${window.i18n ? window.i18n.t('autopilot_workshop_th_clean') : 'Libellé Propre'}</th>
                        <th style="padding: 6px 8px;" data-i18n="autopilot_workshop_th_category">${window.i18n ? window.i18n.t('autopilot_workshop_th_category') : 'Catégorie'}</th>
                        <th style="padding: 6px 8px; text-align: right;" data-i18n="autopilot_workshop_th_confidence">${window.i18n ? window.i18n.t('autopilot_workshop_th_confidence') : 'Origine'}</th>
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
            briquesBadge.title = window.i18n ? window.i18n.t('autopilot_header_briques_badge_tooltip').replace('{active}', active).replace('{total}', total) : `${active} sur ${total} automatismes actifs`;
        }

        // Review pill
        const revPill = document.getElementById('apReviewSummaryPill');
        if (revPill) {
            const count = (this._reviewQueue || []).length;
            revPill.textContent = window.i18n ? window.i18n.t('autopilot_review_count_badge').replace('{count}', count) : `${count} à vérifier`;
            revPill.style.background = count > 0 ? 'rgba(245, 158, 11, 0.15)' : 'rgba(16, 185, 129, 0.12)';
            revPill.style.color = count > 0 ? '#f59e0b' : '#10b981';
            revPill.style.borderColor = count > 0 ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.3)';
        }

        // Workshop pill
        const wPill = document.getElementById('apWorkshopSummaryPill');
        if (wPill) {
            const count = (this._learnedRules || []).length;
            wPill.textContent = window.i18n ? window.i18n.t('autopilot_workshop_active_rules').replace('{count}', count).replace('{s}', count > 1 ? 's' : '') : `${count} règle${count > 1 ? 's' : ''} active${count > 1 ? 's' : ''}`;
        }
    },

    _allBatchesCollapsed: false,
    toggleAllBatches() {
        this._allBatchesCollapsed = !this._allBatchesCollapsed;
        const cards = document.querySelectorAll('.ap-batch-card');
        cards.forEach(card => card.classList.toggle('collapsed', this._allBatchesCollapsed));
        const btn = document.getElementById('apToggleAllBatchesBtn');
        if (btn) {
            btn.textContent = this._allBatchesCollapsed ? (window.i18n ? window.i18n.t('autopilot_feed_expand_batches') : 'Déplier les lots') : (window.i18n ? window.i18n.t('autopilot_feed_collapse_batches') : 'Replier les lots');
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
