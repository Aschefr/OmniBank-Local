// overview.js — Cockpit (the app's home view)
window.OverviewView = {
    _selectedAccountId: '',
    _statsLookback: '6m', // 'all', '12m', '6m', '3m', '1m', '1w' — window of the spending-pace average
    _cachedMonthlyAverages: { income: 0, fixed: 0, variable: 0 },
    _stats: null,
    _accounts: [],
    _transactions: [],
    _accountsMap: {},
    _apStatus: null,
    _apDecisions: [],
    _apPopoverTimer: null,
    _apIsPopoverOpen: false,
    _apListenerBound: false,
    _apCountdownInterval: null,
    _apTargetCountdownEnd: null,
    _apSyncTriggered: false,
    _forecastSummary: null,

    _getTodayISO(d = new Date()) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    },

    _getEndOfMonthISO(d = new Date()) {
        const y = d.getFullYear();
        const m = d.getMonth();
        const lastDay = new Date(y, m + 1, 0).getDate();
        return `${y}-${String(m + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    },

    render() {
        if (window.ProfileStorage) {
            const savedAcc = window.ProfileStorage.get('overview_account_id');
            if (savedAcc !== null && savedAcc !== undefined) this._selectedAccountId = savedAcc;
            const savedLookback = window.ProfileStorage.get('overview_stats_lookback');
            if (savedLookback) this._statsLookback = savedLookback;
        }
        if (window.app?.config) {
            if ((this._selectedAccountId === '' || this._selectedAccountId === null || this._selectedAccountId === undefined) &&
                window.app.config.overview_account_id !== undefined &&
                (!window.ProfileStorage || window.ProfileStorage.get('overview_account_id') === null)) {
                this._selectedAccountId = window.app.config.overview_account_id;
            }
            if (window.app.config.overview_stats_lookback) this._statsLookback = window.app.config.overview_stats_lookback;
        }

        return `
            <div id="overviewRoot" class="overview-root cockpit-active">
                <!-- Header / Health Badge, Account Selector & Quick Actions -->
                <div class="overview-top-bar">
                    <div class="overview-header-main">
                        <div class="overview-title-group">
                            <h2 class="overview-main-title">🎛️ <span data-i18n="nav_cockpit">${window.i18n.t('nav_cockpit') || 'Cockpit'}</span></h2>
                            <div id="ovOrgTag" class="overview-org-tag" style="display:none;">🏢 <span data-i18n="overview_org_badge">${window.i18n.t('overview_org_badge') || 'Mode Organisation'}</span></div>
                            <div id="ovHealthBadge" class="overview-health-badge">—</div>
                        </div>
                    </div>
                    <div class="overview-controls-bar">
                        <div class="overview-controls-row-primary">
                            <div id="ovAccountSelect" class="overview-acc-dropdown">
                                <button type="button" class="overview-acc-trigger" onclick="window.OverviewView.toggleAccountDropdown(event)" aria-haspopup="listbox" aria-expanded="false">
                                    <span class="overview-acc-icon" id="ovAccountTriggerIcon">🏦</span>
                                    <span class="overview-acc-label" id="ovAccountTriggerLabel">${window.i18n.t('overview_filter_all_accounts') || 'Tous les comptes'}</span>
                                    <span class="overview-acc-chevron">▼</span>
                                </button>
                                <div class="overview-acc-menu" id="ovAccountMenu" role="listbox" style="display:none;"></div>
                            </div>

                            <button class="btn btn-primary overview-add-btn" onclick="window.OverviewView.showAddModal()" data-i18n-title="btn_add_operation" title="${window.i18n.t('btn_add_operation') || '➕ Nouvelle opération'}">
                                <span class="ov-btn-text-full" data-i18n="btn_add_operation">${window.i18n.t('btn_add_operation') || '➕ Nouvelle opération'}</span><span class="ov-btn-text-short">➕ Opération</span>
                            </button>
                        </div>

                        <div class="overview-actions-group" id="ovActionsGroup">
                            <!-- Auto-Pilot Distinctive Dynamic Activation Button & Info-Bulle Popover -->
                            <div class="overview-autopilot-widget" id="ovAutopilotWidget">
                                <button type="button" 
                                        class="overview-autopilot-btn is-inactive" 
                                        id="ovAutopilotBtn" 
                                        onclick="window.OverviewView.handleAutopilotBtnClick(event)" 
                                        onmouseenter="if (window.innerWidth > 1024) window.OverviewView.showAutopilotPopover()" 
                                        onmouseleave="window.OverviewView.scheduleHideAutopilotPopover()"
                                        aria-haspopup="dialog" 
                                        aria-expanded="false" 
                                        data-i18n-title="overview_autopilot_btn"
                                        title="${window.i18n.t('overview_autopilot_btn') || 'Auto-Pilote'}">
                                    <span class="overview-autopilot-icon">
                                        <svg class="ov-autopilot-svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                            <circle cx="12" cy="12" r="9.5"></circle>
                                            <circle cx="12" cy="12" r="3"></circle>
                                            <line x1="12" y1="15" x2="12" y2="21.5"></line>
                                            <line x1="2.5" y1="12" x2="9" y2="12"></line>
                                            <line x1="15" y1="12" x2="21.5" y2="12"></line>
                                        </svg>
                                    </span>
                                    <span class="overview-autopilot-label" id="ovAutopilotLabel" data-i18n="overview_autopilot_btn">${window.i18n.t('overview_autopilot_btn') || 'Auto-Pilote'}</span>
                                    <span class="overview-autopilot-dot" id="ovAutopilotDot"></span>
                                    <span class="overview-autopilot-timer-chip" id="ovAutopilotTimerChip" style="display:none;"></span>
                                    <span class="overview-autopilot-badge" id="ovAutopilotBadge" style="display:none;">0</span>
                                </button>
                                <div id="ovAutopilotBackdrop" class="ov-autopilot-backdrop" style="display:none;" onclick="window.OverviewView.closeAutopilotPopover()"></div>
                                <div class="overview-autopilot-popover" 
                                     id="ovAutopilotPopover" 
                                     style="display:none;" 
                                     role="dialog" 
                                     onmouseenter="window.OverviewView.keepAutopilotPopoverOpen()" 
                                     onmouseleave="window.OverviewView.scheduleHideAutopilotPopover()">
                                    <div class="ov-ap-popover-body" style="padding: 16px; text-align: center; color: var(--text-muted);">
                                        <span>⏳ Chargement...</span>
                                    </div>
                                </div>
                            </div>

                            <button class="overview-bank-sync-btn" style="display: none;" onclick="window.BankSyncView ? window.BankSyncView.triggerBackgroundSyncNow() : window.app.loadView('accounts')" data-i18n-title="bank_sync_run_background_tooltip" title="${window.i18n.t('bank_sync_run_background_tooltip') || 'Interroge vos banques connectées en tâche de fond pour récupérer les dernières opérations, détecter les correspondances à rapprocher et actualiser vos soldes sans bloquer l\'interface.'}">
                                <span>⚡</span> <span class="ov-btn-text-full" data-i18n="bank_sync_run_background_btn">${window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne'}</span><span class="ov-btn-text-short">Relever</span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Cockpit Mode (Simplified View with Gauges) -->
                <div class="cockpit-container" id="ovCockpitContainer">
                    <div class="cockpit-gauges-row" id="ovCockpitGauges"></div>
                    <div class="cockpit-cards-row" id="ovCockpitCards"></div>
                    <div class="cockpit-forecast-container" id="ovCockpitForecast"></div>
                </div>
            </div>
        `;
    },

    _initInFlight: false,
    _queuedInit: false,


    async _fetchRhythmAverages() {
        try {
            const accParam = this._selectedAccountId ? `&account_id=${this._selectedAccountId}` : '';
            const lookback = this._statsLookback || '6m';
            const data = await API.get(`/api/stats/rhythm?lookback=${lookback}${accParam}`);
            if (data) {
                this._cachedMonthlyAverages = { ...data, _serverComputed: true };
                this._renderCockpit();
            }
        } catch (e) {
            console.warn('[OverviewView] Erreur actualisation rhythm averages:', e);
        }
    },

    async _fetchForecastSummary(simAccParam = '') {
        try {
            const fs = await API.get('/api/simulator/forecast-summary' + simAccParam);
            if (fs) {
                this._forecastSummary = fs;
                this._renderCockpitForecast();
            }
        } catch (err) {
            console.warn('[OverviewView] Erreur chargement forecast summary:', err);
        }
    },

    async loadData() {
        return this.init();
    },

    async init() {
        if (this._initInFlight) {
            this._queuedInit = true;
            return;
        }
        this._initInFlight = true;

        try {
            // 1. Résolution synchrone de la configuration serveur (déjà chargée dans window.app.config)
            const config = (window.app && window.app.config)
                ? window.app.config
                : await API.get('/api/config/').catch(() => null);

            if (window.app && config && !window.app.config) {
                window.app.config = config;
            }

            // 2. Initialisation des préférences (ProfileStorage prioritaire, repli sur config serveur)
            if (window.ProfileStorage) {
                const savedAcc = window.ProfileStorage.get('overview_account_id');
                if (savedAcc !== null && savedAcc !== undefined) this._selectedAccountId = savedAcc;
                const savedLookback = window.ProfileStorage.get('overview_stats_lookback');
                if (savedLookback) this._statsLookback = savedLookback;
            }

            if (config) {
                const hasExplicitSavedAcc = window.ProfileStorage && window.ProfileStorage.get('overview_account_id') !== null;
                if (!hasExplicitSavedAcc && config.overview_account_id !== undefined) {
                    this._selectedAccountId = config.overview_account_id;
                    if (window.ProfileStorage && this._selectedAccountId) {
                        window.ProfileStorage.set('overview_account_id', this._selectedAccountId);
                    }
                }
                if (config.overview_stats_lookback !== undefined && (!window.ProfileStorage || window.ProfileStorage.get('overview_stats_lookback') === null)) {
                    this._statsLookback = config.overview_stats_lookback;
                }
            }

            // 2b. Rendu instantané SWR (Stale-While-Revalidate) si des données de session sont déjà en mémoire
            if (this._stats && this._accounts && this._accounts.length > 0) {
                this._populateAccountSelect();
                this._renderHealthBadge(this._stats);
                this._renderCockpit();
            }

            // 3. À CE STADE, this._selectedAccountId et this._statsLookback sont résolus AVANT les requêtes
            const lookback = this._statsLookback || '6m';
            const accParam = this._selectedAccountId ? `&account_id=${this._selectedAccountId}` : '';
            const simAccParam = this._selectedAccountId ? `?account_id=${this._selectedAccountId}` : '';

            const [stats, accounts, transactions, pendingData, rhythmAverages] = await Promise.all([
                API.get('/api/stats/dashboard'),
                API.get('/api/stats/accounts'),
                API.get('/api/transactions/?overview_window=true&limit=2000'),
                API.get('/api/bank-sync/pending').catch(err => {
                    console.warn('[OverviewView] Erreur chargement pending sync', err);
                    return null;
                }),
                API.get(`/api/stats/rhythm?lookback=${lookback}${accParam}`).catch(err => {
                    console.warn('[OverviewView] Erreur chargement rhythm stats', err);
                    return null;
                })
            ]);
            this._pendingData = pendingData;
            if (pendingData?.matches_by_tx_id && window.BankSyncView) {
                window.BankSyncView.pendingMatches = pendingData.matches_by_tx_id;
            }
            if (pendingData?.discrepancies_by_tx_id && window.BankSyncView) {
                window.BankSyncView.pendingDiscrepancies = pendingData.discrepancies_by_tx_id;
            }

            if (rhythmAverages) {
                this._cachedMonthlyAverages = { ...rhythmAverages, _serverComputed: true };
            }

            this._stats = stats;
            this._accounts = accounts || [];
            this._transactions = transactions || [];
            this._accountsMap = {};
            this._accounts.forEach(a => { this._accountsMap[a.id] = a; });

            this._populateAccountSelect();
            this._renderHealthBadge(stats);
            this._calculateAverages();

            // ── PRIORITÉ RÉACTIVITÉ (Zéro blocage) ──────────────────────────────
            // Dessiner immédiatement les composants sous les yeux de l'utilisateur
            this._renderCockpit();

            // ── CHARGEMENT EN ARRIÈRE-PLAN (Non-bloquant) ──────────────────────
            // Les widgets annexes, prévisions et graphiques s'actualisent sans bloquer l'affichage
            this._fetchForecastSummary(simAccParam).catch(e => console.warn('[OverviewView] Erreur forecast summary:', e));
            this._checkBankConnections().catch(e => console.warn('[OverviewView] Erreur check connections:', e));
            this._renderAutopilotWidget().catch(e => console.warn('[OverviewView] Erreur widget autopilot:', e));
        } finally {
            this._initInFlight = false;
            if (this._queuedInit) {
                this._queuedInit = false;
                this.init();
            }
        }
    },

    async saveConfig(updates) {
        try {
            if (window.app && window.app.config) {
                Object.assign(window.app.config, updates);
            }
            await API.post('/api/config/', updates);
        } catch (e) {
            console.error('[overview] Erreur sauvegarde config', e);
        }
    },

    toggleAccountDropdown(e) {
        if (e) e.stopPropagation();
        const menu = document.getElementById('ovAccountMenu');
        const trigger = document.querySelector('.overview-acc-trigger');
        const container = document.getElementById('ovAccountSelect');
        if (!menu) return;
        const isOpen = menu.style.display !== 'none';
        if (isOpen) {
            this.closeAccountDropdown();
        } else {
            menu.style.display = 'block';
            if (trigger) trigger.setAttribute('aria-expanded', 'true');
            if (container) container.classList.add('open');

            const onOutsideClick = (evt) => {
                if (container && !container.contains(evt.target)) {
                    this.closeAccountDropdown();
                    document.removeEventListener('click', onOutsideClick);
                }
            };
            setTimeout(() => document.addEventListener('click', onOutsideClick), 10);
        }
    },

    closeAccountDropdown() {
        const menu = document.getElementById('ovAccountMenu');
        const trigger = document.querySelector('.overview-acc-trigger');
        const container = document.getElementById('ovAccountSelect');
        if (menu) menu.style.display = 'none';
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
        if (container) container.classList.remove('open');
    },

    async _renderAutopilotWidget() {
        const btn = document.getElementById('ovAutopilotBtn');
        const label = document.getElementById('ovAutopilotLabel');
        const badge = document.getElementById('ovAutopilotBadge');
        const timerChip = document.getElementById('ovAutopilotTimerChip');
        const popover = document.getElementById('ovAutopilotPopover');
        if (!btn || !popover) return;

        try {
            const [status, decisionsRes] = await Promise.all([
                API.get('/api/autopilot/status', { silent: true }).catch(() => null),
                API.get('/api/autopilot/decisions?limit=15&deduplicate_entities=true', { silent: true }).catch(() => ({ items: [] }))
            ]);

            this._apStatus = status || { 
                is_enabled: false, 
                threshold: 85.0, 
                unseen_decisions_count: 0,
                last_execution_at: null,
                next_execution_at: null,
                next_execution_countdown_seconds: null
            };
            this._apDecisions = (decisionsRes && Array.isArray(decisionsRes.items)) ? decisionsRes.items : [];

            const isEnabled = !!this._apStatus.is_enabled;
            const threshold = Math.round(this._apStatus.threshold || 85);
            // Mode silencieux strict : le badge n'apparaît que si des opérations requièrent une vérification manuelle
            const pendingReviewCount = (this._apStatus.unseen_review_count ?? this._apStatus.review_queue_count ?? 0);

            // Set countdown target
            if (this._apStatus.next_execution_countdown_seconds !== null && this._apStatus.next_execution_countdown_seconds !== undefined) {
                this._apTargetCountdownEnd = Date.now() + (this._apStatus.next_execution_countdown_seconds * 1000);
            } else {
                this._apTargetCountdownEnd = null;
            }

            // Update Button State
            if (isEnabled) {
                btn.classList.add('is-active');
                btn.classList.remove('is-inactive');
                btn.setAttribute('title', window.i18n.t('overview_autopilot_btn_active') || 'Auto-Pilote (Actif)');
            } else {
                btn.classList.add('is-inactive');
                btn.classList.remove('is-active');
                btn.setAttribute('title', window.i18n.t('overview_autopilot_btn_inactive') || 'Auto-Pilote (En veille)');
            }

            if (label) {
                label.textContent = window.i18n.t('overview_autopilot_btn') || 'Auto-Pilote';
            }

            if (badge) {
                if (pendingReviewCount > 0) {
                    badge.textContent = pendingReviewCount > 99 ? '99+' : pendingReviewCount;
                    badge.style.display = 'inline-block';
                    badge.setAttribute('title', `${pendingReviewCount} ${window.i18n ? window.i18n.t('autopilot_to_review_count') || 'opération(s) à vérifier' : 'opération(s) à vérifier'}`);
                } else {
                    badge.style.display = 'none';
                    badge.removeAttribute('title');
                }
            }

            // Format Last Execution and Next Execution
            const lastExecIso = this._apStatus.last_execution_at || this._apStatus.last_run_at;
            let lastExecDisplay = `<span style="color:var(--text-muted); font-size:11px;">${window.i18n.t('overview_autopilot_no_past_exec') || 'Aucune action'}</span>`;
            let lastExecFull = '';
            if (lastExecIso) {
                try {
                    const dt = new Date(lastExecIso);
                    lastExecDisplay = `${this._formatRelativeTime(lastExecIso)} <span style="opacity:0.75; font-size:10px;">(${dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})</span>`;
                    lastExecFull = dt.toLocaleString();
                } catch (e) {}
            }

            let nextExecHtml = '';
            if (!isEnabled) {
                nextExecHtml = `<span style="color:var(--text-muted); font-size:11px;">⏸️ ${window.i18n.t('overview_autopilot_btn_inactive') || 'En veille'}</span>`;
            } else if (this._apStatus.next_execution_countdown_seconds !== null && this._apStatus.next_execution_countdown_seconds !== undefined && this._apStatus.bank_auto_sync_enabled) {
                const countdownStr = this._formatCountdown(this._apStatus.next_execution_countdown_seconds);
                const vaultWarning = !this._apStatus.vault_unlocked ? `<span style="font-size:9.5px; color:#f59e0b; display:block; margin-top:2px;" title="${window.i18n.t('overview_autopilot_next_exec_vault_locked') || 'En attente de déverrouillage'}">⚠️ Coffre verrouillé</span>` : '';
                nextExecHtml = `<span id="ovApNextCountdownBadge" class="ov-ap-countdown-badge">⏳ ${countdownStr}</span>${vaultWarning}`;
            } else {
                nextExecHtml = `<span style="color:var(--text-muted); font-size:11px;">⚡ ${window.i18n.t('overview_autopilot_next_exec_ondemand') || 'Au prochain import / relevé'}</span>`;
            }

            // Build Decisions Feed HTML
            let decisionsHtml = '';
            if (this._apDecisions.length > 0) {
                decisionsHtml = this._apDecisions.map(d => {
                    let badgeClass = 'badge-blue';
                    let typeLabel = window.i18n.t('autopilot_action_committed') || 'Saisie directe';
                    let tooltipText = '';
                    let icon = '✨';

                    if (d.decision_type === 'reconciliation' || d.decision_type === 'reconcile') {
                        if (d.action === 'LINKED_COMING' || d.action === 'LINKED_COMING_PENDING_REVIEW') {
                            badgeClass = 'badge-amber';
                            typeLabel = window.i18n.t('autopilot_action_linked_coming') || 'Opération à venir liée';
                            tooltipText = window.i18n.t('autopilot_action_linked_coming_desc') || 'L\'opération prévisionnelle a été rattachée à l\'annonce bancaire à venir.';
                            icon = '⏳';
                        } else if (d.action === 'AUTO_RECONCILED_DEVIANT') {
                            badgeClass = 'badge-emerald';
                            typeLabel = window.i18n.t('autopilot_action_deviant_confirmed') || 'Rapprochement ajusté';
                            tooltipText = window.i18n.t('autopilot_action_deviant_confirmed_desc') || 'Le débit effectif a été pointé et le montant ajusté.';
                            icon = '⚡';
                        } else {
                            badgeClass = 'badge-emerald';
                            typeLabel = window.i18n.t('autopilot_action_reconciled_confirmed') || 'Rapprochement confirmé';
                            tooltipText = window.i18n.t('autopilot_action_reconciled_confirmed_desc') || 'Le débit effectif a été pointé et rapproché.';
                            icon = '⚡';
                        }
                    } else if (d.action === 'AUTO_SKIPPED_UNRECONCILED' || d.decision_type === 'recurrence_skip') {
                        badgeClass = 'badge-slate';
                        typeLabel = window.i18n.t('autopilot_action_recurrence_skipped') || 'Échéance ignorée';
                        tooltipText = window.i18n.t('autopilot_action_recurrence_skipped_desc') || 'Échéance récurrente non débitée après 30 jours : ignorée pour préserver l\'exactitude du solde.';
                        icon = '⊝';
                    } else if (d.action === 'AUTO_CLOSED_SKIPPED' || d.decision_type === 'recurrence_close') {
                        badgeClass = 'badge-slate';
                        typeLabel = window.i18n.t('autopilot_action_recurrence_closed') || 'Abonnement clôturé';
                        tooltipText = window.i18n.t('autopilot_action_recurrence_closed_desc') || 'Modèle de récurrence clôturé automatiquement après 3 échéances consécutives non prélevées.';
                        icon = '🔒';
                    } else if (d.decision_type === 'recurrence' || d.decision_type === 'recurrence_promoted' || d.decision_type === 'recurrence_promotion') {
                        badgeClass = 'badge-purple';
                        typeLabel = window.i18n.t('autopilot_action_promoted') || 'Récurrence';
                        icon = '🔄';
                    } else if (d.decision_type === 'recurrence_hike') {
                        badgeClass = 'badge-purple';
                        typeLabel = window.i18n.t('autopilot_action_hike') || 'Hausse propagée';
                        icon = '🔄';
                    } else if (d.decision_type === 'budget_recurrence_sync') {
                        badgeClass = 'badge-amber';
                        typeLabel = window.i18n.t('autopilot_action_budget_synced') || 'Budget synchronisé';
                        tooltipText = window.i18n.t('autopilot_action_budget_synced_desc') || 'Enveloppe budgétaire automatiquement mise à jour suite à l\'ajustement ou la promotion d\'une récurrence.';
                        icon = '🎯';
                    } else if (d.decision_type === 'budget_enrichment_suggestion') {
                        badgeClass = 'badge-amber';
                        typeLabel = window.i18n.t('autopilot_action_budget_enriched') || 'Catégorie rattachée';
                        tooltipText = window.i18n.t('autopilot_action_budget_enriched_desc') || 'Nouvelle catégorie de dépense récurrente intégrée automatiquement à une enveloppe budgétaire existante.';
                        icon = '🎯';
                    } else if (d.decision_type === 'budget' || d.decision_type === 'budget_adjustment' || d.decision_type === 'budget_suggestion') {
                        badgeClass = 'badge-amber';
                        typeLabel = window.i18n.t('autopilot_action_budget_recalibrated') || 'Budget';
                        icon = '🎯';
                    } else if (d.decision_type === 'transfer_link') {
                        badgeClass = 'badge-blue';
                        typeLabel = window.i18n.t('autopilot_action_transfer_linked') || 'Virement lié';
                        tooltipText = window.i18n.t('autopilot_action_transfer_linked_desc') || 'Virement interne détecté et automatiquement rapproché entre vos comptes.';
                        icon = '🔄';
                    } else if (d.action === 'AUTO_COMMIT_COMING') {
                        badgeClass = 'badge-blue';
                        typeLabel = window.i18n.t('autopilot_action_coming_detected') || 'Débit à venir';
                        tooltipText = window.i18n.t('autopilot_action_coming_detected_desc') || 'Opération bancaire à venir annoncée par la banque.';
                        icon = '⏳';
                    }

                    const isSkipped = d.action === 'AUTO_SKIPPED_UNRECONCILED' || d.decision_type === 'recurrence_skip';
                    const isClosed = d.action === 'AUTO_CLOSED_SKIPPED' || d.decision_type === 'recurrence_close';
                    let formattedAmount = '';
                    let amountClass = 'text-main';

                    if (isSkipped || isClosed) {
                        formattedAmount = `<span style="text-decoration: line-through; opacity: 0.65;">-${formatCurrency(Math.abs(d.amount))}</span>`;
                        amountClass = 'text-muted';
                    } else if (d.decision_type === 'budget_recurrence_sync' && d.details && d.details.old_amount !== undefined && d.details.new_amount !== undefined) {
                        formattedAmount = `<span style="font-size: 11px; opacity: 0.7;">${formatCurrency(d.details.old_amount)} ➔</span> ${formatCurrency(d.details.new_amount)}`;
                        amountClass = 'text-main';
                    } else if (d.amount !== null && d.amount !== undefined) {
                        formattedAmount = `${d.amount > 0 ? '+' : ''}${formatCurrency(d.amount)}`;
                        amountClass = (d.amount > 0 && d.decision_type !== 'transfer_link') ? 'text-green' : 'text-main';
                    }
                    const timeStr = d.created_at ? this._formatRelativeTime(d.created_at) : '';

                    return `
                        <div class="ov-ap-decision-card">
                            <div class="ov-ap-decision-left">
                                <div class="ov-ap-decision-badge ${badgeClass}" title="${escapeHtml(tooltipText)}">
                                    <span>${icon}</span> <span>${typeLabel}</span>
                                </div>
                                <span class="ov-ap-decision-label" title="${escapeHtml(d.label || '')}">${escapeHtml(d.label || 'Opération')}</span>
                                ${d.category ? `<span class="ov-ap-decision-cat">${escapeHtml(d.category)}</span>` : ''}
                            </div>
                            <div class="ov-ap-decision-right">
                                <span class="ov-ap-decision-amount ${amountClass} privacy-blur">${formattedAmount}</span>
                                <span class="ov-ap-decision-time">${timeStr}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            } else {
                decisionsHtml = `
                    <div class="ov-ap-empty-state">
                        <div class="ov-ap-empty-icon">${isEnabled ? '🛡️' : '💤'}</div>
                        <div class="ov-ap-empty-text">
                            ${isEnabled 
                                ? (window.i18n.t('overview_autopilot_no_actions_active') || 'Surveillance active : toutes vos opérations sont synchronisées.')
                                : (window.i18n.t('overview_autopilot_no_actions_inactive') || 'Auto-Pilote en veille. Activez-le pour automatiser les rapprochements et saisies.')}
                        </div>
                    </div>
                `;
            }

            popover.innerHTML = `
                <div class="ov-ap-popover-header">
                    <div class="ov-ap-popover-title-row">
                        <div class="ov-ap-popover-title">
                            <svg class="ov-autopilot-svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="color:var(--accent);">
                                <circle cx="12" cy="12" r="9.5"></circle>
                                <circle cx="12" cy="12" r="3"></circle>
                                <line x1="12" y1="15" x2="12" y2="21.5"></line>
                                <line x1="2.5" y1="12" x2="9" y2="12"></line>
                                <line x1="15" y1="12" x2="21.5" y2="12"></line>
                            </svg>
                            <span>${window.i18n.t('overview_autopilot_popover_title') || 'Mode Auto-Pilote'}</span>
                        </div>
                        <div class="ov-ap-toggle-switch-wrapper">
                            <span class="ov-ap-status-pill ${isEnabled ? 'is-active' : 'is-inactive'}">
                                ${isEnabled ? (window.i18n.t('autopilot_status_active') || '🟢 Actif') : (window.i18n.t('autopilot_status_inactive') || '⚪ En veille')}
                            </span>
                            <label class="ov-ap-switch" title="${isEnabled ? 'Désactiver' : 'Activer'}">
                                <input type="checkbox" id="ovApQuickToggle" ${isEnabled ? 'checked' : ''} onchange="window.OverviewView.toggleAutopilotState(event)">
                                <span class="ov-ap-slider"></span>
                            </label>
                            <button type="button" class="ov-ap-close-btn" onclick="window.OverviewView.closeAutopilotPopover()" title="${window.i18n ? window.i18n.t('close') : 'Fermer'}">✕</button>
                        </div>
                    </div>

                    <!-- Execution Timings (Last & Next) -->
                    <div class="ov-ap-timing-grid">
                        <div class="ov-ap-timing-card">
                            <div class="ov-ap-timing-label">
                                <span>⏱️</span>
                                <span>${window.i18n.t('overview_autopilot_last_exec') || 'Dernière action'}</span>
                            </div>
                            <div class="ov-ap-timing-value" title="${escapeHtml(lastExecFull)}">
                                ${lastExecDisplay}
                            </div>
                        </div>
                        <div class="ov-ap-timing-card">
                            <div class="ov-ap-timing-label">
                                <span>⏳</span>
                                <span>${window.i18n.t('overview_autopilot_next_exec') || 'Prochaine synchro'}</span>
                            </div>
                            <div class="ov-ap-timing-value" id="ovApNextTimingValue">
                                ${nextExecHtml}
                            </div>
                        </div>
                    </div>

                    <div class="ov-ap-popover-sub" style="margin-top: 8px;">
                        <span>🎯 ${window.i18n.t('overview_autopilot_tolerance') || 'Tolérance'} : <strong>${threshold}%</strong></span>
                    </div>
                </div>

                <div class="ov-ap-popover-body">
                    <div class="ov-ap-section-title">
                        <span>⚡ ${window.i18n.t('overview_autopilot_recent_actions') || 'Dernières actions'}</span>
                        ${this._apDecisions.length > 0 ? `<span class="ov-ap-actions-count">${this._apDecisions.length}</span>` : ''}
                    </div>
                    ${decisionsHtml}
                </div>

                <div class="ov-ap-popover-footer">
                    <button type="button" class="ov-ap-footer-btn" onclick="window.OverviewView.closeAutopilotPopover(); window.app.loadView('autopilot');">
                        <span>⚙️ ${window.i18n.t('overview_autopilot_open_center') || 'Accéder au Centre de Contrôle'}</span>
                        <span class="ov-ap-footer-arrow">➔</span>
                    </button>
                </div>
            `;
            window.i18n.translateDOM(popover);

            // Start live countdown ticker
            this._startCountdownLoop();
        } catch (e) {
            console.error('[OverviewView] Error rendering autopilot widget:', e);
        }
    },

    _startCountdownLoop() {
        if (this._apCountdownInterval) {
            clearInterval(this._apCountdownInterval);
            this._apCountdownInterval = null;
        }

        const updateTick = () => {
            const timerChip = document.getElementById('ovAutopilotTimerChip');
            const popoverBadge = document.getElementById('ovApNextCountdownBadge');

            if (!this._apStatus) return;
            const isEnabled = !!this._apStatus.is_enabled;

            if (!isEnabled) {
                if (timerChip) {
                    timerChip.textContent = '⏸️ ' + (window.i18n.t('overview_autopilot_btn_inactive') || 'En veille');
                    timerChip.style.display = 'inline-flex';
                }
                return;
            }

            if (this._apTargetCountdownEnd) {
                const now = Date.now();
                const diffMs = this._apTargetCountdownEnd - now;
                const remSec = Math.max(0, Math.floor(diffMs / 1000));

                const formatted = this._formatCountdown(remSec);
                const formattedShort = this._formatCountdownShort(remSec);

                if (popoverBadge) {
                    popoverBadge.textContent = '⏳ ' + formatted;
                }
                if (timerChip) {
                    timerChip.textContent = '⏳ ' + formattedShort;
                    timerChip.style.display = 'inline-flex';
                }

                if (remSec === 0 && !this._apSyncTriggered) {
                    this._apSyncTriggered = true;
                    if (window.app && typeof window.app._accelerateSyncWatcher === 'function') {
                        window.app._accelerateSyncWatcher();
                    }
                    setTimeout(() => {
                        this._apSyncTriggered = false;
                        this._renderAutopilotWidget().catch(() => {});
                    }, 3500);
                }
            } else {
                if (timerChip) {
                    timerChip.textContent = '⚡ ' + (window.i18n.t('overview_autopilot_timer_chip_ondemand') || 'Au prochain import');
                    timerChip.style.display = 'inline-flex';
                }
            }
        };

        updateTick();
        this._apCountdownInterval = setInterval(updateTick, 1000);
    },

    _formatCountdown(seconds) {
        if (seconds <= 0) return window.i18n.t('overview_autopilot_next_exec_imminent') || 'Imminente...';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) {
            return `${hrs}h ${mins.toString().padStart(2, '0')}m ${secs.toString().padStart(2, '0')}s`;
        }
        return `${mins}m ${secs.toString().padStart(2, '0')}s`;
    },

    _formatCountdownShort(seconds) {
        if (seconds <= 0) return 'Imminent';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        if (hrs > 0) return `${hrs}h ${mins}m`;
        return `${mins}m`;
    },

    _formatRelativeTime(isoString) {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            if (isNaN(date.getTime())) return '';
            const now = new Date();
            const diffMs = now - date;
            const diffSec = Math.floor(diffMs / 1000);
            const diffMin = Math.floor(diffSec / 60);
            const diffHrs = Math.floor(diffMin / 60);
            const diffDays = Math.floor(diffHrs / 24);

            if (diffSec < 60) return "À l'instant";
            if (diffMin < 60) return `Il y a ${diffMin} min`;
            if (diffHrs < 24) return `Il y a ${diffHrs} h`;
            if (diffDays === 1) return `Hier ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            return date.toLocaleDateString([], { day: 'numeric', month: 'short' });
        } catch (e) {
            return '';
        }
    },

    handleAutopilotBtnClick(e) {
        if (e) {
            e.stopPropagation();
            if (e.preventDefault) e.preventDefault();
        }
        const popover = document.getElementById('ovAutopilotPopover');
        if (!popover) return;

        // If popover was opened less than 400ms ago (e.g. by touch-synthesized mouseenter), keep it open
        if (popover.style.display !== 'none' && (Date.now() - (this._popoverOpenedAt || 0) < 400)) {
            return;
        }

        if (popover.style.display !== 'none') {
            this.closeAutopilotPopover();
        } else {
            this.showAutopilotPopover();
        }
    },

    showAutopilotPopover() {
        clearTimeout(this._apPopoverTimer);
        const popover = document.getElementById('ovAutopilotPopover');
        const btn = document.getElementById('ovAutopilotBtn');
        const backdrop = document.getElementById('ovAutopilotBackdrop');
        if (!popover) return;

        this._popoverOpenedAt = Date.now();
        popover.classList.add('active');
        popover.style.display = 'block';
        if (btn) btn.setAttribute('aria-expanded', 'true');
        if (backdrop && window.innerWidth <= 768) {
            backdrop.classList.add('active');
            backdrop.style.display = 'block';
        }

        const onOutsideClick = (evt) => {
            const widget = document.getElementById('ovAutopilotWidget');
            if (widget && !widget.contains(evt.target)) {
                this.closeAutopilotPopover();
                document.removeEventListener('click', onOutsideClick);
            }
        };
        setTimeout(() => document.addEventListener('click', onOutsideClick), 20);
    },

    keepAutopilotPopoverOpen() {
        clearTimeout(this._apPopoverTimer);
    },

    scheduleHideAutopilotPopover() {
        if (window.innerWidth <= 1024) return;
        clearTimeout(this._apPopoverTimer);
        this._apPopoverTimer = setTimeout(() => {
            this.closeAutopilotPopover();
        }, 280);
    },

    closeAutopilotPopover() {
        clearTimeout(this._apPopoverTimer);
        const popover = document.getElementById('ovAutopilotPopover');
        const btn = document.getElementById('ovAutopilotBtn');
        const backdrop = document.getElementById('ovAutopilotBackdrop');
        if (popover) {
            popover.classList.remove('active');
            popover.style.display = 'none';
        }
        if (btn) btn.setAttribute('aria-expanded', 'false');
        if (backdrop) {
            backdrop.classList.remove('active');
            backdrop.style.display = 'none';
        }
    },

    async toggleAutopilotState(e) {
        if (e) e.stopPropagation();
        try {
            const currentlyEnabled = !!(this._apStatus && this._apStatus.is_enabled);
            const newState = !currentlyEnabled;
            
            const res = await API.post('/api/autopilot/toggle', { enabled: newState });
            if (res) {
                this._apStatus = res;
            }
            
            const msg = newState
                ? (window.i18n.t('overview_autopilot_toggled_on') || 'Mode Auto-Pilote activé')
                : (window.i18n.t('overview_autopilot_toggled_off') || 'Mode Auto-Pilote mis en veille');
            showToast(msg, 'success');

            window.dispatchEvent(new CustomEvent('autopilot_updated'));
            await this._renderAutopilotWidget();
        } catch (err) {
            console.error('[OverviewView] Failed to toggle autopilot:', err);
            showToast('Erreur lors du changement d\'état', 'error');
        }
    },

    selectAccount(accId) {
        this.closeAccountDropdown();
        this.onAccountChange(accId);
        this._populateAccountSelect();
    },

    _populateAccountSelect() {
        const container = document.getElementById('ovAccountSelect');
        const menu = document.getElementById('ovAccountMenu');
        const triggerLabel = document.getElementById('ovAccountTriggerLabel');
        const triggerIcon = document.getElementById('ovAccountTriggerIcon');
        if (!container || !menu) return;

        const groups = {
            checking: { label: window.i18n.t('acc_section_checking') || 'Comptes Courants & Cartes', icon: '💳', accounts: [] },
            savings: { label: window.i18n.t('acc_section_savings') || 'Épargne & Placements', icon: '📈', accounts: [] },
            loans: { label: window.i18n.t('acc_section_loans') || 'Crédits & Emprunts', icon: '🏷️', accounts: [] }
        };

        let selectedAccount = null;
        for (const a of this._accounts) {
            if (a.is_closed) continue;
            if (String(a.id) === String(this._selectedAccountId)) {
                selectedAccount = a;
            }
            const t = (a.type || '').toLowerCase();
            let cat = 'checking';
            if (t.includes('prêt') || t.includes('pret') || t.includes('emprunt') || t.includes('loan') || t.includes('crédit') || t.includes('credit')) {
                cat = 'loans';
            } else if (t.includes('livret') || t.includes('saving') || t.includes('epargne') || t.includes('épargne') || t.includes('pea') || t.includes('assurance') || t.includes('per') || t.includes('titres')) {
                cat = 'savings';
            }
            groups[cat].accounts.push(a);
        }

        // Update trigger display
        if (selectedAccount) {
            if (triggerIcon) {
                const dotColor = selectedAccount.color || '#6366f1';
                triggerIcon.innerHTML = `<span class="overview-acc-color-dot" style="background-color: ${dotColor}"></span>`;
            }
            if (triggerLabel) {
                triggerLabel.innerHTML = `${escapeHtml(selectedAccount.name)} (<span class="privacy-blur">${formatCurrency(selectedAccount.balance)}</span>)`;
            }
        } else {
            if (triggerIcon) triggerIcon.textContent = '🏦';
            if (triggerLabel) triggerLabel.textContent = window.i18n.t('overview_filter_all_accounts') || 'Tous les comptes';
        }

        // Build dropdown menu items
        const allLabel = window.i18n.t('overview_filter_all_accounts') || 'Tous les comptes';
        const isAllSelected = !this._selectedAccountId;

        let html = `
            <div class="overview-acc-item ${isAllSelected ? 'selected' : ''}" onclick="window.OverviewView.selectAccount('')">
                <div class="overview-acc-item-left">
                    <span class="overview-acc-item-icon">🏦</span>
                    <span class="overview-acc-item-name">${allLabel}</span>
                </div>
                <div class="overview-acc-item-right">
                    ${isAllSelected ? '<span class="overview-acc-item-check">✓</span>' : ''}
                </div>
            </div>
            <div class="overview-acc-divider"></div>
        `;

        ['checking', 'savings', 'loans'].forEach(k => {
            const grp = groups[k];
            if (grp.accounts.length === 0) return;
            html += `
                <div class="overview-acc-group">
                    <div class="overview-acc-group-header">
                        <span class="overview-acc-group-icon">${grp.icon}</span>
                        <span>${grp.label}</span>
                    </div>
                    <div class="overview-acc-group-items">
            `;
            for (const a of grp.accounts) {
                const isSel = String(a.id) === String(this._selectedAccountId);
                const dotColor = a.color || '#6366f1';
                html += `
                    <div class="overview-acc-item ${isSel ? 'selected' : ''}" onclick="window.OverviewView.selectAccount('${a.id}')">
                        <div class="overview-acc-item-left">
                            <span class="overview-acc-color-dot" style="background-color: ${dotColor}"></span>
                            <span class="overview-acc-item-name">${escapeHtml(a.name)}</span>
                        </div>
                        <div class="overview-acc-item-right">
                            <span class="overview-acc-item-balance privacy-blur">${formatCurrency(a.balance)}</span>
                            ${isSel ? '<span class="overview-acc-item-check">✓</span>' : ''}
                        </div>
                    </div>
                `;
            }
            html += `
                    </div>
                </div>
            `;
        });

        menu.innerHTML = html;
    },

    async onAccountChange(accId) {
        this._selectedAccountId = accId || '';
        this.saveConfig({ overview_account_id: this._selectedAccountId });
        if (window.ProfileStorage) {
            window.ProfileStorage.set('overview_account_id', this._selectedAccountId);
        }
        await this._fetchRhythmAverages();
        this._renderCockpit();
        this._fetchForecastSummary(this._selectedAccountId ? '?account_id=' + this._selectedAccountId : '');
    },

    async openUserPicker() {
        if (window.app && typeof window.app._showUserPicker === 'function') {
            await window.app._showUserPicker();
            await this.init();
        }
    },

    async _checkBankConnections() {
        if (window.BankSyncView && typeof window.BankSyncView.ensureSyncButtonsVisibility === 'function') {
            await window.BankSyncView.ensureSyncButtonsVisibility();
            return;
        }
        const syncBtn = document.querySelector('.overview-bank-sync-btn');
        try {
            const conns = await API.get('/api/bank-sync/connections');
            if (syncBtn) {
                syncBtn.style.display = (conns && conns.some(c => c.is_active)) ? 'inline-flex' : 'none';
            }
        } catch (_) {
            if (syncBtn) syncBtn.style.display = 'none';
        }
    },

    _renderHealthBadge(stats) {
        const badge = document.getElementById('ovHealthBadge');
        if (!badge) return;

        const isOrgMode = window.app?.config?.enable_org_mode === 'true';

        if (stats.overdraft_warning) {
            const od = stats.overdraft_warning;
            if (od.covered_by_income) {
                badge.className = 'overview-health-badge warning badge-warning';
                badge.textContent = window.i18n.t('overview_health_contingent_cashflow') || '⏳ Vigilance trésorerie';
                const incAmt = od.planned_income_before_risk || od.planned_income_total || 0;
                badge.title = window.i18n.tp
                    ? window.i18n.tp('overview_health_contingent_tooltip', {
                        date: formatDate(od.date),
                        amount: formatCurrency(od.projected_balance),
                        income: formatCurrency(incAmt)
                    })
                    : `Creux de trésorerie temporaire (${formatCurrency(od.projected_balance)} au ${formatDate(od.date)}) absorbé par les rentrées prévues (+${formatCurrency(incAmt)}).`;
            } else {
                badge.className = 'overview-health-badge danger badge-danger';
                badge.textContent = window.i18n.t('overview_health_danger') || '⚠️ Risque Découvert';
                badge.title = '';
            }
        } else if (stats.rest_to_live < 0) {
            badge.className = 'overview-health-badge warning badge-warning';
            badge.textContent = window.i18n.t('overview_health_warning') || '⚡ Reste à vivre négatif';
            badge.title = '';
        } else {
            badge.className = 'overview-health-badge success badge-success';
            badge.textContent = isOrgMode
                ? (window.i18n.t('overview_org_health_ok') || '✨ Trésorerie Saine')
                : (window.i18n.t('overview_health_ok') || '✨ Budget Équilibré');
            badge.title = '';
        }
    },

    _getRestToLiveInfo(stats) {
        if (!stats) return { rav: 0, plannedInc: 0, ravWithInc: 0 };
        let currentRav = stats.rest_to_live || 0;
        let plannedInc = stats.unreconciled_income || 0;
        let ravWithInc = (stats.rest_to_live_with_income !== undefined) ? stats.rest_to_live_with_income : (currentRav + plannedInc);

        const isMainAccount = !this._selectedAccountId || (stats.main_account_id && String(this._selectedAccountId) === String(stats.main_account_id));
        if (!isMainAccount && this._selectedAccountId && this._accountsMap[this._selectedAccountId]) {
            const horizonISO = stats.next_pay_date || this._getEndOfMonthISO();
            const accTxs = (this._transactions || []).filter(tx => {
                if (tx.reconciliation_date || tx.is_skipped) return false;
                if (stats.next_pay_date ? tx.date_operation >= horizonISO : tx.date_operation > horizonISO) return false;
                return String(tx.to_account_id) === String(this._selectedAccountId);
            });
            plannedInc = accTxs.reduce((sum, tx) => sum + (tx.amount > 0 ? tx.amount : 0), 0);
            ravWithInc = currentRav + plannedInc;
        } else if (this._selectedAccountId && this._accountsMap[this._selectedAccountId]) {
            plannedInc = stats.unreconciled_income || 0;
            ravWithInc = (stats.rest_to_live_with_income !== undefined) ? stats.rest_to_live_with_income : (currentRav + plannedInc);
        }

        return { rav: currentRav, plannedInc, ravWithInc };
    },

    _calculateProjection(stats) {
        const isOrgMode = window.app?.config?.enable_org_mode === 'true' || window.app?.config?.enable_org_mode === true;
        const hasPayCycle = !isOrgMode && !!(stats && stats.next_pay_date);
        const isEn = window.i18n.lang === 'en';
        const today = new Date();
        const todayISO = this._getTodayISO(today);

        let cutoffDate = null;
        let dayNum = 0;
        let monthName = '';
        let titleKey = 'overview_projection_title';
        let titleText = '';
        let subText = '';

        if (hasPayCycle) {
            cutoffDate = stats.next_pay_date;
            const parts = cutoffDate.split('-');
            const targetDateObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
            dayNum = parseInt(parts[2], 10);
            monthName = targetDateObj.toLocaleDateString(isEn ? 'en-US' : 'fr-FR', { month: 'long' });
            titleKey = 'overview_projection_cycle_title';
            titleText = window.i18n.t('overview_projection_cycle_title') || (isEn ? 'End of Cycle Forecast' : 'Projection Fin de Cycle');
            const prefix = window.i18n.t('overview_projection_cycle_sub') || (isEn ? 'Forecast balance as of' : 'Solde prévisionnel au');
            subText = isEn ? `${prefix} ${monthName} ${dayNum}` : `${prefix} ${dayNum} ${monthName}`;
        } else {
            cutoffDate = this._getEndOfMonthISO(today);
            const y = today.getFullYear();
            const m = today.getMonth();
            const lastDayDate = new Date(y, m + 1, 0);
            dayNum = lastDayDate.getDate();
            monthName = today.toLocaleDateString(isEn ? 'en-US' : 'fr-FR', { month: 'long' });
            titleKey = 'overview_projection_title';
            titleText = window.i18n.t('overview_projection_title') || (isEn ? 'End of Month Forecast' : 'Projection Fin de Mois');
            if (isOrgMode) {
                const prefix = window.i18n.t('overview_org_forecast_sub') || (isEn ? 'Forecast organisation balance as of' : 'Solde prévisionnel de l\'organisation au');
                subText = isEn ? `${prefix} ${monthName} ${dayNum}` : `${prefix} ${dayNum} ${monthName}`;
            } else if (isEn) {
                subText = `Forecast balance as of ${monthName} ${dayNum}`;
            } else {
                subText = `Solde prévisionnel au ${dayNum} ${monthName}`;
            }
        }

        let baseBalance = (stats && stats.net_worth !== undefined) ? stats.net_worth : 0;
        if (this._selectedAccountId && this._accountsMap[this._selectedAccountId]) {
            baseBalance = this._accountsMap[this._selectedAccountId].balance || 0;
        }

        const accIdStr = this._selectedAccountId ? String(this._selectedAccountId) : null;
        const upcomingTxs = (this._transactions || []).filter(tx => {
            if (tx.reconciliation_date || tx.is_skipped) return false;
            if (tx.cross_profile_status === 'pending') return false;
            if (!tx.date_operation) return false;

            // En cycle de paye : on projette avant la nouvelle paye (ou jusqu'au jour de paye hors salaire)
            if (hasPayCycle) {
                if (tx.date_operation > cutoffDate) return false;
                if (tx.date_operation === cutoffDate && (tx.is_salary || (tx.type === 'income' && tx.amount >= 1000))) return false;
            } else {
                if (tx.date_operation > cutoffDate) return false;
            }

            if (accIdStr) {
                return String(tx.from_account_id) === accIdStr || String(tx.to_account_id) === accIdStr;
            }
            return true;
        });

        let projDiff = 0;
        let incomingSum = 0;
        let outgoingSum = 0;

        upcomingTxs.forEach(tx => {
            const amt = Math.abs(parseFloat(tx.amount) || 0);
            if (accIdStr) {
                const isTo = String(tx.to_account_id) === accIdStr;
                const isFrom = String(tx.from_account_id) === accIdStr;
                if (isTo && !isFrom) {
                    projDiff += amt;
                    incomingSum += amt;
                } else if (isFrom && !isTo) {
                    projDiff -= amt;
                    outgoingSum += amt;
                } else if (!isTo && !isFrom) {
                    if (tx.type === 'income') {
                        projDiff += amt;
                        incomingSum += amt;
                    } else {
                        projDiff -= amt;
                        outgoingSum += amt;
                    }
                }
            } else {
                const isTransfer = tx.from_account_id && tx.to_account_id;
                if (!isTransfer) {
                    if (tx.to_account_id && !tx.from_account_id) {
                        projDiff += amt;
                        incomingSum += amt;
                    } else if (tx.from_account_id && !tx.to_account_id) {
                        projDiff -= amt;
                        outgoingSum += amt;
                    } else if (tx.type === 'income') {
                        projDiff += amt;
                        incomingSum += amt;
                    } else {
                        projDiff -= amt;
                        outgoingSum += amt;
                    }
                }
            }
        });

        // Opérations fantômes de la synchronisation bancaire (non encore validées)
        let ghosts = (window.BankSyncView && window.BankSyncView.ghostTransactions) || [];
        if (accIdStr) {
            ghosts = ghosts.filter(g => String(g.account_id) === accIdStr);
        }
        ghosts.forEach(g => {
            const gDate = (g.date_operation ? String(g.date_operation).substring(0, 10) : '') || todayISO;
            if (gDate <= cutoffDate) {
                const raw = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
                projDiff += raw;
                if (raw > 0) incomingSum += raw;
                else outgoingSum += Math.abs(raw);
            }
        });

        const projectedEnd = Math.round((baseBalance + projDiff) * 100) / 100;
        const targetDateLabel = isEn ? `${monthName} ${dayNum}` : `${dayNum} ${monthName}`;

        let tooltipText = '';
        if (projDiff === 0) {
            tooltipText = isEn
                ? `No pending transactions up to ${targetDateLabel}. Balance remains ${formatCurrency(baseBalance)}.`
                : `Aucune opération prévue d'ici le ${targetDateLabel}. Le solde reste à ${formatCurrency(baseBalance)}.`;
        } else {
            const incStr = incomingSum > 0 ? `+${formatCurrency(incomingSum)}` : '';
            const expStr = outgoingSum > 0 ? `-${formatCurrency(outgoingSum)}` : '';
            const parts = [incStr, expStr].filter(Boolean).join(', ');
            tooltipText = isEn
                ? `Current: ${formatCurrency(baseBalance)} | Planned (${parts}) → Projected: ${formatCurrency(projectedEnd)}`
                : `Solde actuel : ${formatCurrency(baseBalance)} | Prévues (${parts}) → Solde projeté : ${formatCurrency(projectedEnd)}`;
        }

        return {
            baseBalance,
            projDiff,
            projectedEnd,
            incomingSum,
            outgoingSum,
            upcomingCount: upcomingTxs.length + ghosts.length,
            cutoffDate,
            dayNum,
            monthName,
            titleKey,
            titleText,
            subText,
            hasPayCycle,
            tooltipText
        };
    },

    _winsorize(values, sensitivity = 2) {
        if (!values || values.length < 3) return { regular: values || [], outliers: [], excess: 0 };
        const sensitivityMap = {
            1: [1.5, 100.0],
            2: [2.0, 150.0],
            3: [2.5, 200.0],
            4: [3.5, 500.0],
            5: [999.0, 999999.0]
        };
        const [multFactor, minThresh] = sensitivityMap[sensitivity] || [2.0, 150.0];
        if (sensitivity >= 5) return { regular: [...values], outliers: [], excess: 0 };

        const sorted = [...values].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const med = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
        if (med <= 0) return { regular: [...values], outliers: [], excess: 0 };

        const threshold = Math.max(multFactor * med, minThresh);
        const regular = [];
        const outliers = [];
        let excess = 0;

        for (const v of values) {
            if (v > threshold) {
                outliers.push(v);
                regular.push(threshold);
                excess += (v - threshold);
            } else {
                regular.push(v);
            }
        }
        return { regular, outliers, excess, threshold };
    },

    _calculateAverages() {
        // Si les moyennes ont déjà été calculées côté serveur (/api/stats/rhythm),
        // on préserve cette vérité sans écraser avec un sous-ensemble partiel d'opérations
        if (this._cachedMonthlyAverages && this._cachedMonthlyAverages._serverComputed) {
            return;
        }

        const transactions = this._transactions || [];
        const lookback = this._statsLookback || '6m';
        const accIdStr = this._selectedAccountId ? String(this._selectedAccountId) : null;

        const today = new Date();
        const todayISO = this._getTodayISO(today);

        // Calcul de la date de début selon le lookback
        let startDateISO = null;
        let nbDays = 180; // défaut 6 mois

        if (lookback === '1w') {
            const d = new Date(today);
            d.setDate(d.getDate() - 7);
            startDateISO = this._getTodayISO(d);
            nbDays = 7;
        } else if (lookback === '1m') {
            const d = new Date(today);
            d.setDate(d.getDate() - 30);
            startDateISO = this._getTodayISO(d);
            nbDays = 30;
        } else if (lookback === '3m') {
            const d = new Date(today);
            d.setDate(d.getDate() - 90);
            startDateISO = this._getTodayISO(d);
            nbDays = 90;
        } else if (lookback === '6m') {
            const d = new Date(today);
            d.setDate(d.getDate() - 180);
            startDateISO = this._getTodayISO(d);
            nbDays = 180;
        } else if (lookback === '12m') {
            const d = new Date(today);
            d.setDate(d.getDate() - 365);
            startDateISO = this._getTodayISO(d);
            nbDays = 365;
        } else if (lookback === 'all') {
            startDateISO = '1900-01-01';
        }

        // Filtrer les transactions
        let totalIncome = 0;
        let totalFixed = 0;
        let totalVar = 0;
        let earliestDate = null;
        const varAmounts = [];

        for (const tx of transactions) {
            if (tx.is_skipped) continue;
            const txDate = (tx.date_operation || '').substring(0, 10);
            if (!txDate) continue;
            if (txDate > todayISO) continue; // Uniquement le passé / réalisé jusqu'à aujourd'hui
            if (startDateISO && txDate < startDateISO) continue;

            const fromMatch = accIdStr ? String(tx.from_account_id) === accIdStr : false;
            const toMatch = accIdStr ? String(tx.to_account_id) === accIdStr : false;
            if (accIdStr && !fromMatch && !toMatch) continue;

            const isInternalTransfer = tx.from_account_id && tx.to_account_id;
            if (!accIdStr && isInternalTransfer) continue;

            if (!earliestDate || txDate < earliestDate) {
                earliestDate = txDate;
            }

            const amt = Math.abs(tx.amount || 0);

            if (accIdStr) {
                if (fromMatch && toMatch) {
                    continue;
                } else if (toMatch) {
                    totalIncome += amt;
                } else if (fromMatch) {
                    if (tx.type === 'expense_fixed') {
                        totalFixed += amt;
                    } else {
                        totalVar += amt;
                        varAmounts.push(amt);
                    }
                }
            } else {
                if (tx.type === 'income') {
                    totalIncome += amt;
                } else if (tx.type === 'expense_fixed') {
                    totalFixed += amt;
                } else if (tx.type === 'expense_var') {
                    totalVar += amt;
                    varAmounts.push(amt);
                } else if (tx.type !== 'transfer') {
                    totalVar += amt;
                    varAmounts.push(amt);
                }
            }
        }

        if (lookback === 'all') {
            if (earliestDate) {
                const earliest = new Date(earliestDate);
                const diffTime = Math.abs(today - earliest);
                nbDays = Math.max(Math.ceil(diffTime / (1000 * 60 * 60 * 24)), 1);
            } else {
                nbDays = 30;
            }
        }

        const dailyIncome = totalIncome / nbDays;
        const dailyFixed = totalFixed / nbDays;
        const dailyVar = totalVar / nbDays;

        // Calcul de la moyenne journalière propre (sans les pics / dépenses exceptionnelles)
        const winsorized = this._winsorize(varAmounts, 2);
        const totalVarClean = (winsorized.regular || []).reduce((a, b) => a + b, 0);
        const dailyVarClean = nbDays > 0 ? (totalVarClean / nbDays) : dailyVar;

        const daysInMonth = 365.25 / 12;
        this._cachedMonthlyAverages = {
            income: dailyIncome * daysInMonth,
            fixed: dailyFixed * daysInMonth,
            variable: dailyVar * daysInMonth,
            dailyIncome,
            dailyFixed,
            dailyVar,
            dailyVarClean,
            nbDays
        };
    },

    showAddModal() {
        if (window.FormView) {
            window.FormView.open();
        }
    },

    // ── Cockpit Mode: Simplified View ──────────────────────────────────────

    _renderCockpit() {
        const gaugesContainer = document.getElementById('ovCockpitGauges');
        const cardsContainer = document.getElementById('ovCockpitCards');
        if (!gaugesContainer || !cardsContainer) return;

        const stats = this._stats;
        if (!stats) return;

        const t = (key, fallback) => {
            const val = window.i18n.t(key);
            return (val && val !== key) ? val : fallback;
        };
        const tp = (key, params, fallback) => (window.i18n.tp ? window.i18n.tp(key, params) : null) || fallback;

        // ── Cycle calculation (Pay-cycle or calendar month) ──
        const today = new Date();
        const todayISO = this._getTodayISO(today);
        let cycleStart, cycleEnd, cycleDayLabel;
        const isOrgMode = window.app?.config?.enable_org_mode === 'true' || window.app?.config?.enable_org_mode === true;

        if (stats.next_pay_date && !isOrgMode) {
            // Cycle basé sur la paye
            cycleEnd = new Date(stats.next_pay_date);
            // Recherche de la date de paie précédente dans pay_history ou décalage d'un mois
            let prevPayDateStr = null;
            if (Array.isArray(stats.pay_history)) {
                for (const p of stats.pay_history) {
                    if (p.date && p.date < stats.next_pay_date && p.date <= todayISO) {
                        prevPayDateStr = p.date;
                        break;
                    }
                }
            }
            if (prevPayDateStr) {
                cycleStart = new Date(prevPayDateStr);
            } else {
                cycleStart = new Date(cycleEnd);
                cycleStart.setDate(cycleStart.getDate() - 30);
            }
        } else {
            // Cycle calendaire (1er → dernier jour du mois)
            cycleStart = new Date(today.getFullYear(), today.getMonth(), 1);
            cycleEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
        }

        const totalCycleDays = Math.max(1, Math.ceil((cycleEnd - cycleStart) / (1000 * 60 * 60 * 24)));
        const elapsedDays = Math.max(0, Math.ceil((today - cycleStart) / (1000 * 60 * 60 * 24)));
        const remainingDays = Math.max(0, totalCycleDays - elapsedDays);

        cycleDayLabel = tp('cockpit_cycle_day', { current: elapsedDays, total: totalCycleDays }, `Jour ${elapsedDays}/${totalCycleDays}`);
        const cycleDetailText = tp('cockpit_cycle_remaining', { days: remainingDays },
            `${remainingDays} jour${remainingDays > 1 ? 's' : ''} restant${remainingDays > 1 ? 's' : ''}`);

        const cycleStartISO = `${cycleStart.getFullYear()}-${String(cycleStart.getMonth() + 1).padStart(2, '0')}-${String(cycleStart.getDate()).padStart(2, '0')}`;
        const cycleEndISO = `${cycleEnd.getFullYear()}-${String(cycleEnd.getMonth() + 1).padStart(2, '0')}-${String(cycleEnd.getDate()).padStart(2, '0')}`;

        // ── Scan des transactions du cycle pour les dépenses fixes/variables ──
        const accIdStr = this._selectedAccountId ? String(this._selectedAccountId) : null;
        let cycleReconciledExpenses = 0;
        let cycleComingExpenses = 0;
        let cyclePlannedExpenses = 0;
        let cycleReconciledVarExpenses = 0;

        const pendingMatches = this._pendingData?.matches_by_tx_id || window.BankSyncView?.pendingMatches || {};
        const matchedTxIds = new Set();

        for (const tx of (this._transactions || [])) {
            if (tx.is_skipped) continue;
            if (tx.cross_profile_status === 'pending') continue;
            if (!tx.date_operation) continue;
            if (tx.date_operation < cycleStartISO || tx.date_operation > cycleEndISO) continue;

            if (accIdStr) {
                const isFrom = String(tx.from_account_id) === accIdStr;
                const isTo = String(tx.to_account_id) === accIdStr;
                if (!isFrom) continue;
                if (isTo) continue;
            } else {
                if (tx.from_account_id && tx.to_account_id) continue;
                if (tx.type === 'income' || (!tx.type && tx.amount > 0)) continue;
            }

            const amt = Math.abs(parseFloat(tx.amount) || 0);
            if (amt <= 0) continue;

            const isFixed = tx.type === 'expense_fixed' || tx.is_monthly || tx.is_yearly || !!tx.recurrence_id;
            const match = pendingMatches[tx.id] || pendingMatches[String(tx.id)];
            if (match) {
                matchedTxIds.add(tx.id);
            }
            const isComing = (match && match.is_coming) ||
                             tx.is_coming === true || tx.is_coming === 1 || tx.is_coming === 'true' ||
                             (tx.csv_id && String(tx.csv_id).startsWith('woob_coming_'));

            if (tx.reconciliation_date) {
                cycleReconciledExpenses += amt;
                if (!isFixed) {
                    cycleReconciledVarExpenses += amt;
                }
            } else if (isComing) {
                cycleComingExpenses += amt;
            } else {
                cyclePlannedExpenses += amt;
            }
        }

        // Intégrer également les dépenses "À venir" bancaires non encore créées/rattachées en base (ghosts à venir)
        if (this._pendingData?.accounts && Array.isArray(this._pendingData.accounts)) {
            for (const acc of this._pendingData.accounts) {
                if (accIdStr && String(acc.account_id) !== accIdStr) continue;
                for (const g of (acc.transactions || [])) {
                    if (!g.is_coming) continue;
                    if (g._excluded || g.is_dismissed || g.is_auto_dismissed) continue;
                    if (g.is_reconciled && g.matched_db_id && matchedTxIds.has(g.matched_db_id)) continue;

                    const gDate = g.date_operation ? String(g.date_operation).substring(0, 10) : '';
                    if (gDate && (gDate < cycleStartISO || gDate > cycleEndISO)) continue;

                    const rawAmt = parseFloat(g.raw_amount !== undefined ? g.raw_amount : g.amount) || 0;
                    if (rawAmt < 0) {
                        cycleComingExpenses += Math.abs(rawAmt);
                    }
                }
            }
        }

        if (stats.anticipated_recurrences && Array.isArray(stats.anticipated_recurrences)) {
            for (const cand of stats.anticipated_recurrences) {
                const cAmt = Math.abs(parseFloat(cand.amount) || 0);
                if (cAmt > 0) {
                    cyclePlannedExpenses += cAmt;
                }
            }
        }

        // ── Gauge 1: Reste à vivre (% de l'enveloppe initiale du cycle) & Rentrées prévues (Mode Personnel)
        //             OU Trésorerie Nette Disponible & Capacité d'Engagement (Mode Organisation) ──
        let ravLabel = t('cockpit_rav_label', 'Reste à vivre');
        let ravAmount = 0;
        let ravPercent = 0;
        let plannedPercent = 0;
        let ravRef = 0;
        let ravDetailText = '';
        let gaugeTooltip = '';
        let plannedTooltip = '';
        let plannedSubHtml = '';
        let showPlannedArc = false;
        let ravColorClass = 'gauge-green';
        let plannedVariant = 'planned-green';

        // Variables Mode Organisation spécifiques
        let orgGrossBalance = (stats && stats.net_worth !== undefined) ? stats.net_worth : 0;
        if (accIdStr && this._accountsMap[this._selectedAccountId]) {
            orgGrossBalance = this._accountsMap[this._selectedAccountId].balance || 0;
        }
        const orgEngagedExpenses = cyclePlannedExpenses + cycleComingExpenses;
        const orgAvailableTreasury = Math.round((orgGrossBalance - orgEngagedExpenses) * 100) / 100;
        const orgPlannedIncome = (stats && stats.unreconciled_income !== undefined) ? stats.unreconciled_income : 0;
        const orgAvailableWithIncome = Math.round((orgAvailableTreasury + orgPlannedIncome) * 100) / 100;

        if (isOrgMode) {
            // ── Mode Organisation : Trésorerie Disponible (Capacité d'Engagement) ──
            ravLabel = t('cockpit_org_treasury_available_label', 'Trésorerie disponible');
            ravAmount = orgAvailableTreasury;
            ravRef = orgGrossBalance;

            if (orgGrossBalance > 0) {
                ravPercent = Math.max(0, Math.min(100, Math.round((orgAvailableTreasury / orgGrossBalance) * 100)));
                plannedPercent = Math.max(0, Math.min(100, Math.round((orgAvailableWithIncome / orgGrossBalance) * 100)));
                ravDetailText = tp('cockpit_org_treasury_detail', { total: formatCurrency(orgGrossBalance) }, `sur ${formatCurrency(orgGrossBalance)} de trésorerie brute`);
            } else {
                ravPercent = 0;
                plannedPercent = 0;
                ravDetailText = t('cockpit_org_treasury_deficit', 'Trésorerie en tension négative');
            }

            if (orgPlannedIncome > 0) {
                plannedTooltip = tp('cockpit_org_treasury_planned_tooltip', {
                    income: formatCurrency(orgPlannedIncome),
                    total: formatCurrency(orgAvailableWithIncome)
                }, `Trésorerie disponible avec rentrées attendues : ${formatCurrency(orgAvailableWithIncome)}`);
                gaugeTooltip = tp('cockpit_org_treasury_tooltip', {
                    available: formatCurrency(orgAvailableTreasury),
                    percent: ravPercent,
                    total: formatCurrency(orgGrossBalance)
                }, `Trésorerie nette disponible : ${formatCurrency(orgAvailableTreasury)} (${ravPercent}%). Solde brut consolidé : ${formatCurrency(orgGrossBalance)}.`);
                const subText = tp('cockpit_org_treasury_planned_income', {
                    income: formatCurrency(orgPlannedIncome),
                    total: formatCurrency(orgAvailableWithIncome)
                }, `+${formatCurrency(orgPlannedIncome)} attendus (→ ${formatCurrency(orgAvailableWithIncome)})`);
                plannedSubHtml = `<div class="cockpit-gauge-planned privacy-blur" title="${plannedTooltip}">${subText}</div>`;
            } else {
                gaugeTooltip = tp('cockpit_org_treasury_tooltip', {
                    available: formatCurrency(orgAvailableTreasury),
                    percent: ravPercent,
                    total: formatCurrency(orgGrossBalance)
                }, `Trésorerie nette disponible : ${formatCurrency(orgAvailableTreasury)} (${ravPercent}%). Solde brut consolidé : ${formatCurrency(orgGrossBalance)}.`);
            }

            showPlannedArc = orgPlannedIncome > 0 && orgAvailableWithIncome > orgAvailableTreasury;
            plannedVariant = orgAvailableWithIncome >= 0 ? 'planned-green' : (plannedPercent >= 20 ? 'planned-orange' : 'planned-red');
            ravColorClass = orgAvailableTreasury < 0 ? 'gauge-red' : (ravPercent < 30 ? 'gauge-orange' : 'gauge-green');
        } else {
            // ── Mode Personnel : Reste à vivre ──
            const ravInfo = this._getRestToLiveInfo(stats);
            const rav = ravInfo.rav;
            const plannedInc = ravInfo.plannedInc;
            const ravWithInc = ravInfo.ravWithInc;
            ravAmount = rav;

            if (stats.next_pay_date) {
                const ravInitial = Math.round((rav + cycleReconciledVarExpenses) * 100) / 100;
                const ravInitialWithInc = Math.round((ravWithInc + cycleReconciledVarExpenses) * 100) / 100;
                ravRef = plannedInc > 0 ? ravInitialWithInc : ravInitial;

                if (ravRef > 0) {
                    ravPercent = Math.max(0, Math.min(100, Math.round((rav / ravRef) * 100)));
                    plannedPercent = Math.max(0, Math.min(100, Math.round((ravWithInc / ravRef) * 100)));
                    ravDetailText = tp('cockpit_rav_detail_initial', { initial: formatCurrency(ravRef) }, `sur ${formatCurrency(ravRef)} de reste à vivre initial`);
                } else {
                    ravPercent = 0;
                    plannedPercent = 0;
                    ravDetailText = t('cockpit_rav_deficit', 'Enveloppe initiale en déficit');
                }

                if (plannedInc > 0) {
                    plannedTooltip = tp('overview_rav_planned_income_tooltip', { income: formatCurrency(plannedInc), total: formatCurrency(ravWithInc) }, `Reste à vivre avec encaissement des recettes prévues (+${formatCurrency(plannedInc)}) : ${formatCurrency(ravWithInc)}`);
                    gaugeTooltip = tp('cockpit_rav_gauge_tooltip_initial_planned', {
                        rav: formatCurrency(rav),
                        percent: ravPercent,
                        income: formatCurrency(plannedInc),
                        total: formatCurrency(ravWithInc),
                        planned_percent: plannedPercent,
                        initial: formatCurrency(ravRef),
                        consumed: formatCurrency(cycleReconciledVarExpenses)
                    }, `Reste à vivre : ${formatCurrency(rav)} (${ravPercent}%). Rentrées prévues : +${formatCurrency(plannedInc)} (soit ${formatCurrency(ravWithInc)}, ${plannedPercent}%). Enveloppe initiale : ${formatCurrency(ravRef)} (dépenses variables consommées : ${formatCurrency(cycleReconciledVarExpenses)}).`);
                } else {
                    gaugeTooltip = tp('cockpit_rav_gauge_tooltip_initial', {
                        rav: formatCurrency(rav),
                        percent: ravPercent,
                        initial: formatCurrency(ravRef),
                        consumed: formatCurrency(cycleReconciledVarExpenses)
                    }, `Reste à vivre : ${formatCurrency(rav)} sur ${formatCurrency(ravRef)} initial (${ravPercent}%). Dépenses variables consommées : ${formatCurrency(cycleReconciledVarExpenses)}.`);
                }
            } else {
                const avgIncome = this._cachedMonthlyAverages?.income || 0;
                ravRef = avgIncome;
                ravPercent = avgIncome > 0 ? Math.max(0, Math.min(100, Math.round((rav / avgIncome) * 100))) : 0;
                plannedPercent = avgIncome > 0 ? Math.max(0, Math.min(100, Math.round((ravWithInc / avgIncome) * 100))) : 0;
                ravDetailText = avgIncome > 0
                    ? (tp('cockpit_rav_detail', { income: formatCurrency(avgIncome) }, `sur ${formatCurrency(avgIncome)} de revenus`))
                    : (t('cockpit_no_income_data', 'Pas de données de revenus'));
                if (plannedInc > 0) {
                    plannedTooltip = tp('overview_rav_planned_income_tooltip', { income: formatCurrency(plannedInc), total: formatCurrency(ravWithInc) }, `Reste à vivre avec encaissement des recettes prévues (+${formatCurrency(plannedInc)}) : ${formatCurrency(ravWithInc)}`);
                    gaugeTooltip = tp('cockpit_rav_gauge_tooltip', {
                        rav: formatCurrency(rav),
                        percent: ravPercent,
                        income: formatCurrency(plannedInc),
                        total: formatCurrency(ravWithInc),
                        planned_percent: plannedPercent
                    }, `Reste à vivre : ${formatCurrency(rav)} (${ravPercent}%). Rentrées prévues non validées : +${formatCurrency(plannedInc)} (soit jusqu'à ${formatCurrency(ravWithInc)}, ${plannedPercent}%).`);
                } else {
                    gaugeTooltip = ravDetailText;
                }
            }

            if (ravPercent < 20) ravColorClass = 'gauge-red';
            else if (ravPercent < 50) ravColorClass = 'gauge-orange';
            else ravColorClass = 'gauge-green';

            showPlannedArc = plannedInc > 0 && plannedPercent > ravPercent;
            plannedVariant = ravWithInc >= 0 ? 'planned-green' : (plannedPercent >= 20 ? 'planned-orange' : 'planned-red');

            if (plannedInc > 0) {
                const subText = tp('overview_rav_planned_income', { income: formatCurrency(plannedInc), total: formatCurrency(ravWithInc) }, `+${formatCurrency(plannedInc)} prévus (→ ${formatCurrency(ravWithInc)})`);
                plannedSubHtml = `<div class="cockpit-gauge-planned privacy-blur" title="${plannedTooltip}">${subText}</div>`;
            }
        }

        // ── Gauge 2: Dépenses prévues rapprochées & Opérations à venir (Mode Personnel)
        //             OU Exécution Budgétaire / Décaissements (Mode Organisation) ──
        const totalCycleExpenses = cycleReconciledExpenses + cycleComingExpenses + cyclePlannedExpenses;
        const engagedExpenses = cycleReconciledExpenses + cycleComingExpenses;
        const remainingToDebit = cycleComingExpenses + cyclePlannedExpenses;
        let expensesLabel = t('cockpit_expenses_reconciled_label', 'Dépenses pointées');
        let expensesAmount = cycleReconciledExpenses;
        let expensesPercent = 0;
        let expensesComingPercent = 0;
        let showComingArc = false;
        let expensesColorClass = 'gauge-indigo';
        let expensesTooltip = '';
        let expensesComingSubHtml = '';
        let expensesDetailText = '';
        let expensesSubText = '';

        let orgBudgetTarget = 0;
        let orgBudgetSpent = 0;

        if (isOrgMode) {
            if (stats.budget_summary) {
                for (const pData of Object.values(stats.budget_summary)) {
                    if (pData && pData.target > 0) {
                        orgBudgetTarget += pData.target;
                        orgBudgetSpent += (pData.reconciled_expenses || pData.expenses || 0);
                    }
                }
            }

            if (orgBudgetTarget > 0) {
                expensesLabel = t('cockpit_org_budget_exec_label', 'Budget engagé');
                expensesAmount = orgBudgetSpent;
                expensesPercent = Math.min(100, Math.round((orgBudgetSpent / orgBudgetTarget) * 100));
                expensesDetailText = tp('cockpit_org_budget_exec_detail', {
                    spent: formatCurrency(orgBudgetSpent),
                    total: formatCurrency(orgBudgetTarget),
                    percent: expensesPercent
                }, `${formatCurrency(orgBudgetSpent)} sur ${formatCurrency(orgBudgetTarget)} alloués (${expensesPercent}%)`);
                expensesSubText = tp('cockpit_org_budget_exec_sub', { remaining: remainingDays }, `Exercice en cours • 📅 ${remainingDays}j`);
                const remainingBudget = Math.max(0, orgBudgetTarget - orgBudgetSpent);
                expensesTooltip = tp('cockpit_org_budget_exec_tooltip', {
                    spent: formatCurrency(orgBudgetSpent),
                    total: formatCurrency(orgBudgetTarget),
                    percent: expensesPercent,
                    remaining: formatCurrency(remainingBudget)
                }, `Consommation budgétaire de l'exercice : ${formatCurrency(orgBudgetSpent)} sur ${formatCurrency(orgBudgetTarget)} votés (${expensesPercent}%). Reste ${formatCurrency(remainingBudget)} disponibles.`);
                expensesColorClass = expensesPercent > 100 ? 'gauge-red' : (expensesPercent >= 85 ? 'gauge-orange' : 'gauge-indigo');
            } else {
                expensesLabel = t('cockpit_org_disbursed_label', 'Dépenses décaissées');
                expensesAmount = cycleReconciledExpenses;
                if (totalCycleExpenses > 0) {
                    expensesPercent = Math.min(100, Math.round((cycleReconciledExpenses / totalCycleExpenses) * 100));
                    expensesComingPercent = Math.min(100, Math.round((engagedExpenses / totalCycleExpenses) * 100));
                } else {
                    expensesPercent = 100;
                    expensesComingPercent = 100;
                }
                showComingArc = cycleComingExpenses > 0 && expensesComingPercent > expensesPercent;
                expensesDetailText = remainingToDebit > 0
                    ? tp('cockpit_org_disbursed_detail', { disbursed: formatCurrency(cycleReconciledExpenses), total: formatCurrency(totalCycleExpenses) }, `${formatCurrency(cycleReconciledExpenses)} sur ${formatCurrency(totalCycleExpenses)} prévus`)
                    : t('cockpit_expenses_all_reconciled', 'Toutes dépenses prévues pointées');
                expensesSubText = remainingToDebit > 0
                    ? `${tp('cockpit_expenses_remaining_planned', { remaining: formatCurrency(remainingToDebit) }, `Reste ${formatCurrency(remainingToDebit)} à venir`)} • 📅 ${remainingDays}j`
                    : `📅 ${cycleDetailText} (${cycleDayLabel})`;
                expensesTooltip = tp('cockpit_org_disbursed_tooltip', {
                    disbursed: formatCurrency(cycleReconciledExpenses),
                    percent: expensesPercent,
                    coming: formatCurrency(cycleComingExpenses),
                    engaged_percent: expensesComingPercent,
                    total: formatCurrency(totalCycleExpenses)
                }, `Dépenses décaissées : ${formatCurrency(cycleReconciledExpenses)} (${expensesPercent}%). Opérations engagées à venir : +${formatCurrency(cycleComingExpenses)} (soit ${expensesComingPercent}%). Total prévu : ${formatCurrency(totalCycleExpenses)}.`);
                if (cycleComingExpenses > 0) {
                    const comingSubText = tp('cockpit_org_disbursed_coming_sub', {
                        coming: formatCurrency(cycleComingExpenses),
                        total: formatCurrency(engagedExpenses)
                    }, `+${formatCurrency(cycleComingExpenses)} engagés (→ ${formatCurrency(engagedExpenses)})`);
                    expensesComingSubHtml = `<div class="cockpit-gauge-planned privacy-blur" style="color: #a78bfa;" title="${expensesTooltip}">${comingSubText}</div>`;
                }
                if (expensesPercent >= 90) expensesColorClass = 'gauge-green';
                else if (expensesPercent >= 50) expensesColorClass = 'gauge-indigo';
                else expensesColorClass = 'gauge-purple';
            }
        } else {
            // Mode Personnel
            if (totalCycleExpenses > 0) {
                expensesPercent = Math.min(100, Math.round((cycleReconciledExpenses / totalCycleExpenses) * 100));
                expensesComingPercent = Math.min(100, Math.round((engagedExpenses / totalCycleExpenses) * 100));
            } else {
                expensesPercent = 100;
                expensesComingPercent = 100;
            }
            if (expensesPercent >= 90) expensesColorClass = 'gauge-green';
            else if (expensesPercent >= 50) expensesColorClass = 'gauge-indigo';
            else expensesColorClass = 'gauge-purple';

            showComingArc = cycleComingExpenses > 0 && expensesComingPercent > expensesPercent;
            if (cycleComingExpenses > 0) {
                expensesTooltip = tp('cockpit_expenses_coming_tooltip', {
                    reconciled: formatCurrency(cycleReconciledExpenses),
                    percent: expensesPercent,
                    coming: formatCurrency(cycleComingExpenses),
                    engaged_percent: expensesComingPercent,
                    total: formatCurrency(totalCycleExpenses),
                    remaining: formatCurrency(cyclePlannedExpenses)
                }, `Dépenses pointées : ${formatCurrency(cycleReconciledExpenses)} (${expensesPercent}%). Opérations à venir annoncées : +${formatCurrency(cycleComingExpenses)} (soit ${expensesComingPercent}% engagés). Total prévu : ${formatCurrency(totalCycleExpenses)}. Reste ${formatCurrency(cyclePlannedExpenses)} à débiter.`);
                const comingSubText = tp('overview_expenses_coming_sub', {
                    coming: formatCurrency(cycleComingExpenses),
                    total: formatCurrency(engagedExpenses)
                }, `+${formatCurrency(cycleComingExpenses)} à venir (→ ${formatCurrency(engagedExpenses)})`);
                expensesComingSubHtml = `<div class="cockpit-gauge-planned privacy-blur" style="color: #a78bfa;" title="${expensesTooltip}">${comingSubText}</div>`;
            } else {
                expensesTooltip = tp('cockpit_expenses_gauge_tooltip', {
                    reconciled: formatCurrency(cycleReconciledExpenses),
                    total: formatCurrency(totalCycleExpenses),
                    percent: expensesPercent,
                    remaining: formatCurrency(cyclePlannedExpenses)
                }, `${formatCurrency(cycleReconciledExpenses)} pointés sur ${formatCurrency(totalCycleExpenses)} prévus (${expensesPercent}%). Reste ${formatCurrency(cyclePlannedExpenses)} à débiter.`);
            }

            expensesDetailText = remainingToDebit > 0
                ? tp('cockpit_expenses_reconciled_detail', { reconciled: formatCurrency(cycleReconciledExpenses), total: formatCurrency(totalCycleExpenses) }, `${formatCurrency(cycleReconciledExpenses)} sur ${formatCurrency(totalCycleExpenses)} prévus`)
                : t('cockpit_expenses_all_reconciled', 'Toutes dépenses prévues pointées');
            expensesSubText = remainingToDebit > 0
                ? `${tp('cockpit_expenses_remaining_planned', { remaining: formatCurrency(remainingToDebit) }, `Reste ${formatCurrency(remainingToDebit)} à venir`)} • 📅 ${remainingDays}j`
                : `📅 ${cycleDetailText} (${cycleDayLabel})`;
        }

        // ── Gauge 3: Cadence Budgétaire (Mode Personnel) OU Runway / Réserve en Mois (Mode Organisation) ──
        const cadenceLabel = isOrgMode ? t('cockpit_org_runway_label', 'Réserve (Runway)') : t('cockpit_cadence_label', 'Cadence');
        let cadenceRatio = 1.0;
        let cadenceColorClass = 'cadence-blue';
        let cadenceStatusClass = 'status-blue';
        let cadenceStatusText = t('cockpit_cadence_on_track', 'Dans les clous');
        let cadenceSubText = '';
        let cadenceDetailText = '';
        let cadenceCycleText = '';
        let cadenceTooltip = '';
        let dailySpent = 0;
        let dailyRef = 0;
        let needleAngle = -90;
        let cadenceCenterAmount = '';
        let cadenceCenterSub = '';
        let analogLabels = null;

        let runwayMonths = 0;
        let runwayMonthsStr = '0.0';
        let monthlyBurn = 0;

        if (isOrgMode) {
            // Mode Organisation : Réserve Opérationnelle (Runway en Mois)
            const avgFixed = this._cachedMonthlyAverages?.fixed || 0;
            const avgVar = this._cachedMonthlyAverages?.var || 0;
            monthlyBurn = (avgFixed + avgVar);
            if (monthlyBurn <= 0) {
                monthlyBurn = totalCycleExpenses > 0 ? totalCycleExpenses : (cycleReconciledExpenses || 1);
            }
            if (monthlyBurn <= 0) monthlyBurn = 1;

            runwayMonths = Math.max(0, ravAmount / monthlyBurn);
            if (runwayMonths <= 0) {
                needleAngle = -90;
            } else if (runwayMonths <= 4.5) {
                const theta = (runwayMonths / 4.5) * 90;
                needleAngle = Math.max(-90, Math.min(0, theta - 90));
            } else {
                const theta = 90 + Math.min(1, (runwayMonths - 4.5) / 7.5) * 90;
                needleAngle = Math.max(0, Math.min(90, theta - 90));
            }

            if (runwayMonths < 2.0) {
                cadenceColorClass = 'cadence-red';
                cadenceStatusClass = 'status-red';
                cadenceStatusText = t('cockpit_org_runway_critical', 'Tension critique');
            } else if (runwayMonths < 3.0) {
                cadenceColorClass = 'cadence-orange';
                cadenceStatusClass = 'status-orange';
                cadenceStatusText = t('cockpit_org_runway_tight', 'Trésorerie serrée');
            } else if (runwayMonths <= 6.0) {
                cadenceColorClass = 'cadence-green';
                cadenceStatusClass = 'status-green';
                cadenceStatusText = t('cockpit_org_runway_safe', 'Périmètre sécurisé');
            } else {
                cadenceColorClass = 'cadence-blue';
                cadenceStatusClass = 'status-blue';
                cadenceStatusText = t('cockpit_org_runway_strong', 'Réserve confortable');
            }

            runwayMonthsStr = runwayMonths >= 10 ? Math.round(runwayMonths).toString() : runwayMonths.toFixed(1);
            cadenceCenterAmount = `${runwayMonthsStr}<span class="cockpit-gauge-unit">${t('cockpit_org_runway_unit', 'm')}</span>`;
            cadenceCenterSub = tp('cockpit_org_runway_charges', { charges: formatCurrency(monthlyBurn) }, `Charges : ${formatCurrency(monthlyBurn)}/m`);
            cadenceSubText = t('cockpit_org_runway_sub', 'Autonomie financière');
            cadenceCycleText = `📅 ${cycleDetailText} (${cycleDayLabel})`;
            cadenceTooltip = tp('cockpit_org_runway_tooltip', {
                months: runwayMonthsStr,
                status: cadenceStatusText,
                charges: formatCurrency(monthlyBurn)
            }, `Autonomie financière : ${runwayMonthsStr} mois de charges couverts (${cadenceStatusText}). Charges mensuelles moyennes : ${formatCurrency(monthlyBurn)}/mois.`);

            analogLabels = {
                zero: t('cockpit_org_runway_scale_zero', '0m'),
                avg: t('cockpit_org_runway_scale_mid', '3-6m'),
                max: t('cockpit_org_runway_scale_max', '12m+'),
                isRunway: true
            };
        } else if (stats.next_pay_date) {
            // Mode Personnel avec cycle de paye
            const effectiveDays = Math.max(1, elapsedDays);
            dailySpent = cycleReconciledVarExpenses / effectiveDays;
            dailyRef = (this._cachedMonthlyAverages?.dailyVarClean > 0)
                ? this._cachedMonthlyAverages.dailyVarClean
                : (totalCycleExpenses / Math.max(1, totalCycleDays));

            if (dailyRef <= 0) dailyRef = 1;

            if (elapsedDays === 0 || cycleReconciledVarExpenses === 0) {
                cadenceRatio = 0.0;
                needleAngle = -90;
            } else {
                cadenceRatio = dailySpent / dailyRef;
                let theta = 0;
                if (dailySpent <= dailyRef) {
                    theta = (dailySpent / dailyRef) * 90;
                } else {
                    theta = 90 + Math.min(1, (dailySpent - dailyRef) / dailyRef) * 90;
                }
                needleAngle = Math.max(-90, Math.min(90, theta - 90));
            }

            const diffPercent = Math.round(Math.abs(cadenceRatio - 1.0) * 100);

            if (cadenceRatio <= 0.90) {
                cadenceColorClass = 'cadence-green';
                cadenceStatusClass = 'status-green';
                cadenceStatusText = t('cockpit_cadence_steady', 'Rythme maîtrisé');
                cadenceSubText = tp('cockpit_cadence_sub_under', { diff: diffPercent }, `-${diffPercent}% sous la moyenne`);
            } else if (cadenceRatio <= 1.10) {
                cadenceColorClass = 'cadence-blue';
                cadenceStatusClass = 'status-blue';
                cadenceStatusText = t('cockpit_cadence_on_track', 'Dans les clous');
                cadenceSubText = t('cockpit_cadence_sub_aligned', 'Dépenses alignées sur le cycle');
            } else if (cadenceRatio <= 1.30) {
                cadenceColorClass = 'cadence-orange';
                cadenceStatusClass = 'status-orange';
                cadenceStatusText = t('cockpit_cadence_moderate', 'Cadence soutenue');
                cadenceSubText = tp('cockpit_cadence_sub_over', { diff: diffPercent }, `+${diffPercent}% au-dessus du rythme`);
            } else {
                cadenceColorClass = 'cadence-red';
                cadenceStatusClass = 'status-red';
                cadenceStatusText = t('cockpit_cadence_high', 'Surconsommation');
                cadenceSubText = tp('cockpit_cadence_sub_over', { diff: diffPercent }, `+${diffPercent}% au-dessus du rythme`);
            }

            cadenceDetailText = tp('cockpit_cadence_avg_ref', { avg: formatCurrency(dailyRef) }, `(Moyenne : ${formatCurrency(dailyRef)}/j)`);
            cadenceCycleText = tp('cockpit_cadence_sub_cycle', { current: elapsedDays, total: totalCycleDays, totalSpent: formatCurrency(cycleReconciledVarExpenses) }, `${formatCurrency(cycleReconciledVarExpenses)} vie courante au j. ${elapsedDays}/${totalCycleDays}`);
            cadenceTooltip = tp('cockpit_cadence_gauge_tooltip_analog', { dailySpent: formatCurrency(dailySpent), dailyRef: formatCurrency(dailyRef), status: cadenceStatusText, days: elapsedDays, totalSpent: formatCurrency(cycleReconciledVarExpenses) }, `Cadence journalière : ${formatCurrency(dailySpent)}/j (Moyenne propre : ${formatCurrency(dailyRef)}/j — ${cadenceStatusText}). Dépenses courantes : ${formatCurrency(cycleReconciledVarExpenses)} sur ${elapsedDays} jours.`);

            cadenceCenterAmount = `${formatCurrency(dailySpent)}<span class="cockpit-gauge-unit">/j</span>`;
            cadenceCenterSub = cadenceDetailText;
        } else {
            // Mode Personnel sans cycle de paye
            const effectiveDays = Math.max(1, elapsedDays);
            dailySpent = cycleReconciledExpenses / effectiveDays;
            const avgDailyExp = (this._cachedMonthlyAverages?.dailyFixed || 0) + (this._cachedMonthlyAverages?.dailyVar || 0);
            dailyRef = avgDailyExp > 0 ? avgDailyExp : (totalCycleExpenses / Math.max(1, totalCycleDays));

            if (dailyRef <= 0) dailyRef = 1;

            if (elapsedDays === 0 || cycleReconciledExpenses === 0) {
                cadenceRatio = 0.0;
                needleAngle = -90;
            } else {
                cadenceRatio = dailySpent / dailyRef;
                let theta = 0;
                if (dailySpent <= dailyRef) {
                    theta = (dailySpent / dailyRef) * 90;
                } else {
                    theta = 90 + Math.min(1, (dailySpent - dailyRef) / dailyRef) * 90;
                }
                needleAngle = Math.max(-90, Math.min(90, theta - 90));
            }

            const diffPercent = Math.round(Math.abs(cadenceRatio - 1.0) * 100);

            if (cadenceRatio <= 0.90) {
                cadenceColorClass = 'cadence-green';
                cadenceStatusClass = 'status-green';
                cadenceStatusText = t('cockpit_cadence_steady', 'Rythme maîtrisé');
                cadenceSubText = tp('cockpit_cadence_sub_under', { diff: diffPercent }, `-${diffPercent}% sous la moyenne`);
            } else if (cadenceRatio <= 1.10) {
                cadenceColorClass = 'cadence-blue';
                cadenceStatusClass = 'status-blue';
                cadenceStatusText = t('cockpit_cadence_on_track', 'Dans les clous');
                cadenceSubText = t('cockpit_cadence_sub_aligned', 'Dépenses alignées sur le cycle');
            } else if (cadenceRatio <= 1.30) {
                cadenceColorClass = 'cadence-orange';
                cadenceStatusClass = 'status-orange';
                cadenceStatusText = t('cockpit_cadence_moderate', 'Cadence soutenue');
                cadenceSubText = tp('cockpit_cadence_sub_over', { diff: diffPercent }, `+${diffPercent}% au-dessus du rythme`);
            } else {
                cadenceColorClass = 'cadence-red';
                cadenceStatusClass = 'status-red';
                cadenceStatusText = t('cockpit_cadence_high', 'Surconsommation');
                cadenceSubText = tp('cockpit_cadence_sub_over', { diff: diffPercent }, `+${diffPercent}% au-dessus du rythme`);
            }

            cadenceDetailText = tp('cockpit_cadence_avg_ref', { avg: formatCurrency(dailyRef) }, `(Moyenne : ${formatCurrency(dailyRef)}/j)`);
            cadenceCycleText = `📅 ${cycleDetailText} (${cycleDayLabel})`;
            cadenceTooltip = tp('cockpit_cadence_gauge_tooltip_analog', { dailySpent: formatCurrency(dailySpent), dailyRef: formatCurrency(dailyRef), status: cadenceStatusText, days: elapsedDays, totalSpent: formatCurrency(cycleReconciledExpenses) }, `Cadence journalière : ${formatCurrency(dailySpent)}/j (Moyenne : ${formatCurrency(dailyRef)}/j — ${cadenceStatusText}). Dépenses pointées : ${formatCurrency(cycleReconciledExpenses)} sur ${elapsedDays}/${totalCycleDays} jours.`);

            cadenceCenterAmount = `${formatCurrency(dailySpent)}<span class="cockpit-gauge-unit">/j</span>`;
            cadenceCenterSub = cadenceDetailText;
        }

        // ── Build Gauges HTML ──
        gaugesContainer.innerHTML = `
            <div class="cockpit-gauge-card ${ravColorClass} clickable" data-gauge="rav" title="${gaugeTooltip}" onclick="window.OverviewView.showCockpitTileInfo('rav')">
                <div class="cockpit-gauge-wrapper">
                    ${this._buildGaugeSVG(ravPercent, 'rav', showPlannedArc ? plannedPercent : null, plannedTooltip, plannedVariant)}
                    <div class="cockpit-gauge-center">
                        <div class="cockpit-gauge-percent">${ravPercent}%</div>
                        <div class="cockpit-gauge-sublabel">${ravLabel}</div>
                    </div>
                </div>
                <div class="cockpit-gauge-caption">
                    <div class="cockpit-gauge-amount privacy-blur" style="${ravAmount < 0 ? 'color: #ef4444;' : ''}">${formatCurrency(ravAmount)}</div>
                    ${plannedSubHtml}
                    <div class="cockpit-gauge-detail ${ravRef > 0 ? 'privacy-blur' : ''}">${ravDetailText}</div>
                </div>
            </div>
            <div class="cockpit-gauge-card ${expensesColorClass} clickable" data-gauge="expenses" title="${expensesTooltip}" onclick="window.OverviewView.showCockpitTileInfo('expenses')">
                <div class="cockpit-gauge-wrapper">
                    ${this._buildGaugeSVG(expensesPercent, 'expenses', showComingArc ? expensesComingPercent : null, expensesTooltip, 'planned-purple')}
                    <div class="cockpit-gauge-center">
                        <div class="cockpit-gauge-percent">${expensesPercent}%</div>
                        <div class="cockpit-gauge-sublabel">${expensesLabel}</div>
                    </div>
                </div>
                <div class="cockpit-gauge-caption">
                    <div class="cockpit-gauge-amount privacy-blur">${formatCurrency(expensesAmount)}</div>
                    ${expensesComingSubHtml}
                    <div class="cockpit-gauge-detail ${remainingToDebit > 0 ? 'privacy-blur' : ''}" style="font-weight:600; color:var(--text-main); margin-top:3px;">${expensesDetailText}</div>
                    <div class="cockpit-gauge-detail ${remainingToDebit > 0 ? 'privacy-blur' : ''}" style="color:var(--text-muted); font-size:11px; margin-top:2px;">${expensesSubText}</div>
                </div>
            </div>
            <div class="cockpit-gauge-card cockpit-analog-card ${cadenceColorClass} clickable" data-gauge="cadence" aria-label="${cadenceLabel}" title="${cadenceTooltip}" onclick="window.OverviewView.showCockpitTileInfo('cadence')">
                <div class="cockpit-gauge-wrapper cockpit-analog-wrapper">
                    ${this._buildAnalogGaugeSVG(needleAngle, 'cadence', cadenceColorClass, analogLabels)}
                    <div class="cockpit-analog-center">
                        <div class="cockpit-gauge-amount privacy-blur">${cadenceCenterAmount}</div>
                        <div class="cockpit-gauge-sublabel privacy-blur">${cadenceCenterSub}</div>
                    </div>
                </div>
                <div class="cockpit-gauge-caption">
                    <div class="cockpit-cadence-status ${cadenceStatusClass}">${cadenceStatusText}</div>
                    <div class="cockpit-gauge-detail" style="font-weight:600; color:var(--text-main); margin-top:3px;">${cadenceSubText}</div>
                    <div class="cockpit-gauge-detail ${(!isOrgMode && stats.next_pay_date) ? 'privacy-blur' : ''}" style="color:var(--text-muted); font-size:11px; margin-top:2px;">${cadenceCycleText}</div>
                </div>
            </div>
        `;

        // ── Build Cards HTML ──
        // Card 1: Projection Fin de Cycle / Fin de Mois
        const proj = this._calculateProjection(stats);
        const projAmount = proj.projectedEnd;
        const projColorClass = projAmount >= 0 ? 'text-green' : 'text-red';
        const projTitle = proj.titleText || (proj.hasPayCycle ? t('cockpit_projection_cycle_title', 'Projection Fin de Cycle') : t('cockpit_projection_title', 'Projection'));
        const projSubText = proj.subText;

        let candidateSum = 0;
        if (stats.anticipated_recurrences && Array.isArray(stats.anticipated_recurrences)) {
            candidateSum = stats.anticipated_recurrences.reduce((sum, cand) => sum + (Math.abs(parseFloat(cand.amount)) || 0), 0);
        }
        candidateSum = Math.round(candidateSum * 100) / 100;

        let projNetSubHtml = '';
        if (candidateSum > 0) {
            const netProjAmount = Math.round((projAmount - candidateSum) * 100) / 100;
            const netSubText = tp('cockpit_proj_net_sub', { amount: formatCurrency(netProjAmount) }, `Net après charges récurrentes : ${formatCurrency(netProjAmount)}`);
            const netTooltip = tp('cockpit_proj_net_tooltip', { amount: formatCurrency(candidateSum) }, `Déduction faite de ${formatCurrency(candidateSum)} de charges récurrentes anticipées (abonnements)`);
            projNetSubHtml = `<div class="cockpit-card-sub-extra privacy-blur" title="${netTooltip}">${netSubText}</div>`;
        }

        let projBadgeHtml = '';
        if (stats.overdraft_warning) {
            if (stats.overdraft_warning.covered_by_income) {
                projBadgeHtml = `<span class="cockpit-card-badge badge-warning" style="font-size: 10px; padding: 2px 7px;" title="${t('cockpit_vigilance_tooltip', 'Tension de trésorerie temporaire absorbée par les rentrées prévues')}">${t('cockpit_vigilance_badge', '⏳ Vigilance')}</span>`;
            } else {
                projBadgeHtml = `<span class="cockpit-card-badge badge-danger" style="font-size: 10px; padding: 2px 7px;" title="${t('cockpit_overdraft_tooltip', 'Risque de découvert sans rentrées supplémentaires')}">${t('cockpit_overdraft_badge', '⚠️ Risque')}</span>`;
            }
        }

        // Cache tile information for mobile / click info sheets
        const netProjAmount = Math.round((projAmount - candidateSum) * 100) / 100;

        // Détection conformité & pièces jointes / remises de chèques pour mode organisation
        let missingAttachmentsCount = 0;
        let pendingCheckSlipsCount = 0;
        const enableAttach = window.app?.config?.enable_attachments === 'true';
        const enableSlips = window.app?.config?.enable_check_slips === 'true';
        for (const tx of (this._transactions || [])) {
            if (tx.is_skipped) continue;
            if (tx.type === 'transfer') continue;
            if (enableAttach && tx.amount < 0 && tx.reconciliation_date && !tx.attachments) {
                missingAttachmentsCount++;
            }
            if (enableSlips && tx.check_slip_number && !tx.reconciliation_date) {
                pendingCheckSlipsCount++;
            }
        }

        const auditCardTitle = t('cockpit_org_audit_title', 'Conformité & Audit');
        let auditBadgeHtml = '';
        let auditValue = missingAttachmentsCount > 0 ? String(missingAttachmentsCount) : (pendingCheckSlipsCount > 0 ? String(pendingCheckSlipsCount) : '0');
        let auditSubText = '';

        if (missingAttachmentsCount > 0) {
            auditBadgeHtml = `<span class="cockpit-card-badge badge-warning" style="font-size: 10px; padding: 2px 7px;">⚠️ ${tp('cockpit_org_audit_missing_docs_short', { count: missingAttachmentsCount }, `${missingAttachmentsCount} sans justificatif`)}</span>`;
            auditSubText = tp('cockpit_org_audit_missing_docs', { count: missingAttachmentsCount, s: missingAttachmentsCount > 1 ? 's' : '' }, `${missingAttachmentsCount} justificatif${missingAttachmentsCount > 1 ? 's' : ''} manquant${missingAttachmentsCount > 1 ? 's' : ''}`);
        } else if (pendingCheckSlipsCount > 0) {
            auditBadgeHtml = `<span class="cockpit-card-badge badge-info" style="font-size: 10px; padding: 2px 7px;">📋 ${tp('cockpit_org_audit_pending_slips', { count: pendingCheckSlipsCount }, `${pendingCheckSlipsCount} chèques`)}</span>`;
            auditSubText = tp('cockpit_org_audit_pending_slips', { count: pendingCheckSlipsCount }, `${pendingCheckSlipsCount} remises en attente`);
        } else {
            auditBadgeHtml = `<span class="cockpit-card-badge badge-success" style="font-size: 10px; padding: 2px 7px;">✨ ${t('cockpit_org_audit_ok', 'Comptabilité à jour')}</span>`;
            auditSubText = t('cockpit_org_audit_ok', 'Comptabilité à jour');
        }

        const auditTooltip = tp('cockpit_org_audit_tooltip', {
            missing: missingAttachmentsCount,
            slips: pendingCheckSlipsCount
        }, `Audit comptable : ${missingAttachmentsCount} opération(s) sans justificatif attaché, ${pendingCheckSlipsCount} bordereau(x) de chèques en attente.`);

        if (isOrgMode) {
            this._cachedCockpitTileData = {
                rav: {
                    icon: '🏦',
                    title: t('cockpit_org_sheet_treasury_title', 'Trésorerie Nette & Capacité d\'Engagement'),
                    value: formatCurrency(orgAvailableTreasury),
                    valueClass: orgAvailableTreasury < 0 ? 'text-red' : 'text-green',
                    badge: `${ravPercent}%`,
                    badgeClass: ravColorClass,
                    subtitle: ravDetailText,
                    rows: [
                        { label: t('cockpit_org_sheet_treasury_gross', 'Trésorerie brute consolidée'), value: formatCurrency(orgGrossBalance) },
                        { label: t('cockpit_org_sheet_treasury_engaged', 'Engagements & Dépenses à décaisser'), value: `-${formatCurrency(orgEngagedExpenses)}`, valueClass: 'text-red' },
                        ...(orgPlannedIncome > 0 ? [
                            { label: t('cockpit_org_sheet_treasury_expected', 'Subventions & Recettes attendues'), value: `+${formatCurrency(orgPlannedIncome)}`, valueClass: 'text-green' },
                            { label: 'Trésorerie disponible avec rentrées', value: formatCurrency(orgAvailableWithIncome), valueClass: 'text-green' }
                        ] : []),
                        { label: 'Trésorerie nette disponible immédiate', value: formatCurrency(orgAvailableTreasury), valueClass: orgAvailableTreasury < 0 ? 'text-red' : 'text-green' }
                    ],
                    text: gaugeTooltip
                },
                expenses: {
                    icon: '📊',
                    title: t('cockpit_org_sheet_budget_title', 'Exécution Budgétaire de l\'Exercice'),
                    value: formatCurrency(expensesAmount),
                    valueClass: 'text-main',
                    badge: `${expensesPercent}%`,
                    badgeClass: expensesColorClass,
                    subtitle: expensesDetailText,
                    rows: orgBudgetTarget > 0 ? [
                        { label: t('cockpit_org_sheet_budget_consumed', 'Dépenses imputées à date'), value: formatCurrency(orgBudgetSpent) },
                        { label: t('cockpit_org_sheet_budget_total', 'Budget total voté / alloué'), value: formatCurrency(orgBudgetTarget) },
                        { label: t('cockpit_org_sheet_budget_remaining', 'Solde budgétaire disponible'), value: formatCurrency(Math.max(0, orgBudgetTarget - orgBudgetSpent)), valueClass: 'text-green' },
                        { label: 'Jours restants dans le mois', value: `${remainingDays} j` }
                    ] : [
                        { label: 'Dépenses décaissées (débitées)', value: formatCurrency(cycleReconciledExpenses) },
                        ...(cycleComingExpenses > 0 ? [
                            { label: 'Opérations engagées à venir', value: `+${formatCurrency(cycleComingExpenses)}`, valueClass: 'text-purple' },
                            { label: 'Total engagé', value: formatCurrency(cycleReconciledExpenses + cycleComingExpenses) }
                        ] : []),
                        { label: 'Dépenses prévues restantes', value: formatCurrency(cyclePlannedExpenses) },
                        { label: 'Total prévu sur la période', value: formatCurrency(totalCycleExpenses) }
                    ],
                    text: expensesTooltip
                },
                cadence: {
                    icon: '🛡️',
                    title: t('cockpit_org_sheet_runway_title', 'Réserve Opérationnelle & Autonomie'),
                    value: `${runwayMonthsStr} mois`,
                    valueClass: 'text-main',
                    badge: cadenceStatusText,
                    badgeClass: cadenceStatusClass,
                    subtitle: `${cadenceSubText} • ${cadenceCenterSub}`,
                    rows: [
                        { label: 'Statut de la réserve', value: cadenceStatusText },
                        { label: t('cockpit_org_sheet_runway_months', 'Mois de fonctionnement couverts'), value: `${runwayMonthsStr} mois` },
                        { label: t('cockpit_org_sheet_runway_burn', 'Charges structurelles mensuelles'), value: `${formatCurrency(monthlyBurn)}/m` },
                        { label: 'Trésorerie nette disponible', value: formatCurrency(orgAvailableTreasury) },
                        { label: t('cockpit_org_sheet_runway_recom', 'Recommandation (3 à 6 mois)'), value: '3 - 6 mois' }
                    ],
                    text: cadenceTooltip
                },
                audit: {
                    icon: '🧾',
                    title: t('cockpit_org_sheet_audit_title', 'Audit Comptable & Pièces Justificatives'),
                    value: missingAttachmentsCount > 0 ? `${missingAttachmentsCount} sans justificatif` : t('cockpit_org_audit_ok', 'Comptabilité à jour'),
                    valueClass: missingAttachmentsCount > 0 ? 'text-orange' : 'text-green',
                    badge: missingAttachmentsCount > 0 ? '⚠️ À vérifier' : '✨ Conforme',
                    badgeClass: missingAttachmentsCount > 0 ? 'badge-warning' : 'badge-success',
                    subtitle: auditSubText,
                    rows: [
                        { label: t('cockpit_org_sheet_audit_missing', 'Opérations sans pièce jointe'), value: `${missingAttachmentsCount}`, valueClass: missingAttachmentsCount > 0 ? 'text-red' : 'text-green' },
                        { label: t('cockpit_org_sheet_audit_slips', 'Bordereaux de chèques non encaissés'), value: `${pendingCheckSlipsCount}` }
                    ],
                    text: auditTooltip + '\n\n💡 Conseil Trésorier : Rattachez les factures acquittées et justificatifs d\'adhésion pour garantir un bilan et un contrôle de conformité irréprochables.',
                    actionBtnText: t('cockpit_org_sheet_audit_click_action', 'Filtrer dans l\'Historique'),
                    onActionClick: () => {
                        window.AllOperationsView.pendingFilter = {
                            backToView: 'overview'
                        };
                        window.app.loadView('all_operations');
                    }
                },
                projection: {
                    icon: '🔮',
                    title: projTitle,
                    value: formatCurrency(projAmount),
                    valueClass: projColorClass,
                    badge: stats.overdraft_warning ? (stats.overdraft_warning.covered_by_income ? '⏳ Vigilance' : '⚠️ Risque') : (projAmount >= 0 ? '✨ Positif' : '⚠️ Déficit'),
                    badgeClass: stats.overdraft_warning ? (stats.overdraft_warning.covered_by_income ? 'badge-warning' : 'badge-danger') : (projAmount >= 0 ? 'badge-success' : 'badge-danger'),
                    subtitle: projSubText,
                    rows: [
                        { label: 'Solde actuel pointé', value: formatCurrency(proj.baseBalance) },
                        { label: 'Recettes à venir', value: `+${formatCurrency(proj.incomingSum)}`, valueClass: 'text-green' },
                        { label: 'Dépenses à venir', value: `-${formatCurrency(proj.outgoingSum)}`, valueClass: 'text-red' },
                        { label: 'Solde bancaire prévisionnel', value: formatCurrency(projAmount) },
                        ...(candidateSum > 0 ? [
                            { label: 'Charges récurrentes anticipées', value: `-${formatCurrency(candidateSum)}` },
                            { label: 'Net prévisionnel après récurrences', value: formatCurrency(netProjAmount), valueClass: 'text-main' }
                        ] : [])
                    ],
                    text: proj.tooltipText + (stats.overdraft_warning && stats.overdraft_warning.covered_by_income ? `\n\n⏳ Vigilance trésorerie : creux temporaire de ${formatCurrency(stats.overdraft_warning.projected_balance)} le ${formatDate(stats.overdraft_warning.date)}, mais couvert par les recettes prévues (+${formatCurrency(stats.overdraft_warning.planned_income_before_risk || stats.overdraft_warning.planned_income_total || 0)}).` : '')
                }
            };
        } else {
            // Mode Personnel
            this._cachedCockpitTileData = {
                rav: {
                    icon: '💰',
                    title: t('cockpit_rav_label', 'Reste à vivre'),
                    value: formatCurrency(ravAmount),
                    valueClass: ravAmount < 0 ? 'text-red' : 'text-green',
                    badge: (stats && stats.unreconciled_income > 0) ? `${ravPercent}% (${plannedPercent}% avec rentrées)` : `${ravPercent}%`,
                    badgeClass: ravColorClass,
                    subtitle: ravDetailText,
                    rows: [
                        { label: 'Reste à vivre brut actuel', value: formatCurrency(ravAmount) },
                        ...((stats && stats.unreconciled_income > 0) ? [
                            { label: 'Rentrées prévues non pointées', value: `+${formatCurrency(stats.unreconciled_income)}`, valueClass: 'text-green' },
                            { label: 'Reste à vivre avec rentrées', value: formatCurrency(ravAmount + stats.unreconciled_income), valueClass: 'text-green' }
                        ] : []),
                        { label: 'Enveloppe initiale du cycle', value: formatCurrency(ravRef) },
                        { label: 'Dépenses courantes consommées', value: formatCurrency(cycleReconciledVarExpenses) }
                    ],
                    text: gaugeTooltip
                },
                expenses: {
                    icon: '💳',
                    title: t('cockpit_expenses_reconciled_label', 'Dépenses pointées'),
                    value: formatCurrency(cycleReconciledExpenses),
                    valueClass: 'text-main',
                    badge: cycleComingExpenses > 0 ? `${expensesPercent}% (${expensesComingPercent}% engagés)` : `${expensesPercent}%`,
                    badgeClass: expensesColorClass,
                    subtitle: expensesDetailText,
                    rows: [
                        { label: 'Dépenses pointées (débitées)', value: formatCurrency(cycleReconciledExpenses) },
                        ...(cycleComingExpenses > 0 ? [
                            { label: t('cockpit_expenses_coming_tile_row', 'Opérations à venir annoncées'), value: `+${formatCurrency(cycleComingExpenses)}`, valueClass: 'text-purple' },
                            { label: 'Total engagé (pointé + à venir)', value: formatCurrency(engagedExpenses), valueClass: 'text-main' }
                        ] : []),
                        { label: 'Dépenses prévues restantes non annoncées', value: formatCurrency(cyclePlannedExpenses) },
                        { label: 'Total prévu sur le cycle', value: formatCurrency(totalCycleExpenses) },
                        { label: 'Jours restants dans le cycle', value: `${remainingDays} j` }
                    ],
                    text: expensesTooltip
                },
                cadence: {
                    icon: '⏱️',
                    title: t('cockpit_cadence_label', 'Cadence'),
                    value: `${formatCurrency(dailySpent)}/j`,
                    valueClass: 'text-main',
                    badge: cadenceStatusText,
                    badgeClass: cadenceStatusClass,
                    subtitle: `${cadenceSubText} • ${cadenceDetailText}`,
                    rows: [
                        { label: 'Statut du rythme', value: cadenceStatusText },
                        { label: 'Dépenses journalières constatées', value: `${formatCurrency(dailySpent)}/j` },
                        { label: 'Moyenne propre de référence', value: `${formatCurrency(dailyRef)}/j` },
                        { label: 'Dépenses courantes cumulées', value: formatCurrency(cycleReconciledVarExpenses) },
                        { label: 'Avancement du cycle', value: `${elapsedDays} / ${totalCycleDays} jours` }
                    ],
                    text: cadenceTooltip
                },
                projection: {
                    icon: '🔮',
                    title: projTitle,
                    value: formatCurrency(projAmount),
                    valueClass: projColorClass,
                    badge: stats.overdraft_warning ? (stats.overdraft_warning.covered_by_income ? '⏳ Vigilance' : '⚠️ Risque') : (projAmount >= 0 ? '✨ Positif' : '⚠️ Déficit'),
                    badgeClass: stats.overdraft_warning ? (stats.overdraft_warning.covered_by_income ? 'badge-warning' : 'badge-danger') : (projAmount >= 0 ? 'badge-success' : 'badge-danger'),
                    subtitle: projSubText,
                    rows: [
                        { label: 'Solde actuel pointé', value: formatCurrency(proj.baseBalance) },
                        { label: 'Recettes à venir', value: `+${formatCurrency(proj.incomingSum)}`, valueClass: 'text-green' },
                        { label: 'Dépenses à venir', value: `-${formatCurrency(proj.outgoingSum)}`, valueClass: 'text-red' },
                        { label: 'Solde bancaire prévisionnel', value: formatCurrency(projAmount) },
                        ...(candidateSum > 0 ? [
                            { label: 'Charges récurrentes anticipées', value: `-${formatCurrency(candidateSum)}` },
                            { label: 'Net prévisionnel après récurrences', value: formatCurrency(netProjAmount), valueClass: 'text-main' }
                        ] : [])
                    ],
                    text: proj.tooltipText + (stats.overdraft_warning && stats.overdraft_warning.covered_by_income ? `\n\n⏳ Vigilance trésorerie : creux temporaire de ${formatCurrency(stats.overdraft_warning.projected_balance)} le ${formatDate(stats.overdraft_warning.date)}, mais couvert par les recettes prévues (+${formatCurrency(stats.overdraft_warning.planned_income_before_risk || stats.overdraft_warning.planned_income_total || 0)}).` : '')
                }
            };
        }

        this._cockpitGaugeContext = {
            totalCycleExpenses,
            ravRef,
            ravAmount,
            dailyRef,
            dailySpent,
            cycleReconciledVarExpenses,
            cycleReconciledExpenses,
            cycleComingExpenses,
            cyclePlannedExpenses,
            cycleStartISO,
            cycleEndISO,
            isOrgMode,
            orgGrossBalance: typeof orgGrossBalance !== 'undefined' ? orgGrossBalance : 0,
            orgAvailableTreasury: typeof orgAvailableTreasury !== 'undefined' ? orgAvailableTreasury : 0,
            orgBudgetTarget: typeof orgBudgetTarget !== 'undefined' ? orgBudgetTarget : 0,
            orgBudgetSpent: typeof orgBudgetSpent !== 'undefined' ? orgBudgetSpent : 0
        };

        // Card 2: AutoPilot Status
        const apStatus = this._apStatus || {};
        const apEnabled = !!apStatus.is_enabled;
        const apCount = apStatus.unseen_decisions_count || 0;
        const apReviewCount = apStatus.unseen_review_count || apStatus.review_queue_count || 0;
        const isVaultLocked = apEnabled && !apStatus.vault_unlocked && (apStatus.bank_auto_sync_enabled !== false);
        const apBadgeClass = apEnabled ? (isVaultLocked ? 'badge-warning' : 'badge-active') : 'badge-inactive';
        const apDotClass = apEnabled ? (isVaultLocked ? 'warning' : 'active') : 'inactive';
        const apLabel = apEnabled
            ? (isVaultLocked ? t('cockpit_ap_active_vault_locked', 'Actif · 🔒 Verrouillé') : t('cockpit_ap_active', 'Actif'))
            : (t('cockpit_ap_inactive', 'Veille'));
        const apBadgeTooltip = isVaultLocked
            ? t('cockpit_ap_vault_locked_tooltip', 'Auto-Pilote actif mais coffre-fort verrouillé : les relevés bancaires automatiques sont suspendus. Cliquez pour déverrouiller.')
            : (apEnabled ? t('cockpit_ap_active_tooltip', 'Auto-Pilote actif : surveillance et automatisations opérationnelles.') : t('cockpit_ap_inactive_tooltip', 'Auto-Pilote en veille.'));
        const apBadgeClick = isVaultLocked
            ? `onclick="event.stopPropagation(); if (window.BankSyncView && typeof window.BankSyncView.unlockVaultManually === 'function') window.BankSyncView.unlockVaultManually(); else window.OverviewView.showAutopilotPopover();"`
            : '';

        // Card 3: Operations to reconcile
        const unreconciledCount = this._getCockpitUnreconciledCount();

        if (isOrgMode) {
            cardsContainer.innerHTML = `
                <div class="cockpit-compact-card clickable" title="${proj.tooltipText}" onclick="window.OverviewView.showCockpitTileInfo('projection')">
                    <div class="cockpit-card-header">
                        <div class="cockpit-card-title">
                            <span class="cockpit-card-icon">🔮</span>
                            <span>${projTitle}</span>
                        </div>
                        ${projBadgeHtml}
                    </div>
                    <div class="cockpit-card-value privacy-blur ${projColorClass}">${formatCurrency(projAmount)}</div>
                    <div class="cockpit-card-sub">${projSubText}</div>
                    ${projNetSubHtml}
                </div>
                <div class="cockpit-compact-card clickable" title="${auditTooltip}" onclick="window.OverviewView.showCockpitTileInfo('audit')">
                    <div class="cockpit-card-header">
                        <div class="cockpit-card-title">
                            <span class="cockpit-card-icon">🧾</span>
                            <span>${auditCardTitle}</span>
                        </div>
                        ${auditBadgeHtml}
                    </div>
                    <div class="cockpit-card-value privacy-blur">${auditValue}</div>
                    <div class="cockpit-card-sub">${auditSubText}</div>
                    <span class="cockpit-card-arrow">→</span>
                </div>
                <div class="cockpit-compact-card clickable" onclick="window.app.loadView('dashboard')" title="${window.i18n ? (window.i18n.t('nav_dashboard') || 'Dashboard') : 'Dashboard'}">
                    <div class="cockpit-card-header">
                        <div class="cockpit-card-title">
                            <span class="cockpit-card-icon">📋</span>
                            <span>${t('cockpit_reconcile_title', 'À rapprocher')}</span>
                        </div>
                        <span class="cockpit-card-badge ${apBadgeClass}" title="${apBadgeTooltip}" ${apBadgeClick} onclick="event.stopPropagation(); window.OverviewView.showAutopilotPopover();">
                            <span class="cockpit-ap-dot ${apDotClass}"></span>
                            <span>${apLabel}</span>
                        </span>
                    </div>
                    <div class="cockpit-card-value">${unreconciledCount}</div>
                    <div class="cockpit-card-sub">${t('cockpit_reconcile_sub', 'opérations en attente')}</div>
                    <span class="cockpit-card-arrow">→</span>
                </div>
            `;
        } else {
            // Net worth (or the selected account's balance), moved here from the former full dashboard
            const selAcc = this._selectedAccountId ? this._accountsMap[this._selectedAccountId] : null;
            const netWorthLabel = selAcc
                ? `${t('overview_balance', 'Solde')} (${escapeHtml(selAcc.name)})`
                : t('overview_net_worth', 'Patrimoine net');
            const netWorthValue = selAcc ? selAcc.balance : stats.net_worth;
            cardsContainer.classList.add('cockpit-cards-row--4');
            cardsContainer.innerHTML = `
                <div class="cockpit-compact-card clickable" onclick="window.app.loadView('accounts')">
                    <div class="cockpit-card-header">
                        <div class="cockpit-card-title">
                            <span class="cockpit-card-icon">🏦</span>
                            <span>${netWorthLabel}</span>
                        </div>
                    </div>
                    <div class="cockpit-card-value privacy-blur">${formatCurrency(netWorthValue || 0)}</div>
                    <div class="cockpit-card-sub">${selAcc ? t('cockpit_networth_sub_account', 'Solde actuel du compte') : t('cockpit_networth_sub', 'Tous comptes et livrets')}</div>
                    <span class="cockpit-card-arrow">→</span>
                </div>
                <div class="cockpit-compact-card clickable" title="${proj.tooltipText}" onclick="window.OverviewView.showCockpitTileInfo('projection')">
                    <div class="cockpit-card-header">
                        <div class="cockpit-card-title">
                            <span class="cockpit-card-icon">🔮</span>
                            <span>${projTitle}</span>
                        </div>
                        ${projBadgeHtml}
                    </div>
                    <div class="cockpit-card-value privacy-blur ${projColorClass}">${formatCurrency(projAmount)}</div>
                    <div class="cockpit-card-sub">${projSubText}</div>
                    ${projNetSubHtml}
                </div>
                <div class="cockpit-compact-card clickable" onclick="window.OverviewView.showAutopilotPopover()">
                    <div class="cockpit-card-header">
                        <div class="cockpit-card-title">
                            <span class="cockpit-card-icon">🎯</span>
                            <span>AutoPilot</span>
                        </div>
                        <span class="cockpit-card-badge ${apBadgeClass}" title="${apBadgeTooltip}" ${apBadgeClick}>
                            <span class="cockpit-ap-dot ${apDotClass}"></span>
                            <span>${apLabel}</span>
                        </span>
                    </div>
                    <div class="cockpit-card-sub" style="margin-top: auto;">
                        ${apReviewCount > 0
                            ? `<span class="cockpit-ap-actions" style="color: #f59e0b; background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.3);">🔍 ${apReviewCount} ${t('cockpit_ap_to_review', 'à vérifier')}</span>`
                            : (apCount > 0
                                ? `<span class="cockpit-ap-actions">⚡ ${apCount} ${t('cockpit_ap_actions', 'action' + (apCount > 1 ? 's récentes' : ' récente'))}</span>`
                                : (isVaultLocked
                                    ? `<span style="color:#f59e0b; font-size: 12px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; cursor: pointer;" onclick="event.stopPropagation(); if (window.BankSyncView && typeof window.BankSyncView.unlockVaultManually === 'function') window.BankSyncView.unlockVaultManually(); else window.OverviewView.showAutopilotPopover();" title="${t('cockpit_ap_vault_locked_tooltip', 'Coffre verrouillé (cliquer pour déverrouiller)')}">⚠️ ${t('overview_autopilot_next_exec_vault_locked', 'Coffre verrouillé')}</span>`
                                    : `<span style="color:var(--text-muted); font-size: 12px;">${t('cockpit_ap_no_actions', 'Aucune action en attente')}</span>`
                                )
                            )
                        }
                    </div>
                </div>
                <div class="cockpit-compact-card clickable" onclick="window.app.loadView('dashboard')" title="${window.i18n ? (window.i18n.t('nav_dashboard') || 'Dashboard') : 'Dashboard'}">
                    <div class="cockpit-card-header">
                        <div class="cockpit-card-title">
                            <span class="cockpit-card-icon">📋</span>
                            <span>${t('cockpit_reconcile_title', 'À rapprocher')}</span>
                        </div>
                    </div>
                    <div class="cockpit-card-value">${unreconciledCount}</div>
                    <div class="cockpit-card-sub">${t('cockpit_reconcile_sub', 'opérations en attente')}</div>
                    <span class="cockpit-card-arrow">→</span>
                </div>
            `;
        }

        this._renderCockpitForecast();

        // ── Animate gauge arcs after DOM insert ──
        requestAnimationFrame(() => {
            const size = 180;
            const strokeWidth = 12;
            const radius = (size - strokeWidth) / 2;
            const circumference = 2 * Math.PI * radius;

            const ravArc = document.getElementById('cockpitArc_rav');
            if (ravArc) {
                if (ravPercent <= 0) {
                    ravArc.style.strokeDashoffset = circumference;
                    ravArc.style.opacity = '0';
                } else {
                    const target = circumference - (ravPercent / 100) * circumference;
                    ravArc.style.strokeDashoffset = target;
                    ravArc.style.opacity = '1';
                }
            }

            const ravPlannedArc = document.getElementById('cockpitArc_rav_planned');
            if (ravPlannedArc) {
                if (!showPlannedArc || plannedPercent <= 0) {
                    ravPlannedArc.style.strokeDashoffset = circumference;
                    ravPlannedArc.style.opacity = '0';
                } else {
                    const targetPlanned = circumference - (plannedPercent / 100) * circumference;
                    ravPlannedArc.style.strokeDashoffset = targetPlanned;
                    ravPlannedArc.style.opacity = '0.45';
                }
            }

            const expensesArc = document.getElementById('cockpitArc_expenses');
            if (expensesArc) {
                if (expensesPercent <= 0) {
                    expensesArc.style.strokeDashoffset = circumference;
                    expensesArc.style.opacity = '0';
                } else {
                    const target = circumference - (expensesPercent / 100) * circumference;
                    expensesArc.style.strokeDashoffset = target;
                    expensesArc.style.opacity = '1';
                }
            }

            const expensesPlannedArc = document.getElementById('cockpitArc_expenses_planned');
            if (expensesPlannedArc) {
                if (!showComingArc || expensesComingPercent <= 0) {
                    expensesPlannedArc.style.strokeDashoffset = circumference;
                    expensesPlannedArc.style.opacity = '0';
                } else {
                    const targetComing = circumference - (expensesComingPercent / 100) * circumference;
                    expensesPlannedArc.style.strokeDashoffset = targetComing;
                    expensesPlannedArc.style.opacity = '0.45';
                }
            }

            const cadenceNeedle = document.getElementById('cockpitNeedle_cadence');
            if (cadenceNeedle) {
                const targetAngle = parseFloat(cadenceNeedle.getAttribute('data-target-angle') || '-90');
                cadenceNeedle.style.transform = `rotate(${targetAngle}deg)`;
            }
        });
    },

    _buildAnalogGaugeSVG(needleAngle, id = 'cadence', colorClass = 'cadence-blue', labels = null) {
        const size = 180;
        const avgLabel = (labels && labels.avg) || window.i18n.t('cockpit_cadence_scale_avg') || 'Moy.';
        const zeroLabel = (labels && labels.zero) || window.i18n.t('cockpit_cadence_scale_zero') || '0';
        const maxLabel = (labels && labels.max) || window.i18n.t('cockpit_cadence_scale_max') || '2×';
        const isRunway = !!(labels && labels.isRunway);
        const gradId = isRunway ? 'cockpitRunwayGrad' : 'cockpitAnalogGrad';

        return `
            <svg class="cockpit-gauge-svg cockpit-analog-svg" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
                <defs>
                    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="0%">
                        ${isRunway ? `
                        <stop offset="0%" stop-color="#ef4444" />
                        <stop offset="25%" stop-color="#f59e0b" />
                        <stop offset="50%" stop-color="#10b981" />
                        <stop offset="75%" stop-color="#06b6d4" />
                        <stop offset="100%" stop-color="#6366f1" />
                        ` : `
                        <stop offset="0%" stop-color="#10b981" />
                        <stop offset="35%" stop-color="#06b6d4" />
                        <stop offset="50%" stop-color="#3b82f6" />
                        <stop offset="75%" stop-color="#f59e0b" />
                        <stop offset="100%" stop-color="#ef4444" />
                        `}
                    </linearGradient>
                </defs>
                <!-- Background track -->
                <path class="cockpit-analog-bg"
                    d="M 24 108 A 66 66 0 0 1 156 108"
                    fill="none" stroke-width="10" stroke-linecap="round" />
                <!-- Colored arc -->
                <path class="cockpit-analog-arc"
                    d="M 24 108 A 66 66 0 0 1 156 108"
                    fill="none" stroke="url(#${gradId})" stroke-width="10" stroke-linecap="round" />
                
                <!-- Tick Marks -->
                <!-- Left (0) -->
                <line x1="16" y1="108" x2="22" y2="108" class="cockpit-gauge-tick" />
                <text x="18" y="125" text-anchor="middle" class="cockpit-gauge-scale-txt">${zeroLabel}</text>
                
                <!-- Center (Moy.) -->
                <line x1="90" y1="34" x2="90" y2="40" class="cockpit-gauge-tick" />
                <text x="90" y="27" text-anchor="middle" class="cockpit-gauge-scale-txt">${avgLabel}</text>
                
                <!-- Right (2x) -->
                <line x1="158" y1="108" x2="164" y2="108" class="cockpit-gauge-tick" />
                <text x="162" y="125" text-anchor="middle" class="cockpit-gauge-scale-txt">${maxLabel}</text>

                <!-- Needle -->
                <g id="cockpitNeedle_${id}" class="cockpit-gauge-needle" style="transform-origin: 90px 108px; transform: rotate(-90deg);" data-target-angle="${needleAngle}">
                    <polygon points="87.5,108 92.5,108 91,48 89,48" fill="#f43f5e" />
                    <line x1="90" y1="108" x2="90" y2="46" stroke="#f43f5e" stroke-width="2.5" stroke-linecap="round" />
                    <circle cx="90" cy="46" r="3" fill="#fb7185" />
                    <circle cx="90" cy="108" r="7.5" class="cockpit-needle-pivot-bg" stroke-width="2" />
                    <circle cx="90" cy="108" r="4" fill="#f43f5e" />
                </g>
            </svg>
        `;
    },

    _renderCockpitForecast() {
        const container = document.getElementById('ovCockpitForecast');
        if (!container) return;

        const data = this._forecastSummary;
        if (!data) {
            container.innerHTML = `<div class="cockpit-forecast-loading" style="text-align:center; padding:16px; color:var(--text-muted);">⏳ Chargement des prévisions...</div>`;
            return;
        }

        const isOrgMode = window.app?.config?.enable_org_mode === 'true';

        const t = (key, fallback) => {
            const val = window.i18n.t(key);
            return (val && val !== key) ? val : fallback;
        };

        const nm = data.next_month || (data.trajectory_3m?.months?.[1]) || (data.cycle_forecast) || {};
        const monthLabel = nm.month_label || t('cockpit_forecast_next_month_title', 'Mois prochain');
        const incomeVal = Number(nm.projected_income ?? nm.income ?? 0);
        const fixedVal = Number(nm.fixed_charges ?? nm.fixed_expense ?? 0);
        const varVal = Number(nm.variable_expenses ?? nm.variable_expense ?? nm.variable_allocated ?? 0);
        const baseVarVal = Number(nm.base_variable ?? nm.base_variable_projected ?? varVal);
        const totalExpVal = Number(nm.total_expenses ?? nm.total_expense ?? (fixedVal + varVal));
        const netVal = Number(nm.projected_net ?? nm.net_savings ?? 0);
        const startBalVal = nm.start_balance !== undefined ? Number(nm.start_balance) : null;
        const endBalVal = nm.projected_end_balance !== undefined ? Number(nm.projected_end_balance) : null;
        const optimisticEnd = nm.optimistic_end_balance !== undefined ? Number(nm.optimistic_end_balance) : null;
        const pessimisticEnd = nm.pessimistic_end_balance !== undefined ? Number(nm.pessimistic_end_balance) : null;
        const seasonalPct = Number(nm.seasonal_pct || 0);

        let seasonBadgeHtml = '';
        const seasonTooltip = t('cockpit_forecast_seasonality_tooltip', 'Modèle de saisonnalité calculé à partir de vos historiques mensuels et des tendances réelles.');
        if (seasonalPct > 0) {
            const tagStr = t('cockpit_forecast_seasonality_tag_high', 'Saisonnalité : +{pct}%').replace('{pct}', seasonalPct);
            seasonBadgeHtml = `<span class="cockpit-forecast-season-badge badge-high" title="${escapeHtml(seasonTooltip)}">🍂 ${escapeHtml(tagStr)}</span>`;
        } else if (seasonalPct < 0) {
            const tagStr = t('cockpit_forecast_seasonality_tag_low', 'Saisonnalité : {pct}%').replace('{pct}', seasonalPct);
            seasonBadgeHtml = `<span class="cockpit-forecast-season-badge badge-low" title="${escapeHtml(seasonTooltip)}">🌱 ${escapeHtml(tagStr)}</span>`;
        } else {
            const tagStr = t('cockpit_forecast_seasonality_tag_neutral', 'Saisonnalité neutre');
            seasonBadgeHtml = `<span class="cockpit-forecast-season-badge badge-neutral" title="${escapeHtml(seasonTooltip)}">⚖️ ${escapeHtml(tagStr)}</span>`;
        }

        const isSimEnabled = !window.app?.config || (window.app.config.enable_simulator !== 'false' && window.app.config.enable_simulator !== false);
        const simBtnText = isSimEnabled
            ? t('cockpit_forecast_open_simulator', 'Accéder au Simulateur')
            : t('cockpit_forecast_enable_and_open_simulator', 'Activer et accéder au Simulateur');
        const simBtnAction = isSimEnabled
            ? "window.OverviewView.openSimulatorInCockpitMode()"
            : "window.OverviewView.enableAndOpenSimulator()";
        const simBtnExtraClass = isSimEnabled ? '' : ' sim-disabled';

        const incomeLabel = isOrgMode ? t('cockpit_org_forecast_income', 'Recettes & Subventions') : t('cockpit_forecast_next_month_income', 'Recettes prévues');
        const incomeHint = isOrgMode ? t('cockpit_org_forecast_income_hint', 'Subventions & rentrées attendues') : t('cockpit_forecast_next_month_income_hint', 'Salaires & rentrées attendus');
        const incomeTooltip = isOrgMode ? t('cockpit_org_forecast_income_tooltip', 'Total des subventions, cotisations et rentrées attendues pour le mois prochain.') : t('cockpit_forecast_next_month_income_tooltip', 'Total des salaires et rentrées prévisibles pour le mois prochain selon vos récurrences et votre historique.');

        const fixedLabel = isOrgMode ? t('cockpit_org_forecast_fixed', 'Charges de structure') : t('cockpit_forecast_next_month_fixed', 'Charges fixes prévues');
        const fixedHint = isOrgMode ? t('cockpit_org_forecast_fixed_hint', 'Loyer, contrats, charges récurrentes') : t('cockpit_forecast_next_month_fixed_hint', 'Loyer, crédits, abonnements');
        const fixedTooltip = isOrgMode ? t('cockpit_org_forecast_fixed_tooltip', 'Charges fixes de structure récurrentes (loyer, contrats, assurances, prestations).') : t('cockpit_forecast_next_month_fixed_tooltip', 'Total des charges récurrentes engagées (loyer, abonnements, mensualités, factures).');

        const varLabel = isOrgMode ? t('cockpit_org_forecast_var', 'Dépenses courantes') : t('cockpit_forecast_next_month_variable', 'Dépenses variables estimées');
        const varHint = isOrgMode ? t('cockpit_org_forecast_var_hint', 'Activités & fonctionnement courant') : t('cockpit_forecast_next_month_variable_hint', 'Vie courante (saisonnalité incluse)');
        const varTooltip = isOrgMode ? t('cockpit_org_forecast_variable_tooltip', 'Estimation des dépenses courantes de fonctionnement et projets selon le rythme moyen et la saisonnalité.') : t('cockpit_forecast_next_month_variable_tooltip', 'Estimation des dépenses courantes variables basée sur votre rythme moyen et la saisonnalité du mois.');

        const netLabel = isOrgMode ? t('cockpit_org_forecast_net_result', 'Résultat net estimé') : t('cockpit_forecast_next_month_remaining', 'Marge nette estimée');
        const netHint = isOrgMode ? t('cockpit_org_forecast_net_hint', 'Excédent ou besoin prévisionnel') : t('cockpit_forecast_next_month_remaining_hint', 'Marge nette prévisionnelle');
        const netTooltip = isOrgMode ? t('cockpit_org_forecast_net_tooltip', 'Résultat net estimé (Recettes - Charges de structure - Dépenses courantes) pour le mois prochain.') : t('cockpit_forecast_next_month_remaining_tooltip', 'Capacité d\'épargne ou marge disponible nette en fin de mois (Recettes - Fixes - Variables).');

        // Mémorisation des données des fiches de détail (Modale Info Sheet)
        if (!this._cachedCockpitTileData) this._cachedCockpitTileData = {};

        const coveragePct = (totalExpVal > 0) ? Math.round((incomeVal / totalExpVal) * 100) : 100;
        const fixedPct = (incomeVal > 0) ? Math.round((fixedVal / incomeVal) * 100) : 0;
        const remainingAfterFixed = incomeVal - fixedVal;
        const seasonDiff = Math.round((varVal - baseVarVal) * 100) / 100;

        // 1. Recettes prévues
        this._cachedCockpitTileData['next_month_income'] = {
            icon: '📥',
            title: isOrgMode ? t('cockpit_org_forecast_income', 'Recettes & Subventions') : t('cockpit_forecast_sheet_income_title', 'Recettes prévues'),
            value: `+${formatCurrency(incomeVal)}`,
            valueClass: 'text-green',
            badge: `${monthLabel}`,
            badgeClass: 'badge-success',
            subtitle: `${incomeHint} • ${monthLabel}`,
            rows: [
                { label: t('cockpit_forecast_sheet_ref_month', 'Mois de projection'), value: monthLabel },
                { label: isOrgMode ? t('cockpit_org_forecast_income', 'Subventions & cotisations attendues') : t('cockpit_forecast_next_month_income', 'Recettes et salaires prévus'), value: `+${formatCurrency(incomeVal)}`, valueClass: 'text-green' },
                ...(startBalVal !== null ? [
                    { label: t('cockpit_forecast_sheet_start_balance', 'Solde estimé début de mois'), value: formatCurrency(startBalVal) }
                ] : []),
                { label: t('cockpit_forecast_sheet_coverage_pct', 'Couverture des dépenses du mois'), value: `${coveragePct}%`, valueClass: coveragePct >= 100 ? 'text-green' : 'text-orange' }
            ],
            text: isOrgMode 
                ? t('cockpit_org_forecast_income_tooltip', 'Total des subventions, cotisations et rentrées attendues pour le mois prochain.')
                : t('cockpit_forecast_next_month_income_tooltip', 'Total des salaires et rentrées prévisibles pour le mois prochain selon vos récurrences et votre historique.'),
            actionBtnText: t('cockpit_forecast_open_simulator', 'Accéder au Simulateur'),
            onActionClick: () => {
                if (window.OverviewView && window.OverviewView.openSimulatorInCockpitMode) {
                    window.OverviewView.openSimulatorInCockpitMode();
                } else if (window.app && window.app.loadView) {
                    if (typeof ProfileStorage !== 'undefined') ProfileStorage.set('sim_mode', 'recommended');
                    window.app.loadView('simulator');
                }
            }
        };

        // 2. Charges fixes prévues
        this._cachedCockpitTileData['next_month_fixed'] = {
            icon: '📌',
            title: isOrgMode ? t('cockpit_org_forecast_fixed', 'Charges de structure') : t('cockpit_forecast_sheet_fixed_title', 'Charges fixes prévues'),
            value: `-${formatCurrency(fixedVal)}`,
            valueClass: 'text-main',
            badge: `${fixedPct}% des recettes`,
            badgeClass: fixedPct > 70 ? 'badge-warning' : 'badge-secondary',
            subtitle: `${fixedHint} • ${monthLabel}`,
            rows: [
                { label: t('cockpit_forecast_sheet_ref_month', 'Mois de projection'), value: monthLabel },
                { label: isOrgMode ? t('cockpit_org_forecast_fixed', 'Charges de structure prévues') : t('cockpit_forecast_next_month_fixed', 'Charges fixes engagées'), value: `-${formatCurrency(fixedVal)}`, valueClass: 'text-red' },
                { label: t('cockpit_forecast_sheet_fixed_share', 'Poids sur les recettes du mois'), value: `${fixedPct}%` },
                { label: t('cockpit_forecast_sheet_rem_after_fixed', 'Marge après charges fixes'), value: `${remainingAfterFixed >= 0 ? '+' : ''}${formatCurrency(remainingAfterFixed)}`, valueClass: remainingAfterFixed >= 0 ? 'text-green' : 'text-red' }
            ],
            text: isOrgMode 
                ? t('cockpit_org_forecast_fixed_tooltip', 'Charges fixes de structure récurrentes (loyer, contrats, assurances, prestations).')
                : t('cockpit_forecast_next_month_fixed_tooltip', 'Total des charges récurrentes engagées (loyer, abonnements, mensualités, factures).'),
            actionBtnText: t('cockpit_forecast_open_simulator', 'Accéder au Simulateur'),
            onActionClick: () => {
                if (window.OverviewView && window.OverviewView.openSimulatorInCockpitMode) {
                    window.OverviewView.openSimulatorInCockpitMode();
                } else if (window.app && window.app.loadView) {
                    if (typeof ProfileStorage !== 'undefined') ProfileStorage.set('sim_mode', 'recommended');
                    window.app.loadView('simulator');
                }
            }
        };

        // 3. Dépenses variables estimées
        this._cachedCockpitTileData['next_month_variable'] = {
            icon: '🛒',
            title: isOrgMode ? t('cockpit_org_forecast_var', 'Dépenses courantes') : t('cockpit_forecast_sheet_variable_title', 'Dépenses variables estimées'),
            value: `-${formatCurrency(varVal)}`,
            valueClass: 'text-main',
            badge: seasonalPct !== 0 ? (seasonalPct > 0 ? `🍂 +${seasonalPct}%` : `🌱 ${seasonalPct}%`) : `⚖️ Neutre`,
            badgeClass: seasonalPct > 0 ? 'badge-warning' : (seasonalPct < 0 ? 'badge-success' : 'badge-secondary'),
            subtitle: `${varHint} • ${monthLabel}`,
            rows: [
                { label: t('cockpit_forecast_sheet_ref_month', 'Mois de projection'), value: monthLabel },
                { label: t('cockpit_forecast_next_month_variable', 'Budget variable estimé'), value: `-${formatCurrency(varVal)}`, valueClass: 'text-main' },
                ...(baseVarVal && Math.abs(baseVarVal - varVal) > 0.01 ? [
                    { label: t('cockpit_forecast_sheet_base_var', 'Base moyenne (hors saisonnalité)'), value: formatCurrency(baseVarVal) },
                    { label: t('cockpit_forecast_sheet_season_impact', 'Impact saisonnier estimé'), value: `${seasonDiff > 0 ? '+' : ''}${formatCurrency(seasonDiff)} (${seasonalPct > 0 ? '+' : ''}${seasonalPct}%)`, valueClass: seasonalPct > 0 ? 'text-orange' : 'text-green' }
                ] : []),
                { label: t('cockpit_forecast_sheet_daily_budget', 'Cadence journalière équivalente'), value: `~${formatCurrency(varVal / 30)}/j` }
            ],
            text: isOrgMode 
                ? t('cockpit_org_forecast_variable_tooltip', 'Estimation des dépenses courantes de fonctionnement et projets selon le rythme moyen et la saisonnalité.')
                : t('cockpit_forecast_next_month_variable_tooltip', 'Estimation des dépenses courantes variables basée sur votre rythme moyen et la saisonnalité du mois.'),
            actionBtnText: t('cockpit_forecast_open_simulator', 'Accéder au Simulateur'),
            onActionClick: () => {
                if (window.OverviewView && window.OverviewView.openSimulatorInCockpitMode) {
                    window.OverviewView.openSimulatorInCockpitMode();
                } else if (window.app && window.app.loadView) {
                    if (typeof ProfileStorage !== 'undefined') ProfileStorage.set('sim_mode', 'recommended');
                    window.app.loadView('simulator');
                }
            }
        };

        // 4. Reste à vivre / Résultat net
        this._cachedCockpitTileData['next_month_remaining'] = {
            icon: '💰',
            title: isOrgMode ? t('cockpit_org_forecast_net_result', 'Résultat net estimé') : t('cockpit_forecast_sheet_remaining_title', 'Marge nette estimée'),
            value: `${netVal >= 0 ? '+' : ''}${formatCurrency(netVal)}`,
            valueClass: netVal >= 0 ? 'text-green' : 'text-red',
            badge: netVal >= 0 ? (isOrgMode ? '✨ Excédent' : '✨ Épargne') : (isOrgMode ? '⚠️ Besoin' : '⚠️ Déficit'),
            badgeClass: netVal >= 0 ? 'badge-success' : 'badge-danger',
            subtitle: `${netHint} • ${monthLabel}`,
            rows: [
                { label: t('cockpit_forecast_sheet_ref_month', 'Mois de projection'), value: monthLabel },
                { label: isOrgMode ? t('cockpit_org_forecast_income', 'Recettes prévues') : t('cockpit_forecast_next_month_income', 'Recettes prévues'), value: `+${formatCurrency(incomeVal)}`, valueClass: 'text-green' },
                { label: isOrgMode ? t('cockpit_org_forecast_fixed', 'Charges de structure') : t('cockpit_forecast_next_month_fixed', 'Charges fixes'), value: `-${formatCurrency(fixedVal)}`, valueClass: 'text-red' },
                { label: t('cockpit_forecast_sheet_rem_after_fixed', 'Marge après charges fixes (disponible)'), value: `${formatCurrency(remainingAfterFixed)}`, valueClass: remainingAfterFixed >= 0 ? 'text-main' : 'text-red' },
                { label: isOrgMode ? t('cockpit_org_forecast_var', 'Dépenses courantes') : t('cockpit_forecast_next_month_variable', 'Dépenses variables'), value: `-${formatCurrency(varVal)}`, valueClass: 'text-red' },
                { label: isOrgMode ? t('cockpit_org_forecast_net_result', 'Résultat net estimé') : t('cockpit_forecast_next_month_remaining', 'Marge nette estimée'), value: `${netVal >= 0 ? '+' : ''}${formatCurrency(netVal)}`, valueClass: netVal >= 0 ? 'text-green' : 'text-red' },
                ...(endBalVal !== null ? [
                    { label: t('cockpit_forecast_next_month_end_balance', 'Solde fin de mois estimé'), value: formatCurrency(endBalVal), valueClass: endBalVal >= 0 ? 'text-main' : 'text-red' }
                ] : []),
                ...(optimisticEnd !== null && pessimisticEnd !== null ? [
                    { label: t('cockpit_forecast_sheet_confidence_range', 'Fourchette réaliste (min / max)'), value: `${formatCurrency(pessimisticEnd)} → ${formatCurrency(optimisticEnd)}` }
                ] : [])
            ],
            text: isOrgMode 
                ? t('cockpit_org_forecast_net_tooltip', 'Résultat net estimé (Recettes - Charges de structure - Dépenses courantes) pour le mois prochain.')
                : t('cockpit_forecast_next_month_remaining_tooltip', 'Capacité d\'épargne ou marge disponible nette en fin de mois (Recettes - Fixes - Variables).'),
            actionBtnText: t('cockpit_forecast_open_simulator', 'Accéder au Simulateur'),
            onActionClick: () => {
                if (window.OverviewView && window.OverviewView.openSimulatorInCockpitMode) {
                    window.OverviewView.openSimulatorInCockpitMode();
                } else if (window.app && window.app.loadView) {
                    if (typeof ProfileStorage !== 'undefined') ProfileStorage.set('sim_mode', 'recommended');
                    window.app.loadView('simulator');
                }
            }
        };

        container.innerHTML = `
            <div class="cockpit-forecast-header">
                <div class="cockpit-forecast-title-group">
                    <h3 class="cockpit-forecast-main-title">🔮 <span data-i18n="cockpit_forecast_next_month_title">${t('cockpit_forecast_next_month_title', 'Cap sur le mois prochain')}</span></h3>
                    <span class="cockpit-forecast-month-badge">${escapeHtml(monthLabel)}</span>
                    ${seasonBadgeHtml}
                </div>
                <button class="cockpit-forecast-sim-btn${simBtnExtraClass}" onclick="${simBtnAction}" title="${escapeHtml(simBtnText)}">
                    <span>${escapeHtml(simBtnText)}</span>
                    <span>→</span>
                </button>
            </div>

            <div class="cockpit-forecast-kpi-grid">
                <!-- 1. Recettes prévues -->
                <div class="cockpit-forecast-kpi-card kpi-income clickable" onclick="window.OverviewView.showCockpitTileInfo('next_month_income')" title="${escapeHtml(incomeTooltip)}">
                    <div class="cockpit-forecast-kpi-top">
                        <span class="cockpit-forecast-kpi-icon">📥</span>
                        <span class="cockpit-forecast-kpi-label">${incomeLabel}</span>
                    </div>
                    <div class="cockpit-forecast-kpi-val text-green privacy-blur">+${formatCurrency(incomeVal)}</div>
                    <div class="cockpit-forecast-kpi-sub">${incomeHint}</div>
                </div>

                <!-- 2. Charges fixes prévues -->
                <div class="cockpit-forecast-kpi-card kpi-fixed clickable" onclick="window.OverviewView.showCockpitTileInfo('next_month_fixed')" title="${escapeHtml(fixedTooltip)}">
                    <div class="cockpit-forecast-kpi-top">
                        <span class="cockpit-forecast-kpi-icon">📌</span>
                        <span class="cockpit-forecast-kpi-label">${fixedLabel}</span>
                    </div>
                    <div class="cockpit-forecast-kpi-val text-main privacy-blur">-${formatCurrency(fixedVal)}</div>
                    <div class="cockpit-forecast-kpi-sub">${fixedHint}</div>
                </div>

                <!-- 3. Dépenses variables estimées -->
                <div class="cockpit-forecast-kpi-card kpi-variable clickable" onclick="window.OverviewView.showCockpitTileInfo('next_month_variable')" title="${escapeHtml(varTooltip)}">
                    <div class="cockpit-forecast-kpi-top">
                        <span class="cockpit-forecast-kpi-icon">🛒</span>
                        <span class="cockpit-forecast-kpi-label">${varLabel}</span>
                    </div>
                    <div class="cockpit-forecast-kpi-val text-main privacy-blur">-${formatCurrency(varVal)}</div>
                    <div class="cockpit-forecast-kpi-sub">${varHint}</div>
                </div>

                <!-- 4. Reste à vivre / Résultat net estimé -->
                <div class="cockpit-forecast-kpi-card kpi-remaining clickable" onclick="window.OverviewView.showCockpitTileInfo('next_month_remaining')" title="${escapeHtml(netTooltip)}">
                    <div class="cockpit-forecast-kpi-top">
                        <span class="cockpit-forecast-kpi-icon">💰</span>
                        <span class="cockpit-forecast-kpi-label">${netLabel}</span>
                    </div>
                    <div class="cockpit-forecast-kpi-val ${(netVal >= 0) ? 'text-green' : 'text-red'} privacy-blur">${netVal >= 0 ? '+' : ''}${formatCurrency(netVal)}</div>
                    <div class="cockpit-forecast-kpi-sub">
                        <span>${netHint}</span>
                        ${endBalVal !== null ? ` • <span class="privacy-blur" title="${escapeHtml(t('cockpit_forecast_next_month_end_balance', 'Solde fin de mois estimé'))}">${formatCurrency(endBalVal)}</span>` : ''}
                    </div>
                </div>
            </div>
        `;
    },

    _buildGaugeSVG(percent, id, plannedPercent = null, plannedTitle = '', plannedVariant = 'planned-green') {
        // SVG donut gauge with animated arc
        const size = 180;
        const strokeWidth = 12;
        const radius = (size - strokeWidth) / 2;
        const circumference = 2 * Math.PI * radius;

        const hasPlanned = plannedPercent !== null && plannedPercent > percent;

        return `
            <svg class="cockpit-gauge-svg" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
                <circle class="cockpit-gauge-bg"
                    cx="${size / 2}" cy="${size / 2}" r="${radius}"
                    stroke-width="${strokeWidth}" />
                ${hasPlanned ? `
                <circle class="cockpit-gauge-arc-planned ${plannedVariant}"
                    id="cockpitArc_${id}_planned"
                    cx="${size / 2}" cy="${size / 2}" r="${radius}"
                    stroke-width="${strokeWidth}"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${circumference}"
                    transform="rotate(-90 ${size / 2} ${size / 2})">
                    ${plannedTitle ? `<title>${plannedTitle}</title>` : ''}
                </circle>
                ` : ''}
                <circle class="cockpit-gauge-arc"
                    id="cockpitArc_${id}"
                    cx="${size / 2}" cy="${size / 2}" r="${radius}"
                    stroke-width="${strokeWidth}"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${circumference}"
                    transform="rotate(-90 ${size / 2} ${size / 2})" />
            </svg>
        `;
        // Animation is triggered after DOM insert via requestAnimationFrame below
    },

    _getCockpitUnreconciledCount() {
        const transactions = this._transactions || [];
        const todayISO = this._getTodayISO();
        let count = 0;
        for (const tx of transactions) {
            if (tx.reconciliation_date) continue;
            if (tx.is_skipped) continue;
            if (tx.cross_profile_status === 'pending') continue;
            if (tx.date_operation > todayISO) continue;
            count++;
        }
        return count;
    },

    async showCockpitTileInfo(tileKey) {
        if (!this._cachedCockpitTileData) this._cachedCockpitTileData = {};
        let data = this._cachedCockpitTileData[tileKey];

        // Handle hero overdraft card on demand
        if (!data && tileKey === 'hero_overdraft' && this._stats?.overdraft_warning) {
            const od = this._stats.overdraft_warning;
            const isCovered = !!od.covered_by_income;
            const incAmt = od.planned_income_before_risk || od.planned_income_total || 0;
            data = {
                icon: isCovered ? '⏳' : '⚠️',
                title: isCovered ? (window.i18n.t('overview_contingent_cashflow') || 'Vigilance trésorerie') : (window.i18n.t('overview_overdraft_risk') || 'Risque Découvert'),
                value: formatCurrency(od.projected_balance),
                valueClass: isCovered ? 'text-orange' : 'text-red',
                badge: isCovered ? '✅ Couvert' : '⚠️ Découvert',
                badgeClass: isCovered ? 'badge-warning' : 'badge-danger',
                subtitle: `${formatDate(od.date)} (${od.transaction_description})`,
                rows: [
                    { label: 'Date d\'impact estimée', value: formatDate(od.date) },
                    { label: 'Opération déclenchante', value: od.transaction_description },
                    { label: 'Montant de l\'opération', value: `-${formatCurrency(od.transaction_amount)}` },
                    { label: 'Creux théorique sans recettes', value: formatCurrency(od.projected_balance), valueClass: 'text-red' },
                    ...(isCovered ? [
                        { label: 'Recettes prévues absorbant le creux', value: `+${formatCurrency(incAmt)}`, valueClass: 'text-green' },
                        { label: 'Solde minimal avec recettes', value: formatCurrency(od.projected_balance_with_income || 0), valueClass: 'text-green' }
                    ] : [])
                ],
                text: isCovered
                    ? (window.i18n.tp ? window.i18n.tp('overview_health_contingent_tooltip', { date: formatDate(od.date), amount: formatCurrency(od.projected_balance), income: formatCurrency(incAmt) }) : `Creux de trésorerie temporaire absorbé par les rentrées prévues (+${formatCurrency(incAmt)}).`)
                    : `Risque de découvert le ${formatDate(od.date)} suite au débit de cette opération si aucune rentrée n'intervient.`
            };
        }

        // Handle next_month forecast cards on demand
        if (!data && tileKey && tileKey.startsWith('next_month_')) {
            this._renderCockpitForecast();
            data = this._cachedCockpitTileData ? this._cachedCockpitTileData[tileKey] : null;
        }

        if (!data) return;
        this._openInfoSheet(data, tileKey);
    },

    _openInfoSheet(data, tileKey) {
        this._currentSheetTileKey = tileKey;
        let overlay = document.getElementById('ovCockpitInfoSheetOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'ovCockpitInfoSheetOverlay';
            overlay.className = 'cockpit-info-sheet-overlay';
            overlay.innerHTML = `
                <div class="cockpit-info-sheet" role="dialog" aria-modal="true">
                    <div class="cockpit-info-sheet-handle"></div>
                    <div class="cockpit-info-sheet-header">
                        <div class="cockpit-info-sheet-title-group">
                            <span class="cockpit-info-sheet-icon" id="ovSheetIcon">💡</span>
                            <span class="cockpit-info-sheet-title" id="ovSheetTitle">Titre</span>
                        </div>
                        <button class="cockpit-info-sheet-close" id="ovSheetCloseBtn" aria-label="Fermer">✕</button>
                    </div>
                    <div class="cockpit-info-sheet-value-card" id="ovSheetValueCard">
                        <div>
                            <div class="cockpit-info-sheet-value privacy-blur" id="ovSheetValue">—</div>
                            <div class="cockpit-gauge-detail privacy-blur" id="ovSheetSubtitle" style="margin-top: 4px;"></div>
                        </div>
                        <span id="ovSheetBadge" class="cockpit-card-badge"></span>
                    </div>

                    <!-- Mini-graphique temporel avec sélecteur de durée -->
                    <div class="cockpit-info-sheet-chart-section" id="ovSheetChartSection" style="display:none;">
                        <div class="cockpit-sheet-chart-header">
                            <span class="cockpit-sheet-chart-title" id="ovSheetChartTitle">📈 Tendance</span>
                            <div class="cockpit-sheet-period-segmented" id="ovSheetPeriodGroup"></div>
                        </div>
                        <div class="cockpit-sheet-chart-canvas-wrapper">
                            <canvas id="ovSheetChartCanvas"></canvas>
                        </div>
                    </div>

                    <div class="cockpit-info-sheet-rows" id="ovSheetRows"></div>
                    <div class="cockpit-info-sheet-text" id="ovSheetText"></div>
                    <div class="cockpit-info-sheet-actions">
                        <button class="cockpit-info-sheet-btn-secondary" id="ovSheetSecondaryBtn" style="display:none;"></button>
                        <button class="cockpit-info-sheet-btn" id="ovSheetActionBtn">Compris</button>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);

            // Close handlers
            const closeBtn = document.getElementById('ovSheetCloseBtn');
            const actionBtn = document.getElementById('ovSheetActionBtn');
            if (closeBtn) closeBtn.onclick = () => this.closeInfoSheet();
            if (actionBtn) actionBtn.onclick = () => this.closeInfoSheet();
            overlay.onclick = (e) => {
                if (e.target === overlay) this.closeInfoSheet();
            };
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && overlay.classList.contains('active')) {
                    this.closeInfoSheet();
                }
            });
        }

        const t = (k, fb) => (window.i18n ? window.i18n.t(k) : null) || fb;
        document.getElementById('ovSheetIcon').textContent = data.icon || 'ℹ️';
        document.getElementById('ovSheetTitle').textContent = data.title || '';
        const valEl = document.getElementById('ovSheetValue');
        valEl.textContent = data.value || '—';
        valEl.className = `cockpit-info-sheet-value privacy-blur ${data.valueClass || ''}`;

        const subEl = document.getElementById('ovSheetSubtitle');
        if (data.subtitle) {
            subEl.style.display = 'block';
            subEl.textContent = data.subtitle;
        } else {
            subEl.style.display = 'none';
        }

        const badgeEl = document.getElementById('ovSheetBadge');
        if (data.badge) {
            badgeEl.style.display = 'inline-flex';
            badgeEl.className = `cockpit-card-badge ${data.badgeClass || ''}`;
            badgeEl.textContent = data.badge;
        } else {
            badgeEl.style.display = 'none';
        }

        // Rendu du mini-graphique
        this._renderSheetChart(tileKey, 'current');

        const rowsEl = document.getElementById('ovSheetRows');
        if (data.rows && data.rows.length > 0) {
            rowsEl.style.display = 'flex';
            rowsEl.innerHTML = data.rows.map(r => `
                <div class="cockpit-info-sheet-row">
                    <span class="cockpit-info-sheet-row-label">${r.label}</span>
                    <span class="cockpit-info-sheet-row-value privacy-blur ${r.valueClass || ''}">${r.value}</span>
                </div>
            `).join('');
        } else {
            rowsEl.style.display = 'none';
        }

        const textEl = document.getElementById('ovSheetText');
        if (data.text) {
            textEl.style.display = 'block';
            textEl.textContent = data.text;
        } else {
            textEl.style.display = 'none';
        }

        const secBtn = document.getElementById('ovSheetSecondaryBtn');
        if (secBtn) {
            if (data.onActionClick && data.actionBtnText) {
                secBtn.style.display = 'flex';
                secBtn.textContent = `${data.actionBtnText} ➔`;
                secBtn.onclick = () => {
                    this.closeInfoSheet();
                    data.onActionClick();
                };
            } else {
                secBtn.style.display = 'none';
                secBtn.onclick = null;
            }
        }

        const actionBtn = document.getElementById('ovSheetActionBtn');
        if (actionBtn) {
            actionBtn.textContent = t('cockpit_sheet_close', 'Compris');
            actionBtn.onclick = () => this.closeInfoSheet();
        }

        requestAnimationFrame(() => {
            overlay.classList.add('active');
        });
    },

    closeInfoSheet() {
        if (this._infoSheetChart) {
            this._infoSheetChart.destroy();
            this._infoSheetChart = null;
        }
        const overlay = document.getElementById('ovCockpitInfoSheetOverlay');
        if (overlay) {
            overlay.classList.remove('active');
        }
    },

    _renderSheetChart(tileKey, period = 'current') {
        const chartSection = document.getElementById('ovSheetChartSection');
        const canvas = document.getElementById('ovSheetChartCanvas');
        if (!chartSection || !canvas || typeof Chart === 'undefined') return;

        if (this._infoSheetChart) {
            this._infoSheetChart.destroy();
            this._infoSheetChart = null;
        }

        const t = (k, fb) => (window.i18n ? window.i18n.t(k) : null) || fb;
        const isOrgMode = window.app?.config?.enable_org_mode === 'true' || window.app?.config?.enable_org_mode === true;
        const isPrivate = document.body.classList.contains('privacy-mode');
        const isForecastNextMonth = tileKey && tileKey.startsWith('next_month_');
        const periodGroup = document.getElementById('ovSheetPeriodGroup');

        // ── CAS PARTICULIER : CAP SUR LE MOIS PROCHAIN (next_month_*) ──────────
        if (isForecastNextMonth) {
            if (periodGroup) {
                periodGroup.innerHTML = '';
            }

            const today = new Date();
            const curY = today.getFullYear();
            const curM = today.getMonth(); // 0-11
            const monthNames = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

            // 6 barres : 4 mois passés + mois en cours + mois prochain (prévisionnel)
            const monthList = [];
            for (let offset = -4; offset <= 1; offset++) {
                const targetD = new Date(curY, curM + offset, 1);
                const yyyy = targetD.getFullYear();
                const mm = String(targetD.getMonth() + 1).padStart(2, '0');
                const mKey = `${yyyy}-${mm}`;
                const isNext = offset === 1;
                const isCurrent = offset === 0;
                let label = `${monthNames[targetD.getMonth()]} ${yyyy !== curY ? yyyy : ''}`.trim();
                if (isNext) label += ` (${t('cockpit_chart_legend_projected', 'Prévu')})`;
                else if (isCurrent) label += ` (${t('cockpit_chart_period_current', 'En cours')})`;

                monthList.push({ key: mKey, label, isNext, isCurrent });
            }

            // Agrégation des transactions par mois
            const monthIncome = {};
            const monthFixed = {};
            const monthVar = {};

            const accIdStr = this._selectedAccountId ? String(this._selectedAccountId) : null;
            for (const tx of (this._transactions || [])) {
                if (tx.is_skipped) continue;
                if (tx.cross_profile_status === 'pending') continue;
                if (!tx.date_operation) continue;

                let isIncome = false;
                let isExpense = false;

                if (accIdStr) {
                    const isFrom = String(tx.from_account_id) === accIdStr;
                    const isTo = String(tx.to_account_id) === accIdStr;
                    if (!isFrom && !isTo) continue;
                    isIncome = isTo && !isFrom;
                    isExpense = isFrom && !isTo;
                } else {
                    if (tx.from_account_id && tx.to_account_id) continue;
                    const typeStr = String(tx.type || '');
                    if (typeStr === 'income' || (tx.to_account_id && !tx.from_account_id)) {
                        isIncome = true;
                    } else if (typeStr.startsWith('expense') || (tx.from_account_id && !tx.to_account_id)) {
                        isExpense = true;
                    }
                }

                if (!isIncome && !isExpense) {
                    const typeStr = String(tx.type || '');
                    if (typeStr === 'income') isIncome = true;
                    else if (typeStr.startsWith('expense')) isExpense = true;
                }

                const mKey = String(tx.date_operation).substring(0, 7);
                const amt = Math.abs(parseFloat(tx.amount) || 0);
                const typeStr = String(tx.type || '');
                const isFixed = typeStr === 'expense_fixed' || tx.is_monthly || tx.is_yearly || !!tx.recurrence_id;
                const isVar = isExpense && (typeStr === 'expense_var' || !isFixed);

                if (isIncome) {
                    monthIncome[mKey] = (monthIncome[mKey] || 0) + amt;
                } else if (isExpense) {
                    if (isFixed) monthFixed[mKey] = (monthFixed[mKey] || 0) + amt;
                    if (isVar) monthVar[mKey] = (monthVar[mKey] || 0) + amt;
                }
            }

            // Si un salaire ou revenu récurrent est attendu d'ici la fin du mois en cours et n'est pas encore versé,
            // l'intégrer au revenu du mois en cours pour éviter un déficit artificiel (le salaire n'étant pas une transaction passée).
            const curMonthKey = `${curY}-${String(curM + 1).padStart(2, '0')}`;
            const todayISO = `${curY}-${String(curM + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const forecast = this._forecastSummary || {};
            const nextPayDate = this._stats?.next_pay_date || forecast.cycle_forecast?.next_pay_date;
            const nextPayAmount = Number(this._stats?.next_pay_amount || forecast.cycle_forecast?.projected_income || 0);
            const mainAccIdStr = String(this._stats?.main_account_id || '1');

            if (!accIdStr || accIdStr === mainAccIdStr) {
                if (nextPayDate && nextPayAmount > 0 && nextPayDate.startsWith(curMonthKey) && nextPayDate >= todayISO) {
                    monthIncome[curMonthKey] = (monthIncome[curMonthKey] || 0) + nextPayAmount;
                }
            }

            // Données prévisionnelles du mois prochain (extraites de _forecastSummary ou fallback _stats)
            const nm = forecast.next_month || forecast.trajectory_3m?.months?.[1] || forecast.cycle_forecast || this._stats?.next_month || {};
            const nmIncome = Number(nm.projected_income ?? nm.income ?? 0);
            const nmFixed = Number(nm.fixed_charges ?? nm.fixed_expense ?? 0);
            const nmVar = Number(nm.variable_expenses ?? nm.variable_expense ?? nm.variable_allocated ?? 0);
            const nmNet = Number(nm.projected_net ?? nm.net_savings ?? (nmIncome - nmFixed - nmVar));

            let chartTitle = '';
            let metricData = [];
            let bgColors = [];
            let borderColors = [];
            let datasetLabel = '';

            if (tileKey === 'next_month_income') {
                chartTitle = `📥 ${t('cockpit_forecast_sheet_income_title', 'Recettes prévues')} — ${t('cockpit_chart_history_and_forecast', 'Historique & Prévision')}`;
                datasetLabel = t('cockpit_forecast_sheet_income_title', 'Recettes');
                metricData = monthList.map(m => m.isNext ? nmIncome : (Math.round((monthIncome[m.key] || 0) * 100) / 100));
                bgColors = monthList.map(m => m.isNext ? 'rgba(16, 185, 129, 0.85)' : (m.isCurrent ? 'rgba(16, 185, 129, 0.55)' : 'rgba(16, 185, 129, 0.35)'));
                borderColors = monthList.map(m => m.isNext ? '#059669' : '#10b981');
            } else if (tileKey === 'next_month_fixed') {
                chartTitle = `📌 ${t('cockpit_forecast_sheet_fixed_title', 'Charges fixes prévues')} — ${t('cockpit_chart_history_and_forecast', 'Historique & Prévision')}`;
                datasetLabel = t('cockpit_forecast_sheet_fixed_title', 'Charges fixes');
                metricData = monthList.map(m => m.isNext ? nmFixed : (Math.round((monthFixed[m.key] || 0) * 100) / 100));
                bgColors = monthList.map(m => m.isNext ? 'rgba(99, 102, 241, 0.85)' : (m.isCurrent ? 'rgba(99, 102, 241, 0.55)' : 'rgba(99, 102, 241, 0.35)'));
                borderColors = monthList.map(m => m.isNext ? '#4f46e5' : '#6366f1');
            } else if (tileKey === 'next_month_variable') {
                chartTitle = `🛒 ${t('cockpit_forecast_sheet_variable_title', 'Dépenses variables estimées')} — ${t('cockpit_chart_history_and_forecast', 'Historique & Prévision')}`;
                datasetLabel = t('cockpit_forecast_sheet_variable_title', 'Dépenses variables');
                metricData = monthList.map(m => m.isNext ? nmVar : (Math.round((monthVar[m.key] || 0) * 100) / 100));
                bgColors = monthList.map(m => m.isNext ? 'rgba(245, 158, 11, 0.85)' : (m.isCurrent ? 'rgba(245, 158, 11, 0.55)' : 'rgba(245, 158, 11, 0.35)'));
                borderColors = monthList.map(m => m.isNext ? '#d97706' : '#f59e0b');
            } else {
                // next_month_remaining
                chartTitle = `💰 ${t('cockpit_forecast_sheet_remaining_title', 'Reste à vivre estimé')} — ${t('cockpit_chart_history_and_forecast', 'Historique & Prévision')}`;
                datasetLabel = t('cockpit_forecast_sheet_remaining_title', 'Marge nette');
                metricData = monthList.map(m => {
                    if (m.isNext) return nmNet;
                    const inc = monthIncome[m.key] || 0;
                    const exp = (monthFixed[m.key] || 0) + (monthVar[m.key] || 0);
                    return Math.round((inc - exp) * 100) / 100;
                });
                bgColors = metricData.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)');
                borderColors = metricData.map(v => v >= 0 ? '#10b981' : '#ef4444');
            }

            document.getElementById('ovSheetChartTitle').textContent = chartTitle;
            chartSection.style.display = 'flex';

            this._infoSheetChart = new Chart(canvas, {
                type: 'bar',
                data: {
                    labels: monthList.map(m => m.label),
                    datasets: [{
                        label: datasetLabel,
                        data: metricData,
                        backgroundColor: bgColors,
                        borderColor: borderColors,
                        borderWidth: 1.5,
                        borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: { duration: 300 },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            borderColor: 'rgba(255, 255, 255, 0.1)',
                            borderWidth: 1,
                            padding: 8,
                            titleFont: { size: 11, weight: '700' },
                            bodyFont: { size: 11 },
                            callbacks: {
                                label: (ctx) => {
                                    const val = ctx.raw;
                                    if (val === null || val === undefined) return '';
                                    return `${datasetLabel}: ${isPrivate ? '•••• €' : formatCurrency(val)}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(128, 128, 128, 0.08)' },
                            ticks: {
                                color: 'rgba(148, 163, 184, 0.7)',
                                font: { size: 9 },
                                callback: (v) => isPrivate ? '••••' : formatCurrency(v)
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: {
                                color: 'rgba(148, 163, 184, 0.8)',
                                font: { size: 9.5, weight: '500' }
                            }
                        }
                    }
                }
            });
            return;
        }

        // Périodes configurables selon le mode
        const periods = isOrgMode ? [
            { key: 'current', label: t('cockpit_chart_period_month', 'Mois en cours') },
            { key: 'quarter', label: t('cockpit_chart_period_quarter', 'Trimestre') },
            { key: 'year', label: t('cockpit_chart_period_year', 'Exercice') },
            { key: '3m', label: t('cockpit_chart_period_3m', '3 mois') }
        ] : [
            { key: 'current', label: (this._stats?.next_pay_date ? t('cockpit_chart_period_current', 'Période en cours') : t('cockpit_chart_period_month', 'Ce mois')) },
            { key: '30d', label: t('cockpit_chart_period_30d', '30 jours') },
            { key: '3m', label: t('cockpit_chart_period_3m', '3 mois') }
        ];

        if (periodGroup) {
            periodGroup.innerHTML = periods.map(p => `
                <button type="button" class="cockpit-sheet-period-btn ${p.key === period ? 'active' : ''}" data-period="${p.key}">
                    ${p.label}
                </button>
            `).join('');
            periodGroup.querySelectorAll('.cockpit-sheet-period-btn').forEach(btn => {
                btn.onclick = (e) => {
                    e.stopPropagation();
                    const targetPeriod = btn.getAttribute('data-period');
                    this._renderSheetChart(tileKey, targetPeriod);
                };
            });
        }

        // Calcul des dates début et fin
        const today = new Date();
        const todayISO = this._getTodayISO(today);
        let startDate, endDate;

        if (period === 'current') {
            if (this._stats?.next_pay_date && !isOrgMode) {
                endDate = new Date(this._stats.next_pay_date);
                let prevPayDateStr = null;
                if (Array.isArray(this._stats.pay_history)) {
                    for (const p of this._stats.pay_history) {
                        if (p.date && p.date < this._stats.next_pay_date && p.date <= todayISO) {
                            prevPayDateStr = p.date;
                            break;
                        }
                    }
                }
                if (prevPayDateStr) {
                    startDate = new Date(prevPayDateStr);
                } else {
                    startDate = new Date(endDate.getTime() - 30 * 86400000);
                }
            } else {
                startDate = new Date(today.getFullYear(), today.getMonth(), 1);
                endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            }
        } else if (period === '30d') {
            startDate = new Date(today.getTime() - 30 * 86400000);
            endDate = new Date(today);
        } else if (period === 'quarter') {
            const qMonth = Math.floor(today.getMonth() / 3) * 3;
            startDate = new Date(today.getFullYear(), qMonth, 1);
            endDate = new Date(today.getFullYear(), qMonth + 3, 0);
        } else if (period === 'year') {
            startDate = new Date(today.getFullYear(), 0, 1);
            endDate = new Date(today.getFullYear(), 11, 31);
        } else if (period === '3m') {
            startDate = new Date(today.getTime() - 90 * 86400000);
            endDate = new Date(today);
        } else {
            startDate = new Date(today.getTime() - 30 * 86400000);
            endDate = new Date(today);
        }

        // Génération du calendrier journalier
        const dateList = [];
        const cur = new Date(startDate);
        let guard = 0;
        const monthNames = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
        while (cur <= endDate && guard < 370) {
            guard++;
            const yyyy = cur.getFullYear();
            const mm = String(cur.getMonth() + 1).padStart(2, '0');
            const dd = String(cur.getDate()).padStart(2, '0');
            const iso = `${yyyy}-${mm}-${dd}`;
            const dLabel = `${cur.getDate()} ${monthNames[cur.getMonth()]}`;
            dateList.push({ iso, label: dLabel });
            cur.setDate(cur.getDate() + 1);
        }

        if (dateList.length === 0) {
            chartSection.style.display = 'none';
            return;
        }

        // Agrégation des opérations
        const dailyExpenses = {};
        const dailyVarExpenses = {};
        const dailyReconciled = {};
        const dailyIncome = {};

        for (const item of dateList) {
            dailyExpenses[item.iso] = 0;
            dailyVarExpenses[item.iso] = 0;
            dailyReconciled[item.iso] = 0;
            dailyIncome[item.iso] = 0;
        }

        const accIdStr = this._selectedAccountId ? String(this._selectedAccountId) : null;
        const mainAccIdStr = this._stats?.main_account_id ? String(this._stats.main_account_id) : accIdStr;
        const targetAccId = (tileKey === 'rav' || tileKey === 'projection' || tileKey === 'hero_overdraft') ? (accIdStr || mainAccIdStr) : accIdStr;

        for (const tx of (this._transactions || [])) {
            if (tx.is_skipped) continue;
            if (tx.cross_profile_status === 'pending') continue;
            if (!tx.date_operation) continue;
            const txDate = String(tx.date_operation).substring(0, 10);
            if (dailyExpenses[txDate] === undefined) continue;

            let isIncoming = false;
            let isOutgoing = false;

            if (targetAccId) {
                const isFrom = String(tx.from_account_id) === targetAccId;
                const isTo = String(tx.to_account_id) === targetAccId;
                if (!isFrom && !isTo) continue;
                isIncoming = isTo && !isFrom;
                isOutgoing = isFrom && !isTo;
            } else {
                if (tx.from_account_id && tx.to_account_id) continue;
                const typeStr = String(tx.type || '');
                if (typeStr === 'income' || (tx.to_account_id && !tx.from_account_id)) {
                    isIncoming = true;
                } else if (typeStr.startsWith('expense') || (tx.from_account_id && !tx.to_account_id)) {
                    isOutgoing = true;
                }
            }

            if (!isIncoming && !isOutgoing) {
                const typeStr = String(tx.type || '');
                if (typeStr === 'income') isIncoming = true;
                else isOutgoing = true;
            }

            const amt = Math.abs(parseFloat(tx.amount) || 0);
            const typeStr = String(tx.type || '');
            const isFixed = typeStr === 'expense_fixed' || tx.is_monthly || tx.is_yearly || !!tx.recurrence_id;
            const isVar = isOutgoing && (typeStr === 'expense_var' || !isFixed);

            if (isIncoming) {
                dailyIncome[txDate] += amt;
            } else if (isOutgoing) {
                dailyExpenses[txDate] += amt;
                if (isVar) dailyVarExpenses[txDate] += amt;
                if (tx.reconciliation_date) dailyReconciled[txDate] += amt;
            }
        }

        // Configuration selon la carte (tileKey)
        let chartTitle = '📈 Tendance';
        let datasets = [];
        let chartType = 'line';

        const ctx = canvas.getContext('2d');
        const primaryGradient = ctx.createLinearGradient(0, 0, 0, 150);
        primaryGradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
        primaryGradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

        const greenGradient = ctx.createLinearGradient(0, 0, 0, 150);
        greenGradient.addColorStop(0, 'rgba(16, 185, 129, 0.35)');
        greenGradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

        if (tileKey === 'cadence') {
            chartType = 'bar';
            chartTitle = `⏱️ ${t('cockpit_chart_title_cadence', 'Rythme des dépenses')} (€/j)`;
            const dailyRef = this._cockpitGaugeContext?.dailyRef || this._stats?.daily_ref || 50;

            datasets = [
                {
                    type: 'bar',
                    label: t('cockpit_chart_legend_daily_spent', 'Dépenses du jour'),
                    data: dateList.map(item => item.iso <= todayISO ? (isOrgMode ? dailyExpenses[item.iso] : dailyVarExpenses[item.iso]) : null),
                    backgroundColor: 'rgba(99, 102, 241, 0.5)',
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 4
                },
                {
                    type: 'line',
                    label: `${t('cockpit_chart_legend_daily_ref', 'Rythme cible')} (${formatCurrency(dailyRef)}/j)`,
                    data: dateList.map(() => dailyRef),
                    borderColor: '#f59e0b',
                    borderDash: [5, 4],
                    pointRadius: 0,
                    borderWidth: 2,
                    fill: false
                }
            ];
        } else if (tileKey === 'rav') {
            chartTitle = isOrgMode
                ? `🏦 ${t('cockpit_chart_title_treasury', 'Trajectoire de trésorerie')}`
                : `💰 ${t('cockpit_chart_title_rav', 'Trajectoire du reste à vivre')}`;

            if (!isOrgMode) {
                // ── Reconstitution dynamique au fil de l'eau du Reste à vivre ──
                const currentRav = (this._stats?.rest_to_live !== undefined)
                    ? Number(this._stats.rest_to_live)
                    : (this._cockpitGaugeContext?.ravAmount || 0);

                const ravSeries = new Array(dateList.length).fill(null);
                const todayIdx = dateList.findIndex(item => item.iso === todayISO);
                const effectiveTodayIdx = todayIdx >= 0 ? todayIdx : (dateList[dateList.length - 1].iso < todayISO ? dateList.length - 1 : 0);

                let runningRav = currentRav;
                ravSeries[effectiveTodayIdx] = Math.round(runningRav * 100) / 100;

                // Remontée chronologique vers le passé
                for (let i = effectiveTodayIdx; i > 0; i--) {
                    const curItem = dateList[i];
                    runningRav = runningRav + (dailyVarExpenses[curItem.iso] || 0) - (dailyIncome[curItem.iso] || 0);
                    ravSeries[i - 1] = Math.round(runningRav * 100) / 100;
                }

                datasets = [
                    {
                        type: 'line',
                        label: t('cockpit_chart_title_rav', 'Reste à vivre disponible'),
                        data: ravSeries,
                        borderColor: '#10b981',
                        backgroundColor: greenGradient,
                        fill: true,
                        tension: 0.2,
                        pointRadius: dateList.length <= 31 ? 2.5 : 0,
                        pointHoverRadius: 5
                    },
                    {
                        type: 'line',
                        label: 'Seuil 0 €',
                        data: dateList.map(() => 0),
                        borderColor: 'rgba(239, 68, 68, 0.45)',
                        borderDash: [4, 4],
                        borderWidth: 1.5,
                        pointRadius: 0,
                        fill: false
                    }
                ];
            } else {
                // Mode Organisation : cumul trésorerie
                let runningBalance = (this._stats?.total_balance || 0);
                let deltaAfter = 0;
                for (const item of dateList) {
                    if (item.iso <= todayISO) {
                        deltaAfter += ((dailyIncome[item.iso] || 0) - (dailyExpenses[item.iso] || 0));
                    }
                }
                let balance = runningBalance - deltaAfter;
                const series = [];
                for (const item of dateList) {
                    if (item.iso <= todayISO) {
                        balance += ((dailyIncome[item.iso] || 0) - (dailyExpenses[item.iso] || 0));
                        series.push(Math.round(balance * 100) / 100);
                    } else {
                        series.push(null);
                    }
                }

                datasets = [
                    {
                        type: 'line',
                        label: t('cockpit_org_sheet_treasury_title', 'Trésorerie nette'),
                        data: series,
                        borderColor: '#6366f1',
                        backgroundColor: primaryGradient,
                        fill: true,
                        tension: 0.25,
                        pointRadius: dateList.length <= 31 ? 2 : 0
                    }
                ];
            }
        } else if (tileKey === 'expenses') {
            chartTitle = isOrgMode
                ? `📊 ${t('cockpit_chart_title_budget', 'Exécution budgétaire')}`
                : `💳 ${t('cockpit_chart_title_expenses', 'Cumul des dépenses')}`;

            let runningSum = 0;
            const cumSeries = [];
            for (const item of dateList) {
                if (item.iso <= todayISO) {
                    runningSum += (dailyReconciled[item.iso] || 0);
                    cumSeries.push(Math.round(runningSum * 100) / 100);
                } else {
                    cumSeries.push(null);
                }
            }

            const totalLimit = isOrgMode
                ? (this._cockpitGaugeContext?.orgBudgetTarget || this._stats?.budget_target || 0)
                : (this._cockpitGaugeContext?.totalCycleExpenses || this._stats?.total_cycle_expenses || (runningSum * 1.2));

            datasets = [
                {
                    type: 'line',
                    label: t('cockpit_chart_legend_cumulative', 'Dépenses cumulées'),
                    data: cumSeries,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.2)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: dateList.length <= 31 ? 2 : 0
                }
            ];

            if (totalLimit > 0) {
                datasets.push({
                    type: 'line',
                    label: t('cockpit_chart_legend_budget_ceiling', 'Plafond prévu'),
                    data: dateList.map(() => totalLimit),
                    borderColor: 'rgba(148, 163, 184, 0.7)',
                    borderDash: [5, 4],
                    pointRadius: 0,
                    borderWidth: 1.5,
                    fill: false
                });
            }
        } else if (tileKey === 'projection' || tileKey === 'hero_overdraft') {
            chartTitle = `🔮 ${t('cockpit_chart_title_projection', 'Solde bancaire prévisionnel')}`;

            const currentBal = (targetAccId && this._accountsMap?.[targetAccId])
                ? Number(this._accountsMap[targetAccId].balance || 0)
                : Number(this._stats?.total_balance || 0);

            let sumTxUntilToday = 0;
            for (const item of dateList) {
                if (item.iso <= todayISO) {
                    sumTxUntilToday += ((dailyIncome[item.iso] || 0) - (dailyExpenses[item.iso] || 0));
                }
            }

            let balPast = currentBal - sumTxUntilToday;
            const realBalSeries = [];
            const projectedBalSeries = [];

            for (const item of dateList) {
                if (item.iso < todayISO) {
                    balPast += ((dailyIncome[item.iso] || 0) - (dailyExpenses[item.iso] || 0));
                    realBalSeries.push(Math.round(balPast * 100) / 100);
                    projectedBalSeries.push(null);
                } else if (item.iso === todayISO) {
                    realBalSeries.push(Math.round(currentBal * 100) / 100);
                    projectedBalSeries.push(Math.round(currentBal * 100) / 100);
                } else {
                    realBalSeries.push(null);
                    projectedBalSeries.push(null);
                }
            }

            // Calcul des opérations futures prévues d'ici la fin de la période
            const futureDailyIncome = {};
            const futureDailyExpenses = {};
            for (const item of dateList) {
                if (item.iso > todayISO) {
                    futureDailyIncome[item.iso] = 0;
                    futureDailyExpenses[item.iso] = 0;
                }
            }

            for (const tx of (this._transactions || [])) {
                if (tx.reconciliation_date) continue;
                if (tx.is_skipped) continue;
                if (tx.cross_profile_status === 'pending') continue;
                if (!tx.date_operation) continue;
                const txDate = String(tx.date_operation).substring(0, 10);
                if (txDate <= todayISO || futureDailyIncome[txDate] === undefined) continue;

                const amt = Math.abs(parseFloat(tx.amount) || 0);

                // En cycle de paye : on projette jusqu'au jour de paye en excluant le nouveau salaire
                if (period === 'current' && this._stats?.next_pay_date && !isOrgMode) {
                    const cutoffDate = this._stats.next_pay_date;
                    if (txDate > cutoffDate) continue;
                    if (txDate === cutoffDate && (tx.is_salary || (tx.type === 'income' && amt >= 1000))) continue;
                }

                let isInc = false;
                let isExp = false;

                if (targetAccId) {
                    const isFrom = String(tx.from_account_id) === targetAccId;
                    const isTo = String(tx.to_account_id) === targetAccId;
                    if (!isFrom && !isTo) continue;
                    isInc = isTo && !isFrom;
                    isExp = isFrom && !isTo;
                } else {
                    if (tx.from_account_id && tx.to_account_id) continue;
                    const typeStr = String(tx.type || '');
                    if (typeStr === 'income' || (tx.to_account_id && !tx.from_account_id)) {
                        isInc = true;
                    } else if (typeStr.startsWith('expense') || (tx.from_account_id && !tx.to_account_id)) {
                        isExp = true;
                    }
                }

                if (!isInc && !isExp) {
                    const typeStr = String(tx.type || '');
                    if (typeStr === 'income') isInc = true;
                    else isExp = true;
                }

                if (isInc) futureDailyIncome[txDate] += amt;
                else if (isExp) futureDailyExpenses[txDate] += amt;
            }

            let runningFutureBal = currentBal;
            for (let i = 0; i < dateList.length; i++) {
                const item = dateList[i];
                if (item.iso > todayISO) {
                    runningFutureBal += ((futureDailyIncome[item.iso] || 0) - (futureDailyExpenses[item.iso] || 0));
                    projectedBalSeries[i] = Math.round(runningFutureBal * 100) / 100;
                }
            }

            datasets = [
                {
                    type: 'line',
                    label: t('cockpit_chart_legend_real_balance', 'Solde réel constaté'),
                    data: realBalSeries,
                    borderColor: '#3b82f6',
                    backgroundColor: primaryGradient,
                    fill: true,
                    tension: 0.25,
                    pointRadius: dateList.length <= 31 ? 2.5 : 0,
                    pointHoverRadius: 5
                },
                {
                    type: 'line',
                    label: t('cockpit_chart_legend_projected_balance', 'Projection fin de cycle'),
                    data: projectedBalSeries,
                    borderColor: '#8b5cf6',
                    borderDash: [5, 4],
                    borderWidth: 2,
                    pointRadius: dateList.length <= 31 ? 2.5 : 0,
                    fill: false,
                    tension: 0.25
                },
                {
                    type: 'line',
                    label: 'Seuil 0 €',
                    data: dateList.map(() => 0),
                    borderColor: 'rgba(239, 68, 68, 0.45)',
                    borderDash: [4, 4],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    fill: false
                }
            ];
        } else {
            // Autres cartes secondaires : solde réel simple
            chartTitle = `🔮 ${t('cockpit_chart_title_projection', 'Solde bancaire')}`;
            let currentBal = this._stats?.total_balance || 0;
            let sumTx = 0;
            for (const item of dateList) {
                if (item.iso <= todayISO) sumTx += ((dailyIncome[item.iso] || 0) - (dailyExpenses[item.iso] || 0));
            }
            let bal = currentBal - sumTx;
            const balSeries = [];
            for (const item of dateList) {
                if (item.iso <= todayISO) {
                    bal += ((dailyIncome[item.iso] || 0) - (dailyExpenses[item.iso] || 0));
                    balSeries.push(Math.round(bal * 100) / 100);
                } else {
                    balSeries.push(null);
                }
            }

            datasets = [
                {
                    type: 'line',
                    label: t('cockpit_chart_title_projection', 'Solde bancaire'),
                    data: balSeries,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                    fill: true,
                    tension: 0.3,
                    pointRadius: dateList.length <= 31 ? 2 : 0
                }
            ];
        }

        // Affichage du titre et de la section
        document.getElementById('ovSheetChartTitle').textContent = chartTitle;
        chartSection.style.display = 'flex';

        // Création de l'instance Chart.js
        this._infoSheetChart = new Chart(canvas, {
            type: chartType,
            data: {
                labels: dateList.map(item => item.label),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 300 },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: datasets.length > 1,
                        position: 'top',
                        labels: {
                            boxWidth: 8,
                            boxHeight: 8,
                            color: 'rgba(148, 163, 184, 0.85)',
                            font: { size: 10, weight: '600' }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 8,
                        titleFont: { size: 11, weight: '700' },
                        bodyFont: { size: 11 },
                        callbacks: {
                            label: (context) => {
                                const val = context.raw;
                                if (val === null || val === undefined) return '';
                                const formatted = isPrivate ? '•••• €' : formatCurrency(val);
                                return `${context.dataset.label || ''}: ${formatted}`;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: tileKey === 'cadence',
                        grid: { color: 'rgba(128, 128, 128, 0.08)' },
                        ticks: {
                            color: 'rgba(148, 163, 184, 0.7)',
                            font: { size: 9 },
                            callback: (v) => isPrivate ? '••••' : formatCurrency(v)
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: 'rgba(148, 163, 184, 0.8)',
                            font: { size: 9.5, weight: '500' },
                            maxRotation: 0,
                            autoSkip: true,
                            maxTicksLimit: 6
                        }
                    }
                }
            }
        });
    },

        openSimulatorInCockpitMode() {
        if (typeof ProfileStorage !== 'undefined') {
            ProfileStorage.set('sim_mode', 'recommended');
            ProfileStorage.set('sim_conservative_weight', '1.0');
            ProfileStorage.set('sim_income_mode', 'auto');
            ProfileStorage.set('sim_var_expense_adj', '0.0');
            ProfileStorage.set('sim_inflation_rate', '0.0');
            ProfileStorage.set('sim_seasonality_mode', 'disabled');
            if (this._selectedAccountId) {
                ProfileStorage.set('sim_account', this._selectedAccountId);
            }
        }
        if (window.app && window.app.loadView) {
            window.app.loadView('simulator');
        }
    },

    async enableAndOpenSimulator() {
        const t = (key, fallback) => {
            const val = window.i18n.t(key);
            return (val && val !== key) ? val : fallback;
        };
        const title = t('title_confirmation', 'Confirmation');
        const message = t('cockpit_forecast_confirm_enable_sim_msg', 'Le simulateur de scénarios What-If est actuellement désactivé. Voulez-vous l\'activer et y accéder ?');

        const confirmed = await showInlineConfirm(title, message);
        if (!confirmed) return;

        try {
            await this.saveConfig({ enable_simulator: 'true' });
            if (window.app) {
                window.app.config = { ...window.app.config, enable_simulator: 'true' };
                if (window.app.updateNavToggles) {
                    window.app.updateNavToggles();
                } else {
                    document.querySelectorAll('.nav-btn[data-view="simulator"]').forEach(btn => {
                        btn.style.display = '';
                        btn.classList.remove('is-hidden');
                    });
                }
                if (window.app.refreshSidebar) window.app.refreshSidebar();
            }
            if (typeof showToast === 'function') {
                showToast(t('cockpit_forecast_sim_enabled_toast', 'Simulateur activé avec succès'), 'success');
            }
            window.app.loadView('simulator');
        } catch (err) {
            console.error('[OverviewView] Erreur activation simulateur:', err);
            if (typeof showToast === 'function') {
                showToast(t('cockpit_forecast_sim_enable_error', 'Erreur lors de l\'activation du simulateur'), 'error');
            }
        }
    },

    destroy() {
        this.closeInfoSheet();
    }
};
