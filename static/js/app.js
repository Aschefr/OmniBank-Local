// app.js - Main orchestrator & core application lifecycle

// ── Bouclier global anti-fermeture accidentelle des modales ──
// Empêche la fermeture intempestive si l'utilisateur clique dans un input/texte et relâche en dehors
let _lastGlobalMouseDownTarget = null;
document.addEventListener('mousedown', (e) => {
    _lastGlobalMouseDownTarget = e.target;
}, true);

document.addEventListener('click', (e) => {
    const target = e.target;
    if (target && target.nodeType === 1) {
        const isOverlay = target.classList?.contains('modal-overlay') ||
                          target.classList?.contains('bv-modal-overlay') ||
                          target.classList?.contains('user-picker-overlay') ||
                          target.classList?.contains('review-modal-overlay') ||
                          (typeof target.className === 'string' && target.className.includes('modal-overlay')) ||
                          (target.id && (target.id.endsWith('Modal') || target.id.includes('ModalOverlay')));
        if (isOverlay) {
            // Si le mousedown a démarré à l'intérieur de la boîte modale et s'est relâché sur l'overlay
            if (_lastGlobalMouseDownTarget && _lastGlobalMouseDownTarget !== target && target.contains(_lastGlobalMouseDownTarget)) {
                e.stopImmediatePropagation();
                e.preventDefault();
            }
        }
    }
}, true);

window.hideAppInitLoader = function() {
    try {
        sessionStorage.removeItem('omni_switching_profile');
        const loader = document.getElementById('appInitLoader');
        if (loader && loader.style.display !== 'none') {
            loader.style.opacity = '0';
            setTimeout(() => { loader.style.display = 'none'; }, 300);
        }
    } catch (_) {}
};

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

    updateAiNavBadge(status) {
        // Nav badge disabled to prevent shifting top menu layout
        const badge = document.getElementById('aiGlobalNavBadge');
        if (badge) badge.style.display = 'none';
    }

    applyProfileTheme(colorHex) {
        if (!colorHex || !colorHex.startsWith('#')) colorHex = '#6366f1';

        let hex = colorHex.replace('#', '');
        if (hex.length === 3) {
            hex = hex.split('').map(c => c + c).join('');
        }
        const r = parseInt(hex.substring(0, 2), 16) || 99;
        const g = parseInt(hex.substring(2, 4), 16) || 102;
        const b = parseInt(hex.substring(4, 6), 16) || 241;

        const darkR = Math.max(0, Math.floor(r * 0.85));
        const darkG = Math.max(0, Math.floor(g * 0.85));
        const darkB = Math.max(0, Math.floor(b * 0.85));
        const hoverHex = `#${darkR.toString(16).padStart(2, '0')}${darkG.toString(16).padStart(2, '0')}${darkB.toString(16).padStart(2, '0')}`;

        const lightR = Math.min(255, Math.floor(r + (255 - r) * 0.45));
        const lightG = Math.min(255, Math.floor(g + (255 - g) * 0.45));
        const lightB = Math.min(255, Math.floor(b + (255 - b) * 0.45));

        const highlightR = Math.min(255, Math.floor(r + (255 - r) * 0.75));
        const highlightG = Math.min(255, Math.floor(g + (255 - g) * 0.75));
        const highlightB = Math.min(255, Math.floor(b + (255 - b) * 0.75));

        let styleEl = document.getElementById('dynamicProfileThemeStyle');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'dynamicProfileThemeStyle';
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
            :root, body, .theme-dark, body.theme-dark, body.theme-classic-dark, body.theme-classic-light, body.theme-titanium-dark, body.theme-titanium-light, .theme-titanium-dark, .theme-titanium-light {
                --accent: ${colorHex} !important;
                --accent-hover: ${hoverHex} !important;
                --accent-rgb: ${r}, ${g}, ${b} !important;
                --accent-subtle: rgba(${r}, ${g}, ${b}, 0.18) !important;
                --accent-border: rgba(${r}, ${g}, ${b}, 0.35) !important;
                --color-primary: ${colorHex} !important;
                --color-primary-hover: ${hoverHex} !important;
                --color-primary-light: ${hoverHex} !important;
            }
            .theme-light, body.theme-light, body.theme-ios-glass {
                --accent: ${hoverHex} !important;
                --accent-hover: ${hoverHex} !important;
                --accent-rgb: ${r}, ${g}, ${b} !important;
                --accent-subtle: rgba(${r}, ${g}, ${b}, 0.12) !important;
                --accent-border: rgba(${r}, ${g}, ${b}, 0.3) !important;
                --color-primary: ${hoverHex} !important;
                --color-primary-hover: ${hoverHex} !important;
                --color-primary-light: ${hoverHex} !important;
            }
        `;
    }

    async loadAppVersion() {
        if (this._appVersionLoaded) return;
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
                version = vData ? vData.version : null;
            }
            const badge = document.getElementById('appVersionBadge');
            if (badge && version && version !== '?') {
                badge.textContent = `v${version}`;
                this._appVersion = version;
                this._appVersionLoaded = true;
                // Auto-show changelog after update (one-time per version)
                if (window.ProfileStorage) {
                    const lastSeen = window.ProfileStorage.get('omni_last_seen_version');
                    if (lastSeen && lastSeen !== version) {
                        // Version changed (or first time feature is seen) → show changelog after UI loads
                        setTimeout(() => this.showChangelog(), 1500);
                    }
                    window.ProfileStorage.set('omni_last_seen_version', version);
                }
            }
        } catch (e) {
            console.warn('[version] All version checks failed', e);
        }
    }

    async init() {
        // Safety timeout to ensure appInitLoader can never freeze the screen
        setTimeout(() => {
            window.hideAppInitLoader();
            const container = document.querySelector('.app-container');
            if (container && container.style.opacity !== '1') container.style.opacity = '1';
        }, 5000);

        try {
            // Init i18n
            await window.i18n.init();

            // Parallel load of core metadata (version, profiles, global config)
            const [versionRes, pDataRes, configRes] = await Promise.allSettled([
                this.loadAppVersion(),
                API.get('/api/profiles/'),
                API.get('/api/config/')
            ]);

            // Init Master Profiles
            if (pDataRes.status === 'fulfilled' && pDataRes.value) {
                const pData = pDataRes.value;
                this.activeProfileId = pData.active_profile_id;
                this.profiles = pData.profiles || [];
                if (window.ProfileStorage) {
                    window.ProfileStorage.init(this.activeProfileId);
                }
                const activeProf = this.profiles.find(p => p.id === this.activeProfileId);
                if (activeProf && activeProf.color) {
                    this.applyProfileTheme(activeProf.color);
                }
                this._renderProfileSelector();
                this.initAutoLock();
                if (window.FormView && window.FormView.checkPendingCrossTransfers) {
                    window.FormView.checkPendingCrossTransfers();
                }
            } else {
                console.error("Failed to load profiles", pDataRes.reason);
            }

            // Load Global Config
            if (configRes.status === 'fulfilled' && configRes.value) {
                this.config = configRes.value;
                if (this.config && this.config.base_currency) {
                    window.appBaseCurrency = this.config.base_currency;
                }
            } else {
                console.error("Failed to load global config", configRes.reason);
                this.config = {};
            }
            
            // ── Phase 8: Check if first launch / empty DB ──
            if (window.SetupWizard) {
                const wizardShown = await window.SetupWizard.checkAndShow();
                if (wizardShown) {
                    // Reveal UI behind wizard (for theme consistency)
                    window.hideAppInitLoader();
                    const container = document.querySelector('.app-container');
                    if (container) container.style.opacity = '1';
                    return; // Wizard handles the rest
                }
            }
            
            // ── Phase 9: Check if org mode needs user selection ──
            if (this.config.enable_org_mode === 'true') {
                const savedUser = sessionStorage.getItem('omni_current_user');
                if (!savedUser) {
                    // Ensure default user exists
                    try { await API.post('/api/org_users/ensure_default'); } catch (e) {}
                    window.hideAppInitLoader();
                    await this._showUserPicker();
                    return; // Blocks until user selected
                }
                this.currentUser = savedUser;
            }
            
            await this._initUI();
        } catch (e) {
            console.error('[App] init() fatal error — forcing UI reveal:', e);
            const container = document.querySelector('.app-container');
            if (container) container.style.opacity = '1';
            window.hideAppInitLoader();
        }
    }

    async _initUI() {
        if (this._uiInitialized) return;
        this._uiInitialized = true;
        if (!this._appVersionLoaded) {
            await this.loadAppVersion();
        }
        try {
        // Theme toggle
        // Theme Manager Initialization
        if (window.ThemeManager) {
            window.ThemeManager.init();
        } else {
            const savedTheme = ProfileStorage.get('omni_theme') || 'dark';
            if (savedTheme === 'light') {
                document.body.classList.remove('theme-dark');
            } else {
                document.body.classList.add('theme-dark');
            }
        }
        
        // Privacy toggle
        const privacyToggle = document.getElementById('privacyToggle');
        if (privacyToggle) {
            if (ProfileStorage.get('omni_privacy') === 'true') {
                document.body.classList.add('privacy-mode');
                privacyToggle.textContent = '🙈';
                privacyToggle.classList.add('toggle-active');
            }
            
            privacyToggle.addEventListener('click', () => {
                document.body.classList.toggle('privacy-mode');
                const isPrivate = document.body.classList.contains('privacy-mode');
                privacyToggle.textContent = isPrivate ? '🙈' : '👁️';
                privacyToggle.classList.toggle('toggle-active', isPrivate);
                ProfileStorage.set('omni_privacy', isPrivate);
            });
        }
        
        // Compact mode toggle
        const compactToggle = document.getElementById('compactToggle');
        const svgNormal = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect y="2" width="16" height="2.5" rx="1"/><rect y="7" width="16" height="2.5" rx="1"/><rect y="12" width="16" height="2.5" rx="1"/></svg>';
        const svgCompact = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect y="1" width="16" height="1.5" rx=".75"/><rect y="5" width="16" height="1.5" rx=".75"/><rect y="9" width="16" height="1.5" rx=".75"/><rect y="13" width="16" height="1.5" rx=".75"/></svg>';
        if (compactToggle) {
            const savedCompact = (typeof ProfileStorage !== 'undefined' && ProfileStorage.get) ? ProfileStorage.get('omni_compact') : localStorage.getItem('omni_compact');
            if (savedCompact === 'true' || savedCompact === true) {
                document.body.classList.add('compact-mode');
                compactToggle.innerHTML = svgCompact;
                compactToggle.classList.add('toggle-active');
            }
            
            compactToggle.addEventListener('click', () => {
                document.body.classList.toggle('compact-mode');
                const isCompact = document.body.classList.contains('compact-mode');
                compactToggle.innerHTML = isCompact ? svgCompact : svgNormal;
                compactToggle.classList.toggle('toggle-active', isCompact);
                if (typeof ProfileStorage !== 'undefined' && ProfileStorage.set) {
                    ProfileStorage.set('omni_compact', isCompact);
                }
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
        
        this.updateMobileLangUI();
        this.updateDesktopLangUI();

        // Check running bank sync tasks on app load / F5
        if (window.BankSyncView && typeof window.BankSyncView.checkBackgroundSyncStatus === 'function') {
            window.BankSyncView.checkBackgroundSyncStatus();
        }
        this.populateLangDropdown();

        if (langToggleBtn && langMenu) {
            langToggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                langMenu.style.display = langMenu.style.display === 'none' ? 'block' : 'none';
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
            const closeSidebar = () => {
                sidebar.classList.remove('mobile-open');
                overlay.classList.remove('active');
                document.body.style.overflow = '';
            };

            mobileBtn.addEventListener('click', () => {
                const isOpen = sidebar.classList.contains('mobile-open');
                if (isOpen) {
                    closeSidebar();
                } else {
                    sidebar.classList.add('mobile-open');
                    overlay.classList.add('active');
                    document.body.style.overflow = 'hidden';
                }
            });
            overlay.addEventListener('click', closeSidebar);
            const closeBtn = document.getElementById('sidebarCloseBtn');
            if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
            // Close sidebar when clicking a nav button on mobile
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.addEventListener('click', closeSidebar);
            });
        }
        
        // Feature Toggles Nav Visibility
        this.updateNavToggles();

        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.loadView(e.currentTarget.getAttribute('data-view'));
            });
        });

        // Horizontal mouse-wheel scroll support on desktop main-nav
        const mainNav = document.querySelector('.main-nav');
        if (mainNav) {
            mainNav.addEventListener('wheel', (e) => {
                if (e.deltaY !== 0 && mainNav.scrollWidth > mainNav.clientWidth) {
                    e.preventDefault();
                    mainNav.scrollLeft += e.deltaY;
                }
            }, { passive: false });
        }

        // Prevent mouse back/forward buttons & keyboard shortcuts to avoid app navigation bug in Tauri
        window.addEventListener('mousedown', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
        window.addEventListener('mouseup', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
        window.addEventListener('keydown', (e) => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.preventDefault(); });

        // Initial Load (Sidebar accounts & Pending bank sync in parallel)
        await Promise.allSettled([
            this.refreshSidebar(),
            (window.BankSyncView && window.BankSyncView.loadPendingSync) 
                ? window.BankSyncView.loadPendingSync().catch(e => console.warn('[BankSync] Initial pending sync load failed:', e))
                : Promise.resolve()
        ]);

        // Restore view from ProfileStorage
        let savedView = ProfileStorage.get('omni_current_view') || this.currentView;
        // If overview is enabled and no saved view, default to overview
        if (!ProfileStorage.get('omni_current_view') && this.config.enable_overview === 'true') {
            savedView = 'overview';
        }
        await this.loadView(savedView);

        } catch (uiError) {
            console.error('[App] _initUI error:', uiError);
        } finally {
            // Reveal UI after init is complete (prevents FOUC)
            const container = document.querySelector('.app-container');
            if (container) container.style.opacity = '1';
            window.hideAppInitLoader();
        }
        
        // Phase 9: Init user switcher if org mode
        this._initUserSwitcher();

        // Init Notification Center
        this._initNotifications();

        // Reactive EventBus Data Sync (Automatic sidebar refresh on mutations)
        if (window.EventBus) {
            let _sidebarDebounceTimer = null;
            window.EventBus.on('data:mutated', (detail) => {
                const ep = detail?.endpoint || '';
                // Ignorer les endpoints non financiers (ex: chat, logs, feedback)
                if (ep.includes('/chat/') || ep.includes('/feedback') || ep.includes('/log_action') || ep.includes('/diagnostics')) {
                    return;
                }
                clearTimeout(_sidebarDebounceTimer);
                _sidebarDebounceTimer = setTimeout(() => {
                    this.refreshSidebar().catch(e => console.warn('[App] EventBus refreshSidebar error:', e));
                }, 50);
            });
        }

        // Setup Undo / Redo Header Buttons
        const undoBtn = document.getElementById('headerUndoBtn');
        const redoBtn = document.getElementById('headerRedoBtn');
        if (undoBtn) {
            undoBtn.onclick = async () => {
                try {
                    undoBtn.disabled = true;
                    const res = await API.post('/api/history/undo_last');
                    if (res.ok) {
                        showToast(window.i18n.t('history_undo_success') || 'Action annulée', 'success');
                        if (res.warning) {
                            const warningMsg = window.i18n.t(`history_undo_warning_cascade`) || 'Warning: cascade entities modified.';
                            setTimeout(() => showToast(warningMsg, 'info', 6000), 1000);
                        }
                        this.updateHeaderHistoryState();
                        this.loadView(this.currentView);
                        await this.refreshSidebar();
                    }
                } catch (e) {
                    showToast("Failed to undo", 'error');
                    this.updateHeaderHistoryState();
                }
            };
        }
        if (redoBtn) {
            redoBtn.onclick = async () => {
                try {
                    redoBtn.disabled = true;
                    const res = await API.post('/api/history/redo_last');
                    if (res.ok) {
                        showToast(window.i18n.t('history_redo_success') || 'Action rétablie avec succès.', 'success');
                        this.updateHeaderHistoryState();
                        this.loadView(this.currentView);
                        await this.refreshSidebar();
                    }
                } catch (e) {
                    showToast("Failed to redo", 'error');
                    this.updateHeaderHistoryState();
                }
            };
        }
        this.updateHeaderHistoryState();
    }

    async refreshAll() {
        await this.refreshSidebar();
        if (this.currentView && this.views[this.currentView] && typeof this.views[this.currentView].init === 'function') {
            await this.views[this.currentView].init();
        } else if (this.currentView) {
            this.loadView(this.currentView);
        }
    }

    refreshCurrentView() {
        if (this.currentView) {
            this.loadView(this.currentView);
        }
    }

    loadView(viewName) {
        if (viewName === 'accounts_manager') {
            viewName = 'accounts';
        }
        if (viewName === 'bank_sync_pending') {
            viewName = 'dashboard';
            setTimeout(() => {
                if (window.BankSyncView && typeof window.BankSyncView.openPendingReviewModal === 'function') {
                    window.BankSyncView.openPendingReviewModal();
                }
            }, 100);
        }
        if (viewName === 'simulator' && this.config.enable_simulator === 'false') {
            viewName = 'dashboard';
        }
        this.currentView = viewName;

        if (window.ErrorReporter && typeof window.ErrorReporter.recordBreadcrumb === 'function') {
            window.ErrorReporter.recordBreadcrumb('NAV', `Navigated to view: ${viewName}`);
        }

        ProfileStorage.set('omni_current_view', viewName);
        this.updateHeaderHistoryState();
        
        // Update nav buttons active state
        document.querySelectorAll('.nav-btn').forEach(b => {
            if (b.getAttribute('data-view') === viewName) {
                b.classList.add('active');
                if (b.closest('.main-nav')) {
                    b.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                }
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
        // Abort active chat stream only when switching AWAY from chat
        if (viewName !== 'chat' && window.ChatView && window.ChatView.destroy) {
            window.ChatView.destroy();
        }
        // Destroy overview chart when switching away
        if (viewName !== 'overview' && window.OverviewView && window.OverviewView.destroy) {
            window.OverviewView.destroy();
        }

        // Fullscreen toggle for overview
        if (viewName === 'overview') {
            document.body.classList.add('overview-fullscreen');
        } else {
            document.body.classList.remove('overview-fullscreen');
        }
        
        if (main) {
            main.scrollTop = 0;
        }
        window.scrollTo(0, 0);

        if (viewName === 'overview' && window.OverviewView) {
            main.innerHTML = window.OverviewView.render();
            window.OverviewView.init();
        } else if (viewName === 'dashboard' && window.TimelineView) {
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
        } else if (viewName === 'simulator' && window.SimulatorView) {
            main.innerHTML = window.SimulatorView.render();
            window.SimulatorView.init();
        } else if (viewName === 'history' && window.HistoryView) {
            main.innerHTML = window.HistoryView.render();
            window.HistoryView.init();
        } else if (viewName === 'bank_sync' && window.BankSyncView) {
            main.innerHTML = window.BankSyncView.render();
            window.BankSyncView.init();

        } else {
            main.innerHTML = `<h2>${window.i18n.t('nav_' + viewName)}</h2><p>${window.i18n.t('label_in_construction')}</p>`;
        }
        
        window.i18n.translateDOM(main);

        // Re-apply import button AI state after view re-render
        if (window.ImportWizard && window.ImportWizard._setImportBtnState) {
            if (window.ImportWizard._pendingAIResult) {
                window.ImportWizard._setImportBtnState('ready');
            } else if (window.ImportWizard._aiAbortController && !window.ImportWizard._aiAborted) {
                window.ImportWizard._setImportBtnState('working');
            }
        }

        // Re-apply bank sync button animation state across views
        if (window.BankSyncView && typeof window.BankSyncView.applySyncButtonsState === 'function') {
            window.BankSyncView.applySyncButtonsState();
        }
    }

    async scrollToBudget(budgetId, viewName = 'budgets') {
        if (this.currentView !== viewName) {
            this.loadView(viewName);
        }
        const startTime = Date.now();
        const poll = () => {
            const card = document.querySelector(`[data-budget-id="${budgetId}"]`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                card.classList.add('budget-card-highlight-flash');
                setTimeout(() => {
                    card.classList.remove('budget-card-highlight-flash');
                }, 3000);
            } else if (Date.now() - startTime < 3000) {
                setTimeout(poll, 100);
            }
        };
        poll();
    }

    async scrollToBudgetSection(period, accKey = '__global__', viewName = 'budgets') {
        if (this.currentView !== viewName) {
            this.loadView(viewName);
        }
        const startTime = Date.now();
        const poll = () => {
            let target = document.querySelector(`[data-budget-period-sub="${period}-${accKey}"]`);
            if (!target) {
                target = document.querySelector(`[data-budget-period="${period}"]`);
            }
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('budget-card-highlight-flash');
                setTimeout(() => {
                    target.classList.remove('budget-card-highlight-flash');
                }, 3000);
            } else if (Date.now() - startTime < 3000) {
                setTimeout(poll, 100);
            }
        };
        poll();
    }

    async navigateToDiagnostics() {
        if (this.currentView !== 'config') {
            this.loadView('config');
        }
        const startTime = Date.now();
        const poll = () => {
            const el = document.getElementById('configDiagSection') || document.querySelector('[data-i18n="config_diag_title"]')?.closest('div');
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.remove('section-highlight-flash');
                void el.offsetWidth; // force DOM reflow
                el.classList.add('section-highlight-flash');
                setTimeout(() => {
                    el.classList.remove('section-highlight-flash');
                }, 3500);
            } else if (Date.now() - startTime < 3500) {
                setTimeout(poll, 80);
            }
        };
        setTimeout(poll, 120);
    }

    async updateHeaderHistoryState() {
        try {
            const status = await API.get('/api/history/status');
            const undoBtn = document.getElementById('headerUndoBtn');
            const redoBtn = document.getElementById('headerRedoBtn');
            
            if (undoBtn) {
                undoBtn.disabled = !status.can_undo;
                undoBtn.style.opacity = status.can_undo ? "1" : "0.4";
                undoBtn.style.cursor = status.can_undo ? "pointer" : "not-allowed";
                undoBtn.title = status.can_undo && status.undo
                    ? `${window.i18n.t('history_undo_prefix')} : ${window.formatHistoryLabel(status.undo)}`
                    : window.i18n.t('history_nothing_to_undo');
            }
            if (redoBtn) {
                redoBtn.disabled = !status.can_redo;
                redoBtn.style.opacity = status.can_redo ? "1" : "0.4";
                redoBtn.style.cursor = status.can_redo ? "pointer" : "not-allowed";
                redoBtn.title = status.can_redo && status.redo
                    ? `${window.i18n.t('history_redo_prefix')} : ${window.formatHistoryLabel(status.redo)}`
                    : window.i18n.t('history_nothing_to_redo');
            }
        } catch (e) {
            console.warn('[history] Failed to update header state', e);
        }
    }
}

// ── Assemblage modulaire sur la classe App ──
if (window.AppModules) {
    Object.values(window.AppModules).forEach(mod => {
        Object.assign(App.prototype, mod);
    });
}

window.app = new App();
window.navigateToDiagnostics = () => window.app?.navigateToDiagnostics();
document.addEventListener('DOMContentLoaded', () => window.app.init());
