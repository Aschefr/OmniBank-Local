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
        } else if (window.app?.config) {
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
                            <div class="overview-hero-sub" id="ovRestToLiveSub" style="display:none;"></div>
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
                    <div class="overview-hero-card overview-hero-overdraft" id="ovOverdraftCard" style="display:none;">
                        <div class="overview-hero-icon">⚠️</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" data-i18n="overview_overdraft_risk">${window.i18n.t('overview_overdraft_risk')}</div>
                            <div class="overview-hero-value privacy-blur text-red" id="ovOverdraftAmount">—</div>
                            <div class="overview-hero-sub" id="ovOverdraftDate"></div>
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
                </div>
            </div>
        `;
    },

    _initInFlight: false,
    _queuedInit: false,

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
            const [config, stats, accounts, transactions] = await Promise.all([
                API.get('/api/config/'),
                API.get('/api/stats/dashboard'),
                API.get('/api/stats/accounts'),
                API.get('/api/transactions/?limit=10000')
            ]);

            if (config) {
                if (config.overview_account_id !== undefined) {
                    this._selectedAccountId = config.overview_account_id;
                }
                if (config.overview_active_tab !== undefined) {
                    this._activeTab = config.overview_active_tab;
                }
                if (config.overview_horizon !== undefined) {
                    this._horizon = config.overview_horizon;
                }
                if (config.overview_trend_mode !== undefined) {
                    this._trendMode = config.overview_trend_mode;
                }
                if (config.overview_top6_filter !== undefined) {
                    this._top6Filter = config.overview_top6_filter;
                }
                if (config.overview_stats_granularity !== undefined) {
                    this._statsGranularity = config.overview_stats_granularity;
                }
                if (config.overview_stats_lookback !== undefined) {
                    this._statsLookback = config.overview_stats_lookback;
                }
            }
            if (window.ProfileStorage) {
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
                const savedMode = window.ProfileStorage.get('overview_display_mode');
                if (savedMode) this._displayMode = savedMode;
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
            await this._checkBankConnections();
            await this._renderPendingBankSyncBanner();
            await this._renderAutopilotWidget();
            this._renderUnreconciled(transactions);
            this._renderTop3(transactions);
            this._renderBudgets(stats);
            this._renderSavings(stats);
            await this._renderTrend();
            this._renderCockpit();

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
                API.get('/api/autopilot/decisions?limit=4', { silent: true }).catch(() => ({ items: [] }))
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
            const count = this._apStatus.unseen_decisions_count || 0;

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
                if (count > 0) {
                    badge.textContent = count > 99 ? '99+' : count;
                    badge.style.display = 'inline-block';
                } else {
                    badge.style.display = 'none';
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
                    let icon = '✨';

                    if (d.decision_type === 'reconciliation' || d.decision_type === 'reconcile') {
                        badgeClass = 'badge-emerald';
                        typeLabel = window.i18n.t('autopilot_action_reconciled') || 'Rapproché';
                        icon = '⚡';
                    } else if (d.decision_type === 'recurrence' || d.decision_type === 'recurrence_promoted' || d.decision_type === 'recurrence_promotion') {
                        badgeClass = 'badge-purple';
                        typeLabel = window.i18n.t('autopilot_action_promoted') || 'Récurrence';
                        icon = '🔄';
                    } else if (d.decision_type === 'budget' || d.decision_type === 'budget_adjustment' || d.decision_type === 'budget_suggestion') {
                        badgeClass = 'badge-amber';
                        typeLabel = window.i18n.t('autopilot_action_budget_recalibrated') || 'Budget';
                        icon = '🎯';
                    }

                    const formattedAmount = (d.amount !== null && d.amount !== undefined)
                        ? `${d.amount > 0 ? '+' : ''}${formatCurrency(d.amount)}`
                        : '';
                    const amountClass = (d.amount !== null && d.amount > 0) ? 'text-green' : 'text-main';
                    const timeStr = d.created_at ? this._formatRelativeTime(d.created_at) : '';

                    return `
                        <div class="ov-ap-decision-card">
                            <div class="ov-ap-decision-left">
                                <div class="ov-ap-decision-badge ${badgeClass}">
                                    <span>${icon}</span> <span>${typeLabel}</span>
                                </div>
                                <span class="ov-ap-decision-label" title="${escapeHtml(d.label || '')}">${escapeHtml(d.label || 'Opération')}</span>
                                ${d.category ? `<span class="ov-ap-decision-cat">${escapeHtml(d.category)}</span>` : ''}
                            </div>
                            <div class="ov-ap-decision-right">
                                <span class="ov-ap-decision-amount ${amountClass}">${formattedAmount}</span>
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
        if (!popover) return;

        this._popoverOpenedAt = Date.now();
        popover.style.display = 'block';
        if (btn) btn.setAttribute('aria-expanded', 'true');

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
        if (popover) popover.style.display = 'none';
        if (btn) btn.setAttribute('aria-expanded', 'false');
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
                triggerLabel.textContent = `${selectedAccount.name} (${formatCurrency(selectedAccount.balance)})`;
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
                            <span class="overview-acc-item-balance">${formatCurrency(a.balance)}</span>
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

    onAccountChange(accId) {
        this._selectedAccountId = accId || '';
        this.saveConfig({ overview_account_id: this._selectedAccountId });
        this._renderHero(this._stats);
        this._renderUnreconciled(this._transactions);
        this._renderTop3(this._transactions);
        this._renderBudgets(this._stats);
        this._renderSavings(this._stats);
        this._calculateAverages();
        this._renderTrend();
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

        let pendingData = null;
        if (window.BankSyncView && window.BankSyncView.loadPendingSync) {
            pendingData = await window.BankSyncView.loadPendingSync();
        } else {
            try {
                pendingData = await API.get('/api/bank-sync/pending');
            } catch (_) {}
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
            badge.className = 'overview-health-badge danger badge-danger';
            badge.textContent = window.i18n.t('overview_health_danger') || '⚠️ Risque Découvert';
        } else if (stats.rest_to_live < 0) {
            badge.className = 'overview-health-badge warning badge-warning';
            badge.textContent = window.i18n.t('overview_health_warning') || '⚡ Reste à vivre négatif';
        } else {
            badge.className = 'overview-health-badge success badge-success';
            badge.textContent = isOrgMode
                ? (window.i18n.t('overview_org_health_ok') || '✨ Trésorerie Saine')
                : (window.i18n.t('overview_health_ok') || '✨ Budget Équilibré');
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
            const odAmtEl = document.getElementById('ovOverdraftAmount');
            const odDateEl = document.getElementById('ovOverdraftDate');
            if (odAmtEl) {
                odAmtEl.textContent = formatCurrency(od.projected_balance);
                odAmtEl.style.color = '#ef4444';
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

    setStatsLookback(lookback) {
        this._statsLookback = lookback || '6m';
        if (window.ProfileStorage) {
            window.ProfileStorage.set('overview_stats_lookback', this._statsLookback);
        }
        this.saveConfig({ overview_stats_lookback: this._statsLookback });
        this._updateStatsLookbackUI();
        this._calculateAverages();
    },

    _updateStatsLookbackUI() {
        const group = document.getElementById('ovLookbackGroup');
        if (!group) return;
        group.querySelectorAll('.ov-seg-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickStr.includes(`'${this._statsLookback}'`));
        });
    },

    _calculateAverages() {
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
                    }
                }
            } else {
                if (tx.type === 'income') {
                    totalIncome += amt;
                } else if (tx.type === 'expense_fixed') {
                    totalFixed += amt;
                } else if (tx.type === 'expense_var') {
                    totalVar += amt;
                } else if (tx.type !== 'transfer') {
                    totalVar += amt;
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

        const daysInMonth = 365.25 / 12;
        this._cachedMonthlyAverages = {
            income: dailyIncome * daysInMonth,
            fixed: dailyFixed * daysInMonth,
            variable: dailyVar * daysInMonth
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

        // Render cockpit content if switching to cockpit
        if (mode === 'cockpit') {
            this._renderCockpit();
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

        // ── Gauge 1: Reste à vivre (% du revenu moyen) & Rentrées prévues ──
        const ravInfo = this._getRestToLiveInfo(stats);
        const rav = ravInfo.rav;
        const plannedInc = ravInfo.plannedInc;
        const ravWithInc = ravInfo.ravWithInc;

        const avgIncome = this._cachedMonthlyAverages?.income || 0;
        let ravPercent = avgIncome > 0 ? Math.round((rav / avgIncome) * 100) : 0;
        ravPercent = Math.max(0, Math.min(ravPercent, 100));

        let plannedPercent = avgIncome > 0 ? Math.round((ravWithInc / avgIncome) * 100) : 0;
        plannedPercent = Math.max(0, Math.min(plannedPercent, 100));

        let ravColorClass = 'gauge-green';
        if (ravPercent < 20) ravColorClass = 'gauge-red';
        else if (ravPercent < 50) ravColorClass = 'gauge-orange';

        const ravDetailText = avgIncome > 0
            ? (tp('cockpit_rav_detail', { income: formatCurrency(avgIncome) }, `sur ${formatCurrency(avgIncome)} de revenus`))
            : (t('cockpit_no_income_data', 'Pas de données de revenus'));

        let plannedSubHtml = '';
        let plannedTooltip = '';
        let gaugeTooltip = avgIncome > 0
            ? tp('cockpit_rav_detail', { income: formatCurrency(avgIncome) }, `sur ${formatCurrency(avgIncome)} de revenus`)
            : t('cockpit_no_income_data', 'Pas de données de revenus');

        const showPlannedArc = plannedInc > 0 && plannedPercent > ravPercent;
        const plannedVariant = ravWithInc >= 0 ? 'planned-green' : (plannedPercent >= 20 ? 'planned-orange' : 'planned-red');

        if (plannedInc > 0) {
            const subText = tp('overview_rav_planned_income', { income: formatCurrency(plannedInc), total: formatCurrency(ravWithInc) }, `+${formatCurrency(plannedInc)} prévus (→ ${formatCurrency(ravWithInc)})`);
            plannedTooltip = tp('overview_rav_planned_income_tooltip', { income: formatCurrency(plannedInc), total: formatCurrency(ravWithInc) }, `Reste à vivre avec encaissement des recettes prévues (+${formatCurrency(plannedInc)}) : ${formatCurrency(ravWithInc)}`);
            plannedSubHtml = `<div class="cockpit-gauge-planned" title="${plannedTooltip}">${subText}</div>`;
            gaugeTooltip = tp('cockpit_rav_gauge_tooltip', {
                rav: formatCurrency(rav),
                percent: ravPercent,
                income: formatCurrency(plannedInc),
                total: formatCurrency(ravWithInc),
                planned_percent: plannedPercent
            }, `Reste à vivre : ${formatCurrency(rav)} (${ravPercent}%). Rentrées prévues non validées : +${formatCurrency(plannedInc)} (soit jusqu'à ${formatCurrency(ravWithInc)}, ${plannedPercent}%).`);
        }

        // ── Cycle calculation (Pay-cycle or calendar month) ──
        const today = new Date();
        let cycleStart, cycleEnd, cycleDayLabel;
        const isOrgMode = window.app?.config?.enable_org_mode === 'true' || window.app?.config?.enable_org_mode === true;

        if (stats.next_pay_date && !isOrgMode) {
            // Cycle basé sur la paye
            cycleEnd = new Date(stats.next_pay_date);
            // Approximation : le cycle a commencé il y a ~30 jours avant la prochaine paye
            cycleStart = new Date(cycleEnd);
            cycleStart.setDate(cycleStart.getDate() - 30);
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

        // ── Gauge 2: Dépenses prévues rapprochées ──
        const accIdStr = this._selectedAccountId ? String(this._selectedAccountId) : null;
        let cycleReconciledExpenses = 0;
        let cyclePlannedExpenses = 0;

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

            if (tx.reconciliation_date) {
                cycleReconciledExpenses += amt;
            } else {
                cyclePlannedExpenses += amt;
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

        const totalCycleExpenses = cycleReconciledExpenses + cyclePlannedExpenses;
        let expensesPercent = 0;
        if (totalCycleExpenses > 0) {
            expensesPercent = Math.min(100, Math.round((cycleReconciledExpenses / totalCycleExpenses) * 100));
        } else {
            expensesPercent = 100;
        }

        let expensesColorClass = 'gauge-indigo';
        if (expensesPercent >= 90) expensesColorClass = 'gauge-green';
        else if (expensesPercent >= 50) expensesColorClass = 'gauge-indigo';
        else expensesColorClass = 'gauge-purple';

        const expensesTooltip = tp('cockpit_expenses_gauge_tooltip', {
            reconciled: formatCurrency(cycleReconciledExpenses),
            total: formatCurrency(totalCycleExpenses),
            percent: expensesPercent,
            remaining: formatCurrency(cyclePlannedExpenses)
        }, `${formatCurrency(cycleReconciledExpenses)} pointés sur ${formatCurrency(totalCycleExpenses)} prévus (${expensesPercent}%). Reste ${formatCurrency(cyclePlannedExpenses)} à débiter.`);

        const expensesDetailText = cyclePlannedExpenses > 0
            ? tp('cockpit_expenses_reconciled_detail', { reconciled: formatCurrency(cycleReconciledExpenses), total: formatCurrency(totalCycleExpenses) }, `${formatCurrency(cycleReconciledExpenses)} sur ${formatCurrency(totalCycleExpenses)} prévus`)
            : t('cockpit_expenses_all_reconciled', 'Toutes dépenses prévues pointées');

        const expensesSubText = cyclePlannedExpenses > 0
            ? `${tp('cockpit_expenses_remaining_planned', { remaining: formatCurrency(cyclePlannedExpenses) }, `Reste ${formatCurrency(cyclePlannedExpenses)} à venir`)} • 📅 ${remainingDays}j`
            : `📅 ${cycleDetailText} (${cycleDayLabel})`;

        // ── Gauge 3: Cadence Budgétaire (Option C : Rythme de Dépense vs Temps) ──
        const timeRatio = Math.max(0.01, elapsedDays / totalCycleDays);
        const timePercent = Math.min(100, Math.max(1, Math.round(timeRatio * 100)));

        const monthlyBudgetTarget = stats.budget_summary?.monthly?.target || 0;
        const avgExpenses = Math.abs(this._cachedMonthlyAverages?.expense || 0);
        const cadenceRef = totalCycleExpenses > 0
            ? totalCycleExpenses
            : (monthlyBudgetTarget > 0 ? monthlyBudgetTarget : (avgExpenses > 0 ? avgExpenses : 1));

        const spentRatio = Math.max(0, cycleReconciledExpenses / cadenceRef);
        const spentPercent = Math.round(spentRatio * 100);

        let cadenceRatio = 1.0;
        if (elapsedDays === 0 || cycleReconciledExpenses === 0) {
            cadenceRatio = 1.0;
        } else {
            cadenceRatio = spentRatio / timeRatio;
        }

        const cadenceDisplayPercent = Math.min(150, Math.max(0, Math.round(cadenceRatio * 100)));
        const cadenceArcPercent = Math.min(100, Math.max(5, cadenceDisplayPercent));

        let cadenceColorClass = 'cadence-green';
        let cadenceStatusClass = 'status-green';
        let cadenceStatusText = t('cockpit_cadence_steady', 'Rythme maîtrisé');
        let cadenceSubText = '';

        const diffPercent = Math.round(Math.abs(cadenceRatio - 1.0) * 100);

        if (cadenceRatio <= 0.90) {
            cadenceColorClass = 'cadence-green';
            cadenceStatusClass = 'status-green';
            cadenceStatusText = t('cockpit_cadence_steady', 'Rythme maîtrisé');
            cadenceSubText = tp('cockpit_cadence_sub_under', { diff: diffPercent }, `-${diffPercent}% sous la cadence`);
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

        const cadenceDetailText = tp('cockpit_cadence_detail', {
            spent: formatCurrency(cycleReconciledExpenses),
            day: elapsedDays,
            total_days: totalCycleDays
        }, `${formatCurrency(cycleReconciledExpenses)} au jour ${elapsedDays}/${totalCycleDays}`);

        const cadenceTooltip = tp('cockpit_cadence_gauge_tooltip', {
            cadence: cadenceDisplayPercent,
            spent_pct: spentPercent,
            time_pct: timePercent,
            status: cadenceStatusText
        }, `Cadence budgétaire : ${cadenceDisplayPercent}%. Dépenses réelles à ${spentPercent}% pour ${timePercent}% du cycle écoulé (${cadenceStatusText}).`);

        // ── Build Gauges HTML ──
        gaugesContainer.innerHTML = `
            <div class="cockpit-gauge-card ${ravColorClass}" data-gauge="rav" title="${gaugeTooltip}">
                <div class="cockpit-gauge-wrapper">
                    ${this._buildGaugeSVG(ravPercent, 'rav', showPlannedArc ? plannedPercent : null, plannedTooltip, plannedVariant)}
                    <div class="cockpit-gauge-center">
                        <div class="cockpit-gauge-percent">${ravPercent}%</div>
                        <div class="cockpit-gauge-sublabel">${t('cockpit_rav_label', 'Reste à vivre')}</div>
                    </div>
                </div>
                <div class="cockpit-gauge-caption">
                    <div class="cockpit-gauge-amount privacy-blur">${formatCurrency(rav)}</div>
                    ${plannedSubHtml}
                    <div class="cockpit-gauge-detail">${ravDetailText}</div>
                </div>
            </div>
            <div class="cockpit-gauge-card ${expensesColorClass}" data-gauge="expenses" title="${expensesTooltip}">
                <div class="cockpit-gauge-wrapper">
                    ${this._buildGaugeSVG(expensesPercent, 'expenses')}
                    <div class="cockpit-gauge-center">
                        <div class="cockpit-gauge-percent">${expensesPercent}%</div>
                        <div class="cockpit-gauge-sublabel">${t('cockpit_expenses_reconciled_label', 'Dépenses pointées')}</div>
                    </div>
                </div>
                <div class="cockpit-gauge-caption">
                    <div class="cockpit-gauge-amount privacy-blur">${formatCurrency(cycleReconciledExpenses)}</div>
                    <div class="cockpit-gauge-detail" style="font-weight:600; color:var(--text-main); margin-top:3px;">${expensesDetailText}</div>
                    <div class="cockpit-gauge-detail" style="color:var(--text-muted); font-size:11px; margin-top:2px;">${expensesSubText}</div>
                </div>
            </div>
            <div class="cockpit-gauge-card ${cadenceColorClass}" data-gauge="cadence" title="${cadenceTooltip}">
                <div class="cockpit-gauge-wrapper">
                    ${this._buildGaugeSVG(cadenceArcPercent, 'cadence')}
                    <div class="cockpit-gauge-center">
                        <div class="cockpit-gauge-percent">${cadenceDisplayPercent}%</div>
                        <div class="cockpit-gauge-sublabel">${t('cockpit_cadence_label', 'Cadence')}</div>
                    </div>
                </div>
                <div class="cockpit-gauge-caption">
                    <div class="cockpit-cadence-status ${cadenceStatusClass}">${cadenceStatusText}</div>
                    <div class="cockpit-gauge-detail" style="font-weight:600; color:var(--text-main); margin-top:3px;">${cadenceSubText}</div>
                    <div class="cockpit-gauge-detail" style="color:var(--text-muted); font-size:11px; margin-top:2px;">${cadenceDetailText}</div>
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

        // Card 2: AutoPilot Status
        const apStatus = this._apStatus || {};
        const apEnabled = !!apStatus.is_enabled;
        const apCount = apStatus.unseen_decisions_count || 0;
        const apBadgeClass = apEnabled ? 'badge-active' : 'badge-inactive';
        const apDotClass = apEnabled ? 'active' : 'inactive';
        const apLabel = apEnabled
            ? (t('autopilot_status_active', '🟢 Actif'))
            : (t('autopilot_status_inactive', '⚪ En veille'));

        // Card 3: Operations to reconcile
        const unreconciledCount = this._getCockpitUnreconciledCount();

        cardsContainer.innerHTML = `
            <div class="cockpit-compact-card" title="${proj.tooltipText}">
                <div class="cockpit-card-header">
                    <div class="cockpit-card-title">
                        <span class="cockpit-card-icon">🔮</span>
                        <span>${projTitle}</span>
                    </div>
                </div>
                <div class="cockpit-card-value privacy-blur ${projColorClass}">${formatCurrency(projAmount)}</div>
                <div class="cockpit-card-sub">${projSubText}</div>
            </div>
            <div class="cockpit-compact-card clickable" onclick="window.OverviewView.showAutopilotPopover()">
                <div class="cockpit-card-header">
                    <div class="cockpit-card-title">
                        <span class="cockpit-card-icon">🎯</span>
                        <span>AutoPilot</span>
                    </div>
                    <span class="cockpit-card-badge ${apBadgeClass}">
                        <span class="cockpit-ap-dot ${apDotClass}"></span>
                        ${apEnabled ? (t('cockpit_ap_active', 'Actif')) : (t('cockpit_ap_inactive', 'Veille'))}
                    </span>
                </div>
                <div class="cockpit-card-sub" style="margin-top: auto;">
                    ${apCount > 0
                        ? `<span class="cockpit-ap-actions">⚡ ${apCount} ${t('cockpit_ap_actions', 'action' + (apCount > 1 ? 's récentes' : ' récente'))}</span>`
                        : `<span style="color:var(--text-muted); font-size: 12px;">${t('cockpit_ap_no_actions', 'Aucune action en attente')}</span>`
                    }
                </div>
            </div>
            <div class="cockpit-compact-card clickable" onclick="window.OverviewView.setDisplayMode('full')">
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

            const cadenceArc = document.getElementById('cockpitArc_cadence');
            if (cadenceArc) {
                const target = circumference - (cadenceArcPercent / 100) * circumference;
                cadenceArc.style.strokeDashoffset = target;
            }
        });
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

    destroy() {
        this.closeActionMenu();
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }
};
