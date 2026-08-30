window.TimelineView = {
    transactions: [],
    _vt: null,
    currentPeriodIndex: parseInt(ProfileStorage.get('timeline_period_index')) || 0,
    
    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const attachDisp = cfg.enable_attachments === 'true' ? '' : 'display: none !important;';
        const slipDisp = cfg.enable_check_slips === 'true' ? '' : 'display: none !important;';
        const isOrgMode = cfg.enable_org_mode === 'true' || cfg.enable_org_mode === true;
        const unreconciledDisp = isOrgMode ? 'display: none !important;' : '';
        const orgDisp = isOrgMode ? '' : 'display: none !important;';

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
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; ${orgDisp}"><input type="checkbox" id="chk_col_createdBy" onchange="window.TimelineView.toggleCol('createdBy')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_created_by')}</label>
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; font-weight:500; ${orgDisp}"><input type="checkbox" id="chk_col_modifiedBy" onchange="window.TimelineView.toggleCol('modifiedBy')" style="accent-color: var(--accent); width: 16px; height: 16px;"> ${window.i18n.t('col_modified_by')}</label>
                    </div>
                    <div style="text-align: center;">
                        <button class="btn btn-primary" style="width: 100%; padding: 10px; font-size: 14px;" onclick="document.getElementById('timelineColsModal').style.display='none'" data-i18n="btn_close">${window.i18n.t('btn_close')}</button>
                    </div>
                </div>
            </div>
            <div id="timelineHeader" class="view-header-sticky-container">
                <div class="view-header-bar" style="position:static; margin:0; padding:0 0 10px 0;">
                    <div class="view-header-title-group">
                        <h2 class="view-header-title">🏠 <span data-i18n="nav_timeline">${window.i18n.t('nav_timeline')}</span></h2>
                    </div>
                    <div class="view-header-toolbar">
                        <button class="btn btn-secondary toolbar-btn" onclick="document.getElementById('timelineColsModal').style.display='flex'" data-i18n="btn_columns">${window.i18n.t('btn_columns')}</button>
                        <button id="btnImportStatement" class="btn btn-secondary toolbar-btn" onclick="window.ImportWizard.open()" data-i18n="btn_import_statement">${window.i18n.t('btn_import_statement') || '📥 Importer un relevé'}</button>
                        <button id="btnTimelineBgSync" class="btn btn-secondary toolbar-btn overview-bank-sync-btn" onclick="window.BankSyncView ? window.BankSyncView.triggerBackgroundSyncNow() : window.app.loadView('accounts')" data-i18n-title="bank_sync_run_background_tooltip" title="${window.i18n.t('bank_sync_run_background_tooltip') || 'Interroge vos banques connectées en tâche de fond pour récupérer les dernières opérations, détecter les correspondances à rapprocher et actualiser vos soldes sans bloquer l\'interface.'}">
                            <span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne'}</span>
                        </button>
                        <button class="btn btn-primary toolbar-btn" onclick="window.TimelineView.showAddRow()" data-i18n="btn_add_operation">${window.i18n.t('btn_add_operation')}</button>
                    </div>
                </div>

                <!-- Dedicated Structured Filter Bar -->
                <div class="view-filter-bar" style="margin-bottom: 0;">
                    <div class="view-filter-group">
                        <input type="text" id="timelineSearch" class="inline-input" data-i18n-placeholder="ph_search" placeholder="🔍 Rechercher..." style="min-width:140px; max-width:200px; height:36px; font-size:12.5px; padding: 0 10px; border-radius:10px;" oninput="window.TimelineView.applyFilters()">
                        
                        <div class="filter-pill">
                            <span class="filter-pill-label">📅 <span data-i18n="budget_label_period">${window.i18n.t('budget_label_period')}</span></span>
                            <select id="timelineReconciledPeriod" class="filter-pill-select" style="min-width:120px;" onchange="window.TimelineView.savePeriod(); window.TimelineView.applyFilters()">
                                <option value="current" data-i18n="filter_period_current">${window.i18n.t('filter_period_current')}</option>
                                <option value="plus_5" data-i18n="filter_period_plus_5">${window.i18n.t('filter_period_plus_5')}</option>
                                <option value="plus_15" data-i18n="filter_period_plus_15">${window.i18n.t('filter_period_plus_15')}</option>
                                <option value="plus_30" data-i18n="filter_period_plus_30">${window.i18n.t('filter_period_plus_30')}</option>
                                <option value="all" data-i18n="filter_period_all">${window.i18n.t('filter_period_all')}</option>
                            </select>
                        </div>
                        
                        <div id="timelineDateRange" style="display:none; align-items:center; gap: 4px;">
                            <input type="date" id="timelineStartDate" class="inline-input" onchange="window.TimelineView.savePeriod(); window.TimelineView.applyFilters()" style="min-width: 110px; height:36px; font-size:12px; padding: 2px 6px; border-radius:10px;">
                            <span style="color:var(--text-muted); font-size:11px; font-weight: 500;">${window.i18n.t('filter_range_to')}</span>
                            <input type="date" id="timelineEndDate" class="inline-input" onchange="window.TimelineView.savePeriod(); window.TimelineView.applyFilters()" style="min-width: 110px; height:36px; font-size:12px; padding: 2px 6px; border-radius:10px;">
                        </div>

                        <div class="filter-pill">
                            <span class="filter-pill-label">🏷️ <span data-i18n="col_type">${window.i18n.t('col_type')}</span></span>
                            <select id="timelineTypeFilter" class="filter-pill-select" style="min-width:100px;" onchange="window.TimelineView.applyFilters()">
                                <option value="" data-i18n="filter_all_types">${window.i18n.t('filter_all_types')}</option>
                                <option value="expense_fixed" data-i18n="type_expense_fixed">${window.i18n.t('type_expense_fixed')}</option>
                                <option value="expense_var" data-i18n="type_expense_var">${window.i18n.t('type_expense_var')}</option>
                                <option value="income" data-i18n="type_income">${window.i18n.t('type_income')}</option>
                                <option value="transfer" data-i18n="type_transfer">${window.i18n.t('type_transfer')}</option>
                            </select>
                        </div>

                        <div id="timelineCategoryFilter" style="min-width:130px; max-width:180px;"></div>
                        <button class="btn btn-secondary" style="padding:0 8px; font-size:13px; border-radius:8px; height:36px; line-height:36px; min-height:36px;" onclick="window.MultiSelect.reset('timelineCategoryFilter')" title="${window.i18n.t('filter_reset_categories') || 'Reset categories'}">&#x21BA;</button>
                    </div>

                    <div class="view-filter-toggles">
                        <div class="filter-pill" style="${unreconciledDisp}">
                            <label class="filter-pill-toggle">
                                <span data-i18n="filter_unreconciled_before_pay">${window.i18n.t('filter_unreconciled_before_pay')}</span>
                                <span class="toggle-switch" data-i18n-title="tooltip_filter_unreconciled" title="Filtre les dépenses non-rapprochées prévues avant la prochaine paie">
                                    <input type="checkbox" id="timelineUnreconciledFilter" onchange="window.TimelineView.applyFilters()">
                                    <span class="slider"></span>
                                </span>
                            </label>
                        </div>
                        <div class="filter-pill" style="${attachDisp}">
                            <label class="filter-pill-toggle">
                                <span data-i18n="filter_attachments">📎 ${window.i18n.t('filter_attachments')}</span>
                                <span class="toggle-switch" data-i18n-title="tooltip_filter_attachments" title="Uniquement avec pièces jointes">
                                    <input type="checkbox" id="timelineAttachmentFilter" onchange="window.TimelineView.applyFilters()">
                                    <span class="slider"></span>
                                </span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
            <div class="timeline-table-container" style="padding-bottom: 20px;">
                <div id="timelineGhostBox"></div>


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
                    <tbody id="timelineBody">
                        <!-- Rendered dynamically -->
                    </tbody>
                </table>
            </div>
            <div id="timelinePaycheckWidget" style="display: none;"></div>
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
            
            const savedStart = ProfileStorage.get('timeline_start_date');
            const savedEnd = ProfileStorage.get('timeline_end_date');
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
            
            const savedPeriod = ProfileStorage.get('timeline_period_filter');
            if (periodSelect) {
                periodSelect.value = savedPeriod || 'current';
            }
        }

        await this.loadData();
    },

    renderPaycheckWidget(stats) {
        const container = document.getElementById('timelinePaycheckWidget');
        if (!container) return;

        const cfg = window.app && window.app.config ? window.app.config : {};
        const isOrgMode = cfg.enable_org_mode === 'true' || cfg.enable_org_mode === true;
        if (isOrgMode || !stats.next_pay_date) {
            container.innerHTML = '';
            container.style.display = 'none';
            return;
        }

        container.style.display = 'block';
        
        if (this.currentPeriodIndex > 0 && (!window.app.payHistory || this.currentPeriodIndex - 1 >= window.app.payHistory.length)) {
            this.currentPeriodIndex = 0;
            ProfileStorage.set('timeline_period_index', 0);
        }

        const isHistory = this.currentPeriodIndex > 0;
        let isManualSkip = false;
        let payDateStr = '';
        let payAmount = 0;
        let periodStartStr = '';

        if (isHistory) {
            const hIndex = this.currentPeriodIndex - 1;
            const historyItem = window.app.payHistory[hIndex];
            
            payDateStr = formatDate(historyItem.date);
            payAmount = historyItem.amount;
            
            if (historyItem.validated_pay_date) {
                const d = new Date(historyItem.validated_pay_date);
                d.setDate(d.getDate() + 1);
                periodStartStr = formatDate(d.toISOString().split('T')[0]);
            } else if (historyItem.logical_period) {
                const parts = historyItem.logical_period.split('-');
                const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
                periodStartStr = formatDate(d.toISOString().split('T')[0]);
            }
        } else {
            isManualSkip = window.app.isPayValidated || (stats && stats.is_pay_validated);
            payDateStr = formatDate(window.app.nextPayDate);
            payAmount = window.app.nextPayAmount;
            
            if (window.app.validatedPayDate) {
                const d = new Date(window.app.validatedPayDate);
                d.setDate(d.getDate() + 1);
                periodStartStr = formatDate(d.toISOString().split('T')[0]);
            } else if (stats && stats.logical_period) {
                const parts = stats.logical_period.split('-');
                const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
                periodStartStr = formatDate(d.toISOString().split('T')[0]);
            }
        }

        let statusTitle = '';
        let statusClass = '';
        let actionBtnHtml = '';
        let statusDesc = '';

        if (isHistory) {
            statusTitle = window.i18n.t('paycheck_widget_status_history') || 'Historical Period';
            statusClass = 'background: rgba(107, 114, 128, 0.12); border: 1px solid rgba(107, 114, 128, 0.3); color: #9ca3af;';
            statusDesc = window.i18n.tp('paycheck_widget_history_desc', { date: payDateStr, amount: formatCurrency(payAmount), period_start: periodStartStr });
            
            const disabledTitle = window.i18n.t('tooltip_historical_disabled') || 'Action not available for past periods';
            actionBtnHtml = `
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="btn btn-primary" style="padding: 5px 14px; font-weight: 700; font-size: 12px; border-radius: 8px; background: linear-gradient(135deg, #6c5ce7, #a29bfe); border: none; box-shadow: 0 4px 10px rgba(108, 92, 231, 0.2); white-space: nowrap; opacity: 0.5; cursor: not-allowed;" title="${disabledTitle}"><span style="margin-right:4px;">⏩</span>${window.i18n.t('paycheck_widget_btn_force')}</button>
                </div>
            `;
        } else if (isManualSkip) {
            statusTitle = window.i18n.t('paycheck_widget_status_skipped');
            statusClass = 'background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); color: #10b981;';
            statusDesc = window.i18n.tp('paycheck_widget_skipped_desc', { date: payDateStr, amount: formatCurrency(payAmount), period_start: periodStartStr });
            actionBtnHtml = `<button class="btn btn-secondary" style="padding: 5px 12px; font-weight: 600; font-size: 12px; border-color: rgba(245, 158, 11, 0.4); color: #f59e0b; background: transparent; border-radius: 8px; white-space: nowrap;" onclick="window.app.skipPayPeriod()"><span style="margin-right:4px;">⏪</span>${window.i18n.t('paycheck_widget_btn_cancel')}</button>`;
        } else {
            statusTitle = window.i18n.t('paycheck_widget_status_active');
            statusClass = 'background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.3); color: var(--accent);';
            statusDesc = window.i18n.tp('paycheck_widget_active_desc', { date: payDateStr, amount: formatCurrency(payAmount), period_start: periodStartStr });
            actionBtnHtml = `
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="btn btn-primary" style="padding: 5px 14px; font-weight: 700; font-size: 12px; border-radius: 8px; background: linear-gradient(135deg, #6c5ce7, #a29bfe); border: none; box-shadow: 0 4px 10px rgba(108, 92, 231, 0.2); white-space: nowrap;" onclick="window.app.skipPayPeriod()"><span style="margin-right:4px;">⏩</span>${window.i18n.t('paycheck_widget_btn_force')}</button>
                </div>
            `;
        }

        const hasPrev = window.app.payHistory && this.currentPeriodIndex < window.app.payHistory.length;
        const hasNext = this.currentPeriodIndex > 0;
        
        const prevDisabled = !hasPrev ? 'opacity: 0.3; cursor: not-allowed;' : 'cursor: pointer;';
        const nextDisabled = !hasNext ? 'opacity: 0.3; cursor: not-allowed;' : 'cursor: pointer;';
        
        const navArrowsHtml = `
            <div style="display: flex; gap: 4px; align-items: center; background: rgba(0,0,0,0.1); padding: 4px; border-radius: 8px; margin-right: 8px;">
                <button class="btn btn-sm" style="padding: 2px 8px; border: none; background: transparent; color: var(--text-main); ${prevDisabled}" onclick="if(${hasPrev}) window.TimelineView.navigatePeriod('prev')" title="${window.i18n.t('tooltip_prev_period')}">◀</button>
                <button class="btn btn-sm" style="padding: 2px 8px; border: none; background: transparent; color: var(--text-main); font-size: 11px; font-weight: 600;" onclick="window.TimelineView.navigatePeriod('current')" title="${window.i18n.t('btn_current_period')}">📅</button>
                <button class="btn btn-sm" style="padding: 2px 8px; border: none; background: transparent; color: var(--text-main); ${nextDisabled}" onclick="if(${hasNext}) window.TimelineView.navigatePeriod('next')" title="${window.i18n.t('tooltip_next_period')}">▶</button>
            </div>
        `;

        container.style.position = 'sticky';
        container.style.bottom = '15px';
        container.style.zIndex = '100';
        container.style.width = '100%';
        container.style.boxSizing = 'border-box';
        container.style.marginTop = '15px';

        container.innerHTML = `
            <div style="${statusClass} padding: 8px 16px; border-radius: 12px; display: flex; justify-content: space-between; align-items: center; gap: 16px; box-shadow: 0 8px 24px rgba(0,0,0,0.12); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); transition: all 0.3s ease; flex-wrap: wrap;">
                <div style="display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0;">
                    <div style="font-size: 20px; background: rgba(255,255,255,0.08); width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 8px; flex-shrink: 0; box-shadow: inset 0 0 6px rgba(0,0,0,0.05);">📅</div>
                    <div style="display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; flex: 1;">
                        <span style="font-size: 11px; text-transform: uppercase; font-weight: 800; letter-spacing: 0.5px; opacity: 0.85; white-space: nowrap;">${statusTitle}</span>
                        <span id="paycheckWidgetDesc" style="font-size: 13px; color: var(--text-main); font-weight: 500; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; flex: 1; min-width: 100px;">${statusDesc}</span>
                    </div>
                </div>
                <div style="flex-shrink: 0; display: flex; align-items: center;">
                    ${navArrowsHtml}
                    ${actionBtnHtml}
                </div>
            </div>
        `;
    },

    savePeriod() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const isOrgMode = cfg.enable_org_mode === 'true' || cfg.enable_org_mode === true;
        
        if (isOrgMode) {
            const startInput = document.getElementById('timelineStartDate');
            const endInput = document.getElementById('timelineEndDate');
            if (startInput) ProfileStorage.set('timeline_start_date', startInput.value);
            if (endInput) ProfileStorage.set('timeline_end_date', endInput.value);
        } else {
            const select = document.getElementById('timelineReconciledPeriod');
            if (select) ProfileStorage.set('timeline_period_filter', select.value);
        }
        ProfileStorage.set('timeline_period_index', this.currentPeriodIndex);
    },

    navigatePeriod(direction) {
        if (direction === 'current') {
            this.currentPeriodIndex = 0;
        } else if (direction === 'prev') {
            if (window.app.payHistory && this.currentPeriodIndex < window.app.payHistory.length) {
                this.currentPeriodIndex++;
            }
        } else if (direction === 'next') {
            if (this.currentPeriodIndex > 0) {
                this.currentPeriodIndex--;
            }
        }
        this.savePeriod();
        this.renderPaycheckWidget({
            next_pay_date: window.app.nextPayDate,
            next_pay_amount: window.app.nextPayAmount,
            is_pay_validated: window.app.isPayValidated
        });
        this.applyFilters();
    },

    getColSettings() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const showAttachments = cfg.enable_attachments === 'true';
        const showSlips = cfg.enable_check_slips === 'true';
        const def = { dateSaisie: false, date: true, desc: true, type: false, cat: true, amount: true, recon: true, budget: false, depuis: false, vers: false, recurrence: false, slip: showSlips, attachments: showAttachments, createdBy: false, modifiedBy: false };
        try {
            const saved = ProfileStorage.get('timeline_cols');
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
            ProfileStorage.set('timeline_cols', JSON.stringify(settings));
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
                const pct = ((colWeights[k] || 1) / totalWeight * 82).toFixed(1);
                css += `.timeline-table .col-${k} { width: ${pct}%; }\n`;
            }
        });
        // Actions column — enough room for Duplicate + Edit + Delete buttons without overflow
        css += `.timeline-table .col-actions { width: 18%; min-width: 130px; }\n`;
        
        const styleTag = document.getElementById('timelineColsStyle');
        if (styleTag) styleTag.innerHTML = css;
    },

    async loadData() {
        try {
            // PERF: Fetch transactions, budgets, dashboard stats, and pending bank sync in parallel
            const [allTransactions, budgets, stats] = await Promise.all([
                API.get('/api/transactions/?limit=10000'),
                API.get('/api/budgets/').catch(e => { console.error('Failed to load budgets', e); return []; }),
                API.get('/api/stats/dashboard').catch(e => { console.error('Failed to load paycheck stats', e); return null; }),
                (window.BankSyncView && typeof window.BankSyncView.loadPendingSync === 'function') 
                    ? window.BankSyncView.loadPendingSync().catch(e => { console.warn('Failed to load pending bank sync', e); return null; })
                    : Promise.resolve(null)
            ]);
            
            // Keep all transactions, filtering will be done in renderTable
            this.transactions = allTransactions;

            // Populate category multi-select
            const categories = [...new Set(this.transactions.map(t => t.category).filter(Boolean))].sort();
            const catContainer = document.getElementById('timelineCategoryFilter');
            if (catContainer && !catContainer.querySelector('.multi-select-trigger')) {
                window.MultiSelect.create('timelineCategoryFilter', {
                    allLabel: window.i18n.t('filter_all_categories'),
                    searchPlaceholder: window.i18n.t('ph_search') || 'Search...',
                    onChange: () => window.TimelineView.applyFilters()
                });
            }
            window.MultiSelect.populate('timelineCategoryFilter', categories);

            if (this.pendingFilter) {
                const pf = this.pendingFilter;
                this.pendingFilter = null;
                if (pf.unreconciledBeforeDate) {
                    const check = document.getElementById('timelineUnreconciledFilter');
                    if (check) check.checked = true;
                }
            }

            // Process budgets map for the budget column
            this.budgetsMap = {};
            this.categoryToBudgetMap = {};
            budgets.forEach(b => {
                this.budgetsMap[b.id] = b.name;
                if (!b.is_project && b.categories) {
                    b.categories.forEach(cat => { this.categoryToBudgetMap[cat] = b.name; });
                }
            });

            // Render paycheck widget from dashboard stats
            if (stats) this.renderPaycheckWidget(stats);

            this.renderTable();

            if (this._pendingHighlightTxId) {
                const txId = this._pendingHighlightTxId;
                this._pendingHighlightTxId = null;
                // Use rAF to ensure DOM is painted before highlight
                requestAnimationFrame(() => this.highlightRow(txId));
            }
        } catch (e) {
            console.error("Failed to load timeline", e);
            const tbody = document.getElementById('timelineBody');
            if (tbody) {
                const msg = (window.i18n && window.i18n.t('msg_save_error')) || 'Erreur de chargement';
                tbody.innerHTML = `<tr><td class="row-marker"></td><td colspan="15" style="text-align:center; padding: 25px; color: var(--text-muted); font-style: italic;">⚠️ ${msg}</td></tr>`;
            }
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
        const attachFilter = document.getElementById('timelineAttachmentFilter');
        
        const q = searchInput ? window.cleanStringForSearch(searchInput.value) : '';
        const tType = typeFilter ? typeFilter.value : '';
        const selectedCats = window.MultiSelect.getSelected('timelineCategoryFilter');
        const tAttach = attachFilter ? attachFilter.checked : false;

        // Rendu du bloc d'opérations fantômes bancaires en attente
        if (window.BankSyncView && typeof window.BankSyncView.renderGhostBox === 'function') {
            const ghostContainer = document.getElementById('timelineGhostBox');
            if (ghostContainer) {
                window.BankSyncView.renderGhostBox(ghostContainer);
            }
        }

        // Apply filters
        let filtered = this.transactions;

        if (q) {
            filtered = filtered.filter(tx => 
                window.cleanStringForSearch(tx.description || '').includes(q) ||
                window.cleanStringForSearch(tx.category || '').includes(q) ||
                (tx.amount || '').toString().includes(q)
            );
        }
        if (tType) {
            filtered = filtered.filter(tx => tx.type === tType);
        }
        if (selectedCats.length > 0) {
            filtered = filtered.filter(tx => selectedCats.includes(tx.category));
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
            
            const isHistory = this.currentPeriodIndex > 0;
            if (isHistory) {
                const hIndex = this.currentPeriodIndex - 1;
                const historyItem = window.app.payHistory[hIndex];
                endDateStr = historyItem.date;
                
                if (historyItem.validated_pay_date) {
                    const d = new Date(historyItem.validated_pay_date);
                    d.setDate(d.getDate() + 1);
                    baseStartDateStr = d.toISOString().split('T')[0];
                } else if (historyItem.logical_period) {
                    const parts = historyItem.logical_period.split('-');
                    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
                    baseStartDateStr = d.toISOString().split('T')[0];
                }
            } else {
                if (window.app.isPayValidated && window.app.validatedPayDate) {
                    const d = new Date(window.app.validatedPayDate);
                    d.setDate(d.getDate() + 1);
                    baseStartDateStr = d.toISOString().split('T')[0];
                } else if (window.app.payHistory && window.app.payHistory.length > 0) {
                    const detectedHistory = window.app.payHistory.filter(h => !h.is_override && !h.is_placeholder);
                    const sortedHistory = [...detectedHistory].sort((a, b) => new Date(b.date) - new Date(a.date));
                    if (sortedHistory.length > 0) {
                        const d = new Date(sortedHistory[0].date);
                        d.setDate(d.getDate() + 1);
                        baseStartDateStr = d.toISOString().split('T')[0];
                    }
                }
                
                if (!baseStartDateStr) {
                    if (window.app.validatedPayDate) {
                        const d = new Date(window.app.validatedPayDate);
                        d.setDate(d.getDate() + 1);
                        baseStartDateStr = d.toISOString().split('T')[0];
                    } else if (window.app.payPeriod) {
                        const parts = window.app.payPeriod.split('-');
                        if (parts.length === 2) {
                            baseStartDateStr = `${parts[0]}-${parts[1]}-01`;
                        }
                    }
                }
            }
            
            if (!baseStartDateStr) {
                const now = new Date();
                const pad = (n) => n < 10 ? '0'+n : n;
                baseStartDateStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`;
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
        
        if (!isOrgMode && startDateStr) {
            const descSpan = document.getElementById('paycheckWidgetDesc');
            if (descSpan) {
                const isHistory = this.currentPeriodIndex > 0;
                let payDateStr = '';
                let payAmount = 0;
                
                let oldestUnreconciledStr = '';
                if (!isHistory && window.app.nextPayDate) {
                    const nextPayDate = new Date(window.app.nextPayDate);
                    const unreconciledTxs = filtered.filter(tx => {
                        if (tx.reconciliation_date) return false;
                        const txDate = new Date(tx.date_operation);
                        if (txDate > nextPayDate) return false;
                        return true;
                    });
                    if (unreconciledTxs.length > 0) {
                        const dates = unreconciledTxs.map(tx => new Date(tx.date_operation)).filter(d => !isNaN(d));
                        if (dates.length > 0) {
                            const oldest = new Date(Math.min(...dates));
                            const startLimit = new Date(startDateStr);
                            if (oldest < startLimit) {
                                const pad = (n) => n < 10 ? '0'+n : n;
                                oldestUnreconciledStr = `${oldest.getFullYear()}-${pad(oldest.getMonth()+1)}-${pad(oldest.getDate())}`;
                            }
                        }
                    }
                }
                
                if (isHistory) {
                    const hIndex = this.currentPeriodIndex - 1;
                    const historyItem = window.app.payHistory[hIndex];
                    payDateStr = formatDate(historyItem.date);
                    payAmount = historyItem.amount;
                    const periodStartFormatted = formatDate(startDateStr);
                    descSpan.innerHTML = window.i18n.tp('paycheck_widget_history_desc', { date: payDateStr, amount: formatCurrency(payAmount), period_start: periodStartFormatted });
                } else if (window.app.nextPayDate) {
                    payDateStr = formatDate(window.app.nextPayDate);
                    payAmount = window.app.nextPayAmount;
                    const periodStartFormatted = formatDate(startDateStr);
                    const isManualSkip = window.app.isPayValidated;
                    
                    let descText = '';
                    if (isManualSkip) {
                        descText = window.i18n.tp('paycheck_widget_skipped_desc', { date: payDateStr, amount: formatCurrency(payAmount), period_start: periodStartFormatted });
                    } else {
                        descText = window.i18n.tp('paycheck_widget_active_desc', { date: payDateStr, amount: formatCurrency(payAmount), period_start: periodStartFormatted });
                    }
                    
                    if (oldestUnreconciledStr) {
                        descText += window.i18n.tp('paycheck_widget_unreconciled_suffix', { date: formatDate(oldestUnreconciledStr) });
                    }
                    descSpan.innerHTML = descText;
                }
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
            if (this.currentPeriodIndex > 0) {
                unreconciled = []; // Hide all unreconciled if viewing history
            } else {
                const nextPayDate = new Date(window.app.nextPayDate);
                unreconciled = unreconciled.filter(tx => {
                    const txDate = new Date(tx.date_operation);
                    return txDate <= nextPayDate;
                });
            }
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
            
            const idAttr = tx._isFirstReconciled ? 'id="first-reconciled"' : '';
            
            const reconcileHTML = window.ReconciliationStates.resolve(tx, { view: 'timeline', formatDate }).html;

            const accounts = window.app.accounts || [];
            const getAcc = (id) => accounts.find(x => x.id === id);
            const getAccBadge = (id) => {
                const a = getAcc(id);
                if (!a) return '-';
                const c = a.color || '#3366ff';
                return `<span class="account-badge" style="background:${c}18;color:${c};border-color:${c}40;"><span class="acc-badge-dot" style="background:${c};"></span>${a.name}</span>`;
            };
            const depuis = tx.from_account_id ? getAccBadge(tx.from_account_id) : '-';
            const vers = tx.to_account_id ? getAccBadge(tx.to_account_id) : '-';
            const depuisTitle = tx.from_account_id ? (getAcc(tx.from_account_id)?.name || '') : '';
            const versTitle = tx.to_account_id ? (getAcc(tx.to_account_id)?.name || '') : '';
            
            let recText = '-';
            if (tx.is_monthly) recText = window.i18n.t('rec_monthly');
            if (tx.is_yearly) recText = window.i18n.t('rec_yearly');
            if (tx.is_bimonthly) recText = window.i18n.t('rec_bimonthly');

            const attachHtml = tx.attachments ? `<span style="cursor:pointer;" title="${tx.attachments}" onclick="window.TimelineView._openAttachment('${tx.attachments.replace(/'/g, "\\'")}')">📎</span>` : '-';

            const origSubtext = (tx.original_amount && tx.original_currency) ? `<div style="font-size: 10px; font-weight: 500; opacity: 0.8; color: var(--accent); white-space: nowrap;">🌐 ${formatCurrency(tx.original_amount, tx.original_currency)}</div>` : '';

            return `
            <tr data-id="${tx.id}" class="${rowClass}" ${idAttr}>
                <td class="row-marker"></td>
                <td class="col-dateSaisie" data-label="${window.i18n.t('dl_date_entry')}">${formatDate(tx.date_saisie)}</td>
                <td class="col-date" data-label="${window.i18n.t('dl_date_op')}">${renderDateWithStatus(tx)}</td>
                <td class="col-desc" data-label="${window.i18n.t('dl_description')}" title="${(tx.description || '').replace(/"/g, '&quot;')}"><span class="desc-text">${tx.description}</span></td>
                <td class="col-type" data-label="${window.i18n.t('dl_type')}" title="${window.app.getTypeLabel(tx.type) || '-'}">${window.app.getTypeLabel(tx.type) || '-'}</td>
                <td class="col-cat" data-label="${window.i18n.t('dl_category')}" style="white-space: nowrap;" title="${(tx.category || '').replace(/"/g, '&quot;')}"><span style="background: var(--bg-base); padding: 2px 6px; border-radius: 4px; font-size: 11px;">${tx.category || '-'}</span></td>
                <td class="col-amount" data-label="${window.i18n.t('dl_amount')}">
                    <span class="privacy-blur" style="color: ${amountColor}; font-weight: bold;">${formatCurrency(tx.amount)}</span>
                    ${origSubtext}
                </td>
                <td class="col-recon" data-label="${window.i18n.t('dl_reconciled')}" style="text-align: center;">
                    ${reconcileHTML}
                </td>
                <td class="col-budget" data-label="${window.i18n.t('dl_envelope')}">${(() => { const bName = (tx.budget_id && window.TimelineView.budgetsMap[tx.budget_id]) ? window.TimelineView.budgetsMap[tx.budget_id] : (tx.category && window.TimelineView.categoryToBudgetMap && window.TimelineView.categoryToBudgetMap[tx.category]) ? window.TimelineView.categoryToBudgetMap[tx.category] : null; return bName ? `<span onclick="window.BudgetsView._pendingHighlightName='${bName.replace(/'/g, "\\'")}';window.app.loadView('budgets')" style="background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;white-space:nowrap;cursor:pointer;" title="${bName}">🗂️ ${bName}</span>` : '<span style="color:var(--text-muted);font-size:11px;">—</span>'; })()}</td>
                <td class="col-depuis" data-label="${window.i18n.t('dl_from')}" title="${depuisTitle}">${depuis}</td>
                <td class="col-vers" data-label="${window.i18n.t('dl_to')}" title="${versTitle}">${vers}</td>
                <td class="col-recurrence" data-label="${window.i18n.t('dl_recurrence')}" title="${recText}">${recText}</td>
                <td class="col-slip" data-label="${window.i18n.t('dl_slip')}">${tx.check_slip_number || '-'}</td>
                <td class="col-attachments" data-label="${window.i18n.t('dl_attachments')}">${attachHtml}</td>
                <td class="col-createdBy" data-label="${window.i18n.t('dl_created_by')}">${tx.created_by ? `${tx.created_by}${tx.created_at ? `<br><span style="font-size:10px;color:var(--text-muted);">${tx.created_at}</span>` : ''}` : '-'}</td>
                <td class="col-modifiedBy" data-label="${window.i18n.t('dl_modified_by')}">${tx.modified_by ? `${tx.modified_by}${tx.modified_at ? `<br><span style="font-size:10px;color:var(--text-muted);">${tx.modified_at}</span>` : ''}` : '-'}</td>
                <td class="col-actions mobile-card-actions">
                    <div class="row-actions-group">
                        ${(() => {
                            if (tx.recurrence_id) {
                                if (tx.is_skipped) {
                                    return `<button class="btn-action-icon btn-action-skip" onclick="window.TimelineView.toggleSkip(${tx.id})" title="${window.i18n.t('tooltip_unskip') || 'Rétablir'}">↩️</button>`;
                                } else if (!isReconciled) {
                                    return `<button class="btn-action-icon btn-action-skip" onclick="window.TimelineView.toggleSkip(${tx.id})" title="${window.i18n.t('tooltip_skip') || 'Ignorer'}">⏭️</button>`;
                                }
                            }
                            return '<span class="btn-action-placeholder"></span>';
                        })()}
                        <button class="btn-action-icon btn-action-dup" onclick="window.TimelineView.duplicate(${tx.id})" title="${window.i18n.t('tooltip_duplicate') || 'Dupliquer'}">📋</button>
                        <button class="btn-action-edit" onclick="window.TimelineView.edit(${tx.id})" title="${window.i18n.t('tooltip_edit') || 'Modifier'}"><span class="btn-action-edit-icon">✏️</span><span class="btn-action-edit-label">${window.i18n.t('tooltip_edit') || 'Modifier'}</span></button>
                        <button class="btn-action-del" onclick="window.TimelineView.delete(${tx.id})" title="${window.i18n.t('btn_delete') || 'Supprimer'}">✕</button>
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
            const offset = header.offsetHeight - 32; // match -32px margin-top
            table.style.setProperty('--sticky-top', Math.max(0, offset) + 'px');
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

    duplicate(id) {
        const tx = this.transactions.find(t => t.id === id);
        if (tx && window.FormView) {
            window.FormView.openDuplicate(tx);
        }
    },

    async toggleSkip(id) {
        // PERF: UI Optimiste — feedback visuel immédiat avant la réponse API
        const row = document.querySelector(`tr[data-tx-id="${id}"]`);
        if (row) row.style.opacity = '0.5';
        try {
            const res = await API.post(`/api/transactions/${id}/toggle_skip`);
            if (row) row.style.opacity = '';
            this._pendingHighlightTxId = id;
            showUndoToast(window.i18n.t('toast_tx_updated') || "Opération modifiée", res.action_id, () => this.loadData());
            // PERF: Refresh en arrière-plan, non-bloquant
            Promise.all([window.app.refreshSidebar(), this.loadData()]).catch(e => console.error('[Timeline] Erreur refresh arrière-plan:', e));
        } catch (e) {
            if (row) row.style.opacity = '';
            console.error(e);
            showToast("Erreur lors de la modification", "error");
        }
    },

    async toggleReconciliation(id) {
        this._pendingHighlightTxId = id;
        await window.ReconciliationActions.toggle(id, {
            rowSelector: `tr[data-tx-id="${id}"]`,
            refreshView: () => this.loadData()
        });
    },

    async delete(id) {
        if (await showInlineConfirm(window.i18n.t('title_confirmation'), window.i18n.t('confirm_delete_operation'))) {
            // PERF: UI Optimiste — masquer la ligne immédiatement
            const row = document.querySelector(`tr[data-tx-id="${id}"]`);
            if (row) {
                row.style.transition = 'opacity 0.2s, transform 0.2s';
                row.style.opacity = '0';
                row.style.transform = 'translateX(-20px)';
            }
            try {
                const res = await API.del(`/api/transactions/${id}`);
                showUndoToast(window.i18n.t('toast_tx_deleted') || "Opération supprimée", res.action_id, () => this.loadData());
                // PERF: Refresh en arrière-plan, non-bloquant
                Promise.all([window.app.refreshSidebar(), this.loadData()]).catch(e => console.error('[Timeline] Erreur refresh arrière-plan:', e));
            } catch (e) {
                // Rollback: restaurer la ligne
                if (row) { row.style.opacity = ''; row.style.transform = ''; }
                console.error(e);
            }
        }
    },

    
    showAddRow() {
        if (window.FormView) window.FormView.open();
    },

    scrollToAndHighlight(txId) {
        // Legacy entry point — just delegates
        this.highlightRow(txId);
    },

    highlightRow(txId) {
        const tbody = document.getElementById('timelineBody');
        if (!tbody) return;

        let vtIdx = -1;
        let originalRowHtml = null;

        // If using VirtualTable desktop mode, scroll to the row first
        if (this._vt && this._vt._rows && this._vt._rows.length && !this._vt._isMobile()) {
            const needle = `data-id="${txId}"`;
            vtIdx = this._vt._rows.findIndex(r => r.includes(needle));
            if (vtIdx >= 0) {
                originalRowHtml = this._vt._rows[vtIdx];
                // Inject inline style into raw HTML so it survives VT scroll re-renders
                this._vt._rows[vtIdx] = originalRowHtml.replace(
                    /(<tr\s)/,
                    '$1style="background-color: rgba(99,102,241,0.35) !important;" '
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
            const highlightColor = 'rgba(99, 102, 241, 0.35)';
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
