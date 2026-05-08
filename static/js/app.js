// app.js - Main orchestrator

class App {
    constructor() {
        this.currentView = 'dashboard';
        this.views = {};
    }

    getTypeLabel(typeKey) {
        if (!typeKey) return '';
        if (this.config && this.config['type_label_' + typeKey]) {
            return this.config['type_label_' + typeKey];
        }
        if (window.i18n && window.i18n.t) {
            return window.i18n.t('type_' + typeKey) || typeKey;
        }
        return typeKey;
    }

    async init() {
        // Init i18n
        await window.i18n.init();
        
        // Load Global Config
        try {
            this.config = await API.get('/api/config/');
        } catch (e) {
            console.error("Failed to load global config", e);
            this.config = {};
        }
        
        // Display app version in header (via Tauri IPC command)
        try {
            let version = null;
            try {
                if (window.__TAURI_INTERNALS__) {
                    version = await window.__TAURI_INTERNALS__.invoke('get_app_version');
                } else if (window.__TAURI__ && window.__TAURI__.core) {
                    version = await window.__TAURI__.core.invoke('get_app_version');
                }
            } catch (err) {
                console.warn('[version] Tauri IPC failed, trying backend fallback', err);
            }
            
            if (!version) {
                // Fallback for dev mode without Tauri or if IPC fails
                const vData = await API.get('/api/version');
                version = vData.version;
            }
            const badge = document.getElementById('appVersionBadge');
            if (badge && version) badge.textContent = `v${version}`;
        } catch (e) { console.warn('[version] All version checks failed', e); }
        
        // Theme toggle
        const savedTheme = localStorage.getItem('omni_theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('theme-dark');
        } else if (savedTheme === 'light') {
            document.body.classList.remove('theme-dark');
        }
        
        document.getElementById('themeToggle').addEventListener('click', () => {
            document.body.classList.toggle('theme-dark');
            const isDark = document.body.classList.contains('theme-dark');
            localStorage.setItem('omni_theme', isDark ? 'dark' : 'light');
        });
        
        // Privacy toggle
        const privacyToggle = document.getElementById('privacyToggle');
        if (privacyToggle) {
            if (localStorage.getItem('omni_privacy') === 'true') {
                document.body.classList.add('privacy-mode');
                privacyToggle.textContent = '🙈';
            }
            
            privacyToggle.addEventListener('click', () => {
                document.body.classList.toggle('privacy-mode');
                const isPrivate = document.body.classList.contains('privacy-mode');
                privacyToggle.textContent = isPrivate ? '🙈' : '👁️';
                localStorage.setItem('omni_privacy', isPrivate);
            });
        }
        
        // Language dropdown
        const langToggleBtn = document.getElementById('langToggleBtn');
        const langMenu = document.getElementById('langMenu');
        const currentLangFlag = document.getElementById('currentLangFlag');
        
        if (langToggleBtn && langMenu) {
            // Update initial flag
            currentLangFlag.className = `fi fi-${window.i18n.lang === 'en' ? 'gb' : 'fr'}`;
            
            langToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                langMenu.style.display = langMenu.style.display === 'none' ? 'block' : 'none';
            });
            
            document.querySelectorAll('.lang-option').forEach(opt => {
                opt.addEventListener('click', async (e) => {
                    const l = e.currentTarget.getAttribute('data-lang');
                    currentLangFlag.className = `fi fi-${l === 'en' ? 'gb' : 'fr'}`;
                    langMenu.style.display = 'none';
                    await window.i18n.setLang(l);
                });
            });
            
            document.addEventListener('click', () => {
                langMenu.style.display = 'none';
            });
        }
        
        // Mobile Sidebar
        const mobileBtn = document.getElementById('mobileMenuBtn');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        if (mobileBtn && sidebar && overlay) {
            mobileBtn.addEventListener('click', () => {
                sidebar.classList.add('mobile-open');
                overlay.classList.add('active');
            });
            overlay.addEventListener('click', () => {
                sidebar.classList.remove('mobile-open');
                overlay.classList.remove('active');
            });
            // Close sidebar when clicking a nav button on mobile
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    sidebar.classList.remove('mobile-open');
                    overlay.classList.remove('active');
                });
            });
        }
        
        // AI Features Visibility
        const chatBtn = document.querySelector('.nav-btn[data-view="chat"]');
        if (chatBtn) {
            chatBtn.style.display = this.config.enable_ai === 'true' ? 'inline-block' : 'none';
        }

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.loadView(e.currentTarget.getAttribute('data-view'));
            });
        });

        // Initial Load
        await this.refreshSidebar();
        
        // Restore view from localStorage
        const savedView = localStorage.getItem('omni_current_view') || this.currentView;
        this.loadView(savedView);

        // Reveal UI after init is complete (prevents FOUC)
        const container = document.querySelector('.app-container');
        if (container) container.style.opacity = '1';
    }

    showUnreconciledBeforePay() {
        if (!window.app.nextPayDate) return;
        
        if (window.TimelineView) {
            window.TimelineView.pendingFilter = {
                unreconciledBeforeDate: window.app.nextPayDate
            };
        }
        this.loadView('dashboard');
    }

    async refreshSidebar() {
        try {
            const accounts = await API.get('/api/stats/accounts');
            this.accounts = accounts;
            const list = document.getElementById('accountsList');
            list.innerHTML = '';
            
            accounts.filter(a => !a.is_closed).forEach(acc => {
                const div = document.createElement('div');
                div.className = 'account-item';
                div.innerHTML = `<span>${acc.name}</span><strong>${formatCurrency(acc.balance)}</strong>`;
                list.appendChild(div);
            });

            const stats = await API.get('/api/stats/dashboard');
            document.getElementById('valNetWorth').textContent = formatCurrency(stats.net_worth);
            document.getElementById('valRestToLive').textContent = formatCurrency(stats.rest_to_live);
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
                payDateDiv.textContent = formatDate(stats.next_pay_date) + (stats.is_pay_override ? ' (Manuel)' : '');
                
                // Store globally for timeline filtering and history modal
                window.app.nextPayDate = stats.next_pay_date;
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
                    restLabel.textContent = 'Peut-être dépenser';
                    restLabel.removeAttribute('data-i18n'); // prevent i18n from overriding
                } else {
                    restLabel.textContent = 'Reste à vivre';
                    restLabel.setAttribute('data-i18n', 'stat_rest_to_live');
                }
            }
            
            // Budget Summary (Always hide if no budgets are set, even in org mode)
            if (stats.budget_summary && stats.budget_summary.target > 0) {
                const box = document.getElementById('sidebarBudgetBox');
                const spent = document.getElementById('sidebarBudgetSpent');
                const target = document.getElementById('sidebarBudgetTarget');
                const bar = document.getElementById('sidebarBudgetBar');
                const totalBar = document.getElementById('sidebarBudgetTotalBar');
                
                const targetVal = stats.budget_summary.target || 0;
                const totalSpent = stats.budget_summary.spent || 0;
                const recSpent = stats.budget_summary.reconciled_spent || 0;
                
                const totalPct = targetVal > 0 ? Math.min((totalSpent / targetVal) * 100, 100) : 0;
                const recPct = targetVal > 0 ? Math.min((recSpent / targetVal) * 100, 100) : 0;
                
                const over = targetVal > 0 && recSpent > targetVal;
                const color = over ? '#ff5630' : recPct >= 80 ? '#f59e0b' : '#10b981';
                
                box.style.display = 'block';
                box.style.borderColor = color + '66';
                box.style.backgroundColor = color + '1a';
                
                box.querySelector('.stat-label').style.color = color;
                
                spent.textContent = formatCurrency(recSpent);
                spent.style.color = color;
                target.textContent = "/ " + formatCurrency(targetVal);
                
                bar.style.width = recPct + '%';
                bar.style.backgroundColor = color;
                
                if (totalBar) {
                    totalBar.style.width = totalPct + '%';
                }
            } else {
                const box = document.getElementById('sidebarBudgetBox');
                if (box) box.style.display = 'none';
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
            
            this.onQuickPayTypeChange(false);
            
            const overdraftBox = document.getElementById('overdraftBox');
            if (stats.overdraft_warning) {
                overdraftBox.style.display = 'block';
                document.getElementById('valOverdraft').textContent = formatCurrency(stats.overdraft_warning.projected_balance);
                document.getElementById('valOverdraftDate').textContent = `${formatDate(stats.overdraft_warning.date)} (${stats.overdraft_warning.transaction_description})`;
                
                const expText = `Si aucune rentrée d'argent d'ici le ${formatDate(stats.overdraft_warning.date)}, risque de découvert causé par cette opération.`;
                document.getElementById('valOverdraftExplanation').textContent = expText;
                
                const btnLocate = document.getElementById('btnLocateOverdraft');
                if (btnLocate) {
                    btnLocate.onclick = () => {
                        window.app.loadView('all_operations');
                        // Wait for rendering, then scroll and highlight
                        setTimeout(() => {
                            const row = document.querySelector(`tr[data-id="${stats.overdraft_warning.transaction_id}"]`);
                            if (row) {
                                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                row.style.transition = 'background-color 0.5s';
                                const oldBg = row.style.backgroundColor;
                                row.style.backgroundColor = 'rgba(255, 86, 48, 0.2)';
                                setTimeout(() => row.style.backgroundColor = oldBg, 3000);
                            }
                        }, 500);
                    };
                }
            } else {
                overdraftBox.style.display = 'none';
            }
        } catch (e) {
            console.error("Error refreshing sidebar", e);
        }
    }
    
    showPayOverrideModal() {
        document.getElementById('payOverrideModal').style.display = 'flex';
    }
    
    showPayHistoryModal() {
        const tbody = document.getElementById('payHistoryTableBody');
        tbody.innerHTML = '';
        
        if (!this.payHistory || this.payHistory.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 15px; color: var(--text-muted);">Aucun historique détecté pour le moment.</td></tr>`;
        } else {
            this.payHistory.forEach(tx => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = "1px solid var(--border-color)";
                tr.innerHTML = `
                    <td style="padding: 8px;">${formatDate(tx.date)}</td>
                    <td style="padding: 8px;"><strong>${tx.description}</strong></td>
                    <td style="padding: 8px; text-align: right; color: var(--color-income); font-weight: bold;">${formatCurrency(tx.amount)}</td>
                `;
                tbody.appendChild(tr);
            });
        }
        
        document.getElementById('payHistoryModal').style.display = 'flex';
    }
    
    async savePayOverride() {
        const date = document.getElementById('overridePayDate').value;
        const amount = parseFloat(document.getElementById('overridePayAmount').value) || 0;
        
        if (!date) return;
        
        try {
            await API.post('/api/stats/override_paycheck', { date, amount });
            document.getElementById('payOverrideModal').style.display = 'none';
            await this.refreshSidebar();
            if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
        } catch (e) {
            console.error("Failed to save override", e);
            showInlineMessage("Info", "Erreur lors de la sauvegarde.");
        }
    }
    
    onQuickPayTypeChange(save = false) {
        const isBimonthly = document.getElementById('quickPayType').value === 'bimonthly';
        document.getElementById('quickPayDay2').style.display = isBimonthly ? 'block' : 'none';
        document.getElementById('lblQuickPayDay1').textContent = isBimonthly ? 'Jours :' : 'Jour :';
        if (save) this.saveQuickPay();
    }
    
    async saveQuickPay() {
        const type = document.getElementById('quickPayType').value;
        const day = document.getElementById('quickPayDay').value;
        const day2 = document.getElementById('quickPayDay2').value;
        
        if (!day) return;
        
        try {
            await API.post('/api/config/', { 
                base_pay_type: type,
                base_pay_day: day.toString(),
                base_pay_day_2: day2.toString()
            });
            await this.refreshSidebar();
            if (this.currentView === 'dashboard' && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
        } catch (e) {
            console.error(e);
        }
    }

    loadView(viewName) {
        this.currentView = viewName;
        localStorage.setItem('omni_current_view', viewName);
        
        // Update nav buttons active state
        document.querySelectorAll('.nav-btn').forEach(b => {
            if (b.getAttribute('data-view') === viewName) {
                b.classList.add('active');
            } else {
                b.classList.remove('active');
            }
        });

        const main = document.getElementById('mainContent');
        
        if (viewName === 'dashboard' && window.TimelineView) {
            main.innerHTML = window.TimelineView.render();
            window.TimelineView.init();
        } else if (viewName === 'recurrences' && window.RecurrenceView) {
            main.innerHTML = window.RecurrenceView.render();
            window.RecurrenceView.init();
        } else if (viewName === 'categories' && window.CategoriesView) {
            main.innerHTML = window.CategoriesView.render();
            window.CategoriesView.init();
        } else if (viewName === 'accounts' && window.AccountsView) {
            main.innerHTML = window.AccountsView.render();
            window.AccountsView.init();
        } else if (viewName === 'config' && window.ConfigView) {
            main.innerHTML = window.ConfigView.render();
            window.ConfigView.init();
        } else if (viewName === 'chat' && window.ChatView) {
            main.innerHTML = window.ChatView.render();
            window.ChatView.init();
        } else if (viewName === 'all_operations' && window.AllOperationsView) {
            main.innerHTML = window.AllOperationsView.render();
            window.AllOperationsView.init();
        } else if (viewName === 'analytics' && window.AnalyticsView) {
            main.innerHTML = window.AnalyticsView.render();
            window.AnalyticsView.init();
        } else if (viewName === 'budgets' && window.BudgetsView) {
            main.innerHTML = window.BudgetsView.render();
            window.BudgetsView.init();
        } else if (viewName === 'trends' && window.TrendsView) {
            main.innerHTML = window.TrendsView.render();
            window.TrendsView.init();
        } else {
            main.innerHTML = `<h2>${window.i18n.t('nav_' + viewName)}</h2><p>En construction...</p>`;
        }
        
        window.i18n.translateDOM(main);
    }
}

window.app = new App();
document.addEventListener('DOMContentLoaded', () => window.app.init());
