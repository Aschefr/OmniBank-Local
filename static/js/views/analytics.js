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
    _cachedQueryKey: null,

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
                    <div id="analyticsPeriodWrapper" class="filter-pill">
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

        // Apply custom range toggle state to UI
        const crToggle = document.getElementById('analyticsCustomRangeToggle');
        const crInputs = document.getElementById('analyticsCustomRangeInputs');
        const periodSel = document.getElementById('analyticsPeriod');
        const periodWrapper = document.getElementById('analyticsPeriodWrapper') || periodSel?.closest('.filter-pill');
        if (crToggle && this.customRange.enabled) {
            crToggle.checked = true;
            if (crInputs) crInputs.style.display = 'flex';
            if (periodWrapper) periodWrapper.style.display = 'none';
            if (periodSel) periodSel.disabled = true;
            if (this.customRange.start) document.getElementById('analyticsCustomStart').value = this.customRange.start;
            if (this.customRange.end) document.getElementById('analyticsCustomEnd').value = this.customRange.end;
        }

        // Render account bar immediately
        this.renderAccountBar();

        // Show custom period toggle only if org license is active (non-blocking)
        if (window.LicenseManager && typeof window.LicenseManager.getStatus === 'function') {
            window.LicenseManager.getStatus().then(license => {
                const wrapper = document.getElementById('analyticsCustomRangeWrapper');
                if (wrapper && license && license.active) wrapper.style.display = 'flex';
            }).catch(() => {});
        }

        // SWR : Rendu instantané si des données correspondant à la requête actuelle sont déjà en mémoire
        const currentQueryKey = this._buildQueryUrl();
        let didSWR = false;
        if (this._cachedQueryKey === currentQueryKey && this.data && this.data.by_type && Object.keys(this.data.by_type).length > 0) {
            this.populatePeriodSelector();
            this.renderAll(false);
            didSWR = true;
        }

        await this.loadData(didSWR);
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
        const periodWrapper = document.getElementById('analyticsPeriodWrapper') || periodSel?.closest('.filter-pill');
        if (inputs) inputs.style.display = enabled ? 'flex' : 'none';
        if (periodWrapper) periodWrapper.style.display = enabled ? 'none' : 'flex';
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

    _buildQueryUrl() {
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
        return url;
    },

    async loadData(preserveScroll = false) {
        try {
            const url = this._buildQueryUrl();
            const data = await API.get(url);
            this.data = data;
            this._cachedQueryKey = url;
            this.populatePeriodSelector();
            this.renderAll(preserveScroll);
        } catch (e) {
            if (!this.data) {
                document.getElementById('analyticsContainer').innerHTML =
                    `<p style="color:var(--color-expense);padding:20px;">${window.i18n.t('title_error')} : ${e.message}</p>`;
            }
        }
    },

    formatShortMonth(mk) {
        const [y, m] = mk.split('-');
        const d = new Date(parseInt(y), parseInt(m) - 1, 1);
        return d.toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', { month: 'short', year: '2-digit' });
    },

    formatMonthHeader(mk, forPrint = false) {
        if (!forPrint) return this.formatShortMonth(mk);
        const [y, m] = mk.split('-');
        const d = new Date(parseInt(y), parseInt(m) - 1, 1);
        const lang = (window.i18n && window.i18n.currentLang === 'en') ? 'en-US' : 'fr-FR';
        const raw = d.toLocaleDateString(lang, { month: 'short' }).replace('.', '').trim();
        return raw.charAt(0).toUpperCase() + raw.slice(1);
    },

    renderAll(preserveScroll = false) {
        const container = document.getElementById('analyticsContainer');
        if (!container) return;
        if (!this.data || !this.data.by_type || Object.keys(this.data.by_type).length === 0) {
            container.innerHTML = `<p style="color:var(--text-muted);padding:20px;">${window.i18n.t('analytics_no_data')}</p>`;
            return;
        }

        const scrollX = preserveScroll ? container.scrollLeft : 0;
        const scrollY = preserveScroll ? container.scrollTop : 0;

        const { months, years, by_type } = this.data;
        const revYears = (years || []).slice().reverse();

        // Dynamically build and render years in the popover
        this.renderYearsPopover(revYears);

        const sections = [];
        for (const [txType, typeData] of Object.entries(by_type)) {
            sections.push(this.renderTypeTable(txType, typeData, months, revYears));
        }
        container.innerHTML = sections.join('');

        if (preserveScroll) {
            container.scrollLeft = scrollX;
            container.scrollTop = scrollY;
        }
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

        const monthHeaders = months.map(mk => {
            const mLabel = forPrint ? this.formatMonthHeader(mk, true) : this.formatShortMonth(mk);
            const mStyle = forPrint
                ? `text-align:right;white-space:nowrap;border-bottom:1px solid ${hbd};background:var(--bg-surface);`
                : `text-align:right;min-width:80px;white-space:nowrap;border-bottom:1px solid ${hbd};position:sticky;top:0;background:var(--bg-surface);z-index:20;`;
            return `<th data-year="${mk.split('-')[0]}" data-col-type="month" style="${mStyle}">${mLabel}</th>`;
        }).join('');

        const yearHeaders = displayYears.map(yr => {
            const yrStyle = forPrint
                ? `text-align:right;white-space:normal;line-height:1.2;padding-top:4px;padding-bottom:4px;border-left:${annualSep};border-bottom:1px solid ${hbd};color:var(--text-main);background:${hb};`
                : `text-align:right;min-width:90px;white-space:normal;line-height:1.2;padding-top:8px;padding-bottom:8px;border-left:${annualSep};border-bottom:1px solid ${hbd};color:var(--text-main);background:${hb};position:sticky;top:0;z-index:20;backdrop-filter:blur(5px);`;
            return `<th data-year="${yr}" data-col-type="year" style="${yrStyle}">TOT.<span class="year-br"></span>${yr}</th>`;
        }).join('');

        const catW = forPrint ? 125 : (this._catColWidth || 160);
        const catStyle = `text-align:left;width:${catW}px;min-width:${forPrint ? '70px' : '60px'};max-width:${forPrint ? '135px' : '500px'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid ${hbd};position:${forPrint ? 'static' : 'sticky'};left:0;background:var(--bg-surface);z-index:15;box-shadow:${forPrint ? 'none' : '3px 0 6px rgba(0,0,0,0.2)'};box-sizing:border-box;`;
        const catHeaderStyle = `text-align:left;width:${catW}px;min-width:${forPrint ? '70px' : '60px'};max-width:${forPrint ? '135px' : '500px'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid ${hbd};position:${forPrint ? 'static' : 'sticky'};left:0;top:0;background:var(--bg-surface);z-index:30;box-shadow:${forPrint ? 'none' : '3px 0 6px rgba(0,0,0,0.2)'};box-sizing:border-box;`;

        let html = `
        <div data-type="${txType}" style="border:1px solid ${hbd};border-radius:12px;${forPrint ? 'display:block;page-break-inside:auto;break-inside:auto;margin-bottom:20px;' : 'display:flex;flex-direction:column;max-height:75vh;'}">
            <div class="analytics-card-header" style="background:${hb};border-bottom:1px solid ${hbd};">
                <div class="analytics-card-header-top">
                    <span class="analytics-card-title">${cfg.emoji} ${translatedType}</span>
                    <div class="analytics-card-stats">
                        <span class="privacy-blur analytics-card-total">${window.i18n.t('analytics_total_period')} : ${cfg.sign}${formatCurrency(grand_total)}</span>
                        ${hasInactive ? `<button data-inactive-btn="${txType}" class="btn btn-secondary print-hide analytics-inactive-btn" onclick="window.AnalyticsView.toggleInactiveRows('${txType}')" title="${window.i18n.t('analytics_inactive_cats_tooltip') || 'Catégories sans activité sur cette période — présentes dans l\'historique'}">👁 ${inactiveCatEntries.length} ${window.i18n.t('analytics_inactive_cats') || 'inactives'}</button>` : ''}
                    </div>
                </div>
                <div class="print-hide analytics-card-controls">
                    <!-- Bloc Gradient -->
                    <div class="analytics-gradient-control">
                        <span class="analytics-control-label" data-i18n="analytics_gradient_label">${window.i18n.t('analytics_gradient_label') || 'Gradient:'}</span>
                        <input type="range" min="0.0" max="2.0" value="${sliderVal}" step="0.01" class="analytics-slider" oninput="window.AnalyticsView.onGradientChange('${txType}', this.value)">
                        <span class="reset-gradient-btn" style="cursor:pointer;opacity:0.6;font-size:11px;transition:opacity 0.2s, visibility 0.2s;visibility:${isProp ? 'hidden' : 'visible'};" title="Réinitialiser (Proportionnel)" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" onclick="window.AnalyticsView.onGradientChange('${txType}', '1.0'); this.parentElement.querySelector('input[type=range]').value = '1.0';">↺</span>
                        <span class="gradient-label-value">${currentLabel}</span>
                    </div>
                    
                    <!-- Séparateur -->
                    <div class="analytics-control-sep"></div>

                    <!-- Bloc Couleur -->
                    <div class="analytics-color-control">
                        <span class="analytics-control-label" data-i18n="analytics_color_label">${window.i18n.t('analytics_color_label') || 'Color:'}</span>
                        <input type="color" value="${cfg.color}" class="analytics-color-input" title="Changer la couleur du tableau" oninput="window.AnalyticsView.onColorChange('${txType}', this.value)">
                        <span class="reset-color-btn" style="cursor:pointer;opacity:0.6;font-size:11px;transition:opacity 0.2s, display 0.2s;display:${savedColor ? 'inline' : 'none'};" title="Restaurer la couleur par défaut" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6" onclick="ProfileStorage.remove('analytics_color_${txType}'); window.AnalyticsView.renderAll();">⟲</span>
                    </div>
                </div>
            </div>
            <div class="analytics-table-scroll-container" style="${forPrint ? 'overflow:visible;' : 'overflow:auto;'}flex-grow:1;border-bottom-left-radius:12px;border-bottom-right-radius:12px;">
            <table class="data-table" style="${forPrint ? 'width:100%;table-layout:fixed;' : `min-width:${220 + months.length * 80 + displayYears.length * 90}px;`}border-radius:0;border:none;margin:0;border-collapse:separate;border-spacing:0;">
            <thead><tr style="background:var(--bg-surface);">
                <th data-col-type="cat" style="${catHeaderStyle}" data-i18n="analytics_th_category">${window.i18n.t('analytics_th_category')}<span class="col-resize-handle" onmousedown="window.AnalyticsView._startResize(event)"></span></th>
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
                <td title="${cat.replace(/"/g, '&quot;')}" style="font-weight:500;width:${catW}px;min-width:60px;max-width:500px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:${forPrint ? 'static' : 'sticky'};left:0;z-index:5;
                    background:var(--bg-surface);
                    box-shadow:${forPrint ? 'none' : '3px 0 8px rgba(0,0,0,0.25)'};">${cat}</td>
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
                <td title="${cat.replace(/"/g, '&quot;')}" style="font-weight:400;width:${catW}px;min-width:60px;max-width:500px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:${forPrint ? 'static' : 'sticky'};left:0;z-index:5;
                    background:var(--bg-surface);color:var(--text-muted);
                    box-shadow:${forPrint ? 'none' : '3px 0 8px rgba(0,0,0,0.25)'};">${cat}</td>
                ${monthCells}
                ${yearCells}
            </tr>`;
        }

        // Total row
        const totalMonthCells = months.map(mk => {
            const v = totals_per_month[mk] || 0;
            return `<td data-year="${mk.split('-')[0]}" data-col-type="month" style="text-align:right;color:var(--text-main);background:${hb};position:${forPrint ? 'static' : 'sticky'};bottom:0;z-index:20;border-top:2px solid ${hbd};${forPrint ? '' : 'backdrop-filter:blur(5px);'}"><span class="privacy-blur">${v > 0 ? formatCurrency(v) : '—'}</span></td>`;
        }).join('');

        const totalYearCells = displayYears.map(yr => {
            const v = (annual_totals_per_year || {})[yr] || 0;
            return `<td data-year="${yr}" data-col-type="year" style="text-align:right;border-left:${annualSep};color:var(--text-main);background:${hb};position:${forPrint ? 'static' : 'sticky'};bottom:0;z-index:20;border-top:2px solid ${hbd};${forPrint ? '' : 'backdrop-filter:blur(5px);'}"><span class="privacy-blur">${v > 0 ? formatCurrency(v) : '—'}</span></td>`;
        }).join('');

        html += `<tr style="font-weight:700;">
            <td style="color:var(--text-main);font-weight:700;position:${forPrint ? 'static' : 'sticky'};left:0;bottom:0;z-index:25;padding-left:${forPrint ? '4px' : '16px'};
                background:var(--bg-surface);border-top:2px solid ${hbd};
                box-shadow:${forPrint ? 'none' : `inset 0 0 0 999px ${hb}, 3px 0 8px rgba(0,0,0,0.3)`};width:${catW}px;max-width:${forPrint ? '135px' : '500px'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">TOT. ${translatedType.toUpperCase()}</td>
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
            const titleSpan = headerDiv.querySelector('.analytics-card-title') || headerDiv.firstElementChild;
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
        const savedIncludeCompteResultat = ProfileStorage.get('print_sec_enabled_compte_resultat_ag') !== 'false';
        const savedIncludeQuitus = ProfileStorage.get('print_sec_enabled_quitus_ag') === 'true';
        const savedAgDate = ProfileStorage.get('print_ag_date') || '';
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
                        <input type="checkbox" class="export-type-pagebreak-cb" data-type="${type}" ${typePageBreak ? 'checked' : ''} onchange="ProfileStorage.set('print_type_pagebreak_${type}', this.checked); window.AnalyticsView.triggerLivePreviewUpdate();">
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
                <input type="checkbox" class="export-col-cb" value="${c.id}" ${savedCols.includes(c.id) ? 'checked' : ''} onchange="window.AnalyticsView.triggerLivePreviewUpdate()"> ${c.label}
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
                <input type="text" id="exportHeaderTitle" class="inline-input" list="exportTitlePresets" placeholder="${window.i18n.t('export_header_title_placeholder') || 'Titre du document'}" value="${savedHeaderTitle.replace(/"/g, '&quot;')}" style="width:100%;" oninput="ProfileStorage.set('print_header_title', this.value); window.AnalyticsView.triggerLivePreviewUpdate();">
                <datalist id="exportTitlePresets">
                    <option value="${window.i18n.t('export_preset_annual') || 'Bilan Financier Annuel'}">
                    <option value="${window.i18n.t('export_preset_result') || 'Compte de Résultat'}">
                    <option value="${window.i18n.t('export_preset_cse') || 'Rapport de Trésorerie CSE / Association'}">
                    <option value="${window.i18n.t('export_preset_personal') || 'Synthèse des Comptes Personnels'}">
                </datalist>
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <button class="btn btn-secondary" style="font-size:12px;padding:6px 14px;" onclick="document.getElementById('exportLogoFileInput').click()">${window.i18n.t('export_header_logo_import') || 'Importer logo'}</button>
                    <input type="file" id="exportLogoFileInput" accept="image/*" style="display:none;" onchange="window.AnalyticsView._handleLogoUpload(this)">
                    ${savedLogoB64 ? `<button class="btn btn-danger" style="font-size:12px;padding:6px 14px;" onclick="ProfileStorage.remove('print_header_logo');document.getElementById('exportLogoPreview').outerHTML='<div id=\'exportLogoPreview\'></div>';this.remove();window.AnalyticsView.triggerLivePreviewUpdate();">${window.i18n.t('export_header_logo_remove') || 'Supprimer logo'}</button>` : ''}
                </div>
                ${savedLogoB64 ? `<img id="exportLogoPreview" src="${savedLogoB64}" style="max-height:60px;max-width:200px;border-radius:6px;border:1px solid var(--border-color);object-fit:contain;">` : '<div id="exportLogoPreview"></div>'}
                <div style="display:flex;gap:16px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                        <input type="checkbox" id="exportLogoLeft" ${savedLogoLeft ? 'checked' : ''} style="accent-color:var(--accent);" onchange="ProfileStorage.set('print_logo_left', this.checked); window.AnalyticsView.triggerLivePreviewUpdate();">
                        ${window.i18n.t('export_logo_position_left') || 'Logo à gauche'}
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                        <input type="checkbox" id="exportLogoRight" ${savedLogoRight ? 'checked' : ''} style="accent-color:var(--accent);" onchange="ProfileStorage.set('print_logo_right', this.checked); window.AnalyticsView.triggerLivePreviewUpdate();">
                        ${window.i18n.t('export_logo_position_right') || 'Logo à droite'}
                    </label>
                </div>
            </div>
        </div>` : '';

        // Définition de l'ensemble des sections disponibles
        const sectionDefs = {
            header: {
                title: `🏛️ ${window.i18n.t('export_sec_header') || 'En-tête & Titre du document'}`,
                isEnabled: ProfileStorage.get('print_sec_enabled_header') !== 'false',
                content: orgHeaderHtml,
                isOrgOnly: true
            },
            compte_resultat_ag: {
                title: `📊 ${window.i18n.t('export_sec_compte_resultat_ag') || 'Compte de Résultat Simplifié (AG)'}`,
                isEnabled: savedIncludeCompteResultat,
                content: `<div style="font-size:12px;color:var(--text-muted);">${window.i18n.t('export_sec_compte_resultat_desc') || 'Présente la synthèse des Produits d\'exploitation, Charges d\'exploitation, l\'Excédent/Déficit net ainsi que la variation de trésorerie.'}</div>`,
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
                                    <input type="checkbox" class="export-year-total-cb" value="${y}" ${savedYearsTotals.includes(y) ? 'checked' : ''} onchange="window.AnalyticsView.triggerLivePreviewUpdate();"> ${y}
                                </label>
                            `).join('')}
                        </div>
                    </div>
                    <div style="margin-bottom:12px;">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                            <input type="checkbox" id="exportIncludeInactive" ${ProfileStorage.get('print_settings_include_inactive') !== 'false' ? 'checked' : ''} onchange="window.AnalyticsView.triggerLivePreviewUpdate();">
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
            quitus_ag: {
                title: `✍️ ${window.i18n.t('export_sec_quitus_ag') || 'Certification & Quitus d\'Assemblée Générale'}`,
                isEnabled: savedIncludeQuitus,
                content: `
                    <div style="display:flex;flex-direction:column;gap:8px;">
                        <label style="font-size:12px;display:flex;align-items:center;gap:8px;">
                            <span>${window.i18n.t('export_org_ag_date_label') || 'Date de l\'Assemblée Générale :'}</span>
                            <input type="date" id="exportAgDate" class="inline-input" value="${savedAgDate}" style="width:140px;" onchange="ProfileStorage.set('print_ag_date', this.value); window.AnalyticsView.triggerLivePreviewUpdate();">
                        </label>
                        <div style="font-size:11px;color:var(--text-muted);">${window.i18n.t('export_org_quitus_text') || 'Le présent rapport financier a été certifié conforme aux comptes et écritures d\'OmniBank et soumis à l\'approbation de l\'Assemblée Générale Ordinaire.'}</div>
                    </div>`,
                isOrgOnly: true
            },
            signature: {
                title: `✍️ ${window.i18n.t('export_sec_signature') || 'Validation & Bloc de signature simple'}`,
                isEnabled: savedIncludeSignature,
                content: '',
                isOrgOnly: true
            }
        };

        const defaultOrder = isOrgMode
            ? ['header', 'compte_resultat_ag', 'kpi', 'pie_chart', 'bar_chart', 'balances', 'type_tables', 'transactions_list', 'quitus_ag', 'signature']
            : ['kpi', 'pie_chart', 'bar_chart', 'balances', 'type_tables', 'transactions_list'];

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
            <div class="modal export-modal-split" style="display:flex; flex-direction:column;">
                <!-- Header with Title, Mode Badge, Presets, Screen Toggle & Close -->
                <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid var(--border-color); flex-wrap:wrap; gap:10px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <h3 style="margin:0;">${window.i18n.t('export_modal_title')}</h3>
                        ${isOrgMode ? `<span class="badge" style="background:rgba(99,102,241,0.12); color:var(--accent); font-size:11px; font-weight:700; padding:2px 8px; border-radius:12px; border:1px solid rgba(99,102,241,0.3);">🏛️ ${window.i18n.t('export_badge_org_mode') || 'Mode Organisation'}</span>` : ''}
                    </div>
                    
                    <!-- Presets 1-clic -->
                    <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                        <span style="font-size:11px; color:var(--text-muted); font-weight:600;">Modèles :</span>
                        ${isOrgMode ? `
                            <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="window.AnalyticsView.applyExportPreset('ag')" title="${window.i18n.t('export_preset_btn_ag_tooltip')}">
                                ${window.i18n.t('export_preset_btn_ag')}
                            </button>
                            <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="window.AnalyticsView.applyExportPreset('ledger')" title="${window.i18n.t('export_preset_btn_ledger_tooltip')}">
                                ${window.i18n.t('export_preset_btn_ledger')}
                            </button>
                        ` : `
                            <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="window.AnalyticsView.applyExportPreset('personal')" title="${window.i18n.t('export_preset_btn_personal_tooltip')}">
                                ${window.i18n.t('export_preset_btn_personal')}
                            </button>
                            <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 10px;" onclick="window.AnalyticsView.applyExportPreset('detailed')" title="${window.i18n.t('export_preset_btn_detailed_personal_tooltip')}">
                                ${window.i18n.t('export_preset_btn_detailed_personal')}
                            </button>
                        `}
                    </div>

                    <!-- Screen toggle for responsive mobile/tablet -->
                    <div class="export-preview-screen-toggle">
                        <button type="button" id="togglePaneConfig" class="btn btn-secondary btn-sm active" style="font-size:11px; padding:3px 8px;" onclick="window.AnalyticsView.switchPreviewPane('config')">${window.i18n.t('export_preview_tab_config') || '⚙️ Réglages'}</button>
                        <button type="button" id="togglePanePreview" class="btn btn-secondary btn-sm" style="font-size:11px; padding:3px 8px;" onclick="window.AnalyticsView.switchPreviewPane('preview')">${window.i18n.t('export_preview_tab_preview') || '👁️ Aperçu (A4)'}</button>
                    </div>

                    <button class="btn btn-secondary" style="padding:4px 8px; border:none; font-size:16px; margin-left:auto;" onclick="document.getElementById('exportPdfModal').remove()">✕</button>
                </div>

                <!-- Split Body: Left Configuration & Right Live A4 Sheet -->
                <div class="export-modal-body-split">
                    <!-- Left Config Pane -->
                    <div id="exportConfigPane" class="export-config-pane">
                        <!-- Période du document -->
                        <div style="padding:12px; background:rgba(0,0,0,0.02); border-radius:8px; border:1px solid var(--border-color);">
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
                                    <input type="date" id="exportDateStart" class="inline-input" value="${savedCustomStart}" style="width:140px;" onchange="window.AnalyticsView.onExportCustomDatesChange()">
                                </label>
                                <label style="font-size:13px; display:flex; align-items:center; gap:6px;">
                                    <span>${window.i18n.t('export_date_end') || 'Au :'}</span>
                                    <input type="date" id="exportDateEnd" class="inline-input" value="${savedCustomEnd}" style="width:140px;" onchange="window.AnalyticsView.onExportCustomDatesChange()">
                                </label>
                            </div>
                        </div>

                        <!-- Filtre de comptes -->
                        <div>
                            <h4 style="margin-bottom:8px;color:var(--text-muted);font-size:11px;text-transform:uppercase;">${window.i18n.t('export_modal_accounts')}</h4>
                            <div id="exportAccountBadges" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
                        </div>

                        <!-- Liste des sections réordonnables -->
                        <div>
                            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                                <h4 style="margin:0;color:var(--text-muted);font-size:11px;text-transform:uppercase;">${window.i18n.t('export_sections_order_title') || 'Sections du document'}</h4>
                                <button type="button" class="btn btn-secondary" style="font-size:11px; padding:4px 10px; display:inline-flex; align-items:center; gap:6px; background:rgba(99,102,241,0.08); color:var(--accent); border:1px dashed var(--accent); cursor:pointer;" onclick="window.AnalyticsView._addPageBreakCard()">
                                    ➕ ✂️ ${window.i18n.t('export_add_page_break') || 'Ajouter un saut de page'}
                                </button>
                            </div>
                            <div id="exportSectionsList">
                                ${sectionsCardsHtml}
                            </div>
                        </div>

                        <!-- Options d'impression générales -->
                        <div style="padding-top:10px; border-top:1px solid var(--border-color);">
                            <h4 style="margin-bottom:8px;color:var(--text-muted);font-size:11px;text-transform:uppercase;">${window.i18n.t('export_font_sizes_section') || 'Tailles de polices'}</h4>
                            <div style="display:flex;gap:20px;flex-wrap:wrap;">
                                ${isOrgMode ? `
                                <label style="font-size:13px; display:flex; align-items:center; gap:8px;">
                                    <span>${window.i18n.t('export_title_font_size') || 'Titre :'}</span>
                                    <select id="exportTitleFontSize" class="inline-input" style="width:140px;" onchange="ProfileStorage.set('print_settings_title_font_size', this.value); window.AnalyticsView.triggerLivePreviewUpdate();">
                                        <option value="small" ${savedTitleFontSize === 'small' ? 'selected' : ''}>${window.i18n.t('export_font_size_small') || 'Petit'}</option>
                                        <option value="medium" ${savedTitleFontSize === 'medium' ? 'selected' : ''}>${window.i18n.t('export_font_size_medium') || 'Moyen (Défaut)'}</option>
                                        <option value="large" ${savedTitleFontSize === 'large' ? 'selected' : ''}>${window.i18n.t('export_font_size_large') || 'Grand'}</option>
                                    </select>
                                </label>
                                ` : ''}
                                <label style="font-size:13px; display:flex; align-items:center; gap:8px;">
                                    <span>${window.i18n.t('export_table_font_size') || 'Tableaux :'}</span>
                                    <select id="exportTableFontSize" class="inline-input" style="width:140px;" onchange="ProfileStorage.set('print_settings_table_font_size', this.value); window.AnalyticsView.triggerLivePreviewUpdate();">
                                        <option value="small" ${savedTableFontSize === 'small' ? 'selected' : ''}>${window.i18n.t('export_font_size_small') || 'Petit'}</option>
                                        <option value="medium" ${savedTableFontSize === 'medium' ? 'selected' : ''}>${window.i18n.t('export_font_size_medium') || 'Moyen (Défaut)'}</option>
                                        <option value="large" ${savedTableFontSize === 'large' ? 'selected' : ''}>${window.i18n.t('export_font_size_large') || 'Grand'}</option>
                                    </select>
                                </label>
                            </div>
                        </div>
                    </div>

                    <!-- Right Live Preview Pane -->
                    <div id="exportPreviewPane" class="export-preview-pane">
                        <div style="width:100%; max-width:820px; display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding:0 4px;">
                            <div style="display:flex; align-items:center; gap:8px;">
                                <span style="font-weight:700; font-size:12px; color:#475569; text-transform:uppercase; letter-spacing:0.5px;">👁️ ${window.i18n.t('export_preview_title') || 'Aperçu du document'}</span>
                                <span id="exportPreviewStatus" style="font-size:11px; font-weight:600; color:#10b981; background:rgba(16,185,129,0.1); padding:2px 8px; border-radius:10px;">✓ ${window.i18n.t('export_preview_live_badge') || 'Temps réel'}</span>
                            </div>
                            <span id="exportPageCountBadge" style="font-size:11px; color:#64748b; font-weight:600;">Format Page A4</span>
                        </div>
                        <div id="exportPaperContainer" class="export-paper-container">
                            <!-- Rendu A4 multi-pages dynamique injecté ici -->
                        </div>
                    </div>
                </div>

                <!-- Footer Actions -->
                <div class="modal-actions" style="margin-top:12px; padding-top:10px; border-top:1px solid var(--border-color); display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div style="font-size:11px; color:var(--text-muted);">${window.i18n.t('export_modal_hint') || 'Prévisualisation dynamique du document au format A4. Cliquez sur Imprimer pour générer votre document ou PDF.'}</div>
                    <div style="display:flex; gap:10px;">
                        <button class="btn btn-secondary" onclick="document.getElementById('exportPdfModal').remove()">${window.i18n.t('export_modal_cancel')}</button>
                        <button class="btn btn-primary" onclick="window.AnalyticsView.executePrint()">🖨️ ${window.i18n.t('export_modal_print')}</button>
                    </div>
                </div>
            </div>
        </div>`;

        document.body.insertAdjacentHTML('beforeend', modalHtml);

        this.switchExportTab(savedTabMode);
        this._exportAccountIds = this.selectedAccountIds ? [...this.selectedAccountIds] : null;
        this._renderExportAccountBadges();
        this._renderExportBalanceCheckboxes();
        this._initSectionDragAndDrop();
        this._initExportModalListeners(document.getElementById('exportPdfModal'));

        // Cacher données initiales et lancer l'aperçu immédiat
        this._cachedPrintData = this.data;
        this._fetchExportAuxiliaryData().then(() => {
            this.triggerLivePreviewUpdate();
        });
        this.triggerLivePreviewUpdate();
    },

    _initExportModalListeners(modal) {
        if (!modal) return;
        const configPane = modal.querySelector('#exportConfigPane');
        if (!configPane) return;
        const handleChange = (e) => {
            if (e.target.matches('input, select, textarea')) {
                this.triggerLivePreviewUpdate();
            }
        };
        configPane.addEventListener('change', handleChange);
        configPane.addEventListener('input', handleChange);
    },

    switchPreviewPane(pane) {
        const configPane = document.getElementById('exportConfigPane');
        const previewPane = document.getElementById('exportPreviewPane');
        const btnConfig = document.getElementById('togglePaneConfig');
        const btnPreview = document.getElementById('togglePanePreview');
        if (!configPane || !previewPane) return;

        if (pane === 'config') {
            configPane.classList.remove('hidden-pane');
            configPane.classList.add('active-pane');
            previewPane.classList.remove('active-pane');
            if (btnConfig) btnConfig.classList.add('active');
            if (btnPreview) btnPreview.classList.remove('active');
        } else {
            configPane.classList.add('hidden-pane');
            configPane.classList.remove('active-pane');
            previewPane.classList.add('active-pane');
            if (btnConfig) btnConfig.classList.remove('active');
            if (btnPreview) btnPreview.classList.add('active');
            this.triggerLivePreviewUpdate();
        }
    },

    applyExportPreset(preset) {
        const modal = document.getElementById('exportPdfModal');
        if (!modal) return;

        if (preset === 'ag') {
            const titleInput = modal.querySelector('#exportHeaderTitle');
            if (titleInput) {
                titleInput.value = window.i18n.t('export_preset_ag_title') || 'Rapport Financier - Assemblée Générale Ordinaire';
                ProfileStorage.set('print_header_title', titleInput.value);
            }
            const setCb = (id, checked) => {
                const cb = modal.querySelector(`#sec_enable_${id}`);
                if (cb) { cb.checked = checked; this._onSectionEnableChange(id, checked); }
            };
            setCb('header', true);
            setCb('compte_resultat_ag', true);
            setCb('kpi', true);
            setCb('pie_chart', true);
            setCb('bar_chart', true);
            setCb('balances', true);
            setCb('type_tables', true);
            setCb('transactions_list', false);
            setCb('quitus_ag', true);
            setCb('signature', false);

            const agOrder = ['header', 'compte_resultat_ag', 'kpi', 'balances', 'pie_chart', 'bar_chart', 'type_tables', 'quitus_ag'];
            this._reorderSectionCards(agOrder);
            showToast(window.i18n.t('export_preset_applied_ag') || 'Modèle Assemblée Générale appliqué 🏛️', 'success');
        } else if (preset === 'ledger') {
            const titleInput = modal.querySelector('#exportHeaderTitle');
            if (titleInput) {
                titleInput.value = window.i18n.t('export_preset_ledger_title') || 'Grand Livre & Audit Analytique';
                ProfileStorage.set('print_header_title', titleInput.value);
            }
            const setCb = (id, checked) => {
                const cb = modal.querySelector(`#sec_enable_${id}`);
                if (cb) { cb.checked = checked; this._onSectionEnableChange(id, checked); }
            };
            setCb('header', true);
            setCb('compte_resultat_ag', true);
            setCb('kpi', true);
            setCb('pie_chart', false);
            setCb('bar_chart', false);
            setCb('balances', true);
            setCb('type_tables', true);
            setCb('transactions_list', true);
            setCb('quitus_ag', false);
            setCb('signature', true);

            modal.querySelectorAll('.export-col-cb').forEach(cb => cb.checked = true);
            const allCols = Array.from(modal.querySelectorAll('.export-col-cb')).map(cb => cb.value);
            ProfileStorage.set('print_settings_cols', JSON.stringify(allCols));

            const ledgerOrder = ['header', 'compte_resultat_ag', 'kpi', 'balances', 'type_tables', 'transactions_list', 'signature'];
            this._reorderSectionCards(ledgerOrder);
            showToast(window.i18n.t('export_preset_applied_ledger') || 'Modèle Grand Livre & Audit appliqué 📑', 'success');
        } else if (preset === 'personal') {
            const setCb = (id, checked) => {
                const cb = modal.querySelector(`#sec_enable_${id}`);
                if (cb) { cb.checked = checked; this._onSectionEnableChange(id, checked); }
            };
            setCb('kpi', true);
            setCb('pie_chart', true);
            setCb('bar_chart', true);
            setCb('balances', true);
            setCb('type_tables', true);
            setCb('transactions_list', false);
            setCb('signature', false);

            const personalOrder = ['kpi', 'balances', 'pie_chart', 'bar_chart', 'type_tables'];
            this._reorderSectionCards(personalOrder);
            showToast(window.i18n.t('export_preset_applied_personal') || 'Modèle Bilan Annuel Ménage appliqué 🏠', 'success');
        } else if (preset === 'detailed') {
            const setCb = (id, checked) => {
                const cb = modal.querySelector(`#sec_enable_${id}`);
                if (cb) { cb.checked = checked; this._onSectionEnableChange(id, checked); }
            };
            setCb('kpi', true);
            setCb('pie_chart', false);
            setCb('bar_chart', false);
            setCb('balances', true);
            setCb('type_tables', true);
            setCb('transactions_list', true);
            setCb('signature', false);

            const detailedOrder = ['kpi', 'balances', 'type_tables', 'transactions_list'];
            this._reorderSectionCards(detailedOrder);
            showToast(window.i18n.t('export_preset_applied_detailed') || 'Modèle Relevé Détaillé appliqué 📊', 'success');
        }

        this.triggerLivePreviewUpdate();
    },

    _reorderSectionCards(targetOrder) {
        const list = document.getElementById('exportSectionsList');
        if (!list) return;
        targetOrder.forEach(secId => {
            const card = list.querySelector(`.export-section-card[data-section-id="${secId}"]`);
            if (card) list.appendChild(card);
        });
        this._saveSectionsOrder();
        this._initSectionDragAndDrop();
    },

    async onExportYearChange(year) {
        ProfileStorage.set('print_settings_selected_year', year);
        await this._refreshExportData();
        this.triggerLivePreviewUpdate();
    },

    async onExportCustomDatesChange() {
        const modal = document.getElementById('exportPdfModal');
        if (!modal) return;
        const start = modal.querySelector('#exportDateStart')?.value;
        const end = modal.querySelector('#exportDateEnd')?.value;
        if (start) ProfileStorage.set('print_settings_custom_start', start);
        if (end) ProfileStorage.set('print_settings_custom_end', end);
        if (start && end && start <= end) {
            await this._refreshExportData();
            this.triggerLivePreviewUpdate();
        }
    },

    async _fetchExportAuxiliaryData() {
        try {
            const [accs, budgets, transactions] = await Promise.all([
                API.get('/api/accounts/'),
                API.get('/api/budgets/'),
                API.get('/api/transactions/?limit=10000')
            ]);
            this._cachedAccounts = accs || [];
            this._cachedBudgets = budgets || [];
            this._cachedAllTx = transactions || [];

            const accountsMap = {};
            (accs || []).forEach(a => { accountsMap[a.id] = a.name; });
            this._cachedAccountsMap = accountsMap;

            const budgetsMap = {};
            const categoryToBudgetMap = {};
            (budgets || []).forEach(b => {
                budgetsMap[b.id] = b.name;
                if (!b.is_project && b.categories) {
                    b.categories.forEach(cat => { categoryToBudgetMap[cat] = b.name; });
                }
            });
            this._cachedBudgetsMap = budgetsMap;
            this._cachedCategoryToBudgetMap = categoryToBudgetMap;
        } catch (e) {
            console.error("Error fetching auxiliary export data", e);
        }
    },

    async _refreshExportData() {
        const modal = document.getElementById('exportPdfModal');
        if (!modal) return;
        const tabMode = this._exportTabMode || 'year';
        const useCustom = tabMode === 'custom';
        const selectedYear = modal.querySelector('#exportSelectYear')?.value || this.selectedYear;
        const customStart = modal.querySelector('#exportDateStart')?.value;
        const customEnd = modal.querySelector('#exportDateEnd')?.value;
        const exportAccIds = this._exportAccountIds;

        let url = useCustom
            ? `/api/stats/categories_by_month?reconciled=${this.reconciled}&date_start=${customStart}&date_end=${customEnd}`
            : `/api/stats/categories_by_month?reconciled=${this.reconciled}&year=${selectedYear}`;
        if (exportAccIds && exportAccIds.length > 0) url += `&account_ids=${exportAccIds.join(',')}`;

        try {
            const res = await API.get(url);
            if (res && res.by_type) {
                this._cachedPrintData = res;
            }
        } catch (e) {
            console.error("Error refreshing export data", e);
        }
    },

    triggerLivePreviewUpdate() {
        if (this._previewDebounceTimer) clearTimeout(this._previewDebounceTimer);
        this._previewDebounceTimer = setTimeout(() => {
            this._renderLivePreview();
        }, 80);
    },

    async _renderLivePreview() {
        const modal = document.getElementById('exportPdfModal');
        if (!modal) return;
        const container = document.getElementById('exportPaperContainer') || document.getElementById('exportPaperSheet');
        if (!container) return;
        const status = document.getElementById('exportPreviewStatus');
        if (status) status.textContent = '⏳ ' + (window.i18n.t('export_preview_updating') || 'Actualisation...');

        const options = this._gatherExportOptions(modal);
        if (!this._cachedPrintData) {
            this._cachedPrintData = this.data;
        }
        options.printData = this._cachedPrintData;
        options.accounts = this._cachedAccounts || window.app.accounts || [];
        options.allTx = this._cachedAllTx || [];
        options.accountsMap = this._cachedAccountsMap || {};
        options.budgetsMap = this._cachedBudgetsMap || {};
        options.categoryToBudgetMap = this._cachedCategoryToBudgetMap || {};
        options.isForPreview = true;

        const html = this._buildReportHTML(options);
        container.innerHTML = html;

        // Épuration directe du DOM pour masquer/supprimer les catégories/types/colonnes non sélectionnés
        this._applyReportDOMFilters(container, options);

        // Insertion des repères visuels de coupe physique si une feuille dépasse la hauteur A4 (~1120px)
        const a4PhysicalHeight = 1120;
        let estimatedTotalPages = 0;
        const sheets = container.querySelectorAll('.export-paper-sheet');

        sheets.forEach(sheet => {
            const h = sheet.offsetHeight;
            const subPages = Math.max(1, Math.ceil(h / a4PhysicalHeight));
            estimatedTotalPages += subPages;

            if (h > 1200) {
                let cutPos = a4PhysicalHeight;
                while (cutPos < h - 120) {
                    const marker = document.createElement('div');
                    marker.className = 'export-a4-overflow-marker no-print';
                    marker.style.top = `${cutPos}px`;
                    marker.innerHTML = `
                        <div class="export-a4-overflow-cut-line"></div>
                        <div class="export-a4-overflow-cut-badge">
                            <span>${window.i18n.t('export_page_cut_indicator') || '✂️ Ligne de coupe physique A4 (Page suivante à l\'impression)'}</span>
                            <small>— ${window.i18n.t('export_page_cut_hint') || 'Insérez un saut de page pour maîtriser la séparation'}</small>
                        </div>
                    `;
                    sheet.appendChild(marker);
                    cutPos += a4PhysicalHeight;
                }
            }
        });

        const pageCountBadge = modal.querySelector('#exportPageCountBadge');
        if (pageCountBadge) {
            const displayCount = Math.max(sheets.length, estimatedTotalPages);
            if (displayCount > 1) {
                pageCountBadge.textContent = (window.i18n.t('export_page_count_badge') || '{count} pages A4').replace('{count}', displayCount);
            } else {
                pageCountBadge.textContent = window.i18n.t('export_page_single_badge') || '1 page A4';
            }
        }

        if (status) status.textContent = '✓ ' + (window.i18n.t('export_preview_live_badge') || 'Temps réel');
    },

    _gatherExportOptions(modal) {
        const isOrgMode = window.app && window.app.config && (window.app.config.enable_org_mode === 'true' || window.app.config.enable_org_mode === true);
        const tabMode = this._exportTabMode || 'year';
        const useCustomRange = tabMode === 'custom';
        const selectedYear = modal.querySelector('#exportSelectYear')?.value || null;
        const customStart = useCustomRange ? (modal.querySelector('#exportDateStart')?.value || null) : null;
        const customEnd = useCustomRange ? (modal.querySelector('#exportDateEnd')?.value || null) : null;

        const selectedYearsTotals = Array.from(modal.querySelectorAll('.export-year-total-cb:checked')).map(cb => cb.value);
        const selectedTypes = Array.from(modal.querySelectorAll('.export-type-cb:checked')).map(cb => cb.value);
        const selectedCats = Array.from(modal.querySelectorAll('.export-cat-cb:checked')).map(cb => cb.value);
        const selectedCols = Array.from(modal.querySelectorAll('.export-col-cb:checked')).map(cb => cb.value);
        const includeInactive = modal.querySelector('#exportIncludeInactive')?.checked ?? true;

        const isSecChecked = (secId) => modal.querySelector(`#sec_enable_${secId}`)?.checked ?? false;

        const includeDetails = isSecChecked('transactions_list');
        const includePieChart = isSecChecked('pie_chart');
        const includeBarChart = isSecChecked('bar_chart');
        const includeSignature = isSecChecked('signature');
        const includeCompteResultatAg = isSecChecked('compte_resultat_ag');
        const includeQuitusAg = isSecChecked('quitus_ag');

        const titleFontSize = modal.querySelector('#exportTitleFontSize')?.value || 'medium';
        const tableFontSize = modal.querySelector('#exportTableFontSize')?.value || 'medium';

        const headerTitle = modal.querySelector('#exportHeaderTitle')?.value?.trim() || '';
        const headerLogoB64 = ProfileStorage.get('print_header_logo') || null;
        const logoLeft = modal.querySelector('#exportLogoLeft')?.checked ?? true;
        const logoRight = modal.querySelector('#exportLogoRight')?.checked ?? true;
        const agDate = modal.querySelector('#exportAgDate')?.value || ProfileStorage.get('print_ag_date') || '';

        const balanceCbs = modal.querySelectorAll('.export-balance-cb:checked');
        const selectedBalanceIds = Array.from(balanceCbs).map(cb => parseInt(cb.value));

        const sectionCards = Array.from(modal.querySelectorAll('.export-section-card'));
        const orderedSectionIds = sectionCards.map(card => card.getAttribute('data-section-id'));

        const typePageBreaks = {};
        modal.querySelectorAll('.export-type-pagebreak-cb').forEach(cb => {
            typePageBreaks[cb.getAttribute('data-type')] = cb.checked;
        });

        return {
            isOrgMode,
            tabMode,
            useCustomRange,
            selectedYear,
            customStart,
            customEnd,
            selectedYearsTotals,
            selectedTypes,
            selectedCats,
            selectedCols,
            includeInactive,
            includeDetails,
            includePieChart,
            includeBarChart,
            includeSignature,
            includeCompteResultatAg,
            includeQuitusAg,
            titleFontSize,
            tableFontSize,
            headerTitle,
            headerLogoB64,
            logoLeft,
            logoRight,
            agDate,
            exportAccIds: this._exportAccountIds,
            selectedBalanceIds,
            orderedSectionIds,
            typePageBreaks,
            isSecChecked
        };
    },

    _buildReportHTML(options) {
        const {
            printData,
            allTx = [],
            accountsMap = {},
            budgetsMap = {},
            categoryToBudgetMap = {},
            accounts = [],
            isOrgMode = false,
            tabMode = 'year',
            selectedYear = new Date().getFullYear().toString(),
            customStart = null,
            customEnd = null,
            useCustomRange = false,
            selectedYearsTotals = [],
            selectedTypes = [],
            selectedCats = [],
            selectedCols = [],
            includeInactive = true,
            includeDetails = false,
            includePieChart = true,
            includeBarChart = true,
            includeSignature = false,
            includeCompteResultatAg = false,
            includeQuitusAg = false,
            agDate = '',
            titleFontSize = 'medium',
            tableFontSize = 'medium',
            headerTitle = '',
            headerLogoB64 = null,
            logoLeft = true,
            logoRight = true,
            exportAccIds = null,
            selectedBalanceIds = [],
            orderedSectionIds = [],
            typePageBreaks = {},
            isSecChecked = () => true
        } = options;

        const titleSizeMap = { small: '20px', medium: '24px', large: '28px' };
        const tableSizeMap = { small: '7.5px', medium: '8.5px', large: '9.5px' };

        const titleSizeVal = titleSizeMap[titleFontSize] || '24px';
        const tableSizeVal = tableSizeMap[tableFontSize] || '8.5px';

        const styleBlock = `
            <style>
                #printContainer, .export-paper-sheet, #exportPaperSheet, .export-paper-page {
                    --bg-surface: #ffffff !important;
                    --bg-surface-elevated: #f8fafc !important;
                    --bg-card: #ffffff !important;
                    --text-main: #0f172a !important;
                    --text-muted: #64748b !important;
                    --border-color: #e2e8f0 !important;
                    --color-income: #10b981 !important;
                    --color-expense: #ef4444 !important;
                    --color-transfer: #6366f1 !important;
                    --print-title-size: ${titleSizeVal};
                    --print-table-size: ${tableSizeVal};
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                    color: #0f172a !important;
                    background-color: #ffffff !important;
                    height: auto !important;
                    min-height: 1120px !important;
                    flex-shrink: 0 !important;
                }
                #printContainer *, .export-paper-sheet *, .export-paper-page * {
                    --bg-surface: #ffffff !important;
                    --text-main: #0f172a !important;
                    --text-muted: #64748b !important;
                    --border-color: #e2e8f0 !important;
                }
                #printContainer h1, .export-paper-sheet h1,
                #printContainer h2, .export-paper-sheet h2,
                #printContainer h3, .export-paper-sheet h3,
                #printContainer h4, .export-paper-sheet h4,
                #printContainer strong, .export-paper-sheet strong {
                    color: #0f172a !important;
                }
                #printContainer h1, .export-paper-sheet h1 { font-size: var(--print-title-size) !important; }
                #printContainer h2, .export-paper-sheet h2 { font-size: var(--print-title-size) !important; }
                #printContainer h3, .export-paper-sheet h3 { font-size: calc(var(--print-title-size) * 0.8) !important; }
                #printContainer .print-hide, .export-paper-sheet .print-hide {
                    display: none !important;
                }
                #printContainer .data-table, .export-paper-sheet .data-table {
                    background-color: #ffffff !important;
                    color: #0f172a !important;
                    width: 100% !important;
                    min-width: 0 !important;
                    max-width: 100% !important;
                    table-layout: fixed !important;
                    border-collapse: collapse !important;
                    page-break-inside: auto !important;
                    break-inside: auto !important;
                }
                #printContainer .data-table th, .export-paper-sheet .data-table th {
                    background-color: #f8fafc !important;
                    color: #0f172a !important;
                    border-color: #e2e8f0 !important;
                    padding: 4px 2px !important;
                    font-size: var(--print-table-size) !important;
                    font-weight: 700 !important;
                    line-height: 1.2 !important;
                    box-sizing: border-box !important;
                    overflow: visible !important;
                    text-overflow: clip !important;
                }
                #printContainer .data-table td, .export-paper-sheet .data-table td {
                    color: #0f172a !important;
                    border-color: #f1f5f9 !important;
                    padding: 3px 2px !important;
                    font-size: var(--print-table-size) !important;
                    font-variant-numeric: tabular-nums !important;
                    line-height: 1.2 !important;
                    box-sizing: border-box !important;
                    overflow: visible !important;
                    text-overflow: clip !important;
                }
                #printContainer .data-table th[data-col-type="month"], .export-paper-sheet .data-table th[data-col-type="month"] {
                    min-width: 0 !important;
                    text-align: right !important;
                    padding: 4px 2px !important;
                    font-size: var(--print-table-size) !important;
                    overflow: visible !important;
                    white-space: nowrap !important;
                    text-overflow: clip !important;
                }
                #printContainer .data-table td[data-col-type="month"], .export-paper-sheet .data-table td[data-col-type="month"],
                #printContainer .data-table th[data-col-type="year"], .export-paper-sheet .data-table th[data-col-type="year"],
                #printContainer .data-table td[data-col-type="year"], .export-paper-sheet .data-table td[data-col-type="year"] {
                    min-width: 0 !important;
                    text-align: right !important;
                    padding: 3px 2px !important;
                    font-size: var(--print-table-size) !important;
                    letter-spacing: -0.3px !important;
                    overflow: visible !important;
                    white-space: nowrap !important;
                    text-overflow: clip !important;
                }
                #printContainer .data-table td[data-col-type="month"] span, .export-paper-sheet .data-table td[data-col-type="month"] span,
                #printContainer .data-table td[data-col-type="year"] span, .export-paper-sheet .data-table td[data-col-type="year"] span {
                    font-size: var(--print-table-size) !important;
                    letter-spacing: -0.3px !important;
                    white-space: nowrap !important;
                }
                #printContainer .data-table th[data-col-type="cat"], .export-paper-sheet .data-table th[data-col-type="cat"],
                #printContainer [data-type] .data-table td:first-child, .export-paper-sheet [data-type] .data-table td:first-child { 
                    font-size: calc(var(--print-table-size) + 0.5px) !important; 
                    font-weight: 600 !important;
                    background-color: #ffffff !important;
                    color: #0f172a !important;
                    box-shadow: none !important;
                    padding: 3px 4px !important;
                    width: 125px !important;
                    min-width: 70px !important;
                    max-width: 135px !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                }
                #printContainer [data-type] > div > span, .export-paper-sheet [data-type] > div > span { 
                    font-size: calc(var(--print-table-size) + 3px) !important; 
                    color: #0f172a !important;
                }
                #printContainer .analytics-card-title, .export-paper-sheet .analytics-card-title,
                #printContainer .analytics-card-total, .export-paper-sheet .analytics-card-total {
                    color: #0f172a !important;
                }
                #printContainer .export-transactions-detail-block, .export-paper-sheet .export-transactions-detail-block {
                    width: 100% !important;
                    max-width: 100% !important;
                    box-sizing: border-box !important;
                    overflow-x: hidden !important;
                }
                #printContainer .export-tx-table, .export-paper-sheet .export-tx-table {
                    table-layout: fixed !important;
                    width: 100% !important;
                    max-width: 100% !important;
                    border-collapse: collapse !important;
                    box-sizing: border-box !important;
                }
                #printContainer .export-tx-table th, .export-paper-sheet .export-tx-table th {
                    font-size: 8px !important;
                    padding: 3px 4px !important;
                    text-align: left !important;
                    background-color: #f8fafc !important;
                    color: #0f172a !important;
                    border-bottom: 1px solid #e2e8f0 !important;
                    box-sizing: border-box !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                }
                #printContainer .export-tx-table td, .export-paper-sheet .export-tx-table td {
                    font-size: 8px !important;
                    padding: 2.5px 4px !important;
                    color: #0f172a !important;
                    border-bottom: 1px solid #f1f5f9 !important;
                    box-sizing: border-box !important;
                    overflow: hidden !important;
                    text-overflow: ellipsis !important;
                    white-space: nowrap !important;
                    font-weight: normal !important;
                    width: auto !important;
                    min-width: 0 !important;
                    max-width: none !important;
                }
                #printContainer .export-tx-table td:first-child, .export-paper-sheet .export-tx-table td:first-child {
                    font-size: 8px !important;
                    font-weight: normal !important;
                    width: auto !important;
                    min-width: 0 !important;
                    max-width: none !important;
                    padding: 2.5px 4px !important;
                    box-shadow: none !important;
                }
                #printContainer .export-tx-table th.amt, .export-paper-sheet .export-tx-table th.amt,
                #printContainer .export-tx-table td.amt, .export-paper-sheet .export-tx-table td.amt {
                    text-align: right !important;
                    font-variant-numeric: tabular-nums !important;
                }
                .print-page-break-forced {
                    page-break-after: always !important;
                    break-after: page !important;
                    display: block !important;
                }
                .print-page-break-before-forced {
                    page-break-before: always !important;
                    break-before: page !important;
                    display: block !important;
                }
                .print-page-break-auto {
                    page-break-after: auto !important;
                    break-after: auto !important;
                }
                #printContainer [data-type], .export-paper-sheet [data-type] {
                    display: block !important;
                    page-break-inside: auto !important;
                    break-inside: auto !important;
                }
                #printContainer .data-table, .export-paper-sheet .data-table {
                    min-width: 0 !important;
                    page-break-inside: auto !important;
                    break-inside: auto !important;
                }
                #printContainer .data-table tr, .export-paper-sheet .data-table tr {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                .app-toast, .toast, [class*="toast"] {
                    display: none !important;
                    visibility: hidden !important;
                }
                @media print {
                    .export-paper-sheet, #exportPaperSheet, .export-paper-page {
                        background-image: none !important;
                        box-shadow: none !important;
                        margin: 0 !important;
                        padding: 0 !important;
                        border-radius: 0 !important;
                        min-height: 0 !important;
                        height: auto !important;
                        page-break-after: always !important;
                        break-after: page !important;
                    }
                    .export-paper-sheet:last-child, #exportPaperSheet:last-child, .export-paper-page:last-child {
                        page-break-after: auto !important;
                        break-after: auto !important;
                    }
                    .export-page-header-indicator, .no-print {
                        display: none !important;
                    }
                }
            </style>
        `;

        const periodLabel = useCustomRange
            ? `${window.i18n.t('export_org_fiscal_year_label') || 'Exercice'} : ${formatDate(customStart)} — ${formatDate(customEnd)}`
            : `${window.i18n.t('export_org_fiscal_year_label') || 'Exercice'} ${selectedYear}`;

        let orgHeaderBlockHtml = '';
        if (isOrgMode && (headerTitle || headerLogoB64)) {
            const logoHtml = headerLogoB64
                ? `<img src="${headerLogoB64}" style="max-height:75px;max-width:180px;object-fit:contain;">`
                : `<span style="width:80px;"></span>`;
            const leftLogo = (headerLogoB64 && logoLeft) ? logoHtml : `<span style="min-width:80px;"></span>`;
            const rightLogo = (headerLogoB64 && logoRight) ? logoHtml : `<span style="min-width:80px;"></span>`;
            orgHeaderBlockHtml = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid var(--border-color);gap:12px;">
                ${leftLogo}
                <div style="flex:1;text-align:center;">
                    <h1 style="font-size:22px;font-weight:800;margin:0 0 4px 0;color:var(--text-main);letter-spacing:-0.5px;">${headerTitle || window.i18n.t('export_preset_annual') || 'Bilan Financier Annuel'}</h1>
                    <div style="font-size:12px;color:var(--text-muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${periodLabel}</div>
                </div>
                ${rightLogo}
            </div>`;
        }

        const { months, years, by_type } = printData || {};
        const revYears = (years || []).slice().reverse();

        // 1. Compte de résultat AG
        const compteResultatHtml = (isOrgMode && includeCompteResultatAg) ? this._generateCompteResultatAgHTML(options) : '';

        // 2. KPIs
        let printTotalIncome = 0;
        let printTotalExpense = 0;
        if (by_type) {
            if (by_type.income) printTotalIncome = by_type.income.grand_total || 0;
            ['expense_fixed', 'expense_var'].forEach(tKey => {
                if (by_type[tKey]) printTotalExpense += by_type[tKey].grand_total || 0;
            });
        }
        const printNetResult = printTotalIncome - printTotalExpense;
        const kpiCardsHtml = `
        <div style="display:flex; gap:12px; margin-bottom:20px; flex-wrap:wrap; page-break-inside:avoid;">
            <div style="flex:1; min-width:140px; background:#f0fdf4; border:1px solid rgba(16,185,129,0.3); border-radius:8px; padding:10px 14px;">
                <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#10b981;">${window.i18n.t('type_income') || 'Recettes'}</div>
                <div style="font-size:16px; font-weight:800; color:#10b981; margin-top:2px;">${formatCurrency(printTotalIncome)}</div>
            </div>
            <div style="flex:1; min-width:140px; background:#fef2f2; border:1px solid rgba(239,68,68,0.3); border-radius:8px; padding:10px 14px;">
                <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#ef4444;">${window.i18n.t('type_expense_fixed') || 'Dépenses'}</div>
                <div style="font-size:16px; font-weight:800; color:#ef4444; margin-top:2px;">${formatCurrency(printTotalExpense)}</div>
            </div>
            <div style="flex:1; min-width:140px; background:#eef2ff; border:1px solid rgba(99,102,241,0.3); border-radius:8px; padding:10px 14px;">
                <div style="font-size:10px; font-weight:700; text-transform:uppercase; color:#4f46e5;">${window.i18n.t('stat_net_worth') || 'Résultat Net'}</div>
                <div style="font-size:16px; font-weight:800; color:${printNetResult >= 0 ? '#10b981' : '#ef4444'}; margin-top:2px;">${formatCurrency(printNetResult)}</div>
            </div>
        </div>`;

        // 3. Graphiques SVG
        let pieSvg = '';
        let barSvg = '';
        if (includePieChart) {
            const pieCatList = [];
            ['expense_fixed', 'expense_var'].forEach(tKey => {
                if (by_type && by_type[tKey] && by_type[tKey].totals_per_cat) {
                    Object.entries(by_type[tKey].totals_per_cat).forEach(([cName, cTotal]) => {
                        if (cTotal && cTotal > 0 && (!selectedCats.length || selectedCats.includes(cName))) {
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

        // 4. Balances table
        let balancesHtml = '';
        const activeAccounts = (accounts || []).filter(a => !a.is_closed);
        const balanceAccounts = activeAccounts.filter(a => !selectedBalanceIds.length || selectedBalanceIds.includes(a.id));
        if (balanceAccounts.length > 0) {
            const totalBalance = balanceAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
            const balanceRows = balanceAccounts.map(a => {
                const c = a.color || '#3366ff';
                return `<tr>
                    <td style="padding:6px 12px;border-bottom:1px solid #eee;"><span style="color:${c};font-weight:600;">● ${a.name}</span></td>
                    <td style="padding:6px 12px;border-bottom:1px solid #eee;color:var(--text-muted);">${a.type}</td>
                    <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;">${formatCurrency(a.balance)}</td>
                </tr>`;
            }).join('');

            balancesHtml = `
            <div style="margin-bottom:24px;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;page-break-inside:avoid;background:#ffffff;">
                <div style="background:#f8fafc;padding:10px 16px;border-bottom:1px solid #e2e8f0;">
                    <strong style="font-size:13px;color:#0f172a;">${window.i18n.t('export_balance_title') || 'Situation des comptes'}</strong>
                    <span style="float:right;font-size:11px;color:#64748b;">${new Date().toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:12px;background:#ffffff;">
                    <thead><tr style="background:#f8fafc;">
                         <th style="text-align:left;padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${window.i18n.t('acc_th_name')}</th>
                        <th style="text-align:left;padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${window.i18n.t('acc_th_type')}</th>
                        <th style="text-align:right;padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;">${window.i18n.t('export_balance_current') || 'Solde actuel'}</th>
                    </tr></thead>
                    <tbody>${balanceRows}</tbody>
                    <tfoot><tr style="font-weight:700;background:#f8fafc;">
                        <td colspan="2" style="padding:8px 12px;border-top:2px solid #e2e8f0;color:#0f172a;">Total</td>
                        <td style="text-align:right;padding:8px 12px;border-top:2px solid #e2e8f0;color:#0f172a;">${formatCurrency(totalBalance)}</td>
                    </tr></tfoot>
                </table>
            </div>`;
        }

        // 5. Type tables
        const typeTableItems = [];
        const originalSelectedYears = this.selectedYears;
        this.selectedYears = selectedYearsTotals;

        if (by_type) {
            const typeEntries = Object.entries(by_type).filter(([txType]) => selectedTypes.includes(txType));
            typeEntries.forEach(([txType, typeData], idx) => {
                const isFirst = idx === 0;
                const isLast = idx === typeEntries.length - 1;
                const hasTypeBreakBefore = !!typePageBreaks[txType];
                const extraSpacing = (!hasTypeBreakBefore && !isLast) ? '<br><br>' : '';
                typeTableItems.push({
                    hasBreakBefore: hasTypeBreakBefore && !isFirst,
                    html: `<div class="${hasTypeBreakBefore && !isFirst ? 'print-page-break-before-forced' : 'print-page-break-auto'}">` + this.renderTypeTable(txType, typeData, months, revYears, includeInactive, true) + '</div>' + extraSpacing
                });
            });
        }
        if (includeInactive && printData && printData.inactive_types) {
            Object.entries(printData.inactive_types).forEach(([txType, typeData]) => {
                typeTableItems.push({
                    hasBreakBefore: false,
                    html: '<br><br><div class="print-page-break-auto">' + this.renderTypeTable(txType, typeData, months, revYears, true, true) + '</div>'
                });
            });
        }
        this.selectedYears = originalSelectedYears;

        // 6. Transactions list
        let txHtml = '';
        if (includeDetails) {
            let filteredTx = (allTx || []).filter(tx => {
                const dateStr = tx.date_operation || '';
                const yr = dateStr.split('-')[0];
                if (useCustomRange) {
                    const txDate = dateStr.substring(0, 10);
                    if (txDate < customStart || txDate > customEnd) return false;
                } else {
                    if (yr !== selectedYear) return false;
                }
                if (!selectedTypes.includes(tx.type)) return false;
                if (exportAccIds && exportAccIds.length > 0) {
                    if (!exportAccIds.includes(tx.from_account_id) && !exportAccIds.includes(tx.to_account_id)) return false;
                }
                let catMatches = false;
                if (tx.category && selectedCats.includes(tx.category)) catMatches = true;
                if (!tx.category && (selectedCats.includes('Sans catégorie') || selectedCats.includes('Uncategorized') || selectedCats.includes('—') || selectedCats.includes(''))) catMatches = true;
                if (!catMatches) return false;
                return true;
            });

            filteredTx.sort((a, b) => new Date(b.date_operation) - new Date(a.date_operation));

            if (filteredTx.length > 0) {
                const colWeightMap = {
                    dateSaisie: 9,
                    date: 9,
                    desc: 26,
                    type: 13,
                    cat: 16,
                    amount: 11,
                    recon: 9,
                    budget: 14,
                    depuis: 11,
                    vers: 11,
                    recurrence: 6,
                    slip: 8,
                    attachments: 6
                };
                const totalWeight = selectedCols.reduce((sum, col) => sum + (colWeightMap[col] || 10), 0) || 1;
                const getWidthPct = col => (((colWeightMap[col] || 10) / totalWeight) * 100).toFixed(1) + '%';

                let ths = '';
                if (selectedCols.includes('dateSaisie')) ths += `<th data-col="dateSaisie" style="width:${getWidthPct('dateSaisie')};text-align:left;padding:3px 4px;">${window.i18n.t('col_date_entry')}</th>`;
                if (selectedCols.includes('date')) ths += `<th data-col="date" style="width:${getWidthPct('date')};text-align:left;padding:3px 4px;">${window.i18n.t('col_date_op')}</th>`;
                if (selectedCols.includes('desc')) ths += `<th data-col="desc" style="width:${getWidthPct('desc')};text-align:left;padding:3px 4px;">${window.i18n.t('col_description')}</th>`;
                if (selectedCols.includes('type')) ths += `<th data-col="type" style="width:${getWidthPct('type')};text-align:left;padding:3px 4px;">${window.i18n.t('col_type')}</th>`;
                if (selectedCols.includes('cat')) ths += `<th data-col="cat" style="width:${getWidthPct('cat')};text-align:left;padding:3px 4px;">${window.i18n.t('col_category')}</th>`;
                if (selectedCols.includes('amount')) ths += `<th data-col="amount" class="amt" style="width:${getWidthPct('amount')};text-align:right;padding:3px 4px;">${window.i18n.t('col_amount')}</th>`;
                if (selectedCols.includes('recon')) ths += `<th data-col="recon" style="width:${getWidthPct('recon')};text-align:left;padding:3px 4px;">${window.i18n.t('col_reconciled')}</th>`;
                if (selectedCols.includes('budget')) ths += `<th data-col="budget" style="width:${getWidthPct('budget')};text-align:left;padding:3px 4px;">${window.i18n.t('col_envelope')}</th>`;
                if (selectedCols.includes('depuis')) ths += `<th data-col="depuis" style="width:${getWidthPct('depuis')};text-align:left;padding:3px 4px;">${window.i18n.t('col_from')}</th>`;
                if (selectedCols.includes('vers')) ths += `<th data-col="vers" style="width:${getWidthPct('vers')};text-align:left;padding:3px 4px;">${window.i18n.t('col_to')}</th>`;
                if (selectedCols.includes('recurrence')) ths += `<th data-col="recurrence" style="width:${getWidthPct('recurrence')};text-align:center;padding:3px 2px;">${window.i18n.t('col_recurrence')}</th>`;
                if (selectedCols.includes('slip')) ths += `<th data-col="slip" style="width:${getWidthPct('slip')};text-align:left;padding:3px 4px;">${window.i18n.t('col_slip')}</th>`;
                if (selectedCols.includes('attachments')) ths += `<th data-col="attachments" style="width:${getWidthPct('attachments')};text-align:center;padding:3px 2px;">${window.i18n.t('col_attachments')}</th>`;

                let trs = filteredTx.map(tx => {
                    let tds = '';
                    if (selectedCols.includes('dateSaisie')) tds += `<td style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${formatDate(tx.date_saisie)}</td>`;
                    if (selectedCols.includes('date')) tds += `<td style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${formatDate(tx.date_operation)}</td>`;
                    if (selectedCols.includes('desc')) {
                        const descEsc = escapeHtml(tx.description || '');
                        tds += `<td title="${descEsc}" style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${descEsc}</td>`;
                    }
                    if (selectedCols.includes('type')) tds += `<td style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${window.app.getTypeLabel(tx.type)}</td>`;
                    if (selectedCols.includes('cat')) {
                        const catEsc = escapeHtml(tx.category || '-');
                        tds += `<td title="${catEsc}" style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${catEsc}</td>`;
                    }

                    if (selectedCols.includes('amount')) {
                        const amountColor = tx.type === 'income' ? '#16a34a' : (tx.type === 'transfer' ? '#6366f1' : '#0f172a');
                        tds += `<td class="amt" style="text-align:right;color:${amountColor};font-weight:700;padding:2.5px 4px;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${formatCurrency(tx.amount)}</td>`;
                    }

                    if (selectedCols.includes('recon')) tds += `<td style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${formatDate(tx.reconciliation_date) || '-'}</td>`;
                    if (selectedCols.includes('budget')) {
                        const bName = (tx.budget_id && budgetsMap[tx.budget_id]) ? budgetsMap[tx.budget_id] : (tx.category && categoryToBudgetMap[tx.category]) ? categoryToBudgetMap[tx.category] : null;
                        const bNameEsc = escapeHtml(bName || '-');
                        tds += `<td title="${bNameEsc}" style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${bNameEsc}</td>`;
                    }
                    if (selectedCols.includes('depuis')) tds += `<td style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(accountsMap[tx.from_account_id] || '')}</td>`;
                    if (selectedCols.includes('vers')) tds += `<td style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(accountsMap[tx.to_account_id] || '')}</td>`;
                    if (selectedCols.includes('recurrence')) tds += `<td style="text-align:center;padding:2.5px 2px;">${tx.recurrence_id || tx.is_monthly || tx.is_yearly ? '🔄' : '-'}</td>`;
                    if (selectedCols.includes('slip')) tds += `<td style="padding:2.5px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(tx.slip_number || '-')}</td>`;
                    if (selectedCols.includes('attachments')) tds += `<td style="text-align:center;padding:2.5px 2px;">${tx.attachments ? '📎' : '-'}</td>`;

                    return `<tr>${tds}</tr>`;
                }).join('');

                txHtml = `
                <div class="export-transactions-detail-block" style="margin-top:20px;margin-bottom:20px;">
                    <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#0f172a;margin-bottom:8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">
                        📑 ${window.i18n.t('export_sec_transactions_list') || 'Détail des opérations'} (${filteredTx.length})
                    </div>
                    <table class="data-table export-tx-table" style="width:100%; border-collapse:collapse; font-size:8px;">
                        <thead><tr style="background:#f8fafc; color:#0f172a;">${ths}</tr></thead>
                        <tbody>${trs}</tbody>
                    </table>
                </div>`;
            } else {
                txHtml = `
                <div class="export-transactions-detail-block" style="margin-top:20px;margin-bottom:20px;">
                    <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#0f172a;margin-bottom:8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">
                        📑 ${window.i18n.t('export_sec_transactions_list') || 'Détail des opérations'} (0)
                    </div>
                    <div style="font-size:11px;color:#64748b;font-style:italic;padding:8px 0;">${window.i18n.t('export_no_transactions') || 'Aucune opération trouvée pour les filtres sélectionnés.'}</div>
                </div>`;
            }
        }

        // 7. Quitus & Signature
        const quitusHtml = (isOrgMode && includeQuitusAg) ? this._generateQuitusAgHTML(options) : '';
        const signatureHtml = (includeSignature && !includeQuitusAg) ? this._generateSignatureBlockHTML() : '';

        // Assemblage en pages A4 discrètes
        let docHeader = '';
        if (!isOrgMode || !isSecChecked('header') || !orgHeaderBlockHtml) {
            docHeader = `<h2 style="margin-bottom: 20px;">${window.i18n.t('analytics_title')}</h2>`;
        }

        const pages = [];
        let currentPageBlocks = [];

        const startNewPage = () => {
            if (currentPageBlocks.length > 0) {
                pages.push(currentPageBlocks);
                currentPageBlocks = [];
            }
        };

        // Header et titre sur la première page
        if (isOrgMode && isSecChecked('header') && orgHeaderBlockHtml) {
            currentPageBlocks.push(orgHeaderBlockHtml);
        } else if (docHeader) {
            currentPageBlocks.push(docHeader);
        }

        orderedSectionIds.forEach(secId => {
            if (secId.startsWith('page_break_')) {
                startNewPage();
                return;
            }
            if (!isSecChecked(secId)) return;
            if (secId === 'header') return; // Déjà placé en haut de la page 1

            if (secId === 'compte_resultat_ag' && compteResultatHtml) {
                currentPageBlocks.push(compteResultatHtml);
            } else if (secId === 'kpi' && kpiCardsHtml) {
                currentPageBlocks.push(kpiCardsHtml);
            } else if (secId === 'pie_chart' && pieSvg) {
                currentPageBlocks.push(`<div style="margin-bottom:20px;">${pieSvg}</div>`);
            } else if (secId === 'bar_chart' && barSvg) {
                currentPageBlocks.push(`<div style="margin-bottom:20px;">${barSvg}</div>`);
            } else if (secId === 'balances' && balancesHtml) {
                currentPageBlocks.push(balancesHtml);
            } else if (secId === 'type_tables' && typeTableItems.length > 0) {
                typeTableItems.forEach(item => {
                    if (item.hasBreakBefore) {
                        startNewPage();
                    }
                    currentPageBlocks.push(item.html);
                });
            } else if (secId === 'transactions_list' && txHtml) {
                currentPageBlocks.push(txHtml);
            } else if (secId === 'quitus_ag' && quitusHtml) {
                currentPageBlocks.push(quitusHtml);
            } else if (secId === 'signature' && signatureHtml) {
                currentPageBlocks.push(signatureHtml);
            }
        });

        startNewPage();
        if (pages.length === 0) {
            pages.push(['<div style="color:#64748b;font-style:italic;padding:20px;text-align:center;">Aucune section sélectionnée</div>']);
        }

        const totalPages = pages.length;
        const pagesHtml = pages.map((pBlocks, idx) => {
            const pageNum = idx + 1;
            const headerLabel = (window.i18n.t('export_page_header_title') || 'Début de page {page} / {total}')
                .replace('{page}', pageNum)
                .replace('{total}', totalPages);
            const footerLabel = (window.i18n.t('export_page_footer_title') || 'Fin de page {page} / {total}')
                .replace('{page}', pageNum)
                .replace('{total}', totalPages);
            const a4FormatLabel = window.i18n.t('export_page_a4_format') || 'Format A4 • Portrait (210 × 297 mm)';

            return `
            <div class="export-paper-sheet" data-page-index="${pageNum}">
                <!-- Début de page A4 -->
                <div class="export-page-header-indicator no-print">
                    <div class="export-page-header-pill">
                        <span class="export-page-num-badge">📄 ${headerLabel}</span>
                    </div>
                    <div class="export-page-format-badge">
                        <span>${a4FormatLabel}</span>
                    </div>
                </div>

                <!-- Contenu de la page -->
                <div class="export-page-content-wrapper">
                    ${pBlocks.join('')}
                </div>

                <!-- Fin de page A4 -->
                <div class="export-page-footer-indicator no-print">
                    <div class="export-page-footer-line"></div>
                    <div class="export-page-footer-bar">
                        <span class="export-page-footer-text">📑 OmniBank • ${footerLabel}</span>
                        <span class="export-page-footer-cut-tag">Fin de feuille A4 ✂️</span>
                    </div>
                </div>
            </div>`;
        }).join('');

        return styleBlock + pagesHtml;
    },

    _generateCompteResultatAgHTML(options) {
        const { printData, selectedCats, accounts, selectedBalanceIds, months, customStart, customEnd, selectedYear, useCustomRange } = options;
        const by_type = printData?.by_type;
        if (!by_type) return '';

        const incomeCats = by_type.income?.totals_per_cat || {};
        const incomeEntries = Object.entries(incomeCats)
            .filter(([cat]) => !selectedCats || selectedCats.includes(cat))
            .sort((a, b) => b[1] - a[1]);
        const totalOperatingIncome = incomeEntries.reduce((sum, [, amt]) => sum + amt, 0);

        const expenseEntries = [];
        ['expense_fixed', 'expense_var'].forEach(tKey => {
            if (by_type[tKey]?.totals_per_cat) {
                Object.entries(by_type[tKey].totals_per_cat).forEach(([cat, amt]) => {
                    if (!selectedCats || selectedCats.includes(cat)) {
                        expenseEntries.push([cat, amt]);
                    }
                });
            }
        });
        expenseEntries.sort((a, b) => b[1] - a[1]);
        const totalOperatingExpense = expenseEntries.reduce((sum, [, amt]) => sum + amt, 0);

        const netResult = totalOperatingIncome - totalOperatingExpense;
        const isSurplus = netResult >= 0;
        const statusLabel = isSurplus ? (window.i18n.t('export_org_surplus') || 'EXCÉDENT') : (window.i18n.t('export_org_deficit') || 'DÉFICIT');
        const netResultColor = isSurplus ? '#10b981' : '#ef4444';

        const activeAccounts = (accounts || []).filter(a => !a.is_closed && (!selectedBalanceIds || !selectedBalanceIds.length || selectedBalanceIds.includes(a.id)));
        const totalCash = activeAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
        const numMonths = (months && months.length > 0) ? months.length : 12;
        const avgMonthlyExpense = totalOperatingExpense / numMonths;
        const runwayMonths = avgMonthlyExpense > 0 ? (totalCash / avgMonthlyExpense).toFixed(1) : '∞';

        const periodLabel = useCustomRange
            ? (window.i18n.t('export_org_fiscal_year_period') || 'Exercice du {start} au {end}').replace('{start}', formatDate(customStart)).replace('{end}', formatDate(customEnd))
            : `${window.i18n.t('export_org_fiscal_year_label') || 'Exercice'} ${selectedYear}`;

        const incomeRowsHtml = incomeEntries.length > 0
            ? incomeEntries.map(([cat, amt]) => {
                const pct = totalOperatingIncome > 0 ? ((amt / totalOperatingIncome) * 100).toFixed(1) : '0.0';
                return `<tr>
                    <td style="padding:4px 6px;border-bottom:1px solid #f1f5f9;font-weight:500;color:#0f172a;">${cat}</td>
                    <td style="padding:4px 6px;border-bottom:1px solid #f1f5f9;text-align:right;color:#10b981;font-weight:600;">${formatCurrency(amt)} <span style="font-size:9px;color:#94a3b8;font-weight:400;">(${pct}%)</span></td>
                </tr>`;
            }).join('')
            : `<tr><td colspan="2" style="padding:8px;text-align:center;color:#94a3b8;font-style:italic;">Aucune recette sur la période</td></tr>`;

        const expenseRowsHtml = expenseEntries.length > 0
            ? expenseEntries.map(([cat, amt]) => {
                const pct = totalOperatingExpense > 0 ? ((amt / totalOperatingExpense) * 100).toFixed(1) : '0.0';
                return `<tr>
                    <td style="padding:4px 6px;border-bottom:1px solid #f1f5f9;font-weight:500;color:#0f172a;">${cat}</td>
                    <td style="padding:4px 6px;border-bottom:1px solid #f1f5f9;text-align:right;color:#ef4444;font-weight:600;">${formatCurrency(amt)} <span style="font-size:9px;color:#94a3b8;font-weight:400;">(${pct}%)</span></td>
                </tr>`;
            }).join('')
            : `<tr><td colspan="2" style="padding:8px;text-align:center;color:#94a3b8;font-style:italic;">Aucune dépense sur la période</td></tr>`;

        return `
        <div style="margin-bottom:24px; border:1px solid #e2e8f0; border-radius:10px; overflow:hidden; page-break-inside:avoid; background:#ffffff;">
            <div style="background:#f8fafc; padding:10px 16px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center;">
                <strong style="font-size:12px; text-transform:uppercase; letter-spacing:0.5px; color:#0f172a;">📊 ${window.i18n.t('export_org_statement_title') || 'COMPTE DE RÉSULTAT SIMPLIFIÉ'}</strong>
                <span style="font-size:11px; font-weight:700; color:#4f46e5;">${periodLabel}</span>
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:0;">
                <div style="padding:12px 14px; border-right:1px solid #e2e8f0;">
                    <div style="font-size:11px; font-weight:700; color:#10b981; margin-bottom:8px; border-bottom:1px solid rgba(16,185,129,0.2); padding-bottom:4px; text-transform:uppercase;">
                        ${window.i18n.t('export_org_operating_income') || "PRODUITS D'EXPLOITATION (RECETTES)"}
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:11px; background:#ffffff;">
                        <tbody>${incomeRowsHtml}</tbody>
                        <tfoot>
                            <tr style="font-weight:700; border-top:1px solid #e2e8f0; background:#f0fdf4;">
                                <td style="padding:6px; color:#0f172a;">Total Produits</td>
                                <td style="text-align:right; padding:6px; color:#10b981;">${formatCurrency(totalOperatingIncome)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
                <div style="padding:12px 14px;">
                    <div style="font-size:11px; font-weight:700; color:#ef4444; margin-bottom:8px; border-bottom:1px solid rgba(239,68,68,0.2); padding-bottom:4px; text-transform:uppercase;">
                        ${window.i18n.t('export_org_operating_expense') || "CHARGES D'EXPLOITATION (DÉPENSES)"}
                    </div>
                    <table style="width:100%; border-collapse:collapse; font-size:11px; background:#ffffff;">
                        <tbody>${expenseRowsHtml}</tbody>
                        <tfoot>
                            <tr style="font-weight:700; border-top:1px solid #e2e8f0; background:#fef2f2;">
                                <td style="padding:6px; color:#0f172a;">Total Charges</td>
                                <td style="text-align:right; padding:6px; color:#ef4444;">${formatCurrency(totalOperatingExpense)}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
            <div style="background:#f8fafc; padding:10px 16px; border-top:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                <div>
                    <span style="font-size:11px; font-weight:700; text-transform:uppercase; color:#0f172a;">${(window.i18n.t('export_org_surplus_deficit') || "RÉSULTAT NET D'EXERCICE ({status})").replace('{status}', statusLabel)} : </span>
                    <span style="font-size:15px; font-weight:800; color:${netResultColor}; margin-left:6px;">${formatCurrency(netResult)}</span>
                </div>
                <div style="font-size:11px; color:#64748b; display:flex; gap:16px;">
                    <span>${window.i18n.t('export_org_runway_metric') || 'Réserve opérationnelle'} : <strong style="color:#0f172a;">${runwayMonths} mois</strong></span>
                    <span>Trésorerie disponible : <strong style="color:#0f172a;">${formatCurrency(totalCash)}</strong></span>
                </div>
            </div>
        </div>`;
    },

    _generateQuitusAgHTML(options) {
        const { agDate, printData } = options;
        const by_type = printData?.by_type;
        let netResult = 0;
        if (by_type) {
            const inc = by_type.income?.grand_total || 0;
            const exp = (by_type.expense_fixed?.grand_total || 0) + (by_type.expense_var?.grand_total || 0);
            netResult = inc - exp;
        }
        const isSurplus = netResult >= 0;
        const netFormatted = formatCurrency(Math.abs(netResult));
        const statusWord = isSurplus ? 'un excédent' : 'un déficit';

        return `
        <div style="margin-top:24px; padding:16px 20px; border:1px solid #e2e8f0; border-radius:10px; background:#f8fafc; page-break-inside:avoid;">
            <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:#0f172a; margin-bottom:8px; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                ✍️ ${window.i18n.t('export_sec_quitus_ag') || 'Certification & Quitus d\'Assemblée Générale'}
            </div>
            <p style="font-size:11px; color:#64748b; line-height:1.5; margin:0 0 16px 0;">
                ${window.i18n.t('export_org_quitus_text') || 'Le présent rapport financier a été certifié conforme aux comptes et écritures d\'OmniBank et soumis à l\'approbation de l\'Assemblée Générale Ordinaire.'}
                ${agDate ? ` — <strong style="color:#0f172a;">Assemblée Générale du ${formatDate(agDate)}</strong>.` : ''}
            </p>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
                <div style="border:1px dashed #cbd5e1; border-radius:8px; padding:12px; background:#fff;">
                    <div style="font-size:11px; font-weight:700; color:#0f172a; margin-bottom:4px;">
                        ${window.i18n.t('export_org_sign_treasurer') || 'Le / La Trésorier(e)'}
                    </div>
                    <div style="font-size:10px; color:#64748b; margin-bottom:30px;">
                        Arrêté sincère et conforme faisant apparaître ${statusWord} net de <strong style="color:#0f172a;">${netFormatted}</strong>.
                    </div>
                    <div style="border-top:1px dotted #cbd5e1; padding-top:4px; font-size:10px; color:#94a3b8; display:flex; justify-content:space-between;">
                        <span>Date & Signature</span>
                    </div>
                </div>
                <div style="border:1px dashed #cbd5e1; border-radius:8px; padding:12px; background:#fff;">
                    <div style="font-size:11px; font-weight:700; color:#0f172a; margin-bottom:4px;">
                        ${window.i18n.t('export_org_sign_president') || 'Le / La Président(e)'}
                    </div>
                    <div style="font-size:10px; color:#64748b; margin-bottom:30px;">
                        Quitus approuvé et accordé par l\'Assemblée Générale pour l\'exercice clos.
                    </div>
                    <div style="border-top:1px dotted #cbd5e1; padding-top:4px; font-size:10px; color:#94a3b8; display:flex; justify-content:space-between;">
                        <span>Date & Signature</span>
                    </div>
                </div>
            </div>
        </div>`;
    },

    _applyReportDOMFilters(targetEl, options) {
        const { selectedTypes, selectedCats, includeInactive, printData, tabMode, selectedYear, selectedYearsTotals } = options;

        const effectiveSelectedTypes = includeInactive && printData && printData.inactive_types
            ? [...selectedTypes, ...Object.keys(printData.inactive_types)]
            : selectedTypes;

        targetEl.querySelectorAll('[data-type]').forEach(el => {
            if (!effectiveSelectedTypes.includes(el.getAttribute('data-type'))) {
                el.remove();
            } else {
                el.querySelectorAll('tr[data-category]').forEach(tr => {
                    if (tr.hasAttribute('data-inactive') && includeInactive) return;
                    if (!selectedCats.includes(tr.getAttribute('data-category'))) {
                        tr.remove();
                    }
                });
            }
        });

        targetEl.querySelectorAll('[data-year]').forEach(el => {
            const yr = el.getAttribute('data-year');
            const colType = el.getAttribute('data-col-type');

            if (colType === 'month') {
                if (tabMode === 'year' && yr !== selectedYear) el.remove();
            } else if (colType === 'year') {
                if (!selectedYearsTotals.includes(yr)) el.remove();
            }
        });
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
        this._refreshExportData().then(() => this.triggerLivePreviewUpdate());
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
                    onchange="this.style.borderColor = this.querySelector('input').checked ? '${c}' : 'var(--border-color)'; this.querySelector('span:last-child').style.color = this.querySelector('input').checked ? '${c}' : 'inherit'; this.querySelector('span:last-child').style.fontWeight = this.querySelector('input').checked ? '600' : 'normal'; window.AnalyticsView.triggerLivePreviewUpdate();">
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
            this._exportAccountIds = [id];
        } else if (this._exportAccountIds.includes(id)) {
            this._exportAccountIds = this._exportAccountIds.filter(i => i !== id);
            if (this._exportAccountIds.length === 0) this._exportAccountIds = null;
        } else {
            this._exportAccountIds.push(id);
            if (this._exportAccountIds.length >= allIds.length) this._exportAccountIds = null;
        }
        this._renderExportAccountBadges();
        this._refreshExportData().then(() => this.triggerLivePreviewUpdate());
    },

    _initSectionDragAndDrop() {
        const list = document.getElementById('exportSectionsList');
        if (!list) return;

        let draggedCard = null;

        list.querySelectorAll('.export-section-card').forEach(card => {
            // Empêcher le drag intempestif lorsqu'on clique sur un champ ou un bouton
            card.querySelectorAll('input, button, select, textarea, label').forEach(el => {
                el.setAttribute('draggable', 'false');
            });

            card.ondragstart = (e) => {
                if (e.target.closest('input, button, select, textarea')) {
                    e.preventDefault();
                    return false;
                }
                draggedCard = card;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', card.getAttribute('data-section-id') || '');
                card.classList.add('is-dragging');
                setTimeout(() => {
                    if (card && card.classList.contains('is-dragging')) {
                        card.style.opacity = '0.4';
                    }
                }, 0);
            };

            card.ondragend = () => {
                if (card) {
                    card.classList.remove('is-dragging');
                    card.style.opacity = '1';
                }
                draggedCard = null;
                this._saveSectionsOrder();
                this.triggerLivePreviewUpdate();
            };

            card.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (!draggedCard || draggedCard === card) return;

                const rect = card.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    list.insertBefore(draggedCard, card);
                } else {
                    list.insertBefore(draggedCard, card.nextSibling);
                }
            };
        });
    },

    _moveSectionCard(secId, direction) {
        const card = document.querySelector(`.export-section-card[data-section-id="${secId}"]`);
        if (!card || !card.parentElement) return;
        const parent = card.parentElement;
        if (direction === -1 && card.previousElementSibling) {
            parent.insertBefore(card, card.previousElementSibling);
        } else if (direction === 1 && card.nextElementSibling) {
            parent.insertBefore(card, card.nextElementSibling);
        }
        this._saveSectionsOrder();
        this.triggerLivePreviewUpdate();
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
        this.triggerLivePreviewUpdate();
    },

    _onSectionEnableChange(secId, isChecked) {
        ProfileStorage.set(`print_sec_enabled_${secId}`, isChecked);
        if (secId === 'signature') ProfileStorage.set('print_settings_include_signature', isChecked);
        if (secId === 'pie_chart') ProfileStorage.set('print_settings_include_pie_chart', isChecked);
        if (secId === 'bar_chart') ProfileStorage.set('print_settings_include_bar_chart', isChecked);
        if (secId === 'transactions_list') ProfileStorage.set('print_settings_include_details', isChecked);
        if (secId === 'compte_resultat_ag') ProfileStorage.set('print_sec_enabled_compte_resultat_ag', isChecked);
        if (secId === 'quitus_ag') ProfileStorage.set('print_sec_enabled_quitus_ag', isChecked);

        if (secId === 'transactions_list' && isChecked && (!this._cachedAllTx || this._cachedAllTx.length === 0)) {
            this._fetchExportAuxiliaryData().then(() => this.triggerLivePreviewUpdate());
        } else {
            this.triggerLivePreviewUpdate();
        }
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
        this.triggerLivePreviewUpdate();
    },

    _removePageBreakCard(secId) {
        const card = document.querySelector(`.export-section-card[data-section-id="${secId}"]`);
        if (card) {
            card.remove();
            this._saveSectionsOrder();
            this.triggerLivePreviewUpdate();
        }
    },

    async executePrint() {
        const modal = document.getElementById('exportPdfModal');
        if (!modal) return;

        const options = this._gatherExportOptions(modal);

        // Validation
        if (options.useCustomRange) {
            if (!options.customStart || !options.customEnd) {
                showToast(window.i18n.t('analytics_err_dates_required') || "Veuillez saisir les dates de début et de fin pour la période personnalisée.", "error");
                return;
            }
            if (options.customStart > options.customEnd) {
                showToast(window.i18n.t('analytics_err_date_order') || "La date de début doit être antérieure à la date de fin.", "error");
                return;
            }
        } else {
            if (!options.selectedYear) {
                showToast(window.i18n.t('analytics_err_year_required') || "Veuillez sélectionner une année à afficher.", "error");
                return;
            }
        }

        // Mémoriser les choix utilisateur
        ProfileStorage.set('print_settings_tab_mode', options.tabMode);
        if (options.selectedYear) ProfileStorage.set('print_settings_selected_year', options.selectedYear);
        if (options.customStart) ProfileStorage.set('print_settings_custom_start', options.customStart);
        if (options.customEnd) ProfileStorage.set('print_settings_custom_end', options.customEnd);
        ProfileStorage.set('analytics_years_totals', JSON.stringify(options.selectedYearsTotals));
        ProfileStorage.set('print_settings_types', JSON.stringify(options.selectedTypes));
        ProfileStorage.set('print_settings_cats', JSON.stringify(options.selectedCats));
        ProfileStorage.set('print_settings_cols', JSON.stringify(options.selectedCols));
        ProfileStorage.set('print_settings_include_details', options.includeDetails);
        ProfileStorage.set('print_settings_include_pie_chart', options.includePieChart);
        ProfileStorage.set('print_settings_include_bar_chart', options.includeBarChart);
        ProfileStorage.set('print_settings_include_signature', options.includeSignature);
        ProfileStorage.set('print_settings_title_font_size', options.titleFontSize);
        ProfileStorage.set('print_settings_table_font_size', options.tableFontSize);

        const printBtn = modal.querySelector('.modal-actions .btn-primary');
        if (printBtn) { printBtn.disabled = true; printBtn.textContent = '⏳...'; }

        try {
            if (!this._cachedPrintData || !this._cachedAllTx || this._cachedAllTx.length === 0) {
                await Promise.all([
                    this._refreshExportData(),
                    this._fetchExportAuxiliaryData()
                ]);
            }
        } catch (e) {
            console.error("Error fetching print data", e);
        } finally {
            if (printBtn) { printBtn.disabled = false; printBtn.textContent = window.i18n.t('export_modal_print'); }
        }

        options.printData = this._cachedPrintData || this.data;
        options.allTx = this._cachedAllTx || [];
        options.accountsMap = this._cachedAccountsMap || {};
        options.budgetsMap = this._cachedBudgetsMap || {};
        options.categoryToBudgetMap = this._cachedCategoryToBudgetMap || {};
        options.accounts = this._cachedAccounts || window.app.accounts || [];
        options.isForPreview = false;

        let printContainer = document.getElementById('printContainer');
        if (!printContainer) {
            printContainer = document.createElement('div');
            printContainer.id = 'printContainer';
            printContainer.style.cssText = 'display: none;';
            document.body.appendChild(printContainer);
        }

        const reportHtml = this._buildReportHTML(options);
        printContainer.innerHTML = reportHtml;

        this._applyReportDOMFilters(printContainer, options);

        document.querySelectorAll('.app-toast').forEach(t => t.remove());

        document.body.classList.add('printing-offline');
        setTimeout(() => {
            window.print();
            setTimeout(() => {
                document.body.classList.remove('printing-offline');
                printContainer.remove();
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
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; color:#0f172a;">${c.name}</span>
                    </div>
                    <span style="font-weight:600; white-space:nowrap; color:#0f172a;">${formatCurrency(c.amount)} (${pct.toFixed(1)}%)</span>
                </div>
            `);
        });

        return `
        <div style="display:flex; align-items:center; gap:20px; background:#ffffff; padding:16px; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:16px; page-break-inside:avoid;">
            <svg width="200" height="200" viewBox="0 0 200 200" style="flex-shrink:0;">
                ${slices.join('')}
            </svg>
            <div style="flex:1; min-width:0; max-height:190px; overflow-y:auto;">
                <div style="font-size:12px; font-weight:700; text-transform:uppercase; margin-bottom:8px; color:#64748b; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
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
        <div style="background:#ffffff; padding:16px; border-radius:10px; border:1px solid #e2e8f0; margin-bottom:16px; page-break-inside:avoid;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; border-bottom:1px solid #e2e8f0; padding-bottom:4px;">
                <span style="font-size:12px; font-weight:700; text-transform:uppercase; color:#64748b;">
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
        <div style="margin-top:24px; padding:16px; border:1px dashed #cbd5e1; border-radius:10px; background:#f8fafc; page-break-inside:avoid;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:20px;">
                <div style="flex:1;">
                    <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:#475569; margin-bottom:6px;">
                        ${window.i18n.t('print_signature_audit_title') || 'Validation & Certificats de Trésorerie'}
                    </div>
                    <div style="font-size:11px; color:#64748b; line-height:1.4;">
                        ${window.i18n.t('print_signature_audit_desc') || 'Document certifié exact et conforme aux écritures comptables enregistrées dans OmniBank Local.'}
                    </div>
                    <div style="font-size:11px; font-weight:600; margin-top:8px; color:#0f172a;">
                        Émis par : <span style="color:#0f172a;">${userName}</span> — le <span style="color:#0f172a;">${dateStr}</span>
                    </div>
                </div>
                <div style="width:200px; height:80px; border:1px solid #cbd5e1; border-radius:8px; padding:8px; background:#fff; display:flex; flex-direction:column; justify-content:space-between;">
                    <span style="font-size:10px; color:#64748b; font-weight:600; text-transform:uppercase;">Signature / Cachet</span>
                </div>
            </div>
        </div>`;
    }
};
