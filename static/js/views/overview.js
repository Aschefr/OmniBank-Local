// overview.js — Vue d'ensemble (Overview) — Vue simplifiée & premium plein écran
window.OverviewView = {
    _chart: null,
    _unreconciledTxs: [],
    _searchQuery: '',
    _selectedAccountId: '',
    _activeTab: 'all', // 'all', 'overdue', 'expenses', 'income'
    _horizon: 'cycle', // 'cycle' (jusqu'à la paye / fin de mois) ou 'all' (toutes les futures)
    _trendMode: 'expenses', // 'expenses', 'compare', 'balance'
    _top6Filter: 'all', // 'all', 'fixed', 'var'
    _statsGranularity: 'month', // 'month', 'week', 'day', 'hour'
    _statsLookback: '6m', // 'all', '12m', '6m', '3m', '1m', '1w'
    _displayMode: 'cockpit', // 'cockpit' (simplifié) ou 'full' (tableau de bord complet)
    _cachedMonthlyAverages: { income: 0, fixed: 0, variable: 0 },
    _stats: null,
    _accounts: [],
    _transactions: [],
    _accountsMap: {},
    _pastOverdueTxs: [],
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
            const savedTop6 = window.ProfileStorage.get('overview_top6_filter');
            if (savedTop6) this._top6Filter = savedTop6;
            const savedHorizon = window.ProfileStorage.get('overview_horizon');
            if (savedHorizon) this._horizon = savedHorizon;
            const savedGranularity = window.ProfileStorage.get('overview_stats_granularity');
            if (savedGranularity) this._statsGranularity = savedGranularity;
            const savedLookback = window.ProfileStorage.get('overview_stats_lookback');
            if (savedLookback) this._statsLookback = savedLookback;
            const savedTrend = window.ProfileStorage.get('overview_trend_mode');
            if (savedTrend) this._trendMode = savedTrend;
            const savedDisplayMode = window.ProfileStorage.get('overview_display_mode');
            if (savedDisplayMode) this._displayMode = savedDisplayMode;
        }
        if (window.app?.config) {
            if ((this._selectedAccountId === '' || this._selectedAccountId === null || this._selectedAccountId === undefined) &&
                window.app.config.overview_account_id !== undefined &&
                (!window.ProfileStorage || window.ProfileStorage.get('overview_account_id') === null)) {
                this._selectedAccountId = window.app.config.overview_account_id;
            }
            if (window.app.config.overview_top6_filter) this._top6Filter = window.app.config.overview_top6_filter;
            if (window.app.config.overview_horizon) this._horizon = window.app.config.overview_horizon;
            if (window.app.config.overview_stats_granularity) this._statsGranularity = window.app.config.overview_stats_granularity;
            if (window.app.config.overview_stats_lookback) this._statsLookback = window.app.config.overview_stats_lookback;
            if (window.app.config.overview_trend_mode) this._trendMode = window.app.config.overview_trend_mode;
            if (window.app.config.overview_display_mode) this._displayMode = window.app.config.overview_display_mode;
        }

        return `
            <div id="overviewRoot" class="overview-root ${this._displayMode === 'cockpit' ? 'cockpit-active' : ''}">
                <!-- Header / Health Badge, Account Selector & Quick Actions -->
                <div class="overview-top-bar">
                    <div class="overview-header-main">
                        <div class="overview-title-group">
                            <h2 class="overview-main-title">👀 <span data-i18n="nav_overview">${window.i18n.t('nav_overview')}</span></h2>
                            <div id="ovOrgTag" class="overview-org-tag" style="display:none;">🏢 <span data-i18n="overview_org_badge">${window.i18n.t('overview_org_badge') || 'Mode Organisation'}</span></div>
                            <div id="ovHealthBadge" class="overview-health-badge">—</div>
                        </div>
                        <div class="overview-mode-toggle" id="ovModeToggle">
                            <button class="overview-mode-btn ${this._displayMode === 'cockpit' ? 'active' : ''}" onclick="window.OverviewView.setDisplayMode('cockpit')" data-i18n-title="overview_mode_cockpit_tooltip" title="${window.i18n.t('overview_mode_cockpit_tooltip') || 'Vue simplifiée avec jauges visuelles'}">
                                🎛️ <span data-i18n="overview_mode_cockpit">${window.i18n.t('overview_mode_cockpit') || 'Cockpit'}</span>
                            </button>
                            <button class="overview-mode-btn ${this._displayMode === 'full' ? 'active' : ''}" onclick="window.OverviewView.setDisplayMode('full')" data-i18n-title="overview_mode_full_tooltip" title="${window.i18n.t('overview_mode_full_tooltip') || 'Tableau de bord complet avec toutes les sections'}">
                                📊 <span data-i18n="overview_mode_full">${window.i18n.t('overview_mode_full') || 'Complet'}</span>
                            </button>
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

                <!-- Section 1: Hero KPI Cards -->
                <div class="overview-hero">
                    <div class="overview-hero-card overview-hero-networth">
                        <div class="overview-hero-icon">🏦</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" id="ovNetWorthLabel" data-i18n="overview_net_worth">${window.i18n.t('overview_net_worth')}</div>
                            <div class="overview-hero-value privacy-blur" id="ovNetWorth">—</div>
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-rav">
                        <div class="overview-hero-icon">💡</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" id="ovRestToLiveLabel" data-i18n="overview_rest_to_live">${window.i18n.t('overview_rest_to_live')}</div>
                            <div class="overview-hero-value privacy-blur" id="ovRestToLive">—</div>
                            <div class="overview-hero-sub privacy-blur" id="ovRestToLiveSub" style="display:none;"></div>
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-projection">
                        <div class="overview-hero-icon">🔮</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" id="ovProjectionLabel" data-i18n="overview_projection_title">${window.i18n.t('overview_projection_title') || 'Projection Fin de Mois'}</div>
                            <div class="overview-hero-value privacy-blur" id="ovProjectionAmount">—</div>
                            <div class="overview-hero-sub" id="ovProjectionSub">${window.i18n.t('overview_projection_sub') || 'Solde estimé en fin de mois'}</div>
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-pay" id="ovPayCard" style="display:none;">
                        <div class="overview-hero-icon">📅</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" data-i18n="overview_next_pay">${window.i18n.t('overview_next_pay')}</div>
                            <div class="overview-hero-value privacy-blur" id="ovNextPayAmount">—</div>
                            <div class="overview-hero-sub" id="ovNextPayDate"></div>
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-orguser" id="ovOrgUserCard" style="display:none;">
                        <div class="overview-hero-icon">👤</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" data-i18n="overview_org_active_user">${window.i18n.t('overview_org_active_user') || 'Membre Actif'}</div>
                            <div class="overview-hero-value" id="ovOrgUserName">—</div>
                            <button class="overview-hero-switch-btn" onclick="window.OverviewView.openUserPicker()">
                                🔄 <span data-i18n="overview_org_switch_user">${window.i18n.t('overview_org_switch_user') || 'Changer'}</span>
                            </button>
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-overdraft clickable" id="ovOverdraftCard" style="display:none; cursor: pointer;" onclick="window.OverviewView.showCockpitTileInfo('hero_overdraft')">
                        <div class="overview-hero-icon" id="ovOverdraftIcon">⚠️</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" id="ovOverdraftLabel" data-i18n="overview_overdraft_risk">${window.i18n.t('overview_overdraft_risk')}</div>
                            <div class="overview-hero-value privacy-blur text-red" id="ovOverdraftAmount">—</div>
                            <div class="overview-hero-sub privacy-blur" id="ovOverdraftDate"></div>
                        </div>
                    </div>
                </div>

                <!-- Section: Sober & Discreet Real-Time Financial Rhythm Badges -->
                <div class="overview-rhythm-strip" id="ovRhythmStrip">
                    <div class="overview-rhythm-header">
                        <div class="overview-rhythm-title">
                            <span class="overview-rhythm-icon">⏱️</span>
                            <span class="overview-rhythm-label" data-i18n="overview_rhythm_title">${window.i18n.t('overview_rhythm_title') || 'Moyennes & Rythme'}</span>
                        </div>
                        <div class="overview-rhythm-controls">
                            <!-- Sélecteur de période analysée (lookback) -->
                            <div class="overview-rhythm-control-group">
                                <span class="overview-control-label" data-i18n="overview_lookback_label">${window.i18n.t('overview_lookback_label') || 'Période :'}</span>
                                <div class="overview-rhythm-segmented" id="ovLookbackGroup">
                                    <button class="ov-seg-btn ${this._statsLookback === 'all' ? 'active' : ''}" onclick="window.OverviewView.setStatsLookback('all')" data-i18n="overview_lookback_all">${window.i18n.t('overview_lookback_all') || 'Tout'}</button>
                                    <button class="ov-seg-btn ${this._statsLookback === '12m' ? 'active' : ''}" onclick="window.OverviewView.setStatsLookback('12m')" data-i18n="overview_lookback_12m">${window.i18n.t('overview_lookback_12m') || '1 an'}</button>
                                    <button class="ov-seg-btn ${this._statsLookback === '6m' ? 'active' : ''}" onclick="window.OverviewView.setStatsLookback('6m')" data-i18n="overview_lookback_6m">${window.i18n.t('overview_lookback_6m') || '6m'}</button>
                                    <button class="ov-seg-btn ${this._statsLookback === '3m' ? 'active' : ''}" onclick="window.OverviewView.setStatsLookback('3m')" data-i18n="overview_lookback_3m">${window.i18n.t('overview_lookback_3m') || '3m'}</button>
                                    <button class="ov-seg-btn ${this._statsLookback === '1m' ? 'active' : ''}" onclick="window.OverviewView.setStatsLookback('1m')" data-i18n="overview_lookback_1m">${window.i18n.t('overview_lookback_1m') || '1m'}</button>
                                    <button class="ov-seg-btn ${this._statsLookback === '1w' ? 'active' : ''}" onclick="window.OverviewView.setStatsLookback('1w')" data-i18n="overview_lookback_1w">${window.i18n.t('overview_lookback_1w') || '1 sem.'}</button>
                                </div>
                            </div>
                            <!-- Sélecteur d'unité d'affichage (granularity) -->
                            <div class="overview-rhythm-control-group">
                                <span class="overview-control-label" data-i18n="overview_granularity_label">${window.i18n.t('overview_granularity_label') || 'Affichage :'}</span>
                                <div class="overview-rhythm-segmented" id="ovGranularityGroup">
                                    <button class="ov-seg-btn ${this._statsGranularity === 'month' ? 'active' : ''}" onclick="window.OverviewView.setStatsGranularity('month')" data-i18n="overview_granularity_month">${window.i18n.t('overview_granularity_month') || 'Mois'}</button>
                                    <button class="ov-seg-btn ${this._statsGranularity === 'week' ? 'active' : ''}" onclick="window.OverviewView.setStatsGranularity('week')" data-i18n="overview_granularity_week">${window.i18n.t('overview_granularity_week') || 'Semaine'}</button>
                                    <button class="ov-seg-btn ${this._statsGranularity === 'day' ? 'active' : ''}" onclick="window.OverviewView.setStatsGranularity('day')" data-i18n="overview_granularity_day">${window.i18n.t('overview_granularity_day') || 'Jour'}</button>
                                    <button class="ov-seg-btn ${this._statsGranularity === 'hour' ? 'active' : ''}" onclick="window.OverviewView.setStatsGranularity('hour')" data-i18n="overview_granularity_hour">${window.i18n.t('overview_granularity_hour') || 'Heure'}</button>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="overview-rhythm-badges">
                        <!-- Badge 1: Revenus -->
                        <div class="overview-rhythm-badge badge-income" data-i18n-title="overview_rhythm_income_tooltip" title="${window.i18n.t('overview_rhythm_income_tooltip') || 'Revenu moyen calculé sur les 6 derniers mois'}">
                            <div class="overview-badge-dot"></div>
                            <div class="overview-badge-info">
                                <span class="overview-badge-label" data-i18n="overview_rhythm_income">${window.i18n.t('overview_rhythm_income') || 'Revenus'}</span>
                                <div class="overview-badge-value-wrapper">
                                    <span class="overview-badge-value privacy-blur" id="ovRhythmIncome">—</span>
                                    <span class="overview-badge-unit" id="ovRhythmUnitIncome">/ mois</span>
                                </div>
                            </div>
                        </div>
                        <!-- Badge 2: Dépenses Fixes -->
                        <div class="overview-rhythm-badge badge-fixed" data-i18n-title="overview_rhythm_fixed_tooltip" title="${window.i18n.t('overview_rhythm_fixed_tooltip') || 'Dépenses fixes moyennes (loyer, abonnements, crédits...)'}">
                            <div class="overview-badge-dot"></div>
                            <div class="overview-badge-info">
                                <span class="overview-badge-label" data-i18n="overview_rhythm_fixed">${window.i18n.t('overview_rhythm_fixed') || 'Dépenses Fixes'}</span>
                                <div class="overview-badge-value-wrapper">
                                    <span class="overview-badge-value privacy-blur" id="ovRhythmFixed">—</span>
                                    <span class="overview-badge-unit" id="ovRhythmUnitFixed">/ mois</span>
                                </div>
                            </div>
                        </div>
                        <!-- Badge 3: Dépenses Variables -->
                        <div class="overview-rhythm-badge badge-var" data-i18n-title="overview_rhythm_var_tooltip" title="${window.i18n.t('overview_rhythm_var_tooltip') || 'Dépenses variables moyennes (courses, loisirs, imprévus...)'}">
                            <div class="overview-badge-dot"></div>
                            <div class="overview-badge-info">
                                <span class="overview-badge-label" data-i18n="overview_rhythm_var">${window.i18n.t('overview_rhythm_var') || 'Dépenses Variables'}</span>
                                <div class="overview-badge-value-wrapper">
                                    <span class="overview-badge-value privacy-blur" id="ovRhythmVar">—</span>
                                    <span class="overview-badge-unit" id="ovRhythmUnitVar">/ mois</span>
                                </div>
                            </div>
                        </div>
                        <!-- Badge 4: Solde Net / Flux Net -->
                        <div class="overview-rhythm-badge badge-net" data-i18n-title="overview_rhythm_net_tooltip" title="${window.i18n.t('overview_rhythm_net_tooltip') || 'Flux net moyen restant (Revenus − Total Dépenses)'}">
                            <div class="overview-badge-dot"></div>
                            <div class="overview-badge-info">
                                <span class="overview-badge-label" data-i18n="overview_rhythm_net">${window.i18n.t('overview_rhythm_net') || 'Solde Net'}</span>
                                <div class="overview-badge-value-wrapper">
                                    <span class="overview-badge-value privacy-blur" id="ovRhythmNet">—</span>
                                    <span class="overview-badge-unit" id="ovRhythmUnitNet">/ mois</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section Pending Bank Sync Banner -->
                <div id="ovPendingBankSyncBanner" style="display: none; margin-bottom: 20px;"></div>

                <!-- Section 2: Central Wide Card — Opérations non rapprochées -->
                <div class="overview-main-card">
                    <div class="overview-card-header">
                        <div class="overview-header-title">
                            <h3>📋 <span data-i18n="overview_unreconciled_ops">${window.i18n.t('overview_unreconciled_ops')}</span></h3>
                            <span id="ovUnreconciledBadge" class="overview-count-pill">0</span>
                        </div>
                        <div class="overview-header-right">
                            <input type="text" id="ovOpsSearch" class="overview-search-input" 
                                placeholder="${window.i18n.t('ph_search') || 'Rechercher...'}" 
                                value="${escapeHtml(this._searchQuery)}"
                                oninput="window.OverviewView.onSearch(this.value)">
                            
                            <!-- Bulk Reconcile Button with Tooltip -->
                            <div class="overview-bulk-wrapper" id="ovBulkWrapper" style="display:none;">
                                <button id="ovBulkBtn" class="overview-bulk-btn" onclick="window.OverviewView.toggleBulkReconciliation()">
                                    <span id="ovBulkBtnLabel">✓ Tout rapprocher</span>
                                </button>
                                <div id="ovBulkTooltip" class="overview-bulk-tooltip"></div>
                            </div>

                            <button class="overview-link-btn" onclick="window.app.showUnreconciledBeforePay()" data-i18n="overview_see_all">${window.i18n.t('overview_see_all')} →</button>
                        </div>
                    </div>

                    <!-- Filter Tabs & Horizon Selector -->
                    <div class="overview-tabs-bar">
                        <div class="overview-tabs-left">
                            <button class="overview-tab ${this._activeTab === 'all' ? 'active' : ''}" onclick="window.OverviewView.setFilterTab('all')">
                                <span data-i18n="overview_filter_all">${window.i18n.t('overview_filter_all') || 'Toutes'}</span>
                                <span id="ovTabCount_all" class="overview-tab-count">(0)</span>
                            </button>
                            <button class="overview-tab ${this._activeTab === 'overdue' ? 'active' : ''}" onclick="window.OverviewView.setFilterTab('overdue')">
                                <span data-i18n="overview_filter_overdue">${window.i18n.t('overview_filter_overdue') || 'Passées ⏳'}</span>
                                <span id="ovTabCount_overdue" class="overview-tab-count">(0)</span>
                            </button>
                            <button class="overview-tab ${this._activeTab === 'expenses' ? 'active' : ''}" onclick="window.OverviewView.setFilterTab('expenses')">
                                <span data-i18n="overview_filter_expenses">${window.i18n.t('overview_filter_expenses') || 'Dépenses 💸'}</span>
                                <span id="ovTabCount_expenses" class="overview-tab-count">(0)</span>
                            </button>
                            <button class="overview-tab ${this._activeTab === 'income' ? 'active' : ''}" onclick="window.OverviewView.setFilterTab('income')">
                                <span data-i18n="overview_filter_income">${window.i18n.t('overview_filter_income') || 'Recettes 🟢'}</span>
                                <span id="ovTabCount_income" class="overview-tab-count">(0)</span>
                            </button>
                        </div>
                        <div class="overview-horizon-selector" id="ovHorizonSelector">
                            <button class="ov-horizon-btn ${this._horizon === 'cycle' ? 'active' : ''}" onclick="window.OverviewView.setHorizon('cycle')" data-i18n-title="overview_horizon_cycle_tooltip" title="${window.i18n.t('overview_horizon_cycle_tooltip') || 'Opérations échues et à venir jusqu\'à la prochaine paye'}">
                                📅 <span data-i18n="overview_horizon_cycle">${window.i18n.t('overview_horizon_cycle') || 'Cycle en cours (paye)'}</span>
                            </button>
                            <button class="ov-horizon-btn ${this._horizon === 'all' ? 'active' : ''}" onclick="window.OverviewView.setHorizon('all')" data-i18n-title="overview_horizon_all_tooltip" title="${window.i18n.t('overview_horizon_all_tooltip') || 'Toutes les opérations prévues sans limite de date'}">
                                🔮 <span data-i18n="overview_horizon_all">${window.i18n.t('overview_horizon_all') || 'Toutes les prévisions'}</span>
                            </button>
                        </div>
                    </div>

                    <div id="ovUnreconciledList" class="overview-ops-table-container">
                        <div class="overview-loading">⏳</div>
                    </div>
                </div>

                <!-- Section 3: Bottom Grid (Tendance 6M + Top 3 + Budgets & Épargne) -->
                <div class="overview-bottom-grid">
                    <!-- Column 1: Trend Chart (6 Months Area Chart) -->
                    <div class="overview-card overview-card-trend">
                        <div class="overview-card-header">
                            <h3>📈 <span data-i18n="overview_monthly_trend">${window.i18n.t('overview_monthly_trend')}</span> (6M)</h3>
                            <div class="overview-trend-mode-toggle">
                                <button class="ov-mode-btn ${this._trendMode === 'expenses' ? 'active' : ''}" onclick="window.OverviewView.setTrendMode('expenses')" data-i18n="overview_chart_mode_expenses">${window.i18n.t('overview_chart_mode_expenses') || 'Dépenses'}</button>
                                <button class="ov-mode-btn ${this._trendMode === 'compare' ? 'active' : ''}" onclick="window.OverviewView.setTrendMode('compare')">${window.i18n.t('overview_chart_mode_compare') || 'vs Recettes'}</button>
                                <button class="ov-mode-btn ${this._trendMode === 'balance' ? 'active' : ''}" onclick="window.OverviewView.setTrendMode('balance')" data-i18n="overview_chart_mode_balance">${window.i18n.t('overview_chart_mode_balance') || 'Bilan mensuel'}</button>
                            </div>
                            <button class="overview-link-btn" onclick="window.OverviewView.navigateToTrends()" data-i18n="overview_see_all">${window.i18n.t('overview_see_all')} →</button>
                        </div>
                        <div class="overview-trend-container">
                            <canvas id="ovTrendChart"></canvas>
                        </div>
                        <div id="ovTrendLegend" class="overview-trend-legend"></div>
                    </div>

                    <!-- Column 2: Top 6 Dépenses -->
                    <div class="overview-card overview-card-top3">
                        <div class="overview-card-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                            <h3 style="margin: 0;">🏆 <span id="ovTop3Title" data-i18n="overview_top3_expenses">${window.i18n.t('overview_top3_expenses') || 'Top 6 Dépenses du mois'}</span></h3>
                            <div class="ov-mode-selector" style="display: inline-flex; gap: 2px;">
                                <button class="ov-mode-btn ${this._top6Filter === 'all' ? 'active' : ''}" onclick="window.OverviewView.setTop6Filter('all')" data-i18n="filter_top6_all">${window.i18n.t('filter_top6_all') || 'Tous'}</button>
                                <button class="ov-mode-btn ${this._top6Filter === 'fixed' ? 'active' : ''}" onclick="window.OverviewView.setTop6Filter('fixed')" data-i18n="filter_top6_fixed">${window.i18n.t('filter_top6_fixed') || 'Fixes'}</button>
                                <button class="ov-mode-btn ${this._top6Filter === 'var' ? 'active' : ''}" onclick="window.OverviewView.setTop6Filter('var')" data-i18n="filter_top6_var">${window.i18n.t('filter_top6_var') || 'Variables'}</button>
                            </div>
                        </div>
                        <div id="ovTop3List" class="overview-top3-list">
                            <div class="overview-loading">⏳</div>
                        </div>
                    </div>

                    <!-- Column 3: Budgets & Savings -->
                    <div class="overview-card overview-card-budgets-savings">
                        <div class="overview-card-header">
                            <h3>🎯 <span data-i18n="overview_budgets">${window.i18n.t('overview_budgets')}</span> & <span data-i18n="overview_savings">${window.i18n.t('overview_savings')}</span></h3>
                            <button class="overview-link-btn" onclick="window.app.loadView('budgets')" data-i18n="overview_see_all">${window.i18n.t('overview_see_all')} →</button>
                        </div>
                        <div class="overview-budgets-wrapper">
                            <div class="overview-section-subtitle">🎯 <span id="ovBudgetsSubtitle" data-i18n="overview_budgets">${window.i18n.t('overview_budgets') || 'Budgets'}</span></div>
                            <div id="ovBudgetsList" class="overview-budgets-list">
                                <div class="overview-loading">⏳</div>
                            </div>

                            <div id="ovSavingsSection" style="display:none; margin-top: 20px;">
                                <div class="overview-section-subtitle">💰 <span data-i18n="overview_savings_and_goals">${window.i18n.t('overview_savings_and_goals') || 'Épargne & Objectifs'}</span></div>
                                <div id="ovSavingsList" class="overview-savings-list"></div>
                            </div>
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
                this._renderRhythmBadges();
                if (this._displayMode === 'cockpit') {
                    this._renderCockpit();
                }
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
                const savedTop6 = window.ProfileStorage.get('overview_top6_filter');
                if (savedTop6) this._top6Filter = savedTop6;
                const savedHorizon = window.ProfileStorage.get('overview_horizon');
                if (savedHorizon) this._horizon = savedHorizon;
                const savedGranularity = window.ProfileStorage.get('overview_stats_granularity');
                if (savedGranularity) this._statsGranularity = savedGranularity;
                const savedTrend = window.ProfileStorage.get('overview_trend_mode');
                if (savedTrend) this._trendMode = savedTrend;
                const savedMode = window.ProfileStorage.get('overview_display_mode');
                if (savedMode) this._displayMode = savedMode;
            }

            if (config) {
                const hasExplicitSavedAcc = window.ProfileStorage && window.ProfileStorage.get('overview_account_id') !== null;
                if (!hasExplicitSavedAcc && config.overview_account_id !== undefined) {
                    this._selectedAccountId = config.overview_account_id;
                    if (window.ProfileStorage && this._selectedAccountId) {
                        window.ProfileStorage.set('overview_account_id', this._selectedAccountId);
                    }
                }
                if (config.overview_active_tab !== undefined) {
                    this._activeTab = config.overview_active_tab;
                }
                if (config.overview_horizon !== undefined && (!window.ProfileStorage || window.ProfileStorage.get('overview_horizon') === null)) {
                    this._horizon = config.overview_horizon;
                }
                if (config.overview_trend_mode !== undefined && (!window.ProfileStorage || window.ProfileStorage.get('overview_trend_mode') === null)) {
                    this._trendMode = config.overview_trend_mode;
                }
                if (config.overview_top6_filter !== undefined && (!window.ProfileStorage || window.ProfileStorage.get('overview_top6_filter') === null)) {
                    this._top6Filter = config.overview_top6_filter;
                }
                if (config.overview_stats_granularity !== undefined && (!window.ProfileStorage || window.ProfileStorage.get('overview_stats_granularity') === null)) {
                    this._statsGranularity = config.overview_stats_granularity;
                }
                if (config.overview_stats_lookback !== undefined && (!window.ProfileStorage || window.ProfileStorage.get('overview_stats_lookback') === null)) {
                    this._statsLookback = config.overview_stats_lookback;
                }
            }

            // 2b. Rendu instantané SWR (Stale-While-Revalidate) si des données de session sont déjà en mémoire
            if (this._stats && this._accounts && this._accounts.length > 0) {
                this._populateAccountSelect();
                this._renderHealthBadge(this._stats);
                this._renderHero(this._stats);
                this._renderCockpit();
                if (this._transactions) {
                    this._renderUnreconciled(this._transactions);
                    this._renderTop3(this._transactions);
                }
                this._renderBudgets(this._stats);
                this._renderSavings(this._stats);
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
            this._updateActiveTabUI();
            this._updateHorizonUI();
            this._updateTrendModeUI();
            this._updateTop6FilterUI();
            this._updateStatsGranularityUI();
            this._updateStatsLookbackUI();
            this._renderHealthBadge(stats);
            this._renderHero(stats);
            this._calculateAverages();
            const isOrgMode = window.app?.config?.enable_org_mode === 'true' || window.app?.config?.enable_org_mode === true;
            const horizonSelector = document.getElementById('ovHorizonSelector');
            if (horizonSelector) horizonSelector.style.display = isOrgMode ? 'none' : 'inline-flex';

            // ── PRIORITÉ RÉACTIVITÉ (Zéro blocage) ──────────────────────────────
            // Dessiner immédiatement les composants sous les yeux de l'utilisateur
            this._renderCockpit();
            this._renderUnreconciled(transactions);
            this._renderTop3(transactions);
            this._renderBudgets(stats);
            this._renderSavings(stats);

            // ── CHARGEMENT EN ARRIÈRE-PLAN (Non-bloquant) ──────────────────────
            // Les widgets annexes, prévisions et graphiques s'actualisent sans bloquer l'affichage
            this._fetchForecastSummary(simAccParam).catch(e => console.warn('[OverviewView] Erreur forecast summary:', e));
            this._renderPendingBankSyncBanner();
            this._checkBankConnections().catch(e => console.warn('[OverviewView] Erreur check connections:', e));
            this._renderAutopilotWidget().catch(e => console.warn('[OverviewView] Erreur widget autopilot:', e));
            this._renderTrend().catch(e => console.warn('[OverviewView] Erreur trend chart:', e));

            if (this._pendingHighlightTxId) {
                const txId = this._pendingHighlightTxId;
                this._pendingHighlightTxId = null;
                requestAnimationFrame(() => this.highlightRow(txId));
            }
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

    async navigateToTrends() {
        // Propager le compte sélectionné et le mode de graphique vers la page Tendances
        const updates = {
            trends_account_id: this._selectedAccountId || 'total',
            trends_chart_mode: this._trendMode
        };
        await this.saveConfig(updates);
        window.app.loadView('trends');
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
        this._renderHero(this._stats);
        this._renderUnreconciled(this._transactions);
        this._renderTop3(this._transactions);
        this._renderBudgets(this._stats);
        this._renderSavings(this._stats);
        await this._fetchRhythmAverages();
        this._renderCockpit();
        this._renderTrend();
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

    async _renderPendingBankSyncBanner() {
        const banner = document.getElementById('ovPendingBankSyncBanner');
        if (!banner) return;

        let pendingData = this._pendingData;
        if (!pendingData) {
            if (window.BankSyncView && window.BankSyncView.loadPendingSync) {
                pendingData = await window.BankSyncView.loadPendingSync();
            } else {
                try {
                    pendingData = await API.get('/api/bank-sync/pending');
                } catch (_) {}
            }
            this._pendingData = pendingData;
        }

        const totalMatches = pendingData?.total_matches || 0;
        const totalConfirmedMatches = typeof pendingData?.total_confirmed_matches === 'number'
            ? pendingData.total_confirmed_matches
            : Object.values(pendingData?.matches_by_tx_id || {}).filter(m => !m.is_coming).length;
        const totalComingMatches = typeof pendingData?.total_coming_matches === 'number'
            ? pendingData.total_coming_matches
            : Object.values(pendingData?.matches_by_tx_id || {}).filter(m => m.is_coming).length;
        const totalNew = pendingData?.total_new || 0;
        const totalDiscrepancies = pendingData?.total_discrepancies || 0;

        if (totalMatches === 0 && totalNew === 0 && totalDiscrepancies === 0) {
            banner.style.display = 'none';
            return;
        }

        let matchesText = '';
        if (totalConfirmedMatches > 0 && totalComingMatches > 0) {
            const readyLbl = window.i18n ? window.i18n.t('bank_sync_ready_to_reconcile') || 'prête(s) à rapprocher' : 'prête(s) à rapprocher';
            const comingLbl = window.i18n ? window.i18n.t('bank_sync_coming_in_banner') || 'en attente en ligne' : 'en attente en ligne';
            matchesText = `<strong>${totalConfirmedMatches}</strong> ${readyLbl} • <span style="color: #818cf8; font-weight: 600;">⏳ <strong>${totalComingMatches}</strong> ${comingLbl}</span>`;
        } else if (totalConfirmedMatches > 0) {
            const readyLbl = window.i18n ? window.i18n.t('bank_sync_ready_to_reconcile') || 'prête(s) à rapprocher' : 'prête(s) à rapprocher';
            matchesText = `<strong>${totalConfirmedMatches}</strong> ${readyLbl}`;
        } else if (totalComingMatches > 0) {
            const comingLbl = window.i18n ? window.i18n.t('bank_sync_coming_in_banner') || 'en attente en ligne' : 'en attente en ligne';
            matchesText = `<span style="color: #818cf8; font-weight: 600;">⏳ <strong>${totalComingMatches}</strong> ${comingLbl}</span>`;
        }

        let discrepancyHtml = '';
        if (totalDiscrepancies > 0) {
            const discMsg = window.i18n && window.i18n.tp ? window.i18n.tp('bank_sync_banner_discrepancies', { count: totalDiscrepancies }) : `${totalDiscrepancies} rapprochée(s) en attente banque`;
            discrepancyHtml = ` • <span style="color: #d97706; font-weight: 600; cursor: help;" title="${(window.i18n ? window.i18n.t('bank_sync_discrepancy_tooltip') : 'Opérations rapprochées dans OmniBank mais encore en attente à la banque.').replace(/"/g, '&quot;')}">⏳ ${discMsg}</span>`;
        }

        let balanceStatusHtml = '';
        if (pendingData.accounts && pendingData.accounts.length > 0) {
            const accsWithBal = pendingData.accounts.filter(a => typeof a.bank_balance === 'number' && typeof a.local_reconciled_balance === 'number');
            if (accsWithBal.length > 0) {
                const diffAccs = accsWithBal.filter(a => Math.abs(a.bank_balance - a.local_reconciled_balance) >= 0.005);
                if (diffAccs.length > 0) {
                    const unresolvedAcc = diffAccs.find(a => {
                        if (window.BankSyncView && typeof window.BankSyncView.computeAccountBalanceSyncStatus === 'function') {
                            const st = window.BankSyncView.computeAccountBalanceSyncStatus(a);
                            return st.hasBalances && !st.isSynced && !st.isResolvedBySync && !st.isExplainedByComing;
                        }
                        return true;
                    });
                    if (unresolvedAcc) {
                        const diff = Math.round((unresolvedAcc.bank_balance - unresolvedAcc.local_reconciled_balance) * 100) / 100;
                        const diffFormatted = (diff > 0 ? '+' : '') + diff.toFixed(2) + ' €';
                        balanceStatusHtml = ` • <span style="color: #f59e0b; font-weight: 600;">⚠️ ${window.i18n ? window.i18n.t('bank_sync_balance_diff') || 'Écart' : 'Écart'} : ${diffFormatted}</span>`;
                    } else {
                        balanceStatusHtml = ` • <span style="color: #818cf8; font-weight: 600;">💡 ${window.i18n ? window.i18n.t('bank_sync_balance_will_sync') || 'Conforme après validation' : 'Conforme après validation'}</span>`;
                    }
                } else {
                    balanceStatusHtml = ` • <span style="color: #10b981; font-weight: 600;">🟢 ${window.i18n ? window.i18n.t('bank_sync_balance_synced') || 'Soldes conformes' : 'Soldes conformes'}</span>`;
                }
            }
        }

        const confirmedList = (window.BankSyncView && typeof window.BankSyncView.getConfirmedMatchesList === 'function')
            ? window.BankSyncView.getConfirmedMatchesList(pendingData)
            : [];
        const ghostList = (window.BankSyncView && typeof window.BankSyncView.getGhostTransactionsList === 'function')
            ? window.BankSyncView.getGhostTransactionsList(pendingData)
            : [];

        const confirmedTooltipTitle = window.i18n ? window.i18n.t('bank_btn_reconcile_confirmed_tooltip') || 'Opérations confirmées qui seront rapprochées' : 'Opérations confirmées qui seront rapprochées';
        const ghostTooltipTitle = window.i18n ? window.i18n.t('ghost_commit_all_tooltip') || 'Nouvelles opérations qui seront ajoutées' : 'Nouvelles opérations qui seront ajoutées';

        const renderTooltip = (window.BankSyncView && typeof window.BankSyncView.renderOperationsTooltipHtml === 'function')
            ? (title, items) => window.BankSyncView.renderOperationsTooltipHtml(title, items)
            : () => '';

        const confirmedTooltipHtml = renderTooltip(confirmedTooltipTitle, confirmedList);
        const ghostsTooltipHtml = renderTooltip(ghostTooltipTitle, ghostList);

        banner.style.display = 'block';
        banner.innerHTML = `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 14px; padding: 12px 18px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; box-shadow: 0 4px 12px rgba(99,102,241,0.06);">
            <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 22px;">⚡</span>
                <div>
                    <h4 style="margin: 0 0 2px 0; font-size: 13px; font-weight: 700; color: var(--text-main);">
                        ${window.i18n.t('bank_sync_pending_box_title') || 'Opérations bancaires en attente'}
                    </h4>
                    <div style="font-size: 12px; color: var(--text-muted);">
                        ${matchesText}
                        ${(matchesText && totalNew > 0) ? ' • ' : ''}
                        ${totalNew > 0 ? `<strong>${totalNew}</strong> nouvelle(s) opération(s) à ajouter` : ''}
                        ${discrepancyHtml}
                        ${balanceStatusHtml}
                    </div>
                </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                ${totalConfirmedMatches > 0 ? `
                <div class="overview-bulk-wrapper">
                    <button class="btn btn-primary btn-sm" onclick="window.BankSyncView.reconcileAllPending()" style="font-size: 12px; padding: 5px 12px; border-radius: 8px; font-weight: 700;">
                        ⚡ ${window.i18n ? window.i18n.t('bank_btn_reconcile_confirmed') || 'Rapprocher les opérations confirmées' : 'Rapprocher les opérations confirmées'} (${totalConfirmedMatches})
                    </button>
                    ${confirmedTooltipHtml}
                </div>
                ` : ''}
                ${totalNew > 0 ? `
                <div class="overview-bulk-wrapper">
                    <button class="btn btn-gold btn-sm" onclick="window.BankSyncView.commitAllGhosts()" style="font-size: 12px; padding: 5px 12px; border-radius: 8px; font-weight: 700;">
                        📥 ${window.i18n.t('ghost_commit_all') || 'Valider les nouvelles opérations'} (${totalNew})
                    </button>
                    ${ghostsTooltipHtml}
                </div>
                ` : ''}
                ${pendingData.accounts && pendingData.accounts.length > 0 ? `
                <button class="btn btn-secondary btn-sm" onclick="window.BankSyncView.openPendingReviewModal(this)" style="font-size: 12px; padding: 5px 12px; border-radius: 8px; font-weight: 600;">
                    📋 ${window.i18n.t('bank_sync_pending_review_btn') || 'Revue des opérations'}
                </button>
                ` : ''}
            </div>
        </div>
        `;
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

    _renderHero(stats) {
        const nw = document.getElementById('ovNetWorth');
        const nwLabel = document.getElementById('ovNetWorthLabel');
        const isOrgMode = window.app?.config?.enable_org_mode === 'true';

        if (nw) {
            if (this._selectedAccountId && this._accountsMap[this._selectedAccountId]) {
                const acc = this._accountsMap[this._selectedAccountId];
                nw.textContent = formatCurrency(acc.balance);
                if (nwLabel) nwLabel.textContent = `${window.i18n.t('overview_balance') || 'Solde'} (${acc.name})`;
            } else {
                nw.textContent = formatCurrency(stats.net_worth);
                if (nwLabel) {
                    nwLabel.textContent = isOrgMode
                        ? (window.i18n.t('overview_org_treasury') || 'Trésorerie Globale')
                        : (window.i18n.t('overview_net_worth') || 'Patrimoine net');
                }
            }
        }

        const rav = document.getElementById('ovRestToLive');
        const ravLabel = document.getElementById('ovRestToLiveLabel');
        const ravSub = document.getElementById('ovRestToLiveSub');
        if (ravLabel) {
            ravLabel.textContent = isOrgMode
                ? (window.i18n.t('overview_org_available') || 'Trésorerie Disponible')
                : (window.i18n.t('overview_rest_to_live') || 'Reste à vivre');
        }
        if (rav) {
            const ravInfo = this._getRestToLiveInfo(stats);
            const currentRav = ravInfo.rav;
            const plannedInc = ravInfo.plannedInc;
            const ravWithInc = ravInfo.ravWithInc;

            rav.textContent = formatCurrency(currentRav);
            if (stats.savings_overflow) {
                rav.style.color = stats.savings_overflow.fully_consumed ? '#ef4444' : '#f59e0b';
            } else if (currentRav < 0) {
                rav.style.color = '#ef4444';
            } else {
                rav.style.color = '#10b981';
            }

            if (ravSub) {
                if (plannedInc > 0) {
                    ravSub.style.display = 'block';
                    ravSub.style.color = '#10b981';
                    const subText = window.i18n.tp ? window.i18n.tp('overview_rav_planned_income', { income: formatCurrency(plannedInc), total: formatCurrency(ravWithInc) }) : `+${formatCurrency(plannedInc)} prévus (→ ${formatCurrency(ravWithInc)})`;
                    ravSub.textContent = subText;
                    const tooltip = window.i18n.tp ? window.i18n.tp('overview_rav_planned_income_tooltip', { income: formatCurrency(plannedInc), total: formatCurrency(ravWithInc) }) : `Reste à vivre avec encaissement des recettes prévues (+${formatCurrency(plannedInc)}) : ${formatCurrency(ravWithInc)}`;
                    ravSub.title = tooltip;
                } else {
                    ravSub.style.display = 'none';
                    ravSub.textContent = '';
                }
            }
        }

        const projLabel = document.getElementById('ovProjectionLabel');
        const projAmt = document.getElementById('ovProjectionAmount');
        const projSub = document.getElementById('ovProjectionSub');
        if (projAmt) {
            const proj = this._calculateProjection(stats);
            if (projLabel) {
                projLabel.textContent = proj.titleText;
                projLabel.setAttribute('data-i18n', proj.titleKey);
            }
            projAmt.textContent = formatCurrency(proj.projectedEnd);
            projAmt.style.color = proj.projectedEnd < 0 ? '#ef4444' : '#10b981';
            projAmt.title = proj.tooltipText;
            if (projSub) {
                projSub.title = proj.tooltipText;
                projSub.textContent = proj.subText;
            }
        }

        const payCard = document.getElementById('ovPayCard');
        const orgUserCard = document.getElementById('ovOrgUserCard');

        if (isOrgMode) {
            if (payCard) payCard.style.display = 'none';
            if (orgUserCard) {
                orgUserCard.style.display = 'flex';
                const userNameEl = document.getElementById('ovOrgUserName');
                if (userNameEl) userNameEl.textContent = window.app?.currentUser || '—';
            }
        } else {
            if (orgUserCard) orgUserCard.style.display = 'none';
            if (stats.next_pay_date && payCard) {
                payCard.style.display = 'flex';
                document.getElementById('ovNextPayAmount').textContent = formatCurrency(stats.next_pay_amount);
                const dateStr = formatDate(stats.next_pay_date) + (stats.is_pay_override ? ' ✏️' : '');
                document.getElementById('ovNextPayDate').textContent = dateStr;
            }
        }

        const odCard = document.getElementById('ovOverdraftCard');
        if (stats.overdraft_warning && odCard) {
            odCard.style.display = 'flex';
            const od = stats.overdraft_warning;
            const isCovered = !!od.covered_by_income;
            const odIconEl = document.getElementById('ovOverdraftIcon');
            const odLabelEl = document.getElementById('ovOverdraftLabel');
            const odAmtEl = document.getElementById('ovOverdraftAmount');
            const odDateEl = document.getElementById('ovOverdraftDate');

            if (isCovered) {
                odCard.classList.add('is-vigilance');
                if (odIconEl) odIconEl.textContent = '⏳';
                if (odLabelEl) odLabelEl.textContent = window.i18n.t('overview_contingent_cashflow') || 'Vigilance trésorerie';
                if (odAmtEl) {
                    odAmtEl.textContent = formatCurrency(od.projected_balance);
                    odAmtEl.style.color = '#f59e0b';
                    odAmtEl.classList.remove('text-red');
                }
            } else {
                odCard.classList.remove('is-vigilance');
                if (odIconEl) odIconEl.textContent = '⚠️';
                if (odLabelEl) odLabelEl.textContent = window.i18n.t('overview_overdraft_risk') || 'Risque découvert';
                if (odAmtEl) {
                    odAmtEl.textContent = formatCurrency(od.projected_balance);
                    odAmtEl.style.color = '#ef4444';
                    odAmtEl.classList.add('text-red');
                }
            }

            if (odDateEl) {
                let dateSub = formatDate(od.date);
                if (od.covered_by_income) {
                    const incAmt = od.planned_income_before_risk || od.planned_income_total || 0;
                    const covLabel = window.i18n.tp ? window.i18n.tp('overview_overdraft_covered_sub', { income: formatCurrency(incAmt) }) : `Couvert (+${formatCurrency(incAmt)})`;
                    dateSub += ` • <span style="color: #10b981; font-weight: 700;">✅ ${covLabel}</span>`;
                    const tooltip = window.i18n.tp ? window.i18n.tp('overview_overdraft_covered_tooltip', { date: formatDate(od.date), amount: formatCurrency(od.projected_balance), income: formatCurrency(incAmt) }) : `Risque théorique sans recettes au ${formatDate(od.date)} (${formatCurrency(od.projected_balance)}), mais absorbé par les recettes prévues (+${formatCurrency(incAmt)}) d'ici cette date.`;
                    odDateEl.title = tooltip;
                } else if (od.projected_balance_with_income !== undefined && od.projected_balance_with_income > od.projected_balance) {
                    const incAmt = od.planned_income_total || 0;
                    const redLabel = window.i18n.tp ? window.i18n.tp('overview_overdraft_reduced_sub', { amount: formatCurrency(od.projected_balance_with_income) }) : `Réduit (${formatCurrency(od.projected_balance_with_income)})`;
                    dateSub += ` • <span style="color: #f59e0b; font-weight: 700;">${redLabel}</span>`;
                    const tooltip = window.i18n.tp ? window.i18n.tp('overview_overdraft_reduced_tooltip', { date: formatDate(od.date), amount: formatCurrency(od.projected_balance), income: formatCurrency(incAmt), projected_balance: formatCurrency(od.projected_balance_with_income) }) : `Sans recettes : ${formatCurrency(od.projected_balance)} au ${formatDate(od.date)}. Avec recettes prévues (+${formatCurrency(incAmt)}) : solde minimal projeté ${formatCurrency(od.projected_balance_with_income)}.`;
                    odDateEl.title = tooltip;
                } else {
                    odDateEl.title = '';
                }
                odDateEl.innerHTML = dateSub;
            }
        } else if (odCard) {
            odCard.style.display = 'none';
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

    _calculateMonthEndProjection(stats) {
        return this._calculateProjection(stats);
    },

    _renderUnreconciled(transactions) {
        const container = document.getElementById('ovUnreconciledList');
        const badge = document.getElementById('ovUnreconciledBadge');
        if (!container) return;

        const todayISO = this._getTodayISO();
        const nextPayDate = this._stats?.next_pay_date;
        const endOfMonth = this._getEndOfMonthISO();
        const cutoffDate = nextPayDate || endOfMonth;

        // 1. Filtrer les opérations bancaires fantômes (en attente de validation)
        let ghosts = (window.BankSyncView && window.BankSyncView.ghostTransactions) || [];
        if (this._selectedAccountId) {
            const accIdStr = String(this._selectedAccountId);
            ghosts = ghosts.filter(g => String(g.account_id) === accIdStr);
        }

        // 2. Filtrer les opérations prévues de la base
        let allUnreconciled = transactions.filter(tx =>
            !tx.reconciliation_date &&
            !tx.is_skipped &&
            tx.cross_profile_status !== 'pending'
        );

        if (this._selectedAccountId) {
            const accIdStr = String(this._selectedAccountId);
            allUnreconciled = allUnreconciled.filter(tx =>
                String(tx.from_account_id) === accIdStr || String(tx.to_account_id) === accIdStr
            );
        }

        const isOrgMode = window.app?.config?.enable_org_mode === 'true' || window.app?.config?.enable_org_mode === true;
        const horizonSelector = document.getElementById('ovHorizonSelector');
        if (horizonSelector) horizonSelector.style.display = isOrgMode ? 'none' : 'inline-flex';

        // Horizon temporel (En mode organisation : toujours toutes les prévisions. En mode personnel : Cycle en cours vs Toutes)
        if (!isOrgMode && this._horizon === 'cycle') {
            allUnreconciled = allUnreconciled.filter(tx => tx.date_operation <= cutoffDate);
        }

        allUnreconciled.sort((a, b) => new Date(a.date_operation) - new Date(b.date_operation));

        this._unreconciledTxs = allUnreconciled;
        const totalPendingCount = allUnreconciled.length + ghosts.length;
        if (badge) badge.textContent = totalPendingCount;

        // Compute tab counts (opérations réelles + fantômes)
        const overdueTxs = allUnreconciled.filter(tx => tx.date_operation < todayISO);
        const expenseTxs = allUnreconciled.filter(tx => tx.type !== 'income');
        const incomeTxs = allUnreconciled.filter(tx => tx.type === 'income');

        const overdueGhosts = ghosts.filter(g => (g.date_operation ? String(g.date_operation).substring(0, 10) : '') < todayISO);
        const expenseGhosts = ghosts.filter(g => {
            const raw = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
            return raw < 0;
        });
        const incomeGhosts = ghosts.filter(g => {
            const raw = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
            return raw >= 0;
        });

        document.getElementById('ovTabCount_all').textContent = `(${totalPendingCount})`;
        document.getElementById('ovTabCount_overdue').textContent = `(${overdueTxs.length + overdueGhosts.length})`;
        document.getElementById('ovTabCount_expenses').textContent = `(${expenseTxs.length + expenseGhosts.length})`;
        document.getElementById('ovTabCount_income').textContent = `(${incomeTxs.length + incomeGhosts.length})`;

        // Render Bulk Reconcile Button & Tooltip
        const bulkWrapper = document.getElementById('ovBulkWrapper');
        const bulkBtnLabel = document.getElementById('ovBulkBtnLabel');
        const bulkTooltip = document.getElementById('ovBulkTooltip');

        this._pastOverdueTxs = overdueTxs;

        if (overdueTxs.length > 0 && bulkWrapper && bulkBtnLabel) {
            bulkWrapper.style.display = 'inline-block';
            let pastIncomeSum = 0;
            let pastExpenseSum = 0;
            overdueTxs.forEach(tx => {
                if (tx.type === 'income') pastIncomeSum += tx.amount;
                else pastExpenseSum += tx.amount;
            });

            let amtSummary = '';
            if (pastIncomeSum > 0 && pastExpenseSum > 0) {
                amtSummary = ` (+${formatCurrency(pastIncomeSum)} / -${formatCurrency(pastExpenseSum)})`;
            } else if (pastExpenseSum > 0) {
                amtSummary = ` (-${formatCurrency(pastExpenseSum)})`;
            } else if (pastIncomeSum > 0) {
                amtSummary = ` (+${formatCurrency(pastIncomeSum)})`;
            }

            const bulkText = window.i18n.t('overview_bulk_reconcile') || 'Rapprocher les échéances passées';
            bulkBtnLabel.textContent = `✓ ${bulkText} (${overdueTxs.length})${amtSummary}`;

            // Tooltip contents
            let ttHtml = `<div class="overview-tt-title">${window.i18n.t('overview_bulk_reconcile_tooltip_title') || 'Échéances passées qui seront rapprochées'} (${overdueTxs.length}) :</div>`;
            ttHtml += `<div class="overview-tt-list">`;
            for (const tx of overdueTxs.slice(0, 15)) {
                let accName = '—';
                if (tx.from_account_id && this._accountsMap[tx.from_account_id]) accName = this._accountsMap[tx.from_account_id].name;
                const amtColor = tx.type === 'income' ? '#10b981' : '#ef4444';
                ttHtml += `
                    <div class="overview-tt-item">
                        <span class="overview-tt-date">${formatDate(tx.date_operation)}</span>
                        <span class="overview-tt-acc">${escapeHtml(accName)}</span>
                        <span class="overview-tt-desc" title="${escapeHtml(tx.description || '')}">${escapeHtml(tx.description || '—')}</span>
                        <span class="overview-tt-amt" style="color: ${amtColor}">${formatCurrency(tx.amount)}</span>
                    </div>
                `;
            }
            if (overdueTxs.length > 15) {
                ttHtml += `<div class="overview-tt-more">+ ${overdueTxs.length - 15} ${window.i18n.t('overview_more_unreconciled_ops') || 'autres opérations'}...</div>`;
            }
            ttHtml += `</div>`;
            if (bulkTooltip) bulkTooltip.innerHTML = ttHtml;
        } else if (bulkWrapper) {
            bulkWrapper.style.display = 'none';
        }

        // Apply Tab Filter (Transactions standard)
        let filtered = allUnreconciled;
        if (this._activeTab === 'overdue') filtered = overdueTxs;
        else if (this._activeTab === 'expenses') filtered = expenseTxs;
        else if (this._activeTab === 'income') filtered = incomeTxs;

        // Apply Tab Filter (Fantômes)
        let filteredGhosts = ghosts;
        if (this._activeTab === 'overdue') filteredGhosts = overdueGhosts;
        else if (this._activeTab === 'expenses') filteredGhosts = expenseGhosts;
        else if (this._activeTab === 'income') filteredGhosts = incomeGhosts;

        // Apply Search Query
        if (this._searchQuery) {
            const q = this._searchQuery;
            filtered = filtered.filter(tx => {
                const fields = [
                    tx.description,
                    tx.category,
                    tx.amount != null ? tx.amount.toString() : '',
                    tx.amount != null ? tx.amount.toFixed(2) : '',
                    tx.account_name
                ];
                return window.permissiveMatch(fields, q);
            });
            filteredGhosts = filteredGhosts.filter(g => {
                const fields = [
                    g.description,
                    g.category,
                    g.amount != null ? g.amount.toString() : '',
                    g.amount != null ? g.amount.toFixed(2) : '',
                    g.account_name
                ];
                return window.permissiveMatch(fields, q);
            });
        }

        if (filtered.length === 0 && filteredGhosts.length === 0) {
            container.innerHTML = `
                <div class="overview-empty">
                    <span>🎉 ${window.i18n.t('overview_no_unreconciled') || 'Aucune opération à rapprocher'}</span>
                </div>
            `;
            return;
        }

        const display = filtered.slice(0, 20);
        const remaining = filtered.length - display.length;

        const dateTh = window.i18n.t('th_date') || 'Date';
        const accTh = window.i18n.t('th_account') || 'Compte';
        const descTh = window.i18n.t('th_description') || 'Description';
        const catTh = window.i18n.t('th_category') || 'Catégorie';
        const authorTh = window.i18n.t('th_created_by') || 'Saisi par';
        const amtTh = window.i18n.t('th_amount') || 'Montant';
        const actTh = window.i18n.t('th_actions') || 'Action';
        const reconBtnText = window.i18n.t('btn_reconcile') || '✓ Rapprocher';

        // Lignes fantômes injectées au début du tableau
        let ghostRowsHtml = '';
        for (const g of filteredGhosts) {
            const rawAmt = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
            const absAmt = Math.abs(parseFloat(g.amount) || rawAmt || 0);
            const isPositive = rawAmt >= 0;
            const amtFormatted = (isPositive ? '+ ' : '- ') + absAmt.toFixed(2) + ' €';
            const amtColor = isPositive ? 'var(--accent-success, #10b981)' : 'var(--text-main, #f87171)';
            const dateStr = g.date_operation ? String(g.date_operation).substring(0, 10) : '';
            const accName = g.account_name || (g.account_id && this._accountsMap[g.account_id]?.name) || '—';
            const gAccObj = (window.app?.accounts || []).find(x => x.id === g.account_id || x.name === accName) || (g.account_id && this._accountsMap[g.account_id]);
            const gAccColor = gAccObj?.color || '#3366ff';
            const accBadgeHtml = accName !== '—' ? `<span class="account-badge" style="border-color:${gAccColor}40; background:${gAccColor}18; color:${gAccColor};"><span class="acc-badge-dot" style="background:${gAccColor};"></span>${escapeHtml(accName)}</span>` : '—';
            const catLabel = g.category ? `<span class="overview-cat-badge">🏷️ ${escapeHtml(g.category)}</span>` : `<span style="color:var(--text-muted); font-size:11px; font-style:italic;">Sans catégorie</span>`;
            const authorHtml = isOrgMode 
                ? `<td class="ov-td-author"><span style="color:var(--text-muted); font-size: 11px;">🤖 Woob</span></td>`
                : '';

            const showRaw = g.raw_description && g.raw_description !== g.description;
            const rawSubHtml = showRaw ? `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 2px; font-weight: normal; opacity: 0.85;">🏦 ${escapeHtml(g.raw_description)}</div>` : '';

            const comingBadge = g.is_coming
                ? `<span class="badge coming-badge" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 4px;" title="${(window.i18n ? window.i18n.t('bank_sync_coming_tooltip') : 'Opération non encore imputée par la banque').replace(/"/g, '&quot;')}">⏳ ${window.i18n ? window.i18n.t('bank_sync_coming_badge') || 'À venir' : 'À venir'}</span>`
                : '';

            ghostRowsHtml += `
                <tr id="ovGhostRow_${g.csv_id}" class="overview-op-tr ghost-row ov-ghost-tr" data-ghost-id="${g.csv_id}" style="background: rgba(245, 158, 11, 0.04); border-left: 3px dashed #f59e0b;">
                    <td class="ov-td-date">
                        <span class="badge ghost-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-right: 4px;">👻 ${window.i18n ? window.i18n.t('ghost_badge') || 'En ligne' : 'En ligne'}</span>${comingBadge}
                        <span>${dateStr ? formatDate(dateStr) : '—'}</span>
                    </td>
                    <td class="ov-td-acc">${accBadgeHtml}</td>
                    <td class="ov-td-desc" title="${escapeHtml(g.description || '')}">
                        <div style="display: inline-flex; align-items: center; gap: 4px;">
                            <span>${escapeHtml(g.description || '—')}</span>
                            ${window.BankSyncView && typeof window.BankSyncView._renderSmartOriginIcon === 'function' ? window.BankSyncView._renderSmartOriginIcon(g) : (g.smart_suggested ? `<span title="${window.i18n ? window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique' : 'Suggéré d’après votre historique'}" style="cursor:help; font-size:11px;">💡</span>` : '')}
                        </div>
                        ${rawSubHtml}
                    </td>
                    <td class="ov-td-cat">${catLabel}</td>
                    ${authorHtml}
                    <td class="ov-td-amt" style="text-align: right;"><span class="privacy-blur" style="color: ${amtColor}; font-weight: 700;">${amtFormatted}</span></td>
                    <td class="ov-td-action" style="text-align: right; white-space: nowrap;">
                        <div style="display: inline-flex; gap: 4px; align-items: center; justify-content: flex-end;">
                            <button class="btn btn-primary" onclick="window.BankSyncView.validateGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}" style="font-size: 11.5px; padding: 0 10px; border-radius: 6px; height: 26px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                                ✔ ${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}
                            </button>
                            <button class="btn-action-icon" onclick="window.BankSyncView.openLinkGhostModal('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_link_single') || 'Lier à une opération existante' : 'Lier à une opération existante'}">
                                🔗
                            </button>
                            <button class="btn-action-icon" onclick="window.BankSyncView.editGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_edit_single') || 'Modifier' : 'Modifier'}">
                                ✏️
                            </button>
                            <button class="btn-action-del" onclick="window.BankSyncView.dismissGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_dismiss_single') || 'Ignorer' : 'Ignorer'}">
                                ✕
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }

        let html = `
            <table class="overview-ops-table">
                <thead>
                    <tr>
                        <th style="width: 110px;">${dateTh}</th>
                        <th style="width: 130px;">${accTh}</th>
                        <th>${descTh}</th>
                        <th style="width: 140px;">${catTh}</th>
                        ${isOrgMode ? `<th style="width: 110px;">${authorTh}</th>` : ''}
                        <th style="width: 120px; text-align: right;">${amtTh}</th>
                        <th style="width: 150px; text-align: right;">${actTh}</th>
                    </tr>
                </thead>
                <tbody>
                    ${ghostRowsHtml}
        `;

        for (const tx of display) {
            const amountColor = tx.type === 'income' ? 'var(--color-income)' : 
                               (tx.type === 'transfer' ? 'var(--color-transfer)' : 'inherit');
            const catLabel = tx.category || window.i18n.t('no_category') || 'Sans catégorie';
            
            let accName = '—';
            let accColor = '#3366ff';
            if (tx.from_account_id && this._accountsMap[tx.from_account_id]) {
                accName = this._accountsMap[tx.from_account_id].name;
                accColor = this._accountsMap[tx.from_account_id].color || accColor;
            } else if (tx.to_account_id && this._accountsMap[tx.to_account_id]) {
                accName = this._accountsMap[tx.to_account_id].name;
                accColor = this._accountsMap[tx.to_account_id].color || accColor;
            }
            const accBadgeHtml = accName !== '—' 
                ? `<span class="account-badge" style="border-color:${accColor}40; background:${accColor}18; color:${accColor};"><span class="acc-badge-dot" style="background:${accColor};"></span>${escapeHtml(accName)}</span>`
                : '<span style="color:var(--text-muted);">—</span>';

            const authorHtml = isOrgMode 
                ? `<td class="ov-td-author">${tx.created_by ? `<span class="overview-author-badge">👤 ${escapeHtml(tx.created_by)}</span>` : '<span style="color:var(--text-muted);">—</span>'}</td>`
                : '';

            const reconBtnHtml = window.ReconciliationStates.resolve(tx, { view: 'overview', formatDate }).html;
            const showRaw = tx.raw_description && tx.raw_description !== tx.description;
            const rawSubHtml = showRaw ? `<div style="font-size: 10px; color: var(--text-muted); font-family: monospace; margin-top: 2px;">🏦 ${escapeHtml(tx.raw_description)}</div>` : '';
            const reviewBadge = tx.needs_review ? `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px; margin-left: 6px; cursor: pointer; display: inline-flex; align-items: center; gap: 3px;" onclick="window.handleReviewClick(${tx.id}, event)" title="Score de confiance: ${Math.round(tx.confidence_score || 0)}%. Cliquer pour vérifier et lier.">🔍 À vérifier (${Math.round(tx.confidence_score || 0)}%)</span>` : '';

            html += `
                <tr id="ovRow_${tx.id}" class="overview-op-tr" data-id="${tx.id}">
                    <td class="ov-td-date">${renderDateWithStatus(tx)}</td>
                    <td class="ov-td-acc">${accBadgeHtml}</td>
                    <td class="ov-td-desc" title="${escapeHtml(tx.description || '')}">
                        <div style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
                            <span>${escapeHtml(tx.description || '—')}</span>
                            ${reviewBadge}
                        </div>
                        ${rawSubHtml}
                    </td>
                    <td class="ov-td-cat"><span class="overview-cat-badge">${escapeHtml(catLabel)}</span></td>
                    ${authorHtml}
                    <td class="ov-td-amt" style="text-align: right;"><span class="privacy-blur" style="color: ${amountColor}; font-weight: 700;">${formatCurrency(tx.amount)}</span></td>
                    <td class="ov-td-action" style="text-align: right; white-space: nowrap;">
                        <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
                            ${reconBtnHtml}
                            <button class="btn btn-secondary btn-sm ov-action-menu-trigger" onclick="event.stopPropagation(); window.OverviewView.toggleActionMenu(${tx.id}, event)" title="${window.i18n.t('th_actions') || 'Actions'}">
                                ⋮
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }

        html += `</tbody></table>`;

        if (remaining > 0) {
            const moreLabel = window.i18n.t('overview_more_unreconciled_ops') || 'autres opérations non rapprochées';
            html += `
                <div class="overview-op-more">
                    <button class="overview-link-btn" onclick="window.app.showUnreconciledBeforePay()">
                        +${remaining} ${moreLabel} →
                    </button>
                </div>
            `;
        }

        container.innerHTML = html;
    },

    setFilterTab(tabName) {
        this._activeTab = tabName;
        this.saveConfig({ overview_active_tab: this._activeTab });
        this._updateActiveTabUI();
        this._renderUnreconciled(this._transactions);
    },

    _updateActiveTabUI() {
        document.querySelectorAll('.overview-tab').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${this._activeTab}'`));
        });
    },

    setHorizon(mode) {
        this._horizon = mode;
        if (window.ProfileStorage) {
            window.ProfileStorage.set('overview_horizon', mode);
        }
        this.saveConfig({ overview_horizon: this._horizon });
        this._updateHorizonUI();
        this._renderUnreconciled(this._transactions);
    },

    _updateHorizonUI() {
        document.querySelectorAll('.ov-horizon-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${this._horizon}'`));
        });
    },

    async toggleBulkReconciliation() {
        const pastTxs = this._pastOverdueTxs || [];
        if (pastTxs.length === 0) return;

        const bulkBtn = document.getElementById('ovBulkBtn');
        if (bulkBtn) {
            bulkBtn.disabled = true;
            const recText = window.i18n.t('overview_reconciling') || 'Rapprochement';
            bulkBtn.innerHTML = `⏳ ${recText} (${pastTxs.length})...`;
        }

        try {
            await Promise.all(pastTxs.map(tx => API.post(`/api/transactions/${tx.id}/toggle_reconciliation`)));
            const toastText = window.i18n.t('overview_toast_bulk_reconciled') || 'opérations rapprochées';
            showUndoToast(`${pastTxs.length} ${toastText}`, null, () => this.init());
            await Promise.all([window.app.refreshSidebar(), this.init()]);
        } catch (e) {
            console.error('[overview] Erreur rapprochement en masse', e);
            if (bulkBtn) bulkBtn.disabled = false;
        }
    },

    onSearch(query) {
        this._searchQuery = query || '';
        this._renderUnreconciled(this._transactions);
    },

    _renderTop3(transactions) {
        const container = document.getElementById('ovTop3List');
        if (!container) return;

        const isOrgMode = window.app?.config?.enable_org_mode === 'true';
        const top3TitleEl = document.getElementById('ovTop3Title');
        if (top3TitleEl) {
            top3TitleEl.textContent = isOrgMode
                ? (window.i18n.t('overview_org_expenses_title') || 'Postes de Dépenses du mois')
                : (window.i18n.t('overview_top3_expenses') || 'Top 6 Dépenses du mois');
        }

        const today = new Date();
        const curYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

        let monthExpenses = transactions.filter(tx =>
            !tx.is_skipped &&
            tx.type !== 'income' &&
            tx.type !== 'transfer' &&
            (tx.date_operation || '').startsWith(curYearMonth)
        );

        if (this._top6Filter === 'fixed') {
            monthExpenses = monthExpenses.filter(tx => tx.type === 'expense_fixed');
        } else if (this._top6Filter === 'var') {
            monthExpenses = monthExpenses.filter(tx => tx.type === 'expense_var');
        }

        if (this._selectedAccountId) {
            const accIdStr = String(this._selectedAccountId);
            monthExpenses = monthExpenses.filter(tx =>
                String(tx.from_account_id) === accIdStr || String(tx.to_account_id) === accIdStr
            );
        }

        const catMap = {};
        monthExpenses.forEach(tx => {
            const cat = tx.category || window.i18n.t('no_category') || 'Sans catégorie';
            catMap[cat] = (catMap[cat] || 0) + Math.abs(tx.amount);
        });

        const sortedCats = Object.keys(catMap)
            .map(cat => ({ category: cat, amount: catMap[cat] }))
            .sort((a, b) => b.amount - a.amount);

        const top6 = sortedCats.slice(0, 6);

        if (top6.length === 0) {
            const noExpMsg = window.i18n.t('overview_no_expenses_this_month') || 'Aucune dépense ce mois-ci';
            container.innerHTML = `<div class="overview-empty">— ${noExpMsg} —</div>`;
            return;
        }

        const maxAmt = top6[0].amount || 1;
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'];
        const tooltip = window.i18n.t('overview_top3_click_tooltip') || 'Voir les opérations dans l\'historique';
        let html = '';

        top6.forEach((item, index) => {
            const pct = Math.round((item.amount / maxAmt) * 100);
            const medal = medals[index] || `${index + 1}.`;
            const catEscaped = escapeHtml(item.category);
            const catForJs = catEscaped.replace(/'/g, "\\'");
            html += `
                <div class="overview-top3-item overview-top3-item-clickable" 
                     onclick="window.OverviewView.drillDownToHistory('${catForJs}', '${curYearMonth}')" 
                     title="${escapeHtml(tooltip)}">
                    <div class="overview-top3-header">
                        <span class="overview-top3-name">${medal} ${catEscaped}</span>
                        <span class="overview-top3-amt privacy-blur">${formatCurrency(item.amount)}</span>
                    </div>
                    <div class="overview-top3-bar-bg">
                        <div class="overview-top3-bar-fill" style="width: ${pct}%;"></div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    setTop6Filter(mode) {
        this._top6Filter = mode;
        if (window.ProfileStorage) {
            window.ProfileStorage.set('overview_top6_filter', mode);
        }
        this.saveConfig({ overview_top6_filter: mode });
        this._updateTop6FilterUI();
        this._renderTop3(this._transactions);
    },

    _updateTop6FilterUI() {
        const card = document.querySelector('.overview-card-top3');
        if (!card) return;
        card.querySelectorAll('.ov-mode-selector .ov-mode-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            if (onclickStr.includes(`'${this._top6Filter}'`)) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    },

    drillDownToHistory(category, monthKey) {
        let typeFilter = '';
        if (this._top6Filter === 'fixed') {
            typeFilter = 'expense_fixed';
        } else if (this._top6Filter === 'var') {
            typeFilter = 'expense_var';
        }
        window.AllOperationsView.pendingFilter = {
            category: category,
            monthKey: monthKey,
            type: typeFilter,
            backToView: 'overview'
        };
        window.app.loadView('all_operations');
    },

    setTrendMode(mode) {
        this._trendMode = mode;
        if (window.ProfileStorage) {
            window.ProfileStorage.set('overview_trend_mode', mode);
        }
        this.saveConfig({ overview_trend_mode: this._trendMode });
        this._updateTrendModeUI();
        this._renderTrend();
    },

    _updateTrendModeUI() {
        document.querySelectorAll('.overview-trend-mode-toggle .ov-mode-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickStr.includes(`'${this._trendMode}'`));
        });
    },

    _renderBudgets(stats) {
        const container = document.getElementById('ovBudgetsList');
        if (!container) return;

        const isOrgMode = window.app?.config?.enable_org_mode === 'true';
        const budgetsSubEl = document.getElementById('ovBudgetsSubtitle');
        if (budgetsSubEl) {
            budgetsSubEl.textContent = isOrgMode
                ? (window.i18n.t('overview_org_budgets_title') || 'Budgets d\'Exercice & Fonds Dédiés')
                : (window.i18n.t('overview_budgets') || 'Budgets');
        }

        const summary = stats.budget_summary || {};
        const periodLabels = {
            'monthly': window.i18n.t('stat_budgets_monthly') || 'Budgets (Mensuel)',
            'yearly': window.i18n.t('stat_budgets_yearly') || 'Budgets (Annuel)',
            'indefinite': window.i18n.t('stat_budgets_indefinite') || 'Budgets (Indéfini)',
            'custom': window.i18n.t('stat_budgets_custom') || 'Budgets (Défini)'
        };
        const orderedPeriods = ['monthly', 'yearly', 'indefinite', 'custom'];

        let html = '';
        let hasContent = false;

        for (const period of orderedPeriods) {
            const pg = summary[period];
            if (!pg || pg.target <= 0) continue;
            hasContent = true;

            const spent = Math.abs(pg.reconciled_expenses || 0);
            const target = pg.target;
            const pct = target > 0 ? Math.min((spent / target) * 100, 100) : 0;
            const remaining = Math.max(target - spent, 0);
            const over = spent > target;
            const color = over ? '#ef4444' : pct >= 80 ? '#f59e0b' : pct >= 50 ? '#3b82f6' : '#10b981';

            html += `
                <div class="overview-budget-item" onclick="if(window.BudgetsView) window.BudgetsView.backToView='overview'; window.app.loadView('budgets')">
                    <div class="overview-budget-header">
                        <span class="overview-budget-name">${periodLabels[period] || period}</span>
                        <span class="overview-budget-pct" style="color: ${color};">${Math.round(pct)}% ${window.i18n.t('overview_used')}</span>
                    </div>
                    <div class="overview-budget-bar-bg">
                        <div class="overview-budget-bar-fill" style="width: ${pct}%; background: ${color};"></div>
                    </div>
                    <div class="overview-budget-footer">
                        <span class="privacy-blur">${formatCurrency(spent)} ${window.i18n.t('overview_of_budget')} ${formatCurrency(target)}</span>
                        <span class="privacy-blur" style="color: ${color}; font-weight: 600;">${formatCurrency(remaining)} ${window.i18n.t('overview_remaining')}</span>
                    </div>
                </div>
            `;
        }

        const noBudgetsMsg = window.i18n.t('overview_no_budgets') || 'Aucune enveloppe budget';
        container.innerHTML = hasContent ? html : `<div class="overview-empty">— ${noBudgetsMsg} —</div>`;
    },

    _renderSavings(stats) {
        const sec = document.getElementById('ovSavingsSection');
        const container = document.getElementById('ovSavingsList');
        if (!sec || !container) return;

        const savings = (stats.savings_details || []).filter(s => !s.is_closed);
        if (savings.length === 0) return;

        sec.style.display = 'block';
        let html = '';

        for (const s of savings) {
            const pct = s.goal > 0 ? Math.min((s.balance / s.goal) * 100, 100) : (s.balance > 0 ? 100 : 0);
            const color = pct >= 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b';

            html += `
                <div class="overview-savings-item" onclick="if(window.BudgetsView) window.BudgetsView.backToView='overview'; window.app.loadView('budgets')">
                    <div class="overview-savings-header">
                        <span class="overview-savings-name">${escapeHtml(s.name)}</span>
                        <span class="overview-savings-pct" style="color: ${color};">${Math.round(pct)}%</span>
                    </div>
                    <div class="overview-budget-bar-bg">
                        <div class="overview-budget-bar-fill" style="width: ${pct}%; background: ${color};"></div>
                    </div>
                    <div class="overview-budget-footer">
                        <span class="privacy-blur">${formatCurrency(s.balance)}</span>
                        ${s.goal > 0 ? `<span class="privacy-blur" style="color: var(--text-muted);">${window.i18n.t('overview_of_budget')} ${formatCurrency(s.goal)}</span>` : ''}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    },

    setStatsGranularity(granularity) {
        this._statsGranularity = granularity || 'month';
        if (window.ProfileStorage) {
            window.ProfileStorage.set('overview_stats_granularity', this._statsGranularity);
        }
        this.saveConfig({ overview_stats_granularity: this._statsGranularity });
        this._updateStatsGranularityUI();
        this._renderRhythmBadges();
    },

    _updateStatsGranularityUI() {
        const group = document.getElementById('ovGranularityGroup');
        if (!group) return;
        group.querySelectorAll('.ov-seg-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickStr.includes(`'${this._statsGranularity}'`));
        });
    },

    async setStatsLookback(lookback) {
        this._statsLookback = lookback || '6m';
        if (window.ProfileStorage) {
            window.ProfileStorage.set('overview_stats_lookback', this._statsLookback);
        }
        this.saveConfig({ overview_stats_lookback: this._statsLookback });
        this._updateStatsLookbackUI();
        await this._fetchRhythmAverages();
    },

    _updateStatsLookbackUI() {
        const group = document.getElementById('ovLookbackGroup');
        if (!group) return;
        group.querySelectorAll('.ov-seg-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickStr.includes(`'${this._statsLookback}'`));
        });
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
            this._renderRhythmBadges();
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

        this._renderRhythmBadges();
    },

    _renderRhythmBadges() {
        const incEl = document.getElementById('ovRhythmIncome');
        const fixEl = document.getElementById('ovRhythmFixed');
        const varEl = document.getElementById('ovRhythmVar');
        const netEl = document.getElementById('ovRhythmNet');
        if (!incEl || !fixEl || !varEl || !netEl) return;

        const averages = this._cachedMonthlyAverages || { income: 0, fixed: 0, variable: 0 };
        const granularity = this._statsGranularity || 'month';

        let divisor = 1;
        let unitKey = 'unit_per_month';
        let defaultUnit = '/ mois';

        if (granularity === 'week') {
            divisor = 52 / 12; // ~4.3333 semaines par mois
            unitKey = 'unit_per_week';
            defaultUnit = '/ sem.';
        } else if (granularity === 'day') {
            divisor = 365.25 / 12; // ~30.4375 jours par mois
            unitKey = 'unit_per_day';
            defaultUnit = '/ jour';
        } else if (granularity === 'hour') {
            divisor = (365.25 * 24) / 12; // ~730.5 heures par mois
            unitKey = 'unit_per_hour';
            defaultUnit = '/ heure';
        }

        const unitLabel = window.i18n.t(unitKey) || defaultUnit;

        // Mise à jour des suffixes d'unité
        ['Income', 'Fixed', 'Var', 'Net'].forEach(k => {
            const uEl = document.getElementById(`ovRhythmUnit${k}`);
            if (uEl) uEl.textContent = unitLabel;
        });

        const incVal = averages.income / divisor;
        const fixVal = averages.fixed / divisor;
        const varVal = averages.variable / divisor;
        const netVal = (averages.income - averages.fixed - averages.variable) / divisor;

        incEl.textContent = formatCurrency(incVal);
        fixEl.textContent = formatCurrency(fixVal);
        varEl.textContent = formatCurrency(varVal);

        const sign = netVal > 0 ? '+' : '';
        netEl.textContent = `${sign}${formatCurrency(netVal)}`;
        netEl.style.color = netVal >= 0 ? '#10b981' : '#ef4444';
    },

    async _renderTrend() {
        const canvas = document.getElementById('ovTrendChart');
        const legendContainer = document.getElementById('ovTrendLegend');
        if (!canvas) return;

        try {
            let url = '/api/stats/categories_by_month?months=6';
            if (this._selectedAccountId) url += `&account_ids=${this._selectedAccountId}`;
            const catData = await API.get(url);

            const today = new Date();
            const monthKeys = [];
            const monthLabels = [];
            const isEn = window.i18n.lang === 'en';
            const monthNames = isEn 
                ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
                : ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

            for (let i = 5; i >= 0; i--) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                monthKeys.push(mk);
                monthLabels.push(`${monthNames[d.getMonth()]} ${d.getFullYear() % 100}`);
            }

            // Calculer et afficher les moyennes & rythme financier
            this._calculateAverages();

            const expenseTotals = monthKeys.map(mk => {
                let total = 0;
                for (const txType of ['expense_var', 'expense_fixed', 'transfer']) {
                    const typeGroup = (catData.by_type && catData.by_type[txType]) ? catData.by_type[txType] : catData[txType];
                    if (typeGroup && typeGroup.totals_per_month && typeGroup.totals_per_month[mk]) {
                        total += Math.abs(typeGroup.totals_per_month[mk]);
                    }
                }
                return Math.round(total * 100) / 100;
            });

            const incomeTotals = monthKeys.map(mk => {
                let total = 0;
                const typeGroup = (catData.by_type && catData.by_type['income']) ? catData.by_type['income'] : catData['income'];
                if (typeGroup && typeGroup.totals_per_month && typeGroup.totals_per_month[mk]) {
                    total += Math.abs(typeGroup.totals_per_month[mk]);
                }
                return Math.round(total * 100) / 100;
            });

            const netTotals = monthKeys.map((mk, i) => Math.round((incomeTotals[i] - expenseTotals[i]) * 100) / 100);

            const ctx = canvas.getContext('2d');
            let datasets = [];

            const expLabel = window.i18n.t('overview_chart_mode_expenses') || 'Expenses';
            const incLabel = window.i18n.t('overview_chart_mode_income') || 'Income';
            const balLabel = window.i18n.t('overview_chart_mode_balance') || 'Net balance';

            if (this._trendMode === 'expenses') {
                const gradient = ctx.createLinearGradient(0, 0, 0, 220);
                gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
                gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

                datasets = [{
                    label: expLabel,
                    data: expenseTotals,
                    fill: true,
                    backgroundColor: gradient,
                    borderColor: '#6366f1',
                    borderWidth: 3,
                    pointBackgroundColor: '#6366f1',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    pointRadius: 5,
                    tension: 0.35
                }];
            } else if (this._trendMode === 'compare') {
                datasets = [
                    {
                        label: incLabel,
                        data: incomeTotals,
                        borderColor: '#10b981',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        fill: true,
                        borderWidth: 3,
                        pointBackgroundColor: '#10b981',
                        tension: 0.35
                    },
                    {
                        label: expLabel,
                        data: expenseTotals,
                        borderColor: '#ef4444',
                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                        fill: true,
                        borderWidth: 3,
                        pointBackgroundColor: '#ef4444',
                        tension: 0.35
                    }
                ];
            } else if (this._trendMode === 'balance') {
                const bgColors = netTotals.map(val => val >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)');
                datasets = [{
                    type: 'bar',
                    label: balLabel,
                    data: netTotals,
                    backgroundColor: bgColors,
                    borderRadius: 6
                }];
            }

            const targetType = this._trendMode === 'balance' ? 'bar' : 'line';
            if (this._chart && this._chart.config && this._chart.config.type === targetType) {
                this._chart.data.labels = monthLabels;
                this._chart.data.datasets = datasets;
                this._chart.options.plugins.legend.display = this._trendMode === 'compare';
                this._chart.options.scales.y.beginAtZero = this._trendMode !== 'balance';
                this._chart.update('none');
                return;
            }

            if (this._chart) {
                this._chart.destroy();
                this._chart = null;
            }

            this._chart = new Chart(canvas, {
                type: targetType,
                data: {
                    labels: monthLabels,
                    datasets: datasets
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: this._trendMode === 'compare' },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                            padding: 12,
                            displayColors: true,
                            callbacks: {
                                label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: this._trendMode !== 'balance',
                            grid: { color: 'rgba(128,128,128,0.1)' },
                            ticks: {
                                callback: (v) => formatCurrency(v),
                                color: 'rgba(128,128,128,0.6)',
                                font: { size: window.innerWidth < 1024 ? 9.5 : 11 }
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: {
                                color: 'rgba(128,128,128,0.8)',
                                font: { size: window.innerWidth < 1024 ? 10.5 : 12, weight: '600' }
                            }
                        }
                    }
                }
            });

            // Légende dynamique selon le mode
            if (legendContainer) {
                if (this._trendMode === 'expenses') {
                    const curExp = expenseTotals[expenseTotals.length - 1] || 0;
                    const prevExp = expenseTotals[expenseTotals.length - 2] || 0;
                    const diff = curExp - prevExp;
                    const pct = prevExp > 0 ? ((diff / prevExp) * 100).toFixed(0) : 0;
                    const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
                    const color = diff > 0 ? '#ef4444' : diff < 0 ? '#10b981' : 'var(--text-muted)';
                    const sign = diff > 0 ? '+' : '';
                    const expMonthLabel = window.i18n.t('overview_expenses_this_month') || 'Dépenses ce mois';
                    const vsLastLabel = window.i18n.t('overview_vs_last_month') || 'vs mois dernier';
                    legendContainer.innerHTML = `
                        <div style="display:flex; justify-content:center; align-items:center; gap:12px; font-size:13px;">
                            <span>${expMonthLabel}: <strong class="privacy-blur">${formatCurrency(curExp)}</strong></span>
                            <span style="color: ${color}; font-weight: 700;">
                                ${arrow} ${sign}${pct}% ${vsLastLabel}
                            </span>
                        </div>
                    `;
                } else if (this._trendMode === 'compare') {
                    const curInc = incomeTotals[incomeTotals.length - 1] || 0;
                    const curExp = expenseTotals[expenseTotals.length - 1] || 0;
                    const incLabel2 = window.i18n.t('overview_chart_mode_income') || 'Recettes';
                    const expLabel2 = window.i18n.t('overview_chart_mode_expenses') || 'Dépenses';
                    legendContainer.innerHTML = `
                        <div style="display:flex; justify-content:center; align-items:center; gap:16px; font-size:13px;">
                            <span style="color:#10b981;">● ${incLabel2}: <strong class="privacy-blur">${formatCurrency(curInc)}</strong></span>
                            <span style="color:#ef4444;">● ${expLabel2}: <strong class="privacy-blur">${formatCurrency(curExp)}</strong></span>
                        </div>
                    `;
                } else if (this._trendMode === 'balance') {
                    const curNet = netTotals[netTotals.length - 1] || 0;
                    const netColor = curNet >= 0 ? '#10b981' : '#ef4444';
                    const netSign = curNet >= 0 ? '+' : '';
                    const balMonthLabel = window.i18n.t('overview_chart_mode_balance') || 'Bilan mensuel';
                    const thisMonthLabel = window.i18n.t('overview_this_month') || 'ce mois';
                    legendContainer.innerHTML = `
                        <div style="display:flex; justify-content:center; align-items:center; gap:12px; font-size:13px;">
                            <span>${balMonthLabel} ${thisMonthLabel}: <strong class="privacy-blur" style="color:${netColor};">${netSign}${formatCurrency(curNet)}</strong></span>
                        </div>
                    `;
                }
            }
        } catch (e) {
            console.error('[overview] Erreur rendu tendance', e);
            const noDataMsg = window.i18n.t('overview_insufficient_data') || 'Données insuffisantes pour la courbe';
            canvas.parentElement.innerHTML = `<div class="overview-empty">— ${noDataMsg} —</div>`;
        }
    },

    async toggleReconciliation(id) {
        await window.ReconciliationActions.toggle(id, {
            rowSelector: `#ovRow_${id}`,
            animateFade: true,
            refreshView: () => this.init()
        });
    },


    edit(id) {
        const tx = (this._transactions || []).find(t => t.id === id);
        if (tx && window.FormView) {
            window.FormView.openEdit(tx);
        }
    },

    duplicate(id) {
        const tx = (this._transactions || []).find(t => t.id === id);
        if (tx && window.FormView) {
            window.FormView.openDuplicate(tx);
        }
    },

    async toggleSkip(id) {
        const row = document.getElementById(`ovRow_${id}`);
        if (row) {
            row.style.transition = 'opacity 0.2s, transform 0.2s';
            row.style.opacity = '0.15';
            row.style.transform = 'translateX(-10px)';
            row.style.pointerEvents = 'none';
        }
        try {
            const res = await API.post(`/api/transactions/${id}/toggle_skip`);
            showUndoToast(window.i18n.t('toast_tx_updated') || "Opération modifiée", res.action_id, () => this.init());
            Promise.all([window.app.refreshSidebar(), this.init()]).catch(e => console.error('[overview] Erreur refresh arrière-plan:', e));
        } catch (e) {
            console.error('[overview] Erreur toggle skip', e);
            if (row) {
                row.style.opacity = '1';
                row.style.transform = '';
                row.style.pointerEvents = '';
            }
        }
    },

    async delete(id) {
        if (await showInlineConfirm(window.i18n.t('title_confirmation') || "Confirmation", window.i18n.t('confirm_delete_operation') || "Supprimer cette opération ?")) {
            const row = document.getElementById(`ovRow_${id}`);
            if (row) {
                row.style.transition = 'opacity 0.2s, transform 0.2s';
                row.style.opacity = '0';
                row.style.transform = 'translateX(-20px)';
            }
            try {
                const res = await API.del(`/api/transactions/${id}`);
                showUndoToast(window.i18n.t('toast_tx_deleted') || "Opération supprimée", res.action_id, () => this.init());
                Promise.all([window.app.refreshSidebar(), this.init()]).catch(e => console.error('[overview] Erreur refresh arrière-plan:', e));
            } catch (e) {
                if (row) { row.style.opacity = ''; row.style.transform = ''; }
                console.error('[overview] Erreur suppression', e);
            }
        }
    },

    showAddModal() {
        if (window.FormView) {
            window.FormView.open();
        }
    },

    highlightRow(txId) {
        if (!txId) return;
        requestAnimationFrame(() => {
            const row = document.getElementById(`ovRow_${txId}`) || document.querySelector(`tr[data-id="${txId}"]`);
            if (!row) return;

            row.scrollIntoView({ behavior: 'smooth', block: 'center' });

            const highlightColor = 'rgba(99, 102, 241, 0.35)';
            row.style.setProperty('background-color', highlightColor, 'important');
            row.querySelectorAll('td').forEach(td => {
                td.style.setProperty('background-color', highlightColor, 'important');
            });

            setTimeout(() => {
                row.style.transition = 'background-color 1s ease-out';
                row.style.setProperty('background-color', 'transparent', 'important');
                row.querySelectorAll('td').forEach(td => {
                    td.style.transition = 'background-color 1s ease-out';
                    td.style.setProperty('background-color', 'transparent', 'important');
                });

                setTimeout(() => {
                    row.style.removeProperty('background-color');
                    row.style.removeProperty('transition');
                    row.querySelectorAll('td').forEach(td => {
                        td.style.removeProperty('background-color');
                        td.style.removeProperty('transition');
                    });
                }, 1000);
            }, 2000);
        });
    },

    toggleActionMenu(id, event) {
        if (event) event.stopPropagation();
        const existing = document.getElementById('ovFloatingActionMenu');
        if (existing) {
            const wasId = existing.getAttribute('data-tx-id');
            existing.remove();
            if (wasId === String(id)) return;
        }

        const tx = (this._transactions || []).find(t => t.id === id);
        if (!tx) return;

        const btn = event.currentTarget;
        const rect = btn.getBoundingClientRect();

        const menu = document.createElement('div');
        menu.id = 'ovFloatingActionMenu';
        menu.setAttribute('data-tx-id', String(id));
        menu.style.position = 'fixed';
        menu.style.top = `${rect.bottom + 4}px`;
        menu.style.right = `${window.innerWidth - rect.right}px`;
        menu.style.zIndex = '99999';
        menu.style.background = 'var(--bg-surface)';
        menu.style.border = '1px solid var(--border-color)';
        menu.style.borderRadius = '8px';
        menu.style.boxShadow = '0 10px 25px rgba(0, 0, 0, 0.4)';
        menu.style.padding = '4px 0';
        menu.style.minWidth = '170px';
        menu.style.display = 'flex';
        menu.style.flexDirection = 'column';

        const editLabel = window.i18n.t('tooltip_edit') || 'Modifier';
        const dupLabel = window.i18n.t('tooltip_duplicate') || 'Dupliquer';
        const skipLabel = window.i18n.t('tooltip_skip') || 'Ignorer cette occurrence';
        const delLabel = window.i18n.t('tooltip_delete') || 'Supprimer';

        let itemsHtml = '';
        if (tx.needs_review) {
            itemsHtml += `
                <button class="ov-action-menu-item" style="color: #f59e0b; font-weight: 600;" onclick="window.handleReviewClick(${id}, event); window.OverviewView.closeActionMenu();">
                    <span>🔍</span> <span>${window.i18n ? (window.i18n.t('autopilot_review_context_menu') || 'Vérifier / Lier (Auto-Pilote)') : 'Vérifier / Lier (Auto-Pilote)'}</span>
                </button>
                <div style="height:1px; background:var(--border-color); margin:4px 0;"></div>
            `;
        }

        itemsHtml += `
            <button class="ov-action-menu-item" onclick="window.OverviewView.edit(${id}); window.OverviewView.closeActionMenu();">
                <span>✏️</span> <span>${editLabel}</span>
            </button>
            <button class="ov-action-menu-item" onclick="window.OverviewView.duplicate(${id}); window.OverviewView.closeActionMenu();">
                <span>📋</span> <span>${dupLabel}</span>
            </button>
        `;

        if (tx.recurrence_id) {
            itemsHtml += `
                <button class="ov-action-menu-item" onclick="window.OverviewView.toggleSkip(${id}); window.OverviewView.closeActionMenu();">
                    <span>⏭️</span> <span>${skipLabel}</span>
                </button>
            `;
        }

        itemsHtml += `
            <div style="height:1px; background:var(--border-color); margin:4px 0;"></div>
            <button class="ov-action-menu-item" style="color:#ef4444;" onclick="window.OverviewView.delete(${id}); window.OverviewView.closeActionMenu();">
                <span>🗑️</span> <span>${delLabel}</span>
            </button>
        `;

        menu.innerHTML = itemsHtml;
        document.body.appendChild(menu);

        const closeHandler = (e) => {
            if (!menu.contains(e.target) && e.target !== btn) {
                menu.remove();
                document.removeEventListener('click', closeHandler);
            }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    },

    closeActionMenu() {
        const existing = document.getElementById('ovFloatingActionMenu');
        if (existing) existing.remove();
    },

    // ── Cockpit Mode: Simplified View ──────────────────────────────────────

    setDisplayMode(mode) {
        if (mode === this._displayMode) return;
        this._displayMode = mode;

        // Persist preference
        if (window.ProfileStorage) {
            window.ProfileStorage.set('overview_display_mode', mode);
        }
        this.saveConfig({ overview_display_mode: mode });

        // Toggle root class
        const root = document.getElementById('overviewRoot');
        if (root) {
            root.classList.toggle('cockpit-active', mode === 'cockpit');
        }

        // Update toggle buttons
        const toggle = document.getElementById('ovModeToggle');
        if (toggle) {
            toggle.querySelectorAll('.overview-mode-btn').forEach(btn => {
                const isCockpit = btn.textContent.includes(window.i18n.t('overview_mode_cockpit') || 'Cockpit');
                btn.classList.toggle('active', isCockpit ? mode === 'cockpit' : mode === 'full');
            });
        }

        // Render cockpit content if switching to cockpit, or trend chart if switching to full
        if (mode === 'cockpit') {
            this._renderCockpit();
        } else if (mode === 'full') {
            if (!this._chart) {
                this._renderTrend().catch(e => console.warn('[OverviewView] Erreur trend chart:', e));
            }
        }

        console.log(`[OverviewView] Mode d'affichage changé : ${mode}`);
    },

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
        this.closeActionMenu();
        this.closeInfoSheet();
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }
};
