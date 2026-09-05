// static/js/views/bank_sync.js — Synchronisation Bancaire Universelle (Woob)
// Conforme aux règles OmniBank : 100% Modales In-App, Toasts, Délai Anti-Spam, Session RAM Sécurisée, Relevé Auto en Arrière-Plan & IA Conditionnelle

window.BankSyncView = {
    connections: [],
    backends: [],
    localAccounts: [],
    selectedBackend: null,
    activeSessionId: null,
    eventSource: null,

    // Délai anti-spam recommandé entre deux requêtes vers la même banque (5 minutes)
    COOLDOWN_MS: 5 * 60 * 1000,

    // État de la prévisualisation / revue des opérations
    previewData: null,
    currentAccountIndex: 0,
    currentFilter: 'all',
    activeConnId: null,

    // Correspondances en attente pour pointage rapide depuis Dashboard & Historique
    pendingMatches: {},
    pendingDiscrepancies: {},
    totalDiscrepancies: 0,
    ghostTransactions: [],
    _ghostCategorized: false,
    vaultStatus: { is_unlocked: false, remaining_days: 0, remaining_seconds: 0 },
    autoSyncSettings: { enabled: false, interval_hours: 24 },

    // Handlers de promesse pour les dialogues modaux personnalisés
    _pwResolve: null,
    _pwReject: null,
    _confirmResolve: null,

    showToast(msg, type = 'info', duration = 3000) {
        if (typeof window.showToast === 'function') {
            window.showToast(msg, type, duration);
        } else if (typeof showToast === 'function') {
            showToast(msg, type, duration);
        }
    },


    isAIEnabled() {
        return Boolean(window.app && window.app.config && (window.app.config.enable_ai === 'true' || window.app.config.enable_ai === true));
    },

    getActiveProfileId() {
        if (window.ProfileStorage && typeof window.ProfileStorage.getActiveProfileId === 'function') {
            return window.ProfileStorage.getActiveProfileId();
        }
        if (window.app && window.app.activeProfileId) {
            return window.app.activeProfileId;
        }
        return 'default';
    },

    _getPreviewCacheKey(connId) {
        const pid = this.getActiveProfileId();
        return `omnibank_${pid}_sync_preview_${connId}`;
    },

    _getRejectedMatchesKey(connId) {
        const pid = this.getActiveProfileId();
        return `omnibank_${pid}_sync_rejected_${connId}`;
    },

    _getForcedMatchesKey(connId) {
        const pid = this.getActiveProfileId();
        return `omnibank_${pid}_sync_forced_${connId}`;
    },

    // ── GESTION DU CACHE DU DERNIER APERÇU ──────────────────────────
    saveCachedPreview(connId, previewData) {
        try {
            const pid = this.getActiveProfileId();
            const entry = {
                profileId: pid,
                timestamp: Date.now(),
                data: previewData
            };
            sessionStorage.setItem(this._getPreviewCacheKey(connId), JSON.stringify(entry));
        } catch (e) {
            console.warn('[BankSync] Impossible de cacher l\'aperçu:', e);
        }
    },

    getCachedPreview(connId) {
        try {
            const pid = this.getActiveProfileId();
            const key = this._getPreviewCacheKey(connId);
            const raw = sessionStorage.getItem(key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (entry && entry.profileId && entry.profileId !== pid) {
                sessionStorage.removeItem(key);
                return null;
            }
            return entry;
        } catch (e) {
            return null;
        }
    },

    // ── GESTION DES DÉROGATIONS DE RAPPROCHEMENT (REJECTED & FORCED MATCHES) ──
    getRejectedMatches(connId) {
        try {
            return JSON.parse(sessionStorage.getItem(this._getRejectedMatchesKey(connId)) || '[]');
        } catch { return []; }
    },

    addRejectedMatch(connId, csvId, dbId) {
        if (!connId || !csvId || !dbId) return;
        const list = this.getRejectedMatches(connId);
        if (!list.some(r => r.csv_id === csvId && r.db_id === dbId)) {
            list.push({ csv_id: csvId, db_id: dbId });
        }
        sessionStorage.setItem(this._getRejectedMatchesKey(connId), JSON.stringify(list));
    },

    getForceMatches(connId) {
        try {
            return JSON.parse(sessionStorage.getItem(this._getForcedMatchesKey(connId)) || '[]');
        } catch { return []; }
    },

    addForceMatch(connId, csvId, dbId) {
        if (!connId || !csvId || !dbId) return;
        let list = this.getForceMatches(connId);
        list = list.filter(f => f.csv_id !== csvId);
        list.push({ csv_id: csvId, db_id: dbId });
        sessionStorage.setItem(this._getForcedMatchesKey(connId), JSON.stringify(list));
    },

    removeForceMatch(connId, csvId) {
        if (!connId || !csvId) return;
        let list = this.getForceMatches(connId);
        list = list.filter(f => f.csv_id !== csvId);
        sessionStorage.setItem(this._getForcedMatchesKey(connId), JSON.stringify(list));
    },

    clearMatchOverrides(connId) {
        if (!connId) return;
        sessionStorage.removeItem(this._getRejectedMatchesKey(connId));
        sessionStorage.removeItem(this._getForcedMatchesKey(connId));
        sessionStorage.removeItem(`omnibank_sync_rejected_${connId}`);
        sessionStorage.removeItem(`omnibank_sync_forced_${connId}`);
    },

    clearCachedPreview(connId) {
        if (!connId) return;
        sessionStorage.removeItem(this._getPreviewCacheKey(connId));
        sessionStorage.removeItem(`omnibank_sync_preview_${connId}`);
    },

    async clearAllCaches() {
        // 1. Vider tous les caches sessionStorage (previews + overrides) pour ce profil et legacy
        const pid = this.getActiveProfileId();
        const keysToRemove = [];
        for (let i = 0; i < sessionStorage.length; i++) {
            const k = sessionStorage.key(i);
            if (!k) continue;
            if (k.startsWith(`omnibank_${pid}_sync_`) ||
                k.startsWith('omnibank_sync_preview_') ||
                k.startsWith('omnibank_sync_rejected_') ||
                k.startsWith('omnibank_sync_forced_')) {
                keysToRemove.push(k);
            }
        }
        keysToRemove.forEach(k => sessionStorage.removeItem(k));

        // 2. Purger le sas d'attente côté serveur
        try {
            await API.post('/api/bank-sync/purge-pending');
        } catch (e) {
            console.warn('[BankSync] Erreur purge sas backend:', e);
        }

        // 3. Rafraîchir l'UI
        this._ghostCategoryCache = {};
        this._ghostCategorizing = false;
        this.showToast(window.i18n ? window.i18n.t('bank_sync_cache_purged') || 'Sas de synchronisation vidé.' : 'Sas de synchronisation vidé.', 'success');
        await this.loadPendingSync();
        if (window.OverviewView && window.OverviewView.init) window.OverviewView.init();
    },

    // ── CACHE DES COMPTES DISTANTS À ASSOCIER (MAPPING INSTANTANÉ) ────
    _getRemoteAccountsCacheKey(conn) {
        if (!conn) return null;
        const connId = typeof conn === 'object' ? conn.id : conn;
        const backend = typeof conn === 'object' ? (conn.backend || 'unknown') : 'generic';
        const profileId = this.getActiveProfileId();
        return `omnibank_remote_accounts_${profileId}_${backend}_${connId}`;
    },

    saveCachedRemoteAccounts(conn, accounts) {
        try {
            const key = this._getRemoteAccountsCacheKey(conn);
            if (!key) return;
            const backend = typeof conn === 'object' ? conn.backend : null;
            const entry = {
                timestamp: Date.now(),
                backend: backend,
                accounts: accounts
            };
            localStorage.setItem(key, JSON.stringify(entry));
        } catch (e) {
            console.warn('[BankSync] Impossible de cacher les comptes distants:', e);
        }
    },

    getCachedRemoteAccounts(conn) {
        try {
            const key = this._getRemoteAccountsCacheKey(conn);
            if (!key) return null;
            const raw = localStorage.getItem(key);
            if (!raw) return null;
            const entry = JSON.parse(raw);
            if (typeof conn === 'object' && conn.backend && entry.backend && entry.backend !== conn.backend) {
                // Incohérence de backend détectée : purge immédiate du cache corrompu
                localStorage.removeItem(key);
                return null;
            }
            return entry.accounts || null;
        } catch (e) {
            return null;
        }
    },

    clearCachedRemoteAccounts(conn) {
        try {
            const key = this._getRemoteAccountsCacheKey(conn);
            if (key) localStorage.removeItem(key);
            const connId = typeof conn === 'object' ? conn.id : conn;
            if (connId) {
                const pid = this.getActiveProfileId();
                localStorage.removeItem(`omnibank_remote_accounts_${pid}_${connId}`);
                localStorage.removeItem(`omnibank_remote_accounts_${connId}`);
                sessionStorage.removeItem(this._getPreviewCacheKey(connId));
                sessionStorage.removeItem(`omnibank_sync_preview_${connId}`);
            }
        } catch (_) {}
    },

    render() {
        this.ensureModalsExist();
        return `
        <div id="bankSyncRoot" class="bank-sync-unified-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: 16px; padding: 20px; box-shadow: var(--shadow-sm); margin-bottom: 24px;">
            <!-- Top Row: Title, Badges, Vault status & Actions -->
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid var(--border-color);">
                <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
                    <h3 style="font-size: 17px; font-weight: 700; margin: 0; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        <span>⚡</span> <span data-i18n="bank_sync_title">${window.i18n.t('bank_sync_title')}</span>
                    </h3>
                    <span class="bank-sync-secure-badge" style="font-size: 11.5px; font-weight: 600; background: rgba(99, 102, 241, 0.12); color: var(--accent); border: 1px solid rgba(99, 102, 241, 0.25); height: 26px; padding: 0 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 5px; cursor: help; box-sizing: border-box; line-height: 1;" title="${window.i18n.t('bank_sync_security_notice')}">
                        <span>🛡️</span> <span data-i18n="bank_sync_badge_secure">${window.i18n.t('bank_sync_badge_secure')}</span>
                    </span>
                    <span id="bankSyncVaultPill" class="bank-sync-vault-wrapper" style="display: inline-flex; align-items: center;"></span>
                </div>

                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <!-- Auto-Sync Widget & Status -->
                    <div id="bankSyncAutoSyncCompact" class="bank-sync-auto-sync-widget" style="display: ${this.connections.length > 0 ? 'inline-flex' : 'none'};"></div>


                    <button id="btnHeaderBgSync" class="btn btn-secondary overview-bank-sync-btn" onclick="window.BankSyncView.triggerBackgroundSyncNow()" style="display: ${this.connections.length > 0 ? 'inline-flex' : 'none'}; height: 36px; padding: 0 14px; font-size: 13px; border-radius: 9px; align-items: center; gap: 6px; font-weight: 600; box-sizing: border-box; white-space: nowrap;" data-i18n-title="bank_sync_run_background_tooltip" title="${window.i18n.t('bank_sync_run_background_tooltip') || 'Interroge vos banques connectées en tâche de fond pour récupérer les dernières opérations, détecter les correspondances à rapprocher et actualiser vos soldes sans bloquer l\'interface.'}">
                        <span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne'}</span>
                    </button>

                    <button class="btn btn-primary" onclick="window.BankSyncView.openAddModal()" style="display: inline-flex; height: 36px; align-items: center; gap: 6px; font-weight: 700; padding: 0 16px; font-size: 13px; border-radius: 9px; box-shadow: 0 2px 8px var(--accent-glow); box-sizing: border-box; white-space: nowrap;">
                        <span>➕</span> <span data-i18n="bank_sync_add_btn">${window.i18n.t('bank_sync_add_btn')}</span>
                    </button>

                </div>
            </div>

            <!-- Encart Opérations en attente (si détectées par le scheduler) -->
            <div id="bankPendingSyncBox" style="display: none; margin-bottom: 14px;"></div>

            <!-- Liste des Connexions (Grille moderne) -->
            <div id="bankConnectionsList">
                <div style="text-align: center; padding: 20px; color: var(--text-muted);" data-i18n="bank_sync_loading_connections">
                    ${window.i18n.t('bank_sync_loading_connections')}
                </div>
            </div>
        </div>
        `;
    },

    async init() {
        await Promise.all([
            this.loadConnections(),
            this.loadBackends(),
            this.loadLocalAccounts(),
            this.loadVaultStatus(),
            this.loadAutoSyncSettings(),
            this.loadPendingSync()
        ]);
    },

    // ── TOAST NOTIFICATIONS (Custom in-app) ──────────────────────────
    showToast(message, type = 'info') {
        if (typeof window.showToast === 'function') {
            window.showToast(message, type);
            return;
        }
        let container = document.getElementById('bankSyncToastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'bankSyncToastContainer';
            container.style.cssText = 'position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        toast.style.pointerEvents = 'auto';

        const bg = type === 'success' ? '#10b981' : (type === 'error' ? '#ef4444' : '#6366f1');
        const icon = type === 'success' ? '✔' : (type === 'error' ? '⚠️' : 'ℹ️');

        toast.style.cssText = `
            background: var(--bg-card);
            border-left: 4px solid ${bg};
            border-top: 1px solid var(--border-color);
            border-right: 1px solid var(--border-color);
            border-bottom: 1px solid var(--border-color);
            color: var(--text-main);
            padding: 12px 18px;
            border-radius: 10px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.3);
            font-size: 13px;
            display: flex;
            align-items: center;
            gap: 10px;
            min-width: 260px;
            max-width: 400px;
            animation: slideIn 0.3s ease;
        `;
        toast.innerHTML = `<span style="font-weight:700; color:${bg};">${icon}</span> <span>${message}</span>`;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.4s ease';
            setTimeout(() => toast.remove(), 400);
        }, 3500);
    },

    ensureModalsExist() {
        if (document.getElementById('bankSyncGlobalModalsContainer')) return;
        const aiEnabled = this.isAIEnabled();

        const container = document.createElement('div');
        container.id = 'bankSyncGlobalModalsContainer';
        container.innerHTML = `
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Ajouter une banque -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="addBankModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 10000; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 650px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.4); overflow: hidden;">
                <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        <span>🏦</span> <span data-i18n="bank_sync_modal_title">${window.i18n.t('bank_sync_modal_title')}</span>
                    </h3>
                    <button onclick="window.BankSyncView.closeAddModal()" style="background: none; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>

                <div id="addBankModalBody" style="padding: 24px; overflow-y: auto; flex: 1;">
                    <div id="stepSelectBank">
                        <label style="display: block; font-weight: 600; font-size: 14px; margin-bottom: 10px; color: var(--text-main);" data-i18n="bank_sync_select_bank">
                            ${window.i18n.t('bank_sync_select_bank')}
                        </label>
                        <div style="position: relative; margin-bottom: 14px;">
                            <input type="text" id="bankSearchInput" class="input-styled" placeholder="${window.i18n.t('bank_sync_search_placeholder')}" style="width: 100%; padding-left: 38px; border-radius: 10px;" oninput="window.BankSyncView.filterBackends(this.value)" />
                            <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); opacity: 0.5;">🔍</span>
                        </div>
                        <div id="backendsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; max-height: 240px; overflow-y: auto; padding: 4px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-base);"></div>
                    </div>

                    <div id="stepCredentials" style="display: none; margin-top: 10px;">
                        <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px;">
                            <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_credentials_title">
                                2. Identifiants de connexion
                            </h4>
                            <button class="btn btn-secondary" onclick="window.BankSyncView.backToBankSelection()" style="padding: 5px 12px; font-size: 12px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;">
                                ↩ Changer de banque
                            </button>
                        </div>
                        <div id="selectedBankBanner" style="padding: 10px 14px; background: rgba(99,102,241,0.1); border: 1px solid rgba(99,102,241,0.25); border-radius: 10px; margin-bottom: 16px; font-size: 13px; font-weight: 600; color: var(--accent);"></div>
                        
                        <div style="margin-bottom: 14px;">
                            <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 6px; color: var(--text-main);" data-i18n="bank_sync_conn_label">
                                ${window.i18n ? window.i18n.t('bank_sync_conn_label') : 'Nom de la connexion (ex: Mon Crédit Agricole)'}
                            </label>
                            <input type="text" id="connLabelInput" class="input-styled" placeholder="${window.i18n ? window.i18n.t('bank_sync_conn_label_placeholder') : 'Ex: Mon Crédit Agricole'}" />
                        </div>

                        <div id="dynamicFormFields" style="display: flex; flex-direction: column; gap: 14px;"></div>

                        <div id="masterPwSection" style="margin-top: 20px; padding-top: 18px; border-top: 1px dashed var(--border-color);">
                            <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;" data-i18n="bank_sync_master_pw_title">
                                ${window.i18n ? window.i18n.t('bank_sync_master_pw_title') : '🔐 3. Mot de passe maître (Chiffrement local)'}
                            </label>
                            <p style="font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;" data-i18n="bank_sync_master_pw_desc">
                                ${window.i18n ? window.i18n.t('bank_sync_master_pw_desc') : 'Ce mot de passe sert à chiffrer vos identifiants sur votre machine (Fernet AES). Il ne quitte jamais votre appareil.'}
                            </p>
                            <input type="password" id="connMasterPwInput" class="input-styled" placeholder="${window.i18n ? window.i18n.t('bank_sync_master_pw_field') : 'Entrez un mot de passe maître sécurisé'}" autocomplete="new-password" />
                        </div>
                        <div id="addBankErrorMsg" style="display:none; color:#ef4444; font-size:13px; margin-top:10px; padding:8px 12px; background:rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.25); border-radius:8px;"></div>
                    </div>
                </div>

                <div style="padding: 16px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 10px; background: var(--bg-card);">
                    <button class="btn btn-secondary" onclick="window.BankSyncView.closeAddModal()" data-i18n="bank_sync_cancel">
                        ${window.i18n.t('bank_sync_cancel')}
                    </button>
                    <button id="btnSaveConnection" class="btn btn-primary" onclick="window.BankSyncView.saveConnection()" style="display: none;" data-i18n="bank_sync_save_btn">
                        ${window.i18n.t('bank_sync_save_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Association des comptes (Mapping) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="mappingModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 10000; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 700px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.4); overflow: hidden;">
                <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-card);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_mapping_title">
                            🔗 ${window.i18n.t('bank_sync_mapping_title')}
                        </h3>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.openMappingModal(window.BankSyncView.activeConnId, true)" style="font-size: 12px; padding: 4px 10px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;" title="${window.i18n ? window.i18n.t('bank_sync_refresh_mapping_tooltip') : 'Actualiser la liste depuis votre banque'}">
                            <span>🔄</span> <span data-i18n="bank_sync_refresh_btn">${window.i18n ? window.i18n.t('bank_sync_refresh_btn') : 'Actualiser'}</span>
                        </button>
                    </div>
                    <button onclick="window.BankSyncView.closeMappingModal()" style="background: none; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>
                <div style="padding: 20px 24px; overflow-y: auto; flex: 1;">
                    <p style="font-size: 13px; color: var(--text-muted); margin: 0 0 16px 0;" data-i18n="bank_sync_mapping_desc">
                        ${window.i18n.t('bank_sync_mapping_desc')}
                    </p>
                    <div id="mappingRowsContainer" style="display: flex; flex-direction: column; gap: 12px;"></div>
                </div>
                <div style="padding: 16px 24px; border-top: 1px solid var(--border-color); display: flex; justify-content: flex-end; gap: 10px;">
                    <button class="btn btn-secondary" onclick="window.BankSyncView.closeMappingModal()" data-i18n="bank_sync_cancel">
                        ${window.i18n.t('bank_sync_cancel')}
                    </button>
                    <button class="btn btn-primary" onclick="window.BankSyncView.saveMapping()" data-i18n="bank_sync_save_mapping_btn">
                        ${window.i18n.t('bank_sync_save_mapping_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : 2FA Interactive (Smartphone / OTP) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="twoFAModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 10100; align-items: center; justify-content: center; backdrop-filter: blur(6px);">
            <div style="background: var(--bg-card); border: 2px solid var(--accent); border-radius: 20px; width: 95%; max-width: 480px; padding: 28px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div id="twoFAIcon" style="font-size: 48px; margin-bottom: 16px;">📱</div>
                <h3 id="twoFATitle" style="margin: 0 0 10px 0; font-size: 20px; font-weight: 800; color: var(--text-main);" data-i18n="bank_sync_2fa_title">
                    ${window.i18n.t('bank_sync_2fa_title')}
                </h3>
                <p id="twoFAMessage" style="font-size: 14px; color: var(--text-muted); line-height: 1.5; margin: 0 0 20px 0;" data-i18n="bank_sync_2fa_default_msg">
                    ${window.i18n.t('bank_sync_2fa_default_msg')}
                </p>

                <div id="twoFAOtpInputContainer" style="display: none; margin-bottom: 20px;">
                    <input type="text" id="twoFAOtpInput" class="input-styled" style="width: 100%; font-size: 20px; letter-spacing: 6px; text-align: center; padding: 12px;" placeholder="123456" />
                </div>

                <div style="display: flex; gap: 10px; justify-content: center;">
                    <button class="btn btn-secondary" onclick="window.BankSyncView.cancel2FA()" style="flex: 1;" data-i18n="bank_sync_cancel">
                        ${window.i18n.t('bank_sync_cancel')}
                    </button>
                    <button id="twoFAConfirmBtn" class="btn btn-primary" onclick="window.BankSyncView.submit2FA()" style="flex: 1; font-weight: 700;" data-i18n="bank_sync_2fa_continue">
                        ${window.i18n.t('bank_sync_2fa_continue')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Synchronisation en cours (Progress SSE) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="syncProgressModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10050; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 500px; padding: 28px; text-align: center; box-shadow: 0 20px 40px rgba(0,0,0,0.4);">
                <div style="font-size: 40px; margin-bottom: 14px; display: inline-block; animation: spin-reverse 2s linear infinite;">🔄</div>
                <h3 id="syncProgressTitle" style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_progress_title">
                    ${window.i18n.t('bank_sync_progress_title')}
                </h3>
                <p id="syncProgressMsg" style="font-size: 13px; color: var(--text-muted); margin: 0 0 20px 0;" data-i18n="bank_sync_progress_msg">
                    ${window.i18n.t('bank_sync_progress_msg')}
                </p>
                <div style="width: 100%; height: 8px; background: var(--bg-base); border-radius: 4px; overflow: hidden; margin-bottom: 20px;">
                    <div id="syncProgressBar" style="width: 25%; height: 100%; background: linear-gradient(90deg, #6366f1, #8b5cf6); transition: width 0.3s ease;"></div>
                </div>
                <button class="btn btn-secondary" onclick="window.BankSyncView.abortSync()" style="font-size: 12px;" data-i18n="bank_sync_btn_cancel">
                    ${window.i18n.t('bank_sync_btn_cancel')}
                </button>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Cockpit Unifié — Revue & Validation des Opérations              -->
        <!-- Sert à la fois pour la synchro bancaire ET l'import de relevé CSV/XLSX    -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="bankSyncReviewModal" class="modal-overlay review-modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 10060; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <datalist id="bankSyncDescList"></datalist>
            <div class="review-modal-card">
                <div class="review-modal-header">
                    <div>
                        <h3 id="reviewModalTitle" class="review-modal-title">
                            <span id="reviewModalIcon">📥</span> <span id="reviewModalTitleText" data-i18n="bank_sync_review_title">${window.i18n.t('bank_sync_review_title')}</span>
                        </h3>
                        <p id="reviewModalSubtitle" class="review-modal-subtitle" data-i18n="bank_sync_review_subtitle">
                            ${window.i18n.t('bank_sync_review_subtitle')}
                        </p>
                    </div>
                    <button class="review-modal-close" onclick="window.BankSyncView.closeReviewModal()">&times;</button>
                </div>

                <!-- Barre CSV Import : Sélection de compte + Alertes (masqué en mode synchro) -->
                <div id="reviewCsvBar" class="review-csv-bar" style="display: none;">
                    <div class="review-csv-inner">
                        <div class="review-csv-acc-wrap">
                            <label class="review-csv-acc-label" data-i18n="label_link_account">Lier au compte :</label>
                            <select id="reviewCsvAccountSelect" class="inline-input review-csv-select" onchange="window.BankSyncView.onCsvAccountChanged()">
                                <option value="" data-i18n="opt_no_account">-- Aucun compte sélectionné --</option>
                            </select>
                        </div>
                        <div id="reviewCsvAlertBox" class="review-csv-alert-box" style="display: none;"></div>
                        <div id="reviewCsvBalanceBadge" style="display: none; font-size: 12px;"></div>
                    </div>
                </div>

                <div class="review-modal-toolbar">
                    <div id="reviewAccountTabs" class="review-account-tabs"></div>
                    <div class="review-filter-container">
                        <!-- Mobile selection bar: master checkbox + select all label -->
                        <div class="review-mobile-select-bar">
                            <label class="review-mobile-select-label" for="syncCheckAllMobile">
                                <input type="checkbox" id="syncCheckAllMobile" class="review-mobile-master-check" onchange="window.BankSyncView.toggleCheckAll(this.checked)" checked>
                                <span data-i18n="maintenance_convert_zeroed_select_all">${window.i18n ? window.i18n.t('maintenance_convert_zeroed_select_all') || 'Tout sélectionner' : 'Tout sélectionner'}</span>
                            </label>
                        </div>
                        <!-- Bouton IA visible UNIQUEMENT si l'IA locale est activée -->
                        <div class="review-filter-group">
                            <button class="btn btn-sm btn-secondary review-filter-pill" id="btnSyncCategorizeAllAI" onclick="window.BankSyncView.categorizeAllNewAI()" style="display: ${aiEnabled ? 'inline-flex' : 'none'};" title="${window.i18n.t('bank_categorize_ai_tooltip')}">
                                <span>✨</span> <span data-i18n="bank_categorize_all_ai">${window.i18n.t('bank_categorize_all_ai')}</span>
                            </button>

                            <span class="review-filter-label" data-i18n="bank_sync_filter_label">${window.i18n.t('bank_sync_filter_label')}</span>
                            <button class="btn btn-sm review-filter-pill" id="btnSyncFilterPending" onclick="window.BankSyncView.setReviewFilter('pending')"><span>⚡</span> <span data-i18n="bank_sync_filter_pending">${window.i18n ? window.i18n.t('bank_sync_filter_pending') || 'À traiter' : 'À traiter'}</span></button>
                            <button class="btn btn-sm review-filter-pill" id="btnSyncFilterAll" onclick="window.BankSyncView.setReviewFilter('all')" data-i18n="bank_sync_filter_all">${window.i18n.t('bank_sync_filter_all')}</button>
                            <button class="btn btn-sm review-filter-pill" id="btnSyncFilterAdd" onclick="window.BankSyncView.setReviewFilter('add')" data-i18n="bank_sync_filter_add">${window.i18n.t('bank_sync_filter_add')}</button>
                            <button class="btn btn-sm review-filter-pill" id="btnSyncFilterReconcile" onclick="window.BankSyncView.setReviewFilter('reconcile')" data-i18n="bank_sync_filter_reconcile">${window.i18n.t('bank_sync_filter_reconcile')}</button>
                            <button class="btn btn-sm review-filter-pill" id="btnSyncFilterComing" onclick="window.BankSyncView.setReviewFilter('coming')" data-i18n="bank_sync_filter_coming">⏳ ${window.i18n.t('bank_sync_filter_coming')}</button>
                            <button class="btn btn-sm review-filter-pill" id="btnSyncFilterIgnored" onclick="window.BankSyncView.setReviewFilter('ignored')" data-i18n="bank_sync_filter_ignored">${window.i18n.t('bank_sync_filter_ignored')}</button>
                            <button class="btn btn-sm review-filter-pill" id="btnSyncToggleScores" onclick="window.BankSyncView.toggleReviewScores()" title="${window.i18n ? window.i18n.t('bank_sync_toggle_scores_tooltip') : 'Affiche le score de confiance du rapprochement automatique. Plus le score est élevé, plus la correspondance entre l\'opération bancaire et votre opération locale est fiable.'}">
                                <span>🎯</span> <span data-i18n="bank_sync_toggle_scores">${window.i18n ? window.i18n.t('bank_sync_toggle_scores') : 'Scores'}</span>
                            </button>
                        </div>
                    </div>
                </div>

                <div class="review-table-container">
                    <table class="review-table">
                        <thead class="review-thead">
                            <tr>
                                <th class="review-th-check">
                                    <input type="checkbox" id="syncCheckAll" onchange="window.BankSyncView.toggleCheckAll(this.checked)" checked title="${window.i18n ? window.i18n.t('bank_sync_check_all_tooltip') || 'Tout cocher / Tout décocher' : 'Tout cocher / Tout décocher'}" style="cursor: pointer; transform: scale(1.15);">
                                </th>
                                <th class="review-th-date" data-i18n="bank_sync_th_date">${window.i18n.t('bank_sync_th_date')}</th>
                                <th class="review-th-desc" data-i18n="bank_sync_th_description">${window.i18n.t('bank_sync_th_description')}</th>
                                <th class="review-th-cat" data-i18n="bank_sync_th_category">${window.i18n.t('bank_sync_th_category')}</th>
                                <th class="review-th-amount" data-i18n="bank_sync_th_amount">${window.i18n.t('bank_sync_th_amount')}</th>
                                <th class="review-th-status" data-i18n="bank_sync_th_status">${window.i18n.t('bank_sync_th_status')}</th>
                                <th class="review-th-action" data-i18n="bank_sync_th_action">${window.i18n.t('bank_sync_th_action')}</th>
                            </tr>
                        </thead>
                        <tbody id="bankSyncReviewBody" class="review-tbody"></tbody>
                    </table>
                </div>

                <div class="review-modal-footer">
                    <div id="reviewSummaryBox" class="review-summary-box"></div>
                    <div class="review-footer-buttons">
                        <button class="btn btn-secondary review-btn-cancel" onclick="window.BankSyncView.closeReviewModal()" data-i18n="bank_sync_btn_cancel">
                            ${window.i18n.t('bank_sync_btn_cancel')}
                        </button>
                        <button class="btn btn-primary review-btn-commit" id="btnCommitSync" onclick="window.BankSyncView.commitSync()" data-i18n="bank_sync_btn_commit">
                            ${window.i18n.t('bank_sync_btn_commit')}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale In-App : Délai Anti-Spam & Réouverture de l'Aperçu Récent -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="bankSyncCooldownModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10150; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 480px; padding: 26px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div style="font-size: 42px; margin-bottom: 12px;">⏳</div>
                <h3 style="margin: 0 0 8px 0; font-size: 18px; font-weight: 800; color: var(--text-main);" data-i18n="bank_sync_cooldown_title">
                    ${window.i18n.t('bank_sync_cooldown_title')}
                </h3>
                <p id="cooldownModalMsg" style="font-size: 13px; color: var(--text-muted); line-height: 1.5; margin: 0 0 20px 0;" data-i18n="bank_sync_cooldown_msg">
                    ${window.i18n.t('bank_sync_cooldown_msg')}
                </p>

                <div style="display: flex; flex-direction: column; gap: 10px;">
                    <button id="btnReopenCachedPreview" class="btn btn-primary" style="display: none; font-weight: 700; padding: 10px; border-radius: 10px; justify-content: center;" onclick="window.BankSyncView.reopenCachedPreview()" data-i18n="bank_sync_reopen_cached_btn">
                        ${window.i18n.t('bank_sync_reopen_cached_btn')}
                    </button>
                    <button class="btn btn-secondary" style="font-size: 12px; padding: 8px; border-radius: 8px;" onclick="window.BankSyncView.forceSyncAnyway()" data-i18n="bank_sync_force_sync_btn">
                        ${window.i18n.t('bank_sync_force_sync_btn')}
                    </button>
                    <button class="btn btn-secondary" style="font-size: 12px; padding: 8px; border-radius: 8px; opacity: 0.8;" onclick="window.BankSyncView.closeCooldownModal()" data-i18n="bank_sync_close_btn">
                        ${window.i18n.t('bank_sync_close_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale In-App : Saisie du Mot de Passe Maître avec Option de Mémorisation -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="masterPasswordModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10200; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 440px; padding: 24px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div style="font-size: 40px; margin-bottom: 12px;">🔐</div>
                <h3 id="masterPwModalTitle" style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_master_pw_modal_title">
                    ${window.i18n.t('bank_sync_master_pw_modal_title')}
                </h3>
                <p id="masterPwModalMsg" style="font-size: 13px; color: var(--text-muted); line-height: 1.4; margin: 0 0 16px 0;" data-i18n="bank_sync_master_pw_modal_msg">
                    ${window.i18n.t('bank_sync_master_pw_modal_msg')}
                </p>

                <!-- Information contextuelle si le coffre est déjà actif sur le serveur (autre PC / Docker) -->
                <div id="masterPwModalNotice" style="display: none; margin-bottom: 14px; padding: 10px 14px; background: rgba(99, 102, 241, 0.12); border: 1px solid rgba(99, 102, 241, 0.3); border-radius: 10px; font-size: 12px; line-height: 1.45; color: var(--text-main); text-align: left;">
                    <div style="font-weight: 700; color: var(--accent, #6366f1); margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
                        <span>🌐</span> <span id="masterPwModalNoticeTitle" data-i18n="bank_sync_vault_server_active_title">${window.i18n ? window.i18n.t('bank_sync_vault_server_active_title') || 'Coffre-fort actif sur le serveur' : 'Coffre-fort actif sur le serveur'}</span>
                    </div>
                    <div id="masterPwModalNoticeDesc" style="color: var(--text-muted);" data-i18n="bank_sync_vault_server_active_desc">
                        ${window.i18n ? window.i18n.t('bank_sync_vault_server_active_desc') || 'Votre coffre est déjà déverrouillé sur le serveur (les relevés automatiques fonctionnent). Veuillez vous authentifier sur cet appareil avec votre mot de passe maître pour autoriser les actions manuelles depuis ce poste.' : 'Votre coffre est déjà déverrouillé sur le serveur (les relevés automatiques fonctionnent). Veuillez vous authentifier sur cet appareil avec votre mot de passe maître pour autoriser les actions manuelles depuis ce poste.'}
                    </div>
                </div>
                <div style="margin-bottom: 14px;">
                    <input type="password" id="masterPwModalInput" class="input-styled" style="width: 100%; text-align: center; font-size: 16px; padding: 10px;" placeholder="${window.i18n.t('bank_sync_master_pw_modal_placeholder')}" onkeydown="if(event.key==='Enter') window.BankSyncView._submitMasterPw()" autocomplete="current-password" />
                </div>

                <!-- Option de Mémorisation en Mémoire (RAM TTL) -->
                <div style="margin-bottom: 18px; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 10px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; text-align: left;">
                    <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: var(--text-main); margin: 0;">
                        <input type="checkbox" id="masterPwRememberCheck" checked />
                        <span data-i18n="bank_vault_remember_label">${window.i18n.t('bank_vault_remember_label')}</span>
                    </label>
                    <select id="masterPwRememberDays" class="input-styled" style="padding: 2px 6px; font-size: 11px; border-radius: 6px;">
                        <option value="3">${window.i18n.t('bank_vault_remember_days_3')}</option>
                        <option value="7" selected>${window.i18n.t('bank_vault_remember_days_7')}</option>
                        <option value="14">${window.i18n.t('bank_vault_remember_days_14')}</option>
                        <option value="30">${window.i18n.t('bank_vault_remember_days_30')}</option>
                    </select>
                </div>

                <div id="masterPwModalError" style="display: none; color: #ef4444; font-size: 12px; margin-bottom: 14px; background: rgba(239,68,68,0.1); padding: 8px; border-radius: 8px;"></div>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" style="flex: 1;" onclick="window.BankSyncView._cancelMasterPw()" data-i18n="bank_sync_btn_cancel">
                        ${window.i18n.t('bank_sync_btn_cancel')}
                    </button>
                    <button class="btn btn-primary" style="flex: 1; font-weight: 700;" onclick="window.BankSyncView._submitMasterPw()" data-i18n="bank_sync_master_pw_unlock_btn">
                        ${window.i18n.t('bank_sync_master_pw_unlock_btn')}
                    </button>
                </div>
                <div style="margin-top: 14px; text-align: center; border-top: 1px dashed var(--border-color); padding-top: 10px;">
                    <a href="javascript:void(0)" onclick="window.BankSyncView._cancelMasterPw(); window.BankSyncView.resetVault();" style="font-size: 11.5px; color: var(--text-muted); text-decoration: underline; cursor: pointer;">
                        🔑 <span data-i18n="bank_sync_reset_vault_link">${window.i18n.t('bank_sync_reset_vault_link')}</span>
                    </a>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Ajustement du solde du compte (1-clic) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="balanceAdjustModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10200; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 580px; box-shadow: 0 25px 50px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column;">
                <div style="padding: 18px 22px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center;">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        <span>⚖️</span> <span id="balanceAdjustModalTitle" data-i18n="modal_adjust_balance_title">${window.i18n ? window.i18n.t('modal_adjust_balance_title', 'Ajustement du solde du compte') : 'Ajustement du solde du compte'}</span>
                    </h3>
                    <button onclick="window.BankSyncView.closeBalanceAdjustModal()" style="background: none; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>

                <div style="padding: 20px 22px; display: flex; flex-direction: column; gap: 16px;">
                    <div id="balanceAdjustModalHeader" style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 16px; font-size: 13px; color: var(--text-muted); line-height: 1.4;">
                    </div>

                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <!-- Option 1: Ajuster solde initial -->
                        <div style="background: var(--bg-surface, var(--bg-base)); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; transition: border-color 0.2s;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="font-weight: 700; font-size: 14px; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                    <span>🎯</span> <span data-i18n="modal_adjust_opt_initial_title">${window.i18n ? window.i18n.t('modal_adjust_opt_initial_title', 'Ajuster le solde initial (Recommandé)') : 'Ajuster le solde initial (Recommandé)'}</span>
                                </div>
                                <span class="badge" data-i18n="modal_adjust_badge_no_entry" style="background: rgba(16, 185, 129, 0.15); color: #10b981; font-weight: 700; font-size: 10px; padding: 2px 6px; border-radius: 4px;">${window.i18n ? window.i18n.t('modal_adjust_badge_no_entry', 'Sans écriture') : 'Sans écriture'}</span>
                            </div>
                            <p data-i18n="modal_adjust_opt_initial_desc" style="margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.4;">
                                ${window.i18n ? window.i18n.t('modal_adjust_opt_initial_desc', 'Ajuste le solde de départ du compte sans créer d\'opération fictive ni fausser vos graphiques de dépenses et budgets.') : 'Ajuste le solde de départ du compte sans créer d\'opération fictive ni fausser vos graphiques de dépenses et budgets.'}
                            </p>
                            <button id="btnAdjustInitialBalance" class="btn btn-primary" onclick="window.BankSyncView.submitBalanceAdjustment('initial_balance')" style="align-self: flex-start; margin-top: 4px; font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 6px;">
                                🎯 Ajuster le solde initial
                            </button>
                        </div>

                        <!-- Option 2: Créer opération d'intérêts / régularisation -->
                        <div style="background: var(--bg-surface, var(--bg-base)); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <div style="font-weight: 700; font-size: 14px; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                    <span>📝</span> <span data-i18n="modal_adjust_opt_tx_title">${window.i18n ? window.i18n.t('modal_adjust_opt_tx_title', 'Créer une écriture d\'intérêts ou régularisation') : 'Créer une écriture d\'intérêts ou régularisation'}</span>
                                </div>
                                <span class="badge" data-i18n="modal_adjust_badge_recorded" style="background: rgba(99, 102, 241, 0.15); color: #6366f1; font-weight: 700; font-size: 10px; padding: 2px 6px; border-radius: 4px;">${window.i18n ? window.i18n.t('modal_adjust_badge_recorded', 'Comptabilisé') : 'Comptabilisé'}</span>
                            </div>
                            <p data-i18n="modal_adjust_opt_tx_desc" style="margin: 0; font-size: 12px; color: var(--text-muted); line-height: 1.4;">
                                ${window.i18n ? window.i18n.t('modal_adjust_opt_tx_desc', 'Enregistre une opération rapprochée du montant exact (idéal pour les intérêts annuels de livrets d\'épargne ou frais bancaires).') : 'Enregistre une opération rapprochée du montant exact (idéal pour les intérêts annuels de livrets d\'épargne ou frais bancaires).'}
                            </p>
                            
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 2px;">
                                <div>
                                    <label data-i18n="modal_adjust_tx_label" style="display: block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">
                                        ${window.i18n ? window.i18n.t('modal_adjust_tx_label', 'Libellé de l\'opération') : 'Libellé de l\'opération'}
                                    </label>
                                    <input type="text" id="balanceAdjustTxDesc" class="input-styled" style="width: 100%; font-size: 12px; padding: 5px 8px; border-radius: 6px;" />
                                </div>
                                <div>
                                    <label data-i18n="modal_adjust_tx_cat" style="display: block; font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 4px;">
                                        ${window.i18n ? window.i18n.t('modal_adjust_tx_cat', 'Catégorie') : 'Catégorie'}
                                    </label>
                                    <select id="balanceAdjustTxCategory" class="input-styled" style="width: 100%; font-size: 12px; padding: 5px 8px; border-radius: 6px;">
                                    </select>
                                </div>
                            </div>

                            <button id="btnAdjustCreateTx" class="btn btn-secondary" onclick="window.BankSyncView.submitBalanceAdjustment('transaction')" style="align-self: flex-start; margin-top: 4px; font-size: 12px; font-weight: 700; padding: 6px 14px; border-radius: 6px;">
                                📝 Créer l'opération rapprochée
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale : Liaison Manuelle Ghost -> Opération DB -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="linkGhostModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 10250; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 680px; max-height: 90vh; box-shadow: 0 25px 50px rgba(0,0,0,0.5); overflow: hidden; display: flex; flex-direction: column;">
                
                <!-- En-tête -->
                <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-card);">
                    <h3 style="margin: 0; font-size: 16px; font-weight: 700; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                        <span>🔗</span> <span data-i18n="ghost_link_modal_title">${window.i18n ? window.i18n.t('ghost_link_modal_title', 'Lier l\'opération en ligne à la base de données') : 'Lier l\'opération en ligne à la base de données'}</span>
                    </h3>
                    <button onclick="window.BankSyncView.closeLinkGhostModal()" style="background: none; border: none; font-size: 22px; cursor: pointer; color: var(--text-muted); line-height: 1;">&times;</button>
                </div>

                <!-- Corps scrollable -->
                <div style="padding: 18px 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px;">
                    
                    <!-- Carte résumé de l'opération en ligne (Ghost) -->
                    <div id="linkGhostSourceSummary" style="background: rgba(245, 158, 11, 0.08); border: 1px dashed rgba(245, 158, 11, 0.35); border-radius: 12px; padding: 12px 16px;">
                    </div>

                    <!-- Barre de recherche DB -->
                    <div>
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <label style="font-size: 12px; font-weight: 700; color: var(--text-main);" data-i18n="ghost_link_search_label">
                                ${window.i18n ? window.i18n.t('ghost_link_search_label', 'Rechercher une opération existante') : 'Rechercher une opération existante'}
                            </label>
                            <label style="display: flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--text-muted); cursor: pointer;">
                                <input type="checkbox" id="linkGhostUnrecOnly" checked onchange="window.BankSyncView.onLinkGhostSearchInput()" />
                                <span data-i18n="ghost_link_search_unrec_only">${window.i18n ? window.i18n.t('ghost_link_search_unrec_only', 'Non rapprochées uniquement') : 'Non rapprochées uniquement'}</span>
                            </label>
                        </div>
                        <div style="position: relative;">
                            <input type="text" id="linkGhostSearchInput" class="input-styled" style="width: 100%; font-size: 13px; padding: 8px 12px 8px 34px; border-radius: 8px;" placeholder="${window.i18n ? window.i18n.t('ghost_link_search_placeholder', 'Rechercher par libellé, catégorie ou montant (ex: 45.50)...') : 'Rechercher par libellé, catégorie ou montant (ex: 45.50)...'}" oninput="window.BankSyncView.onLinkGhostSearchInput()" />
                            <span style="position: absolute; left: 10px; top: 50%; transform: translateY(-50%); font-size: 14px; opacity: 0.5;">🔍</span>
                        </div>
                    </div>

                    <!-- Liste des résultats de recherche -->
                    <div style="display: flex; flex-direction: column; gap: 6px;">
                        <span style="font-size: 11px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;" data-i18n="ghost_link_select_hint">
                            ${window.i18n ? window.i18n.t('ghost_link_select_hint', 'Sélectionnez une opération ci-dessous pour la lier :') : 'Sélectionnez une opération ci-dessous pour la lier :'}
                        </span>
                        <div id="linkGhostResultsList" style="max-height: 180px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 10px; background: var(--bg-base); padding: 6px; display: flex; flex-direction: column; gap: 4px;">
                        </div>
                    </div>

                    <!-- Panneau de résolution des conflits de champs -->
                    <div id="linkGhostResolutionPanel" style="display: none; background: var(--bg-surface, var(--bg-base)); border: 1px solid var(--accent, #6366f1); border-radius: 12px; padding: 14px 16px; flex-direction: column; gap: 14px;">
                        <div>
                            <div style="font-weight: 700; font-size: 13.5px; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                                <span>⚖️</span> <span data-i18n="ghost_link_resolution_title">${window.i18n ? window.i18n.t('ghost_link_resolution_title', 'Résolution des champs avant liaison') : 'Résolution des champs avant liaison'}</span>
                            </div>
                            <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;" data-i18n="ghost_link_resolution_subtitle">
                                ${window.i18n ? window.i18n.t('ghost_link_resolution_subtitle', 'Choisissez quelle valeur conserver pour chaque champ ou modifiez-la manuellement :') : 'Choisissez quelle valeur conserver pour chaque champ ou modifiez-la manuellement :'}
                            </div>
                        </div>

                        <!-- Ligne Libellé -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 11.5px; font-weight: 700; color: var(--text-main);" data-i18n="ghost_link_field_desc">${window.i18n ? window.i18n.t('ghost_link_field_desc', 'Libellé') : 'Libellé'}</label>
                                <div style="display: flex; gap: 4px;">
                                    <button type="button" class="btn btn-xs" id="linkPillDescDb" onclick="window.BankSyncView.setLinkFieldSource('desc', 'db')">${window.i18n ? window.i18n.t('ghost_link_source_db', 'OmniBank') : 'OmniBank'}</button>
                                    <button type="button" class="btn btn-xs" id="linkPillDescOnline" onclick="window.BankSyncView.setLinkFieldSource('desc', 'online')">${window.i18n ? window.i18n.t('ghost_link_source_online', 'En ligne') : 'En ligne'}</button>
                                </div>
                            </div>
                            <input type="text" id="linkFinalDesc" class="input-styled" style="width: 100%; font-size: 12px; padding: 6px 10px; border-radius: 6px;" />
                            <div id="linkDescOriginalHint" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;"></div>
                        </div>

                        <!-- Ligne Montant -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 11.5px; font-weight: 700; color: var(--text-main);" data-i18n="ghost_link_field_amount">${window.i18n ? window.i18n.t('ghost_link_field_amount', 'Montant') : 'Montant'}</label>
                                <div style="display: flex; gap: 4px;">
                                    <button type="button" class="btn btn-xs" id="linkPillAmountDb" onclick="window.BankSyncView.setLinkFieldSource('amount', 'db')">${window.i18n ? window.i18n.t('ghost_link_source_db', 'OmniBank') : 'OmniBank'}</button>
                                    <button type="button" class="btn btn-xs" id="linkPillAmountOnline" onclick="window.BankSyncView.setLinkFieldSource('amount', 'online')">${window.i18n ? window.i18n.t('ghost_link_source_online', 'En ligne') : 'En ligne'}</button>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 6px;">
                                <input type="number" step="0.01" id="linkFinalAmount" class="input-styled" style="flex: 1; font-size: 12px; padding: 6px 10px; border-radius: 6px;" />
                                <span style="font-size: 12px; font-weight: 700; color: var(--text-muted);">€</span>
                            </div>
                        </div>

                        <!-- Ligne Catégorie -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <label style="font-size: 11.5px; font-weight: 700; color: var(--text-main);" data-i18n="ghost_link_field_category">${window.i18n ? window.i18n.t('ghost_link_field_category', 'Catégorie') : 'Catégorie'}</label>
                                <div style="display: flex; gap: 4px;">
                                    <button type="button" class="btn btn-xs" id="linkPillCatDb" onclick="window.BankSyncView.setLinkFieldSource('cat', 'db')">${window.i18n ? window.i18n.t('ghost_link_source_db', 'OmniBank') : 'OmniBank'}</button>
                                    <button type="button" class="btn btn-xs" id="linkPillCatOnline" onclick="window.BankSyncView.setLinkFieldSource('cat', 'online')">${window.i18n ? window.i18n.t('ghost_link_source_online', 'En ligne') : 'En ligne'}</button>
                                </div>
                            </div>
                            <select id="linkFinalCategory" class="input-styled" style="width: 100%; font-size: 12px; padding: 6px 10px; border-radius: 6px;">
                            </select>
                        </div>

                        <!-- Ligne Date de Pointage -->
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            <label style="font-size: 11.5px; font-weight: 700; color: var(--text-main);" data-i18n="ghost_link_field_recon_date">${window.i18n ? window.i18n.t('ghost_link_field_recon_date', 'Date de pointage') : 'Date de pointage'}</label>
                            <input type="date" id="linkFinalReconDate" class="input-styled" style="width: 100%; font-size: 12px; padding: 6px 10px; border-radius: 6px;" />
                        </div>
                    </div>
                </div>

                <!-- Pied de modale avec boutons d'actions -->
                <div style="padding: 12px 20px; border-top: 1px solid var(--border-color); background: var(--bg-card); display: flex; justify-content: flex-end; gap: 10px; align-items: center;">
                    <button class="btn btn-secondary" onclick="window.BankSyncView.closeLinkGhostModal()" data-i18n="bank_sync_btn_cancel">
                        ${window.i18n ? window.i18n.t('bank_sync_btn_cancel', 'Annuler') : 'Annuler'}
                    </button>
                    <button id="btnSubmitLinkGhost" class="btn btn-primary" onclick="window.BankSyncView.submitGhostLink()" style="font-weight: 700; padding: 8px 16px; border-radius: 8px; display: inline-flex; align-items: center; gap: 6px;" disabled>
                        <span data-i18n="ghost_link_submit_btn">${window.i18n ? window.i18n.t('ghost_link_submit_btn', '🔗 Lier et pointer l\'opération') : '🔗 Lier et pointer l\'opération'}</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale In-App : Confirmation de Suppression -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="confirmDeleteModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10200; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 440px; padding: 24px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div style="font-size: 40px; margin-bottom: 12px;">🗑️</div>
                <h3 id="confirmDeleteTitle" style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_delete_title">
                    ${window.i18n.t('bank_sync_delete_title')}
                </h3>
                <p id="confirmDeleteMsg" style="font-size: 13px; color: var(--text-muted); line-height: 1.4; margin: 0 0 20px 0;" data-i18n="bank_sync_delete_msg">
                    ${window.i18n.t('bank_sync_delete_msg')}
                </p>
                <div style="display: flex; gap: 10px;">
                    <button class="btn btn-secondary" style="flex: 1;" onclick="window.BankSyncView._cancelConfirm()" data-i18n="bank_sync_btn_cancel">
                        ${window.i18n.t('bank_sync_btn_cancel')}
                    </button>
                    <button class="btn btn-danger" style="flex: 1; font-weight: 700; background: #ef4444; color: white;" onclick="window.BankSyncView._submitConfirm()" data-i18n="bank_sync_delete_confirm_btn">
                        ${window.i18n.t('bank_sync_delete_confirm_btn')}
                    </button>
                </div>
            </div>
        </div>

        <!-- Conteneur Toast pour Notifications Flottantes -->
        <div id="bankSyncToastContainer" style="position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; flex-direction: column; gap: 10px; pointer-events: none;"></div>
        `;
        document.body.appendChild(container);
    },
    // Les méthodes suivantes sont chargées via des modules séparés :
    // bank_sync_vault.js, bank_sync_connections.js, bank_sync_sync.js,
    // bank_sync_review.js, bank_sync_pending.js
};
