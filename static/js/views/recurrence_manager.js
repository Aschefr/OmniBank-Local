window.RecurrenceView = {
    templates: [],
    transactions: [],
    selectedYear: new Date().getFullYear(),
    modifiedRows: new Set(),
    expandedTemplateIds: new Set(),
    
    render() {
        return `
            <div class="view-header" style="margin-bottom:20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                <h2>🔄 <span data-i18n="nav_recurrences">Récurrences</span></h2>
                <div style="display: flex; align-items: center; gap: 10px; flex: 1; justify-content: flex-end;">
                    <input type="text" id="recurrenceSearch" class="inline-input" data-i18n-placeholder="ph_search_recurrence" placeholder="${window.i18n.t('ph_search_recurrence')}" style="min-width: 180px; max-width: 300px; flex: 1;" oninput="window.RecurrenceView.applyFilter()">
                    <button class="btn btn-primary" style="padding: 10px 20px; font-weight: bold; background: linear-gradient(135deg, #6c5ce7, #a29bfe); color: white; border: none; box-shadow: 0 4px 6px rgba(108, 92, 231, 0.2);" onclick="window.RecurrenceView.showWizard()" data-i18n="rec_wizard_btn">${window.i18n.t('rec_wizard_btn')}</button>
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
                
                <div id="recurrencesTableContainer" style="margin-top: 20px; overflow-x: auto;">
                    <!-- Table rendered dynamically -->
                </div>
            </div>
        `;
    },

    async init() {
        this.selectedYear = new Date().getFullYear();
        this.modifiedRows.clear();
        this.expandedTemplateIds.clear();
        this.sortBy = localStorage.getItem('recurrences_sortBy') || 'description';
        this.sortOrder = localStorage.getItem('recurrences_sortOrder') || 'asc';
        await this.loadData();
    },

    async loadData() {
        try {
            this.templates = await API.get('/api/recurrences/?include_closed=true');
            this.categories = await API.get('/api/categories/');
            // Fetch all operations and filter locally
            const allTx = await API.get('/api/transactions/?limit=10000');
            this.allTransactions = allTx;
            
            // Find active templates for this year
            const activeTemplateIds = new Set(
                allTx.filter(tx => tx.date_operation && parseInt(tx.date_operation.substring(0, 4)) === this.selectedYear && tx.recurrence_id != null)
                     .map(tx => tx.recurrence_id)
            );
            
            // Filter templates: only show those that have transactions in the selected year
            const displayTemplates = this.templates.filter(t => 
                activeTemplateIds.has(t.id)
            );

            // Compute global statistics
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

                // Find the last reconciled transaction for this template up to the selected year
                const reconciledTx = (this.allTransactions || [])
                    .filter(tx => tx.recurrence_id == t.id && 
                                  tx.reconciliation_date != null &&
                                  tx.date_operation &&
                                  parseInt(tx.date_operation.substring(0, 4)) <= this.selectedYear)
                    .sort((a, b) => b.date_operation.localeCompare(a.date_operation));
                t.displayAmount = reconciledTx.length > 0 ? reconciledTx[0].amount : t.amount;

                // Calculate progress
                const reconciledCount = templateTx.filter(tx => tx.reconciliation_date != null || tx.is_skipped === true).length;
                const totalCount = templateTx.length;
                t.progressPct = totalCount > 0 ? Math.round((reconciledCount / totalCount) * 100) : 0;
                t.reconciledCount = reconciledCount;
                t.totalCount = totalCount;
            });

            const monthlyAverage = grandTotalAnnual / 12;
            const activeCount = displayTemplates.length;
            const reconciliationRate = totalInstancesCount > 0 ? Math.round((totalReconciledCount / totalInstancesCount) * 100) : 0;

            // Render stats grid
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
            
            const tableContainer = document.getElementById('recurrencesTableContainer');
            if (tableContainer) {
                if (displayTemplates.length === 0) {
                    const emptyMsg = (window.i18n.t('msg_no_recurrences_configured_year') || 'No recurring operations planned for {year}').replace('{year}', this.selectedYear);
                    tableContainer.innerHTML = `<div style="text-align: center; padding: 40px; color: var(--text-muted); font-size: 16px;">${emptyMsg}</div>`;
                    return;
                }
                               // Sort templates based on sortBy and sortOrder
                const sortBy = this.sortBy || 'description';
                const sortOrder = this.sortOrder || 'asc';
                
                displayTemplates.sort((a, b) => {
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

                let tableHtml = `
                     <table class="data-table" style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                        <thead>
                            <tr style="text-align: left; background: rgba(0, 0, 0, 0.02); border-bottom: 2px solid var(--border-color); user-select: none;">
                                <th style="padding: 12px; width: 45px; text-align: center;"></th>
                                <th style="padding: 12px; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('description')">${window.i18n.t('col_description')} ${this.getSortArrow('description')}</th>
                                <th style="padding: 12px; width: 170px; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('category')">${window.i18n.t('col_category')} ${this.getSortArrow('category')}</th>
                                <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('frequency')">${window.i18n.t('wizard_th_frequency') || 'Frequency'} ${this.getSortArrow('frequency')}</th>
                                <th style="padding: 12px; width: 100px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('status')">${window.i18n.t('col_status')} ${this.getSortArrow('status')}</th>
                                <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('day')">${window.i18n.t('wizard_th_day') || 'Day of month'} ${this.getSortArrow('day')}</th>
                                <th style="padding: 12px; width: 130px; text-align: center; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('progress')">${window.i18n.t('col_progress') || 'Progression'} ${this.getSortArrow('progress')}</th>
                                <th style="padding: 12px; width: 120px; text-align: right; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('amount')">${window.i18n.t('col_amount')} ${this.getSortArrow('amount')}</th>
                                <th style="padding: 12px; width: 140px; text-align: right; white-space: nowrap; cursor: pointer;" onclick="window.RecurrenceView.setSort('annual_total')">${window.i18n.t('col_total_annual') || 'Annual Total'} ${this.getSortArrow('annual_total')}</th>
                                <th style="padding: 12px; width: 85px; text-align: center; white-space: nowrap;">${window.i18n.t('th_actions') || 'Actions'}</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
                
                displayTemplates.forEach(t => {
                    const isExpanded = this.expandedTemplateIds.has(t.id);
                    const chevronStyle = `display: inline-block; transition: transform 0.2s ease; transform: ${isExpanded ? 'rotate(90deg)' : 'rotate(0deg)'}; font-size: 11px; color: var(--text-muted); cursor: pointer;`;
                    const displayStyle = isExpanded ? 'table-row' : 'none';
                    
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
                        <tr onclick="window.RecurrenceView.toggleRow(${t.id})" style="cursor: pointer; border-bottom: 1px solid var(--border-color); transition: background-color 0.2s;" onmouseover="this.style.backgroundColor='rgba(99,102,241,0.03)'" onmouseout="this.style.backgroundColor=''">
                            <td style="padding: 12px; text-align: center;">
                                <span id="chevron_${t.id}" style="${chevronStyle}">❯</span>
                            </td>
                            <td style="padding: 12px; font-weight: 600; color: var(--text-main); font-size: 14px;">${t.description}</td>
                            <td style="padding: 6px 12px;" onclick="event.stopPropagation()">
                                <select class="inline-input" style="padding: 4px 8px; border-radius: 6px; font-size: 13px; width: 100%; border: 1px solid var(--border-color); background: var(--bg-surface); cursor: pointer;" onchange="window.RecurrenceView.changeTemplateCategory(this, ${t.id})">
                                    <option value="">-- Sans catégorie --</option>
                                    ${catOptionsHtml}
                                    <option value="__new__" style="color: var(--primary-color); font-weight: bold;">+ Nouvelle catégorie...</option>
                                </select>
                            </td>
                            <td style="padding: 12px; text-align: center;">${badgeHtml}</td>
                            <td style="padding: 12px; text-align: center;">${statusBadgeHtml}</td>
                            <td style="padding: 12px; text-align: center; font-size: 13px; color: var(--text-muted); font-weight: 500;">${t.day_of_month || 1}</td>
                            <td style="padding: 12px; text-align: center;" onclick="event.stopPropagation()">
                                <div style="display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; min-width: 90px;">
                                    <div style="width: 100%; height: 6px; background: rgba(255, 255, 255, 0.08); border-radius: 3px; overflow: hidden; border: 1px solid var(--border-color);">
                                        <div style="width: ${t.progressPct}%; height: 100%; background: ${t.progressPct === 100 ? 'linear-gradient(90deg, #2ecc71, #27ae60)' : 'linear-gradient(90deg, var(--accent, #6c5ce7), #a29bfe)'}; border-radius: 3px; transition: width 0.3s ease;"></div>
                                    </div>
                                    <span style="font-size: 11px; font-weight: 600; color: var(--text-muted);">${t.progressPct}% <span style="font-size: 10px; font-weight: 500; opacity: 0.7;">(${t.reconciledCount}/${t.totalCount})</span></span>
                                </div>
                            </td>
                            <td style="padding: 12px; text-align: right; font-weight: 600; color: var(--text-main); font-size: 13px;">${formatCurrency(t.displayAmount)}</td>
                            <td style="padding: 12px; text-align: right; font-weight: 700; color: var(--text-main); font-size: 14px;"><span class="privacy-blur">${formatCurrency(t.totalAnnualAmount)}</span></td>
                            <td style="padding: 12px; text-align: center;" onclick="event.stopPropagation()">
                                <div style="display: flex; justify-content: center; gap: 6px;">
                                    <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='var(--primary-color, #6366f1)'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.openEditModal(${t.id})" title="${window.i18n.t('tooltip_edit') || 'Modifier'}">✏️</button>
                                    <button class="btn btn-secondary btn-delete" style="padding: 6px 10px; font-size: 12px; border: 1px solid var(--border-color); background: var(--bg-surface); transition: all 0.2s;" onmouseover="this.style.background='var(--danger, #ff5630)'; this.style.color='#ffffff';" onmouseout="this.style.background='var(--bg-surface)'; this.style.color='inherit';" onclick="window.RecurrenceView.deleteTemplate(${t.id})" title="${window.i18n.t('tooltip_delete') || 'Delete'}">🗑️</button>
                                </div>
                            </td>
                        </tr>
                        <tr id="details_row_${t.id}" style="display: ${displayStyle}; background: var(--bg-sidebar);">
                            <td colspan="10" style="padding: 15px 20px; border-bottom: 1px solid var(--border-color);">
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
                `;
                tableContainer.innerHTML = tableHtml;
                
                // Re-render contents of all expanded templates
                this.expandedTemplateIds.forEach(id => {
                    this.renderTemplateDetails(id);
                });

                // Apply filter
                this.applyFilter();
            }
        } catch (e) {
            console.error("Failed to load transactions", e);
        }
    },
    
    async refreshTransactions() {
        await this.loadData();
    },

    applyFilter() {
        const input = document.getElementById('recurrenceSearch');
        const q = input ? input.value.toLowerCase().trim() : '';
        const container = document.getElementById('recurrencesTableContainer');
        if (!container) return;
        const rows = container.querySelectorAll('tbody > tr');
        for (let i = 0; i < rows.length; i += 2) {
            const mainRow = rows[i];
            const detailRow = rows[i + 1];
            if (!mainRow) continue;
            
            const selectEl = mainRow.querySelector('select');
            const descText = mainRow.cells[1] ? mainRow.cells[1].textContent.toLowerCase() : '';
            const catText = selectEl ? selectEl.value.toLowerCase() : '';
            const freqText = mainRow.cells[3] ? mainRow.cells[3].textContent.toLowerCase() : '';
            const dayText = mainRow.cells[4] ? mainRow.cells[4].textContent.toLowerCase() : '';
            const amountText = mainRow.cells[5] ? mainRow.cells[5].textContent.toLowerCase() : '';
            
            const match = !q || 
                          descText.includes(q) || 
                          catText.includes(q) || 
                          freqText.includes(q) || 
                          dayText.includes(q) || 
                          amountText.includes(q);
                          
            mainRow.style.display = match ? '' : 'none';
            if (detailRow && detailRow.id && detailRow.id.startsWith('details_row_')) {
                if (!match) {
                    detailRow.style.display = 'none';
                } else {
                    // Restore expanded state if matching
                    const templateId = parseInt(detailRow.id.replace('details_row_', ''));
                    detailRow.style.display = this.expandedTemplateIds.has(templateId) ? 'table-row' : 'none';
                }
            }
        }
    },

    changeYear(delta) {
        this.selectedYear += delta;
        this.lastPropagate = null; // Reset undo state on year change
        const display = document.getElementById('recYearDisplay');
        if (display) display.textContent = this.selectedYear;
        this.refreshTransactions();
    },

    setSort(columnName) {
        if (this.sortBy === columnName) {
            this.sortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc';
        } else {
            this.sortBy = columnName;
            this.sortOrder = 'asc';
        }
        localStorage.setItem('recurrences_sortBy', this.sortBy);
        localStorage.setItem('recurrences_sortOrder', this.sortOrder);
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
            detailsRow.style.display = 'none';
            if (chevron) chevron.style.transform = 'rotate(0deg)';
        } else {
            this.expandedTemplateIds.add(templateId);
            detailsRow.style.display = 'table-row';
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

        let instancesHtml = `
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                <h4 style="margin: 0; color: var(--text-muted); font-size: 14px; font-weight: bold;">${window.i18n.t('rec_year_details_title') || 'Détails des opérations de l\'année'}</h4>
                <button id="save_btn_${templateId}" class="btn btn-primary" style="display: ${buttonDisplay}; padding: 6px 15px; font-size: 13px; font-weight: bold;" onclick="window.RecurrenceView.saveTemplateChanges(${templateId})">${window.i18n.t('btn_save_changes') || 'Sauvegarder les modifications'}</button>
            </div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 60px 140px; gap: 10px; margin-bottom: 10px; padding: 0 10px; font-weight: bold; color: var(--text-muted); text-align: center; font-size: 13px;">
                <div data-i18n="rec_col_date">${window.i18n.t('rec_col_date')}</div>
                <div data-i18n="rec_col_amount">${window.i18n.t('rec_col_amount')}</div>
                <div data-i18n="rec_col_status">Statut</div>
                <div></div>
            </div>
            <div style="display: flex; flex-direction: column; gap: 8px;">
        `;
        
        instancesHtml += templateTx.map(tx => {
            const isModified = this.modifiedRows.has(tx.id);
            const isReconciled = tx.reconciliation_date != null;
            const isSkipped = tx.is_skipped === true;
            
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

            let skipColHTML = '';
            if (isSkipped) {
                skipColHTML = `<button class="btn btn-secondary" style="padding: 4px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center;" onclick="window.RecurrenceView.toggleSkipInDetails(${tx.id}, ${templateId})" title="${window.i18n.t('tooltip_unskip') || 'Rétablir'}">↩️</button>`;
            } else if (!isReconciled) {
                skipColHTML = `<button class="btn btn-secondary" style="padding: 4px; font-size: 11px; display: inline-flex; align-items: center; justify-content: center;" onclick="window.RecurrenceView.toggleSkipInDetails(${tx.id}, ${templateId})" title="${window.i18n.t('tooltip_skip') || 'Ignorer'}">⏭️</button>`;
            } else {
                skipColHTML = '✅';
            }
 
            return `
            <div class="rec-instance-row" style="display: grid; grid-template-columns: 1fr 1fr 60px 140px; gap: 10px; align-items: center; background: ${bg}; padding: 8px; border-radius: 8px; border: 1px solid var(--border-color); ${opClass}">
                <input type="date" id="rec_date_${tx.id}" class="inline-input" value="${dateStr}" style="text-align: center; font-size: 13px;" onchange="window.RecurrenceView.markTemplateRowModified(${tx.id}, ${templateId})" ${readonly}>
                <input type="number" id="rec_amount_${tx.id}" class="inline-input" value="${tx.amount}" step="0.01" style="text-align: center; font-size: 13px;" onchange="window.RecurrenceView.markTemplateRowModified(${tx.id}, ${templateId})" ${readonly}>
                <div style="text-align: center;">${skipColHTML}</div>
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
                    let msg = e.message;
                    try {
                        const parsed = JSON.parse(e.message);
                        msg = parsed.detail || e.message;
                        if (msg.includes("already exists") && msg.includes("currently in use")) {
                            isConflict = true;
                        }
                    } catch(err) {}

                    if (isConflict) {
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
            await API.del(`/api/recurrences/${templateId}`);
            showToast(window.i18n.t('msg_template_deleted') || 'Recurrence deleted');
            if (this.expandedTemplateIds.has(templateId)) {
                this.expandedTemplateIds.delete(templateId);
            }
            await window.app.refreshSidebar();
            await this.loadData();
        } catch (e) {
            console.error(e);
            showToast(window.i18n.t('rec_delete_error') || "Impossible de supprimer la récurrence", "error");
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

    async openEditModal(templateId) {
        const tpl = this.templates.find(t => t.id === templateId);
        if (!tpl) return;

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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
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
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
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
                        <input type="checkbox" id="edit_is_closed" ${tpl.is_closed ? 'checked' : ''} style="width: 22px; height: 22px; cursor: pointer;">
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
            await API.put(`/api/recurrences/${templateId}`, payload);

            // 2. Trigger automatic recurrence generation to regenerate future instances
            await API.post('/api/recurrences/generate_to_end_of_year');

            // Remove modal
            document.getElementById('editRecurrenceModal').remove();

            // Refresh UI
            window.app.refreshSidebar();
            await this.loadData();
            showToast(window.i18n.t('msg_saved') || 'Enregistré avec succès !', 'success');
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
    }
};
