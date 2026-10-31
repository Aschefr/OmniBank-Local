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
                const vData = await API.get('/api/version', { silent: true });
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
                if (window.ServerConfig && typeof window.ServerConfig.openModal === 'function') {
                    window.hideAppInitLoader();
                    const container = document.querySelector('.app-container');
                    if (container) container.style.opacity = '1';
                    window.ServerConfig.openModal({ autoScan: true });
                }
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
                const savedUser = (window.ProfileSessionStorage ? window.ProfileSessionStorage.getItem('omni_current_user') : sessionStorage.getItem('omni_current_user'));
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
                const isVisible = window.getComputedStyle(langMenu).display !== 'none';
                langMenu.style.display = isVisible ? 'none' : 'block';
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

        // Initial Load (Sidebar accounts, Pending bank sync & Bank connections in parallel)
        await Promise.allSettled([
            this.refreshSidebar(),
            (window.BankSyncView && window.BankSyncView.loadPendingSync) 
                ? window.BankSyncView.loadPendingSync().catch(e => console.warn('[BankSync] Initial pending sync load failed:', e))
                : Promise.resolve(),
            (window.BankSyncView && window.BankSyncView.ensureSyncButtonsVisibility)
                ? window.BankSyncView.ensureSyncButtonsVisibility().catch(e => console.warn('[BankSync] Initial sync buttons visibility check failed:', e))
                : Promise.resolve()
        ]);

        // Restore view from ProfileStorage
        // First visit opens the Cockpit
        let savedView = ProfileStorage.get('omni_current_view') || 'overview';
        await this.loadView(savedView);

        // Horodatage d'initialisation pour éviter les faux rebonds visibilitychange au premier affichage mobile
        this._bootTime = Date.now();
        this._lastActiveViewRefreshAt = Date.now();

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

        // Reactive EventBus Data Sync (Automatic sidebar & active view refresh on mutations)
        if (window.EventBus) {
            let _mutationDebounceTimer = null;
            window.EventBus.on('data:mutated', (detail) => {
                const ep = detail?.endpoint || '';
                // Ignorer les endpoints non financiers ou bac à sable (chat, logs, feedback, diagnostics, simulator, config UI, utilitaires IA)
                if (ep.includes('/chat/') || 
                    ep.includes('/feedback') || 
                    ep.includes('/log_action') || 
                    ep.includes('/diagnostics') ||
                    ep.includes('/simulator/') ||
                    ep.includes('/config') ||
                    ep.includes('/ai/categorize') ||
                    ep.includes('/smart-labels/')) {
                    return;
                }
                clearTimeout(_mutationDebounceTimer);
                _mutationDebounceTimer = setTimeout(() => {
                    this.refreshSidebar().catch(e => console.warn('[App] EventBus refreshSidebar error:', e));
                    this.refreshActiveView().catch(e => console.warn('[App] EventBus refreshActiveView error:', e));
                }, 100);
            });
        }

        // Global Real-Time Reactivity Listeners (Zero F5)
        const reactiveRefreshHandler = () => this.refreshActiveView();
        window.addEventListener('transactions_updated', reactiveRefreshHandler);
        window.addEventListener('transactions_changed', reactiveRefreshHandler);
        window.addEventListener('transactions-changed', reactiveRefreshHandler);
        window.addEventListener('transactions:refresh', reactiveRefreshHandler);
        window.addEventListener('bank_sync_completed', () => {
            this.updateAutopilotBadge();
            this.refreshActiveView();
        });
        window.addEventListener('autopilot_updated', () => {
            this.updateAutopilotBadge();
            this.refreshActiveView();
        });
        window.addEventListener('budgets:refresh', reactiveRefreshHandler);
        window.addEventListener('timeline:refresh', reactiveRefreshHandler);
        window.addEventListener('categoriesUpdated', reactiveRefreshHandler);
        window.addEventListener('categories-changed', reactiveRefreshHandler);
        window.addEventListener('recurrences:updated', reactiveRefreshHandler);

        // Document visibility change (Alt-Tab, smartphone 2FA return)
        document.addEventListener('visibilitychange', async () => {
            if (document.hidden) return;
            const now = Date.now();
            // Période de grâce de 4s après le chargement initial pour ignorer les micro-transitions de rendu mobile
            if (now - (this._bootTime || 0) < 4000) return;
            // Cooldown de 3s pour éviter les multi-rechargements intempestifs
            if (now - (this._lastActiveViewRefreshAt || 0) < 3000) return;

            this._lastActiveViewRefreshAt = now;
            this._accelerateSyncWatcher();
            await Promise.all([
                this.refreshActiveView(),
                this.refreshSidebar(),
                this.updateAutopilotBadge(),
                typeof this.loadNotifications === 'function' ? this.loadNotifications(true) : Promise.resolve()
            ]).catch(e => console.warn('[App] Visibility refresh error:', e));
        });

        // Initialize global bank sync & auto-pilot watcher
        this._initGlobalSyncWatcher();

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
        this.updateAutopilotBadge();
    }

    async updateAutopilotBadge() {
        try {
            const status = await API.get('/api/autopilot/status', { silent: true });
            const reviewCount = status ? (status.review_queue_count || 0) : 0;
            const unseenReviewCount = status ? (status.unseen_review_count ?? 0) : 0;
            
            const desktopIcon = document.getElementById('autopilotNavIcon') || document.querySelector('button[data-view="autopilot"] svg');
            const mobileIcon = document.getElementById('autopilotMobileNavIcon') || document.querySelector('.mobile-nav button[data-view="autopilot"] svg');
            
            // Attirer l'oeil (ambre + lueur) uniquement s'il y a de nouvelles opérations à vérifier non encore consultées
            const isCurrentlyOnAutopilotView = (this.currentView === 'autopilot');
            const shouldAlert = !isCurrentlyOnAutopilotView && unseenReviewCount > 0;
            const iconColor = shouldAlert ? '#f59e0b' : '';
            
            let tooltip = '';
            if (shouldAlert) {
                tooltip = `${unseenReviewCount} nouvelle(s) opération(s) à vérifier`;
            } else if (reviewCount > 0) {
                tooltip = `${reviewCount} opération(s) à vérifier`;
            }

            [desktopIcon, mobileIcon].forEach(icon => {
                if (icon) {
                    icon.style.stroke = iconColor;
                    if (shouldAlert) {
                        icon.style.filter = 'drop-shadow(0 0 3px rgba(245, 158, 11, 0.6))';
                        icon.setAttribute('title', tooltip);
                    } else {
                        icon.style.filter = '';
                        if (tooltip) {
                            icon.setAttribute('title', tooltip);
                        } else {
                            icon.removeAttribute('title');
                        }
                    }
                }
            });

            const navBtns = document.querySelectorAll('button[data-view="autopilot"]');
            navBtns.forEach(btn => {
                if (tooltip) {
                    btn.setAttribute('title', `Auto-Pilote (${tooltip})`);
                } else {
                    btn.removeAttribute('title');
                }
            });
        } catch (e) {
            // Silently ignore during initial boot
        }
    }

    _refreshActiveViewInFlight = false;
    _queuedRefreshActiveView = false;
    _lastActiveViewRefreshAt = 0;
    _activeViewDebounceTimer = null;

    async refreshActiveView(options = {}) {
        const { highlightTxId = null, force = false, immediate = false } = options;
        
        if (!immediate) {
            clearTimeout(this._activeViewDebounceTimer);
            return new Promise((resolve) => {
                this._activeViewDebounceTimer = setTimeout(async () => {
                    const res = await this.refreshActiveView({ highlightTxId, force, immediate: true });
                    resolve(res);
                }, 100);
            });
        }

        if (this._refreshActiveViewInFlight) {
            this._queuedRefreshActiveView = true;
            return;
        }
        this._refreshActiveViewInFlight = true;
        this._lastActiveViewRefreshAt = Date.now();

        const curView = this.currentView;
        try {
            if (curView === 'overview' && window.OverviewView) {
                await (window.OverviewView.loadData ? window.OverviewView.loadData() : window.OverviewView.init());
                if (highlightTxId && typeof window.OverviewView.highlightRow === 'function') {
                    requestAnimationFrame(() => window.OverviewView.highlightRow(highlightTxId));
                }
            } else if ((curView === 'dashboard' || curView === 'timeline') && window.TimelineView) {
                if (typeof window.TimelineView.loadData === 'function') {
                    await window.TimelineView.loadData();
                    if (highlightTxId && typeof window.TimelineView.highlightRow === 'function') {
                        requestAnimationFrame(() => window.TimelineView.highlightRow(highlightTxId));
                    }
                }
            } else if (curView === 'all_operations' && window.AllOperationsView) {
                if (typeof window.AllOperationsView.loadData === 'function') {
                    await window.AllOperationsView.loadData();
                    if (highlightTxId && typeof window.AllOperationsView.highlightRow === 'function') {
                        requestAnimationFrame(() => window.AllOperationsView.highlightRow(highlightTxId));
                    }
                }
            } else if (curView === 'accounts' && window.AccountsView) {
                if (typeof window.AccountsView.loadData === 'function') {
                    await window.AccountsView.loadData();
                }
            } else if (curView === 'budgets' && window.BudgetsView) {
                await Promise.all([
                    typeof window.BudgetsView.loadBudgets === 'function' ? window.BudgetsView.loadBudgets() : Promise.resolve(),
                    typeof window.BudgetsView.loadCategories === 'function' ? window.BudgetsView.loadCategories() : Promise.resolve(),
                    typeof window.BudgetsView.loadAllStatuses === 'function' ? window.BudgetsView.loadAllStatuses() : Promise.resolve(),
                    typeof window.BudgetsView.loadAutopilotSuggestions === 'function' ? window.BudgetsView.loadAutopilotSuggestions() : Promise.resolve()
                ]);
                if (typeof window.BudgetsView.renderStatus === 'function') {
                    window.BudgetsView.renderStatus();
                }
            } else if (curView === 'autopilot' && window.AutopilotView) {
                if (typeof window.AutopilotView.refresh === 'function') {
                    await window.AutopilotView.refresh();
                }
            } else if (curView === 'analytics' && window.AnalyticsView) {
                if (typeof window.AnalyticsView.loadData === 'function') {
                    await window.AnalyticsView.loadData();
                }
            } else if (curView === 'trends' && window.TrendsView) {
                if (typeof window.TrendsView.loadData === 'function') {
                    await window.TrendsView.loadData();
                }
            } else if (curView === 'recurrences' && window.RecurrenceView) {
                if (typeof window.RecurrenceView.loadData === 'function') {
                    await window.RecurrenceView.loadData();
                }
            } else if (curView === 'simulator' && window.SimulatorView) {
                if (typeof window.SimulatorView.loadData === 'function') {
                    await window.SimulatorView.loadData();
                }
            } else if (curView === 'categories' && window.CategoriesView) {
                if (typeof window.CategoriesView.loadData === 'function') {
                    await window.CategoriesView.loadData();
                }
            } else if (curView === 'history' && window.HistoryView) {
                if (typeof window.HistoryView.loadActions === 'function') {
                    await window.HistoryView.loadActions();
                }
            }

            this.updateHeaderHistoryState();
            if (window.BankSyncView && typeof window.BankSyncView.ensureSyncButtonsVisibility === 'function') {
                window.BankSyncView.ensureSyncButtonsVisibility();
            }
        } catch (err) {
            console.warn(`[App] Erreur lors du refreshActiveView (${curView}):`, err);
        } finally {
            this._refreshActiveViewInFlight = false;
            if (this._queuedRefreshActiveView) {
                this._queuedRefreshActiveView = false;
                this.refreshActiveView({ highlightTxId, force, immediate: true });
            }
        }
    }

    _syncWatcherTimer = null;
    _lastSyncExecutionAt = null;
    _isSyncRunning = false;

    _initGlobalSyncWatcher() {
        if (this._syncWatcherTimer) return;

        const checkStatus = async () => {
            try {
                if (document.hidden) {
                    this._syncWatcherTimer = setTimeout(checkStatus, 15000);
                    return;
                }

                const status = await API.get('/api/autopilot/status', { silent: true }).catch(() => null);
                if (!status) {
                    this._syncWatcherTimer = setTimeout(checkStatus, 10000);
                    return;
                }

                const prevIsSyncing = this._isSyncRunning;
                const currentIsSyncing = Boolean(status.is_syncing);
                const currentLastExec = status.last_bank_sync_at || status.last_execution_at || null;
                const remSec = status.next_execution_countdown_seconds;

                this._isSyncRunning = currentIsSyncing;

                const execChanged = (this._lastSyncExecutionAt && currentLastExec && this._lastSyncExecutionAt !== currentLastExec);
                const syncJustCompleted = (prevIsSyncing && !currentIsSyncing) || execChanged;

                if (syncJustCompleted) {
                    this._lastSyncExecutionAt = currentLastExec;
                    console.info('[App] Synchronisation automatique terminée détectée. Actualisation réactive globale (Zero F5)...');

                    window.dispatchEvent(new CustomEvent('bank_sync_completed'));
                    window.dispatchEvent(new CustomEvent('autopilot_updated'));
                    window.dispatchEvent(new CustomEvent('transactions_updated'));

                    await Promise.all([
                        this.refreshActiveView(),
                        this.refreshSidebar()
                    ]);
                    this.updateAutopilotBadge();
                    if (typeof this.loadNotifications === 'function') {
                        this.loadNotifications(true);
                    }
                    if (window.BankSyncView && typeof window.BankSyncView.setButtonsState === 'function') {
                        window.BankSyncView.setButtonsState('idle');
                    }
                    if (window.BankSyncView && typeof window.BankSyncView.loadConnections === 'function') {
                        window.BankSyncView.loadConnections().catch(() => {});
                    }
                } else if (!this._lastSyncExecutionAt && currentLastExec) {
                    this._lastSyncExecutionAt = currentLastExec;
                }

                if (remSec !== null && remSec <= 0 && status.is_enabled && status.bank_auto_sync_enabled && status.vault_unlocked && !currentIsSyncing) {
                    if (this.currentView !== 'autopilot') {
                        API.post('/api/bank-sync/trigger-auto-sync', { force: false, trigger_source: 'scheduled' }, { silent: true }).catch(() => {});
                    }
                }

                const nextInterval = (currentIsSyncing || (remSec !== null && remSec <= 2)) ? 1500 : 10000;
                this._syncWatcherTimer = setTimeout(checkStatus, nextInterval);
            } catch (err) {
                this._syncWatcherTimer = setTimeout(checkStatus, 12000);
            }
        };

        this._syncWatcherTimer = setTimeout(checkStatus, 2500);
    }

    _accelerateSyncWatcher() {
        if (this._syncWatcherTimer) {
            clearTimeout(this._syncWatcherTimer);
            this._syncWatcherTimer = null;
        }
        this._initGlobalSyncWatcher();
    }

    async refreshAll() {
        await Promise.all([
            this.refreshSidebar(),
            this.refreshActiveView(),
            this.updateAutopilotBadge()
        ]);
    }

    onLogoClick(e) {
        if (e) e.preventDefault();
        this.loadView('overview');
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
        // The former full dashboard ('overview_full') is retired: saved views and old links open the Cockpit.
        if (viewName === 'overview_full') viewName = 'overview';
        const navView = viewName;
        if (viewName === 'overview') {
            ProfileStorage.set('overview_display_mode', 'cockpit');
            if (this.config) this.config.overview_display_mode = 'cockpit';
            if (window.OverviewView) window.OverviewView._displayMode = 'cockpit';
        }
        this.currentView = viewName;

        if (window.ErrorReporter && typeof window.ErrorReporter.recordBreadcrumb === 'function') {
            window.ErrorReporter.recordBreadcrumb('NAV', `Navigated to view: ${viewName}`);
        }

        ProfileStorage.set('omni_current_view', navView);
        this.updateHeaderHistoryState();
        
        // Update nav buttons active state
        document.querySelectorAll('.nav-btn').forEach(b => {
            if (b.getAttribute('data-view') === navView) {
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
        // Destroy simulator chart when switching away
        if (viewName !== 'simulator' && window.SimulatorView && window.SimulatorView.destroy) {
            window.SimulatorView.destroy();
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
        } else if (viewName === 'autopilot' && window.AutopilotView) {
            main.innerHTML = window.AutopilotView.render();
            window.AutopilotView.init();
            this.updateAutopilotBadge();
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
        if (window.BudgetsView) {
            window.BudgetsView._pendingHighlightId = budgetId;
        }
        if (this.currentView !== viewName) {
            this.loadView(viewName);
        } else if (window.BudgetsView && typeof window.BudgetsView._highlightBudget === 'function') {
            window.BudgetsView._highlightBudget(budgetId, null);
        }
    }

    async scrollToBudgetSection(period, accKey = '__global__', viewName = 'budgets') {
        const subKey = `${period}-${accKey}`;
        if (window.BudgetsView) {
            window.BudgetsView._pendingHighlightPeriod = period;
            window.BudgetsView._pendingHighlightPeriodSub = subKey;
        }
        if (this.currentView !== viewName) {
            this.loadView(viewName);
        } else if (window.BudgetsView && typeof window.BudgetsView._highlightSection === 'function') {
            window.BudgetsView._highlightSection(period, subKey);
        }
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
            const status = await API.get('/api/history/status', { silent: true });
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
window.handleReviewClick = function(txId, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (window.app) {
        if (window.app.currentView === 'autopilot' && window.AutopilotView && typeof window.AutopilotView.openReviewModal === 'function') {
            window.AutopilotView.openReviewModal(txId);
        } else {
            window.openQuickReviewModal(txId);
        }
    }
};

window.openQuickReviewModal = async function(txId) {
    let overlay = document.getElementById('quickReviewModal');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'quickReviewModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 10005; align-items: center; justify-content: center; backdrop-filter: blur(4px);';
        overlay.onclick = (e) => {
            if (e.target === overlay) window.closeQuickReviewModal();
        };
        document.body.appendChild(overlay);
    }

    overlay.style.display = 'flex';
    overlay.innerHTML = `
        <div class="modal-content" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; width: 90%; max-width: 520px; padding: 24px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                    <span>🔍</span>
                    <span>${window.i18n ? window.i18n.t('autopilot_quick_review_title') : 'Vérification du rapprochement'}</span>
                </h3>
                <button class="btn btn-sm" style="border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--text-muted);" onclick="window.closeQuickReviewModal()">✕</button>
            </div>
            <div style="text-align: center; padding: 20px; color: var(--text-muted);">
                Chargement...
            </div>
        </div>
    `;

    try {
        const tx = await API.get(`/api/transactions/${txId}`);
        if (!tx) throw new Error('Transaction introuvable');

        let reviewItem = null;
        try {
            const queue = await API.get('/api/autopilot/review-queue') || [];
            reviewItem = queue.find(q => q.id === txId);
        } catch (_) {}

        const bestCandidate = (reviewItem?.candidate_forecasts && reviewItem.candidate_forecasts.length > 0)
            ? reviewItem.candidate_forecasts[0]
            : null;

        const conf = Math.round(tx.confidence_score || reviewItem?.confidence_score || 0);
        const dateStr = typeof formatDate === 'function' ? formatDate(tx.date_operation) : (tx.date_operation || '');
        const amtStr = typeof formatCurrency === 'function' ? formatCurrency(tx.amount) : `${Number(tx.amount || 0).toFixed(2)} €`;
        const isIncome = tx.type === 'income' || Number(tx.amount || 0) > 0;
        const amtColor = isIncome ? 'var(--color-income, #10b981)' : 'var(--color-expense, #ef4444)';

        overlay.innerHTML = `
            <div class="modal-content" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; width: 90%; max-width: 520px; padding: 22px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                            <span>🔍</span>
                            <span>${window.i18n ? window.i18n.t('autopilot_quick_review_title') : 'Vérifier le rapprochement'}</span>
                        </h3>
                        <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.35); font-weight: 700; font-size: 11px; padding: 2px 7px; border-radius: 6px;">
                            Score : ${conf}%
                        </span>
                    </div>
                    <button class="btn btn-sm" style="border: none; background: transparent; font-size: 18px; cursor: pointer; color: var(--text-muted);" onclick="window.closeQuickReviewModal()">✕</button>
                </div>

                <div style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 8px; padding: 12px; margin-bottom: 12px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 11.5px; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">Opération enregistrée</span>
                        <span class="privacy-blur" style="font-weight: 800; font-size: 15px; color: ${amtColor};">${amtStr}</span>
                    </div>
                    <div style="font-weight: 700; font-size: 13.5px; color: var(--text-main);">${window.escapeHtml ? window.escapeHtml(tx.description || '') : (tx.description || '')}</div>
                    <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 3px;">📅 ${dateStr} • Catégorie : <span class="badge" style="font-size: 10.5px;">${window.escapeHtml ? window.escapeHtml(tx.category || '—') : (tx.category || '—')}</span></div>
                    ${tx.raw_description && tx.raw_description !== tx.description ? `
                        <div style="margin-top: 8px; padding-top: 8px; border-top: 1px dashed var(--border-color); font-size: 11px; color: var(--text-muted);">
                            <span style="font-weight: 600;">${window.i18n ? window.i18n.t('autopilot_quick_review_bank_raw') : 'Libellé banque brut'} :</span>
                            <code style="font-family: monospace; background: rgba(0,0,0,0.06); padding: 1px 4px; border-radius: 3px; margin-left: 4px;">${window.escapeHtml ? window.escapeHtml(tx.raw_description) : tx.raw_description}</code>
                        </div>
                    ` : ''}
                </div>

                ${bestCandidate ? `
                    <div style="background: rgba(99,102,241,0.08); border: 1px dashed rgba(99,102,241,0.35); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                        <div style="font-size: 11.5px; font-weight: 700; color: var(--accent); margin-bottom: 6px; display: flex; align-items: center; gap: 5px;">
                            <span>🔗</span> <span>${window.i18n ? window.i18n.t('autopilot_quick_review_alternative') : 'Autre prévision suggérée :'}</span>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <div style="font-weight: 600; font-size: 13px; color: var(--text-main);">${window.escapeHtml ? window.escapeHtml(bestCandidate.description) : bestCandidate.description}</div>
                                <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">Prévu : ${bestCandidate.date_operation} • <span class="badge" style="font-size: 10px;">${window.escapeHtml ? window.escapeHtml(bestCandidate.category || '—') : (bestCandidate.category || '—')}</span></div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span class="privacy-blur" style="font-weight: 700; font-size: 13px; color: var(--accent);">${Number(bestCandidate.amount).toFixed(2)} €</span>
                                <button class="btn btn-sm" style="background: rgba(99,102,241,0.18); color: var(--accent); border: 1px solid var(--accent); font-weight: 600; padding: 4px 10px; font-size: 11.5px;" onclick="window.linkQuickReviewItem(${txId}, ${bestCandidate.id}, this)">🔗 ${window.i18n ? (window.i18n.t('autopilot_review_btn_link_action') || 'Lier à cette prévision') : 'Lier à cette prévision'}</button>
                            </div>
                        </div>
                    </div>
                ` : ''}

                <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap;">
                    <button class="btn btn-secondary btn-sm" style="font-size: 12px; padding: 6px 12px;" onclick="window.openEditFromQuickReview(${txId})">
                        ✏️ Éditer / Corriger
                    </button>
                    <div style="display: flex; gap: 8px;">
                        <button class="btn btn-secondary btn-sm" style="font-size: 12px; padding: 6px 12px;" onclick="window.closeQuickReviewModal()">
                            Annuler
                        </button>
                        <button class="btn btn-success btn-sm" style="background: #10b981; border: none; color: white; font-weight: 700; font-size: 12px; padding: 6px 14px; display: inline-flex; align-items: center; gap: 5px;" onclick="window.validateQuickReviewItem(${txId}, this)">
                            ✓ ${bestCandidate ? (window.i18n ? window.i18n.t('autopilot_review_btn_confirm_standalone') : 'Valider telle quelle') : (window.i18n ? window.i18n.t('autopilot_review_btn_confirm') : 'Valider')}
                        </button>
                    </div>
                </div>
            </div>
        `;
    } catch (err) {
        overlay.innerHTML = `
            <div class="modal-content" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 12px; width: 90%; max-width: 440px; padding: 20px; text-align: center;">
                <div style="color: #ef4444; font-weight: 700; margin-bottom: 8px;">Erreur</div>
                <div style="color: var(--text-muted); font-size: 12.5px; margin-bottom: 14px;">Impossible de charger les détails de l'opération.</div>
                <button class="btn btn-secondary btn-sm" onclick="window.closeQuickReviewModal()">Fermer</button>
            </div>
        `;
    }
};

window.closeQuickReviewModal = function() {
    const overlay = document.getElementById('quickReviewModal');
    if (overlay) overlay.style.display = 'none';
};

window.validateQuickReviewItem = async function(txId, btn) {
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '...';
        }
        await API.post(`/api/autopilot/review/${txId}/validate?force_keep_current=true`, {});
        window.closeQuickReviewModal();
        showToast(window.i18n ? (window.i18n.t('autopilot_review_validated') || 'Opération confirmée avec succès') : 'Opération confirmée avec succès', 'success');
        if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
            window.app.updateAutopilotBadge();
        }
        window.dispatchEvent(new CustomEvent('autopilot_updated'));
        window.dispatchEvent(new CustomEvent('transactions_updated'));
    } catch (e) {
        showToast(window.i18n ? window.i18n.t('autopilot_toast_validate_error') : 'Erreur lors de la validation', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `✓ ${window.i18n ? window.i18n.t('autopilot_review_btn_confirm') : 'Valider'}`;
        }
    }
};

window.linkQuickReviewItem = async function(txId, forecastId, btn) {
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '...';
        }
        await API.post(`/api/autopilot/review/${txId}/link`, {
            target_forecast_id: forecastId,
            learn_rule: true
        });
        window.closeQuickReviewModal();
        showToast(window.i18n ? (window.i18n.t('autopilot_toast_link_success') || 'Opération liée avec succès') : 'Opération liée avec succès', 'success');
        if (window.app && typeof window.app.updateAutopilotBadge === 'function') {
            window.app.updateAutopilotBadge();
        }
        window.dispatchEvent(new CustomEvent('autopilot_updated'));
        window.dispatchEvent(new CustomEvent('transactions_updated'));
    } catch (e) {
        showToast(window.i18n ? window.i18n.t('autopilot_toast_link_error') : 'Erreur lors de la liaison', 'error');
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔗 Lier';
        }
    }
};

window.openEditFromQuickReview = async function(txId) {
    window.closeQuickReviewModal();
    try {
        const tx = await API.get(`/api/transactions/${txId}`);
        if (tx && window.FormView && typeof window.FormView.openEdit === 'function') {
            window.FormView.openEdit(tx);
        }
    } catch (e) {
        console.error('Erreur ouverture édition:', e);
    }
};
document.addEventListener('DOMContentLoaded', () => window.app.init());
