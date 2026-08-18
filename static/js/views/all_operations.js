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
                    <div class="op-form-grid-2" style="display:grid; grid-template-columns: 1fr 1fr; gap:15px; margin-bottom: 25px;">
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
                <h2 style="margin:0; display:flex; align-items:center; gap:10px;">
                    📋 <span data-i18n="nav_history">Historique</span>
                    <button id="btnHistoryBackToAnalytics" class="btn btn-secondary" style="display:none; padding: 4px 10px; font-size: 13px; font-weight: 500; align-items: center; gap: 4px;" onclick="window.app.loadView(window.AllOperationsView.backToView || 'analytics')" title="Retour">⬅️ Retour</button>
                </h2>
                <div class="responsive-header-controls">
                    <div class="history-filters" style="display:flex; gap:8px; width:100%; max-width:900px; justify-content:flex-end; flex-wrap:wrap; align-items: center;">
                    <input type="text" id="historySearch" class="inline-input" data-i18n-placeholder="ph_search" placeholder="Rechercher..." style="min-width:0; flex:1; max-width: 180px;" oninput="window.AllOperationsView.applyFilters()">
                    <div style="display:inline-flex; align-items:center; gap:4px; margin-right: 4px;">
                        <button id="historyMonthPrevBtn" class="btn btn-secondary" style="display:none; padding:0 8px; font-size:11px; min-height:32px; line-height:32px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-surface); cursor: pointer;" onclick="window.AllOperationsView.navigateMonthFilter(-1)" title="Mois précédent">◀</button>
                        <select id="historyMonthFilter" class="inline-input" style="min-width:110px; flex:1;" onchange="window.AllOperationsView.applyFilters(); window.AllOperationsView.updateMonthNavButtons();">
                            <option value="" data-i18n="filter_all_months">${window.i18n.t('filter_all_months') || 'Tous les mois'}</option>
                        </select>
                        <button id="historyMonthNextBtn" class="btn btn-secondary" style="display:none; padding:0 8px; font-size:11px; min-height:32px; line-height:32px; border-radius:6px; border:1px solid var(--border-color); background:var(--bg-surface); cursor: pointer;" onclick="window.AllOperationsView.navigateMonthFilter(1)" title="Mois suivant">▶</button>
                    </div>
                    <select id="historyTypeFilter" class="inline-input" style="min-width:130px; flex:1;" onchange="window.AllOperationsView.applyFilters()">
                        <option value="" data-i18n="filter_all_types">${window.i18n.t('filter_all_types')}</option>
                        <option value="expense_fixed" data-i18n="type_expense_fixed">${window.i18n.t('type_expense_fixed')}</option>
                        <option value="expense_var" data-i18n="type_expense_var">${window.i18n.t('type_expense_var')}</option>
                        <option value="income" data-i18n="type_income">${window.i18n.t('type_income')}</option>
                        <option value="transfer" data-i18n="type_transfer">${window.i18n.t('type_transfer')}</option>
                    </select>
                    <select id="historyAccountFilter" class="inline-input" style="min-width:130px; flex:1; max-width:180px;" onchange="window.AllOperationsView.applyFilters()">
                        <option value="" data-i18n="filter_all_accounts">${window.i18n.t('filter_all_accounts') || 'Tous les comptes'}</option>
                    </select>
                    <div id="historyCategoryFilter" style="min-width:130px; flex:1; max-width:220px;"></div>
                    <button class="btn btn-secondary" style="padding:0 8px; font-size:14px; border-radius:8px; min-height:32px; line-height:32px;" onclick="window.MultiSelect.reset('historyCategoryFilter')" title="${window.i18n.t('filter_reset_categories') || 'Reset categories'}">&#x21BA;</button>
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
                <div class="header-buttons" style="display:flex; gap:6px; flex-wrap:nowrap; justify-content:flex-end; align-items:center; flex-shrink:0;">
                    <button class="btn btn-secondary" onclick="document.getElementById('historyColsModal').style.display='flex'" data-i18n="btn_columns" style="height:32px; padding:0 10px; font-size:12px; border-radius:8px; white-space:nowrap;">${window.i18n.t('btn_columns')}</button>
                    <button id="btnImportStatement" class="btn btn-secondary" onclick="window.ImportWizard.open()" data-i18n="btn_import_statement" style="height:32px; padding:0 10px; font-size:12px; border-radius:8px; white-space:nowrap;">${window.i18n.t('btn_import_statement') || '📥 Importer un relevé'}</button>
                    <button id="btnHistoryBgSync" class="btn btn-secondary overview-bank-sync-btn" onclick="window.BankSyncView ? window.BankSyncView.triggerBackgroundSyncNow() : window.app.loadView('accounts')" data-i18n-title="bank_sync_run_background_tooltip" title="${window.i18n.t('bank_sync_run_background_tooltip') || 'Interroge vos banques connectées en tâche de fond pour récupérer les dernières opérations, détecter les correspondances à pointer et actualiser vos soldes sans bloquer l\'interface.'}" style="height:32px; padding:0 10px; font-size:12px; border-radius:8px; font-weight:600; white-space:nowrap; display:inline-flex; align-items:center; gap:4px;">
                        <span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne'}</span>
                    </button>
                    <button class="btn btn-primary" onclick="window.TimelineView.showAddRow()" data-i18n="btn_add_operation" style="height:32px; padding:0 12px; font-size:12px; border-radius:8px; font-weight:700; white-space:nowrap;">${window.i18n.t('btn_add_operation')}</button>

                </div>
                </div>
            </div>


            <div style="padding-bottom: 20px;">
                <div id="allOpsGhostBox"></div>
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
                            <th class="col-recon" style="text-align: center;" data-i18n="col_reconciled">${window.i18n.t('col_reconciled')}</th>
                            <th class="col-budget" data-i18n="col_envelope">${window.i18n.t('col_envelope')}</th>
                            <th class="col-depuis" data-i18n="col_from">${window.i18n.t('col_from')}</th>
                            <th class="col-vers" data-i18n="col_to">${window.i18n.t('col_to')}</th>
                            <th class="col-recurrence" data-i18n="col_recurrence">${window.i18n.t('col_recurrence')}</th>
                            <th class="col-slip" data-i18n="col_slip">${window.i18n.t('col_slip')}</th>
                            <th class="col-attachments" data-i18n="col_attachments">${window.i18n.t('col_attachments')}</th>
                            <th class="col-createdBy" data-i18n="col_created_by">${window.i18n.t('col_created_by')}</th>
                            <th class="col-modifiedBy" data-i18n="col_modified_by">${window.i18n.t('col_modified_by')}</th>
                            <th class="col-actions" style="text-align: right; padding-right: 15px;" data-i18n="th_actions">${window.i18n.t('th_actions') || 'Actions'}</th>
                        </tr>
                    </thead>
                    <tbody id="allOperationsBody">
                        <!-- Rendered dynamically -->
                    </tbody>
                </table>
                <div id="historyTotalsFooter" class="view-footer" style="position: sticky; bottom: -32px; margin: 0 -32px -32px -32px; background: var(--bg-surface); padding: 12px 32px 32px 32px; border-top: 2px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; box-shadow: 0 -4px 10px rgba(0,0,0,0.1); z-index: 50; font-weight: 500;">
                    <!-- Rendered dynamically -->
                </div>
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
            const saved = ProfileStorage.get('history_cols');
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
            ProfileStorage.set('history_cols', JSON.stringify(settings));
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
        // Actions column — enough room for Duplicate + Edit + Delete buttons
        css += `.timeline-table .col-actions { width: 10%; }\n`;
        
        const styleTag = document.getElementById('historyColsStyle');
        if (styleTag) styleTag.innerHTML = css;
    },

    async loadData() {
        try {
            // PERF: Fetch budgets, accounts, and transactions in parallel
            const [budgets, accs, allTx] = await Promise.all([
                API.get('/api/budgets/').catch(e => { console.error('Failed to load budgets', e); return []; }),
                API.get('/api/accounts/'),
                API.get('/api/transactions/?limit=10000')
            ]);

            // Process budgets map
            this.budgetsMap = {};
            this.categoryToBudgetMap = {};
            budgets.forEach(b => {
                this.budgetsMap[b.id] = b.name;
                if (!b.is_project && b.categories) {
                    b.categories.forEach(cat => { this.categoryToBudgetMap[cat] = b.name; });
                }
            });

            // Process accounts
            this.accounts = {};
            this.accountNames = {};
            accs.forEach(a => { this.accounts[a.id] = a; this.accountNames[a.id] = a.name; });

            // Sort by operation date descending (newest first)
            this.transactions = allTx.sort((a, b) => new Date(b.date_operation) - new Date(a.date_operation));
            
            // Populate account select dropdown
            const accSelect = document.getElementById('historyAccountFilter');
            if (accSelect) {
                const currentAccVal = accSelect.value;
                let accHtml = `<option value="" data-i18n="filter_all_accounts">${window.i18n.t('filter_all_accounts') || 'Tous les comptes'}</option>`;
                accs.forEach(a => {
                    const icon = a.type && (a.type.toLowerCase().includes('livret') || a.type.toLowerCase().includes('epargne') || a.type.toLowerCase().includes('saving')) ? '🏦 ' :
                                (a.type && (a.type.toLowerCase().includes('prêt') || a.type.toLowerCase().includes('pret') || a.type.toLowerCase().includes('emprunt') || a.type.toLowerCase().includes('loan')) ? '📑 ' : '💳 ');
                    accHtml += `<option value="${a.id}">${icon}${a.name}</option>`;
                });
                accSelect.innerHTML = accHtml;
                if (currentAccVal) {
                    accSelect.value = currentAccVal;
                }
            }

            // Populate category multi-select (including uncategorized option if present)
            const hasUncategorized = this.transactions.some(t => !t.category);
            const categories = [...new Set(this.transactions.map(t => t.category).filter(Boolean))].sort();
            const uncatLabel = (window.i18n && window.i18n.t('uncategorized')) || 'Sans catégorie';
            if (hasUncategorized && !categories.includes(uncatLabel)) {
                categories.unshift(uncatLabel);
            }
            const catContainer = document.getElementById('historyCategoryFilter');
            if (catContainer && !catContainer.querySelector('.multi-select-trigger')) {
                window.MultiSelect.create('historyCategoryFilter', {
                    allLabel: window.i18n.t('filter_all_categories'),
                    searchPlaceholder: window.i18n.t('ph_search') || 'Search...',
                    onChange: () => window.AllOperationsView.applyFilters()
                });
            }
            window.MultiSelect.populate('historyCategoryFilter', categories);

            // Populate month select dropdown dynamically grouped by year
            const monthSelect = document.getElementById('historyMonthFilter');
            if (monthSelect) {
                const uniqueMonths = [...new Set(
                    this.transactions
                        .map(tx => tx.date_operation ? tx.date_operation.substring(0, 7) : null)
                        .filter(Boolean)
                )].sort().reverse();
                
                // Group by year
                const grouped = {};
                uniqueMonths.forEach(m => {
                    const year = m.split('-')[0];
                    if (!grouped[year]) {
                        grouped[year] = [];
                    }
                    grouped[year].push(m);
                });
                
                let monthHtml = `<option value="" data-i18n="filter_all_months">${window.i18n.t('filter_all_months') || 'Tous les mois'}</option>`;
                
                // Sort years descending and render grouped options
                const sortedYears = Object.keys(grouped).sort().reverse();
                sortedYears.forEach(year => {
                    monthHtml += `<optgroup label="${year}">`;
                    grouped[year].forEach(m => {
                        const parts = m.split('-');
                        const monthIdx = parseInt(parts[1]) - 1;
                        const dateObj = new Date(year, monthIdx, 1);
                        // Only show month name under the year group header
                        const formattedMonth = dateObj.toLocaleDateString(window.i18n.lang || 'fr', { month: 'long' });
                        monthHtml += `<option value="${m}">${formattedMonth}</option>`;
                    });
                    monthHtml += `</optgroup>`;
                });
                
                const currentVal = monthSelect.value;
                monthSelect.innerHTML = monthHtml;
                if (currentVal && uniqueMonths.includes(currentVal)) {
                    monthSelect.value = currentVal;
                }
            }

            // Apply pending filter from AnalyticsView / OverviewView drilldown
            if (this.pendingFilter) {
                const pf = this.pendingFilter;
                this.pendingFilter = null;
                
                if (pf.backToView) {
                    this.isDrillDown = true;
                    this.backToView = pf.backToView;
                } else {
                    this.isDrillDown = false;
                    this.backToView = null;
                }

                // Set category filter
                if (pf.category) {
                    window.MultiSelect.setSelected('historyCategoryFilter', [pf.category]);
                }
                // Set month filter
                if (pf.monthKey) {
                    const monthInput = document.getElementById('historyMonthFilter');
                    if (monthInput) monthInput.value = pf.monthKey;
                }
                // Set type filter
                if (pf.type) {
                    const typeInput = document.getElementById('historyTypeFilter');
                    if (typeInput) typeInput.value = pf.type;
                }
                // Set account filter
                if (pf.accountId) {
                    const accInput = document.getElementById('historyAccountFilter');
                    if (accInput) accInput.value = pf.accountId.toString();
                }
                // Set year in search
                if (pf.year) {
                    const searchInput = document.getElementById('historySearch');
                    if (searchInput) searchInput.value = pf.year;
                }
            } else {
                this.isDrillDown = false;
                this.backToView = null;
            }

            const backBtn = document.getElementById('btnHistoryBackToAnalytics');
            if (backBtn) {
                backBtn.style.display = this.isDrillDown ? 'flex' : 'none';
            }

            this.renderTable();
            this.updateMonthNavButtons();

            // Check if we need to highlight a specific transaction (e.g. overdraft locate)
            if (this._pendingHighlightTxId) {
                const txId = this._pendingHighlightTxId;
                const cssClass = this._pendingHighlightCssClass || 'highlight-flash';
                this._pendingHighlightTxId = null;
                this._pendingHighlightCssClass = null;
                // Small delay to let VirtualTable finish initial render
                setTimeout(() => this.scrollToAndHighlight(txId, cssClass), 250);
            }
        } catch (e) {
            console.error("Failed to load operations", e);
        }
    },
    
    applyFilters() {
        this.renderTable(false); // false means don't auto-scroll
    },

    navigateMonthFilter(direction) {
        const select = document.getElementById('historyMonthFilter');
        if (!select) return;
        
        if (!select.value) return;
        
        const newIndex = select.selectedIndex - direction;
        
        if (newIndex >= 1 && newIndex < select.options.length) {
            select.selectedIndex = newIndex;
            this.applyFilters();
            this.updateMonthNavButtons();
        }
    },

    updateMonthNavButtons() {
        const select = document.getElementById('historyMonthFilter');
        const prevBtn = document.getElementById('historyMonthPrevBtn');
        const nextBtn = document.getElementById('historyMonthNextBtn');
        if (!select || !prevBtn || !nextBtn) return;
        
        const val = select.value;
        if (!val) {
            prevBtn.style.display = 'none';
            nextBtn.style.display = 'none';
            return;
        }
        
        const idx = select.selectedIndex;
        // ◀ (previous month / older) is shown if we can go older (index can increase)
        const showPrev = idx < select.options.length - 1;
        // ▶ (next month / newer) is shown if we can go newer (index can decrease)
        const showNext = idx > 1;
        
        prevBtn.style.display = showPrev ? 'inline-block' : 'none';
        nextBtn.style.display = showNext ? 'inline-block' : 'none';
    },

    renderTable(autoScroll = true) {
        const tbody = document.getElementById('allOperationsBody');
        if (!tbody) return;
        
        // Read filters
        const searchInput = document.getElementById('historySearch');
        const typeFilter = document.getElementById('historyTypeFilter');
        const accFilter = document.getElementById('historyAccountFilter');
        
        const q = searchInput ? window.cleanStringForSearch(searchInput.value) : '';
        const tType = typeFilter ? typeFilter.value : '';
        const tAcc = accFilter ? accFilter.value : '';
        const selectedCats = window.MultiSelect.getSelected('historyCategoryFilter');

        // Month filter (YYYY-MM)
        const monthInput = document.getElementById('historyMonthFilter');
        const tMonth = monthInput ? monthInput.value : '';
        
        const attachFilter = document.getElementById('historyAttachmentFilter');
        const tAttach = attachFilter ? attachFilter.checked : false;
        
        const unrecFilter = document.getElementById('historyUnreconciledFilter');
        const unrecChecked = unrecFilter ? unrecFilter.checked : false;

        // Rendu du bloc d'opérations fantômes bancaires en attente
        if (window.BankSyncView && typeof window.BankSyncView.renderGhostBox === 'function') {
            const ghostContainer = document.getElementById('allOpsGhostBox');
            if (ghostContainer) {
                window.BankSyncView.renderGhostBox(ghostContainer, tAcc || null);
            }
        }

        // Apply filters
        let filtered = this.transactions;

        if (q) {
            filtered = filtered.filter(tx => 
                window.cleanStringForSearch(tx.description || '').includes(q) ||
                window.cleanStringForSearch(tx.category || '').includes(q) ||
                (tx.amount || '').toString().includes(q) ||
                window.cleanStringForSearch(this.accountNames[tx.from_account_id] || '').includes(q) ||
                window.cleanStringForSearch(this.accountNames[tx.to_account_id] || '').includes(q) ||
                (tx.date_operation || '').includes(q)
            );
        }
        if (tType) {
            filtered = filtered.filter(tx => tx.type === tType);
        }
        if (tAcc) {
            const accId = parseInt(tAcc);
            filtered = filtered.filter(tx => tx.from_account_id === accId || tx.to_account_id === accId);
        }
        if (selectedCats.length > 0) {
            const uncatLabel = (window.i18n && window.i18n.t('uncategorized')) || 'Sans catégorie';
            filtered = filtered.filter(tx => {
                const cat = tx.category || uncatLabel;
                return selectedCats.includes(cat) || (!tx.category && (selectedCats.includes('Sans catégorie') || selectedCats.includes('Uncategorized')));
            });
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

        let sumIncome = 0;
        let sumExpense = 0;
        filtered.forEach(tx => {
            if (tx.type === 'income') sumIncome += tx.amount || 0;
            else if (tx.type && tx.type.startsWith('expense_')) sumExpense += tx.amount || 0;
        });

        const footer = document.getElementById('historyTotalsFooter');
        if (footer) {
            const net = sumIncome - sumExpense;
            const netColor = net > 0 ? 'var(--color-income)' : (net < 0 ? 'var(--color-expense)' : 'inherit');
            footer.innerHTML = `
                <div class="history-totals-grid" style="display:flex; gap: 16px; flex-wrap: wrap; width: 100%; align-items: center;">
                    <div style="flex:1; min-width: 70px;"><span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;white-space:nowrap;">${window.i18n.t('allops_label_operations') || 'Opérations'}</span> <br/> <strong style="font-size:14px;">${filtered.length}</strong></div>
                    <div style="flex:1; min-width: 100px;"><span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;white-space:nowrap;">${window.i18n.t('allops_label_expenses') || 'Dépenses'}</span> <br/> <strong style="font-size:14px; color:var(--color-expense);white-space:nowrap;">${formatCurrency(sumExpense)}</strong></div>
                    <div style="flex:1; min-width: 100px;"><span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;white-space:nowrap;">${window.i18n.t('type_income') || 'Recettes'}</span> <br/> <strong style="font-size:14px; color:var(--color-income);white-space:nowrap;">${formatCurrency(sumIncome)}</strong></div>
                    <div style="flex:1; min-width: 100px; text-align:right;" class="total-affiche-box"><span style="color:var(--text-muted);font-size:11px;text-transform:uppercase;white-space:nowrap;">${window.i18n.t('allops_label_total_shown') || 'Total Affiché'}</span> <br/> <strong style="font-size:15px; color:${netColor};white-space:nowrap;">${formatCurrency(net)}</strong></div>
                </div>
            `;
        }

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
            if (tx.is_skipped) {
                rowClass += ' skipped-row';
            }
            
            // Highlight non-recurrent operations
            const isRecurrent = tx.recurrence_id || tx.is_monthly || tx.is_yearly;
            if (!isRecurrent) {
                rowClass += ' non-recurrent-row';
            } else {
                rowClass += ' recurrent-row';
            }

            const fromAcc = this.accounts[tx.from_account_id];
            const toAcc = this.accounts[tx.to_account_id];
            const depuisTitle = fromAcc ? fromAcc.name : (tx.cross_profile_label || '');
            const versTitle = toAcc ? toAcc.name : (tx.cross_profile_label || '');
            
            let depuisBadge = fromAcc ? `<span class="account-badge" style="background:${fromAcc.color || '#3366ff'}20;color:${fromAcc.color || '#3366ff'};border-color:${fromAcc.color || '#3366ff'}40;">${fromAcc.name}</span>` : '-';
            let versBadge = toAcc ? `<span class="account-badge" style="background:${toAcc.color || '#3366ff'}20;color:${toAcc.color || '#3366ff'};border-color:${toAcc.color || '#3366ff'}40;">${toAcc.name}</span>` : '-';

            if (tx.cross_profile_label) {
                const cpBadge = `<span class="account-badge" style="background:rgba(99,102,241,0.15);color:#818cf8;border-color:rgba(99,102,241,0.3);" title="${tx.cross_profile_label}">${tx.cross_profile_label}</span>`;
                if (!fromAcc) depuisBadge = cpBadge;
                if (!toAcc) versBadge = cpBadge;
            }

            let statusSubtext = '';
            if (tx.cross_profile_status === 'pending') {
                statusSubtext = `<div style="font-size:10px; font-weight:700; color:#f59e0b; background:rgba(245,158,11,0.12); padding:2px 5px; border-radius:4px; margin-top:2px; display:inline-block;">⏳ En attente</div>`;
            } else if (tx.cross_profile_status === 'rejected') {
                statusSubtext = `<div style="font-size:10px; font-weight:700; color:#ef4444; background:rgba(239,68,68,0.12); padding:2px 5px; border-radius:4px; margin-top:2px; display:inline-block;">❌ Refusé</div>`;
            }

            let recText = '-';
            if (tx.is_monthly) recText = window.i18n.t('rec_monthly');
            if (tx.is_yearly) recText = window.i18n.t('rec_yearly');
            if (tx.is_bimonthly) recText = window.i18n.t('rec_bimonthly');
            const origSubtext = (tx.original_amount && tx.original_currency) ? `<div style="font-size: 10px; font-weight: 500; opacity: 0.8; color: var(--accent); white-space: nowrap;">🌐 ${formatCurrency(tx.original_amount, tx.original_currency)}</div>` : '';

            return `
            <tr data-id="${tx.id}" class="${rowClass}" ${idAttr}>
                <td class="row-marker"></td>
                <td class="col-dateSaisie" data-label="${window.i18n.t('dl_date_entry')}">${formatDate(tx.date_saisie)}</td>
                <td class="col-date" data-label="${window.i18n.t('dl_date_op')}">${renderDateWithStatus(tx)}</td>
                <td class="col-desc" data-label="${window.i18n.t('dl_description')}" title="${(tx.description || '').replace(/"/g, '&quot;')}"><span class="desc-text">${tx.description}</span>${statusSubtext}</td>
                <td class="col-type" data-label="${window.i18n.t('dl_type')}" title="${window.app.getTypeLabel(tx.type)}">${window.app.getTypeLabel(tx.type)}</td>
                <td class="col-cat" data-label="${window.i18n.t('dl_category')}" title="${(tx.category || '').replace(/"/g, '&quot;')}"><span style="background: var(--bg-base); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${tx.category || '-'}</span></td>
                <td class="col-amount" data-label="${window.i18n.t('dl_amount')}">
                    <span class="privacy-blur" style="color: ${amountColor}; font-weight: bold;">${formatCurrency(tx.amount)}</span>
                    ${origSubtext}
                </td>
                <td class="col-recon" data-label="${window.i18n.t('dl_reconciled')}" style="text-align: center;">${tx.is_skipped ? `<span style="font-size:11px; font-weight: 600; color: #64748b; background: rgba(100, 116, 139, 0.1); padding: 3px 8px; border-radius: 6px; border: 1px solid rgba(100, 116, 139, 0.2); white-space: nowrap;">${window.i18n.t('rec_status_skipped') || '⏭️ Ignorée'}</span>` : (isReconciled ? formatDate(tx.reconciliation_date) || '-' : ((window.BankSyncView && window.BankSyncView.pendingMatches && window.BankSyncView.pendingMatches[tx.id]) ? `<span style="cursor:pointer; font-size:11px; font-weight:700; color:white; background:linear-gradient(135deg, #10b981, #059669); padding:3px 8px; border-radius:6px; box-shadow:0 2px 6px rgba(16,185,129,0.3); display:inline-flex; align-items:center; gap:4px;" onclick="window.BankSyncView.reconcileFast(${tx.id})" title="Opération trouvée sur votre relevé bancaire. Cliquez pour pointer en 1 clic !">⚡ <span>${window.i18n.t('bank_badge_found_online') || 'Trouvé'}</span></span>` : '-'))}</td>
                <td class="col-budget" data-label="${window.i18n.t('dl_envelope')}">${(() => { const bName = (tx.budget_id && this.budgetsMap[tx.budget_id]) ? this.budgetsMap[tx.budget_id] : (tx.category && this.categoryToBudgetMap && this.categoryToBudgetMap[tx.category]) ? this.categoryToBudgetMap[tx.category] : null; return bName ? `<span onclick="window.BudgetsView._pendingHighlightName='${bName.replace(/'/g, "\\'")}';window.app.loadView('budgets')" style="background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;cursor:pointer;" title="${bName}">🗂️ ${bName}</span>` : '<span style="color:var(--text-muted);font-size:11px;">—</span>'; })()}</td>
                <td class="col-depuis" data-label="${window.i18n.t('dl_from')}" title="${depuisTitle}">${depuisBadge}</td>
                <td class="col-vers" data-label="${window.i18n.t('dl_to')}" title="${versTitle}">${versBadge}</td>
                <td class="col-recurrence" data-label="${window.i18n.t('dl_recurrence')}" title="${recText}">${recText}</td>

                <td class="col-slip" data-label="${window.i18n.t('dl_slip')}">${tx.slip_number ? '<span style="background: rgba(255,152,0,0.15); color: #ff9800; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">' + tx.slip_number + '</span>' : '-'}</td>
                <td class="col-attachments" data-label="${window.i18n.t('dl_attachments')}">${tx.attachments ? `<span style="cursor:pointer;" title="${tx.attachments}" onclick="window.AllOperationsView._openAttachment('${tx.attachments.replace(/'/g, "\\'")}')">📎</span>` : '-'}</td>
                <td class="col-createdBy" data-label="${window.i18n.t('dl_created_by')}">${tx.created_by ? `${tx.created_by}${tx.created_at ? `<br><span style="font-size:10px;color:var(--text-muted);">${tx.created_at}</span>` : ''}` : '-'}</td>
                <td class="col-modifiedBy" data-label="${window.i18n.t('dl_modified_by')}">${tx.modified_by ? `${tx.modified_by}${tx.modified_at ? `<br><span style="font-size:10px;color:var(--text-muted);">${tx.modified_at}</span>` : ''}` : '-'}</td>
                <td class="col-actions mobile-card-actions">
                    <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end;">
                        ${(() => {
                            if (tx.recurrence_id) {
                                if (tx.is_skipped) {
                                    return `<button class="btn btn-secondary" style="padding: 4px 6px; font-size: 11px; display: flex; align-items: center;" onclick="window.AllOperationsView.toggleSkip(${tx.id})" title="${window.i18n.t('tooltip_unskip') || 'Rétablir'}">↩️</button>`;
                                } else if (!isReconciled) {
                                    return `<button class="btn btn-secondary" style="padding: 4px 6px; font-size: 11px; display: flex; align-items: center;" onclick="window.AllOperationsView.toggleSkip(${tx.id})" title="${window.i18n.t('tooltip_skip') || 'Ignorer'}">⏭️</button>`;
                                }
                            }
                            return '';
                        })()}
                        <button class="btn btn-secondary" style="padding: 4px 6px; font-size: 11px; display: flex; align-items: center;" onclick="window.AllOperationsView.duplicate(${tx.id})" title="${window.i18n.t('tooltip_duplicate') || 'Dupliquer'}">📋</button>
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

    duplicate(id) {
        const tx = this.transactions.find(t => t.id === id);
        if (tx && window.FormView) {
            window.FormView.openDuplicate(tx);
        }
    },

    async toggleSkip(id) {
        try {
            const res = await API.post(`/api/transactions/${id}/toggle_skip`);
            await Promise.all([window.app.refreshSidebar(), this.loadData()]);
            showUndoToast(window.i18n.t('toast_tx_updated') || "Opération modifiée", res.action_id, () => this.loadData());
        } catch (e) {
            console.error(e);
            showToast("Erreur lors de la modification", "error");
        }
    },

    async delete(id) {
        if (await showInlineConfirm(window.i18n.t('title_confirmation'), window.i18n.t('confirm_delete_operation'))) {
            try {
                const res = await API.del(`/api/transactions/${id}`);
                // PERF: Refresh sidebar and reload data in parallel
                await Promise.all([window.app.refreshSidebar(), this.loadData()]);
                showUndoToast(window.i18n.t('toast_tx_deleted') || "Opération supprimée", res.action_id, () => this.loadData());
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
    scrollToAndHighlight(txId, cssClass) {
        cssClass = cssClass || 'highlight-flash';
        const tbody = document.getElementById('allOperationsBody');
        if (!tbody) return;

        // Pick color based on highlight type
        const highlightColor = cssClass === 'overdraft-flash'
            ? 'rgba(255, 86, 48, 0.35)'
            : 'rgba(99, 102, 241, 0.35)';

        let vtIdx = -1;
        let originalRowHtml = null;

        // If using VirtualTable desktop mode, inject inline style into raw HTML
        // so it survives scroll-triggered re-renders
        if (this._vt && this._vt._rows && this._vt._rows.length && !this._vt._isMobile()) {
            const needle = `data-id="${txId}"`;
            vtIdx = this._vt._rows.findIndex(r => r.includes(needle));
            if (vtIdx >= 0) {
                originalRowHtml = this._vt._rows[vtIdx];
                this._vt._rows[vtIdx] = originalRowHtml.replace(
                    /(<tr\s)/,
                    `$1style="background-color: ${highlightColor} !important;" `
                );
                this._vt._scrollToIndex(vtIdx);
            }
        }

        // Wait for DOM to settle after potential scroll/render
        requestAnimationFrame(() => {
            const row = tbody.querySelector(`tr[data-id="${txId}"]`);
            if (!row) { console.log('[Highlight] Row not found in DOM for tx', txId); return; }

            row.scrollIntoView({ behavior: 'smooth', block: 'center' });

            // Apply highlight via inline styles (beats any CSS specificity)
            row.style.setProperty('background-color', highlightColor, 'important');
            row.querySelectorAll('td').forEach(td => {
                td.style.setProperty('background-color', highlightColor, 'important');
            });

            // Fade out after 2 seconds
            setTimeout(() => {
                row.style.transition = 'background-color 1s ease-out';
                row.style.setProperty('background-color', 'transparent', 'important');
                row.querySelectorAll('td').forEach(td => {
                    td.style.transition = 'background-color 1s ease-out';
                    td.style.setProperty('background-color', 'transparent', 'important');
                });

                // Clean up inline styles after fade
                setTimeout(() => {
                    row.style.removeProperty('background-color');
                    row.style.removeProperty('transition');
                    row.querySelectorAll('td').forEach(td => {
                        td.style.removeProperty('background-color');
                        td.style.removeProperty('transition');
                    });
                    // Restore original VT HTML
                    if (vtIdx >= 0 && originalRowHtml && this._vt && this._vt._rows) {
                        this._vt._rows[vtIdx] = originalRowHtml;
                    }
                }, 1100);
            }, 2000);
        });
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
