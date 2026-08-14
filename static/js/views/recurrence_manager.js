window.RecurrenceView = Object.assign(window.RecurrenceView || {}, {
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
});
