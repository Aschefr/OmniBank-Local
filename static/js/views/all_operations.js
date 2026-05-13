window.AllOperationsView = {
    transactions: [],
    accounts: {},
    pendingFilter: null,  // {category, monthKey} set by AnalyticsView before navigation
    _vt: null,

    budgetsMap: {}, // added for column matching

    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const attachDisp = cfg.enable_attachments === 'true' ? '' : 'display: none !important;';
        const slipDisp = cfg.enable_check_slips === 'true' ? '' : 'display: none !important;';
        const orgDisp = cfg.enable_org_mode === 'true' ? '' : 'display: none !important;';

        return `
            <style id="historyColsStyle"></style>
            <div id="historyColsModal" class="modal-overlay" style="display: none; z-index: 100;">
                <div class="modal" style="max-width: 380px; min-width: auto; padding: 25px;">
                    <h3 style="margin-top:0; margin-bottom: 20px; display:flex; align-items:center; gap:8px; border-bottom: 1px solid var(--border-color); padding-bottom: 10px;">${window.i18n.t('btn_columns')}</h3>
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom: 25px;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_dateSaisie" onchange="window.AllOperationsView.toggleCol('dateSaisie')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_date_entry')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_date" onchange="window.AllOperationsView.toggleCol('date')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_date_op')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_desc" onchange="window.AllOperationsView.toggleCol('desc')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_description')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_type" onchange="window.AllOperationsView.toggleCol('type')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_type')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_cat" onchange="window.AllOperationsView.toggleCol('cat')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_category')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_amount" onchange="window.AllOperationsView.toggleCol('amount')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_amount')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_recon" onchange="window.AllOperationsView.toggleCol('recon')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_reconciled')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_budget" onchange="window.AllOperationsView.toggleCol('budget')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_envelope')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_depuis" onchange="window.AllOperationsView.toggleCol('depuis')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_from')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_vers" onchange="window.AllOperationsView.toggleCol('vers')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_to')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500;"><input type="checkbox" id="chk_history_col_recurrence" onchange="window.AllOperationsView.toggleCol('recurrence')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_recurrence')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; ${slipDisp}"><input type="checkbox" id="chk_history_col_slip" onchange="window.AllOperationsView.toggleCol('slip')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_slip')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; ${attachDisp}"><input type="checkbox" id="chk_history_col_attachments" onchange="window.AllOperationsView.toggleCol('attachments')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_attachments')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; ${orgDisp}"><input type="checkbox" id="chk_history_col_createdBy" onchange="window.AllOperationsView.toggleCol('createdBy')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_created_by')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; ${orgDisp}"><input type="checkbox" id="chk_history_col_modifiedBy" onchange="window.AllOperationsView.toggleCol('modifiedBy')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_modified_by')}</label>
                    </div>
                    <div style="text-align: center;">
                        <button class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 14px;" onclick="document.getElementById('historyColsModal').style.display='none'" data-i18n="btn_close">${window.i18n.t('btn_close')}</button>
                    </div>
                </div>
            </div>
            <div id="historyHeader" class="view-header responsive-header" style="position: sticky; top: -32px; z-index: 10; background-color: var(--bg-base); padding: 32px 0 15px 0; margin-top: -32px;">
                <h2 style="margin:0;">📋 <span data-i18n="nav_history">Historique</span></h2>
                <div class="responsive-header-controls">
                    <div class="history-filters" style="display:flex; gap:8px; width:100%; max-width:900px; justify-content:flex-end; flex-wrap:wrap; align-items: center;">
                    <input type="text" id="historySearch" class="inline-input" data-i18n-placeholder="ph_search" placeholder="Rechercher..." style="min-width:0; flex:1; max-width: 180px;" oninput="window.AllOperationsView.applyFilters()">
                    <input type="month" id="historyMonthFilter" class="inline-input" style="min-width:0; flex:1;" onchange="window.AllOperationsView.applyFilters()" title="Filtrer par mois">
                    <select id="historyTypeFilter" class="inline-input" style="min-width:130px; flex:1;" onchange="window.AllOperationsView.applyFilters()">
                        <option value="" data-i18n="filter_all_types">${window.i18n.t('filter_all_types')}</option>
                        <option value="expense_fixed" data-i18n="type_expense_fixed">${window.i18n.t('type_expense_fixed')}</option>
                        <option value="expense_var" data-i18n="type_expense_var">${window.i18n.t('type_expense_var')}</option>
                        <option value="income" data-i18n="type_income">${window.i18n.t('type_income')}</option>
                        <option value="transfer" data-i18n="type_transfer">${window.i18n.t('type_transfer')}</option>
                    </select>
                    <select id="historyCategoryFilter" class="inline-input" style="min-width:130px; flex:1;" onchange="window.AllOperationsView.applyFilters()">
                        <option value="">Toutes les catégories</option>
                    </select>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span style="font-size:12px; font-weight:600; color:var(--text-muted); white-space:nowrap;" data-i18n="filter_unreconciled_before_pay">${window.i18n.t('filter_unreconciled_before_pay')}</span>
                        <label class="toggle-switch" style="flex-shrink: 0;" data-i18n-title="tooltip_filter_unreconciled" title="Filtre les dépenses non-rapprochées prévues avant la prochaine paie">
                            <input type="checkbox" id="historyUnreconciledFilter" onchange="window.AllOperationsView.applyFilters()">
                            <span class="slider"></span>
                        </label>
                    </div>
                    <div style="display:flex; align-items:center; gap:8px; ${attachDisp}">
                        <span style="font-size:12px; font-weight:600; color:var(--text-muted); white-space:nowrap;" data-i18n="filter_attachments">Pièces jointes</span>
                        <label class="toggle-switch" style="flex-shrink: 0;" data-i18n-title="tooltip_filter_attachments" title="Uniquement avec pièces jointes">
                            <input type="checkbox" id="historyAttachmentFilter" onchange="window.AllOperationsView.applyFilters()">
                            <span class="slider"></span>
                        </label>
                    </div>
                    </div>
                <div class="header-buttons" style="display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="document.getElementById('historyColsModal').style.display='flex'" data-i18n="btn_columns">${window.i18n.t('btn_columns')}</button>
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
                            <th class="col-createdBy" data-i18n="col_created_by">${window.i18n.t('col_created_by')}</th>
                            <th class="col-modifiedBy" data-i18n="col_modified_by">${window.i18n.t('col_modified_by')}</th>
                            <th class="col-actions"></th>
                        </tr>
                    </thead>
                    <tbody id="allOperationsBody">
                        <!-- Rendered dynamically -->
                    </tbody>
                </table>
            </div>
        `;
    },

    async init() {
        this.applyColSettings();
        // Lazily create VirtualTable
        if (!this._vt) {
            this._vt = new VirtualTable({
                tbodyId: 'allOperationsBody',
                scrollContainerSelector: '.app-main',
                rowHeight: 38,
                bufferRows: 20,
                emptyHTML: `<tr><td></td><td colspan="13" style="text-align:center; padding: 20px; color: var(--text-muted)">${window.i18n.t('msg_no_operations_period')}</td></tr>`
            });
        }
        await this.loadData();
    },

    getColSettings() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const showAttachments = cfg.enable_attachments === 'true';
        const showSlips = cfg.enable_check_slips === 'true';
        const def = { dateSaisie: false, date: true, desc: true, type: false, cat: true, amount: true, recon: true, budget: false, depuis: false, vers: false, recurrence: false, slip: showSlips, attachments: showAttachments, createdBy: false, modifiedBy: false };
        try {
            const saved = localStorage.getItem('history_cols');
            const parsed = saved ? { ...def, ...JSON.parse(saved) } : def;
            if (!showSlips) parsed.slip = false;
            if (!showAttachments) parsed.attachments = false;
            return parsed;
        } catch { return def; }
    },

    toggleCol(col) {
        const settings = this.getColSettings();
        const chk = document.getElementById('chk_history_col_' + col);
        if (chk) {
            settings[col] = chk.checked;
            localStorage.setItem('history_cols', JSON.stringify(settings));
            this.applyColSettings();
        }
    },

    applyColSettings() {
        const cols = this.getColSettings();
        
        // Update checkboxes
        Object.keys(cols).forEach(k => {
            const el = document.getElementById('chk_history_col_' + k);
            if (el) el.checked = cols[k];
        });
        
        // Column weight map (higher = more space)
        const colWeights = {
            dateSaisie: 1.5, date: 1.5, desc: 4, type: 1.8,
            cat: 2.5, amount: 1.5, recon: 1.8, budget: 1.5,
            depuis: 1.5, vers: 1.5, recurrence: 1.2, slip: 1.2, attachments: 1,
            createdBy: 1.5, modifiedBy: 1.5
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
        
        const styleTag = document.getElementById('historyColsStyle');
        if (styleTag) styleTag.innerHTML = css;
    },

    async loadData() {
        try {
            // Load budgets map for the budget column
            try {
                const budgets = await API.get('/api/budgets/');
                this.budgetsMap = {};
                this.categoryToBudgetMap = {}; // category name → budget name (for category-based envelopes)
                budgets.forEach(b => {
                    this.budgetsMap[b.id] = b.name;
                    // For category-based budgets, map each category to the budget name
                    if (!b.is_project && b.categories) {
                        b.categories.forEach(cat => { this.categoryToBudgetMap[cat] = b.name; });
                    }
                });
            } catch(e) { this.budgetsMap = {}; this.categoryToBudgetMap = {}; }

            // Load accounts to map IDs to full objects (name + color)
            const accs = await API.get('/api/accounts/');
            this.accounts = {};
            this.accountNames = {};
            accs.forEach(a => { this.accounts[a.id] = a; this.accountNames[a.id] = a.name; });

            // Get all operations
            const allTx = await API.get('/api/transactions/?limit=10000');
            // Sort by operation date descending (newest first)
            this.transactions = allTx.sort((a, b) => new Date(b.date_operation) - new Date(a.date_operation));
            
            // Populate category filter
            const categories = [...new Set(this.transactions.map(t => t.category).filter(Boolean))].sort();
            const catSelect = document.getElementById('historyCategoryFilter');
            if (catSelect) {
                const currentVal = catSelect.value;
                catSelect.innerHTML = `<option value="" data-i18n="filter_all_categories">${window.i18n.t('filter_all_categories')}</option>` + 
                    categories.map(c => `<option value="${c}">${c}</option>`).join('');
                catSelect.value = currentVal;
            }

            // Apply pending filter from AnalyticsView drilldown
            if (this.pendingFilter) {
                const pf = this.pendingFilter;
                this.pendingFilter = null;
                // Set category filter
                if (pf.category) {
                    const catSelect = document.getElementById('historyCategoryFilter');
                    if (catSelect) catSelect.value = pf.category;
                }
                // Set month filter
                if (pf.monthKey) {
                    const monthInput = document.getElementById('historyMonthFilter');
                    if (monthInput) monthInput.value = pf.monthKey;
                }
                // Set year in search
                if (pf.year) {
                    const searchInput = document.getElementById('historySearch');
                    if (searchInput) searchInput.value = pf.year;
                }
            }

            this.renderTable();

            // Check if we need to highlight a specific transaction (e.g. overdraft locate)
            if (this._pendingHighlightTxId) {
                const txId = this._pendingHighlightTxId;
                this._pendingHighlightTxId = null;
                // Small delay to let VirtualTable finish initial render
                setTimeout(() => this.scrollToAndHighlight(txId), 200);
            }
        } catch (e) {
            console.error("Failed to load operations", e);
        }
    },
    
    applyFilters() {
        this.renderTable(false); // false means don't auto-scroll
    },

    renderTable(autoScroll = true) {
        const tbody = document.getElementById('allOperationsBody');
        if (!tbody) return;
        
        // Read filters
        const searchInput = document.getElementById('historySearch');
        const typeFilter = document.getElementById('historyTypeFilter');
        const catFilter = document.getElementById('historyCategoryFilter');
        
        const q = searchInput ? searchInput.value.toLowerCase() : '';
        const tType = typeFilter ? typeFilter.value : '';
        const tCat = catFilter ? catFilter.value : '';

        // Month filter (YYYY-MM)
        const monthInput = document.getElementById('historyMonthFilter');
        const tMonth = monthInput ? monthInput.value : '';
        
        const attachFilter = document.getElementById('historyAttachmentFilter');
        const tAttach = attachFilter ? attachFilter.checked : false;
        
        const unrecFilter = document.getElementById('historyUnreconciledFilter');
        const unrecChecked = unrecFilter ? unrecFilter.checked : false;

        // Apply filters
        let filtered = this.transactions;
        if (q) {
            filtered = filtered.filter(tx => 
                (tx.description || '').toLowerCase().includes(q) ||
                (tx.category || '').toLowerCase().includes(q) ||
                (tx.amount || '').toString().includes(q) ||
                (this.accountNames[tx.from_account_id] || '').toLowerCase().includes(q) ||
                (this.accountNames[tx.to_account_id] || '').toLowerCase().includes(q) ||
                (tx.date_operation || '').includes(q)
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
        if (unrecChecked && window.app.nextPayDate) {
            const nextPayDate = new Date(window.app.nextPayDate);
            filtered = filtered.filter(tx => {
                if (tx.reconciliation_date) return false;
                const txDate = new Date(tx.date_operation);
                if (txDate > nextPayDate) return false;
                if (!tx.from_account_id || tx.to_account_id) return false; // Basic proxy for expense
                return true;
            });
        }
        if (tMonth) {
            filtered = filtered.filter(tx => tx.date_operation && tx.date_operation.startsWith(tMonth));
        }
        
        const today = new Date();
        today.setHours(0,0,0,0);
        let foundCurrent = false;

        const rowStrings = filtered.map(tx => {
            let idAttr = '';
            if (!foundCurrent) {
                const txDate = new Date(tx.date_operation);
                txDate.setHours(0,0,0,0);
                if (txDate <= today) {
                    idAttr = 'id="current-date-row"';
                    foundCurrent = true;
                }
            }

            const amountColor = tx.type === 'income' ? 'var(--color-income)' : 
                               (tx.type === 'transfer' ? 'var(--color-transfer)' : 'inherit');
            
            const isReconciled = tx.reconciliation_date ? true : false;
            let rowClass = isReconciled ? 'reconciled-row' : '';
            
            // Highlight non-recurrent operations
            const isRecurrent = tx.recurrence_id || tx.is_monthly || tx.is_yearly;
            if (!isRecurrent) {
                rowClass += ' non-recurrent-row';
            } else {
                rowClass += ' recurrent-row';
            }

            const fromAcc = this.accounts[tx.from_account_id];
            const toAcc = this.accounts[tx.to_account_id];
            const depuisTitle = fromAcc ? fromAcc.name : '';
            const versTitle = toAcc ? toAcc.name : '';
            const depuisBadge = fromAcc ? `<span class="account-badge" style="background:${fromAcc.color || '#3366ff'}20;color:${fromAcc.color || '#3366ff'};border-color:${fromAcc.color || '#3366ff'}40;">${fromAcc.name}</span>` : '-';
            const versBadge = toAcc ? `<span class="account-badge" style="background:${toAcc.color || '#3366ff'}20;color:${toAcc.color || '#3366ff'};border-color:${toAcc.color || '#3366ff'}40;">${toAcc.name}</span>` : '-';

            let recText = '-';
            if (tx.is_monthly) recText = window.i18n.t('rec_monthly');
            if (tx.is_yearly) recText = window.i18n.t('rec_yearly');
            if (tx.is_bimonthly) recText = window.i18n.t('rec_bimonthly');

            return `
            <tr data-id="${tx.id}" class="${rowClass}" ${idAttr}>
                <td class="row-marker"></td>
                <td class="col-dateSaisie" data-label="${window.i18n.t('dl_date_entry')}">${formatDate(tx.date_saisie)}</td>
                <td class="col-date" data-label="${window.i18n.t('dl_date_op')}">${formatDate(tx.date_operation)}</td>
                <td class="col-desc" data-label="${window.i18n.t('dl_description')}" title="${(tx.description || '').replace(/"/g, '&quot;')}"><span class="desc-text">${tx.description}</span></td>
                <td class="col-type" data-label="${window.i18n.t('dl_type')}" title="${window.app.getTypeLabel(tx.type)}">${window.app.getTypeLabel(tx.type)}</td>
                <td class="col-cat" data-label="${window.i18n.t('dl_category')}" title="${(tx.category || '').replace(/"/g, '&quot;')}"><span style="background: var(--bg-base); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${tx.category || '-'}</span></td>
                <td class="col-amount" data-label="${window.i18n.t('dl_amount')}">
                    <span class="privacy-blur" style="color: ${amountColor}; font-weight: bold;">${formatCurrency(tx.amount)}</span>
                </td>
                <td class="col-recon" data-label="${window.i18n.t('dl_reconciled')}">${formatDate(tx.reconciliation_date) || '-'}</td>
                <td class="col-budget" data-label="${window.i18n.t('dl_envelope')}">${(() => { const bName = (tx.budget_id && this.budgetsMap[tx.budget_id]) ? this.budgetsMap[tx.budget_id] : (tx.category && this.categoryToBudgetMap && this.categoryToBudgetMap[tx.category]) ? this.categoryToBudgetMap[tx.category] : null; return bName ? `<span onclick="window.BudgetsView._pendingHighlightName='${bName.replace(/'/g, "\\'")}';window.app.loadView('budgets')" style="background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;cursor:pointer;" title="${bName}">🗂️ ${bName}</span>` : '<span style="color:var(--text-muted);font-size:11px;">—</span>'; })()}</td>
                <td class="col-depuis" data-label="${window.i18n.t('dl_from')}" title="${depuisTitle}">${depuisBadge}</td>
                <td class="col-vers" data-label="${window.i18n.t('dl_to')}" title="${versTitle}">${versBadge}</td>
                <td class="col-recurrence" data-label="${window.i18n.t('dl_recurrence')}" title="${recText}">${recText}</td>
                <td class="col-slip" data-label="${window.i18n.t('dl_slip')}">${tx.slip_number ? '<span style="background: rgba(255,152,0,0.15); color: #ff9800; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">' + tx.slip_number + '</span>' : '-'}</td>
                <td class="col-attachments" data-label="${window.i18n.t('dl_attachments')}">${tx.attachments ? `<span style="cursor:pointer;" title="${tx.attachments}" onclick="window.AllOperationsView._openAttachment('${tx.attachments.replace(/'/g, "\\'")}')">📎</span>` : '-'}</td>
                <td class="col-createdBy" data-label="${window.i18n.t('dl_created_by')}">${tx.created_by || '-'}</td>
                <td class="col-modifiedBy" data-label="${window.i18n.t('dl_modified_by')}">${tx.modified_by || '-'}</td>
                <td class="col-actions mobile-card-actions">
                    <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;">
                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;white-space:nowrap;" onclick="window.AllOperationsView.edit(${tx.id})">${window.i18n.t('tooltip_edit')}</button>
                        <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="window.AllOperationsView.delete(${tx.id})">✕</button>
                    </div>
                </td>
            </tr>
            `;
        });

        // Use virtual table for rendering
        const scrollOpts = {};
        if (autoScroll && foundCurrent) {
            scrollOpts.scrollToId = 'current-date-row';
        }
        this._vt.setData(rowStrings, scrollOpts);

        // Fix sticky table headers position
        this._initStickyObserver();
    },

    _stickyObserver: null,
    _initStickyObserver() {
        const header = document.getElementById('historyHeader');
        const table = document.querySelector('.data-table');
        if (!header || !table) return;

        const update = () => {
            const offset = header.offsetHeight - 32;
            table.style.setProperty('--sticky-top', offset + 'px');
        };
        update();

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

    /**
     * Scroll to a transaction by ID and flash-highlight it.
     * Injects a CSS class into the VirtualTable raw HTML so the
     * highlight survives re-renders triggered by scrolling.
     */
    scrollToAndHighlight(txId) {
        if (!this._vt || !this._vt._rows.length) return;

        const needle = `data-id="${txId}"`;
        const idx = this._vt._rows.findIndex(r => r.includes(needle));
        if (idx < 0) return;

        // Inject highlight class into the raw HTML string
        const original = this._vt._rows[idx];
        this._vt._rows[idx] = original.replace(
            /class="([^"]*)"/,
            (m, cls) => `class="${cls} overdraft-flash"`
        );

        // Scroll to the row
        this._vt._scrollToIndex(idx);

        // Remove the highlight after 3 seconds
        setTimeout(() => {
            this._vt._rows[idx] = original; // restore original HTML
            this._vt.refresh();
        }, 3500);
    },

    async _openAttachment(path) {
        const fileUrl = `${window.location.origin}/${path}`;
        if (window.__TAURI_INTERNALS__) {
            try {
                await window.__TAURI_INTERNALS__.invoke('plugin:shell|open', { path: fileUrl });
            } catch(err) { console.error('Shell open failed', err); }
        } else {
            window.open(fileUrl, '_blank');
        }
    }
};
