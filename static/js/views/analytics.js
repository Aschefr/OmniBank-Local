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
        'expense_var':   { emoji: '🛍️', color: '#f59e0b', sign: '-' },
        'expense_fixed': { emoji: '📋', color: '#ef4444', sign: '-' },
        'income':        { emoji: '💰', color: '#10b981', sign: '+' },
        'transfer':      { emoji: '🔁', color: '#6366f1', sign: '±' },
        'neutral':       { emoji: '⚪', color: '#6b7280', sign: '' },
    },

    render() {
        return `
        <div style="padding:0;">
            <div class="view-header" style="position:sticky;top:-32px;z-index:50;background:var(--bg-base);padding:32px 0 15px;margin-top:-32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <h2 style="margin:0;" data-i18n="analytics_title">${window.i18n.t('analytics_title')}</h2>
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    <button class="btn btn-secondary" onclick="window.AnalyticsView.showExportModal()" style="padding: 6px 12px; font-size: 13px;" data-i18n-title="tooltip_export_pdf" title="Générer un PDF du rapport" data-i18n="btn_export_pdf">📥 Exporter en PDF</button>
                    <select id="analyticsReconciled" class="inline-input" style="width:210px;" onchange="window.AnalyticsView.changeFilter('reconciled', this.value)">
                        <option value="all" data-i18n="analytics_all_amounts">${window.i18n.t('analytics_all_amounts')}</option>
                        <option value="reconciled" data-i18n="analytics_reconciled_only">${window.i18n.t('analytics_reconciled_only')}</option>
                        <option value="unreconciled" data-i18n="analytics_unreconciled_only">${window.i18n.t('analytics_unreconciled_only')}</option>
                    </select>
                    <select id="analyticsPeriod" class="inline-input" style="width:190px;" onchange="window.AnalyticsView.changeFilter('period', this.value)">
                        <option value="m3" data-i18n="analytics_rolling_3m">${window.i18n.t('analytics_rolling_3m')}</option>
                        <option value="m6" data-i18n="analytics_rolling_6m">${window.i18n.t('analytics_rolling_6m')}</option>
                        <option value="m12" data-i18n="analytics_rolling_12m">${window.i18n.t('analytics_rolling_12m')}</option>
                        <option value="m24" data-i18n="analytics_rolling_24m">${window.i18n.t('analytics_rolling_24m')}</option>
                        <option disabled data-i18n="analytics_years_separator">${window.i18n.t('analytics_years_separator')}</option>
                    </select>
                    <div id="analyticsCustomRangeWrapper" style="display:none;align-items:center;gap:6px;">
                        <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;">
                            <div style="position:relative;width:36px;height:20px;">
                                <input type="checkbox" id="analyticsCustomRangeToggle" class="global-toggle" style="opacity:0;width:0;height:0;position:absolute;" onchange="window.AnalyticsView.onCustomRangeToggle(this.checked)">
                                <span class="slider" style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background-color:var(--border-color);transition:.4s;border-radius:34px;"></span>
                                <span class="slider-knob" style="position:absolute;height:14px;width:14px;left:3px;bottom:3px;background-color:white;transition:.4s;border-radius:50%;"></span>
                            </div>
                            <span data-i18n="analytics_custom_range_toggle">${window.i18n.t('analytics_custom_range_toggle') || 'P\u00e9riode'}</span>
                        </label>
                        <div id="analyticsCustomRangeInputs" style="display:none;align-items:center;gap:4px;">
                            <input type="date" id="analyticsCustomStart" class="inline-input" style="width:145px;" onchange="window.AnalyticsView.onCustomRangeChange()">
                            <span style="color:var(--text-muted);font-size:11px;">→</span>
                            <input type="date" id="analyticsCustomEnd" class="inline-input" style="width:145px;" onchange="window.AnalyticsView.onCustomRangeChange()">
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
        const savedReconciled = localStorage.getItem('analytics_reconciled');
        if (savedReconciled) this.reconciled = savedReconciled;
        
        const savedPeriod = localStorage.getItem('analytics_period');
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
        const savedColWidth = localStorage.getItem('analytics_cat_col_width');
        this._catColWidth = savedColWidth ? parseInt(savedColWidth) : 160;

        // Restore custom range state
        const crEnabled = localStorage.getItem('analytics_custom_range_enabled') === 'true';
        const crStart = localStorage.getItem('analytics_custom_range_start');
        const crEnd = localStorage.getItem('analytics_custom_range_end');
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
            } catch(e) { /* silent */ }
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
            opt.textContent = window.i18n.tp('label_year', {year: yr});
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
            localStorage.setItem('analytics_reconciled', val);
        }
        if (key === 'period') {
            localStorage.setItem('analytics_period', val);
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
        localStorage.setItem('analytics_custom_range_enabled', enabled);
        const inputs = document.getElementById('analyticsCustomRangeInputs');
        const periodSel = document.getElementById('analyticsPeriod');
        if (inputs) inputs.style.display = enabled ? 'flex' : 'none';
        if (periodSel) periodSel.disabled = enabled;

        if (enabled && !this.customRange.start) {
            // Default: first day of year to today
            const now = new Date();
            const startDate = `${now.getFullYear()}-01-01`;
            const endDate = now.toISOString().split('T')[0];
            document.getElementById('analyticsCustomStart').value = startDate;
            document.getElementById('analyticsCustomEnd').value = endDate;
            this.customRange.start = startDate;
            this.customRange.end = endDate;
            localStorage.setItem('analytics_custom_range_start', startDate);
            localStorage.setItem('analytics_custom_range_end', endDate);
        }
        this.loadData();
    },

    onCustomRangeChange() {
        const start = document.getElementById('analyticsCustomStart')?.value || null;
        const end = document.getElementById('analyticsCustomEnd')?.value || null;
        // Validation : ne pas envoyer si l'une des dates est absente ou si end < start
        if (start && end) {
            if (start > end) {
                showToast(window.i18n.t('error_date_range_invalid') || 'La date de fin doit être après la date de début.', 'error');
                return;
            }
        }
        this.customRange.start = start;
        this.customRange.end = end;
        if (start) localStorage.setItem('analytics_custom_range_start', start);
        if (end) localStorage.setItem('analytics_custom_range_end', end);
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
        } catch(e) {
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
        const sections = [];
        for (const [txType, typeData] of Object.entries(by_type)) {
            sections.push(this.renderTypeTable(txType, typeData, months, revYears));
        }
        container.innerHTML = sections.join('');
    },

    renderTypeTable(txType, typeData, months, years) {
        const cfg = this.TYPE_CONFIG[txType] || { emoji: '•', color: 'var(--text-muted)', sign: '' };
        const { categories, totals_per_cat, totals_per_month, grand_total, annual_by_cat, annual_totals_per_year } = typeData;

        const isExpense = ['expense_fixed', 'expense_var'].includes(txType);
        const isIncome = txType === 'income';
        const translatedType = window.app.getTypeLabel(txType);

        // Max for heatmap
        let maxVal = 0;
        for (const cat of Object.keys(categories)) {
            for (const v of Object.values(categories[cat])) if (v > maxVal) maxVal = v;
        }

        const hb = `${cfg.color}22`;
        const hbd = `${cfg.color}44`;
        const annualSep = '3px solid rgba(255,255,255,0.15)';

        const monthHeaders = months.map(mk =>
            `<th data-year="${mk.split('-')[0]}" data-col-type="month" style="text-align:right;min-width:80px;white-space:nowrap;border-bottom:1px solid ${hbd};position:sticky;top:0;background:var(--bg-surface);z-index:20;">${this.formatShortMonth(mk)}</th>`
        ).join('');

        const yearHeaders = years.map(yr =>
            `<th data-year="${yr}" data-col-type="year" style="text-align:right;min-width:90px;white-space:normal;line-height:1.2;padding-top:8px;padding-bottom:8px;border-left:${annualSep};border-bottom:1px solid ${hbd};color:${cfg.color};background:${hb};position:sticky;top:0;z-index:20;backdrop-filter:blur(5px);">TOT.<span class="year-br"></span>${yr}</th>`
        ).join('');

        const catW = this._catColWidth || 160;
        const catStyle = `text-align:left;width:${catW}px;min-width:60px;max-width:500px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid ${hbd};position:sticky;left:0;top:0;background:var(--bg-surface);z-index:20;box-shadow:3px 0 6px rgba(0,0,0,0.2);box-sizing:border-box;position:sticky;`;

        let html = `
        <div data-type="${txType}" style="border:1px solid ${hbd};border-radius:12px;display:flex;flex-direction:column;max-height:75vh;">
            <div style="background:${hb};padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${hbd};flex-shrink:0;">
                <span style="font-weight:700;font-size:15px;color:${cfg.color};">${cfg.emoji} ${translatedType}</span>
                <span class="privacy-blur" style="font-size:13px;font-weight:600;color:${cfg.color};">${window.i18n.t('analytics_total_period')} : ${cfg.sign}${formatCurrency(grand_total)}</span>
            </div>
            <div style="overflow:auto;flex-grow:1;border-bottom-left-radius:12px;border-bottom-right-radius:12px;">
            <table class="data-table" style="min-width:${220 + months.length * 80 + years.length * 90}px;border-radius:0;border:none;margin:0;border-collapse:separate;border-spacing:0;">
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
                const intensity = maxVal > 0 ? v / maxVal : 0;
                const alpha = Math.round(intensity * 0.55 * 100) / 100;
                const bg = v > 0 ? (isExpense ? `rgba(239,68,68,${alpha})` : isIncome ? `rgba(16,185,129,${alpha})` : `rgba(99,102,241,${alpha})`) : 'transparent';
                return `<td data-year="${mk.split('-')[0]}" data-col-type="month" style="text-align:right;background:${bg};transition:opacity 0.2s;cursor:pointer;"
                    onclick="window.AnalyticsView.drillDown('${cat.replace(/'/g,"\\'")}','${mk}')"
                    title="🔍 ${cat} — ${this.formatShortMonth(mk)} — Voir les opérations">
                    <span class="privacy-blur">${v > 0 ? formatCurrency(v) : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</span>
                </td>`;
            }).join('');

            const yearCells = years.map(yr => {
                const v = annCat[yr] || 0;
                return `<td data-year="${yr}" data-col-type="year" style="text-align:right;border-left:${annualSep};background:${hb};font-weight:500;cursor:pointer;"
                    onclick="window.AnalyticsView.drillDownYear('${cat.replace(/'/g,"\\'")}','${yr}')"
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

        // Total row
        const totalMonthCells = months.map(mk => {
            const v = totals_per_month[mk] || 0;
            return `<td data-year="${mk.split('-')[0]}" data-col-type="month" style="text-align:right;color:${cfg.color};background:${hb};position:sticky;bottom:0;z-index:20;border-top:2px solid ${hbd};backdrop-filter:blur(5px);"><span class="privacy-blur">${v > 0 ? formatCurrency(v) : '—'}</span></td>`;
        }).join('');

        const totalYearCells = years.map(yr => {
            const v = (annual_totals_per_year || {})[yr] || 0;
            return `<td data-year="${yr}" data-col-type="year" style="text-align:right;border-left:${annualSep};color:${cfg.color};background:${hb};position:sticky;bottom:0;z-index:20;border-top:2px solid ${hbd};backdrop-filter:blur(5px);"><span class="privacy-blur">${v > 0 ? formatCurrency(v) : '—'}</span></td>`;
        }).join('');

        html += `<tr style="font-weight:700;">
            <td style="color:${cfg.color};font-weight:700;position:sticky;left:0;bottom:0;z-index:25;padding-left:16px;
                background:var(--bg-surface);border-top:2px solid ${hbd};
                box-shadow:inset 0 0 0 999px ${hb}, 3px 0 8px rgba(0,0,0,0.3);width:${catW}px;">TOT. ${translatedType.toUpperCase()}</td>
            ${totalMonthCells}
            ${totalYearCells}
        </tr>`;

        html += `</tbody></table></div></div>`;
        return html;
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
            localStorage.setItem('analytics_cat_col_width', this._catColWidth);
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    },

    showExportModal() {
        if (!this.data || !this.data.by_type) return;
        
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

        // Bug #3 : Calculer les dates de début/fin pour TOUS les modes de période,
        // pas seulement le custom range — pour que la modale reflète toujours ce qui est affiché
        const hasCustomRange = this.customRange.enabled && this.customRange.start && this.customRange.end;
        let defaultStart, defaultEnd;
        if (hasCustomRange) {
            defaultStart = this.customRange.start;
            defaultEnd   = this.customRange.end;
        } else if (this.selectedPeriod && this.selectedPeriod !== 'year') {
            // Rolling period : calculer les bornes réelles
            const now = new Date();
            const pad = n => n < 10 ? '0' + n : '' + n;
            const toYMD = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
            defaultEnd = toYMD(now);
            const rollMap = { m1: 1, m3: 3, m6: 6, m12: 12, m24: 24 };
            const months = rollMap[this.selectedPeriod] || 12;
            const start = new Date(now.getFullYear(), now.getMonth() - months, now.getDate());
            defaultStart = toYMD(start);
        } else {
            defaultStart = `${currentYear}-01-01`;
            defaultEnd   = `${currentYear}-12-31`;
        }
        // La case "Période personnalisée" est pré-cochée si custom range ou rolling period actifs
        const exportRangeChecked = hasCustomRange || (this.selectedPeriod && this.selectedPeriod !== 'year');
        
        let yearsHtml = availableYears.map(y => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                <input type="checkbox" class="export-year-cb" value="${y}" ${y === currentYear ? 'checked' : ''}> ${y}
            </label>
        `).join('');
        
        let typesHtml = types.map(type => {
            const translatedType = window.app.getTypeLabel(type);
            const cats = Object.keys(this.data.by_type[type].categories || {}).sort();
            const catsHtml = cats.map(cat => `
                <label style="display:flex;align-items:center;gap:8px;margin-left:20px;cursor:pointer;font-size:12px;">
                    <input type="checkbox" class="export-cat-cb" data-type="${type}" value="${cat.replace(/"/g, '&quot;')}" checked> ${cat}
                </label>
            `).join('');
            
            return `
            <div style="margin-bottom: 12px; background: rgba(0,0,0,0.02); padding: 8px; border-radius: 8px;">
                <label style="display:flex;align-items:center;gap:8px;font-weight:600;cursor:pointer;margin-bottom:6px;">
                    <input type="checkbox" class="export-type-cb" value="${type}" checked onchange="
                        const cbs = this.parentElement.parentElement.querySelectorAll('.export-cat-cb');
                        cbs.forEach(cb => cb.checked = this.checked);
                    "> ${translatedType}
                </label>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(180px, 1fr));gap:6px;">
                    ${catsHtml}
                </div>
            </div>`;
        }).join('');
        
        const colSettings = window.AllOperationsView ? window.AllOperationsView.getColSettings() : 
            { date: true, desc: true, type: false, cat: true, amount: true, recon: true };

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
                <input type="checkbox" class="export-col-cb" value="${c.id}" ${colSettings[c.id] ? 'checked' : ''}> ${c.label}
            </label>
        `).join('');

        const isOrgMode = window.app && window.app.config && (window.app.config.enable_org_mode === 'true' || window.app.config.enable_org_mode === true);
        const savedHeaderTitle = localStorage.getItem('print_header_title') || '';
        const savedLogoB64 = localStorage.getItem('print_header_logo') || null;
        const savedLogoLeft = localStorage.getItem('print_logo_left') !== 'false';
        const savedLogoRight = localStorage.getItem('print_logo_right') !== 'false';
        const orgHeaderHtml = isOrgMode ? `
        <div style="margin-bottom: 20px; padding: 14px; background: rgba(99,102,241,0.06); border-radius: 10px; border: 1px solid rgba(99,102,241,0.2);">
            <h4 style="margin:0 0 12px 0;color:var(--text-muted);font-size:12px;text-transform:uppercase;">${window.i18n.t('export_header_section') || 'En-tête du document'}</h4>
            <div style="display:flex;flex-direction:column;gap:10px;">
                <input type="text" id="exportHeaderTitle" class="inline-input" placeholder="${window.i18n.t('export_header_title_placeholder') || 'Titre du document'}" value="${savedHeaderTitle.replace(/"/g,'&quot;')}" style="width:100%;" oninput="localStorage.setItem('print_header_title', this.value)">
                <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                    <button class="btn btn-secondary" style="font-size:12px;padding:6px 14px;" onclick="document.getElementById('exportLogoFileInput').click()">${window.i18n.t('export_header_logo_import') || 'Importer un logo'}</button>
                    <input type="file" id="exportLogoFileInput" accept="image/*" style="display:none;" onchange="window.AnalyticsView._handleLogoUpload(this)">
                    ${savedLogoB64 ? `<button class="btn btn-danger" style="font-size:12px;padding:6px 14px;" onclick="localStorage.removeItem('print_header_logo');this.previousElementSibling.previousElementSibling.previousElementSibling.style.display='none';this.remove()">${window.i18n.t('export_header_logo_remove') || 'Supprimer le logo'}</button>` : ''}
                </div>
                ${savedLogoB64 ? `<img id="exportLogoPreview" src="${savedLogoB64}" style="max-height:60px;max-width:200px;border-radius:6px;border:1px solid var(--border-color);object-fit:contain;">` : '<div id="exportLogoPreview"></div>'}
                <div style="display:flex;gap:16px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                        <input type="checkbox" id="exportLogoLeft" ${savedLogoLeft ? 'checked' : ''} style="accent-color:var(--accent);" onchange="localStorage.setItem('print_logo_left', this.checked)">
                        ${window.i18n.t('export_logo_position_left') || 'Logo à gauche'}
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;">
                        <input type="checkbox" id="exportLogoRight" ${savedLogoRight ? 'checked' : ''} style="accent-color:var(--accent);" onchange="localStorage.setItem('print_logo_right', this.checked)">
                        ${window.i18n.t('export_logo_position_right') || 'Logo à droite'}
                    </label>
                </div>
            </div>
        </div>` : '';

        const modalHtml = `
        <div id="exportPdfModal" class="modal-overlay" style="display:flex;z-index:9999;">
            <div class="modal" style="width:700px; max-width:90vw; max-height:90vh; display:flex; flex-direction:column;">
                <h3 style="margin-bottom: 16px;">${window.i18n.t('export_modal_title')}</h3>
                <div style="flex:1; overflow-y:auto; padding-right:10px;">
                    ${orgHeaderHtml}
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin-bottom:10px;color:var(--text-muted);font-size:12px;text-transform:uppercase;">${window.i18n.t('export_modal_years')}</h4>
                        <div style="display:flex;gap:15px;flex-wrap:wrap;">
                            ${yearsHtml}
                        </div>
                        <div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border-color);">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text-muted);margin-bottom:8px;">
                                <input type="checkbox" id="exportCustomRange" ${exportRangeChecked ? 'checked' : ''} onchange="document.getElementById('exportCustomRangeInputs').style.display=this.checked?'flex':'none';">
                                ${window.i18n.t('export_custom_period') || 'Période personnalisée'}
                            </label>
                            <div id="exportCustomRangeInputs" style="display:${exportRangeChecked ? 'flex' : 'none'};gap:10px;align-items:center;flex-wrap:wrap;">
                                <input type="date" id="exportDateStart" class="inline-input" value="${defaultStart}" style="width:160px;">
                                <span style="color:var(--text-muted);font-size:12px;">→</span>
                                <input type="date" id="exportDateEnd" class="inline-input" value="${defaultEnd}" style="width:160px;">
                            </div>
                        </div>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin-bottom:10px;color:var(--text-muted);font-size:12px;text-transform:uppercase;">${window.i18n.t('export_modal_accounts')}</h4>
                        <div id="exportAccountBadges" style="display:flex;gap:6px;flex-wrap:wrap;"></div>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin-bottom:10px;color:var(--text-muted);font-size:12px;text-transform:uppercase;">${window.i18n.t('export_modal_tables')}</h4>
                        ${typesHtml}
                    </div>
                    <div style="margin-bottom: 20px;">
                        <h4 style="margin-bottom:10px;color:var(--text-muted);font-size:12px;text-transform:uppercase;">${window.i18n.t('export_account_balances') || 'Situation des comptes'}</h4>
                        <div id="exportBalanceCheckboxes" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:6px;background:rgba(0,0,0,0.02);padding:10px;border-radius:8px;"></div>
                    </div>
                    <div style="margin-bottom: 20px;">
                        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-weight:600;font-size:13px;padding:10px;background:rgba(0,0,0,0.02);border-radius:8px;">
                            <input type="checkbox" id="exportIncludeDetails" checked onchange="
                                document.getElementById('exportColsSection').style.display = this.checked ? 'block' : 'none';
                            " style="accent-color: var(--accent); width: 16px; height: 16px;">
                            ${window.i18n.t('export_include_details')}
                        </label>
                    </div>
                    <div id="exportColsSection">
                        <h4 style="margin-bottom:10px;color:var(--text-muted);font-size:12px;text-transform:uppercase;">${window.i18n.t('export_cols_title')}</h4>
                        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(140px, 1fr));gap:10px;background:rgba(0,0,0,0.02);padding:10px;border-radius:8px;">
                            ${colsHtml}
                        </div>
                    </div>

                    <div style="margin-top:12px;">
                        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:var(--text-muted);">
                            <input type="checkbox" id="exportForcePageBreak" style="accent-color:var(--accent);">
                            ${window.i18n.t('export_force_page_break') || 'Forcer un saut de page entre chaque tableau'}
                        </label>
                    </div>
                </div>
                <div class="modal-actions" style="margin-top:20px;padding-top:15px;border-top:1px solid var(--border-color);">
                    <button class="btn btn-secondary" onclick="document.getElementById('exportPdfModal').remove()">${window.i18n.t('export_modal_cancel')}</button>
                    <button class="btn btn-primary" onclick="window.AnalyticsView.executePrint()">${window.i18n.t('export_modal_print')}</button>
                </div>
            </div>
        </div>`;
        
        document.body.insertAdjacentHTML('beforeend', modalHtml);
        this._exportAccountIds = this.selectedAccountIds ? [...this.selectedAccountIds] : null;
        this._renderExportAccountBadges();
        this._renderExportBalanceCheckboxes();
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

    async executePrint() {
        const modal = document.getElementById('exportPdfModal');
        if (!modal) return;
        
        // Gather selections
        const selectedYears = Array.from(modal.querySelectorAll('.export-year-cb:checked')).map(cb => cb.value);
        const selectedTypes = Array.from(modal.querySelectorAll('.export-type-cb:checked')).map(cb => cb.value);
        const selectedCats = Array.from(modal.querySelectorAll('.export-cat-cb:checked')).map(cb => cb.value);
        const selectedCols = Array.from(modal.querySelectorAll('.export-col-cb:checked')).map(cb => cb.value);
        const includeDetails = modal.querySelector('#exportIncludeDetails')?.checked ?? true;
        
        // Custom date range — validation avant envoi
        const useCustomRange = modal.querySelector('#exportCustomRange')?.checked ?? false;
        let customStart = useCustomRange ? (modal.querySelector('#exportDateStart')?.value || null) : null;
        let customEnd   = useCustomRange ? (modal.querySelector('#exportDateEnd')?.value || null)   : null;
        // Swap si end < start
        if (customStart && customEnd && customStart > customEnd) { [customStart, customEnd] = [customEnd, customStart]; }



        // Bug #7 : Saut de page forcé
        const forcePageBreak = modal.querySelector('#exportForcePageBreak')?.checked ?? false;

        // Bug #8 : En-tête pro (mode org)
        const headerTitle = modal.querySelector('#exportHeaderTitle')?.value?.trim() || '';
        const headerLogoB64 = localStorage.getItem('print_header_logo') || null;
        const logoLeft  = modal.querySelector('#exportLogoLeft')?.checked ?? true;
        const logoRight = modal.querySelector('#exportLogoRight')?.checked ?? true;
        
        // Gather account filter from modal
        const exportAccIds = this._exportAccountIds;
        
        // Determine primary year (most recent selected)
        const primaryYear = selectedYears.slice().sort().reverse()[0] || null;
        
        let printData = this.data;
        let allTx = [];
        let accountsMap = {};
        let budgetsMap = {};
        let categoryToBudgetMap = {};
        
        // Bug #4 : Re-fetch les données avec les paramètres exacts (custom range ou année)
        // pour garantir la cohérence entre synthèse et PDF
        try {
            if (useCustomRange && customStart && customEnd) {
                // Custom range : fetch avec les bornes exactes du PDF
                let printUrl = `/api/stats/categories_by_month?reconciled=${this.reconciled}&date_start=${customStart}&date_end=${customEnd}`;
                if (exportAccIds) printUrl += `&account_ids=${exportAccIds.join(',')}`;
                printData = await API.get(printUrl);
            } else if (primaryYear) {
                let printUrl = `/api/stats/categories_by_month?reconciled=${this.reconciled}&year=${primaryYear}`;
                if (exportAccIds) printUrl += `&account_ids=${exportAccIds.join(',')}`;
                printData = await API.get(printUrl);
            }
            allTx = await API.get('/api/transactions/?limit=10000');
            const accs = await API.get('/api/accounts/');
            accs.forEach(a => { accountsMap[a.id] = a.name; });
            const budgets = await API.get('/api/budgets/');
            budgets.forEach(b => {
                budgetsMap[b.id] = b.name;
                if (!b.is_project && b.categories) {
                    b.categories.forEach(cat => { categoryToBudgetMap[cat] = b.name; });
                }
            });
        } catch (e) {
            console.error("Error fetching print data", e);
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
        
        if (by_type) {
            const typeEntries = Object.entries(by_type);
            typeEntries.forEach(([txType, typeData], idx) => {
                // Bug #6 : Pas de saut sur le DERNIER tableau
                // Bug #7 : Saut forcé seulement si la checkbox est cochée
                const isLast = idx === typeEntries.length - 1;
                const breakClass = (!isLast && forcePageBreak) ? 'print-page-break-forced' : 'print-page-break-auto';
                sections.push(`<div class="${breakClass}">` + this.renderTypeTable(txType, typeData, months, revYears) + '</div>');
            });
        }
        
        // Build transactions list
        let filteredTx = allTx.filter(tx => {
            const dateStr = tx.date_operation || '';
            const yr = dateStr.split('-')[0];
            
            if (useCustomRange && customStart && customEnd) {
                // Custom range: compare full YYYY-MM-DD date string
                const txDate = dateStr.substring(0, 10); // YYYY-MM-DD
                if (txDate < customStart || txDate > customEnd) return false;
            } else {
                if (!selectedYears.includes(yr)) return false;
            }
            
            if (!selectedTypes.includes(tx.type)) return false;
            
            // Account filter from modal
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
                    <strong style="font-size:14px;">${window.i18n.t('export_balance_title') || 'Situation des comptes'}</strong>
                    <span style="float:right;font-size:12px;color:var(--text-muted);">${new Date().toLocaleDateString(window.i18n.currentLang === 'en' ? 'en-US' : 'fr-FR', {day:'numeric', month:'long', year:'numeric'})}</span>
                </div>
                <table style="width:100%;border-collapse:collapse;font-size:12px;">
                    <thead><tr style="background:rgba(0,0,0,0.03);">
                        <th style="text-align:left;padding:6px 12px;border-bottom:1px solid var(--border-color);">${window.i18n.t('acc_th_name')}</th>
                        <th style="text-align:left;padding:6px 12px;border-bottom:1px solid var(--border-color);">${window.i18n.t('acc_th_type')}</th>
                        <th style="text-align:right;padding:6px 12px;border-bottom:1px solid var(--border-color);">${window.i18n.t('export_balance_current') || 'Solde actuel'}</th>
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
            const leftLogo  = (headerLogoB64 && logoLeft)  ? logoHtml : `<span style="min-width:80px;"></span>`;
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

        const titleHtml = `<h2 style="margin-bottom: 20px;">${window.i18n.t('analytics_title')}</h2>`;
        printContainer.innerHTML = orgHeaderBlockHtml + balancesHtml + sections.join('') + txHtml;
        // Titre uniquement si pas d'en-tête org
        if (!orgHeaderBlockHtml) {
            printContainer.insertAdjacentHTML('afterbegin', titleHtml);
        }
        
        // Handle Types
        printContainer.querySelectorAll('[data-type]').forEach(el => {
            if (!selectedTypes.includes(el.getAttribute('data-type'))) {
                el.classList.add('no-print');
            } else {
                // Handle Categories within this type
                el.querySelectorAll('tr[data-category]').forEach(tr => {
                    if (!selectedCats.includes(tr.getAttribute('data-category'))) {
                        tr.classList.add('no-print');
                    }
                });
            }
        });
        
        // Handle Years (columns)
        printContainer.querySelectorAll('[data-year]').forEach(el => {
            const yr = el.getAttribute('data-year');
            const colType = el.getAttribute('data-col-type');
            
            if (!selectedYears.includes(yr)) {
                el.classList.add('no-print');
            } else if (colType === 'month' && yr !== primaryYear) {
                // Hide month columns if not primary year
                el.classList.add('no-print');
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
                modal.remove();
            }, 500);
        }, 100);
    },

    /** Bug #8 : Gestion de l'import de logo — conversion en base64 et sauvegarde dans localStorage */
    _handleLogoUpload(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        // Vérification type
        if (!file.type.startsWith('image/')) {
            showToast('Fichier non supporté. Veuillez importer une image (PNG, JPG, SVG…).', 'error');
            return;
        }
        // Vérification taille (max 2 Mo)
        if (file.size > 2 * 1024 * 1024) {
            showToast('Logo trop volumineux (max 2 Mo). Veuillez réduire la taille du fichier.', 'error');
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
                localStorage.setItem('print_header_logo', resizedB64);
                // Mettre à jour le preview dans la modale
                const preview = document.getElementById('exportLogoPreview');
                if (preview) {
                    preview.outerHTML = `<img id="exportLogoPreview" src="${resizedB64}" style="max-height:60px;max-width:200px;border-radius:6px;border:1px solid var(--border-color);object-fit:contain;">`;
                }
                showToast('Logo importé et enregistré ✅', 'success');
            };
            img.src = b64;
        };
        reader.readAsDataURL(file);
    }
};
