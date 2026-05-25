// trends.js — Tendances (Chart.js)
window.TrendsView = {
    accounts: [],
    selectedAccountId: null,
    chart: null,
    historyData: [],
    
    // State
    timeframeMonths: 12,
    showOtherYears: false,
    showOtherMonths: false,

    render() {
        return `
        <div>
            <div class="view-header" style="position:sticky;top:-32px;z-index:10;background:var(--bg-base);padding:32px 0 15px;margin-top:-32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <h2 style="margin:0;">📉 <span data-i18n="nav_trends">Tendances</span></h2>
                <div style="display:flex;gap:10px;align-items:center; flex-wrap: wrap;">
                    <label style="font-size:13px;color:var(--text-muted);" data-i18n="trends_label_account">${window.i18n.t('trends_label_account')}</label>
                    <select id="trendsAccountSelect" class="inline-input" style="width:160px;" onchange="window.TrendsView.onAccountChange(this.value)">
                        <option value="" data-i18n="trends_opt_loading">${window.i18n.t('trends_opt_loading')}</option>
                    </select>
                    
                    <label style="font-size:13px;color:var(--text-muted);margin-left:10px;" data-i18n="trends_label_period">${window.i18n.t('trends_label_period')}</label>
                    <select id="trendsTimeframeSelect" class="inline-input" style="width:100px;" onchange="window.TrendsView.onTimeframeChange(this.value)">
                        <option value="1" data-i18n="trends_1m">${window.i18n.t('trends_1m')}</option>
                        <option value="3" data-i18n="trends_3m">${window.i18n.t('trends_3m')}</option>
                        <option value="6" data-i18n="trends_6m">${window.i18n.t('trends_6m')}</option>
                        <option value="9" data-i18n="trends_9m">${window.i18n.t('trends_9m')}</option>
                        <option value="12" selected data-i18n="trends_1y">${window.i18n.t('trends_1y')}</option>
                    </select>
                    
                    <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);margin-left:10px;cursor:pointer;">
                        <input type="checkbox" id="trendsOtherYearsCheck" onchange="window.TrendsView.onOtherYearsChange(this.checked)">
                        <span data-i18n="trends_other_years">${window.i18n.t('trends_other_years')}</span>
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--text-muted);margin-left:10px;cursor:pointer;">
                        <input type="checkbox" id="trendsOtherMonthsCheck" onchange="window.TrendsView.onOtherMonthsChange(this.checked)">
                        <span data-i18n="trends_other_months">${window.i18n.t('trends_other_months')}</span>
                    </label>
                </div>
            </div>

            <!-- Chart -->
            <div style="background:var(--bg-body);border:1px solid var(--border-color);border-radius:12px;padding:24px;margin-bottom:24px;">
                <canvas id="trendsChart" height="120"></canvas>
            </div>
        </div>`;
    },

    async init() {
        await this.loadAccounts();
    },

    async loadAccounts() {
        try {
            this.accounts = await API.get('/api/stats/accounts');
            const mainAcc = await API.get('/api/stats/main_account');

            const sel = document.getElementById('trendsAccountSelect');
            let options = `<option value="total" style="font-weight:bold;" data-i18n="trends_opt_total">${window.i18n.t('trends_opt_total')}</option>`;
            options += this.accounts.map(a =>
                `<option value="${a.id}">${a.name}</option>`
            ).join('');
            sel.innerHTML = options;

            // Default to main account, like in Simulator
            if (mainAcc && mainAcc.id) {
                this.selectedAccountId = mainAcc.id.toString();
                sel.value = this.selectedAccountId;
            } else if (this.accounts.length > 0) {
                this.selectedAccountId = this.accounts[0].id.toString();
                sel.value = this.selectedAccountId;
            } else {
                this.selectedAccountId = "total";
            }

            await this.loadData();
        } catch(e) {
            console.error('TrendsView loadAccounts:', e);
        }
    },

    async onAccountChange(accountId) {
        this.selectedAccountId = accountId;
        await this.loadData();
    },
    
    onTimeframeChange(months) {
        this.timeframeMonths = parseInt(months);
        this.renderChart();
    },
    
    onOtherYearsChange(checked) {
        this.showOtherYears = checked;
        if (checked) {
            this.showOtherMonths = false;
            document.getElementById('trendsOtherMonthsCheck').checked = false;
        }
        this.renderChart();
    },

    onOtherMonthsChange(checked) {
        this.showOtherMonths = checked;
        if (checked) {
            this.showOtherYears = false;
            document.getElementById('trendsOtherYearsCheck').checked = false;
        }
        this.renderChart();
    },

    async loadData() {
        if (!this.selectedAccountId) return;
        try {
            const data = await API.get(`/api/stats/trends/${this.selectedAccountId}`);
            this.historyData = data.history || [];
            this.renderChart();
        } catch(e) {
            console.error('TrendsView data:', e);
        }
    },

    renderChart() {
        const ctx = document.getElementById('trendsChart');
        if (!ctx) return;

        if (this.chart) {
            this.chart.destroy();
        }

        if (this.historyData.length === 0) {
            // Render empty chart
            this.chart = new Chart(ctx, { type: 'line', data: { labels: [], datasets: [] } });
            return;
        }

        const today = new Date();
        const datasets = [];
        let labels = [];

        // Colors for other years
        const colors = [
            'rgba(51, 102, 255, 1)',   // Current year (Primary blue)
            'rgba(156, 163, 175, 0.6)',// -1 year (Gray)
            'rgba(245, 158, 11, 0.6)', // -2 years (Amber)
            'rgba(16, 185, 129, 0.6)', // -3 years (Emerald)
            'rgba(139, 92, 246, 0.6)'  // -4 years (Purple)
        ];

        if (!this.showOtherYears && !this.showOtherMonths) {
            // Single continuous line for the selected timeframe
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - this.timeframeMonths);
            
            const filteredData = this.historyData.filter(d => new Date(d.date) >= startDate);
            
            labels = filteredData.map(d => {
                const dt = new Date(d.date);
                return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
            });
            
            datasets.push({
                label: window.i18n.t('chart_label_balance'),
                data: filteredData.map(d => d.balance),
                borderColor: colors[0],
                backgroundColor: 'rgba(51, 102, 255, 0.1)',
                borderWidth: 2,
                pointRadius: 0,
                pointHitRadius: 10,
                fill: true,
                tension: 0.1
            });
        } else {
            // Superimpose other years
            // We create slices of timeframeMonths for each year backwards from today
            
            // First, determine how many days are in the timeframe to align the X axis
            const startDate = new Date();
            startDate.setMonth(startDate.getMonth() - this.timeframeMonths);
            const daysInTimeframe = Math.round((today - startDate) / (1000 * 60 * 60 * 24));
            
            // Generate generic labels based on the current period
            for (let i = 0; i <= daysInTimeframe; i++) {
                const d = new Date(startDate);
                d.setDate(d.getDate() + i);
                labels.push(d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }));
            }
            
            let offset = 0;
            let dataAvailable = true;
            
            // Look back until we run out of data
            const firstDateInData = new Date(this.historyData[0].date);
            
            while (dataAvailable && offset < colors.length) {
                const periodEnd = new Date(today);
                const periodStart = new Date(startDate);
                
                if (this.showOtherYears) {
                    periodEnd.setFullYear(periodEnd.getFullYear() - offset);
                    periodStart.setFullYear(periodStart.getFullYear() - offset);
                } else if (this.showOtherMonths) {
                    periodEnd.setMonth(periodEnd.getMonth() - offset);
                    periodStart.setMonth(periodStart.getMonth() - offset);
                }
                
                // Stop if this period is entirely before our first data point
                if (periodEnd < firstDateInData && offset > 0) {
                    dataAvailable = false;
                    break;
                }
                
                // Collect data for this period
                const periodData = [];
                for (let i = 0; i <= daysInTimeframe; i++) {
                    const targetDate = new Date(periodStart);
                    targetDate.setDate(targetDate.getDate() + i);
                    const dateStr = targetDate.toISOString().split('T')[0];
                    
                    // Find the exact date or the closest previous date
                    let closestBalance = null;
                    // Because historyData has a point for every day, we can just look it up.
                    // If not found, it means it's before the first transaction, so balance is null or initial.
                    const point = this.historyData.find(d => d.date === dateStr);
                    if (point) {
                        closestBalance = point.balance;
                    } else if (targetDate > firstDateInData) {
                        // If it's a date we should have but don't (e.g. gaps), find the most recent
                        const previousPoints = this.historyData.filter(d => d.date < dateStr);
                        if (previousPoints.length > 0) {
                            closestBalance = previousPoints[previousPoints.length - 1].balance;
                        }
                    }
                    
                    periodData.push(closestBalance);
                }
                
                // Check if the entire array is null
                if (periodData.some(val => val !== null)) {
                    let label = offset === 0 ? window.i18n.t('chart_current_period') : (this.showOtherYears ? window.i18n.tp('chart_years_ago', {offset}) : window.i18n.tp('chart_months_ago', {offset}));
                    datasets.push({
                        label: label,
                        data: periodData,
                        borderColor: colors[offset],
                        borderWidth: offset === 0 ? 2.5 : 1.5,
                        borderDash: offset === 0 ? [] : [5, 5],
                        pointRadius: 0,
                        pointHitRadius: 10,
                        fill: false,
                        tension: 0.1
                    });
                } else {
                    dataAvailable = false;
                }
                
                offset++;
            }
        }

        const textColor = getComputedStyle(document.body).getPropertyValue('--text-muted').trim() || '#9ca3af';
        const mainTextColor = getComputedStyle(document.body).getPropertyValue('--text-main').trim() || '#f3f4f6';

        this.chart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets
            },
            options: {
                responsive: true,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        display: this.showOtherYears || this.showOtherMonths,
                        position: 'top',
                        labels: { color: mainTextColor }
                    },
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.dataset.label} : ${ctx.parsed.y.toLocaleString('fr-FR', {style:'currency',currency:'EUR'})}`
                        }
                    }
                },
                scales: {
                    y: {
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: {
                            color: textColor,
                            callback: (v) => v.toLocaleString('fr-FR', {style:'currency',currency:'EUR',maximumFractionDigits:0})
                        }
                    },
                    x: {
                        grid: { display: false },
                        ticks: {
                            color: textColor,
                            maxTicksLimit: 15
                        }
                    }
                }
            }
        });
    }
};
