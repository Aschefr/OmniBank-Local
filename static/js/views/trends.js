// trends.js — Tendances (Chart.js)
window.TrendsView = {
    accounts: [],
    selectedAccountId: null,
    chart: null,
    historyData: [],
    _catData: null, // categories_by_month data for expense/compare/balance modes
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

            <div class="view-header" style="position:sticky;top:-32px;z-index:10;background:var(--bg-base);padding:32px 0 15px;margin-top:-32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <h2 style="margin:0;">📉 <span data-i18n="nav_trends">Tendances</span></h2>
                <div style="display:flex;gap:10px;align-items:center; flex-wrap: wrap;">
                    <label style="font-size:13px;color:var(--text-muted);" data-i18n="trends_label_account">${window.i18n.t('trends_label_account')}</label>
                    <select id="trendsAccountSelect" class="inline-input" style="width:160px;" onchange="window.TrendsView.onAccountChange(this.value)">
                        <option value="" data-i18n="trends_opt_loading">${window.i18n.t('trends_opt_loading')}</option>
                    </select>
                    
                    <label style="font-size:13px;color:var(--text-muted);margin-left:10px;" data-i18n="trends_label_period">${window.i18n.t('trends_label_period')}</label>
                    <select id="trendsTimeframeSelect" class="inline-input" style="width:100px;" onchange="window.TrendsView.onTimeframeChange(this.value)">
                        <option value="1" data-i18n="trends_1m">${window.i18n.t('trends_1m')}</option>
                        <option value="3" data-i18n="trends_3m">${window.i18n.t('trends_3m')}</option>
                        <option value="6" data-i18n="trends_6m">${window.i18n.t('trends_6m')}</option>
                        <option value="9" data-i18n="trends_9m">${window.i18n.t('trends_9m')}</option>
                        <option value="12" selected data-i18n="trends_1y">${window.i18n.t('trends_1y')}</option>
                        <option value="24" data-i18n="trends_2y">${window.i18n.t('trends_2y')}</option>
                        <option value="60" data-i18n="trends_5y">${window.i18n.t('trends_5y')}</option>
                        <option value="all" data-i18n="trends_all">${window.i18n.t('trends_all')}</option>
                    </select>
                    
                    <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text-muted);margin-left:10px;cursor:pointer;user-select:none;">
                        <span data-i18n="trends_superimpose">${window.i18n.t('trends_superimpose')}</span>
                        <div class="trends-switch" style="position:relative;width:34px;height:18px;background:${switchBg};border:1px solid ${switchBorder};border-radius:9px;transition:all 0.2s;">
                            <input type="checkbox" id="trendsOtherYearsCheck" onchange="window.TrendsView.onOtherYearsChange(this.checked)" ${superimposeActive ? 'checked' : ''} style="display:none;">
                            <div class="trends-switch-slider" style="position:absolute;top:1px;left:1px;width:14px;height:14px;background:${sliderBg};border-radius:50%;transform:${sliderTransform};transition:transform 0.2s, background 0.2s;"></div>
                        </div>
                    </label>

                    <div style="display:flex;align-items:center;gap:6px;margin-left:10px;">
                        <label style="font-size:13px;color:var(--text-muted);" data-i18n="trends_align_type">${window.i18n.t('trends_align_type')}</label>
                        <select id="trendsAlignmentSelect" class="inline-input" style="width:120px;padding:4px 8px;font-size:12px;" onchange="window.TrendsView.onAlignmentChange(this.value)">
                            <option value="rolling" ${this.alignmentType === 'rolling' ? 'selected' : ''} data-i18n="trends_align_rolling">${window.i18n.t('trends_align_rolling')}</option>
                            <option value="calendar" ${this.alignmentType === 'calendar' ? 'selected' : ''} data-i18n="trends_align_calendar">${window.i18n.t('trends_align_calendar')}</option>
                        </select>
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
        </div>`;
    },

    async init() {
        await this.loadConfig();
        await this.loadAccounts();
    },

    async loadConfig() {
        try {
            const config = await API.get('/api/config');
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
        } catch(e) {
            console.error('TrendsView loadConfig error:', e);
        }
    },

    async saveConfig(updates) {
        try {
            await API.post('/api/config', updates);
        } catch(e) {
            console.error('TrendsView saveConfig error:', e);
        }
    },

    async loadAccounts() {
        try {
            this.accounts = await API.get('/api/stats/accounts');
            const mainAcc = await API.get('/api/stats/main_account');

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

            await this.loadData();
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
        
        const checkbox = document.getElementById('trendsOtherYearsCheck');
        if (checkbox) {
            const switchEl = checkbox.closest('.trends-switch');
            if (switchEl) {
                const sliderEl = switchEl.querySelector('.trends-switch-slider');
                if (checked) {
                    switchEl.style.background = 'var(--accent, #6366f1)';
                    switchEl.style.borderColor = 'var(--accent, #6366f1)';
                    if (sliderEl) {
                        sliderEl.style.transform = 'translateX(16px)';
                        sliderEl.style.background = '#ffffff';
                    }
                } else {
                    switchEl.style.background = 'var(--bg-base)';
                    switchEl.style.borderColor = 'var(--border-color)';
                    if (sliderEl) {
                        sliderEl.style.transform = 'translateX(0)';
                        sliderEl.style.background = 'var(--text-muted)';
                    }
                }
            }
        }
        
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
        document.querySelectorAll('.ov-mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.getAttribute('onclick').includes(`'${mode}'`));
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
