// static/js/app/sidebar.js
// Gestion de la barre latérale : comptes, navigation, salaires & prévisions, dépassements, budgets résumés

window.AppModules = window.AppModules || {};

window.AppModules.sidebar = {
    updateNavToggles() {
        const isAiEnabled = Boolean(this.config && (this.config.enable_ai === 'true' || this.config.enable_ai === true));
        document.querySelectorAll('.nav-btn[data-view="chat"]').forEach(btn => {
            btn.style.display = isAiEnabled ? '' : 'none';
            btn.classList.toggle('is-hidden', !isAiEnabled);
        });

        const isOverviewEnabled = Boolean(this.config && (this.config.enable_overview === 'true' || this.config.enable_overview === true));
        document.querySelectorAll('.nav-btn[data-view="overview"]').forEach(btn => {
            btn.style.display = isOverviewEnabled ? '' : 'none';
            btn.classList.toggle('is-hidden', !isOverviewEnabled);
        });

        const isSimEnabled = !this.config || (this.config.enable_simulator !== 'false' && this.config.enable_simulator !== false);
        document.querySelectorAll('.nav-btn[data-view="simulator"]').forEach(btn => {
            btn.style.display = isSimEnabled ? '' : 'none';
            btn.classList.toggle('is-hidden', !isSimEnabled);
        });
    },

    showUnreconciledBeforePay() {
        if (!window.app.nextPayDate) return;
        
        if (window.TimelineView) {
            window.TimelineView.pendingFilter = {
                unreconciledBeforeDate: window.app.nextPayDate
            };
        }
        this.loadView('dashboard');
    },

    toggleSidebarAccountMode(direction = 1) {
        this.sidebarAccountMode = this.sidebarAccountMode === 'loans' ? 'liquid' : 'loans';
        localStorage.setItem('omnibank_sidebar_acc_mode', this.sidebarAccountMode);
        this.renderSidebarAccounts();
    },

    renderSidebarAccounts() {
        const accounts = this.accounts || [];
        const stats = this.dashboardStats || {};
        const list = document.getElementById('accountsList');
        if (!list) return;
        list.innerHTML = '';

        const activeAccounts = accounts.filter(a => !a.is_closed);
        const liquidAccounts = activeAccounts.filter(a => !a.is_loan);
        const loanAccounts = activeAccounts.filter(a => !a.is_loan);

        const nav = document.getElementById('sidebarAccountsNav');
        const badge = document.getElementById('sidebarAccModeBadge');
        const iconEl = document.getElementById('sidebarAccountsIcon');
        const labelEl = document.getElementById('sidebarAccountsLabel');
        const totalLabel = document.getElementById('sidebarTotalLabel');
        const totalVal = document.getElementById('valNetWorth');

        if (!this.sidebarAccountMode) {
            this.sidebarAccountMode = localStorage.getItem('omnibank_sidebar_acc_mode') || 'liquid';
        }

        if (loanAccounts.length > 0) {
            if (nav) nav.style.display = 'flex';
        } else {
            if (nav) nav.style.display = 'none';
            this.sidebarAccountMode = 'liquid';
        }

        if (this.sidebarAccountMode === 'loans' && loanAccounts.length > 0) {
            if (badge) badge.textContent = '2/2';
            if (iconEl) iconEl.textContent = '📑';
            if (labelEl) labelEl.textContent = window.i18n ? (window.i18n.t('sidebar_loans') || 'Prêts & Emprunts') : 'Prêts & Emprunts';
            if (totalLabel) totalLabel.textContent = window.i18n ? (window.i18n.t('sidebar_total_loans') || 'Capital restant dû') : 'Capital restant dû';

            loanAccounts.forEach(acc => {
                const div = document.createElement('div');
                div.className = 'account-item';
                const crd = Math.abs(acc.balance || 0);
                const rateBadge = acc.interest_rate ? ` <span style="font-size:10px; color:var(--text-muted); font-weight:normal;">(${acc.interest_rate}%)</span>` : '';
                div.innerHTML = `<span>${acc.name}${rateBadge}</span><strong style="color: #ef4444;" class="privacy-blur">${formatCurrency(crd, acc.currency || 'EUR')}</strong>`;
                list.appendChild(div);
            });

            const totalCRD = stats.loan_total !== undefined ? stats.loan_total : loanAccounts.reduce((sum, a) => sum + Math.abs(a.balance || 0), 0);
            if (totalVal) {
                totalVal.textContent = formatCurrency(totalCRD);
                totalVal.style.color = '#ef4444';
            }
        } else {
            if (badge) badge.textContent = loanAccounts.length > 0 ? '1/2' : '1/1';
            if (iconEl) iconEl.textContent = '🏦';
            if (labelEl) labelEl.textContent = window.i18n ? (window.i18n.t('sidebar_accounts') || 'Comptes & Livrets') : 'Comptes & Livrets';
            if (totalLabel) totalLabel.textContent = window.i18n ? (window.i18n.t('sidebar_total_liquid') || 'Trésorerie & Épargne') : 'Trésorerie & Épargne';

            liquidAccounts.forEach(acc => {
                const div = document.createElement('div');
                div.className = 'account-item';
                div.innerHTML = `<span>${acc.name}</span><strong class="privacy-blur">${formatCurrency(acc.balance, acc.currency || 'EUR')}</strong>`;
                list.appendChild(div);
            });

            const liquidTotal = stats.liquid_net_worth !== undefined ? stats.liquid_net_worth : liquidAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
            if (totalVal) {
                totalVal.textContent = formatCurrency(liquidTotal);
                totalVal.style.color = liquidTotal >= 0 ? '#10b981' : '#ef4444';
            }
        }
    },

    async refreshSidebar() {
        try {
            // PERF: Fetch accounts and dashboard stats in parallel
            const [accounts, stats] = await Promise.all([
                API.get('/api/stats/accounts'),
                API.get('/api/stats/dashboard')
            ]);
            this.accounts = accounts;
            this.dashboardStats = stats;
            
            this.renderSidebarAccounts();

            this.isPayValidated = stats.is_pay_validated;
            this.validatedPayDate = stats.validated_pay_date;
            
            const valRestToLive = document.getElementById('valRestToLive');
            valRestToLive.textContent = formatCurrency(stats.rest_to_live);
            
            // Color-code Rest to Live based on savings consumption
            if (stats.savings_overflow) {
                if (stats.savings_overflow.fully_consumed) {
                    valRestToLive.style.color = '#ef4444'; // Red: overdraft warning
                } else {
                    valRestToLive.style.color = '#f59e0b'; // Orange: consuming savings
                }
            } else {
                valRestToLive.style.color = ''; // Default green
            }

            const valRestToLiveSub = document.getElementById('valRestToLiveSub');
            if (valRestToLiveSub) {
                const inc = stats.unreconciled_income || 0;
                if (inc > 0) {
                    valRestToLiveSub.style.display = 'block';
                    valRestToLiveSub.style.color = '#10b981';
                    const ravWithInc = (stats.rest_to_live_with_income !== undefined) ? stats.rest_to_live_with_income : (stats.rest_to_live + inc);
                    const subText = window.i18n.tp ? window.i18n.tp('overview_rav_planned_income', { income: formatCurrency(inc), total: formatCurrency(ravWithInc) }) : `+${formatCurrency(inc)} prévus (→ ${formatCurrency(ravWithInc)})`;
                    valRestToLiveSub.textContent = subText;
                    const tooltip = window.i18n.tp ? window.i18n.tp('overview_rav_planned_income_tooltip', { income: formatCurrency(inc), total: formatCurrency(ravWithInc) }) : `Reste à vivre avec encaissement des recettes prévues (+${formatCurrency(inc)}) : ${formatCurrency(ravWithInc)}`;
                    valRestToLiveSub.title = tooltip;
                } else {
                    valRestToLiveSub.style.display = 'none';
                    valRestToLiveSub.textContent = '';
                }
            }
            
            // Load base config early to check Org Mode
            const configs = window.app.config || await API.get('/api/config/');
            const isOrgMode = configs.enable_org_mode === 'true' || configs.enable_org_mode === true;

            // Unreconciled expenses box
            const valUnreconciled = document.getElementById('valUnreconciled');
            const valPlannedExpenses = document.getElementById('valPlannedExpenses');
            if (valUnreconciled && !isOrgMode) {
                valUnreconciled.textContent = formatCurrency(stats.unreconciled_expenses || 0);
                document.getElementById('unreconciledBox').style.display = 'flex';
                if (document.getElementById('plannedExpensesBox')) document.getElementById('plannedExpensesBox').style.display = 'none';
            } else if (isOrgMode) {
                document.getElementById('unreconciledBox').style.display = 'none';
                if (valPlannedExpenses) {
                    valPlannedExpenses.textContent = formatCurrency(stats.total_unreconciled_expenses || 0);
                    document.getElementById('plannedExpensesBox').style.display = 'flex';
                }
            } else if (valUnreconciled) {
                document.getElementById('unreconciledBox').style.display = 'none';
                if (document.getElementById('plannedExpensesBox')) document.getElementById('plannedExpensesBox').style.display = 'none';
            }
            
            // Next Paycheck UI
            const payAmtSpan = document.getElementById('valNextPayAmount');
            const payDateDiv = document.getElementById('valNextPayDate');
            const nextPayBox = document.getElementById('nextPayBox');
            if (stats.next_pay_date && !isOrgMode) {
                if (nextPayBox) nextPayBox.style.display = '';
                payAmtSpan.textContent = formatCurrency(stats.next_pay_amount);
                
                const isManualSkip = stats.is_pay_validated;
                payDateDiv.textContent = formatDate(stats.next_pay_date) + (stats.is_pay_override ? ' ' + window.i18n.t('msg_manual') : '');
                
                const btnSkip = document.getElementById('btnSkipPayPeriod');
                if (btnSkip) {
                    if (isManualSkip) {
                        btnSkip.textContent = '⏪';
                        btnSkip.setAttribute('data-i18n-title', 'tooltip_cancel_skip_pay_period');
                        btnSkip.setAttribute('title', window.i18n.t('tooltip_cancel_skip_pay_period') || 'Cancel skip to next period');
                    } else {
                        btnSkip.textContent = '⏭️';
                        btnSkip.setAttribute('data-i18n-title', 'tooltip_skip_pay_period');
                        btnSkip.setAttribute('title', window.i18n.t('tooltip_skip_pay_period') || 'Skip to next period');
                    }
                }
                
                // Store globally for timeline filtering and history modal
                window.app.nextPayDate = stats.next_pay_date;
                window.app.nextPayAmount = stats.next_pay_amount;
                window.app.payHistory = stats.pay_history || [];
                
                // Pre-fill modal
                document.getElementById('overridePayDate').value = stats.next_pay_date;
                document.getElementById('overridePayAmount').value = stats.next_pay_amount;
            } else if (nextPayBox) {
                nextPayBox.style.display = 'none';
            }
            
            // Rest to Live label
            const restLabel = document.getElementById('restToLiveLabel');
            if (restLabel) {
                if (isOrgMode) {
                    restLabel.textContent = window.i18n.t('stat_can_spend');
                    restLabel.removeAttribute('data-i18n'); // prevent i18n from overriding
                } else {
                    restLabel.textContent = window.i18n.t('stat_rest_to_live');
                    restLabel.setAttribute('data-i18n', 'stat_rest_to_live');
                }
            }
            
            // Budget Summary — multiple bars per period type
            const barsContainer = document.getElementById('sidebarBudgetBars');
            if (barsContainer) {
                const summary = stats.budget_summary || {};
                const periodLabels = {
                    'monthly': window.i18n.t('stat_budgets_monthly') || '🎯 Budgets (Mensuel)',
                    'yearly': window.i18n.t('stat_budgets_yearly') || '🎯 Budgets (Annuel)',
                    'indefinite': window.i18n.t('stat_budgets_indefinite') || '🎯 Budgets (Indéfini)',
                    'custom': window.i18n.t('stat_budgets_custom') || '🎯 Budgets (Défini)'
                };
                const orderedPeriods = ['monthly', 'yearly', 'indefinite', 'custom'];
                let barsHtml = '';

                // Helper: render a single sidebar budget bar
                const renderBar = (label, targetVal, recSpent, totalSpent, accentColor, indent, period, accKey) => {
                    const totalPct = targetVal > 0 ? Math.min((totalSpent / targetVal) * 100, 100) : 0;
                    const recPct = targetVal > 0 ? Math.min((recSpent / targetVal) * 100, 100) : 0;
                    const over = targetVal > 0 && recSpent > targetVal;
                    const color = over ? '#ff5630' : recPct >= 80 ? '#f59e0b' : '#10b981';
                    
                    const periodColors = {
                        'monthly': '#3b82f6',
                        'yearly': '#8b5cf6',
                        'indefinite': '#14b8a6',
                        'custom': '#ec4899'
                    };
                    const pColor = periodColors[period] || '#3b82f6';
                    const borderLeftColor = accentColor || pColor;
                    const borderLeft = `border-left:3px solid ${borderLeftColor};`;
                    const marginLeft = indent ? 'margin-left:8px;' : '';
                    const clickAction = `window.app.scrollToBudgetSection('${period}', '${accKey || '__global__'}')`;

                    return `
                    <div class="stat-box" style="display:block; border-color:${pColor}66; background-color:${pColor}1a; cursor:pointer; margin-bottom:6px; ${borderLeft}${marginLeft}" onclick="${clickAction}">
                        <span class="stat-label" style="color:${pColor}; font-weight:600;">${label}</span>
                        <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:6px;overflow:hidden;margin:8px 0;border:1px solid rgba(255,255,255,0.05);">
                            <div style="position:absolute;top:0;left:0;width:${totalPct}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;transition:width 0.3s;"></div>
                            <div style="position:absolute;top:0;left:0;width:${recPct}%;height:100%;background:${color};border-radius:999px;transition:width 0.3s;"></div>
                        </div>
                        <div style="display:flex; justify-content:space-between; font-size:12px;">
                            <span class="privacy-blur" style="color:${color}; font-weight:600;">${formatCurrency(recSpent)}</span>
                            <span class="privacy-blur" style="color:var(--text-muted);">/ ${formatCurrency(targetVal)}</span>
                        </div>
                    </div>`;
                };

                for (const period of orderedPeriods) {
                    const data = summary[period];
                    if (!data) continue;

                    const accountSubs = data.accounts || {};
                    const subKeys = Object.keys(accountSubs);
                    const hasAccountScope = subKeys.some(k => k !== '__global__');

                    if (hasAccountScope) {
                        // Period header (no bar, just label) — only if multiple sub-groups
                        if (subKeys.length > 1) {
                            barsHtml += `<div style="margin-bottom:2px;">
                                <span class="stat-label" style="color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.03em;">${periodLabels[period] || period}</span>
                            </div>`;
                        }
                        // One bar per account sub-group
                        for (const [key, sub] of Object.entries(accountSubs)) {
                            const accent = sub.accent_color || null;
                            let subLabel;
                            if (key === '__global__') {
                                subLabel = window.i18n.t('budget_account_all') || 'Global';
                            } else {
                                // Build colorized account names with dots
                                const names = sub.account_names || [];
                                const periodSuffix = subKeys.length <= 1 ? ` <span style="font-size:10px;color:var(--text-muted);font-weight:normal;">(${(periodLabels[period] || period).replace(/🎯\s*/, '')})</span>` : '';
                                if (accent && names.length > 0) {
                                    subLabel = names.map(n => `<span style="color:${accent};">● </span>${n}`).join(' + ') + periodSuffix;
                                } else {
                                    subLabel = (names.join(' + ') || key) + periodSuffix;
                                }
                            }
                            barsHtml += renderBar(subLabel, sub.target, sub.reconciled_expenses, sub.expenses, accent, subKeys.length > 1, period, key);
                        }
                    } else {
                        // Single bar for the whole period (original behavior)
                        barsHtml += renderBar(periodLabels[period] || period, data.target, data.reconciled_expenses, data.expenses, null, false, period, '__global__');
                    }
                }

                barsContainer.innerHTML = barsHtml;

                // ── Savings (Tirelire) sidebar bars ──
                const savingsDetails = stats.savings_details || [];
                const overflow = stats.savings_overflow;
                if (savingsDetails && savingsDetails.length > 0) {
                    let savingsHtml = `<div style="margin-top:12px; margin-bottom:4px;">
                        <span class="stat-label" style="color:var(--text-muted); font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.03em;">🏦 ${window.i18n.t('budget_savings_summary')}</span>
                    </div>`;
                    
                    savingsDetails.forEach(sav => {
                        if (sav.is_closed) return;
                        const balance = sav.balance || 0;
                        const goal = sav.goal || 0;
                        
                        // Calculate temporary withdrawal
                        let tempWithdrawn = 0;
                        if (overflow && overflow.total_savings > 0) {
                            // Proportional share of the overflow
                            const proportion = balance / overflow.total_savings;
                            tempWithdrawn = Math.min(balance, overflow.overflow_amount * proportion);
                        }
                        
                        const effectiveBalance = balance - tempWithdrawn;
                        const pct = goal > 0 ? Math.min((effectiveBalance / goal) * 100, 100) : 0;
                        const theoreticalPct = goal > 0 ? Math.min((balance / goal) * 100, 100) : 0;
                        
                        const goalReached = balance >= goal && goal > 0;
                        const savColor = goalReached ? '#f59e0b' : '#10b981';

                        savingsHtml += `
                        <div class="stat-box" data-sidebar-budget-id="${sav.id}" style="display:block; border-color:#f59e0b66; background-color:#f59e0b1a; cursor:pointer; margin-bottom:6px; border-left:3px solid #f59e0b;" onclick="window.app.scrollToBudget(${sav.id}, 'budgets')">
                            <div style="display:flex; justify-content:space-between; align-items:center;">
                                <span class="stat-label" style="color:#f59e0b; font-weight:600;">${sav.name}</span>
                                ${tempWithdrawn > 0 ? `<span style="color:#ef4444; font-size:11px; font-weight:600; background:rgba(239,68,68,0.1); padding:1px 4px; border-radius:4px;" title="${window.i18n.t('savings_temp_withdrawn') || 'Provisoirement retiré'}">-${formatCurrency(tempWithdrawn)}</span>` : ''}
                            </div>
                            <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:6px;overflow:hidden;margin:8px 0;border:1px solid rgba(255,255,255,0.05);">
                                <!-- Ghost (theoretical) fill -->
                                ${tempWithdrawn > 0 ? `<div style="position:absolute;top:0;left:0;width:${theoreticalPct}%;height:100%;background:${savColor};opacity:0.25;border-radius:999px;"></div>` : ''}
                                <!-- Actual (effective) fill -->
                                <div style="position:absolute;top:0;left:0;width:${pct}%;height:100%;background:${savColor};border-radius:999px;transition:width 0.3s;"></div>
                            </div>
                            <div style="display:flex; justify-content:space-between; font-size:12px;">
                                <span class="privacy-blur" style="color:${savColor}; font-weight:600;">${formatCurrency(effectiveBalance)}</span>
                                <span class="privacy-blur" style="color:var(--text-muted);">/ ${formatCurrency(goal)}</span>
                            </div>
                        </div>`;
                    });
                    barsContainer.innerHTML += savingsHtml;
                }
            }

            
            const quickSettingsBox = document.getElementById('quickSettingsBox');
            if (quickSettingsBox) quickSettingsBox.style.display = isOrgMode ? 'none' : 'block';
            
            const bimonthlyOpt = document.getElementById('quickPayOptBimonthly');
            const typeContainer = document.getElementById('quickPayTypeContainer');
            if (configs.enable_bimonthly === 'true' || configs.enable_bimonthly === true) {
                bimonthlyOpt.hidden = false;
                bimonthlyOpt.disabled = false;
                typeContainer.style.display = 'flex';
            } else {
                bimonthlyOpt.hidden = true;
                bimonthlyOpt.disabled = true;
                typeContainer.style.display = 'none';
                if (document.getElementById('quickPayType').value === 'bimonthly') {
                    document.getElementById('quickPayType').value = 'monthly';
                }
            }
            
            if (configs.base_pay_type) document.getElementById('quickPayType').value = configs.base_pay_type;
            if (configs.base_pay_day) document.getElementById('quickPayDay').value = configs.base_pay_day;
            if (configs.base_pay_day_2) document.getElementById('quickPayDay2').value = configs.base_pay_day_2;
            
            // Populate income categories in settings select
            try {
                const categories = await API.get('/api/categories/');
                const incomeCats = categories.filter(c => c.type === 'income');
                const catSelect = document.getElementById('quickPayCategory');
                if (catSelect) {
                    const currentSelVal = configs.pay_category || '';
                    let html = `<option value="" data-i18n="opt_any_category">${window.i18n.t('opt_any_category') || '-- Toutes --'}</option>`;
                    incomeCats.forEach(c => {
                        html += `<option value="${c.name}">${c.name}</option>`;
                    });
                    catSelect.innerHTML = html;
                    catSelect.value = currentSelVal;
                }
            } catch (e) {
                console.error("Failed to load categories for quick pay config", e);
            }

            if (configs.pay_threshold_percent) {
                document.getElementById('quickPayThreshold').value = configs.pay_threshold_percent;
            } else {
                document.getElementById('quickPayThreshold').value = '30';
            }
            
            this.onQuickPayTypeChange(false);
            
            const overdraftBox = document.getElementById('overdraftBox');
            if (stats.overdraft_warning) {
                overdraftBox.style.display = 'block';
                const od = stats.overdraft_warning;
                document.getElementById('valOverdraft').textContent = formatCurrency(od.projected_balance);
                
                let dateSub = `${formatDate(od.date)} (${od.transaction_description})`;
                if (od.covered_by_income) {
                    const incAmt = od.planned_income_before_risk || od.planned_income_total || 0;
                    const covLabel = window.i18n.tp ? window.i18n.tp('overview_overdraft_covered_sub', { income: formatCurrency(incAmt) }) : `Couvert (+${formatCurrency(incAmt)})`;
                    dateSub += ` • <span style="color: #10b981; font-weight: 700;">✅ ${covLabel}</span>`;
                }
                document.getElementById('valOverdraftDate').innerHTML = dateSub;
                
                let expText = '';
                if (od.covered_by_income) {
                    const incAmt = od.planned_income_before_risk || od.planned_income_total || 0;
                    expText = window.i18n.tp ? window.i18n.tp('msg_overdraft_covered_by_income', { date: formatDate(od.date), amount: formatCurrency(od.projected_balance), income: formatCurrency(incAmt) }) : `Si aucune recette avant le ${formatDate(od.date)}, risque de découvert (${formatCurrency(od.projected_balance)}). Les recettes prévues (+${formatCurrency(incAmt)}) permettent toutefois d'absorber ce risque.`;
                } else if (od.projected_balance_with_income !== undefined && od.projected_balance_with_income > od.projected_balance) {
                    const incAmt = od.planned_income_total || 0;
                    expText = window.i18n.tp ? window.i18n.tp('msg_overdraft_reduced_by_income', { date: formatDate(od.date), amount: formatCurrency(od.projected_balance), income: formatCurrency(incAmt), reduced_amount: formatCurrency(od.projected_balance_with_income) }) : `Si aucune recette avant le ${formatDate(od.date)}, risque de découvert (${formatCurrency(od.projected_balance)}). Avec les recettes prévues (+${formatCurrency(incAmt)}), le découvert est réduit à ${formatCurrency(od.projected_balance_with_income)}.`;
                } else {
                    expText = window.i18n.t('msg_overdraft_explanation') ? window.i18n.tp('msg_overdraft_explanation', {date: formatDate(od.date)}) : `If no income by ${formatDate(od.date)}, risk of overdraft caused by this transaction.`;
                }
                document.getElementById('valOverdraftExplanation').textContent = expText;
                
                const btnLocate = document.getElementById('btnLocateOverdraft');
                if (btnLocate) {
                    btnLocate.onclick = () => {
                        const txId = stats.overdraft_warning.transaction_id;
                        // Set pending highlight for AllOperationsView to pick up after data load
                        if (window.AllOperationsView) {
                            window.AllOperationsView._pendingHighlightTxId = txId;
                            window.AllOperationsView._pendingHighlightCssClass = 'overdraft-flash';
                        }
                        window.app.loadView('all_operations');
                    };
                }
            } else {
                overdraftBox.style.display = 'none';
            }
        } catch (e) {
            console.error("Error refreshing sidebar", e);
        }
    },
    
    showPayOverrideModal() {
        const dateInput = document.getElementById('overridePayDate');
        const amountInput = document.getElementById('overridePayAmount');
        
        // Initialize with currently predicted date and amount if available
        if (this.nextPayDate) {
            const d = new Date(this.nextPayDate);
            dateInput.value = this.nextPayDate;
            
            // Set scope +/- 45 days from predicted date
            const minDate = new Date(d);
            minDate.setDate(d.getDate() - 45);
            const maxDate = new Date(d);
            maxDate.setDate(d.getDate() + 45);
            
            const pad = n => n < 10 ? '0'+n : n;
            dateInput.min = `${minDate.getFullYear()}-${pad(minDate.getMonth()+1)}-${pad(minDate.getDate())}`;
            dateInput.max = `${maxDate.getFullYear()}-${pad(maxDate.getMonth()+1)}-${pad(maxDate.getDate())}`;
        }
        
        if (this.nextPayAmount) {
            amountInput.value = this.nextPayAmount;
        }
        
        document.getElementById('payOverrideModal').style.display = 'flex';
    },
    
    showPayHistoryModal() {
        const tbody = document.getElementById('payHistoryTableBody');
        tbody.innerHTML = '';
        
        if (!this.payHistory || this.payHistory.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 15px; color: var(--text-muted);">${window.i18n.t('msg_no_history')}</td></tr>`;
        } else {
            this.payHistory.forEach(tx => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = "1px solid var(--border-color)";
                if (tx.is_placeholder) {
                    const defineLabel = window.i18n.t('btn_define_salary') || 'Définir';
                    const parts = tx.logical_period.split('-');
                    const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1);
                    const formattedMonth = dateObj.toLocaleDateString(window.i18n.lang || 'fr', { month: 'long', year: 'numeric' });
                    const capitalizedMonth = formattedMonth.charAt(0).toUpperCase() + formattedMonth.slice(1);
                    
                    tr.innerHTML = `
                        <td style="padding: 8px; color: var(--text-muted); font-weight: 500;">${capitalizedMonth}</td>
                        <td style="padding: 8px; color: var(--text-muted); font-style: italic;">${window.i18n.t('msg_no_salary_detected') || 'Aucune paie détectée'}</td>
                        <td style="padding: 8px; text-align: right; color: var(--text-muted); font-weight: bold;">-</td>
                        <td style="padding: 8px; text-align: center;">
                            <button onclick="window.app.triggerSelectPaycheck('${tx.logical_period}')" title="${defineLabel}" style="cursor:pointer; background:var(--accent); border:none; color:white; border-radius:4px; padding:3px 8px; font-weight:bold; font-size:11px;">
                                ➕ ${defineLabel}
                            </button>
                        </td>
                    `;
                } else if (tx.is_override) {
                    const overrideLabel = window.i18n.t('pay_history_override_label') || 'Correction Manuelle';
                    const restoreLabel = window.i18n.t('btn_restore_default') || 'Restaurer';
                    const isForced = (tx.amount === 0 && tx.description === 'Période forcée');
                    tr.innerHTML = `
                        <td style="padding: 8px;">
                            ${formatDate(tx.date)} 
                            <span style="display:inline-block; background: linear-gradient(135deg, #f59e0b, #d97706); color: #fff; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-left: 4px;">🔧 ${overrideLabel}</span>
                        </td>
                        <td style="padding: 8px; color: var(--text-muted); font-style: italic;">
                            <button onclick="window.app.deletePayOverride(${isForced})" style="cursor:pointer; font-size:11px; background:none; border:1px solid var(--border-color); color:var(--text-main); border-radius:4px; padding:3px 6px;">
                                🔄 ${restoreLabel}
                            </button>
                        </td>
                        <td style="padding: 8px; text-align: right; color: #f59e0b; font-weight: bold;">${formatCurrency(tx.amount)}</td>
                        <td style="padding: 8px; text-align: center;">-</td>
                    `;
                } else {
                    const rejectTitle = window.i18n.t('btn_reject_salary') || 'Rejeter cette paie';
                    tr.innerHTML = `
                        <td style="padding: 8px;">${formatDate(tx.date)}</td>
                        <td style="padding: 8px;"><strong>${tx.description}</strong></td>
                        <td style="padding: 8px; text-align: right; color: var(--color-income); font-weight: bold;">${formatCurrency(tx.amount)}</td>
                        <td style="padding: 8px; text-align: center; white-space: nowrap;">
                            <button class="btn-reject-pay" data-txid="${tx.id}" title="${rejectTitle}" style="cursor:pointer; background:none; border:1px solid var(--border-color); color:var(--color-expense); border-radius:4px; padding:3px 8px; font-weight:bold; transition: all 0.2s;">
                                ❌
                            </button>
                        </td>
                    `;
                }
                tbody.appendChild(tr);
            });
        }
        
        // Attach inline confirm listeners to reject buttons
        tbody.querySelectorAll('.btn-reject-pay').forEach(btn => {
            let clickedOnce = false;
            let timer = null;
            const originalContent = btn.innerHTML;
            const originalStyle = btn.style.cssText;
            
            btn.onclick = async (e) => {
                e.stopPropagation();
                const txId = btn.getAttribute('data-txid');
                if (!clickedOnce) {
                    clickedOnce = true;
                    btn.innerHTML = (window.i18n.t('btn_confirm') || 'Sûr ?');
                    btn.style.color = '#fff';
                    btn.style.background = 'var(--color-expense)';
                    btn.style.borderColor = 'var(--color-expense)';
                    btn.style.fontSize = '10px';
                    btn.style.padding = '3px 6px';
                    
                    timer = setTimeout(() => {
                        btn.innerHTML = originalContent;
                        btn.style.cssText = originalStyle;
                        clickedOnce = false;
                    }, 3000);
                } else {
                    clearTimeout(timer);
                    await window.app.executeRejectPaycheck(txId);
                }
            };
        });
        
        document.getElementById('payHistoryModal').style.display = 'flex';
    },

    async triggerSelectPaycheck(period) {
        if (!period) return;
        try {
            const data = await API.get(`/api/stats/pay_candidates?period=${period}`);
            document.getElementById('payHistoryModal').style.display = 'none';
            this.showPayCandidatesModal(data);
        } catch (e) {
            console.error("Failed to load pay candidates:", e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error') || 'Erreur de connexion');
        }
    },
    
    async executeRejectPaycheck(txId) {
        if (!txId) return;
        try {
            // Update transaction setting is_salary = false
            await API.put(`/api/transactions/${txId}?propagate=false`, { is_salary: false });
            
            // Hide modal and refresh everything
            document.getElementById('payHistoryModal').style.display = 'none';
            await this.refreshSidebar();
            if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
            
            // Fetch candidate paycheck replacements
            let candidatesData = null;
            try {
                candidatesData = await API.get(`/api/stats/pay_candidates?rejected_tx_id=${txId}`);
            } catch (err) {
                console.error("Failed to fetch pay candidates:", err);
            }

            showToast(window.i18n.t('msg_salary_rejected') || 'Opération rejetée avec succès');
            
            // Open candidates helper modal
            if (candidatesData) {
                this.showPayCandidatesModal(candidatesData);
            }
        } catch (e) {
            console.error("Failed to reject paycheck", e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error') || 'Erreur lors de la sauvegarde');
        }
    },

    showPayCandidatesModal(data) {
        const modal = document.getElementById('payCandidatesModal');
        if (!modal) return;
        
        const periodStr = data.period;
        
        const titleEl = document.getElementById('payCandidatesTitle');
        if (titleEl) {
            titleEl.textContent = `${window.i18n.t('pay_candidates_title') || 'Correction de la paie'} - ${periodStr}`;
        }
        
        const candidates = data.candidates || [];
        const tableBody = document.getElementById('payCandidatesTableBody');
        const container = document.getElementById('payCandidatesListContainer');
        const emptyMsg = document.getElementById('noPayCandidatesMsg');
        
        tableBody.innerHTML = '';
        
        if (candidates.length > 0) {
            candidates.forEach(c => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid var(--border-color)';
                
                let statusBadge = '';
                if (c.is_salary === false) {
                    const label = window.i18n.t('label_rejected') || 'Rejeté';
                    const tooltip = window.i18n.t('tooltip_rejected_candidate') || '';
                    statusBadge = ` <span title="${tooltip}" style="display: inline-block; font-size: 10px; background: rgba(156, 163, 175, 0.15); color: #9ca3af; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 5px; vertical-align: middle; cursor: help;">${label}</span>`;
                } else if (c.is_salary === true) {
                    const label = window.i18n.t('label_selected') || 'Sélectionné';
                    const tooltip = window.i18n.t('tooltip_selected_candidate') || '';
                    statusBadge = ` <span title="${tooltip}" style="display: inline-block; font-size: 10px; background: rgba(46, 204, 113, 0.15); color: #2ecc71; padding: 2px 6px; border-radius: 4px; font-weight: bold; margin-left: 5px; vertical-align: middle; cursor: help;">${label}</span>`;
                }
                
                tr.innerHTML = `
                    <td style="padding: 8px;">${formatDate(c.date)}</td>
                    <td style="padding: 8px; font-weight: bold; color: var(--text-normal);">${c.description || ''}${statusBadge}</td>
                    <td style="padding: 8px; text-align: right; font-weight: bold; color: var(--color-income);">${formatCurrency(c.amount)}</td>
                    <td style="padding: 8px; text-align: center;">
                        <button class="btn btn-primary" onclick="window.app.selectPaycheckCandidate(${c.id})" title="${window.i18n.t('btn_apply') || 'Définir comme paie'}" style="padding: 3px 8px; font-size: 12px; border-radius: 4px; background: linear-gradient(135deg, #2ecc71, #27ae60); border: none; box-shadow: 0 4px 10px rgba(46, 204, 113, 0.2); font-weight: bold; color: white;">✔️</button>
                    </td>
                `;
                tableBody.appendChild(tr);
            });
            container.style.display = 'block';
            emptyMsg.style.display = 'none';
        } else {
            container.style.display = 'none';
            emptyMsg.style.display = 'block';
        }
        
        // Configure force missed period button
        const forceBtn = document.getElementById('btnForceMissedPeriod');
        if (forceBtn) {
            let clickedOnce = false;
            let timer = null;
            const originalText = window.i18n.t('btn_force_missed') || 'Aucune paie ce mois-ci';
            const originalStyle = forceBtn.style.cssText;
            
            // Reset state initially
            forceBtn.textContent = originalText;
            forceBtn.style.cssText = originalStyle;
            
            forceBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!clickedOnce) {
                    clickedOnce = true;
                    forceBtn.textContent = '⚠️ ' + (window.i18n.t('btn_confirm_action') || 'Confirmer l\'absence ?');
                    forceBtn.style.background = 'linear-gradient(135deg, #c0392b, #962d22)';
                    
                    timer = setTimeout(() => {
                        forceBtn.textContent = originalText;
                        forceBtn.style.cssText = originalStyle;
                        clickedOnce = false;
                    }, 4000);
                } else {
                    clearTimeout(timer);
                    try {
                        await API.post(`/api/stats/validate_pay_period?action=force&period=${periodStr}`);
                        modal.style.display = 'none';
                        await this.refreshSidebar();
                        if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                            window.TimelineView.loadData();
                        }
                        showToast(window.i18n.t('msg_period_validated') || 'Période validée avec succès');
                    } catch (e) {
                        console.error("Failed to force missed period:", e);
                        showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error') || 'Erreur lors de la validation');
                    }
                    clickedOnce = false;
                }
            };
        }
        
        modal.style.display = 'flex';
    },
    
    async selectPaycheckCandidate(txId) {
        if (!txId) return;
        try {
            await API.put(`/api/transactions/${txId}?propagate=false`, { is_salary: true });
            
            document.getElementById('payCandidatesModal').style.display = 'none';
            await this.refreshSidebar();
            if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
            if (window.BudgetsView && typeof window.BudgetsView.loadStatus === 'function') {
                window.BudgetsView.loadStatus();
            }
            showToast(window.i18n.t('msg_salary_defined') || 'Nouvelle paie définie avec succès');
        } catch (e) {
            console.error("Failed to select paycheck candidate:", e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error') || 'Erreur lors de la modification');
        }
    },
    
    async savePayOverride() {
        const dateInput = document.getElementById('overridePayDate');
        const date = dateInput.value;
        const amount = parseFloat(document.getElementById('overridePayAmount').value) || 0;
        
        if (!date) return;
        
        // Ensure date is within the allowed min/max range
        const selectedDate = new Date(date);
        const minDate = new Date(dateInput.min);
        const maxDate = new Date(dateInput.max);
        
        if (selectedDate < minDate || selectedDate > maxDate) {
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_date_out_of_bounds'));
            return;
        }
        
        try {
            await API.post('/api/stats/override_paycheck', { date, amount });
            document.getElementById('payOverrideModal').style.display = 'none';
            await this.refreshSidebar();
            if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
            if (window.BudgetsView && typeof window.BudgetsView.loadStatus === 'function') {
                window.BudgetsView.loadStatus();
            }
        } catch (e) {
            console.error("Failed to save override", e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error'));
        }
    },
    
    async deletePayOverride(clearValidation = false) {
        try {
            const url = '/api/stats/override_paycheck' + (clearValidation ? '?clear_validation=true' : '');
            await API.del(url);
            document.getElementById('payOverrideModal').style.display = 'none';
            await this.refreshSidebar();
            if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
            if (window.BudgetsView && typeof window.BudgetsView.loadStatus === 'function') {
                window.BudgetsView.loadStatus();
            }
            this.showPayHistoryModal();
        } catch (e) {
            console.error("Failed to delete override", e);
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error'));
        }
    },
    
    onQuickPayTypeChange(save = false) {
        const isBimonthly = document.getElementById('quickPayType').value === 'bimonthly';
        document.getElementById('quickPayDay2').style.display = isBimonthly ? 'block' : 'none';
        document.getElementById('lblQuickPayDay1').textContent = isBimonthly ? window.i18n.t('label_pay_days') : window.i18n.t('label_pay_day');
        if (save) this.saveQuickPay();
    },
    
    async saveQuickPay() {
        const type = document.getElementById('quickPayType').value;
        const day = document.getElementById('quickPayDay').value;
        const day2 = document.getElementById('quickPayDay2').value;
        const payCat = document.getElementById('quickPayCategory').value;
        const payThreshold = document.getElementById('quickPayThreshold').value;
        
        if (!day) return;
        
        try {
            await API.post('/api/config/', { 
                base_pay_type: type,
                base_pay_day: day.toString(),
                base_pay_day_2: day2.toString(),
                pay_category: payCat,
                pay_threshold_percent: payThreshold ? payThreshold.toString() : '30'
            });
            // Update cache to prevent stale config overwriting input fields in refreshSidebar
            if (this.config) {
                this.config.base_pay_type = type;
                this.config.base_pay_day = day.toString();
                this.config.base_pay_day_2 = day2.toString();
                this.config.pay_category = payCat;
                this.config.pay_threshold_percent = payThreshold ? payThreshold.toString() : '30';
            }
            await this.refreshSidebar();
            if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
        } catch (e) {
            console.error(e);
        }
    },

    async skipPayPeriod() {
        try {
            let url = '/api/stats/validate_pay_period';
            if (this.isPayValidated) {
                url += '?action=reset';
            }
            await API.post(url);
            await this.refreshSidebar();
            if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
        } catch (e) {
            console.error("Failed to skip pay period", e);
        }
    }
};

if (window.App) {
    Object.assign(window.App.prototype, window.AppModules.sidebar);
}
