// overview.js — Vue d'ensemble (Overview) — Vue simplifiée & premium plein écran
window.OverviewView = {
    _chart: null,
    _unreconciledTxs: [],
    _searchQuery: '',
    _selectedAccountId: '',
    _activeTab: 'all', // 'all', 'overdue', 'expenses', 'income'
    _trendMode: 'expenses', // 'expenses', 'compare', 'balance'
    _top6Filter: 'all', // 'all', 'fixed', 'var'
    _stats: null,
    _accounts: [],
    _transactions: [],
    _accountsMap: {},
    _pastOverdueTxs: [],

    render() {
        return `
            <div id="overviewRoot" class="overview-root">
                <!-- Header / Health Badge, Account Selector & Quick Actions -->
                <div class="overview-top-bar">
                    <div class="overview-header-main">
                        <div class="overview-title-group">
                            <h2 class="overview-main-title">👀 <span data-i18n="nav_overview">${window.i18n.t('nav_overview')}</span></h2>
                            <div id="ovOrgTag" class="overview-org-tag" style="display:none;">🏢 <span data-i18n="overview_org_badge">${window.i18n.t('overview_org_badge') || 'Mode Organisation'}</span></div>
                            <div id="ovHealthBadge" class="overview-health-badge">—</div>
                        </div>
                    </div>
                    <div class="overview-controls-bar">
                        <div class="overview-acc-select-wrapper">
                            <span class="overview-acc-select-icon">🏦</span>
                            <select id="ovAccountSelect" class="overview-account-select" onchange="window.OverviewView.onAccountChange(this.value)">
                                <option value="">${window.i18n.t('overview_filter_all_accounts') || 'Tous les comptes'}</option>
                            </select>
                        </div>
                        <button class="overview-bank-sync-btn" onclick="window.BankSyncView ? window.BankSyncView.triggerBackgroundSyncNow() : window.app.loadView('accounts')" data-i18n-title="bank_sync_run_background_tooltip" title="${window.i18n.t('bank_sync_run_background_tooltip') || 'Interroge vos banques connectées en tâche de fond pour récupérer les dernières opérations, détecter les correspondances à pointer et actualiser vos soldes sans bloquer l\'interface.'}">
                            <span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne'}</span>
                        </button>
                        <button class="btn btn-primary overview-add-btn" onclick="window.OverviewView.showAddModal()" data-i18n="btn_add_operation">
                            <span>${window.i18n.t('btn_add_operation') || '➕ Nouvelle opération'}</span>
                        </button>

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
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-projection">
                        <div class="overview-hero-icon">🔮</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" data-i18n="overview_projection_title">${window.i18n.t('overview_projection_title') || 'Projection Fin de Mois'}</div>
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

                    <!-- Filter Tabs -->
                    <div class="overview-tabs-bar">
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
                API.get('/api/transactions/?limit=1000')
            ]);

            if (config) {
                if (config.overview_account_id !== undefined) {
                    this._selectedAccountId = config.overview_account_id;
                }
                if (config.overview_active_tab !== undefined) {
                    this._activeTab = config.overview_active_tab;
                }
                if (config.overview_trend_mode !== undefined) {
                    this._trendMode = config.overview_trend_mode;
                }
                if (config.overview_top6_filter !== undefined) {
                    this._top6Filter = config.overview_top6_filter;
                }
            }
            if (window.ProfileStorage) {
                const savedTop6 = window.ProfileStorage.get('overview_top6_filter');
                if (savedTop6) this._top6Filter = savedTop6;
            }

            this._stats = stats;
            this._accounts = accounts || [];
            this._transactions = transactions || [];
            this._accountsMap = {};
            this._accounts.forEach(a => { this._accountsMap[a.id] = a; });

            this._populateAccountSelect();
            this._updateActiveTabUI();
            this._updateTrendModeUI();
            this._renderHealthBadge(stats);
            this._renderHero(stats);
            await this._checkBankConnections();
            await this._renderPendingBankSyncBanner();
            this._renderUnreconciled(transactions);
            this._renderTop3(transactions);
            this._renderBudgets(stats);
            this._renderSavings(stats);
            await this._renderTrend();

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

    _populateAccountSelect() {
        const select = document.getElementById('ovAccountSelect');
        if (!select) return;

        const groups = {
            checking: { label: window.i18n.t('acc_section_checking') || 'Comptes Courants & Cartes', accounts: [] },
            savings: { label: window.i18n.t('acc_section_savings') || 'Épargne & Placements', accounts: [] },
            loans: { label: window.i18n.t('acc_section_loans') || 'Crédits & Emprunts', accounts: [] }
        };

        for (const a of this._accounts) {
            if (a.is_closed) continue;
            const t = (a.type || '').toLowerCase();
            let cat = 'checking';
            if (t.includes('prêt') || t.includes('pret') || t.includes('emprunt') || t.includes('loan') || t.includes('crédit') || t.includes('credit')) {
                cat = 'loans';
            } else if (t.includes('livret') || t.includes('saving') || t.includes('epargne') || t.includes('épargne') || t.includes('pea') || t.includes('assurance') || t.includes('per') || t.includes('titres')) {
                cat = 'savings';
            }
            groups[cat].accounts.push(a);
        }

        let html = `<option value="">${window.i18n.t('overview_filter_all_accounts') || 'Tous les comptes'}</option>`;
        ['checking', 'savings', 'loans'].forEach(k => {
            const grp = groups[k];
            if (grp.accounts.length === 0) return;
            html += `<optgroup label="${grp.label}">`;
            for (const a of grp.accounts) {
                const selected = String(a.id) === String(this._selectedAccountId) ? 'selected' : '';
                html += `<option value="${a.id}" ${selected}>${escapeHtml(a.name)} (${formatCurrency(a.balance)})</option>`;
            }
            html += `</optgroup>`;
        });

        select.innerHTML = html;
    },

    onAccountChange(accId) {
        this._selectedAccountId = accId || '';
        this.saveConfig({ overview_account_id: this._selectedAccountId });
        this._renderHero(this._stats);
        this._renderUnreconciled(this._transactions);
        this._renderTop3(this._transactions);
        this._renderBudgets(this._stats);
        this._renderSavings(this._stats);
        this._renderTrend();
    },

    async openUserPicker() {
        if (window.app && typeof window.app._showUserPicker === 'function') {
            await window.app._showUserPicker();
            await this.init();
        }
    },

    async _checkBankConnections() {
        const syncBtn = document.querySelector('.overview-bank-sync-btn');
        if (!syncBtn) return;
        try {
            const conns = await API.get('/api/bank-sync/connections');
            syncBtn.style.display = (conns && conns.length > 0) ? 'inline-flex' : 'none';
        } catch (_) {
            syncBtn.style.display = 'none';
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
            const discMsg = window.i18n && window.i18n.tp ? window.i18n.tp('bank_sync_banner_discrepancies', { count: totalDiscrepancies }) : `${totalDiscrepancies} pointée(s) en attente banque`;
            discrepancyHtml = ` • <span style="color: #d97706; font-weight: 600; cursor: help;" title="${(window.i18n ? window.i18n.t('bank_sync_discrepancy_tooltip') : 'Opérations pointées dans OmniBank mais encore en attente à la banque.').replace(/"/g, '&quot;')}">⏳ ${discMsg}</span>`;
        }

        let balanceStatusHtml = '';
        if (pendingData.accounts && pendingData.accounts.length > 0) {
            const accsWithBal = pendingData.accounts.filter(a => typeof a.bank_balance === 'number' && typeof a.local_reconciled_balance === 'number');
            if (accsWithBal.length > 0) {
                const hasDiff = accsWithBal.some(a => Math.abs(a.bank_balance - a.local_reconciled_balance) >= 0.005);
                if (hasDiff) {
                    const firstDiffAcc = accsWithBal.find(a => Math.abs(a.bank_balance - a.local_reconciled_balance) >= 0.005);
                    const diff = Math.round((firstDiffAcc.bank_balance - firstDiffAcc.local_reconciled_balance) * 100) / 100;
                    const diffFormatted = (diff > 0 ? '+' : '') + diff.toFixed(2) + ' €';
                    balanceStatusHtml = ` • <span style="color: #f59e0b; font-weight: 600;">⚠️ ${window.i18n ? window.i18n.t('bank_sync_balance_diff') || 'Écart' : 'Écart'} : ${diffFormatted}</span>`;
                } else {
                    balanceStatusHtml = ` • <span style="color: #10b981; font-weight: 600;">🟢 ${window.i18n ? window.i18n.t('bank_sync_balance_synced') || 'Soldes conformes' : 'Soldes conformes'}</span>`;
                }
            }
        }

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
                <button class="btn btn-primary btn-sm" onclick="window.BankSyncView.reconcileAllPending()" style="font-size: 12px; padding: 5px 12px; border-radius: 8px; font-weight: 700;">
                    ⚡ ${window.i18n ? window.i18n.t('bank_btn_reconcile_confirmed') || 'Rapprocher les opérations confirmées' : 'Rapprocher les opérations confirmées'} (${totalConfirmedMatches})
                </button>
                ` : ''}
                ${totalNew > 0 ? `
                <button class="btn btn-gold btn-sm" onclick="window.BankSyncView.commitAllGhosts()" style="font-size: 12px; padding: 5px 12px; border-radius: 8px; font-weight: 700;">
                    📥 ${window.i18n.t('ghost_commit_all') || 'Valider les nouvelles opérations'} (${totalNew})
                </button>
                ` : ''}
                ${pendingData.accounts && pendingData.accounts.length > 0 ? `
                <button class="btn btn-secondary btn-sm" onclick="window.BankSyncView.openPendingReviewModal()" style="font-size: 12px; padding: 5px 12px; border-radius: 8px; font-weight: 600;">
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
        if (ravLabel) {
            ravLabel.textContent = isOrgMode
                ? (window.i18n.t('overview_org_available') || 'Trésorerie Disponible')
                : (window.i18n.t('overview_rest_to_live') || 'Reste à vivre');
        }
        if (rav) {
            rav.textContent = formatCurrency(stats.rest_to_live);
            if (stats.savings_overflow) {
                rav.style.color = stats.savings_overflow.fully_consumed ? '#ef4444' : '#f59e0b';
            } else if (stats.rest_to_live < 0) {
                rav.style.color = '#ef4444';
            } else {
                rav.style.color = '#10b981';
            }
        }

        const projAmt = document.getElementById('ovProjectionAmount');
        const projSub = document.getElementById('ovProjectionSub');
        if (projAmt) {
            const today = new Date();
            const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            const todayISO = today.toISOString().split('T')[0];
            const lastDayISO = lastDay.toISOString().split('T')[0];

            let baseBalance = stats.net_worth;
            if (this._selectedAccountId && this._accountsMap[this._selectedAccountId]) {
                baseBalance = this._accountsMap[this._selectedAccountId].balance;
            }

            const upcomingTxs = (this._transactions || []).filter(tx => {
                if (tx.reconciliation_date || tx.is_skipped) return false;
                if (tx.date_operation < todayISO || tx.date_operation > lastDayISO) return false;
                if (this._selectedAccountId) {
                    return String(tx.from_account_id) === String(this._selectedAccountId) || String(tx.to_account_id) === String(this._selectedAccountId);
                }
                return true;
            });

            let projDiff = 0;
            upcomingTxs.forEach(tx => {
                if (tx.type === 'income') projDiff += tx.amount;
                else projDiff -= tx.amount;
            });

            const projectedEnd = baseBalance + projDiff;
            projAmt.textContent = formatCurrency(projectedEnd);
            projAmt.style.color = projectedEnd < 0 ? '#ef4444' : '#10b981';
            if (projSub) {
                const isEn = window.i18n.lang === 'en';
                const monthName = today.toLocaleDateString(isEn ? 'en-US' : 'fr-FR', { month: 'long' });
                const dayNum = lastDay.getDate();
                if (isOrgMode) {
                    const prefix = window.i18n.t('overview_org_forecast_sub') || (isEn ? 'Forecast organisation balance as of' : 'Solde prévisionnel de l\'organisation au');
                    projSub.textContent = `${prefix} ${dayNum} ${monthName}`;
                } else if (isEn) {
                    projSub.textContent = `Forecast balance as of ${monthName} ${dayNum}`;
                } else {
                    projSub.textContent = `Solde prévisionnel au ${dayNum} ${monthName}`;
                }
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
            const odAmtEl = document.getElementById('ovOverdraftAmount');
            if (odAmtEl) {
                odAmtEl.textContent = formatCurrency(stats.overdraft_warning.projected_balance);
                odAmtEl.style.color = '#ef4444';
            }
            document.getElementById('ovOverdraftDate').textContent = formatDate(stats.overdraft_warning.date);
        } else if (odCard) {
            odCard.style.display = 'none';
        }
    },

    _renderUnreconciled(transactions) {
        const container = document.getElementById('ovUnreconciledList');
        const badge = document.getElementById('ovUnreconciledBadge');
        if (!container) return;

        const todayISO = new Date().toISOString().split('T')[0];

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
            const q = this._searchQuery.toLowerCase();
            filtered = filtered.filter(tx =>
                (tx.description || '').toLowerCase().includes(q) ||
                (tx.category || '').toLowerCase().includes(q)
            );
            filteredGhosts = filteredGhosts.filter(g =>
                (g.description || '').toLowerCase().includes(q) ||
                (g.category || '').toLowerCase().includes(q) ||
                (g.account_name || '').toLowerCase().includes(q)
            );
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

        const isOrgMode = window.app?.config?.enable_org_mode === 'true';
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
                            ${g.smart_suggested ? `<span title="${window.i18n ? window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique' : 'Suggéré d’après votre historique'}" style="cursor:help; font-size:11px;">💡</span>` : ''}
                        </div>
                        ${rawSubHtml}
                    </td>
                    <td class="ov-td-cat">${catLabel}</td>
                    ${authorHtml}
                    <td class="ov-td-amt privacy-blur" style="color: ${amtColor}; font-weight: 700;">${amtFormatted}</td>
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

            html += `
                <tr id="ovRow_${tx.id}" class="overview-op-tr" data-id="${tx.id}">
                    <td class="ov-td-date">${renderDateWithStatus(tx)}</td>
                    <td class="ov-td-acc">${accBadgeHtml}</td>
                    <td class="ov-td-desc" title="${escapeHtml(tx.description || '')}">${escapeHtml(tx.description || '—')}</td>
                    <td class="ov-td-cat"><span class="overview-cat-badge">${escapeHtml(catLabel)}</span></td>
                    ${authorHtml}
                    <td class="ov-td-amt privacy-blur" style="color: ${amountColor}; font-weight: 700;">${formatCurrency(tx.amount)}</td>
                    <td class="ov-td-action" style="text-align: right; white-space: nowrap;">
                        <div style="display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end;">
                            ${reconBtnHtml}
                            <button class="btn btn-secondary btn-sm ov-action-menu-trigger" style="padding: 4px 8px; font-size: 14px; font-weight: 700; line-height: 1; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; height: 28px; width: 28px;" onclick="event.stopPropagation(); window.OverviewView.toggleActionMenu(${tx.id}, event)" title="${window.i18n.t('th_actions') || 'Actions'}">
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
        this._renderUnreconciled(this._unreconciledTxs);
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
        this.saveConfig({ overview_trend_mode: this._trendMode });
        this._updateTrendModeUI();
        this._renderTrend();
    },

    _updateTrendModeUI() {
        document.querySelectorAll('.ov-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${this._trendMode}'`));
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
                <div class="overview-budget-item" onclick="window.app.loadView('budgets')">
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
                <div class="overview-savings-item" onclick="window.app.loadView('budgets')">
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
                                font: { size: window.innerWidth < 768 ? 9.5 : 11 }
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: {
                                color: 'rgba(128,128,128,0.8)',
                                font: { size: window.innerWidth < 768 ? 10.5 : 12, weight: '600' }
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

        let itemsHtml = `
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

    destroy() {
        this.closeActionMenu();
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }
};
