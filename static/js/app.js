// app.js - Main orchestrator

class App {
    constructor() {
        this.currentView = 'dashboard';
        this.views = {};
        this.currentUser = null;  // Phase 9: active org user name
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
        
        // ── Phase 8: Check if first launch / empty DB ──
        if (window.SetupWizard) {
            const wizardShown = await window.SetupWizard.checkAndShow();
            if (wizardShown) {
                // Reveal UI behind wizard (for theme consistency)
                const container = document.querySelector('.app-container');
                if (container) container.style.opacity = '1';
                return; // Wizard handles the rest
            }
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
            if (badge && version) {
                badge.textContent = `v${version}`;
                this._appVersion = version;
                // Auto-show changelog after update (one-time per version)
                const lastSeen = localStorage.getItem('omni_last_seen_version');
                if (lastSeen !== version) {
                    // Version changed (or first time feature is seen) → show changelog after UI loads
                    setTimeout(() => this.showChangelog(), 1500);
                }
                localStorage.setItem('omni_last_seen_version', version);
            }
        } catch (e) { console.warn('[version] All version checks failed', e); }
        
        // ── Phase 9: Check if org mode needs user selection ──
        if (this.config.enable_org_mode === 'true') {
            const savedUser = sessionStorage.getItem('omni_current_user');
            if (!savedUser) {
                // Ensure default user exists
                try { await API.post('/api/org_users/ensure_default'); } catch (e) {}
                await this._showUserPicker();
                return; // Blocks until user selected
            }
            this.currentUser = savedUser;
        }
        
        await this._initUI();
    }

    async _initUI() {
        if (this._uiInitialized) return;
        this._uiInitialized = true;
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
                privacyToggle.classList.add('toggle-active');
            }
            
            privacyToggle.addEventListener('click', () => {
                document.body.classList.toggle('privacy-mode');
                const isPrivate = document.body.classList.contains('privacy-mode');
                privacyToggle.textContent = isPrivate ? '🙈' : '👁️';
                privacyToggle.classList.toggle('toggle-active', isPrivate);
                localStorage.setItem('omni_privacy', isPrivate);
            });
        }
        
        // Compact mode toggle
        const compactToggle = document.getElementById('compactToggle');
        const svgNormal = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect y="2" width="16" height="2.5" rx="1"/><rect y="7" width="16" height="2.5" rx="1"/><rect y="12" width="16" height="2.5" rx="1"/></svg>';
        const svgCompact = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect y="1" width="16" height="1.5" rx=".75"/><rect y="5" width="16" height="1.5" rx=".75"/><rect y="9" width="16" height="1.5" rx=".75"/><rect y="13" width="16" height="1.5" rx=".75"/></svg>';
        if (compactToggle) {
            if (localStorage.getItem('omni_compact') === 'true') {
                document.body.classList.add('compact-mode');
                compactToggle.innerHTML = svgCompact;
                compactToggle.classList.add('toggle-active');
            }
            
            compactToggle.addEventListener('click', () => {
                document.body.classList.toggle('compact-mode');
                const isCompact = document.body.classList.contains('compact-mode');
                compactToggle.innerHTML = isCompact ? svgCompact : svgNormal;
                compactToggle.classList.toggle('toggle-active', isCompact);
                localStorage.setItem('omni_compact', isCompact);
                // Re-measure row height and refresh active VirtualTable
                [window.TimelineView, window.AllOperationsView].forEach(v => {
                    if (v && v._vt) {
                        v._vt._measured = false;
                        v._vt.refresh();
                    }
                });
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
        document.querySelectorAll('.nav-btn[data-view="chat"]').forEach(btn => {
            btn.style.display = this.config.enable_ai === 'true' ? '' : 'none';
        });

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
        
        // Phase 9: Init user switcher if org mode
        this._initUserSwitcher();
    }

    // ── Phase 9: User Picker (full-page splash) ──────────────────
    async _showUserPicker() {
        const overlay = document.getElementById('userPickerOverlay');
        if (!overlay) return;

        // Translate overlay
        window.i18n.translateDOM(overlay);

        let users = [];
        try {
            users = await API.get('/api/org_users/');
            users = users.filter(u => u.is_active);
        } catch (e) {
            console.error('[Phase9] Erreur chargement utilisateurs', e);
        }

        const badges = document.getElementById('userPickerBadges');
        badges.innerHTML = users.map(u => `
            <div class="user-picker-badge" data-user="${u.name}">
                <div class="user-picker-badge-avatar">👤</div>
                <div class="user-picker-badge-name">${u.name}</div>
            </div>
        `).join('');

        overlay.style.display = 'flex';

        return new Promise(resolve => {
            badges.querySelectorAll('.user-picker-badge').forEach(badge => {
                badge.addEventListener('click', () => {
                    const name = badge.getAttribute('data-user');
                    this.currentUser = name;
                    sessionStorage.setItem('omni_current_user', name);

                    // Fade out overlay
                    overlay.style.transition = 'opacity 0.3s';
                    overlay.style.opacity = '0';
                    setTimeout(async () => {
                        overlay.style.display = 'none';
                        overlay.style.opacity = '1';
                        await this._initUI();
                        resolve();
                    }, 300);
                });
            });
        });
    }

    async _initUserSwitcher() {
        const isOrg = this.config && this.config.enable_org_mode === 'true';
        const switcher = document.getElementById('userSwitcher');
        if (!switcher) return;

        if (!isOrg) {
            switcher.style.display = 'none';
            return;
        }

        switcher.style.display = 'block';

        // Set current user label
        const label = document.getElementById('currentUserLabel');
        if (label) label.textContent = this.currentUser || '—';

        // Toggle menu
        const btn = document.getElementById('userSwitcherBtn');
        const menu = document.getElementById('userSwitcherMenu');

        btn.onclick = async (e) => {
            e.stopPropagation();
            if (menu.style.display === 'none') {
                // Fetch users and populate
                let users = [];
                try {
                    users = await API.get('/api/org_users/');
                    users = users.filter(u => u.is_active);
                } catch (e) { console.error(e); }

                menu.innerHTML = users.map(u => `
                    <div class="user-switcher-item ${u.name === this.currentUser ? 'active' : ''}" data-user="${u.name}">
                        ${u.name === this.currentUser ? '<span class="user-item-dot"></span>' : '<span style="width:8px"></span>'}
                        <span>👤 ${u.name}</span>
                    </div>
                `).join('');

                menu.querySelectorAll('.user-switcher-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const name = item.getAttribute('data-user');
                        this.currentUser = name;
                        sessionStorage.setItem('omni_current_user', name);
                        label.textContent = name;
                        menu.style.display = 'none';
                    });
                });

                menu.style.display = 'block';
            } else {
                menu.style.display = 'none';
            }
        };

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!switcher.contains(e.target)) {
                menu.style.display = 'none';
            }
        });
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
                payDateDiv.textContent = formatDate(stats.next_pay_date) + (stats.is_pay_override ? ' ' + window.i18n.t('msg_manual') : '');
                
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
                const renderBar = (label, targetVal, recSpent, totalSpent, accentColor, indent) => {
                    const totalPct = targetVal > 0 ? Math.min((totalSpent / targetVal) * 100, 100) : 0;
                    const recPct = targetVal > 0 ? Math.min((recSpent / targetVal) * 100, 100) : 0;
                    const over = targetVal > 0 && recSpent > targetVal;
                    const color = over ? '#ff5630' : recPct >= 80 ? '#f59e0b' : '#10b981';
                    const borderLeft = accentColor ? `border-left:3px solid ${accentColor};` : '';
                    const marginLeft = indent ? 'margin-left:8px;' : '';

                    return `
                    <div class="stat-box" style="display:block; border-color:${color}66; background-color:${color}1a; cursor:pointer; margin-bottom:6px; ${borderLeft}${marginLeft}" onclick="window.app.loadView('budgets')">
                        <span class="stat-label" style="color:${color}; font-weight:600;">${label}</span>
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
                    if (!data || data.target <= 0) continue;

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
                            barsHtml += renderBar(subLabel, sub.target, sub.reconciled_expenses, sub.expenses, accent, subKeys.length > 1);
                        }
                    } else {
                        // Single bar for the whole period (original behavior)
                        barsHtml += renderBar(periodLabels[period] || period, data.target, data.reconciled_expenses, data.expenses, null, false);
                    }
                }

                barsContainer.innerHTML = barsHtml;
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
                        const txId = stats.overdraft_warning.transaction_id;
                        // Set pending highlight for AllOperationsView to pick up after data load
                        if (window.AllOperationsView) {
                            window.AllOperationsView._pendingHighlightTxId = txId;
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
    }
    
    showPayOverrideModal() {
        document.getElementById('payOverrideModal').style.display = 'flex';
    }
    
    showPayHistoryModal() {
        const tbody = document.getElementById('payHistoryTableBody');
        tbody.innerHTML = '';
        
        if (!this.payHistory || this.payHistory.length === 0) {
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 15px; color: var(--text-muted);">${window.i18n.t('msg_no_history')}</td></tr>`;
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
            showInlineMessage(window.i18n.t('title_info'), window.i18n.t('msg_save_error'));
        }
    }
    
    onQuickPayTypeChange(save = false) {
        const isBimonthly = document.getElementById('quickPayType').value === 'bimonthly';
        document.getElementById('quickPayDay2').style.display = isBimonthly ? 'block' : 'none';
        document.getElementById('lblQuickPayDay1').textContent = isBimonthly ? window.i18n.t('label_pay_days') : window.i18n.t('label_pay_day');
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

        // Destroy any active VirtualTable instances before swapping DOM
        if (window.TimelineView && window.TimelineView._vt) {
            window.TimelineView._vt.destroy();
            window.TimelineView._vt = null;
        }
        if (window.AllOperationsView && window.AllOperationsView._vt) {
            window.AllOperationsView._vt.destroy();
            window.AllOperationsView._vt = null;
        }
        
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
            main.innerHTML = `<h2>${window.i18n.t('nav_' + viewName)}</h2><p>${window.i18n.t('label_in_construction')}</p>`;
        }
        
        window.i18n.translateDOM(main);
    }

    // ── Changelog popup ──────────────────────────────────────────────
    async showChangelog() {
        const modal = document.getElementById('changelogModal');
        const body = document.getElementById('changelogBody');
        const versionEl = document.getElementById('changelogVersion');
        if (!modal || !body) return;

        body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);"><div class="loading-spinner" style="margin:0 auto 10px;"></div></div>`;
        versionEl.textContent = '';
        modal.style.display = 'flex';

        try {
            const version = this._appVersion || null;
            const url = version ? `/api/changelog?version=${version}` : '/api/changelog';
            const data = await API.get(url);

            versionEl.textContent = `Version ${data.version || '?'}${data.pub_date ? ' — ' + new Date(data.pub_date).toLocaleDateString() : ''}`;

            if (data.notes) {
                // Render markdown (marked.js is already loaded)
                const rawHtml = typeof marked?.parse === 'function' ? marked.parse(data.notes) : data.notes;
                const safeHtml = typeof DOMPurify?.sanitize === 'function' ? DOMPurify.sanitize(rawHtml) : rawHtml;
                body.innerHTML = `<div class="changelog-content" style="font-size:13px;line-height:1.8;">${safeHtml}</div>`;
                // Style markdown elements
                body.querySelectorAll('h1,h2,h3').forEach(h => { h.style.color = 'var(--text-color)'; h.style.marginTop = '16px'; h.style.marginBottom = '8px'; });
                body.querySelectorAll('ul').forEach(ul => { ul.style.paddingLeft = '20px'; });
                body.querySelectorAll('li').forEach(li => { li.style.marginBottom = '4px'; });
                body.querySelectorAll('code').forEach(c => { c.style.background = 'var(--bg-base)'; c.style.padding = '2px 6px'; c.style.borderRadius = '4px'; c.style.fontSize = '12px'; });
            } else {
                body.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px;">${window.i18n.t('changelog_no_notes')}</p>`;
            }
        } catch (e) {
            console.warn('[changelog] Failed to load:', e);
            body.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:20px;">${window.i18n.t('changelog_no_notes')}</p>`;
        }
    }

    closeChangelog() {
        const modal = document.getElementById('changelogModal');
        if (modal) modal.style.display = 'none';
    }
}

window.app = new App();
document.addEventListener('DOMContentLoaded', () => window.app.init());
