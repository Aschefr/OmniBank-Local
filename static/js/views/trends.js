// trends.js — Tendances (Chart.js)
window.TrendsView = {
    accounts: [],
    selectedAccountId: null,
    chart: null,
    historyData: [],
    _catData: null, // categories_by_month data for expense/compare/balance modes
    _cachedTrends: {}, // accountId -> history array
    _cachedCatData: {}, // `${months}_${accountId}` -> catData object
    destroy() {
        if (this.chart) {
            this.chart.destroy();
            this.chart = null;
        }
    },
        // State
    timeframeMonths: 12,
    showOtherYears: false,
    alignmentType: 'rolling', // 'rolling' or 'calendar'
    selectedYears: [], // offsets (e.g. [1, 2]) selected for display. If empty, show all available.
    focusedOffset: null, // offset of the year/period currently highlighted
    savedAccountId: null,
    chartMode: 'history', // 'history', 'expenses', 'compare', 'balance'

    render() {
        const superimposeActive = this.showOtherYears;
        const switchBg = superimposeActive ? 'var(--accent, #6366f1)' : 'var(--bg-base)';
        const switchBorder = superimposeActive ? 'var(--accent, #6366f1)' : 'var(--border-color)';
        const sliderTransform = superimposeActive ? 'translateX(16px)' : 'translateX(0)';
        const sliderBg = superimposeActive ? '#ffffff' : 'var(--text-muted)';

        return `
        <div id="trendsViewRoot" class="${superimposeActive ? 'trends-with-alignment' : ''}">
            <style>
                @media (min-width: 992px) {
                    body {
                        overflow: hidden !important;
                    }
                    .trends-split-layout {
                        height: calc(100vh - 330px);
                        min-height: 300px;
                        display: flex;
                        gap: 20px;
                        flex-wrap: wrap;
                        margin-bottom: 24px;
                        align-items: stretch;
                    }
                    .trends-with-alignment .trends-split-layout {
                        height: calc(100vh - 400px);
                    }
                    .trends-chart-pane, .trends-table-pane {
                        height: 100% !important;
                    }
                }
            </style>

            <div class="view-header-bar">
                <div class="view-header-title-group">
                    <h2 class="view-header-title">📉 <span data-i18n="nav_trends">${window.i18n.t('nav_trends')}</span></h2>
                </div>
                <div class="view-header-toolbar">
                    <div class="filter-pill">
                        <span class="filter-pill-label">🏦 <span data-i18n="trends_label_account">${window.i18n.t('trends_label_account')}</span></span>
                        <select id="trendsAccountSelect" class="filter-pill-select" style="min-width:140px;" onchange="window.TrendsView.onAccountChange(this.value)">
                            <option value="" data-i18n="trends_opt_loading">${window.i18n.t('trends_opt_loading')}</option>
                        </select>
                    </div>
                    
                    <div class="filter-pill">
                        <span class="filter-pill-label">📅 <span data-i18n="trends_label_period">${window.i18n.t('trends_label_period')}</span></span>
                        <select id="trendsTimeframeSelect" class="filter-pill-select" style="min-width:80px;" onchange="window.TrendsView.onTimeframeChange(this.value)">
                            <option value="1" data-i18n="trends_1m">${window.i18n.t('trends_1m')}</option>
                            <option value="3" data-i18n="trends_3m">${window.i18n.t('trends_3m')}</option>
                            <option value="6" data-i18n="trends_6m">${window.i18n.t('trends_6m')}</option>
                            <option value="9" data-i18n="trends_9m">${window.i18n.t('trends_9m')}</option>
                            <option value="12" selected data-i18n="trends_1y">${window.i18n.t('trends_1y')}</option>
                            <option value="24" data-i18n="trends_2y">${window.i18n.t('trends_2y')}</option>
                            <option value="60" data-i18n="trends_5y">${window.i18n.t('trends_5y')}</option>
                            <option value="all" data-i18n="trends_all">${window.i18n.t('trends_all')}</option>
                        </select>
                    </div>
                    
                    <div class="filter-pill">
                        <span class="filter-pill-label">📊 <span data-i18n="trends_align_type">${window.i18n.t('trends_align_type')}</span></span>
                        <select id="trendsAlignmentSelect" class="filter-pill-select" style="min-width:90px;" onchange="window.TrendsView.onAlignmentChange(this.value)">
                            <option value="rolling" ${this.alignmentType === 'rolling' ? 'selected' : ''} data-i18n="trends_align_rolling">${window.i18n.t('trends_align_rolling')}</option>
                            <option value="calendar" ${this.alignmentType === 'calendar' ? 'selected' : ''} data-i18n="trends_align_calendar">${window.i18n.t('trends_align_calendar')}</option>
                        </select>
                    </div>

                    <div class="filter-pill">
                        <label class="filter-pill-toggle">
                            <span data-i18n="trends_superimpose">${window.i18n.t('trends_superimpose')}</span>
                            <span class="toggle-switch">
                                <input type="checkbox" id="trendsOtherYearsCheck" onchange="window.TrendsView.onOtherYearsChange(this.checked)" ${superimposeActive ? 'checked' : ''}>
                                <span class="slider"></span>
                            </span>
                        </label>
                    </div>
                </div>
            </div>

            <!-- Contextual Years Filtering (visible only when superimposing) -->
            <div id="trendsYearsSelectorContainer" style="display:none;align-items:center;gap:10px;margin-bottom:20px;background:var(--bg-surface);border:1px solid var(--border-color);border-radius:12px;padding:10px 18px;flex-wrap:wrap;">
                <span style="font-size:13px;font-weight:600;color:var(--text-main);" data-i18n="trends_select_years">${window.i18n.t('trends_select_years')}</span>
                <div id="trendsYearsCheckboxes" style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;"></div>
            </div>

            <!-- Chart Mode Toggle -->
            <div class="overview-trend-mode-toggle" style="margin-bottom:16px;">
                <button class="ov-mode-btn ${this.chartMode === 'history' ? 'active' : ''}" onclick="window.TrendsView.setChartMode('history')" data-i18n="trends_mode_history">${window.i18n.t('trends_mode_history')}</button>
                <button class="ov-mode-btn ${this.chartMode === 'expenses' ? 'active' : ''}" onclick="window.TrendsView.setChartMode('expenses')" data-i18n="trends_mode_expenses">${window.i18n.t('trends_mode_expenses')}</button>
                <button class="ov-mode-btn ${this.chartMode === 'compare' ? 'active' : ''}" onclick="window.TrendsView.setChartMode('compare')" data-i18n="trends_mode_compare">${window.i18n.t('trends_mode_compare')}</button>
                <button class="ov-mode-btn ${this.chartMode === 'balance' ? 'active' : ''}" onclick="window.TrendsView.setChartMode('balance')" data-i18n="trends_mode_balance">${window.i18n.t('trends_mode_balance')}</button>
            </div>

            <!-- Stats Grid -->
            <div id="trendsStatsGrid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 24px;">
            </div>

            <!-- Split Layout Container for Chart & Table -->
            <div class="trends-split-layout">
                <!-- Chart (Left pane: 70% or 100% on small screens) -->
                <div class="trends-chart-pane" style="flex:2 1 65%; min-width:320px; background:var(--bg-body); border:1px solid var(--border-color); border-radius:12px; padding:24px; position:relative; display:flex; flex-direction:column; justify-content:center;">
                    <canvas id="trendsChart"></canvas>
                    <button onclick="window.TrendsView.resetZoom()" class="btn btn-secondary" style="position:absolute;top:15px;right:15px;font-size:11px;padding:6px 12px;border-radius:8px;display:flex;align-items:center;gap:6px;box-shadow:var(--shadow-sm);border:1px solid var(--border-color);transition:all 0.2s ease;">
                        <span style="font-size:12px;">🔍</span> <span data-i18n="trends_reset_zoom">${window.i18n.t('trends_reset_zoom')}</span>
                    </button>
                </div>

                <!-- Comparative Table (Right pane: 30% or 100% on small screens) -->
                <div id="trendsComparisonContainer" class="trends-table-pane" style="display:none; flex:1 1 30%; min-width:300px; background:var(--bg-surface); border:1px solid var(--border-color); border-radius:12px; padding:20px; overflow-y:auto;">
                    <h3 style="margin-top:0;margin-bottom:15px;font-size:14px;color:var(--text-main);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">📊 Comparatif détaillé</h3>
                    <table class="data-table" style="width:100%; border-collapse:collapse; font-size:12px;">
                        <thead>
                            <tr style="border-bottom:1px solid var(--border-color);">
                                <th style="text-align:left; padding:8px 6px;" data-i18n="trends_th_year">${window.i18n.t('trends_th_year')}</th>
                                <th style="text-align:right; padding:8px 6px;" data-i18n="trends_th_variation">${window.i18n.t('trends_th_variation')}</th>
                                <th style="text-align:right; padding:8px 6px;" data-i18n="trends_th_average">${window.i18n.t('trends_th_average')}</th>
                                <th style="text-align:center; padding:8px 6px; width:70px;" data-i18n="trends_th_actions">${window.i18n.t('trends_th_actions')}</th>
                            </tr>
                        </thead>
                        <tbody id="trendsComparisonBody">
                        </tbody>
                    </table>
                </div>
            </div>

            ${this._renderExtras()}
        </div>`;
    },

    // ── Averages & pace + top expenses (moved here from the former full dashboard) ──
    _rhythmLookback: '6m',
    _rhythmGranularity: 'month',
    _top6Filter: 'all',

    _renderExtras() {
        const t = (k, f) => window.i18n.t(k) || f;
        const ps = window.ProfileStorage;
        if (ps) {
            this._rhythmLookback = ps.get('overview_stats_lookback') || this._rhythmLookback;
            this._rhythmGranularity = ps.get('overview_stats_granularity') || this._rhythmGranularity;
            this._top6Filter = ps.get('overview_top6_filter') || this._top6Filter;
        }
        const seg = (setter, value, current, label, key) =>
            `<button class="ov-seg-btn ${current === value ? 'active' : ''}" onclick="window.TrendsView.${setter}('${value}')" data-i18n="${key}">${t(key, label)}</button>`;
        const badge = (cls, key, label, id) => `
                        <div class="overview-rhythm-badge ${cls}">
                            <div class="overview-badge-dot"></div>
                            <div class="overview-badge-info">
                                <span class="overview-badge-label" data-i18n="${key}">${t(key, label)}</span>
                                <div class="overview-badge-value-wrapper">
                                    <span class="overview-badge-value privacy-blur" id="trRhythm${id}">—</span>
                                    <span class="overview-badge-unit trRhythmUnit"></span>
                                </div>
                            </div>
                        </div>`;
        const lb = this._rhythmLookback, gr = this._rhythmGranularity, tf = this._top6Filter;
        return `
            <div class="trends-extras">
                <div class="overview-rhythm-strip" id="trRhythmStrip">
                    <div class="overview-rhythm-header">
                        <div class="overview-rhythm-title">
                            <span class="overview-rhythm-icon">⏱️</span>
                            <span class="overview-rhythm-label" data-i18n="overview_rhythm_title">${t('overview_rhythm_title', 'Moyennes & Rythme')}</span>
                        </div>
                        <div class="overview-rhythm-controls">
                            <div class="overview-rhythm-control-group">
                                <span class="overview-control-label" data-i18n="overview_lookback_label">${t('overview_lookback_label', 'Période :')}</span>
                                <div class="overview-rhythm-segmented" id="trLookbackGroup">
                                    ${seg('setRhythmLookback', 'all', lb, 'Tout', 'overview_lookback_all')}
                                    ${seg('setRhythmLookback', '12m', lb, '1 an', 'overview_lookback_12m')}
                                    ${seg('setRhythmLookback', '6m', lb, '6m', 'overview_lookback_6m')}
                                    ${seg('setRhythmLookback', '3m', lb, '3m', 'overview_lookback_3m')}
                                    ${seg('setRhythmLookback', '1m', lb, '1m', 'overview_lookback_1m')}
                                    ${seg('setRhythmLookback', '1w', lb, '1 sem.', 'overview_lookback_1w')}
                                </div>
                            </div>
                            <div class="overview-rhythm-control-group">
                                <span class="overview-control-label" data-i18n="overview_granularity_label">${t('overview_granularity_label', 'Affichage :')}</span>
                                <div class="overview-rhythm-segmented" id="trGranularityGroup">
                                    ${seg('setRhythmGranularity', 'month', gr, 'Mois', 'overview_granularity_month')}
                                    ${seg('setRhythmGranularity', 'week', gr, 'Semaine', 'overview_granularity_week')}
                                    ${seg('setRhythmGranularity', 'day', gr, 'Jour', 'overview_granularity_day')}
                                    ${seg('setRhythmGranularity', 'hour', gr, 'Heure', 'overview_granularity_hour')}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="overview-rhythm-badges">
                        ${badge('badge-income', 'overview_rhythm_income', 'Revenus', 'Income')}
                        ${badge('badge-fixed', 'overview_rhythm_fixed', 'Dépenses Fixes', 'Fixed')}
                        ${badge('badge-var', 'overview_rhythm_var', 'Dépenses Variables', 'Var')}
                        ${badge('badge-net', 'overview_rhythm_net', 'Solde Net', 'Net')}
                    </div>
                </div>

                <div class="overview-card overview-card-top3 trends-top6-card">
                    <div class="overview-card-header" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
                        <h3 style="margin:0;">🏆 <span data-i18n="overview_top3_expenses">${t('overview_top3_expenses', 'Top 6 Dépenses du mois')}</span></h3>
                        <div class="ov-mode-selector" id="trTop6Filter" style="display:inline-flex; gap:2px;">
                            <button class="ov-mode-btn ${tf === 'all' ? 'active' : ''}" onclick="window.TrendsView.setTop6Filter('all')" data-i18n="filter_top6_all">${t('filter_top6_all', 'Tous')}</button>
                            <button class="ov-mode-btn ${tf === 'fixed' ? 'active' : ''}" onclick="window.TrendsView.setTop6Filter('fixed')" data-i18n="filter_top6_fixed">${t('filter_top6_fixed', 'Fixes')}</button>
                            <button class="ov-mode-btn ${tf === 'var' ? 'active' : ''}" onclick="window.TrendsView.setTop6Filter('var')" data-i18n="filter_top6_var">${t('filter_top6_var', 'Variables')}</button>
                        </div>
                    </div>
                    <div id="trTop6List" class="overview-top3-list"><div class="overview-loading">⏳</div></div>
                </div>
            </div>`;
    },

    _extrasAccountParam(name) {
        const id = this.selectedAccountId;
        return id && id !== 'total' ? `&${name}=${id}` : '';
    },

    async _loadExtras() {
        await Promise.all([this._loadRhythm(), this._loadTop6()]);
    },

    async _loadRhythm() {
        try {
            this._rhythm = await API.get(`/api/stats/rhythm?lookback=${this._rhythmLookback}${this._extrasAccountParam('account_id')}`);
        } catch (e) {
            console.warn('[trends] rhythm', e);
            this._rhythm = null;
        }
        this._renderRhythm();
    },

    _renderRhythm() {
        const a = this._rhythm || { income: 0, fixed: 0, variable: 0 };
        const units = {
            month: [1, 'unit_per_month', '/ mois'],
            week: [52 / 12, 'unit_per_week', '/ sem.'],
            day: [365.25 / 12, 'unit_per_day', '/ jour'],
            hour: [(365.25 * 24) / 12, 'unit_per_hour', '/ heure']
        };
        const [divisor, unitKey, unitFallback] = units[this._rhythmGranularity] || units.month;
        const set = (id, v) => {
            const el = document.getElementById(`trRhythm${id}`);
            if (el) el.textContent = formatCurrency(v / divisor);
        };
        set('Income', a.income);
        set('Fixed', a.fixed);
        set('Var', a.variable);
        const net = (a.income - a.fixed - a.variable) / divisor;
        const netEl = document.getElementById('trRhythmNet');
        if (netEl) {
            netEl.textContent = `${net > 0 ? '+' : ''}${formatCurrency(net)}`;
            netEl.style.color = net >= 0 ? '#10b981' : '#ef4444';
        }
        const unit = window.i18n.t(unitKey) || unitFallback;
        document.querySelectorAll('.trRhythmUnit').forEach(el => { el.textContent = unit; });
    },

    _setSegActive(groupId, value) {
        document.querySelectorAll(`#${groupId} .ov-seg-btn, #${groupId} .ov-mode-btn`).forEach(btn => {
            btn.classList.toggle('active', (btn.getAttribute('onclick') || '').includes(`'${value}'`));
        });
    },

    async setRhythmLookback(value) {
        this._rhythmLookback = value;
        if (window.ProfileStorage) window.ProfileStorage.set('overview_stats_lookback', value);
        this._setSegActive('trLookbackGroup', value);
        await this._loadRhythm();
    },

    setRhythmGranularity(value) {
        this._rhythmGranularity = value;
        if (window.ProfileStorage) window.ProfileStorage.set('overview_stats_granularity', value);
        this._setSegActive('trGranularityGroup', value);
        this._renderRhythm();
    },

    async _loadTop6() {
        try {
            this._top6Data = await API.get(`/api/stats/categories_by_month?months=1${this._extrasAccountParam('account_ids')}`);
        } catch (e) {
            console.warn('[trends] top6', e);
            this._top6Data = null;
        }
        this._renderTop6();
    },

    _renderTop6() {
        const container = document.getElementById('trTop6List');
        if (!container) return;
        const data = this._top6Data;
        const month = data && data.months ? data.months[data.months.length - 1] : null;
        const types = this._top6Filter === 'fixed' ? ['expense_fixed']
            : this._top6Filter === 'var' ? ['expense_var'] : ['expense_fixed', 'expense_var'];
        const catMap = {};
        types.forEach(type => {
            const cats = (data && data.by_type && data.by_type[type] && data.by_type[type].categories) || {};
            Object.keys(cats).forEach(cat => {
                const amt = Math.abs(cats[cat][month] || 0);
                if (amt) catMap[cat] = (catMap[cat] || 0) + amt;
            });
        });
        const top6 = Object.keys(catMap)
            .map(c => ({ category: c, amount: catMap[c] }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 6);
        if (!top6.length) {
            container.innerHTML = `<div class="overview-empty">— ${window.i18n.t('overview_no_expenses_this_month') || 'Aucune dépense ce mois-ci'} —</div>`;
            return;
        }
        const maxAmt = top6[0].amount || 1;
        const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'];
        const tooltip = escapeHtml(window.i18n.t('overview_top3_click_tooltip') || "Voir les opérations dans l'historique");
        container.innerHTML = top6.map((item, i) => {
            const cat = escapeHtml(item.category);
            const catForJs = cat.replace(/'/g, "\\'");
            return `
                <div class="overview-top3-item overview-top3-item-clickable" onclick="window.TrendsView.drillDownToHistory('${catForJs}', '${month}')" title="${tooltip}">
                    <div class="overview-top3-header">
                        <span class="overview-top3-name">${medals[i]} ${cat}</span>
                        <span class="overview-top3-amt privacy-blur">${formatCurrency(item.amount)}</span>
                    </div>
                    <div class="overview-top3-bar-bg">
                        <div class="overview-top3-bar-fill" style="width: ${Math.round((item.amount / maxAmt) * 100)}%;"></div>
                    </div>
                </div>`;
        }).join('');
    },

    setTop6Filter(mode) {
        this._top6Filter = mode;
        if (window.ProfileStorage) window.ProfileStorage.set('overview_top6_filter', mode);
        this._setSegActive('trTop6Filter', mode);
        this._renderTop6();
    },

    drillDownToHistory(category, monthKey) {
        window.AllOperationsView.pendingFilter = {
            category,
            monthKey,
            type: this._top6Filter === 'fixed' ? 'expense_fixed' : this._top6Filter === 'var' ? 'expense_var' : '',
            backToView: 'trends'
        };
        window.app.loadView('all_operations');
    },

    async init() {
        // Appliquer la configuration existante immédiatement si disponible
        if (window.app && window.app.config) {
            this._applyConfig(window.app.config);
        } else {
            await this.loadConfig();
        }

        // Peupler immédiatement les comptes si déjà en mémoire
        const knownAccounts = (this.accounts && this.accounts.length > 0) ? this.accounts : window.app.accounts;
        const knownMainAcc = window.app.mainAccount;

        let didSWR = false;
        if (knownAccounts && knownAccounts.length > 0) {
            this._populateAccountSelect(knownAccounts, knownMainAcc);
            const accId = this.selectedAccountId;
            const months = this.timeframeMonths === 'all' ? 120 : this.timeframeMonths;
            const catKey = `${months}_${accId}`;

            // SWR : Si des données pour ce compte sont en cache, afficher le graphique instantanément
            if (this._cachedTrends && this._cachedTrends[accId]) {
                this.historyData = this._cachedTrends[accId];
                if (this._cachedCatData && this._cachedCatData[catKey]) {
                    this._catData = this._cachedCatData[catKey];
                }
                this.updateAlignmentVisibility();
                this.renderChart();
                didSWR = true;
            }
        }

        await this.loadAccounts(didSWR);
    },

    async loadConfig() {
        try {
            const config = (window.app && window.app.config) ? window.app.config : await API.get('/api/config');
            this._applyConfig(config);
        } catch(e) {
            console.error('TrendsView loadConfig error:', e);
        }
    },

    _applyConfig(config) {
        if (!config) return;
        if (config.trends_superimpose !== undefined) {
            this.showOtherYears = config.trends_superimpose === 'true';
        }
        if (config.trends_alignment_type !== undefined) {
            this.alignmentType = config.trends_alignment_type;
        }
        if (config.trends_timeframe_months !== undefined) {
            const val = config.trends_timeframe_months;
            this.timeframeMonths = val === 'all' ? 'all' : parseInt(val, 10);
        }
        if (config.trends_account_id !== undefined) {
            this.savedAccountId = config.trends_account_id;
        }
        if (config.trends_chart_mode !== undefined) {
            this.chartMode = config.trends_chart_mode;
        }
    },

    async saveConfig(updates) {
        try {
            await API.post('/api/config', updates);
        } catch(e) {
            console.error('TrendsView saveConfig error:', e);
        }
    },

    _populateAccountSelect(accounts, mainAcc) {
        this.accounts = accounts;
        const sel = document.getElementById('trendsAccountSelect');
        const activeAccounts = this.accounts.filter(a => !a.is_closed);
        let options = `<option value="total" style="font-weight:bold;" data-i18n="trends_opt_total">${window.i18n.t('trends_opt_total')}</option>`;
        options += activeAccounts.map(a =>
            `<option value="${a.id}">${a.name}</option>`
        ).join('');
        if (sel) sel.innerHTML = options;

        if (this.savedAccountId !== null && (this.savedAccountId === 'total' || activeAccounts.some(a => a.id.toString() === this.savedAccountId.toString()))) {
            this.selectedAccountId = this.savedAccountId.toString();
        } else if (mainAcc && mainAcc.id && activeAccounts.some(a => a.id === mainAcc.id)) {
            this.selectedAccountId = mainAcc.id.toString();
        } else if (activeAccounts.length > 0) {
            this.selectedAccountId = activeAccounts[0].id.toString();
        } else {
            this.selectedAccountId = "total";
        }
        if (sel) sel.value = this.selectedAccountId;

        const tfSel = document.getElementById('trendsTimeframeSelect');
        if (tfSel) tfSel.value = this.timeframeMonths.toString();

        const alignSel = document.getElementById('trendsAlignmentSelect');
        if (alignSel) alignSel.value = this.alignmentType;
    },

    async loadAccounts(didSWR = false) {
        try {
            if (!this.accounts || this.accounts.length === 0) {
                const [accs, mainAcc] = await Promise.all([
                    API.get('/api/stats/accounts'),
                    API.get('/api/stats/main_account')
                ]);
                this._populateAccountSelect(accs, mainAcc);
            }

            await this.loadData(didSWR);
        } catch(e) {
            console.error('TrendsView loadAccounts:', e);
        }
    },

    async onAccountChange(accountId) {
        this.selectedAccountId = accountId;
        this.focusedOffset = null;
        this.saveConfig({ trends_account_id: accountId.toString() });
        await this.loadData();
    },
    
    async onTimeframeChange(months) {
        this.timeframeMonths = months === 'all' ? 'all' : parseInt(months, 10);
        this.focusedOffset = null;
        this.saveConfig({ trends_timeframe_months: months.toString() });
        
        const otherYearsCheck = document.getElementById('trendsOtherYearsCheck');
        
        if (months === 'all') {
            this.showOtherYears = false;
            this.saveConfig({ trends_superimpose: 'false' });
            if (otherYearsCheck) {
                otherYearsCheck.checked = false;
                otherYearsCheck.disabled = true;
                const label = otherYearsCheck.closest('label');
                if (label) {
                    label.style.opacity = '0.5';
                    label.style.cursor = 'not-allowed';
                }
                const switchEl = otherYearsCheck.closest('.trends-switch');
                if (switchEl) {
                    const sliderEl = switchEl.querySelector('.trends-switch-slider');
                    switchEl.style.background = 'var(--bg-base)';
                    switchEl.style.borderColor = 'var(--border-color)';
                    if (sliderEl) {
                        sliderEl.style.transform = 'translateX(0)';
                        sliderEl.style.background = 'var(--text-muted)';
                    }
                }
            }
        } else {
            if (otherYearsCheck) {
                otherYearsCheck.disabled = false;
                const label = otherYearsCheck.closest('label');
                if (label) {
                    label.style.opacity = '1';
                    label.style.cursor = 'pointer';
                }
            }
        }
        
        // Recharger les données de catégorie si mode non-history
        if (this.chartMode !== 'history') {
            await this._loadCategoryData();
        }

        this.updateAlignmentVisibility();
        this.renderChart();
    },
    
    updateAlignmentVisibility() {
        const rootDiv = document.getElementById('trendsViewRoot');
        const yearsSelector = document.getElementById('trendsYearsSelectorContainer');
        if (yearsSelector) {
            yearsSelector.style.display = this.showOtherYears ? 'flex' : 'none';
            if (this.showOtherYears) {
                this.renderYearsFilter();
            }
        }
        if (rootDiv) {
            if (this.showOtherYears) {
                rootDiv.classList.add('trends-with-alignment');
            } else {
                rootDiv.classList.remove('trends-with-alignment');
            }
        }
        const alignSelect = document.getElementById('trendsAlignmentSelect');
        if (alignSelect) {
            alignSelect.value = this.alignmentType;
        }
    },
    
    renderYearsFilter() {
        const container = document.getElementById('trendsYearsCheckboxes');
        if (!container || this.historyData.length === 0) return;
        
        const today = new Date();
        const firstDateInData = new Date(this.historyData[0].date);
        const maxOffset = Math.min(5, today.getFullYear() - firstDateInData.getFullYear() + 1);
        
        let html = '';
        for (let offset = 0; offset < maxOffset; offset++) {
            const yearStr = today.getFullYear() - offset;
            const isChecked = this.selectedYears.length === 0 || this.selectedYears.includes(offset);
            html += `
                <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:var(--text-muted);cursor:pointer;">
                    <input type="checkbox" value="${offset}" ${isChecked ? 'checked' : ''} onchange="window.TrendsView.onYearFilterChange(this.value, this.checked)">
                    <span>${yearStr}</span>
                </label>
            `;
        }
        container.innerHTML = html;
    },

    onYearFilterChange(offsetVal, checked) {
        const offset = parseInt(offsetVal);
        
        if (this.selectedYears.length === 0) {
            const today = new Date();
            const firstDateInData = this.historyData.length > 0 ? new Date(this.historyData[0].date) : today;
            const maxOffset = Math.min(5, today.getFullYear() - firstDateInData.getFullYear() + 1);
            for (let i = 0; i < maxOffset; i++) {
                this.selectedYears.push(i);
            }
        }

        if (checked) {
            if (!this.selectedYears.includes(offset)) {
                this.selectedYears.push(offset);
            }
        } else {
            this.selectedYears = this.selectedYears.filter(o => o !== offset);
        }
        
        if (this.focusedOffset === offset && !checked) {
            this.focusedOffset = null;
        }
        
        this.renderChart();
    },

    onAlignmentChange(val) {
        this.alignmentType = val;
        this.saveConfig({ trends_alignment_type: val });
        this.renderChart();
    },
    
    onOtherYearsChange(checked) {
        this.showOtherYears = checked;
        this.focusedOffset = null;
        this.saveConfig({ trends_superimpose: checked ? 'true' : 'false' });
        this.updateAlignmentVisibility();
        this.renderChart();
    },

    async loadData() {
        if (!this.selectedAccountId) return;
        try {
            // Charger les données de solde historique
            const data = await API.get(`/api/stats/trends/${this.selectedAccountId}`);
            this.historyData = data.history || [];
            this.selectedYears = []; // Reset on new account load

            // Charger les données par catégorie pour les modes expenses/compare/balance
            await this._loadCategoryData();

            this.updateAlignmentVisibility();
            this.renderChart();
            this._loadExtras();
        } catch(e) {
            console.error('TrendsView data:', e);
        }
    },

    async _loadCategoryData() {
        try {
            const months = this.timeframeMonths === 'all' ? 120 : this.timeframeMonths;
            let url = `/api/stats/categories_by_month?months=${months}`;
            if (this.selectedAccountId && this.selectedAccountId !== 'total') {
                url += `&account_ids=${this.selectedAccountId}`;
            }
            this._catData = await API.get(url);
        } catch (e) {
            console.error('[trends] Erreur chargement catégories', e);
            this._catData = null;
        }
    },

    setChartMode(mode) {
        this.chartMode = mode;
        this.saveConfig({ trends_chart_mode: mode });
        // Mettre à jour les boutons de mode
        document.querySelectorAll('.overview-trend-mode-toggle .ov-mode-btn').forEach(btn => {
            const onclickStr = btn.getAttribute('onclick') || '';
            btn.classList.toggle('active', onclickStr.includes(`'${mode}'`));
        });
        this.renderChart();
    },
    
    focusYear(offset) {
        if (this.focusedOffset === offset) {
            this.focusedOffset = null; // Toggle off
        } else {
            this.focusedOffset = offset;
        }
        this.renderChart();
    },

    resetZoom() {
        if (this.chart) {
            this.chart.resetZoom();
        }
    },

    renderChart() {
        const ctx = document.getElementById('trendsChart');
        if (!ctx) return;

        if (this.chart) {
            this.chart.destroy();
        }

        const statsGrid = document.getElementById('trendsStatsGrid');
        const compContainer = document.getElementById('trendsComparisonContainer');
        const compBody = document.getElementById('trendsComparisonBody');

        // Masquer les contrôles de superposition pour les modes non-history
        const superimposeControls = document.querySelector('label:has(#trendsOtherYearsCheck)');
        const alignControls = document.getElementById('trendsAlignmentSelect');
        if (superimposeControls) superimposeControls.style.display = this.chartMode === 'history' ? '' : 'none';
        if (alignControls) alignControls.closest('div').style.display = this.chartMode === 'history' ? '' : 'none';
        const yearsSelector = document.getElementById('trendsYearsSelectorContainer');
        if (yearsSelector && this.chartMode !== 'history') yearsSelector.style.display = 'none';

        // Mode catégories (expenses, compare, balance) — rendu séparé
        if (this.chartMode !== 'history') {
            if (compContainer) compContainer.style.display = 'none';
            this._renderCategoryChart(ctx, statsGrid);
            return;
        }
        
        if (this.historyData.length === 0) {
            this.chart = new Chart(ctx, { type: 'line', data: { labels: [], datasets: [] } });
            if (statsGrid) statsGrid.innerHTML = '';
            if (compContainer) compContainer.style.display = 'none';
            return;
        }

        const today = new Date();
        const datasets = [];
        let labels = [];

        // Colors for other years/periods
        const colors = [
            'rgba(51, 102, 255, 1)',   // Current year (Primary blue)
            'rgba(156, 163, 175, 0.8)',// -1 year (Gray)
            'rgba(245, 158, 11, 0.8)', // -2 years (Amber)
            'rgba(16, 185, 129, 0.8)', // -3 years (Emerald)
            'rgba(139, 92, 246, 0.8)', // -4 years (Purple)
            'rgba(239, 68, 68, 0.8)'   // -5 years (Red)
        ];

        // Optimize: index historyData by date for O(1) lookups
        const dateToBalanceMap = new Map();
        this.historyData.forEach(d => {
            dateToBalanceMap.set(d.date, d.balance);
        });

        // Determine data subset for current period stats
        let statsData = [];
        const comparisonRows = [];

        if (!this.showOtherYears) {
            // SINGLE CONTINUOUS LINE
            if (compContainer) compContainer.style.display = 'none';
            
            let filteredData = this.historyData;
            if (this.timeframeMonths !== 'all') {
                const startDate = new Date();
                if (this.alignmentType === 'calendar') {
                    // Année civile : début au 1er janvier de l'année calculée selon la période
                    const yearsBack = Math.max(0, Math.floor((this.timeframeMonths - 1) / 12));
                    startDate.setFullYear(today.getFullYear() - yearsBack, 0, 1);
                    startDate.setHours(0, 0, 0, 0);
                } else {
                    // Glissant : X mois en arrière depuis aujourd'hui
                    startDate.setMonth(startDate.getMonth() - this.timeframeMonths);
                }
                filteredData = this.historyData.filter(d => new Date(d.date) >= startDate);
            }
            
            statsData = filteredData;

            labels = filteredData.map(d => {
                const dt = new Date(d.date);
                return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            });
            
            datasets.push({
                label: window.i18n.t('chart_label_balance'),
                data: filteredData.map(d => d.balance),
                borderColor: colors[0],
                backgroundColor: 'rgba(51, 102, 255, 0.1)',
                borderWidth: 2.5,
                pointRadius: 0,
                pointHitRadius: 10,
                fill: true,
                tension: 0.1
            });
        } else {
            // SUPERIMPOSED PERIODS (YEARS)
            if (compContainer) compContainer.style.display = 'block';
            
            let daysInTimeframe = 0;
            let startDate = new Date();
            let endDate = new Date();

            if (this.alignmentType === 'calendar') {
                // Calendar Year alignment (Jan 1st to Dec 31st)
                startDate = new Date(today.getFullYear(), 0, 1);
                endDate = new Date(today.getFullYear(), 11, 31);
                daysInTimeframe = Math.round((endDate - startDate) / (1000 * 60 * 60 * 24));
                
                // Generate X axis labels: Jan 1st to Dec 31st
                for (let i = 0; i <= daysInTimeframe; i++) {
                    const d = new Date(startDate);
                    d.setDate(d.getDate() + i);
                    labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
                }
            } else {
                // Rolling alignment (relative to today)
                if (this.timeframeMonths === 'all') {
                    if (this.historyData.length > 0) {
                        const firstDate = new Date(this.historyData[0].date);
                        startDate.setTime(firstDate.getTime());
                    } else {
                        startDate.setMonth(startDate.getMonth() - 12);
                    }
                } else {
                    startDate.setMonth(startDate.getMonth() - this.timeframeMonths);
                }
                
                daysInTimeframe = Math.round((today - startDate) / (1000 * 60 * 60 * 24));
                
                for (let i = 0; i <= daysInTimeframe; i++) {
                    const d = new Date(startDate);
                    d.setDate(d.getDate() + i);
                    labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
                }
            }
            
            let offset = 0;
            let dataAvailable = true;
            const firstDateInData = new Date(this.historyData[0].date);
            const isFocusActive = this.focusedOffset !== null;

            while (dataAvailable && offset < colors.length) {
                // Skip if this offset is not selected in the years filter (and filter is not empty)
                if (this.selectedYears.length > 0 && !this.selectedYears.includes(offset)) {
                    offset++;
                    continue;
                }

                const periodEnd = this.alignmentType === 'calendar' ? new Date(endDate) : new Date(today);
                const periodStart = new Date(startDate);
                
                periodEnd.setFullYear(periodEnd.getFullYear() - offset);
                periodStart.setFullYear(periodStart.getFullYear() - offset);
                
                // Stop if this period is entirely before our first data point
                if (periodEnd < firstDateInData && offset > 0) {
                    dataAvailable = false;
                    break;
                }
                
                // Collect data for this period
                const periodData = [];
                for (let i = 0; i <= daysInTimeframe; i++) {
                    const targetDate = new Date(periodStart);
                    targetDate.setDate(targetDate.getDate() + i);
                    
                    // Don't show future data in current period
                    if (offset === 0 && targetDate > today) {
                        periodData.push(null);
                        continue;
                    }
                    
                    const dateStr = targetDate.toISOString().split('T')[0];
                    let closestBalance = dateToBalanceMap.get(dateStr);
                    if (closestBalance === undefined) {
                        closestBalance = null;
                    }
                    periodData.push(closestBalance);
                }
                
                // Check if the entire array is null
                if (periodData.some(val => val !== null)) {
                    let label = offset === 0 ? window.i18n.t('chart_current_period') : window.i18n.tp('chart_years_ago', {offset});
                    
                    // Specific label format for Calendar Year alignment
                    if (this.alignmentType === 'calendar') {
                        label = `${today.getFullYear() - offset}`;
                    }

                    // Focus/Highlight calculations
                    let opacity = 1.0;
                    let borderWidth = offset === 0 ? 2.5 : 1.5;
                    let borderDash = offset === 0 ? [] : [5, 5];
                    
                    if (isFocusActive) {
                        if (offset === this.focusedOffset) {
                            opacity = 1.0;
                            borderWidth = 3.5;
                            borderDash = []; // make it solid when highlighted
                        } else {
                            opacity = 0.15;
                            borderWidth = 1.0;
                        }
                    }

                    datasets.push({
                        label: label,
                        data: periodData,
                        borderColor: colors[offset % colors.length].replace(', 1)', `, ${opacity})`).replace(', 0.8)', `, ${opacity})`),
                        borderWidth: borderWidth,
                        borderDash: borderDash,
                        pointRadius: 0,
                        pointHitRadius: 10,
                        fill: false,
                        tension: 0.1
                    });

                    // Calculate stats for this specific period
                    const validBalances = periodData.filter(v => v !== null);
                    if (validBalances.length > 0) {
                        const startBal = validBalances[0];
                        const endBal = validBalances[validBalances.length - 1];
                        const variation = endBal - startBal;
                        const minBal = Math.min(...validBalances);
                        const maxBal = Math.max(...validBalances);
                        const avgBal = validBalances.reduce((a, b) => a + b, 0) / validBalances.length;
                        
                        comparisonRows.push({
                            offset: offset,
                            label: label,
                            variation,
                            average: avgBal,
                            min: minBal,
                            max: maxBal,
                            color: colors[offset % colors.length]
                        });

                        // Reference active stats to focused year, or default to current year (offset 0)
                        if (isFocusActive) {
                            if (offset === this.focusedOffset) {
                                statsData = periodData.map(b => ({ balance: b })).filter(b => b.balance !== null);
                            }
                        } else if (offset === 0) {
                            statsData = periodData.map(b => ({ balance: b })).filter(b => b.balance !== null);
                        }
                    }
                } else {
                    dataAvailable = false;
                }
                
                offset++;
            }
        }

        // Render Stats Grid
        if (statsGrid) {
            if (statsData.length > 0) {
                const startBalance = statsData[0].balance;
                const endBalance = statsData[statsData.length - 1].balance;
                const variation = endBalance - startBalance;
                
                const balances = statsData.map(d => d.balance);
                const minBalance = Math.min(...balances);
                const maxBalance = Math.max(...balances);
                const avgBalance = balances.reduce((a, b) => a + b, 0) / balances.length;
                
                const varColor = variation >= 0 ? '#10b981' : '#ef4444';
                const varPrefix = variation >= 0 ? '+' : '';
                
                statsGrid.innerHTML = `
                    <div class="stat-box" style="margin-bottom: 0;">
                        <span class="stat-label" data-i18n="trends_stat_variation">${window.i18n.t('trends_stat_variation')}</span>
                        <strong class="privacy-blur" style="color: ${varColor}; font-size: 20px; margin-top: 4px; font-weight: 700;">${varPrefix}${formatCurrency(variation)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom: 0;">
                        <span class="stat-label" data-i18n="trends_stat_average">${window.i18n.t('trends_stat_average')}</span>
                        <strong class="privacy-blur" style="font-size: 20px; margin-top: 4px; font-weight: 700; color: var(--text-main);">${formatCurrency(avgBalance)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom: 0;">
                        <span class="stat-label" data-i18n="trends_stat_min">${window.i18n.t('trends_stat_min')}</span>
                        <strong class="privacy-blur" style="font-size: 20px; margin-top: 4px; font-weight: 700; color: var(--text-main);">${formatCurrency(minBalance)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom: 0;">
                        <span class="stat-label" data-i18n="trends_stat_max">${window.i18n.t('trends_stat_max')}</span>
                        <strong class="privacy-blur" style="font-size: 20px; margin-top: 4px; font-weight: 700; color: var(--text-main);">${formatCurrency(maxBalance)}</strong>
                    </div>
                `;
            } else {
                statsGrid.innerHTML = '';
            }
        }

        // Render Comparative Table Body
        if (compBody) {
            compBody.innerHTML = comparisonRows.map(row => {
                const varColor = row.variation >= 0 ? '#10b981' : '#ef4444';
                const varPrefix = row.variation >= 0 ? '+' : '';
                const isFocused = this.focusedOffset === row.offset;
                
                return `
                    <tr style="border-bottom:1px solid var(--border-color); cursor:pointer; background:${isFocused ? 'rgba(99,102,241,0.1)' : 'transparent'}; transition:background 0.2s;" onclick="window.TrendsView.focusYear(${row.offset})">
                        <td style="padding:10px 6px;">
                            <div style="display:flex; align-items:center; gap:6px;">
                                <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${row.color}; flex-shrink:0;"></span>
                                <span style="font-weight:600; color:var(--text-main); white-space:nowrap;">${row.label}</span>
                            </div>
                        </td>
                        <td style="padding:10px 6px; text-align:right; font-weight:600; color:${varColor};"><span class="privacy-blur">${varPrefix}${formatCurrency(row.variation)}</span></td>
                        <td style="padding:10px 6px; text-align:right; color:var(--text-main);"><span class="privacy-blur">${formatCurrency(row.average)}</span></td>
                        <td style="padding:10px 6px; text-align:center;">
                            <button class="btn" style="padding:2px 6px; font-size:10px; background:${isFocused ? 'var(--accent)' : 'var(--bg-base)'}; color:var(--text-main); border:1px solid var(--border-color);">
                                ${isFocused ? 'Active' : 'Focus'}
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        const isDark = document.body.classList.contains('theme-dark');
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
        const textColor = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#9ca3af';
        const mainTextColor = getComputedStyle(document.body).getPropertyValue('--text-main').trim() || '#f3f4f6';

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: this.showOtherYears,
                        position: 'top',
                        labels: { color: mainTextColor },
                        onClick: (e, legendItem, legend) => {
                            const index = legendItem.datasetIndex;
                            const dataset = legend.chart.data.datasets[index];
                            const label = dataset.label;
                            let offsetMatch = 0;
                            
                            if (this.alignmentType === 'calendar') {
                                offsetMatch = today.getFullYear() - parseInt(label);
                            } else {
                                const yearsAgoMatch = label.match(/(\d+)\s+an/);
                                if (yearsAgoMatch) offsetMatch = parseInt(yearsAgoMatch[1]);
                            }
                            
                            this.focusYear(offsetMatch);
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label} : ${ctx.parsed.y.toLocaleString('fr-FR', {style:'currency',currency:'EUR'})}`
                        }
                    },
                    zoom: {
                        zoom: {
                            wheel: {
                                enabled: true,
                                center: false
                            },
                            pinch: {
                                enabled: true,
                                center: false
                            },
                            drag: {
                                enabled: false
                            },
                            mode: 'x',
                        },
                        pan: {
                            enabled: true,
                            mode: 'x',
                            threshold: 2,
                        },
                        transition: {
                            animation: {
                                duration: 200
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            callback: (v) => v.toLocaleString('fr-FR', {style:'currency',currency:'EUR',maximumFractionDigits:0})
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: textColor,
                            maxTicksLimit: 15
                        }
                    }
                }
            }
        });
    },

    _renderCategoryChart(canvasEl, statsGrid) {
        const catData = this._catData;
        if (!catData) {
            this.chart = new Chart(canvasEl, { type: 'line', data: { labels: [], datasets: [] } });
            if (statsGrid) statsGrid.innerHTML = '';
            return;
        }

        const today = new Date();
        const months = this.timeframeMonths === 'all' ? 120 : this.timeframeMonths;
        const monthKeys = [];
        const monthLabels = [];
        const isEn = window.i18n.lang === 'en';
        const monthNames = isEn
            ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
            : ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

        for (let i = months - 1; i >= 0; i--) {
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

        const ctxCanvas = canvasEl.getContext('2d');
        let datasets = [];

        const expLabel = window.i18n.t('overview_chart_mode_expenses') || 'Sorties';
        const incLabel = window.i18n.t('overview_chart_mode_income') || 'Recettes';
        const balLabel = window.i18n.t('overview_chart_mode_balance') || 'Bilan mensuel';

        if (this.chartMode === 'expenses') {
            const gradient = ctxCanvas.createLinearGradient(0, 0, 0, 300);
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
                pointRadius: 4,
                tension: 0.35
            }];
        } else if (this.chartMode === 'compare') {
            datasets = [
                {
                    label: incLabel,
                    data: incomeTotals,
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    fill: true,
                    borderWidth: 3,
                    pointBackgroundColor: '#10b981',
                    pointRadius: 3,
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
                    pointRadius: 3,
                    tension: 0.35
                }
            ];
        } else if (this.chartMode === 'balance') {
            const bgColors = netTotals.map(val => val >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)');
            datasets = [{
                type: 'bar',
                label: balLabel,
                data: netTotals,
                backgroundColor: bgColors,
                borderRadius: 6
            }];
        }

        const isDark = document.body.classList.contains('theme-dark');
        const gridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)';
        const textColor = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#9ca3af';

        this.chart = new Chart(canvasEl, {
            type: this.chartMode === 'balance' ? 'bar' : 'line',
            data: {
                labels: monthLabels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: { display: this.chartMode === 'compare' },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.9)',
                        padding: 12,
                        displayColors: true,
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label}: ${formatCurrency(ctx.raw)}`
                        }
                    },
                    zoom: {
                        zoom: {
                            wheel: { enabled: true },
                            pinch: { enabled: true },
                            drag: { enabled: false },
                            mode: 'x',
                        },
                        pan: {
                            enabled: true,
                            mode: 'x',
                            threshold: 2,
                        },
                        transition: {
                            animation: {
                                duration: 200
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: this.chartMode !== 'balance',
                        grid: { color: gridColor },
                        ticks: {
                            color: textColor,
                            callback: (v) => formatCurrency(v)
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: textColor,
                            maxTicksLimit: 15
                        }
                    }
                }
            }
        });

        // Stats grid pour les modes catégories
        if (statsGrid) {
            const totalExp = expenseTotals.reduce((a, b) => a + b, 0);
            const totalInc = incomeTotals.reduce((a, b) => a + b, 0);
            const totalNet = totalInc - totalExp;
            const avgExp = expenseTotals.length > 0 ? totalExp / expenseTotals.length : 0;
            const avgInc = incomeTotals.length > 0 ? totalInc / incomeTotals.length : 0;

            const varColor = totalNet >= 0 ? '#10b981' : '#ef4444';
            const varPrefix = totalNet >= 0 ? '+' : '';

            const statVariation = window.i18n.t('trends_stat_variation') || 'Variation';
            const statAverage = window.i18n.t('trends_stat_average') || 'Moyenne';

            if (this.chartMode === 'expenses') {
                statsGrid.innerHTML = `
                    <div class="stat-box" style="margin-bottom:0;">
                        <span class="stat-label">${window.i18n.t('overview_chart_mode_expenses') || 'Sorties'} (total)</span>
                        <strong class="privacy-blur" style="color: #ef4444; font-size: 20px; margin-top: 4px; font-weight: 700;">${formatCurrency(totalExp)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom:0;">
                        <span class="stat-label">${statAverage} /mois</span>
                        <strong class="privacy-blur" style="font-size: 20px; margin-top: 4px; font-weight: 700; color: var(--text-main);">${formatCurrency(avgExp)}</strong>
                    </div>
                `;
            } else if (this.chartMode === 'compare') {
                statsGrid.innerHTML = `
                    <div class="stat-box" style="margin-bottom:0;">
                        <span class="stat-label">${window.i18n.t('overview_chart_mode_income') || 'Recettes'} (total)</span>
                        <strong class="privacy-blur" style="color: #10b981; font-size: 20px; margin-top: 4px; font-weight: 700;">${formatCurrency(totalInc)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom:0;">
                        <span class="stat-label">${window.i18n.t('overview_chart_mode_expenses') || 'Sorties'} (total)</span>
                        <strong class="privacy-blur" style="color: #ef4444; font-size: 20px; margin-top: 4px; font-weight: 700;">${formatCurrency(totalExp)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom:0;">
                        <span class="stat-label">${statVariation}</span>
                        <strong class="privacy-blur" style="color: ${varColor}; font-size: 20px; margin-top: 4px; font-weight: 700;">${varPrefix}${formatCurrency(totalNet)}</strong>
                    </div>
                `;
            } else if (this.chartMode === 'balance') {
                statsGrid.innerHTML = `
                    <div class="stat-box" style="margin-bottom:0;">
                        <span class="stat-label">${window.i18n.t('overview_chart_mode_balance') || 'Bilan mensuel'} (total)</span>
                        <strong class="privacy-blur" style="color: ${varColor}; font-size: 20px; margin-top: 4px; font-weight: 700;">${varPrefix}${formatCurrency(totalNet)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom:0;">
                        <span class="stat-label">${statAverage} /mois</span>
                        <strong class="privacy-blur" style="font-size: 20px; margin-top: 4px; font-weight: 700; color: var(--text-main);">${formatCurrency(totalNet / (monthKeys.length || 1))}</strong>
                    </div>
                `;
            }
        }
    }
};
