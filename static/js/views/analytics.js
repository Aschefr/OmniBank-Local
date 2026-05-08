// analytics.js — Synthèse Catégories × Mois (séparée par type) + totaux annuels
window.AnalyticsView = {
    data: null,
    months: null,
    reconciled: 'all',
    selectedYear: new Date().getFullYear(),

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
                    <button class="btn btn-secondary" onclick="window.print()" style="padding: 6px 12px; font-size: 13px;" data-i18n-title="tooltip_export_pdf" title="Générer un PDF du rapport" data-i18n="btn_export_pdf">📥 Exporter en PDF</button>
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
                </div>
            </div>
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
        
        // First load to discover available years, then populate selector
        await this.loadData();
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

    async loadData() {
        try {
            let url = `/api/stats/categories_by_month?reconciled=${this.reconciled}`;
            if (this.selectedYear) {
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
            `<th style="text-align:right;min-width:80px;white-space:nowrap;border-bottom:1px solid ${hbd};position:sticky;top:0;background:var(--bg-surface);z-index:20;">${this.formatShortMonth(mk)}</th>`
        ).join('');

        const yearHeaders = years.map(yr =>
            `<th style="text-align:right;min-width:90px;white-space:nowrap;border-left:${annualSep};border-bottom:1px solid ${hbd};color:${cfg.color};background:${hb};position:sticky;top:0;z-index:20;backdrop-filter:blur(5px);">Total ${yr}</th>`
        ).join('');

        let html = `
        <div style="border:1px solid ${hbd};border-radius:12px;display:flex;flex-direction:column;max-height:75vh;">
            <div style="background:${hb};padding:12px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid ${hbd};flex-shrink:0;">
                <span style="font-weight:700;font-size:15px;color:${cfg.color};">${cfg.emoji} ${translatedType}</span>
                <span class="privacy-blur" style="font-size:13px;font-weight:600;color:${cfg.color};">${window.i18n.t('analytics_total_period')} : ${cfg.sign}${formatCurrency(grand_total)}</span>
            </div>
            <div style="overflow:auto;flex-grow:1;border-bottom-left-radius:12px;border-bottom-right-radius:12px;">
            <table class="data-table" style="min-width:${220 + months.length * 80 + years.length * 90}px;border-radius:0;border:none;margin:0;border-collapse:separate;border-spacing:0;">
            <thead><tr style="background:var(--bg-surface);">
                <th style="text-align:left;min-width:100px;max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-bottom:1px solid ${hbd};position:sticky;left:0;top:0;background:var(--bg-surface);z-index:20;box-shadow:3px 0 6px rgba(0,0,0,0.2);" data-i18n="analytics_th_category">${window.i18n.t('analytics_th_category')}</th>
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
                return `<td style="text-align:right;background:${bg};transition:opacity 0.2s;cursor:pointer;"
                    onclick="window.AnalyticsView.drillDown('${cat.replace(/'/g,"\\'")}','${mk}')"
                    title="🔍 ${cat} — ${this.formatShortMonth(mk)} — Voir les opérations">
                    <span class="privacy-blur">${v > 0 ? formatCurrency(v) : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</span>
                </td>`;
            }).join('');

            const yearCells = years.map(yr => {
                const v = annCat[yr] || 0;
                return `<td style="text-align:right;border-left:${annualSep};background:${hb};font-weight:500;cursor:pointer;"
                    onclick="window.AnalyticsView.drillDownYear('${cat.replace(/'/g,"\\'")}','${yr}')"
                    title="🔍 ${cat} — ${yr}">
                    <span class="privacy-blur">${v > 0 ? formatCurrency(v) : '<span style="color:var(--text-muted);font-size:11px;">—</span>'}</span>
                </td>`;
            }).join('');

            html += `<tr>
                <td title="${cat.replace(/"/g, '&quot;')}" style="font-weight:500;min-width:100px;max-width:130px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;position:sticky;left:0;z-index:5;
                    background:var(--bg-surface);
                    box-shadow:3px 0 8px rgba(0,0,0,0.25);">${cat}</td>
                ${monthCells}
                ${yearCells}
            </tr>`;
        }

        // Total row
        const totalMonthCells = months.map(mk => {
            const v = totals_per_month[mk] || 0;
            return `<td style="text-align:right;color:${cfg.color};background:${hb};position:sticky;bottom:0;z-index:20;border-top:2px solid ${hbd};backdrop-filter:blur(5px);"><span class="privacy-blur">${v > 0 ? formatCurrency(v) : '—'}</span></td>`;
        }).join('');

        const totalYearCells = years.map(yr => {
            const v = (annual_totals_per_year || {})[yr] || 0;
            return `<td style="text-align:right;border-left:${annualSep};color:${cfg.color};background:${hb};position:sticky;bottom:0;z-index:20;border-top:2px solid ${hbd};backdrop-filter:blur(5px);"><span class="privacy-blur">${v > 0 ? formatCurrency(v) : '—'}</span></td>`;
        }).join('');

        html += `<tr style="font-weight:700;">
            <td style="color:${cfg.color};font-weight:700;position:sticky;left:0;bottom:0;z-index:25;padding-left:16px;
                background:var(--bg-surface);border-top:2px solid ${hbd};
                box-shadow:inset 0 0 0 999px ${hb}, 3px 0 8px rgba(0,0,0,0.3);">TOTAL ${translatedType.toUpperCase()}</td>
            ${totalMonthCells}
            ${totalYearCells}
        </tr>`;

        html += `</tbody></table></div></div>`;
        return html;
    },

    drillDown(category, monthKey) {
        // Set pending filter before navigating
        window.AllOperationsView.pendingFilter = { category, monthKey };
        window.app.loadView('all_operations');
    },

    drillDownYear(category, year) {
        window.AllOperationsView.pendingFilter = { category, monthKey: '', year };
        window.app.loadView('all_operations');
    }
};
