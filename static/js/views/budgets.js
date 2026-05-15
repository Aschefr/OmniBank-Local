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
                    <div style="display:flex;align-items:center;gap:0;">
                        <button class="btn btn-secondary" style="padding:6px 10px;font-size:14px;border-radius:8px 0 0 8px;border-right:none;" onclick="window.BudgetsView.stepMonth(-1)" title="${window.i18n.t('tooltip_prev_month') || 'Mois précédent'}">◀</button>
                        <input type="month" id="budgetMonth" class="inline-input" style="min-width:140px;border-radius:0;" onchange="window.BudgetsView.loadStatus()">
                        <button class="btn btn-secondary" style="padding:6px 10px;font-size:14px;border-radius:0 8px 8px 0;border-left:none;" onclick="window.BudgetsView.stepMonth(1)" title="${window.i18n.t('tooltip_next_month') || 'Mois suivant'}">▶</button>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;">
                            <div style="position:relative;width:36px;height:20px;">
                                <input type="checkbox" id="budgetCustomPeriodToggle" class="global-toggle" style="opacity:0;width:0;height:0;position:absolute;" onchange="window.BudgetsView.onCustomPeriodToggle(this.checked)">
                                <span class="slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:var(--border-color);transition:.4s;border-radius:34px;"></span>
                                <span class="slider-knob" style="position:absolute;height:14px;width:14px;left:3px;bottom:3px;background-color:white;transition:.4s;border-radius:50%;"></span>
                            </div>
                            <span data-i18n="budget_custom_period">${window.i18n.t('budget_custom_period') || 'Période'}</span>
                        </label>
                        <div id="budgetCustomPeriodInputs" style="display:none;align-items:center;gap:4px;">
                            <input type="date" id="budgetCustomStart" class="inline-input" style="width:145px;" onchange="window.BudgetsView.onCustomPeriodChange()">
                            <span style="color:var(--text-muted);font-size:11px;">→</span>
                            <input type="date" id="budgetCustomEnd" class="inline-input" style="width:145px;" onchange="window.BudgetsView.onCustomPeriodChange()">
                        </div>
                    </div>
                    <button class="btn btn-secondary" style="padding:6px 12px;font-size:12px;white-space:nowrap;" onclick="window.BudgetsView.goToday()" data-i18n="btn_today">${window.i18n.t('btn_today')}</button>
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
        document.getElementById('budgetMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;

        // Restore custom period from localStorage
        const savedEnabled = localStorage.getItem('budget_custom_enabled') === 'true';
        const savedStart = localStorage.getItem('budget_custom_start');
        const savedEnd   = localStorage.getItem('budget_custom_end');
        this.customPeriod = { enabled: savedEnabled, start: savedStart, end: savedEnd };

        // Apply toggle state to UI
        const toggle = document.getElementById('budgetCustomPeriodToggle');
        const inputs = document.getElementById('budgetCustomPeriodInputs');
        const monthControls = document.querySelector('#budgetMonth')?.parentElement;
        if (toggle && savedEnabled) {
            toggle.checked = true;
            if (inputs) inputs.style.display = 'flex';
            if (monthControls) monthControls.style.opacity = '0.4';
            if (monthControls) monthControls.style.pointerEvents = 'none';
            if (savedStart) document.getElementById('budgetCustomStart').value = savedStart;
            if (savedEnd)   document.getElementById('budgetCustomEnd').value   = savedEnd;
        }
        // Default dates if enabled but no dates saved
        if (savedEnabled && !savedStart) {
            const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0);
            const endDay = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
            document.getElementById('budgetCustomStart').value = firstDay;
            document.getElementById('budgetCustomEnd').value   = endDay;
            this.customPeriod.start = firstDay;
            this.customPeriod.end = endDay;
        }

        await Promise.all([this.loadBudgets(), this.loadAccounts(), this.loadCategories(), this.loadStatus(), this.checkAI()]);
    },

    stepMonth(delta) {
        const input = document.getElementById('budgetMonth');
        if (!input?.value) return;
        const [y, m] = input.value.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        input.value = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        this.loadStatus();
    },

    goToday() {
        const now = new Date();
        document.getElementById('budgetMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        this.loadStatus();
    },

    onCustomPeriodToggle(enabled) {
        this.customPeriod.enabled = enabled;
        localStorage.setItem('budget_custom_enabled', enabled);
        const inputs = document.getElementById('budgetCustomPeriodInputs');
        const monthControls = document.querySelector('#budgetMonth')?.parentElement;
        if (inputs) inputs.style.display = enabled ? 'flex' : 'none';
        if (monthControls) {
            monthControls.style.opacity = enabled ? '0.4' : '1';
            monthControls.style.pointerEvents = enabled ? 'none' : 'auto';
        }

        if (enabled && !this.customPeriod.start) {
            // Default: first to last day of current month
            const now = new Date();
            const firstDay = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
            const lastDay = new Date(now.getFullYear(), now.getMonth()+1, 0);
            const endDay = `${lastDay.getFullYear()}-${String(lastDay.getMonth()+1).padStart(2,'0')}-${String(lastDay.getDate()).padStart(2,'0')}`;
            document.getElementById('budgetCustomStart').value = firstDay;
            document.getElementById('budgetCustomEnd').value   = endDay;
            this.customPeriod.start = firstDay;
            this.customPeriod.end = endDay;
            localStorage.setItem('budget_custom_start', firstDay);
            localStorage.setItem('budget_custom_end', endDay);
        }
        this.loadStatus();
    },

    onCustomPeriodChange() {
        const start = document.getElementById('budgetCustomStart')?.value || null;
        const end   = document.getElementById('budgetCustomEnd')?.value   || null;
        this.customPeriod.start = start;
        this.customPeriod.end = end;
        if (start) localStorage.setItem('budget_custom_start', start);
        if (end)   localStorage.setItem('budget_custom_end',   end);
        this.loadStatus();
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
            return `
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;background:var(--bg-surface);padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'};transition:all 0.2s;">
                    <input type="checkbox" name="budgetAccount" value="${a.id}" ${isSelected ? 'checked' : ''} onchange="window.BudgetsView.onAccountChange(this)">
                    <div style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
                        <span style="font-weight:${isSelected ? '600' : 'normal'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${a.name}">${a.name}</span>
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
            el.parentElement.style.borderColor = el.checked ? 'var(--accent)' : 'var(--border-color)';
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
        const catSection = document.getElementById('budgetCatSection');
        if (catSection) catSection.style.display = isProject ? 'none' : 'block';

        const tabCat = document.getElementById('tabLabelCat');
        const tabProj = document.getElementById('tabLabelProj');
        if (tabCat && tabProj) {
            if (isProject) {
                tabProj.style.background = 'var(--bg-surface)';
                tabProj.style.fontWeight = '700';
                tabProj.style.color = 'var(--accent)';
                tabProj.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
                tabCat.style.background = 'transparent';
                tabCat.style.fontWeight = 'normal';
                tabCat.style.color = 'inherit';
                tabCat.style.boxShadow = 'none';
            } else {
                tabCat.style.background = 'var(--bg-surface)';
                tabCat.style.fontWeight = '700';
                tabCat.style.color = 'var(--accent)';
                tabCat.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
                tabProj.style.background = 'transparent';
                tabProj.style.fontWeight = 'normal';
                tabProj.style.color = 'inherit';
                tabProj.style.boxShadow = 'none';
            }
        }
    },

    async loadStatus() {
        if (this.customPeriod.enabled && this.customPeriod.start && this.customPeriod.end) {
            // Custom date range (day granularity)
            await this._loadStatusCustomPeriod(this.customPeriod.start, this.customPeriod.end);
        } else {
            const monthVal = document.getElementById('budgetMonth')?.value;
            if (!monthVal) return;
            const [y, m] = monthVal.split('-');
            try {
                this.statusData = await API.get(`/api/budgets/status?year=${y}&month=${m}`);
                this.renderStatus();
            } catch(e) {
                document.getElementById('budgetStatusContainer').innerHTML =
                    `<p style="color:#ff5630;">${window.i18n.t('title_error')} : ${e.message}</p>`;
            }
        }
    },

    async _loadStatusCustomPeriod(start, end) {
        // Single API call with date_start/date_end (day granularity)
        if (!start || !end) return;
        try {
            this.statusData = await API.get(`/api/budgets/status?date_start=${start}&date_end=${end}`);
            this.renderStatus();
        } catch(e) {
            document.getElementById('budgetStatusContainer').innerHTML =
                `<p style="color:#ff5630;">${window.i18n.t('title_error')} : ${e.message}</p>`;
        }
    },

    renderStatus() {
        const container = document.getElementById('budgetStatusContainer');
        if (!this.statusData || this.statusData.budgets.length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);padding:10px 0;">${window.i18n.t('budget_no_active')}</p>`;
            return;
        }

        const monthVal = document.getElementById('budgetMonth')?.value || '';
        const [y, m] = monthVal.split('-');
        const label = new Date(parseInt(y), parseInt(m)-1, 1).toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', {month:'long', year:'numeric'});

        // Group budgets by period
        const groups = {
            'monthly': { title: window.i18n.t('period_monthly'), budgets: [] },
            'yearly': { title: window.i18n.t('period_yearly'), budgets: [] },
            'indefinite': { title: window.i18n.t('budget_period_indefinite'), budgets: [] },
            'custom': { title: window.i18n.t('budget_period_custom') || 'Défini dans le temps', budgets: [] }
        };

        for (const b of this.statusData.budgets) {
            if (groups[b.period]) {
                groups[b.period].budgets.push(b);
            } else {
                groups['monthly'].budgets.push(b);
            }
        }

        let fullHtml = '';

        // ── Helper: render a summary bar ──────────────────────────────────
        const renderSummaryBar = (titleText, subtitleText, budgetsList, accentColor) => {
            let totalTarget = 0, totalSpent = 0, totalRecSpent = 0;
            for (const b of budgetsList) {
                totalTarget += b.budget_amount;
                totalSpent += b.spent;
                totalRecSpent += b.reconciled_spent || 0;
            }
            const totalPct = totalTarget > 0 ? Math.min((totalSpent / totalTarget) * 100, 100) : 0;
            const recPct = totalTarget > 0 ? Math.min((totalRecSpent / totalTarget) * 100, 100) : 0;
            const totalBarColor = (totalTarget > 0 && (totalRecSpent / totalTarget) * 100 > 100) ? '#ff5630' : recPct >= 80 ? '#f59e0b' : '#10b981';
            const globalOver = totalSpent > totalTarget;
            const globalRemaining = totalTarget - totalSpent;
            const borderStyle = accentColor ? `border-left:3px solid ${accentColor};` : '';

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
                        <span class="privacy-blur" style="color:${totalBarColor};font-weight:600;">${formatCurrency(totalRecSpent)} ${window.i18n.t('budget_reconciled')}</span>
                        <span class="privacy-blur" style="color:var(--text-muted);font-size:12px;align-self:flex-end;">(${formatCurrency(totalSpent)} ${window.i18n.t('budget_committed')})</span>
                    </div>
                    <span style="color:${globalOver ? '#ff5630' : 'var(--text-muted)'};font-weight:600;">${globalOver ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(globalRemaining))}</span> ${globalOver ? window.i18n.t('budget_global_exceeded') : window.i18n.t('budget_global_remaining')}</span>
                </div>
            </div>`;
        };

        // ── Helper: render a single budget card ──────────────────────────
        const renderBudgetCard = (b) => {
            const pct = Math.min((b.spent / b.budget_amount) * 100 || 0, 100);
            const recPct = Math.min(b.reconciled_percent || 0, 100);
            const barColor = b.reconciled_percent > 100 ? '#ff5630' : b.reconciled_percent >= 80 ? '#f59e0b' : '#10b981';
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
                    return `<span style="background:${color}1a; color:${color}; border:1px solid ${color}33; padding:1px 5px; border-radius:4px; font-size:10px; font-weight:600;">${acc.name}</span>`;
                }).join(' ');
            }

            return `<div data-budget-id="${b.id}" onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})" style="background:var(--bg-body);border:1px solid ${overBudget ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'};border-radius:10px;padding:16px;cursor:pointer;transition:border-color 0.3s, box-shadow 0.3s;${closedStyle}" onmouseover="this.style.borderColor='rgba(99,102,241,0.5)'" onmouseout="this.style.borderColor='${overBudget ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}'">
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
                            <input type="number" class="inline-input" style="width:80px;text-align:right;padding:2px 6px;font-size:12px;border-radius:4px;" value="${b.budget_amount}" onchange="window.BudgetsView.updateAmount(${b.id}, this.value)"> €
                        </div>
                    </div>

                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:8px;overflow:hidden;margin-bottom:8px;border:1px solid rgba(255,255,255,0.05);">
                        <div style="position:absolute;top:0;left:0;width:${pct}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;"></div>
                        <div style="position:absolute;top:0;left:0;width:${recPct}%;height:100%;background:${barColor};border-radius:999px;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;flex-wrap:wrap;gap:4px;">
                        <div style="display:flex;flex-wrap:wrap;gap:8px;">
                            <span class="privacy-blur" style="color:${barColor};font-weight:600;">${formatCurrency(b.reconciled_spent || 0)} ${window.i18n.t('budget_reconciled')}</span>
                            <span class="privacy-blur" style="color:var(--text-muted);font-size:11px;align-self:flex-end;">(${formatCurrency(b.spent)} ${window.i18n.t('budget_committed')})</span>
                            ${incomeHtml}
                        </div>
                        <span style="color:${overBudget ? '#ff5630' : 'var(--text-muted)'}">${overBudget ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(b.remaining))}</span> ${overBudget ? window.i18n.t('budget_exceeded_label') : window.i18n.t('budget_remaining_label')}</span>
                    </div>
                </div>`;
        };

        // ── Main rendering loop ──────────────────────────────────────────
        const isOrgMode = window.app?.config?.enable_org_mode === 'true';

        for (const period of ['monthly', 'yearly', 'indefinite', 'custom']) {
            const group = groups[period];
            if (group.budgets.length === 0) continue;

            let html = `<div style="margin-bottom:40px;">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--text-color);border-bottom:1px solid var(--border-color);padding-bottom:8px;">${window.i18n.t('budget_envelopes_title')} — ${group.title}</h3>`;

            // Sub-group budgets by account scope (Org Mode) or keep flat
            const hasAnyAccountScope = isOrgMode && group.budgets.some(b => b.account_ids && b.account_ids.length > 0);

            if (hasAnyAccountScope) {
                // Build sub-groups: key = sorted account_ids joined, or '__global__'
                const subGroups = {};
                for (const b of group.budgets) {
                    const key = (b.account_ids && b.account_ids.length > 0) ? [...b.account_ids].sort((a2,b2) => a2 - b2).join(',') : '__global__';
                    if (!subGroups[key]) subGroups[key] = [];
                    subGroups[key].push(b);
                }

                // Render each sub-group with its own summary
                for (const [key, budgets] of Object.entries(subGroups)) {
                    let subTitle, accentColor;
                    if (key === '__global__') {
                        subTitle = `${window.i18n.t('budget_summary_global')} — ${group.title}`;
                        accentColor = null;
                    } else {
                        const accNames = key.split(',').map(id => {
                            const acc = this.accounts?.find(a => a.id === parseInt(id));
                            return acc ? acc.name : `#${id}`;
                        });
                        const firstAcc = this.accounts?.find(a => a.id === parseInt(key.split(',')[0]));
                        accentColor = firstAcc?.color || 'var(--accent)';
                        subTitle = accNames.join(' + ');
                    }

                    html += renderSummaryBar(subTitle, label, budgets, accentColor);
                    html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-bottom:24px;">`;
                    for (const b of budgets) html += renderBudgetCard(b);
                    html += '</div>';
                }
            } else {
                // No account scoping → single summary for the whole period group (original behavior)
                html += renderSummaryBar(`${window.i18n.t('budget_summary_global')} — ${group.title}`, label, group.budgets, null);
                html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">`;
                for (const b of group.budgets) html += renderBudgetCard(b);
                html += '</div>';
            }

            html += '</div>';
            fullHtml += html;
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
            const txs = await API.get(`/api/budgets/${budgetId}/transactions?year=${year}&month=${month}`);

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
            const budget   = this.statusData?.budgets.find(b => b.id === budgetId);
            const target   = budget?.budget_amount || 0;
            const maxVal   = Math.max(totalExp, totalInc, target, 1);

            const barHtml = (val, color, label, sublabel, recVal = null, recColor = null) => {
                const w = Math.max(0, Math.min(val / maxVal * 100, 100));
                let barContent = '';
                if (recVal !== null) {
                    const rw = Math.max(0, Math.min(recVal / maxVal * 100, 100));
                    barContent = `
                        <div style="position:absolute;top:0;left:0;width:${w}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;"></div>
                        <div style="position:absolute;top:0;left:0;width:${rw}%;height:100%;background:${recColor || color};border-radius:999px;"></div>
                    `;
                } else {
                    barContent = `<div style="position:absolute;top:0;left:0;width:${w}%;height:100%;background:${color};border-radius:999px;"></div>`;
                }
                
                return `<div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px;">
                        <span>${label}</span><span class="privacy-blur">${sublabel}</span>
                    </div>
                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">
                        ${barContent}
                    </div>
                </div>`;
            };

            const pct = target > 0 ? (totalRecExp / target) * 100 : 0;
            const recExpColor = pct > 100 ? '#ff5630' : pct >= 80 ? '#f59e0b' : '#10b981';

            graph.innerHTML =
                barHtml(totalExp, null, window.i18n.t('budget_expenses'), `${formatCurrency(totalRecExp)} ${window.i18n.t('budget_reconciled')} / ${formatCurrency(totalExp)} ${window.i18n.t('budget_committed')}`, totalRecExp, recExpColor) +
                (totalInc > 0 ? barHtml(totalInc, '#10b981', '↑ ' + window.app.getTypeLabel('income'), formatCurrency(totalInc)) : '') +
                barHtml(target, 'rgba(99,102,241,0.6)', window.i18n.t('budget_objective'), formatCurrency(target));

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
        const categories = isProject ? [] : this.getSelectedCats();

        if (!name) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_name_required'));
        if (isNaN(amount) || amount <= 0) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_invalid_amount'));

        const startDate = period === 'custom' ? (document.getElementById('newBudgetStartDate')?.value || null) : null;
        const endDate = period === 'custom' ? (document.getElementById('newBudgetEndDate')?.value || null) : null;
        if (period === 'custom' && (!startDate || !endDate)) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_custom_dates_required') || 'Veuillez sélectionner les dates de début et de fin.');
        
        const account_ids = window.app?.config?.enable_org_mode === 'true' ? this.getSelectedAccounts() : null;
        const payload = { name, monthly_amount: amount, period, is_project: isProject, categories, start_date: startDate, end_date: endDate, account_ids };

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
                const monthVal = document.getElementById('budgetMonth')?.value;
                if (monthVal) {
                    const [y, m] = monthVal.split('-');
                    await this.showDetail(parseInt(savedId), name, parseInt(y), parseInt(m));
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
        if (isNaN(amount)) return;
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


