// static/js/views/budgets/budgets_modals.js
// Enveloppes Budgétaires v2 — Modals, Forms & Allocation Management

window.BudgetsView = Object.assign(window.BudgetsView || {}, {
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

    renderCatCheckboxes(selected = []) {
        const container = document.getElementById('budgetCatCheckboxes');
        if (!container) return;

        const period = document.getElementById('newBudgetPeriod')?.value || 'monthly';
        const currentEditId = parseInt(document.getElementById('budgetEditId')?.value || 0);

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

        const groups = {
            'expense_fixed': { title: window.app.getTypeLabel('expense_fixed'), cats: [] },
            'expense_var': { title: window.app.getTypeLabel('expense_var'), cats: [] },
            'income': { title: window.app.getTypeLabel('income'), cats: [] },
            'neutral': { title: window.app.getTypeLabel('neutral'), cats: [] },
            'other': { title: window.i18n.t('budget_cat_other'), cats: [] }
        };

        for (const c of (this.categories || [])) {
            if (groups[c.type]) groups[c.type].cats.push(c);
            else groups['other'].cats.push(c);
        }

        let html = '';
        const searchTerm = document.getElementById('budgetCatSearch')?.value || '';
        const cleanTerm = window.cleanStringForSearch(searchTerm);

        for (const key of ['expense_fixed', 'expense_var', 'income', 'neutral', 'other']) {
            const visibleCats = cleanTerm
                ? groups[key].cats.filter(c => window.cleanStringForSearch(c.name).includes(cleanTerm))
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
                const catAvg = this.catAverages ? this.catAverages[c.name] : null;

                if (catAvg) {
                    if (period === 'monthly' || period === 'indefinite') {
                        avgValue = catAvg.yearly_average;
                        avgLabel = window.i18n.t('budget_cat_this_month');
                    } else if (period === 'yearly') {
                        avgValue = catAvg.yearly_average * 12;
                        avgLabel = window.i18n.t('budget_cat_per_year');
                    }
                }

                const avgText = avgValue > 0 ? `<span style="font-size:10px;color:var(--text-muted);background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:4px;">~${formatCurrency(avgValue)} ${avgLabel}</span>` : '';
                const overlapText = overlap ? `<span style="font-size:10px;color:#f59e0b;background:rgba(245,158,11,0.15);padding:1px 4px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${window.i18n.t('budget_cat_used_in')}: ${overlap}">⚠️ ${overlap}</span>` : '';

                html += `
                    <label style="display:flex;align-items:center;gap:6px;font-size:12px;background:var(--bg-surface);padding:6px 8px;border-radius:6px;cursor:pointer;border:1px solid ${isSelected ? 'var(--accent)' : 'var(--border-color)'};transition:all 0.2s;">
                        <input type="checkbox" name="budgetCat" value="${c.name}" ${isSelected ? 'checked' : ''} onchange="window.BudgetsView.toggleCategorySelection(this)">
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

    onPeriodChange() {
        const period = document.getElementById('newBudgetPeriod')?.value;
        const customDates = document.getElementById('budgetCustomDates');
        if (customDates) customDates.style.display = period === 'custom' ? 'block' : 'none';
        this.renderCatCheckboxes(this.selectedCategories);
    },

    toggleType() {
        const isProject = document.getElementById('budgetTypeProject')?.checked;
        const isSavings = document.getElementById('budgetTypeSavings')?.checked;
        const catSection = document.getElementById('budgetCatSection');
        const periodRow = document.getElementById('newBudgetPeriod')?.closest('div');
        if (catSection) catSection.style.display = (isProject || isSavings) ? 'none' : 'block';
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
        document.getElementById('budgetEditId').value = budgetId;
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

            if (isSavings) {
                let allocs = [];
                try { allocs = await API.get(`/api/budgets/${budgetId}/allocations`); } catch(e) {}

                const funded = budget?.funded || 0;
                const withdrawn = budget?.withdrawn || 0;
                const balance = budget?.balance || 0;
                const goal = budget?.budget_amount || 0;

                const overflow = this.savingsOverflow;
                let tempWithdrawn = 0;
                if (overflow && overflow.total_savings > 0 && !budget?.is_closed) {
                    const proportion = balance / overflow.total_savings;
                    tempWithdrawn = Math.min(balance, overflow.overflow_amount * proportion);
                }

                const effectiveBalance = balance - tempWithdrawn;
                const pct = goal > 0 ? Math.min((effectiveBalance / goal) * 100, 100) : 0;
                const theoreticalPct = goal > 0 ? Math.min((balance / goal) * 100, 100) : 0;
                const goalReached = balance >= goal && goal > 0;
                const barColor = goalReached ? '#f59e0b' : '#10b981';

                const safeName = budgetName.replace(/'/g, "\\'");

                const hostedPerAccount = {};
                for (const a of allocs) {
                    const key = a.account_id || 'main';
                    hostedPerAccount[key] = (hostedPerAccount[key] || 0.0) + a.amount;
                }

                const accountSelectDetail = this._buildAccountSelect('detailAllocAccountId', hostedPerAccount);

                graph.innerHTML = `<div style="margin-bottom:10px;">
                    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted);margin-bottom:3px;">
                        <span>${window.i18n.t('budget_expenses')} · <span class="privacy-blur" style="font-weight:600;">${formatCurrency(goal)}</span> ${window.i18n.t('budget_savings_goal')}</span>
                        <span class="privacy-blur">
                            <span style="color:#10b981;font-weight:600;">↑ ${formatCurrency(funded)}</span> ${window.i18n.t('budget_savings_funded')}
                            ${withdrawn > 0 ? ` · <span style="color:#ff5630;font-weight:600;">↓ ${formatCurrency(withdrawn)}</span> ${window.i18n.t('budget_savings_withdrawn')}` : ''}
                        </span>
                    </div>
                    <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.05);">
                        ${tempWithdrawn > 0 ? `<div style="position:absolute;top:0;left:0;width:${theoreticalPct}%;height:100%;background:${barColor};opacity:0.25;border-radius:999px;"></div>` : ''}
                        <div style="position:absolute;top:0;left:0;width:${pct}%;height:100%;background:${barColor};border-radius:999px;transition:width 0.5s ease;"></div>
                    </div>
                    <div style="display:flex;justify-content:space-between;font-size:12px;margin-top:4px;">
                        <span class="privacy-blur" style="color:${barColor};font-weight:600;">${formatCurrency(effectiveBalance)} ${window.i18n.t('budget_savings_balance')}</span>
                        <span style="color:${goalReached ? '#f59e0b' : 'var(--text-muted)'};font-weight:600;">${goalReached ? '🎯 ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(goal - balance))}</span> ${goalReached ? window.i18n.t('budget_savings_goal_reached') : window.i18n.t('budget_savings_remaining')}</span>
                    </div>
                </div>
                <div style="display:flex;flex-direction:column;gap:10px;padding:12px;background:var(--bg-surface);border:1px solid rgba(245,158,11,0.3);border-radius:8px;margin-bottom:12px;">
                    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                        <input type="number" id="detailAllocAmount" class="inline-input" placeholder="${window.i18n.t('budget_savings_add_placeholder')}" step="0.01" style="width:110px;font-size:12px;padding:6px 10px;border-radius:6px;">
                        ${accountSelectDetail}
                        <input type="text" id="detailAllocNote" class="inline-input" placeholder="${window.i18n.t('budget_savings_note_placeholder')}" style="flex:1;min-width:140px;font-size:12px;padding:6px 10px;border-radius:6px;">
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
                        <button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocationFromDetail(${budgetId}, 1, '${safeName}', ${year}, ${month})">↑ ${window.i18n.t('budget_savings_deposit')}</button>
                        <button class="btn btn-secondary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocationFromDetail(${budgetId}, -1, '${safeName}', ${year}, ${month})">↓ ${window.i18n.t('budget_savings_withdrawal')}</button>
                    </div>
                </div>`;

                const items = [];
                for (const tx of txs) {
                    items.push({
                        type: 'tx', date: tx.date, description: tx.description, amount: tx.amount,
                        isIncome: tx.is_income, category: tx.category, isReconciled: tx.is_reconciled
                    });
                }
                for (const a of allocs) {
                    const acc = this.accounts?.find(ac => ac.id === a.account_id);
                    const accLabel = acc ? ` <span style="font-size:10px;color:var(--accent);background:var(--bg-base);padding:1px 4px;border-radius:4px;margin-left:4px;">🏦 ${acc.name}</span>` : '';
                    items.push({
                        type: 'alloc', id: a.id, date: a.date, description: (a.note || (a.amount > 0 ? window.i18n.t('budget_savings_deposit') : window.i18n.t('budget_savings_withdrawal'))) + accLabel,
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

            if (!txs.length) {
                graph.innerHTML = `<p style="color:var(--text-muted);font-size:12px;">${window.i18n.t('budget_no_operations')}</p>`;
                return;
            }

            const expenses = txs.filter(t => !t.is_income);
            const incomes  = txs.filter(t =>  t.is_income);
            const totalExp = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
            const totalRecExp = expenses.filter(t => t.is_reconciled).reduce((s, t) => s + Math.abs(t.amount), 0);
            const totalInc = incomes.reduce((s,  t) => s + Math.abs(t.amount), 0);
            const target   = budget?.budget_amount || 0;
            const maxVal   = Math.max(totalExp, totalInc, target, 1);

            const pct = target > 0 ? (totalRecExp / target) * 100 : 0;
            const recExpColor = pct > 100 ? '#ff5630' : pct >= 80 ? '#f59e0b' : '#10b981';

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
        
        const catSearch = document.getElementById('budgetCatSearch');
        if (catSearch) catSearch.value = '';
        this.selectedCategories = [];
        this.renderCatCheckboxes(this.selectedCategories);
        
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
            this.closeUnifiedModal();
        } else {
            document.getElementById('budgetFormSection').style.display = 'none';
            document.getElementById('budgetDetailSection').style.display = 'block';
        }
    },

    showEditSection() {
        this._directEdit = false;
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
        } else if ((b.envelope_type || 'spending') === 'savings') {
            document.getElementById('budgetTypeSavings').checked = true;
        } else {
            document.getElementById('budgetTypeCategory').checked = true;
        }
        this.toggleType();
        this.renderAccountCheckboxes(b.account_ids || []);
        
        const catSearch = document.getElementById('budgetCatSearch');
        if (catSearch) catSearch.value = '';
        this.selectedCategories = b.categories || [];
        this.renderCatCheckboxes(this.selectedCategories);

        document.getElementById('budgetFormSection').style.display = 'block';
        
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

        this._directEdit = true;
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
        
        const catSearch = document.getElementById('budgetCatSearch');
        if (catSearch) catSearch.value = '';
        this.selectedCategories = b.categories || [];
        this.renderCatCheckboxes(this.selectedCategories);

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
        const categories = (isProject || isSavings) ? [] : this.selectedCategories;

        if (!name) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_name_required'));
        if (isNaN(amount) || amount < 0) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_invalid_amount'));

        const startDate = period === 'custom' ? (document.getElementById('newBudgetStartDate')?.value || null) : null;
        const endDate = period === 'custom' ? (document.getElementById('newBudgetEndDate')?.value || null) : null;
        if (period === 'custom' && (!startDate || !endDate)) return showInlineMessage(window.i18n.t('title_info'), window.i18n.t('budget_custom_dates_required') || 'Please select start and end dates.');
        
        const envelope_type = isSavings ? 'savings' : 'spending';
        const account_ids = window.app?.config?.enable_org_mode === 'true' ? this.getSelectedAccounts() : null;
        const payload = { name, monthly_amount: amount, period, is_project: isProject, categories, start_date: startDate, end_date: endDate, account_ids, envelope_type };

        try {
            let savedId = id;
            let actionId = null;
            if (id) {
                const res = await API.put(`/api/budgets/${id}`, payload);
                actionId = res.action_id;
            } else {
                const res = await API.post('/api/budgets/', payload);
                savedId = res.id;
                actionId = res.action_id;
            }
            
            if (!id) this._pendingHighlightName = name;

            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();

            if (this._directEdit || !id) {
                this.closeUnifiedModal();
            } else {
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

            const toastMsg = id ? window.i18n.t('msg_envelope_updated') : window.i18n.t('msg_envelope_created');
            showUndoToast(toastMsg, actionId, () => this.loadBudgets().then(() => this.loadStatus()));
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
            const res = await API.put(`/api/budgets/${id}`, { is_closed: !b.is_closed });
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            showUndoToast(window.i18n.t('msg_envelope_updated'), res.action_id, () => this.loadBudgets().then(() => this.loadStatus()));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async deleteBudget(id) {
        if (!await showInlineConfirm(window.i18n.t('title_deletion'), window.i18n.t('confirm_delete_envelope'))) return;
        try {
            const res = await API.del(`/api/budgets/${id}`);
            await this.loadBudgets();
            await this.loadStatus();
            window.app.refreshSidebar();
            showUndoToast(window.i18n.t('msg_envelope_deleted') || 'Budget supprimé', res.action_id, () => this.loadBudgets().then(() => this.loadStatus()));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_info'), e.message);
        }
    },

    async showAllocationForm(budgetId) {
        const existing = document.getElementById('allocationInlineForm');
        if (existing) existing.remove();

        const card = document.querySelector(`[data-budget-id="${budgetId}"]`);
        if (!card) return;

        let hostedPerAccount = {};
        try {
            const allocs = await API.get(`/api/budgets/${budgetId}/allocations`);
            for (const a of allocs) {
                const key = a.account_id || 'main';
                hostedPerAccount[key] = (hostedPerAccount[key] || 0.0) + a.amount;
            }
        } catch(e) {}

        const accountSelect = this._buildAccountSelect('allocAccountId', hostedPerAccount);

        const form = document.createElement('div');
        form.id = 'allocationInlineForm';
        form.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:12px;margin-top:8px;background:var(--bg-surface);border:1px solid rgba(245,158,11,0.3);border-radius:8px;';
        form.onclick = (e) => e.stopPropagation();
        form.innerHTML = `
            <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
                <input type="number" id="allocAmount" class="inline-input" placeholder="${window.i18n.t('budget_savings_add_placeholder')}" step="0.01" style="width:110px;font-size:12px;padding:6px 10px;border-radius:6px;">
                ${accountSelect}
                <input type="text" id="allocNote" class="inline-input" placeholder="${window.i18n.t('budget_savings_note_placeholder')}" style="flex:1;min-width:140px;font-size:12px;padding:6px 10px;border-radius:6px;">
            </div>
            <div style="display:flex;gap:8px;justify-content:flex-end;align-items:center;">
                <button class="btn btn-primary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocation(${budgetId}, 1)">↑ ${window.i18n.t('budget_savings_deposit')}</button>
                <button class="btn btn-secondary" style="padding:6px 14px;font-size:12px;" onclick="window.BudgetsView.addAllocation(${budgetId}, -1)">↓ ${window.i18n.t('budget_savings_withdrawal')}</button>
                <button class="btn btn-secondary" style="padding:6px 10px;font-size:12px;" onclick="document.getElementById('allocationInlineForm')?.remove()">✕</button>
            </div>
        `;
        card.appendChild(form);
        document.getElementById('allocAmount')?.focus();
    },

    async addAllocation(budgetId, sign) {
        const amountInput = document.getElementById('allocAmount');
        const noteInput = document.getElementById('allocNote');
        const accSelect = document.getElementById('allocAccountId');
        const amount = parseFloat(amountInput?.value);
        if (isNaN(amount) || amount <= 0) return;
        const account_id = accSelect && accSelect.value ? parseInt(accSelect.value) : null;

        try {
            const res = await API.post(`/api/budgets/${budgetId}/allocations`, {
                amount: amount * sign,
                note: noteInput?.value || null,
                date: new Date().toISOString().split('T')[0],
                account_id: account_id,
            });
            document.getElementById('allocationInlineForm')?.remove();
            await this.loadStatus();
            window.app.refreshSidebar();
            const toastMsg = sign > 0 ? `↑ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_deposit').toLowerCase()}` : `↓ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_withdrawal').toLowerCase()}`;
            showUndoToast(toastMsg, res.action_id, () => this.loadStatus());
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
            const res = await API.del(`/api/budgets/${budgetId}/allocations/${allocId}`);
            await this.loadStatus();
            window.app.refreshSidebar();
            await this.showDetail(budgetId, budgetName, year, month);
            showUndoToast(window.i18n.t('msg_allocation_deleted') || 'Allocation supprimée', res.action_id, () => this.loadStatus().then(() => this.showDetail(budgetId, budgetName, year, month)));
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    async addAllocationFromDetail(budgetId, sign, budgetName, year, month) {
        const amountInput = document.getElementById('detailAllocAmount');
        const noteInput = document.getElementById('detailAllocNote');
        const accSelect = document.getElementById('detailAllocAccountId');
        const amount = parseFloat(amountInput?.value);
        if (isNaN(amount) || amount <= 0) return;
        const account_id = accSelect && accSelect.value ? parseInt(accSelect.value) : null;

        try {
            await API.post(`/api/budgets/${budgetId}/allocations`, {
                amount: amount * sign,
                note: noteInput?.value || null,
                date: new Date().toISOString().split('T')[0],
                account_id: account_id,
            });
            await this.loadStatus();
            window.app.refreshSidebar();
            showToast(sign > 0 ? `↑ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_deposit').toLowerCase()}` : `↓ ${formatCurrency(amount)} ${window.i18n.t('budget_savings_withdrawal').toLowerCase()}`, 'success');
            await this.showDetail(budgetId, budgetName, year, month);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message);
        }
    },

    showBulkDeleteModal() {
        const panel = document.getElementById('budgetBulkDeletePanel');
        if (panel) {
            panel.style.display = 'block';
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    },

    closeBulkDeleteModal() {
        const panel = document.getElementById('budgetBulkDeletePanel');
        if (panel) panel.style.display = 'none';
    },

    async confirmBulkDelete() {
        const selected = document.querySelector('input[name="bulkDeleteType"]:checked')?.value || 'spending';
        const btn = document.getElementById('btnConfirmBulkDelete');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> ${window.i18n.t('budget_bulk_delete_confirm') || 'En cours...'}`;
        }

        try {
            const res = await API.post('/api/budgets/bulk_delete', { target_type: selected });
            this.closeBulkDeleteModal();
            await this.loadBudgets();
            await this.loadAllStatuses();
            window.app.refreshSidebar();
            showInlineMessage(window.i18n.t('title_info'), `${res.deleted_count} enveloppe(s) supprimée(s).`);
        } catch(e) {
            showInlineMessage(window.i18n.t('title_error'), e.message || 'Erreur lors de la suppression.');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = window.i18n.t('budget_bulk_delete_confirm') || 'Confirmer la suppression';
            }
        }
    }
});
