// budgets.js — Enveloppes v2 : multi-catégories, projets, suggestions IA
window.BudgetsView = {
    budgets: [],
    categories: [],
    statusData: null,
    aiEnabled: false,
    _directEdit: false, // true when modal was opened directly in edit mode (not via detail)
    customPeriod: { enabled: false, start: null, end: null }, // custom period with toggle

    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const aiDisp = cfg.enable_ai === 'true' ? '' : 'display: none !important;';

        return `
        <div>
            <div class="view-header" style="position:sticky;top:-32px;z-index:10;background:var(--bg-base);padding:32px 0 15px;margin-top:-32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <h2 style="margin:0;" data-i18n="budget_title">${window.i18n.t('budget_title')}</h2>
                <div class="history-filters" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    <button id="budgetAiBtn" class="btn btn-secondary" style="white-space:nowrap; ${aiDisp}" onclick="window.BudgetsView.requestAiSuggestions()" data-i18n="budget_btn_suggestions">${window.i18n.t('budget_btn_suggestions')}</button>
                    <button class="btn btn-primary" style="white-space:nowrap;" onclick="window.BudgetsView.showAddForm()" data-i18n="budget_btn_new">${window.i18n.t('budget_btn_new')}</button>
                </div>
            </div>

            <!-- AI Suggestions panel -->
            <div id="budgetAiPanel" style="display:none;margin-bottom:24px;background:var(--bg-surface);border:1px solid var(--accent);border-radius:12px;padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <strong style="color:var(--accent);" data-i18n="budget_ai_proposals">${window.i18n.t('budget_ai_proposals')}</strong>
                    <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;" onclick="window.BudgetsView.closeAiPanel()" data-i18n="budget_ai_close">${window.i18n.t('budget_ai_close')}</button>
                </div>
                <div id="budgetAiProposals" style="display:flex;flex-direction:column;gap:12px;"></div>
            </div>

            <!-- Status this month -->
            <div id="budgetStatusContainer" style="margin-bottom:30px;"></div>

            <!-- Budget config list (Merged into Status) -->

            <!-- Unified Modal (Details + Add/Edit Form) -->
            <div id="budgetUnifiedModal" class="modal-overlay" style="display:none;z-index:1000;align-items:flex-start;padding-top:8vh;padding-bottom:8vh;overflow-y:auto;">
                <div class="modal" style="width:95vw;max-width:1100px;border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);padding:30px;background:var(--bg-surface);border:1px solid var(--accent);height:max-content;">
                    
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;border-bottom:1px solid var(--border-color);padding-bottom:12px;">
                        <h4 id="budgetUnifiedTitle" style="margin:0;font-size:16px;" data-i18n="budget_modal_title">${window.i18n.t('budget_modal_title')}</h4>
                        <div style="display:flex;gap:8px;">
                            <button id="budgetUnifiedEditBtn" class="btn btn-secondary" style="display:none;padding:4px 8px;font-size:12px;" onclick="window.BudgetsView.showEditSection()" data-i18n="budget_btn_edit">${window.i18n.t('budget_btn_edit')}</button>
                            <button class="btn btn-secondary" onclick="window.BudgetsView.closeUnifiedModal()" style="padding:4px 8px;font-size:12px;">✕</button>
                        </div>
                    </div>

                    <!-- DETAIL SECTION -->
                    <div id="budgetDetailSection" style="display:none;margin-bottom:24px;">
                        <div id="budgetDetailGraph" style="margin-bottom:16px;"></div>
                        <div id="budgetDetailList" style="display:flex;flex-direction:column;gap:6px;"></div>
                    </div>

                    <!-- FORM SECTION -->
                    <div id="budgetFormSection" style="display:none;">
                        <input type="hidden" id="budgetEditId">

                        <div style="display:flex;flex-direction:column;gap:14px;">
                            <!-- Name -->
                            <div>
                                <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_label_name">${window.i18n.t('budget_label_name')}</label>
                                <input type="text" id="newBudgetName" class="inline-input" placeholder="Ex: Courses, Vacances St Malo..." style="width:100%;margin-top:4px;">
                            </div>

                            <!-- Type toggle -->
                            <div style="display:flex;align-items:center;gap:12px;width:100%;">
                                <label style="font-size:12px;color:var(--text-muted);white-space:nowrap;" data-i18n="budget_type_label">${window.i18n.t('budget_type_label')}</label>
                                <div style="display:flex; flex:1; background:var(--bg-base); padding:4px; border-radius:8px; border:1px solid var(--border-color);">
                                    <label id="tabLabelCat" style="flex:1; text-align:center; cursor:pointer; padding:8px 12px; font-size:13px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="category" id="budgetTypeCategory" checked onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        <span data-i18n="budget_type_category">${window.i18n.t('budget_type_category')}</span>
                                    </label>
                                    <label id="tabLabelProj" style="flex:1; text-align:center; cursor:pointer; padding:8px 12px; font-size:13px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="project" id="budgetTypeProject" onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        <span data-i18n="budget_type_project">${window.i18n.t('budget_type_project')}</span>
                                    </label>
                                    <label id="tabLabelSavings" style="flex:1; text-align:center; cursor:pointer; padding:8px 12px; font-size:13px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="savings" id="budgetTypeSavings" onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        <span data-i18n="budget_type_savings">${window.i18n.t('budget_type_savings')}</span>
                                    </label>
                                </div>
                            </div>

                            <!-- Improvement_04: Account Selector (Org Mode only) -->
                            <div id="budgetAccountSection" style="${(window.app?.config?.enable_org_mode === 'true') ? '' : 'display:none;'}">
                                <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_account_filter">${window.i18n.t('budget_account_filter') || 'Périmètre comptes'}</label>
                                <div id="budgetAccountCheckboxes" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(200px, 1fr));gap:6px;margin-top:6px;max-height:150px;overflow-y:auto;padding:10px;background:var(--bg-base);border-radius:8px;border:1px solid var(--border-color);">
                                    <!-- Filled dynamically -->
                                </div>
                            </div>

                            <!-- Category selector (hidden for project type) -->
                            <div id="budgetCatSection">
                                <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_cat_included">${window.i18n.t('budget_cat_included')}</label>
                                <input type="text" id="budgetCatSearch" class="inline-input" 
                                    data-i18n-placeholder="budget_cat_search_placeholder"
                                    placeholder="${window.i18n.t('budget_cat_search_placeholder') || 'Rechercher une catégorie...'}"
                                    style="width:100%;margin-top:6px;margin-bottom:4px;font-size:12px;padding:6px 10px;border-radius:6px;"
                                    oninput="window.BudgetsView.renderCatCheckboxes(window.BudgetsView.getSelectedCats())">
                                <div id="budgetCatCheckboxes" style="display:block;margin-top:8px;max-height:450px;overflow-y:auto;padding:12px;background:var(--bg-base);border-radius:8px;border:1px solid var(--border-color);">
                                    <!-- Filled dynamically -->
                                </div>
                            </div>

                            <!-- Amount + period -->
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                                <div>
                                    <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_target_amount">${window.i18n.t('budget_target_amount')}</label>
                                    <input type="number" id="newBudgetAmount" class="inline-input" placeholder="0.00" style="width:100%;margin-top:4px;" min="0" step="0.01">
                                </div>
                                <div>
                                    <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_label_period">${window.i18n.t('budget_label_period')}</label>
                                    <select id="newBudgetPeriod" class="inline-input" style="width:100%;margin-top:4px;" onchange="window.BudgetsView.onPeriodChange()">
                                        <option value="monthly" data-i18n="budget_opt_monthly">${window.i18n.t('budget_opt_monthly')}</option>
                                        <option value="yearly" data-i18n="budget_opt_yearly">${window.i18n.t('budget_opt_yearly')}</option>
                                        <option value="indefinite" data-i18n="budget_opt_indefinite">${window.i18n.t('budget_opt_indefinite')}</option>
                                        ${(window.app?.config?.enable_org_mode === 'true') ? `<option value="custom" data-i18n="budget_opt_custom">${window.i18n.t('budget_opt_custom') || 'Défini dans le temps'}</option>` : ''}
                                    </select>
                                </div>
                            </div>

                            <!-- Custom period date pickers (hidden by default) -->
                            <div id="budgetCustomDates" style="display:none;">
                                <label style="font-size:12px;color:var(--text-muted);" data-i18n="budget_custom_dates_label">${window.i18n.t('budget_custom_dates_label') || 'Période personnalisée'}</label>
                                <div style="display:flex;gap:10px;align-items:center;margin-top:4px;">
                                    <input type="date" id="newBudgetStartDate" class="inline-input" style="flex:1;">
                                    <span style="color:var(--text-muted);">→</span>
                                    <input type="date" id="newBudgetEndDate" class="inline-input" style="flex:1;">
                                </div>
                            </div>

                            <!-- Buttons -->
                            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">
                                <button class="btn btn-primary" style="flex:1;" onclick="window.BudgetsView.saveForm()" data-i18n="budget_btn_save">${window.i18n.t('budget_btn_save')}</button>
                                <button class="btn btn-secondary" style="flex:1;" onclick="window.BudgetsView.hideEditSection()" data-i18n="budget_btn_cancel">${window.i18n.t('budget_btn_cancel')}</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    },

    async init() {
        const now = new Date();
        // Per-type date state from localStorage (or defaults)
        this.monthlyMonth = localStorage.getItem('budget_monthly_month') || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        this.yearlyYear = parseInt(localStorage.getItem('budget_yearly_year') || now.getFullYear());

        // Restore custom period state for monthly
        const savedEnabled = localStorage.getItem('budget_custom_enabled') === 'true';
        const savedStart = localStorage.getItem('budget_custom_start');
        const savedEnd   = localStorage.getItem('budget_custom_end');
        this.customPeriod = { enabled: savedEnabled, start: savedStart, end: savedEnd };

        // Default custom period dates if enabled but no dates saved
        if (savedEnabled && !savedStart) {
            const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0);
            const endDay = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
            this.customPeriod.start = firstDay;
            this.customPeriod.end = endDay;
        }

        // Per-type status data
        this.statusByType = { monthly: null, yearly: null, indefinite: null, custom: null };

        await Promise.all([this.loadBudgets(), this.loadAccounts(), this.loadCategories(), this.loadAllStatuses(), this.checkAI()]);
        // Re-render after all data is loaded to ensure this.accounts is available for colored badges
        this.renderStatus();
    },

    // ── Per-type navigation ────────────────────────────────────────────
    stepMonthly(delta) {
        const [y, m] = this.monthlyMonth.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        this.monthlyMonth = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        localStorage.setItem('budget_monthly_month', this.monthlyMonth);
        this.loadStatusForType('monthly');
    },

    goTodayMonthly() {
        const now = new Date();
        this.monthlyMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        localStorage.setItem('budget_monthly_month', this.monthlyMonth);
        // Reset custom period
        this.customPeriod.enabled = false;
        localStorage.setItem('budget_custom_enabled', 'false');
        this.loadStatusForType('monthly');
    },

    stepYearly(delta) {
        this.yearlyYear += delta;
        localStorage.setItem('budget_yearly_year', this.yearlyYear);
        this.loadStatusForType('yearly');
    },

    goTodayYearly() {
        this.yearlyYear = new Date().getFullYear();
        localStorage.setItem('budget_yearly_year', this.yearlyYear);
        this.loadStatusForType('yearly');
    },

    onCustomPeriodToggle(enabled) {
        this.customPeriod.enabled = enabled;
        localStorage.setItem('budget_custom_enabled', enabled);

        if (enabled && !this.customPeriod.start) {
            const now = new Date();
            const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0);
            const endDay = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
            this.customPeriod.start = firstDay;
            this.customPeriod.end = endDay;
            localStorage.setItem('budget_custom_start', firstDay);
            localStorage.setItem('budget_custom_end', endDay);
        }
        this.loadStatusForType('monthly');
    },

    onCustomPeriodChange() {
        const start = document.getElementById('budgetCustomStart')?.value || null;
        const end   = document.getElementById('budgetCustomEnd')?.value   || null;
        this.customPeriod.start = start;
        this.customPeriod.end = end;
        if (start) localStorage.setItem('budget_custom_start', start);
        if (end)   localStorage.setItem('budget_custom_end',   end);
        this.loadStatusForType('monthly');
    },


    async checkAI() {
        try {
            const config = await API.get('/api/config/');
            const aiEnabled = config.find(c => c.key === 'enable_ai')?.value;
            this.aiEnabled = aiEnabled === 'true';
            const btn = document.getElementById('budgetAiBtn');
            if (btn) btn.style.display = this.aiEnabled ? 'inline-flex' : 'none';
        } catch(e) {}
    },

    async loadBudgets() {
        this.budgets = await API.get('/api/budgets/');
        // config is now rendered inside renderStatus
    },

    async loadAccounts() {
        this.accounts = await API.get('/api/stats/accounts');
        this.renderAccountCheckboxes();
    },

    async loadCategories() {
        const accIds = this.getSelectedAccounts();
        if (accIds.length > 0 && window.app?.config?.enable_org_mode === 'true') {
            this.categories = await API.get(`/api/categories/by_accounts?account_ids=${accIds.join(',')}`);
        } else {
            this.categories = await API.get('/api/categories/');
        }
        this.catAverages = await API.get('/api/categories/averages').catch(() => ({}));
        this.renderCatCheckboxes(this.getSelectedCats());
    },

    renderAccountCheckboxes(selected = []) {
        const container = document.getElementById('budgetAccountCheckboxes');
        if (!container || !this.accounts) return;

        container.innerHTML = this.accounts.filter(a => !a.is_closed).map(a => {
            const isSelected = selected.includes(a.id);
            const accColor = a.color || 'var(--accent)';
            const borderColor = isSelected ? accColor : 'var(--border-color)';
            return `
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;background:var(--bg-surface);padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid ${borderColor};transition:all 0.2s;">
                    <input type="checkbox" name="budgetAccount" value="${a.id}" data-color="${accColor}" ${isSelected ? 'checked' : ''} onchange="window.BudgetsView.onAccountChange(this)">
                    <span style="width:10px;height:10px;border-radius:50%;background:${accColor};flex-shrink:0;"></span>
                    <div style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
                        <span style="font-weight:${isSelected ? '600' : 'normal'};color:${isSelected ? accColor : 'inherit'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${a.name}">${a.name}</span>
                    </div>
                </label>
            `;
        }).join('');
    },

    getSelectedAccounts() {
        return [...document.querySelectorAll('input[name="budgetAccount"]:checked')].map(el => parseInt(el.value));
    },

    async onAccountChange(el) {
        if (el) {
            const accColor = el.dataset.color || 'var(--accent)';
            el.parentElement.style.borderColor = el.checked ? accColor : 'var(--border-color)';
            // Update label text color
            const nameSpan = el.parentElement.querySelector('div > span');
            if (nameSpan) {
                nameSpan.style.fontWeight = el.checked ? '600' : 'normal';
                nameSpan.style.color = el.checked ? accColor : 'inherit';
            }
        }
        // Refresh categories based on account selection
        await this.loadCategories();
    },

    renderCatCheckboxes(selected = []) {
        const container = document.getElementById('budgetCatCheckboxes');
        if (!container) return;

        const period = document.getElementById('newBudgetPeriod')?.value || 'monthly';
        const currentEditId = parseInt(document.getElementById('budgetEditId')?.value || 0);

        // Map categories to existing budgets to detect overlaps
        const catToBudget = {};
        if (this.budgets) {
            for (const b of this.budgets) {
                if (b.id === currentEditId) continue;
                for (const c of (b.categories || [])) {
                    if (!catToBudget[c]) catToBudget[c] = [];
                    catToBudget[c].push(b.name);
                }
            }
        }

        // Group categories by type
        const groups = {
            'expense_fixed': { title: window.app.getTypeLabel('expense_fixed'), cats: [] },
            'expense_var': { title: window.app.getTypeLabel('expense_var'), cats: [] },
            'income': { title: window.app.getTypeLabel('income'), cats: [] },
            'neutral': { title: window.app.getTypeLabel('neutral'), cats: [] },
            'other': { title: window.i18n.t('budget_cat_other'), cats: [] }
        };

        for (const c of this.categories) {
            if (groups[c.type]) groups[c.type].cats.push(c);
            else groups['other'].cats.push(c);
        }

        let html = '';
        const searchTerm = (document.getElementById('budgetCatSearch')?.value || '').toLowerCase();

        for (const key of ['expense_fixed', 'expense_var', 'income', 'neutral', 'other']) {
            const visibleCats = searchTerm
                ? groups[key].cats.filter(c => c.name.toLowerCase().includes(searchTerm))
                : groups[key].cats;
            if (visibleCats.length === 0) continue;

            
            html += `<div style="margin-bottom:12px;">
                <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;border-bottom:1px solid var(--border-color);padding-bottom:4px;">
                    ${groups[key].title}
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:6px;">`;
                
            for (const c of visibleCats) {
                const isSelected = selected.includes(c.name);
                const overlap = catToBudget[c.name] ? catToBudget[c.name].join(', ') : null;
                
                let avgValue = 0;
                let avgLabel = '';
                const catAvg = this.catAverages[c.name];
                
                if (catAvg) {
                    if (period === 'monthly' || period === 'indefinite') {
                        avgValue = catAvg.yearly_average; // Use the 12-month smoothed monthly average
                        avgLabel = window.i18n.t('budget_cat_this_month');
                    } else if (period === 'yearly') {
                        avgValue = catAvg.yearly_average * 12; // Revert to total annual average
                        avgLabel = window.i18n.t('budget_cat_per_year');
                    }
                }
                
                const avgText = avgValue > 0 ? `<span style="font-size:10px;color:var(--text-muted);background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:4px;">~${formatCurrency(avgValue)} ${avgLabel}</span>` : '';
                const overlapText = overlap ? `<span style="font-size:10px;color:#f59e0b;background:rgba(245,158,11,0.15);padding:1px 4px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${window.i18n.t('budget_cat_used_in')}: ${overlap}">⚠️ ${overlap}</span>` : '';

                html += `
                    <label style="display:flex;align-items:center;gap:6px;font-size:12px;background:var(--bg-surface);padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'};transition:all 0.2s;">
                        <input type="checkbox" name="budgetCat" value="${c.name}" ${isSelected ? 'checked' : ''} onchange="this.parentElement.style.borderColor = this.checked ? 'var(--accent)' : 'var(--border-color)'">
                        <div style="display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1;">
                            <span style="font-weight:${isSelected ? '600' : 'normal'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${c.name}">${c.name}</span>
                            <div style="display:flex;gap:4px;">
                                ${avgText}
                                ${overlapText}
                            </div>
                        </div>
                    </label>
                `;
            }
            html += `</div></div>`;
        }
        
        container.innerHTML = html;
    },

    getSelectedCats() {
        return [...document.querySelectorAll('input[name="budgetCat"]:checked')].map(el => el.value);
    },

    onPeriodChange() {
        const period = document.getElementById('newBudgetPeriod')?.value;
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = period === 'custom' ? 'block' : 'none';
        this.renderCatCheckboxes(this.getSelectedCats());
    },

    toggleType() {
        const isProject = document.getElementById('budgetTypeProject')?.checked;
        const isSavings = document.getElementById('budgetTypeSavings')?.checked;
        const catSection = document.getElementById('budgetCatSection');
        const periodRow = document.getElementById('newBudgetPeriod')?.closest('div');
        if (catSection) catSection.style.display = (isProject || isSavings) ? 'none' : 'block';
        // Hide period selector for savings (always indefinite)
        if (periodRow) periodRow.style.display = isSavings ? 'none' : '';
        if (isSavings) {
            document.getElementById('newBudgetPeriod').value = 'indefinite';
        }

        const tabCat = document.getElementById('tabLabelCat');
        const tabProj = document.getElementById('tabLabelProj');
        const tabSavings = document.getElementById('tabLabelSavings');
        const allTabs = [tabCat, tabProj, tabSavings].filter(Boolean);
        const activeTab = isSavings ? tabSavings : isProject ? tabProj : tabCat;
        for (const tab of allTabs) {
            if (tab === activeTab) {
                tab.style.background = 'var(--bg-surface)';
                tab.style.fontWeight = '700';
                tab.style.color = 'var(--accent)';
                tab.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
            } else {
                tab.style.background = 'transparent';
                tab.style.fontWeight = 'normal';
                tab.style.color = 'inherit';
                tab.style.boxShadow = 'none';
            }
        }
    },

    // ── API loading per type ────────────────────────────────────────────

    _buildStatusUrl(type) {
        let url = `/api/budgets/status?period_filter=${type}`;
        if (type === 'monthly') {
            if (this.customPeriod.enabled && this.customPeriod.start && this.customPeriod.end) {
                url += `&date_start=${this.customPeriod.start}&date_end=${this.customPeriod.end}`;
            } else {
                const [y, m] = this.monthlyMonth.split('-');
                url += `&year=${y}&month=${m}`;
            }
        } else if (type === 'yearly') {
            url += `&year=${this.yearlyYear}`;
        }
        // indefinite and custom: no date params needed
        return url;
    },

    async loadAllStatuses() {
        try {
            const [monthly, yearly, indefinite, custom] = await Promise.all([
                API.get(this._buildStatusUrl('monthly')),
                API.get(this._buildStatusUrl('yearly')),
                API.get(this._buildStatusUrl('indefinite')),
                API.get(this._buildStatusUrl('custom')),
            ]);
            this.statusByType = { monthly, yearly, indefinite, custom };
            this._mergeStatusData();
            this.renderStatus();
        } catch(e) {
            document.getElementById('budgetStatusContainer').innerHTML =
                `<p style="color:#ff5630;">${window.i18n.t('title_error')} : ${e.message}</p>`;
        }
    },

    async loadStatusForType(type) {
        try {
            this.statusByType[type] = await API.get(this._buildStatusUrl(type));
            this._mergeStatusData();
            this.renderStatus();
        } catch(e) {
            console.error(`[budget] Error loading ${type}`, e);
        }
    },

    _mergeStatusData() {
        // Merge all per-type results into a single statusData for backward compat
        const allBudgets = [];
        for (const type of ['monthly', 'yearly', 'indefinite', 'custom']) {
            const data = this.statusByType[type];
            if (data?.budgets) allBudgets.push(...data.budgets);
        }
        this.statusData = { budgets: allBudgets };
    },

    // Keep old loadStatus as alias for full reload
    async loadStatus() { await this.loadAllStatuses(); },


    renderStatus() {
        const container = document.getElementById('budgetStatusContainer');
        if (!this.statusData || this.statusData.budgets.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);padding:10px 0;">${window.i18n.t('budget_no_active')}</p>`;
            return;
        }

        // Per-type label and date params
        const [my, mm] = this.monthlyMonth.split('-').map(Number);
        const monthLabel = new Date(my, mm-1, 1).toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', {month:'long', year:'numeric'});
        const yearLabel = String(this.yearlyYear);

        // Group budgets by period
        const groups = {
            'monthly': { title: window.i18n.t('period_monthly'), budgets: [], label: monthLabel, y: my, m: mm },
            'yearly': { title: window.i18n.t('period_yearly'), budgets: [], label: yearLabel, y: this.yearlyYear, m: 1 },
            'indefinite': { title: window.i18n.t('budget_period_indefinite'), budgets: [], label: '', y: my, m: mm },
            'custom': { title: window.i18n.t('budget_period_custom') || 'Défini dans le temps', budgets: [], label: '', y: my, m: mm }
        };

        for (const b of this.statusData.budgets) {
            if (groups[b.period]) {
                groups[b.period].budgets.push(b);
            } else {
                groups['monthly'].budgets.push(b);
            }
        }

        let fullHtml = '';

        // ── Helper: per-type date controls ─────────────────────────────────
        const renderDateControls = (period) => {
            if (period === 'monthly') {
                const customEnabled = this.customPeriod.enabled;
                const monthOpacity = customEnabled ? 'opacity:0.4;pointer-events:none;' : '';
                const customDisp = customEnabled ? 'display:flex;' : 'display:none;';
                return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <div style="display:flex;align-items:center;gap:0;${monthOpacity}">
                        <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:6px 0 0 6px;border-right:none;" onclick="window.BudgetsView.stepMonthly(-1)">◀</button>
                        <input type="month" id="budgetMonthInput" class="inline-input" style="min-width:130px;border-radius:0;font-size:12px;padding:4px 6px;" value="${this.monthlyMonth}" onchange="window.BudgetsView.monthlyMonth=this.value;localStorage.setItem('budget_monthly_month',this.value);window.BudgetsView.loadStatusForType('monthly')">
                        <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:0 6px 6px 0;border-left:none;" onclick="window.BudgetsView.stepMonthly(1)">▶</button>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;font-size:11px;">
                            <div style="position:relative;width:32px;height:18px;">
                                <input type="checkbox" id="budgetCustomPeriodToggle" class="global-toggle" style="opacity:0;width:0;height:0;position:absolute;" ${customEnabled ? 'checked' : ''} onchange="window.BudgetsView.onCustomPeriodToggle(this.checked)">
                                <span class="slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:var(--border-color);transition:.4s;border-radius:34px;"></span>
                                <span class="slider-knob" style="position:absolute;height:12px;width:12px;left:3px;bottom:3px;background-color:white;transition:.4s;border-radius:50%;"></span>
                            </div>
                            <span>${window.i18n.t('budget_custom_period') || 'Période'}</span>
                        </label>
                        <div id="budgetCustomPeriodInputs" style="${customDisp}align-items:center;gap:4px;">
                            <input type="date" id="budgetCustomStart" class="inline-input" style="width:130px;font-size:11px;" value="${this.customPeriod.start || ''}" onchange="window.BudgetsView.onCustomPeriodChange()">
                            <span style="color:var(--text-muted);font-size:10px;">→</span>
                            <input type="date" id="budgetCustomEnd" class="inline-input" style="width:130px;font-size:11px;" value="${this.customPeriod.end || ''}" onchange="window.BudgetsView.onCustomPeriodChange()">
                        </div>
                    </div>
                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;" onclick="window.BudgetsView.goTodayMonthly()">${window.i18n.t('btn_today')}</button>
                </div>`;
            } else if (period === 'yearly') {
                return `<div style="display:flex;align-items:center;gap:0;">
                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:6px 0 0 6px;border-right:none;" onclick="window.BudgetsView.stepYearly(-1)">◀</button>
                    <span class="inline-input" style="min-width:60px;text-align:center;border-radius:0;font-size:12px;padding:4px 10px;display:inline-block;">${this.yearlyYear}</span>
                    <button class="btn btn-secondary" style="padding:4px 8px;font-size:13px;border-radius:0 6px 6px 0;border-left:none;" onclick="window.BudgetsView.stepYearly(1)">▶</button>
                    <button class="btn btn-secondary" style="padding:4px 10px;font-size:11px;margin-left:8px;" onclick="window.BudgetsView.goTodayYearly()">${window.i18n.t('btn_today')}</button>
                </div>`;
            }
            return ''; // indefinite & custom: no controls
        };

        // ── Helper: render a summary bar ──────────────────────────────────
        const renderSummaryBar = (titleText, subtitleText, budgetsList, accentColor) => {
            let totalTarget = 0, totalExpenses = 0, totalRecExpenses = 0, totalIncome = 0, totalSpent = 0, totalRecSpent = 0;
            for (const b of budgetsList) {
                totalTarget += b.budget_amount;
                totalExpenses += b.expenses || 0;
                totalRecExpenses += b.reconciled_expenses || 0;
                totalIncome += b.income || 0;
                totalSpent += b.spent;
                totalRecSpent += b.reconciled_spent || 0;
            }
            const effectiveTarget = totalTarget + totalIncome;
            const totalPct = effectiveTarget > 0 ? Math.min((totalExpenses / effectiveTarget) * 100, 100) : 0;
            const recPct = effectiveTarget > 0 ? Math.min((totalRecExpenses / effectiveTarget) * 100, 100) : 0;
            const totalBarColor = (effectiveTarget > 0 && (totalRecExpenses / effectiveTarget) * 100 > 100) ? '#ff5630' : recPct >= 80 ? '#f59e0b' : '#10b981';
            const netSpent = totalExpenses - totalIncome;
            const globalOver = netSpent > totalTarget;
            const globalRemaining = totalTarget - netSpent;
            const borderStyle = accentColor ? `border-left:3px solid ${accentColor};` : '';
            const incomeHtml = totalIncome > 0 ? `<span class="privacy-blur" style="color:#10b981;font-size:12px;align-self:flex-end;">↑ ${formatCurrency(totalIncome)} ${window.i18n.t('budget_received')}</span>` : '';

            return `<div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);${borderStyle}">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                    <div>
                        <h4 style="margin:0 0 4px;font-size:14px;color:var(--text-color);">${titleText}</h4>
                        <span style="font-size:12px;color:var(--text-muted);">${subtitleText}</span>
                    </div>
                    <div style="text-align:right;">
                        <strong class="privacy-blur" style="font-size:18px;color:var(--text-color);">${formatCurrency(totalTarget)}</strong><span style="font-size:12px;color:var(--text-muted);"> ${window.i18n.t('budget_budgeted')}</span>
                    </div>
                </div>
                <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:12px;overflow:hidden;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05);">
                    <div style="position:absolute;top:0;left:0;width:${totalPct}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;transition:width 0.3s;"></div>
                    <div style="position:absolute;top:0;left:0;width:${recPct}%;height:100%;background:${totalBarColor};border-radius:999px;transition:width 0.3s;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;flex-wrap:wrap;gap:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <span class="privacy-blur" style="color:${totalBarColor};font-weight:600;">${formatCurrency(totalRecExpenses)} ${window.i18n.t('budget_reconciled')}</span>
                        <span class="privacy-blur" style="color:var(--text-muted);font-size:12px;align-self:flex-end;">(${formatCurrency(totalExpenses)} ${window.i18n.t('budget_committed')})</span>
                        ${incomeHtml}
                    </div>
                    <span style="color:${globalOver ? '#ff5630' : 'var(--text-muted)'};font-weight:600;">${globalOver ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(globalRemaining))}</span> ${globalOver ? window.i18n.t('budget_global_exceeded') : window.i18n.t('budget_global_remaining')}</span>
                </div>
            </div>`;
        };

        // ── Helper: render a single budget card ──────────────────────────
        const renderBudgetCard = (b, y, m) => {
            const effectiveBudget = b.budget_amount + (b.income || 0);
            const expensesPct = effectiveBudget > 0 ? Math.min(((b.expenses || 0) / effectiveBudget) * 100 || 0, 100) : 0;
            const recExpPct = effectiveBudget > 0 ? Math.min(((b.reconciled_expenses || 0) / effectiveBudget) * 100 || 0, 100) : 0;
            const barColor = (effectiveBudget > 0 && ((b.reconciled_expenses || 0) / effectiveBudget) * 100 > 100) ? '#ff5630' : recExpPct >= 80 ? '#f59e0b' : '#10b981';
            const overBudget = b.remaining < 0;
            const typeTag = b.is_project
                ? `<span style="background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">${window.i18n.t('budget_project_tag')}</span>`
                : '';
            const catTags = (b.categories || []).map(c =>
                `<span style="background:var(--bg-base);padding:2px 6px;border-radius:4px;font-size:10px;color:var(--text-muted);">${c}</span>`
            ).join(' ');

            const incomeHtml = b.income > 0
                ? `<div style="font-size:11px;color:#10b981;margin-top:3px;">↑ <span class="privacy-blur">${formatCurrency(b.income)}</span> ${window.i18n.t('budget_received')}</div>`
                : '';

            const safeName = b.name.replace(/'/g, "\\'");
            const periodLabel = b.period === 'monthly' ? window.i18n.t('period_monthly') : b.period === 'yearly' ? window.i18n.t('period_yearly') : b.period === 'custom' ? `${window.i18n.t('budget_period_custom') || 'Défini'} (${b.start_date || '?'} → ${b.end_date || '?'})` : window.i18n.t('period_undefined');
            const closedStyle = b.is_closed ? 'opacity:0.6;' : '';
            const closedTag = b.is_closed
                ? `<span style="background:rgba(239,68,68,0.15);color:#ff5630;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px;">${window.i18n.t('budget_closed_tag')}</span>`
                : '';

            // Improvement_04: Account badges
            let accountBadges = '';
            if (b.account_ids && b.account_ids.length > 0 && window.app?.config?.enable_org_mode === 'true') {
                accountBadges = b.account_ids.map(aid => {
                    const acc = this.accounts?.find(a => a.id === aid);
                    if (!acc) return '';
                    const color = acc.color || 'var(--accent)';
                    return `<span style="background:${color}1a; color:${color}; border:1px solid ${color}33; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:600;">● ${acc.name}</span>`;
                }).join(' ');
            }

            const periodColors = {
                'monthly': '#3b82f6',
                'yearly': '#8b5cf6',
                'indefinite': '#14b8a6',
                'custom': '#ec4899'
            };
            const pColor = periodColors[b.period] || '#3b82f6';
            return `<div data-budget-id="${b.id}" onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})" class="budget-envelope-card ${overBudget ? 'over-budget' : ''}" style="${closedStyle}">\
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:8px;">
                        <div style="flex:1;">
                            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
                                <strong style="font-size:13px;">${b.name}</strong>
                                ${closedTag}
                                ${accountBadges}
                            </div>
                            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${typeTag}${catTags}</div>
                        </div>
                        <div style="display:flex;gap:4px;flex-shrink:0;" onclick="event.stopPropagation()">
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.editBudget(${b.id})" title=\"${window.i18n.t('tooltip_edit')}\">✏️</button>
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.toggleClose(${b.id})" title="${b.is_closed ? window.i18n.t('budget_reopen_action') : window.i18n.t('budget_close_action')}">${b.is_closed ? '🔓' : '🔒'}</button>
                            <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.deleteBudget(${b.id})" title=\"${window.i18n.t('tooltip_delete')}\">✕</button>
                        </div>
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11px;color:var(--text-muted);">
                        <span>${periodLabel}</span>
                        <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;">
                            <input type="number" class="inline-input" style="width:80px;text-align:right;padding:2px 6px;font-size:12px;border-radius:4px;" value="${b.budget_amount}" min="0" step="0.01" onchange="window.BudgetsView.updateAmount(${b.id}, this.value)"> €
                        </div>
                    </div>

                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:8px;overflow:hidden;margin-bottom:8px;border:1px solid rgba(255,255,255,0.05);">
                        <div style="position:absolute;top:0;left:0;width:${expensesPct}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;"></div>
                        <div style="position:absolute;top:0;left:0;width:${recExpPct}%;height:100%;background:${barColor};border-radius:999px;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;flex-wrap:wrap;gap:4px;">
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            <span class="privacy-blur" style="color:${barColor};font-weight:600;">${formatCurrency(b.reconciled_expenses || 0)} ${window.i18n.t('budget_reconciled')}</span>
                            <span class="privacy-blur" style="color:var(--text-muted);font-size:11px;align-self:flex-end;">(${formatCurrency(b.expenses || 0)} ${window.i18n.t('budget_committed')})</span>
                            ${incomeHtml}
                        </div>
                        <span style="color:${overBudget ? '#ff5630' : 'var(--text-muted)'}">${overBudget ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(b.remaining))}</span> ${overBudget ? window.i18n.t('budget_exceeded_label') : window.i18n.t('budget_remaining_label')}</span>
                    </div>
                </div>`;
        };

        // ── Helper: render a single savings (tirelire) card ──────────────
        const renderSavingsCard = (b, y, m) => {
            const balance = b.balance || 0;
            const goal = b.budget_amount || 0;
            const pct = goal > 0 ? Math.min((balance / goal) * 100, 100) : 0;
            const goalReached = balance >= goal && goal > 0;
            const barColor = goalReached ? '#f59e0b' : '#10b981';
            const funded = b.funded || 0;
            const withdrawn = b.withdrawn || 0;

            const safeName = b.name.replace(/'/g, "\\'");
            const closedStyle = b.is_closed ? 'opacity:0.6;' : '';
            const closedTag = b.is_closed
                ? `<span style="background:rgba(239,68,68,0.15);color:#ff5630;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px;">${window.i18n.t('budget_closed_tag')}</span>`
                : '';
            const typeTag = `<span style="background:rgba(245,158,11,0.15);color:#f59e0b;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">${window.i18n.t('budget_savings_tag')}</span>`;

            // Improvement_04: Account badges
            let accountBadges = '';
            if (b.account_ids && b.account_ids.length > 0 && window.app?.config?.enable_org_mode === 'true') {
                accountBadges = b.account_ids.map(aid => {
                    const acc = this.accounts?.find(a => a.id === aid);
                    if (!acc) return '';
                    const color = acc.color || 'var(--accent)';
                    return `<span style="background:${color}1a; color:${color}; border:1px solid ${color}33; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:600;">● ${acc.name}</span>`;
                }).join(' ');
            }

            const withdrawnHtml = withdrawn > 0
                ? `<span class="privacy-blur" style="color:#ff5630;font-size:11px;">↓ ${formatCurrency(withdrawn)} ${window.i18n.t('budget_savings_withdrawn')}</span>`
                : '';

            return `<div data-budget-id="${b.id}" onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})" class="budget-envelope-card savings ${goalReached ? 'goal-reached' : ''}" style="${closedStyle}">\
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:8px;">
                        <div style="flex:1;">
                            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
                                <strong style="font-size:13px;">${b.name}</strong>
                                ${closedTag}
                                ${accountBadges}
                            </div>
                            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${typeTag}</div>
                        </div>
                        <div style="display:flex;gap:4px;flex-shrink:0;" onclick="event.stopPropagation()">
                            ${!b.is_closed ? `<button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.showAllocationForm(${b.id})" title="${window.i18n.t('budget_savings_add_funds')}">➕</button>` : ''}
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.editBudget(${b.id})" title="${window.i18n.t('tooltip_edit')}">✏️</button>
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.${b.is_closed ? 'toggleClose' : 'breakPiggyBank'}(${b.id})" title="${b.is_closed ? window.i18n.t('budget_reopen_action') : window.i18n.t('budget_savings_break_action')}">${b.is_closed ? '🔓' : '🔨'}</button>
                            <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.deleteBudget(${b.id})" title="${window.i18n.t('tooltip_delete')}">✕</button>
                        </div>
                    </div>

                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:11px;color:var(--text-muted);">
                        <span>${window.i18n.t('budget_savings_goal')}</span>
                        <div onclick="event.stopPropagation()" style="display:flex;align-items:center;gap:4px;">
                            <input type="number" class="inline-input" style="width:80px;text-align:right;padding:2px 6px;font-size:12px;border-radius:4px;" value="${b.budget_amount}" min="0" step="0.01" onchange="window.BudgetsView.updateAmount(${b.id}, this.value)"> €
                        </div>
                    </div>

                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:8px;overflow:hidden;margin-bottom:8px;border:1px solid rgba(255,255,255,0.05);">
                        <div style="position:absolute;top:0;left:0;width:${pct}%;height:100%;background:${barColor};border-radius:999px;transition:width 0.5s ease;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;flex-wrap:wrap;gap:4px;">
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            <span class="privacy-blur" style="color:${barColor};font-weight:600;">↑ ${formatCurrency(funded)} ${window.i18n.t('budget_savings_funded')}</span>
                            ${withdrawnHtml}
                        </div>
                        <span style="color:${goalReached ? '#f59e0b' : 'var(--text-muted)'};font-weight:600;">${goalReached ? '🎯 ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(b.remaining || 0))}</span> ${goalReached ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                    </div>
                </div>`;
        };

        // ── Main rendering loop ──────────────────────────────────────────
        const isOrgMode = window.app?.config?.enable_org_mode === 'true';

        // Separate savings from spending budgets
        const savingsBudgets = [];
        for (const period of ['monthly', 'yearly', 'indefinite', 'custom']) {
            const group = groups[period];
            if (group.budgets.length === 0) continue;
            const y = group.y;
            const m = group.m;
            const label = group.label;

            // Separate savings from spending in this group
            const spendingBudgets = group.budgets.filter(b => (b.envelope_type || 'spending') !== 'savings');
            const groupSavings = group.budgets.filter(b => (b.envelope_type || 'spending') === 'savings');
            savingsBudgets.push(...groupSavings.map(b => ({ ...b, _y: y, _m: m })));

            if (spendingBudgets.length === 0) continue;

            const periodColors = {
                'monthly': '#3b82f6',
                'yearly': '#8b5cf6',
                'indefinite': '#14b8a6',
                'custom': '#ec4899'
            };
            const pColor = periodColors[period] || '#3b82f6';

            let html = `<div data-budget-period="${period}" style="margin-bottom:40px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;border-bottom:2px solid ${pColor}80;padding-bottom:8px;">
                    <h3 style="margin:0;font-size:16px;color:var(--text-color);">${window.i18n.t('budget_envelopes_title')} — ${group.title}</h3>
                    ${renderDateControls(period)}
                </div>`;

            // Sub-group budgets by account scope (Org Mode) or keep flat
            const hasAnyAccountScope = isOrgMode && spendingBudgets.some(b => b.account_ids && b.account_ids.length > 0);

            if (hasAnyAccountScope) {
                const subGroups = {};
                for (const b of spendingBudgets) {
                    const key = (b.account_ids && b.account_ids.length > 0) ? [...b.account_ids].sort((a2,b2) => a2 - b2).join(',') : '__global__';
                    if (!subGroups[key]) subGroups[key] = [];
                    subGroups[key].push(b);
                }

                for (const [key, budgets] of Object.entries(subGroups)) {
                    let subTitle, accentColor;
                    if (key === '__global__') {
                        subTitle = `${window.i18n.t('budget_summary_global')} — ${group.title}`;
                        accentColor = null;
                    } else {
                        const accIds = key.split(',').map(id => parseInt(id));
                        const accObjs = accIds.map(id => this.accounts?.find(a => a.id === id)).filter(Boolean);
                        if (accObjs.length > 0) {
                            subTitle = accObjs.map(a => {
                                const c = a.color || 'var(--accent)';
                                return `<span style="color:${c};font-weight:600;">● ${a.name}</span>`;
                            }).join(' <span style="color:var(--text-muted);">+</span> ');
                        } else {
                            const firstBudget = budgets[0];
                            if (firstBudget?.account_names?.length > 0) {
                                subTitle = firstBudget.account_names.join(' + ');
                            } else {
                                subTitle = accIds.map(id => `#${id}`).join(' + ');
                            }
                        }
                        const firstAcc = accObjs[0];
                        accentColor = firstAcc?.color || 'var(--accent)';
                    }

                    html += `<div data-budget-period-sub="${period}-${key}">`;
                    html += renderSummaryBar(subTitle, label, budgets, accentColor);
                    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:24px;">`;
                    for (const b of budgets) html += renderBudgetCard(b, y, m);
                    html += '</div></div>';
                }
            } else {
                html += `<div data-budget-period-sub="${period}-__global__">`;
                html += renderSummaryBar(`${window.i18n.t('budget_summary_global')} — ${group.title}`, label, spendingBudgets, null);
                html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">`;
                for (const b of spendingBudgets) html += renderBudgetCard(b, y, m);
                html += '</div></div>';
            }

            html += '</div>';
            fullHtml += html;
        }

        // ── Savings (Tirelire) section ───────────────────────────────────
        if (savingsBudgets.length > 0) {
            let savingsHtml = `<div data-budget-period="savings" style="margin-bottom:40px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px;border-bottom:2px solid rgba(245,158,11,0.3);padding-bottom:8px;">
                    <h3 style="margin:0;font-size:16px;color:#f59e0b;">🏦 ${window.i18n.t('budget_savings_section')}</h3>
                </div>`;

            // Summary bar for savings
            const totalGoal = savingsBudgets.reduce((s, b) => s + (b.budget_amount || 0), 0);
            const totalBalance = savingsBudgets.reduce((s, b) => s + (b.balance || 0), 0);
            const savingsPct = totalGoal > 0 ? Math.min((totalBalance / totalGoal) * 100, 100) : 0;
            const savingsBarColor = savingsPct >= 100 ? '#f59e0b' : '#10b981';
            savingsHtml += `<div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:20px;margin-bottom:16px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);border-left:3px solid #f59e0b;">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                    <div>
                        <h4 style="margin:0 0 4px;font-size:14px;color:var(--text-color);">🏦 ${window.i18n.t('budget_savings_summary')}</h4>
                        <span style="font-size:12px;color:var(--text-muted);">${savingsBudgets.length} ${window.i18n.t('budget_savings_tag').toLowerCase()}${savingsBudgets.length > 1 ? 's' : ''}</span>
                    </div>
                    <div style="text-align:right;">
                        <strong class="privacy-blur" style="font-size:18px;color:var(--text-color);">${formatCurrency(totalBalance)}</strong><span style="font-size:12px;color:var(--text-muted);"> / ${formatCurrency(totalGoal)}</span>
                    </div>
                </div>
                <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:12px;overflow:hidden;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05);">
                    <div style="position:absolute;top:0;left:0;width:${savingsPct}%;height:100%;background:${savingsBarColor};border-radius:999px;transition:width 0.3s;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;">
                    <span class="privacy-blur" style="color:${savingsBarColor};font-weight:600;">${formatCurrency(totalBalance)} ${window.i18n.t('budget_savings_funded')}</span>
                    <span style="color:var(--text-muted);font-weight:600;"><span class="privacy-blur">${formatCurrency(Math.abs(totalGoal - totalBalance))}</span> ${totalBalance >= totalGoal ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                </div>
            </div>`;

            savingsHtml += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">`;
            for (const b of savingsBudgets) savingsHtml += renderSavingsCard(b, b._y, b._m);
            savingsHtml += '</div></div>';
            fullHtml += savingsHtml;
        }

        let html = fullHtml;

        container.innerHTML = html;

        // Highlight a specific budget card if requested from another view
        if (this._pendingHighlightName) {
            const name = this._pendingHighlightName;
            this._pendingHighlightName = null;
            setTimeout(() => this._highlightByName(name), 100);
        }
    },

    _highlightByName(budgetName) {
        const cards = document.querySelectorAll('[data-budget-id]');
        for (const card of cards) {
            const nameEl = card.querySelector('strong');
            if (nameEl && nameEl.textContent.trim().startsWith(budgetName)) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.style.boxShadow = '0 0 0 2px var(--accent), 0 0 20px rgba(99,102,241,0.4)';
                card.style.borderColor = 'var(--accent)';
                setTimeout(() => {
                    card.style.boxShadow = '';
                    card.style.borderColor = '';
                }, 3000);
                break;
            }
        }
    },

    async showDetail(budgetId, budgetName, year, month) {
        this._currentDetailYear = year;
        this._currentDetailMonth = month;
        const modal = document.getElementById('budgetUnifiedModal');
        const title = document.getElementById('budgetUnifiedTitle');
        const graph = document.getElementById('budgetDetailGraph');
        const list = document.getElementById('budgetDetailList');
        const editBtn = document.getElementById('budgetUnifiedEditBtn');
        const detailSec = document.getElementById('budgetDetailSection');
        const formSec = document.getElementById('budgetFormSection');
        
        if (!modal) return;

        title.textContent = `📊 ${budgetName}`;
        document.getElementById('budgetEditId').value = budgetId; // Store for edit
        editBtn.style.display = 'block';
        
        detailSec.style.display = 'block';
        formSec.style.display = 'none';
        
        graph.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">${window.i18n.t('budget_loading')}</p>`;
        list.innerHTML = '';
        modal.style.display = 'flex';

        try {
            const budget = this.statusData?.budgets.find(b => b.id === budgetId);
            const isSavings = (budget?.envelope_type || 'spending') === 'savings';
            const txs = await API.get(`/api/budgets/${budgetId}/transactions?year=${year}&month=${month}`);

            // ── Savings (Tirelire) detail ────────────────────────────────
            if (isSavings) {
                // Load allocations
                let allocs = [];
                try { allocs = await API.get(`/api/budgets/${budgetId}/allocations`); } catch(e) {}

                const funded = budget?.funded || 0;
                const withdrawn = budget?.withdrawn || 0;
                const balance = budget?.balance || 0;
                const goal = budget?.budget_amount || 0;
                const pct = goal > 0 ? Math.min((balance / goal) * 100, 100) : 0;
                const goalReached = balance >= goal && goal > 0;
                const barColor = goalReached ? '#f59e0b' : '#10b981';

                title.textContent = `🏦 ${budgetName}`;
                const safeName = budgetName.replace(/'/g, "\\'");

                graph.innerHTML = `<div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px;">
                        <span>${window.i18n.t('budget_expenses')} · <span class="privacy-blur" style="font-weight:600;">${formatCurrency(goal)}</span> ${window.i18n.t('budget_savings_goal')}</span>
                        <span class="privacy-blur">
                            <span style="color:#10b981;font-weight:600;">↑ ${formatCurrency(funded)}</span> ${window.i18n.t('budget_savings_funded')}
                            ${withdrawn > 0 ? ` · <span style="color:#ff5630;font-weight:600;">↓ ${formatCurrency(withdrawn)}</span> ${window.i18n.t('budget_savings_withdrawn')}` : ''}
                        </span>
                    </div>
                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">
                        <div style="position:absolute;top:0;left:0;width:${pct}%;height:100%;background:${barColor};border-radius:999px;transition:width 0.5s ease;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;">
                        <span class="privacy-blur" style="color:${barColor};font-weight:600;">${formatCurrency(balance)} ${window.i18n.t('budget_savings_balance')}</span>
                        <span style="color:${goalReached ? '#f59e0b' : 'var(--text-muted)'};font-weight:600;">${goalReached ? '🎯 ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(goal - balance))}</span> ${goalReached ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                    </div>
                </div>
                <div style="display:flex;gap:8px;align-items:center;padding:12px;background:var(--bg-surface);border:1px solid rgba(245,158,11,0.3);border-radius:8px;flex-wrap:wrap;margin-bottom:8px;">
                    <input type="number" id="detailAllocAmount" class="inline-input" placeholder="${window.i18n.t('budget_savings_add_placeholder')}" step="0.01" style="width:100px;font-size:12px;padding:6px 10px;border-radius:6px;">
                    <input type="text" id="detailAllocNote" class="inline-input" placeholder="${window.i18n.t('budget_savings_note_placeholder')}" style="flex:1;min-width:120px;font-size:12px;padding:6px 10px;border-radius:6px;">
                    <button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocationFromDetail(${budgetId}, 1, '${safeName}', ${year}, ${month})">↑ ${window.i18n.t('budget_savings_deposit')}</button>
                    <button class="btn btn-secondary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocationFromDetail(${budgetId}, -1, '${safeName}', ${year}, ${month})">↓ ${window.i18n.t('budget_savings_withdrawal')}</button>
                </div>`;

                // Merge txs and allocs into a single list sorted by date
                const items = [];
                for (const tx of txs) {
                    items.push({
                        type: 'tx', date: tx.date, description: tx.description, amount: tx.amount,
                        isIncome: tx.is_income, category: tx.category, isReconciled: tx.is_reconciled
                    });
                }
                for (const a of allocs) {
                    items.push({
                        type: 'alloc', id: a.id, date: a.date, description: a.note || (a.amount > 0 ? window.i18n.t('budget_savings_deposit') : window.i18n.t('budget_savings_withdrawal')),
                        amount: Math.abs(a.amount), isIncome: a.amount > 0
                    });
                }
                items.sort((a, b) => b.date.localeCompare(a.date));

                if (items.length === 0) {
                    list.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">${window.i18n.t('budget_no_operations')}</p>`;
                } else {
                    list.innerHTML = `<h4 style="margin:0 0 10px;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">${window.i18n.tp('budget_operations_count', {count: items.length})}</h4>` +
                        items.map(it => `
                        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);flex-wrap:wrap;${it.isReconciled ? 'opacity:0.55;' : ''}">
                            <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${it.date}</span>
                            <span style="flex:1;font-size:12px;min-width:100px;">
                                ${it.type === 'alloc' ? '💰 ' : ''}${it.description}
                                ${it.isReconciled ? `<span style="font-size:10px;color:var(--text-muted);font-style:italic;margin-left:8px;">${window.i18n.t('budget_reconciled_label')}</span>` : ''}
                            </span>
                            ${it.category ? `<span style="background:var(--bg-base);padding:1px 5px;border-radius:4px;font-size:10px;color:var(--text-muted);">${it.category}</span>` : ''}
                            <span class="privacy-blur" style="font-size:13px;font-weight:600;color:${it.isIncome ? '#10b981' : '#ff5630'};white-space:nowrap;">
                                ${it.isIncome ? '↑ +' : '↓ -'}${formatCurrency(it.amount)}
                            </span>
                            ${it.type === 'alloc' ? `<button class="btn btn-secondary" style="padding:2px 6px;font-size:10px;" onclick="event.stopPropagation();window.BudgetsView.deleteAllocation(${budgetId},${it.id},'${budgetName}',${year},${month})">✕</button>` : ''}
                        </div>`).join('');
                }
                return;
            }

            // ── Standard spending detail ─────────────────────────────────
            if (!txs.length) {
                graph.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">${window.i18n.t('budget_no_operations')}</p>`;
                return;
            }

            // ── Bar chart (CSS-based, no lib needed) ────────────────────────
            const expenses = txs.filter(t => !t.is_income);
            const incomes  = txs.filter(t =>  t.is_income);
            const totalExp = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
            const totalRecExp = expenses.filter(t => t.is_reconciled).reduce((s, t) => s + Math.abs(t.amount), 0);
            const totalInc = incomes.reduce((s,  t) => s + Math.abs(t.amount), 0);
            const target   = budget?.budget_amount || 0;
            const maxVal   = Math.max(totalExp, totalInc, target, 1);


            const pct = target > 0 ? (totalRecExp / target) * 100 : 0;
            const recExpColor = pct > 100 ? '#ff5630' : pct >= 80 ? '#f59e0b' : '#10b981';

            // Build sublabel with income offset mention
            let expSublabel = `${formatCurrency(totalRecExp)} ${window.i18n.t('budget_reconciled')} / ${formatCurrency(totalExp)} ${window.i18n.t('budget_committed')}`;
            if (totalInc > 0) {
                expSublabel += ` · ↑ ${formatCurrency(totalInc)} ${window.i18n.t('budget_received')}`;
            }

            const expW = Math.max(0, Math.min(totalExp / maxVal * 100, 100));
            const recW = Math.max(0, Math.min(totalRecExp / maxVal * 100, 100));

            graph.innerHTML = `<div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px;">
                        <span>${window.i18n.t('budget_expenses')} · <span class="privacy-blur" style="font-weight:600;">${formatCurrency(target)}</span> ${window.i18n.t('budget_objective')}</span><span class="privacy-blur">${expSublabel}</span>
                    </div>
                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">
                        <div style="position:absolute;top:0;left:0;width:${expW}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;"></div>
                        <div style="position:absolute;top:0;left:0;width:${recW}%;height:100%;background:${recExpColor};border-radius:999px;"></div>
                    </div>
                </div>`;

            // ── Transactions list ─────────────────────────────────────────
            list.innerHTML = `<h4 style="margin:0 0 10px;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">${window.i18n.tp('budget_operations_count', {count: txs.length})}</h4>` +
                txs.map(tx => `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);flex-wrap:wrap;${tx.is_reconciled ? 'opacity:0.55;' : ''}">
                    <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${tx.date}</span>
                    <span style="flex:1;font-size:12px;min-width:100px;">
                        ${tx.description}
                        ${tx.is_reconciled ? `<span style="font-size:10px;color:var(--text-muted);font-style:italic;margin-left:8px;">${window.i18n.t('budget_reconciled_label')}</span>` : ''}
                    </span>
                    ${tx.category ? `<span style="background:var(--bg-base);padding:1px 5px;border-radius:4px;font-size:10px;color:var(--text-muted);">${tx.category}</span>` : ''}
                    <span class="privacy-blur" style="font-size:13px;font-weight:600;color:${tx.is_income ? '#10b981' : '#ff5630'};white-space:nowrap;">
                        ${tx.is_income ? '+' : ''}${formatCurrency(tx.amount)}
                    </span>
                </div>`).join('');
        } catch(e) {
            graph.innerHTML = `<p style="color:#ff5630;">${window.i18n.t('title_error')} : ${e.message}</p>`;
        }
    },

    showAddForm() {
        document.getElementById('budgetUnifiedTitle').textContent = window.i18n.t('budget_new');
        document.getElementById('budgetUnifiedEditBtn').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        
        document.getElementById('budgetEditId').value = '';
        document.getElementById('newBudgetName').value = '';
        document.getElementById('newBudgetAmount').value = '';
        document.getElementById('newBudgetPeriod').value = 'monthly';
        document.getElementById('newBudgetStartDate').value = '';
        document.getElementById('newBudgetEndDate').value = '';
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = 'none';
        document.getElementById('budgetTypeCategory').checked = true;
        this.toggleType();
        this.renderAccountCheckboxes([]);
        this.renderCatCheckboxes([]);
        
        document.getElementById('budgetFormSection').style.display = 'block';
        document.getElementById('budgetUnifiedModal').style.display = 'flex';
    },

    closeUnifiedModal() {
        document.getElementById('budgetUnifiedModal').style.display = 'none';
        document.getElementById('budgetFormSection').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        this._directEdit = false;
    },
    
    hideEditSection() {
        if (!document.getElementById('budgetEditId').value || this._directEdit) {
            // Adding new OR direct edit → close the whole modal
            this.closeUnifiedModal();
        } else {
            // Editing from detail view → just hide the form, show detail again
            document.getElementById('budgetFormSection').style.display = 'none';
            document.getElementById('budgetDetailSection').style.display = 'block';
        }
    },

    showEditSection() {
        this._directEdit = false; // Opened from detail view
        const id = document.getElementById('budgetEditId').value;
        const b = this.budgets.find(x => x.id == id);
        if (!b) return;

        document.getElementById('newBudgetName').value = b.name;
        document.getElementById('newBudgetAmount').value = b.monthly_amount;
        document.getElementById('newBudgetPeriod').value = b.period;
        document.getElementById('newBudgetStartDate').value = b.start_date || '';
        document.getElementById('newBudgetEndDate').value = b.end_date || '';
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = b.period === 'custom' ? 'block' : 'none';

        if (b.is_project) {
            document.getElementById('budgetTypeProject').checked = true;
        } else {
            document.getElementById('budgetTypeCategory').checked = true;
        }
        this.toggleType();
        this.renderAccountCheckboxes(b.account_ids || []);
        this.renderCatCheckboxes(b.categories || []);

        document.getElementById('budgetFormSection').style.display = 'block';
        
        // Scroll down inside the modal safely
        setTimeout(() => {
            const modalContent = document.querySelector('#budgetUnifiedModal .modal');
            if (modalContent) {
                modalContent.scrollTo({ top: modalContent.scrollHeight, behavior: 'smooth' });
            }
        }, 50);
    },

    editBudget(id) {
        const b = this.budgets.find(x => x.id === id);
        if (!b) return;

        this._directEdit = true; // Flag: opened directly, not from detail view
        document.getElementById('budgetUnifiedTitle').textContent = window.i18n.t('budget_edit_envelope');
        document.getElementById('budgetUnifiedEditBtn').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        document.getElementById('budgetEditId').value = id;
        
        document.getElementById('newBudgetName').value = b.name;
        document.getElementById('newBudgetAmount').value = b.monthly_amount;
        document.getElementById('newBudgetPeriod').value = b.period;
        document.getElementById('newBudgetStartDate').value = b.start_date || '';
        document.getElementById('newBudgetEndDate').value = b.end_date || '';
        const customDates2 = document.getElementById('budgetCustomDates');
        if (customDates2) customDates2.style.display = b.period === 'custom' ? 'block' : 'none';

        if (b.is_project) {
            document.getElementById('budgetTypeProject').checked = true;
        } else if ((b.envelope_type || 'spending') === 'savings') {
            document.getElementById('budgetTypeSavings').checked = true;
        } else {
            document.getElementById('budgetTypeCategory').checked = true;
        }
        this.toggleType();
        this.renderAccountCheckboxes(b.account_ids || []);
        this.renderCatCheckboxes(b.categories || []);

        document.getElementById('budgetFormSection').style.display = 'block';
        document.getElementById('budgetUnifiedModal').style.display = 'flex';
    },

    async saveForm() {
        const id = document.getElementById('budgetEditId').value;
        const name = document.getElementById('newBudgetName').value.trim();
        const amount = parseFloat(document.getElementById('newBudgetAmount').value);
        const period = document.getElementById('newBudgetPeriod').value;
        const isProject = document.getElementById('budgetTypeProject').checked;
        const isSavings = document.getElementById('budgetTypeSavings')?.checked;
        const categories = (isProject || isSavings) ? [] : this.getSelectedCats();

        if (!name) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_name_required'));
        if (isNaN(amount) || amount < 0) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_invalid_amount'));

        const startDate = period === 'custom' ? (document.getElementById('newBudgetStartDate')?.value || null) : null;
        const endDate = period === 'custom' ? (document.getElementById('newBudgetEndDate')?.value || null) : null;
        if (period === 'custom' && (!startDate || !endDate)) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_custom_dates_required') || 'Veuillez sélectionner les dates de début et de fin.');
        
        const envelope_type = isSavings ? 'savings' : 'spending';
        const account_ids = window.app?.config?.enable_org_mode === 'true' ? this.getSelectedAccounts() : null;
        const payload = { name, monthly_amount: amount, period, is_project: isProject, categories, start_date: startDate, end_date: endDate, account_ids, envelope_type };

        try {
            let savedId = id;
            if (id) {
                await API.put(`/api/budgets/${id}`, payload);
            } else {
                const res = await API.post('/api/budgets/', payload);
                savedId = res.id;
            }
            
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();

            if (this._directEdit || !id) {
                // Cas 1: direct edit or new → close modal entirely
                this.closeUnifiedModal();
            } else {
                // Cas 2: edit from detail view → hide form, refresh detail
                document.getElementById('budgetFormSection').style.display = 'none';
                const y = this._currentDetailYear;
                const m = this._currentDetailMonth;
                if (y && m) {
                    await this.showDetail(parseInt(savedId), name, y, m);
                } else {
                    const monthVal = document.getElementById('budgetMonthInput')?.value || this.monthlyMonth;
                    if (monthVal) {
                        const [yyyy, mm] = monthVal.split('-');
                        await this.showDetail(parseInt(savedId), name, parseInt(yyyy), parseInt(mm));
                    }
                }
            }

            // Non-blocking toast
            showToast(id ? window.i18n.t('msg_envelope_updated') : window.i18n.t('msg_envelope_created'), 'success');
        } catch(e) {
            showToast(e.message || window.i18n.t('budget_ai_create_fail'), 'error', 5000);
        }
    },

    async updateAmount(id, val) {
        const amount = parseFloat(val);
        if (isNaN(amount) || amount < 0) return;
        try {
            await API.put(`/api/budgets/${id}`, { monthly_amount: amount });
            await this.loadStatus();
            window.app.refreshSidebar();
        } catch(e) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.tp('msg_update_error', {error: e.message}));
        }
    },

    async toggleClose(id) {
        const b = this.budgets.find(x => x.id === id);
        if (!b) return;
        const action = b.is_closed ? window.i18n.t('budget_reopen_action') : window.i18n.t('budget_close_action');
        if (!await showInlineConfirm(window.i18n.t('title_confirmation'), window.i18n.tp('budget_confirm_toggle', {action}))) return;
        try {
            await API.put(`/api/budgets/${id}`, { is_closed: !b.is_closed });
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async deleteBudget(id) {
        if (!await showInlineConfirm(window.i18n.t('title_deletion'), window.i18n.t('confirm_delete_envelope'))) return;
        try {
            await API.del(`/api/budgets/${id}`);
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
        } catch(e) {
            showInlineMessage(window.i18n.t('title_info'), e.message);
        }
    },

    // ── Piggy Bank (Tirelire) methods ─────────────────────────────────────────

    showAllocationForm(budgetId) {
        // Remove any existing allocation form
        const existing = document.getElementById('allocationInlineForm');
        if (existing) existing.remove();

        const card = document.querySelector(`[data-budget-id="${budgetId}"]`);
        if (!card) return;

        const form = document.createElement('div');
        form.id = 'allocationInlineForm';
        form.style.cssText = 'display:flex;gap:8px;align-items:center;padding:12px;margin-top:8px;background:var(--bg-surface);border:1px solid rgba(245,158,11,0.3);border-radius:8px;flex-wrap:wrap;';
        form.onclick = (e) => e.stopPropagation();
        form.innerHTML = `
            <input type="number" id="allocAmount" class="inline-input" placeholder="${window.i18n.t('budget_savings_add_placeholder')}" step="0.01" style="width:100px;font-size:12px;padding:4px 8px;border-radius:4px;">
            <input type="text" id="allocNote" class="inline-input" placeholder="${window.i18n.t('budget_savings_note_placeholder')}" style="flex:1;min-width:120px;font-size:12px;padding:4px 8px;border-radius:4px;">
            <button class="btn btn-primary" style="padding:4px 12px;font-size:11px;" onclick="window.BudgetsView.addAllocation(${budgetId}, 1)">↑ ${window.i18n.t('budget_savings_deposit')}</button>
            <button class="btn btn-secondary" style="padding:4px 12px;font-size:11px;" onclick="window.BudgetsView.addAllocation(${budgetId}, -1)">↓ ${window.i18n.t('budget_savings_withdrawal')}</button>
            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="document.getElementById('allocationInlineForm')?.remove()">✕</button>
        `;
        card.appendChild(form);
        document.getElementById('allocAmount')?.focus();
    },

    async addAllocation(budgetId, sign) {
        const amountInput = document.getElementById('allocAmount');
        const noteInput = document.getElementById('allocNote');
        const amount = parseFloat(amountInput?.value);
        if (isNaN(amount) || amount <= 0) return;

        try {
            await API.post(`/api/budgets/${budgetId}/allocations`, {
                amount: amount * sign,
                note: noteInput?.value || null,
                date: new Date().toISOString().split('T')[0],
            });
            document.getElementById('allocationInlineForm')?.remove();
            await this.loadStatus();
            window.app.refreshSidebar();
            showToast(sign > 0 ? `↑ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_deposit').toLowerCase()}` : `↓ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_withdrawal').toLowerCase()}`, 'success');
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async breakPiggyBank(id) {
        if (!await showInlineConfirm('🔨 ' + window.i18n.t('budget_savings_break_action'), window.i18n.t('budget_savings_break_confirm'))) return;
        try {
            await API.put(`/api/budgets/${id}`, { is_closed: true });
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            showToast('🏦 ' + window.i18n.t('budget_savings_broken'), 'success', 4000);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async deleteAllocation(budgetId, allocId, budgetName, year, month) {
        try {
            await API.del(`/api/budgets/${budgetId}/allocations/${allocId}`);
            await this.loadStatus();
            window.app.refreshSidebar();
            // Refresh detail view
            await this.showDetail(budgetId, budgetName, year, month);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async addAllocationFromDetail(budgetId, sign, budgetName, year, month) {
        const amountInput = document.getElementById('detailAllocAmount');
        const noteInput = document.getElementById('detailAllocNote');
        const amount = parseFloat(amountInput?.value);
        if (isNaN(amount) || amount <= 0) return;

        try {
            await API.post(`/api/budgets/${budgetId}/allocations`, {
                amount: amount * sign,
                note: noteInput?.value || null,
                date: new Date().toISOString().split('T')[0],
            });
            await this.loadStatus();
            window.app.refreshSidebar();
            showToast(sign > 0 ? `↑ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_deposit').toLowerCase()}` : `↓ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_withdrawal').toLowerCase()}`, 'success');
            // Refresh detail view in place
            await this.showDetail(budgetId, budgetName, year, month);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    // ── AI Suggestions ────────────────────────────────────────────────────────

    async requestAiSuggestions() {
        const btn = document.getElementById('budgetAiBtn');
        btn.disabled = true;
        btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg> ${window.i18n.t('budget_ai_analyzing')}`;
        try {
            const result = await API.post('/api/budgets/ai_suggest', {});
            this.renderAiProposals(result.proposals || []);
        } catch(e) {
            const msg = e.message || '';
            if (msg.includes('non activ') || msg.includes('400')) {
                showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_ai_not_enabled'));
            } else {
                showInlineMessage(window.i18n.t('title_error'), msg || window.i18n.t('budget_ai_error'));
            }
        } finally {
            btn.disabled = false;
            btn.textContent = window.i18n.t('budget_btn_suggestions');
        }
    },

    renderAiProposals(proposals) {
        const panel = document.getElementById('budgetAiPanel');
        const container = document.getElementById('budgetAiProposals');
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

        if (!proposals.length) {
            container.innerHTML = `<p style="color:var(--text-muted);">${window.i18n.t('budget_ai_no_proposals')}</p>`;
            return;
        }

        container.innerHTML = proposals.map((p, i) => `
            <div id="aiProposal_${i}" style="background:var(--bg-body);border:1px solid var(--border-color);border-radius:10px;padding:14px;">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;">
                    <div style="flex:1;">
                        <strong style="font-size:14px;">🎯 ${p.name}</strong>
                        <div style="font-size:12px;color:var(--text-muted);margin-top:4px;">${p.reason || ''}</div>
                        ${(p.categories || []).length ? `<div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${(p.categories).map(c => `<span style="background:var(--bg-surface);padding:2px 6px;border-radius:4px;font-size:10px;color:var(--text-muted);">${c}</span>`).join('')}</div>` : ''}
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                        <div style="font-size:18px;font-weight:700;color:var(--accent);">${formatCurrency(p.suggested_amount)}<span style="font-size:11px;font-weight:400;color:var(--text-muted);">${window.i18n.t('budget_ai_per_month')}</span></div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="btn btn-primary" style="flex:1;" onclick="window.BudgetsView.acceptProposal(${i}, ${JSON.stringify(p).replace(/"/g, '&quot;')})" data-i18n="btn_create_envelope">✅ Créer cette enveloppe</button>
                    <button class="btn btn-secondary" style="padding:6px 12px;" onclick="document.getElementById('aiProposal_${i}').style.display='none'">✕</button>
                </div>
            </div>
        `).join('');
    },

    async acceptProposal(idx, proposal) {
        const btn = document.querySelector(`#aiProposal_${idx} button.btn-primary`);
        if(btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('budget_ai_creating')}`;
        }

        try {
            await API.post('/api/budgets/', {
                name: proposal.name,
                monthly_amount: proposal.suggested_amount,
                period: 'monthly',
                is_project: false,
                categories: proposal.categories || [],
            });
            
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            
            if(btn) {
                btn.innerHTML = window.i18n.t('msg_envelope_created_badge');
                btn.style.backgroundColor = '#10b981';
                btn.style.borderColor = '#10b981';
                btn.style.color = 'white';
            }
            
            // Disappear after 2 seconds
            setTimeout(() => {
                const card = document.getElementById(`aiProposal_${idx}`);
                if (card) {
                    card.style.transition = 'opacity 0.4s ease';
                    card.style.opacity = '0';
                    setTimeout(() => card.style.display = 'none', 400);
                }
            }, 2000);
            
        } catch(e) {
            if(btn) {
                btn.disabled = false;
                btn.innerHTML = window.i18n.t('budget_ai_create_error');
            }
            showInlineMessage(window.i18n.t('title_error'), e.message || window.i18n.t('budget_ai_create_fail'));
        }
    },

    closeAiPanel() {
        document.getElementById('budgetAiPanel').style.display = 'none';
    },
};


