window.TimelineView = {
    transactions: [],
    _vt: null,
    
    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const attachDisp = cfg.enable_attachments === 'true' ? '' : 'display: none !important;';
        const slipDisp = cfg.enable_check_slips === 'true' ? '' : 'display: none !important;';
        const isOrgMode = cfg.enable_org_mode === 'true' || cfg.enable_org_mode === true;
        const unreconciledDisp = isOrgMode ? 'display: none !important;' : '';

        return `
            <style id="timelineColsStyle"></style>
            <div id="timelineColsModal" class="modal-overlay" style="display: none; z-index: 100;">
                <div class="modal" style="max-width: 380px; min-width: auto; padding: 25px;">
                    <h3 style="margin-top:0; margin-bottom: 20px; display:flex; align-items:center; gap:8px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">${window.i18n.t('btn_columns')} </h3>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom: 25px;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_dateSaisie" onchange="window.TimelineView.toggleCol('dateSaisie')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_date_entry')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_date" onchange="window.TimelineView.toggleCol('date')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_date_op')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_desc" onchange="window.TimelineView.toggleCol('desc')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_description')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_type" onchange="window.TimelineView.toggleCol('type')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_type')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_cat" onchange="window.TimelineView.toggleCol('cat')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_category')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_amount" onchange="window.TimelineView.toggleCol('amount')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_amount')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_recon" onchange="window.TimelineView.toggleCol('recon')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_reconciled')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_budget" onchange="window.TimelineView.toggleCol('budget')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_envelope')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_depuis" onchange="window.TimelineView.toggleCol('depuis')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_from')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_vers" onchange="window.TimelineView.toggleCol('vers')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_to')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_col_recurrence" onchange="window.TimelineView.toggleCol('recurrence')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_recurrence')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; ${slipDisp}"><input type="checkbox" id="chk_col_slip" onchange="window.TimelineView.toggleCol('slip')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_slip')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; ${attachDisp}"><input type="checkbox" id="chk_col_attachments" onchange="window.TimelineView.toggleCol('attachments')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_attachments')}</label>
                    </div>
                    <div style="text-align: center;">
                        <button class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 14px;" onclick="document.getElementById('timelineColsModal').style.display='none'" data-i18n="btn_close">${window.i18n.t('btn_close')}</button>
                    </div>
                </div>
            </div>
            <div id="timelineHeader" class="view-header responsive-header" style="position: sticky; top: -32px; z-index: 10; background-color: var(--bg-base); padding: 32px 0 15px 0; margin-top: -32px;">
                <h2 style="margin:0;">🏠 <span data-i18n="nav_timeline">Dashboard</span></h2>
                <div class="responsive-header-controls">
                    <div class="history-filters" style="display:flex; gap:8px; width:100%; max-width:950px; justify-content:flex-end; flex-wrap:wrap; align-items: center;">
                    <select id="timelineReconciledPeriod" class="inline-input" style="min-width:160px; flex:1; max-width: 220px;" onchange="window.TimelineView.savePeriod(); window.TimelineView.applyFilters()">
                        <option value="current" data-i18n="filter_period_current">${window.i18n.t('filter_period_current')}</option>
                        <option value="plus_5" data-i18n="filter_period_plus_5">${window.i18n.t('filter_period_plus_5')}</option>
                        <option value="plus_15" data-i18n="filter_period_plus_15">${window.i18n.t('filter_period_plus_15')}</option>
                        <option value="plus_30" data-i18n="filter_period_plus_30">${window.i18n.t('filter_period_plus_30')}</option>
                        <option value="all" data-i18n="filter_period_all">${window.i18n.t('filter_period_all')}</option>
                    </select>
                    <div id="timelineDateRange" style="display:none; align-items:center; gap: 6px; flex:1; min-width: 260px; max-width: 320px;">
                        <input type="date" id="timelineStartDate" class="inline-input" onchange="window.TimelineView.savePeriod(); window.TimelineView.applyFilters()" style="flex:1; min-width: 110px;">
                        <span style="color:var(--text-muted); font-size:12px; font-weight: 500;">${window.i18n.t('filter_range_to')}</span>
                        <input type="date" id="timelineEndDate" class="inline-input" onchange="window.TimelineView.savePeriod(); window.TimelineView.applyFilters()" style="flex:1; min-width: 110px;">
                    </div>
                    <input type="text" id="timelineSearch" class="inline-input" data-i18n-placeholder="ph_search" placeholder="Rechercher..." style="min-width:140px; flex:1; max-width: 200px;" oninput="window.TimelineView.applyFilters()">
                    <select id="timelineTypeFilter" class="inline-input" style="min-width:140px; flex:1; max-width: 180px;" onchange="window.TimelineView.applyFilters()">
                        <option value="" data-i18n="filter_all_types">${window.i18n.t('filter_all_types')}</option>
                        <option value="expense_fixed" data-i18n="type_expense_fixed">${window.i18n.t('type_expense_fixed')}</option>
                        <option value="expense_var" data-i18n="type_expense_var">${window.i18n.t('type_expense_var')}</option>
                        <option value="income" data-i18n="type_income">${window.i18n.t('type_income')}</option>
                        <option value="transfer" data-i18n="type_transfer">${window.i18n.t('type_transfer')}</option>
                    </select>
                    <select id="timelineCategoryFilter" class="inline-input" style="min-width:140px; flex:1; max-width: 180px;" onchange="window.TimelineView.applyFilters()">
                        <option value="" data-i18n="filter_all_categories">${window.i18n.t('filter_all_categories')}</option>
                    </select>
                    <div style="display:flex; align-items:center; gap:8px; ${unreconciledDisp}">
                        <span style="font-size:12px; font-weight:600; color:var(--text-muted); white-space:nowrap;" data-i18n="filter_unreconciled_before_pay">${window.i18n.t('filter_unreconciled_before_pay')}</span>
                        <label class="toggle-switch" style="flex-shrink: 0;" data-i18n-title="tooltip_filter_unreconciled" title="Filtre les dépenses non-rapprochées prévues avant la prochaine paie">
                            <input type="checkbox" id="timelineUnreconciledFilter" onchange="window.TimelineView.applyFilters()">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; ${attachDisp}">
                        <span style="font-size:12px; font-weight:600; color:var(--text-muted); white-space:nowrap;" data-i18n="filter_attachments">Pièces jointes</span>
                        <label class="toggle-switch" style="flex-shrink: 0;" data-i18n-title="tooltip_filter_attachments" title="Uniquement avec pièces jointes">
                            <input type="checkbox" id="timelineAttachmentFilter" onchange="window.TimelineView.applyFilters()">
                            <span class="slider"></span>
                        </label>
                    </div>
                    </div>
                <div class="header-buttons" style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="document.getElementById('timelineColsModal').style.display='flex'" data-i18n="btn_columns">${window.i18n.t('btn_columns')}</button>
                    <button class="btn btn-secondary" onclick="window.ImportWizard.open()" data-i18n="btn_import_statement">📥 Importer un relevé</button>
                    <button class="btn btn-primary" onclick="window.TimelineView.showAddRow()">${window.i18n.t('btn_add_operation')}</button>
                </div>
                </div>
            </div>
            <div style="padding-bottom: 20px;">
                <table class="data-table timeline-table mobile-card-table">
                    <thead>
                        <tr>
                            <th class="col-marker"></th>
                            <th class="col-dateSaisie" data-i18n="col_date_entry">${window.i18n.t('col_date_entry')}</th>
                            <th class="col-date" data-i18n="col_date_op">${window.i18n.t('col_date_op')}</th>
                            <th class="col-desc" data-i18n="col_description">${window.i18n.t('col_description')}</th>
                            <th class="col-type" data-i18n="col_type">${window.i18n.t('col_type')}</th>
                            <th class="col-cat" data-i18n="col_category">${window.i18n.t('col_category')}</th>
                            <th class="col-amount" data-i18n="col_amount">${window.i18n.t('col_amount')}</th>
                            <th class="col-recon" data-i18n="col_reconciled">${window.i18n.t('col_reconciled')}</th>
                            <th class="col-budget" data-i18n="col_envelope">${window.i18n.t('col_envelope')}</th>
                            <th class="col-depuis" data-i18n="col_from">${window.i18n.t('col_from')}</th>
                            <th class="col-vers" data-i18n="col_to">${window.i18n.t('col_to')}</th>
                            <th class="col-recurrence" data-i18n="col_recurrence">${window.i18n.t('col_recurrence')}</th>
                            <th class="col-slip" data-i18n="col_slip">${window.i18n.t('col_slip')}</th>
                            <th class="col-attachments" data-i18n="col_attachments">${window.i18n.t('col_attachments')}</th>
                            <th class="col-actions"></th>
                        </tr>
                    </thead>
                    <tbody id="timelineBody">
                        <!-- Rendered dynamically -->
                    </tbody>
                </table>
            </div>
        `;
    },

    transactions: [],
    budgetsMap: {}, // id -> name, for budget column display

    _ensureVT() {
        if (!this._vt) {
            this._vt = new VirtualTable({
                tbodyId: 'timelineBody',
                scrollContainerSelector: '.app-main',
                rowHeight: 38,
                bufferRows: 20,
                emptyHTML: `<tr><td></td><td colspan="13" style="text-align:center; padding: 20px; color: var(--text-muted)">${window.i18n.t('msg_no_operations_month')}</td></tr>`
            });
        }
        return this._vt;
    },

    async init() {
        this.applyColSettings();
        
        const cfg = window.app && window.app.config ? window.app.config : {};
        const isOrgMode = cfg.enable_org_mode === 'true' || cfg.enable_org_mode === true;
        
        const periodSelect = document.getElementById('timelineReconciledPeriod');
        const dateRange = document.getElementById('timelineDateRange');
        
        if (isOrgMode) {
            if (periodSelect) periodSelect.style.display = 'none';
            if (dateRange) dateRange.style.display = 'flex';
            
            const savedStart = localStorage.getItem('timeline_start_date');
            const savedEnd = localStorage.getItem('timeline_end_date');
            const startInput = document.getElementById('timelineStartDate');
            const endInput = document.getElementById('timelineEndDate');
            
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const pad = (n) => n < 10 ? '0'+n : n;
            const fmtStart = `${startOfMonth.getFullYear()}-${pad(startOfMonth.getMonth()+1)}-${pad(startOfMonth.getDate())}`;
            
            if (startInput) startInput.value = savedStart || fmtStart;
            if (endInput) endInput.value = savedEnd || '';
        } else {
            if (periodSelect) periodSelect.style.display = '';
            if (dateRange) dateRange.style.display = 'none';
            
            const savedPeriod = localStorage.getItem('timeline_period_filter');
            if (periodSelect) {
                periodSelect.value = savedPeriod || 'current';
            }
        }

        await this.loadData();
    },

    savePeriod() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const isOrgMode = cfg.enable_org_mode === 'true' || cfg.enable_org_mode === true;
        
        if (isOrgMode) {
            const startInput = document.getElementById('timelineStartDate');
            const endInput = document.getElementById('timelineEndDate');
            if (startInput) localStorage.setItem('timeline_start_date', startInput.value);
            if (endInput) localStorage.setItem('timeline_end_date', endInput.value);
        } else {
            const select = document.getElementById('timelineReconciledPeriod');
            if (select) localStorage.setItem('timeline_period_filter', select.value);
        }
    },

    getColSettings() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const showAttachments = cfg.enable_attachments === 'true';
        const showSlips = cfg.enable_check_slips === 'true';
        const def = { dateSaisie: false, date: true, desc: true, type: false, cat: true, amount: true, recon: true, budget: false, depuis: false, vers: false, recurrence: false, slip: showSlips, attachments: showAttachments };
        try {
            const saved = localStorage.getItem('timeline_cols');
            const parsed = saved ? { ...def, ...JSON.parse(saved) } : def;
            if (!showSlips) parsed.slip = false;
            if (!showAttachments) parsed.attachments = false;
            return parsed;
        } catch { return def; }
    },

    toggleCol(col) {
        const settings = this.getColSettings();
        const chk = document.getElementById('chk_col_' + col);
        if (chk) {
            settings[col] = chk.checked;
            localStorage.setItem('timeline_cols', JSON.stringify(settings));
            this.applyColSettings();
        }
    },

    applyColSettings() {
        const cols = this.getColSettings();
        
        // Update checkboxes
        Object.keys(cols).forEach(k => {
            const el = document.getElementById('chk_col_' + k);
            if (el) el.checked = cols[k];
        });
        
        // Column weight map (higher = more space)
        const colWeights = {
            dateSaisie: 1.5, date: 1.5, desc: 4, type: 1.8,
            cat: 2.5, amount: 1.5, recon: 1.8, budget: 1.5,
            depuis: 1.5, vers: 1.5, recurrence: 1.2, slip: 1.2, attachments: 1
        };
        
        // Calculate total weight of visible columns
        let totalWeight = 0;
        Object.keys(cols).forEach(k => { if (cols[k]) totalWeight += (colWeights[k] || 1); });
        
        // Build CSS: hide invisible cols + set dynamic widths on visible ones
        let css = '';
        Object.keys(cols).forEach(k => {
            if (!cols[k]) {
                css += `.timeline-table .col-${k} { display: none !important; }\n`;
            } else {
                const pct = ((colWeights[k] || 1) / totalWeight * 92).toFixed(1);
                css += `.timeline-table .col-${k} { width: ${pct}%; }\n`;
            }
        });
        // Actions column — enough room for Edit + Delete buttons
        css += `.timeline-table .col-actions { width: 8%; }\n`;
        
        const styleTag = document.getElementById('timelineColsStyle');
        if (styleTag) styleTag.innerHTML = css;
    },

    async loadData() {
        try {
            // Get all operations and filter in JS
            const allTransactions = await API.get('/api/transactions/?limit=10000');
            
            // Keep all transactions, filtering will be done in renderTable
            this.transactions = allTransactions;

            // Populate category filter
            const categories = [...new Set(this.transactions.map(t => t.category).filter(Boolean))].sort();
            const catSelect = document.getElementById('timelineCategoryFilter');
            if (catSelect) {
                const currentVal = catSelect.value;
                catSelect.innerHTML = `<option value="" data-i18n="filter_all_categories">${window.i18n.t('filter_all_categories')}</option>` + 
                    categories.map(c => `<option value="${c}">${c}</option>`).join('');
                catSelect.value = currentVal;
            }

            if (this.pendingFilter) {
                const pf = this.pendingFilter;
                this.pendingFilter = null;
                if (pf.unreconciledBeforeDate) {
                    const check = document.getElementById('timelineUnreconciledFilter');
                    if (check) check.checked = true;
                }
            }

            // Load budgets map for the budget column
            try {
                const budgets = await API.get('/api/budgets/');
                this.budgetsMap = {};
                budgets.forEach(b => { this.budgetsMap[b.id] = b.name; });
            } catch(e) { this.budgetsMap = {}; }

            this.renderTable();
        } catch (e) {
            console.error("Failed to load timeline", e);
        }
    },

    applyFilters() {
        this.renderTable(false); // false means don't auto-scroll
    },

    renderTable(autoScroll = true) {
        const tbody = document.getElementById('timelineBody');
        if (!tbody) return;
        
        // Read filters
        const searchInput = document.getElementById('timelineSearch');
        const typeFilter = document.getElementById('timelineTypeFilter');
        const catFilter = document.getElementById('timelineCategoryFilter');
        const attachFilter = document.getElementById('timelineAttachmentFilter');
        
        const q = searchInput ? searchInput.value.toLowerCase() : '';
        const tType = typeFilter ? typeFilter.value : '';
        const tCat = catFilter ? catFilter.value : '';
        const tAttach = attachFilter ? attachFilter.checked : false;

        // Apply filters
        let filtered = this.transactions;
        if (q) {
            filtered = filtered.filter(tx => 
                (tx.description || '').toLowerCase().includes(q) ||
                (tx.category || '').toLowerCase().includes(q) ||
                (tx.amount || '').toString().includes(q)
            );
        }
        if (tType) {
            filtered = filtered.filter(tx => tx.type === tType);
        }
        if (tCat) {
            filtered = filtered.filter(tx => tx.category === tCat);
        }
        if (tAttach) {
            filtered = filtered.filter(tx => !!tx.attachments);
        }
        
        const unrecFilter = document.getElementById('timelineUnreconciledFilter');
        const unrecChecked = unrecFilter ? unrecFilter.checked : false;
        
        const cfg = window.app && window.app.config ? window.app.config : {};
        const isOrgMode = cfg.enable_org_mode === 'true' || cfg.enable_org_mode === true;
        
        let startDateStr = '';
        let endDateStr = '';

        if (isOrgMode) {
            const startInput = document.getElementById('timelineStartDate');
            const endInput = document.getElementById('timelineEndDate');
            startDateStr = startInput ? startInput.value : '';
            endDateStr = endInput ? endInput.value : '';
        } else {
            const periodFilter = document.getElementById('timelineReconciledPeriod');
            const periodValue = periodFilter ? periodFilter.value : 'current';
            
            let baseStartDateStr = '';
            if (window.app.payHistory && window.app.payHistory.length > 0) {
                const sortedHistory = [...window.app.payHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
                baseStartDateStr = sortedHistory[0].date.substring(0, 10);
            } else {
                const now = new Date();
                const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const pad = (n) => n < 10 ? '0'+n : n;
                baseStartDateStr = `${startOfMonth.getFullYear()}-${pad(startOfMonth.getMonth()+1)}-${pad(startOfMonth.getDate())}`;
            }
            
            if (periodValue !== 'all') {
                const baseDateObj = new Date(baseStartDateStr);
                if (periodValue === 'plus_5') {
                    baseDateObj.setDate(baseDateObj.getDate() - 5);
                } else if (periodValue === 'plus_15') {
                    baseDateObj.setDate(baseDateObj.getDate() - 15);
                } else if (periodValue === 'plus_30') {
                    baseDateObj.setDate(baseDateObj.getDate() - 30);
                }
                const pad = (n) => n < 10 ? '0'+n : n;
                startDateStr = `${baseDateObj.getFullYear()}-${pad(baseDateObj.getMonth()+1)}-${pad(baseDateObj.getDate())}`;
            }
        }

        if (unrecChecked && !isOrgMode && window.app.nextPayDate) {
            const nextPayDate = new Date(window.app.nextPayDate);
            filtered = filtered.filter(tx => {
                if (tx.reconciliation_date) return false;
                const txDate = new Date(tx.date_operation);
                if (txDate > nextPayDate) return false;
                if (!tx.from_account_id || tx.to_account_id) return false; // Basic proxy for expense
                return true;
            });
        }

        // Split into unreconciled and reconciled
        let unreconciled = filtered.filter(tx => !tx.reconciliation_date);
        let reconciled = filtered.filter(tx => tx.reconciliation_date);
        
        // Hide unreconciled transactions strictly AFTER next pay date
        if (!isOrgMode && window.app.nextPayDate) {
            const nextPayDate = new Date(window.app.nextPayDate);
            unreconciled = unreconciled.filter(tx => {
                const txDate = new Date(tx.date_operation);
                return txDate <= nextPayDate;
            });
        }
        
        // Filter reconciled transactions based on start and end dates
        reconciled = reconciled.filter(tx => {
            if (!startDateStr && !endDateStr) return true;
            
            // Lexicographical comparison works for YYYY-MM-DD format
            const txDateStr = tx.date_operation ? tx.date_operation.substring(0, 10) : '';
            if (!txDateStr) return true;
            
            if (startDateStr && txDateStr < startDateStr) return false;
            if (endDateStr && txDateStr > endDateStr) return false;
            
            return true;
        });

        // Sort Unreconciled: furthest future to closest (descending date)
        unreconciled.sort((a, b) => new Date(b.date_operation) - new Date(a.date_operation));

        // Sort Reconciled: most recent to oldest (descending date)
        reconciled.sort((a, b) => new Date(b.date_operation) - new Date(a.date_operation));

        const renderRow = (tx) => {
            const isReconciled = tx.reconciliation_date ? true : false;
            const amountColor = tx.type === 'income' ? 'var(--color-income)' : 
                               (tx.type === 'transfer' ? 'var(--color-transfer)' : 'inherit');
            
            let rowClass = isReconciled ? 'reconciled-row' : '';
            
            // Highlight non-recurrent operations
            const isRecurrent = tx.recurrence_id || tx.is_monthly || tx.is_yearly;
            if (!isRecurrent) {
                rowClass += ' non-recurrent-row';
            } else {
                rowClass += ' recurrent-row';
            }
            
            const idAttr = tx._isFirstReconciled ? 'id="first-reconciled"' : '';
            
            let reconcileHTML = '';
            if (isReconciled) {
                const dateStr = formatDate(tx.reconciliation_date);
                reconcileHTML = `<span style="font-size:12px; cursor:pointer;" onclick="window.TimelineView.toggleReconciliation(${tx.id})" title="${window.i18n.t('tooltip_cancel_reconciliation')}">${dateStr}</span>`;
            } else {
                reconcileHTML = `<button class="btn btn-primary" style="padding: 4px 10px; font-size: 11px; border-radius: 6px;" onclick="window.TimelineView.toggleReconciliation(${tx.id})">${window.i18n.t('btn_reconcile')}</button>`;
            }

            const accounts = window.app.accounts || [];
            const getAcc = (id) => accounts.find(x => x.id === id);
            const getAccBadge = (id) => {
                const a = getAcc(id);
                if (!a) return '-';
                const c = a.color || '#3366ff';
                return `<span class="account-badge" style="background:${c}20;color:${c};border-color:${c}40;">${a.name}</span>`;
            };
            const depuis = tx.from_account_id ? getAccBadge(tx.from_account_id) : '-';
            const vers = tx.to_account_id ? getAccBadge(tx.to_account_id) : '-';
            const depuisTitle = tx.from_account_id ? (getAcc(tx.from_account_id)?.name || '') : '';
            const versTitle = tx.to_account_id ? (getAcc(tx.to_account_id)?.name || '') : '';
            
            let recText = '-';
            if (tx.is_monthly) recText = window.i18n.t('rec_monthly');
            if (tx.is_yearly) recText = window.i18n.t('rec_yearly');
            if (tx.is_bimonthly) recText = window.i18n.t('rec_bimonthly');

            const attachHtml = tx.attachments ? `<span title="${tx.attachments}">📎</span>` : '-';

            return `
            <tr data-id="${tx.id}" class="${rowClass}" ${idAttr}>
                <td class="row-marker"></td>
                <td class="col-dateSaisie" data-label="${window.i18n.t('dl_date_entry')}">${formatDate(tx.date_saisie)}</td>
                <td class="col-date" data-label="${window.i18n.t('dl_date_op')}">${formatDate(tx.date_operation)}</td>
                <td class="col-desc" data-label="${window.i18n.t('dl_description')}" title="${(tx.description || '').replace(/"/g, '&quot;')}"><span class="desc-text">${tx.description}</span></td>
                <td class="col-type" data-label="${window.i18n.t('dl_type')}">${window.app.getTypeLabel(tx.type) || '-'}</td>
                <td class="col-cat" data-label="${window.i18n.t('dl_category')}" style="white-space: nowrap;" title="${(tx.category || '').replace(/"/g, '&quot;')}"><span style="background: var(--bg-base); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${tx.category || '-'}</span></td>
                <td class="col-amount" data-label="${window.i18n.t('dl_amount')}">
                    <span class="privacy-blur" style="color: ${amountColor}; font-weight: bold;">${formatCurrency(tx.amount)}</span>
                </td>
                <td class="col-recon" data-label="${window.i18n.t('dl_reconciled')}" style="text-align: center;">
                    ${reconcileHTML}
                </td>
                <td class="col-budget" data-label="${window.i18n.t('dl_envelope')}">${tx.budget_id && window.TimelineView.budgetsMap[tx.budget_id] ? `<span onclick="window.app.loadView('budgets')" style="background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;cursor:pointer;" title=\"${window.i18n.t('tooltip_view_envelope')}\">🗂️ ${window.TimelineView.budgetsMap[tx.budget_id]}</span>` : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</td>
                <td class="col-depuis" data-label="${window.i18n.t('dl_from')}" title="${depuisTitle}">${depuis}</td>
                <td class="col-vers" data-label="${window.i18n.t('dl_to')}" title="${versTitle}">${vers}</td>
                <td class="col-recurrence" data-label="${window.i18n.t('dl_recurrence')}">${recText}</td>
                <td class="col-slip" data-label="${window.i18n.t('dl_slip')}">${tx.check_slip_number || '-'}</td>
                <td class="col-attachments" data-label="${window.i18n.t('dl_attachments')}">${attachHtml}</td>
                <td class="col-actions mobile-card-actions">
                    <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;">
                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;white-space:nowrap;" onclick="window.TimelineView.edit(${tx.id})">${window.i18n.t('tooltip_edit')}</button>
                        <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="window.TimelineView.delete(${tx.id})">✕</button>
                    </div>
                </td>
            </tr>
            `;
        };

        // Mark first reconciled for scroll targeting
        if (reconciled.length > 0) reconciled[0]._isFirstReconciled = true;

        const allRows = [
            ...unreconciled.map(renderRow),
            ...reconciled.map(renderRow)
        ];

        // Use virtual table for rendering
        const vt = this._ensureVT();
        const scrollOpts = {};
        if (autoScroll && reconciled.length > 0) {
            scrollOpts.scrollToId = 'first-reconciled';
        }
        vt.setData(allRows, scrollOpts);

        // Fix sticky headers
        this._initStickyObserver();
    },

    _stickyObserver: null,
    _initStickyObserver() {
        const header = document.getElementById('timelineHeader');
        const table = document.querySelector('.data-table');
        if (!header || !table) return;

        // Set initial value
        const update = () => {
            const offset = header.offsetHeight - 32; // minus the negative top margin
            table.style.setProperty('--sticky-top', offset + 'px');
        };
        update();

        // Watch for header size changes (filter wrapping, viewport resize)
        if (this._stickyObserver) this._stickyObserver.disconnect();
        this._stickyObserver = new ResizeObserver(update);
        this._stickyObserver.observe(header);
    },

    edit(id) {
        const tx = this.transactions.find(t => t.id === id);
        if (tx && window.FormView) {
            window.FormView.openEdit(tx);
        }
    },

    async toggleReconciliation(id) {
        try {
            await API.post(`/api/transactions/${id}/toggle_reconciliation`);
            await this.loadData();
            window.app.refreshSidebar();
        } catch (e) {
            console.error(e);
        }
    },

    async delete(id) {
        if (await showInlineConfirm(window.i18n.t('title_confirmation'), window.i18n.t('confirm_delete_operation'))) {
            try {
                await API.del(`/api/transactions/${id}`);
                await this.loadData();
                window.app.refreshSidebar();
            } catch (e) {
                console.error(e);
            }
        }
    },
    
    showAddRow() {
        if (window.FormView) window.FormView.open();
    }
};
