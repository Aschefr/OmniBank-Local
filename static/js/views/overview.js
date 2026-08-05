// overview.js — Vue d'ensemble (Overview) — Vue simplifiée & premium plein écran
window.OverviewView = {
    _chart: null,
    _unreconciledTxs: [],
    _searchQuery: '',

    render() {
        return `
            <div id="overviewRoot" class="overview-root">
                <!-- Header / Health Badge & Quick Actions -->
                <div class="overview-top-bar">
                    <div class="overview-title-group">
                        <h2 class="overview-main-title">👀 <span data-i18n="nav_overview">${window.i18n.t('nav_overview')}</span></h2>
                        <div id="ovHealthBadge" class="overview-health-badge">—</div>
                    </div>
                    <div class="overview-top-actions">
                        <button class="btn btn-primary overview-add-btn" onclick="window.OverviewView.showAddModal()">
                            ✨ <span>${window.i18n.t('btn_add_operation') || 'Nouvelle opération'}</span>
                        </button>
                    </div>
                </div>

                <!-- Section 1: Hero KPI Cards -->
                <div class="overview-hero">
                    <div class="overview-hero-card overview-hero-networth">
                        <div class="overview-hero-icon">🏦</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" data-i18n="overview_net_worth">${window.i18n.t('overview_net_worth')}</div>
                            <div class="overview-hero-value privacy-blur" id="ovNetWorth">—</div>
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-rav">
                        <div class="overview-hero-icon">💡</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" data-i18n="overview_rest_to_live">${window.i18n.t('overview_rest_to_live')}</div>
                            <div class="overview-hero-value privacy-blur" id="ovRestToLive">—</div>
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-pay" id="ovPayCard" style="display:none;">
                        <div class="overview-hero-icon">📅</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" data-i18n="overview_next_pay">${window.i18n.t('overview_next_pay')}</div>
                            <div class="overview-hero-value privacy-blur" id="ovNextPayAmount">—</div>
                            <div class="overview-hero-sub" id="ovNextPayDate"></div>
                        </div>
                    </div>
                    <div class="overview-hero-card overview-hero-overdraft" id="ovOverdraftCard" style="display:none;">
                        <div class="overview-hero-icon">⚠️</div>
                        <div class="overview-hero-content">
                            <div class="overview-hero-label" data-i18n="overview_overdraft_risk">${window.i18n.t('overview_overdraft_risk')}</div>
                            <div class="overview-hero-value privacy-blur text-red" id="ovOverdraftAmount">—</div>
                            <div class="overview-hero-sub" id="ovOverdraftDate"></div>
                        </div>
                    </div>
                </div>

                <!-- Section 2: Central Wide Card — Opérations non rapprochées -->
                <div class="overview-main-card">
                    <div class="overview-card-header">
                        <div class="overview-header-title">
                            <h3>📋 <span data-i18n="overview_unreconciled_ops">${window.i18n.t('overview_unreconciled_ops')}</span></h3>
                            <span id="ovUnreconciledBadge" class="overview-count-pill">0</span>
                        </div>
                        <div class="overview-header-right">
                            <input type="text" id="ovOpsSearch" class="overview-search-input" 
                                placeholder="${window.i18n.t('ph_search') || 'Rechercher...'}" 
                                oninput="window.OverviewView.onSearch(this.value)">
                            <button class="overview-link-btn" onclick="window.app.showUnreconciledBeforePay()" data-i18n="overview_see_all">${window.i18n.t('overview_see_all')} →</button>
                        </div>
                    </div>
                    <div id="ovUnreconciledList" class="overview-ops-table-container">
                        <div class="overview-loading">⏳</div>
                    </div>
                </div>

                <!-- Section 3: Bottom Grid (Tendance 6 mois + Budgets & Épargne) -->
                <div class="overview-bottom-grid">
                    <!-- Column 1: Trend Chart (6 Months Area Chart) -->
                    <div class="overview-card overview-card-trend">
                        <div class="overview-card-header">
                            <h3>📈 <span data-i18n="overview_monthly_trend">${window.i18n.t('overview_monthly_trend')}</span> (6M)</h3>
                            <button class="overview-link-btn" onclick="window.app.loadView('trends')" data-i18n="overview_see_all">${window.i18n.t('overview_see_all')} →</button>
                        </div>
                        <div class="overview-trend-container">
                            <canvas id="ovTrendChart"></canvas>
                        </div>
                        <div id="ovTrendLegend" class="overview-trend-legend"></div>
                    </div>

                    <!-- Column 2: Budgets & Savings -->
                    <div class="overview-card overview-card-budgets-savings">
                        <div class="overview-card-header">
                            <h3>🎯 <span data-i18n="overview_budgets">${window.i18n.t('overview_budgets')}</span> & <span data-i18n="overview_savings">${window.i18n.t('overview_savings')}</span></h3>
                            <button class="overview-link-btn" onclick="window.app.loadView('budgets')" data-i18n="overview_see_all">${window.i18n.t('overview_see_all')} →</button>
                        </div>
                        <div class="overview-budgets-wrapper">
                            <div class="overview-section-subtitle">🎯 Budgets</div>
                            <div id="ovBudgetsList" class="overview-budgets-list">
                                <div class="overview-loading">⏳</div>
                            </div>

                            <div id="ovSavingsSection" style="display:none; margin-top: 20px;">
                                <div class="overview-section-subtitle">💰 Épargne & Objectifs</div>
                                <div id="ovSavingsList" class="overview-savings-list"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    },

    async init() {
        // Fetch data in parallel
        const [stats, accounts, transactions] = await Promise.all([
            API.get('/api/stats/dashboard'),
            API.get('/api/stats/accounts'),
            API.get('/api/transactions/?limit=1000')
        ]);

        this._accountsMap = {};
        (accounts || []).forEach(a => { this._accountsMap[a.id] = a; });

        this._renderHealthBadge(stats);
        this._renderHero(stats);
        this._renderUnreconciled(transactions);
        this._renderBudgets(stats);
        this._renderSavings(stats);
        await this._renderTrend();
    },

    _renderHealthBadge(stats) {
        const badge = document.getElementById('ovHealthBadge');
        if (!badge) return;

        if (stats.overdraft_warning) {
            badge.className = 'overview-health-badge badge-danger';
            badge.innerHTML = `⚠️ Risk Découvert (${formatCurrency(stats.overdraft_warning.projected_balance)})`;
        } else if (stats.savings_overflow && stats.savings_overflow.fully_consumed) {
            badge.className = 'overview-health-badge badge-warning';
            badge.innerHTML = `🟧 Épargne entamée`;
        } else if (stats.rest_to_live < 0) {
            badge.className = 'overview-health-badge badge-warning';
            badge.innerHTML = `🟧 Reste à vivre négatif`;
        } else {
            badge.className = 'overview-health-badge badge-success';
            badge.innerHTML = `🟢 Situation Saine`;
        }
    },

    _renderHero(stats) {
        const nw = document.getElementById('ovNetWorth');
        if (nw) nw.textContent = formatCurrency(stats.net_worth);

        const rav = document.getElementById('ovRestToLive');
        if (rav) {
            rav.textContent = formatCurrency(stats.rest_to_live);
            if (stats.savings_overflow) {
                rav.style.color = stats.savings_overflow.fully_consumed ? '#ef4444' : '#f59e0b';
            } else if (stats.rest_to_live < 0) {
                rav.style.color = '#ef4444';
            } else {
                rav.style.color = '#10b981';
            }
        }

        const isOrgMode = window.app.config && (window.app.config.enable_org_mode === 'true');
        const payCard = document.getElementById('ovPayCard');
        if (stats.next_pay_date && !isOrgMode && payCard) {
            payCard.style.display = 'flex';
            document.getElementById('ovNextPayAmount').textContent = formatCurrency(stats.next_pay_amount);
            const dateStr = formatDate(stats.next_pay_date) + (stats.is_pay_override ? ' ✏️' : '');
            document.getElementById('ovNextPayDate').textContent = dateStr;
        }

        const odCard = document.getElementById('ovOverdraftCard');
        if (stats.overdraft_warning && odCard) {
            odCard.style.display = 'flex';
            document.getElementById('ovOverdraftAmount').textContent = formatCurrency(stats.overdraft_warning.projected_balance);
            document.getElementById('ovOverdraftDate').textContent = formatDate(stats.overdraft_warning.date);
        }
    },

    _renderUnreconciled(transactions) {
        const container = document.getElementById('ovUnreconciledList');
        const badge = document.getElementById('ovUnreconciledBadge');
        if (!container) return;

        // Filter unreconciled ops
        let unreconciled = transactions.filter(tx =>
            !tx.reconciliation_date &&
            !tx.is_skipped &&
            tx.cross_profile_status !== 'pending'
        ).sort((a, b) => new Date(a.date_operation) - new Date(b.date_operation));

        this._unreconciledTxs = unreconciled;
        if (badge) badge.textContent = unreconciled.length;

        // Apply filter if query exists
        if (this._searchQuery) {
            const q = this._searchQuery.toLowerCase();
            unreconciled = unreconciled.filter(tx =>
                (tx.description || '').toLowerCase().includes(q) ||
                (tx.category || '').toLowerCase().includes(q)
            );
        }

        if (unreconciled.length === 0) {
            container.innerHTML = `
                <div class="overview-empty">
                    <span>🎉 Aucune opération à rapprocher</span>
                </div>
            `;
            return;
        }

        const display = unreconciled.slice(0, 20);
        const remaining = unreconciled.length - display.length;

        let html = `
            <table class="overview-ops-table">
                <thead>
                    <tr>
                        <th style="width: 110px;">Date</th>
                        <th style="width: 130px;">Compte</th>
                        <th>Description</th>
                        <th style="width: 140px;">Catégorie</th>
                        <th style="width: 120px; text-align: right;">Montant</th>
                        <th style="width: 110px; text-align: center;">Action</th>
                    </tr>
                </thead>
                <tbody>
        `;

        for (const tx of display) {
            const amountColor = tx.type === 'income' ? 'var(--color-income)' : 
                               (tx.type === 'transfer' ? 'var(--color-transfer)' : 'inherit');
            const catLabel = tx.category || 'Sans catégorie';
            
            // Get account name
            let accName = '—';
            if (tx.from_account_id && this._accountsMap[tx.from_account_id]) {
                accName = this._accountsMap[tx.from_account_id].name;
            } else if (tx.to_account_id && this._accountsMap[tx.to_account_id]) {
                accName = this._accountsMap[tx.to_account_id].name;
            }

            html += `
                <tr id="ovRow_${tx.id}" class="overview-op-tr">
                    <td class="ov-td-date">${renderDateWithStatus(tx)}</td>
                    <td class="ov-td-acc"><span class="overview-acc-badge">${escapeHtml(accName)}</span></td>
                    <td class="ov-td-desc" title="${escapeHtml(tx.description || '')}">${escapeHtml(tx.description || '—')}</td>
                    <td class="ov-td-cat"><span class="overview-cat-badge">${escapeHtml(catLabel)}</span></td>
                    <td class="ov-td-amt privacy-blur" style="color: ${amountColor}; font-weight: 700;">${formatCurrency(tx.amount)}</td>
                    <td class="ov-td-action">
                        <button class="btn btn-sm overview-recon-action-btn" onclick="window.OverviewView.toggleReconciliation(${tx.id})">
                            ✓ Rapprocher
                        </button>
                    </td>
                </tr>
            `;
        }

        html += `</tbody></table>`;

        if (remaining > 0) {
            html += `
                <div class="overview-op-more">
                    <button class="overview-link-btn" onclick="window.app.showUnreconciledBeforePay()">
                        +${remaining} autres opérations non rapprochées →
                    </button>
                </div>
            `;
        }

        container.innerHTML = html;
    },

    onSearch(query) {
        this._searchQuery = query || '';
        this._renderUnreconciled(this._unreconciledTxs);
    },

    _renderBudgets(stats) {
        const container = document.getElementById('ovBudgetsList');
        if (!container) return;

        const summary = stats.budget_summary || {};
        const periodLabels = {
            'monthly': window.i18n.t('stat_budgets_monthly') || 'Budgets (Mensuel)',
            'yearly': window.i18n.t('stat_budgets_yearly') || 'Budgets (Annuel)',
            'indefinite': window.i18n.t('stat_budgets_indefinite') || 'Budgets (Indéfini)',
            'custom': window.i18n.t('stat_budgets_custom') || 'Budgets (Défini)'
        };
        const orderedPeriods = ['monthly', 'yearly', 'indefinite', 'custom'];

        let html = '';
        let hasContent = false;

        for (const period of orderedPeriods) {
            const pg = summary[period];
            if (!pg || pg.target <= 0) continue;
            hasContent = true;

            const spent = Math.abs(pg.reconciled_expenses || 0);
            const target = pg.target;
            const pct = target > 0 ? Math.min((spent / target) * 100, 100) : 0;
            const remaining = Math.max(target - spent, 0);
            const over = spent > target;
            const color = over ? '#ef4444' : pct >= 80 ? '#f59e0b' : pct >= 50 ? '#3b82f6' : '#10b981';

            html += `
                <div class="overview-budget-item" onclick="window.app.loadView('budgets')">
                    <div class="overview-budget-header">
                        <span class="overview-budget-name">${periodLabels[period] || period}</span>
                        <span class="overview-budget-pct" style="color: ${color};">${Math.round(pct)}% ${window.i18n.t('overview_used')}</span>
                    </div>
                    <div class="overview-budget-bar-bg">
                        <div class="overview-budget-bar-fill" style="width: ${pct}%; background: ${color};"></div>
                    </div>
                    <div class="overview-budget-footer">
                        <span class="privacy-blur">${formatCurrency(spent)} ${window.i18n.t('overview_of_budget')} ${formatCurrency(target)}</span>
                        <span class="privacy-blur" style="color: ${color}; font-weight: 600;">${formatCurrency(remaining)} ${window.i18n.t('overview_remaining')}</span>
                    </div>
                </div>
            `;
        }

        container.innerHTML = hasContent ? html : '<div class="overview-empty">— Aucune enveloppe budget —</div>';
    },

    _renderSavings(stats) {
        const sec = document.getElementById('ovSavingsSection');
        const container = document.getElementById('ovSavingsList');
        if (!sec || !container) return;

        const savings = (stats.savings_details || []).filter(s => !s.is_closed);
        if (savings.length === 0) return;

        sec.style.display = 'block';
        let html = '';

        for (const s of savings) {
            const pct = s.goal > 0 ? Math.min((s.balance / s.goal) * 100, 100) : (s.balance > 0 ? 100 : 0);
            const color = pct >= 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b';

            html += `
                <div class="overview-savings-item" onclick="window.app.loadView('budgets')">
                    <div class="overview-savings-header">
                        <span class="overview-savings-name">${escapeHtml(s.name)}</span>
                        <span class="overview-savings-pct" style="color: ${color};">${Math.round(pct)}%</span>
                    </div>
                    <div class="overview-budget-bar-bg">
                        <div class="overview-budget-bar-fill" style="width: ${pct}%; background: ${color};"></div>
                    </div>
                    <div class="overview-budget-footer">
                        <span class="privacy-blur">${formatCurrency(s.balance)}</span>
                        ${s.goal > 0 ? `<span class="privacy-blur" style="color: var(--text-muted);">${window.i18n.t('overview_of_budget')} ${formatCurrency(s.goal)}</span>` : ''}
                    </div>
                </div>
            `;
        }

        container.innerHTML = html;
    },

    async _renderTrend() {
        const canvas = document.getElementById('ovTrendChart');
        const legendContainer = document.getElementById('ovTrendLegend');
        if (!canvas) return;

        try {
            // Fetch 6 months category data
            const catData = await API.get('/api/stats/categories_by_month?months=6');

            // Generate last 6 months keys YYYY-MM
            const today = new Date();
            const monthKeys = [];
            const monthLabels = [];
            const monthNames = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

            for (let i = 5; i >= 0; i--) {
                const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
                const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                monthKeys.append ? monthKeys.push(mk) : monthKeys.push(mk);
                monthLabels.push(`${monthNames[d.getMonth()]} ${d.getFullYear() % 100}`);
            }

            // Sum variable and fixed expenses per month
            const monthlyTotals = monthKeys.map(mk => {
                let total = 0;
                for (const txType of ['expense_var', 'expense_fixed']) {
                    const typeGroup = (catData.by_type && catData.by_type[txType]) ? catData.by_type[txType] : catData[txType];
                    if (typeGroup && typeGroup.totals_per_month && typeGroup.totals_per_month[mk]) {
                        total += Math.abs(typeGroup.totals_per_month[mk]);
                    }
                }
                return Math.round(total * 100) / 100;
            });

            // Destroy previous chart
            if (this._chart) {
                this._chart.destroy();
                this._chart = null;
            }

            const ctx = canvas.getContext('2d');
            
            // Gradient fill
            const gradient = ctx.createLinearGradient(0, 0, 0, 220);
            gradient.addColorStop(0, 'rgba(99, 102, 241, 0.35)');
            gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

            this._chart = new Chart(canvas, {
                type: 'line',
                data: {
                    labels: monthLabels,
                    datasets: [{
                        label: 'Dépenses mensuelles',
                        data: monthlyTotals,
                        fill: true,
                        backgroundColor: gradient,
                        borderColor: '#6366f1',
                        borderWidth: 3,
                        pointBackgroundColor: '#6366f1',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 2,
                        pointRadius: 5,
                        pointHoverRadius: 7,
                        tension: 0.35
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.9)',
                            padding: 12,
                            titleFont: { size: 13, weight: 'bold' },
                            bodyFont: { size: 13 },
                            displayColors: false,
                            callbacks: {
                                label: (ctx) => `Dépenses: ${formatCurrency(ctx.raw)}`
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: { color: 'rgba(128,128,128,0.1)' },
                            ticks: {
                                callback: (v) => formatCurrency(v),
                                color: 'rgba(128,128,128,0.6)',
                                font: { size: window.innerWidth < 768 ? 9.5 : 11 }
                            }
                        },
                        x: {
                            grid: { display: false },
                            ticks: {
                                color: 'rgba(128,128,128,0.8)',
                                font: { size: window.innerWidth < 768 ? 10.5 : 12, weight: '600' }
                            }
                        }
                    }
                }
            });

            if (legendContainer) {
                const currentMonthTotal = monthlyTotals[monthlyTotals.length - 1] || 0;
                const prevMonthTotal = monthlyTotals[monthlyTotals.length - 2] || 0;
                const diff = currentMonthTotal - prevMonthTotal;
                const pct = prevMonthTotal > 0 ? ((diff / prevMonthTotal) * 100).toFixed(0) : 0;
                
                const arrow = diff > 0 ? '↑' : diff < 0 ? '↓' : '→';
                const color = diff > 0 ? '#ef4444' : diff < 0 ? '#10b981' : 'var(--text-muted)';
                const sign = diff > 0 ? '+' : '';

                legendContainer.innerHTML = `
                    <div style="display:flex; justify-content:center; align-items:center; gap:12px; font-size:13px;">
                        <span>Ce mois: <strong>${formatCurrency(currentMonthTotal)}</strong></span>
                        <span style="color: ${color}; font-weight: 700;">
                            ${arrow} ${sign}${pct}% vs mois dernier
                        </span>
                    </div>
                `;
            }
        } catch (e) {
            console.error('[overview] Erreur rendu tendance', e);
            canvas.parentElement.innerHTML = '<div class="overview-empty">— Données insuffisantes pour la courbe —</div>';
        }
    },

    async toggleReconciliation(id) {
        try {
            const row = document.getElementById(`ovRow_${id}`);
            if (row) {
                row.style.opacity = '0.4';
                row.style.pointerEvents = 'none';
            }
            const res = await API.post(`/api/transactions/${id}/toggle_reconciliation`);
            showUndoToast(window.i18n.t('toast_tx_updated') || "Opération modifiée", res.action_id, () => this.init());
            // Refresh sidebar + re-init overview
            await Promise.all([window.app.refreshSidebar(), this.init()]);
        } catch (e) {
            console.error('[overview] Erreur rapprochement', e);
            const row = document.getElementById(`ovRow_${id}`);
            if (row) {
                row.style.opacity = '1';
                row.style.pointerEvents = '';
            }
        }
    },

    showAddModal() {
        if (window.FormView) {
            window.FormView.open();
        }
    },

    destroy() {
        if (this._chart) {
            this._chart.destroy();
            this._chart = null;
        }
    }
};
