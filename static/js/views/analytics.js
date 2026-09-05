// analytics.js — Synthèse Catégories × Mois (séparée par type) + totaux annuels
window.AnalyticsView = {
    data: null,
    months: null,
    reconciled: 'all',
    selectedYear: new Date().getFullYear(),
    selectedAccountIds: null,  // null = all accounts
    _catColWidth: null,        // persisted category column width (px)
    _resizing: false,
    customRange: { enabled: false, start: null, end: null },  // day-granularity custom period

    TYPE_CONFIG: {
        'expense_var': { emoji: '🛍️', color: '#f59e0b', sign: '-' },
        'expense_fixed': { emoji: '📋', color: '#ef4444', sign: '-' },
        'income': { emoji: '💰', color: '#10b981', sign: '+' },
        'transfer': { emoji: '🔁', color: '#6366f1', sign: '±' },
        'neutral': { emoji: '⚪', color: '#6b7280', sign: '' },
    },

    render() {
        return `
        <div style="padding:0;">
            <div class="view-header-bar">
                <div class="view-header-title-group">
                    <h2 class="view-header-title">📊 <span data-i18n="analytics_title">${window.i18n.t('analytics_title')}</span></h2>
                </div>
                <div class="view-header-toolbar">
                    <div class="filter-pill">
                        <span class="filter-pill-label">📅 <span data-i18n="budget_label_period">${window.i18n.t('budget_label_period')}</span></span>
                        <select id="analyticsPeriod" class="filter-pill-select" style="min-width:140px;" onchange="window.AnalyticsView.changeFilter('period', this.value)">
                            <option value="m3" data-i18n="analytics_rolling_3m">${window.i18n.t('analytics_rolling_3m')}</option>
                            <option value="m6" data-i18n="analytics_rolling_6m">${window.i18n.t('analytics_rolling_6m')}</option>
                            <option value="m12" data-i18n="analytics_rolling_12m">${window.i18n.t('analytics_rolling_12m')}</option>
                            <option value="m24" data-i18n="analytics_rolling_24m">${window.i18n.t('analytics_rolling_24m')}</option>
                            <option disabled data-i18n="analytics_years_separator">${window.i18n.t('analytics_years_separator')}</option>
                        </select>
                    </div>

                    <div class="filter-pill">
                        <span class="filter-pill-label">🔒 <span data-i18n="col_status">${window.i18n.t('col_status')}</span></span>
                        <select id="analyticsReconciled" class="filter-pill-select" style="min-width:140px;" onchange="window.AnalyticsView.changeFilter('reconciled', this.value)">
                            <option value="all" data-i18n="analytics_all_amounts">${window.i18n.t('analytics_all_amounts')}</option>
                            <option value="reconciled" data-i18n="analytics_reconciled_only">${window.i18n.t('analytics_reconciled_only')}</option>
                            <option value="unreconciled" data-i18n="analytics_unreconciled_only">${window.i18n.t('analytics_unreconciled_only')}</option>
                        </select>
                    </div>

                    <div style="position:relative; display:inline-block;">
                        <button id="analyticsYearsBtn" class="btn btn-secondary toolbar-btn" onclick="window.AnalyticsView.toggleYearsPopover(event)" data-i18n="analytics_btn_years">⚙️ Années</button>
                        <div id="analyticsYearsPopover" class="years-popover print-hide" style="display:none; position:absolute; right:0; top:calc(100% + 5px); background:var(--bg-surface); border:1px solid var(--border-color); border-radius:12px; box-shadow:var(--shadow-md); padding:12px; min-width:180px; z-index:2500; flex-direction:column; gap:8px; backdrop-filter:blur(12px);"></div>
                    </div>

                    <button class="btn btn-secondary toolbar-btn" onclick="window.AnalyticsView.showExportModal()" data-i18n-title="tooltip_export_pdf" title="Générer un PDF du rapport" data-i18n="btn_export_pdf">📥 Exporter en PDF</button>

                    <div id="analyticsCustomRangeWrapper" class="filter-pill" style="display:none;">
                        <label class="filter-pill-toggle">
                            <span data-i18n="analytics_custom_range_toggle">${window.i18n.t('analytics_custom_range_toggle') || 'Période'}</span>
                            <span class="toggle-switch">
                                <input type="checkbox" id="analyticsCustomRangeToggle" onchange="window.AnalyticsView.onCustomRangeToggle(this.checked)">
                                <span class="slider"></span>
                            </span>
                        </label>
                        <div id="analyticsCustomRangeInputs" style="display:none;align-items:center;gap:4px;margin-left:6px;">
                            <input type="date" id="analyticsCustomStart" class="inline-input" style="width:130px;height:28px;font-size:11px;padding:2px 6px;" onchange="window.AnalyticsView.onCustomRangeChange()">
                            <span style="color:var(--text-muted);font-size:11px;">→</span>
                            <input type="date" id="analyticsCustomEnd" class="inline-input" style="width:130px;height:28px;font-size:11px;padding:2px 6px;" onchange="window.AnalyticsView.onCustomRangeChange()">
                        </div>
                    </div>
                </div>
            </div>
            <div id="analyticsAccountBar" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap;margin-bottom:12px;"></div>
            <div id="analyticsContainer" style="overflow-x:auto;display:flex;flex-direction:column;gap:28px;">
                <div style="text-align:center;padding:40px;color:var(--text-muted);">Chargement…</div>
            </div>
        </div>`;
    },

    async init() {
        const savedReconciled = ProfileStorage.get('analytics_reconciled');
        if (savedReconciled) this.reconciled = savedReconciled;

        const savedPeriod = ProfileStorage.get('analytics_period');
        if (savedPeriod) {
            if (savedPeriod.startsWith('y')) {
                this.selectedYear = parseInt(savedPeriod.slice(1));
                this.months = null;
            } else if (savedPeriod.startsWith('m')) {
                this.selectedYear = null;
                this.months = parseInt(savedPeriod.slice(1));
            }
        }

        // Restore saved category column width
        const savedColWidth = ProfileStorage.get('analytics_cat_col_width');
        this._catColWidth = savedColWidth ? parseInt(savedColWidth) : 160;

        // Restore selected years
        let savedSelectedYears;
        try { savedSelectedYears = JSON.parse(ProfileStorage.get('analytics_years_totals')); } catch (e) { }
        if (Array.isArray(savedSelectedYears)) {
            this.selectedYears = savedSelectedYears.map(String);
        } else {
            this.selectedYears = null;
        }

        // Restore custom range state
        const crEnabled = ProfileStorage.get('analytics_custom_range_enabled') === 'true';
        const crStart = ProfileStorage.get('analytics_custom_range_start');
        const crEnd = ProfileStorage.get('analytics_custom_range_end');
        this.customRange = { enabled: crEnabled, start: crStart, end: crEnd };

        // Reset account filter (all selected)
        this.selectedAccountIds = null;

        // First load to discover available years, then populate selector
        await this.loadData();
        this.renderAccountBar();

        // Show custom period toggle only if org license is active
        try {
            const license = await window.LicenseManager.getStatus();
            const wrapper = document.getElementById('analyticsCustomRangeWrapper');
            if (wrapper && license.active) wrapper.style.display = 'flex';
        } catch (e) { /* no license module — keep hidden */ }
        // Apply custom range toggle state to UI
        const crToggle = document.getElementById('analyticsCustomRangeToggle');
        const crInputs = document.getElementById('analyticsCustomRangeInputs');
        const periodSel = document.getElementById('analyticsPeriod');
        if (crToggle && this.customRange.enabled) {
            crToggle.checked = true;
            if (crInputs) crInputs.style.display = 'flex';
            if (periodSel) periodSel.disabled = true;
            if (this.customRange.start) document.getElementById('analyticsCustomStart').value = this.customRange.start;
            if (this.customRange.end) document.getElementById('analyticsCustomEnd').value = this.customRange.end;
        }
    },

    async renderAccountBar() {
        const bar = document.getElementById('analyticsAccountBar');
        if (!bar) return;
        // Ensure accounts are loaded (may not be on F5 due to race with refreshSidebar)
        if (!window.app.accounts || window.app.accounts.length === 0) {
            try {
                window.app.accounts = await API.get('/api/stats/accounts');
            } catch (e) { /* silent */ }
        }
        const accounts = (window.app.accounts || []).filter(a => !a.is_closed);
        if (accounts.length <= 1) { bar.innerHTML = ''; return; }

        const allSelected = !this.selectedAccountIds;

        let html = `<button class="account-badge" style="cursor:pointer;font-size:12px;padding:4px 12px;
            background:${allSelected ? 'var(--accent)' : 'var(--bg-surface)'};
            color:${allSelected ? '#fff' : 'var(--text-muted)'};
            border:1px solid ${allSelected ? 'var(--accent)' : 'var(--border-color)'};"
            onclick="window.AnalyticsView.toggleAllAccounts()">${window.i18n.t('analytics_all_accounts')}</button>`;

        accounts.forEach(acc => {
            const c = acc.color || '#3366ff';
            const isActive = allSelected || (this.selectedAccountIds && this.selectedAccountIds.includes(acc.id));
            html += `<button class="account-badge" style="cursor:pointer;font-size:12px;padding:4px 12px;
                background:${isActive ? c + '20' : 'var(--bg-surface)'};
                color:${isActive ? c : 'var(--text-muted)'};
                border:1px solid ${isActive ? c + '60' : 'var(--border-color)'};
                opacity:${isActive ? '1' : '0.5'};"
                onclick="window.AnalyticsView.toggleAccount(${acc.id})">${acc.name}</button>`;
        });

        bar.innerHTML = html;
    },

    toggleAllAccounts() {
        this.selectedAccountIds = null;
        this.renderAccountBar();
        this.loadData();
    },

    toggleAccount(id) {
        const accounts = (window.app.accounts || []).filter(a => !a.is_closed);
        const allIds = accounts.map(a => a.id);

        if (!this.selectedAccountIds) {
            // Was "all" — select only this one
            this.selectedAccountIds = [id];
        } else if (this.selectedAccountIds.includes(id)) {
            // Deselect this account
            this.selectedAccountIds = this.selectedAccountIds.filter(i => i !== id);
            // If none left, go back to all
            if (this.selectedAccountIds.length === 0) this.selectedAccountIds = null;
        } else {
            // Add this account to selection
            this.selectedAccountIds.push(id);
            // If all are selected, switch to "all" mode
            if (this.selectedAccountIds.length >= allIds.length) this.selectedAccountIds = null;
        }

        this.renderAccountBar();
        this.loadData();
    },

    populatePeriodSelector() {
        const sel = document.getElementById('analyticsPeriod');
        if (!sel || !this.data) return;

        const years = (this.data.years || []).slice().reverse(); // most recent first
        // Remove old year options (keep first 4 rolling options + separator)
        while (sel.options.length > 5) sel.remove(5);

        years.forEach(yr => {
            const opt = document.createElement('option');
            opt.value = `y${yr}`;
            opt.textContent = window.i18n.tp('label_year', { year: yr });
            if (this.selectedYear === parseInt(yr)) opt.selected = true;
            sel.appendChild(opt);
        });

        // Restore current selection
        if (this.selectedYear) {
            sel.value = `y${this.selectedYear}`;
        } else if (this.months) {
            sel.value = `m${this.months}`;
        }

        const selRec = document.getElementById('analyticsReconciled');
        if (selRec) {
            selRec.value = this.reconciled;
        }
    },

    async changeFilter(key, val) {
        if (key === 'reconciled') {
            this.reconciled = val;
            ProfileStorage.set('analytics_reconciled', val);
        }
        if (key === 'period') {
            ProfileStorage.set('analytics_period', val);
            if (val.startsWith('y')) {
                this.selectedYear = parseInt(val.slice(1));
                this.months = null;
            } else if (val.startsWith('m')) {
                this.selectedYear = null;
                this.months = parseInt(val.slice(1));
            }
        }
        await this.loadData();
    },

    onCustomRangeToggle(enabled) {
        this.customRange.enabled = enabled;
        ProfileStorage.set('analytics_custom_range_enabled', enabled);
        const inputs = document.getElementById('analyticsCustomRangeInputs');
        const periodSel = document.getElementById('analyticsPeriod');
        if (inputs) inputs.style.display = enabled ? 'flex' : 'none';
        if (periodSel) periodSel.disabled = enabled;

        if (enabled) {
            if (!this.customRange.start) {
                // Default: first day of year to today
                const now = new Date();
                const startDate = `${now.getFullYear()}-01-01`;
                const endDate = now.toISOString().split('T')[0];
                this.customRange.start = startDate;
                this.customRange.end = endDate;
                ProfileStorage.set('analytics_custom_range_start', startDate);
                ProfileStorage.set('analytics_custom_range_end', endDate);
            }
            // Mettre à jour la valeur des inputs
            const startInput = document.getElementById('analyticsCustomStart');
            const endInput = document.getElementById('analyticsCustomEnd');
            if (startInput) startInput.value = this.customRange.start;
            if (endInput) endInput.value = this.customRange.end;
        }
        this.loadData();
    },

    onCustomRangeChange() {
        const start = document.getElementById('analyticsCustomStart')?.value || null;
        const end = document.getElementById('analyticsCustomEnd')?.value || null;
        // Validation : ne pas envoyer si l'une des dates est absente ou si end < start
        if (start && end) {
            if (start > end) {
                showToast(window.i18n.t('error_date_range_invalid') || 'End date must be after start date.', 'error');
                return;
            }
        }
        this.customRange.start = start;
        this.customRange.end = end;
        if (start) ProfileStorage.set('analytics_custom_range_start', start);
        if (end) ProfileStorage.set('analytics_custom_range_end', end);
        // Ne charger que si les deux dates sont présentes (sinon attendre la deuxième saisie)
        if (start && end) this.loadData();
    },

    async loadData() {
        try {
            let url = `/api/stats/categories_by_month?reconciled=${this.reconciled}`;
            if (this.selectedAccountIds) {
                url += `&account_ids=${this.selectedAccountIds.join(',')}`;
            }
            if (this.customRange.enabled && this.customRange.start && this.customRange.end) {
                url += `&date_start=${this.customRange.start}&date_end=${this.customRange.end}`;
            } else if (this.selectedYear) {
                url += `&year=${this.selectedYear}`;
            } else {
                url += `&months=${this.months}`;
            }
            this.data = await API.get(url);
            this.populatePeriodSelector();
            this.renderAll();
        } catch (e) {
            document.getElementById('analyticsContainer').innerHTML =
                `<p style="color:var(--color-expense);padding:20px;">${window.i18n.t('title_error')} : ${e.message}</p>`;
        }
    },

    formatShortMonth(mk) {
        const [y, m] = mk.split('-');
        const d = new Date(parseInt(y), parseInt(m) - 1, 1);
        return d.toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', { month: 'short', year: '2-digit' });
    },

    renderAll() {
        const container = document.getElementById('analyticsContainer');
        if (!this.data || !this.data.by_type || Object.keys(this.data.by_type).length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);padding:20px;">${window.i18n.t('analytics_no_data')}</p>`;
            return;
        }

        const { months, years, by_type } = this.data;
        const revYears = (years || []).slice().reverse();

        // Dynamically build and render years in the popover
        this.renderYearsPopover(revYears);

        const sections = [];
        for (const [txType, typeData] of Object.entries(by_type)) {
            sections.push(this.renderTypeTable(txType, typeData, months, revYears));
        }
        container.innerHTML = sections.join('');
    },

    renderTypeTable(txType, typeData, months, years, showInactive = false, forPrint = false) {
        const cfg = { ...(this.TYPE_CONFIG[txType] || { emoji: '•', color: 'var(--text-muted)', sign: '' }) };
        const savedColor = ProfileStorage.get('analytics_color_' + txType);
        if (savedColor) cfg.color = savedColor;
        const { categories, totals_per_cat, totals_per_month, grand_total, annual_by_cat, annual_totals_per_year, inactive_by_cat } = typeData;

        const isExpense = ['expense_fixed', 'expense_var'].includes(txType);
        const isIncome = txType === 'income';
        const translatedType = window.app.getTypeLabel(txType);

        // Load gradient setting (default is 1.0)
        const sliderVal = parseFloat(ProfileStorage.get('analytics_gradient_' + txType) || '1.0');
        const mappedVal = 2.0 - sliderVal;
        const p = this.mapSliderToExponent(mappedVal);
        const isProp = sliderVal >= 0.98 && sliderVal <= 1.02;
        let currentLabel = '';
        if (isProp) {
            currentLabel = window.i18n.t('analytics_gradient_prop') || 'Proportional';
        } else if (sliderVal > 1.02) {
            currentLabel = `${window.i18n.t('analytics_gradient_log') || 'Logarithmic'} (${p.toFixed(2)})`;
        } else {
            currentLabel = `${window.i18n.t('analytics_gradient_exp') || 'Exponential'} (${p.toFixed(2)})`;
        }

        // Max for heatmap
        let maxVal = 0;
        for (const cat of Object.keys(categories)) {
            for (const v of Object.values(categories[cat])) if (v > maxVal) maxVal = v;
        }

        const hb = `${cfg.color}22`;
        const hbd = `${cfg.color}44`;
        const annualSep = '3px solid rgba(255,255,255,0.15)';

        const displayYears = years.filter(yr => !this.selectedYears || this.selectedYears.includes(yr.toString()));

        // Catégories inactives : existantes dans l'historique global mais sans données sur la période filtrée.
        // Triées par total historique décroissant (même ordre que le backend).
        const inactiveCatEntries = Object.entries(inactive_by_cat || {});
        const hasInactive = inactiveCatEntries.length > 0;

        const monthHeaders = months.map(mk =>
            `<th data-year="${mk.split('-')[0]}" data-col-type="month" style="text-align:right;min-width:80px;white-space:nowrap;border-bottom:1px solid ${hbd};position:sticky;top:0;background:var(--bg-surface);z-index:20;">${this.formatShortMonth(mk)}</th>`
        ).join('');

        const yearHeaders = displayYears.map(yr =>
            `<th data-year="${yr}" data-col-type="year" style="text-align:right;min-width:90px;white-space:normal;line-height:1.2;padding-top:8px;padding-bottom:8px;border-left:${annualSep};border-bottom:1px solid ${hbd};color:var(--text-main);background:${hb};position:sticky;top:0;z-index:20;backdrop-filter:blur(5px);">TOT.<span class="year-br"></span>${yr}</th>`
        ).join('');

        const catW = this._catColWidth || 160;
        const catStyle = `text-align:left;width:${catW}px;min-width:60px;max-width:500px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid ${hbd};position:sticky;left:0;top:0;background:var(--bg-surface);z-index:20;box-shadow:3px 0 6px rgba(0,0,0,0.2);box-sizing:border-box;position:sticky;`;

        let html = `
        <div data-type="${txType}" style="border:1px solid ${hbd};border-radius:12px;display:flex;flex-direction:column;${forPrint ? '' : 'max-height:75vh;'}">
            <div style="background:${hb};padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${hbd};flex-shrink:0;flex-wrap:wrap;gap:8px;">
                <span style="font-weight:700;font-size:15px;color:var(--text-main);">${cfg.emoji} ${translatedType}</span>
                <div class="print-hide" style="display:flex;align-items:center;gap:18px;font-size:12px;color:var(--text-muted);user-select:none;">
                    <!-- Bloc Gradient -->
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span data-i18n="analytics_gradient_label">${window.i18n.t('analytics_gradient_label') || 'Gradient:'}</span>
                        <input type="range" min="0.0" max="2.0" value="${sliderVal}" step="0.01" style="width:95px;cursor:pointer;margin:0;" oninput="window.AnalyticsView.onGradientChange('${txType}', this.value)">
                        <span class="reset-gradient-btn" style="cursor:pointer;opacity:0.6;font-size:11px;transition:opacity 0.2s, visibility 0.2s;visibility:${isProp ? 'hidden' : 'visible'};" title="Réinitialiser (Proportionnel)" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" onclick="window.AnalyticsView.onGradientChange('${txType}', '1.0'); this.parentElement.querySelector('input[type=range]').value = '1.0';">↺</span>
                        <span class="gradient-label-value" style="font-weight:600;width:140px;flex-shrink:0;color:var(--text-muted);">${currentLabel}</span>
                    </div>
                    
                    <!-- Séparateur -->
                    <div style="width:1px;height:14px;background:var(--border-color);opacity:0.5;"></div>

                    <!-- Bloc Couleur -->
                    <div style="display:flex;align-items:center;gap:8px;">
                        <span data-i18n="analytics_color_label">${window.i18n.t('analytics_color_label') || 'Color:'}</span>
                        <input type="color" value="${cfg.color}" style="width:20px;height:20px;border:none;border-radius:50%;cursor:pointer;padding:0;background:none;outline:none;vertical-align:middle;box-shadow:var(--shadow-sm);" title="Changer la couleur du tableau" oninput="window.AnalyticsView.onColorChange('${txType}', this.value)">
                        <span class="reset-color-btn" style="cursor:pointer;opacity:0.6;font-size:11px;transition:opacity 0.2s, display 0.2s;display:${savedColor ? 'inline' : 'none'};" title="Restaurer la couleur par défaut" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" onclick="ProfileStorage.remove('analytics_color_${txType}'); window.AnalyticsView.renderAll();">⟲</span>
                    </div>
                </div>
                <span class="privacy-blur" style="font-size:13px;font-weight:600;color:var(--text-main);">${window.i18n.t('analytics_total_period')} : ${cfg.sign}${formatCurrency(grand_total)}</span>
                ${hasInactive ? `<button data-inactive-btn="${txType}" class="btn btn-secondary print-hide" style="font-size:11px;padding:3px 10px;opacity:0.7;border-style:dashed;" onclick="window.AnalyticsView.toggleInactiveRows('${txType}')" title="${window.i18n.t('analytics_inactive_cats_tooltip') || 'Catégories sans activité sur cette période — présentes dans l\'historique'}">👁 ${inactiveCatEntries.length} ${window.i18n.t('analytics_inactive_cats') || 'inactives'}</button>` : ''}
            </div>
            <div style="${forPrint ? '' : 'overflow:auto;'}flex-grow:1;border-bottom-left-radius:12px;border-bottom-right-radius:12px;">
            <table class="data-table" style="min-width:${220 + months.length * 80 + displayYears.length * 90}px;border-radius:0;border:none;margin:0;border-collapse:separate;border-spacing:0;">
            <thead><tr style="background:var(--bg-surface);">
                <th data-col-type="cat" style="${catStyle}position:relative;" data-i18n="analytics_th_category">${window.i18n.t('analytics_th_category')}<span class="col-resize-handle" onmousedown="window.AnalyticsView._startResize(event)"></span></th>
                ${monthHeaders}
                ${yearHeaders}
            </tr></thead>
            <tbody>`;

        for (const [cat, catData] of Object.entries(categories)) {
            const catTotal = totals_per_cat[cat] || 0;
            const annCat = (annual_by_cat || {})[cat] || {};

            const monthCells = months.map(mk => {
                const v = catData[mk] || 0;
                let intensity = 0;
                if (maxVal > 0 && v > 0) {
                    intensity = Math.pow(v / maxVal, p);
                }
                const alpha = Math.round(intensity * 0.55 * 100) / 100;
                const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
                const bg = v > 0 ? `${cfg.color}${alphaHex}` : 'transparent';
                return `<td data-year="${mk.split('-')[0]}" data-col-type="month" data-val="${v}" style="text-align:right;background:${bg};transition:opacity 0.2s;cursor:pointer;"
                    onclick="window.AnalyticsView.drillDown('${cat.replace(/'/g, "\\'")}','${mk}')"
                    title="🔍 ${cat} — ${this.formatShortMonth(mk)} — Voir les opérations">
                    <span class="privacy-blur">${v > 0 ? formatCurrency(v) : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</span>
                </td>`;
            }).join('');

            const yearCells = displayYears.map(yr => {
                const v = annCat[yr] || 0;
                return `<td data-year="${yr}" data-col-type="year" style="text-align:right;border-left:${annualSep};background:${hb};font-weight:500;cursor:pointer;"
                    onclick="window.AnalyticsView.drillDownYear('${cat.replace(/'/g, "\\'")}','${yr}')"
                    title="🔍 ${cat} — ${yr}">
                    <span class="privacy-blur">${v > 0 ? formatCurrency(v) : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</span>
                </td>`;
            }).join('');

            html += `<tr data-category="${cat.replace(/"/g, '&quot;')}">
                <td title="${cat.replace(/"/g, '&quot;')}" style="font-weight:500;width:${catW}px;min-width:60px;max-width:500px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:sticky;left:0;z-index:5;
                    background:var(--bg-surface);
                    box-shadow:3px 0 8px rgba(0,0,0,0.25);">${cat}</td>
                ${monthCells}
                ${yearCells}
            </tr>`;
        }

        // Lignes des catégories inactives (masquées par défaut, révélées par le bouton toggle)
        for (const [cat, annData] of inactiveCatEntries) {
            const monthCells = months.map(mk =>
                `<td data-year="${mk.split('-')[0]}" data-col-type="month" style="text-align:right;">
                    <span style="color:var(--text-muted);font-size:11px;">—</span>
                </td>`
            ).join('');
            const yearCells = displayYears.map(yr => {
                const v = annData[yr] || 0;
                return `<td data-year="${yr}" data-col-type="year" style="text-align:right;border-left:${annualSep};background:${hb};font-weight:500;cursor:pointer;"
                    onclick="window.AnalyticsView.drillDownYear('${cat.replace(/'/g, "\\'")}','${yr}')"
                    title="🔍 ${cat} — ${yr}">
                    <span class="privacy-blur">${v > 0 ? formatCurrency(v) : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</span>
                </td>`;
            }).join('');
            html += `<tr data-inactive="${txType}" data-category="${cat.replace(/"/g, '&quot;')}" style="display:${showInactive ? '' : 'none'};opacity:0.6;font-style:italic;">
                <td title="${cat.replace(/"/g, '&quot;')}" style="font-weight:400;width:${catW}px;min-width:60px;max-width:500px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:sticky;left:0;z-index:5;
                    background:var(--bg-surface);color:var(--text-muted);
                    box-shadow:3px 0 8px rgba(0,0,0,0.25);">${cat}</td>
                ${monthCells}
                ${yearCells}
            </tr>`;
        }

        // Total row
        const totalMonthCells = months.map(mk => {
            const v = totals_per_month[mk] || 0;
            return `<td data-year="${mk.split('-')[0]}" data-col-type="month" style="text-align:right;color:var(--text-main);background:${hb};position:sticky;bottom:0;z-index:20;border-top:2px solid ${hbd};backdrop-filter:blur(5px);"><span class="privacy-blur">${v > 0 ? formatCurrency(v) : '—'}</span></td>`;
        }).join('');

        const totalYearCells = displayYears.map(yr => {
            const v = (annual_totals_per_year || {})[yr] || 0;
            return `<td data-year="${yr}" data-col-type="year" style="text-align:right;border-left:${annualSep};color:var(--text-main);background:${hb};position:sticky;bottom:0;z-index:20;border-top:2px solid ${hbd};backdrop-filter:blur(5px);"><span class="privacy-blur">${v > 0 ? formatCurrency(v) : '—'}</span></td>`;
        }).join('');

        html += `<tr style="font-weight:700;">
            <td style="color:var(--text-main);font-weight:700;position:sticky;left:0;bottom:0;z-index:25;padding-left:16px;
                background:var(--bg-surface);border-top:2px solid ${hbd};
                box-shadow:inset 0 0 0 999px ${hb}, 3px 0 8px rgba(0,0,0,0.3);width:${catW}px;">TOT. ${translatedType.toUpperCase()}</td>
            ${totalMonthCells}
            ${totalYearCells}
        </tr>`;

        html += `</tbody></table></div></div>`;
        return html;
    },

    toggleInactiveRows(txType) {
        const rows = document.querySelectorAll(`tr[data-inactive="${txType}"]`);
        const btn = document.querySelector(`[data-inactive-btn="${txType}"]`);
        if (!rows.length) return;
        const isHidden = rows[0].style.display === 'none';
        rows.forEach(r => { r.style.display = isHidden ? '' : 'none'; });
        if (btn) {
            const count = rows.length;
            const label = window.i18n.t('analytics_inactive_cats') || 'inactives';
            if (isHidden) {
                btn.innerHTML = `🙈 ${count} ${label}`;
                btn.style.opacity = '1';
                btn.style.borderStyle = 'solid';
            } else {
                btn.innerHTML = `👁 ${count} ${label}`;
                btn.style.opacity = '0.7';
                btn.style.borderStyle = 'dashed';
            }
        }
    },

    drillDown(category, monthKey) {
        // Set pending filter before navigating
        window.AllOperationsView.pendingFilter = { category, monthKey, backToView: 'analytics' };
        window.app.loadView('all_operations');
    },

    drillDownYear(category, year) {
        window.AllOperationsView.pendingFilter = { category, monthKey: '', year, backToView: 'analytics' };
        window.app.loadView('all_operations');
    },

    mapSliderToExponent(s) {
        const val = parseFloat(s);
        if (val <= 1.0) {
            return 0.02 * Math.pow(50.0, val);
        } else {
            return 1.0 + (val - 1.0) * 2.0;
        }
    },

    onGradientChange(txType, value) {
        ProfileStorage.set('analytics_gradient_' + txType, value);
        
        const container = document.querySelector(`[data-type="${txType}"]`);
        if (!container) return;

        const sliderVal = parseFloat(value);
        const mappedVal = 2.0 - sliderVal;
        const p = this.mapSliderToExponent(mappedVal);
        let currentLabel = '';
        if (sliderVal >= 0.98 && sliderVal <= 1.02) {
            currentLabel = window.i18n.t('analytics_gradient_prop') || 'Proportional';
        } else if (sliderVal > 1.02) {
            currentLabel = `${window.i18n.t('analytics_gradient_log') || 'Logarithmic'} (${p.toFixed(2)})`;
        } else {
            currentLabel = `${window.i18n.t('analytics_gradient_exp') || 'Exponential'} (${p.toFixed(2)})`;
        }

        const labelEl = container.querySelector('.gradient-label-value');
        if (labelEl) {
            labelEl.textContent = currentLabel;
        }

        const resetBtn = container.querySelector('.reset-gradient-btn');
        if (resetBtn) {
            const isProp = sliderVal >= 0.98 && sliderVal <= 1.02;
            resetBtn.style.visibility = isProp ? 'hidden' : 'visible';
        }

        // Calculate maxVal
        const typeData = this.data?.by_type?.[txType];
        if (!typeData) return;
        const categories = typeData.categories || {};
        let maxVal = 0;
        for (const cat of Object.keys(categories)) {
            for (const v of Object.values(categories[cat])) if (v > maxVal) maxVal = v;
        }

        const savedColor = ProfileStorage.get('analytics_color_' + txType);
        const cfg = { ...(this.TYPE_CONFIG[txType] || { color: '#6b7280' }) };
        if (savedColor) cfg.color = savedColor;
        const cells = container.querySelectorAll('td[data-col-type="month"]');
        cells.forEach(td => {
            const v = parseFloat(td.getAttribute('data-val') || '0');
            if (v > 0 && maxVal > 0) {
                const intensity = Math.pow(v / maxVal, p);
                const alpha = Math.round(intensity * 0.55 * 100) / 100;
                const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
                const bg = `${cfg.color}${alphaHex}`;
                td.style.backgroundColor = bg;
            } else {
                td.style.backgroundColor = 'transparent';
            }
        });
    },

    onColorChange(txType, value) {
        ProfileStorage.set('analytics_color_' + txType, value);
        
        const container = document.querySelector(`[data-type="${txType}"]`);
        if (!container) return;

        const hb = value + '22';
        const hbd = value + '44';

        // 1. Container border
        container.style.borderColor = hbd;

        // 2. Header background & border-bottom
        const headerDiv = container.firstElementChild;
        if (headerDiv) {
            headerDiv.style.background = hb;
            headerDiv.style.borderBottomColor = hbd;
            
            // Title color (must remain var(--text-main))
            const titleSpan = headerDiv.firstElementChild;
            if (titleSpan) titleSpan.style.color = 'var(--text-main)';
            
            // Period total color (must remain var(--text-main))
            const totalSpan = headerDiv.querySelector('.privacy-blur');
            if (totalSpan) totalSpan.style.color = 'var(--text-main)';
            
            // Reset button & Label colors in header controls (must remain var(--text-muted))
            const gradientLabel = headerDiv.querySelector('.gradient-label-value');
            if (gradientLabel) gradientLabel.style.color = 'var(--text-muted)';
        }

        // 3. Table elements (th & td border bottom, annual column headers background, annual cells background)
        container.querySelectorAll('th, td').forEach(el => {
            if (el.style.borderBottomColor) {
                el.style.borderBottomColor = hbd;
            }
            if (el.getAttribute('data-col-type') === 'year') {
                el.style.color = 'var(--text-main)';
                el.style.background = hb;
            }
        });

        // 4. Total row top border and cell background
        const totalCells = container.querySelectorAll('tr:last-child td');
        totalCells.forEach(td => {
            td.style.borderTopColor = hbd;
            if (td.getAttribute('data-col-type') === 'month' || td.getAttribute('data-col-type') === 'year') {
                td.style.color = 'var(--text-main)';
                td.style.background = hb;
            }
        });
        const firstTotalTd = container.querySelector('tr:last-child td:first-child');
        if (firstTotalTd) {
            firstTotalTd.style.color = 'var(--text-main)';
            firstTotalTd.style.borderTopColor = hbd;
            firstTotalTd.style.boxShadow = `inset 0 0 0 999px ${hb}, 3px 0 8px rgba(0,0,0,0.3)`;
        }

        // 5. Month cells gradient background colors
        const sliderVal = parseFloat(ProfileStorage.get('analytics_gradient_' + txType) || '1.0');
        const mappedVal = 2.0 - sliderVal;
        const p = this.mapSliderToExponent(mappedVal);

        const typeData = this.data?.by_type?.[txType];
        if (!typeData) return;
        const categories = typeData.categories || {};
        let maxVal = 0;
        for (const cat of Object.keys(categories)) {
            for (const v of Object.values(categories[cat])) if (v > maxVal) maxVal = v;
        }

        const cells = container.querySelectorAll('td[data-col-type="month"]');
        cells.forEach(td => {
            const v = parseFloat(td.getAttribute('data-val') || '0');
            if (v > 0 && maxVal > 0) {
                const intensity = Math.pow(v / maxVal, p);
                const alpha = Math.round(intensity * 0.55 * 100) / 100;
                const alphaHex = Math.round(alpha * 255).toString(16).padStart(2, '0');
                td.style.backgroundColor = `${value}${alphaHex}`;
            } else {
                td.style.backgroundColor = 'transparent';
            }
        });

        // Show the reset color button dynamically
        const resetColorBtn = container.querySelector('.reset-color-btn');
        if (resetColorBtn) {
            resetColorBtn.style.display = 'inline';
        }
    },

    // ── Column resize logic ────────────────────────────────────────────
    _startResize(e) {
        e.preventDefault();
        this._resizing = true;
        const startX = e.clientX;
        const startW = this._catColWidth || 160;
        const handle = e.target;
        handle.classList.add('resizing');

        const onMove = (ev) => {
            if (!this._resizing) return;
            const newW = Math.max(60, Math.min(500, startW + ev.clientX - startX));
            this._catColWidth = newW;
            // Update all sticky category cells live
            document.querySelectorAll('[data-col-type="cat"], td:first-child').forEach(el => {
                el.style.width = newW + 'px';
            });
        };
        const onUp = () => {
            this._resizing = false;
            handle.classList.remove('resizing');
            ProfileStorage.set('analytics_cat_col_width', this._catColWidth);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    },

    showExportModal() {
        if (!this.data || !this.data.by_type) return;
        if (document.getElementById('exportPdfModal')) return;

        // Extract years safely as strings
        const yearsSet = new Set();
        (this.data.years || []).forEach(y => yearsSet.add(y.toString()));
        if (this.data.months) {
            this.data.months.forEach(m => yearsSet.add(m.split('-')[0]));
        }
        const availableYears = Array.from(yearsSet).sort().reverse();

        // Extract types and categories
        const types = Object.keys(this.data.by_type);
        const currentYear = (this.selectedYear || new Date().getFullYear()).toString();

        // Bug #3 : Calculer les dates de début/fin par défaut
        const hasCustomRange = this.customRange.enabled && this.customRange.start && this.customRange.end;
        let defaultStart, defaultEnd;
        if (hasCustomRange) {
            defaultStart = this.customRange.start;
            defaultEnd = this.customRange.end;
        } else if (this.selectedPeriod && this.selectedPeriod !== 'year') {
            const now = new Date();
            const pad = n => n < 10 ? '0' + n : '' + n;
            const toYMD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
            defaultEnd = toYMD(now);
            const rollMap = { m1: 1, m3: 3, m6: 6, m12: 12, m24: 24 };
            const months = rollMap[this.selectedPeriod] || 12;
            const start = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
            defaultStart = toYMD(start);
        } else {
            defaultStart = `${currentYear}-01-01`;
            defaultEnd = `${currentYear}-12-31`;
        }

        // Charger les préférences mémorisées
        const savedTabMode = ProfileStorage.get('print_settings_tab_mode') || (hasCustomRange ? 'custom' : 'year');
        this._exportTabMode = savedTabMode;

        const savedSelectedYear = ProfileStorage.get('print_settings_selected_year') || currentYear;
        const savedCustomStart = ProfileStorage.get('print_settings_custom_start') || defaultStart;
        const savedCustomEnd = ProfileStorage.get('print_settings_custom_end') || defaultEnd;

        let savedYearsTotals;
        try { savedYearsTotals = JSON.parse(ProfileStorage.get('analytics_years_totals')); } catch (e) { }
        if (!Array.isArray(savedYearsTotals)) {
            savedYearsTotals = [currentYear];
        }

        let savedTypes;
        try { savedTypes = JSON.parse(ProfileStorage.get('print_settings_types')); } catch (e) { }
        if (!Array.isArray(savedTypes)) savedTypes = types;

        let savedCats;
        try { savedCats = JSON.parse(ProfileStorage.get('print_settings_cats')); } catch (e) { }

        const colSettings = window.AllOperationsView ? window.AllOperationsView.getColSettings() :
            { date: true, desc: true, type: false, cat: true, amount: true, recon: true };

        let savedCols;
        try { savedCols = JSON.parse(ProfileStorage.get('print_settings_cols')); } catch (e) { }
        if (!Array.isArray(savedCols)) savedCols = Object.keys(colSettings).filter(k => colSettings[k]);

        const savedIncludeDetails = (ProfileStorage.get('print_sec_enabled_transactions_list') ?? ProfileStorage.get('print_settings_include_details')) !== 'false';
        const savedIncludePieChart = (ProfileStorage.get('print_sec_enabled_pie_chart') ?? ProfileStorage.get('print_settings_include_pie_chart')) !== 'false';
        const savedIncludeBarChart = (ProfileStorage.get('print_sec_enabled_bar_chart') ?? ProfileStorage.get('print_settings_include_bar_chart')) !== 'false';
        const savedIncludeSignature = (ProfileStorage.get('print_sec_enabled_signature') ?? ProfileStorage.get('print_settings_include_signature')) === 'true';
        const savedTitleFontSize = ProfileStorage.get('print_settings_title_font_size') || 'medium';
        const savedTableFontSize = ProfileStorage.get('print_settings_table_font_size') || 'medium';

        let typesHtml = types.map(type => {
            const translatedType = window.app.getTypeLabel(type);
            const cats = Object.keys(this.data.by_type[type].categories || {}).sort();
            const typeChecked = savedTypes.includes(type);
            const typePageBreak = ProfileStorage.get(`print_type_pagebreak_${type}`) === 'true';

            const catsHtml = cats.map(cat => {
                const catChecked = !savedCats || savedCats.includes(cat);
                return `
                <label style="display:flex;align-items:center;gap:8px;margin-left:20px;cursor:pointer;font-size:12px;">
                    <input type="checkbox" class="export-cat-cb" data-type="${type}" value="${cat.replace(/"/g, '&quot;')}" ${catChecked ? 'checked' : ''} onchange="window.AnalyticsView._saveExportCategorySelection()"> ${cat}
                </label>`;
            }).join('');

            return `
            <div style="margin-bottom: 12px; background: rgba(0,0,0,0.02); padding: 8px 12px; border-radius: 8px;">
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:6px;">
                    <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;">
                        <input type="checkbox" class="export-type-cb" value="${type}" ${typeChecked ? 'checked' : ''} onchange="
                            const cbs = this.parentElement.parentElement.parentElement.querySelectorAll('.export-cat-cb');
                            cbs.forEach(cb => cb.checked = this.checked);
                            window.AnalyticsView._saveExportCategorySelection();
                        "> ${translatedType}
                    </label>
                    <label style="font-size:11px; color:var(--text-muted); display:flex; align-items:center; gap:4px; cursor:pointer; background:rgba(0,0,0,0.04); padding:2px 8px; border-radius:4px;" title="${window.i18n.t('export_type_pagebreak_tooltip') || 'Insérer un saut de page avant ce tableau'}">
                        <input type="checkbox" class="export-type-pagebreak-cb" data-type="${type}" ${typePageBreak ? 'checked' : ''} onchange="ProfileStorage.set('print_type_pagebreak_${type}', this.checked)">
                        <span>✂️ ${window.i18n.t('export_type_pagebreak') || 'Saut de page avant'}</span>
                    </label>
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:6px;">
                    ${catsHtml}
                </div>
            </div>`;
        }).join('');

        const allCols = [
            { id: 'dateSaisie', label: window.i18n.t('col_date_entry') },
            { id: 'date', label: window.i18n.t('col_date_op') },
            { id: 'desc', label: window.i18n.t('col_description') },
            { id: 'type', label: window.i18n.t('col_type') },
            { id: 'cat', label: window.i18n.t('col_category') },
            { id: 'amount', label: window.i18n.t('col_amount') },
            { id: 'recon', label: window.i18n.t('col_reconciled') },
            { id: 'budget', label: window.i18n.t('col_envelope') },
            { id: 'depuis', label: window.i18n.t('col_from') },
            { id: 'vers', label: window.i18n.t('col_to') },
            { id: 'recurrence', label: window.i18n.t('col_recurrence') },
            { id: 'slip', label: window.i18n.t('col_slip') },
            { id: 'attachments', label: window.i18n.t('col_attachments') }
        ];

        let colsHtml = allCols.map(c => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                <input type="checkbox" class="export-col-cb" value="${c.id}" ${savedCols.includes(c.id) ? 'checked' : ''}> ${c.label}
            </label>
        `).join('');

        const isOrgMode = window.app && window.app.config && (window.app.config.enable_org_mode === 'true' || window.app.config.enable_org_mode === true);
        const savedHeaderTitle = ProfileStorage.get('print_header_title') || '';
        const savedLogoB64 = ProfileStorage.get('print_header_logo') || null;
        const savedLogoLeft = ProfileStorage.get('print_logo_left') !== 'false';
        const savedLogoRight = ProfileStorage.get('print_logo_right') !== 'false';

        const orgHeaderHtml = isOrgMode ? `
        <div style="padding: 12px; background: rgba(99,102,241,0.06); border-radius: 8px; border: 1px solid rgba(99,102,241,0.2);">
            <div style="display:flex;flex-direction:column;gap:10px;">
                <input type="text" id="exportHeaderTitle" class="inline-input" list="exportTitlePresets" placeholder="${window.i18n.t('export_header_title_placeholder') || 'Titre du document'}" value="${savedHeaderTitle.replace(/"/g, '&quot;')}" style="width:100%;" oninput="ProfileStorage.set('print_header_title', this.value)">
                <datalist id="exportTitlePresets">
                    <option value="${window.i18n.t('export_preset_annual') || 'Bilan Financier Annuel'}">
                    <option value="${window.i18n.t('export_preset_result') || 'Compte de Résultat'}">
                    <option value="${window.i18n.t('export_preset_cse') || 'Rapport de Trésorerie CSE / Association'}">
                    <option value="${window.i18n.t('export_preset_personal') || 'Synthèse des Comptes Personnels'}">
                </datalist>
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <button class="btn btn-secondary" style="font-size:12px;padding:6px 14px;" onclick="document.getElementById('exportLogoFileInput').click()">${window.i18n.t('export_header_logo_import') || 'Importer logo'}</button>
                    <input type="file" id="exportLogoFileInput" accept="image/*" style="display:none;" onchange="window.AnalyticsView._handleLogoUpload(this)">
                    ${savedLogoB64 ? `<button class="btn btn-danger" style="font-size:12px;padding:6px 14px;" onclick="ProfileStorage.remove('print_header_logo');this.previousElementSibling.previousElementSibling.previousElementSibling.style.display='none';this.remove()">${window.i18n.t('export_header_logo_remove') || 'Supprimer logo'}</button>` : ''}
                </div>
                ${savedLogoB64 ? `<img id="exportLogoPreview" src="${savedLogoB64}" style="max-height:60px;max-width:200px;border-radius:6px;border:1px solid var(--border-color);object-fit:contain;">` : '<div id="exportLogoPreview"></div>'}
                <div style="display:flex;gap:16px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                        <input type="checkbox" id="exportLogoLeft" ${savedLogoLeft ? 'checked' : ''} style="accent-color:var(--accent);" onchange="ProfileStorage.set('print_logo_left', this.checked)">
                        ${window.i18n.t('export_logo_position_left') || 'Logo à gauche'}
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                        <input type="checkbox" id="exportLogoRight" ${savedLogoRight ? 'checked' : ''} style="accent-color:var(--accent);" onchange="ProfileStorage.set('print_logo_right', this.checked)">
                        ${window.i18n.t('export_logo_position_right') || 'Logo à droite'}
                    </label>
                </div>
            </div>
        </div>` : '';

        // Construction des 8 cartes réordonnables
        const sectionDefs = {
            header: {
                title: `🏛️ ${window.i18n.t('export_sec_header') || 'En-tête & Titre du document'}`,
                isEnabled: ProfileStorage.get('print_sec_enabled_header') !== 'false',
                content: orgHeaderHtml,
                isOrgOnly: true
            },
            kpi: {
                title: `📌 ${window.i18n.t('export_sec_kpi') || 'Synthèse des indicateurs clés (Recettes, Dépenses, Résultat Net)'}`,
                isEnabled: ProfileStorage.get('print_sec_enabled_kpi') !== 'false',
                content: ''
            },
            pie_chart: {
                title: `📊 ${window.i18n.t('export_sec_pie_chart') || 'Graphique Camembert (Répartition des dépenses)'}`,
                isEnabled: savedIncludePieChart,
                content: ''
            },
            bar_chart: {
                title: `📈 ${window.i18n.t('export_sec_bar_chart') || 'Graphique à Barres (Comparatif mensuel)'}`,
                isEnabled: savedIncludeBarChart,
                content: ''
            },
            balances: {
                title: `💳 ${window.i18n.t('export_sec_balances') || 'Situation des comptes & livrets'}`,
                isEnabled: ProfileStorage.get('print_sec_enabled_balances') !== 'false',
                content: `<div id="exportBalanceCheckboxes" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:6px;background:rgba(0,0,0,0.02);padding:10px;border-radius:8px;"></div>`
            },
            type_tables: {
                title: `📋 ${window.i18n.t('export_sec_type_tables') || 'Tableaux croisés par Type & Catégories'}`,
                isEnabled: ProfileStorage.get('print_sec_enabled_type_tables') !== 'false',
                content: `
                    <div style="margin-bottom:12px;">
                        <h5 style="margin-bottom:6px;color:var(--text-muted);font-size:11px;text-transform:uppercase;">${window.i18n.t('export_annual_totals_section') || 'Colonnes de Totaux Annuels'}</h5>
                        <div style="display:flex; gap:16px; flex-wrap:wrap;">
                            ${availableYears.map(y => `
                                <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;">
                                    <input type="checkbox" class="export-year-total-cb" value="${y}" ${savedYearsTotals.includes(y) ? 'checked' : ''}> ${y}
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                            <input type="checkbox" id="exportIncludeInactive" ${ProfileStorage.get('print_settings_include_inactive') !== 'false' ? 'checked' : ''}>
                            <span>👁 ${window.i18n.t('export_include_inactive_cats') || 'Inclure les catégories inactives sur la période (présentes dans les totaux annuels)'}</span>
                        </label>
                    </div>
                    ${typesHtml}`
            },
            transactions_list: {
                title: `📑 ${window.i18n.t('export_sec_transactions_list') || 'Détail des opérations'}`,
                isEnabled: savedIncludeDetails,
                content: `
                    <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:10px;background:rgba(0,0,0,0.02);padding:10px;border-radius:8px;">
                        ${colsHtml}
                    </div>`
            },
            signature: {
                title: `✍️ ${window.i18n.t('export_sec_signature') || 'Validation & Bloc de signature (Trésorier / Président)'}`,
                isEnabled: savedIncludeSignature,
                content: '',
                isOrgOnly: true
            }
        };

        const defaultOrder = ['header', 'kpi', 'pie_chart', 'bar_chart', 'balances', 'type_tables', 'transactions_list', 'signature'];
        let savedOrder;
        try { savedOrder = JSON.parse(ProfileStorage.get('print_sections_order')); } catch (e) { }
        if (!Array.isArray(savedOrder)) savedOrder = defaultOrder;
        defaultOrder.forEach(id => { if (!savedOrder.includes(id)) savedOrder.push(id); });

        let sectionsCardsHtml = savedOrder.map(secId => {
            if (secId.startsWith('page_break_')) {
                return `
                <div class="export-section-card page-break-card" data-section-id="${secId}" draggable="true" style="margin-bottom:10px; border:1px dashed var(--accent); border-radius:8px; background:rgba(99,102,241,0.04); overflow:hidden;">
                    <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; cursor:grab;">
                        <span class="drag-handle" style="cursor:grab; font-size:16px; color:var(--accent); padding:0 4px;" title="${window.i18n.t('export_drag_handle') || 'Glisser pour réordonner'}">☰</span>
                        <strong style="font-size:13px; flex:1; color:var(--accent); user-select:none;">✂️ ${window.i18n.t('export_sec_page_break_card') || 'Saut de page de document'}</strong>
                        <div style="display:flex; gap:4px; align-items:center;">
                            <button type="button" class="btn btn-secondary" style="font-size:10px; padding:2px 6px;" onclick="window.AnalyticsView._moveSectionCard('${secId}', -1)" title="${window.i18n.t('export_move_up') || 'Monter'}">▲</button>
                            <button type="button" class="btn btn-secondary" style="font-size:10px; padding:2px 6px;" onclick="window.AnalyticsView._moveSectionCard('${secId}', 1)" title="${window.i18n.t('export_move_down') || 'Descendre'}">▼</button>
                            <button type="button" class="btn btn-secondary" style="font-size:11px; padding:2px 8px; margin-left:4px; color:#ef4444; border-color:rgba(239,68,68,0.3);" onclick="window.AnalyticsView._removePageBreakCard('${secId}')" title="${window.i18n.t('btn_delete') || 'Supprimer'}">🗑️</button>
                        </div>
                    </div>
                </div>`;
            }

            const def = sectionDefs[secId];
            if (!def) return '';
            if (def.isOrgOnly && !isOrgMode) return '';

            const isCollapsed = ProfileStorage.get(`print_sec_collapsed_${secId}`) !== 'false';
            const hasContent = !!def.content;

            return `
            <div class="export-section-card" data-section-id="${secId}" draggable="true" style="margin-bottom:10px; border:1px solid var(--border-color); border-radius:8px; background:var(--bg-surface); overflow:hidden;">
                <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; background:rgba(0,0,0,0.02); border-bottom:${hasContent && !isCollapsed ? '1px solid var(--border-color)' : 'none'}; cursor:grab;">
                    <span class="drag-handle" style="cursor:grab; font-size:16px; color:var(--text-muted); padding:0 4px;" title="${window.i18n.t('export_drag_handle') || 'Glisser pour réordonner'}">☰</span>
                    <input type="checkbox" id="sec_enable_${secId}" class="sec-enable-cb" ${def.isEnabled ? 'checked' : ''} style="accent-color:var(--accent); width:16px; height:16px;" onchange="window.AnalyticsView._onSectionEnableChange('${secId}', this.checked)">
                    <strong style="font-size:13px; flex:1; user-select:none; cursor:${hasContent ? 'pointer' : 'default'};" ${hasContent ? `onclick="window.AnalyticsView._toggleSectionCard('${secId}')"` : ''}>${def.title}</strong>
                    <div style="display:flex; gap:4px; align-items:center;">
                        <button type="button" class="btn btn-secondary" style="font-size:10px; padding:2px 6px;" onclick="window.AnalyticsView._moveSectionCard('${secId}', -1)" title="${window.i18n.t('export_move_up') || 'Monter'}">▲</button>
                        <button type="button" class="btn btn-secondary" style="font-size:10px; padding:2px 6px;" onclick="window.AnalyticsView._moveSectionCard('${secId}', 1)" title="${window.i18n.t('export_move_down') || 'Descendre'}">▼</button>
                        ${hasContent ? `
                        <button type="button" class="btn btn-secondary" style="font-size:11px; padding:2px 8px; margin-left:4px;" onclick="window.AnalyticsView._toggleSectionCard('${secId}')">
                            <span id="sec_chev_${secId}">${isCollapsed ? '▶' : '▼'}</span>
                        </button>` : ''}
                    </div>
                </div>
                ${hasContent ? `<div id="sec_body_${secId}" style="padding:12px 14px; display:${isCollapsed ? 'none' : 'block'};">${def.content}</div>` : ''}
            </div>`;
        }).join('');

        const modalHtml = `
        <div id="exportPdfModal" class="modal-overlay" style="display:flex;z-index:10000;" onclick="if(event.target===this) this.remove()">
            <div class="modal" style="width: min(750px, calc(100vw - 24px)); max-width:92vw; max-height:92vh; display:flex; flex-direction:column;">
                <h3 style="margin-bottom: 14px;">${window.i18n.t('export_modal_title')}</h3>
                <div style="flex:1; overflow-y:auto; padding-right:8px;">
                    <!-- Période du document -->
                    <div style="margin-bottom: 16px; padding:12px; background:rgba(0,0,0,0.02); border-radius:8px; border:1px solid var(--border-color);">
                        <h4 style="margin-bottom:8px;color:var(--text-muted);font-size:11px;text-transform:uppercase;">${window.i18n.t('export_detailed_period') || 'Période du document'}</h4>
                        <div style="display:flex; border-bottom:1px solid var(--border-color); margin-bottom:10px; gap:8px;">
                            <button type="button" class="tab-btn" id="tabYear" onclick="window.AnalyticsView.switchExportTab('year')" style="padding:6px 14px; border:none; background:none; cursor:pointer; font-size:13px; outline:none; transition:all 0.2s;">${window.i18n.t('export_full_year') || 'Année complète'}</button>
                            <button type="button" class="tab-btn" id="tabCustom" onclick="window.AnalyticsView.switchExportTab('custom')" style="padding:6px 14px; border:none; background:none; cursor:pointer; font-size:13px; outline:none; transition:all 0.2s;">${window.i18n.t('export_custom_range') || 'Période personnalisée'}</button>
                        </div>

                        <!-- Vue par année -->
                        <div id="exportTabContentYear" style="display:flex; align-items:center; gap:12px;">
                            <label style="font-size:13px;">${window.i18n.t('export_select_year') || 'Année :'}</label>
                            <select id="exportSelectYear" class="inline-input" style="width:120px;" onchange="window.AnalyticsView.onExportYearChange(this.value)">
                                ${availableYears.map(y => `<option value="${y}" ${y === savedSelectedYear ? 'selected' : ''}>${y}</option>`).join('')}
                            </select>
                        </div>

                        <!-- Vue par période personnalisée -->
                        <div id="exportTabContentCustom" style="display:none; align-items:center; gap:12px; flex-wrap:wrap;">
                            <label style="font-size:13px; display:flex; align-items:center; gap:6px;">
                                <span>${window.i18n.t('export_date_start') || 'Du :'}</span>
                                <input type="date" id="exportDateStart" class="inline-input" value="${savedCustomStart}" style="width:140px;" onchange="ProfileStorage.set('print_settings_custom_start', this.value)">
                            </label>
                            <label style="font-size:13px; display:flex; align-items:center; gap:6px;">
                                <span>${window.i18n.t('export_date_end') || 'Au :'}</span>
                                <input type="date" id="exportDateEnd" class="inline-input" value="${savedCustomEnd}" style="width:140px;" onchange="ProfileStorage.set('print_settings_custom_end', this.value)">
                            </label>
                        </div>
                    </div>

                    <!-- Filtre de comptes -->
                    <div style="margin-bottom: 16px;">
                        <h4 style="margin-bottom:8px;color:var(--text-muted);font-size:11px;text-transform:uppercase;">${window.i18n.t('export_modal_accounts')}</h4>
                        <div id="exportAccountBadges" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
                    </div>

                    <!-- Liste des sections réordonnables -->
                    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                        <h4 style="margin:0;color:var(--text-muted);font-size:11px;text-transform:uppercase;">${window.i18n.t('export_sections_order_title') || 'Dispositions des sections (Glisser-Déposer pour réordonner)'}</h4>
                        <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 10px; display:inline-flex; align-items:center; gap:6px; background:rgba(99,102,241,0.08); color:var(--accent); border:1px dashed var(--accent); cursor:pointer;" onclick="window.AnalyticsView._addPageBreakCard()">
                            ➕ ✂️ ${window.i18n.t('export_add_page_break') || 'Ajouter un saut de page'}
                        </button>
                    </div>
                    <div id="exportSectionsList">
                        ${sectionsCardsHtml}
                    </div>

                    <!-- Options d'impression générales -->
                    <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border-color);">

                        <h4 style="margin-bottom:8px;color:var(--text-muted);font-size:11px;text-transform:uppercase;">${window.i18n.t('export_font_sizes_section') || 'Tailles de polices'}</h4>
                        <div style="display:flex;gap:20px;flex-wrap:wrap;">
                            ${isOrgMode ? `
                            <label style="font-size:13px; display:flex; align-items:center; gap:8px;">
                                <span>${window.i18n.t('export_title_font_size') || 'Titre :'}</span>
                                <select id="exportTitleFontSize" class="inline-input" style="width:140px;" onchange="ProfileStorage.set('print_settings_title_font_size', this.value)">
                                    <option value="small" ${savedTitleFontSize === 'small' ? 'selected' : ''}>${window.i18n.t('export_font_size_small') || 'Petit'}</option>
                                    <option value="medium" ${savedTitleFontSize === 'medium' ? 'selected' : ''}>${window.i18n.t('export_font_size_medium') || 'Moyen (Défaut)'}</option>
                                    <option value="large" ${savedTitleFontSize === 'large' ? 'selected' : ''}>${window.i18n.t('export_font_size_large') || 'Grand'}</option>
                                </select>
                            </label>
                            ` : ''}
                            <label style="font-size:13px; display:flex; align-items:center; gap:8px;">
                                <span>${window.i18n.t('export_table_font_size') || 'Tableaux :'}</span>
                                <select id="exportTableFontSize" class="inline-input" style="width:140px;" onchange="ProfileStorage.set('print_settings_table_font_size', this.value)">
                                    <option value="small" ${savedTableFontSize === 'small' ? 'selected' : ''}>${window.i18n.t('export_font_size_small') || 'Petit'}</option>
                                    <option value="medium" ${savedTableFontSize === 'medium' ? 'selected' : ''}>${window.i18n.t('export_font_size_medium') || 'Moyen (Défaut)'}</option>
                                    <option value="large" ${savedTableFontSize === 'large' ? 'selected' : ''}>${window.i18n.t('export_font_size_large') || 'Grand'}</option>
                                </select>
                            </label>
                        </div>
                    </div>
                </div>
                <div class="modal-actions" style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border-color);">
                    <button class="btn btn-secondary" onclick="document.getElementById('exportPdfModal').remove()">${window.i18n.t('export_modal_cancel')}</button>
                    <button class="btn btn-primary" onclick="window.AnalyticsView.executePrint()">${window.i18n.t('export_modal_print')}</button>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Initialiser l'affichage de l'onglet actif
        this.switchExportTab(savedTabMode);

        this._exportAccountIds = this.selectedAccountIds ? [...this.selectedAccountIds] : null;
        this._renderExportAccountBadges();
        this._renderExportBalanceCheckboxes();
        this._initSectionDragAndDrop();
    },

    switchExportTab(mode) {
        this._exportTabMode = mode;
        ProfileStorage.set('print_settings_tab_mode', mode);
        const tabYear = document.getElementById('tabYear');
        const tabCustom = document.getElementById('tabCustom');
        const contentYear = document.getElementById('exportTabContentYear');
        const contentCustom = document.getElementById('exportTabContentCustom');

        if (!tabYear || !tabCustom || !contentYear || !contentCustom) return;

        if (mode === 'year') {
            tabYear.style.borderBottom = '2px solid var(--accent)';
            tabYear.style.color = 'var(--accent)';
            tabYear.style.fontWeight = '600';
            tabCustom.style.borderBottom = 'none';
            tabCustom.style.color = 'var(--text-muted)';
            tabCustom.style.fontWeight = 'normal';
            contentYear.style.display = 'block';
            contentCustom.style.display = 'none';
        } else {
            tabCustom.style.borderBottom = '2px solid var(--accent)';
            tabCustom.style.color = 'var(--accent)';
            tabCustom.style.fontWeight = '600';
            tabYear.style.borderBottom = 'none';
            tabYear.style.color = 'var(--text-muted)';
            tabYear.style.fontWeight = 'normal';
            contentYear.style.display = 'none';
            contentCustom.style.display = 'flex';
        }
    },

    _renderExportBalanceCheckboxes() {
        const container = document.getElementById('exportBalanceCheckboxes');
        if (!container) return;
        const accounts = (window.app.accounts || []).filter(a => !a.is_closed);
        if (accounts.length === 0) { container.innerHTML = ''; return; }

        container.innerHTML = accounts.map(acc => {
            const c = acc.color || '#3366ff';
            return `
                <label style="display:flex;align-items:center;gap:6px;font-size:12px;background:var(--bg-surface);padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid var(--border-color);transition:all 0.2s;"
                    onchange="this.style.borderColor = this.querySelector('input').checked ? '${c}' : 'var(--border-color)'; this.querySelector('span:last-child').style.color = this.querySelector('input').checked ? '${c}' : 'inherit'; this.querySelector('span:last-child').style.fontWeight = this.querySelector('input').checked ? '600' : 'normal';">
                    <input type="checkbox" class="export-balance-cb" value="${acc.id}" checked>
                    <span style="width:10px;height:10px;border-radius:50%;background:${c};flex-shrink:0;"></span>
                    <span style="color:${c};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${acc.name}">${acc.name}</span>
                    <span class="privacy-blur" style="margin-left:auto;font-size:11px;color:var(--text-muted);white-space:nowrap;">${formatCurrency(acc.balance)}</span>
                </label>
            `;
        }).join('');
    },

    _renderExportAccountBadges() {
        const container = document.getElementById('exportAccountBadges');
        if (!container) return;
        const accounts = (window.app.accounts || []).filter(a => !a.is_closed);
        if (accounts.length <= 1) { container.innerHTML = ''; return; }

        const allSelected = !this._exportAccountIds;
        let html = `<button class="account-badge" style="cursor:pointer;font-size:12px;padding:4px 12px;
            background:${allSelected ? 'var(--accent)' : 'var(--bg-surface)'};
            color:${allSelected ? '#fff' : 'var(--text-muted)'};
            border:1px solid ${allSelected ? 'var(--accent)' : 'var(--border-color)'};" 
            onclick="window.AnalyticsView._toggleExportAccount(null)">${window.i18n.t('analytics_all_accounts')}</button>`;

        accounts.forEach(acc => {
            const c = acc.color || '#3366ff';
            const isActive = allSelected || (this._exportAccountIds && this._exportAccountIds.includes(acc.id));
            html += `<button class="account-badge" style="cursor:pointer;font-size:12px;padding:4px 12px;
                background:${isActive ? c + '20' : 'var(--bg-surface)'};
                color:${isActive ? c : 'var(--text-muted)'};
                border:1px solid ${isActive ? c + '60' : 'var(--border-color)'};
                opacity:${isActive ? '1' : '0.5'};" 
                onclick="window.AnalyticsView._toggleExportAccount(${acc.id})">${acc.name}</button>`;
        });
        container.innerHTML = html;
    },

    _toggleExportAccount(id) {
        const accounts = (window.app.accounts || []).filter(a => !a.is_closed);
        const allIds = accounts.map(a => a.id);

        if (id === null) {
            this._exportAccountIds = null;
        } else if (!this._exportAccountIds) {
            // Was "all" — select only this one
            this._exportAccountIds = [id];
        } else if (this._exportAccountIds.includes(id)) {
            this._exportAccountIds = this._exportAccountIds.filter(i => i !== id);
            if (this._exportAccountIds.length === 0) this._exportAccountIds = null;
        } else {
            this._exportAccountIds.push(id);
            if (this._exportAccountIds.length >= allIds.length) this._exportAccountIds = null;
        }
        this._renderExportAccountBadges();
    },

    _initSectionDragAndDrop() {
        const list = document.getElementById('exportSectionsList');
        if (!list) return;

        let draggedItem = null;

        list.querySelectorAll('.export-section-card').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                draggedItem = card;
                e.dataTransfer.effectAllowed = 'move';
                card.style.opacity = '0.4';
            });

            card.addEventListener('dragend', () => {
                draggedItem = null;
                card.style.opacity = '1';
                this._saveSectionsOrder();
            });

            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const targetCard = e.target.closest('.export-section-card');
                if (targetCard && targetCard !== draggedItem && targetCard.parentElement === list) {
                    const rect = targetCard.getBoundingClientRect();
                    const next = (e.clientY - rect.top) > (rect.height / 2);
                    list.insertBefore(draggedItem, next ? targetCard.nextSibling : targetCard);
                }
            });
        });
    },

    _moveSectionCard(secId, direction) {
        const card = document.querySelector(`.export-section-card[data-section-id="${secId}"]`);
        if (!card || !card.parentElement) return;
        const parent = card.parentElement;
        if (direction === -1 && card.previousElementSibling) {
            parent.insertBefore(card, card.previousElementSibling);
        } else if (direction === 1 && card.nextElementSibling) {
            parent.insertBefore(card.nextElementSibling, card);
        }
        this._saveSectionsOrder();
    },

    _saveSectionsOrder() {
        const cards = document.querySelectorAll('.export-section-card');
        const order = Array.from(cards).map(c => c.getAttribute('data-section-id'));
        ProfileStorage.set('print_sections_order', JSON.stringify(order));
    },

    _toggleSectionCard(secId) {
        const content = document.getElementById(`sec_body_${secId}`);
        const chevron = document.getElementById(`sec_chev_${secId}`);
        if (!content) return;
        const isHidden = content.style.display === 'none';
        content.style.display = isHidden ? 'block' : 'none';
        if (chevron) chevron.textContent = isHidden ? '▼' : '▶';
        ProfileStorage.set(`print_sec_collapsed_${secId}`, isHidden ? 'false' : 'true');
    },

    _saveExportCategorySelection() {
        const modal = document.getElementById('exportPdfModal');
        if (!modal) return;
        const selectedCats = Array.from(modal.querySelectorAll('.export-cat-cb:checked')).map(cb => cb.value);
        const selectedTypes = Array.from(modal.querySelectorAll('.export-type-cb:checked')).map(cb => cb.value);
        ProfileStorage.set('print_settings_cats', JSON.stringify(selectedCats));
        ProfileStorage.set('print_settings_types', JSON.stringify(selectedTypes));
    },

    _onSectionEnableChange(secId, isChecked) {
        ProfileStorage.set(`print_sec_enabled_${secId}`, isChecked);
        if (secId === 'signature') ProfileStorage.set('print_settings_include_signature', isChecked);
        if (secId === 'pie_chart') ProfileStorage.set('print_settings_include_pie_chart', isChecked);
        if (secId === 'bar_chart') ProfileStorage.set('print_settings_include_bar_chart', isChecked);
        if (secId === 'transactions_list') ProfileStorage.set('print_settings_include_details', isChecked);
    },

    _addPageBreakCard() {
        const list = document.getElementById('exportSectionsList');
        if (!list) return;
        const newId = `page_break_${Date.now()}`;
        const cardHtml = `
        <div class="export-section-card page-break-card" data-section-id="${newId}" draggable="true" style="margin-bottom:10px; border:1px dashed var(--accent); border-radius:8px; background:rgba(99,102,241,0.04); overflow:hidden;">
            <div style="display:flex; align-items:center; gap:10px; padding:10px 14px; cursor:grab;">
                <span class="drag-handle" style="cursor:grab; font-size:16px; color:var(--accent); padding:0 4px;" title="${window.i18n.t('export_drag_handle') || 'Glisser pour réordonner'}">☰</span>
                <strong style="font-size:13px; flex:1; color:var(--accent); user-select:none;">✂️ ${window.i18n.t('export_sec_page_break_card') || 'Saut de page de document'}</strong>
                <div style="display:flex; gap:4px; align-items:center;">
                    <button type="button" class="btn btn-secondary" style="font-size:10px; padding:2px 6px;" onclick="window.AnalyticsView._moveSectionCard('${newId}', -1)" title="${window.i18n.t('export_move_up') || 'Monter'}">▲</button>
                    <button type="button" class="btn btn-secondary" style="font-size:10px; padding:2px 6px;" onclick="window.AnalyticsView._moveSectionCard('${newId}', 1)" title="${window.i18n.t('export_move_down') || 'Descendre'}">▼</button>
                    <button type="button" class="btn btn-secondary" style="font-size:11px; padding:2px 8px; margin-left:4px; color:#ef4444; border-color:rgba(239,68,68,0.3);" onclick="window.AnalyticsView._removePageBreakCard('${newId}')" title="${window.i18n.t('btn_delete') || 'Supprimer'}">🗑️</button>
                </div>
            </div>
        </div>`;
        list.insertAdjacentHTML('beforeend', cardHtml);
        this._initSectionDragAndDrop();
        this._saveSectionsOrder();
    },

    _removePageBreakCard(secId) {
        const card = document.querySelector(`.export-section-card[data-section-id="${secId}"]`);
        if (card) {
            card.remove();
            this._saveSectionsOrder();
        }
    },

    async executePrint() {
        const modal = document.getElementById('exportPdfModal');
        if (!modal) return;

        const isOrgMode = window.app && window.app.config && (window.app.config.enable_org_mode === 'true' || window.app.config.enable_org_mode === true);

        // Gather selections
        const tabMode = this._exportTabMode || 'year';
        const useCustomRange = tabMode === 'custom';
        const selectedYear = modal.querySelector('#exportSelectYear')?.value || null;
        const customStart = useCustomRange ? (modal.querySelector('#exportDateStart')?.value || null) : null;
        const customEnd = useCustomRange ? (modal.querySelector('#exportDateEnd')?.value || null) : null;

        // Validation
        if (useCustomRange) {
            if (!customStart || !customEnd) {
                showToast(window.i18n.t('analytics_err_dates_required') || "Veuillez saisir les dates de début et de fin pour la période personnalisée.", "error");
                return;
            }
            if (customStart > customEnd) {
                showToast(window.i18n.t('analytics_err_date_order') || "La date de début doit être antérieure à la date de fin.", "error");
                return;
            }
        } else {
            if (!selectedYear) {
                showToast(window.i18n.t('analytics_err_year_required') || "Veuillez sélectionner une année à afficher.", "error");
                return;
            }
        }

        const selectedYearsTotals = Array.from(modal.querySelectorAll('.export-year-total-cb:checked')).map(cb => cb.value);
        const selectedTypes = Array.from(modal.querySelectorAll('.export-type-cb:checked')).map(cb => cb.value);
        const selectedCats = Array.from(modal.querySelectorAll('.export-cat-cb:checked')).map(cb => cb.value);
        const selectedCols = Array.from(modal.querySelectorAll('.export-col-cb:checked')).map(cb => cb.value);
        const includeDetails = (modal.querySelector('#sec_enable_transactions_list')?.checked ?? modal.querySelector('#exportIncludeDetails')?.checked) ?? true;
        const includePieChart = (modal.querySelector('#sec_enable_pie_chart')?.checked ?? modal.querySelector('#exportIncludePieChart')?.checked) ?? true;
        const includeBarChart = (modal.querySelector('#sec_enable_bar_chart')?.checked ?? modal.querySelector('#exportIncludeBarChart')?.checked) ?? true;
        const includeSignature = (modal.querySelector('#sec_enable_signature')?.checked ?? modal.querySelector('#exportIncludeSignature')?.checked) ?? false;
        const titleFontSize = modal.querySelector('#exportTitleFontSize')?.value || 'medium';
        const tableFontSize = modal.querySelector('#exportTableFontSize')?.value || 'medium';

        // Mémoriser les choix utilisateur
        ProfileStorage.set('print_settings_tab_mode', tabMode);
        if (selectedYear) ProfileStorage.set('print_settings_selected_year', selectedYear);
        if (customStart) ProfileStorage.set('print_settings_custom_start', customStart);
        if (customEnd) ProfileStorage.set('print_settings_custom_end', customEnd);
        ProfileStorage.set('analytics_years_totals', JSON.stringify(selectedYearsTotals));
        ProfileStorage.set('print_settings_types', JSON.stringify(selectedTypes));
        ProfileStorage.set('print_settings_cats', JSON.stringify(selectedCats));
        ProfileStorage.set('print_settings_cols', JSON.stringify(selectedCols));
        ProfileStorage.set('print_settings_include_details', includeDetails);
        ProfileStorage.set('print_settings_include_pie_chart', includePieChart);
        ProfileStorage.set('print_settings_include_bar_chart', includeBarChart);
        ProfileStorage.set('print_settings_include_signature', includeSignature);
        ProfileStorage.set('print_settings_title_font_size', titleFontSize);
        ProfileStorage.set('print_settings_table_font_size', tableFontSize);

        // Bug #8 : En-tête pro (mode org)
        const headerTitle = modal.querySelector('#exportHeaderTitle')?.value?.trim() || '';
        const headerLogoB64 = ProfileStorage.get('print_header_logo') || null;
        const logoLeft = modal.querySelector('#exportLogoLeft')?.checked ?? true;
        const logoRight = modal.querySelector('#exportLogoRight')?.checked ?? true;

        // Desactiver le bouton pour éviter les double-clics
        const printBtn = modal.querySelector('.modal-actions .btn-primary');
        if (printBtn) { printBtn.disabled = true; printBtn.textContent = '⏳...'; }

        // Gather account filter from modal
        const exportAccIds = this._exportAccountIds;

        let printData = this.data;
        let allTx = [];
        let accountsMap = {};
        let budgetsMap = {};
        let categoryToBudgetMap = {};

        try {
            let printUrl = useCustomRange
                ? `/api/stats/categories_by_month?reconciled=${this.reconciled}&date_start=${customStart}&date_end=${customEnd}`
                : `/api/stats/categories_by_month?reconciled=${this.reconciled}&year=${selectedYear}`;
            if (exportAccIds) printUrl += `&account_ids=${exportAccIds.join(',')}`;

            const promises = [
                API.get(printUrl),
                API.get('/api/accounts/'),
                API.get('/api/budgets/')
            ];
            if (includeDetails) {
                promises.push(API.get('/api/transactions/?limit=10000'));
            }

            const results = await Promise.all(promises);
            printData = results[0];
            const accs = results[1] || [];
            const budgets = results[2] || [];
            if (includeDetails) {
                allTx = results[3] || [];
            }

            accs.forEach(a => { accountsMap[a.id] = a.name; });
            budgets.forEach(b => {
                budgetsMap[b.id] = b.name;
                if (!b.is_project && b.categories) {
                    b.categories.forEach(cat => { categoryToBudgetMap[cat] = b.name; });
                }
            });
        } catch (e) {
            console.error("Error fetching print data", e);
        } finally {
            if (printBtn) { printBtn.disabled = false; printBtn.textContent = window.i18n.t('export_modal_print'); }
        }

        // Create an offline container
        let printContainer = document.getElementById('printContainer');
        if (!printContainer) {
            printContainer = document.createElement('div');
            printContainer.id = 'printContainer';
            printContainer.style.cssText = 'display: none;';
            document.body.appendChild(printContainer);
        }

        // Render data into offline container
        const { months, years, by_type } = printData;
        const revYears = (years || []).slice().reverse();
        const sections = [];

        // Save original selectedYears and temporarily override with PDF selection
        const originalSelectedYears = this.selectedYears;
        this.selectedYears = selectedYearsTotals;

        // Lire l'option catégories inactives avant le bloc by_type (utilisé aussi dans la boucle de filtrage)
        const includeInactive = modal.querySelector('#exportIncludeInactive')?.checked ?? true;
        ProfileStorage.set('print_settings_include_inactive', includeInactive);

        if (by_type) {
            // Filtrer avant de générer pour éviter de générer un saut de page sur un tableau masqué (résout le bug de page vide à la fin)
            const typeEntries = Object.entries(by_type).filter(([txType]) => selectedTypes.includes(txType));
            typeEntries.forEach(([txType, typeData], idx) => {
                const isFirst = idx === 0;
                const isLast = idx === typeEntries.length - 1;
                const hasTypeBreakBefore = modal.querySelector(`.export-type-pagebreak-cb[data-type="${txType}"]`)?.checked ?? false;
                const breakClass = (hasTypeBreakBefore && !isFirst) ? 'print-page-break-before-forced' : 'print-page-break-auto';
                const extraSpacing = (!hasTypeBreakBefore && !isLast) ? '<br><br>' : '';
                sections.push(`<div class="${breakClass}">` + this.renderTypeTable(txType, typeData, months, revYears, includeInactive, true) + '</div>' + extraSpacing);
            });
        }

        // Types entièrement inactifs sur la période : générer leurs tableaux si includeInactive est coché
        if (includeInactive && printData.inactive_types) {
            Object.entries(printData.inactive_types).forEach(([txType, typeData]) => {
                sections.push('<br><br><div class="print-page-break-auto">' + this.renderTypeTable(txType, typeData, months, revYears, true, true) + '</div>');
            });
        }

        // Restore original selectedYears
        this.selectedYears = originalSelectedYears;

        // Build transactions list
        let filteredTx = allTx.filter(tx => {
            const dateStr = tx.date_operation || '';
            const yr = dateStr.split('-')[0];

            if (useCustomRange) {
                const txDate = dateStr.substring(0, 10);
                if (txDate < customStart || txDate > customEnd) return false;
            } else {
                if (yr !== selectedYear) return false;
            }

            if (!selectedTypes.includes(tx.type)) return false;

            if (exportAccIds) {
                const accIds = exportAccIds;
                if (!accIds.includes(tx.from_account_id) && !accIds.includes(tx.to_account_id)) return false;
            }

            let catMatches = false;
            if (tx.category && selectedCats.includes(tx.category)) catMatches = true;
            if (!tx.category && (selectedCats.includes('Sans catégorie') || selectedCats.includes('Uncategorized') || selectedCats.includes('—') || selectedCats.includes(''))) catMatches = true;
            if (!catMatches) return false;

            return true;
        });

        filteredTx.sort((a, b) => new Date(b.date_operation) - new Date(a.date_operation));

        let txHtml = '';
        if (includeDetails && filteredTx.length > 0) {
            let ths = '';
            if (selectedCols.includes('dateSaisie')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_date_entry')}</th>`;
            if (selectedCols.includes('date')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_date_op')}</th>`;
            if (selectedCols.includes('desc')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_description')}</th>`;
            if (selectedCols.includes('type')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_type')}</th>`;
            if (selectedCols.includes('cat')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_category')}</th>`;
            if (selectedCols.includes('amount')) ths += `<th style="text-align:right;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_amount')}</th>`;
            if (selectedCols.includes('recon')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_reconciled')}</th>`;
            if (selectedCols.includes('budget')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_envelope')}</th>`;
            if (selectedCols.includes('depuis')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_from')}</th>`;
            if (selectedCols.includes('vers')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_to')}</th>`;
            if (selectedCols.includes('recurrence')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_recurrence')}</th>`;
            if (selectedCols.includes('slip')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_slip')}</th>`;
            if (selectedCols.includes('attachments')) ths += `<th style="text-align:left;padding:4px;border-bottom:1px solid var(--border-color);">${window.i18n.t('col_attachments')}</th>`;

            let trs = filteredTx.map(tx => {
                let tds = '';
                if (selectedCols.includes('dateSaisie')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${formatDate(tx.date_saisie)}</td>`;
                if (selectedCols.includes('date')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${formatDate(tx.date_operation)}</td>`;
                if (selectedCols.includes('desc')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${tx.description || ''}</td>`;
                if (selectedCols.includes('type')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${window.app.getTypeLabel(tx.type)}</td>`;
                if (selectedCols.includes('cat')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${tx.category || '-'}</td>`;

                if (selectedCols.includes('amount')) {
                    const amountColor = tx.type === 'income' ? 'var(--color-income)' :
                        (tx.type === 'transfer' ? 'var(--color-transfer)' : 'inherit');
                    tds += `<td style="text-align:right;color:${amountColor};font-weight:bold;padding:4px;border-bottom:1px solid #eee;">${formatCurrency(tx.amount)}</td>`;
                }

                if (selectedCols.includes('recon')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${formatDate(tx.reconciliation_date) || '-'}</td>`;
                if (selectedCols.includes('budget')) { const bName = (tx.budget_id && budgetsMap[tx.budget_id]) ? budgetsMap[tx.budget_id] : (tx.category && categoryToBudgetMap[tx.category]) ? categoryToBudgetMap[tx.category] : null; tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${bName || '-'}</td>`; }
                if (selectedCols.includes('depuis')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${accountsMap[tx.from_account_id] || ''}</td>`;
                if (selectedCols.includes('vers')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${accountsMap[tx.to_account_id] || ''}</td>`;
                if (selectedCols.includes('recurrence')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${tx.recurrence_id || tx.is_monthly || tx.is_yearly ? '🔄' : '-'}</td>`;
                if (selectedCols.includes('slip')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${tx.slip_number || '-'}</td>`;
                if (selectedCols.includes('attachments')) tds += `<td style="padding:4px;border-bottom:1px solid #eee;">${tx.attachments ? '📎' : '-'}</td>`;

                return `<tr>${tds}</tr>`;
            }).join('');

            txHtml = `
            <h3 style="margin-top:20px;margin-bottom:15px;color:var(--text-main);">Détail des opérations (${filteredTx.length})</h3>
            <table class="data-table" style="width:100%; border-collapse:collapse; font-size:10px;">
                <thead><tr style="background:var(--bg-surface);">${ths}</tr></thead>
                <tbody>${trs}</tbody>
            </table>
            `;
        }

        // Build account balances section for print
        let balancesHtml = '';
        const balanceCbs = modal.querySelectorAll('.export-balance-cb:checked');
        if (balanceCbs.length > 0) {
            const accounts = (window.app.accounts || []).filter(a => !a.is_closed);
            const selectedBalanceIds = Array.from(balanceCbs).map(cb => parseInt(cb.value));
            const balanceAccounts = accounts.filter(a => selectedBalanceIds.includes(a.id));
            const totalBalance = balanceAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);

            let balanceRows = balanceAccounts.map(a => {
                const c = a.color || '#3366ff';
                return `<tr>
                    <td style="padding:6px 12px;border-bottom:1px solid #eee;"><span style="color:${c};font-weight:600;">● ${a.name}</span></td>
                    <td style="padding:6px 12px;border-bottom:1px solid #eee;color:var(--text-muted);">${a.type}</td>
                    <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${formatCurrency(a.balance)}</td>
                </tr>`;
            }).join('');

            balancesHtml = `
            <div style="margin-bottom:24px;border:1px solid var(--border-color);border-radius:10px;overflow:hidden;">
                <div style="background:rgba(99,102,241,0.08);padding:10px 16px;border-bottom:1px solid var(--border-color);">
                    <strong style="font-size:14px;">${window.i18n.t('export_balance_title') || 'Account Balances'}</strong>
                    <span style="float:right;font-size:12px;color:var(--text-muted);">${new Date().toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:rgba(0,0,0,0.03);">
                         <th style="text-align:left;padding:6px 12px;border-bottom:1px solid var(--border-color);">${window.i18n.t('acc_th_name')}</th>
                        <th style="text-align:left;padding:6px 12px;border-bottom:1px solid var(--border-color);">${window.i18n.t('acc_th_type')}</th>
                        <th style="text-align:right;padding:6px 12px;border-bottom:1px solid var(--border-color);">${window.i18n.t('export_balance_current') || 'Current Balance'}</th>
                    </tr></thead>
                    <tbody>${balanceRows}</tbody>
                    <tfoot><tr style="font-weight:700;background:rgba(0,0,0,0.03);">
                        <td colspan="2" style="padding:8px 12px;border-top:2px solid var(--border-color);">Total</td>
                        <td style="text-align:right;padding:8px 12px;border-top:2px solid var(--border-color);">${formatCurrency(totalBalance)}</td>
                    </tr></tfoot>
                </table>
            </div>`;
        }

        // Bug #8 : En-tête professionnel (mode org)
        let orgHeaderBlockHtml = '';
        if (headerTitle || headerLogoB64) {
            const logoHtml = headerLogoB64
                ? `<img src="${headerLogoB64}" style="max-height:80px;max-width:180px;object-fit:contain;">`
                : `<span style="width:80px;"></span>`;
            const leftLogo = (headerLogoB64 && logoLeft) ? logoHtml : `<span style="min-width:80px;"></span>`;
            const rightLogo = (headerLogoB64 && logoRight) ? logoHtml : `<span style="min-width:80px;"></span>`;
            orgHeaderBlockHtml = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;padding-bottom:16px;border-bottom:2px solid var(--border-color);gap:12px;">
                ${leftLogo}
                <div style="flex:1;text-align:center;">
                    <h1 style="font-size:20px;font-weight:800;margin:0;color:var(--text-main);letter-spacing:-0.5px;">${headerTitle}</h1>
                </div>
                ${rightLogo}
            </div>`;
        }

        // CSS dynamique pour ajuster les tailles de police de manière homogène
        const titleSizeMap = { small: '20px', medium: '24px', large: '28px' };
        const tableSizeMap = { small: '9px', medium: '11px', large: '13px' };

        const titleSizeVal = titleSizeMap[titleFontSize] || '24px';
        const tableSizeVal = tableSizeMap[tableFontSize] || '11px';

        const styleBlock = `
            <style>
                #printContainer {
                    --print-title-size: ${titleSizeVal};
                    --print-table-size: ${tableSizeVal};
                }
                #printContainer, #printContainer * {
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                }
                #printContainer h1, #printContainer h1 * { font-size: var(--print-title-size) !important; }
                #printContainer h2, #printContainer h2 * { font-size: var(--print-title-size) !important; }
                #printContainer h3, #printContainer h3 * { font-size: calc(var(--print-title-size) * 0.8) !important; }
                #printContainer th, 
                #printContainer td, 
                #printContainer span, 
                #printContainer div { 
                    font-size: var(--print-table-size) !important; 
                }
                /* Noms de catégories légèrement plus grands */
                #printContainer .data-table td:first-child { 
                    font-size: calc(var(--print-table-size) + 0.5px) !important; 
                    font-weight: 600 !important;
                }
                /* En-têtes de section de tableaux (ex: Dépenses variables) */
                #printContainer [data-type] > div > span { 
                    font-size: calc(var(--print-table-size) + 3px) !important; 
                }
                /* Saut de page forcé */
                .print-page-break-forced {
                    page-break-after: always !important;
                    break-after: page !important;
                    display: block !important;
                }
                .print-page-break-auto {
                    page-break-after: auto !important;
                    break-after: auto !important;
                }
            </style>
        `;

        // Calcul des KPIs
        let printTotalIncome = 0;
        let printTotalExpense = 0;
        if (by_type) {
            if (by_type.income) {
                printTotalIncome = by_type.income.grand_total || 0;
            }
            ['expense_fixed', 'expense_var'].forEach(tKey => {
                if (by_type[tKey]) {
                    printTotalExpense += by_type[tKey].grand_total || 0;
                }
            });
        }
        const printNetResult = printTotalIncome - printTotalExpense;
        const kpiCardsHtml = `
        <div style="display:flex; gap:12px; margin-bottom:20px; flex-wrap:wrap; page-break-inside:avoid;">
            <div style="flex:1; min-width:140px; background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:10px 14px;">
                <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#10b981;">${window.i18n.t('type_income') || 'Recettes'}</div>
                <div style="font-size:16px; font-weight:800; color:#10b981; margin-top:2px;">${formatCurrency(printTotalIncome)}</div>
            </div>
            <div style="flex:1; min-width:140px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:10px 14px;">
                <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#ef4444;">${window.i18n.t('type_expense_fixed') || 'Dépenses'}</div>
                <div style="font-size:16px; font-weight:800; color:#ef4444; margin-top:2px;">${formatCurrency(printTotalExpense)}</div>
            </div>
            <div style="flex:1; min-width:140px; background:rgba(99,102,241,0.08); border:1px solid rgba(99,102,241,0.3); border-radius:8px; padding:10px 14px;">
                <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:var(--accent);">${window.i18n.t('stat_net_worth') || 'Résultat Net'}</div>
                <div style="font-size:16px; font-weight:800; color:${printNetResult >= 0 ? '#10b981' : '#ef4444'}; margin-top:2px;">${formatCurrency(printNetResult)}</div>
            </div>
        </div>`;

        // Graphiques SVG visuels
        let chartsHtml = '';
        let pieSvg = '';
        let barSvg = '';

        if (includePieChart) {
            const pieCatList = [];
            ['expense_fixed', 'expense_var'].forEach(tKey => {
                if (by_type && by_type[tKey] && by_type[tKey].totals_per_cat) {
                    Object.entries(by_type[tKey].totals_per_cat).forEach(([cName, cTotal]) => {
                        if (cTotal && cTotal > 0 && selectedCats.includes(cName)) {
                            pieCatList.push({ name: cName, amount: cTotal });
                        }
                    });
                }
            });
            pieCatList.sort((a, b) => b.amount - a.amount);
            pieSvg = this._generatePieChartSVG(pieCatList);
        }

        if (includeBarChart) {
            const incomeByMonth = {};
            const expenseByMonth = {};
            (months || []).forEach(m => {
                incomeByMonth[m] = (by_type?.income?.totals_per_month?.[m]) || 0;
                expenseByMonth[m] = ((by_type?.expense_fixed?.totals_per_month?.[m]) || 0) + ((by_type?.expense_var?.totals_per_month?.[m]) || 0);
            });
            barSvg = this._generateBarChartSVG(months || [], incomeByMonth, expenseByMonth);
        }

        if (pieSvg || barSvg) {
            chartsHtml = `<div style="margin-bottom:20px; page-break-inside:avoid;">${pieSvg}${barSvg}</div>`;
        }

        // Bloc de signature
        let signatureHtml = '';
        if (includeSignature) {
            signatureHtml = this._generateSignatureBlockHTML();
        }

        // Assemblage dynamique selon l'ordre des cartes défini par l'utilisateur
        const sectionCards = Array.from(modal.querySelectorAll('.export-section-card'));
        const orderedSectionIds = sectionCards.map(card => card.getAttribute('data-section-id'));

        const isSecChecked = (secId) => {
            return modal.querySelector(`#sec_enable_${secId}`)?.checked ?? false;
        };

        const orderedBlocks = [];
        let pendingPageBreak = false;

        orderedSectionIds.forEach(secId => {
            if (secId.startsWith('page_break_')) {
                pendingPageBreak = true;
                return;
            }
            if (!isSecChecked(secId)) return;
            let blockContent = '';

            if (secId === 'header' && isOrgMode && orgHeaderBlockHtml) blockContent = orgHeaderBlockHtml;
            else if (secId === 'kpi' && kpiCardsHtml) blockContent = kpiCardsHtml;
            else if (secId === 'pie_chart' && pieSvg) blockContent = `<div style="margin-bottom:20px;">${pieSvg}</div>`;
            else if (secId === 'bar_chart' && barSvg) blockContent = `<div style="margin-bottom:20px;">${barSvg}</div>`;
            else if (secId === 'balances' && balancesHtml) blockContent = balancesHtml;
            else if (secId === 'type_tables' && sections.length > 0) blockContent = sections.join('');
            else if (secId === 'transactions_list' && txHtml) blockContent = txHtml;
            else if (secId === 'signature' && signatureHtml) blockContent = signatureHtml;

            if (blockContent) {
                const breakClass = pendingPageBreak ? 'print-page-break-before-forced' : 'print-page-break-auto';
                orderedBlocks.push(`<div class="${breakClass}">${blockContent}</div>`);
                pendingPageBreak = false;
            }
        });

        printContainer.innerHTML = styleBlock + orderedBlocks.join('');
        if (!isSecChecked('header') || !orgHeaderBlockHtml) {
            printContainer.insertAdjacentHTML('afterbegin', `<h2 style="margin-bottom: 20px;">${window.i18n.t('analytics_title')}</h2>`);
        }

        // Les types inactifs n'ont pas de checkbox dans la modal → absents de selectedTypes.
        // On les ajoute à une liste étendue pour éviter qu'ils soient masqués par le filtre ci-dessous.
        const effectiveSelectedTypes = includeInactive && printData.inactive_types
            ? [...selectedTypes, ...Object.keys(printData.inactive_types)]
            : selectedTypes;

        // Handle Types
        printContainer.querySelectorAll('[data-type]').forEach(el => {
            if (!effectiveSelectedTypes.includes(el.getAttribute('data-type'))) {
                el.classList.add('no-print');
            } else {
                // Handle Categories within this type
                el.querySelectorAll('tr[data-category]').forEach(tr => {
                    // Les lignes inactives sont déjà filtrées via showInactive — ne pas les masquer ici
                    if (tr.hasAttribute('data-inactive') && includeInactive) return;
                    if (!selectedCats.includes(tr.getAttribute('data-category'))) {
                        tr.classList.add('no-print');
                    }
                });
            }
        });

        // Handle Columns (months and years)
        printContainer.querySelectorAll('[data-year]').forEach(el => {
            const yr = el.getAttribute('data-year');
            const colType = el.getAttribute('data-col-type');

            if (colType === 'month') {
                if (tabMode === 'year') {
                    if (yr !== selectedYear) el.classList.add('no-print');
                }
            } else if (colType === 'year') {
                if (!selectedYearsTotals.includes(yr)) {
                    el.classList.add('no-print');
                }
            }
        });

        // Print
        document.body.classList.add('printing-offline');

        // Allow DOM to update before printing
        setTimeout(() => {
            window.print();

            // Cleanup
            setTimeout(() => {
                document.body.classList.remove('printing-offline');
                printContainer.remove();
                // Ne pas remove() le modal pour le laisser ouvert
            }, 500);
        }, 100);
    },

    /** Bug #8 : Gestion de l'import de logo — conversion en base64 et sauvegarde dans localStorage */
    _handleLogoUpload(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        // Vérification type
        if (!file.type.startsWith('image/')) {
            showToast(window.i18n.t('analytics_err_logo_format') || 'Fichier non supporté. Veuillez importer une image (PNG, JPG, SVG…).', 'error');
            return;
        }
        // Vérification taille (max 2 Mo)
        if (file.size > 2 * 1024 * 1024) {
            showToast(window.i18n.t('analytics_err_logo_size') || 'Logo trop volumineux (max 2 Mo). Veuillez réduire la taille du fichier.', 'error');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const b64 = e.target.result;
            // Resize via canvas pour garantir max-height:80px sur le print
            const img = new Image();
            img.onload = () => {
                const maxH = 200; // pixels max en storage (réduit la taille base64)
                let { width, height } = img;
                if (height > maxH) {
                    width = Math.round(width * maxH / height);
                    height = maxH;
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(img, 0, 0, width, height);
                const resizedB64 = canvas.toDataURL('image/png');
                ProfileStorage.set('print_header_logo', resizedB64);
                // Mettre à jour le preview dans la modale
                const preview = document.getElementById('exportLogoPreview');
                if (preview) {
                    preview.outerHTML = `<img id="exportLogoPreview" src="${resizedB64}" style="max-height:60px;max-width:200px;border-radius:6px;border:1px solid var(--border-color);object-fit:contain;">`;
                }
                showToast(window.i18n.t('analytics_logo_saved') || 'Logo importé et enregistré ✅', 'success');
            };
            img.src = b64;
        };
        reader.readAsDataURL(file);
    },

    renderYearsPopover(revYears) {
        const popover = document.getElementById('analyticsYearsPopover');
        if (!popover) return;
        
        if (revYears.length === 0) {
            popover.innerHTML = `<div style="color:var(--text-muted); font-size:12px;">Aucune année disponible</div>`;
            return;
        }

        const title = window.i18n.t('analytics_popover_years_title') || 'Total Years:';
        let html = `<div style="font-weight:600; font-size:12px; border-bottom:1px solid var(--border-color); padding-bottom:6px; margin-bottom:6px; color:var(--text-main);">${title}</div>`;
        
        revYears.forEach(yr => {
            const yrStr = yr.toString();
            const checked = !this.selectedYears || this.selectedYears.includes(yrStr);
            html += `
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer; font-size:13px; color:var(--text-main); user-select:none; margin: 4px 0;">
                <input type="checkbox" class="analytics-year-cb" value="${yrStr}" ${checked ? 'checked' : ''} onchange="window.AnalyticsView.onYearToggle('${yrStr}', this.checked)" style="accent-color:var(--accent); width:14px; height:14px; cursor:pointer;">
                <span>${yrStr}</span>
            </label>`;
        });
        
        popover.innerHTML = html;
    },

    toggleYearsPopover(e) {
        e.stopPropagation();
        const popover = document.getElementById('analyticsYearsPopover');
        if (!popover) return;
        
        const isHidden = popover.style.display === 'none';
        if (isHidden) {
            popover.style.display = 'flex';
            
            // Add click outside listener
            const closePopover = (evt) => {
                if (!popover.contains(evt.target) && evt.target !== document.getElementById('analyticsYearsBtn')) {
                    popover.style.display = 'none';
                    document.removeEventListener('click', closePopover);
                }
            };
            // Delay adding to avoid catching this immediate click
            setTimeout(() => {
                document.addEventListener('click', closePopover);
            }, 0);
        } else {
            popover.style.display = 'none';
        }
    },

    onYearToggle(yr, checked) {
        // Initialize selectedYears if null (if null, all are selected initially)
        if (!this.selectedYears) {
            const yearsSet = new Set();
            (this.data.years || []).forEach(y => yearsSet.add(y.toString()));
            if (this.data.months) {
                this.data.months.forEach(m => yearsSet.add(m.split('-')[0]));
            }
            this.selectedYears = Array.from(yearsSet).sort().reverse();
        }

        if (checked) {
            if (!this.selectedYears.includes(yr)) {
                this.selectedYears.push(yr);
            }
        } else {
            this.selectedYears = this.selectedYears.filter(y => y !== yr);
        }

        ProfileStorage.set('analytics_years_totals', JSON.stringify(this.selectedYears));
        this.renderAll();
    },

    _generatePieChartSVG(catsData) {
        if (!catsData || catsData.length === 0) return '';
        const colors = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#3b82f6', '#84cc16', '#64748b'];
        const total = catsData.reduce((sum, c) => sum + (c.amount || 0), 0);
        if (total <= 0) return '';

        let cumulativeAngle = 0;
        const slices = [];
        const legendItems = [];

        catsData.forEach((c, idx) => {
            const color = colors[idx % colors.length];
            const pct = (c.amount / total) * 100;
            const angle = (c.amount / total) * 2 * Math.PI;
            
            const startAngle = cumulativeAngle;
            const endAngle = cumulativeAngle + angle;
            cumulativeAngle += angle;

            const cx = 100, cy = 100, rOuter = 80, rInner = 45;
            const x1 = cx + rOuter * Math.cos(startAngle);
            const y1 = cy + rOuter * Math.sin(startAngle);
            const x2 = cx + rOuter * Math.cos(endAngle);
            const y2 = cy + rOuter * Math.sin(endAngle);

            const x3 = cx + rInner * Math.cos(endAngle);
            const y3 = cy + rInner * Math.sin(endAngle);
            const x4 = cx + rInner * Math.cos(startAngle);
            const y4 = cy + rInner * Math.sin(startAngle);

            const largeArcFlag = angle > Math.PI ? 1 : 0;

            const pathData = [
                `M ${x1} ${y1}`,
                `A ${rOuter} ${rOuter} 0 ${largeArcFlag} 1 ${x2} ${y2}`,
                `L ${x3} ${y3}`,
                `A ${rInner} ${rInner} 0 ${largeArcFlag} 0 ${x4} ${y4}`,
                `Z`
            ].join(' ');

            slices.push(`<path d="${pathData}" fill="${color}" stroke="#fff" stroke-width="1.5" />`);
            legendItems.push(`
                <div style="display:flex; align-items:center; justify-content:space-between; font-size:11px; margin-bottom:4px; gap:8px;">
                    <div style="display:flex; align-items:center; gap:6px; min-width:0;">
                        <span style="display:inline-block; width:10px; height:10px; border-radius:3px; background:${color}; flex-shrink:0;"></span>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500;">${c.name}</span>
                    </div>
                    <span style="font-weight:600; white-space:nowrap;">${formatCurrency(c.amount)} (${pct.toFixed(1)}%)</span>
                </div>
            `);
        });

        return `
        <div style="display:flex; align-items:center; gap:20px; background:var(--bg-surface); padding:16px; border-radius:10px; border:1px solid var(--border-color); margin-bottom:16px; page-break-inside:avoid;">
            <svg width="200" height="200" viewBox="0 0 200 200" style="flex-shrink:0;">
                ${slices.join('')}
            </svg>
            <div style="flex:1; min-width:0; max-height:190px; overflow-y:auto;">
                <div style="font-size:12px; font-weight:700; text-transform:uppercase; margin-bottom:8px; color:var(--text-muted); border-bottom:1px solid var(--border-color); padding-bottom:4px;">
                    ${window.i18n.t('print_chart_expenses_breakdown') || 'Répartition des Dépenses'}
                </div>
                ${legendItems.join('')}
            </div>
        </div>`;
    },

    _generateBarChartSVG(months, incomeByMonth, expenseByMonth) {
        if (!months || months.length === 0) return '';
        const maxVal = Math.max(...months.map(m => Math.max(incomeByMonth[m] || 0, expenseByMonth[m] || 0)), 100);
        const chartHeight = 120;
        const chartWidth = 550;
        const marginX = 40;
        const marginY = 20;
        
        const groupWidth = (chartWidth - marginX * 2) / months.length;
        const barWidth = Math.max(Math.min(groupWidth * 0.35, 14), 6);

        const bars = [];
        const monthLabels = [];

        months.forEach((m, idx) => {
            const inc = incomeByMonth[m] || 0;
            const exp = expenseByMonth[m] || 0;

            const incH = (inc / maxVal) * chartHeight;
            const expH = (exp / maxVal) * chartHeight;

            const xCenter = marginX + idx * groupWidth + groupWidth / 2;
            const incX = xCenter - barWidth - 1;
            const expX = xCenter + 1;

            const incY = marginY + (chartHeight - incH);
            const expY = marginY + (chartHeight - expH);

            if (inc > 0) bars.push(`<rect x="${incX}" y="${incY}" width="${barWidth}" height="${incH}" fill="#10b981" rx="2" />`);
            if (exp > 0) bars.push(`<rect x="${expX}" y="${expY}" width="${barWidth}" height="${expH}" fill="#ef4444" rx="2" />`);

            const mParts = m.split('-');
            const monthNum = parseInt(mParts[1]);
            const mNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
            const mLabel = mNames[monthNum - 1] || mParts[1];

            monthLabels.push(`<text x="${xCenter}" y="${marginY + chartHeight + 15}" font-size="10" fill="#64748b" text-anchor="middle">${mLabel}</text>`);
        });

        return `
        <div style="background:var(--bg-surface); padding:16px; border-radius:10px; border:1px solid var(--border-color); margin-bottom:16px; page-break-inside:avoid;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid var(--border-color); padding-bottom:4px;">
                <span style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted);">
                    ${window.i18n.t('print_chart_monthly_compare') || 'Comparatif Mensuel Recettes vs Dépenses'}
                </span>
                <div style="display:flex; gap:12px; font-size:11px; font-weight:600;">
                    <span style="color:#10b981;">■ ${window.i18n.t('type_income') || 'Recettes'}</span>
                    <span style="color:#ef4444;">■ ${window.i18n.t('type_expense_fixed') || 'Dépenses'}</span>
                </div>
            </div>
            <svg width="100%" height="160" viewBox="0 0 580 160" style="overflow:visible;">
                ${bars.join('')}
                ${monthLabels.join('')}
            </svg>
        </div>`;
    },

    _generateSignatureBlockHTML() {
        const isOrgMode = window.app && window.app.config && (window.app.config.enable_org_mode === 'true' || window.app.config.enable_org_mode === true);
        if (!isOrgMode) return '';

        const userName = window.app?.currentUser || 'Trésorier';
        const now = new Date();
        const pad = n => n < 10 ? '0'+n : n;
        const dateStr = `${pad(now.getDate())}/${pad(now.getMonth()+1)}/${now.getFullYear()} à ${pad(now.getHours())}:${pad(now.getMinutes())}`;

        return `
        <div style="margin-top:24px; padding:16px; border:1px dashed var(--border-color); border-radius:10px; background:var(--bg-surface); page-break-inside:avoid;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:20px;">
                <div style="flex:1;">
                    <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px;">
                        ${window.i18n.t('print_signature_audit_title') || 'Validation & Certificats de Trésorerie'}
                    </div>
                    <div style="font-size:11px; color:var(--text-muted); line-height:1.4;">
                        ${window.i18n.t('print_signature_audit_desc') || 'Document certifié exact et conforme aux écritures comptables enregistrées dans OmniBank Local.'}
                    </div>
                    <div style="font-size:11px; font-weight:600; margin-top:8px; color:var(--text-main);">
                        Émis par : <span>${userName}</span> — le <span>${dateStr}</span>
                    </div>
                </div>
                <div style="width:200px; height:80px; border:1px solid var(--border-color); border-radius:8px; padding:8px; background:#fff; display:flex; flex-direction:column; justify-content:space-between;">
                    <span style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Signature / Cachet</span>
                </div>
            </div>
        </div>`;
    }
};
