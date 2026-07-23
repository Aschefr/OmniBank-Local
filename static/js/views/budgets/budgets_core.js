// static/js/views/budgets/budgets_core.js
// Enveloppes Budgétaires v2 — Core State, API Data Loading & Period Navigation

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
    budgets: [],
    categories: [],
    statusData: null,
    capacityData: null,
    aiEnabled: false,
    _directEdit: false, // true when modal was opened directly in edit mode (not via detail)
    customPeriod: { enabled: false, start: null, end: null }, // custom period with toggle
    selectedCategories: [], // Persistent state for category selection during edits
    statusByType: { monthly: null, yearly: null, indefinite: null, custom: null },
    savingsOverflow: null,

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
        this.savingsOverflow = null; // Loaded from dashboard for overflow visual

        // Inject initial loading spinner while fetching all budgets/stats
        const container = document.getElementById('budgetStatusContainer');
        if (container) {
            container.innerHTML = `
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; padding:60px 20px; gap:16px; color:var(--text-muted);">
                    <div style="width:40px; height:40px; border:3px solid rgba(99, 102, 241, 0.15); border-top-color:var(--accent); border-radius:50%; animation: importSpin 0.8s linear infinite;"></div>
                    <span style="font-size:14px; font-weight:600; color:var(--text-main); animation: importPulse 1.8s ease-in-out infinite;" data-i18n="budget_loading">${window.i18n.t('budget_loading') || 'Chargement des budgets...'}</span>
                </div>
            `;
        }

        await Promise.all([this.loadBudgets(), this.loadAccounts(), this.loadCategories(), this.loadAllStatuses(), this.checkAI(), this.loadSavingsOverflow()]);
        // Re-render after all data is loaded to ensure this.accounts is available for colored badges
        this.renderStatus();
        this.checkAiTaskStatusOnMount();
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
        this.renderCatCheckboxes(this.selectedCategories);
    },

    getSelectedAccounts() {
        return [...document.querySelectorAll('input[name="budgetAccount"]:checked')].map(el => parseInt(el.value));
    },

    async onAccountChange(el) {
        if (el) {
            const accColor = el.dataset.color || 'var(--accent)';
            el.parentElement.style.borderColor = el.checked ? accColor : 'var(--border-color)';
            const nameSpan = el.parentElement.querySelector('div > span');
            if (nameSpan) {
                nameSpan.style.fontWeight = el.checked ? '600' : 'normal';
                nameSpan.style.color = el.checked ? accColor : 'inherit';
            }
        }
        await this.loadCategories();
    },

    getSelectedCats() {
        return [...document.querySelectorAll('input[name="budgetCat"]:checked')].map(el => el.value);
    },

    toggleCategorySelection(el) {
        el.parentElement.style.borderColor = el.checked ? 'var(--accent)' : 'var(--border-color)';
        const textSpan = el.parentElement.querySelector('span');
        if (textSpan) {
            textSpan.style.fontWeight = el.checked ? '600' : 'normal';
        }
        const catName = el.value;
        if (el.checked) {
            if (!this.selectedCategories.includes(catName)) {
                this.selectedCategories.push(catName);
            }
        } else {
            this.selectedCategories = this.selectedCategories.filter(c => c !== catName);
        }
    },

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
        return url;
    },

    async loadAllStatuses() {
        try {
            const [monthly, yearly, indefinite, custom, capacity] = await Promise.all([
                API.get(this._buildStatusUrl('monthly')),
                API.get(this._buildStatusUrl('yearly')),
                API.get(this._buildStatusUrl('indefinite')),
                API.get(this._buildStatusUrl('custom')),
                API.get('/api/budgets/capacity'),
            ]);
            this.statusByType = { monthly, yearly, indefinite, custom };
            this.capacityData = capacity;
            this._mergeStatusData();
            this.renderStatus();
        } catch(e) {
            const container = document.getElementById('budgetStatusContainer');
            if (container) {
                container.innerHTML = `<p style="color:#ff5630;">${window.i18n.t('title_error')} : ${e.message}</p>`;
            }
        }
    },

    async loadStatusForType(type) {
        try {
            const [status, capacity] = await Promise.all([
                API.get(this._buildStatusUrl(type)),
                API.get('/api/budgets/capacity')
            ]);
            this.statusByType[type] = status;
            this.capacityData = capacity;
            this._mergeStatusData();
            this.renderStatus();
        } catch(e) {
            console.error(`[budget] Error loading ${type}`, e);
        }
    },

    _mergeStatusData() {
        const allBudgets = [];
        for (const type of ['monthly', 'yearly', 'indefinite', 'custom']) {
            const data = this.statusByType[type];
            if (data?.budgets) allBudgets.push(...data.budgets);
        }
        this.statusData = { budgets: allBudgets };
    },

    async loadStatus() {
        await Promise.all([
            this.loadAllStatuses(),
            this.loadSavingsOverflow()
        ]);
    },

    async loadSavingsOverflow() {
        try {
            const dash = await API.get('/api/stats/dashboard');
            this.savingsOverflow = dash.savings_overflow || null;
        } catch(e) {
            console.warn('[budget] Could not load savings overflow data', e);
            this.savingsOverflow = null;
        }
    },

    toggleCapacityPanel(checked) {
        localStorage.setItem('show_budget_capacity_panel', checked ? 'true' : 'false');
        this.renderStatus();
    }
});
