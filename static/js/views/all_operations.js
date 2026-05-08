window.AllOperationsView = {
    transactions: [],
    accounts: {},
    pendingFilter: null,  // {category, monthKey} set by AnalyticsView before navigation

    budgetsMap: {}, // added for column matching

    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const attachDisp = cfg.enable_attachments === 'true' ? '' : 'display: none !important;';
        const slipDisp = cfg.enable_check_slips === 'true' ? '' : 'display: none !important;';

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
                    </div>
                    <div style="text-align: center;">
                        <button class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 14px;" onclick="document.getElementById('historyColsModal').style.display='none'" data-i18n="btn_close">${window.i18n.t('btn_close')}</button>
                    </div>
                </div>
            </div>
            <div id="historyHeader" class="view-header" style="position: sticky; top: -32px; z-index: 10; background-color: var(--bg-base); padding: 32px 0 15px 0; margin-top: -32px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                <h2 style="margin:0;">📋 <span data-i18n="nav_history">Historique</span></h2>
                <div class="history-filters" style="display:flex; gap:8px; flex:1; max-width:900px; justify-content:flex-end; flex-wrap:wrap;">
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
                <div style="display:flex; gap:8px; flex-wrap:wrap;">
                    <button class="btn btn-secondary" onclick="document.getElementById('historyColsModal').style.display='flex'" data-i18n="btn_columns">${window.i18n.t('btn_columns')}</button>
                    <button class="btn btn-secondary" onclick="window.ImportWizard.open()" data-i18n="btn_import_statement">📥 Importer un relevé</button>
                    <button class="btn btn-primary" onclick="window.TimelineView.showAddRow()">${window.i18n.t('btn_add_operation')}</button>
                </div>
            </div>
            <div style="padding-bottom: 20px;">
                <table class="data-table timeline-table mobile-card-table">
                    <thead>
                        <tr>
                            <th class="col-dateSaisie" style="width: 100px;" data-i18n="col_date_entry">${window.i18n.t('col_date_entry')}</th>
                            <th class="col-date" style="width: 100px;" data-i18n="col_date_op">${window.i18n.t('col_date_op')}</th>
                            <th class="col-desc" data-i18n="col_description">${window.i18n.t('col_description')}</th>
                            <th class="col-type" style="width: 120px;" data-i18n="col_type">${window.i18n.t('col_type')}</th>
                            <th class="col-cat" style="width: 160px; white-space: nowrap;" data-i18n="col_category">${window.i18n.t('col_category')}</th>
                            <th class="col-amount" style="width: 100px;" data-i18n="col_amount">${window.i18n.t('col_amount')}</th>
                            <th class="col-recon" style="width: 120px;" data-i18n="col_reconciled">${window.i18n.t('col_reconciled')}</th>
                            <th class="col-budget" style="width: 110px;" data-i18n="col_envelope">${window.i18n.t('col_envelope')}</th>
                            <th class="col-depuis" style="width: 120px;" data-i18n="col_from">${window.i18n.t('col_from')}</th>
                            <th class="col-vers" style="width: 120px;" data-i18n="col_to">${window.i18n.t('col_to')}</th>
                            <th class="col-recurrence" style="width: 100px;" data-i18n="col_recurrence">${window.i18n.t('col_recurrence')}</th>
                            <th class="col-slip" style="width: 120px;" data-i18n="col_slip">${window.i18n.t('col_slip')}</th>
                            <th class="col-attachments" style="width: 100px;" data-i18n="col_attachments">${window.i18n.t('col_attachments')}</th>
                            <th class="col-actions" style="width: 50px;"></th>
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
        await this.loadData();
    },

    getColSettings() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const showAttachments = cfg.enable_attachments === 'true';
        const showSlips = cfg.enable_check_slips === 'true';
        const def = { dateSaisie: false, date: true, desc: true, type: false, cat: true, amount: true, recon: true, budget: false, depuis: false, vers: false, recurrence: false, slip: showSlips, attachments: showAttachments };
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
        
        // Inject CSS using classes
        let css = '';
        Object.keys(cols).forEach(k => {
            if (!cols[k]) {
                css += `.timeline-table .col-${k} { display: none !important; }\n`;
            }
        });
        
        const styleTag = document.getElementById('historyColsStyle');
        if (styleTag) styleTag.innerHTML = css;
    },

    async loadData() {
        try {
            // Load budgets map for the budget column
            try {
                const budgets = await API.get('/api/budgets/');
                this.budgetsMap = {};
                budgets.forEach(b => { this.budgetsMap[b.id] = b.name; });
            } catch(e) { this.budgetsMap = {}; }

            // Load accounts to map IDs to names
            const accs = await API.get('/api/accounts/');
            this.accounts = {};
            accs.forEach(a => { this.accounts[a.id] = a.name; });

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
                (this.accounts[tx.from_account_id] || '').toLowerCase().includes(q) ||
                (this.accounts[tx.to_account_id] || '').toLowerCase().includes(q) ||
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

        const html = filtered.map(tx => {
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
            }

            const depuis = this.accounts[tx.from_account_id] || '';
            const vers = this.accounts[tx.to_account_id] || '';

            return `
            <tr data-id="${tx.id}" class="${rowClass}" ${idAttr}>
                <td class="col-dateSaisie" data-label="${window.i18n.t('dl_date_entry')}">${formatDate(tx.date_saisie)}</td>
                <td class="col-date" data-label="${window.i18n.t('dl_date_op')}">${formatDate(tx.date_operation)}</td>
                <td class="col-desc" data-label="${window.i18n.t('dl_description')}"><strong>${tx.description}</strong></td>
                <td class="col-type" data-label="${window.i18n.t('dl_type')}">${window.app.getTypeLabel(tx.type)}</td>
                <td class="col-cat" data-label="${window.i18n.t('dl_category')}" style="white-space: nowrap;"><span style="background: var(--bg-base); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${tx.category || '-'}</span></td>
                <td class="col-amount" data-label="${window.i18n.t('dl_amount')}">
                    <span class="privacy-blur" style="color: ${amountColor}; font-weight: bold;">${formatCurrency(tx.amount)}</span>
                </td>
                <td class="col-recon" data-label="${window.i18n.t('dl_reconciled')}">${formatDate(tx.reconciliation_date) || '-'}</td>
                <td class="col-budget" data-label="${window.i18n.t('dl_envelope')}">${tx.budget_id && this.budgetsMap[tx.budget_id] ? `<span onclick="window.app.loadView('budgets')" style="background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;cursor:pointer;" title=\"${window.i18n.t('tooltip_view_envelope')}\">🗂️ ${this.budgetsMap[tx.budget_id]}</span>` : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</td>
                <td class="col-depuis" data-label="${window.i18n.t('dl_from')}">${depuis}</td>
                <td class="col-vers" data-label="${window.i18n.t('dl_to')}">${vers}</td>
                <td class="col-recurrence" data-label="${window.i18n.t('dl_recurrence')}">${isRecurrent ? '🔄' : '-'}</td>
                <td class="col-slip" data-label="${window.i18n.t('dl_slip')}">${tx.slip_number ? '<span style="background: rgba(255,152,0,0.15); color: #ff9800; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">' + tx.slip_number + '</span>' : '-'}</td>
                <td class="col-attachments" data-label="${window.i18n.t('dl_attachments')}">${tx.attachments ? `<span style="cursor:pointer;" title="${tx.attachments}">📎</span>` : '-'}</td>
                <td class="col-actions mobile-card-actions">
                    <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;">
                        <button class="btn btn-secondary" style="padding: 4px 8px; font-size: 11px;white-space:nowrap;" onclick="window.AllOperationsView.edit(${tx.id})">${window.i18n.t('tooltip_edit')}</button>
                        <button class="btn btn-danger" style="padding: 4px 8px; font-size: 11px;" onclick="window.AllOperationsView.delete(${tx.id})">✕</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        tbody.innerHTML = html || `<tr><td colspan="10" style="text-align:center; padding: 20px; color: var(--text-muted)">${window.i18n.t('msg_no_operations_period')}</td></tr>`;
        
        // Fix sticky table headers position
        setTimeout(() => {
            const header = document.getElementById('historyHeader');
            const ths = document.querySelectorAll('.data-table th');
            if (header && ths.length) {
                const offset = header.offsetHeight - 32; 
                ths.forEach(th => th.style.top = offset + 'px');
            }
            
            if (autoScroll) {
                const currentPoint = document.getElementById('current-date-row');
                if (currentPoint) {
                    const main = document.querySelector('.app-main');
                    if (main) {
                        main.scrollTo({
                            top: currentPoint.offsetTop - (main.clientHeight / 2) + (currentPoint.offsetHeight / 2),
                            behavior: 'smooth'
                        });
                    }
                }
            }
        }, 50);
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
    }
};
