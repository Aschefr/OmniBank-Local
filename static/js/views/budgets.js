// budgets.js â€” Enveloppes v2 : multi-catégories, projets, suggestions IA
window.BudgetsView = {
    budgets: [],
    categories: [],
    statusData: null,
    aiEnabled: false,

    render() {
        const cfg = window.app && window.app.config ? window.app.config : {};
        const aiDisp = cfg.enable_ai === 'true' ? '' : 'display: none !important;';

        return `
        <div>
            <div class="view-header" style="position:sticky;top:-32px;z-index:10;background:var(--bg-base);padding:32px 0 15px;margin-top:-32px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
                <h2 style="margin:0;">🎯 Budgets par Enveloppe</h2>
                <div class="history-filters" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    <input type="month" id="budgetMonth" class="inline-input" style="flex:1;min-width:140px;" onchange="window.BudgetsView.loadStatus()">
                    <button id="budgetAiBtn" class="btn btn-secondary" style="white-space:nowrap; ${aiDisp}" onclick="window.BudgetsView.requestAiSuggestions()">✨ Suggestions IA</button>
                    <button class="btn btn-primary" style="white-space:nowrap;" onclick="window.BudgetsView.showAddForm()">+ Nouvelle enveloppe</button>
                </div>
            </div>

            <!-- AI Suggestions panel -->
            <div id="budgetAiPanel" style="display:none;margin-bottom:24px;background:var(--bg-surface);border:1px solid var(--accent);border-radius:12px;padding:20px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
                    <strong style="color:var(--accent);">✨ Propositions de l'IA</strong>
                    <button class="btn btn-secondary" style="padding:3px 10px;font-size:11px;" onclick="window.BudgetsView.closeAiPanel()">✕ Fermer</button>
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
                        <h4 id="budgetUnifiedTitle" style="margin:0;font-size:16px;">Titre de la modale</h4>
                        <div style="display:flex;gap:8px;">
                            <button id="budgetUnifiedEditBtn" class="btn btn-secondary" style="display:none;padding:4px 8px;font-size:12px;" onclick="window.BudgetsView.showEditSection()">✏️ Éditer</button>
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
                                <label style="font-size:12px;color:var(--text-muted);">Nom de l'enveloppe</label>
                                <input type="text" id="newBudgetName" class="inline-input" placeholder="Ex: Courses, Vacances St Malo..." style="width:100%;margin-top:4px;">
                            </div>

                            <!-- Type toggle -->
                            <div style="display:flex;align-items:center;gap:12px;width:100%;">
                                <label style="font-size:12px;color:var(--text-muted);white-space:nowrap;">Type :</label>
                                <div style="display:flex; flex:1; background:var(--bg-base); padding:4px; border-radius:8px; border:1px solid var(--border-color);">
                                    <label id="tabLabelCat" style="flex:1; text-align:center; cursor:pointer; padding:8px 12px; font-size:13px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="category" id="budgetTypeCategory" checked onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        📁 Par catégorie(s)
                                    </label>
                                    <label id="tabLabelProj" style="flex:1; text-align:center; cursor:pointer; padding:8px 12px; font-size:13px; border-radius:6px; transition:all 0.2s;">
                                        <input type="radio" name="budgetType" value="project" id="budgetTypeProject" onchange="window.BudgetsView.toggleType()" style="display:none;">
                                        🗂️ Projet libre
                                    </label>
                                </div>
                            </div>

                            <!-- Category selector (hidden for project type) -->
                            <div id="budgetCatSection">
                                <label style="font-size:12px;color:var(--text-muted);">Catégories incluses (0 = toutes les dépenses du mois)</label>
                                <div id="budgetCatCheckboxes" style="display:block;margin-top:8px;max-height:450px;overflow-y:auto;padding:12px;background:var(--bg-base);border-radius:8px;border:1px solid var(--border-color);">
                                    <!-- Filled dynamically -->
                                </div>
                            </div>

                            <!-- Amount + period -->
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                                <div>
                                    <label style="font-size:12px;color:var(--text-muted);">Montant cible (€)</label>
                                    <input type="number" id="newBudgetAmount" class="inline-input" placeholder="0.00" style="width:100%;margin-top:4px;" min="0" step="0.01">
                                </div>
                                <div>
                                    <label style="font-size:12px;color:var(--text-muted);">Période</label>
                                    <select id="newBudgetPeriod" class="inline-input" style="width:100%;margin-top:4px;" onchange="window.BudgetsView.renderCatCheckboxes(window.BudgetsView.getSelectedCats())">
                                        <option value="monthly">Mensuel</option>
                                        <option value="yearly">Annuel</option>
                                        <option value="indefinite">Indéfini (projet long terme)</option>
                                    </select>
                                </div>
                            </div>

                            <!-- Buttons -->
                            <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px;">
                                <button class="btn btn-primary" style="flex:1;" onclick="window.BudgetsView.saveForm()">Enregistrer</button>
                                <button class="btn btn-secondary" style="flex:1;" onclick="window.BudgetsView.hideEditSection()">Annuler</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>`;
    },

    async init() {
        const now = new Date();
        document.getElementById('budgetMonth').value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
        await Promise.all([this.loadBudgets(), this.loadCategories(), this.loadStatus(), this.checkAI()]);
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

    async loadCategories() {
        this.categories = await API.get('/api/categories/');
        this.catAverages = await API.get('/api/categories/averages').catch(() => ({}));
        this.renderCatCheckboxes();
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
            'other': { title: 'Autres', cats: [] }
        };

        for (const c of this.categories) {
            if (groups[c.type]) groups[c.type].cats.push(c);
            else groups['other'].cats.push(c);
        }

        let html = '';
        for (const key of ['expense_fixed', 'expense_var', 'income', 'neutral', 'other']) {
            if (groups[key].cats.length === 0) continue;
            
            html += `<div style="margin-bottom:12px;">
                <div style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px;border-bottom:1px solid var(--border-color);padding-bottom:4px;">
                    ${groups[key].title}
                </div>
                <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(220px, 1fr));gap:6px;">`;
                
            for (const c of groups[key].cats) {
                const isSelected = selected.includes(c.name);
                const overlap = catToBudget[c.name] ? catToBudget[c.name].join(', ') : null;
                
                let avgValue = 0;
                let avgLabel = '';
                const catAvg = this.catAverages[c.name];
                
                if (catAvg) {
                    if (period === 'monthly' || period === 'indefinite') {
                        avgValue = catAvg.yearly_average; // Use the 12-month smoothed monthly average
                        avgLabel = 'ce mois';
                    } else if (period === 'yearly') {
                        avgValue = catAvg.yearly_average * 12; // Revert to total annual average
                        avgLabel = 'par an';
                    }
                }
                
                const avgText = avgValue > 0 ? `<span style="font-size:10px;color:var(--text-muted);background:rgba(128,128,128,0.1);padding:1px 4px;border-radius:4px;">~${formatCurrency(avgValue)} ${avgLabel}</span>` : '';
                const overlapText = overlap ? `<span style="font-size:10px;color:#f59e0b;background:rgba(245,158,11,0.15);padding:1px 4px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="Utilisé dans: ${overlap}">⚠️ ${overlap}</span>` : '';

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
        const monthVal = document.getElementById('budgetMonth')?.value;
        if (!monthVal) return;
        const [y, m] = monthVal.split('-');
        try {
            this.statusData = await API.get(`/api/budgets/status?year=${y}&month=${m}`);
            this.renderStatus();
        } catch(e) {
            document.getElementById('budgetStatusContainer').innerHTML =
                `<p style="color:#ff5630;">Erreur : ${e.message}</p>`;
        }
    },

    renderStatus() {
        const container = document.getElementById('budgetStatusContainer');
        if (!this.statusData || this.statusData.budgets.length === 0) {
            container.innerHTML = '<p style="color:var(--text-muted);padding:10px 0;">Aucune enveloppe active. Créez-en une pour commencer.</p>';
            return;
        }

        const monthVal = document.getElementById('budgetMonth')?.value || '';
        const [y, m] = monthVal.split('-');
        const label = new Date(parseInt(y), parseInt(m)-1, 1).toLocaleDateString('fr-FR', {month:'long', year:'numeric'});

        // Group budgets by period
        const groups = {
            'monthly': { title: 'Mensuel', budgets: [] },
            'yearly': { title: 'Annuel', budgets: [] },
            'indefinite': { title: 'Indéfini', budgets: [] }
        };

        for (const b of this.statusData.budgets) {
            if (groups[b.period]) {
                groups[b.period].budgets.push(b);
            } else {
                groups['monthly'].budgets.push(b);
            }
        }

        let fullHtml = '';

        for (const period of ['monthly', 'yearly', 'indefinite']) {
            const group = groups[period];
            if (group.budgets.length === 0) continue;

            let totalTarget = 0;
            let totalSpent = 0;
            let totalRecSpent = 0;
            for (const b of group.budgets) {
                totalTarget += b.budget_amount;
                totalSpent += b.spent;
                totalRecSpent += b.reconciled_spent || 0;
            }
            
            const totalPct = totalTarget > 0 ? Math.min((totalSpent / totalTarget) * 100, 100) : 0;
            const recPct = totalTarget > 0 ? Math.min((totalRecSpent / totalTarget) * 100, 100) : 0;
            const totalBarColor = (totalTarget > 0 && (totalRecSpent / totalTarget) * 100 > 100) ? '#ff5630' : recPct >= 80 ? '#f59e0b' : '#10b981';
            const globalOver = totalSpent > totalTarget;
            const globalRemaining = totalTarget - totalSpent;

            let html = `<div style="margin-bottom:40px;">
                <h3 style="margin:0 0 16px;font-size:16px;color:var(--text-color);border-bottom:1px solid var(--border-color);padding-bottom:8px;">Enveloppes — ${group.title}</h3>
                
                <div style="background:var(--bg-surface);border:1px solid var(--border-color);border-radius:10px;padding:20px;margin-bottom:24px;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
                <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:12px;flex-wrap:wrap;gap:8px;">
                    <div>
                        <h4 style="margin:0 0 4px;font-size:14px;color:var(--text-color);">Résumé Global — ${group.title}</h4>
                        <span style="font-size:12px;color:var(--text-muted);">${label}</span>
                    </div>
                    <div style="text-align:right;">
                        <strong class="privacy-blur" style="font-size:18px;color:var(--text-color);">${formatCurrency(totalTarget)}</strong><span style="font-size:12px;color:var(--text-muted);"> budgeté</span>
                    </div>
                </div>
                <div style="position:relative;background:rgba(128,128,128,0.15);border-radius:999px;height:12px;overflow:hidden;margin-bottom:12px;border:1px solid rgba(255,255,255,0.05);">
                    <div style="position:absolute;top:0;left:0;width:${totalPct}%;height:100%;background:rgba(128,128,128,0.4);border-radius:999px;transition:width 0.3s;"></div>
                    <div style="position:absolute;top:0;left:0;width:${recPct}%;height:100%;background:${totalBarColor};border-radius:999px;transition:width 0.3s;"></div>
                </div>
                <div style="display:flex;justify-content:space-between;font-size:14px;flex-wrap:wrap;gap:4px;">
                    <div style="display:flex;flex-wrap:wrap;gap:8px;">
                        <span class="privacy-blur" style="color:${totalBarColor};font-weight:600;">${formatCurrency(totalRecSpent)} rapprochés</span>
                        <span class="privacy-blur" style="color:var(--text-muted);font-size:12px;align-self:flex-end;">(${formatCurrency(totalSpent)} engagés)</span>
                    </div>
                    <span style="color:${globalOver ? '#ff5630' : 'var(--text-muted)'};font-weight:600;">${globalOver ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(globalRemaining))}</span> ${globalOver ? 'de dépassement global' : 'restants au global'}</span>
                </div>
            </div>`;

            html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">`;

            for (const b of group.budgets) {
                const pct = Math.min((b.spent / b.budget_amount) * 100 || 0, 100);
                const recPct = Math.min(b.reconciled_percent || 0, 100);
                const barColor = b.reconciled_percent > 100 ? '#ff5630' : b.reconciled_percent >= 80 ? '#f59e0b' : '#10b981';
                const overBudget = b.remaining < 0;
                const typeTag = b.is_project
                    ? `<span style="background:rgba(99,102,241,0.15);color:#818cf8;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;">PROJET</span>`
                    : '';
                const catTags = (b.categories || []).map(c =>
                    `<span style="background:var(--bg-base);padding:2px 6px;border-radius:4px;font-size:10px;color:var(--text-muted);">${c}</span>`
                ).join(' ');

                const incomeHtml = b.income > 0
                    ? `<div style="font-size:11px;color:#10b981;margin-top:3px;">↑ <span class="privacy-blur">${formatCurrency(b.income)}</span> reçus</div>`
                    : '';

                const safeName = b.name.replace(/'/g, "\\'");
                const periodLabel = b.period === 'monthly' ? 'Mensuel' : b.period === 'yearly' ? 'Annuel' : 'Indéfini';
                const closedStyle = b.is_closed ? 'opacity:0.6;' : '';
                const closedTag = b.is_closed
                    ? `<span style="background:rgba(239,68,68,0.15);color:#ff5630;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px;">CLÔTURÉ</span>`
                    : '';

                html += `<div onclick="window.BudgetsView.showDetail(${b.id}, '${safeName}', ${y}, ${m})" style="background:var(--bg-body);border:1px solid ${overBudget ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'};border-radius:10px;padding:16px;cursor:pointer;transition:border-color 0.2s;${closedStyle}" onmouseover="this.style.borderColor='rgba(99,102,241,0.5)'" onmouseout="this.style.borderColor='${overBudget ? 'rgba(239,68,68,0.4)' : 'var(--border-color)'}'">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;gap:8px;">
                        <div style="flex:1;">
                            <strong style="font-size:13px;">${b.name} ${closedTag}</strong>
                            <div style="margin-top:4px;display:flex;flex-wrap:wrap;gap:4px;">${typeTag}${catTags}</div>
                        </div>
                        <div style="display:flex;gap:4px;flex-shrink:0;" onclick="event.stopPropagation()">
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.editBudget(${b.id})" title="Modifier">✏️</button>
                            <button class="btn btn-secondary" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.toggleClose(${b.id})" title="${b.is_closed ? 'Réouvrir' : 'Clôturer'}">${b.is_closed ? '🔓' : '🔒'}</button>
                            <button class="btn btn-danger" style="padding:4px 8px;font-size:11px;" onclick="window.BudgetsView.deleteBudget(${b.id})" title="Supprimer">✕</button>
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
                            <span class="privacy-blur" style="color:${barColor};font-weight:600;">${formatCurrency(b.reconciled_spent || 0)} rapprochés</span>
                            <span class="privacy-blur" style="color:var(--text-muted);font-size:11px;align-self:flex-end;">(${formatCurrency(b.spent)} engagés)</span>
                            ${incomeHtml}
                        </div>
                        <span style="color:${overBudget ? '#ff5630' : 'var(--text-muted)'}">${overBudget ? '⚠️ ' : ''}<span class="privacy-blur">${formatCurrency(Math.abs(b.remaining))}</span> ${overBudget ? 'de dépassement' : 'restants'}</span>
                    </div>
                </div>`;
            }
            html += '</div></div>';
            fullHtml += html;
        }

        let html = fullHtml;

        container.innerHTML = html;
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
        
        graph.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">Chargement...</p>';
        list.innerHTML = '';
        modal.style.display = 'flex';

        try {
            const txs = await API.get(`/api/budgets/${budgetId}/transactions?year=${year}&month=${month}`);

            if (!txs.length) {
                graph.innerHTML = '<p style="color:var(--text-muted);font-size:12px;">Aucune opération dans cette enveloppe.</p>';
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
                barHtml(totalExp, null, '💸 Dépenses', `${formatCurrency(totalRecExp)} rapprochés / ${formatCurrency(totalExp)} engagés`, totalRecExp, recExpColor) +
                (totalInc > 0 ? barHtml(totalInc, '#10b981', '↑ ' + window.app.getTypeLabel('income'), formatCurrency(totalInc)) : '') +
                barHtml(target, 'rgba(99,102,241,0.6)', '🎯 Objectif', formatCurrency(target));

            // ── Transactions list ─────────────────────────────────────────
            list.innerHTML = `<h4 style="margin:0 0 10px;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;">Opérations (${txs.length})</h4>` +
                txs.map(tx => `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border-color);flex-wrap:wrap;${tx.is_reconciled ? 'opacity:0.55;' : ''}">
                    <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;">${tx.date}</span>
                    <span style="flex:1;font-size:12px;min-width:100px;">
                        ${tx.description}
                        ${tx.is_reconciled ? '<span style="font-size:10px;color:var(--text-muted);font-style:italic;margin-left:8px;">Rapproché</span>' : ''}
                    </span>
                    ${tx.category ? `<span style="background:var(--bg-base);padding:1px 5px;border-radius:4px;font-size:10px;color:var(--text-muted);">${tx.category}</span>` : ''}
                    <span class="privacy-blur" style="font-size:13px;font-weight:600;color:${tx.is_income ? '#10b981' : '#ff5630'};white-space:nowrap;">
                        ${tx.is_income ? '+' : ''}${formatCurrency(tx.amount)}
                    </span>
                </div>`).join('');
        } catch(e) {
            graph.innerHTML = `<p style="color:#ff5630;">Erreur : ${e.message}</p>`;
        }
    },

    showAddForm() {
        document.getElementById('budgetUnifiedTitle').textContent = 'Nouvelle enveloppe';
        document.getElementById('budgetUnifiedEditBtn').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        
        document.getElementById('budgetEditId').value = '';
        document.getElementById('newBudgetName').value = '';
        document.getElementById('newBudgetAmount').value = '';
        document.getElementById('newBudgetPeriod').value = 'monthly';
        document.getElementById('budgetTypeCategory').checked = true;
        this.toggleType();
        this.renderCatCheckboxes([]);
        
        document.getElementById('budgetFormSection').style.display = 'block';
        document.getElementById('budgetUnifiedModal').style.display = 'flex';
    },

    closeUnifiedModal() {
        document.getElementById('budgetUnifiedModal').style.display = 'none';
        document.getElementById('budgetFormSection').style.display = 'none';
    },
    
    hideEditSection() {
        if (!document.getElementById('budgetEditId').value) {
            // We were adding a new budget, close the whole modal
            this.closeUnifiedModal();
        } else {
            // We were editing an existing budget, just hide the form
            document.getElementById('budgetFormSection').style.display = 'none';
        }
    },

    showEditSection() {
        const id = document.getElementById('budgetEditId').value;
        const b = this.budgets.find(x => x.id == id);
        if (!b) return;

        document.getElementById('newBudgetName').value = b.name;
        document.getElementById('newBudgetAmount').value = b.monthly_amount;
        document.getElementById('newBudgetPeriod').value = b.period;

        if (b.is_project) {
            document.getElementById('budgetTypeProject').checked = true;
        } else {
            document.getElementById('budgetTypeCategory').checked = true;
        }
        this.toggleType();
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

        document.getElementById('budgetUnifiedTitle').textContent = `Modifier l'enveloppe`;
        document.getElementById('budgetUnifiedEditBtn').style.display = 'none';
        document.getElementById('budgetDetailSection').style.display = 'none';
        document.getElementById('budgetEditId').value = id;
        
        document.getElementById('newBudgetName').value = b.name;
        document.getElementById('newBudgetAmount').value = b.monthly_amount;
        document.getElementById('newBudgetPeriod').value = b.period;

        if (b.is_project) {
            document.getElementById('budgetTypeProject').checked = true;
        } else {
            document.getElementById('budgetTypeCategory').checked = true;
        }
        this.toggleType();
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

        if (!name) return showInlineMessage('Info', 'Nom requis.');
        if (isNaN(amount) || amount <= 0) return showInlineMessage('Info', 'Montant invalide.');

        const payload = { name, monthly_amount: amount, period, is_project: isProject, categories };

        try {
            let savedId = id;
            if (id) {
                await API.put(`/api/budgets/${id}`, payload);
                showInlineMessage('Succès', 'Enveloppe mise à jour.');
            } else {
                const res = await API.post('/api/budgets/', payload);
                savedId = res.id;
                document.getElementById('budgetEditId').value = savedId;
                document.getElementById('budgetUnifiedTitle').textContent = `Modifier l'enveloppe`;
                showInlineMessage('Succès', 'Enveloppe créée.');
            }
            
            await this.loadBudgets();
            await this.loadStatus();
            
            // Re-render categories to update any overlaps
            this.renderCatCheckboxes(categories);
            
            // If detail view is open, refresh it
            const detailSec = document.getElementById('budgetDetailSection');
            if (detailSec && detailSec.style.display !== 'none') {
                const monthVal = document.getElementById('budgetMonth')?.value;
                if (monthVal) {
                    const [y, m] = monthVal.split('-');
                    this.showDetail(savedId, name, y, m);
                }
            }
        } catch(e) {
            showInlineMessage('Erreur', 'Erreur : ' + (e.message || e));
        }
    },

    async updateAmount(id, val) {
        const amount = parseFloat(val);
        if (isNaN(amount)) return;
        try {
            await API.put(`/api/budgets/${id}`, { monthly_amount: amount });
            await this.loadStatus();
        } catch(e) {
            showInlineMessage('Info', 'Erreur mise à jour : ' + e.message);
        }
    },

    async toggleClose(id) {
        const b = this.budgets.find(x => x.id === id);
        if (!b) return;
        const action = b.is_closed ? 'réouvrir' : 'clôturer';
        if (!await showInlineConfirm('Confirmation', `Voulez-vous vraiment ${action} cette enveloppe ?`)) return;
        try {
            await API.put(`/api/budgets/${id}`, { is_closed: !b.is_closed });
            await this.loadBudgets();
            await this.loadStatus();
        } catch(e) {
            showInlineMessage('Erreur', e.message);
        }
    },

    async deleteBudget(id) {
        if (!await showInlineConfirm('Suppression', 'Supprimer cette enveloppe définitivement ?')) return;
        try {
            await API.del(`/api/budgets/${id}`);
            await this.loadBudgets();
            await this.loadStatus();
        } catch(e) {
            showInlineMessage('Info', 'Erreur suppression : ' + e.message);
        }
    },

    // ── AI Suggestions ────────────────────────────────────────────────────────

    async requestAiSuggestions() {
        const btn = document.getElementById('budgetAiBtn');
        btn.disabled = true;
        btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg> Analyse en cours...`;
        try {
            const result = await API.post('/api/budgets/ai_suggest', {});
            this.renderAiProposals(result.proposals || []);
        } catch(e) {
            const msg = e.message || '';
            if (msg.includes('non activ') || msg.includes('400')) {
                showInlineMessage('Info', '✨ L\'IA n\'est pas activée. Activez-la dans Paramètres → Ollama pour utiliser cette fonctionnalité.');
            } else {
                showInlineMessage('Erreur', msg || 'L\'IA n\'a pas pu générer de propositions.');
            }
        } finally {
            btn.disabled = false;
            btn.textContent = '✨ Suggestions IA';
        }
    },

    renderAiProposals(proposals) {
        const panel = document.getElementById('budgetAiPanel');
        const container = document.getElementById('budgetAiProposals');
        panel.style.display = 'block';
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

        if (!proposals.length) {
            container.innerHTML = '<p style="color:var(--text-muted);">Aucune proposition disponible.</p>';
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
                        <div style="font-size:18px;font-weight:700;color:var(--accent);">${formatCurrency(p.suggested_amount)}<span style="font-size:11px;font-weight:400;color:var(--text-muted);">/mois</span></div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:12px;">
                    <button class="btn btn-primary" style="flex:1;" onclick="window.BudgetsView.acceptProposal(${i}, ${JSON.stringify(p).replace(/"/g, '&quot;')})">✅ Créer cette enveloppe</button>
                    <button class="btn btn-secondary" style="padding:6px 12px;" onclick="document.getElementById('aiProposal_${i}').style.display='none'">✕</button>
                </div>
            </div>
        `).join('');
    },

    async acceptProposal(idx, proposal) {
        const btn = document.querySelector(`#aiProposal_${idx} button.btn-primary`);
        if(btn) {
            btn.disabled = true;
            btn.innerHTML = `<svg class="animate-spin" style="width:14px;height:14px;margin-right:6px;display:inline-block;vertical-align:middle;" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle style="opacity:0.25;" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path style="opacity:0.75;" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg> Création...`;
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
            
            if(btn) {
                btn.innerHTML = '✅ Enveloppe créée !';
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
                btn.innerHTML = '❌ Erreur';
            }
            showInlineMessage('Erreur', e.message || 'Impossible de créer l\'enveloppe.');
        }
    },

    closeAiPanel() {
        document.getElementById('budgetAiPanel').style.display = 'none';
    },
};


