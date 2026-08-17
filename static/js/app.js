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

        let styleEl = document.getElementById('dynamicProfileThemeStyle');
        if (!styleEl) {
            styleEl = document.createElement('style');
            styleEl.id = 'dynamicProfileThemeStyle';
            document.head.appendChild(styleEl);
        }

        styleEl.textContent = `
            :root, body, .theme-dark {
                --accent: ${colorHex} !important;
                --accent-hover: ${hoverHex} !important;
                --accent-rgb: ${r}, ${g}, ${b} !important;
                --accent-subtle: rgba(${r}, ${g}, ${b}, 0.18) !important;
                --accent-border: rgba(${r}, ${g}, ${b}, 0.45) !important;
                --accent-glow: rgba(${r}, ${g}, ${b}, 0.35) !important;
            }
        `;

        this._activeThemeColor = colorHex;
    }

    async init() {
        // Init i18n
        await window.i18n.init();

        // Init Master Profiles
        try {
            const pData = await API.get('/api/profiles/');
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
        } catch (e) {

            console.error("Failed to load profiles", e);
        }

        // Load Global Config
        try {
            this.config = await API.get('/api/config/');
            if (this.config && this.config.base_currency) {
                window.appBaseCurrency = this.config.base_currency;
            }
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
                const lastSeen = ProfileStorage.get('omni_last_seen_version');
                if (lastSeen !== version) {
                    // Version changed (or first time feature is seen) → show changelog after UI loads
                    setTimeout(() => this.showChangelog(), 1500);
                }
                ProfileStorage.set('omni_last_seen_version', version);
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
        const savedTheme = ProfileStorage.get('omni_theme');
        if (savedTheme === 'dark') {
            document.body.classList.add('theme-dark');
        } else if (savedTheme === 'light') {
            document.body.classList.remove('theme-dark');
        }
        
        document.getElementById('themeToggle').addEventListener('click', () => {
            document.body.classList.toggle('theme-dark');
            const isDark = document.body.classList.contains('theme-dark');
            ProfileStorage.set('omni_theme', isDark ? 'dark' : 'light');
        });
        
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
            if (ProfileStorage.get('omni_compact') === 'true') {
                document.body.classList.add('compact-mode');
                compactToggle.innerHTML = svgCompact;
                compactToggle.classList.add('toggle-active');
            }
            
            compactToggle.addEventListener('click', () => {
                document.body.classList.toggle('compact-mode');
                const isCompact = document.body.classList.contains('compact-mode');
                compactToggle.innerHTML = isCompact ? svgCompact : svgNormal;
                compactToggle.classList.toggle('toggle-active', isCompact);
                ProfileStorage.set('omni_compact', isCompact);
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
            // Close sidebar when clicking a nav button on mobile
            document.querySelectorAll('.nav-btn').forEach(btn => {
                btn.addEventListener('click', closeSidebar);
            });
        }
        
        // AI Features Visibility
        document.querySelectorAll('.nav-btn[data-view="chat"]').forEach(btn => {
            btn.style.display = this.config.enable_ai === 'true' ? '' : 'none';
        });

        // Overview Features Visibility
        document.querySelectorAll('.nav-btn[data-view="overview"]').forEach(btn => {
            btn.style.display = this.config.enable_overview === 'true' ? '' : 'none';
        });

        // Simulator Features Visibility
        document.querySelectorAll('.nav-btn[data-view="simulator"]').forEach(btn => {
            btn.style.display = this.config.enable_simulator !== 'false' ? '' : 'none';
        });


        // Navigation
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.loadView(e.currentTarget.getAttribute('data-view'));
            });
        });

        // Prevent mouse back/forward buttons & keyboard shortcuts to avoid app navigation bug in Tauri
        window.addEventListener('mousedown', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
        window.addEventListener('mouseup', (e) => { if (e.button === 3 || e.button === 4) e.preventDefault(); });
        window.addEventListener('keydown', (e) => { if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.preventDefault(); });

        // Initial Load
        await this.refreshSidebar();
        
        // Restore view from ProfileStorage
        let savedView = ProfileStorage.get('omni_current_view') || this.currentView;
        // If overview is enabled and no saved view, default to overview
        if (!ProfileStorage.get('omni_current_view') && this.config.enable_overview === 'true') {
            savedView = 'overview';
        }
        this.loadView(savedView);

        // Reveal UI after init is complete (prevents FOUC)
        const container = document.querySelector('.app-container');
        if (container) container.style.opacity = '1';
        
        // Phase 9: Init user switcher if org mode
        this._initUserSwitcher();

        // Init Notification Center
        this._initNotifications();

        // Initial check for pending bank sync matches
        if (window.BankSyncView && window.BankSyncView.loadPendingSync) {
            window.BankSyncView.loadPendingSync();
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

    _initNotifications() {
        const bellBtn = document.getElementById('notifBellBtn');
        const notifMenu = document.getElementById('notifMenu');
        if (!bellBtn || !notifMenu) return;

        bellBtn.onclick = (e) => {
            e.stopPropagation();
            if (notifMenu.style.display === 'none') {
                this.loadNotifications();
                notifMenu.style.display = 'block';
            } else {
                notifMenu.style.display = 'none';
            }
        };

        document.addEventListener('click', (e) => {
            if (!bellBtn.contains(e.target) && !notifMenu.contains(e.target)) {
                notifMenu.style.display = 'none';
            }
        });

        // Load notifications initially
        this.loadNotifications();
        
        // Dynamic notification polling
        this._notifInterval = 60000; // Base: 60s
        this._notifTimer = null;
        this._startNotifPolling();
    }

    _startNotifPolling() {
        if (this._notifTimer) clearTimeout(this._notifTimer);
        
        const poll = async () => {
            await this.loadNotifications();
            this._notifTimer = setTimeout(poll, this._notifInterval);
        };
        this._notifTimer = setTimeout(poll, this._notifInterval);
    }

    setFastNotificationsPolling(active) {
        const newInterval = active ? 15000 : 60000;
        if (this._notifInterval !== newInterval) {
            this._notifInterval = newInterval;
            this._startNotifPolling();
        }
        // Auto-disable fast polling after a safety timeout (5 minutes) to avoid infinite polling if something goes wrong
        if (active) {
            if (this._fastPollingSafetyTimeout) clearTimeout(this._fastPollingSafetyTimeout);
            this._fastPollingSafetyTimeout = setTimeout(() => {
                this.setFastNotificationsPolling(false);
            }, 300000);
        } else {
            if (this._fastPollingSafetyTimeout) {
                clearTimeout(this._fastPollingSafetyTimeout);
                this._fastPollingSafetyTimeout = null;
            }
        }
    }

    async loadNotifications() {
        try {
            const notifs = await API.get('/api/notifications');
            let pendingTransfers = [];
            try {
                pendingTransfers = await API.get('/api/cross-profile/pending');
            } catch (err) { /* silent catch if endpoint fails or cross profile not active */ }
            
            // Check for new unread notifications to display toast
            let hasBankSyncNotif = false;
            if (this._knownNotifIds) {
                let foundNew = false;
                notifs.forEach(n => {
                    if (!n.is_read && !this._knownNotifIds.has(n.id)) {
                        this._knownNotifIds.add(n.id);
                        foundNew = true;
                        if (n.type === 'bank_sync' || n.type === 'bank_sync_error') {
                            hasBankSyncNotif = true;
                        }
                        if (typeof showToast === 'function') {
                            showToast(`${n.title} 🔔`, 'info', 5000);
                        }
                    }
                });
                if (foundNew) {
                    this.setFastNotificationsPolling(false);
                }
            } else {
                this._knownNotifIds = new Set(notifs.map(n => n.id));
            }

            if (hasBankSyncNotif && window.BankSyncView && typeof window.BankSyncView.refreshActiveViews === 'function') {
                window.BankSyncView.refreshActiveViews();
            }

            const pendingCount = (pendingTransfers && Array.isArray(pendingTransfers)) ? pendingTransfers.length : 0;
            const unreadCount = notifs.filter(n => !n.is_read).length + pendingCount;
            const badge = document.getElementById('notifCountBadge');
            const totalLabel = document.getElementById('notifTotalLabel');
            const container = document.getElementById('notifListContainer');

            if (unreadCount > 0) {
                badge.textContent = unreadCount;
                badge.style.display = 'block';
            } else {
                badge.style.display = 'none';
            }

            const totalCount = notifs.length + pendingCount;
            totalLabel.textContent = `${totalCount} notification(s)`;

            if (totalCount === 0) {
                container.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-muted); font-style: italic;" data-i18n="notif_no_notifications">${window.i18n.t('notif_no_notifications')}</div>`;
                return;
            }

            // Store notification data in a map keyed by ID to avoid inline text injection issues
            this._notifDataMap = {};
            notifs.forEach(n => { this._notifDataMap[n.id] = n; });

            let html = '';

            // 1. Render pending cross-profile transfers at top
            if (pendingCount > 0) {
                const acceptTxt = (window.i18n && window.i18n.t('cross_profile_accept')) || 'Accepter';
                const rejectTxt = (window.i18n && window.i18n.t('cross_profile_reject')) || 'Refuser';
                const detailsTxt = (window.i18n && window.i18n.t('btn_details')) || 'Détails';

                html += pendingTransfers.map(tx => {
                    const fmtAmt = typeof formatCurrency === 'function' ? formatCurrency(tx.amount) : `${tx.amount} €`;
                    const origSub = (tx.original_amount && tx.original_currency) ? `<div style="font-size: 11px; font-weight: 500; color: var(--accent); margin-top: 2px;">🌐 ${typeof formatCurrency === 'function' ? formatCurrency(tx.original_amount, tx.original_currency) : `${tx.original_amount} ${tx.original_currency}`}</div>` : '';
                    return `
                    <div style="padding: 14px 18px; border-bottom: 1px solid var(--border-color); border-left: 4px solid #f59e0b; background: rgba(245, 158, 11, 0.05); transition: background 0.2s; cursor: pointer;" onclick="window.FormView && window.FormView.openPendingModal()">
                        <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
                            <span style="font-weight: 700; font-size: 13px; color: #f59e0b; display: flex; align-items: center; gap: 6px;">
                                ↔ ${tx.cross_profile_label || (window.i18n && window.i18n.t('cross_profile_transfer')) || 'Virement inter-profil'}
                            </span>
                            <span style="font-size: 11px; color: var(--text-muted); white-space: nowrap;">${tx.date_operation}</span>
                        </div>
                        <div style="font-size: 12.5px; margin-top: 6px; line-height: 1.4; color: var(--text-main);">
                            ${tx.description || ''}
                            <div style="font-size: 14px; font-weight: 800; color: #10b981; margin-top: 4px;">
                                +${fmtAmt}
                            </div>
                            ${origSub}
                        </div>
                        <div style="display: flex; gap: 8px; justify-content: flex-end; align-items: center; margin-top: 10px;">
                            <button class="notif-action-btn" style="font-size: 11px; padding: 4px 10px; border-radius: 6px; background: var(--bg-surface); border: 1px solid var(--border-color); color: var(--text-muted); cursor: pointer; font-weight: 500; height: 28px; width: auto; display: inline-flex; align-items: center; justify-content: center;" onclick="event.stopPropagation(); window.FormView.openPendingModal()">
                                🔍 ${detailsTxt}
                            </button>
                            <button class="notif-action-btn" style="font-size: 11px; padding: 4px 12px; border-radius: 6px; background: #10b981; border: none; color: white; cursor: pointer; font-weight: 600; height: 28px; width: auto; display: inline-flex; align-items: center; justify-content: center;" onclick="event.stopPropagation(); window.FormView.validatePendingTransfer('${tx.cross_profile_link_id}', 'accept')">
                                ${acceptTxt}
                            </button>
                            <button class="notif-action-btn" style="font-size: 11px; padding: 4px 12px; border-radius: 6px; border: 1px solid rgba(239,68,68,0.3); color: #ef4444; background: rgba(239,68,68,0.08); cursor: pointer; font-weight: 600; height: 28px; width: auto; display: inline-flex; align-items: center; justify-content: center;" onclick="event.stopPropagation(); window.FormView.validatePendingTransfer('${tx.cross_profile_link_id}', 'reject')">
                                ${rejectTxt}
                            </button>
                        </div>
                    </div>
                `;}).join('');
            }

            // 2. Render standard notifications
            html += notifs.map(n => {
                const dateStr = new Date(n.created_at).toLocaleString(window.i18n.lang || 'fr', {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'});
                const styleUnread = n.is_read ? 'opacity: 0.85; cursor: default; user-select: text;' : 'border-left: 4px solid var(--accent); background: rgba(99,102,241,0.02); font-weight: 500; cursor: pointer;';
                const isReport = n.type === 'ai_report';
                const clickCallback = `onclick="window.app.handleNotifClick(${n.id})"`;
                
                let displayContent = n.content || '';
                if (displayContent.includes('"summary"') || displayContent.trim().startsWith('{') || displayContent.trim().startsWith('```')) {
                    try {
                        const cleaned = displayContent.replace(/```(?:json)?/g, '').trim();
                        const parsed = JSON.parse(cleaned);
                        if (parsed.summary) displayContent = parsed.summary;
                    } catch (e) {
                        const match = displayContent.match(/"summary"\s*:\s*"([^"]+)"/);
                        if (match && match[1]) displayContent = match[1];
                    }
                }
                displayContent = displayContent.replace(/\\n/g, '\n').trim();

                return `
                <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); ${styleUnread} transition: background 0.2s;" ${clickCallback}>
                    <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
                        <span style="font-weight: 700; font-size:13px; color: ${n.is_read ? 'var(--text-color)' : 'var(--accent)'}">${n.title}</span>
                        <span style="font-size:11px; color:var(--text-muted); white-space:nowrap;">${dateStr}</span>
                    </div>
                    <div style="font-size:12.5px; margin-top:6px; line-height:1.5; color:var(--text-main); white-space: pre-wrap;">${displayContent}</div>
                    <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:12px;">
                        ${isReport ? `<button class="btn btn-primary btn-sm notif-action-btn" style="font-size:11px; padding:6px 12px; border-radius:8px; height:30px; width:auto; background:var(--accent); color:white; border:none; cursor:pointer; font-weight:600; transition: all 0.2s; box-shadow:0 2px 4px rgba(32,101,209,0.24);" onmouseover="this.style.opacity='0.9'" onmouseout="this.style.opacity='1'" onclick="event.stopPropagation(); window.app.deepenAIReportById(${n.id})" data-i18n="notif_btn_deepen">${window.i18n.t('notif_btn_deepen')}</button>` : ''}
                        <button id="delete-notif-btn-${n.id}" class="btn btn-secondary btn-sm notif-action-btn" style="font-size:11px; padding:6px 12px; border-radius:8px; height:30px; width:auto; border:1px solid rgba(239,68,68,0.2); color:#ff5630; background:rgba(255,86,48,0.05); cursor:pointer; font-weight:600; transition: all 0.2s;" onmouseover="this.style.background='rgba(255,86,48,0.15)'" onmouseout="this.style.background='rgba(255,86,48,0.05)'" onclick="event.stopPropagation(); window.app.deleteNotif(${n.id}, event)" data-i18n="notif_btn_delete">${window.i18n.t('notif_btn_delete')}</button>
                    </div>
                </div>`;
            }).join('');

            container.innerHTML = html;
        } catch (e) {
            console.error("Failed to load notifications", e);
        }
    }

    async handleNotifClick(id) {
        const n = this._notifDataMap && this._notifDataMap[id];
        if (!n) return;

        // 1. Mark as read if it is unread
        if (!n.is_read) {
            await this.markNotifRead(id);
        }

        // 2. Process link redirection if present (close menu only when navigating)
        if (n.link_data) {
            try {
                const linkObj = JSON.parse(n.link_data);
                if (linkObj.session_id) {
                    sessionStorage.setItem('chatActiveSessionId', linkObj.session_id);
                    if (window.ChatView) {
                        window.ChatView.activeSessionId = linkObj.session_id;
                    }
                    // Close notification menu only when navigating away
                    const notifMenu = document.getElementById('notifMenu');
                    if (notifMenu) notifMenu.style.display = 'none';
                    this.loadView('chat');
                } else if (linkObj.action === 'open_pending' || linkObj.action === 'bank_sync') {
                    const notifMenu = document.getElementById('notifMenu');
                    if (notifMenu) notifMenu.style.display = 'none';
                    if (window.BankSyncView && window.BankSyncView.openPendingReviewModal) {
                        window.BankSyncView.openPendingReviewModal();
                    }
                } else if (linkObj.view === 'accounts' || linkObj.view === 'accounts_manager') {
                    const notifMenu = document.getElementById('notifMenu');
                    if (notifMenu) notifMenu.style.display = 'none';
                    this.loadView('accounts');
                }
            } catch (e) {
                console.error("Failed to parse link_data", e);
            }
        }
    }

    async markNotifRead(id) {
        try {
            await API.put(`/api/notifications/${id}/read`);
            await this.loadNotifications();
        } catch (e) {
            console.error(e);
        }
    }

    async markAllNotifsRead() {
        try {
            await API.put('/api/notifications/read-all');
            await this.loadNotifications();
        } catch (e) {
            console.error(e);
        }
    }

    async deleteNotif(id, event) {
        const btn = event ? event.currentTarget : document.getElementById(`delete-notif-btn-${id}`);
        if (!btn) return;

        // If the button is already in confirmation state, execute deletion
        if (btn.dataset.confirmState === "true") {
            try {
                await API.del(`/api/notifications/${id}`);
                await this.loadNotifications();
            } catch (e) {
                console.error(e);
            }
        } else {
            // Put button in confirmation state
            btn.dataset.confirmState = "true";
            const originalText = btn.textContent;
            btn.textContent = window.i18n.lang === 'en' ? "Confirm?" : "Confirmer ?";
            btn.style.background = "#ff5630";
            btn.style.color = "white";
            btn.style.border = "1px solid #ff5630";

            // Cancel confirmation state if clicked outside or after 3 seconds
            const resetBtn = () => {
                if (btn && btn.dataset.confirmState === "true") {
                    btn.dataset.confirmState = "false";
                    btn.textContent = originalText;
                    btn.style.background = "rgba(255,86,48,0.05)";
                    btn.style.color = "#ff5630";
                    btn.style.border = "1px solid rgba(239,68,68,0.2)";
                }
            };
            btn._resetTimeout = setTimeout(resetBtn, 3000);
        }
    }

    deepenAIReportById(notifId) {
        const n = this._notifDataMap && this._notifDataMap[notifId];
        if (!n) {
            console.error("Notification data not found for id", notifId);
            return;
        }
        this.deepenAIReport(n.content || '', n.detailed_content || '');
    }

    async deepenAIReport(content, detailedContent) {
        try {
            // Close popover
            const notifMenu = document.getElementById('notifMenu');
            if (notifMenu) notifMenu.style.display = 'none';

            const isEn = window.i18n.lang === 'en';
            const sessionTitle = isEn ? "AI Financial Report Deepening" : "Approfondissement Bilan IA";

            // Helper to extract clean Markdown text from raw/escaped JSON
            const extractCleanText = (text) => {
                if (!text) return '';
                let cleaned = text.trim();
                if (cleaned.includes('"detailed_analysis"') || cleaned.includes('"summary"') || cleaned.startsWith('{') || cleaned.startsWith('```')) {
                    try {
                        const jsonCandidate = cleaned.replace(/```(?:json)?/g, '').trim();
                        const parsed = JSON.parse(jsonCandidate);
                        if (parsed.detailed_analysis) return parsed.detailed_analysis.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                        if (parsed.summary) return parsed.summary.replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                    } catch (e) {
                        const detMatch = cleaned.match(/"detailed_analysis"\s*:\s*"([\s\S]*?)(?<!\\)"/);
                        if (detMatch && detMatch[1]) {
                            return detMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                        }
                        const sumMatch = cleaned.match(/"summary"\s*:\s*"([\s\S]*?)(?<!\\)"/);
                        if (sumMatch && sumMatch[1]) {
                            return sumMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').trim();
                        }
                    }
                }
                return cleaned.replace(/\\n/g, '\n').trim();
            };

            // Create a new session
            const newSession = await API.post('/api/chat/sessions', {
                title: sessionTitle,
                role: "advisor"
            });
            
            const sessionId = newSession.id;

            // 1. Insert the detailed report as an ASSISTANT message (will render with full markdown)
            const cleanDetailed = extractCleanText(detailedContent);
            const cleanSummary = extractCleanText(content);
            const textReport = cleanDetailed || cleanSummary;
            const reportIntro = isEn
                ? `## 📊 Financial Health Report\n\n${textReport}`
                : `## 📊 Bilan de Santé Financière\n\n${textReport}`;

            await API.post(`/api/chat/sessions/${sessionId}/system-message`, {
                content: reportIntro,
                role: "assistant"
            });

            // 2. Save active session and navigate to chat
            sessionStorage.setItem('chatActiveSessionId', sessionId);
            if (window.ChatView) {
                window.ChatView.activeSessionId = sessionId;
            }

            this.loadView('chat');

            // 3. Pre-fill the suggested question into the chat input so user can send or customize
            setTimeout(() => {
                const textarea = document.getElementById('chatInput');
                if (textarea) {
                    const userPrompt = isEn 
                        ? "Could you analyze my financial situation in detail based on this report? What are the key risks and what concrete actions do you recommend?"
                        : "Pouvez-vous analyser ma situation financière en détail à partir de ce bilan ? Quels sont les principaux risques et quelles actions concrètes me recommandez-vous ?";
                    textarea.value = userPrompt;
                    textarea.focus();
                }
            }, 300);

        } catch (e) {
            console.error("Failed to deepen AI report", e);
            const errToast = window.i18n.lang === 'en' ? "Failed to start conversation." : "Échec du lancement de la discussion.";
            showToast(errToast, 'error', 3000);
        }
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
                        if (this.currentView === 'configuration' && window.ConfigView && typeof window.ConfigView.fetchFacts === 'function') {
                            window.ConfigView.fetchFacts();
                        }
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

    toggleSidebarAccountMode(direction = 1) {
        this.sidebarAccountMode = this.sidebarAccountMode === 'loans' ? 'liquid' : 'loans';
        localStorage.setItem('omnibank_sidebar_acc_mode', this.sidebarAccountMode);
        this.renderSidebarAccounts();
    }

    renderSidebarAccounts() {
        const accounts = this.accounts || [];
        const stats = this.dashboardStats || {};
        const list = document.getElementById('accountsList');
        if (!list) return;
        list.innerHTML = '';

        const activeAccounts = accounts.filter(a => !a.is_closed);
        const liquidAccounts = activeAccounts.filter(a => !a.is_loan);
        const loanAccounts = activeAccounts.filter(a => a.is_loan);

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
    }

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
                document.getElementById('valOverdraft').textContent = formatCurrency(stats.overdraft_warning.projected_balance);
                document.getElementById('valOverdraftDate').textContent = `${formatDate(stats.overdraft_warning.date)} (${stats.overdraft_warning.transaction_description})`;
                
                const expText = window.i18n.t('msg_overdraft_explanation') ? window.i18n.tp('msg_overdraft_explanation', {date: formatDate(stats.overdraft_warning.date)}) : `If no income by ${formatDate(stats.overdraft_warning.date)}, risk of overdraft caused by this transaction.`;
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
    }
    
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
    }
    
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
    }

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
    }
    
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
    }

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
    }
    
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
    }
    
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
    }
    
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
    }

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


    refreshCurrentView() {
        if (this.currentView) {
            this.loadView(this.currentView);
        }
    }

    loadView(viewName) {
        if (viewName === 'accounts_manager') {
            viewName = 'accounts';
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

            versionEl.textContent = `v${this._appVersion || data.version || '?'}`;

            if (data.history && data.history.length > 0) {
                let html = '';
                data.history.forEach((release, idx) => {
                    const rawHtml = typeof marked?.parse === 'function' ? marked.parse(release.notes) : release.notes;
                    const safeHtml = typeof DOMPurify?.sanitize === 'function' ? DOMPurify.sanitize(rawHtml) : rawHtml;
                    
                    const isLatest = idx === 0;
                    const badgeHtml = isLatest ? `<span style="background: rgba(99, 102, 241, 0.1); color: var(--accent); border: 1px solid rgba(99, 102, 241, 0.2); font-size: 11px; padding: 2px 8px; border-radius: 6px; font-weight: bold; margin-left: 10px;">Dernière version</span>` : '';
                    
                    const releaseDate = release.date ? new Date(release.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : '';
                    
                    html += `
                        <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid var(--border-color); ${isLatest ? 'background: rgba(99, 102, 241, 0.02); padding: 16px; border-radius: 12px; border: 1px solid rgba(99, 102, 241, 0.15);' : ''}">
                            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 12px;">
                                <div style="display: flex; align-items: center;">
                                    <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-main);">Version ${release.version}</h4>
                                    ${badgeHtml}
                                </div>
                                <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">${releaseDate}</span>
                            </div>
                            <div class="changelog-content" style="font-size: 14px; line-height: 1.8;">
                                ${safeHtml}
                            </div>
                        </div>
                    `;
                });
                body.innerHTML = `<div style="padding-right: 8px;">${html}</div>`;
                
                // Style markdown elements
                body.querySelectorAll('h1,h2,h3').forEach(h => { h.style.color = 'var(--text-color)'; h.style.marginTop = '16px'; h.style.marginBottom = '8px'; });
                body.querySelectorAll('ul').forEach(ul => { ul.style.paddingLeft = '20px'; });
                body.querySelectorAll('li').forEach(li => { li.style.marginBottom = '4px'; });
                body.querySelectorAll('code').forEach(c => { c.style.background = 'var(--bg-base)'; c.style.padding = '2px 6px'; c.style.borderRadius = '4px'; c.style.fontSize = '12px'; });
            } else if (data.notes) {
                // Render markdown (marked.js is already loaded)
                const rawHtml = typeof marked?.parse === 'function' ? marked.parse(data.notes) : data.notes;
                const safeHtml = typeof DOMPurify?.sanitize === 'function' ? DOMPurify.sanitize(rawHtml) : rawHtml;
                body.innerHTML = `<div class="changelog-content" style="font-size:14px;line-height:1.8;">${safeHtml}</div>`;
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

    editCurrentProfile() {
        const activeProf = this.profiles ? this.profiles.find(p => p.id === this.activeProfileId) : null;
        if (!activeProf) return;

        const dropdown = document.getElementById('profileDropdown');
        if (dropdown) dropdown.style.display = 'none';

        if (window.ConfigView && typeof window.ConfigView._showEditProfileModal === 'function') {
            window.ConfigView._showEditProfileModal(activeProf.id, activeProf.name, activeProf.color, activeProf.icon, activeProf.currency, activeProf.pay_cycle_day, activeProf.date_format);
        } else {
            this.loadView('config');
            setTimeout(() => {
                if (window.ConfigView && window.ConfigView._showEditProfileModal) {
                    window.ConfigView._showEditProfileModal(activeProf.id, activeProf.name, activeProf.color, activeProf.icon, activeProf.currency, activeProf.pay_cycle_day, activeProf.date_format);
                }
            }, 250);
        }
    }

    _renderProfileSelector() {
        const container = document.getElementById('profileSelector');
        const btn = document.getElementById('profileBtn');
        const dot = document.getElementById('profileDot');
        const nameEl = document.getElementById('profileName');
        const dropdown = document.getElementById('profileDropdown');

        if (!container || !this.profiles) return;

        container.style.display = 'inline-block';

        const active = this.profiles.find(p => p.id === this.activeProfileId) || this.profiles[0] || { name: 'Mon Profil', color: '#6366f1', icon: '👤' };
        if (dot) dot.style.backgroundColor = active.color || '#6366f1';
        if (nameEl) nameEl.textContent = (active.icon ? active.icon + ' ' : '') + (active.name || 'Mon Profil');

        let html = '';
        this.profiles.forEach(p => {
            const isActive = p.id === this.activeProfileId;
            const lockIcon = p.has_pin ? '<span style="font-size:11px; opacity:0.7;">🔒</span>' : '';
            const activeBadge = isActive ? '<span style="font-size:10px; opacity:0.6; margin-left:4px;">✓</span>' : '';
            const safeName = window.escapeHtml ? window.escapeHtml(p.name) : p.name;
            const pIcon = p.icon || '👤';
            const editBtn = isActive ? `
                <button class="profile-hdr-edit-btn" title="Éditer le profil" style="background:var(--accent-subtle); border:1px solid var(--accent-border); color:var(--text-main); font-size:12px; padding:3px 6px; border-radius:6px; cursor:pointer; display:flex; align-items:center; justify-content:center; transition:all 0.15s;" onclick="event.stopPropagation(); window.app.editCurrentProfile();">
                    ✏️
                </button>
            ` : '';

            html += `
                <div class="profile-dropdown-item ${isActive ? 'active' : ''}" data-profile-id="${p.id}" style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
                    <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                        <span class="profile-dot" style="background-color:${p.color || '#6366f1'};"></span>
                        <span style="font-size:13px;">${pIcon}</span>
                        <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeName}</span>
                        ${activeBadge}
                    </div>
                    <div style="display:flex; align-items:center; gap:6px; margin-left:auto; flex-shrink:0;">
                        ${lockIcon}
                        ${editBtn}
                    </div>
                </div>
            `;
        });

        const addText = window.i18n ? window.i18n.t('profiles_create') : 'Créer un profil';
        html += `
            <div class="profile-dropdown-add" id="profileAddBtn">
                <span>➕</span>
                <span data-i18n="profiles_create">${addText}</span>
            </div>
        `;

        if (this.profiles && active && active.has_pin) {
            html += `
                <div class="profile-dropdown-add" id="profileLockBtn" style="border-top:1px solid var(--border-color); color:var(--text-muted); margin-top:2px;">
                    <span>🔒</span>
                    <span>Verrouiller la session</span>
                </div>
            `;
        }

        dropdown.innerHTML = html;

        btn.onclick = (e) => {
            e.stopPropagation();
            const isOpen = dropdown.style.display === 'block';
            dropdown.style.display = isOpen ? 'none' : 'block';
        };

        dropdown.querySelectorAll('.profile-dropdown-item').forEach(item => {
            item.onclick = async (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                const targetId = item.getAttribute('data-profile-id');
                if (targetId === this.activeProfileId) return;

                const targetProf = this.profiles.find(p => p.id === targetId);
                if (targetProf && targetProf.has_pin) {
                    this.openProfilePinModal(targetId);
                } else {
                    await this.switchProfile(targetId);
                }
            };
        });

        const addBtn = document.getElementById('profileAddBtn');
        if (addBtn) {
            addBtn.onclick = (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                this.loadView('config');
                setTimeout(() => {
                    if (window.ConfigView && window.ConfigView._showCreateProfileModal) {
                        window.ConfigView._showCreateProfileModal();
                    }
                }, 200);
            };
        }

        const lockBtn = document.getElementById('profileLockBtn');
        if (lockBtn) {
            lockBtn.onclick = (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                this.showLockScreen();
            };
        }

        if (!this._profileClickOutsideBound) {
            this._profileClickOutsideBound = true;
            document.addEventListener('click', () => {
                if (dropdown) dropdown.style.display = 'none';
            });
        }
    }

    // ── Auto-Lock & Lock Screen Manager ──
    initAutoLock() {
        if (!this.profiles || this.profiles.length === 0) return;

        const activeProf = this.profiles.find(p => p.id === this.activeProfileId);
        const activeHasPin = activeProf && activeProf.has_pin;

        // Pas d'auto-verrouillage si le profil actif n'a pas de PIN défini
        if (!activeHasPin) {
            if (this._autoLockTimeout) {
                clearTimeout(this._autoLockTimeout);
                this._autoLockTimeout = null;
            }
            sessionStorage.removeItem('omni_is_locked');
            const overlay = document.getElementById('appLockScreen');
            if (overlay) overlay.style.display = 'none';
            return;
        }

        const isLocked = sessionStorage.getItem('omni_is_locked') === 'true';
        if (isLocked) {
            this.showLockScreen();
        }

        const resetTimer = () => this._resetAutoLockTimer();
        ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => {
            window.removeEventListener(evt, resetTimer);
            window.addEventListener(evt, resetTimer, { passive: true });
        });
        this._resetAutoLockTimer();
    }

    _resetAutoLockTimer() {
        if (this._autoLockTimeout) clearTimeout(this._autoLockTimeout);
        if (!this.profiles || this.profiles.length === 0) return;

        const activeProf = this.profiles.find(p => p.id === this.activeProfileId);
        if (!activeProf || !activeProf.has_pin) return;

        const minutesStr = window.ProfileStorage ? window.ProfileStorage.get('omni_autolock_minutes') : '5';
        if (minutesStr === 'off') return;

        const minutes = parseInt(minutesStr || '5', 10);
        if (isNaN(minutes) || minutes <= 0) return;

        this._autoLockTimeout = setTimeout(() => {
            console.log(`[AutoLock] Inactivité détectée (${minutes} min). Verrouillage de l'application.`);
            this.showLockScreen();
        }, minutes * 60 * 1000);
    }

    showLockScreen() {
        if (!this.profiles || this.profiles.length === 0) return;

        const activeProf = this.profiles.find(p => p.id === this.activeProfileId);
        if (!activeProf || !activeProf.has_pin) {
            sessionStorage.removeItem('omni_is_locked');
            const overlay = document.getElementById('appLockScreen');
            if (overlay) overlay.style.display = 'none';
            return;
        }

        sessionStorage.setItem('omni_is_locked', 'true');

        const overlay = document.getElementById('appLockScreen');
        const list = document.getElementById('lockScreenProfilesList');
        const pinForm = document.getElementById('lockScreenPinForm');
        const errDiv = document.getElementById('lockScreenError');

        if (errDiv) errDiv.style.display = 'none';
        if (pinForm) pinForm.style.display = 'none';

        if (list) {
            let html = '';
            this.profiles.forEach(p => {
                const isActive = p.id === this.activeProfileId;
                const safeName = window.escapeHtml ? window.escapeHtml(p.name) : p.name;
                const lockBadge = p.has_pin ? '<span style="margin-left:auto; font-size:12px; opacity:0.8;">🔒 Protégé</span>' : '<span style="margin-left:auto; font-size:11px; opacity:0.5;">Accès libre</span>';
                const activeTag = isActive ? '<span style="font-size:11px; font-weight:700; background:rgba(99,102,241,0.2); color:var(--accent); padding:2px 8px; border-radius:12px; margin-left:6px;">Actif</span>' : '';

                html += `
                    <div class="lock-profile-card" data-profile-id="${p.id}" style="display:flex; align-items:center; gap:12px; padding:12px 16px; background:var(--bg-surface); border:1px solid ${isActive ? 'var(--accent)' : 'var(--border-color)'}; border-radius:12px; cursor:pointer; transition:all 0.2s;">
                        <span class="profile-dot" style="background-color:${p.color || '#6366f1'}; width:12px; height:12px; border-radius:50%; flex-shrink:0;"></span>
                        <div style="font-size:14px; font-weight:600; color:var(--text-main); display:flex; align-items:center;">
                            ${safeName} ${activeTag}
                        </div>
                        ${lockBadge}
                    </div>
                `;
            });
            list.innerHTML = html;

            list.querySelectorAll('.lock-profile-card').forEach(card => {
                card.onclick = () => {
                    const profId = card.getAttribute('data-profile-id');
                    this.selectLockProfile(profId);
                };
            });
        }

        if (overlay) overlay.style.display = 'flex';
    }

    selectLockProfile(profId) {
        const target = this.profiles.find(p => p.id === profId);
        if (!target) return;
        this._pendingLockProfileId = profId;

        const pinForm = document.getElementById('lockScreenPinForm');
        const pinInput = document.getElementById('lockScreenPinInput');
        const label = document.getElementById('lockScreenSelectedProfileName');
        const errDiv = document.getElementById('lockScreenError');

        if (errDiv) errDiv.style.display = 'none';

        if (target.has_pin) {
            if (label) label.textContent = `Déverrouiller « ${target.name} »`;
            if (pinInput) pinInput.value = '';
            if (pinForm) pinForm.style.display = 'block';
            setTimeout(() => { if (pinInput) pinInput.focus(); }, 100);
        } else {
            this.submitLockPin(null);
        }
    }

    cancelLockPinInput() {
        const pinForm = document.getElementById('lockScreenPinForm');
        const errDiv = document.getElementById('lockScreenError');
        if (pinForm) pinForm.style.display = 'none';
        if (errDiv) errDiv.style.display = 'none';
        this._pendingLockProfileId = null;
    }

    async submitLockPin(explicitPin = undefined) {
        const pinInput = document.getElementById('lockScreenPinInput');
        const errDiv = document.getElementById('lockScreenError');
        const pin = (explicitPin !== undefined) ? explicitPin : (pinInput ? pinInput.value.trim() : null);

        const targetId = this._pendingLockProfileId || this.activeProfileId;

        try {
            if (errDiv) errDiv.style.display = 'none';
            sessionStorage.removeItem('omni_is_locked');
            await this.switchProfile(targetId, pin);
            const overlay = document.getElementById('appLockScreen');
            if (overlay) overlay.style.display = 'none';
        } catch (e) {
            if (errDiv) {
                errDiv.textContent = e.message || (window.i18n ? window.i18n.t('profiles_pin_wrong') : 'Code PIN incorrect');
                errDiv.style.display = 'block';
            }
        }
    }

    async switchProfile(profileId, pin = null) {
        try {
            const body = pin ? { pin } : {};
            const res = await API.post(`/api/profiles/${profileId}/activate`, body);
            sessionStorage.removeItem('omni_is_locked');
            if (res.ok) {
                if (res.reload_required) {
                    window.location.reload();
                } else {
                    const overlay = document.getElementById('appLockScreen');
                    if (overlay) overlay.style.display = 'none';
                }
            }
        } catch (e) {
            console.error("Failed to switch profile", e);
            throw e;
        }
    }

    openProfilePinModal(targetProfileId) {
        this._pendingSwitchProfileId = targetProfileId;
        const modal = document.getElementById('profilePinModal');
        const input = document.getElementById('profilePinInput');
        const err = document.getElementById('profilePinError');
        if (modal) {
            if (err) err.style.display = 'none';
            if (input) input.value = '';
            modal.style.display = 'flex';
            setTimeout(() => { if (input) input.focus(); }, 100);
        }
    }

    closeProfilePinModal() {
        this._pendingSwitchProfileId = null;
        const modal = document.getElementById('profilePinModal');
        if (modal) modal.style.display = 'none';
    }

    async submitProfilePin() {
        const input = document.getElementById('profilePinInput');
        const err = document.getElementById('profilePinError');
        const pin = input ? input.value : '';
        if (!pin) return;

        try {
            if (err) err.style.display = 'none';
            await this.switchProfile(this._pendingSwitchProfileId, pin);
        } catch (e) {
            if (err) {
                err.textContent = e.message || (window.i18n ? window.i18n.t('profiles_pin_wrong') : 'Code PIN incorrect');
                err.style.display = 'block';
            }
        }
    }

    populateLangDropdown() {
        const langMenu = document.getElementById('langMenu');
        if (!langMenu || !window.i18n) return;
        
        const langs = window.i18n.availableLangs || [];
        let html = '';
        for (const l of langs) {
            html += `
                <button class="lang-option" data-lang="${l.code}" style="display:flex; align-items:center; gap:8px; width:100%; padding:6px 10px; background:none; border:none; color:var(--text-main); cursor:pointer; font-size:12px;">
                    <span class="fi fi-${l.flag}"></span> ${escapeHtml(l.label)}
                </button>
            `;
        }
        langMenu.innerHTML = html;

        langMenu.querySelectorAll('.lang-option').forEach(opt => {
            opt.addEventListener('click', async (e) => {
                const l = e.currentTarget.getAttribute('data-lang');
                langMenu.style.display = 'none';
                await window.i18n.setLang(l);
                this.updateMobileLangUI();
                this.updateDesktopLangUI();
                await this.refreshSidebar();
                this.loadView(this.currentView);
                this.updateHeaderHistoryState();
            });
        });
    }

    renderMobileLangList() {
        const container = document.getElementById('mobileLangList');
        if (!container || !window.i18n) return;

        const langs = window.i18n.availableLangs || [];
        const current = window.i18n.lang;
        let html = '';

        for (const l of langs) {
            const isActive = l.code === current;
            html += `
                <button class="mobile-lang-item ${isActive ? 'active' : ''}" onclick="window.app.setLanguage('${l.code}')">
                    <span class="fi fi-${l.flag}"></span>
                    <span>${escapeHtml(l.label)}</span>
                    ${isActive ? '<span class="mobile-lang-check">✓</span>' : ''}
                </button>
            `;
        }

        container.innerHTML = html;
    }

    async setLanguage(langCode) {
        if (!window.i18n) return;
        await window.i18n.setLang(langCode);
        this.updateMobileLangUI();
        this.updateDesktopLangUI();
        await this.refreshSidebar();
        this.loadView(this.currentView);
        this.updateHeaderHistoryState();
    }

    updateMobileLangUI() {
        this.renderMobileLangList();
    }

    updateDesktopLangUI() {
        const currentLangFlag = document.getElementById('currentLangFlag');
        if (!window.i18n) return;
        const info = window.i18n.getLangInfo();
        if (currentLangFlag) currentLangFlag.className = `fi fi-${info.flag}`;
    }
}

window.app = new App();
document.addEventListener('DOMContentLoaded', () => window.app.init());
