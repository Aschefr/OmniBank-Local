window.RecurrenceView = {
    templates: [],
    transactions: [],
    selectedYear: new Date().getFullYear(),
    modifiedRows: new Set(),
    expandedTemplateIds: new Set(),
    
    render() {
        const durationFilter = this.activeDurationFilter || 'all';
        const periodFilter = this.activePeriodFilter || 'all';
        const viewMode = this.currentViewMode || ProfileStorage.get('recurrences_viewMode') || 'table';
        
        const durationClass = (f) => durationFilter === f ? 'active' : '';
        const periodClass = (f) => periodFilter === f ? 'active' : '';
        const viewClass = (v) => viewMode === v ? 'active' : '';
        
        // Build dynamic frequency badges from user data
        const availableFreqs = this.getAvailableFrequencies();
        const freqBadgesHtml = availableFreqs.map(freq => {
            const label = window.i18n.t('rec_' + freq.toLowerCase()) || freq;
            return `<button class="btn-filter btn-filter-period ${periodClass(freq.toLowerCase())}" onclick="window.RecurrenceView.setPeriodFilter('${freq.toLowerCase()}')" data-filter-period="${freq.toLowerCase()}">${label}</button>`;
        }).join('\n                    ');
        
        return `
            <style>
                .btn-filter {
                    background: var(--bg-base);
                    color: var(--text-muted);
                    border: 1px solid var(--border-color);
                    padding: 5px 12px;
                    border-radius: 20px;
                    font-size: 11px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }
                .btn-filter:hover {
                    background: var(--bg-input);
                    color: var(--text-main);
                }
                .btn-filter.active {
                    color: #ffffff;
                    box-shadow: 0 2px 4px rgba(51, 102, 255, 0.15);
                }
                .btn-filter-duration.active {
                    background: #8b5cf6;
                    border-color: #8b5cf6;
                }
                .btn-filter-period.active {
                    background: var(--accent);
                    border-color: var(--accent);
                }
                .btn-filter-reset.active {
                    background: var(--accent);
                    border-color: var(--accent);
                }
                .filter-separator {
                    width: 1px;
                    height: 24px;
                    background: var(--border-color);
                    margin: 0 4px;
                }
                .btn-view-toggle {
                    padding: 6px 12px;
                    border-radius: 6px;
                    font-size: 13px;
                    font-weight: 600;
                    cursor: pointer;
                    border: none;
                    background: transparent;
                    color: var(--text-muted);
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    transition: all 0.2s;
                }
                .btn-view-toggle.active {
                    background: var(--bg-surface);
                    color: var(--text-main) !important;
                    box-shadow: var(--shadow-sm);
                }
                /* Gantt chart styles */
                .gantt-row {
                    display: grid;
                    grid-template-columns: 240px 1fr;
                    align-items: center;
                    border-bottom: 1px solid var(--border-color);
                    transition: background-color 0.15s;
                    cursor: pointer;
                }
                .gantt-row:hover {
                    background: rgba(99, 102, 241, 0.03);
                }
                .gantt-desc {
                    padding: 10px 12px;
                    font-weight: 600;
                    font-size: 13px;
                    color: var(--text-main);
                }
                .gantt-bar-container {
                    display: grid;
                    grid-template-columns: repeat(12, 1fr);
                    height: 32px;
                    gap: 0;
                    padding: 0 8px;
                }
                .gantt-segment {
                    height: 100%;
                    position: relative;
                    cursor: pointer;
                    transition: filter 0.15s, transform 0.1s;
                    border-right: 1px solid rgba(255,255,255,0.15);
                }
                .gantt-segment:last-child {
                    border-right: none;
                }
                .gantt-segment:hover {
                    filter: brightness(1.15);
                    z-index: 2;
                }
                .gantt-segment-empty {
                    background: transparent;
                    cursor: default;
                }
                .gantt-segment-empty:hover {
                    filter: none;
                }
                .gantt-segment-pending {
                    background: linear-gradient(135deg, rgba(51, 102, 255, 0.55), rgba(51, 102, 255, 0.35));
                }
                .gantt-segment-reconciled {
                    background: linear-gradient(135deg, rgba(54, 179, 126, 0.65), rgba(54, 179, 126, 0.40));
                }
                .gantt-segment-skipped {
                    background: repeating-linear-gradient(
                        -45deg,
                        rgba(100, 116, 139, 0.15),
                        rgba(100, 116, 139, 0.15) 3px,
                        rgba(100, 116, 139, 0.30) 3px,
                        rgba(100, 116, 139, 0.30) 6px
                    );
                }
                .gantt-segment-label {
                    position: absolute;
                    inset: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    font-size: 10px;
                    line-height: 1.15;
                    font-weight: 700;
                    color: #fff;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.3);
                    pointer-events: none;
                }
                .gantt-segment-skipped .gantt-segment-label {
                    color: var(--text-muted);
                    text-shadow: none;
                }
                .gantt-header {
                    display: grid;
                    grid-template-columns: 240px 1fr;
                    border-bottom: 2px solid var(--border-color);
                    background: var(--bg-surface);
                    user-select: none;
                    position: sticky;
                    top: var(--sticky-offset, -32px);
                    z-index: 10;
                }
                #recurrencesTableContainer .data-table th {
                    position: sticky;
                    top: var(--sticky-offset, -32px);
                    z-index: 10;
                    background: var(--bg-surface);
                }
                .gantt-header-months {
                    display: grid;
                    grid-template-columns: repeat(12, 1fr);
                    padding: 0 8px;
                }
                .gantt-header-months > div {
                    text-align: center;
                    font-size: 11px;
                    font-weight: 600;
                    color: var(--text-muted);
                    padding: 10px 0;
                }
                /* Popover for segment confirmation */
                .gantt-popover {
                    position: fixed;
                    z-index: 1000;
                    background: var(--bg-surface);
                    border: 1px solid var(--border-color);
                    border-radius: 10px;
                    padding: 14px 16px;
                    box-shadow: 0 8px 24px rgba(0,0,0,0.18);
                    min-width: 220px;
                    max-width: 300px;
                    animation: popoverIn 0.15s ease-out;
                }
                @keyframes popoverIn {
                    from { opacity: 0; transform: translateY(-6px) scale(0.96); }
                    to { opacity: 1; transform: translateY(0) scale(1); }
                }
                .gantt-popover-title {
                    font-size: 13px;
                    font-weight: 700;
                    color: var(--text-main);
                    margin-bottom: 6px;
                }
                .gantt-popover-info {
                    font-size: 12px;
                    color: var(--text-muted);
                    margin-bottom: 10px;
                    line-height: 1.5;
                }
                .gantt-popover-actions {
                    display: flex;
                    gap: 8px;
                    justify-content: flex-end;
                }
                .gantt-popover-actions button {
                    padding: 5px 14px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    border: 1px solid var(--border-color);
                    transition: all 0.15s;
                }
                .gantt-popover-confirm {
                    background: var(--accent);
                    color: #fff;
                    border-color: var(--accent) !important;
                }
                .gantt-popover-confirm:hover {
                    filter: brightness(1.1);
                }
                .gantt-popover-cancel {
                    background: var(--bg-base);
                    color: var(--text-muted);
                }
                .gantt-popover-cancel:hover {
                    background: var(--bg-input);
                }
                .gantt-popover-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    width: 100%;
                    padding: 8px 12px;
                    border: none;
                    background: transparent;
                    color: var(--text-main);
                    font-size: 12px;
                    font-weight: 500;
                    text-align: left;
                    cursor: pointer;
                    border-radius: 6px;
                    transition: background 0.15s;
                }
                .gantt-popover-item:hover {
                    background: var(--bg-input);
                }
                .gantt-popover-item:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
            </style>
            <div class="view-header" style="margin-bottom:20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <h2>🔄 <span data-i18n="nav_recurrences">Récurrences</span></h2>
            </div>
            
            <div class="rec-filter-bar" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; background: var(--bg-surface); padding: 12px 20px; border-radius: 12px; border: 1px solid var(--border-color);">
                <!-- Left: Combinable Filters (Duration + Period) -->
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <button class="btn-filter btn-filter-reset ${(durationFilter === 'all' && periodFilter === 'all') ? 'active' : ''}" onclick="window.RecurrenceView.resetAllFilters()" data-i18n="rec_filter_all">${window.i18n.t('rec_filter_all')}</button>
                    
                    <div class="filter-separator"></div>
                    
                    <button class="btn-filter btn-filter-duration ${durationClass('unlimited')}" onclick="window.RecurrenceView.setDurationFilter('unlimited')" data-filter-duration="unlimited" data-i18n="rec_filter_unlimited">${window.i18n.t('rec_filter_unlimited')}</button>
                    <button class="btn-filter btn-filter-duration ${durationClass('limited')}" onclick="window.RecurrenceView.setDurationFilter('limited')" data-filter-duration="limited" data-i18n="rec_filter_limited">${window.i18n.t('rec_filter_limited')}</button>
                    
                    <div class="filter-separator"></div>
                    
                    ${freqBadgesHtml}
                </div>
                <!-- Right: Text Search + View switcher -->
                <div class="rec-search-wrapper" style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <input type="text" id="recurrenceSearch" class="inline-input" data-i18n-placeholder="ph_search_recurrence" placeholder="${window.i18n.t('ph_search_recurrence')}" style="min-width: 140px; flex: 1; margin: 0;" oninput="window.RecurrenceView.applyFilter()">
                    
                    <!-- View Toggle Buttons -->
                    <div style="display: flex; background: var(--bg-base); padding: 3px; border-radius: 8px; border: 1px solid var(--border-color);">
                        <button id="viewModeTable" class="btn-view-toggle ${viewClass('table')}" onclick="window.RecurrenceView.setViewMode('table')">
                            <span>📋</span> <span data-i18n="rec_view_table">${window.i18n.t('rec_view_table')}</span>
                        </button>
                        <button id="viewModeTimeline" class="btn-view-toggle ${viewClass('timeline')}" onclick="window.RecurrenceView.setViewMode('timeline')">
                            <span>📅</span> <span data-i18n="rec_view_timeline">${window.i18n.t('rec_view_timeline')}</span>
                        </button>
                    </div>
                </div>
            </div>
            
            <div style="background: var(--bg-surface); padding: 24px; border-radius: 16px; margin-top: 20px; border: 1px solid var(--border-color); box-shadow: var(--shadow-sm);">
                <div style="display: flex; gap: 15px; align-items: center; justify-content: center; margin-bottom: 24px;">
                    <button class="btn btn-secondary" style="padding: 6px 16px; border-radius: 8px; font-weight: 600;" onclick="window.RecurrenceView.changeYear(-1)">&lt;</button>
                    <h3 style="margin: 0; width: 100px; text-align: center; font-size: 26px; font-weight: 700; color: var(--text-main);" id="recYearDisplay">${this.selectedYear}</h3>
                    <button class="btn btn-secondary" style="padding: 6px 16px; border-radius: 8px; font-weight: 600;" onclick="window.RecurrenceView.changeYear(1)">&gt;</button>
                </div>

                <!-- Global Recurrence Indicators -->
                <div id="recurrenceStatsGrid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin-bottom: 28px;">
                </div>
                
                <div id="recurrencesTableContainer" style="margin-top: 20px; position: relative;">
                    <!-- Table rendered dynamically -->
                </div>
            </div>
        `;
    },

    async init() {
        this.selectedYear = new Date().getFullYear();
        this.modifiedRows.clear();
        this.expandedTemplateIds.clear();
        this.sortBy = ProfileStorage.get('recurrences_sortBy') || 'description';
        this.sortOrder = ProfileStorage.get('recurrences_sortOrder') || 'asc';
        this.activeDurationFilter = ProfileStorage.get('recurrences_durationFilter') || 'all';
        this.activePeriodFilter = ProfileStorage.get('recurrences_periodFilter') || 'all';
        this.currentViewMode = ProfileStorage.get('recurrences_viewMode') || 'table';
        await this.loadData();
    },

    async loadData() {
        try {
            this.templates = await API.get('/api/recurrences/?include_closed=true');
            this.categories = await API.get('/api/categories/');
            const allTx = await API.get('/api/transactions/?limit=10000');
            this.allTransactions = allTx;
            
            const activeTemplateIds = new Set(
                allTx.filter(tx => tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear && tx.recurrence_id != null)
                     .map(tx => tx.recurrence_id)
            );
            
            const displayTemplates = this.templates.filter(t => 
                activeTemplateIds.has(t.id)
            );

            let grandTotalAnnual = 0;
            let totalReconciledCount = 0;
            let totalInstancesCount = 0;

            displayTemplates.forEach(t => {
                const templateTx = (this.allTransactions || []).filter(tx => 
                    tx.recurrence_id == t.id && 
                    tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear
                );
                t.totalAnnualAmount = templateTx.reduce((sum, tx) => sum + tx.amount, 0);
                grandTotalAnnual += t.totalAnnualAmount;
                totalInstancesCount += templateTx.length;
                totalReconciledCount += templateTx.filter(tx => tx.reconciliation_date != null || tx.is_skipped === true).length;

                const reconciledTx = (this.allTransactions || [])
                    .filter(tx => tx.recurrence_id == t.id && 
                                  tx.reconciliation_date != null &&
                                  tx.date_operation &&
                                  parseInt(tx.date_operation.substring(0, 4)) <= this.selectedYear)
                    .sort((a, b) => b.date_operation.localeCompare(a.date_operation));
                t.displayAmount = reconciledTx.length > 0 ? reconciledTx[0].amount : t.amount;

                const reconciledCount = templateTx.filter(tx => tx.reconciliation_date != null || tx.is_skipped === true).length;
                const totalCount = templateTx.length;
                t.progressPct = totalCount > 0 ? Math.round((reconciledCount / totalCount) * 100) : 0;
                t.reconciledCount = reconciledCount;
                t.totalCount = totalCount;
            });

            const monthlyAverage = grandTotalAnnual / 12;
            const activeCount = displayTemplates.length;
            const reconciliationRate = totalInstancesCount > 0 ? Math.round((totalReconciledCount / totalInstancesCount) * 100) : 0;

            const statsGrid = document.getElementById('recurrenceStatsGrid');
            if (statsGrid) {
                statsGrid.innerHTML = `
                    <div class="stat-box" style="margin-bottom: 0; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column;">
                        <span class="stat-label" style="font-size: 12px; color: var(--text-muted); font-weight: 500;" data-i18n="rec_stat_total_annual">${window.i18n.t('rec_stat_total_annual')}</span>
                        <strong class="privacy-blur" style="font-size: 20px; font-weight: 700; color: var(--text-main); margin-top: 4px;">${formatCurrency(grandTotalAnnual)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom: 0; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column;">
                        <span class="stat-label" style="font-size: 12px; color: var(--text-muted); font-weight: 500;" data-i18n="rec_stat_monthly_average">${window.i18n.t('rec_stat_monthly_average')}</span>
                        <strong class="privacy-blur" style="font-size: 20px; font-weight: 700; color: var(--text-main); margin-top: 4px;">${formatCurrency(monthlyAverage)}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom: 0; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column;">
                        <span class="stat-label" style="font-size: 12px; color: var(--text-muted); font-weight: 500;" data-i18n="rec_stat_active_count">${window.i18n.t('rec_stat_active_count')}</span>
                        <strong style="font-size: 20px; font-weight: 700; color: var(--text-main); margin-top: 4px;">${activeCount}</strong>
                    </div>
                    <div class="stat-box" style="margin-bottom: 0; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 12px; padding: 16px; box-shadow: var(--shadow-sm); display: flex; flex-direction: column;">
                        <span class="stat-label" style="font-size: 12px; color: var(--text-muted); font-weight: 500;" data-i18n="rec_stat_reconciliation">${window.i18n.t('rec_stat_reconciliation')}</span>
                        <strong style="font-size: 20px; font-weight: 700; color: var(--accent); margin-top: 4px;">${reconciliationRate}% <span style="font-size: 12px; font-weight: 500; color: var(--text-muted);">(${totalReconciledCount}/${totalInstancesCount})</span></strong>
                    </div>
                `;
            }
            
            this.lastDisplayTemplates = displayTemplates;
            this._renderDynamicFrequencyBadges();
            this.renderMainContent();
            
        } catch (e) {
            console.error("Failed to load transactions", e);
        }
    },
    
    getFilteredTemplates() {
        const templates = this.lastDisplayTemplates || [];
        const q = window.cleanStringForSearch(document.getElementById('recurrenceSearch')?.value || '');
        const durationFilter = this.activeDurationFilter || 'all';
        const periodFilter = this.activePeriodFilter || 'all';
        
        return templates.filter(t => {
            // Duration filter (independent axis)
            if (durationFilter === 'unlimited' && t.max_occurrences) return false;
            if (durationFilter === 'limited' && !t.max_occurrences) return false;
            
            // Period/frequency filter (independent axis)
            if (periodFilter !== 'all' && t.frequency.toLowerCase() !== periodFilter) return false;
            
            // Text search
            if (q) {
                const descText = window.cleanStringForSearch(t.description || '');
                const catText = window.cleanStringForSearch(t.category || '');
                const freqText = window.cleanStringForSearch(t.frequency || '');
                const amountText = (t.displayAmount || 0).toString().toLowerCase();
                if (!descText.includes(q) && !catText.includes(q) && !freqText.includes(q) && !amountText.includes(q)) {
                    return false;
                }
            }
            return true;
        });
    },

    renderMainContent() {
        const tableContainer = document.getElementById('recurrencesTableContainer');
        if (!tableContainer) return;
        
        const filteredTemplates = this.getFilteredTemplates();
        
        if (filteredTemplates.length === 0) {
            const emptyMsg = (window.i18n.t('msg_no_recurrences_configured_year') || 'No recurring operations planned for {year}').replace('{year}', this.selectedYear);
            tableContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 16px;">${emptyMsg}</div>`;
            return;
        }

        const sortBy = this.sortBy || 'description';
        const sortOrder = this.sortOrder || 'asc';
        
        filteredTemplates.sort((a, b) => {
            let valA, valB;
            if (sortBy === 'description') {
                valA = a.description || '';
                valB = b.description || '';
                return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else if (sortBy === 'category') {
                valA = a.category || '';
                valB = b.category || '';
                return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else if (sortBy === 'frequency') {
                valA = a.frequency || '';
                valB = b.frequency || '';
                return sortOrder === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            } else if (sortBy === 'day') {
                valA = a.day_of_month || 1;
                valB = b.day_of_month || 1;
                return sortOrder === 'asc' ? valA - valB : valB - valA;
            } else if (sortBy === 'progress') {
                valA = a.progressPct || 0;
                valB = b.progressPct || 0;
                return sortOrder === 'asc' ? valA - valB : valB - valA;
            } else if (sortBy === 'amount') {
                valA = a.displayAmount || 0;
                valB = b.displayAmount || 0;
                return sortOrder === 'asc' ? valA - valB : valB - valA;
            } else if (sortBy === 'annual_total') {
                valA = a.totalAnnualAmount || 0;
                valB = b.totalAnnualAmount || 0;
                return sortOrder === 'asc' ? valA - valB : valB - valA;
            } else if (sortBy === 'status') {
                valA = a.is_closed ? 1 : 0;
                valB = b.is_closed ? 1 : 0;
                return sortOrder === 'asc' ? valA - valB : valB - valA;
            }
            return 0;
        });

        if (this.currentViewMode === 'timeline') {
            this.renderTimelineView(tableContainer, filteredTemplates);
        } else {
            this.renderTableView(tableContainer, filteredTemplates);
        }

        // Dynamically compute the sticky offset so headers stick flush at the scroll viewport top
        requestAnimationFrame(() => {
            const main = document.querySelector('.app-main');
            if (main) {
                const padding = parseInt(getComputedStyle(main).paddingTop, 10) || 0;
                tableContainer.style.setProperty('--sticky-offset', `-${padding}px`);
            }
        });
    },

    renderTableView(tableContainer, displayTemplates) {
        let tableHtml = `
            <div class="table-responsive" style="width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch;">
                 <table class="data-table mobile-card-table" style="width: 100%; border-collapse: separate; border-spacing: 0; margin-top: 10px;">
                    <thead>
                        <tr style="text-align: left; background: rgba(0, 0, 0, 0.02); border-bottom: 2px solid var(--border-color); user-select: none;">
                            <th style="width: 3px; padding: 0; overflow: visible;"></th>
                            <th style="padding: 12px; width: 45px; text-align: center;"></th>
                            <th style="padding: 12px; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('description')">${window.i18n.t('col_description')} ${this.getSortArrow('description')}</th>
                            <th style="padding: 12px; width: 170px; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('category')">${window.i18n.t('col_category')} ${this.getSortArrow('category')}</th>
                            <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('frequency')">${window.i18n.t('wizard_th_frequency') || 'Frequency'} ${this.getSortArrow('frequency')}</th>
                            <th style="padding: 12px; width: 100px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('status')">${window.i18n.t('col_status')} ${this.getSortArrow('status')}</th>
                            <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('day')">${window.i18n.t('wizard_th_day') || 'Day of month'} ${this.getSortArrow('day')}</th>
                            <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('progress')">${window.i18n.t('col_progress') || 'Progression'} ${this.getSortArrow('progress')}</th>
                            <th style="padding: 12px; width: 120px; text-align: right; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('amount')">${window.i18n.t('col_amount')} ${this.getSortArrow('amount')}</th>
                            <th style="padding: 12px; width: 140px; text-align: right; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('annual_total')">${window.i18n.t('col_total_annual') || 'Annual Total'} ${this.getSortArrow('annual_total')}</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        displayTemplates.forEach(t => {
            const isExpanded = this.expandedTemplateIds.has(t.id);
            const chevronStyle = `display: inline-block; transition: transform 0.2s ease; transform: ${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}; font-size: 11px; color: var(--text-muted); cursor: pointer;`;
            const displayStyle = isExpanded ? 'table-row' : 'none';
            
            const typeColors = this.getTypeColors(t);
            const freqLabel = window.i18n.t('rec_' + t.frequency.toLowerCase()) || t.frequency;
            
            let badgeStyle = '';
            const freq = t.frequency.toLowerCase();
            if (freq === 'monthly') {
                badgeStyle = 'background: rgba(51, 102, 255, 0.1); color: var(--accent); border: 1px solid rgba(51, 102, 255, 0.2);';
            } else if (freq === 'yearly') {
                badgeStyle = 'background: rgba(139, 92, 246, 0.1); color: #8b5cf6; border: 1px solid rgba(139, 92, 246, 0.2);';
            } else if (freq === 'weekly') {
                badgeStyle = 'background: rgba(245, 158, 11, 0.1); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.2);';
            } else if (freq === 'quarterly') {
                badgeStyle = 'background: rgba(14, 165, 233, 0.1); color: #0ea5e9; border: 1px solid rgba(14, 165, 233, 0.2);';
            } else if (freq === 'semi-annually') {
                badgeStyle = 'background: rgba(236, 72, 153, 0.1); color: #ec4899; border: 1px solid rgba(236, 72, 153, 0.2);';
            } else {
                badgeStyle = 'background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2);';
            }
            const badgeHtml = `<span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; ${badgeStyle}">${freqLabel}</span>`;
            
            const statusLabel = t.is_closed ? window.i18n.t('rec_status_closed') : window.i18n.t('rec_status_active');
            const statusBadgeStyle = t.is_closed 
                ? 'background: rgba(100, 116, 139, 0.1); color: #64748b; border: 1px solid rgba(100, 116, 139, 0.2);' 
                : 'background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2);';
            const statusBadgeHtml = `<span style="display: inline-block; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; ${statusBadgeStyle}">${statusLabel}</span>`;
            
            const catOptionsHtml = (this.categories || [])
                .filter(c => !c.is_closed || c.name === t.category)
                .map(c => `<option value="${c.name}" ${t.category === c.name ? 'selected' : ''}>${c.name}</option>`)
                .join('');
            
            tableHtml += `
                <tr id="rec-row-${t.id}" onclick="window.RecurrenceView.toggleRow(${t.id})" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(99,102,241,0.03)'" onmouseout="this.style.backgroundColor=''">
                    <td style="width: 3px; min-width: 3px; max-width: 3px; padding: 0; position: relative; overflow: visible;" onclick="event.stopPropagation()">
                        <div style="position: absolute; top: 0; bottom: 0; left: -2px; width: 3px; background: ${typeColors.border}; box-shadow: -3px 0 8px -1px ${typeColors.border}; cursor: help;" title="${typeColors.label}"></div>
                    </td>
                    <td style="padding: 12px; text-align: center;">
                        <span id="chevron_${t.id}" style="${chevronStyle}">❯</span>
                    </td>
                    <td data-label="Description" style="padding: 12px; font-weight: 600; color: var(--text-main); font-size: 14px;">${t.description}</td>
                    <td data-label="${window.i18n.t('col_category') || 'Catégorie'}" style="padding: 6px 12px;" onclick="event.stopPropagation()">
                        <select class="inline-input" style="padding: 4px 8px; border-radius: 6px; font-size: 13px; width: 100%; border: 1px solid var(--border-color); background: var(--bg-surface); cursor: pointer;" onchange="window.RecurrenceView.changeTemplateCategory(this, ${t.id})">
                            <option value="">-- Sans catégorie --</option>
                            ${catOptionsHtml}
                            <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ Nouvelle catégorie...</option>
                        </select>
                    </td>
                    <td data-label="${window.i18n.t('wizard_th_frequency') || 'Fréquence'}" style="padding: 12px; text-align: center;">${badgeHtml}</td>
                    <td data-label="${window.i18n.t('col_status') || 'Statut'}" style="padding: 12px; text-align: center;">${statusBadgeHtml}</td>
                    <td data-label="${window.i18n.t('wizard_th_day') || 'Jour'}" style="padding: 12px; text-align: center; font-size: 13px; color: var(--text-muted); font-weight: 500;">${t.day_of_month || 1}</td>
                    <td data-label="${window.i18n.t('col_progress') || 'Progression'}" style="padding: 12px; text-align: center;" onclick="event.stopPropagation()">
                        <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; min-width: 90px;">
                            <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden; border: 1px solid var(--border-color);">
                                <div style="width: ${t.progressPct}%; height: 100%; background: ${t.progressPct === 100 ? 'linear-gradient(90deg, #2ecc71, #27ae60)' : 'linear-gradient(90deg, var(--accent, #6c5ce7), #a29bfe)'}; border-radius: 3px; transition: width 0.3s ease;"></div>
                            </div>
                            <span style="font-size: 11px; font-weight: 600; color: var(--text-muted);">${t.progressPct}% <span style="font-size: 10px; font-weight: 500; opacity: 0.7;">(${t.reconciledCount}/${t.totalCount})</span></span>
                        </div>
                    </td>
                    <td data-label="${window.i18n.t('col_amount') || 'Montant'}" style="padding: 12px; text-align: right; font-weight: 600; color: ${typeColors.text}; font-size: 13px;">${formatCurrency(t.displayAmount)}</td>
                    <td data-label="${window.i18n.t('col_total_annual') || 'Total Annuel'}" style="padding: 12px; text-align: right; font-weight: 700; color: ${typeColors.text}; font-size: 14px;"><span class="privacy-blur">${formatCurrency(t.totalAnnualAmount)}</span></td>
                </tr>
                <tr id="details_row_${t.id}" class="rec-details-row" style="display: ${displayStyle}; background: var(--bg-sidebar);">
                    <td colspan="10" class="rec-details-cell" style="padding: 15px 20px; border-bottom: 1px solid var(--border-color);">
                        <div id="details_content_${t.id}">
                            <!-- Rendered dynamically -->
                        </div>
                    </td>
                </tr>
            `;
        });
        
        tableHtml += `
                    </tbody>
                </table>
            </div>
        `;
        tableContainer.innerHTML = tableHtml;
        
        this.expandedTemplateIds.forEach(id => {
            this.renderTemplateDetails(id);
        });
    },

    renderTimelineView(tableContainer, displayTemplates) {
        const locale = window.i18n.locale || 'fr';
        
        // Build month headers
        let monthHeaders = '';
        for (let m = 0; m < 12; m++) {
            const dateSample = new Date(this.selectedYear, m, 1);
            const monthLabel = new Intl.DateTimeFormat(locale, { month: 'short' }).format(dateSample);
            const capitalizedMonth = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
            monthHeaders += `<div>${capitalizedMonth}</div>`;
        }
        
        let timelineHtml = `
            <div style="border: 1px solid var(--border-color); border-radius: 10px; margin-top: 10px;">
                <div class="gantt-header">
                    <div style="padding: 10px 12px; font-size: 12px; font-weight: 600; color: var(--text-muted);">Description</div>
                    <div class="gantt-header-months">${monthHeaders}</div>
                </div>
        `;
        
        displayTemplates.forEach(t => {
            const isExpanded = this.expandedTemplateIds.has(t.id);
            const chevronStyle = `display: inline-block; transition: transform 0.2s ease; transform: ${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}; font-size: 11px; color: var(--text-muted); cursor: pointer;`;
            const typeColors = this.getTypeColors(t);
            const freqLabel = window.i18n.t('rec_' + t.frequency.toLowerCase()) || t.frequency;
            
            const templateTx = (this.allTransactions || []).filter(tx => 
                tx.recurrence_id == t.id && 
                tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear
            );
            
            // Build month-indexed segments
            let segmentsHtml = '';
            for (let m = 0; m < 12; m++) {
                const monthTx = templateTx.filter(tx => {
                    if (!tx.date_operation) return false;
                    const txMonth = parseInt(tx.date_operation.split('T')[0].split('-')[1]) - 1;
                    return txMonth === m;
                }).sort((a, b) => a.date_operation.localeCompare(b.date_operation));
                
                if (monthTx.length > 0) {
                    // Use the first transaction of the month for the segment
                    const tx = monthTx[0];
                    const isSkipped = tx.is_skipped === true || tx.is_skipped === 'true';
                    const isReconciled = tx.reconciliation_date != null && !isSkipped;
                    
                    let segmentClass = 'gantt-segment-pending';
                    if (isSkipped) segmentClass = 'gantt-segment-skipped';
                    else if (isReconciled) segmentClass = 'gantt-segment-reconciled';
                    
                    const day = parseInt(tx.date_operation.split('T')[0].split('-')[2]);
                    
                    // Round corners for first and last segments with occurrences
                    const isFirst = !templateTx.some(otx => {
                        const om = parseInt(otx.date_operation.split('T')[0].split('-')[1]) - 1;
                        return om < m;
                    });
                    const isLast = !templateTx.some(otx => {
                        const om = parseInt(otx.date_operation.split('T')[0].split('-')[1]) - 1;
                        return om > m;
                    });
                    let borderRadius = '';
                    if (isFirst && isLast) borderRadius = 'border-radius: 4px;';
                    else if (isFirst) borderRadius = 'border-radius: 4px 0 0 4px;';
                    else if (isLast) borderRadius = 'border-radius: 0 4px 4px 0;';
                    
                    // Build tooltip
                    const datePart = tx.date_operation.split('T')[0];
                    const formattedDate = datePart.split('-').reverse().join('/');
                    let statusText = window.i18n.t('rec_gantt_status_pending');
                    if (isReconciled) statusText = window.i18n.t('rec_gantt_status_reconciled');
                    else if (isSkipped) statusText = window.i18n.t('rec_gantt_status_skipped');
                    const tooltip = `${tx.description} — ${formattedDate}\n${formatCurrency(tx.amount)} • ${statusText}`;
                    
                    // Multiple transactions in same month: show count, plus stacked amount
                    let labelDayStr = '';
                    if (window.i18n.lang === 'en') {
                        const getOrdinalSuffix = (d) => {
                            if (d > 3 && d < 21) return 'th';
                            switch (d % 10) {
                                case 1:  return "st";
                                case 2:  return "nd";
                                case 3:  return "rd";
                                default: return "th";
                            }
                        };
                        labelDayStr = `${day}${getOrdinalSuffix(day)}`;
                        if (monthTx.length > 1) {
                            labelDayStr += `+${monthTx.length - 1}`;
                        }
                    } else {
                        const labelBase = monthTx.length > 1 ? `${day}+${monthTx.length - 1}` : `${day}`;
                        labelDayStr = `Le ${labelBase}`;
                    }
                    const skipStyle = isSkipped ? 'text-decoration: line-through;' : '';
                    const label = `<span style="${skipStyle}">${labelDayStr}</span><span style="font-size: 8.5px; opacity: 0.95; font-weight: 600; ${skipStyle}">${formatCurrency(tx.amount)}</span>`;
                    
                    segmentsHtml += `<div class="gantt-segment ${segmentClass}" style="${borderRadius}" title="${tooltip}" data-tx-id="${tx.id}" data-template-id="${t.id}" onclick="event.stopPropagation(); window.RecurrenceView.showSegmentPopover(${tx.id}, ${t.id}, this)"><span class="gantt-segment-label">${label}</span></div>`;
                } else {
                    segmentsHtml += `<div class="gantt-segment gantt-segment-empty"></div>`;
                }
            }
            
            const displayStyle = isExpanded ? '' : 'display: none;';
            
            timelineHtml += `
                <div id="rec-row-${t.id}" class="gantt-row" onclick="window.RecurrenceView.toggleRow(${t.id})" style="position: relative;">
                    <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: ${typeColors.border}; box-shadow: -3px 0 8px -1px ${typeColors.border}; z-index: 2;"></div>
                    <div style="position: absolute; left: 0; top: 0; bottom: 0; width: 10px; cursor: help; z-index: 3;" title="${typeColors.label}" onclick="event.stopPropagation()"></div>
                    <div class="gantt-desc">
                        <span id="chevron_${t.id}" style="${chevronStyle}">❯</span>
                        <span style="margin-left: 5px;">${t.description}</span>
                        <div style="font-size: 11px; font-weight: normal; color: var(--text-muted); margin-top: 2px;">${t.category || '--'} • ${freqLabel} • <span class="privacy-blur" style="color: ${typeColors.text};">${formatCurrency(t.displayAmount)}</span></div>
                    </div>
                    <div class="gantt-bar-container">${segmentsHtml}</div>
                </div>
                <div id="details_row_${t.id}" style="${displayStyle} background: var(--bg-sidebar); border-bottom: 1px solid var(--border-color);">
                    <div style="padding: 15px 20px;">
                        <div id="details_content_${t.id}">
                            <!-- Rendered dynamically -->
                        </div>
                    </div>
                </div>
            `;
        });
        
        timelineHtml += `</div>`;
        tableContainer.innerHTML = timelineHtml;
        
        this.expandedTemplateIds.forEach(id => {
            this.renderTemplateDetails(id);
        });
    },

    getTypeColors(t) {
        let detectedType = t.type;
        // Infer type dynamically based on accounts configuration to safeguard against database inconsistency
        if (t.from_account_id && t.to_account_id) {
            detectedType = 'transfer';
        } else if (!t.from_account_id && t.to_account_id) {
            detectedType = 'income';
        } else if (t.from_account_id && !t.to_account_id && (t.type === 'transfer' || t.type === 'income')) {
            // Safe fallback if it was misconfigured as transfer/income but lacks one of the accounts
            detectedType = 'expense_fixed';
        }

        if (detectedType === 'income') {
            return { border: '#36b37e', text: '#36b37e', label: window.i18n.t('edit_type_option_income') || 'Revenu' };
        } else if (detectedType === 'transfer') {
            return { border: '#00b8d9', text: '#00b8d9', label: window.i18n.t('edit_type_option_transfer') || 'Virement' };
        }
        const label = detectedType === 'expense_var'
            ? (window.i18n.t('edit_type_option_expense_var') || 'Dépense variable')
            : (window.i18n.t('edit_type_option_expense_fixed') || 'Dépense fixe');
        return { border: '#e06050', text: 'var(--text-main)', label };
    },

    getAvailableFrequencies() {
        const templates = this.lastDisplayTemplates || this.templates || [];
        const freqSet = new Set();
        templates.forEach(t => {
            if (t.frequency) freqSet.add(t.frequency.toLowerCase());
        });
        // Sort: monthly first, then yearly, then alphabetical for the rest
        const order = ['monthly', 'yearly', 'weekly', 'bi-weekly', 'bi-monthly', 'quarterly', 'semi-annually'];
        return Array.from(freqSet).sort((a, b) => {
            const ia = order.indexOf(a);
            const ib = order.indexOf(b);
            if (ia !== -1 && ib !== -1) return ia - ib;
            if (ia !== -1) return -1;
            if (ib !== -1) return 1;
            return a.localeCompare(b);
        });
    },

    showSegmentPopover(txId, templateId, segmentEl) {
        // Close any existing popover
        this.closeSegmentPopover();
        
        const tx = (this.allTransactions || []).find(t => t.id === txId);
        if (!tx) return;
        
        const isSkipped = tx.is_skipped === true || tx.is_skipped === 'true';
        const isReconciled = tx.reconciliation_date != null && !isSkipped;
        
        const datePart = tx.date_operation.split('T')[0];
        const formattedDate = datePart.split('-').reverse().join('/');
        
        const popover = document.createElement('div');
        popover.className = 'gantt-popover';
        popover.id = 'ganttPopoverActive';
        popover.style.padding = '8px';
        popover.style.width = '240px';
        
        let skipActionHtml = '';
        if (!isReconciled) {
            if (isSkipped) {
                skipActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.toggleSkipInDetails(${txId}, ${templateId})">↩️ ${window.i18n.t('rec_popover_action_unskip') || 'Rétablir l\'échéance'}</button>`;
            } else {
                skipActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.toggleSkipInDetails(${txId}, ${templateId})">⏭️ ${window.i18n.t('rec_popover_action_skip') || 'Ignorer l\'échéance'}</button>`;
            }
        }
        
        let reconcileActionHtml = '';
        if (isReconciled) {
            reconcileActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.toggleReconciliationInDetails(${txId}, ${templateId})">🔓 ${window.i18n.t('rec_popover_action_unreconcile') || 'Annuler le rapprochement'}</button>`;
        } else if (!isSkipped) {
            reconcileActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.toggleReconciliationInDetails(${txId}, ${templateId})">✅ ${window.i18n.t('rec_popover_action_reconcile') || 'Rapprocher (Pointer)'}</button>`;
        }
        
        // Pass complete transaction object to FormView.openEdit by resolving it from memory
        const editActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.openEditForTx(${txId})">✏️ ${window.i18n.t('rec_popover_action_edit') || 'Modifier l\'opération'}</button>`;
        
        const tpl = (this.templates || []).find(t => t.id === templateId);
        let closeSubActionHtml = '';
        if (tpl) {
            if (tpl.is_closed) {
                closeSubActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.reopenTemplate(${templateId})">🔓 ${window.i18n.t('rec_popover_action_reopen_sub') || 'Rouvrir l\'abonnement'}</button>`;
            } else {
                closeSubActionHtml = `<button class="gantt-popover-item" onclick="window.RecurrenceView.closeSegmentPopover(); window.RecurrenceView.showCloseModal(${templateId})">🛑 ${window.i18n.t('rec_popover_action_close_sub') || 'Clôturer l\'abonnement'}</button>`;
            }
        }
        
        popover.innerHTML = `
            <div style="padding: 6px 10px; border-bottom: 1px solid var(--border-color); margin-bottom: 4px;">
                <div style="font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">${window.i18n.t('rec_popover_title') || 'Options de l\'échéance'}</div>
                <div style="font-size: 12px; font-weight: 600; color: var(--text-main); margin-top: 4px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${tx.description}</div>
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">📅 ${formattedDate} • <span class="privacy-blur">${formatCurrency(tx.amount)}</span></div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 2px;">
                ${skipActionHtml}
                ${reconcileActionHtml}
                ${editActionHtml}
                ${closeSubActionHtml}
            </div>
        `;
        
        document.body.appendChild(popover);
        
        // Position relative to segmentEl
        const rect = segmentEl.getBoundingClientRect();
        const popW = 240;
        const popH = popover.offsetHeight || 180;
        let left = rect.left + rect.width / 2 - popW / 2;
        let top = rect.bottom + 8;
        
        // Keep within viewport
        if (left < 10) left = 10;
        if (left + popW > window.innerWidth - 10) left = window.innerWidth - popW - 10;
        if (top + popH > window.innerHeight) top = rect.top - popH - 8;
        
        popover.style.left = left + 'px';
        popover.style.top = top + 'px';
        
        // Close on outside click (delayed to avoid immediate close)
        setTimeout(() => {
            this._popoverClickHandler = (e) => {
                if (!popover.contains(e.target) && e.target !== segmentEl) {
                    this.closeSegmentPopover();
                }
            };
            document.addEventListener('click', this._popoverClickHandler, { once: true });
        }, 50);
    },

    openEditForTx(txId) {
        const tx = (this.allTransactions || []).find(t => t.id === txId);
        if (tx && window.FormView && window.FormView.openEdit) {
            window.FormView.openEdit(tx);
        }
    },

    closeSegmentPopover() {
        const existing = document.getElementById('ganttPopoverActive');
        if (existing) existing.remove();
        if (this._popoverClickHandler) {
            document.removeEventListener('click', this._popoverClickHandler);
            this._popoverClickHandler = null;
        }
    },

    async toggleReconciliationInDetails(txId, templateId) {
        try {
            await API.post(`/api/transactions/${txId}/toggle_reconciliation`);
            window.app.refreshSidebar();
            await this.loadData();
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la modification", "error");
        }
    },

    setPeriodFilter(freq) {
        // Toggle: if already selected, deselect
        if (this.activePeriodFilter === freq) {
            this.activePeriodFilter = 'all';
        } else {
            this.activePeriodFilter = freq;
        }
        ProfileStorage.set('recurrences_periodFilter', this.activePeriodFilter);
        this._updateFilterBadges();
        this.renderMainContent();
    },

    setDurationFilter(duration) {
        // Toggle: if already selected, deselect
        if (this.activeDurationFilter === duration) {
            this.activeDurationFilter = 'all';
        } else {
            this.activeDurationFilter = duration;
        }
        ProfileStorage.set('recurrences_durationFilter', this.activeDurationFilter);
        this._updateFilterBadges();
        this.renderMainContent();
    },

    resetAllFilters() {
        this.activeDurationFilter = 'all';
        this.activePeriodFilter = 'all';
        ProfileStorage.set('recurrences_durationFilter', 'all');
        ProfileStorage.set('recurrences_periodFilter', 'all');
        this._updateFilterBadges();
        this.renderMainContent();
    },

    changeYear(delta) {
        this.selectedYear += delta;
        const yearDisplay = document.getElementById('recYearDisplay');
        if (yearDisplay) yearDisplay.textContent = this.selectedYear;
        this.loadData();
    },

    _updateFilterBadges() {
        // Update duration badges
        document.querySelectorAll('.btn-filter-duration').forEach(btn => {
            const val = btn.getAttribute('data-filter-duration');
            btn.classList.toggle('active', val === this.activeDurationFilter);
        });
        // Update period badges
        document.querySelectorAll('.btn-filter-period').forEach(btn => {
            const val = btn.getAttribute('data-filter-period');
            btn.classList.toggle('active', val === this.activePeriodFilter);
        });
        // Update reset/all button
        document.querySelectorAll('.btn-filter-reset').forEach(btn => {
            btn.classList.toggle('active', this.activeDurationFilter === 'all' && this.activePeriodFilter === 'all');
        });
    },

    _renderDynamicFrequencyBadges() {
        // Find the filter container (parent of the reset button)
        const resetBtn = document.querySelector('.btn-filter-reset');
        if (!resetBtn) return;
        const container = resetBtn.parentElement;
        if (!container) return;
        
        // Remove old dynamic period badges
        container.querySelectorAll('.btn-filter-period').forEach(b => b.remove());
        // Remove old dynamic separator (the one before the period badges)
        const separators = container.querySelectorAll('.filter-separator');
        if (separators.length > 2) {
            // Keep only the first two separators (before/after duration buttons)
            for (let i = 2; i < separators.length; i++) separators[i].remove();
        }
        
        const availableFreqs = this.getAvailableFrequencies();
        if (availableFreqs.length === 0) return;
        
        const periodFilter = this.activePeriodFilter || 'all';
        
        // Add separator before frequency badges
        const sep = document.createElement('div');
        sep.className = 'filter-separator';
        container.appendChild(sep);
        
        availableFreqs.forEach(freq => {
            const btn = document.createElement('button');
            const isActive = periodFilter === freq.toLowerCase();
            btn.className = `btn-filter btn-filter-period${isActive ? ' active' : ''}`;
            btn.setAttribute('data-filter-period', freq.toLowerCase());
            btn.onclick = () => window.RecurrenceView.setPeriodFilter(freq.toLowerCase());
            btn.textContent = window.i18n.t('rec_' + freq.toLowerCase()) || freq;
            container.appendChild(btn);
        });
    },

    applyFilter() {
        this.renderMainContent();
    },

    setViewMode(viewMode) {
        this.currentViewMode = viewMode;
        ProfileStorage.set('recurrences_viewMode', viewMode);
        
        const tableBtn = document.getElementById('viewModeTable');
        const timelineBtn = document.getElementById('viewModeTimeline');
        if (tableBtn && timelineBtn) {
            if (viewMode === 'timeline') {
                tableBtn.classList.remove('active');
                timelineBtn.classList.add('active');
            } else {
                tableBtn.classList.add('active');
                timelineBtn.classList.remove('active');
            }
        }
        
        this.renderMainContent();
    },

    setSort(columnName) {
        if (this.sortBy === columnName) {
            this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortBy = columnName;
            this.sortOrder = 'asc';
        }
        ProfileStorage.set('recurrences_sortBy', this.sortBy);
        ProfileStorage.set('recurrences_sortOrder', this.sortOrder);
        this.loadData();
    },

    getSortArrow(columnName) {
        if (this.sortBy === columnName) {
            return this.sortOrder === 'asc' ? ' <span style="font-size: 10px; color: var(--accent);">▲</span>' : ' <span style="font-size: 10px; color: var(--accent);">▼</span>';
        }
        return ' <span style="font-size: 10px; color: var(--text-muted); opacity: 0.3;">▲</span>';
    },

    toggleRow(templateId) {
        const detailsRow = document.getElementById(`details_row_${templateId}`);
        const chevron = document.getElementById(`chevron_${templateId}`);
        if (!detailsRow) return;
        
        if (this.expandedTemplateIds.has(templateId)) {
            this.expandedTemplateIds.delete(templateId);
            detailsRow.style.setProperty('display', 'none', 'important');
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        } else {
            this.expandedTemplateIds.add(templateId);
            const disp = (this.currentViewMode === 'timeline' || window.innerWidth <= 768) ? 'block' : 'table-row';
            detailsRow.style.setProperty('display', disp, 'important');
            if (chevron) chevron.style.transform = 'rotate(90deg)';
            this.renderTemplateDetails(templateId);
        }
    },

    renderTemplateDetails(templateId) {
        const container = document.getElementById(`details_content_${templateId}`);
        if (!container) return;
        
        // Filter occurrences for this template in the selected year
        const templateTx = (this.allTransactions || []).filter(tx => 
            tx.recurrence_id == templateId && 
            tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear
        ).sort((a, b) => a.date_operation.localeCompare(b.date_operation));
        
        if (templateTx.length === 0) {
            container.innerHTML = `<div style="text-align: center; padding: 20px; color: var(--text-muted);">${window.i18n.t('msg_no_operations_this_year')}</div>`;
            return;
        }
        
        // Backup original values if not already backed up
        templateTx.forEach(tx => {
            if (tx._original_amount === undefined) tx._original_amount = tx.amount;
            if (tx._original_date === undefined) tx._original_date = tx.date_operation;
        });
        
        const hasChanges = templateTx.some(tx => this.modifiedRows.has(tx.id));
        const buttonDisplay = hasChanges ? 'inline-block' : 'none';

        const tpl = (this.templates || []).find(t => t.id === templateId);

        let instancesHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4 style="margin: 0; color: var(--text-muted); font-size: 14px; font-weight: bold;">${window.i18n.t('rec_year_details_title') || 'Détails des opérations de l\'année'}</h4>
                <div style="display: flex; align-items: center; gap: 10px;">
                    <button id="save_btn_${templateId}" class="btn btn-primary" style="display: ${buttonDisplay}; padding: 6px 15px; font-size: 13px; font-weight: bold;" onclick="window.RecurrenceView.saveTemplateChanges(${templateId})">${window.i18n.t('btn_save_changes') || 'Sauvegarder les modifications'}</button>
                    <div style="display: flex; gap: 6px; border-left: 1px solid var(--border-color); padding-left: 10px;">
                        <button class="btn btn-secondary" style="padding: 5px 9px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='var(--primary-color, #6366f1)'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.openEditModal(${templateId})" title="${window.i18n.t('tooltip_edit') || 'Modifier'}">✏️</button>
                        ${tpl && tpl.is_closed
                            ? `<button class="btn btn-secondary" style="padding: 5px 9px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='#10b981'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.reopenTemplate(${templateId})" title="${window.i18n.t('tooltip_reopen') || 'Rouvrir'}">🔓</button>`
                            : `<button class="btn btn-secondary" style="padding: 5px 9px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='#f59e0b'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.showCloseModal(${templateId})" title="${window.i18n.t('tooltip_close') || 'Clôturer'}">🛑</button>`
                        }
                        <button class="btn btn-secondary btn-delete" style="padding: 5px 9px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='var(--danger, #ff5630)'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.deleteTemplate(${templateId})" title="${window.i18n.t('tooltip_delete') || 'Delete'}">🗑️</button>
                    </div>
                </div>
            </div>
            <div class="rec-instance-header" style="display: grid; grid-template-columns: 1fr 1fr 110px 140px; gap: 10px; margin-bottom: 10px; padding: 0 10px; font-weight: bold; color: var(--text-muted); text-align: center; font-size: 13px;">
                <div data-i18n="rec_col_date">${window.i18n.t('rec_col_date')}</div>
                <div data-i18n="rec_col_amount">${window.i18n.t('rec_col_amount')}</div>
                <div data-i18n="rec_col_status" data-i18n="rec_col_status">${window.i18n.t('rec_col_status') || 'Statut'}</div>
                <div></div>
            </div>
            <div class="rec-instances-list" style="display: flex; flex-direction: column; gap: 8px; max-height: 380px; overflow-y: auto; padding-right: 4px;">
        `;
        
        instancesHtml += templateTx.map(tx => {
            const isModified = this.modifiedRows.has(tx.id);
            const isSkipped = tx.is_skipped === true;
            const isReconciled = tx.reconciliation_date != null && !isSkipped;
            
            const justPropagated = (this.lastPropagate && this.lastPropagate.txId === tx.id);
            
            let bg = isModified ? 'rgba(51, 102, 255, 0.05)' : (isReconciled ? 'var(--bg-base)' : 'var(--bg-surface)');
            if (isSkipped) {
                bg = 'rgba(100, 116, 139, 0.05)';
            }
            const opClass = (isReconciled || isSkipped) ? 'opacity: 0.6;' : '';
            const readonly = (isReconciled || isSkipped) ? 'readonly disabled' : '';
            
            const dateStr = tx.date_operation.split('T')[0];
            
            let actionBtn = '';
            if (justPropagated) {
                const oldAmtStr = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(this.lastPropagate.oldAmount);
                actionBtn = `<button class="btn btn-danger" style="padding: 5px; font-size: 11px; width: 100%; white-space: normal;" onclick="window.RecurrenceView.undoPropagate(${templateId})">Annuler (Retour à ${oldAmtStr})</button>`;
            } else if (isModified && !isReconciled) {
                actionBtn = `<button class="btn btn-primary" style="padding: 5px; font-size: 11px; width: 100%; white-space: normal;" onclick="window.RecurrenceView.propagate(${tx.id})" data-i18n="btn_propagate_down">Propager vers le bas ⬇️</button>`;
            }

            let statusHTML = '';
            if (isReconciled) {
                statusHTML = `<span class="badge" style="background: rgba(54, 179, 126, 0.15); color: var(--success); padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; white-space: nowrap;" onclick="event.stopPropagation(); window.RecurrenceView.showSegmentPopover(${tx.id}, ${templateId}, this)">✅ ${window.i18n.t('rec_gantt_status_reconciled') || 'Pointé'}</span>`;
            } else if (isSkipped) {
                statusHTML = `<span class="badge" style="background: rgba(145, 158, 171, 0.15); color: var(--text-muted); padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; text-decoration: line-through; white-space: nowrap;" onclick="event.stopPropagation(); window.RecurrenceView.showSegmentPopover(${tx.id}, ${templateId}, this)">⏭️ ${window.i18n.t('rec_gantt_status_skipped') || 'Ignoré'}</span>`;
            } else {
                statusHTML = `<span class="badge" style="background: rgba(51, 102, 255, 0.12); color: var(--accent); padding: 4px 8px; border-radius: 6px; font-size: 11px; cursor: pointer; white-space: nowrap;" onclick="event.stopPropagation(); window.RecurrenceView.showSegmentPopover(${tx.id}, ${templateId}, this)">⏳ ${window.i18n.t('rec_gantt_status_pending') || 'En attente'}</span>`;
            }
 
            return `
            <div class="rec-instance-row" style="display: grid; grid-template-columns: 1fr 1fr 110px 140px; gap: 10px; align-items: center; background: ${bg}; padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); ${opClass}">
                <input type="date" id="rec_date_${tx.id}" class="inline-input" value="${dateStr}" style="text-align: center; font-size: 13px;" onchange="window.RecurrenceView.markTemplateRowModified(${tx.id}, ${templateId})" ${readonly}>
                <input type="number" id="rec_amount_${tx.id}" class="inline-input" value="${tx.amount}" step="0.01" style="text-align: center; font-size: 13px;" onchange="window.RecurrenceView.markTemplateRowModified(${tx.id}, ${templateId})" ${readonly}>
                <div style="text-align: center; display: flex; justify-content: center; align-items: center;">${statusHTML}</div>
                <div>${actionBtn}</div>
            </div>
            `;
        }).join('');
        
        instancesHtml += `</div>`;
        container.innerHTML = instancesHtml;
    },
    async toggleSkipInDetails(txId, templateId) {
        try {
            await API.post(`/api/transactions/${txId}/toggle_skip`);
            window.app.refreshSidebar();
            await this.loadData();
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la modification", "error");
        }
    },
    
    markTemplateRowModified(txId, templateId) {
        const dateInput = document.getElementById(`rec_date_${txId}`);
        const amountInput = document.getElementById(`rec_amount_${txId}`);
        
        if (dateInput && amountInput) {
            const tx = this.allTransactions.find(t => t.id === txId);
            if (tx) {
                tx.date_operation = dateInput.value;
                tx.amount = parseFloat(amountInput.value) || 0;
            }
        }
        
        this.modifiedRows.add(txId);
        this.renderTemplateDetails(templateId);
    },

    async saveTemplateChanges(templateId) {
        // Find all modified transactions that belong to this template
        const templateTx = this.allTransactions.filter(tx => 
            tx.recurrence_id == templateId && 
            tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear
        );
        const modifiedInTemplate = Array.from(this.modifiedRows).filter(id => 
            templateTx.some(tx => tx.id === id)
        );
        
        if (modifiedInTemplate.length === 0) return;
        
        const btn = document.getElementById(`save_btn_${templateId}`);
        const originalText = btn ? btn.innerHTML : '';
        
        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '⏳ ...';
            }
            
            for (let id of modifiedInTemplate) {
                const dateVal = document.getElementById(`rec_date_${id}`).value;
                const amountVal = parseFloat(document.getElementById(`rec_amount_${id}`).value);
                await API.put(`/api/transactions/${id}`, {
                    date_operation: dateVal,
                    amount: amountVal
                });
                this.modifiedRows.delete(id);
            }
            
            window.app.refreshSidebar();
            await this.loadData();
            
            // Re-fetch the new button from the DOM after loadData re-renders the table
            const successBtn = document.getElementById(`save_btn_${templateId}`);
            if (successBtn) {
                const successOriginalText = successBtn.innerHTML;
                successBtn.innerHTML = '✅ ' + window.i18n.t('btn_saved');
                successBtn.style.background = 'var(--success, #2ecc71)';
                successBtn.style.transition = 'background-color 0.5s ease';
                setTimeout(() => {
                    const currentBtn = document.getElementById(`save_btn_${templateId}`);
                    if (currentBtn) {
                        currentBtn.style.background = '';
                        currentBtn.innerHTML = successOriginalText;
                    }
                }, 4000);
            }
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la sauvegarde", "error");
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        }
    },
    
    async propagate(txId) {
        const dateVal = document.getElementById(`rec_date_${txId}`).value;
        const amountVal = parseFloat(document.getElementById(`rec_amount_${txId}`).value);
        
        if (!dateVal || isNaN(amountVal)) return;
        
        const originalTx = this.allTransactions.find(t => t.id === txId);
        if (!originalTx) return;
        
        const templateId = originalTx.recurrence_id;
        
        try {
            const res = await API.post(`/api/recurrences/${templateId}/propagate`, {
                transaction_id: txId,
                new_amount: amountVal,
                new_date: dateVal
            });
            window.app.refreshSidebar();
            
            // Save state for undo using the TRULY original values before user modified them
            this.lastPropagate = {
                txId: txId,
                templateId: templateId,
                oldDate: originalTx._original_date.split('T')[0],
                oldAmount: originalTx._original_amount
            };
            
            await this.refreshTransactions();
            
            // Highlight updated inputs successfully
            setTimeout(() => {
                const templateTx = this.allTransactions.filter(tx => tx.recurrence_id == templateId);
                const affectedRows = templateTx.filter(t => t.date_operation >= dateVal);
                affectedRows.forEach(t => {
                    const dInput = document.getElementById(`rec_date_${t.id}`);
                    const aInput = document.getElementById(`rec_amount_${t.id}`);
                    if (dInput && dInput.value !== originalTx._original_date.split('T')[0]) {
                        dInput.style.transition = 'background-color 0.5s';
                        dInput.style.backgroundColor = 'rgba(40, 167, 69, 0.2)';
                        setTimeout(() => dInput.style.backgroundColor = '', 2000);
                    }
                    if (aInput && parseFloat(aInput.value) !== originalTx._original_amount) {
                        aInput.style.transition = 'background-color 0.5s';
                        aInput.style.backgroundColor = 'rgba(40, 167, 69, 0.2)';
                        setTimeout(() => aInput.style.backgroundColor = '', 2000);
                    }
                });
            }, 100);
            
        } catch (e) {
            console.error("Propagate error", e);
            await showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_propagation_error'));
        }
    },
    
    async undoPropagate(templateId) {
        if (!this.lastPropagate || this.lastPropagate.templateId !== templateId) return;
        const p = this.lastPropagate;
        try {
            await API.post(`/api/recurrences/${templateId}/propagate`, {
                transaction_id: p.txId,
                new_amount: p.oldAmount,
                new_date: p.oldDate
            });
            this.lastPropagate = null;
            window.app.refreshSidebar();
            await this.refreshTransactions();
        } catch (e) {
            console.error("Undo error", e);
            await showInlineMessage(window.i18n.t('title_error'), window.i18n.t('msg_cancel_error'));
        }
    },

    async changeTemplateCategory(selectElement, templateId) {
        const val = selectElement.value;
        if (val === '__new__') {
            const title = window.i18n.t('wizard_prompt_new_category_title') || 'Name of the new fixed expense category:';
            const name = await showInlinePrompt(title);
            if (name && name.trim()) {
                try {
                    const newCat = await API.post('/api/categories/', { name: name.trim(), type: 'expense_fixed' });
                    await API.patch(`/api/recurrences/${templateId}/category`, { category: newCat.name });
                    showToast(window.i18n.t('msg_category_added') || 'Category added');
                } catch (e) {
                    let isConflict = false;
                    let msg = e.message || '';
                    try {
                        const parsed = JSON.parse(e.message);
                        msg = parsed.detail || e.message;
                    } catch(err) {}

                    if (msg.includes("already exists") || msg.includes("déjà")) {
                        isConflict = true;
                    }

                    if (isConflict) {
                        const suffix = window.i18n.t('cat_suffix_fixed') || ' (Fixes)';
                        const suggestedName = `${name.trim()}${suffix}`;
                        const suffixPromptMsg = window.i18n.tp('cat_conflict_suffix_prompt', { name: name.trim(), suggestedName: suggestedName });

                        if (await showInlineConfirm(window.i18n.t('cat_conflict_title') || "Conflit de catégorie", suffixPromptMsg)) {
                            try {
                                const newCat = await API.post('/api/categories/', { name: suggestedName, type: 'expense_fixed' });
                                await API.patch(`/api/recurrences/${templateId}/category`, { category: newCat.name });
                                showToast(window.i18n.t('msg_category_added') || 'Category added');
                                await this.loadData();
                                return;
                            } catch(errSuffix) {
                                showToast(window.i18n.t('msg_category_create_error') || 'Category creation error', 'error');
                                return;
                            }
                        }

                        const confirmMsg = window.i18n.tp('cat_conflict_confirm', { name: name });
                        if (await showInlineConfirm(window.i18n.t('cat_conflict_title') || "Conflit de catégorie", confirmMsg)) {
                            try {
                                const newCat = await API.post('/api/categories/?force_move=true', { name: name.trim(), type: 'expense_fixed' });
                                await API.patch(`/api/recurrences/${templateId}/category`, { category: newCat.name });
                                showToast(window.i18n.t('msg_category_added') || 'Category added');
                            } catch(err2) {
                                showToast(window.i18n.t('cat_move_error') || "Erreur lors du déplacement de la catégorie", "error");
                            }
                        }
                    } else {
                        console.error("Failed to create category", e);
                        showToast(window.i18n.t('msg_category_create_error') || 'Category creation error', 'error');
                    }
                }
            }
            await this.loadData();
        } else {
            try {
                await API.patch(`/api/recurrences/${templateId}/category`, { category: val || null });
                showToast(window.i18n.t('cat_updated') || "Catégorie mise à jour");
            } catch (e) {
                console.error(e);
                showToast(window.i18n.t('cat_update_error') || "Erreur lors de la mise à jour de la catégorie", "error");
            }
            await this.loadData();
        }
    },

    async deleteTemplate(templateId) {
        const confirm = await showInlineConfirm('title_deletion', 'confirm_delete_template');
        if (!confirm) return;
        
        try {
            const res = await API.del(`/api/recurrences/${templateId}`);
            if (this.expandedTemplateIds.has(templateId)) {
                this.expandedTemplateIds.delete(templateId);
            }
            await window.app.refreshSidebar();
            await this.loadData();
            showUndoToast(window.i18n.t('msg_template_deleted') || 'Recurrence deleted', res.action_id, () => this.loadData());
        } catch (e) {
            console.error(e);
            showToast(window.i18n.t('rec_delete_error') || "Impossible de supprimer la récurrence", "error");
        }
    },

    async showCloseModal(templateId) {
        const tpl = (this.templates || []).find(t => t.id === templateId);
        if (!tpl) {
            showToast("Récurrence introuvable", "error");
            return;
        }

        const todayStr = new Date().toISOString().substring(0, 10);
        
        const now = new Date();
        const lastDayObj = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const endOfMonthStr = lastDayObj.toISOString().substring(0, 10);

        const modal = document.createElement('div');
        modal.id = 'closeSubscriptionModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1000';

        const title = window.i18n.t('rec_close_title') || "Clôturer l'abonnement";
        const explanation = window.i18n.t('rec_close_explanation') || "L'abonnement sera marqué comme clôturé et conservé dans vos archives. Les échéances futures non rapprochées strictement après la date choisie seront automatiquement supprimées.";
        const dateLabel = window.i18n.t('rec_close_date_label') || "Date d'effet de la clôture";
        const optToday = (window.i18n.t('rec_close_option_today') || "Aujourd'hui ({date})").replace('{date}', todayStr);
        const optEndMonth = (window.i18n.t('rec_close_option_end_month') || "Fin du mois en cours ({date})").replace('{date}', endOfMonthStr);
        const optCustom = window.i18n.t('rec_close_option_custom') || "Date personnalisée";
        const confirmBtnText = window.i18n.t('rec_close_confirm_btn') || "Clôturer l'abonnement";

        modal.innerHTML = `
            <div class="modal" style="width: 90%; max-width: 520px; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); padding: 25px; display: flex; flex-direction: column; gap: 20px; animation: modalFadeIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
                    <div>
                        <h3 style="margin: 0; font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px;">🛑 ${title}</h3>
                        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">${tpl.description} (${formatCurrency(tpl.displayAmount || tpl.amount)})</div>
                    </div>
                    <button style="background: transparent; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted);" onclick="document.getElementById('closeSubscriptionModal').remove()">×</button>
                </div>
                
                <div style="font-size: 13px; color: var(--text-main); line-height: 1.5; background: rgba(245, 158, 11, 0.08); border-left: 4px solid #f59e0b; padding: 12px; border-radius: 6px;">
                    ${explanation}
                </div>

                <form id="closeSubscriptionForm" style="display: flex; flex-direction: column; gap: 15px;" onsubmit="event.preventDefault(); window.RecurrenceView.submitCloseModal(${tpl.id})">
                    <div style="display: flex; flex-direction: column; gap: 8px;">
                        <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${dateLabel}</label>
                        
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base);">
                            <input type="radio" name="close_date_type" value="today" checked onchange="window.RecurrenceView.toggleCloseCustomDate(false)">
                            <span>${optToday}</span>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base);">
                            <input type="radio" name="close_date_type" value="end_month" onchange="window.RecurrenceView.toggleCloseCustomDate(false)">
                            <span>${optEndMonth}</span>
                        </label>
                        
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer; font-size: 13px; padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base);">
                            <input type="radio" name="close_date_type" value="custom" onchange="window.RecurrenceView.toggleCloseCustomDate(true)">
                            <span>${optCustom}</span>
                        </label>

                        <div id="close_custom_date_container" style="display: none; margin-top: 5px; padding-left: 28px;">
                            <input type="date" id="close_custom_date_input" value="${todayStr}" class="inline-input" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; width: 100%;">
                        </div>
                    </div>

                    <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 10px;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('closeSubscriptionModal').remove()" style="padding: 8px 16px;">${window.i18n.t('btn_cancel') || 'Annuler'}</button>
                        <button type="submit" class="btn btn-danger" style="padding: 8px 16px; background: var(--danger, #ff5630); color: #ffffff;">${confirmBtnText}</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
    },

    toggleCloseCustomDate(showCustom) {
        const container = document.getElementById('close_custom_date_container');
        if (container) {
            container.style.display = showCustom ? 'block' : 'none';
        }
    },

    async submitCloseModal(templateId) {
        const selectedType = document.querySelector('input[name="close_date_type"]:checked')?.value || 'today';
        let closureDate = new Date().toISOString().substring(0, 10);
        
        if (selectedType === 'end_month') {
            const now = new Date();
            const lastDayObj = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            closureDate = lastDayObj.toISOString().substring(0, 10);
        } else if (selectedType === 'custom') {
            closureDate = document.getElementById('close_custom_date_input')?.value || closureDate;
        }

        const formBtn = document.querySelector('#closeSubscriptionForm button[type="submit"]');
        const originalText = formBtn ? formBtn.textContent : '';

        try {
            if (formBtn) {
                formBtn.disabled = true;
                formBtn.textContent = '⏳ ...';
            }

            const res = await API.post(`/api/recurrences/${templateId}/close`, { closure_date: closureDate });
            
            document.getElementById('closeSubscriptionModal')?.remove();

            await window.app.refreshSidebar();
            await this.loadData();
            showUndoToast(window.i18n.t('rec_closed_success') || 'Abonnement clôturé avec succès !', res.action_id, () => this.loadData());
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la clôture de l'abonnement", "error");
            if (formBtn) {
                formBtn.disabled = false;
                formBtn.textContent = originalText;
            }
        }
    },

    async reopenTemplate(templateId) {
        const confirmed = await showInlineConfirm(
            window.i18n.t('rec_reopen_confirm_title') || "Rouvrir l'abonnement",
            window.i18n.t('rec_reopen_confirm_msg') || "Voulez-vous rouvrir cet abonnement ? Les échéances futures récurrentes seront régénérées."
        );
        if (!confirmed) return;

        try {
            const res = await API.post(`/api/recurrences/${templateId}/reopen`);
            await window.app.refreshSidebar();
            await this.loadData();
            showUndoToast(window.i18n.t('rec_reopened_success') || 'Abonnement rouvert avec succès !', res.action_id, () => this.loadData());
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la réouverture de l'abonnement", "error");
        }
    },
    
    async showWizard() {
        const targetYear = this.selectedYear + 1;
        const currentTemplates = JSON.parse(JSON.stringify(this.templates));
        
        let categories = [];
        try {
            categories = await API.get('/api/categories/');
            this.categories = categories; // Cache for addWizardRow()
        } catch (e) {
            console.error("Failed to load categories for wizard", e);
        }
        
        const cfg = window.app.config || {};
        const showBimonthly = (cfg.enable_bimonthly === 'true' || cfg.enable_bimonthly === true);
        
        const allTx = this.allTransactions || [];
        const uniqueYears = Array.from(new Set(allTx.filter(tx => tx.date_operation).map(tx => parseInt(tx.date_operation.substring(0, 4))))).sort((a, b) => b - a);
        const currentYear = new Date().getFullYear();
        if (!uniqueYears.includes(currentYear)) uniqueYears.push(currentYear);
        if (!uniqueYears.includes(targetYear - 1)) uniqueYears.push(targetYear - 1);
        uniqueYears.sort((a, b) => b - a);

        const yearOptions = uniqueYears.map(yr => `<option value="${yr}" ${yr === (targetYear - 1) ? 'selected' : ''}>${yr}</option>`).join('');

        let wizardHtml = `
            <div id="recWizardModal" class="modal-overlay" style="z-index: 1000;">
                <div class="modal" style="width: 95%; max-width: 1200px; height: 90vh; display: flex; flex-direction: column; overflow: hidden; padding: 0; border-radius: 14px; box-shadow: 0 25px 60px -12px rgba(0,0,0,0.6);">
                    <div style="padding: 20px; background: var(--bg-surface); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                        <h2 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">${window.i18n.t('wizard_title_prep')} <input type="number" id="wizardTargetYear" value="${targetYear}" style="background:transparent; border:none; color:inherit; font-size:inherit; font-weight:inherit; width:80px; border-bottom: 2px solid var(--primary-color); outline:none;" oninput="window.RecurrenceView.onTargetYearInput()"></h2>
                        <button class="btn btn-secondary" onclick="document.getElementById('recWizardModal').remove()">❌ ${window.i18n.t('btn_close')}</button>
                    </div>
                    <div style="padding: 15px 20px; background: var(--bg-sidebar); border-bottom: 1px solid var(--border-color); display: flex; gap: 20px; align-items: center; flex-wrap: wrap; justify-content: space-between; flex-shrink: 0;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-weight: 600; font-size: 14px;">${window.i18n.t('wizard_ref_year_label')} :</span>
                            <select id="wizardRefYearSelect" class="inline-input" style="padding: 6px 12px; border-radius: 6px; font-weight: bold; width: 100px;" onchange="window.RecurrenceView.filterWizardTemplates()">
                                ${yearOptions}
                            </select>
                        </div>
                        <button class="btn btn-secondary" style="padding: 8px 16px; font-size: 13px;" onclick="window.RecurrenceView.resetFromReferenceYear()">${window.i18n.t('wizard_btn_reset')}</button>
                    </div>
                    <div style="flex: 1; overflow-y: auto; padding: 20px; background: var(--bg-base);">
                        <table style="width: 100%; border-collapse: collapse; background: var(--bg-surface); border-radius: 8px; overflow: hidden; box-shadow: var(--shadow-sm);">
                            <thead>
                                <tr style="background: rgba(0,0,0,0.05); text-align: left;">
                                    <th style="padding: 15px; width: 100px; text-align: center; vertical-align: middle;">
                                        <input type="checkbox" id="wizardSelectAll" checked style="width: 20px; height: 20px; cursor: pointer; margin-bottom: 4px;" onclick="window.RecurrenceView.toggleSelectAll(this.checked)" title="${window.i18n.t('wizard_tooltip_select_all')}">
                                        <div style="font-size: 11px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('wizard_th_renew')}</div>
                                    </th>
                                    <th style="padding: 15px;">${window.i18n.t('col_description')}</th>
                                    <th style="padding: 15px;">${window.i18n.t('wizard_th_frequency')}</th>
                                    <th style="padding: 15px;">${window.i18n.t('col_category')}</th>
                                    <th style="padding: 15px;">${window.i18n.t('col_amount')}</th>
                                    <th style="padding: 15px;">${window.i18n.t('wizard_th_day')}</th>
                                </tr>
                            </thead>
                            <tbody id="wizardTemplatesBody">
        `;
        
        currentTemplates.forEach(t => {
             let freqOptions = `
                 <option value="Weekly" ${t.frequency === 'Weekly' ? 'selected' : ''}>${window.i18n.t('opt_freq_weekly') || 'Hebdomadaire'}</option>
                 <option value="Monthly" ${t.frequency === 'Monthly' ? 'selected' : ''}>${window.i18n.t('opt_freq_monthly')}</option>
                 <option value="Quarterly" ${t.frequency === 'Quarterly' ? 'selected' : ''}>${window.i18n.t('opt_freq_quarterly') || 'Trimestrielle'}</option>
                 <option value="Semi-Annually" ${t.frequency === 'Semi-Annually' ? 'selected' : ''}>${window.i18n.t('opt_freq_semi_annually') || 'Bi-annuelle'}</option>
                 <option value="Yearly" ${t.frequency === 'Yearly' ? 'selected' : ''}>${window.i18n.t('opt_freq_yearly')}</option>
             `;
             if (showBimonthly) {
                 freqOptions = `
                     <option value="Bi-Monthly" ${(t.frequency === 'Bi-Monthly' || t.frequency === 'Bi-Weekly') ? 'selected' : ''}>${window.i18n.t('opt_freq_bimonthly')}</option>
                 ` + freqOptions;
             }

            wizardHtml += `
                <tr style="border-bottom: 1px solid var(--border-color); transition: opacity 0.2s; ${t.is_closed ? 'opacity: 0.4;' : ''}" id="wizard_row_${t.id}">
                    <td style="padding: 10px; text-align: center;">
                        <input type="checkbox" id="wiz_renew_${t.id}" ${t.is_closed ? '' : 'checked'} style="width: 20px; height: 20px; cursor: pointer;" onchange="window.RecurrenceView.onRowRenewChange(this, '${t.id}')">
                    </td>
                    <td style="padding: 10px; font-weight: bold; font-size: 14px;">${t.description}</td>
                    <td style="padding: 10px;">
                        <select id="wiz_freq_${t.id}" class="inline-input" style="width:100%; font-size: 13px;">
                            ${freqOptions}
                        </select>
                    </td>
                    <td style="padding: 10px;">
                        <select id="wiz_cat_${t.id}" class="inline-input" style="width:100%; font-size: 13px;" onchange="window.RecurrenceView.onWizardCategoryChange(this, '${t.id}')">
                            <option value="">${window.i18n.t('wizard_opt_no_category')}</option>
                            ${categories.filter(c => c.type === 'expense_fixed' || c.name === t.category).map(c => `<option value="${c.name}" ${t.category === c.name ? 'selected' : ''}>${c.name}</option>`).join('')}
                            <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ ${window.i18n.t('wizard_opt_new_category') || 'New category...'}</option>
                        </select>
                    </td>
                    <td style="padding: 10px;">
                        <input type="number" id="wiz_amount_${t.id}" class="inline-input" value="${t.amount}" step="0.01" style="width: 100px; font-size: 13px; text-align: right;">
                    </td>
                    <td style="padding: 10px;">
                        <input type="number" id="wiz_day_${t.id}" class="inline-input" value="${t.day_of_month || 1}" min="1" max="31" style="width: 60px; font-size: 13px; text-align: center;">
                    </td>
                </tr>
            `;
        });
        
        wizardHtml += `
                            </tbody>
                        </table>
                        <div style="margin-top: 20px; text-align: center;">
                            <button class="btn btn-secondary" onclick="window.RecurrenceView.addWizardRow()">${window.i18n.t('wizard_btn_add_recurrence')}</button>
                        </div>
                    </div>
                    <div style="padding: 20px; background: var(--bg-surface); border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 15px; flex-shrink: 0;">
                        <button class="btn btn-secondary" style="padding: 15px 30px; font-weight: bold; font-size: 16px;" onclick="window.RecurrenceView.submitWizard(false)">${window.i18n.t('wizard_btn_save_close')}</button>
                        <button class="btn btn-primary" style="padding: 15px 30px; font-weight: bold; font-size: 16px; background: linear-gradient(135deg, #6c5ce7, #a29bfe); border: none;" onclick="window.RecurrenceView.submitWizard(true)">${window.i18n.t('wizard_btn_validate')}</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', wizardHtml);
        this.filterWizardTemplates();
    },
    
    onTargetYearInput() {
        const input = document.getElementById('wizardTargetYear');
        const refSelect = document.getElementById('wizardRefYearSelect');
        if (input && refSelect) {
            const targetYear = parseInt(input.value);
            if (targetYear && targetYear >= 2000) {
                refSelect.value = targetYear - 1;
                this.filterWizardTemplates();
            }
        }
    },
    
    filterWizardTemplates() {
        const refSelect = document.getElementById('wizardRefYearSelect');
        if (!refSelect) return;
        const refYear = parseInt(refSelect.value);
        if (!refYear) return;
        
        // Find active templates for the reference year
        const allTx = this.allTransactions || [];
        const activeTemplateIds = new Set(
            allTx.filter(tx => tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === refYear && tx.recurrence_id != null)
                 .map(tx => tx.recurrence_id)
        );
        
        this.templates.forEach(t => {
            const row = document.getElementById(`wizard_row_${t.id}`);
            if (row) {
                if (activeTemplateIds.has(t.id)) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            }
        });
        this.updateMasterCheckbox();
    },
    
    toggleSelectAll(checked) {
        const rows = document.querySelectorAll('#wizardTemplatesBody tr');
        rows.forEach(row => {
            if (row.style.display !== 'none') {
                const checkbox = row.querySelector('input[type="checkbox"][id^="wiz_renew_"]');
                if (checkbox) {
                    checkbox.checked = checked;
                    row.style.opacity = checked ? '1' : '0.4';
                }
            }
        });
    },
    
    onRowRenewChange(checkbox, id) {
        const row = document.getElementById(`wizard_row_${id}`);
        if (row) {
            row.style.opacity = checkbox.checked ? '1' : '0.4';
        }
        this.updateMasterCheckbox();
    },
    
    updateMasterCheckbox() {
        const master = document.getElementById('wizardSelectAll');
        if (!master) return;
        
        const rows = document.querySelectorAll('#wizardTemplatesBody tr');
        let allChecked = true;
        let anyChecked = false;
        let visibleCount = 0;
        
        rows.forEach(row => {
            if (row.style.display !== 'none') {
                const checkbox = row.querySelector('input[type="checkbox"][id^="wiz_renew_"]');
                if (checkbox) {
                    visibleCount++;
                    if (checkbox.checked) {
                        anyChecked = true;
                    } else {
                        allChecked = false;
                    }
                }
            }
        });
        
        if (visibleCount === 0) {
            master.checked = false;
            master.indeterminate = false;
        } else if (allChecked) {
            master.checked = true;
            master.indeterminate = false;
        } else if (anyChecked) {
            master.checked = false;
            master.indeterminate = true;
        } else {
            master.checked = false;
            master.indeterminate = false;
        }
    },
    
    resetFromReferenceYear() {
        const refSelect = document.getElementById('wizardRefYearSelect');
        if (!refSelect) return;
        const refYear = parseInt(refSelect.value);
        if (!refYear) return;
        
        this.templates.forEach(t => {
            // Find transactions of this template in refYear
            const refTx = (this.allTransactions || []).filter(tx => 
                tx.recurrence_id == t.id && 
                tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === refYear
            );
            
            let targetAmt = t.amount;
            let targetCat = t.category || "";
            let targetDay = t.day_of_month || 1;
            
            const renewCheckbox = document.getElementById(`wiz_renew_${t.id}`);
            const row = document.getElementById(`wizard_row_${t.id}`);
            
            if (refTx.length > 0) {
                // Sort descending to get the most recent transaction (lexicographical sort is timezone-independent)
                refTx.sort((a, b) => b.date_operation.localeCompare(a.date_operation));
                const latest = refTx[0];
                targetAmt = latest.amount;
                targetCat = latest.category || "";
                targetDay = parseInt(latest.date_operation.split('-')[2]) || 1;
                
                if (renewCheckbox) renewCheckbox.checked = true;
                if (row) row.style.opacity = '1';
            } else {
                if (renewCheckbox) renewCheckbox.checked = false;
                if (row) row.style.opacity = '0.4';
            }
            
            const amtInput = document.getElementById(`wiz_amount_${t.id}`);
            if (amtInput) amtInput.value = targetAmt;
            const catSelect = document.getElementById(`wiz_cat_${t.id}`);
            if (catSelect) catSelect.value = targetCat;
            const dayInput = document.getElementById(`wiz_day_${t.id}`);
            if (dayInput) dayInput.value = targetDay;
        });
        this.updateMasterCheckbox();
    },
    
    addWizardRow() {
        const body = document.getElementById('wizardTemplatesBody');
        const categories = this.categories || [];
        // Filter categories of type expense_fixed
        const fixedCats = categories.filter(c => c.type === 'expense_fixed');
        const catOptions = fixedCats.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        const newId = 'new_' + Date.now();
        
        const cfg = window.app.config || {};
        const showBimonthly = (cfg.enable_bimonthly === 'true' || cfg.enable_bimonthly === true);
        
        let freqOptions = `
            <option value="Weekly">${window.i18n.t('opt_freq_weekly') || 'Hebdomadaire'}</option>
            <option value="Monthly" selected>${window.i18n.t('opt_freq_monthly')}</option>
            <option value="Quarterly">${window.i18n.t('opt_freq_quarterly') || 'Trimestrielle'}</option>
            <option value="Semi-Annually">${window.i18n.t('opt_freq_semi_annually') || 'Bi-annuelle'}</option>
            <option value="Yearly">${window.i18n.t('opt_freq_yearly')}</option>
        `;
        if (showBimonthly) {
            freqOptions = `
                <option value="Bi-Monthly">${window.i18n.t('opt_freq_bimonthly')}</option>
            ` + freqOptions;
        }

        const row = `
            <tr style="border-bottom: 1px solid var(--border-color); background: rgba(108, 92, 231, 0.05);" class="wizard-new-row" data-id="${newId}">
                <td style="padding: 10px; text-align: center;">
                    <span title="${window.i18n.t('wizard_new_recurrence_title')}">✨</span>
                </td>
                <td style="padding: 10px;">
                    <input type="text" id="wiz_desc_${newId}" class="inline-input" placeholder="${window.i18n.t('col_description')}" style="width: 100%; font-size: 13px;">
                </td>
                <td style="padding: 10px;">
                    <select id="wiz_freq_${newId}" class="inline-input" style="width: 100%; font-size: 13px;">
                        ${freqOptions}
                    </select>
                </td>
                <td style="padding: 10px;">
                    <select id="wiz_cat_${newId}" class="inline-input" style="width:100%; font-size: 13px;" onchange="window.RecurrenceView.onWizardCategoryChange(this, '${newId}')">
                        <option value="">${window.i18n.t('wizard_opt_no_category')}</option>
                        ${catOptions}
                        <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ ${window.i18n.t('wizard_opt_new_category') || 'New category...'}</option>
                    </select>
                </td>
                <td style="padding: 10px;">
                    <input type="number" id="wiz_amount_${newId}" class="inline-input" placeholder="0.00" step="0.01" style="width: 100px; font-size: 13px; text-align: right;">
                </td>
                <td style="padding: 10px;">
                    <input type="number" id="wiz_day_${newId}" class="inline-input" value="1" min="1" max="31" style="width: 60px; font-size: 13px; text-align: center;">
                </td>
            </tr>
        `;
        body.insertAdjacentHTML('beforeend', row);
    },
    
    async onWizardCategoryChange(select, id) {
        if (select.value === '__new__') {
            const title = window.i18n.t('wizard_prompt_new_category_title') || 'Name of the new fixed expense category:';
            const name = await showInlinePrompt(title);
            if (name && name.trim()) {
                try {
                    const newCat = await API.post('/api/categories/', { name: name.trim(), type: 'expense_fixed' });
                    
                    const categories = await API.get('/api/categories/');
                    this.categories = categories;
                    
                    const fixedCategories = categories.filter(c => c.type === 'expense_fixed');
                    
                    this.templates.forEach(tpl => {
                        const sel = document.getElementById(`wiz_cat_${tpl.id}`);
                        if (sel) {
                            const val = (tpl.id == id) ? newCat.name : sel.value;
                            this.updateWizardCategorySelectOptions(sel, fixedCategories, val, tpl.category);
                        }
                    });
                    
                    document.querySelectorAll('.wizard-new-row').forEach(row => {
                        const rowId = row.getAttribute('data-id');
                        const sel = document.getElementById(`wiz_cat_${rowId}`);
                        if (sel) {
                            const val = (rowId == id) ? newCat.name : sel.value;
                            this.updateWizardCategorySelectOptions(sel, fixedCategories, val);
                        }
                    });
                    
                    showToast(window.i18n.t('msg_category_added') || 'Category added');
                } catch (e) {
                    console.error("Failed to create category in wizard", e);
                    showToast(window.i18n.t('msg_category_create_error') || 'Category creation error', 'error');
                    select.value = '';
                }
            } else {
                select.value = '';
            }
        }
    },
    
    updateWizardCategorySelectOptions(selectElement, fixedCategories, currentValue, originalCategoryValue = null) {
        const noCatLabel = window.i18n.t('wizard_opt_no_category') || '-- Category --';
        const newCatLabel = window.i18n.t('wizard_opt_new_category') || 'New category...';
        
        const displayCategories = [...fixedCategories];
        if (originalCategoryValue && !displayCategories.some(c => c.name === originalCategoryValue)) {
            displayCategories.push({ name: originalCategoryValue, type: 'other' });
        }
        
        let html = `<option value="">${noCatLabel}</option>`;
        html += displayCategories.map(c => `<option value="${c.name}">${c.name}</option>`).join('');
        html += `<option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ ${newCatLabel}</option>`;
        
        selectElement.innerHTML = html;
        selectElement.value = currentValue;
    },
    
    async submitWizard(generateInstances = true) {
        const targetYear = parseInt(document.getElementById('wizardTargetYear').value);
        if (!targetYear || targetYear < 2000) return;
        
        const updates = [];
        this.templates.forEach(t => {
            const row = document.getElementById(`wizard_row_${t.id}`);
            const isVisible = row && row.style.display !== 'none';
            
            const renewVal = isVisible && (document.getElementById(`wiz_renew_${t.id}`)?.checked || false);
            const amountEl = document.getElementById(`wiz_amount_${t.id}`);
            const dayEl = document.getElementById(`wiz_day_${t.id}`);
            const catEl = document.getElementById(`wiz_cat_${t.id}`);
            const freqEl = document.getElementById(`wiz_freq_${t.id}`);
            
            updates.push({
                id: t.id,
                renew: renewVal,
                amount: amountEl ? (parseFloat(amountEl.value) || 0) : t.amount,
                day_of_month: dayEl ? (parseInt(dayEl.value) || 1) : t.day_of_month,
                category: catEl ? (catEl.value || null) : t.category,
                frequency: freqEl ? freqEl.value : t.frequency
            });
        });
        
        const newTemplates = [];
        document.querySelectorAll('.wizard-new-row').forEach(row => {
            const newId = row.getAttribute('data-id');
            const desc = document.getElementById(`wiz_desc_${newId}`).value.trim();
            if (desc) {
                newTemplates.push({
                    description: desc,
                    amount: parseFloat(document.getElementById(`wiz_amount_${newId}`).value) || 0,
                    type: "expense_fixed", // par défaut
                    category: document.getElementById(`wiz_cat_${newId}`).value || null,
                    frequency: document.getElementById(`wiz_freq_${newId}`).value,
                    day_of_month: parseInt(document.getElementById(`wiz_day_${newId}`).value) || 1
                });
            }
        });
        
        try {
            const btn = document.querySelector('#recWizardModal .btn-primary');
            if (btn) {
                btn.disabled = true;
                btn.textContent = '⏳ Génération...';
            }
            
            await API.post('/api/recurrences/wizard_generate', {
                target_year: targetYear,
                updates: updates,
                new_templates: newTemplates,
                generate_instances: generateInstances
            });
            if (generateInstances) {
                await showInlineMessage(window.i18n.t('title_success'), window.i18n.t('wizard_msg_success'));
            }
            document.getElementById('recWizardModal').remove();
            
            if (generateInstances) {
                this.selectedYear = targetYear;
                const display = document.getElementById('recYearDisplay');
                if (display) display.textContent = this.selectedYear;
            }
            window.app.refreshSidebar();
            await this.loadData();
            
        } catch (e) {
            console.error(e);
            await showInlineMessage(window.i18n.t('error_title') || "Erreur", window.i18n.t('rec_generate_error') || "Une erreur s'est produite lors de la génération.");
            const btn = document.querySelector('#recWizardModal .btn-primary');
            if (btn) {
                btn.disabled = false;
                btn.textContent = window.i18n.t('wizard_btn_validate');
            }
        }
    },

    async openEditModal(templateId, forceIsClosedState = undefined) {
        if (!this.templates || this.templates.length === 0 || !this.allTransactions || this.allTransactions.length === 0) {
            try {
                this.templates = await API.get('/api/recurrences/?include_closed=true');
                this.categories = await API.get('/api/categories/');
                this.allTransactions = await API.get('/api/transactions/?limit=10000');
            } catch (e) {
                console.error("Failed to load dependency data for edit modal", e);
            }
        }
        const tpl = (this.templates || []).find(t => t.id === templateId);
        if (!tpl) {
            showToast("Récurrence introuvable", "error");
            return;
        }

        const initialIsClosed = (forceIsClosedState !== undefined) ? forceIsClosedState : (tpl.is_closed || false);

        // Auto-infer month_of_year from existing transactions if not set
        if (tpl.month_of_year == null && ['Yearly', 'Semi-Annually'].includes(tpl.frequency)) {
            const tplTxs = (this.allTransactions || []).filter(tx => tx.recurrence_id === templateId && tx.date_operation);
            if (tplTxs.length > 0) {
                // Use the month from the most recent transaction
                const sorted = tplTxs.sort((a, b) => b.date_operation.localeCompare(a.date_operation));
                const dateStr = sorted[0].date_operation;
                const inferredMonth = parseInt(dateStr.substring(5, 7)); // 1-12
                tpl.month_of_year = inferredMonth;
            }
        }

        // Fetch accounts
        let accounts = [];
        try {
            accounts = await API.get('/api/accounts/');
        } catch (e) {
            console.error("Failed to load accounts", e);
        }

        // Create modal element
        const modal = document.createElement('div');
        modal.id = 'editRecurrenceModal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '1000';

        const categoryOptions = (this.categories || [])
            .map(c => `<option value="${c.name}" ${tpl.category === c.name ? 'selected' : ''}>${c.name}</option>`)
            .join('');

        const freqOptions = [
            ['Weekly', 'rec_weekly', 'Hebdomadaire'],
            ['Monthly', 'rec_monthly', 'Mensuelle'],
            ['Quarterly', 'rec_quarterly', 'Trimestrielle'],
            ['Semi-Annually', 'rec_semi-annually', 'Semestrielle'],
            ['Yearly', 'rec_yearly', 'Annuelle'],
            ['Bi-Weekly', 'rec_biweekly', 'Toutes les 2 semaines'],
            ['Bi-Monthly', 'rec_bimonthly', 'Tous les 2 mois']
        ].map(([val, key, fallback]) => `<option value="${val}" ${tpl.frequency === val ? 'selected' : ''}>${window.i18n.t(key) || fallback}</option>`).join('');

        const fromAccOptions = `<option value="">-- Aucun --</option>` + accounts.map(a => `<option value="${a.id}" ${tpl.from_account_id === a.id ? 'selected' : ''}>${a.name}</option>`).join('');
        const toAccOptions = `<option value="">-- Aucun --</option>` + accounts.map(a => `<option value="${a.id}" ${tpl.to_account_id === a.id ? 'selected' : ''}>${a.name}</option>`).join('');

        const monthOptions = Array.from({length: 12}, (_, i) => i + 1)
            .map(m => `<option value="${m}" ${tpl.month_of_year == m ? 'selected' : ''}>${new Date(2000, m - 1, 1).toLocaleDateString('fr-FR', {month: 'long'})}</option>`)
            .join('');

        modal.innerHTML = `
            <div class="modal" style="width: 90%; max-width: 650px; background: var(--bg-surface); color: var(--text-main); border: 1px solid var(--border-color); border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,0.3); padding: 25px; display: flex; flex-direction: column; gap: 20px; animation: modalFadeIn 0.3s ease;">
                <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border-color); padding-bottom: 15px;">
                    <h3 style="margin: 0; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px;">✏️ ${window.i18n.t('edit_recurrence_title') || 'Modifier la récurrence'}</h3>
                    <button style="background: transparent; border: none; font-size: 20px; cursor: pointer; color: var(--text-muted);" onclick="document.getElementById('editRecurrenceModal').remove()">×</button>
                </div>
                
                <form id="editRecurrenceForm" style="display: flex; flex-direction: column; gap: 15px;" onsubmit="event.preventDefault(); window.RecurrenceView.saveEditModal(${tpl.id})">
                    <!-- Line 1: Description & Montant -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_description')}</label>
                            <input type="text" id="edit_desc" class="inline-input" value="${tpl.description || ''}" required style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit;">
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_amount')}</label>
                            <input type="number" id="edit_amount" class="inline-input" value="${tpl.amount || 0}" step="0.01" required style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit;">
                            <span style="font-size: 11px; color: var(--text-muted); font-style: italic;">${window.i18n.t('edit_amount_hint') || 'Le nouveau montant sera appliqué pour toutes les futures occurrences.'}</span>
                        </div>
                    </div>

                    <!-- Line 2: Type & Catégorie -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_type') || "Type d'opération"}</label>
                            <select id="edit_type" class="inline-input" onchange="window.RecurrenceView.onEditTypeChange()" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                <option value="expense_fixed" ${tpl.type === 'expense_fixed' ? 'selected' : ''}>${window.i18n.t('edit_type_option_expense_fixed') || 'Dépense fixe'}</option>
                                <option value="expense_var" ${tpl.type === 'expense_var' ? 'selected' : ''}>${window.i18n.t('edit_type_option_expense_var') || 'Dépense variable'}</option>
                                <option value="income" ${tpl.type === 'income' ? 'selected' : ''}>${window.i18n.t('edit_type_option_income') || 'Revenu'}</option>
                                <option value="transfer" ${tpl.type === 'transfer' ? 'selected' : ''}>${window.i18n.t('edit_type_option_transfer') || 'Virement'}</option>
                            </select>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_category')}</label>
                            <select id="edit_category" class="inline-input" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                <option value="">${window.i18n.t('edit_category_option_none') || '-- Sans catégorie --'}</option>
                                ${categoryOptions}
                            </select>
                        </div>
                    </div>

                    <!-- Line 3: Fréquence & Jour du mois -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('wizard_th_frequency') || 'Fréquence'}</label>
                            <select id="edit_freq" class="inline-input" onchange="window.RecurrenceView.onEditFreqChange()" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                ${freqOptions}
                            </select>
                            <span style="font-size: 11px; color: #ff5630; font-weight: 500;">${window.i18n.t('edit_freq_hint') || "Changer la fréquence régénérera toutes les occurrences futures non rapprochées de l'année."}</span>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('wizard_th_day') || 'Jour du mois'}</label>
                            <input type="number" id="edit_day" class="inline-input" value="${tpl.day_of_month || 1}" min="1" max="31" required style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit;">
                            <span style="font-size: 11px; color: #ff5630; font-weight: 500;">${window.i18n.t('edit_day_hint') || "Changer le jour régénérera également les dates des futures occurrences."}</span>
                        </div>
                    </div>

                    <!-- Line 4: Mois de l'année (only active if Yearly or Semi-Annually) & Max Occurrences -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div id="edit_month_container" style="display: flex; flex-direction: column; gap: 5px; opacity: ${['Yearly', 'Semi-Annually'].includes(tpl.frequency) ? '1' : '0.5'};">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_month_of_year') || "Mois de l'année"}</label>
                            <select id="edit_month" class="inline-input" ${['Yearly', 'Semi-Annually'].includes(tpl.frequency) ? '' : 'disabled'} style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                <option value="">${window.i18n.t('edit_month_option_none') || '-- Aucun --'}</option>
                                ${monthOptions}
                            </select>
                        </div>
                        <div style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('col_max_occurrences') || 'Occurrences Max (Optionnel)'}</label>
                            <input type="number" id="edit_max_occurrences" class="inline-input" value="${tpl.max_occurrences || ''}" min="1" placeholder="Illimité" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit;">
                        </div>
                    </div>

                    <!-- Line 5: Depuis & Vers -->
                    <div class="op-form-grid-2" style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div id="edit_from_acc_container" style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('label_from') || 'Depuis'}</label>
                            <select id="edit_from_acc" class="inline-input" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                ${fromAccOptions}
                            </select>
                        </div>
                        <div id="edit_to_acc_container" style="display: flex; flex-direction: column; gap: 5px;">
                            <label style="font-size: 13px; font-weight: 600; color: var(--text-muted);">${window.i18n.t('label_to') || 'Vers'}</label>
                            <select id="edit_to_acc" class="inline-input" style="padding: 8px 12px; border-radius: 6px; border: 1px solid var(--border-color); background: var(--bg-base); color: inherit; cursor: pointer;">
                                ${toAccOptions}
                            </select>
                        </div>
                    </div>

                    <!-- Line 6: Closed Switch -->
                    <label style="display: flex; align-items: center; justify-content: space-between; border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 5px; cursor: pointer; user-select: none;">
                        <div style="display: flex; flex-direction: column; gap: 3px; max-width: 80%;">
                            <span style="font-size: 14px; font-weight: 600; color: var(--text-main);">${window.i18n.t('edit_close_recurrence_label') || "Clôturer l'abonnement / récurrence"}</span>
                            <span style="font-size: 11px; color: var(--text-muted); line-height: 1.3;">${window.i18n.t('edit_close_recurrence_hint') || 'Activer cette option désactive définitivement la génération future de cette récurrence. Les transactions existantes seront conservées.'}</span>
                        </div>
                        <input type="checkbox" id="edit_is_closed" ${initialIsClosed ? 'checked' : ''} style="width: 22px; height: 22px; cursor: pointer;">
                    </label>

                    <!-- Real-time Preview Container -->
                    <div id="edit_preview_dates_container" style="display: flex; flex-direction: column; gap: 8px; margin-top: 5px; padding: 12px; background: rgba(99, 102, 241, 0.05); border-radius: 8px; border: 1px solid var(--border-color);">
                        <span id="edit_preview_dates_title" style="font-size: 13px; font-weight: 600; color: var(--text-muted);">Aperçu des 6 prochaines dates :</span>
                        <div id="edit_preview_dates_list" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; font-size: 13px; font-weight: 500; text-align: center;"></div>
                    </div>

                    <!-- Form Actions -->
                    <div style="display: flex; justify-content: flex-end; gap: 10px; border-top: 1px solid var(--border-color); padding-top: 15px; margin-top: 10px;">
                        <button type="button" class="btn btn-secondary" onclick="document.getElementById('editRecurrenceModal').remove()" style="padding: 8px 16px;">${window.i18n.t('btn_cancel') || 'Annuler'}</button>
                        <button type="submit" class="btn btn-primary" style="padding: 8px 16px; background: var(--primary-color, #6366f1); color: #ffffff;">${window.i18n.t('btn_save') || 'Enregistrer'}</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);
        window.RecurrenceView.onEditTypeChange(); // align accounts field on start

        // Bind preview listeners
        document.getElementById('edit_freq').addEventListener('change', () => {
            window.RecurrenceView.onEditFreqChange();
            window.RecurrenceView.updateEditPreviewDates();
        });
        document.getElementById('edit_day').addEventListener('input', () => window.RecurrenceView.updateEditPreviewDates());
        document.getElementById('edit_month').addEventListener('change', () => window.RecurrenceView.updateEditPreviewDates());
        document.getElementById('edit_amount').addEventListener('input', () => window.RecurrenceView.updateEditPreviewDates());
        document.getElementById('edit_is_closed').addEventListener('change', (e) => {
            const container = document.getElementById('edit_preview_dates_container');
            if (container) {
                container.style.display = e.target.checked ? 'none' : 'flex';
            }
        });

        const isClosed = document.getElementById('edit_is_closed').checked;
        document.getElementById('edit_preview_dates_container').style.display = isClosed ? 'none' : 'flex';

        window.RecurrenceView.updateEditPreviewDates(); // initial preview draw
    },

    onEditFreqChange() {
        const freq = document.getElementById('edit_freq').value;
        const monthContainer = document.getElementById('edit_month_container');
        const monthSelect = document.getElementById('edit_month');
        if (['Yearly', 'Semi-Annually'].includes(freq)) {
            monthContainer.style.opacity = '1';
            monthSelect.disabled = false;
        } else {
            monthContainer.style.opacity = '0.5';
            monthSelect.disabled = true;
            monthSelect.value = '';
        }
    },

    onEditTypeChange() {
        // Both account fields are always available — no disabling.
        // The user can freely assign Depuis/Vers regardless of type.
    },

    async saveEditModal(templateId) {
        const desc = document.getElementById('edit_desc').value.trim();
        const amount = parseFloat(document.getElementById('edit_amount').value) || 0;
        const type = document.getElementById('edit_type').value;
        const category = document.getElementById('edit_category').value || null;
        const frequency = document.getElementById('edit_freq').value;
        const day_of_month = parseInt(document.getElementById('edit_day').value) || 1;
        const month_val = document.getElementById('edit_month').value;
        const month_of_year = month_val ? parseInt(month_val) : null;
        const max_occ_val = document.getElementById('edit_max_occurrences').value;
        const max_occurrences = max_occ_val ? parseInt(max_occ_val) : null;
        const from_acc_val = document.getElementById('edit_from_acc').value;
        const from_account_id = from_acc_val ? parseInt(from_acc_val) : null;
        const to_acc_val = document.getElementById('edit_to_acc').value;
        const to_account_id = to_acc_val ? parseInt(to_acc_val) : null;
        const is_closed = document.getElementById('edit_is_closed').checked;

        const payload = {
            description: desc,
            amount: amount,
            type: type,
            category: category,
            frequency: frequency,
            day_of_month: day_of_month,
            month_of_year: month_of_year,
            max_occurrences: max_occurrences,
            from_account_id: from_account_id,
            to_account_id: to_account_id,
            is_closed: is_closed
        };

        const formBtn = document.querySelector('#editRecurrenceForm button[type="submit"]');
        const originalText = formBtn ? formBtn.textContent : '';

        try {
            if (formBtn) {
                formBtn.disabled = true;
                formBtn.textContent = '⏳ ...';
            }

            // 1. Put updates to DB
            const res = await API.put(`/api/recurrences/${templateId}`, payload);

            // 2. Trigger automatic recurrence generation to regenerate future instances
            await API.post('/api/recurrences/generate_to_end_of_year');

            // Remove modal
            document.getElementById('editRecurrenceModal').remove();

            // Refresh UI
            window.app.refreshSidebar();
            await this.loadData();
            showUndoToast(window.i18n.t('msg_saved') || 'Enregistré avec succès !', res.action_id, () => this.loadData());
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la mise à jour de la récurrence", "error");
            if (formBtn) {
                formBtn.disabled = false;
                formBtn.textContent = originalText;
            }
        }
    },

    updateEditPreviewDates() {
        const freq = document.getElementById('edit_freq').value;
        const day = parseInt(document.getElementById('edit_day').value) || 1;
        const monthVal = document.getElementById('edit_month').value;
        const month = monthVal ? parseInt(monthVal) - 1 : null;
        
        const list = document.getElementById('edit_preview_dates_list');
        if (!list) return;

        // Show active amount in the preview header
        const amountEl = document.getElementById('edit_amount');
        const amountVal = amountEl ? parseFloat(amountEl.value) || 0 : 0;
        const titleEl = document.getElementById('edit_preview_dates_title');
        if (titleEl) {
            const formattedAmt = `<span style="color: var(--accent, #6366f1); font-weight: 700;">${amountVal.toFixed(2).replace('.', ',')} €</span>`;
            titleEl.innerHTML = (window.i18n.t('edit_preview_title') || 'Aperçu des 6 prochaines échéances (Montant : {amount}) :')
                .replace('{amount}', formattedAmt);
        }
        
        const dates = [];
        let base = new Date();
        
        if (freq === 'Monthly') {
            let y = base.getFullYear();
            let m = base.getMonth();
            if (base.getDate() > day) {
                m++;
            }
            for (let i = 0; i < 6; i++) {
                let d = new Date(y, m + i, day);
                dates.push(d);
            }
        } else if (freq === 'Yearly') {
            let y = base.getFullYear();
            let targetM = month !== null ? month : 0;
            if (base.getMonth() > targetM || (base.getMonth() === targetM && base.getDate() > day)) {
                y++;
            }
            for (let i = 0; i < 6; i++) {
                let d = new Date(y + i, targetM, day);
                dates.push(d);
            }
        } else if (freq === 'Weekly') {
            for (let i = 0; i < 6; i++) {
                let temp = new Date();
                temp.setDate(base.getDate() + (i + 1) * 7);
                dates.push(temp);
            }
        } else if (freq === 'Quarterly') {
            let y = base.getFullYear();
            let m = base.getMonth();
            if (base.getDate() > day) {
                m++;
            }
            for (let i = 0; i < 6; i++) {
                let d = new Date(y, m + i * 3, day);
                dates.push(d);
            }
        } else if (freq === 'Semi-Annually') {
            let y = base.getFullYear();
            let startMonth = month !== null ? month : base.getMonth();
            // Determine starting point based on startMonth and startMonth + 6
            let m1 = startMonth;
            let m2 = (startMonth + 6) % 12;
            
            // Put in order relative to current year
            let d1 = new Date(y, m1, day);
            let d2 = new Date(y, m2, day);
            if (m2 < m1) {
                // if second month wrapped around, it belongs to the next year visually if sorting,
                // but let's just find the first occurrence >= base date
            }
            
            let possibleDates = [];
            for (let i = -1; i < 4; i++) {
                possibleDates.push(new Date(y + i, m1, day));
                possibleDates.push(new Date(y + i, m2, day));
            }
            // Filter future dates (including today if base.getDate() <= day)
            let future = possibleDates.filter(d => {
                const compDate = new Date(base.getFullYear(), base.getMonth(), base.getDate());
                return d >= compDate;
            });
            // Sort
            future.sort((a, b) => a - b);
            for (let i = 0; i < 6; i++) {
                dates.push(future[i] || new Date());
            }
        } else if (freq === 'Bi-Weekly') {
            for (let i = 0; i < 6; i++) {
                let temp = new Date();
                temp.setDate(base.getDate() + (i + 1) * 14);
                dates.push(temp);
            }
        } else if (freq === 'Bi-Monthly') {
            let y = base.getFullYear();
            let m = base.getMonth();
            if (base.getDate() > day) {
                m++;
            }
            for (let i = 0; i < 6; i++) {
                let d = new Date(y, m + i * 2, day);
                dates.push(d);
            }
        }
        
        list.innerHTML = dates.map(d => {
            const formatted = d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
            return `<div style="padding: 6px; background: rgba(99, 102, 241, 0.08); color: var(--accent, #6366f1); border-radius: 6px; border: 1px solid rgba(99, 102, 241, 0.15); font-weight: 600;">${formatted}</div>`;
        }).join('');
    },

    scrollToAndHighlightTemplate(templateId) {
        if (!templateId) return;
        
        setTimeout(() => {
            const row = document.getElementById(`rec-row-${templateId}`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                
                const originalBg = row.style.backgroundColor;
                const originalTransition = row.style.transition;
                
                row.style.transition = 'background-color 0.3s ease, box-shadow 0.3s ease';
                row.style.backgroundColor = 'rgba(99, 102, 241, 0.2)';
                row.style.boxShadow = '0 0 15px rgba(99, 102, 241, 0.4)';
                
                setTimeout(() => {
                    row.style.backgroundColor = originalBg;
                    row.style.boxShadow = 'none';
                    setTimeout(() => {
                        row.style.transition = originalTransition;
                    }, 300);
                }, 2000);
            }
        }, 300);
    }
};
