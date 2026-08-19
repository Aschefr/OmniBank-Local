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

    // ── GESTION DU TOKEN DE SESSION COFFRE (RAM TTL BACKEND) ────────
    getVaultToken() {
        if (window.ProfileStorage) {
            return window.ProfileStorage.get('vault_token') || null;
        }
        return null;
    },

    setVaultToken(token) {
        if (window.ProfileStorage) {
            if (token) {
                window.ProfileStorage.set('vault_token', token);
            } else {
                window.ProfileStorage.remove('vault_token');
            }
        }
        // Purger également toute clé globale résiduelle
        try { localStorage.removeItem('omnibank_vault_token'); } catch (_) {}
    },

    clearVaultToken() {
        if (window.ProfileStorage) {
            window.ProfileStorage.remove('vault_token');
        }
        try { localStorage.removeItem('omnibank_vault_token'); } catch (_) {}
    },

    isAIEnabled() {
        return Boolean(window.app && window.app.config && (window.app.config.enable_ai === 'true' || window.app.config.enable_ai === true));
    },

    // ── GESTION DU CACHE DU DERNIER APERÇU ──────────────────────────
    saveCachedPreview(connId, previewData) {
        try {
            const entry = {
                timestamp: Date.now(),
                data: previewData
            };
            sessionStorage.setItem(`omnibank_sync_preview_${connId}`, JSON.stringify(entry));
        } catch (e) {
            console.warn('[BankSync] Impossible de cacher l\'aperçu:', e);
        }
    },

    getCachedPreview(connId) {
        try {
            const raw = sessionStorage.getItem(`omnibank_sync_preview_${connId}`);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    },

    // ── CACHE DES COMPTES DISTANTS À ASSOCIER (MAPPING INSTANTANÉ) ────
    _getRemoteAccountsCacheKey(conn) {
        if (!conn) return null;
        const connId = typeof conn === 'object' ? conn.id : conn;
        const backend = typeof conn === 'object' ? (conn.backend || 'unknown') : 'generic';
        const profileId = (window.ProfileStorage && window.ProfileStorage.getActiveProfileId) ? window.ProfileStorage.getActiveProfileId() : 'default';
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
                localStorage.removeItem(`omnibank_remote_accounts_${connId}`);
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
                    <span style="font-size: 11.5px; font-weight: 600; background: rgba(99, 102, 241, 0.12); color: var(--accent); border: 1px solid rgba(99, 102, 241, 0.25); height: 26px; padding: 0 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 5px; cursor: help; box-sizing: border-box; line-height: 1;" title="${window.i18n.t('bank_sync_security_notice')}">
                        <span>🛡️</span> <span>100% Local & Chiffré</span>
                    </span>
                    <span id="bankSyncVaultPill" style="display: inline-flex; align-items: center;"></span>
                </div>

                <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                    <!-- Auto-Sync Widget & Status -->
                    <div id="bankSyncAutoSyncCompact" class="bank-sync-auto-sync-widget" style="display: ${this.connections.length > 0 ? 'inline-flex' : 'none'};"></div>


                    <button id="btnHeaderBgSync" class="btn btn-secondary overview-bank-sync-btn" onclick="window.BankSyncView.triggerBackgroundSyncNow()" style="display: ${this.connections.length > 0 ? 'inline-flex' : 'none'}; height: 36px; padding: 0 14px; font-size: 13px; border-radius: 9px; align-items: center; gap: 6px; font-weight: 600; box-sizing: border-box; white-space: nowrap;" data-i18n-title="bank_sync_run_background_tooltip" title="${window.i18n.t('bank_sync_run_background_tooltip') || 'Interroge vos banques connectées en tâche de fond pour récupérer les dernières opérations, détecter les correspondances à pointer et actualiser vos soldes sans bloquer l\'interface.'}">
                        <span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne'}</span>
                    </button>

                    <button class="btn btn-primary" onclick="window.BankSyncView.openAddModal()" style="display: inline-flex; height: 36px; align-items: center; gap: 6px; font-weight: 700; padding: 0 16px; font-size: 13px; border-radius: 9px; box-shadow: 0 2px 8px rgba(99,102,241,0.25); box-sizing: border-box; white-space: nowrap;">
                        <span>➕</span> <span data-i18n="bank_sync_add_btn">${window.i18n.t('bank_sync_add_btn')}</span>
                    </button>

                </div>
            </div>

            <!-- Encart Opérations en attente (si détectées par le scheduler) -->
            <div id="bankPendingSyncBox" style="display: none; margin-bottom: 14px;"></div>

            <!-- Liste des Connexions (Grille moderne) -->
            <div id="bankConnectionsList">
                <div style="text-align: center; padding: 20px; color: var(--text-muted);">
                    Chargement des connexions...
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
        <div id="addBankModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 1000; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
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
                                Nom de la connexion (ex: Mon Crédit Agricole)
                            </label>
                            <input type="text" id="connLabelInput" class="input-styled" placeholder="Ex: Mon Crédit Agricole" />
                        </div>

                        <div id="dynamicFormFields" style="display: flex; flex-direction: column; gap: 14px;"></div>

                        <div id="masterPwSection" style="margin-top: 20px; padding-top: 18px; border-top: 1px dashed var(--border-color);">
                            <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;" data-i18n="bank_sync_master_pw_title">
                                🔐 3. Mot de passe maître (Chiffrement local)
                            </label>
                            <p style="font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;" data-i18n="bank_sync_master_pw_desc">
                                Ce mot de passe sert à chiffrer vos identifiants sur votre machine (Fernet AES). Il ne quitte jamais votre appareil.
                            </p>
                            <input type="password" id="connMasterPwInput" class="input-styled" placeholder="Entrez un mot de passe maître sécurisé" autocomplete="new-password" />
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
        <div id="mappingModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.65); z-index: 1000; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 700px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 20px 40px rgba(0,0,0,0.4); overflow: hidden;">
                <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-card);">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <h3 style="margin: 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_mapping_title">
                            🔗 ${window.i18n.t('bank_sync_mapping_title')}
                        </h3>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.openMappingModal(window.BankSyncView.activeConnId, true)" style="font-size: 12px; padding: 4px 10px; border-radius: 8px; display: inline-flex; align-items: center; gap: 4px;" title="Actualiser la liste depuis votre banque">
                            <span>🔄</span> <span data-i18n="bank_sync_refresh_btn">Actualiser</span>
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
        <div id="twoFAModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 1100; align-items: center; justify-content: center; backdrop-filter: blur(6px);">
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
        <div id="syncProgressModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1050; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
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
        <!-- Modale : Revue & Validation des Opérations (Style Import Relevé) -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="bankSyncReviewModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.75); z-index: 1060; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 96%; max-width: 1100px; height: 92vh; display: flex; flex-direction: column; box-shadow: 0 25px 50px rgba(0,0,0,0.5); overflow: hidden;">
                <div style="padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-card);">
                    <div>
                        <h3 id="reviewModalTitle" style="margin: 0 0 4px 0; font-size: 18px; font-weight: 800; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                            <span>📥</span> <span data-i18n="bank_sync_review_title">${window.i18n.t('bank_sync_review_title')}</span>
                        </h3>
                        <p id="reviewModalSubtitle" style="margin: 0; font-size: 13px; color: var(--text-muted);" data-i18n="bank_sync_review_subtitle">
                            ${window.i18n.t('bank_sync_review_subtitle')}
                        </p>
                    </div>
                    <button onclick="window.BankSyncView.closeReviewModal()" style="background: none; border: none; font-size: 24px; cursor: pointer; color: var(--text-muted);">&times;</button>
                </div>

                <div style="padding: 12px 24px; background: var(--bg-base); border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div id="reviewAccountTabs" style="display: flex; gap: 8px; overflow-x: auto; max-width: 50%;"></div>
                    <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
                        <!-- Bouton IA visible UNIQUEMENT si l'IA locale est activée -->
                        <button class="btn btn-sm btn-secondary" id="btnSyncCategorizeAllAI" onclick="window.BankSyncView.categorizeAllNewAI()" style="display: ${aiEnabled ? 'inline-flex' : 'none'}; font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid var(--accent); background: rgba(99,102,241,0.1); color: var(--accent); font-weight: 600; align-items: center; gap: 6px;" title="${window.i18n.t('bank_categorize_ai_tooltip')}">
                            <span>✨</span> <span data-i18n="bank_categorize_all_ai">${window.i18n.t('bank_categorize_all_ai')}</span>
                        </button>

                        <span style="font-size: 12px; color: var(--text-muted); font-weight: 600; margin-left: 6px;" data-i18n="bank_sync_filter_label">${window.i18n.t('bank_sync_filter_label')}</span>
                        <button class="btn btn-sm" id="btnSyncFilterAll" onclick="window.BankSyncView.setReviewFilter('all')" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--accent); background: var(--accent); color: white;" data-i18n="bank_sync_filter_all">${window.i18n.t('bank_sync_filter_all')}</button>
                        <button class="btn btn-sm" id="btnSyncFilterAdd" onclick="window.BankSyncView.setReviewFilter('add')" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted);" data-i18n="bank_sync_filter_add">${window.i18n.t('bank_sync_filter_add')}</button>
                        <button class="btn btn-sm" id="btnSyncFilterReconcile" onclick="window.BankSyncView.setReviewFilter('reconcile')" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted);" data-i18n="bank_sync_filter_reconcile">${window.i18n.t('bank_sync_filter_reconcile')}</button>
                        <button class="btn btn-sm" id="btnSyncFilterIgnored" onclick="window.BankSyncView.setReviewFilter('ignored')" style="padding: 4px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--border-color); background: transparent; color: var(--text-muted);" data-i18n="bank_sync_filter_ignored">${window.i18n.t('bank_sync_filter_ignored')}</button>
                    </div>
                </div>

                <div style="flex: 1; overflow-y: auto; padding: 0;">
                    <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
                        <thead style="position: sticky; top: 0; background: var(--bg-card); z-index: 10; box-shadow: 0 1px 0 var(--border-color);">
                            <tr>
                                <th style="padding: 10px 14px; width: 130px; color: var(--text-muted);" data-i18n="bank_sync_th_date">${window.i18n.t('bank_sync_th_date')}</th>
                                <th style="padding: 10px 14px; color: var(--text-muted);" data-i18n="bank_sync_th_description">${window.i18n.t('bank_sync_th_description')}</th>
                                <th style="padding: 10px 14px; width: 230px; color: var(--text-muted);" data-i18n="bank_sync_th_category">${window.i18n.t('bank_sync_th_category')}</th>
                                <th style="padding: 10px 14px; width: 120px; text-align: right; color: var(--text-muted);" data-i18n="bank_sync_th_amount">${window.i18n.t('bank_sync_th_amount')}</th>
                                <th style="padding: 10px 14px; width: 130px; text-align: center; color: var(--text-muted);" data-i18n="bank_sync_th_status">${window.i18n.t('bank_sync_th_status')}</th>
                                <th style="padding: 10px 14px; width: 140px; text-align: right; color: var(--text-muted);" data-i18n="bank_sync_th_action">${window.i18n.t('bank_sync_th_action')}</th>
                            </tr>
                        </thead>
                        <tbody id="bankSyncReviewBody"></tbody>
                    </table>
                </div>

                <div style="padding: 14px 24px; border-top: 1px solid var(--border-color); background: var(--bg-card); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div id="reviewSummaryBox" style="font-size: 13px; color: var(--text-main); display: flex; gap: 16px;"></div>
                    <div style="display: flex; gap: 10px;">
                        <button class="btn btn-secondary" onclick="window.BankSyncView.closeReviewModal()" data-i18n="bank_sync_btn_cancel">
                            ${window.i18n.t('bank_sync_btn_cancel')}
                        </button>
                        <button class="btn btn-primary" id="btnCommitSync" onclick="window.BankSyncView.commitSync()" style="font-weight: 700; padding: 8px 20px; border-radius: 10px; box-shadow: 0 4px 12px rgba(99,102,241,0.3);" data-i18n="bank_sync_btn_commit">
                            ${window.i18n.t('bank_sync_btn_commit')}
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <!-- Modale In-App : Délai Anti-Spam & Réouverture de l'Aperçu Récent -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="bankSyncCooldownModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1150; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
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
        <div id="masterPasswordModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1200; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
            <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 18px; width: 95%; max-width: 440px; padding: 24px; text-align: center; box-shadow: 0 25px 50px rgba(0,0,0,0.5);">
                <div style="font-size: 40px; margin-bottom: 12px;">🔐</div>
                <h3 id="masterPwModalTitle" style="margin: 0 0 8px 0; font-size: 18px; font-weight: 700; color: var(--text-main);" data-i18n="bank_sync_master_pw_modal_title">
                    ${window.i18n.t('bank_sync_master_pw_modal_title')}
                </h3>
                <p id="masterPwModalMsg" style="font-size: 13px; color: var(--text-muted); line-height: 1.4; margin: 0 0 16px 0;" data-i18n="bank_sync_master_pw_modal_msg">
                    ${window.i18n.t('bank_sync_master_pw_modal_msg')}
                </p>
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
        <!-- Modale In-App : Confirmation de Suppression -->
        <!-- ════════════════════════════════════════════════════════════════════════════ -->
        <div id="confirmDeleteModal" class="modal-overlay" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1200; align-items: center; justify-content: center; backdrop-filter: blur(4px);">
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

    // ── GESTION DU COFFRE & DÉVERROUILLAGE SÉCURISÉ ──────────────────
    formatVaultRemaining(sec) {
        if (!sec || sec <= 0) return '0s';
        const d = Math.floor(sec / 86400);
        const h = Math.floor((sec % 86400) / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        if (d > 0) return `${d}j ${h}h`;
        if (h > 0) return `${h}h ${m}m`;
        if (m > 0) return `${m}m ${s}s`;
        return `${s}s`;
    },

    startVaultCountdown() {
        this.stopVaultCountdown();
        if (!this.vaultStatus?.is_unlocked || !this.vaultStatus?.remaining_seconds) return;

        this._vaultCountdownInterval = setInterval(() => {
            if (!this.vaultStatus || !this.vaultStatus.is_unlocked) {
                this.stopVaultCountdown();
                return;
            }
            this.vaultStatus.remaining_seconds = Math.max(0, this.vaultStatus.remaining_seconds - 1);
            if (this.vaultStatus.remaining_seconds <= 0) {
                this.stopVaultCountdown();
                this.loadVaultStatus();
                return;
            }
            this.updateVaultCountdownDisplay();
        }, 1000);
    },

    stopVaultCountdown() {
        if (this._vaultCountdownInterval) {
            clearInterval(this._vaultCountdownInterval);
            this._vaultCountdownInterval = null;
        }
    },

    updateVaultCountdownDisplay() {
        const pillText = document.getElementById('bankSyncVaultPillText');
        const pillSpan = document.getElementById('bankSyncVaultPillBtn');
        if (!pillText || !this.vaultStatus?.is_unlocked) return;

        const timeStr = this.formatVaultRemaining(this.vaultStatus.remaining_seconds);
        pillText.textContent = `Déverrouillé (${timeStr})`;
        if (pillSpan) {
            pillSpan.title = `Coffre-fort déverrouillé en mémoire (reverrouillage automatique dans ${timeStr}). Cliquez pour verrouiller immédiatement.`;
        }
    },

    async loadVaultStatus() {
        try {
            const token = this.getVaultToken();
            const url = token ? `/api/bank-sync/vault/status?token=${encodeURIComponent(token)}` : '/api/bank-sync/vault/status';
            const data = await API.get(url);
            this.vaultStatus = data;
            if (token && !data.is_unlocked) {
                this.clearVaultToken();
            }
            this.renderVaultStatusBar();
        } catch (e) {
            console.warn('[BankSync] Erreur lecture statut coffre:', e);
            this.clearVaultToken();
            this.vaultStatus = { is_unlocked: false, remaining_days: 0, remaining_seconds: 0 };
            this.renderVaultStatusBar();
        }
    },

    renderVaultStatusBar() {
        const pill = document.getElementById('bankSyncVaultPill');
        const autoSyncBox = document.getElementById('bankSyncAutoSyncCompact');
        const headerBtn = document.getElementById('btnHeaderBgSync');

        if (headerBtn) {
            headerBtn.style.display = this.connections && this.connections.length > 0 ? 'inline-flex' : 'none';
        }
        if (autoSyncBox) {
            autoSyncBox.style.display = this.connections && this.connections.length > 0 ? 'inline-flex' : 'none';
        }

        const isUnlocked = !!this.vaultStatus?.is_unlocked;
        const isAutoSyncEnabled = !!this.autoSyncSettings?.enabled;
        const interval = this.autoSyncSettings?.interval_hours || 24;

        // ── 1. GESTION DU BADGE D'ÉTAT DU COFFRE ──
        if (pill) {
            if (!this.connections || this.connections.length === 0) {
                pill.innerHTML = '';
                pill.style.display = 'none';
                this.stopVaultCountdown();
            } else {
                pill.style.display = 'inline-flex';
                if (isUnlocked) {
                    const timeStr = this.formatVaultRemaining(this.vaultStatus?.remaining_seconds || 0);
                    pill.innerHTML = `
                        <span id="bankSyncVaultPillBtn" style="font-size: 11.5px; font-weight: 600; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.3); height: 26px; padding: 0 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; line-height: 1;" onclick="window.BankSyncView.lockVault()" title="Coffre-fort déverrouillé en mémoire (reverrouillage automatique dans ${timeStr}). Cliquez pour verrouiller immédiatement.">
                            <span>🔓</span> <span id="bankSyncVaultPillText">Déverrouillé (${timeStr})</span> <span style="font-size: 11px; opacity: 0.75;" title="Verrouiller immédiatement">🔒</span>
                        </span>
                    `;
                    this.startVaultCountdown();
                } else {
                    this.stopVaultCountdown();
                    pill.innerHTML = `
                        <span style="font-size: 11.5px; font-weight: 600; background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3); height: 26px; padding: 0 10px; border-radius: 20px; display: inline-flex; align-items: center; gap: 5px; cursor: pointer; transition: all 0.2s ease; box-sizing: border-box; line-height: 1;" onclick="window.BankSyncView.unlockVaultManually()" title="Coffre verrouillé. Cliquez pour déverrouiller avec votre mot de passe maître.">
                            <span>🔒</span> <span>Coffre verrouillé</span> <span style="font-size: 11px; text-decoration: underline; font-weight: 700;">(Déverrouiller)</span>
                        </span>
                    `;
                }
            }
        }

        // ── 2. GESTION DU WIDGET RELEVÉ AUTO ──
        if (autoSyncBox) {
            if (isAutoSyncEnabled && !isUnlocked) {
                // ÉTAT ALERTE CRITIQUE : Relevé auto programmé mais Coffre verrouillé !
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-locked-warning';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: 36px;
                    align-items: center;
                    gap: 8px;
                    padding: 0 12px;
                    background: rgba(245, 158, 11, 0.12);
                    border: 1.5px dashed #f59e0b;
                    border-radius: 10px;
                    font-size: 12px;
                    font-weight: 600;
                    color: #f59e0b;
                    box-sizing: border-box;
                    box-shadow: 0 0 12px rgba(245, 158, 11, 0.15);
                    transition: all 0.25s ease;
                `;
                autoSyncBox.title = "Le relevé automatique est programmé mais NE FONCTIONNE PAS car le coffre est verrouillé ! Cliquez pour déverrouiller.";
                autoSyncBox.innerHTML = `
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap;">
                        <input type="checkbox" id="chkAutoSyncToggle" checked onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: #f59e0b; width: 15px; height: 15px;">
                        <span style="display: inline-flex; align-items: center; gap: 4px;">
                            <span>⚠️</span> <strong style="color: #f59e0b;">Relevé auto :</strong>
                        </span>
                    </label>
                    <select id="selAutoSyncInterval" class="input-styled" style="height: 24px; font-size: 11px; padding: 0 6px; border: 1px solid rgba(245, 158, 11, 0.4); border-radius: 6px; background: rgba(0,0,0,0.25); color: #f59e0b; font-weight: 700; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        <option value="12" ${interval === 12 ? 'selected' : ''}>12h</option>
                        <option value="24" ${interval === 24 ? 'selected' : ''}>24h</option>
                        <option value="48" ${interval === 48 ? 'selected' : ''}>48h</option>
                    </select>
                    <button type="button" class="btn" onclick="window.BankSyncView.unlockVaultManually()" style="height: 24px; padding: 0 8px; font-size: 11px; font-weight: 700; background: #f59e0b; color: #1e1e2d; border-radius: 6px; border: none; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 3px;" title="Déverrouiller le coffre pour autoriser les relevés automatiques">
                        <span>🔓</span> <span>Déverrouiller</span>
                    </button>
                `;
            } else if (isAutoSyncEnabled && isUnlocked) {
                // ÉTAT OPÉRATIONNEL : Coffre déverrouillé & Relevé auto actif
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-active';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: 36px;
                    align-items: center;
                    gap: 8px;
                    padding: 0 12px;
                    background: rgba(16, 185, 129, 0.08);
                    border: 1px solid rgba(16, 185, 129, 0.4);
                    border-radius: 10px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-main);
                    box-sizing: border-box;
                    transition: all 0.25s ease;
                `;
                autoSyncBox.title = `Relevé automatique programmé toutes les ${interval}h (coffre déverrouillé).`;
                autoSyncBox.innerHTML = `
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap;">
                        <input type="checkbox" id="chkAutoSyncToggle" checked onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: #10b981; width: 15px; height: 15px;">
                        <span>⏰ <strong style="color: #10b981;">Relevé auto</strong></span>
                    </label>
                    <select id="selAutoSyncInterval" class="input-styled" style="height: 24px; font-size: 11px; padding: 0 6px; border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 6px; background: rgba(0,0,0,0.15); color: var(--text-main); font-weight: 700; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        <option value="12" ${interval === 12 ? 'selected' : ''}>12h</option>
                        <option value="24" ${interval === 24 ? 'selected' : ''}>24h</option>
                        <option value="48" ${interval === 48 ? 'selected' : ''}>48h</option>
                    </select>
                    <span style="font-size: 10px; font-weight: 700; color: #10b981; background: rgba(16, 185, 129, 0.16); padding: 2px 7px; border-radius: 10px; display: inline-flex; align-items: center; gap: 4px;" title="Le planificateur exécute un relevé toutes les ${interval} heures.">
                        <span style="width: 6px; height: 6px; background: #10b981; border-radius: 50%; display: inline-block;"></span> Actif
                    </span>
                `;
            } else {
                // ÉTAT INACTIF : Relevé auto décoché
                autoSyncBox.className = 'bank-sync-auto-sync-widget is-disabled';
                autoSyncBox.style.cssText = `
                    display: inline-flex;
                    height: 36px;
                    align-items: center;
                    gap: 8px;
                    padding: 0 12px;
                    background: var(--bg-card);
                    border: 1px solid var(--border-color);
                    border-radius: 10px;
                    font-size: 12px;
                    font-weight: 600;
                    color: var(--text-muted);
                    box-sizing: border-box;
                    transition: all 0.25s ease;
                `;
                autoSyncBox.title = isUnlocked ? "Activer le relevé automatique en arrière-plan." : "Activer le relevé automatique (nécessite de déverrouiller le coffre).";
                autoSyncBox.innerHTML = `
                    <label style="display: inline-flex; align-items: center; gap: 6px; cursor: pointer; margin: 0; white-space: nowrap;">
                        <input type="checkbox" id="chkAutoSyncToggle" onchange="window.BankSyncView.toggleAutoSync(this.checked)" style="margin: 0; cursor: pointer; accent-color: var(--accent); width: 15px; height: 15px;">
                        <span>⏰ <span>Relevé auto</span></span>
                    </label>
                    <select id="selAutoSyncInterval" class="input-styled" style="height: 24px; font-size: 11px; padding: 0 6px; border: 1px solid var(--border-color); border-radius: 6px; background: transparent; color: var(--text-muted); font-weight: 600; cursor: pointer;" onchange="window.BankSyncView.changeAutoSyncInterval(this.value)">
                        <option value="12" ${interval === 12 ? 'selected' : ''}>12h</option>
                        <option value="24" ${interval === 24 ? 'selected' : ''}>24h</option>
                        <option value="48" ${interval === 48 ? 'selected' : ''}>48h</option>
                    </select>
                `;
            }
        }
    },

    async unlockVaultManually() {
        const pw = await this.promptMasterPassword(
            'Déverrouillage du coffre',
            'Entrez votre mot de passe maître pour déverrouiller le coffre en mémoire :'
        );
        if (!pw) return;
        this.showToast('Coffre déverrouillé avec succès !', 'success');
        await this.loadVaultStatus();
        await this.loadPendingSync();
    },

    async lockVault() {
        const token = this.getVaultToken();
        try {
            await API.post(`/api/bank-sync/vault/lock${token ? `?token=${encodeURIComponent(token)}` : ''}`);
        } catch (_) {}
        this.clearVaultToken();
        this.stopVaultCountdown();
        this.vaultStatus = { is_unlocked: false, remaining_days: 0, remaining_seconds: 0 };
        this.renderVaultStatusBar();
        this.showToast('Coffre-fort verrouillé (mémoire purgée).', 'info');
    },

    async resetVault() {
        const count = this.connections ? this.connections.length : 0;
        let confirmText = '';
        if (count > 0) {
            confirmText = window.i18n.tp('bank_sync_reset_vault_confirm_conns', { count });
        } else {
            confirmText = window.i18n.t('bank_sync_reset_vault_confirm_empty');
        }

        const confirmed = await this.confirmAction(
            window.i18n.t('bank_sync_reset_vault_title'),
            confirmText
        );
        if (!confirmed) return;

        try {
            await API.post('/api/bank-sync/vault/reset');
            this.clearVaultToken();
            this.clearAllCachedData();
            this.vaultStatus = { is_unlocked: false, remaining_days: 0, remaining_seconds: 0 };
            await this.loadVaultStatus();
            await this.loadConnections();
            this.showToast(window.i18n.t('bank_sync_reset_vault_success'), 'success');
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    clearAllCachedData() {
        try {
            Object.keys(localStorage).forEach(k => {
                if (k.startsWith('omnibank_remote_accounts_')) {
                    localStorage.removeItem(k);
                }
            });
            Object.keys(sessionStorage).forEach(k => {
                if (k.startsWith('omnibank_sync_preview_')) {
                    sessionStorage.removeItem(k);
                }
            });
        } catch (_) {}
    },

    async loadAutoSyncSettings() {
        try {
            const data = await API.get('/api/bank-sync/settings/auto-sync');
            this.autoSyncSettings = data || { enabled: false, interval_hours: 24 };
            this.renderVaultStatusBar();
        } catch (e) {
            console.warn('[BankSync] Erreur settings auto-sync:', e);
        }
    },

    async toggleAutoSync(enabled) {
        this.autoSyncSettings.enabled = enabled;
        this.renderVaultStatusBar();
        try {
            await API.post('/api/bank-sync/settings/auto-sync', {
                enabled: enabled,
                interval_hours: this.autoSyncSettings.interval_hours
            });
            if (enabled && !this.vaultStatus?.is_unlocked) {
                this.showToast('Relevé auto activé. Note : le coffre doit être déverrouillé pour fonctionner.', 'warning');
            } else {
                this.showToast(enabled ? 'Relevé automatique activé !' : 'Relevé automatique désactivé.', 'info');
            }
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    async changeAutoSyncInterval(interval) {
        this.autoSyncSettings.interval_hours = parseInt(interval) || 24;
        this.renderVaultStatusBar();
        try {
            await API.post('/api/bank-sync/settings/auto-sync', {
                enabled: this.autoSyncSettings.enabled,
                interval_hours: this.autoSyncSettings.interval_hours
            });
            this.showToast(`Fréquence ajustée : ${interval} heures.`, 'info');
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── DÉCLENCHEMENT MANUEL DU RELEVÉ EN ARRIÈRE-PLAN ──────────────
    async triggerBackgroundSyncNow() {
        this.ensureModalsExist();

        const setButtonsState = (state, customHtml) => {
            const syncButtons = document.querySelectorAll('.overview-bank-sync-btn, #btnTriggerAutoSync');
            syncButtons.forEach(btn => {
                btn.classList.remove('is-syncing', 'is-success', 'is-error');
                if (state === 'syncing') {
                    btn.classList.add('is-syncing');
                    btn.disabled = true;
                    btn.innerHTML = `<span>⚡</span> <span>${window.i18n ? window.i18n.t('bank_sync_progress_loading') || 'Relevé en cours...' : 'Relevé en cours...'}</span>`;
                } else if (state === 'success') {
                    btn.classList.add('is-success');
                    btn.disabled = false;
                    btn.innerHTML = `<span>✅</span> <span>${customHtml || (window.i18n ? window.i18n.t('bank_sync_progress_done') || 'Relevé terminé !' : 'Relevé terminé !')}</span>`;
                } else if (state === 'error') {
                    btn.classList.add('is-error');
                    btn.disabled = false;
                    btn.innerHTML = `<span>⚠️</span> <span>${customHtml || (window.i18n ? window.i18n.t('bank_sync_progress_error') || 'Erreur relevé' : 'Erreur relevé')}</span>`;
                } else {
                    btn.disabled = false;
                    btn.innerHTML = `<span>⚡</span> <span data-i18n="bank_sync_run_background_btn">${window.i18n ? window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne' : 'Relever en ligne'}</span>`;
                }
            });
        };

        if (!this.vaultStatus || this.vaultStatus.remaining_seconds === undefined) {
            await this.loadVaultStatus();
        }

        let token = this.getVaultToken();
        let pw = null;

        // Si le coffre n'est pas déverrouillé, demander le mot de passe maître
        if (!token || !this.vaultStatus?.is_unlocked) {
            pw = await this.promptMasterPassword(
                window.i18n ? window.i18n.t('bank_sync_run_background_btn') || 'Relever en ligne' : 'Relever en ligne',
                window.i18n ? window.i18n.t('bank_sync_vault_prompt_msg') || 'Entrez votre mot de passe maître pour autoriser le relevé en tâche de fond :' : 'Entrez votre mot de passe maître pour autoriser le relevé en tâche de fond :'
            );

            if (!pw) {
                setButtonsState('idle');
                return;
            }
            token = this.getVaultToken();
        }

        // Lancer l'animation de progression sur le fond du bouton
        setButtonsState('syncing');

        const payload = {};
        if (token) payload.vault_token = token;
        if (pw && pw !== "__USE_VAULT_TOKEN__") payload.master_password = pw;

        try {
            const res = await API.post('/api/bank-sync/trigger-auto-sync', payload);
            this.showToast(window.i18n ? window.i18n.t('bank_sync_run_background_toast') || 'Relevé lancé en arrière-plan.' : 'Relevé lancé en arrière-plan.', 'success');

            if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                window.app.setFastNotificationsPolling(true);
            }

            // Suivi intelligent et non intrusif du relevé en arrière-plan
            let pollCount = 0;
            const checkSyncStatus = async () => {
                pollCount++;
                try {
                    const statusRes = await API.get('/api/bank-sync/status');
                    const isStillRunning = statusRes && statusRes.running_tasks && statusRes.running_tasks.length > 0;
                    
                    if (!isStillRunning || pollCount >= 12) {
                        // Fin du relevé : mise à jour unique et propre
                        setButtonsState('success');
                        setTimeout(() => setButtonsState('idle'), 3000);
                        if (window.app && typeof window.app.setFastNotificationsPolling === 'function') {
                            window.app.setFastNotificationsPolling(false);
                        }
                        await this.refreshActiveViews();
                        if (this.connections && this.connections.length > 0) this.loadConnections();
                        if (window.app && typeof window.app.loadNotifications === 'function') {
                            window.app.loadNotifications();
                        }
                        return;
                    }
                } catch(e) {
                    console.warn('[BankSync] Erreur polling statut sync:', e);
                }

                // Vérifier à nouveau dans 2.5 secondes si le relevé est toujours en cours
                setTimeout(checkSyncStatus, 2500);
            };

            setTimeout(checkSyncStatus, 3000);
        } catch (err) {
            console.error('[BankSync] Erreur trigger-auto-sync:', err);
            if (err.status === 401 || (err.detail && err.detail.includes('verrouill'))) {
                this.clearVaultToken();
                this.vaultStatus = { is_unlocked: false, remaining_days: 0 };
                this.renderVaultStatusBar();
                setButtonsState('idle');
                this.showToast(err.detail || 'Session expirée. Veuillez ressaisir votre mot de passe maître.', 'info');
                const retryPw = await this.promptMasterPassword(
                    'Relevé en arrière-plan',
                    'Veuillez déverrouiller le coffre avec votre mot de passe maître :'
                );
                if (retryPw) {
                    return this.triggerBackgroundSyncNow();
                }
                return;
            }
            setButtonsState('error', err.detail || err.message);
            setTimeout(() => setButtonsState('idle'), 3500);
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── GESTION DES OPÉRATIONS EN ATTENTE (PENDING / SAS) ────────────
    async loadPendingSync() {
        try {
            const data = await API.get('/api/bank-sync/pending');
            this.pendingMatches = data?.matches_by_tx_id || {};

            // Extraire toutes les opérations fantômes (non encore rapprochées)
            this.ghostTransactions = [];
            if (data && data.accounts) {
                data.accounts.forEach(acc => {
                    const connId = acc.connection_id || 0;
                    const connLabel = acc.connection_label || '';
                    const accId = acc.account_id;
                    const accName = acc.account_name || acc.name || `Compte #${accId}`;
                    (acc.transactions || []).forEach(tx => {
                        if (!tx.is_reconciled) {
                            this.ghostTransactions.push({
                                ...tx,
                                account_id: tx.account_id || accId,
                                account_name: accName,
                                connection_id: connId,
                                connection_label: connLabel
                            });
                        }
                    });
                });
            }

            // Auto-catégorisation IA en tâche de fond si activée
            if (this.isAIEnabled() && !this._ghostCategorized && this.ghostTransactions.some(g => !g.category)) {
                this.autoCategorizeGhosts();
            }

            this.renderPendingSyncBox(data);
            return data;
        } catch (e) {
            console.warn('[BankSync] Erreur chargement pending sync:', e);
            return null;
        }
    },

    async autoCategorizeGhosts() {
        const toCat = this.ghostTransactions.filter(g => !g.category && g.description);
        if (!toCat.length) return;
        this._ghostCategorized = true;
        try {
            // 1. Résolution Smart Label locale instantanée (Niveaux 1 et 2)
            const rawLabels = Array.from(new Set(toCat.map(g => g.raw_description || g.description)));
            let remainingForAI = [];
            try {
                const smartRes = await API.post('/api/smart-labels/resolve-batch', { labels: rawLabels });
                if (smartRes && smartRes.results) {
                    this.ghostTransactions.forEach(g => {
                        const raw = g.raw_description || g.description;
                        if (smartRes.results[raw]) {
                            const r = smartRes.results[raw];
                            if (r.source === 'rule' || r.source === 'history') {
                                g.description = r.description;
                                g.smart_suggested = true;
                                g.smart_source = r.source;
                                if (!g.category && r.category) {
                                    g.category = r.category;
                                }
                            }
                        }
                    });
                }
            } catch (errSmart) {
                console.warn('[BankSync] Erreur Smart Label batch:', errSmart);
            }

            // 2. Fallback IA pour les opérations restantes sans catégorie
            if (this.isAIEnabled()) {
                const stillUncat = this.ghostTransactions.filter(g => !g.category && g.description);
                if (stillUncat.length > 0) {
                    const descriptions = Array.from(new Set(stillUncat.map(g => g.description)));
                    const res = await API.post('/api/ai/categorize_batch', { descriptions });
                    if (res && res.categories) {
                        this.ghostTransactions.forEach(g => {
                            if (!g.category && res.categories[g.description]) {
                                g.category = res.categories[g.description];
                            }
                        });
                    }
                }
            }

            // Re-render ghost box in current view
            const box = document.getElementById('ghostRowsBox');
            if (box && box.parentElement) {
                this.renderGhostBox(box.parentElement);
            }
        } catch(e) {
            console.warn('[BankSync] Erreur auto-catégorisation des fantômes:', e);
        }
    },

    async refreshActiveViews() {
        await this.loadPendingSync();
        const curView = window.app?.currentView;
        if (curView === 'overview' && window.OverviewView && typeof window.OverviewView.init === 'function') {
            await window.OverviewView.init();
        } else if ((curView === 'dashboard' || curView === 'timeline') && window.TimelineView && typeof window.TimelineView.loadData === 'function') {
            await window.TimelineView.loadData();
        } else if (curView === 'all_operations' && window.AllOperationsView && typeof window.AllOperationsView.loadData === 'function') {
            await window.AllOperationsView.loadData();
        } else if (curView === 'accounts' && window.AccountsView && typeof window.AccountsView.loadData === 'function') {
            await window.AccountsView.loadData();
        }
        if (window.app && typeof window.app.refreshSidebar === 'function') {
            window.app.refreshSidebar();
        }
    },

    renderPendingSyncBox(data) {
        const box = document.getElementById('bankPendingSyncBox');
        if (!box) return;

        const totalMatches = data?.total_matches || 0;
        const totalNew = data?.total_new || 0;
        const hasConnections = this.connections && this.connections.length > 0;

        if (!hasConnections || (totalMatches === 0 && totalNew === 0)) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.style.display = 'block';
        box.innerHTML = `
        <div style="background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.25); border-radius: 12px; padding: 10px 16px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; align-items: center; gap: 10px;">
                <span style="font-size: 20px;">📥</span>
                <div>
                    <span style="font-size: 13px; font-weight: 700; color: var(--text-main); margin-right: 6px;">
                        ${window.i18n.t('bank_sync_pending_box_title') || 'Opérations en attente de synchronisation'} :
                    </span>
                    <span style="font-size: 12px; color: var(--text-muted);">
                        ${totalMatches > 0 ? `<strong style="color: #10b981;">${totalMatches}</strong> ${window.i18n ? window.i18n.t('bank_sync_ready_to_reconcile') || 'prête(s) à rapprocher' : 'prête(s) à rapprocher'}` : ''}
                        ${(totalMatches > 0 && totalNew > 0) ? ' • ' : ''}
                        ${totalNew > 0 ? `<strong>${totalNew}</strong> nouvelle(s)` : ''}
                    </span>
                </div>
            </div>

            <div style="display: flex; gap: 8px; align-items: center;">
                ${totalMatches > 0 ? `
                <button class="btn btn-primary" onclick="window.BankSyncView.reconcileAllPending()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 700; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                    <span>⚡</span> <span>${window.i18n.t('bank_btn_reconcile_all') || 'Rapprocher en banque'} (${totalMatches})</span>
                </button>
                ` : ''}
                ${totalNew > 0 ? `
                <button class="btn btn-gold" onclick="window.BankSyncView.commitAllGhosts()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 700; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                    <span>📥</span> <span>${window.i18n.t('ghost_commit_all') || 'Valider les nouvelles opérations'} (${totalNew})</span>
                </button>
                ` : ''}
                ${data.accounts && data.accounts.length > 0 ? `
                <button class="btn btn-secondary" onclick="window.BankSyncView.openPendingReviewModal()" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 600; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                    <span>📋</span> <span>${window.i18n.t('bank_sync_pending_review_btn') || 'Ouvrir la revue'}</span>
                </button>
                ` : ''}
            </div>
        </div>
        `;
    },

    renderGhostBox(container, accountFilter = null) {
        let box = document.getElementById('ghostRowsBox');
        if (!box) {
            box = document.createElement('div');
            box.id = 'ghostRowsBox';
            if (container) {
                container.insertBefore(box, container.firstChild);
            }
        }

        let ghosts = this.ghostTransactions || [];
        if (accountFilter) {
            ghosts = ghosts.filter(g => String(g.account_id) === String(accountFilter));
        }

        if (ghosts.length === 0) {
            box.style.display = 'none';
            box.innerHTML = '';
            return;
        }

        box.style.display = 'block';
        const totalCount = ghosts.length;

        const rowsHtml = ghosts.map(g => {
            const rawAmt = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
            const absAmt = Math.abs(parseFloat(g.amount) || rawAmt || 0);
            const isPositive = rawAmt >= 0;
            const amtFormatted = (isPositive ? '+ ' : '- ') + absAmt.toFixed(2) + ' €';
            const amtColor = isPositive ? 'var(--accent-success, #10b981)' : 'var(--text-main, #f87171)';
            const dateStr = g.date_operation ? String(g.date_operation).substring(0, 10) : '';
            const isSuggested = g.smart_suggested;
            const suggestedTip = (window.i18n ? window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique' : 'Suggéré d’après votre historique').replace(/"/g, '&quot;');

            const showRaw = g.raw_description && g.raw_description !== g.description;
            const rawSubHtml = showRaw ? `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 2px; font-weight: normal; opacity: 0.85;">🏦 ${window.escapeHtml ? window.escapeHtml(g.raw_description) : g.raw_description}</div>` : '';

            return `
            <tr id="ghostRow_${g.csv_id}" class="ghost-row" style="background: rgba(245, 158, 11, 0.04); border-left: 3px dashed #f59e0b; transition: background 0.15s ease;">
                <td style="padding: 8px 12px; font-size: 11px; white-space: nowrap;">
                    <span class="badge ghost-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px;">👻 ${window.i18n ? window.i18n.t('ghost_badge') || 'En ligne' : 'En ligne'}</span>
                </td>
                <td style="padding: 8px 12px; font-size: 12px; white-space: nowrap; color: var(--text-muted);">${dateStr}</td>
                <td style="padding: 8px 12px; font-size: 12px; font-weight: 600; color: var(--text-main);">
                    <div style="display: inline-flex; align-items: center; gap: 4px;">
                        <span>${window.escapeHtml ? window.escapeHtml(g.description) : g.description}</span>
                        ${isSuggested ? `<span title="${suggestedTip}" style="cursor:help; font-size: 11px;">💡</span>` : ''}
                    </div>
                    ${rawSubHtml}
                </td>
                <td style="padding: 8px 12px; font-size: 11px; color: var(--text-muted);">${g.account_name ? (window.escapeHtml ? window.escapeHtml(g.account_name) : g.account_name) : ''}</td>
                <td style="padding: 8px 12px; font-size: 11px;">
                    ${g.category ? `<span style="background: rgba(99, 102, 241, 0.12); color: var(--accent, #6366f1); padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏷️ ${window.escapeHtml ? window.escapeHtml(g.category) : g.category}</span>` : `<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Sans catégorie</span>`}
                </td>
                <td style="padding: 8px 12px; font-size: 12px; font-weight: 700; text-align: right; color: ${amtColor}; white-space: nowrap;">${amtFormatted}</td>
                <td style="padding: 8px 12px; text-align: right; white-space: nowrap;">
                    <div style="display: inline-flex; gap: 4px; align-items: center;">
                        <button class="btn btn-primary" onclick="window.BankSyncView.validateGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}" style="font-size: 11px; padding: 3px 8px; border-radius: 4px; height: 24px; font-weight: 700;">
                            ✔ ${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}
                        </button>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.editGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_edit_single') || 'Modifier' : 'Modifier'}" style="font-size: 11px; padding: 3px 8px; border-radius: 4px; height: 24px;">
                            ✏️
                        </button>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.dismissGhostRow('${g.csv_id}')" title="${window.i18n ? window.i18n.t('ghost_dismiss_single') || 'Ignorer' : 'Ignorer'}" style="font-size: 11px; padding: 3px 6px; border-radius: 4px; height: 24px; color: var(--text-muted);">
                            ✕
                        </button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        const cardsHtml = ghosts.map(g => {
            const rawAmt = typeof g.raw_amount !== 'undefined' ? parseFloat(g.raw_amount) : (parseFloat(g.amount) || 0);
            const absAmt = Math.abs(parseFloat(g.amount) || rawAmt || 0);
            const isPositive = rawAmt >= 0;
            const amtFormatted = (isPositive ? '+ ' : '- ') + absAmt.toFixed(2) + ' €';
            const amtColor = isPositive ? 'var(--accent-success, #10b981)' : 'var(--text-main, #f87171)';
            const dateStr = g.date_operation ? String(g.date_operation).substring(0, 10) : '';
            const isSuggested = g.smart_suggested;
            const suggestedTip = (window.i18n ? window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique' : 'Suggéré d’après votre historique').replace(/"/g, '&quot;');
            const showRaw = g.raw_description && g.raw_description !== g.description;
            const rawSubHtml = showRaw ? `<div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 2px; font-weight: normal; opacity: 0.85;">🏦 ${window.escapeHtml ? window.escapeHtml(g.raw_description) : g.raw_description}</div>` : '';

            return `
            <div id="ghostCard_${g.csv_id}" class="ghost-mobile-card" style="background: var(--bg-surface); border: 1px solid var(--border-color); border-left: 3px dashed #f59e0b; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; box-shadow: var(--shadow-sm);">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <span class="badge ghost-badge" style="background: rgba(245, 158, 11, 0.15); color: #f59e0b; font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 10px;">👻 ${window.i18n ? window.i18n.t('ghost_badge') || 'En ligne' : 'En ligne'}</span>
                        <span style="font-size: 11px; color: var(--text-muted);">${dateStr}</span>
                    </div>
                    <span style="font-size: 13px; font-weight: 800; color: ${amtColor};">${amtFormatted}</span>
                </div>
                <div style="font-size: 13px; font-weight: 600; color: var(--text-main); line-height: 1.3;">
                    <div style="display: flex; align-items: center; gap: 4px;">
                        <span>${window.escapeHtml ? window.escapeHtml(g.description) : g.description}</span>
                        ${isSuggested ? `<span title="${suggestedTip}" style="cursor:help; font-size: 11px;">💡</span>` : ''}
                    </div>
                    ${rawSubHtml}
                </div>
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 11px;">
                    ${g.account_name ? `<span style="background: var(--bg-base); border: 1px solid var(--border-color); color: var(--text-muted); padding: 1px 6px; border-radius: 4px; font-size: 11px;">💳 ${window.escapeHtml ? window.escapeHtml(g.account_name) : g.account_name}</span>` : ''}
                    ${g.category ? `<span style="background: rgba(99, 102, 241, 0.12); color: var(--accent, #6366f1); padding: 1px 6px; border-radius: 4px; font-size: 11px; font-weight: 600;">🏷️ ${window.escapeHtml ? window.escapeHtml(g.category) : g.category}</span>` : `<span style="color: var(--text-muted); font-size: 11px; font-style: italic;">Sans catégorie</span>`}
                </div>
                <div style="display: flex; gap: 6px; align-items: center; margin-top: 4px; padding-top: 6px; border-top: 1px dashed var(--border-color);">
                    <button class="btn btn-primary" onclick="window.BankSyncView.validateGhostRow('${g.csv_id}')" style="flex: 1; font-size: 12px; padding: 6px 10px; border-radius: 6px; font-weight: 700; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                        ✔ ${window.i18n ? window.i18n.t('ghost_validate_single') || 'Valider' : 'Valider'}
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.editGhostRow('${g.csv_id}')" style="font-size: 12px; padding: 6px 12px; border-radius: 6px; height: 32px; display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                        ✏️ ${window.i18n ? window.i18n.t('ghost_edit_single') || 'Modifier' : 'Modifier'}
                    </button>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.dismissGhostRow('${g.csv_id}')" style="font-size: 12px; padding: 6px 10px; border-radius: 6px; height: 32px; color: var(--text-muted); display: inline-flex; align-items: center; justify-content: center;" title="${window.i18n ? window.i18n.t('ghost_dismiss_single') || 'Ignorer' : 'Ignorer'}">
                        ✕
                    </button>
                </div>
            </div>
            `;
        }).join('');

        box.innerHTML = `
        <div class="ghost-rows-container" style="background: rgba(245, 158, 11, 0.06); border: 1px dashed rgba(245, 158, 11, 0.35); border-radius: 12px; padding: 12px 14px; margin-bottom: 14px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 18px;">👻</span>
                    <span style="font-size: 13px; font-weight: 700; color: var(--text-main);">
                        ${window.i18n ? window.i18n.t('ghost_box_title') || 'Opérations en ligne non enregistrées' : 'Opérations en ligne non enregistrées'}
                    </span>
                    <span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #f59e0b; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 10px;">
                        ${totalCount}
                    </span>
                </div>
                <div class="ghost-box-header-btn-wrap" style="display: flex;">
                    <button class="btn btn-gold ghost-box-header-btn" onclick="window.BankSyncView.commitAllGhosts()" style="font-size: 12px; padding: 5px 14px; border-radius: 6px; font-weight: 700; height: 30px; display: inline-flex; align-items: center; gap: 6px;">
                        <span>📥</span> <span>${window.i18n ? window.i18n.t('ghost_commit_all') || 'Valider les nouvelles opérations' : 'Valider les nouvelles opérations'} (${totalCount})</span>
                    </button>
                </div>
            </div>
            <!-- Vue Tableau Desktop -->
            <div class="ghost-desktop-table-wrapper">
                <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                    <thead>
                        <tr style="border-bottom: 1px solid rgba(245, 158, 11, 0.2); text-align: left; color: var(--text-muted); font-size: 11px;">
                            <th style="padding: 4px 12px; width: 60px;">Statut</th>
                            <th style="padding: 4px 12px; width: 90px;">Date</th>
                            <th style="padding: 4px 12px;">Description</th>
                            <th style="padding: 4px 12px; width: 140px;">Compte</th>
                            <th style="padding: 4px 12px; width: 140px;">Catégorie</th>
                            <th style="padding: 4px 12px; width: 100px; text-align: right;">Montant</th>
                            <th style="padding: 4px 12px; width: 130px; text-align: right;">Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
            <!-- Vue Cartes Mobile -->
            <div class="ghost-mobile-cards-wrapper">
                ${cardsHtml}
            </div>
        </div>
        `;
    },


    async validateGhostRow(csvId) {
        const ghost = this.ghostTransactions.find(g => g.csv_id === csvId);
        if (!ghost) return;

        const rowEls = [
            document.getElementById(`ovGhostRow_${csvId}`),
            document.getElementById(`ghostRow_${csvId}`),
            document.getElementById(`ghostCard_${csvId}`)
        ].filter(Boolean);

        rowEls.forEach(el => {
            el.style.transition = 'opacity 0.2s, transform 0.2s';
            el.style.opacity = '0.15';
            el.style.transform = 'translateX(-10px)';
            el.style.pointerEvents = 'none';
        });

        try {
            await API.post('/api/bank-sync/commit-ghost', {
                connection_id: ghost.connection_id || 0,
                transaction: ghost
            });
            this.ghostTransactions = this.ghostTransactions.filter(g => g.csv_id !== csvId);
            this.showToast(window.i18n ? window.i18n.t('ghost_validated') || 'Opération validée' : 'Opération validée', 'success');
            await this.refreshActiveViews();
        } catch (err) {
            rowEls.forEach(el => {
                el.style.opacity = '1';
                el.style.transform = '';
                el.style.pointerEvents = '';
            });
            this.showToast('Erreur validation : ' + (err.detail || err.message), 'error');
        }
    },

    async dismissGhostRow(csvId) {
        const rowEls = [
            document.getElementById(`ovGhostRow_${csvId}`),
            document.getElementById(`ghostRow_${csvId}`),
            document.getElementById(`ghostCard_${csvId}`)
        ].filter(Boolean);

        rowEls.forEach(el => {
            el.style.transition = 'opacity 0.2s, transform 0.2s';
            el.style.opacity = '0.15';
            el.style.transform = 'translateX(-10px)';
            el.style.pointerEvents = 'none';
        });

        try {
            await API.post(`/api/bank-sync/dismiss-ghost/${encodeURIComponent(csvId)}`);
            this.ghostTransactions = this.ghostTransactions.filter(g => g.csv_id !== csvId);
            this.showToast(window.i18n ? window.i18n.t('ghost_dismissed') || 'Opération ignorée' : 'Opération ignorée', 'info');
            await this.refreshActiveViews();
        } catch (err) {
            rowEls.forEach(el => {
                el.style.opacity = '1';
                el.style.transform = '';
                el.style.pointerEvents = '';
            });
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    editGhostRow(csvId) {
        const ghost = this.ghostTransactions.find(g => g.csv_id === csvId);
        if (!ghost) return;
        if (window.FormView && typeof window.FormView.openGhost === 'function') {
            window.FormView.openGhost(ghost);
        }
    },

    async commitAllGhosts() {
        const count = this.ghostTransactions.length;
        if (count === 0) {
            this.showToast('Aucune nouvelle opération à valider.', 'info');
            return;
        }
        const confirmMsg = (window.i18n ? window.i18n.t('ghost_commit_all_confirm') || 'Valider {count} nouvelle(s) opération(s) d\'un seul coup ?' : 'Valider {count} nouvelle(s) opération(s) d\'un seul coup ?').replace('{count}', count);
        if (typeof showInlineConfirm === 'function') {
            const ok = await showInlineConfirm(window.i18n ? window.i18n.t('title_confirmation') || 'Confirmation' : 'Confirmation', confirmMsg);
            if (!ok) return;
        }
        try {
            const res = await API.post('/api/bank-sync/commit-all-ghosts');
            const committed = res?.committed_count || count;
            const toastMsg = (window.i18n ? window.i18n.t('ghost_committed_success') || '{count} opération(s) validée(s) avec succès' : '{count} opération(s) validée(s) avec succès').replace('{count}', committed);
            this.showToast(toastMsg, 'success');
            this.ghostTransactions = [];
            await this.refreshActiveViews();
        } catch (err) {
            this.showToast('Erreur validation en lot : ' + (err.detail || err.message), 'error');
        }
    },

    async openPendingReviewModal() {
        try {
            this.ensureModalsExist();
            const data = await API.get('/api/bank-sync/pending');
            if (data && data.accounts && data.accounts.length > 0) {
                const firstConnId = data.accounts[0]?.connection_id || (this.connections?.[0]?.id || 1);
                await this.openReviewModal(firstConnId, {
                    connection_id: firstConnId,
                    accounts: data.accounts
                });
            } else {
                this.showToast('Aucune opération en attente.', 'info');
            }
        } catch (e) {
            console.error('[BankSync] Erreur ouverture des opérations en attente:', e);
            this.showToast('Erreur ouverture des opérations en attente : ' + (e.message || e), 'error');
        }
    },

    // ── RAPPROCHEMENT EN 1 CLIC (Depuis Dashboard ou Historique) ─────
    async reconcileFast(txId) {
        try {
            const ovRow = document.getElementById(`ovRow_${txId}`);
            if (ovRow) {
                ovRow.style.transition = 'opacity 0.2s, transform 0.2s';
                ovRow.style.opacity = '0.15';
                ovRow.style.transform = 'translateX(-10px)';
                ovRow.style.pointerEvents = 'none';
            }

            const res = await API.post(`/api/bank-sync/reconcile-fast/${txId}`);
            this.showToast(window.i18n ? window.i18n.t('bank_sync_reconciled_success') || 'Opération pointée avec succès !' : 'Opération pointée avec succès !', 'success');

            // Retirer de pendingMatches localement
            if (this.pendingMatches && this.pendingMatches[txId]) {
                delete this.pendingMatches[txId];
            }

            await this.refreshActiveViews();
        } catch (err) {
            const ovRow = document.getElementById(`ovRow_${txId}`);
            if (ovRow) {
                ovRow.style.opacity = '1';
                ovRow.style.transform = '';
                ovRow.style.pointerEvents = '';
            }
            this.showToast('Erreur pointage : ' + (err.detail || err.message), 'error');
        }
    },

    async reconcileAllPending() {
        try {
            const res = await API.post('/api/bank-sync/reconcile-all-pending');
            const count = res?.reconciled_count || 0;
            this.showToast(`${count} opération(s) pointée(s) avec succès !`, 'success');
            this.pendingMatches = {};

            await this.refreshActiveViews();
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },


    // ── PROMPT MASTER PASSWORD (Custom in-app modal) ────────────────
    promptMasterPassword(title = 'Déverrouillage sécurisé', message = 'Entrez votre mot de passe maître :') {
        this.ensureModalsExist();
        const token = this.getVaultToken();
        if (token && this.vaultStatus?.is_unlocked) {
            return Promise.resolve("__USE_VAULT_TOKEN__");
        }

        return new Promise((resolve) => {
            this._pwResolve = resolve;
            const modal = document.getElementById('masterPasswordModal');
            const titleEl = document.getElementById('masterPwModalTitle');
            const msgEl = document.getElementById('masterPwModalMsg');
            const input = document.getElementById('masterPwModalInput');
            const errEl = document.getElementById('masterPwModalError');

            if (titleEl) titleEl.innerText = title;
            if (msgEl) msgEl.innerText = message;
            if (input) input.value = '';
            if (errEl) errEl.style.display = 'none';

            if (modal) {
                modal.style.display = 'flex';
                setTimeout(() => input && input.focus(), 50);
            } else {
                resolve(null);
            }
        });
    },

    async _submitMasterPw() {
        const input = document.getElementById('masterPwModalInput');
        const val = input.value;
        const errEl = document.getElementById('masterPwModalError');
        if (!val) {
            errEl.innerText = 'Veuillez saisir votre mot de passe maître.';
            errEl.style.display = 'block';
            return;
        }

        const rememberCheck = document.getElementById('masterPwRememberCheck');
        const rememberDaysSel = document.getElementById('masterPwRememberDays');
        const shouldRemember = rememberCheck ? rememberCheck.checked : true;
        const days = shouldRemember ? (rememberDaysSel ? parseInt(rememberDaysSel.value) : 7) : 1;

        try {
            const res = await API.post('/api/bank-sync/vault/unlock', {
                master_password: val,
                remember_days: days
            });
            if (res.vault_token) {
                if (shouldRemember) {
                    this.setVaultToken(res.vault_token);
                }
                this.vaultStatus = res;
                this.renderVaultStatusBar();
            }
        } catch (unlockErr) {
            console.warn('[BankSync] Erreur validation mot de passe maître:', unlockErr);
            errEl.innerText = unlockErr.detail || unlockErr.message || 'Mot de passe maître incorrect.';
            errEl.style.display = 'block';
            return;
        }

        document.getElementById('masterPasswordModal').style.display = 'none';
        if (this._pwResolve) {
            this._pwResolve(val);
            this._pwResolve = null;
        }
    },

    _cancelMasterPw() {
        document.getElementById('masterPasswordModal').style.display = 'none';
        if (this._pwResolve) {
            this._pwResolve(null);
            this._pwResolve = null;
        }
    },

    // ── CONFIRM ACTION (Custom in-app modal) ────────────────────────
    confirmAction(title = 'Confirmer', message = 'Êtes-vous sûr ?') {
        return new Promise((resolve) => {
            this._confirmResolve = resolve;
            const modal = document.getElementById('confirmDeleteModal');
            document.getElementById('confirmDeleteTitle').innerText = title;
            document.getElementById('confirmDeleteMsg').innerText = message;
            modal.style.display = 'flex';
        });
    },

    _submitConfirm() {
        document.getElementById('confirmDeleteModal').style.display = 'none';
        if (this._confirmResolve) {
            this._confirmResolve(true);
            this._confirmResolve = null;
        }
    },

    _cancelConfirm() {
        document.getElementById('confirmDeleteModal').style.display = 'none';
        if (this._confirmResolve) {
            this._confirmResolve(false);
            this._confirmResolve = null;
        }
    },

    async loadConnections() {
        try {
            const conns = await API.get('/api/bank-sync/connections');
            this.connections = conns || [];
            const headerBtn = document.getElementById('btnHeaderBgSync');
            if (headerBtn) {
                headerBtn.style.display = this.connections.length > 0 ? 'flex' : 'none';
            }
            this.renderVaultStatusBar();
            this.renderConnectionsList();
        } catch (err) {
            console.error('Erreur chargement connexions:', err);
        }
    },

    async loadBackends() {
        try {
            const data = await API.get('/api/bank-sync/backends');
            this.backends = data || [];
        } catch (err) {
            console.error('Erreur chargement backends:', err);
        }
    },

    async loadLocalAccounts() {
        try {
            const accs = await API.get('/api/accounts/');
            this.localAccounts = (accs || []).filter(a => !a.is_closed);
        } catch (err) {
            console.error('Erreur chargement comptes locaux:', err);
        }
    },

    renderConnectionsList() {
        const container = document.getElementById('bankConnectionsList');
        if (!container) return;

        if (this.connections.length === 0) {
            container.innerHTML = `
            <div style="text-align: center; padding: 24px 20px; background: var(--bg-base); border: 1px dashed var(--border-color); border-radius: 12px;">
                <div style="font-size: 32px; margin-bottom: 8px;">🏦</div>
                <h4 style="font-size: 14px; font-weight: 700; margin: 0 0 4px 0; color: var(--text-main);" data-i18n="bank_sync_empty_state">
                    ${window.i18n.t('bank_sync_empty_state')}
                </h4>
                <p style="font-size: 12px; color: var(--text-muted); max-width: 420px; margin: 0 auto 12px auto;" data-i18n="bank_sync_empty_desc">
                    ${window.i18n.t('bank_sync_empty_desc')}
                </p>
                <button class="btn btn-primary" onclick="window.BankSyncView.openAddModal()" style="font-weight: 600; padding: 6px 14px; font-size: 12px; border-radius: 8px;">
                    ➕ <span data-i18n="bank_sync_add_btn">${window.i18n.t('bank_sync_add_btn')}</span>
                </button>
            </div>
            `;
            return;
        }

        container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(480px, 1fr)); gap: 14px;">
            ${this.connections.map(conn => {
                const lastSyncText = conn.last_sync_at 
                    ? new Date(conn.last_sync_at).toLocaleString() 
                    : window.i18n.t('bank_sync_never');
                
                const isVaultUnlocked = Boolean(this.vaultStatus && this.vaultStatus.is_unlocked);
                const isStalePasswordError = isVaultUnlocked && conn.last_error && (conn.last_error.toLowerCase().includes('mot de passe') || conn.last_error.toLowerCase().includes('coffre'));
                const effectiveError = isStalePasswordError ? null : (conn.last_error && conn.last_error.trim() ? conn.last_error.trim() : null);
                const isError = !isStalePasswordError && (conn.last_sync_status === 'error' || conn.last_sync_status === 'auto_error' || Boolean(effectiveError));
                const statusBadge = isError 
                    ? `<span style="background: rgba(239,68,68,0.12); color: #ef4444; border: 1px solid rgba(239,68,68,0.25); font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0;"><span>🔴</span> <span>${window.i18n.t('bank_sync_status_error')}</span></span>`
                    : `<span style="background: rgba(16,185,129,0.12); color: #10b981; border: 1px solid rgba(16,185,129,0.25); font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 20px; display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; flex-shrink: 0;"><span>🟢</span> <span>${window.i18n.t('bank_sync_status_connected')}</span></span>`;

                const displayError = isError ? (effectiveError || window.i18n.t('bank_sync_status_error') || 'Erreur lors de la synchronisation.') : null;

                const cachedPreview = this.getCachedPreview(conn.id);
                const cachedBtn = cachedPreview ? `
                    <button class="btn btn-secondary" onclick="window.BankSyncView.openCachedPreviewDirectly(${conn.id})" style="padding: 0 10px; border-radius: 8px; font-size: 12px; height: 32px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;" title="${window.i18n.t('bank_sync_cached_preview_tooltip')}">
                        <span>📋</span> <span data-i18n="bank_sync_cached_preview_btn">${window.i18n.t('bank_sync_cached_preview_btn')}</span>
                    </button>
                ` : '';

                return `
                <div class="bank-connection-item" style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 14px; padding: 14px 20px; display: flex; justify-content: space-between; align-items: center; gap: 16px; box-shadow: var(--shadow-sm); transition: border-color 0.2s ease;">
                    <div style="display: flex; align-items: center; gap: 14px; min-width: 0;">
                        <div style="width: 44px; height: 44px; border-radius: 12px; background: rgba(99, 102, 241, 0.08); border: 1px solid rgba(99, 102, 241, 0.2); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0;">
                            🏦
                        </div>
                        <div style="min-width: 0;">
                            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px; flex-wrap: wrap;">
                                <h4 style="margin: 0; font-size: 15px; font-weight: 700; color: var(--text-main); white-space: nowrap;">${conn.label}</h4>
                                ${statusBadge}
                            </div>
                            <div style="font-size: 12px; color: var(--text-muted); display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                                <span style="background: rgba(255,255,255,0.06); padding: 1px 6px; border-radius: 4px; font-family: monospace; font-size: 11px; color: var(--text-main); font-weight: 600;">${conn.backend}</span>
                                <span>•</span>
                                <span>${lastSyncText}</span>
                                ${conn.last_sync_count ? `<span style="background: rgba(16,185,129,0.12); color: #10b981; font-weight: 700; padding: 1px 8px; border-radius: 6px; font-size: 11px;">+${conn.last_sync_count} op.</span>` : ''}
                            </div>
                            ${displayError ? `
                                <div style="font-size: 11px; color: #ef4444; margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                                    <span>⚠️ ${displayError}</span>
                                    <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.copyReportToClipboard('Erreur connexion bancaire: ${conn.backend || conn.id} - ${displayError.replace(/'/g, "\\'")}');" style="font-size: 10px; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Copier un rapport technique anonymisé">
                                        📋 Copier
                                    </button>
                                    <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.openGitHubIssue('Erreur connexion bancaire: ${conn.backend || conn.id}');" style="font-size: 10px; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Créer une issue GitHub">
                                        🐙 Issue
                                    </button>
                                    <button class="btn btn-secondary" onclick="if(window.app && window.app.navigateToDiagnostics) { window.app.navigateToDiagnostics(); } else if(window.app && window.app.loadView) { window.app.loadView('config'); }" style="font-size: 10px; padding: 1px 6px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px;" title="Accéder aux diagnostics">
                                        ⚙️ Diag
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <div style="display: flex; gap: 8px; align-items: center; flex-shrink: 0;">
                        ${cachedBtn}
                        <button class="btn btn-primary" onclick="window.BankSyncView.promptAndSync(${conn.id})" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 600; padding: 0 14px; border-radius: 8px; font-size: 12px; height: 32px; box-sizing: border-box;" title="Lancer la synchronisation">
                            <span>🔄</span> <span data-i18n="bank_sync_sync_btn">${window.i18n.t('bank_sync_sync_btn')}</span>
                        </button>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.openMappingModal(${conn.id})" style="padding: 0 12px; border-radius: 8px; font-size: 12px; height: 32px; display: inline-flex; align-items: center; gap: 5px; box-sizing: border-box; font-weight: 600;" title="${window.i18n.t('bank_sync_edit_mapping_btn')}">
                            <span>🔗</span> <span data-i18n="bank_sync_mapping_btn">${window.i18n.t('bank_sync_mapping_btn')}</span>
                        </button>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.deleteConnection(${conn.id})" style="padding: 0 10px; border-radius: 8px; color: #ef4444; height: 32px; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;" title="${window.i18n.t('bank_sync_delete_btn')}">
                            🗑️
                        </button>
                    </div>
                </div>
                `;
            }).join('')}
        </div>
        `;
    },

    openAddModal() {
        this.selectedBackend = null;
        document.getElementById('addBankModal').style.display = 'flex';
        document.getElementById('stepSelectBank').style.display = 'block';
        document.getElementById('stepCredentials').style.display = 'none';
        document.getElementById('btnSaveConnection').style.display = 'none';
        this.renderBackendsGrid(this.backends);
    },

    closeAddModal() {
        document.getElementById('addBankModal').style.display = 'none';
    },

    filterBackends(query) {
        const q = query.toLowerCase().trim();
        const filtered = this.backends.filter(b => 
            b.name.toLowerCase().includes(q) || b.description.toLowerCase().includes(q)
        );
        this.renderBackendsGrid(filtered);
    },

    renderBackendsGrid(backendsList) {
        const grid = document.getElementById('backendsGrid');
        if (!grid) return;

        if (backendsList.length === 0) {
            grid.innerHTML = `<div style="grid-column: 1/-1; text-align: center; padding: 20px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_banks_found')}</div>`;
            return;
        }

        grid.innerHTML = backendsList.map(b => `
            <div class="backend-card" onclick="window.BankSyncView.selectBackend('${b.name}')" 
                 style="padding: 10px 12px; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 10px; cursor: pointer; transition: all 0.2s ease; display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 16px;">🏦</span>
                <div style="font-size: 12px; font-weight: 600; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    ${b.description || b.name}
                </div>
            </div>
        `).join('');
    },

    selectBackend(backendName) {
        const backend = this.backends.find(b => b.name === backendName);
        if (!backend) return;

        this.selectedBackend = backend;
        document.getElementById('stepSelectBank').style.display = 'none';
        document.getElementById('stepCredentials').style.display = 'block';
        document.getElementById('btnSaveConnection').style.display = 'inline-block';

        document.getElementById('selectedBankBanner').innerHTML = `
            🏦 <strong>${backend.description || backend.name}</strong> (${backend.name})
        `;
        document.getElementById('connLabelInput').value = backend.description || backend.name;

        // Configuration dynamique du step 3 mot de passe maître
        const isUnlocked = this.vaultStatus?.is_unlocked;
        const hasConnections = this.connections && this.connections.length > 0;
        const masterPwContainer = document.getElementById('masterPwSection');
        
        if (masterPwContainer) {
            if (isUnlocked) {
                masterPwContainer.innerHTML = `
                    <div style="padding: 12px 14px; background: rgba(16,185,129,0.08); border: 1px solid rgba(16,185,129,0.25); border-radius: 10px; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 22px;">🔓</span>
                        <div style="font-size: 12px; color: var(--text-main); line-height: 1.4;">
                            <strong style="color: #10b981;">Coffre-fort déverrouillé</strong><br/>
                            <span style="color: var(--text-muted);">Vos identifiants seront automatiquement chiffrés avec votre mot de passe maître de coffre-fort.</span>
                        </div>
                    </div>
                    <input type="password" id="connMasterPwInput" style="display: none;" />
                `;
            } else if (hasConnections) {
                masterPwContainer.innerHTML = `
                    <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;">
                        🔐 3. Mot de passe maître du coffre-fort
                    </label>
                    <p style="font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;">
                        Entrez le mot de passe maître unique de votre coffre-fort local pour y rattacher cette banque.
                    </p>
                    <input type="password" id="connMasterPwInput" class="input-styled" placeholder="Mot de passe maître du coffre-fort" autocomplete="current-password" />
                `;
            } else {
                masterPwContainer.innerHTML = `
                    <label style="display: block; font-size: 13px; font-weight: 700; color: var(--text-main); margin-bottom: 4px;" data-i18n="bank_sync_master_pw_title">
                        🔐 3. Définir votre mot de passe maître (Chiffrement local)
                    </label>
                    <p style="font-size: 12px; color: var(--text-muted); margin: 0 0 8px 0; line-height: 1.4;" data-i18n="bank_sync_master_pw_desc">
                        Ce mot de passe servira de clé principale pour chiffrer l'ensemble de vos connexions bancaires (Fernet AES). Il ne quitte jamais votre appareil.
                    </p>
                    <input type="password" id="connMasterPwInput" class="input-styled" placeholder="Entrez un mot de passe maître sécurisé" autocomplete="new-password" />
                `;
            }
        }

        this.renderDynamicFields(backend.fields || []);
    },

    backToBankSelection() {
        document.getElementById('stepSelectBank').style.display = 'block';
        document.getElementById('stepCredentials').style.display = 'none';
        document.getElementById('btnSaveConnection').style.display = 'none';
    },

    renderDynamicFields(fields) {
        const container = document.getElementById('dynamicFormFields');
        if (!container) return;

        if (fields.length === 0) {
            container.innerHTML = `
                <div>
                    <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">${window.i18n.t('bank_sync_login_field')}</label>
                    <input type="text" id="cred_login" class="input-styled" required />
                </div>
                <div>
                    <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">${window.i18n.t('bank_sync_password_field')}</label>
                    <input type="password" id="cred_password" class="input-styled" required />
                </div>
            `;
            return;
        }

        container.innerHTML = fields.map(f => {
            const reqMark = f.required ? '*' : '';
            const descHtml = f.description ? `<p style="font-size: 11px; color: var(--text-muted); margin: 2px 0 6px 0;">${f.description}</p>` : '';
            let inputHtml = '';

            if (f.type === 'select' && f.choices) {
                const options = Object.entries(f.choices).map(([val, label]) => 
                    `<option value="${val}" ${f.default === val ? 'selected' : ''}>${label}</option>`
                ).join('');
                inputHtml = `<select id="cred_${f.id}" class="input-styled">${options}</select>`;
            } else if (f.type === 'checkbox') {
                inputHtml = `<input type="checkbox" id="cred_${f.id}" ${f.default === 'true' ? 'checked' : ''} />`;
            } else {
                const inputType = f.type === 'password' ? 'password' : 'text';
                inputHtml = `<input type="${inputType}" id="cred_${f.id}" class="input-styled" value="${f.default || ''}" ${f.required ? 'required' : ''} />`;
            }

            return `
            <div>
                <label style="display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; color: var(--text-main);">
                    ${f.label} ${reqMark}
                </label>
                ${descHtml}
                ${inputHtml}
            </div>
            `;
        }).join('');
    },

    async saveConnection() {
        if (!this.selectedBackend) return;

        const label = document.getElementById('connLabelInput').value.trim();
        const masterPw = document.getElementById('connMasterPwInput')?.value;
        const isUnlocked = this.vaultStatus?.is_unlocked;
        const token = this.getVaultToken();
        const errDiv = document.getElementById('addBankErrorMsg');
        errDiv.style.display = 'none';

        if (!label) {
            errDiv.innerText = 'Veuillez saisir un nom pour cette connexion.';
            errDiv.style.display = 'block';
            return;
        }
        if (!masterPw && !isUnlocked) {
            errDiv.innerText = 'Veuillez saisir le mot de passe maître pour chiffrer vos identifiants.';
            errDiv.style.display = 'block';
            return;
        }

        const credentials = {};
        const fields = this.selectedBackend.fields || [];
        if (fields.length === 0) {
            credentials.login = document.getElementById('cred_login')?.value?.trim();
            credentials.password = document.getElementById('cred_password')?.value;
        } else {
            fields.forEach(f => {
                const el = document.getElementById(`cred_${f.id}`);
                if (el) {
                    credentials[f.id] = f.type === 'checkbox' ? el.checked : el.value.trim();
                }
            });
        }

        const btn = document.getElementById('btnSaveConnection');
        btn.disabled = true;
        btn.innerText = 'Chiffrement & Sauvegarde...';

        try {
            const payload = {
                backend: this.selectedBackend.name,
                label: label,
                master_password: masterPw || null,
                vault_token: token || null,
                credentials: credentials
            };
            const newConn = await API.post('/api/bank-sync/connections', payload);
            
            // Stocker automatiquement le mot de passe maître en session si saisi
            if (masterPw) {
                try {
                    const unlockRes = await API.post('/api/bank-sync/vault/unlock', {
                        master_password: masterPw,
                        remember_days: 7
                    });
                    if (unlockRes.vault_token) {
                        this.setVaultToken(unlockRes.vault_token);
                        this.vaultStatus = unlockRes;
                        this.renderVaultStatusBar();
                    }
                } catch (_) {}
            }

            this.clearCachedRemoteAccounts(newConn);
            this.closeAddModal();
            await this.loadConnections();
            this.showToast('Connexion bancaire ajoutée et chiffrée avec succès !', 'success');

            // Ouvrir directement la modale de mapping avec rafraîchissement obligatoire
            setTimeout(() => this.openMappingModal(newConn.id, true), 400);

        } catch (err) {
            const rawMsg = err.detail || err.message || 'Erreur lors de la création de la connexion.';
            errDiv.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px;">
                    <span style="font-weight: 700; color: #ef4444;">⚠️ Erreur :</span>
                    <button class="btn btn-secondary" onclick="window.BankSyncView.closeAddModal(); if(window.app && window.app.navigateToDiagnostics) { window.app.navigateToDiagnostics(); } else if(window.app && window.app.loadView) { window.app.loadView('config'); }" style="font-size: 11px; padding: 2px 8px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px; color: var(--text-main); border: 1px solid var(--border-color); background: var(--bg-surface); cursor: pointer;">
                        ⚙️ Configuration & Diagnostics
                    </button>
                </div>
                <div style="margin-bottom: 8px; line-height: 1.4; color: var(--text-main); font-size: 12.5px;">${rawMsg}</div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center; padding-top: 6px; border-top: 1px dashed rgba(239,68,68,0.2);">
                    <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.copyReportToClipboard('Erreur création connexion: ${this.selectedBackend?.name || ''} - ${rawMsg.replace(/'/g, "\\'")}');" style="font-size: 11px; padding: 3px 8px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;">
                        📋 Copier le rapport
                    </button>
                    <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.openGitHubIssue('Erreur création connexion: ${this.selectedBackend?.name || ''}');" style="font-size: 11px; padding: 3px 8px; border-radius: 5px; display: inline-flex; align-items: center; gap: 4px;">
                        🐙 Créer une Issue GitHub
                    </button>
                </div>
            `;
            errDiv.style.display = 'block';
        } finally {
            btn.disabled = false;
            btn.innerText = window.i18n.t('bank_sync_save_btn');
        }
    },

    // ── MAPPING DES COMPTES ──────────────────────────────────────────
    async openMappingModal(connId, forceRefresh = false) {
        this.activeConnId = connId;
        const conn = this.connections.find(c => c.id === connId);
        if (!conn) return;

        const modal = document.getElementById('mappingModal');
        const container = document.getElementById('mappingRowsContainer');
        modal.style.display = 'flex';

        // 1. Vérifier si les comptes distants sont déjà en cache pour cette connexion exacte
        const cachedAccounts = forceRefresh ? null : this.getCachedRemoteAccounts(conn);
        if (cachedAccounts && cachedAccounts.length > 0 && !forceRefresh) {
            this.currentConnection = conn;
            this.currentRemoteAccounts = cachedAccounts;
            this.renderMappingRows(conn, cachedAccounts);
            return;
        }

        container.innerHTML = `
            <div style="text-align: center; padding: 30px 20px; color: var(--text-muted);">
                <div style="font-size: 28px; margin-bottom: 10px; animation: spin-reverse 1.5s linear infinite; display: inline-block;">🔄</div>
                <div id="mappingModalLoadingText" style="font-size: 13px; font-weight: 600; color: var(--text-main);">
                    Connexion sécurisée à votre banque...
                </div>
                <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 6px;">
                    Récupération de la liste de vos comptes distants
                </div>
            </div>
        `;

        // 2. Demander le mot de passe maître si le coffre n'est pas déverrouillé
        let pw = null;
        const token = this.getVaultToken();
        if (token && this.vaultStatus?.is_unlocked) {
            pw = "__USE_VAULT_TOKEN__";
        } else {
            pw = await this.promptMasterPassword(
                'Association des comptes',
                'Entrez votre mot de passe maître pour interroger votre banque :'
            );
        }

        if (!pw) {
            if (cachedAccounts && cachedAccounts.length > 0) {
                this.currentConnection = conn;
                this.currentRemoteAccounts = cachedAccounts;
                this.renderMappingRows(conn, cachedAccounts);
                return;
            }
            this.closeMappingModal();
            return;
        }

        // Fermer un éventuel flux précédent
        if (this.mappingEventSource) {
            this.mappingEventSource.close();
            this.mappingEventSource = null;
        }

        const queryParams = new URLSearchParams();
        if (pw !== "__USE_VAULT_TOKEN__") {
            queryParams.set("master_password", pw);
        } else if (token) {
            queryParams.set("vault_token", token);
        }

        const sseUrl = `/api/bank-sync/connections/${connId}/test-stream?${queryParams.toString()}`;
        const es = new EventSource(sseUrl);
        this.mappingEventSource = es;

        es.addEventListener('progress', (e) => {
            try {
                const d = JSON.parse(e.data);
                const txt = document.getElementById('mappingModalLoadingText');
                if (txt && d.message) txt.innerText = d.message;
            } catch (_) {}
        });

        es.addEventListener('2fa_required', (e) => {
            try {
                const d = JSON.parse(e.data);
                this.activeSessionId = d.session_id;
                this.show2FAModal(d.type, d.message);
            } catch (_) {}
        });

        es.addEventListener('accounts', (e) => {
            try {
                const d = JSON.parse(e.data);
                es.close();
                this.mappingEventSource = null;
                this.currentConnection = conn;
                this.currentRemoteAccounts = d.accounts || [];
                this.saveCachedRemoteAccounts(conn, this.currentRemoteAccounts);
                this.renderMappingRows(conn, this.currentRemoteAccounts);
            } catch (err) {
                console.error('Erreur traitement comptes SSE:', err);
            }
        });

        es.addEventListener('error', (e) => {
            let errorMsg = 'Erreur lors de la communication avec la banque.';
            try {
                if (e.data) {
                    const d = JSON.parse(e.data);
                    if (d.message) errorMsg = d.message;
                }
            } catch (_) {}
            es.close();
            this.mappingEventSource = null;

            if (cachedAccounts && cachedAccounts.length > 0) {
                this.currentConnection = conn;
                this.currentRemoteAccounts = cachedAccounts;
                this.renderMappingRows(conn, cachedAccounts);
                this.showToast('Actualisation échouée, affichage des comptes en cache : ' + errorMsg, 'info');
                return;
            }

            container.innerHTML = `
                <div style="padding: 16px 18px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.25); border-radius: 12px; font-size: 13px; margin: 10px 0;">
                    <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; flex-wrap: wrap;">
                        <div style="font-weight: 700; color: #ef4444; display: flex; align-items: center; gap: 6px;">
                            <span>⚠️</span> <span>${window.i18n.t('bank_sync_cannot_fetch_remote')}</span>
                        </div>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.closeMappingModal(); if(window.app && window.app.navigateToDiagnostics) { window.app.navigateToDiagnostics(); } else if(window.app && window.app.loadView) { window.app.loadView('config'); }" style="font-size: 11.5px; padding: 4px 10px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px; color: var(--text-main); border: 1px solid var(--border-color); background: var(--bg-surface); cursor: pointer;" title="${window.i18n.t('bank_sync_btn_config_diag')}">
                            ⚙️ ${window.i18n.t('bank_sync_btn_config_diag')}
                        </button>
                    </div>
                    <div style="color: var(--text-main); font-size: 12.5px; line-height: 1.4; margin-bottom: 14px;">
                        ${errorMsg}
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; padding-top: 10px; border-top: 1px dashed rgba(239,68,68,0.2);">
                        <button class="btn btn-primary" onclick="window.BankSyncView.openMappingModal(${connId}, true)" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; font-weight: 600;">
                            🔄 ${window.i18n.t('bank_sync_btn_retry')}
                        </button>
                        <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.copyReportToClipboard('Erreur synchro bancaire: ${conn.backend || connId} - ${errorMsg.replace(/'/g, "\\'")}');" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;" title="${window.i18n.t('bank_sync_btn_copy_report')}">
                            📋 ${window.i18n.t('bank_sync_btn_copy_report')}
                        </button>
                        <button class="btn btn-secondary" onclick="if(window.ErrorReporter) window.ErrorReporter.openGitHubIssue('Erreur synchro bancaire: ${conn.backend || connId}');" style="font-size: 12px; padding: 5px 12px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px;" title="${window.i18n.t('bank_sync_btn_github_issue')}">
                            🐙 ${window.i18n.t('bank_sync_btn_github_issue')}
                        </button>
                    </div>
                </div>
            `;
        });
    },

    closeMappingModal() {
        if (this.mappingEventSource) {
            this.mappingEventSource.close();
            this.mappingEventSource = null;
        }
        document.getElementById('mappingModal').style.display = 'none';
    },

    renderMappingRows(connection, remoteAccounts) {
        const container = document.getElementById('mappingRowsContainer');
        if (!container) return;

        if (remoteAccounts.length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 20px; color: var(--text-muted);">Aucun compte trouvé sur votre banque.</div>';
            return;
        }

        let currentMapping = {};
        if (connection.account_mapping) {
            try {
                currentMapping = typeof connection.account_mapping === 'string' 
                    ? JSON.parse(connection.account_mapping) 
                    : connection.account_mapping;
            } catch (_) {
                currentMapping = {};
            }
        }

        const localAccOptions = '<option value="">-- Ne pas synchroniser --</option>' + 
            this.localAccounts.map(a => `<option value="${a.id}">${a.name} (${a.type})</option>`).join('');

        const detectType = (r) => {
            const rawLower = (r.type || '').toLowerCase();
            const nameLower = (r.label || '').toLowerCase();
            if (rawLower.includes('prêt') || rawLower.includes('pret') || rawLower.includes('emprunt') || rawLower.includes('loan') || rawLower.includes('crédit') || rawLower.includes('credit') || nameLower.includes('prêt') || nameLower.includes('pret') || nameLower.includes('emprunt')) {
                return 'Prêt / Emprunt';
            }
            if (rawLower.includes('livret') || rawLower.includes('saving') || rawLower.includes('epargne') || rawLower.includes('épargne')) {
                return 'Livret';
            }
            if (rawLower.includes('pea')) {
                return 'PEA';
            }
            if (rawLower.includes('assurance')) {
                return 'Assurance Vie';
            }
            if (rawLower.includes('per')) {
                return 'PER';
            }
            return 'Compte courant';
        };

        container.innerHTML = remoteAccounts.map(r => {
            const mappedLocalId = currentMapping[r.id] || '';
            const balStr = `${r.balance >= 0 ? '+' : ''}${r.balance.toFixed(2)} ${r.currency || '€'}`;
            const balColor = r.balance < 0 ? '#ef4444' : '#10b981';
            const detectedType = detectType(r);

            return `
            <div style="background: var(--bg-base); border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 18px; display: flex; flex-direction: column; gap: 10px;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <div>
                        <div style="font-weight: 700; font-size: 14px; color: var(--text-main);">${r.label}</div>
                        <div style="font-size: 12px; color: var(--text-muted); display: flex; gap: 10px; margin-top: 2px;">
                            <span>Type: <strong>${r.type}</strong></span>
                            <span>N°: <strong>${r.id}</strong></span>
                            <span>Solde: <strong style="color: ${balColor};">${balStr}</strong></span>
                        </div>
                    </div>

                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <span style="font-size: 12px; color: var(--text-muted); font-weight: 600;">Lié à :</span>
                        <select class="input-styled mapping-select" data-remote-id="${r.id}" style="min-width: 200px; padding: 6px 10px;">
                            ${localAccOptions}
                        </select>
                        <button class="btn btn-secondary" onclick="window.BankSyncView.toggleQuickCreateForm('${r.id}')" style="font-size: 11px; padding: 6px 10px; border-radius: 8px; white-space: nowrap; display: inline-flex; align-items: center; gap: 4px;" title="Personnaliser et créer ce compte dans OmniBank">
                            <span>➕</span> <span>Créer dans OmniBank</span>
                        </button>
                    </div>
                </div>

                <!-- Mini-formulaire in-line de création personnalisée -->
                <div id="qcBox_${r.id}" style="display: none; padding: 12px 14px; background: var(--bg-card); border: 1px dashed var(--accent-border, var(--border-color)); border-radius: 10px; margin-top: 4px;">
                    <div style="font-size: 11px; font-weight: 700; color: var(--accent); margin-bottom: 8px; display: flex; align-items: center; gap: 6px;">
                        <span>✨</span> <span data-i18n="bank_sync_custom_create_title">${window.i18n.t('bank_sync_custom_create_title')}</span>
                    </div>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end;">
                        <div style="flex: 2; min-width: 150px;">
                            <label style="font-size: 10px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;" data-i18n="bank_sync_custom_create_name">${window.i18n.t('bank_sync_custom_create_name')}</label>
                            <input type="text" id="qcName_${r.id}" class="input-styled" value="${r.label.replace(/"/g, '&quot;')}" style="width: 100%; height: 32px; padding: 0 8px; font-size: 12px;">
                        </div>
                        <div style="flex: 1.5; min-width: 130px;">
                            <label style="font-size: 10px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;" data-i18n="bank_sync_custom_create_type">${window.i18n.t('bank_sync_custom_create_type')}</label>
                            <select id="qcType_${r.id}" class="input-styled" style="width: 100%; height: 32px; padding: 0 8px; font-size: 12px;">
                                <option value="Compte courant" ${detectedType === 'Compte courant' ? 'selected' : ''}>${window.i18n.t('wizard_type_checking')}</option>
                                <option value="Livret" ${detectedType === 'Livret' ? 'selected' : ''}>${window.i18n.t('wizard_type_savings')}</option>
                                <option value="PEA" ${detectedType === 'PEA' ? 'selected' : ''}>${window.i18n.t('wizard_type_pea')}</option>
                                <option value="Assurance Vie" ${detectedType === 'Assurance Vie' ? 'selected' : ''}>${window.i18n.t('wizard_type_life_ins')}</option>
                                <option value="PER" ${detectedType === 'PER' ? 'selected' : ''}>${window.i18n.t('wizard_type_per')}</option>
                                <option value="Prêt / Emprunt" ${detectedType === 'Prêt / Emprunt' ? 'selected' : ''}>${window.i18n.t('wizard_type_loan') || 'Prêt / Emprunt'}</option>
                            </select>
                        </div>
                        <div style="flex: 1; min-width: 100px;">
                            <label style="font-size: 10px; font-weight: 600; color: var(--text-muted); display: block; margin-bottom: 3px;" data-i18n="bank_sync_custom_create_balance">${window.i18n.t('bank_sync_custom_create_balance')}</label>
                            <input type="number" step="0.01" id="qcBal_${r.id}" class="input-styled" value="${r.balance || 0}" style="width: 100%; height: 32px; padding: 0 8px; font-size: 12px;">
                        </div>
                        <div style="display: flex; gap: 6px;">
                            <button class="btn btn-primary" onclick="window.BankSyncView.submitQuickCreate('${r.id}', '${r.currency || 'EUR'}')" style="height: 32px; padding: 0 12px; font-size: 11px; font-weight: 700; white-space: nowrap; border-radius: 6px;">
                                <span data-i18n="bank_sync_custom_create_submit">${window.i18n.t('bank_sync_custom_create_submit')}</span>
                            </button>
                            <button class="btn btn-secondary" onclick="window.BankSyncView.toggleQuickCreateForm('${r.id}')" style="height: 32px; padding: 0 10px; font-size: 11px; white-space: nowrap; border-radius: 6px;">
                                <span data-i18n="bank_sync_custom_create_cancel">${window.i18n.t('bank_sync_custom_create_cancel')}</span>
                            </button>
                        </div>
                    </div>
                    <div style="font-size: 10px; color: var(--text-muted); font-style: italic; margin-top: 6px; line-height: 1.3;" data-i18n="bank_sync_custom_create_bal_hint">
                        💡 ${window.i18n.t('bank_sync_custom_create_bal_hint')}
                    </div>
                </div>
            </div>
            `;
        }).join('');

        // Pré-sélectionner les options
        container.querySelectorAll('.mapping-select').forEach(sel => {
            const remId = sel.getAttribute('data-remote-id');
            if (currentMapping[remId]) {
                sel.value = currentMapping[remId];
            }
        });
    },

    toggleQuickCreateForm(remoteId) {
        const box = document.getElementById(`qcBox_${remoteId}`);
        if (!box) return;
        const isHidden = box.style.display === 'none';
        box.style.display = isHidden ? 'block' : 'none';
        if (isHidden) {
            const nameInput = document.getElementById(`qcName_${remoteId}`);
            if (nameInput) nameInput.focus();
        }
    },

    async submitQuickCreate(remoteId, currency = 'EUR') {
        const nameInput = document.getElementById(`qcName_${remoteId}`);
        const typeSelect = document.getElementById(`qcType_${remoteId}`);
        const balInput = document.getElementById(`qcBal_${remoteId}`);

        const finalName = nameInput ? nameInput.value.trim() : '';
        const finalType = typeSelect ? typeSelect.value : 'Compte courant';
        const finalBal = balInput ? parseFloat(balInput.value) || 0.0 : 0.0;

        if (!finalName) {
            this.showToast('Veuillez indiquer un nom de compte.', 'warning');
            return;
        }

        try {
            const newAcc = await API.post('/api/accounts/', {
                name: finalName,
                type: finalType,
                initial_balance: finalBal,
                currency: currency || 'EUR'
            });

            await this.loadLocalAccounts();
            if (window.app && window.app.refreshSidebar) {
                window.app.refreshSidebar();
            }
            if (window.AccountsView && typeof window.AccountsView.loadData === 'function') {
                window.AccountsView.loadData();
            }

            // Récupérer le mapping courant depuis le DOM
            const currentMapping = {};
            document.querySelectorAll('.mapping-select').forEach(sel => {
                const remId = sel.getAttribute('data-remote-id');
                if (sel.value) currentMapping[remId] = parseInt(sel.value);
            });
            currentMapping[remoteId] = newAcc.id;

            const conn = this.connections.find(c => c.id === this.activeConnId);
            if (conn) {
                conn.account_mapping = JSON.stringify(currentMapping);
            }

            this.renderMappingRows(conn, this.currentRemoteAccounts || []);
            this.showToast(`Compte "${newAcc.name}" (${finalType}) créé et associé avec succès !`, 'success');
        } catch (err) {
            this.showToast('Erreur création compte : ' + (err.detail || err.message), 'error');
        }
    },

    async saveMapping() {
        const connId = this.activeConnId;
        if (!connId) return;

        const mapping = {};
        document.querySelectorAll('.mapping-select').forEach(sel => {
            const remoteId = sel.getAttribute('data-remote-id');
            const localId = parseInt(sel.value);
            if (remoteId && localId) {
                mapping[remoteId] = localId;
            }
        });

        try {
            await API.put(`/api/bank-sync/connections/${connId}`, {
                account_mapping: mapping
            });
            this.closeMappingModal();
            await this.loadConnections();
            this.showToast('Association des comptes enregistrée !', 'success');
        } catch (err) {
            this.showToast('Erreur : ' + (err.detail || err.message), 'error');
        }
    },

    // ── GESTION ANTI-SPAM & COOLDOWN ─────────────────────────────────
    async openCachedPreviewDirectly(connId) {
        // Toujours interroger en priorité le sas unifié du serveur (/api/bank-sync/pending)
        try {
            const data = await API.get('/api/bank-sync/pending');
            if (data && data.accounts && data.accounts.length > 0) {
                const connAccounts = data.accounts.filter(a => !a.connection_id || a.connection_id === connId);
                const accountsToUse = connAccounts.length > 0 ? connAccounts : data.accounts;
                const preview = {
                    connection_id: connId,
                    accounts: accountsToUse
                };
                this.saveCachedPreview(connId, preview);
                await this.openReviewModal(connId, preview);
                return;
            }
        } catch (_) {}

        const cached = this.getCachedPreview(connId);
        if (cached && cached.data) {
            await this.openReviewModal(connId, cached.data);
            return;
        }

        this.showToast('Aucun aperçu récent disponible pour cette connexion.', 'info');
    },

    async promptAndSync(connId) {
        this.activeConnId = connId;
        const conn = this.connections.find(c => c.id === connId);
        const cached = this.getCachedPreview(connId);

        let lastTime = 0;
        if (cached && cached.timestamp) {
            lastTime = cached.timestamp;
        } else if (conn && conn.last_sync_at) {
            lastTime = new Date(conn.last_sync_at).getTime();
        }

        const elapsedMs = Date.now() - lastTime;

        // Si la dernière synchronisation a eu lieu il y a moins de 5 minutes :
        if (lastTime > 0 && elapsedMs < this.COOLDOWN_MS) {
            this.showCooldownModal(connId, elapsedMs, cached);
            return;
        }

        // Sinon : déroulement normal
        await this._startFreshSync(connId);
    },

    showCooldownModal(connId, elapsedMs, cached) {
        const modal = document.getElementById('bankSyncCooldownModal');
        const msgEl = document.getElementById('cooldownModalMsg');
        const btnReopen = document.getElementById('btnReopenCachedPreview');

        const elapsedSec = Math.floor(elapsedMs / 1000);
        const elapsedMin = Math.floor(elapsedSec / 60);
        const remainingSec = Math.floor((this.COOLDOWN_MS - elapsedMs) / 1000);
        const remainingMin = Math.ceil(remainingSec / 60);

        const timeAgoStr = elapsedMin > 0 ? `${elapsedMin} min` : `${elapsedSec} sec`;

        msgEl.innerHTML = `
            Une synchronisation a déjà été effectuée il y a <strong>${timeAgoStr}</strong> (délai de sécurité conseillé : <strong>5 min</strong> — reste ~${remainingMin} min).<br><br>
            Pour préserver l'accès à votre banque et éviter tout blocage ou demande de code 2FA répétée, vous pouvez consulter directement le dernier relevé obtenu sans réinterroger les serveurs de la banque.
        `;

        if (cached && cached.data) {
            let totalOps = 0;
            (cached.data.accounts || []).forEach(a => totalOps += (a.transactions || []).length);
            btnReopen.innerHTML = `📋 Rouvrir le dernier aperçu (${totalOps} opérations)`;
            btnReopen.style.display = 'flex';
        } else {
            btnReopen.style.display = 'none';
        }

        modal.style.display = 'flex';
    },

    reopenCachedPreview() {
        this.closeCooldownModal();
        if (this.activeConnId) {
            const cached = this.getCachedPreview(this.activeConnId);
            if (cached && cached.data) {
                this.openReviewModal(this.activeConnId, cached.data);
            }
        }
    },

    async forceSyncAnyway() {
        this.closeCooldownModal();
        if (this.activeConnId) {
            await this._startFreshSync(this.activeConnId);
        }
    },

    closeCooldownModal() {
        document.getElementById('bankSyncCooldownModal').style.display = 'none';
    },

    async _startFreshSync(connId) {
        let pw = null;
        const token = this.getVaultToken();
        if (token && this.vaultStatus?.is_unlocked) {
            pw = "__USE_VAULT_TOKEN__";
        } else {
            pw = await this.promptMasterPassword(
                'Synchronisation bancaire',
                'Entrez votre mot de passe maître pour synchroniser vos comptes :'
            );
        }
        if (!pw) return;

        this.activeConnId = connId;
        this.startSyncStream(connId, pw !== "__USE_VAULT_TOKEN__" ? pw : null, token);
    },

    startSyncStream(connId, masterPassword, vaultToken) {
        const progressModal = document.getElementById('syncProgressModal');
        const progressTitle = document.getElementById('syncProgressTitle');
        const progressMsg = document.getElementById('syncProgressMsg');
        const progressBar = document.getElementById('syncProgressBar');

        progressModal.style.display = 'flex';
        progressTitle.innerText = 'Connexion à la banque en cours...';
        progressMsg.innerText = 'Établissement du canal sécurisé...';
        progressBar.style.width = '25%';

        let url = `/api/bank-sync/connections/${connId}/sync-stream?since_days=90`;
        if (masterPassword) url += `&master_password=${encodeURIComponent(masterPassword)}`;
        if (vaultToken) url += `&vault_token=${encodeURIComponent(vaultToken)}`;

        const es = new EventSource(url);
        this.eventSource = es;

        es.addEventListener('progress', (e) => {
            const data = JSON.parse(e.data);
            progressMsg.innerText = data.message || 'Synchronisation...';
            if (data.step === 'auth') progressBar.style.width = '45%';
            if (data.step === 'sync_account') progressBar.style.width = '75%';
        });

        es.addEventListener('2fa_required', (e) => {
            const data = JSON.parse(e.data);
            this.activeSessionId = data.session_id;
            this.show2FAModal(data.type, data.message);
        });

        es.addEventListener('preview_ready', (e) => {
            const previewData = JSON.parse(e.data);
            this.saveCachedPreview(connId, previewData);
            progressBar.style.width = '100%';
            es.close();
            this.eventSource = null;
            this.refreshActiveViews();
            setTimeout(() => {
                progressModal.style.display = 'none';
                this.openReviewModal(connId, previewData);
                this.renderConnectionsList();
            }, 500);
        });

        es.addEventListener('done', (e) => {
            const data = JSON.parse(e.data);
            progressBar.style.width = '100%';
            es.close();
            this.eventSource = null;
            setTimeout(() => {
                progressModal.style.display = 'none';
                if (data.accounts) {
                    this.saveCachedPreview(connId, data);
                    this.openReviewModal(connId, data);
                    this.renderConnectionsList();
                } else {
                    this.loadConnections();
                }
            }, 500);
        });

        es.addEventListener('error', (e) => {
            let msg = 'Erreur lors de la synchronisation.';
            try {
                if (e.data) {
                    const data = JSON.parse(e.data);
                    msg = data.message || msg;
                }
            } catch (_) {}
            es.close();
            this.eventSource = null;
            progressModal.style.display = 'none';
            this.showToast('Échec de la synchronisation : ' + msg, 'error');
            this.loadConnections();
        });
    },

    // ── REVUE DES OPÉRATIONS (STYLE IMPORT CSV & IA CONDITIONNELLE) ──
    async openReviewModal(connId, previewData) {
        this.ensureModalsExist();
        if (!window.app?.categoriesList || window.app.categoriesList.length === 0) {
            try {
                window.app.categoriesList = await API.get('/api/categories/');
            } catch (_) {
                window.app.categoriesList = [];
            }
        }
        this.activeConnId = connId;
        this.previewData = previewData;
        this.currentAccountIndex = 0;
        this.currentFilter = 'all';

        // 1. Résolution proactive Smart Label pour garantir l'application des règles et la conservation du nom brut
        try {
            const unrecTxs = [];
            (this.previewData?.accounts || []).forEach(acc => {
                (acc.transactions || []).forEach(t => {
                    if (!t.is_reconciled) {
                        unrecTxs.push(t);
                    }
                });
            });

            if (unrecTxs.length > 0) {
                const rawLabels = Array.from(new Set(unrecTxs.map(t => t.raw_description || t.description)));
                const smartRes = await API.post('/api/smart-labels/resolve-batch', { labels: rawLabels });
                if (smartRes && smartRes.results) {
                    unrecTxs.forEach(t => {
                        const raw = t.raw_description || t.description;
                        t.raw_description = raw;
                        if (smartRes.results[raw]) {
                            const r = smartRes.results[raw];
                            if (r.source === 'rule' || r.source === 'history') {
                                t.description = r.description;
                                if (r.category && !t.category) {
                                    t.category = r.category;
                                }
                                t.smart_suggested = true;
                            }
                        }
                    });
                }
            }
        } catch (e) {
            console.warn('[BankSync] Erreur smart label resolve dans review modal:', e);
        }

        const modal = document.getElementById('bankSyncReviewModal');
        if (modal) modal.style.display = 'flex';

        // Adapter la visibilité du bouton IA global selon paramètre enable_ai
        const aiBtn = document.getElementById('btnSyncCategorizeAllAI');
        if (aiBtn) {
            aiBtn.style.display = this.isAIEnabled() ? 'inline-flex' : 'none';
        }

        this.renderAccountTabs();
        this.renderReviewTable();
    },

    closeReviewModal() {
        document.getElementById('bankSyncReviewModal').style.display = 'none';
        this.previewData = null;
    },

    renderAccountTabs() {
        const container = document.getElementById('reviewAccountTabs');
        if (!container || !this.previewData || !this.previewData.accounts) return;

        const accs = this.previewData.accounts;
        if (accs.length <= 1) {
            container.innerHTML = `<span style="font-weight: 700; font-size: 13px; color: var(--text-main);">${accs[0]?.account_name || 'Compte'}</span>`;
            return;
        }

        container.innerHTML = accs.map((acc, idx) => `
            <button class="btn btn-sm ${idx === this.currentAccountIndex ? 'btn-primary' : 'btn-secondary'}" 
                    onclick="window.BankSyncView.switchAccountTab(${idx})" 
                    style="padding: 4px 12px; font-size: 12px; border-radius: 8px;">
                ${acc.account_name} (${acc.transactions?.length || 0})
            </button>
        `).join('');
    },

    switchAccountTab(idx) {
        this.currentAccountIndex = idx;
        this.renderAccountTabs();
        this.renderReviewTable();
    },

    setReviewFilter(filter) {
        this.currentFilter = filter;

        ['btnSyncFilterAll', 'btnSyncFilterAdd', 'btnSyncFilterReconcile', 'btnSyncFilterIgnored'].forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.style.background = 'transparent';
                btn.style.borderColor = 'var(--border-color)';
                btn.style.color = 'var(--text-muted)';
            }
        });

        const activeMap = {
            'all': 'btnSyncFilterAll',
            'add': 'btnSyncFilterAdd',
            'reconcile': 'btnSyncFilterReconcile',
            'ignored': 'btnSyncFilterIgnored'
        };
        const activeBtn = document.getElementById(activeMap[filter]);
        if (activeBtn) {
            activeBtn.style.background = 'var(--accent)';
            activeBtn.style.borderColor = 'var(--accent)';
            activeBtn.style.color = 'white';
        }

        this.renderReviewTable();
    },

    renderReviewTable() {
        const tbody = document.getElementById('bankSyncReviewBody');
        if (!tbody || !this.previewData || !this.previewData.accounts) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_transactions')}</td></tr>`;
            return;
        }

        const txs = currentAcc.transactions;
        const categories = window.app?.categoriesList || [];
        const aiEnabled = this.isAIEnabled();

        let visibleTxs = txs.filter(tx => {
            if (this.currentFilter === 'all') return true;
            if (this.currentFilter === 'ignored') return tx.is_reconciled && tx.already_reconciled;
            if (this.currentFilter === 'reconcile') return tx.is_reconciled && !tx.already_reconciled;
            if (this.currentFilter === 'add') return !tx.is_reconciled;
            return true;
        });

        if (visibleTxs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 40px; color: var(--text-muted);">${window.i18n.t('bank_sync_no_transactions_filter')}</td></tr>`;
            this.updateReviewSummary();
            return;
        }

        const lblInDb = window.i18n.t('bank_sync_in_db') || 'En base :';
        const lblAutoCat = window.i18n.t('bank_sync_auto_cat') || '(Automatique)';
        const lblSelectCat = window.i18n.t('bank_sync_select_category') || '-- Catégorie --';
        const lblIgnoreRow = window.i18n.t('bank_sync_ignore_row_tooltip') || 'Ignorer cette ligne';

        tbody.innerHTML = visibleTxs.map((tx) => {
            const isRec = tx.is_reconciled;
            const alreadyRec = tx.already_reconciled;

            let statusBadge = '';
            let actionText = '';
            let actionColor = '';

            if (isRec && alreadyRec) {
                if (tx.is_mirror_transfer) {
                    const badgeLabel = window.i18n.t('bank_sync_mirror_transfer_badge') || 'Virement miroir';
                    const badgeTip = (window.i18n.t('bank_sync_mirror_transfer_tooltip') || 'Écriture miroir d\'un virement interne déjà enregistré.').replace(/"/g, '&quot;');
                    statusBadge = `<span class="badge" style="background:rgba(99,102,241,0.12); color:var(--accent); border:1px solid rgba(99,102,241,0.3); cursor:help; display:inline-flex; align-items:center; gap:4px;" title="${badgeTip}"><span>${badgeLabel}</span> <span style="font-size:11px; opacity:0.8;">ℹ️</span></span>`;
                    actionText = window.i18n.t('bank_sync_mirror_transfer_action') || 'Ignorée (miroir de virement)';
                    actionColor = `color: var(--text-muted);`;
                } else {
                    statusBadge = `<span class="badge" style="background:var(--bg-surface); color:var(--text-muted); border:1px solid var(--border-color);">${window.i18n.t('bank_sync_status_already_processed')}</span>`;
                    actionText = window.i18n.t('bank_sync_action_ignored_duplicate') || 'Ignorée (doublon)';
                    actionColor = `color: var(--text-muted);`;
                }
            } else if (isRec && !alreadyRec) {
                statusBadge = `<span class="badge" style="background:var(--color-income, #10b981); color:white;">${window.i18n.t('bank_sync_status_to_reconcile')}</span>`;
                actionText = window.i18n.t('bank_sync_action_will_reconcile') || 'Sera pointée';
                actionColor = `color: var(--color-income, #10b981);`;
            } else {
                statusBadge = `<span class="badge" style="background:var(--color-expense, #6366f1); color:white;">${window.i18n.t('bank_sync_status_to_add')}</span>`;
                actionText = window.i18n.t('bank_sync_action_new_operation') || 'Nouvelle opération';
                actionColor = `color: var(--color-expense, #6366f1);`;
            }

            const showRaw = tx.raw_description && tx.raw_description !== tx.description;
            const tipSuggested = (window.i18n ? window.i18n.t('smart_label_suggested_tooltip') || window.i18n.t('smart_label_suggested') || 'Suggéré d’après votre historique / règles' : 'Suggéré d’après votre historique / règles').replace(/"/g, '&quot;');
            const rawSubHtml = showRaw 
                ? `<div style="font-size: 11px; color: var(--text-muted); font-style: italic; margin-top: 3px; font-weight: normal; opacity: 0.85; display: flex; align-items: center; gap: 4px;"><span>🏛️</span> <span>${window.escapeHtml ? window.escapeHtml(tx.raw_description) : tx.raw_description}</span> ${tx.smart_suggested ? `<span title="${tipSuggested}" style="cursor:help; font-size:11px;">💡</span>` : ''}</div>` 
                : '';
            const dbDesc = (tx.db_description && tx.db_description !== tx.description) 
                ? `<div style="font-size: 11px; color: var(--text-muted); margin-bottom: 3px;">${lblInDb} ${window.escapeHtml ? window.escapeHtml(tx.db_description) : tx.db_description}</div>` 
                : '';

            const descInput = isRec 
                ? `${dbDesc}<input type="text" class="sync-desc input-styled" value="${(tx.description || '').replace(/"/g, '&quot;')}" style="width: 100%; border: 1px solid transparent; background: transparent; padding: 4px; color: var(--text-muted);" readonly>${rawSubHtml}` 
                : `${dbDesc}<input type="text" class="sync-desc input-styled" value="${(tx.description || '').replace(/"/g, '&quot;')}" style="width: 100%; padding: 4px;" onchange="window.BankSyncView.updateTxDesc(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">${rawSubHtml}`;

            const catOptions = `<option value="">${lblSelectCat}</option>` + categories.filter(c => !c.is_closed).map(c => 
                `<option value="${c.name.replace(/"/g, '&quot;')}" ${tx.category === c.name ? 'selected' : ''}>${c.name}</option>`
            ).join('');

            const aiButtonHtml = (!isRec && aiEnabled) ? `
                <button class="btn btn-secondary" style="padding: 3px 6px; font-size: 11px; border-radius: 6px;" onclick="window.BankSyncView.categorizeRowAI('${tx.csv_id}', this)" title="${window.i18n.t('bank_categorize_ai_tooltip')}">🧠</button>
            ` : '';

            const catSelect = isRec 
                ? `<span style="color: var(--text-muted); font-size: 12px; font-style: italic;">${lblAutoCat}</span>`
                : `
                <div style="display: flex; gap: 4px; align-items: center;">
                    <select class="input-styled sync-cat" id="catSel_${tx.csv_id}" style="flex: 1; padding: 4px;" onchange="window.BankSyncView.updateTxCat(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">
                        ${catOptions}
                    </select>
                    ${aiButtonHtml}
                </div>
                `;

            const amountColor = (tx.raw_amount < 0) ? '#ef4444' : '#10b981';
            const amountInput = isRec 
                ? `<span style="font-weight: 700; color: ${amountColor};">${(tx.raw_amount < 0 ? '-' : '+')} ${tx.amount.toFixed(2)} €</span>`
                : `<input type="number" step="0.01" class="input-styled" value="${tx.amount.toFixed(2)}" style="width: 80px; text-align: right; padding: 4px; font-weight: 700; color: ${amountColor};" onchange="window.BankSyncView.updateTxAmount(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">`;

            return `
            <tr id="syncRow_${tx.csv_id}" style="border-bottom: 1px solid var(--border-color); ${alreadyRec ? 'opacity: 0.6;' : ''}">
                <td style="padding: 10px 14px;">
                    <input type="date" class="input-styled sync-date" value="${tx.date_operation}" style="width: 120px; padding: 4px;" ${isRec ? 'disabled' : ''} onchange="window.BankSyncView.updateTxDate(${this.currentAccountIndex}, '${tx.csv_id}', this.value)">
                </td>
                <td style="padding: 10px 14px;">${descInput}</td>
                <td style="padding: 10px 14px;">${catSelect}</td>
                <td style="padding: 10px 14px; text-align: right;">
                    ${amountInput}
                </td>
                <td style="padding: 10px 14px; text-align: center;">${statusBadge}</td>
                <td style="padding: 10px 14px;">
                    <div style="display: flex; align-items: center; justify-content: flex-end; gap: 10px;">
                        <span style="font-size: 11px; ${actionColor}">${actionText}</span>
                        <button class="btn btn-secondary" style="padding: 4px 8px; color: #ef4444; border: 1px solid var(--border-color); border-radius: 6px;" onclick="window.BankSyncView.removeTxRow('${tx.csv_id}')" title="${lblIgnoreRow}">✕</button>
                    </div>
                </td>
            </tr>
            `;
        }).join('');

        this.updateReviewSummary();
    },

    updateTxDesc(accIdx, csvId, newDesc) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.description = newDesc;
    },

    updateTxCat(accIdx, csvId, newCat) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.category = newCat || null;
    },

    updateTxDate(accIdx, csvId, newDate) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) tx.date_operation = newDate;
    },

    updateTxAmount(accIdx, csvId, newAmt) {
        const tx = this.previewData.accounts[accIdx]?.transactions.find(t => t.csv_id === csvId);
        if (tx) {
            const val = parseFloat(newAmt) || 0;
            tx.amount = Math.abs(val);
            tx.raw_amount = tx.raw_amount < 0 ? -Math.abs(val) : Math.abs(val);
        }
    },

    removeTxRow(csvId) {
        if (!this.previewData) return;
        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (currentAcc) {
            currentAcc.transactions = currentAcc.transactions.filter(t => t.csv_id !== csvId);
            this.renderReviewTable();
        }
    },

    // ── AUTO-CATÉGORISATION IA (Conditionnelle) ──────────────────────
    async categorizeRowAI(csvId, btnEl) {
        if (!this.isAIEnabled()) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        const tx = currentAcc?.transactions.find(t => t.csv_id === csvId);
        if (!tx) return;

        const originalText = btnEl.innerText;
        btnEl.innerText = '⏳';
        btnEl.disabled = true;

        try {
            const res = await API.post('/api/ai/categorize', { description: tx.description });
            if (res && res.category) {
                tx.category = res.category;
                const sel = document.getElementById(`catSel_${csvId}`);
                if (sel) sel.value = res.category;
                this.showToast(`Catégorie suggérée : ${res.category}`, 'success');
            }
        } catch (err) {
            this.showToast('Erreur IA : ' + (err.detail || err.message), 'error');
        } finally {
            btnEl.innerText = originalText;
            btnEl.disabled = false;
        }
    },

    async categorizeAllNewAI() {
        if (!this.isAIEnabled() || !this.previewData) return;

        const currentAcc = this.previewData.accounts[this.currentAccountIndex];
        if (!currentAcc || !currentAcc.transactions) return;

        const uncatTxs = currentAcc.transactions.filter(t => !t.is_reconciled && !t.category);
        if (uncatTxs.length === 0) {
            this.showToast('Toutes les nouvelles opérations sont déjà catégorisées.', 'info');
            return;
        }

        const btn = document.getElementById('btnSyncCategorizeAllAI');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⏳</span> <span>Catégorisation IA en cours...</span>';
        }

        try {
            const descriptions = uncatTxs.map(t => t.description);
            const res = await API.post('/api/ai/categorize_batch', { descriptions });
            if (res && res.categories) {
                uncatTxs.forEach((tx, idx) => {
                    const assigned = res.categories[idx];
                    if (assigned) {
                        tx.category = assigned;
                    }
                });
                this.renderReviewTable();
                this.showToast(`${uncatTxs.length} opération(s) catégorisée(s) par l'IA !`, 'success');
            }
        } catch (err) {
            this.showToast('Erreur catégorisation IA en lot : ' + (err.detail || err.message), 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `<span>✨</span> <span>${window.i18n.t('bank_categorize_all_ai')}</span>`;
            }
        }
    },

    updateReviewSummary() {
        const box = document.getElementById('reviewSummaryBox');
        if (!box || !this.previewData || !this.previewData.accounts) return;

        let totalNew = 0;
        let totalReconciled = 0;
        let totalIgnored = 0;

        this.previewData.accounts.forEach(acc => {
            (acc.transactions || []).forEach(tx => {
                if (tx.is_reconciled && tx.already_reconciled) {
                    totalIgnored++;
                } else if (tx.is_reconciled) {
                    totalReconciled++;
                } else {
                    totalNew++;
                }
            });
        });

        const toAddStr = window.i18n.tp('bank_sync_summary_to_add', { count: totalNew });
        const toRecStr = window.i18n.tp('bank_sync_summary_to_reconcile', { count: totalReconciled });
        const ignoredStr = window.i18n.tp('bank_sync_summary_ignored', { count: totalIgnored });

        box.innerHTML = `
            <span>🟢 <strong>${toAddStr}</strong></span>
            <span>🔵 <strong>${toRecStr}</strong></span>
            <span style="color: var(--text-muted);">⚪ <strong>${ignoredStr}</strong></span>
        `;
    },

    async commitSync() {
        if (!this.previewData || !this.activeConnId) return;

        const allTxs = [];
        this.previewData.accounts.forEach(acc => {
            (acc.transactions || []).forEach(tx => {
                allTxs.push({
                    account_id: acc.account_id,
                    date_operation: tx.date_operation,
                    description: tx.description,
                    raw_description: tx.raw_description || tx.description,
                    amount: tx.amount,
                    raw_amount: tx.raw_amount,
                    category: tx.category,
                    csv_id: tx.csv_id,
                    is_reconciled: tx.is_reconciled,
                    already_reconciled: tx.already_reconciled,
                    matched_db_id: tx.matched_db_id
                });
            });
        });

        try {
            const res = await API.post(`/api/bank-sync/connections/${this.activeConnId}/commit`, {
                transactions: allTxs
            });

            this.closeReviewModal();
            this.showToast(`Synchronisation validée : +${res.imported} ajoutée(s), ✔ ${res.reconciled} pointée(s)`, 'success');
            await this.loadConnections();
            await this.loadPendingSync();

            if (window.OverviewView && window.OverviewView.init) {
                window.OverviewView.init();
            }
            if (window.AccountsView && window.AccountsView.loadData) {
                window.AccountsView.loadData();
            }
            if (window.TimelineView && window.TimelineView.loadData) {
                window.TimelineView.loadData();
            }
            if (window.AllOperationsView && window.AllOperationsView.loadData) {
                window.AllOperationsView.loadData();
            }
            if (window.app && window.app.refreshSidebar) {
                window.app.refreshSidebar();
            }
        } catch (err) {
            this.showToast('Erreur lors de la validation : ' + (err.detail || err.message), 'error');
        }
    },

    show2FAModal(type, message) {
        const modal = document.getElementById('twoFAModal');
        const icon = document.getElementById('twoFAIcon');
        const title = document.getElementById('twoFATitle');
        const msg = document.getElementById('twoFAMessage');
        const otpContainer = document.getElementById('twoFAOtpInputContainer');
        const confirmBtn = document.getElementById('twoFAConfirmBtn');

        modal.style.display = 'flex';
        msg.innerText = message || '';

        if (type === 'app_validation') {
            icon.innerText = '📱';
            title.innerText = window.i18n.t('bank_sync_2fa_app_title');
            otpContainer.style.display = 'none';
            confirmBtn.innerText = window.i18n.t('bank_sync_2fa_app_confirm_btn');
        } else {
            icon.innerText = '🔑';
            title.innerText = window.i18n.t('bank_sync_2fa_otp_title');
            otpContainer.style.display = 'block';
            document.getElementById('twoFAOtpInput').value = '';
            confirmBtn.innerText = window.i18n.t('bank_sync_2fa_send_btn');
        }
    },

    async submit2FA() {
        if (!this.activeSessionId) return;

        const otpInput = document.getElementById('twoFAOtpInput');
        const isOtp = document.getElementById('twoFAOtpInputContainer').style.display !== 'none';
        const value = isOtp ? otpInput.value.trim() : null;

        try {
            await API.post('/api/bank-sync/2fa/respond', {
                session_id: this.activeSessionId,
                response_type: isOtp ? 'otp_code' : 'app_validated',
                value: value
            });
            document.getElementById('twoFAModal').style.display = 'none';
        } catch (err) {
            this.showToast('Erreur validation 2FA : ' + (err.detail || err.message), 'error');
        }
    },

    async cancel2FA() {
        if (this.activeSessionId) {
            try {
                await API.post('/api/bank-sync/2fa/respond', {
                    session_id: this.activeSessionId,
                    response_type: 'cancel'
                });
            } catch (_) {}
        }
        document.getElementById('twoFAModal').style.display = 'none';
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        document.getElementById('syncProgressModal').style.display = 'none';
    },

    abortSync() {
        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }
        document.getElementById('syncProgressModal').style.display = 'none';
    },

    async deleteConnection(connId) {
        const confirmed = await this.confirmAction(
            'Supprimer la connexion',
            'Voulez-vous vraiment supprimer cette connexion bancaire et ses identifiants chiffrés ?'
        );
        if (!confirmed) return;

        try {
            await API.del(`/api/bank-sync/connections/${connId}`);
            this.clearCachedRemoteAccounts(connId);
            await this.loadConnections();
            this.showToast('Connexion bancaire supprimée.', 'info');
        } catch (err) {
            this.showToast('Erreur suppression : ' + (err.detail || err.message), 'error');
        }
    }
};
